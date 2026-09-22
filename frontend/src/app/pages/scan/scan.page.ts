import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AiPick, AiResult, AiService, AiVenue } from '../../core/ai.service';
import { SaasService } from '../../core/saas.service';
import { VenueService } from '../../core/venue.service';
import { IconComponent } from '../../ui/icon.component';
import { ScoreRingComponent } from '../../ui/score-ring.component';
import { SommelierChatComponent } from '../../ui/sommelier-chat.component';
import { COOKING_LABELS, FAT_LABELS, TASTE_LABELS, WEIGHT_LABELS } from '../../core/pairing.service';
import { DataService } from '../../core/data.service';
import { I18nKey, I18nService } from '../../core/i18n.service';

type State = 'idle' | 'busy' | 'done' | 'error';
const STEPS: I18nKey[] = ['scan.step.1', 'scan.step.2', 'scan.step.3', 'scan.step.4'];

/** AI Food Scanner: фото блюда → распознавание → подбор пива из карты (или из всех 17) → объяснение. Язык ru/kk/en — через I18nService. */
@Component({
  selector: 'ft-scan',
  standalone: true,
  imports: [RouterLink, FormsModule, IconComponent, ScoreRingComponent, SommelierChatComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state() === 'idle' || state() === 'error') {
      <section class="hero">
        <div class="cam-ico"><ft-icon name="camera" [size]="30" /></div>
        <span class="eyebrow light">{{ t('common.ai') }}</span>
        <h1>{{ t('scan.title.a') }} <span class="hl">{{ t('scan.title.hl') }}</span> {{ t('scan.title.b') }}</h1>
        <p class="lead">{{ venueCtx() ? t('scan.lead.venue', { venue: venueCtx()!.name || '' }) : t('scan.lead.all', { n: data.stats().brands }) }}</p>
        <label class="btn btn-primary btn-lg btn-block cam"><input type="file" accept="image/*" capture="environment" hidden (change)="onFile($event)" /><ft-icon name="camera" [size]="20" /> {{ t('scan.camera') }}</label>
        <label class="btn btn-secondary btn-block"><input type="file" accept="image/*" hidden (change)="onFile($event)" /> {{ t('scan.gallery') }}</label>
        @if (state() === 'error') { <div class="soft warn mt12">{{ error() }}</div> }
        <p class="muted xs mt12 center">{{ t('scan.tips') }}</p>
      </section>
      <section class="section-sm">
        <div class="grid grid-3 how">
          <div class="card card-p"><b>{{ t('scan.how1.title') }}</b><p class="dim sm">{{ t('scan.how1.text') }}</p></div>
          <div class="card card-p"><b>{{ t('scan.how2.title') }}</b><p class="dim sm">{{ t('scan.how2.text') }}</p></div>
          <div class="card card-p"><b>{{ t('scan.how3.title') }}</b><p class="dim sm">{{ t('scan.how3.text') }}</p></div>
        </div>
      </section>
    }

    @if (state() === 'busy') {
      <section class="card busy">
        @if (preview()) { <img [src]="preview()" alt="" class="prev" /> }
        <div class="card-p">
          <div class="steps">
            @for (s of steps; track s; let i = $index) {
              <div class="step" [class.on]="i === stepIdx()" [class.done]="i < stepIdx()"><span class="dot">@if (i < stepIdx()) { <ft-icon name="check" [size]="12" /> }</span>{{ t(s) }}</div>
            }
          </div>
        </div>
      </section>
    }

    @if (state() === 'done' && result(); as r) {
      <section class="card res">
        <div class="res-top">
          @if (preview()) { <img [src]="preview()" alt="" class="thumb" /> }
          <div class="grow min0">
            <span class="eyebrow">{{ r.dish ? t('scan.recognised') : t('scan.clarify') }}</span>
            <h1 class="dn">{{ r.dish ? r.dish.emoji + ' ' + i18n.dishNameById(r.dish.slug, r.dish.name) : t('scan.hmm') }}</h1>
            @if (r.dish) {
              <div class="conf"><i [style.width.%]="r.dish.confidence * 100"></i></div>
              <div class="chips mt8"><span class="chip chip-sm">{{ taste(r.dish.spec.taste) }}</span><span class="chip chip-sm">{{ weight(r.dish.spec.weight) }}</span><span class="chip chip-sm">{{ t('common.fat', { level: fat(r.dish.spec.fat) }) }}</span><span class="chip chip-sm">{{ cook(r.dish.spec.cooking) }}</span>@if ((r.dish.spec.heat || 0) >= .4) { <span class="chip chip-sm hot">🌶 {{ Math.round((r.dish.spec.heat || 0) * 100) }}%</span> }</div>
            }
          </div>
        </div>
        <div class="say"><span class="av"><ft-icon name="sparkles" [size]="16" /></span><p>{{ r.reply }}</p></div>

        @if (r.picks.length) {
          <div class="picks">
            @for (p of r.picks; track p.beer_id; let i = $index) {
              <div class="pick" [class.top]="i === 0">
                <ft-score [score]="p.score" [size]="56" [stroke]="5" />
                <a class="grow min0" [routerLink]="['/beers', p.beer_id]">
                  <div class="pn">{{ p.name }} @if (i === 0) { <em>{{ t('common.best') }}</em> } @if (p.sommelier_pick) { <em class="somm">{{ t('scan.badge.somm') }}</em> }</div>
                  <div class="pw">{{ i18n.reasonText(p.why) }}</div>
                  <div class="pm">{{ i18n.matchLabel(p.match_type, p.match_label) }} · {{ styleOf(p) }} · {{ p.abv }}%</div>
                </a>
                <div class="buy">
                  @if (p.price) { <div class="pp">{{ fmt(p.price) }} {{ venueCtx()?.currency || '₸' }}</div> }
                  @if (venueCtx()) { <button type="button" class="btn btn-primary btn-sm" (click)="order(r, p)" [disabled]="ordered().has(p.beer_id)">{{ ordered().has(p.beer_id) ? '✓ ' + t('common.ordered') : t('common.order') }}</button> }
                </div>
              </div>
            }
          </div>
          @if (r.route) { <a class="btn btn-secondary btn-block mt12" [routerLink]="routePath(r.route)" [queryParams]="routeQuery(r.route)">{{ t('scan.full') }} <ft-icon name="arrow-right" [size]="16" /></a> }
        }

        <form class="fix mt12" (ngSubmit)="refine()">
          <input class="input" [ngModel]="note()" (ngModelChange)="note.set($event)" name="note" [placeholder]="t('scan.refine.placeholder')" />
          <button type="submit" class="btn btn-ghost btn-icon" [disabled]="!note().trim()" [attr.aria-label]="t('scan.refine.aria')"><ft-icon name="refresh" /></button>
        </form>
        <div class="flex g8 mt12">
          <label class="btn btn-primary grow center"><input type="file" accept="image/*" capture="environment" hidden (change)="onFile($event)" />{{ t('scan.another') }}</label>
          <button type="button" class="btn btn-ghost" (click)="reset()">{{ t('scan.reset') }}</button>
        </div>
      </section>
    }
    <ft-sommelier [venue]="venueCtx()" [table]="tableNo()" />
  `,
  styles: [`
    .hero { text-align: center; padding: 26px 18px 18px; border-radius: var(--r-xl); background: linear-gradient(160deg, #120D09 0%, #2A1F0D 55%, #6A4A17 130%); color: #F7F1E5; border: 1px solid rgba(229, 184, 73, .22); box-shadow: var(--shadow-2); }
    .cam-ico { width: 64px; height: 64px; border-radius: 20px; background: var(--grad-amber); display: grid; place-items: center; margin: 0 auto 12px; box-shadow: var(--shadow-amber); }
    .eyebrow.light { color: var(--amber-300); }
    .hero h1 { color: #fff; font-size: 1.9rem; line-height: 1.05; margin-top: 4px; } .hl { color: var(--amber-300); }
    .lead { color: rgba(255,255,255,.78); margin: 10px auto 18px; max-width: 420px; }
    .cam { margin-bottom: 10px; } .hero .btn-secondary { background: rgba(255,255,255,.1); color: #fff; border-color: rgba(255,255,255,.25); }
    .section-sm { margin-top: 16px; } .how b { display: block; margin-bottom: 6px; }
    .busy { overflow: hidden; } .prev { width: 100%; max-height: 300px; object-fit: cover; display: block; }
    .steps { display: grid; gap: 10px; } .step { display: flex; align-items: center; gap: 10px; color: var(--ink-3); font-weight: 600; transition: color var(--t-med); }
    .step.on { color: var(--ink); } .step.done { color: var(--ok); }
    .dot { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--line); display: grid; place-items: center; flex-shrink: 0; }
    .step.on .dot { border-color: var(--amber-500); animation: pulse 1s infinite; } .step.done .dot { background: var(--ok); border-color: var(--ok); color: #fff; }
    @keyframes pulse { 50% { box-shadow: 0 0 0 6px rgba(224,138,40,.18); } }
    .res { padding: 16px; } .res-top { display: flex; gap: 14px; align-items: center; }
    .thumb { width: 84px; height: 84px; border-radius: 18px; object-fit: cover; flex-shrink: 0; }
    .dn { font-size: 1.5rem; line-height: 1.1; } .min0 { min-width: 0; }
    .conf { height: 4px; border-radius: 4px; background: var(--line-2); margin-top: 8px; max-width: 160px; } .conf i { display: block; height: 100%; border-radius: 4px; background: var(--grad-amber); }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; } .chip.hot { background: var(--warn-bg); color: var(--warn); }
    .say { display: flex; gap: 10px; align-items: flex-start; margin-top: 14px; padding: 12px; border-radius: 16px; background: var(--surface-2); border: 1px solid var(--line-2); }
    .say p { font-size: .95rem; line-height: 1.5; } .av { width: 30px; height: 30px; border-radius: 10px; background: var(--grad-amber); color: #fff; display: grid; place-items: center; flex-shrink: 0; }
    .picks { display: grid; gap: 8px; margin-top: 14px; }
    .pick { display: flex; gap: 12px; align-items: center; padding: 12px; border-radius: 18px; border: 1.5px solid var(--line); background: var(--surface); }
    .pick.top { border-color: var(--amber-500); background: var(--amber-100); }
    .pn { font-family: var(--font-display); font-weight: 800; } .pn em { font-style: normal; font-size: .6rem; text-transform: uppercase; letter-spacing: .08em; background: var(--amber-500); color: #fff; padding: 2px 7px; border-radius: 999px; margin-left: 4px; vertical-align: middle; } .pn em.somm { background: var(--violet); }
    .pw { font-size: .82rem; color: var(--ink-2); margin-top: 2px; } .pm { font-size: .7rem; color: var(--ink-3); margin-top: 2px; }
    .buy { display: grid; gap: 6px; justify-items: end; flex-shrink: 0; } .pp { font-family: var(--font-display); font-weight: 800; }
    .fix { display: flex; gap: 8px; } .fix .input { flex: 1; }
    .soft.warn { background: var(--warn-bg); color: var(--warn); padding: 10px 14px; border-radius: var(--r-md); text-align: left; }
  `],
})
export class ScanPage {
  ai = inject(AiService);
  data = inject(DataService);
  i18n = inject(I18nService);
  private saas = inject(SaasService);
  private venueSvc = inject(VenueService);
  readonly Math = Math;
  /** t() читает сигнал языка — шаблон перерисуется при его смене. */
  readonly t = this.i18n.t;
  readonly steps = STEPS;

  venue = input<string | undefined>();     // ?venue=slug (гостевое меню)
  table = input<string | undefined>();

  readonly state = signal<State>('idle');
  readonly error = signal('');
  readonly preview = signal<string | null>(null);
  readonly result = signal<AiResult | null>(null);
  readonly stepIdx = signal(0);
  readonly note = signal('');
  readonly ordered = signal(new Set<string>());
  readonly venueCtx = signal<AiVenue | null>(null);
  readonly tableNo = computed(() => { const t = parseInt(this.table() || '', 10); return Number.isFinite(t) ? t : null; });
  private file: Blob | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(async () => {
      const slug = this.venue() || this.venueSvc.venue()?.id;
      if (!slug) { this.venueCtx.set(null); return; }
      const m = await this.saas.loadMenu(slug, this.tableNo());
      this.venueCtx.set(m ? { slug, name: m.venue.name, beers: m.beers.map(b => b.ref_slug), currency: m.venue.currency,
        prices: Object.fromEntries(m.beers.map(b => [b.ref_slug, b.price])), volumes: Object.fromEntries(m.beers.map(b => [b.ref_slug, b.volume])) } : null);
    }, { allowSignalWrites: true });
  }

  async onFile(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0]; input.value = '';
    if (!f) return;
    this.file = f; this.note.set('');
    try { this.preview.set(URL.createObjectURL(f)); } catch { this.preview.set(null); }
    await this.run('');
  }
  async refine(): Promise<void> { if (this.file && this.note().trim()) await this.run(this.note().trim()); }

  private async run(note: string): Promise<void> {
    if (!this.file) return;
    this.state.set('busy'); this.stepIdx.set(0); this.startSteps();
    const r = await this.ai.vision(this.file, { venue: this.venueCtx() }, note);
    this.stopSteps();
    if (!r.ok) { this.error.set(r.error); this.state.set('error'); return; }
    this.result.set(r); this.state.set('done'); this.ordered.set(new Set());
    const v = this.venueCtx();
    if (v && r.picks[0]) this.saas.track({ venue: v.slug, kind: 'PAIR_VIEW', dish: r.dish?.slug || r.dish?.name, beer: r.picks[0].beer_id, score: r.picks[0].score, table: this.tableNo() });
  }
  order(r: AiResult, p: AiPick): void {
    const v = this.venueCtx(); if (!v) return;
    this.saas.track({ venue: v.slug, kind: 'ORDER_INTENT', dish: r.dish?.slug || r.dish?.name, beer: p.beer_id, score: p.score, price: p.price, table: this.tableNo() });
    this.ordered.update(s => new Set(s).add(p.beer_id));
  }
  reset(): void { this.state.set('idle'); this.result.set(null); this.preview.set(null); this.file = null; }

  taste = (t: string) => this.i18n.tasteLabel(t, (TASTE_LABELS as Record<string, string>)[t] || t);
  weight = (w: string) => this.i18n.weightLabel(w, (WEIGHT_LABELS as Record<string, string>)[w] || w);
  fat = (f: string) => this.i18n.fatLabel(f, (FAT_LABELS as Record<string, string>)[f] || f);
  cook = (c: string) => this.i18n.cookingLabel(c, (COOKING_LABELS as Record<string, string>)[c] || c);
  /** Сервер отдаёт русскую подпись стиля; по beer_id находим бренд и берём перевод по семейству стиля. */
  styleOf(p: AiPick): string { const b = this.data.brand(p.beer_id); return b ? this.i18n.styleLabel(b) : p.style; }
  fmt(n: number): string { return Math.round(n).toLocaleString('ru-RU'); }
  routePath(route: string): string { return route.split('?')[0]; }
  routeQuery(route: string): Record<string, string> { return Object.fromEntries(new URLSearchParams(route.split('?')[1] || '')); }

  /** Шаги «думаю» идут по таймеру — реальный ответ приходит одним куском через 3–8 с. */
  private startSteps(): void { this.stopSteps(); this.timer = setInterval(() => this.stepIdx.update(i => Math.min(i + 1, STEPS.length - 1)), 1800); }
  private stopSteps(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
}

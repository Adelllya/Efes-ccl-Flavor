import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AiDrink, AiNote, AiPick, AiResponse, AiResult, AiService, AiVenue } from '../../core/ai.service';
import { SaasService } from '../../core/saas.service';
import { VenueService } from '../../core/venue.service';
import { IconComponent } from '../../ui/icon.component';
import { ScoreRingComponent } from '../../ui/score-ring.component';
import { SommelierChatComponent, drinkArt, evidenceOf } from '../../ui/sommelier-chat.component';
import { DrinkArtComponent, DrinkArtDrink } from '../../ui/drink-art.component';
import { FAT_LABELS, TASTE_LABELS, WEIGHT_LABELS } from '../../core/pairing.service';
import { I18nKey, I18nService } from '../../core/i18n.service';

type State = 'idle' | 'busy' | 'done' | 'error';
type Mode = 'dish' | 'drink';
const STEPS: Record<Mode, I18nKey[]> = {
  dish: ['scan.step.1', 'scan.step.2', 'scan.step.3', 'scan.step.4'],
  drink: ['scan.drink.step.1', 'scan.drink.step.2', 'scan.drink.step.3', 'scan.step.4'],
};
/** Оси блюда, которые показываем чипами (вес и жир уже есть в чипах мастера). */
const AXIS_CHIPS = ['salt', 'sweet', 'sour', 'umami', 'maillard', 'smoke', 'cream', 'fresh', 'pungent', 'fish_oil'];

/**
 * ИИ-сканер: «Блюдо» — фото блюда → распознавание → напитки движка v2 из карты (или всего каталога) → объяснение;
 * «Напиток» — фото этикетки / строки меню или название → профиль напитка (из каталога или честная оценка ИИ по этикетке:
 * что прочитано, а что предположено) → блюда к нему со ссылками на /pair/:dish. Язык ru/kk/en — через I18nService.
 */
@Component({
  selector: 'ft-scan',
  standalone: true,
  imports: [RouterLink, FormsModule, IconComponent, ScoreRingComponent, SommelierChatComponent, DrinkArtComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state() === 'idle' || state() === 'error') {
      <section class="hero">
        <div class="seg" role="radiogroup" [attr.aria-label]="t('scan.mode.aria')">
          <button type="button" role="radio" [attr.aria-checked]="kind() === 'dish'" [class.on]="kind() === 'dish'" (click)="setKind('dish')"><ft-icon name="dish" [size]="16" /> {{ t('scan.mode.dish') }}</button>
          <button type="button" role="radio" [attr.aria-checked]="kind() === 'drink'" [class.on]="kind() === 'drink'" (click)="setKind('drink')"><ft-icon name="glass" [size]="16" /> {{ t('scan.mode.drink') }}</button>
        </div>
        <div class="cam-ico"><ft-icon [name]="kind() === 'drink' ? 'glass' : 'camera'" [size]="30" /></div>
        <span class="eyebrow light">{{ t('common.ai') }}</span>
        @if (kind() === 'dish') {
          <h1>{{ t('scan.title.a') }} <span class="hl">{{ t('scan.title.hl') }}</span> {{ t('scan.title.b') }}</h1>
          <p class="lead">{{ venueCtx() ? t('scan.lead.venue', { venue: venueCtx()!.name || '' }) : t('scan.lead.all') }}</p>
        } @else {
          <h1>{{ t('scan.drink.title.a') }} <span class="hl">{{ t('scan.drink.title.hl') }}</span> {{ t('scan.drink.title.b') }}</h1>
          <p class="lead">{{ t('scan.drink.lead') }}</p>
        }
        <label class="btn btn-primary btn-lg btn-block cam"><input type="file" accept="image/*" capture="environment" hidden (change)="onFile($event)" /><ft-icon name="camera" [size]="20" /> {{ t('scan.camera') }}</label>
        <label class="btn btn-secondary btn-block"><input type="file" accept="image/*" hidden (change)="onFile($event)" /> {{ t('scan.gallery') }}</label>
        @if (kind() === 'drink') {
          <form class="fix mt12" (ngSubmit)="byName()">
            <input class="input" [ngModel]="drinkText()" (ngModelChange)="drinkText.set($event)" name="drinkText" [placeholder]="t('scan.drink.text')" autocomplete="off" />
            <button type="submit" class="btn btn-primary" [disabled]="!drinkText().trim()">{{ t('scan.drink.submit') }}</button>
          </form>
        }
        @if (state() === 'error') { <div class="soft warn mt12">{{ error() }}</div> }
        <p class="muted xs mt12 center">{{ kind() === 'drink' ? t('scan.drink.tips') : t('scan.tips') }}</p>
      </section>
      @if (kind() === 'dish') {
        <section class="section-sm">
          <div class="grid grid-3 how">
            <div class="card card-p"><b>{{ t('scan.how1.title') }}</b><p class="dim sm">{{ t('scan.how1.text') }}</p></div>
            <div class="card card-p"><b>{{ t('scan.how2.title') }}</b><p class="dim sm">{{ t('scan.how2.text') }}</p></div>
            <div class="card card-p"><b>{{ t('scan.how3.title') }}</b><p class="dim sm">{{ t('scan.how3.text') }}</p></div>
          </div>
        </section>
      }
    }

    @if (state() === 'busy') {
      <section class="card busy">
        @if (preview()) { <img [src]="preview()" alt="" class="prev" /> }
        <div class="card-p">
          <div class="steps">
            @for (s of steps(); track s; let i = $index) {
              <div class="step" [class.on]="i === stepIdx()" [class.done]="i < stepIdx()"><span class="dot">@if (i < stepIdx()) { <ft-icon name="check" [size]="12" /> }</span>{{ t(s) }}</div>
            }
          </div>
        </div>
      </section>
    }

    @if (state() === 'done' && result(); as r) {
      <section class="card res">
        @if (r.drink; as d) {
          <!-- ── напиток ── -->
          <div class="res-top">
            <div class="art"><ft-drink-art [drink]="art(d)" [size]="120" [glow]="true" [animate]="true" /></div>
            <div class="grow min0">
              <span class="eyebrow">{{ t('scan.drink.recognised') }}</span>
              <h1 class="dn">{{ d.name }}</h1>
              <div class="dim sm">{{ d.category_label }}@if (d.style) { · {{ d.style }} }@if (d.abv !== null) { · {{ d.abv }}% }@if (d.producer) { · {{ d.producer }} }</div>
              <span class="srcbadge mt8" [class.est]="d.estimated">{{ d.estimated ? t('scan.drink.estimated') : t('scan.drink.catalog') }}@if (d.vector_confidence !== null) { · {{ t('scan.drink.confidence', { n: pct(d.vector_confidence) }) }} }</span>
            </div>
          </div>
          @if (d.estimated) { <p class="soft note mt12">{{ t('scan.drink.estimatedNote') }}</p> }
          <div class="ra mt12">
            <div class="card-p box"><b class="sm">{{ t('scan.drink.read') }}</b>
              @if (d.what_was_read.length) { <ul>@for (x of d.what_was_read; track x) { <li>{{ x }}</li> }</ul> } @else { <p class="dim xs">{{ t('scan.drink.readNone') }}</p> }
            </div>
            <div class="card-p box"><b class="sm">{{ t('scan.drink.assumed') }}</b><ul>@for (x of d.what_was_assumed; track x) { <li>{{ x }}</li> }</ul></div>
          </div>
          <div class="say"><span class="av"><ft-icon name="sparkles" [size]="16" /></span><p>{{ r.reply }}</p></div>
          @if (r.pair; as pr) {
            <h3 class="sub">{{ t('scan.drink.pair') }}</h3>
            <a class="dish pair" [routerLink]="routePath(pr.route)" [queryParams]="routeQuery(pr.route)">
              <span class="emo">{{ pr.emoji }}</span><span class="grow min0"><b>{{ pr.name }}</b><span class="pw">{{ pr.why }}</span><span class="pm">{{ pr.band_label }} · {{ pr.match_label }}</span></span>
              <ft-score [score]="pr.score" [size]="48" [stroke]="4" />
            </a>
          }
          @if (r.dishes.length) {
            <h3 class="sub">{{ t('scan.drink.dishes') }}</h3>
            <div class="picks">
              @for (x of r.dishes; track x.dish_id; let i = $index) {
                <a class="dish" [class.top]="i === 0" [routerLink]="routePath(x.route)" [queryParams]="routeQuery(x.route)">
                  <span class="emo">{{ x.emoji }}</span>
                  <span class="grow min0"><b>{{ i18n.dishNameById(x.dish_id, x.name) }}</b>@if (x.classic) { <em class="classic">{{ t('v2.card.classic') }}</em> }
                    <span class="pw">{{ x.why }}</span>
                    <span class="pm">{{ x.match_label }}@for (e of ev(x.reasons); track e) { <abbr class="ev" [title]="t(evKey(e))">{{ e }}</abbr> }</span></span>
                  <ft-score [score]="x.score" [size]="48" [stroke]="4" />
                </a>
              }
            </div>
          }
          @if (d.id) { <a class="btn btn-secondary btn-block mt12" [routerLink]="['/drinks', d.id]">{{ t('v2.card.drink') }} <ft-icon name="arrow-right" [size]="16" /></a> }
        } @else {
          <!-- ── блюдо ── -->
          <div class="res-top">
            @if (preview()) { <img [src]="preview()" alt="" class="thumb" /> }
            <div class="grow min0">
              <span class="eyebrow">{{ r.dish ? t('scan.recognised') : t('scan.clarify') }}</span>
              <h1 class="dn">{{ r.dish ? r.dish.emoji + ' ' + i18n.dishNameById(r.dish.slug, r.dish.name) : t('scan.hmm') }}</h1>
              @if (r.dish; as dish) {
                <div class="conf"><i [style.width.%]="dish.confidence * 100"></i></div>
                <div class="chips mt8">
                  <span class="chip chip-sm">{{ taste(dish.spec.taste) }}</span><span class="chip chip-sm">{{ weight(dish.spec.weight) }}</span><span class="chip chip-sm">{{ t('common.fat', { level: fat(dish.spec.fat) }) }}</span>
                  @for (a of axes(dish.vector); track a) { <span class="chip chip-sm">{{ t(axisKey(a)) }}</span> }
                  @if ((dish.spec.heat || 0) >= .4) { <span class="chip chip-sm hot">🌶 {{ Math.round((dish.spec.heat || 0) * 100) }}%</span> }
                </div>
              }
            </div>
          </div>
          <div class="say"><span class="av"><ft-icon name="sparkles" [size]="16" /></span><p>{{ r.reply }}</p></div>

          @if (r.picks.length) {
            <div class="picks">
              @for (p of r.picks; track p.drink_id; let i = $index) {
                <div class="pick" [class.top]="i === 0">
                  <ft-score [score]="p.score" [size]="56" [stroke]="5" />
                  <a class="grow min0" [routerLink]="['/drinks', p.drink_id]">
                    <div class="pn">{{ p.name }} @if (i === 0) { <em>{{ t('common.best') }}</em> } @if (p.classic) { <em class="somm">{{ t('v2.card.classic') }}</em> }</div>
                    <div class="pw">{{ p.why }}</div>
                    <div class="pm"><b>{{ p.category_label || p.category }}</b> · {{ p.match_label }}@if (p.style) { · {{ p.style }} } · {{ p.abv }}%
                      @for (e of ev(p.reasons); track e) { <abbr class="ev" [title]="t(evKey(e))" [attr.aria-label]="t('scan.evidence.aria')">{{ e }}</abbr> }</div>
                  </a>
                  <div class="buy">
                    @if (p.price) { <div class="pp">{{ fmt(p.price) }} {{ venueCtx()?.currency || '₸' }}</div> }
                    @if (venueCtx()) { <button type="button" class="btn btn-primary btn-sm" (click)="order(r, p)" [disabled]="ordered().has(p.drink_id)">{{ ordered().has(p.drink_id) ? '✓ ' + t('common.ordered') : t('common.order') }}</button> }
                  </div>
                </div>
              }
              @if (r.best_partner; as bp) {
                <a class="partner" [routerLink]="['/drinks', bp.drink_id]">
                  <span class="pt">{{ t('v2.pair.partner.title') }}</span>
                  <span><b>{{ bp.name }}</b> · {{ bp.category_label }} · {{ bp.score }}</span>
                  <span class="pw">{{ bp.why }}</span>
                  <span class="dim xs">{{ t('v2.pair.partner.note') }}</span>
                </a>
              }
            </div>
            @if (r.route) { <a class="btn btn-secondary btn-block mt12" [routerLink]="routePath(r.route)" [queryParams]="routeQuery(r.route)">{{ t('scan.full') }} <ft-icon name="arrow-right" [size]="16" /></a> }
          }
        }

        @if (r.questions.length) {
          <p class="dim xs mt12">{{ t('scan.drink.questions') }}</p>
          <div class="chips">@for (q of r.questions; track q) { <button type="button" class="chip" (click)="note.set(q)">{{ q }}</button> }</div>
        }
        <form class="fix mt12" (ngSubmit)="refine()">
          <input class="input" [ngModel]="note()" (ngModelChange)="note.set($event)" name="note" [placeholder]="kind() === 'drink' ? t('scan.drink.refine') : t('scan.refine.placeholder')" />
          <button type="submit" class="btn btn-ghost btn-icon" [disabled]="!note().trim()" [attr.aria-label]="t('scan.refine.aria')"><ft-icon name="refresh" /></button>
        </form>
        <div class="flex g8 mt12">
          <label class="btn btn-primary grow center"><input type="file" accept="image/*" capture="environment" hidden (change)="onFile($event)" />{{ kind() === 'drink' ? t('scan.drink.another') : t('scan.another') }}</label>
          <button type="button" class="btn btn-ghost" (click)="reset()">{{ t('scan.reset') }}</button>
        </div>
      </section>
    }
    <ft-sommelier [venue]="venueCtx()" [table]="tableNo()" />
  `,
  styles: [`
    .hero { text-align: center; padding: 22px 18px 18px; border-radius: var(--r-xl); background: linear-gradient(160deg, #120D09 0%, #2A1F0D 55%, #6A4A17 130%); color: #F7F1E5; border: 1px solid rgba(229, 184, 73, .22); box-shadow: var(--shadow-2); }
    .seg { display: inline-flex; gap: 4px; padding: 4px; border-radius: 14px; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14); margin-bottom: 16px; }
    .seg button { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 16px; border-radius: 10px; font-weight: 700; color: rgba(255,255,255,.72); }
    .seg button.on { background: var(--amber-300); color: #1A1209; }
    .cam-ico { width: 64px; height: 64px; border-radius: 20px; background: var(--grad-amber); display: grid; place-items: center; margin: 0 auto 12px; box-shadow: var(--shadow-amber); }
    .eyebrow.light { color: var(--amber-300); }
    .hero h1 { color: #fff; font-size: 1.9rem; line-height: 1.05; margin-top: 4px; } .hl { color: var(--amber-300); }
    .lead { color: rgba(255,255,255,.78); margin: 10px auto 18px; max-width: 420px; }
    .cam { margin-bottom: 10px; } .hero .btn-secondary { background: rgba(255,255,255,.1); color: #fff; border-color: rgba(255,255,255,.25); }
    .hero .fix .input { background: rgba(255,255,255,.95); }
    .section-sm { margin-top: 16px; } .how b { display: block; margin-bottom: 6px; }
    .busy { overflow: hidden; } .prev { width: 100%; max-height: 300px; object-fit: cover; display: block; }
    .steps { display: grid; gap: 10px; } .step { display: flex; align-items: center; gap: 10px; color: var(--ink-3); font-weight: 600; transition: color var(--t-med); }
    .step.on { color: var(--ink); } .step.done { color: var(--ok); }
    .dot { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--line); display: grid; place-items: center; flex-shrink: 0; }
    .step.on .dot { border-color: var(--amber-500); animation: pulse 1s infinite; } .step.done .dot { background: var(--ok); border-color: var(--ok); color: #fff; }
    @keyframes pulse { 50% { box-shadow: 0 0 0 6px rgba(224,138,40,.18); } }
    .res { padding: 16px; } .res-top { display: flex; gap: 14px; align-items: center; }
    .thumb { width: 84px; height: 84px; border-radius: 18px; object-fit: cover; flex-shrink: 0; }
    .art { flex-shrink: 0; width: 96px; display: grid; place-items: center; }
    .dn { font-size: 1.5rem; line-height: 1.1; } .min0 { min-width: 0; }
    .conf { height: 4px; border-radius: 4px; background: var(--line-2); margin-top: 8px; max-width: 160px; } .conf i { display: block; height: 100%; border-radius: 4px; background: var(--grad-amber); }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; } .chip.hot { background: var(--warn-bg); color: var(--warn); }
    .srcbadge { display: inline-block; max-width: 100%; white-space: normal; text-transform: none; letter-spacing: 0; font-size: .7rem; font-weight: 800; padding: 2px 10px; border-radius: 999px; background: var(--surface-2); color: var(--ink-2); border: 1px solid var(--line); }
    .srcbadge.est { background: var(--warn-bg); color: var(--warn); border-color: transparent; }
    .soft.note { background: var(--surface-2); padding: 10px 14px; border-radius: var(--r-md); font-size: .84rem; color: var(--ink-2); }
    .ra { display: grid; gap: 8px; grid-template-columns: 1fr; } @media (min-width: 560px) { .ra { grid-template-columns: 1fr 1fr; } }
    .box { border: 1px solid var(--line-2); border-radius: 14px; } .box ul { margin: 6px 0 0; padding-left: 18px; font-size: .84rem; color: var(--ink-2); display: grid; gap: 2px; }
    .say { display: flex; gap: 10px; align-items: flex-start; margin-top: 14px; padding: 12px; border-radius: 16px; background: var(--surface-2); border: 1px solid var(--line-2); }
    .say p { font-size: .95rem; line-height: 1.5; } .av { width: 30px; height: 30px; border-radius: 10px; background: var(--grad-amber); color: #fff; display: grid; place-items: center; flex-shrink: 0; }
    .sub { font-size: 1rem; margin-top: 16px; }
    .picks { display: grid; gap: 8px; margin-top: 14px; }
    .pick { display: flex; gap: 12px; align-items: center; padding: 12px; border-radius: 18px; border: 1.5px solid var(--line); background: var(--surface); }
    .pick.top, .dish.top { border-color: var(--amber-500); background: var(--amber-100); }
    .pn { font-family: var(--font-display); font-weight: 800; color: var(--ink); } .dish b { color: var(--ink); } .pn em, em.classic { font-style: normal; font-size: .6rem; text-transform: uppercase; letter-spacing: .08em; background: var(--amber-500); color: #fff; padding: 2px 7px; border-radius: 999px; margin-left: 4px; vertical-align: middle; } .pn em.somm, em.classic { background: var(--violet); }
    .pw { display: block; font-size: .82rem; color: var(--ink-2); margin-top: 2px; } .pm { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; font-size: .7rem; color: var(--ink-3); margin-top: 2px; }
    .ev { text-decoration: none; font-size: .62rem; font-weight: 800; border: 1px solid var(--line); border-radius: 5px; padding: 0 4px; line-height: 1.4; color: var(--ink-2); cursor: help; }
    .buy { display: grid; gap: 6px; justify-items: end; flex-shrink: 0; } .pp { font-family: var(--font-display); font-weight: 800; }
    .partner { display: grid; gap: 2px; padding: 10px 12px; border-radius: 16px; border: 1px dashed var(--amber-500); font-size: .84rem; }
    .partner .pt { font-size: .64rem; text-transform: uppercase; letter-spacing: .08em; font-weight: 800; color: var(--amber-800); }
    .dish { display: flex; gap: 12px; align-items: center; padding: 10px 12px; border-radius: 16px; border: 1.5px solid var(--line); background: var(--surface); }
    .dish.pair { margin-top: 8px; border-color: var(--ink-3); }
    .dish .emo { font-size: 1.6rem; width: 34px; text-align: center; flex-shrink: 0; }
    .fix { display: flex; gap: 8px; } .fix .input { flex: 1; min-width: 0; }
    .soft.warn { background: var(--warn-bg); color: var(--warn); padding: 10px 14px; border-radius: var(--r-md); text-align: left; }
  `],
})
export class ScanPage {
  ai = inject(AiService);
  i18n = inject(I18nService);
  private saas = inject(SaasService);
  private venueSvc = inject(VenueService);
  readonly Math = Math;
  /** t() читает сигнал языка — шаблон перерисуется при его смене. */
  readonly t = this.i18n.t;

  venue = input<string | undefined>();     // ?venue=slug (гостевое меню)
  table = input<string | undefined>();
  mode = input<string | undefined>();      // ?mode=drink — сразу режим «Напиток»

  readonly kind = signal<Mode>('dish');
  readonly state = signal<State>('idle');
  readonly error = signal('');
  readonly preview = signal<string | null>(null);
  readonly result = signal<AiResult | null>(null);
  readonly stepIdx = signal(0);
  readonly note = signal('');
  readonly drinkText = signal('');
  readonly ordered = signal(new Set<string>());
  readonly venueCtx = signal<AiVenue | null>(null);
  readonly tableNo = computed(() => { const t = parseInt(this.table() || '', 10); return Number.isFinite(t) ? t : null; });
  readonly steps = computed(() => STEPS[this.kind()]);
  private file: Blob | null = null;
  private lastText = '';
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => { const m = this.mode(); if (m === 'drink' || m === 'dish') untracked(() => this.kind.set(m)); }, { allowSignalWrites: true });
    effect(async () => {
      const slug = this.venue() || this.venueSvc.venue()?.id;
      if (!slug) { this.venueCtx.set(null); return; }
      const m = await this.saas.loadMenu(slug, this.tableNo());
      this.venueCtx.set(m ? { slug, name: m.venue.name, beers: m.beers.map(b => b.ref_slug), currency: m.venue.currency,
        prices: Object.fromEntries(m.beers.map(b => [b.ref_slug, b.price])), volumes: Object.fromEntries(m.beers.map(b => [b.ref_slug, b.volume])) } : null);
    }, { allowSignalWrites: true });
  }

  setKind(k: Mode): void { if (this.state() !== 'busy') { this.kind.set(k); this.state.set('idle'); this.error.set(''); } }

  async onFile(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0]; input.value = '';
    if (!f) return;
    this.file = f; this.lastText = ''; this.note.set('');
    try { this.preview.set(URL.createObjectURL(f)); } catch { this.preview.set(null); }
    await this.run('');
  }
  /** Режим «Напиток» без фото: название или строка меню. */
  async byName(): Promise<void> {
    const q = this.drinkText().trim(); if (!q) return;
    this.file = null; this.preview.set(null); this.lastText = q; this.note.set('');
    await this.run('');
  }
  async refine(): Promise<void> { if ((this.file || this.lastText) && this.note().trim()) await this.run(this.note().trim()); }

  private async run(note: string): Promise<void> {
    if (!this.file && !this.lastText) return;
    this.state.set('busy'); this.stepIdx.set(0); this.startSteps();
    const opts = { venue: this.venueCtx() };
    let r: AiResponse;
    if (this.kind() === 'drink') {
      const turns = [this.lastText, note].filter(Boolean).map(content => ({ role: 'user' as const, content }));
      r = await this.ai.drink({ file: this.file, messages: this.file ? (note ? [{ role: 'user', content: note }] : []) : turns }, opts);
    } else {
      r = await this.ai.vision(this.file!, opts, note);
    }
    this.stopSteps();
    if (!r.ok) { this.error.set(r.error); this.state.set('error'); return; }
    this.result.set(r); this.state.set('done'); this.ordered.set(new Set());
    const v = this.venueCtx();
    if (v && r.picks[0]) this.saas.track({ venue: v.slug, kind: 'PAIR_VIEW', dish: r.dish?.slug || r.dish?.name, beer: r.picks[0].drink_id, score: r.picks[0].score, table: this.tableNo() });
  }
  order(r: AiResult, p: AiPick): void {
    const v = this.venueCtx(); if (!v) return;
    this.saas.track({ venue: v.slug, kind: 'ORDER_INTENT', dish: r.dish?.slug || r.dish?.name, beer: p.drink_id, score: p.score, price: p.price ?? undefined, table: this.tableNo() });
    this.ordered.update(s => new Set(s).add(p.drink_id));
  }
  reset(): void { this.state.set('idle'); this.result.set(null); this.preview.set(null); this.file = null; this.lastText = ''; this.drinkText.set(''); }

  taste = (t: string) => this.i18n.tasteLabel(t, (TASTE_LABELS as Record<string, string>)[t] || t);
  weight = (w: string) => this.i18n.weightLabel(w, (WEIGHT_LABELS as Record<string, string>)[w] || w);
  fat = (f: string) => this.i18n.fatLabel(f, (FAT_LABELS as Record<string, string>)[f] || f);
  /** До трёх самых выраженных осей блюда (≥ 0.5) — чипами «Корочка», «Дым»… */
  axes(v: Record<string, number>): string[] {
    return AXIS_CHIPS.filter(a => (v[a] ?? 0) >= 0.5).sort((a, b) => (v[b] ?? 0) - (v[a] ?? 0)).slice(0, 3);
  }
  axisKey(a: string): I18nKey { return `v2.dax.${a}` as I18nKey; }
  ev(notes: readonly AiNote[]): string[] { return evidenceOf(notes); }
  evKey(e: string): I18nKey { return `v2.ev.${e}` as I18nKey; }
  art(d: AiDrink): DrinkArtDrink { return drinkArt(d); }
  pct(x: number): number { return Math.round(x * 100); }
  fmt(n: number): string { return Math.round(n).toLocaleString('ru-RU'); }
  routePath(route: string): string { return route.split('?')[0]; }
  routeQuery(route: string): Record<string, string> { return Object.fromEntries(new URLSearchParams(route.split('?')[1] || '')); }

  /** Шаги «думаю» идут по таймеру — реальный ответ приходит одним куском через 3–10 с. */
  private startSteps(): void { this.stopSteps(); this.timer = setInterval(() => this.stepIdx.update(i => Math.min(i + 1, STEPS[this.kind()].length - 1)), 1800); }
  private stopSteps(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
}

import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AiDrink, AiNote, AiOccasion, AiPick, AiResult, AiService, AiTurn, AiVenue, normalize } from '../core/ai.service';
import { SaasService } from '../core/saas.service';
import { DataService } from '../core/data.service';
import { IconComponent } from './icon.component';
import { ScoreRingComponent } from './score-ring.component';
import { DrinkArtComponent, DrinkArtDrink } from './drink-art.component';
import { I18nKey, I18nService } from '../core/i18n.service';

type Mode = 'dish' | 'drink';
interface Msg { role: 'user' | 'assistant'; text: string; result?: AiResult; error?: boolean; }

/** Уровни доказательности причин пары — буквы A–D (подсказка — v2.ev.*). */
export function evidenceOf(notes: readonly AiNote[]): string[] {
  return [...new Set(notes.map(n => n.evidence).filter(e => /^[ABCD]$/.test(e)))].sort();
}
/** Разобранный напиток → вход иллюстрации бокала (ui/drink-art). */
export function drinkArt(d: AiDrink): DrinkArtDrink {
  return { id: d.id ?? 'ai-estimate', name: d.name, category: d.category, archetype: d.archetype, family: d.family, sensory: d.sensory,
           aroma_tags: d.aroma_tags, serving: d.serving ? { glass: d.serving.glass } : null, image: d.image };
}

/**
 * Плавающая кнопка «Сомелье» + шторка-чат. Гость спрашивает словами — получает напитки движка v2 и объяснение;
 * «Разобрать напиток» — название или строка меню → профиль напитка (из каталога или оценка ИИ) и блюда к нему.
 * В заведении — только напитки из его карты, с ценами и кнопкой «Заказать».
 * Язык ru/kk/en — через I18nService; подсказки-чипы уходят серверу на языке гостя, locale добавляет AiService.
 */
@Component({
  selector: 'ft-sommelier',
  standalone: true,
  imports: [RouterLink, NgTemplateOutlet, FormsModule, IconComponent, ScoreRingComponent, DrinkArtComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="fab" (click)="open.set(true)" [attr.aria-label]="t('chat.fab.aria')" [class.hidden]="open()">
      <ft-icon name="sparkles" [size]="22" /><span>{{ t('chat.fab') }}</span>
    </button>

    @if (open()) {
      <div class="bg" (click)="open.set(false)"></div>
      <section class="sheet" role="dialog" [attr.aria-label]="t('common.ai')">
        <div class="grab"></div>
        <header class="hd">
          <span class="av"><ft-icon name="sparkles" [size]="18" /></span>
          <div class="grow"><b>{{ t('common.ai') }}</b><div class="muted xs">{{ venue()?.name ? t('chat.sub.venue', { venue: venue()!.name || '' }) : t('chat.sub.all') }}</div></div>
          <button type="button" class="btn btn-icon btn-ghost" (click)="open.set(false)" [attr.aria-label]="t('common.close')"><ft-icon name="x" /></button>
        </header>

        <div class="log" #log>
          @if (!msgs().length) {
            <div class="hello">
              <p>{{ mode() === 'drink' ? t('chat.drink.hello') : t('chat.hello') }}</p>
              @if (mode() === 'dish') {
                <div class="chips">@for (c of chips(); track c) { <button type="button" class="chip" (click)="send(c)">{{ c }}</button> }</div>
                <button type="button" class="chip drink" (click)="setMode('drink')">{{ t('chat.drink') }}</button>
              }
              <a routerLink="/scan" [queryParams]="scanParams()" class="chip cam" (click)="open.set(false)">{{ mode() === 'drink' ? t('chat.drink.scan') : t('chat.scan') }}</a>
            </div>
          }
          @for (m of msgs(); track $index) {
            <div class="msg" [class.me]="m.role === 'user'" [class.err]="m.error">
              <div class="bubble">{{ m.text }}</div>
              @if (m.result; as r) {
                @if (r.picks.length) {
                  <div class="picks">
                    @for (p of r.picks; track p.drink_id; let i = $index) {
                      <div class="pick" [class.top]="i === 0">
                        <ft-score [score]="p.score" [size]="44" [stroke]="4" />
                        <a class="grow min0" [routerLink]="['/drinks', p.drink_id]" (click)="open.set(false)">
                          <div class="pn ellipsis">{{ p.name }} @if (i === 0) { <em>{{ t('chat.best') }}</em> }</div>
                          <div class="meta"><span class="cat">{{ p.category_label || p.category }}</span>@if (p.match_label) { <span>· {{ p.match_label }}</span> }
                            @for (e of ev(p.reasons); track e) { <abbr class="ev" [title]="t(evKey(e))">{{ e }}</abbr> }</div>
                          <div class="pw">{{ p.why }}</div>
                          @if (p.price) { <div class="pp">{{ fmt(p.price) }} {{ venue()?.currency || '₸' }}@if (p.volume) { · {{ i18n.volume(p.volume) }} }</div> }
                        </a>
                        @if (venue()) { <button type="button" class="btn btn-primary btn-sm" (click)="order(r, p)" [disabled]="ordered().has(p.drink_id)">{{ ordered().has(p.drink_id) ? '✓' : t('common.order') }}</button> }
                      </div>
                    }
                    @if (r.best_partner; as bp) {
                      <a class="partner" [routerLink]="['/drinks', bp.drink_id]" (click)="open.set(false)" [title]="t('v2.pair.partner.note')">
                        <span class="pt">{{ t('v2.pair.partner.title') }}</span>
                        <span class="pb"><b>{{ bp.name }}</b> · {{ bp.score }} · {{ bp.why }}</span>
                      </a>
                    }
                    @if (r.route) { <a class="more" [routerLink]="routePath(r.route)" [queryParams]="routeQuery(r.route)" (click)="open.set(false)">{{ t('chat.full') }} <ft-icon name="arrow-right" [size]="14" /></a> }
                  </div>
                }
                @if (r.drink; as d) {
                  <div class="drinkres">
                    <div class="dhead">
                      <ft-drink-art [drink]="art(d)" [size]="64" />
                      <div class="grow min0">
                        <div class="pn">{{ d.name }}</div>
                        <div class="meta"><span class="cat">{{ d.category_label }}</span>@if (d.style) { <span>· {{ d.style }}</span> }@if (d.abv !== null) { <span>· {{ d.abv }}%</span> }</div>
                        <span class="srcbadge" [class.est]="d.estimated">{{ d.estimated ? t('scan.drink.estimated') : t('scan.drink.catalog') }}@if (d.vector_confidence !== null) { · {{ t('scan.drink.confidence', { n: pct(d.vector_confidence) }) }} }</span>
                      </div>
                    </div>
                    @if (r.pair; as pr) { <ng-container *ngTemplateOutlet="dishRow; context: { $implicit: pr, pair: true }" /> }
                    @for (x of r.dishes; track x.dish_id) { <ng-container *ngTemplateOutlet="dishRow; context: { $implicit: x, pair: false }" /> }
                    @if (d.id) { <a class="more" [routerLink]="['/drinks', d.id]" (click)="open.set(false)">{{ t('v2.card.drink') }} <ft-icon name="arrow-right" [size]="14" /></a> }
                  </div>
                }
                @if (r.questions.length) {
                  <div class="chips">@for (q of r.questions; track q) { <button type="button" class="chip" (click)="draft.set(q)">{{ q }}</button> }</div>
                }
              }
            </div>
          }
          @if (ai.busy()) { <div class="msg"><div class="bubble typing"><i></i><i></i><i></i></div></div> }
        </div>

        <ng-template #dishRow let-x let-pair="pair">
          <a class="dish" [class.pair]="pair" [routerLink]="routePath(x.route)" [queryParams]="routeQuery(x.route)" (click)="open.set(false)">
            <span class="emo">{{ x.emoji }}</span>
            <span class="grow min0"><span class="pn ellipsis">@if (pair) { <em class="yours">{{ t('scan.drink.pair') }}</em> }{{ i18n.dishNameById(x.dish_id === 'custom' ? null : x.dish_id, x.name) }}</span><span class="pw">{{ x.why }}</span></span>
            <ft-score [score]="x.score" [size]="36" [stroke]="3" />
          </a>
        </ng-template>

        @if (mode() === 'drink') {
          <div class="modebar"><ft-icon name="glass" [size]="14" /> {{ t('chat.drink.mode') }}<button type="button" class="linkbtn" (click)="setMode('dish')">{{ t('chat.drink.back') }}</button></div>
        }
        <form class="inp" (ngSubmit)="send(draft())">
          <input class="input" [ngModel]="draft()" (ngModelChange)="draft.set($event)" name="q" [placeholder]="mode() === 'drink' ? t('chat.drink.placeholder') : t('chat.placeholder')" autocomplete="off" [disabled]="ai.busy()" />
          <button type="submit" class="btn btn-primary btn-icon" [disabled]="ai.busy() || !draft().trim()" [attr.aria-label]="t('chat.send')"><ft-icon name="arrow-right" /></button>
        </form>
      </section>
    }
  `,
  styles: [`
    :host { display: contents; }
    .fab { position: fixed; right: 16px; bottom: calc(var(--tabbar-h) + 14px + var(--safe-b)); z-index: 90; display: inline-flex; align-items: center; gap: 8px; padding: 12px 16px; border-radius: var(--r-full); background: var(--ink); color: var(--bg); font-weight: 800; box-shadow: var(--shadow-3); transition: transform var(--t-fast), opacity var(--t-fast); }
    .fab:hover { transform: translateY(-2px); } .fab.hidden { opacity: 0; pointer-events: none; }
    @media (min-width: 720px) { .fab { bottom: 24px; right: 24px; } }
    .bg { position: fixed; inset: 0; background: rgba(30,22,17,.45); z-index: 200; animation: fade var(--t-med) both; }
    /* шторка живёт внутри <main> (z-index 1 в оболочке) и не может встать выше нижней панели вкладок — стоит над ней */
    .sheet { position: fixed; left: 0; right: 0; bottom: calc(var(--tabbar-h) + var(--safe-b)); z-index: 201; height: calc(86vh - var(--tabbar-h)); background: var(--surface); border-radius: var(--r-xl) var(--r-xl) 0 0; display: flex; flex-direction: column; box-shadow: var(--shadow-3); animation: up var(--t-slow) var(--ease) both; }
    @media (min-width: 720px) { .sheet { left: auto; right: 24px; bottom: 24px; width: 440px; height: min(680px, 84vh); border-radius: var(--r-xl); } }
    @keyframes up { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    .grab { width: 40px; height: 4px; border-radius: 4px; background: var(--line); margin: 8px auto 4px; flex-shrink: 0; }
    .hd { display: flex; align-items: center; gap: 10px; padding: 6px 12px 10px 16px; border-bottom: 1px solid var(--line-2); flex-shrink: 0; }
    .av { width: 36px; height: 36px; border-radius: 12px; background: var(--grad-amber); color: #fff; display: grid; place-items: center; flex-shrink: 0; }
    .log { flex: 1; overflow: auto; padding: 14px 16px; display: grid; gap: 10px; align-content: start; }
    .hello p { color: var(--ink-2); font-size: .92rem; }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
    .chip { white-space: normal; text-align: left; line-height: 1.25; padding-block: 6px; max-width: 100%; }
    .chip.cam, .chip.drink { margin-top: 8px; background: var(--amber-100); color: var(--amber-800); font-weight: 700; display: inline-flex; }
    .chip.drink { margin-right: 6px; }
    .msg { display: grid; gap: 8px; justify-items: start; max-width: 100%; }
    .msg.me { justify-items: end; }
    .bubble { padding: 10px 14px; border-radius: 18px 18px 18px 6px; background: var(--surface-2); border: 1px solid var(--line-2); font-size: .92rem; line-height: 1.45; max-width: 92%; white-space: pre-wrap; }
    .me .bubble { background: var(--ink); color: var(--bg); border-radius: 18px 18px 6px 18px; }
    .err .bubble { background: var(--warn-bg); color: var(--warn); }
    .typing { display: flex; gap: 4px; padding: 12px 14px; } .typing i { width: 6px; height: 6px; border-radius: 50%; background: var(--ink-4); animation: blink 1.2s infinite; } .typing i:nth-child(2) { animation-delay: .2s; } .typing i:nth-child(3) { animation-delay: .4s; }
    @keyframes blink { 0%, 80%, 100% { opacity: .3; } 40% { opacity: 1; } }
    .picks, .drinkres { display: grid; gap: 6px; width: 100%; }
    .pick { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 14px; border: 1.5px solid var(--line); background: var(--surface); }
    .pick.top { border-color: var(--amber-500); background: var(--amber-100); }
    .min0 { min-width: 0; }
    .pn { font-family: var(--font-display); font-weight: 800; font-size: .92rem; display: block; color: var(--ink); } .pn em { font-style: normal; font-size: .6rem; text-transform: uppercase; letter-spacing: .08em; background: var(--amber-500); color: #fff; padding: 1px 6px; border-radius: 999px; margin-left: 4px; vertical-align: middle; }
    .pn em.yours { margin: 0 6px 0 0; background: var(--ink); }
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; font-size: .7rem; color: var(--ink-3); margin-top: 1px; }
    .meta .cat { font-weight: 700; color: var(--ink-2); }
    .ev { text-decoration: none; font-size: .6rem; font-weight: 800; border: 1px solid var(--line); border-radius: 5px; padding: 0 4px; line-height: 1.4; color: var(--ink-2); cursor: help; }
    .pw { font-size: .76rem; color: var(--ink-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .pp { font-size: .78rem; font-weight: 800; color: var(--amber-800); margin-top: 2px; }
    .partner { display: grid; gap: 2px; padding: 8px 10px; border-radius: 12px; border: 1px dashed var(--amber-500); font-size: .76rem; }
    .partner .pt { font-size: .62rem; text-transform: uppercase; letter-spacing: .08em; font-weight: 800; color: var(--amber-800); }
    .partner .pb { color: var(--ink-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .dhead { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 14px; border: 1.5px solid var(--line); background: var(--surface); }
    .srcbadge { display: inline-block; max-width: 100%; white-space: normal; text-transform: none; letter-spacing: 0; margin-top: 4px; font-size: .64rem; font-weight: 800; padding: 1px 8px; border-radius: 999px; background: var(--surface-2); color: var(--ink-2); border: 1px solid var(--line); }
    .srcbadge.est { background: var(--warn-bg); color: var(--warn); border-color: transparent; }
    .dish { display: flex; gap: 10px; align-items: center; padding: 6px 10px; border-radius: 12px; border: 1px solid var(--line-2); background: var(--surface); }
    .dish.pair { border-color: var(--ink-3); }
    .dish .emo { font-size: 1.3rem; width: 28px; text-align: center; flex-shrink: 0; }
    .more { display: inline-flex; align-items: center; gap: 4px; font-size: .8rem; font-weight: 700; color: var(--amber-700); margin-top: 2px; }
    .modebar { display: flex; align-items: center; gap: 6px; padding: 6px 16px 0; font-size: .74rem; font-weight: 700; color: var(--amber-800); }
    .linkbtn { margin-left: auto; font-size: .74rem; font-weight: 700; color: var(--ink-3); text-decoration: underline; text-underline-offset: 3px; }
    .inp { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--line-2); flex-shrink: 0; }
    .inp .input { flex: 1; }
  `],
})
export class SommelierChatComponent {
  ai = inject(AiService);
  data = inject(DataService);
  i18n = inject(I18nService);
  private saas = inject(SaasService);
  /** t() читает сигнал языка — шаблон и chips() пересчитываются при его смене. */
  readonly t = this.i18n.t;

  venue = input<AiVenue | null>(null);
  occasion = input<AiOccasion | null>(null);
  table = input<number | null>(null);

  readonly open = signal(false);
  readonly mode = signal<Mode>('dish');
  readonly draft = signal('');
  readonly msgs = signal<Msg[]>([]);
  readonly ordered = signal(new Set<string>());
  private log = viewChild<ElementRef<HTMLDivElement>>('log');

  readonly chips = computed(() => {
    const v = this.venue();
    const dish = v ? null : this.data.dishes()[Math.floor(Math.random() * 8)];
    // на русском название блюда идёт со строчной («к бешбармаку»), на kk/en — как в словаре
    const name = dish ? (this.i18n.locale() === 'ru' ? dish.display_name.toLowerCase() : this.i18n.dishName(dish)) : this.t('chat.chip.dishFallback');
    return [
      v ? this.t('chat.chip.venue') : this.t('chat.chip.dish', { dish: name }),
      this.t('chat.chip.hot'),
      this.t('chat.chip.bitter'),
      this.t('chat.chip.lager'),
    ];
  });
  readonly scanParams = computed(() => {
    const v = this.venue();
    return { ...(v ? { venue: v.slug, ...(this.table() ? { table: this.table() } : {}) } : {}), ...(this.mode() === 'drink' ? { mode: 'drink' } : {}) };
  });

  constructor() {
    effect(() => { this.msgs(); this.ai.busy(); queueMicrotask(() => { const el = this.log()?.nativeElement; if (el) el.scrollTop = el.scrollHeight; }); });
    effect(() => {
      const key = this.storeKey();
      try {
        const raw = sessionStorage.getItem(key);
        if (raw) this.msgs.set((JSON.parse(raw) as Msg[]).map(m => (m.result ? { ...m, result: normalize(m.result) } : m)));
      } catch { /* ignore */ }
    }, { allowSignalWrites: true });
  }

  setMode(m: Mode): void { this.mode.set(m); this.draft.set(''); }

  async send(text: string): Promise<void> {
    const q = text.trim();
    if (!q || this.ai.busy()) return;
    this.draft.set('');
    this.msgs.update(list => [...list, { role: 'user', text: q }]);
    const history: AiTurn[] = this.msgs().filter(m => !m.error).map(m => ({ role: m.role, content: m.text }));
    const opts = { venue: this.venue(), occasion: this.occasion() };
    const r = this.mode() === 'drink' ? await this.ai.drink({ messages: history }, opts) : await this.ai.ask(history, opts);
    if (!r.ok) { this.msgs.update(list => [...list, { role: 'assistant', text: r.error, error: true }]); return; }
    this.msgs.update(list => [...list, { role: 'assistant', text: r.reply, result: r }]);
    const v = this.venue();
    if (v && r.picks[0]) this.saas.track({ venue: v.slug, kind: 'PAIR_VIEW', dish: r.dish?.slug || r.dish?.name, beer: r.picks[0].drink_id, score: r.picks[0].score, table: this.table() });
    try { sessionStorage.setItem(this.storeKey(), JSON.stringify(this.msgs().slice(-12))); } catch { /* ignore */ }
  }

  order(r: AiResult, p: AiPick): void {
    const v = this.venue(); if (!v) return;
    this.saas.track({ venue: v.slug, kind: 'ORDER_INTENT', dish: r.dish?.slug || r.dish?.name, beer: p.drink_id, score: p.score, price: p.price ?? undefined, table: this.table() });
    this.ordered.update(s => new Set(s).add(p.drink_id));
  }

  ev(notes: readonly AiNote[]): string[] { return evidenceOf(notes); }
  evKey(e: string): I18nKey { return `v2.ev.${e}` as I18nKey; }
  art(d: AiDrink): DrinkArtDrink { return drinkArt(d); }
  pct(x: number): number { return Math.round(x * 100); }
  fmt(n: number): string { return Math.round(n).toLocaleString('ru-RU'); }
  routePath(route: string): string { return route.split('?')[0]; }
  routeQuery(route: string): Record<string, string> { return Object.fromEntries(new URLSearchParams(route.split('?')[1] || '')); }
  private storeKey(): string { return `ft.ai.chat.v2.${this.venue()?.slug || 'global'}`; }
}

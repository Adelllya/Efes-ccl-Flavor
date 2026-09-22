import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AiPick, AiResult, AiService, AiTurn, AiVenue } from '../core/ai.service';
import { SaasService } from '../core/saas.service';
import { DataService } from '../core/data.service';
import type { Occasion } from '../engine/pairing-engine';
import { IconComponent } from './icon.component';
import { ScoreRingComponent } from './score-ring.component';
import { I18nService } from '../core/i18n.service';

interface Msg { role: 'user' | 'assistant'; text: string; result?: AiResult; error?: boolean; }

/**
 * Плавающая кнопка «Сомелье» + шторка-чат. Гость спрашивает словами — получает пары из движка
 * и объяснение. В заведении — только сорта из его карты, с ценами и кнопкой «Заказать».
 * Язык ru/kk/en — через I18nService; подсказки-чипы уходят серверу на языке гостя, locale добавляет AiService.
 */
@Component({
  selector: 'ft-sommelier',
  standalone: true,
  imports: [RouterLink, FormsModule, IconComponent, ScoreRingComponent],
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
          <div class="grow"><b>{{ t('common.ai') }}</b><div class="muted xs">{{ venue()?.name ? t('chat.sub.venue', { venue: venue()!.name || '' }) : t('chat.sub.all', { n: data.stats().brands }) }}</div></div>
          <button type="button" class="btn btn-icon btn-ghost" (click)="open.set(false)" [attr.aria-label]="t('common.close')"><ft-icon name="x" /></button>
        </header>

        <div class="log" #log>
          @if (!msgs().length) {
            <div class="hello">
              <p>{{ t('chat.hello') }}</p>
              <div class="chips">@for (c of chips(); track c) { <button type="button" class="chip" (click)="send(c)">{{ c }}</button> }</div>
              <a routerLink="/scan" [queryParams]="scanParams()" class="chip cam" (click)="open.set(false)">{{ t('chat.scan') }}</a>
            </div>
          }
          @for (m of msgs(); track $index) {
            <div class="msg" [class.me]="m.role === 'user'" [class.err]="m.error">
              <div class="bubble">{{ m.text }}</div>
              @if (m.result?.picks?.length) {
                <div class="picks">
                  @for (p of m.result!.picks; track p.beer_id; let i = $index) {
                    <div class="pick" [class.top]="i === 0">
                      <ft-score [score]="p.score" [size]="44" [stroke]="4" />
                      <a class="grow min0" [routerLink]="['/beers', p.beer_id]" (click)="open.set(false)">
                        <div class="pn ellipsis">{{ p.name }} @if (i === 0) { <em>{{ t('chat.best') }}</em> }</div>
                        <div class="pw">{{ i18n.reasonText(p.why) }}</div>
                        @if (p.price) { <div class="pp">{{ fmt(p.price) }} {{ venue()?.currency || '₸' }}@if (p.volume) { · {{ p.volume }} }</div> }
                      </a>
                      @if (venue()) { <button type="button" class="btn btn-primary btn-sm" (click)="order(m.result!, p)" [disabled]="ordered().has(p.beer_id)">{{ ordered().has(p.beer_id) ? '✓' : t('common.order') }}</button> }
                    </div>
                  }
                  @if (m.result!.route) { <a class="more" [routerLink]="routePath(m.result!.route)" [queryParams]="routeQuery(m.result!.route)" (click)="open.set(false)">{{ t('chat.full') }} <ft-icon name="arrow-right" [size]="14" /></a> }
                </div>
              }
            </div>
          }
          @if (ai.busy()) { <div class="msg"><div class="bubble typing"><i></i><i></i><i></i></div></div> }
        </div>

        <form class="inp" (ngSubmit)="send(draft())">
          <input class="input" [ngModel]="draft()" (ngModelChange)="draft.set($event)" name="q" [placeholder]="t('chat.placeholder')" autocomplete="off" [disabled]="ai.busy()" />
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
    .sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 201; height: 82vh; background: var(--surface); border-radius: var(--r-xl) var(--r-xl) 0 0; display: flex; flex-direction: column; box-shadow: var(--shadow-3); animation: up var(--t-slow) var(--ease) both; padding-bottom: var(--safe-b); }
    @media (min-width: 720px) { .sheet { left: auto; right: 24px; bottom: 24px; width: 420px; height: min(640px, 80vh); border-radius: var(--r-xl); } }
    @keyframes up { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    .grab { width: 40px; height: 4px; border-radius: 4px; background: var(--line); margin: 8px auto 4px; flex-shrink: 0; }
    .hd { display: flex; align-items: center; gap: 10px; padding: 6px 12px 10px 16px; border-bottom: 1px solid var(--line-2); flex-shrink: 0; }
    .av { width: 36px; height: 36px; border-radius: 12px; background: var(--grad-amber); color: #fff; display: grid; place-items: center; flex-shrink: 0; }
    .log { flex: 1; overflow: auto; padding: 14px 16px; display: grid; gap: 10px; align-content: start; }
    .hello p { color: var(--ink-2); font-size: .92rem; }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
    .hello .chip { white-space: normal; text-align: left; line-height: 1.25; padding-block: 6px; max-width: 100%; }
    .chip.cam { margin-top: 8px; background: var(--amber-100); color: var(--amber-800); font-weight: 700; }
    .msg { display: grid; gap: 8px; justify-items: start; max-width: 100%; }
    .msg.me { justify-items: end; }
    .bubble { padding: 10px 14px; border-radius: 18px 18px 18px 6px; background: var(--surface-2); border: 1px solid var(--line-2); font-size: .92rem; line-height: 1.45; max-width: 92%; white-space: pre-wrap; }
    .me .bubble { background: var(--ink); color: var(--bg); border-radius: 18px 18px 6px 18px; }
    .err .bubble { background: var(--warn-bg); color: var(--warn); }
    .typing { display: flex; gap: 4px; padding: 12px 14px; } .typing i { width: 6px; height: 6px; border-radius: 50%; background: var(--ink-4); animation: blink 1.2s infinite; } .typing i:nth-child(2) { animation-delay: .2s; } .typing i:nth-child(3) { animation-delay: .4s; }
    @keyframes blink { 0%, 80%, 100% { opacity: .3; } 40% { opacity: 1; } }
    .picks { display: grid; gap: 6px; width: 100%; }
    .pick { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 14px; border: 1.5px solid var(--line); background: var(--surface); }
    .pick.top { border-color: var(--amber-500); background: var(--amber-100); }
    .min0 { min-width: 0; }
    .pn { font-family: var(--font-display); font-weight: 800; font-size: .92rem; } .pn em { font-style: normal; font-size: .6rem; text-transform: uppercase; letter-spacing: .08em; background: var(--amber-500); color: #fff; padding: 1px 6px; border-radius: 999px; margin-left: 4px; vertical-align: middle; }
    .pw { font-size: .76rem; color: var(--ink-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .pp { font-size: .78rem; font-weight: 800; color: var(--amber-800); margin-top: 2px; }
    .more { display: inline-flex; align-items: center; gap: 4px; font-size: .8rem; font-weight: 700; color: var(--amber-700); margin-top: 2px; }
    .inp { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--line-2); flex-shrink: 0; }
    .inp .input { flex: 1; }
  `],
})
export class SommelierChatComponent {
  ai = inject(AiService);
  data = inject(DataService);
  i18n = inject(I18nService);
  private saas = inject(SaasService);
  private router = inject(Router);
  /** t() читает сигнал языка — шаблон и chips() пересчитываются при его смене. */
  readonly t = this.i18n.t;

  venue = input<AiVenue | null>(null);
  occasion = input<Occasion | null>(null);
  table = input<number | null>(null);

  readonly open = signal(false);
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
  readonly scanParams = computed(() => { const v = this.venue(); return v ? { venue: v.slug, ...(this.table() ? { table: this.table() } : {}) } : {}; });

  constructor() {
    effect(() => { this.msgs(); this.ai.busy(); queueMicrotask(() => { const el = this.log()?.nativeElement; if (el) el.scrollTop = el.scrollHeight; }); });
    effect(() => { const key = this.storeKey(); try { const raw = sessionStorage.getItem(key); if (raw) this.msgs.set(JSON.parse(raw)); } catch { /* ignore */ } }, { allowSignalWrites: true });
  }

  async send(text: string): Promise<void> {
    const q = text.trim();
    if (!q || this.ai.busy()) return;
    this.draft.set('');
    this.msgs.update(list => [...list, { role: 'user', text: q }]);
    const history: AiTurn[] = this.msgs().filter(m => !m.error).map(m => ({ role: m.role, content: m.text }));
    const r = await this.ai.ask(history, { venue: this.venue(), occasion: this.occasion() });
    if (!r.ok) { this.msgs.update(list => [...list, { role: 'assistant', text: r.error, error: true }]); return; }
    this.msgs.update(list => [...list, { role: 'assistant', text: r.reply, result: r }]);
    const v = this.venue();
    if (v && r.picks[0]) this.saas.track({ venue: v.slug, kind: 'PAIR_VIEW', dish: r.dish?.slug || r.dish?.name, beer: r.picks[0].beer_id, score: r.picks[0].score, table: this.table() });
    try { sessionStorage.setItem(this.storeKey(), JSON.stringify(this.msgs().slice(-12))); } catch { /* ignore */ }
  }

  order(r: AiResult, p: AiPick): void {
    const v = this.venue(); if (!v) return;
    this.saas.track({ venue: v.slug, kind: 'ORDER_INTENT', dish: r.dish?.slug || r.dish?.name, beer: p.beer_id, score: p.score, price: p.price, table: this.table() });
    this.ordered.update(s => new Set(s).add(p.beer_id));
  }

  fmt(n: number): string { return Math.round(n).toLocaleString('ru-RU'); }
  routePath(route: string): string { return route.split('?')[0]; }
  routeQuery(route: string): Record<string, string> { return Object.fromEntries(new URLSearchParams(route.split('?')[1] || '')); }
  private storeKey(): string { return `ft.ai.chat.${this.venue()?.slug || 'global'}`; }
}

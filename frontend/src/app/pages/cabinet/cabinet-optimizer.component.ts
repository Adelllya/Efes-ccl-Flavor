import { ChangeDetectionStrategy, Component, NgZone, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SaasService } from '../../core/saas.service';
import { MenuItem } from '../../core/saas.models';
import { DataV2Service, DishV2, DrinkV2, TAB_GROUPS } from '../../core/data-v2.service';
import {
  DishState, MenuAnalysis, PairLevel, ScoreTable, SuggestResult, SuggestStep,
  analyzeMenu, fillScores, newScoreTable, suggestDrinks, tableMatches,
} from '../../core/menu-optimizer';
import { DishProfile, DrinkProfile } from '../../engine/pairing-engine-v2';
import { plural } from '../../core/format';
import { IconComponent } from '../../ui/icon.component';
import { DrinkArtComponent } from '../../ui/drink-art.component';

type Mode = 'any' | 'efes';
type AddState = 'busy' | 'done' | 'limit' | 'error';
interface MenuData { beers: MenuItem[]; dishes: MenuItem[]; limit: number; used: number }
interface DishRow { s: DishState; label: string; ceiling: boolean }
interface Dumb { id: string; label: string; before: number | null; after: number; delta: number; x0: number; x1: number; tip: string }
interface StepView {
  step: SuggestStep; n: number; drink: DrinkV2; cat: string; producer: string;
  price: string | null; avail: string; rel: string | null; headline: string; dumbs: Dumb[]; hidden: number;
  idxFrom: string; idxTo: string; idxDelta: string; gainLabel: string;
}

const CAT_RU: Readonly<Record<string, string>> = {
  beer: 'Пиво', na_beer: 'Безалкогольное пиво', radler: 'Радлер', cider: 'Сидр', wine: 'Вино', sparkling: 'Игристое',
  fortified: 'Креплёное вино', cocktail: 'Коктейль', spirit: 'Крепкий алкоголь', liqueur: 'Ликёр', kvass: 'Квас',
  lemonade: 'Лимонад', soda: 'Тоник и газировка', dairy: 'Кумыс, айран, шубат', tea: 'Чай', coffee: 'Кофе', water: 'Вода',
};
const GROUP_RU: Readonly<Record<string, string>> = {
  beer: 'Пиво', na: 'Без алкоголя', cider: 'Сидр', wine: 'Вино и игристое', cocktail: 'Коктейли', spirit: 'Крепкое',
};
const AVAIL_RU: Readonly<Record<string, string>> = {
  wide: 'широко в рознице', horeca: 'в барах и ресторанах', import: 'импорт, крупные сети', niche: 'редко, нишевые магазины',
  unknown: 'наличие не проверялось', not_confirmed: 'наличие не подтверждено',
};
const REL_RU: Readonly<Record<string, string>> = { own: 'Efes Kazakhstan', distribution: 'дистрибуция Efes', cci: 'портфель CCI' };
const LEVEL_RU: Readonly<Record<PairLevel, string>> = { excellent: 'Отлично', good: 'Хорошо', weak: 'Слабо', none: 'Нет пары' };

/** Кеш баллов между открытиями вкладки: ключ — набор блюд меню (каталог в сессии не меняется). */
const MEMO = new Map<string, ScoreTable>();
/**
 * Уступить главный поток между порциями расчёта: ввод и отрисовка проходят между задачами. Не ждём «простоя»
 * (requestIdleCallback при занятом потоке откладывает каждую порцию до таймаута) — scheduler.yield, иначе
 * MessageChannel (без 4-мс зажима вложенных setTimeout), иначе setTimeout.
 */
const yieldToMain = (): Promise<void> => {
  const g = globalThis as { scheduler?: { yield?: () => Promise<void> } };
  if (typeof g.scheduler?.yield === 'function') return g.scheduler.yield();
  if (typeof MessageChannel !== 'undefined') {
    return new Promise(resolve => { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); resolve(); }; ch.port2.postMessage(0); });
  }
  return new Promise(resolve => setTimeout(resolve, 0));
};
/** После ближайшей отрисовки кадра (rAF → задача), чтобы первая часть страницы успела показаться. */
const nextPaint = (): Promise<void> => new Promise(resolve => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(resolve, 0)); else setTimeout(resolve, 0);
});
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * «Анализ карты» для кабинета заведения — самостоятельный блок: <ft-cabinet-optimizer />.
 * Берёт карту заведения из SaasService.menu() (только позиции «в наличии»), каталог — DataV2Service,
 * баллы — движок v2 через core/menu-optimizer.ts (analyzeMenu / suggestDrinks, без своей формулы).
 * Показывает: индекс «качество пар», блюда от слабых к сильным, до 3 напитков, которые сильнее всего поднимут пары
 * (любые / только портфель Efes — оба итога рядом, честно), и позиции карты, которые ни для одного блюда не лучшие.
 * «Добавить в карту» заводит напиток через SaasService.saveItems в стоп-листе с ценой 0: цену ставит владелец,
 * и только после «в наличии» гость его увидит. Кабинет русскоязычный, как cabinet.page.ts.
 */
@Component({
  selector: 'ft-cabinet-optimizer',
  standalone: true,
  imports: [RouterLink, IconComponent, DrinkArtComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mo" aria-labelledby="mo-title">
      <div class="top">
        <div>
          <span class="eyebrow">Анализ карты</span>
          <h2 id="mo-title" class="h">Как ваши напитки сочетаются с меню</h2>
          <p class="dim sm mt8 lede-s">Для каждого блюда берём лучший напиток из вашей карты и смотрим, чего не хватает. Считаются только позиции «в наличии».</p>
        </div>
      </div>

      @if (!saas.authed()) {
        <div class="card card-p mt12"><p class="dim sm">Войдите в кабинет, чтобы увидеть анализ карты.</p></div>
      } @else if (phase() === 'error') {
        <div class="soft warn mt12" role="alert">Не удалось загрузить каталог напитков или карту заведения. <button type="button" class="link" (click)="reload()">Повторить</button></div>
      } @else if (phase() === 'loading') {
        <div class="mt12" aria-busy="true">
          <div class="skeleton sk-hero" aria-hidden="true"></div>
          <p class="muted xs mt8" aria-live="polite">{{ progressText() }}</p>
          <div class="skeleton sk-row mt12" aria-hidden="true"></div>
          <div class="skeleton sk-row mt8" aria-hidden="true"></div>
          <div class="skeleton sk-row mt8" aria-hidden="true"></div>
        </div>
      } @else if (!dishes().length) {
        <div class="card card-p mt12">
          <p class="empty">В меню нет блюд</p>
          <p class="muted sm mt8">Добавьте блюда во вкладке «Меню и цены» (и отметьте «в наличии») — анализ покажет, к каким из них в карте нет хорошей пары.</p>
        </div>
      } @else { @if (analysis(); as a) {
        <!-- ═══ итог ═══ -->
        @if (a.list_size) {
          <div class="hero card mt12">
            <div class="hero-l">
              <span class="eyebrow plain">Качество пар</span>
              <div class="big" [attr.aria-label]="'Качество пар ' + idx(a.index) + ' из 99'">{{ idx(a.index) }}<span class="of">/99</span></div>
              <p class="dim sm">Средний балл лучшей пары из вашей карты по {{ word(dishes().length, 'блюду', 'блюдам', 'блюдам') }} меню.</p>
            </div>
            <div class="hero-r">
              <div class="kpi"><span class="kv">{{ pct(a.excellent_share) }}</span><span class="kl">блюд с отличной парой (от 72) — {{ a.excellent }} из {{ dishes().length }}</span></div>
              <div class="kpi" [class.kpi-warn]="a.weak + a.none > 0"><span class="kv">{{ a.weak + a.none }}</span><span class="kl">{{ form(a.weak + a.none, 'блюдо', 'блюда', 'блюд') }} без хорошей пары (ниже 60)</span></div>
              <div class="kpi"><span class="kv">{{ a.list_size }}</span><span class="kl">{{ form(a.list_size, 'напиток', 'напитка', 'напитков') }} карты в подборе</span></div>
            </div>
            <div class="dist">
              <div class="dbar" role="img" [attr.aria-label]="distLabel()">
                @for (seg of dist(); track seg.level) {
                  @if (seg.n) { <i class="seg lv-{{ seg.level }}" [style.flex-grow]="seg.n" [title]="seg.label + ': ' + seg.n"></i> }
                }
              </div>
              <ul class="legend">
                @for (seg of dist(); track seg.level) {
                  <li><i class="sw lv-{{ seg.level }}"></i>{{ seg.label }} <b>{{ seg.n }}</b></li>
                }
              </ul>
            </div>
          </div>
        } @else {
          <div class="card card-p mt12">
            <p class="empty">В карте нет напитков из каталога</p>
            <p class="muted sm mt8">Сочетать блюда пока не с чем. Ниже — напитки, с которых стоит начать: они закрывают больше всего блюд вашего меню.</p>
          </div>
        }

        <!-- ═══ блюда ═══ -->
        @if (a.list_size) {
          <div class="card card-p mt12">
            <div class="flex jb ac wrap g8"><b>Блюда: от слабых пар к сильным</b><span class="muted xs">балл лучшей пары из карты</span></div>
            <ul class="rows mt12">
              @for (r of dishRows(); track r.s.dish_id) {
                <li class="drow" [class.weak]="r.s.level === 'weak' || r.s.level === 'none'">
                  <span class="sc"><i class="mk lv-{{ r.s.level }}"></i><b>{{ r.s.score ?? '—' }}</b></span>
                  <div class="grow min0">
                    <div class="flex jb g8 as">
                      <span class="dn-s">{{ r.label }}</span>
                      <span class="band muted nowrap">{{ r.s.band_label ?? levelRu(r.s.level) }}</span>
                    </div>
                    @if (r.s.drink_name) { <div class="xs dim mt2 clamp2" [title]="r.s.reason ?? ''">{{ r.s.drink_name }}@if (r.s.reason && r.s.level !== 'weak') { <span class="muted"> · {{ r.s.reason }}</span> }</div> }
                    @if (r.s.level === 'weak' || r.s.level === 'none') {
                      <div class="flex g6 wrap ac mt6">
                        <span class="badge badge-warn">нет хорошей пары</span>
                        @if (r.s.warning) { <span class="xs muted">{{ r.s.warning }}</span> }
                      </div>
                    }
                    @if (r.ceiling && r.s.ceiling; as c) { <div class="xs muted mt6">Лучшее в каталоге: <a class="lnk" [routerLink]="['/drinks', c.drink_id]" target="_blank">{{ c.drink_name }}</a> — {{ c.score }}</div> }
                  </div>
                </li>
              }
            </ul>
            @if (dishRowsAll().length > collapsedCount) {
              <button type="button" class="btn btn-ghost btn-sm mt12" (click)="showAll.set(!showAll())" [attr.aria-expanded]="showAll()">
                <ft-icon [name]="showAll() ? 'chevron-down' : 'chevron-right'" [size]="16" />
                {{ showAll() ? 'Свернуть' : 'Показать все ' + word(dishRowsAll().length, 'блюдо', 'блюда', 'блюд') }}
              </button>
            }
          </div>
        }

        <!-- ═══ что добавить (второй кадр: сначала итог и блюда) ═══ -->
        @if (!stage2()) {
          <div class="skeleton sk-hero mt12" aria-hidden="true"></div>
        } @else {
          <div class="card card-p mt12">
            <b>Что добавить в карту</b>
            <p class="muted xs mt4">До трёх напитков из каталога, которые сильнее всего поднимут лучшие пары ваших блюд. Каждый следующий учитывает предыдущие.</p>

            <div class="modes mt12" role="group" aria-label="Из каких напитков выбирать">
              @for (m of modeViews(); track m.id) {
                <button type="button" class="mode" [class.on]="mode() === m.id" [attr.aria-pressed]="mode() === m.id" (click)="mode.set(m.id)">
                  <span class="mt-t">{{ m.title }}</span>
                  <span class="mt-v">{{ m.value }}</span>
                  <span class="mt-s">{{ m.sub }}</span>
                </button>
              }
            </div>

            <div class="groups mt12" role="group" aria-label="Какие категории готовы добавить">
              <span class="xs muted">Готовы добавить:</span>
              @for (g of groupList; track g.id) {
                <button type="button" class="chip chip-sm" [class.on]="groups().has(g.id)" [attr.aria-pressed]="groups().has(g.id)" (click)="toggleGroup(g.id)">@if (groups().has(g.id)) { <ft-icon name="check" [size]="12" [stroke]="3" /> }{{ g.label }}</button>
              }
            </div>

            @if (honestNote(); as note) { <div class="soft note mt12" role="note"><ft-icon name="info" [size]="16" /> <span>{{ note }}</span></div> }

            @if (steps().length) {
              <div class="legend2 mt16" aria-hidden="true">
                <span><i class="dot b"></i>сейчас</span><span><i class="dot a"></i>с новым напитком</span><span class="muted">риски — 60 и 72 баллов</span>
              </div>
              <ol class="steps">
                @for (v of steps(); track v.step.drink_id) {
                  <li class="step">
                    <div class="st-head">
                      <span class="art"><ft-drink-art [drink]="v.drink" [size]="76" [preferPhoto]="!!v.drink.image" /></span>
                      <div class="grow min0">
                        <div class="xs muted">{{ v.n }}-й напиток · {{ v.cat }}</div>
                        <h3 class="dname"><a [routerLink]="['/drinks', v.drink.id]" target="_blank">{{ v.drink.name }}</a></h3>
                        @if (v.producer) { <div class="xs dim">{{ v.producer }}</div> }
                        <div class="flex g6 wrap mt8">
                          @if (v.rel) { <span class="tag rel">{{ v.rel }}</span> }
                          <span class="tag">{{ v.avail }}</span>
                          @if (v.price) { <span class="tag">{{ v.price }}</span> }
                        </div>
                      </div>
                      <div class="gain">
                        <span class="gv">{{ v.idxDelta }}</span>
                        <span class="kl">{{ v.gainLabel }}</span>
                      </div>
                    </div>

                    <p class="headline mt12">{{ v.headline }}</p>

                    <ul class="dumbs mt8">
                      @for (d of v.dumbs; track d.id) {
                        <li class="dmb" [title]="d.tip">
                          <span class="dl">{{ d.label }}</span>
                          <span class="track" role="img" [attr.aria-label]="d.tip">
                            @for (t of ticks(); track t) { <i class="tick" [style.left.%]="t"></i> }
                            <i class="line" [style.left.%]="d.x0" [style.width.%]="d.x1 - d.x0"></i>
                            @if (d.before !== null) { <i class="dot b" [style.left.%]="d.x0"></i> }
                            <i class="dot a" [style.left.%]="d.x1"></i>
                          </span>
                          <span class="dv">@if (d.before !== null) { <span class="muted">{{ d.before }}</span> → }<b>{{ d.after }}</b></span>
                        </li>
                      }
                    </ul>
                    @if (v.hidden) {
                      <button type="button" class="link xs mt8" (click)="toggleStep(v.step.drink_id)">
                        {{ expanded().has(v.step.drink_id) ? 'Свернуть' : 'И ещё ' + word(v.hidden, 'блюдо', 'блюда', 'блюд') }}
                      </button>
                    }
                    @if (v.step.reason) { <p class="xs muted mt8"><b class="dim">Почему:</b> {{ v.step.reason }}</p> }

                    <div class="st-foot mt12">
                      <span class="sm dim">Качество пар: {{ v.idxFrom }} → <b>{{ v.idxTo }}</b></span>
                      @switch (addState()[v.step.drink_id]) {
                        @case ('done') { <span class="ok-s sm"><ft-icon name="check" [size]="16" /> В карте, в стоп-листе</span> }
                        @case ('busy') { <button type="button" class="btn btn-secondary btn-sm" disabled>Добавляем…</button> }
                        @default { <button type="button" class="btn btn-secondary btn-sm" (click)="add(v)" [disabled]="limitReached()"><ft-icon name="beer" [size]="16" /> Добавить в карту</button> }
                      }
                    </div>
                    @switch (addState()[v.step.drink_id]) {
                      @case ('done') { <p class="xs muted mt8">Цену мы не подставляем. Во вкладке «Меню и цены» укажите цену и объём и включите «в наличии» — тогда гости увидят эту пару.</p> }
                      @case ('limit') { <p class="xs warn-t mt8">Лимит тарифа — {{ menuLimit() }} позиций. Освободите место в карте или смените тариф.</p> }
                      @case ('error') { <p class="xs warn-t mt8">Не удалось добавить. Проверьте соединение и попробуйте ещё раз.</p> }
                    }
                    @if (limitReached() && !addState()[v.step.drink_id]) { <p class="xs muted mt8">Карта заполнена по лимиту тарифа ({{ menuLimit() }} позиций).</p> }
                  </li>
                }
              </ol>
            } @else {
              <p class="empty-s mt16">{{ noStepsText() }}</p>
            }
          </div>

          <!-- ═══ лишние позиции ═══ -->
          @if (redundant().length) {
            <div class="card card-p mt12">
              <b>Позиции, которые не ведут ни одну пару</b>
              <p class="muted xs mt4">Для каждого блюда в вашей карте есть напиток не хуже. Это не повод убирать: их могут заказывать и сами по себе. Но если освобождаете место в карте — начните с них.</p>
              <ul class="rows mt12">
                @for (r of redundant(); track r.drink_id) {
                  <li class="rrow">
                    <div class="grow min0">
                      <div class="dn-s"><a class="plain-a" [routerLink]="['/drinks', r.drink_id]" target="_blank">{{ r.drink_name }}</a></div>
                      <div class="xs muted mt2">{{ redundantLine(r) }}</div>
                    </div>
                    @if (r.gap !== null && r.gap <= 2) { <span class="tag">почти равноценна</span> }
                  </li>
                }
              </ul>
            </div>
          }
        }

        <p class="xs muted mt12 foot">
          Баллы — движок подбора Flavor Tree для «среднего гостя», без личных вкусов. Бренд на баллы не влияет.
          @if (notes(); as n) { {{ n }} }
        </p>
      } }
    </section>
  `,
  styles: [`
    :host { display: block; --lv-excellent: var(--ok); --lv-good: var(--ink-4); --lv-weak: var(--warn); --lv-none: var(--warn); --mk-before: var(--ink-4); --mk-after: var(--gold); }
    :host-context([data-theme="light"]) { --mk-after: var(--amber-700); }
    @media (prefers-color-scheme: light) { :host-context(:root:not([data-theme="dark"])) { --mk-after: var(--amber-700); } }
    .top { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
    .h { font-size: 1.5rem; margin-top: 4px; }
    .lede-s { max-width: 62ch; }
    .mt2 { margin-top: 2px; } .mt4 { margin-top: 4px; } .mt6 { margin-top: 6px; }
    .min0 { min-width: 0; }
    .empty { font-family: var(--font-display); font-size: 1.3rem; }
    .empty-s { color: var(--ink-2); font-size: .92rem; }
    .sk-hero { height: 190px; border-radius: var(--r-lg); }
    .sk-row { height: 58px; }
    .link { color: var(--amber-700); font-weight: 700; text-decoration: underline; }
    .lnk { color: var(--ink-2); text-decoration: underline; text-decoration-color: var(--line); text-underline-offset: 2px; }
    .lnk:hover, .plain-a:hover { color: var(--gold-soft); }
    .soft.warn { background: var(--warn-bg); color: var(--warn); padding: 10px 14px; border-radius: var(--r-md); }
    .warn-t { color: var(--warn); }
    .ok-s { color: var(--ok); font-weight: 700; display: inline-flex; align-items: center; gap: 6px; }

    /* итог */
    .hero { display: grid; gap: 16px; padding: 18px; }
    @media (min-width: 720px) { .hero { grid-template-columns: 1fr 1.3fr; align-items: center; padding: 24px; } }
    .big { font-family: var(--font-display); font-weight: 700; font-size: 3.4rem; line-height: 1; letter-spacing: -.02em; margin: 6px 0 8px; color: var(--ink); font-variant-numeric: lining-nums proportional-nums; }
    .big .of { font-size: 1.2rem; color: var(--ink-3); margin-left: 4px; letter-spacing: 0; }
    .hero-r { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    @media (max-width: 420px) { .hero-r { grid-template-columns: 1fr 1fr; } .hero-r .kpi:last-child { grid-column: span 2; } }
    .kpi { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); padding: 10px 12px; display: grid; gap: 2px; align-content: start; }
    .kpi-warn { border-color: rgba(229, 112, 90, .35); }
    .kv { font-family: var(--font-display); font-weight: 800; font-size: 1.5rem; line-height: 1.1; font-variant-numeric: lining-nums proportional-nums; }
    .kl { font-size: .72rem; color: var(--ink-3); line-height: 1.3; }
    .dist { grid-column: 1 / -1; }
    .dbar { display: flex; gap: 2px; height: 10px; }
    .dbar .seg { display: block; min-width: 6px; height: 100%; }
    .dbar .seg:first-child { border-radius: 4px 0 0 4px; }
    .dbar .seg:last-child { border-radius: 0 4px 4px 0; }
    .dbar .seg:only-child { border-radius: 4px; }
    .legend { list-style: none; padding: 0; margin: 8px 0 0; display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: .76rem; color: var(--ink-2); }
    .legend li { display: inline-flex; align-items: center; gap: 6px; }
    .legend b { color: var(--ink); font-variant-numeric: tabular-nums; }
    .sw { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
    .lv-excellent { background: var(--lv-excellent); } .lv-good { background: var(--lv-good); }
    .lv-weak { background: var(--lv-weak); } .lv-none { background: var(--lv-none); }

    /* блюда */
    .rows { list-style: none; padding: 0; margin: 0; display: grid; }
    .drow { display: flex; gap: 12px; align-items: flex-start; padding: 10px 8px; border-top: 1px solid var(--line-2); border-radius: var(--r-sm); }
    .drow:first-child { border-top: 0; }
    .drow.weak { background: var(--warn-bg); border-top-color: transparent; }
    .drow.weak + .drow { border-top-color: transparent; }
    .sc { display: inline-flex; align-items: center; gap: 6px; min-width: 50px; padding-top: 1px; }
    .sc b { font-family: var(--font-display); font-weight: 800; font-size: 1.25rem; line-height: 1; font-variant-numeric: lining-nums tabular-nums; color: var(--ink); }
    .mk { width: 4px; height: 18px; border-radius: 2px; display: inline-block; flex-shrink: 0; }
    .dn-s { font-weight: 700; font-size: .92rem; overflow-wrap: anywhere; }
    .drow .band { flex-shrink: 0; font-size: .72rem; }
    .clamp2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .plain-a { color: var(--ink); }

    /* режимы */
    .modes { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .mode { text-align: left; display: grid; gap: 2px; padding: 12px 14px; border-radius: var(--r-md); border: 1.5px solid var(--line); background: var(--surface); color: var(--ink-2); transition: border-color var(--t-fast), background var(--t-fast); }
    .mode:hover { border-color: rgba(229, 184, 73, .45); }
    .mode.on { border-color: var(--gold); background: var(--surface-2); color: var(--ink); box-shadow: var(--ring); }
    .mt-t { font-weight: 700; font-size: .84rem; }
    .mt-v { font-family: var(--font-display); font-weight: 800; font-size: 1.35rem; color: var(--ink); font-variant-numeric: lining-nums; }
    .mt-s { font-size: .72rem; color: var(--ink-3); line-height: 1.3; }
    .groups { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    /* фильтр — тихий: включённая категория с золотой кромкой и галочкой, выключенная — приглушена */
    .groups .chip { gap: 4px; }
    .groups .chip.on { background: var(--surface-2); color: var(--ink); border-color: rgba(229, 184, 73, .55); box-shadow: none; font-weight: 700; }
    .groups .chip:not(.on) { color: var(--ink-3); }
    .groups .chip ft-icon { color: var(--gold); }
    .soft.note { display: flex; gap: 8px; align-items: flex-start; padding: 10px 14px; font-size: .84rem; color: var(--ink-2); border-radius: var(--r-md); }
    .soft.note ft-icon { color: var(--gold); margin-top: 2px; flex-shrink: 0; }

    /* шаги */
    .legend2 { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: .74rem; color: var(--ink-2); align-items: center; }
    .legend2 > span { display: inline-flex; align-items: center; gap: 6px; }
    .legend2 .dot { position: static; transform: none; }
    .steps { list-style: none; padding: 0; margin: 10px 0 0; display: grid; gap: 12px; }
    .step { border: 1px solid var(--line); border-radius: var(--r-md); padding: 14px; background: var(--surface); min-width: 0; }
    .st-head { display: flex; gap: 12px; align-items: flex-start; }
    .art { width: 60px; display: grid; place-items: center; flex-shrink: 0; }
    .dname { font-size: 1.25rem; margin-top: 2px; overflow-wrap: anywhere; }
    .dname a:hover { color: var(--gold-soft); }
    .tag.rel { color: var(--amber-700); border-color: rgba(229, 184, 73, .45); font-weight: 700; }
    .tag { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: var(--r-full); font-size: .72rem; font-weight: 600; color: var(--ink-2); background: var(--surface-2); border: 1px solid var(--line); white-space: nowrap; }
    .gain { display: grid; justify-items: end; text-align: right; flex-shrink: 0; }
    .gv { font-family: var(--font-display); font-weight: 800; font-size: 1.6rem; line-height: 1; color: var(--ink); font-variant-numeric: lining-nums proportional-nums; }
    .gain .kl { max-width: 72px; }
    .headline { font-size: .95rem; color: var(--ink); line-height: 1.45; }
    .dumbs { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; }
    .dmb { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'l v' 't t'; column-gap: 10px; row-gap: 2px; align-items: center; padding: 4px 0; }
    @media (min-width: 560px) { .dmb { grid-template-columns: minmax(0, 11rem) minmax(0, 1fr) 5.5rem; grid-template-areas: 'l t v'; } }
    .dl { grid-area: l; font-size: .84rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dv { grid-area: v; font-size: .84rem; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .dv b { color: var(--ink); }
    .track { grid-area: t; position: relative; height: 16px; display: block; }
    .track::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; height: 1px; background: var(--line); }
    .tick { position: absolute; top: 3px; bottom: 3px; width: 1px; background: var(--line); }
    .line { position: absolute; top: 50%; height: 2px; margin-top: -1px; background: var(--mk-after); opacity: .55; border-radius: 1px; }
    .dot { position: absolute; top: 50%; width: 10px; height: 10px; border-radius: 50%; transform: translate(-50%, -50%); box-shadow: 0 0 0 2px var(--surface); display: inline-block; }
    .dot.b { background: var(--mk-before); }
    .dot.a { background: var(--mk-after); }
    .st-foot { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; padding-top: 12px; border-top: 1px solid var(--line-2); }

    /* лишние */
    .rrow { display: flex; gap: 10px; align-items: center; padding: 10px 0; border-top: 1px solid var(--line-2); }
    .rrow:first-child { border-top: 0; padding-top: 0; }
    .foot { line-height: 1.5; }
  `],
})
export class CabinetOptimizerComponent {
  readonly saas = inject(SaasService);
  private data = inject(DataV2Service);
  private zone = inject(NgZone);

  readonly collapsedCount = 8;
  readonly groupList = TAB_GROUPS.map(g => ({ id: g.id, label: GROUP_RU[g.id] ?? g.id, categories: g.categories }));

  readonly phase = signal<'loading' | 'ready' | 'error'>('loading');
  readonly progress = signal<{ done: number; total: number }>({ done: 0, total: 0 });
  readonly menu = signal<MenuData | null>(null);
  private readonly table = signal<ScoreTable | null>(null);
  /** Анализ считается в load() отдельной задачей после таблицы баллов (зависит только от карты — меняется вместе с ней). */
  private readonly analysisState = signal<MenuAnalysis | null>(null);
  readonly analysis = this.analysisState.asReadonly();
  readonly mode = signal<Mode>('any');
  readonly groups = signal<ReadonlySet<string>>(new Set(TAB_GROUPS.map(g => g.id)));
  readonly showAll = signal(false);
  readonly expanded = signal<ReadonlySet<string>>(new Set());
  readonly addState = signal<Readonly<Record<string, AddState>>>({});
  /** Второй кадр отрисовки: предложения и «лишние» — после того, как итог и блюда уже показаны. */
  readonly stage2 = signal(false);
  private readonly added = signal(0);
  /** Перезагружаемся только при смене входа, а не при любом обновлении сессии (например, настроек заведения). */
  private readonly token = computed(() => this.saas.session()?.token ?? '');
  private ticket = 0;

  // ── входы анализа: карта заведения → профили движка ──
  private readonly dishItems = computed(() => (this.menu()?.dishes ?? []).filter(i => i.is_available));
  readonly dishes = computed<DishProfile[]>(() => {
    const byId = this.data.dishProfileById();
    const seen = new Set<string>();
    const out: DishProfile[] = [];
    for (const it of this.dishItems()) {
      const p = byId.get(it.ref_slug);
      if (p && !seen.has(p.id)) { seen.add(p.id); out.push(p); }
    }
    return out;
  });
  private readonly dishLabel = computed(() => {
    const m = new Map<string, string>();
    for (const it of this.dishItems()) {
      const d: DishV2 | undefined = this.data.dish(it.ref_slug);
      if (d && !m.has(d.id)) m.set(d.id, (it.name || d.display_name || d.name).trim());
    }
    return m;
  });
  /** Позиция карты → id напитка v2 (по id или slug сорта v1 через legacy_brand_id). */
  private readonly drinkIdOf = computed(() => {
    const m = new Map<string, string>();
    for (const d of this.data.drinks() ?? []) {
      m.set(d.id, d.id);
      if (d.legacy_brand_id && !m.has(d.legacy_brand_id)) m.set(d.legacy_brand_id, d.id);
    }
    return m;
  });
  private readonly poolById = computed(() => new Map(this.data.guestPool().map(p => [p.id, p])));
  readonly list = computed<DrinkProfile[]>(() => {
    const ids = this.drinkIdOf(), pool = this.poolById();
    const out = new Map<string, DrinkProfile>();
    for (const it of this.menu()?.beers ?? []) {
      if (!it.is_available) continue;
      const id = ids.get(it.ref_slug); const p = id ? pool.get(id) : undefined;
      if (p) out.set(p.id, p);
    }
    return [...out.values()];
  });
  /** Всё, что уже заведено в карте (и в стоп-листе) — это не предлагаем. */
  private readonly listAllIds = computed(() => {
    const ids = this.drinkIdOf();
    return (this.menu()?.beers ?? []).map(it => ids.get(it.ref_slug)).filter((x): x is string => !!x);
  });

  private readonly categories = computed<string[] | null>(() => {
    const on = this.groups();
    if (on.size === TAB_GROUPS.length) return null;
    return TAB_GROUPS.filter(g => on.has(g.id)).flatMap(g => [...g.categories]);
  });
  private readonly results = computed<Record<Mode, SuggestResult> | null>(() => {
    const a = this.analysis(), table = this.table();
    if (!a || !table) return null;
    const base = { table, analysis: a, categories: this.categories(), exclude: this.listAllIds() };
    const run = (efesOnly: boolean) => suggestDrinks(this.dishes(), this.list(), this.data.guestPool(), this.data.params, this.data.classics, { ...base, efesOnly });
    return { any: run(false), efes: run(true) };
  });

  // ── представление ──
  readonly dishRowsAll = computed<DishRow[]>(() => {
    const labels = this.dishLabel();
    return (this.analysis()?.dishes ?? []).map(s => ({
      s, label: labels.get(s.dish_id) ?? s.dish_name,
      ceiling: !!s.ceiling && s.score !== null && s.level !== 'excellent' && s.ceiling.score > s.score && s.ceiling.drink_id !== s.drink_id,
    }));
  });
  readonly dishRows = computed(() => (this.showAll() ? this.dishRowsAll() : this.dishRowsAll().slice(0, this.collapsedCount)));
  readonly dist = computed(() => {
    const a = this.analysis();
    return [
      { level: 'weak' as const, label: 'Слабо, ниже 60', n: (a?.weak ?? 0) + (a?.none ?? 0) },
      { level: 'good' as const, label: 'Хорошо, 60–71', n: a?.good ?? 0 },
      { level: 'excellent' as const, label: 'Отлично, от 72', n: a?.excellent ?? 0 },
    ];
  });
  readonly distLabel = computed(() => 'Распределение блюд по качеству пары: ' + this.dist().map(s => `${s.label} — ${s.n}`).join(', '));

  readonly modeViews = computed(() => {
    const r = this.results();
    const empty = (this.analysis()?.list_size ?? 0) === 0;
    const view = (id: Mode, title: string) => {
      const x = r?.[id];
      if (!x) return { id, title, value: '—', sub: '' };
      const gainExc = x.after.excellent - x.before.excellent;
      return {
        id, title,
        value: x.steps.length ? (empty ? `— → ${this.idx(x.after.index)}` : this.idxPair(x.before.index, x.after.index).join(' → ')) : 'без изменений',
        sub: x.steps.length
          ? `${plural(x.steps.length, 'напиток', 'напитка', 'напитков')}${gainExc > 0 ? ` · +${plural(gainExc, 'блюдо', 'блюда', 'блюд')} с отличной парой` : ''}`
          : 'заметно лучше не станет',
      };
    };
    return [view('any', 'Любые напитки'), view('efes', 'Только портфель Efes')];
  });
  /** Честно: если вне портфеля Efes есть вариант заметно сильнее — говорим об этом в режиме Efes. */
  readonly honestNote = computed<string | null>(() => {
    const r = this.results();
    if (!r || this.mode() !== 'efes') return null;
    const any = r.any.after.index ?? 0, efes = r.efes.after.index ?? 0;
    if (any - efes < 1 || !r.any.steps.length) return null;
    const first = r.any.steps[0];
    const outside = first.efes ? '' : ` Сильнейший вариант вне портфеля — «${first.drink_name}».`;
    return `Без ограничения портфелем качество пар выросло бы до ${this.idx(any)}, с портфелем Efes — до ${this.idx(efes)}.${outside}`;
  });
  readonly steps = computed<StepView[]>(() => {
    const r = this.results()?.[this.mode()];
    if (!r) return [];
    const labels = this.dishLabel();
    const byId = this.data.drinkById();
    const lo = this.scaleLo();
    const x = (v: number) => ((Math.max(lo, Math.min(100, v)) - lo) / (100 - lo)) * 100;
    const open = this.expanded();
    const empty = (this.analysis()?.list_size ?? 0) === 0;
    let prev = r.before.index;
    const out: StepView[] = [];
    r.steps.forEach((step, i) => {
      const drink = byId.get(step.drink_id);
      if (!drink) return;
      const label = (id: string, fallback: string) => labels.get(id) ?? fallback;
      const all = step.improved.map(d => {
        const l = label(d.dish_id, d.dish_name);
        return {
          id: d.dish_id, label: l, before: d.before, after: d.after, delta: d.delta,
          x0: d.before === null ? 0 : x(d.before), x1: x(d.after),
          tip: `${l}: ${d.before === null ? 'пары не было' : 'сейчас ' + d.before}, с «${step.drink_name}» — ${d.after} (+${d.delta})`,
        };
      });
      const shown = open.has(step.drink_id) ? all : all.slice(0, 6);
      const head = step.improved.slice(0, 3)
        .map(d => `${lcFirst(label(d.dish_id, d.dish_name))} ${d.before === null ? d.after : `${d.before} → ${d.after}`}`).join(', ');
      const allNew = step.improved.every(d => d.before === null);
      const [from, to] = this.idxPair(prev, step.index_after);
      const delta = (step.index_after ?? 0) - (prev ?? 0);
      out.push({
        step, n: i + 1, drink, cat: CAT_RU[drink.category] ?? drink.category,
        producer: drink.producer?.name ?? '',
        price: priceText(drink), avail: AVAIL_RU[drink.availability_kz?.level ?? 'unknown'] ?? AVAIL_RU['unknown'],
        rel: REL_RU[drink.efes_relation ?? ''] ?? null,
        headline: allNew
          ? `Добавьте «${drink.name}» — у ${plural(step.improved.length, 'блюда', 'блюд', 'блюд')} появится пара: ${head}${step.improved.length > 3 ? ', …' : '.'}`
          : `Добавьте «${drink.name}» — ${plural(step.improved.length, 'блюдо получит', 'блюда получат', 'блюд получат')} пару лучше: ${head}${step.improved.length > 3 ? ', …' : '.'}`,
        dumbs: shown, hidden: all.length > 6 ? all.length - 6 : 0,
        idxFrom: empty && i === 0 ? '—' : from, idxTo: to,
        idxDelta: empty && i === 0 ? to : `+${Math.abs(delta) < 1 ? fmt1(delta) : Math.round(delta)}`,
        gainLabel: empty && i === 0 ? 'качество пар' : 'к качеству пар',
      });
      prev = step.index_after;
    });
    return out;
  });
  /** Общая шкала всех «гантелей» режима: от 40–50 (или ниже, если есть совсем слабые пары) до 100. */
  private readonly scaleLo = computed(() => {
    const r = this.results()?.[this.mode()];
    let min = 100;
    for (const s of r?.steps ?? []) for (const d of s.improved) min = Math.min(min, d.before ?? d.after, d.after);
    return Math.max(0, Math.min(50, Math.floor(min / 10) * 10));
  });
  readonly ticks = computed(() => {
    const lo = this.scaleLo();
    return [60, 72].filter(t => t > lo).map(t => ((t - lo) / (100 - lo)) * 100);
  });
  readonly noStepsText = computed(() => {
    if (!this.groups().size) return 'Выберите хотя бы одну категорию напитков.';
    return this.mode() === 'efes'
      ? 'В портфеле Efes нет напитка, который заметно поднял бы пары вашего меню, — карта уже закрывает то, что может портфель.'
      : 'Ни один напиток каталога не поднимет пары заметно: ваша карта уже закрывает меню.';
  });
  readonly redundant = computed(() => ((this.analysis()?.list_size ?? 0) >= 2 ? this.analysis()?.redundant ?? [] : []));

  readonly menuLimit = computed(() => this.menu()?.limit ?? 0);
  readonly limitReached = computed(() => { const m = this.menu(); return !!m && m.limit > 0 && m.used + this.added() >= m.limit; });
  readonly notes = computed(() => {
    const m = this.menu(); if (!m) return '';
    const ids = this.drinkIdOf(), pool = this.poolById();
    const avail = m.beers.filter(b => b.is_available);
    const unknownDrinks = avail.filter(b => !ids.has(b.ref_slug)).length;
    const outOfPool = avail.filter(b => { const id = ids.get(b.ref_slug); return !!id && !pool.has(id); }).length;
    const stop = m.beers.filter(b => !b.is_available).length;
    const unknownDishes = this.dishItems().filter(i => !this.data.dish(i.ref_slug)).length;
    const parts: string[] = [];
    if (stop) parts.push(`${plural(stop, 'напиток', 'напитка', 'напитков')} в стоп-листе не ${stop === 1 ? 'учитывается' : 'учитываются'}`);
    if (unknownDrinks) parts.push(`${plural(unknownDrinks, 'позицию', 'позиции', 'позиций')} карты напитков мы не нашли в каталоге`);
    if (outOfPool) parts.push(`${plural(outOfPool, 'напиток', 'напитка', 'напитков')} пока не ${outOfPool === 1 ? 'участвует' : 'участвуют'} в подборе (наличие не подтверждено)`);
    if (unknownDishes) parts.push(`${plural(unknownDishes, 'блюдо', 'блюда', 'блюд')} нет в справочнике блюд`);
    return parts.length ? `${capFirst(parts.join('; '))}.` : '';
  });
  readonly progressText = computed(() => {
    const p = this.progress();
    return p.total ? `Считаем пары: ${p.done} из ${plural(p.total, 'напитка', 'напитков', 'напитков')} каталога…` : 'Загружаем каталог напитков и вашу карту…';
  });

  constructor() {
    effect(() => {
      const token = this.token();
      untracked(() => void this.load(token));
    }, { allowSignalWrites: true });
  }

  reload(): void { void this.load(this.token()); }

  toggleGroup(id: string): void {
    this.groups.update(s => { const n = new Set(s); if (n.has(id)) { if (n.size > 1) n.delete(id); } else n.add(id); return n; });
  }
  toggleStep(id: string): void {
    this.expanded.update(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  /** Заводим напиток в карту через тот же SaasService.saveItems, что и редактор меню: в стоп-листе, без цены. */
  async add(v: StepView): Promise<void> {
    const id = v.drink.id;
    if (this.addState()[id] === 'busy' || this.addState()[id] === 'done') return;
    if (this.limitReached()) { this.setAdd(id, 'limit'); return; }
    this.setAdd(id, 'busy');
    const m = this.menu();
    const res = await this.saas.saveItems([{
      kind: 'BEER', ref_slug: id,
      name: v.drink.legacy_brand_id ? '' : v.drink.name,    // v1-сорта редактор меню называет сам
      description: '', category: CAT_RU[v.drink.category] ?? 'Напитки', price: 0, volume: '',
      is_available: false, is_featured: false, sort_order: (m?.beers.length ?? 0) + this.added(),
    }]);
    if (!res.ok) { this.setAdd(id, 'error'); return; }
    if (res.skipped) { this.setAdd(id, 'limit'); return; }
    this.added.update(n => n + 1);
    this.setAdd(id, 'done');
  }

  idx(x: number | null): string { return x === null ? '—' : String(Math.round(x)); }
  pct(x: number | null): string { return x === null ? '—' : `${Math.round(x * 100)}%`; }
  word(n: number, one: string, few: string, many: string): string { return plural(n, one, few, many); }
  /** Только форма слова, без числа. */
  form(n: number, one: string, few: string, many: string): string { return plural(n, one, few, many).slice(String(n).length + 1); }
  levelRu(l: PairLevel): string { return LEVEL_RU[l]; }
  redundantLine(r: { closest_dish_id: string | null; closest_dish_name: string | null; score: number | null; gap: number | null }): string {
    if (r.closest_dish_id === null || r.score === null || r.gap === null) return 'К блюдам меню не подходит.';
    const dish = this.dishLabel().get(r.closest_dish_id) ?? r.closest_dish_name ?? '';
    return `Лучшая пара — «${dish}», ${plural(r.score, 'балл', 'балла', 'баллов')}; лидер карты для этого блюда — на ${plural(r.gap, 'балл', 'балла', 'баллов')} выше.`;
  }

  /** «77 → 90»; если округление спрятало бы разницу — с одним знаком после запятой. */
  private idxPair(a: number | null, b: number | null): [string, string] {
    if (a === null || b === null) return [this.idx(a), this.idx(b)];
    if (Math.round(a) === Math.round(b) && a !== b) return [fmt1(a), fmt1(b)];
    return [this.idx(a), this.idx(b)];
  }

  private setAdd(id: string, s: AddState): void { this.addState.update(m => ({ ...m, [id]: s })); }

  private async load(token: string): Promise<void> {
    const ticket = ++this.ticket;
    this.phase.set('loading');
    this.progress.set({ done: 0, total: 0 });
    this.table.set(null);
    this.analysisState.set(null);
    this.stage2.set(false);
    if (!token) return;
    let menu: MenuData;
    try {
      const [m] = await Promise.all([this.saas.menu(), this.data.ensureDrinks()]);
      menu = m;
    } catch {
      if (ticket === this.ticket) this.phase.set('error');
      return;
    }
    if (ticket !== this.ticket) return;
    this.menu.set(menu);
    this.addState.set({});
    this.added.set(0);

    const dishes = this.dishes();
    const key = dishes.map(d => d.id).join('|');
    let table = MEMO.get(key);
    if (!table || !tableMatches(table, dishes)) {
      table = newScoreTable(dishes, this.data.params);
      MEMO.set(key, table);
      while (MEMO.size > 4) MEMO.delete(MEMO.keys().next().value as string);
    }
    // ~400 напитков × до 80 блюд: порции по ≤ 12 мс вне зоны Angular (уступка потока не запускает проверку всего
    // приложения), прогресс — не чаще раза в 150 мс; потом анализ отдельной задачей, потом отрисовка.
    const full = table;
    const ok = await this.zone.runOutsideAngular(() => this.fillChunked(full, dishes, ticket));
    if (!ok) return;
    await yieldToMain();
    if (ticket !== this.ticket) return;
    const a = analyzeMenu(dishes, this.list(), this.data.guestPool(), this.data.params, this.data.classics, { table: full });
    await yieldToMain();
    if (ticket !== this.ticket) return;
    this.zone.run(() => {
      this.table.set(full);
      this.analysisState.set(a);
      this.phase.set('ready');
    });
    await nextPaint();
    if (ticket === this.ticket) this.zone.run(() => this.stage2.set(true));
  }

  private async fillChunked(table: ScoreTable, dishes: DishProfile[], ticket: number): Promise<boolean> {
    const pool = [...this.data.guestPool(), ...this.list()];
    const todo = pool.filter(p => !table.rows.has(p.id));
    const base = pool.length - todo.length;
    this.progress.set({ done: base, total: pool.length });
    let i = 0, shown = now();
    while (i < todo.length) {
      await yieldToMain();
      if (ticket !== this.ticket) return false;
      const t0 = now();
      while (i < todo.length && now() - t0 < 12) {
        fillScores(table, [todo[i]], dishes, this.data.params, this.data.classics);
        i++;
      }
      if (now() - shown > 150 || i === todo.length) { shown = now(); this.progress.set({ done: base + i, total: pool.length }); }
    }
    return true;
  }
}

function lcFirst(s: string): string {
  return s.length > 1 && s[1] === s[1].toLowerCase() ? s[0].toLowerCase() + s.slice(1) : s;
}
function capFirst(s: string): string { return s ? s[0].toUpperCase() + s.slice(1) : s; }
function fmt1(x: number): string { return (Math.round(x * 10) / 10).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }

/** Цена из каталога, если собрана: розница (диапазон и объём) или цена в заведениях; «≈» — оценка. Ничего не придумываем. */
function priceText(d: DrinkV2): string | null {
  const p = d.price_kzt;
  if (!p) return null;
  const n = (x: number) => x.toLocaleString('ru-RU');
  const est = p.is_estimate ? '≈ ' : '';
  if (typeof p.retail_min === 'number') {
    const max = typeof p.retail_max === 'number' ? p.retail_max : p.retail_min;
    return `розница ${est}${max !== p.retail_min ? `${n(p.retail_min)}–${n(max)}` : n(p.retail_min)} ₸${p.unit_ml ? ` / ${p.unit_ml} мл` : ''}`;
  }
  if (typeof p.horeca === 'number') return `в заведениях ${est}${n(p.horeca)} ₸`;
  return null;
}

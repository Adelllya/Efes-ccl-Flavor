import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nKey, I18nService } from '../../core/i18n.service';
import { cuisineLabel } from '../../core/cuisines-v2';
import { DishPhotoComponent } from '../../ui/dish-photo.component';
import { DrinkArtComponent, DrinkArtDrink } from '../../ui/drink-art.component';
import { ScoreRingComponent } from '../../ui/score-ring.component';

/* ── форма data/insights_v2.json (scripts/build_insights_v2.py) — только то, что читает страница ── */
type Status = 'leads' | 'tie' | 'close' | 'behind';
type Group = 'beer' | 'wine' | 'strong' | 'other';
interface Pick { id: string | null; score: number; category: string | null; archetype: string | null; efes?: boolean }
interface DishRow {
  id: string; name: string; cuisine: string[]; category: string | null; emoji: string | null; is_dessert: boolean;
  best: Pick; best_efes: Pick; gap: number; efes_rank: number; n_at_top: number; status: Status;
  beer: { id: string | null; score: number; archetype: string | null; gap: number; status: Status }; top3: Pick[];
}
interface StatusCounts { leads: number; tie: number; close: number; behind: number }
interface CuisineRow extends StatusCounts { id: string; n: number; covered: number; beer_covered: number; mean_gap: number }
interface SkuRow { id: string; name: string; category: string; archetype: string; relation: string; best_efes_for: number; leads_for: number; top3_for: number; mean_score: number; best_efes_dishes: string[] }
interface CompRow { category: string; group: Group; n: number; tie: number; close: number; behind: number; archetypes: { archetype: string; n: number; label_ru: string }[]; dishes: string[] }
interface GapRow {
  archetype: string; label_ru: string; category: string; abv: number | null; realistic: boolean; proposed: boolean; in_portfolio: string[];
  dishes_gained: number; gained_leads: number; gained_tie: number; avg_gap_reduction: number;
  dishes: { id: string; score: number; was: Status; now: Status; old_gap: number; new_gap: number }[];
}
interface MapDrink { id: string; name: string; category: string; group: Group; archetype: string | null; efes: boolean; abv: number; x: number; y: number; pool: number }
interface Insights {
  meta: {
    engine_version: string; params_version: string | null; calibration: { version?: string; fitted_at?: string } | null; calibration_applied: boolean;
    generated_at: string; tie_window: number; close_max: number; counts: Record<string, number>; caveats_ru: string[]; method_ru: string[];
  };
  headline: { dishes: number; leads: number; tie: number; close: number; behind: number; covered: number; beer_covered: number; beer_leads: number; meal_covered: number; mean_gap: number; mean_best_score: number; mean_best_efes_score: number };
  dishes: DishRow[];
  aggregates: { by_status: StatusCounts; by_status_beer: StatusCounts; by_cuisine: CuisineRow[]; efes_skus: SkuRow[]; competitors: CompRow[]; competitor_groups: { group: Group; n: number }[] };
  gaps: { realistic: GapRow[]; beyond_brewing: GapRow[]; n_candidates: number };
  meal: { by_status: StatusCounts; mean_gap: number };
  map: { axes: string[]; explained: [number, number]; directions: { pc1: { pos: string[]; neg: string[] }; pc2: { pos: string[]; neg: string[] } }; bounds_robust: { x: [number, number]; y: [number, number] }; n_outside_robust: number; drinks: MapDrink[] };
  pool: string[];
  scores: Record<string, string>;
}
interface Point { d: MapDrink; px: number; py: number; fill: string; dim: boolean; clamped: boolean; score: number | null }

const STATUSES: readonly Status[] = ['leads', 'tie', 'close', 'behind'];
const GROUPS: readonly Group[] = ['beer', 'wine', 'strong', 'other'];
const TOP_CUISINES = 12;
const PAD = 26;

/**
 * «Радар портфеля Efes» — бизнес-аналитика из честного движка v2 для жюри и команды Efes: где Efes лучший выбор,
 * кому уходят блюда, какой стиль добавить (контрфактуал) и карта вкусов всех напитков (PCA). Данные — data/insights_v2.json,
 * подгружаются динамически (страница не утяжеляет основной бандл). Цвета графиков — из проверенной палитры
 * (см. комментарий к стилям), статусы всегда подписаны, у каждого графика есть табличный вид.
 */
@Component({
  selector: 'ft-insights',
  standalone: true,
  imports: [RouterLink, DishPhotoComponent, DrinkArtComponent, ScoreRingComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="ins">
      <header class="hero">
        <span class="eyebrow">{{ t('ins.eyebrow') }}</span>
        <h1>{{ t('ins.h1') }}</h1>
        <p class="lede mt12">{{ t('ins.lede', { w: data()?.meta?.tie_window ?? 2 }) }}</p>
      </header>

      @if (error()) { <p class="card card-p mt24 muted">{{ error() }}</p> }
      @if (data(); as D) {
        <!-- ── главные цифры ── -->
        <section class="kpi reveal">
          <div class="hero-fig card gilded card-p">
            <div class="hf"><b class="num">{{ D.headline.covered }}</b><span class="of">{{ t('ins.hero.of', { n: D.headline.dishes }) }}</span></div>
            <p class="hf-l">{{ t('ins.hero.covered') }}</p>
            <ul class="hf-sub">
              <li>{{ t('ins.hero.beer', { n: D.headline.beer_covered }) }}</li>
              <li>{{ t('ins.hero.meal', { n: D.headline.meal_covered }) }}</li>
              <li>{{ t('ins.hero.gap', { n: fmt(D.headline.mean_gap) }) }}</li>
            </ul>
          </div>
          <div class="tiles">
            @for (s of statuses; track s) {
              <div class="tile"><i class="sw" [attr.data-s]="s"></i><b class="num">{{ D.aggregates.by_status[s] }}</b><span>{{ t(statusKey(s)) }}</span></div>
            }
          </div>
        </section>

        <!-- ── статус по блюдам: сегментная полоса + unit chart ── -->
        <section class="section" id="status">
          <div class="section-head"><div><span class="eyebrow">01</span><h2>{{ t('ins.s.status') }}</h2><p>{{ t('ins.s.status.sub', { n: D.headline.dishes }) }}</p></div></div>
          <div class="seg" role="img" [attr.aria-label]="segAria()">
            @for (s of segments(); track s.status) { <i [attr.data-s]="s.status" [style.flex]="s.n" [title]="t(statusKey(s.status)) + ' · ' + s.n"></i> }
          </div>
          <ul class="legend mt12" [attr.aria-label]="t('ins.status.legend')">
            @for (s of statuses; track s) { <li><i class="sw" [attr.data-s]="s"></i>{{ t(statusKey(s)) }} <b class="num">{{ D.aggregates.by_status[s] }}</b></li> }
          </ul>
          <div class="status-grid mt16">
            <div class="units" role="listbox" [attr.aria-label]="t('ins.s.status')">
              @for (d of D.dishes; track d.id) {
                <button type="button" class="u" role="option" [attr.data-s]="d.status" [attr.aria-selected]="selDish() === d.id" [class.on]="selDish() === d.id"
                        (click)="selDish.set(d.id)" [title]="dishName(d.id) + ' · ' + t(statusKey(d.status))"><span class="sr-only">{{ dishName(d.id) }} — {{ t(statusKey(d.status)) }}</span></button>
              }
            </div>
            @if (sel(); as d) {
              <div class="detail card card-p pop">
                <div class="dh">
                  <ft-dish-photo [dishId]="d.id" [emoji]="d.emoji || '🍽️'" [name]="d.name" variant="square" />
                  <div class="dt">
                    <span class="badge st" [attr.data-s]="d.status">{{ t(statusKey(d.status)) }}</span>
                    <h3>{{ dishName(d.id) }}</h3>
                    <p class="muted sm">{{ cuisineList(d.cuisine) }}@if (d.category) { · {{ i18n.category(d.category) }}}</p>
                  </div>
                </div>
                <div class="vs">
                  <div class="side">
                    <span class="lbl">{{ t('ins.detail.bestEfes') }}</span>
                    @if (d.best_efes.id; as id) {
                      <a class="drink" [routerLink]="['/drinks', id]">
                        <ft-drink-art [drink]="art(id)" [size]="58" />
                        <div class="dn"><b>{{ drinkName(id) }}</b><span class="muted xs">{{ catLabel(d.best_efes.category) }}</span></div>
                        <ft-score [score]="d.best_efes.score" [size]="46" [stroke]="5" />
                      </a>
                    }
                  </div>
                  <div class="side">
                    <span class="lbl">{{ t('ins.detail.best') }}</span>
                    @if (d.best.id; as id) {
                      <a class="drink" [routerLink]="['/drinks', id]">
                        <ft-drink-art [drink]="art(id)" [size]="58" />
                        <div class="dn"><b>{{ drinkName(id) }}</b><span class="muted xs">{{ catLabel(d.best.category) }}@if (d.best.efes) { · Efes}</span></div>
                        <ft-score [score]="d.best.score" [size]="46" [stroke]="5" />
                      </a>
                    }
                  </div>
                </div>
                <p class="sm dim">
                  {{ t('ins.detail.gap', { n: d.gap }) }} · {{ t('ins.detail.rank', { n: d.efes_rank, m: D.pool.length }) }}
                  @if (d.beer.id && d.beer.id !== d.best_efes.id) { · {{ t('ins.detail.beer', { name: drinkName(d.beer.id), score: d.beer.score }) }} }
                </p>
                <a class="btn btn-secondary btn-sm" [routerLink]="['/pair', d.id]">{{ t('ins.detail.open') }} →</a>
              </div>
            }
          </div>
          <details class="tbl mt16">
            <summary>{{ t('ins.map.table') }} · {{ D.headline.dishes }}</summary>
            <table>
              <thead><tr><th>{{ t('ins.table.dish') }}</th><th>{{ t('ins.status.legend') }}</th><th>{{ t('ins.detail.bestEfes') }}</th><th class="r">{{ t('ins.table.score') }}</th><th>{{ t('ins.detail.best') }}</th><th class="r">{{ t('ins.table.score') }}</th></tr></thead>
              <tbody>
                @for (d of D.dishes; track d.id) {
                  <tr><td><a [routerLink]="['/pair', d.id]">{{ dishName(d.id) }}</a></td><td>{{ t(statusKey(d.status)) }}</td><td>{{ drinkName(d.best_efes.id) }}</td><td class="r num">{{ d.best_efes.score }}</td><td>{{ drinkName(d.best.id) }}</td><td class="r num">{{ d.best.score }}</td></tr>
                }
              </tbody>
            </table>
          </details>
        </section>

        <!-- ── кто несёт портфель (SKU) ── -->
        <section class="section" id="sku">
          <div class="section-head"><div><span class="eyebrow">02</span><h2>{{ t('ins.s.sku') }}</h2><p>{{ t('ins.s.sku.sub') }}</p></div></div>
          <ol class="bars">
            @for (s of skus(); track s.id) {
              <li>
                <a class="bl" [routerLink]="['/drinks', s.id]"><ft-drink-art [drink]="art(s.id)" [size]="30" /><span class="ellipsis">{{ s.name }}</span></a>
                <div class="bar-t"><i class="bar-f gold" [style.width.%]="pctOf(s.best_efes_for, maxSku())"></i><b class="num">{{ s.best_efes_for }}</b></div>
                <span class="bs muted xs">{{ t('ins.sku.leads', { n: s.leads_for }) }} · {{ catLabel(s.category) }}</span>
              </li>
            }
          </ol>
        </section>

        <!-- ── по кухням: малые кратные ── -->
        <section class="section" id="cuisine">
          <div class="section-head"><div><span class="eyebrow">03</span><h2>{{ t('ins.s.cuisine') }}</h2><p>{{ t('ins.s.cuisine.sub') }}</p></div></div>
          <ul class="cuis">
            @for (c of cuisines(); track c.id) {
              <li>
                <div class="ch"><span class="cn ellipsis">{{ c.label }}</span><span class="cv"><b class="num">{{ c.covered }}</b><span class="muted"> / {{ c.n }}</span></span></div>
                <div class="seg sm" role="img" [attr.aria-label]="c.label + ': ' + t('ins.cuisine.covered', { k: c.covered, n: c.n })">
                  @for (s of statuses; track s) { @if (c[s] > 0) { <i [attr.data-s]="s" [style.flex]="c[s]" [title]="t(statusKey(s)) + ' · ' + c[s]"></i> } }
                </div>
              </li>
            }
          </ul>
          <details class="tbl mt16">
            <summary>{{ t('ins.map.table') }}</summary>
            <table>
              <thead><tr><th>{{ t('ins.s.cuisine') }}</th><th class="r">n</th>@for (s of statuses; track s) { <th class="r">{{ t(statusKey(s)) }}</th> }<th class="r">{{ t('ins.table.gap') }}</th></tr></thead>
              <tbody>@for (c of D.aggregates.by_cuisine; track c.id) { <tr><td>{{ cuisine(c.id) }}</td><td class="r num">{{ c.n }}</td>@for (s of statuses; track s) { <td class="r num">{{ c[s] }}</td> }<td class="r num">{{ fmt(c.mean_gap) }}</td></tr> }</tbody>
            </table>
          </details>
        </section>

        <!-- ── кому уходят блюда ── -->
        <section class="section" id="competitors">
          <div class="section-head"><div><span class="eyebrow">04</span><h2>{{ t('ins.s.comp') }}</h2><p>{{ t('ins.s.comp.sub', { n: D.headline.dishes - D.headline.leads }) }}</p></div></div>
          <ul class="legend mb12">@for (g of groups; track g) { <li><i class="sw" [attr.data-g]="g"></i>{{ t(groupKey(g)) }}</li> }</ul>
          <ol class="bars comp">
            @for (c of D.aggregates.competitors; track c.category) {
              <li>
                <span class="bl ellipsis">{{ catLabel(c.category) }}</span>
                <div class="bar-t"><i class="bar-f" [attr.data-g]="c.group" [style.width.%]="pctOf(c.n, maxComp())"></i><b class="num">{{ c.n }}</b></div>
                <span class="bs muted xs">{{ t('ins.comp.top') }} {{ archList(c.archetypes) }}</span>
              </li>
            }
          </ol>
        </section>

        <!-- ── какой стиль добавить (контрфактуал) ── -->
        <section class="section" id="gaps">
          <div class="section-head"><div><span class="eyebrow">05</span><h2>{{ t('ins.s.gaps') }}</h2><p>{{ t('ins.s.gaps.sub') }}</p></div></div>
          <ol class="gaps">
            @for (g of D.gaps.realistic.slice(0, 8); track g.archetype; let i = $index) {
              <li class="card card-p">
                <div class="gh">
                  <span class="rank num">{{ i + 1 }}</span>
                  <div class="gt">
                    <div class="flex ac g8 wrap"><h3>{{ g.label_ru }}</h3><span class="badge badge-violet">{{ t('ins.gaps.badge') }}</span>
                      @if (g.in_portfolio.length) { <span class="badge">{{ t('ins.gaps.inPortfolio') }}</span> } @if (g.proposed) { <span class="badge badge-info">{{ t('ins.gaps.proposed') }}</span> }</div>
                    <p class="muted xs">{{ t('ins.gaps.hyp', { style: g.label_ru }) }} · {{ catLabel(g.category) }}@if (g.abv !== null) { · {{ fmt(g.abv) }} %}</p>
                  </div>
                  <div class="gn"><b class="num">+{{ g.dishes_gained }}</b><span class="xs muted">{{ t('ins.gaps.split', { a: g.gained_leads, b: g.gained_tie }) }}</span></div>
                </div>
                <div class="chips">
                  @for (x of g.dishes; track x.id) { <a class="chip chip-sm" [routerLink]="['/pair', x.id]" [title]="t(statusKey(x.was)) + ' → ' + t(statusKey(x.now)) + ' · ' + x.score">{{ dishName(x.id) }} <b class="num">{{ x.score }}</b></a> }
                </div>
                <p class="xs muted mt8">{{ t('ins.gaps.avg', { n: fmt(g.avg_gap_reduction) }) }}</p>
              </li>
            }
          </ol>
          <div class="mt24">
            <button type="button" class="btn btn-ghost btn-sm" (click)="showBeyond.set(!showBeyond())" [attr.aria-expanded]="showBeyond()">{{ showBeyond() ? t('ins.gaps.hide') : t('ins.gaps.show') }}: {{ t('ins.gaps.beyond') }}</button>
            @if (showBeyond()) {
              <p class="muted sm mt8">{{ t('ins.gaps.beyond.sub') }}</p>
              <ol class="gaps mt12">
                @for (g of D.gaps.beyond_brewing.slice(0, 5); track g.archetype; let i = $index) {
                  <li class="card card-p">
                    <div class="gh">
                      <span class="rank num">{{ i + 1 }}</span>
                      <div class="gt"><div class="flex ac g8 wrap"><h3>{{ g.label_ru }}</h3><span class="badge badge-violet">{{ t('ins.gaps.badge') }}</span></div><p class="muted xs">{{ catLabel(g.category) }}</p></div>
                      <div class="gn"><b class="num">+{{ g.dishes_gained }}</b><span class="xs muted">{{ t('ins.gaps.split', { a: g.gained_leads, b: g.gained_tie }) }}</span></div>
                    </div>
                    <div class="chips">@for (x of g.dishes; track x.id) { <a class="chip chip-sm" [routerLink]="['/pair', x.id]">{{ dishName(x.id) }} <b class="num">{{ x.score }}</b></a> }</div>
                  </li>
                }
              </ol>
            }
          </div>
        </section>

        <!-- ── карта вкусов ── -->
        <section class="section" id="map">
          <div class="section-head"><div><span class="eyebrow">06</span><h2>{{ t('ins.s.map') }}</h2><p>{{ t('ins.s.map.sub', { n: D.map.drinks.length, axes: D.map.axes.length }) }}</p></div></div>
          <div class="ctl">
            <label class="sel"><span class="lbl">{{ t('ins.map.select') }}</span>
              <select class="input" [value]="mapDish()" (change)="mapDish.set($any($event.target).value)">
                <option value="">{{ t('ins.map.none') }}</option>
                @for (grp of dishOptions(); track grp.id) { <optgroup [label]="grp.label">@for (d of grp.dishes; track d.id) { <option [value]="d.id">{{ d.name }}</option> }</optgroup> }
              </select>
            </label>
            <ul class="legend">
              @if (!mapDish()) {
                @for (g of groups; track g) { <li><i class="sw dot" [attr.data-g]="g"></i>{{ t(groupKey(g)) }}</li> }
              } @else {
                <li class="ramp"><span>{{ t('ins.map.low') }}</span>@for (q of [1,2,3,4,5]; track q) { <i class="sw" [attr.data-q]="q"></i> }<span>{{ t('ins.map.high') }}</span></li>
              }
              <li><i class="sw ring"></i>{{ t('ins.map.efes') }}</li>
            </ul>
          </div>
          <a class="sr-only" href="#map-after">{{ t('ins.map.skip') }}</a>
          <div class="map-wrap" #mapWrap>
            <svg class="map" [attr.viewBox]="'0 0 ' + W() + ' ' + H()" [attr.width]="W()" [attr.height]="H()" role="group" [attr.aria-label]="t('ins.s.map')">
              <rect class="plot" x="0" y="0" [attr.width]="W()" [attr.height]="H()" rx="16" />
              <line class="ax" [attr.x1]="PAD" [attr.x2]="W() - PAD" [attr.y1]="H() - PAD" [attr.y2]="H() - PAD" />
              <line class="ax" [attr.x1]="PAD" [attr.x2]="PAD" [attr.y1]="PAD" [attr.y2]="H() - PAD" />
              <text class="axl" [attr.x]="W() - PAD" [attr.y]="H() - 8" text-anchor="end">{{ axisLabel('pc1', 'pos') }} →</text>
              <text class="axl" [attr.x]="PAD" [attr.y]="H() - 8" text-anchor="start">← {{ axisLabel('pc1', 'neg') }}</text>
              <text class="axl" [attr.x]="14" [attr.y]="PAD" text-anchor="end" [attr.transform]="'rotate(-90 14 ' + PAD + ')'">{{ axisLabel('pc2', 'pos') }} →</text>
              <text class="axl" [attr.x]="14" [attr.y]="H() - PAD" text-anchor="start" [attr.transform]="'rotate(-90 14 ' + (H() - PAD) + ')'">← {{ axisLabel('pc2', 'neg') }}</text>
              @for (p of points(); track p.d.id) {
                <g class="pt" [class.dim]="p.dim" [class.efes]="p.d.efes" [class.on]="mapSel() === p.d.id" [class.hov]="hover() === p.d.id"
                   (pointerenter)="hover.set(p.d.id)" (pointerleave)="hover.set(null)" (click)="mapSel.set(mapSel() === p.d.id ? null : p.d.id)"
                   (keydown.enter)="mapSel.set(p.d.id)" (focus)="hover.set(p.d.id)" (blur)="hover.set(null)" tabindex="0" role="button" [attr.aria-label]="ptAria(p)">
                  <circle class="hit" [attr.cx]="p.px" [attr.cy]="p.py" r="12" />
                  @if (p.d.efes) { <circle class="ring" [attr.cx]="p.px" [attr.cy]="p.py" r="7.5" /> }
                  <circle class="dot" [attr.cx]="p.px" [attr.cy]="p.py" [attr.r]="p.d.efes ? 4.5 : 4" [attr.fill]="p.fill" />
                  @if (p.clamped) { <path class="clamp" [attr.d]="'M' + (p.px - 3) + ' ' + (p.py + 8) + ' l3 -4 l3 4 z'" /> }
                </g>
              }
              @if (tip(); as tp) {
                <g class="tip" [attr.transform]="'translate(' + tp.x + ' ' + tp.y + ')'" pointer-events="none">
                  <rect x="0" y="0" [attr.width]="tp.w" height="42" rx="8" />
                  <text x="10" y="17" class="t1">{{ tp.name }}</text>
                  <text x="10" y="33" class="t2">{{ tp.sub }}</text>
                </g>
              }
            </svg>
          </div>
          <p class="xs muted mt8" id="map-after">{{ t('ins.map.explained', { a: pct100(D.map.explained[0]), b: pct100(D.map.explained[1]) }) }} · {{ t('ins.map.clamped', { n: D.map.n_outside_robust }) }} · {{ t('ins.map.hint') }}</p>

          <div class="map-side mt16">
            @if (selDrink(); as m) {
              <div class="card card-p pop mcard">
                <ft-drink-art [drink]="art(m.id)" [size]="72" [glow]="true" />
                <div class="grow">
                  <div class="flex ac g8 wrap"><h3>{{ m.name }}</h3>@if (m.efes) { <span class="badge">Efes</span> }</div>
                  <p class="muted sm">{{ catLabel(m.category) }}@if (m.archetype) { · {{ archLabel(m.archetype) }}} · {{ fmt(m.abv) }} %</p>
                  @if (mapDish()) {
                    @if (scoreOf(m.id); as sc) { <p class="sm mt8">{{ t('ins.map.score', { dish: dishName(mapDish()) }) }}: <b class="num lg">{{ sc }}</b></p> }
                    @else { <p class="sm muted mt8">{{ t('ins.map.notInPool') }}</p> }
                  }
                  <a class="btn btn-secondary btn-sm mt12" [routerLink]="['/drinks', m.id]">{{ t('ins.map.open') }} →</a>
                </div>
              </div>
            }
            @if (mapDish()) {
              <div class="card card-p">
                <h4>{{ t('ins.map.top') }}: {{ dishName(mapDish()) }}</h4>
                <ol class="top">
                  @for (r of topForDish(); track r.id; let i = $index) {
                    <li [class.efes]="r.efes"><span class="num muted">{{ i + 1 }}</span><a [routerLink]="['/drinks', r.id]" class="ellipsis">{{ r.name }}</a><span class="xs muted ellipsis">{{ catLabel(r.category) }}@if (r.efes) { · Efes}</span><b class="num">{{ r.score }}</b></li>
                  }
                </ol>
              </div>
            }
          </div>
          <details class="tbl mt16">
            <summary>{{ t('ins.map.table') }} · {{ D.map.drinks.length }}</summary>
            <table>
              <thead><tr><th>{{ t('ins.table.drink') }}</th><th>{{ t('ins.table.cat') }}</th><th>Efes</th><th class="r">x</th><th class="r">y</th>@if (mapDish()) { <th class="r">{{ t('ins.table.score') }}</th> }</tr></thead>
              <tbody>@for (m of D.map.drinks; track m.id) { <tr><td><a [routerLink]="['/drinks', m.id]">{{ m.name }}</a></td><td>{{ catLabel(m.category) }}</td><td>{{ m.efes ? '●' : '' }}</td><td class="r num">{{ m.x }}</td><td class="r num">{{ m.y }}</td>@if (mapDish()) { <td class="r num">{{ scoreOf(m.id) ?? '—' }}</td> }</tr> }</tbody>
            </table>
          </details>
        </section>

        <!-- ── метод и оговорки ── -->
        <section class="section" id="method">
          <div class="section-head"><div><span class="eyebrow">07</span><h2>{{ t('ins.s.method') }}</h2></div></div>
          @if (!ru()) { <p class="muted sm mb12">{{ t('ins.ruOnly') }}</p> }
          <div class="grid grid-2">
            <div class="card card-p"><h4 class="mb8">{{ t('ins.method.title') }}</h4><ol class="ladder">@for (m of D.meta.method_ru; track $index) { <li>{{ m }}</li> }</ol></div>
            <div class="card card-p"><h4 class="mb8">{{ t('ins.caveats.title') }}</h4><ul class="limits">@for (c of D.meta.caveats_ru; track $index) { <li>{{ c }}</li> }</ul></div>
          </div>
          <p class="xs muted mt16">{{ t('ins.meta', { engine: D.meta.engine_version, cal: D.meta.calibration_applied ? t('ins.cal.applied', { v: D.meta.calibration?.version ?? '' }) : t('ins.cal.none'), date: D.meta.generated_at.slice(0, 10) }) }}
            · {{ t('ins.meta.pool', { a: D.meta.counts['drinks_pool'], b: D.meta.counts['drinks_catalog'] }) }} · {{ t('ins.meta.efes', { n: D.meta.counts['efes_in_pool'] }) }} · {{ t('ins.meta.dishes', { n: D.meta.counts['dishes'] }) }} · {{ t('ins.meta.styles', { n: D.gaps.n_candidates }) }}</p>
          <div class="links"><a class="btn btn-secondary" routerLink="/method">{{ t('method.h1') }}</a><a class="btn btn-secondary" routerLink="/pair">{{ t('method.links.pair') }}</a></div>
        </section>
      } @else if (!error()) {
        <div class="mt24 grid grid-2"><div class="skeleton" style="height: 160px"></div><div class="skeleton" style="height: 160px"></div></div>
      }
    </article>
  `,
  styles: [`
    /* Цвета графиков — проверены scripts/validate_palette.js (skill dataviz) на поверхностях темы:
       статусы — ординальная золотая шкала (dark #F7E8C0→#E5B849→#9D6F22; light #D9A93C→#9D6F22→#5A3D10) + нейтральный «отстаёт»;
       группы карты — blue / orange / aqua (all-pairs PASS в обеих темах) + нейтральный «прочее»; золото — только кольцо Efes;
       балл к блюду — одна синяя последовательная шкала (в тёмной теме светлее = выше). */
    :host {
      display: block;
      --s-leads: #F7E8C0; --s-tie: #E5B849; --s-close: #9D6F22; --s-behind: var(--ink-4);
      --g-beer: #3987e5; --g-wine: #d95926; --g-strong: #199e70; --g-other: #898781;
      --q5: #9ec5f4; --q4: #6da7ec; --q3: #3987e5; --q2: #256abf; --q1: #184f95;
      --ring: #E5B849; --plot-bg: var(--surface); --grid: var(--line);
    }
    :host-context([data-theme="light"]) {
      --s-leads: #D9A93C; --s-tie: #9D6F22; --s-close: #5A3D10;
      --g-beer: #2a78d6; --g-wine: #eb6834; --g-strong: #1baf7a;
      --q5: #0d366b; --q4: #1c5cab; --q3: #2a78d6; --q2: #5598e7; --q1: #86b6ef; --ring: #8A6118;
    }
    @media (prefers-color-scheme: light) {
      :host-context(:root:not([data-theme="dark"])) {
        --s-leads: #D9A93C; --s-tie: #9D6F22; --s-close: #5A3D10;
        --g-beer: #2a78d6; --g-wine: #eb6834; --g-strong: #1baf7a;
        --q5: #0d366b; --q4: #1c5cab; --q3: #2a78d6; --q2: #5598e7; --q1: #86b6ef; --ring: #8A6118;
      }
    }
    [data-s="leads"] { --c: var(--s-leads); } [data-s="tie"] { --c: var(--s-tie); } [data-s="close"] { --c: var(--s-close); } [data-s="behind"] { --c: var(--s-behind); }
    [data-g="beer"] { --c: var(--g-beer); } [data-g="wine"] { --c: var(--g-wine); } [data-g="strong"] { --c: var(--g-strong); } [data-g="other"] { --c: var(--g-other); }
    [data-q="1"] { --c: var(--q1); } [data-q="2"] { --c: var(--q2); } [data-q="3"] { --c: var(--q3); } [data-q="4"] { --c: var(--q4); } [data-q="5"] { --c: var(--q5); }

    .ins { padding-top: 4px; }
    .hero { max-width: 760px; }
    .hero h1 { margin-top: 8px; }
    .kpi { display: grid; gap: 14px; margin-top: 28px; }
    @media (min-width: 900px) { .kpi { grid-template-columns: minmax(300px, 1.1fr) 1.4fr; gap: 18px; margin-top: 36px; } }
    .hero-fig { display: grid; align-content: start; gap: 6px; }
    .hf { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
    .hf b { font-size: clamp(3.6rem, 9vw, 5.4rem); line-height: .95; color: var(--amber-700); font-variant-numeric: lining-nums proportional-nums; letter-spacing: -.03em; }
    .hf .of { font-family: var(--font-display); font-size: 1.3rem; color: var(--ink-2); }
    .hf-l { color: var(--ink); font-weight: 600; }
    .hf-sub { list-style: none; padding: 0; display: grid; gap: 3px; color: var(--ink-3); font-size: .85rem; margin-top: 6px; }
    .hf-sub li::before { content: '· '; color: var(--gold); }
    .tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    @media (min-width: 560px) { .tiles { grid-template-columns: repeat(4, 1fr); } }
    @media (min-width: 900px) { .tiles { grid-template-columns: repeat(2, 1fr); } }
    .tile { display: grid; gap: 2px; padding: 14px 16px; border-radius: var(--r-md); background: var(--grad-amber-soft), var(--surface); border: 1px solid var(--line); align-content: start; }
    .tile b { font-size: 2.3rem; line-height: 1; color: var(--ink); font-variant-numeric: lining-nums proportional-nums; }
    .tile span { font-size: .78rem; color: var(--ink-3); }
    .sw { display: inline-block; width: 12px; height: 12px; border-radius: 3px; background: var(--c, var(--ink-4)); flex-shrink: 0; }
    .sw.dot { border-radius: 50%; }
    .sw.ring { border-radius: 50%; background: transparent; box-shadow: inset 0 0 0 2.5px var(--ring); }
    .tile .sw { margin-bottom: 6px; }

    /* сегментная полоса: 2px зазор поверхности между заливками */
    .seg { display: flex; gap: 2px; height: 18px; border-radius: 6px; overflow: hidden; background: var(--surface); }
    .seg i { display: block; height: 100%; background: var(--c); min-width: 2px; }
    .seg.sm { height: 10px; }
    .legend { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: .8rem; color: var(--ink-2); }
    .legend li { display: inline-flex; align-items: center; gap: 7px; }
    .legend b { color: var(--ink); }
    .legend .ramp { gap: 3px; } .legend .ramp span { color: var(--ink-3); font-size: .72rem; margin-inline: 4px; }

    .status-grid { display: grid; gap: 16px; }
    @media (min-width: 900px) { .status-grid { grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); align-items: start; gap: 24px; } }
    .units { display: flex; flex-wrap: wrap; gap: 4px; padding: 14px; border-radius: var(--r-lg); background: var(--surface); border: 1px solid var(--line); }
    .u { width: 18px; height: 18px; border-radius: 4px; background: var(--c); border: 0; padding: 0; transition: transform var(--t-fast) var(--ease), box-shadow var(--t-fast); position: relative; }
    @media (min-width: 900px) { .u { width: 22px; height: 22px; } }
    .u:hover { transform: scale(1.18); z-index: 1; }
    .u.on { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--gold); z-index: 1; }
    .u[data-s="behind"] { opacity: .75; }
    .detail { display: grid; gap: 14px; align-content: start; }
    .dh { display: grid; grid-template-columns: 84px 1fr; gap: 14px; align-items: center; }
    .dt { display: grid; gap: 4px; min-width: 0; }
    .dt h3 { font-size: 1.5rem; }
    .badge.st { background: color-mix(in srgb, var(--c) 18%, transparent); color: var(--ink); border-color: color-mix(in srgb, var(--c) 55%, transparent); justify-self: start; }
    .vs { display: grid; gap: 10px; }
    @media (min-width: 560px) { .vs { grid-template-columns: 1fr 1fr; } }
    .side { display: grid; gap: 6px; padding: 12px; border-radius: var(--r-md); background: var(--surface-2); border: 1px solid var(--line-2); min-width: 0; }
    .lbl { font-size: .66rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-3); }
    .drink { display: grid; grid-template-columns: 44px minmax(0, 1fr) 46px; gap: 8px; align-items: center; min-width: 0; }
    .drink ft-drink-art, .drink ft-score { display: block; }
    .drink:hover b { color: var(--amber-700); }
    /* золотой текст бейджа в светлой теме: тот же токен, что и у цифр */
    .badge:not([class*='badge-']) { color: var(--amber-700); }
    .dn { display: grid; gap: 2px; min-width: 0; } .dn b { color: var(--ink); line-height: 1.25; font-size: .92rem; overflow-wrap: break-word; hyphens: auto; } .dn span { line-height: 1.3; }

    /* горизонтальные бары: ≤ 22px, скруглённый конец данных, значение у кончика */
    .bars { list-style: none; padding: 0; display: grid; gap: 12px; counter-reset: b; }
    .bars li { display: grid; grid-template-columns: 1fr; gap: 4px; }
    @media (min-width: 720px) { .bars li { grid-template-columns: 220px 1fr; grid-template-areas: 'l b' 'l s'; column-gap: 16px; align-items: center; } .bars .bl { grid-area: l; } .bars .bar-t { grid-area: b; } .bars .bs { grid-area: s; } }
    .bl { display: flex; align-items: center; gap: 8px; min-width: 0; color: var(--ink); font-weight: 600; font-size: .92rem; }
    .bar-t { display: flex; align-items: center; gap: 10px; }
    .bar-f { display: block; height: 16px; border-radius: 0 4px 4px 0; background: var(--c, var(--gold)); min-width: 3px; transition: width .6s var(--ease); }
    .bar-f.gold { background: linear-gradient(90deg, var(--gold-deep), var(--gold)); }
    .bar-t b { color: var(--ink); font-size: 1.05rem; }
    .bs { line-height: 1.35; }

    .cuis { list-style: none; padding: 0; display: grid; gap: 12px 22px; }
    @media (min-width: 640px) { .cuis { grid-template-columns: 1fr 1fr; } }
    @media (min-width: 1000px) { .cuis { grid-template-columns: repeat(3, 1fr); } }
    .cuis li { display: grid; gap: 6px; }
    .ch { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: .9rem; }
    .cn { color: var(--ink); font-weight: 600; } .cv b { color: var(--amber-700); font-size: 1.1rem; } .cv .muted { font-size: .8rem; }

    .gaps { list-style: none; padding: 0; display: grid; gap: 12px; counter-reset: g; }
    .gh { display: grid; grid-template-columns: 34px 1fr auto; gap: 10px 12px; align-items: start; }
    .rank { font-size: 1.6rem; color: var(--amber-700); line-height: 1; }
    .gt { display: grid; gap: 4px; min-width: 0; } .gt h3 { font-size: 1.35rem; }
    .gn { display: grid; justify-items: end; gap: 2px; text-align: right; } .gn b { font-size: 2rem; line-height: 1; color: var(--ink); }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
    .chip b { color: inherit; margin-left: 2px; }

    .ctl { display: grid; gap: 12px; margin-bottom: 12px; }
    @media (min-width: 900px) { .ctl { grid-template-columns: minmax(260px, 380px) 1fr; align-items: end; } }
    .sel { display: grid; gap: 6px; }
    .map-wrap { width: 100%; border-radius: var(--r-lg); overflow: hidden; border: 1px solid var(--line); background: var(--plot-bg); }
    .map { display: block; width: 100%; height: auto; touch-action: manipulation; }
    .plot { fill: var(--plot-bg); }
    .ax { stroke: var(--grid); stroke-width: 1; }
    .axl { fill: var(--ink-3); font-family: var(--font-body); font-size: 11px; letter-spacing: .02em; }
    .pt { cursor: pointer; outline: none; }
    .pt .hit { fill: transparent; }
    .pt .dot { stroke: var(--plot-bg); stroke-width: 1.5; transition: r var(--t-fast); }
    .pt .ring { fill: none; stroke: var(--ring); stroke-width: 2; }
    .pt .clamp { fill: var(--ink-3); }
    .pt.dim .dot { opacity: .28; } .pt.dim .ring { opacity: .45; }
    .pt.hov .dot, .pt.on .dot { stroke: var(--ink); stroke-width: 2; }
    .pt:focus-visible .dot { stroke: var(--gold); stroke-width: 2.5; }
    .pt.on .dot { r: 7; }
    .tip rect { fill: var(--surface-glass); stroke: var(--line); }
    .tip .t1 { fill: var(--ink); font-size: 12px; font-weight: 700; font-family: var(--font-body); }
    .tip .t2 { fill: var(--ink-3); font-size: 11px; font-family: var(--font-body); }
    .map-side { display: grid; gap: 12px; }
    @media (min-width: 900px) { .map-side { grid-template-columns: 1fr 1fr; align-items: start; } }
    .mcard { display: flex; gap: 16px; align-items: flex-start; }
    .mcard h3 { font-size: 1.4rem; }
    .top { list-style: none; padding: 0; display: grid; gap: 6px; margin-top: 10px; }
    .top li { display: grid; grid-template-columns: 22px 1fr auto auto; gap: 8px; align-items: baseline; font-size: .9rem; padding: 4px 8px; border-radius: 8px; }
    .top li.efes { background: rgba(229, 184, 73, .10); }
    .top a { color: var(--ink); font-weight: 600; } .top b { color: var(--amber-700); }

    .tbl summary { cursor: pointer; color: var(--ink-3); font-size: .85rem; font-weight: 600; }
    .tbl table { width: 100%; border-collapse: collapse; font-size: .82rem; margin-top: 10px; }
    .tbl th, .tbl td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line-2); vertical-align: top; }
    .tbl th { font-size: .66rem; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3); }
    .tbl .r { text-align: right; } .tbl a { color: var(--ink); }
    .tbl table { display: block; overflow-x: auto; }
    .ladder { padding-left: 22px; display: grid; gap: 10px; color: var(--ink-2); line-height: 1.55; font-size: .92rem; }
    .ladder li::marker { color: var(--gold); font-family: var(--font-display); font-weight: 700; }
    .limits { list-style: none; display: grid; gap: 10px; padding: 0; color: var(--ink-2); line-height: 1.55; font-size: .92rem; }
    .limits li { padding-left: 16px; position: relative; }
    .limits li::before { content: ''; position: absolute; left: 0; top: .6em; width: 6px; height: 6px; border-radius: 50%; background: var(--gold); box-shadow: 0 0 8px var(--gold); }
    .links { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 32px; padding-top: 24px; border-top: 1px solid var(--line); }
  `],
})
export class InsightsPage {
  readonly i18n = inject(I18nService);
  readonly t = this.i18n.t;
  readonly statuses = STATUSES;
  readonly groups = GROUPS;
  readonly PAD = PAD;

  readonly data = signal<Insights | null>(null);
  readonly error = signal<string | null>(null);
  readonly selDish = signal<string | null>(null);
  readonly mapDish = signal<string>('');
  readonly mapSel = signal<string | null>(null);
  readonly hover = signal<string | null>(null);
  readonly showBeyond = signal(false);
  readonly width = signal(360);
  private readonly mapWrap = viewChild<ElementRef<HTMLDivElement>>('mapWrap');
  private readonly artCache = new Map<string, DrinkArtDrink>();

  readonly ru = computed(() => this.i18n.locale() === 'ru');
  readonly dishById = computed(() => new Map((this.data()?.dishes ?? []).map(d => [d.id, d])));
  readonly drinkById = computed(() => new Map((this.data()?.map.drinks ?? []).map(m => [m.id, m])));
  readonly archLabels = computed(() => {
    const D = this.data(); const m = new Map<string, string>();
    for (const g of [...(D?.gaps.realistic ?? []), ...(D?.gaps.beyond_brewing ?? [])]) m.set(g.archetype, g.label_ru);
    for (const c of D?.aggregates.competitors ?? []) for (const a of c.archetypes) m.set(a.archetype, a.label_ru);
    return m;
  });
  readonly sel = computed(() => { const id = this.selDish(); return id ? this.dishById().get(id) ?? null : null; });
  readonly segments = computed(() => { const D = this.data(); return D ? STATUSES.map(s => ({ status: s, n: D.aggregates.by_status[s] })) : []; });
  readonly segAria = computed(() => this.segments().map(s => `${this.t(this.statusKey(s.status))}: ${s.n}`).join(', '));
  readonly skus = computed(() => (this.data()?.aggregates.efes_skus ?? []).filter(s => s.best_efes_for > 0).slice(0, 10));
  readonly maxSku = computed(() => Math.max(1, ...this.skus().map(s => s.best_efes_for)));
  readonly maxComp = computed(() => Math.max(1, ...(this.data()?.aggregates.competitors ?? []).map(c => c.n)));
  /** Топ кухонь по числу блюд + остальные одной строкой (блюдо считается в каждой своей кухне). */
  readonly cuisines = computed(() => {
    const rows = this.data()?.aggregates.by_cuisine ?? [];
    this.i18n.locale();
    const top = rows.slice(0, TOP_CUISINES).map(c => ({ ...c, label: this.cuisine(c.id) }));
    const rest = rows.slice(TOP_CUISINES);
    if (rest.length) {
      const sum = (k: keyof StatusCounts | 'n' | 'covered' | 'beer_covered') => rest.reduce((a, c) => a + c[k], 0);
      top.push({ id: '_rest', n: sum('n'), leads: sum('leads'), tie: sum('tie'), close: sum('close'), behind: sum('behind'), covered: sum('covered'), beer_covered: sum('beer_covered'), mean_gap: 0, label: this.t('ins.cuisine.other', { n: rest.length }) });
    }
    return top;
  });
  readonly dishOptions = computed(() => {
    const D = this.data(); if (!D) return [];
    this.i18n.locale();
    const groups = new Map<string, { id: string; label: string; dishes: { id: string; name: string }[] }>();
    for (const d of [...D.dishes].sort((a, b) => a.name.localeCompare(b.name, 'ru'))) {
      const c = d.cuisine[0] ?? 'international';
      const g = groups.get(c) ?? { id: c, label: this.cuisine(c), dishes: [] };
      g.dishes.push({ id: d.id, name: this.dishName(d.id) });
      groups.set(c, g);
    }
    return [...groups.values()].sort((a, b) => b.dishes.length - a.dishes.length || a.label.localeCompare(b.label, 'ru'));
  });

  // ── карта вкусов ──
  readonly W = computed(() => Math.max(300, Math.round(this.width())));
  readonly H = computed(() => { const w = this.W(); return Math.round(w < 600 ? w * 1.08 : Math.min(580, w * 0.62)); });
  /** Сколько осей называть в подписи направления: на узкой карте подписи иначе сталкиваются. */
  readonly axisN = computed(() => (this.W() < 480 ? 1 : this.W() < 760 ? 2 : 3));
  /** Баллы всех напитков пула к выбранному блюду: 2 hex-символа на напиток в порядке pool. */
  readonly dishScores = computed<number[] | null>(() => {
    const D = this.data(); const id = this.mapDish();
    const s = D && id ? D.scores[id] : undefined;
    if (!s) return null;
    const out = new Array<number>(s.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    return out;
  });
  readonly points = computed<Point[]>(() => {
    const D = this.data(); if (!D) return [];
    const W = this.W(), H = this.H(), sc = this.dishScores();
    const [x0, x1] = D.map.bounds_robust.x, [y0, y1] = D.map.bounds_robust.y;
    const px = (x: number) => PAD + 6 + (x - x0) / (x1 - x0) * (W - 2 * PAD - 12);
    const py = (y: number) => H - PAD - 6 - (y - y0) / (y1 - y0) * (H - 2 * PAD - 12);
    const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const pts: Point[] = D.map.drinks.map(d => {
      const cx = clampN(d.x, x0, x1), cy = clampN(d.y, y0, y1);
      const score = sc && d.pool >= 0 ? sc[d.pool] ?? null : null;
      const fill = sc ? (score === null ? 'var(--ink-4)' : `var(--q${this.bin(score)})`) : `var(--g-${d.group})`;
      return { d, px: Math.round(px(cx) * 10) / 10, py: Math.round(py(cy) * 10) / 10, fill, dim: !!sc && score === null, clamped: cx !== d.x || cy !== d.y, score };
    });
    // порядок отрисовки: обычные → Efes → с баллом выше → выбранный сверху
    const sel = this.mapSel();
    return pts.sort((a, b) => (a.d.id === sel ? 1 : 0) - (b.d.id === sel ? 1 : 0) || (a.d.efes ? 1 : 0) - (b.d.efes ? 1 : 0) || (a.score ?? -1) - (b.score ?? -1) || a.d.id.localeCompare(b.d.id));
  });
  readonly selDrink = computed(() => { const id = this.mapSel(); return id ? this.drinkById().get(id) ?? null : null; });
  readonly tip = computed(() => {
    const id = this.hover(); if (!id) return null;
    const p = this.points().find(q => q.d.id === id); if (!p) return null;
    const sub = `${this.catLabel(p.d.category)}${p.d.efes ? ' · Efes' : ''}${p.score !== null ? ' · ' + p.score : ''}`;
    const w = Math.min(this.W() - 16, Math.max(120, Math.round(Math.max(p.d.name.length, sub.length) * 6.6 + 24)));
    const x = p.px + 14 + w > this.W() ? p.px - 14 - w : p.px + 14;
    const y = p.py - 21 < 4 ? 4 : p.py + 21 > this.H() - 4 ? this.H() - 46 : p.py - 21;
    return { x, y, w, name: p.d.name, sub };
  });
  readonly topForDish = computed(() => {
    const D = this.data(); const sc = this.dishScores(); if (!D || !sc) return [];
    const by = this.drinkById();
    return D.pool.map((id, i) => { const m = by.get(id); return { id, score: sc[i], name: m?.name ?? id, category: m?.category ?? '', efes: !!m?.efes }; })
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 10)
      .map(r => ({ id: r.id, name: r.name, category: r.category, efes: r.efes, score: r.score }));
  });

  constructor() {
    import('../../../../../data/insights_v2.json').then(m => {
      const D = (m as unknown as { default: Insights }).default ?? (m as unknown as Insights);
      this.data.set(D);
      this.selDish.set(D.dishes.find(d => d.status === 'tie')?.id ?? D.dishes[0]?.id ?? null);
    }).catch(() => this.error.set(this.t('ins.error')));
    // ширина карты = ширина контейнера (1 единица viewBox = 1px), чтобы точки и хит-зоны были в реальных пикселях
    effect(onCleanup => {
      const el = this.mapWrap()?.nativeElement; if (!el) return;
      const ro = new ResizeObserver(entries => { const w = entries[0]?.contentRect.width; if (w) this.width.set(w); });
      ro.observe(el);
      onCleanup(() => ro.disconnect());
    });
  }

  statusKey(s: Status): I18nKey { return `ins.status.${s}` as I18nKey; }
  groupKey(g: Group): I18nKey { return `ins.group.${g}` as I18nKey; }
  catLabel(c: string | null): string { return c ? this.t(`v2.cat.${c}` as I18nKey) : ''; }
  cuisine(id: string): string { return cuisineLabel(id, this.i18n.locale()); }
  cuisineList(ids: string[]): string { return ids.map(c => this.cuisine(c)).join(', '); }
  dishName(id: string): string { return this.i18n.dishNameById(id, this.dishById().get(id)?.name ?? id); }
  drinkName(id: string | null): string { return id ? this.drinkById().get(id)?.name ?? id : '—'; }
  archLabel(a: string): string { return this.archLabels().get(a) ?? a; }
  archList(items: { archetype: string; n: number; label_ru: string }[]): string { return items.slice(0, 3).map(a => `${a.label_ru} ×${a.n}`).join(', '); }
  art(id: string): DrinkArtDrink {
    let a = this.artCache.get(id);
    if (!a) { const m = this.drinkById().get(id); a = { id, category: m?.category ?? 'beer', archetype: m?.archetype ?? null, name: m?.name ?? id }; this.artCache.set(id, a); }
    return a;
  }
  scoreOf(id: string): number | null { const sc = this.dishScores(); const m = this.drinkById().get(id); return sc && m && m.pool >= 0 ? sc[m.pool] ?? null : null; }
  pctOf(n: number, max: number): number { return Math.max(2, Math.round(n / max * 1000) / 10); }
  pct100(x: number): number { return Math.round(x * 100); }
  fmt(x: number): string { const r = Math.round(x * 10) / 10; return Number.isInteger(r) ? String(r) : r.toFixed(1); }
  axisLabel(pc: 'pc1' | 'pc2', side: 'pos' | 'neg'): string {
    const D = this.data(); if (!D) return '';
    return D.map.directions[pc][side].slice(0, this.axisN()).map(a => this.t(`ins.axis.${a}` as I18nKey)).join(' · ');
  }
  ptAria(p: Point): string { return `${p.d.name} · ${this.catLabel(p.d.category)}${p.d.efes ? ' · Efes' : ''}${p.score !== null ? ' · ' + p.score : ''}`; }
  /** Бины балла для последовательной шкалы: 1 — ниже 55, 5 — 85 и выше. */
  private bin(s: number): 1 | 2 | 3 | 4 | 5 { return s >= 85 ? 5 : s >= 75 ? 4 : s >= 65 ? 3 : s >= 55 ? 2 : 1; }
}

import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, OnInit, afterNextRender, computed, effect, inject, input, signal,
  untracked, viewChild,
} from '@angular/core';
import { Location } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DataV2Service, DishV2, DrinkV2 } from '../../core/data-v2.service';
import { PairingV2Service } from '../../core/pairing-v2.service';
import { GuestPrefsService } from '../../core/guest-prefs.service';
import { VenueService } from '../../core/venue.service';
import { SaasService } from '../../core/saas.service';
import { I18nKey, I18nService } from '../../core/i18n.service';
import { cuisineLabel } from '../../core/cuisines-v2';
import {
  DEFAULT_MIN_GAIN_PER_DISH, DEFAULT_MIN_SCORE, MAX_TABLE_DISHES, TABLE_PRESETS, TablePairCell, TablePlan, TableSingle,
  TableFlightItem, TableWarning, newTableScoreCache, planTableAsync,
} from '../../core/table-planner';
import { Ctx, DrinkProfile, Occasion, ParamsV2, pyStrCmp } from '../../engine/pairing-engine-v2';
import { IconComponent } from '../../ui/icon.component';
import { DishPhotoComponent } from '../../ui/dish-photo.component';
import { DrinkArtComponent } from '../../ui/drink-art.component';
import {
  SHARE_IMAGE_EXT, ShareDrink, TableCardData, canShareFiles, downloadBlob, ensureShareFonts, renderTableCard, shareImage,
} from '../../ui/share-card';

type OccasionChip = { id: Occasion | null; l: I18nKey };
interface SingleCard { s: TableSingle; drink: DrinkV2; crown: boolean; promoted: boolean; hero: boolean }
interface FlightCard { f: TableFlightItem; drink: DrinkV2 }
const STORE = 'ft.table.v1';
const FLIGHT_SIZES = [2, 3, 4] as const;
const PAGE = 12;

/**
 * «Дастархан» — подбор напитков на весь стол: один напиток, который лучше всех держит самое трудное блюдо (maximin;
 * если хорошей пары на весь стол нет — так и говорим), и сет из 2–4 бокалов в порядке подачи. Все баллы —
 * core/table-planner.ts (scorePair движка v2); страница только показывает. Политика окна Efes меняет лишь порядок
 * карточек и всегда названа прямо (с честным местом напитка). Состояние стола — в ?d=… (ссылкой можно поделиться) и в
 * localStorage гостя.
 */
@Component({
  selector: 'ft-table',
  standalone: true,
  imports: [RouterLink, IconComponent, DishPhotoComponent, DrinkArtComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="hero">
      <span class="eyebrow">{{ t('table.eyebrow') }}</span>
      <h1>{{ t('table.title') }}</h1>
      <p class="accent-serif tagline">{{ t('table.tagline') }}</p>
      <p class="lede mt12">{{ t('table.lede') }}</p>
    </header>

    <section class="presets" [attr.aria-label]="t('table.presets')">
      <h2 class="h-sm">{{ t('table.presets') }}</h2>
      <div class="preset-row scroll-x">
        @for (p of presets; track p.id) {
          <button type="button" class="preset" [class.on]="activePreset() === p.id" [attr.aria-pressed]="activePreset() === p.id" (click)="applyPreset(p.id)">
            <span class="stack" aria-hidden="true">
              @for (id of p.dishes.slice(0, 4); track id) {
                <span class="av" aria-hidden="true"><ft-dish-photo [dishId]="id" [emoji]="emojiOf(id)" /></span>
              }
            </span>
            <span class="pn">{{ t(presetLabel(p.id)) }}</span>
            <span class="pc">{{ i18n.count(p.dishes.length, 'count.dishes') }}</span>
          </button>
        }
      </div>
    </section>

    <div class="layout">
      <aside class="composer">
        <section class="card tbl" [attr.aria-label]="t('table.yours')">
          <div class="tbl-head">
            <h2 class="h-sm">{{ t('table.yours') }}</h2>
            <span class="cnt num" [class.full]="isFull()">{{ selected().length }}<span class="of">/{{ max }}</span></span>
            @if (selected().length) {
              <button type="button" class="btn btn-ghost btn-sm clear" (click)="clear()"><ft-icon name="x" [size]="14" /> {{ t('table.clear') }}</button>
            }
          </div>

          @if (tableDishes().length) {
            <ul class="sel" role="list">
              @for (d of tableDishes(); track d.id) {
                <li class="dchip pop">
                  <span class="av" aria-hidden="true"><ft-dish-photo [dishId]="d.id" [emoji]="d.emoji || '🍽️'" /></span>
                  <span class="dn">{{ name(d) }}</span>
                  <button type="button" class="rm" (click)="toggle(d.id)" [attr.aria-label]="t('table.remove', { dish: name(d) })"><ft-icon name="x" [size]="14" /></button>
                </li>
              }
            </ul>
          } @else {
            <p class="muted sm empty-sel">{{ t('table.emptyHint') }}</p>
          }

          <button type="button" class="btn btn-secondary btn-sm btn-block mt12 add" (click)="pickerOpen.set(!pickerOpen())" [attr.aria-expanded]="pickerOpen()" aria-controls="dish-picker">
            <ft-icon [name]="pickerOpen() ? 'chevron-down' : 'dish'" [size]="16" /> {{ pickerOpen() ? t('table.pickerDone') : t('table.add') }}
          </button>

          @if (pickerOpen()) {
            <div class="picker" id="dish-picker">
              <div class="search mt12">
                <ft-icon name="search" />
                <input #search class="input" type="search" autocomplete="off" enterkeyhint="search" [placeholder]="t('table.search')"
                       [value]="q()" (input)="onQuery($event)" (keydown.enter)="addFirstHit()" [attr.aria-label]="t('table.search')" />
              </div>
              @if (!q().trim()) {
                <div class="cuisines scroll-x mt8" role="group" [attr.aria-label]="t('table.cuisines')">
                  <button type="button" class="chip chip-sm" [class.on]="cuisine() === ''" [attr.aria-pressed]="cuisine() === ''" (click)="setCuisine('')">{{ t('table.all') }}</button>
                  @for (c of cuisines(); track c.id) {
                    <button type="button" class="chip chip-sm" [class.on]="cuisine() === c.id" [attr.aria-pressed]="cuisine() === c.id" (click)="setCuisine(cuisine() === c.id ? '' : c.id)">{{ c.label }}</button>
                  }
                </div>
              }
              @if (isFull()) { <p class="full-note xs mt8" role="status"><ft-icon name="info" [size]="14" /> {{ t('table.full', { n: max }) }}</p> }
              <div class="tiles mt12">
                @for (d of pickList(); track d.id) {
                  <button type="button" class="tile" [class.on]="isSelected(d.id)" [attr.aria-pressed]="isSelected(d.id)" [attr.aria-label]="name(d)"
                          [disabled]="!isSelected(d.id) && isFull()" (click)="toggle(d.id)">
                    <ft-dish-photo [dishId]="d.id" [emoji]="d.emoji || '🍽️'" [name]="name(d)" />
                    <span class="tn">{{ name(d) }}</span>
                    <span class="tick" aria-hidden="true">@if (isSelected(d.id)) { <ft-icon name="check" [size]="14" /> } @else { <span class="plus">+</span> }</span>
                  </button>
                } @empty {
                  <p class="muted sm nohit">{{ t('table.noHits') }}</p>
                }
              </div>
              @if (hasMore()) {
                <button type="button" class="btn btn-ghost btn-sm btn-block mt8" (click)="limit.set(limit() + page)">{{ t('table.more') }}</button>
              }
            </div>
          }
        </section>

        <section class="card ctx" [attr.aria-label]="t('table.context')">
          <div class="ctx-row">
            <span class="lbl" id="occ-l">{{ t('pair.occasion') }}</span>
            <div class="chips" role="group" aria-labelledby="occ-l">
              @for (o of occasions; track o.l) {
                <button type="button" class="chip chip-sm" [class.on]="occasion() === o.id" [attr.aria-pressed]="occasion() === o.id" (click)="occasion.set(o.id)">{{ t(o.l) }}</button>
              }
            </div>
          </div>
          <div class="ctx-row">
            <span class="lbl" id="fl-l">{{ t('table.flightSize') }}</span>
            <div class="seg" role="group" aria-labelledby="fl-l">
              @for (n of flightSizes; track n) {
                <button type="button" [class.on]="maxFlight() === n" [attr.aria-pressed]="maxFlight() === n" (click)="maxFlight.set(n)">{{ t('table.glasses', { n: n }) }}</button>
              }
            </div>
          </div>
          <div class="toggles">
            @if (anySpicy()) {
              <button type="button" class="chip chip-sm" [class.on]="heatLover()" [attr.aria-pressed]="heatLover()" (click)="prefs.set({ heat_lover: !heatLover() })"><ft-icon name="flame" [size]="14" /> {{ t('v2.pair.heatLover') }}</button>
            }
            <button type="button" class="chip chip-sm" [class.on]="sensitive()" [attr.aria-pressed]="sensitive()" (click)="prefs.set({ harsh_tol: sensitive() ? 'median' : 'sensitive' })"><ft-icon name="droplet" [size]="14" /> {{ t('v2.pair.sensitive') }}</button>
            @if (venue.venue(); as v) {
              <button type="button" class="chip chip-sm" [class.on]="onlyVenue()" [attr.aria-pressed]="onlyVenue()" (click)="onlyVenue.set(!onlyVenue())"><ft-icon name="map-pin" [size]="14" /> {{ t('pair.onlyVenue', { venue: v.name }) }}</button>
            }
          </div>
          @if (prefs.learned().length) {
            <p class="learned xs">{{ t('v2.pair.prefs', { list: prefs.learned().join(', ') }) }} · <button type="button" class="linkish" (click)="prefs.reset()">{{ t('v2.pair.prefsReset') }}</button></p>
          }
        </section>
      </aside>

      <div class="results" #results [attr.aria-busy]="busy()">
        <p class="sr-only" aria-live="polite">{{ liveText() }}</p>

        @if (!tableDishes().length) {
          <div class="card empty">
            <div class="empty-art" aria-hidden="true">
              @for (id of emptyIds; track id) { <span class="av" aria-hidden="true"><ft-dish-photo [dishId]="id" [emoji]="emojiOf(id)" /></span> }
            </div>
            <h2 class="h-md">{{ t('table.empty.title') }}</h2>
            <p class="dim">{{ t('table.empty.text') }}</p>
            <button type="button" class="btn btn-primary mt16" (click)="applyPreset('dastarkhan')"><ft-icon name="sparkles" [size]="16" /> {{ t('table.empty.cta') }}</button>
          </div>
        } @else if (data.drinks() === null || (!plan() && busy())) {
          @if (data.error()) { <div class="card card-p center"><p class="dim">{{ t('v2.pair.loadError') }}</p></div> }
          @else {
            <p class="loading muted sm">{{ t('table.computing') }}</p>
            <div class="card skeleton sk-hero"></div><div class="card skeleton sk-row"></div>
          }
        } @else {
          @if (plan(); as p) {
          <div class="res-head">
            <span class="eyebrow plain">{{ t('table.result') }}</span>
            <p class="muted xs">
              {{ i18n.count(p.dishes.length, 'count.dishes') }} · {{ t('table.compared', { drinks: i18n.count(p.n_candidates, 'count.drinks') }) }}
              @if (p.excluded_non_alcoholic.length) { · {{ t('v2.pair.excludedNa', { n: p.excluded_non_alcoholic.length }) }} }
              @if (venueOn()) { · {{ t('table.venueOnly') }} }
              @if (busy()) { · <span class="upd">{{ t('table.updating') }}</span> }
            </p>
          </div>

          @if (p.status === 'no_drinks') {
            <div class="card card-p center"><p class="dim">{{ t('table.noDrinks') }}</p></div>
          } @else {
            <!-- ── один напиток на весь стол ── -->
            <section class="blk" [class.stale]="busy()">
              <div class="blk-h">
                <h2 class="h-md">{{ t('table.single.title') }}</h2>
                <p class="muted sm">{{ t('table.single.sub') }}</p>
              </div>

              @if (policyNote(); as note) {
                <p class="policy" role="note"><ft-icon name="info" [size]="16" /><span>{{ note }}</span></p>
              }

              <div class="singles" [class.two]="heroCards().length > 1">
                @for (c of heroCards(); track c.s.drink_id; let i = $index) {
                  <article class="card single reveal" [class.reveal-1]="i === 0" [class.reveal-2]="i === 1" [class.gilded]="c.crown">
                    <div class="flags">
                      @if (c.crown) { <span class="crown"><ft-icon name="trophy" [size]="13" /> {{ t('table.single.best') }}</span> }
                      @if (c.promoted) { <span class="crown promoted" [attr.title]="t('v2.pair.policy', { n: p.policy.window })">{{ t('table.single.promoted', { upto: plural('table.upto', p.policy.window) }) }}</span> }
                      @if (c.s.efes && !c.promoted) { <span class="badge">{{ relLabel(c.s.efes_relation) }}</span> }
                    </div>
                    <div class="sg-head">
                      <a class="art" [routerLink]="['/drinks', c.drink.id]" [attr.aria-label]="c.drink.name">
                        <ft-drink-art [drink]="c.drink" [size]="heroCards().length > 1 ? 104 : 128" [glow]="true" />
                      </a>
                      <div class="sg-t">
                        <a [routerLink]="['/drinks', c.drink.id]" class="nm"><h3>{{ c.drink.name }}</h3></a>
                        <p class="sub">{{ drinkSub(c.drink) }}</p>
                        <div class="nums">
                          <div class="nb"><span class="num big">{{ c.s.min }}</span><span class="cap">{{ t('table.min') }}</span></div>
                          <div class="nb"><span class="num big alt">{{ fmt(c.s.mean) }}</span><span class="cap">{{ t('table.mean') }}</span></div>
                        </div>
                      </div>
                    </div>
                    @if (c.s.why) {
                      <p class="why"><span class="q">{{ t('table.why', { dish: dishNameById(c.s.strongest_dish.dish_id) }) }}</span> {{ c.s.why }}</p>
                    }
                    @if (c.s.per_dish.length) {
                    <ul class="per" [attr.aria-label]="t('table.perDish')">
                      @for (cell of c.s.per_dish; track cell.dish_id) {
                        <li [class.weak]="cell.dish_id === c.s.weakest_dish.dish_id" [class.low]="cell.score < minScore()">
                          <span class="av sm" aria-hidden="true"><ft-dish-photo [dishId]="cell.dish_id" [emoji]="emojiOf(cell.dish_id)" /></span>
                          <span class="pdn">{{ dishNameById(cell.dish_id) }}@if (cell.classic) { <ft-icon name="star" [size]="11" class="cl" [attr.title]="t('v2.card.classic')" /><span class="sr-only"> ({{ t('v2.card.classic') }})</span> }</span>
                          <span class="meter" aria-hidden="true"><i [style.width.%]="cell.score"></i></span>
                          <span class="num sc">{{ cell.score }}</span>
                        </li>
                      }
                    </ul>
                    }
                    <p class="weak-note" [class.bad]="c.s.weakest_dish.score < minScore()">
                      <ft-icon [name]="c.s.weakest_dish.score < minScore() ? 'info' : 'shield'" [size]="15" />
                      <span>{{ t('table.weakest', { dish: dishNameById(c.s.weakest_dish.dish_id), score: c.s.weakest_dish.score }) }}@if (c.s.weakest_dish.warning) { — {{ c.s.weakest_dish.warning }}}</span>
                    </p>
                  </article>
                }
              </div>

              @if (others().length) {
                <h3 class="h-xs mt16">{{ t('table.single.more') }}</h3>
                <div class="others mt8">
                  @for (c of others(); track c.s.drink_id) {
                    <a class="card hover other" [routerLink]="['/drinks', c.drink.id]">
                      <span class="o-art"><ft-drink-art [drink]="c.drink" [size]="64" /></span>
                      <span class="o-t">
                        <span class="o-n">{{ c.drink.name }}</span>
                        <span class="sub">{{ drinkSub(c.drink) }}</span>
                        <span class="o-w xs">{{ t('table.weakestShort', { dish: dishNameById(c.s.weakest_dish.dish_id) }) }}</span>
                      </span>
                      <span class="o-nums">
                        <span class="num">{{ c.s.min }}</span><span class="cap">{{ t('table.minShort') }}</span>
                        <span class="num alt">{{ fmt(c.s.mean) }}</span><span class="cap">{{ t('table.meanShort') }}</span>
                      </span>
                    </a>
                  }
                </div>
              }
            </section>

            <!-- ── сет бокалов ── -->
            <section class="blk" [class.stale]="busy()">
              @if (flight().length > 1 && p.flight_summary; as fs) {
                <div class="blk-h">
                  <h2 class="h-md">{{ t('table.flight.title', { n: flight().length }) }}</h2>
                  <p class="muted sm">{{ t('table.flight.sub') }}</p>
                </div>
                <div class="gainbar card">
                  <div class="gb">
                    <span class="cap">{{ t('table.mean') }}</span>
                    <span class="gv"><span class="num was">{{ fmt(fs.single_mean) }}</span><ft-icon name="arrow-right" [size]="16" /><span class="num now" [class.flat]="fs.mean <= fs.single_mean">{{ fmt(fs.mean) }}</span></span>
                  </div>
                  <div class="gb">
                    <span class="cap">{{ t('table.min') }}</span>
                    <span class="gv"><span class="num was">{{ fs.single_min }}</span><ft-icon name="arrow-right" [size]="16" /><span class="num now" [class.flat]="fs.min <= fs.single_min" [class.down]="fs.min < fs.single_min">{{ fs.min }}</span></span>
                  </div>
                  <p class="gnote xs muted">{{ t('table.flight.vs') }}</p>
                </div>
                <ol class="flight" [style.--cols]="flightCols()">
                  @for (fc of flight(); track fc.f.drink_id; let i = $index; let last = $last) {
                    <li class="fl card" [class.last]="last" [class.rowend]="(i + 1) % flightCols() === 0">
                      <div class="fl-top">
                        <span class="ord num" [attr.aria-label]="t('table.flight.order', { n: fc.f.order })">{{ fc.f.order }}</span>
                        <span class="ord-l">{{ orderLabel(fc.f.order, flight().length) }}</span>
                      </div>
                      <a class="fl-art" [routerLink]="['/drinks', fc.drink.id]" [attr.aria-label]="fc.drink.name"><ft-drink-art [drink]="fc.drink" [size]="112" [glow]="true" /></a>
                      <div class="fl-b">
                        <a [routerLink]="['/drinks', fc.drink.id]" class="nm"><h3>{{ fc.drink.name }}</h3></a>
                        <p class="sub">{{ drinkSub(fc.drink) }}</p>
                        <div class="loud" [attr.title]="t('table.loudTitle')">
                          <span class="cap">{{ t('table.loud') }}</span>
                          <span class="lbar" aria-hidden="true"><i [style.width.%]="fc.f.F_B * 100"></i></span>
                          <span class="num lv">{{ fx(fc.f.F_B) }}</span>
                        </div>
                        <ul class="fd" [attr.aria-label]="t('table.flight.dishes')">
                          @for (cell of fc.f.dishes; track cell.dish_id) {
                            <li [class.low]="cell.score < minScore()">
                              <span class="av xs" aria-hidden="true"><ft-dish-photo [dishId]="cell.dish_id" [emoji]="emojiOf(cell.dish_id)" /></span>
                              <span class="fdn">{{ dishNameById(cell.dish_id) }}</span>
                              <span class="num sc">{{ cell.score }}</span>
                            </li>
                          }
                        </ul>
                        @if (fc.f.why) { <p class="why sm">{{ fc.f.why }}</p> }
                        @if (fc.f.gain !== null && fc.f.gain > 0 && fc.f.dishes.length) { <p class="gain xs">{{ gainText(fc.f) }}</p> }
                      </div>
                    </li>
                  }
                </ol>
              } @else {
                <div class="card card-p one" [class.weak]="!singleCoversAll()">
                  <ft-icon [name]="singleCoversAll() ? 'glass' : 'info'" [size]="20" />
                  <p class="dim sm">{{ flightNoneText() }}</p>
                </div>
              }
            </section>

            <!-- ── где пары нет ── -->
            @if (p.warnings.length) {
              <section class="card warns" [attr.aria-label]="t('table.warn.title')">
                <h3 class="h-xs"><ft-icon name="info" [size]="16" /> {{ t('table.warn.title') }}</h3>
                <ul>
                  @for (w of p.warnings; track w.dish_id) {
                    <li>
                      <span class="av sm" aria-hidden="true"><ft-dish-photo [dishId]="w.dish_id" [emoji]="emojiOf(w.dish_id)" /></span>
                      <span>
                        <b>{{ dishNameById(w.dish_id) }}</b> — {{ warnText(w) }}
                        @if (w.engine_warning) { <span class="muted xs ew">{{ w.engine_warning }}</span> }
                      </span>
                    </li>
                  }
                </ul>
              </section>
            }

            <!-- ── поделиться ── -->
            <div class="share-row">
              <button type="button" class="btn btn-primary btn-lg" (click)="openShare()" [disabled]="!p.single || busy()">
                <ft-icon name="share" [size]="18" /> {{ t('table.share') }}
              </button>
              <p class="muted xs">{{ t('table.share.hint') }}</p>
            </div>

            <!-- ── метод ── -->
            <details class="card method">
              <summary><ft-icon name="compass" [size]="16" /> {{ t('table.method.title') }}</summary>
              <ul>
                <li>{{ t('table.method.engine') }}</li>
                <li>{{ t('table.method.single') }}</li>
                <li>{{ t('table.method.flight', { n: minGain }) }}</li>
                <li>{{ t('table.method.order') }}</li>
                <li>{{ t('table.method.warn', { n: minScore() }) }}</li>
                <li>{{ t('v2.pair.policy', { n: p.policy.window }) }}</li>
              </ul>
              <a routerLink="/method" class="linkish sm">{{ t('v2.pair.method') }}</a>
            </details>
          }
          }
        }
      </div>
    </div>

    <dialog #shareDlg class="share-dlg" aria-labelledby="share-h" (close)="onShareClosed()" (click)="backdropClose($event)">
      <div class="dlg-in">
        <div class="dlg-head">
          <h2 id="share-h" class="h-sm">{{ t('table.share.title') }}</h2>
          <button type="button" class="btn btn-icon btn-ghost" (click)="closeShare()" [attr.aria-label]="t('common.close')"><ft-icon name="x" [size]="18" /></button>
        </div>
        <div class="preview">
          @if (previewUrl(); as u) {
            <img [src]="u" width="1080" height="1920" [alt]="t('table.share.alt')" />
          } @else if (shareError()) {
            <p class="dim sm center">{{ t('table.share.error') }}</p>
          } @else {
            <div class="pv-sk" role="status"><span class="pv-dot" aria-hidden="true"></span><span class="muted xs">{{ t('table.share.rendering') }}</span></div>
          }
        </div>
        <div class="dlg-actions">
          @if (canShare) {
            <button type="button" class="btn btn-primary" [disabled]="!shareBlob()" (click)="doShare()"><ft-icon name="share" [size]="16" /> {{ t('table.share.send') }}</button>
          }
          <button type="button" class="btn" [class.btn-primary]="!canShare" [class.btn-secondary]="canShare" [disabled]="!shareBlob()" (click)="doDownload()"><ft-icon name="download" [size]="16" /> {{ t('table.share.download') }}</button>
        </div>
        @if (shareMsg()) { <p class="xs muted center" role="status">{{ shareMsg() }}</p> }
      </div>
    </dialog>
  `,
  styles: [`
    :host { display: block; --tg: var(--gold); --tg-soft: var(--gold-soft); --tg-grad: var(--grad-amber); }
    /* светлая тема: светлое золото (#F4DDA3/#E5B849) на кремовом фоне почти не видно (1,3–1,8:1) — цифры и подписи
       этой страницы берут тёмное золото (#8A6118: ≈5:1), крупные числа — тёмный градиент */
    :host-context([data-theme="light"]) { --tg: #8A6118; --tg-soft: #8A6118; --tg-grad: linear-gradient(150deg, #A87A26 0%, #8A6118 50%, #6B4A12 100%); }
    @media (prefers-color-scheme: light) {
      :host-context(html:not([data-theme="dark"])) { --tg: #8A6118; --tg-soft: #8A6118; --tg-grad: linear-gradient(150deg, #A87A26 0%, #8A6118 50%, #6B4A12 100%); }
    }
    .hero { max-width: 760px; }
    .hero h1 { margin-top: 10px; }
    .tagline { font-size: clamp(1.25rem, 1.6vw + .8rem, 1.7rem); color: var(--tg-soft); margin-top: 2px; }
    .h-sm { font-family: var(--font-display); font-size: 1.45rem; font-weight: 600; }
    .h-md { font-family: var(--font-display); font-size: clamp(1.6rem, 1.6vw + 1rem, 2.1rem); font-weight: 600; }
    .h-xs { font-family: var(--font-body); font-size: .74rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-3); display: flex; align-items: center; gap: 8px; }
    .cap { font-size: .68rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-3); }

    /* ── готовые столы ── */
    .presets { margin-top: 28px; }
    .preset-row { margin-top: 12px; gap: 10px; padding-block: 4px 8px; scroll-padding-inline: var(--gutter); }
    .preset { display: grid; gap: 6px; justify-items: start; text-align: left; width: 188px; padding: 14px 14px 12px; border-radius: var(--r-lg);
      background: var(--grad-amber-soft), var(--surface); border: 1px solid var(--line); box-shadow: var(--shadow-1), var(--inner-lip);
      transition: transform var(--t-med) var(--ease), border-color var(--t-med), box-shadow var(--t-med); }
    .preset:hover { transform: translateY(-2px); border-color: rgba(229, 184, 73, .38); }
    .preset.on { border-color: rgba(229, 184, 73, .6); box-shadow: var(--shadow-1), inset 0 0 0 1px rgba(229, 184, 73, .35), 0 10px 30px -18px rgba(229, 184, 73, .6); }
    .preset.on .pn { color: var(--tg-soft); }
    .pn { font-family: var(--font-display); font-weight: 700; font-size: 1.16rem; line-height: 1.1; margin-top: 4px; }
    .pc { font-size: .72rem; color: var(--ink-3); font-weight: 600; }
    .stack { display: flex; padding-left: 8px; }
    .stack .av { width: 40px; margin-left: -8px; }
    @media (min-width: 1100px) { .preset-row { display: grid; grid-template-columns: repeat(5, 1fr); overflow: visible; margin-inline: 0; padding-inline: 0; } .preset { width: auto; } }

    /* круглые аватары блюд из ft-dish-photo */
    .av { display: block; width: 36px; flex-shrink: 0; --r-md: 50%; border-radius: 50%; box-shadow: 0 0 0 2px var(--surface); }
    .av.sm { width: 30px; } .av.xs { width: 24px; }

    /* ── раскладка ── */
    .layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; margin-top: 20px; }
    @media (min-width: 1100px) {
      .layout { grid-template-columns: 388px minmax(0, 1fr); gap: 28px; align-items: start; }
      .composer { position: sticky; top: calc(var(--header-h) + 16px); max-height: calc(100dvh - var(--header-h) - 32px); overflow-y: auto; scrollbar-width: thin; padding-right: 4px; }
    }
    .composer { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; align-content: start; min-width: 0; }

    /* ── ваш стол ── */
    .tbl { padding: 16px; }
    .tbl-head { display: flex; align-items: center; gap: 10px; }
    .cnt { font-size: 1.2rem; color: var(--tg-soft); }
    .cnt .of { color: var(--ink-3); font-size: .9rem; }
    .cnt.full { color: var(--warn); }
    .clear { margin-left: auto; min-height: 40px; padding: 0 10px; color: var(--ink-3); }
    .sel { list-style: none; display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .dchip { display: inline-flex; align-items: center; gap: 7px; padding: 3px 4px 3px 3px; border-radius: var(--r-full); background: var(--surface-2); border: 1px solid rgba(229, 184, 73, .26); max-width: 100%; }
    .dchip .av { width: 28px; box-shadow: none; }
    .dchip .dn { font-size: .84rem; font-weight: 600; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rm { position: relative; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; color: var(--ink-3); flex-shrink: 0; transition: background var(--t-fast), color var(--t-fast); }
    /* зона нажатия ≈ 44 px при том же виде кнопки */
    .rm::before { content: ''; position: absolute; inset: -8px; border-radius: 50%; }
    .rm:hover, .rm:focus-visible { background: var(--warn-bg); color: var(--warn); }
    .empty-sel { margin-top: 10px; }
    .add { justify-content: center; }
    .full-note { display: flex; align-items: center; gap: 6px; color: var(--warn); }
    .cuisines { gap: 6px; padding-block: 2px 4px; scroll-padding-inline: var(--gutter); }
    .tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    @media (min-width: 560px) and (max-width: 1099px) { .tiles { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
    .tile { position: relative; display: grid; gap: 6px; padding: 5px 5px 8px; border-radius: var(--r-md); background: var(--surface); border: 1.5px solid var(--line); text-align: left; min-width: 0; transition: border-color var(--t-fast), transform var(--t-fast); }
    .tile:hover:not(:disabled) { border-color: rgba(229, 184, 73, .45); transform: translateY(-1px); }
    .tile:disabled { opacity: .45; cursor: not-allowed; }
    .tile ft-dish-photo { --r-md: 11px; }
    .tile .tn { font-size: .74rem; font-weight: 600; line-height: 1.2; padding-inline: 3px; color: var(--ink-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .tile .tick { position: absolute; top: 9px; right: 9px; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: rgba(11, 8, 6, .62); color: var(--ink-2); backdrop-filter: blur(6px); opacity: 0; transition: opacity var(--t-fast); }
    .tile:hover .tick { opacity: 1; }
    .tile.on { border-color: var(--gold); box-shadow: 0 0 0 1px rgba(229, 184, 73, .35), 0 8px 22px -14px rgba(229, 184, 73, .7); }
    .tile.on .tn { color: var(--tg-soft); }
    .tile.on .tick { opacity: 1; background: var(--grad-amber); color: var(--on-gold); }
    .tick .plus { font-size: 1.05rem; font-weight: 600; line-height: 1; margin-top: -1px; }
    .nohit { grid-column: 1 / -1; padding: 8px 2px; }

    /* ── контекст ── */
    .ctx { padding: 16px; display: grid; gap: 14px; }
    .ctx-row { display: grid; gap: 8px; }
    .lbl { font-size: .68rem; font-weight: 700; text-transform: uppercase; letter-spacing: .14em; color: var(--ink-3); }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4px; padding: 4px; border-radius: var(--r-md); background: var(--bg-2); }
    .seg button { min-height: 38px; border-radius: 10px; font-weight: 700; font-size: .84rem; color: var(--ink-2); }
    .seg button.on { background: var(--surface-2); color: var(--tg-soft); box-shadow: var(--shadow-1), inset 0 0 0 1px rgba(229, 184, 73, .3); }
    .toggles { display: flex; flex-wrap: wrap; gap: 6px; }
    .toggles .chip { white-space: normal; text-align: left; line-height: 1.25; padding-block: 4px; max-width: 100%; }
    .learned { color: var(--ink-3); }
    /* на телефоне переключатели контекста — обычной высоты чипа (≈ 40 px), а не 28 px */
    @media (max-width: 1099px) { .ctx .chip-sm { min-height: 40px; padding: 0 14px; font-size: .82rem; } }
    .linkish { color: var(--tg-soft); text-decoration: underline; text-underline-offset: 3px; font-size: inherit; }

    /* ── результаты ── */
    .results { display: grid; gap: 22px; min-width: 0; align-content: start; scroll-margin-top: calc(var(--header-h, 64px) + 12px); }
    .res-head { display: grid; gap: 4px; }
    .upd { color: var(--tg-soft); }
    .loading { margin-bottom: -8px; }
    .sk-hero { height: 320px; } .sk-row { height: 160px; }
    .blk { display: grid; gap: 12px; transition: opacity var(--t-med); }
    .blk.stale { opacity: .55; }
    .blk-h { display: grid; gap: 4px; }
    .blk-h p { max-width: 64ch; }

    .empty { padding: 28px 20px; text-align: center; display: grid; justify-items: center; gap: 8px; }
    .empty .dim { max-width: 46ch; }
    .empty-art { display: flex; padding-left: 12px; margin-bottom: 8px; }
    .empty-art .av { width: 58px; margin-left: -12px; box-shadow: 0 0 0 3px var(--surface); }

    .policy { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: var(--r-md); background: rgba(229, 184, 73, .07); border: 1px solid rgba(229, 184, 73, .3); font-size: .86rem; color: var(--ink-2); line-height: 1.45; }
    .policy ft-icon { color: var(--tg); margin-top: 2px; flex-shrink: 0; }

    .singles { display: grid; gap: 12px; }
    @media (min-width: 900px) { .singles.two { grid-template-columns: 1fr 1fr; align-items: stretch; } }
    .single { padding: 18px; display: grid; gap: 14px; align-content: start; }
    .single.gilded { border-color: rgba(229, 184, 73, .42); box-shadow: var(--shadow-2), inset 0 0 0 1px rgba(229, 184, 73, .14); }
    .flags { display: flex; flex-wrap: wrap; gap: 6px; min-height: 0; }
    .flags:empty { display: none; }
    .crown { display: inline-flex; align-items: center; gap: 6px; background: var(--grad-amber); color: var(--on-gold); font-size: .68rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; padding: 4px 10px; border-radius: var(--r-full); }
    .crown.promoted { background: rgba(229, 184, 73, .12); color: var(--tg-soft); border: 1px solid rgba(229, 184, 73, .35); cursor: help; }
    .sg-head { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 16px; align-items: center; }
    .art { display: grid; place-items: center; width: 104px; min-height: 140px; border-radius: 18px; background: radial-gradient(70% 55% at 50% 88%, var(--gold-glow), transparent), var(--surface-2); border: 1px solid var(--line-2); }
    .two .art { width: 88px; min-height: 118px; }
    .nm { color: inherit; }
    .sg-t h3 { font-size: clamp(1.35rem, 1.2vw + 1rem, 1.7rem); font-weight: 700; line-height: 1.08; }
    .sub { color: var(--ink-3); font-size: .8rem; margin-top: 3px; }
    .nums { display: flex; gap: 22px; margin-top: 12px; }
    .nb { display: grid; gap: 2px; min-width: 0; }
    .nb .cap { white-space: nowrap; }
    /* две карточки в ряд: подписи под числами переносятся, а не вылезают за край */
    .two .nums { gap: 16px; }
    .two .nb .cap { white-space: normal; letter-spacing: .1em; }
    .num.big { font-size: 3.1rem; line-height: .9; color: var(--tg-soft); background: var(--tg-grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
    .num.big.alt { background: none; color: var(--ink); }
    .two .num.big { font-size: 2.6rem; }
    .why { font-size: .9rem; color: var(--ink-2); line-height: 1.45; }
    .why .q { font-family: var(--font-display); font-style: italic; font-weight: 600; color: var(--tg-soft); font-size: 1.02rem; }

    .per { list-style: none; display: grid; gap: 6px; padding-top: 12px; border-top: 1px dashed var(--line); }
    .per li { display: grid; grid-template-columns: auto minmax(0, 1fr) minmax(56px, 34%) 30px; gap: 10px; align-items: center; font-size: .84rem; margin-inline: -6px; padding: 3px 6px; border-radius: 12px; }
    .per .av { box-shadow: none; }
    .pdn { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-2); font-weight: 500; }
    .pdn .cl { color: var(--tg); margin-left: 4px; vertical-align: 1px; }
    .meter { height: 6px; border-radius: var(--r-full); background: rgba(0, 0, 0, .35); overflow: hidden; }
    .meter i { display: block; height: 100%; border-radius: var(--r-full); background: linear-gradient(90deg, var(--gold-deep), var(--gold)); }
    .sc { font-size: 1.12rem; text-align: right; color: var(--ink); }
    .per li.weak { background: rgba(229, 184, 73, .07); box-shadow: inset 0 0 0 1px rgba(229, 184, 73, .16); }
    .per li.weak .pdn { color: var(--ink); }
    .per li.low .meter i { background: var(--warn); }
    .per li.low .sc { color: var(--warn); }
    .weak-note { display: flex; gap: 8px; align-items: flex-start; font-size: .82rem; color: var(--ink-3); line-height: 1.45; }
    .weak-note ft-icon { color: var(--tg); margin-top: 1px; flex-shrink: 0; }
    .weak-note.bad ft-icon { color: var(--warn); }

    .others { display: grid; gap: 10px; }
    @media (min-width: 720px) { .others { grid-template-columns: 1fr 1fr; } }
    .other { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 12px 14px; }
    .o-art { display: grid; place-items: center; width: 56px; min-height: 72px; border-radius: 12px; background: var(--surface-2); }
    .o-t { display: grid; gap: 1px; min-width: 0; }
    .o-n { font-family: var(--font-display); font-weight: 700; font-size: 1.12rem; line-height: 1.1; }
    .o-t .sub { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .o-w { color: var(--ink-3); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .o-nums { display: grid; grid-template-columns: auto auto; align-items: baseline; gap: 0 6px; text-align: right; }
    .o-nums .num { font-size: 1.5rem; line-height: 1; color: var(--tg-soft); }
    .o-nums .num.alt { color: var(--ink-2); font-size: 1.2rem; }
    .o-nums .cap { font-size: .68rem; text-align: left; }

    /* ── сет ── */
    .gainbar { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; padding: 14px 16px; }
    .gb { display: grid; gap: 2px; }
    .gv { display: inline-flex; align-items: center; gap: 8px; color: var(--ink-4); }
    .gv .was { font-size: 1.5rem; color: var(--ink-3); }
    .gv .now { font-size: 2.1rem; line-height: 1; background: var(--tg-grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
    /* без улучшения — не золотом: золото = «сет лучше» */
    .gv .now.flat { background: none; color: var(--ink-2); }
    .gv .now.down { color: var(--warn); }
    .gnote { grid-column: 1 / -1; }
    .flight { list-style: none; display: grid; gap: 12px; position: relative; counter-reset: fl; }
    .fl { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr); grid-template-areas: 'top top' 'art body'; gap: 10px 14px; padding: 16px; }
    .fl-top { grid-area: top; display: flex; align-items: center; gap: 10px; }
    .ord { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; font-size: 1.3rem; color: var(--tg-soft); border: 1.5px solid rgba(229, 184, 73, .6); background: var(--bg-2); box-shadow: 0 0 0 4px rgba(229, 184, 73, .06); }
    .ord-l { font-size: .68rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--tg); }
    .fl-art { grid-area: art; display: grid; place-items: center; width: 92px; min-height: 124px; border-radius: 16px; background: radial-gradient(70% 55% at 50% 88%, var(--gold-glow), transparent), var(--surface-2); align-self: start; }
    .fl-b { grid-area: body; min-width: 0; display: grid; gap: 8px; align-content: start; }
    .fl-b h3 { font-size: 1.3rem; font-weight: 700; line-height: 1.1; }
    .fl-b .sub { margin-top: -4px; }
    .loud { display: grid; grid-template-columns: auto minmax(24px, 1fr) auto; gap: 8px; align-items: center; cursor: help; }
    .lbar { height: 4px; border-radius: var(--r-full); background: rgba(0, 0, 0, .35); overflow: hidden; }
    .lbar i { display: block; height: 100%; border-radius: var(--r-full); background: linear-gradient(90deg, var(--gold-soft), var(--gold)); }
    .lv { font-size: .95rem; color: var(--ink-3); }
    .fd { list-style: none; display: grid; gap: 5px; }
    .fd li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; align-items: center; font-size: .84rem; color: var(--ink-2); }
    .fd .av { box-shadow: none; }
    .fdn { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fd .sc { font-size: 1.05rem; }
    .fd li.low .sc { color: var(--warn); }
    .fl .why { color: var(--ink-3); font-size: .84rem; }
    .gain { color: var(--ok); font-weight: 600; }
    /* соединительная нить подачи: вертикально на телефоне */
    .fl:not(.last)::after { content: ''; position: absolute; left: 33px; bottom: -13px; width: 1.5px; height: 14px; background: linear-gradient(var(--gold), transparent); }
    @media (min-width: 1100px) {
      /* 2–3 бокала — в ряд, 4 — сеткой 2×2 (порядок подачи читается слева направо, сверху вниз) */
      .flight { grid-template-columns: repeat(var(--cols, 3), minmax(0, 1fr)); gap: 14px; }
      .fl { grid-template-columns: minmax(0, 1fr); grid-template-areas: 'top' 'art' 'body'; align-content: start; }
      .fl-art { width: 100%; min-height: 150px; }
      .fl:not(.last)::after { left: auto; right: -12px; top: 34px; bottom: auto; width: 10px; height: 1.5px; background: var(--gold); opacity: .6; }
      .fl.rowend::after { display: none; }
      .singles:not(.two) .per { grid-template-columns: 1fr 1fr; column-gap: 28px; }
    }
    .one { display: flex; gap: 12px; align-items: center; color: var(--tg); }
    .one.weak { color: var(--warn); border-color: rgba(229, 112, 90, .35); }

    .warns { padding: 16px; border-color: rgba(229, 112, 90, .35); display: grid; gap: 10px; }
    .warns h3 { color: var(--warn); }
    .warns ul { list-style: none; display: grid; gap: 10px; }
    .warns li { display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: start; font-size: .88rem; color: var(--ink-2); line-height: 1.45; }
    .warns .ew { display: block; margin-top: 2px; }

    .share-row { display: grid; justify-items: center; gap: 8px; text-align: center; padding-block: 6px; }
    .method { padding: 0; }
    .method summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 14px 16px; font-weight: 700; font-size: .9rem; color: var(--ink-2); }
    .method summary::-webkit-details-marker { display: none; }
    .method summary ft-icon { color: var(--tg); }
    .method[open] summary { border-bottom: 1px solid var(--line); }
    .method ul { padding: 12px 16px 4px 34px; display: grid; gap: 8px; font-size: .86rem; color: var(--ink-2); line-height: 1.5; }
    .method > a { display: inline-block; margin: 4px 16px 14px; }

    /* ── предпросмотр сторис ── */
    .share-dlg { margin: auto; padding: 0; border: 1px solid rgba(229, 184, 73, .3); border-radius: var(--r-lg); background: var(--surface); color: var(--ink); box-shadow: var(--shadow-3); width: min(420px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); }
    .share-dlg::backdrop { background: rgba(6, 4, 3, .72); backdrop-filter: blur(6px); }
    .dlg-in { display: grid; gap: 12px; padding: 14px 16px 16px; }
    .dlg-head { display: flex; align-items: center; justify-content: space-between; }
    .preview { display: grid; place-items: center; }
    .preview img { width: auto; max-width: 100%; height: min(58dvh, 620px); aspect-ratio: 9 / 16; object-fit: contain; border-radius: 14px; box-shadow: var(--shadow-2); border: 1px solid var(--line); }
    .pv-sk { height: min(58dvh, 620px); aspect-ratio: 9 / 16; border-radius: 14px; display: grid; place-content: center; justify-items: center; gap: 12px;
      background: radial-gradient(80% 50% at 50% 0%, var(--gold-glow), transparent), var(--surface-2); border: 1px solid var(--line); }
    /* только opacity/transform — композитор: пока идёт анимация с перерисовкой, Chrome откладывает кодирование PNG */
    .pv-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--gold); box-shadow: 0 0 18px var(--gold); animation: pv 1.1s ease-in-out infinite alternate; }
    @keyframes pv { from { opacity: .35; transform: scale(.8); } to { opacity: 1; transform: scale(1.15); } }
    .dlg-actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
  `],
})
export class TablePage implements OnInit {
  data = inject(DataV2Service);
  private pairing = inject(PairingV2Service);
  prefs = inject(GuestPrefsService);
  venue = inject(VenueService);
  private saas = inject(SaasService);
  i18n = inject(I18nService);
  private location = inject(Location);
  private injector = inject(Injector);
  readonly t = this.i18n.t;

  /** ?d=beshbarmak,kazy — стол из ссылки; ?preset=dastarkhan — готовый стол. */
  d = input<string>('');
  preset = input<string>('');

  readonly max = MAX_TABLE_DISHES;
  readonly page = PAGE;
  readonly minGain = DEFAULT_MIN_GAIN_PER_DISH;
  readonly presets = TABLE_PRESETS;
  readonly flightSizes = FLIGHT_SIZES;
  readonly emptyIds = ['beshbarmak', 'kazy', 'baursaki', 'samsa', 'chak-chak'];
  readonly canShare = canShareFiles();
  readonly occasions: OccasionChip[] = [
    { id: null, l: 'pair.occasion.any' }, { id: 'meal', l: 'v2.pair.occasion.meal' }, { id: 'evening', l: 'pair.occasion.evening' },
    { id: 'party', l: 'pair.occasion.party' }, { id: 'hot', l: 'pair.occasion.hot' }, { id: 'gourmet', l: 'pair.occasion.gourmet' },
    { id: 'non_alcoholic', l: 'v2.pair.occasion.na' },
  ];

  readonly selected = signal<string[]>([]);
  readonly q = signal('');
  readonly cuisine = signal('');
  readonly limit = signal(PAGE);
  readonly pickerOpen = signal(false);
  readonly occasion = signal<Occasion | null>(null);
  readonly maxFlight = signal<number>(3);
  readonly onlyVenue = signal(true);
  readonly plan = signal<TablePlan | null>(null);
  readonly busy = signal(false);

  readonly heatLover = computed(() => this.prefs.prefs().heat_lover);
  readonly sensitive = computed(() => this.prefs.prefs().harsh_tol === 'sensitive');
  readonly minScore = computed(() => this.plan()?.options.minScore ?? DEFAULT_MIN_SCORE);

  private readonly searchEl = viewChild<ElementRef<HTMLInputElement>>('search');
  private readonly resultsEl = viewChild<ElementRef<HTMLElement>>('results');
  private readonly shareDlg = viewChild.required<ElementRef<HTMLDialogElement>>('shareDlg');
  private readonly cache = newTableScoreCache();
  private token: { aborted: boolean } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ready = false;
  private fontsWarm = false;
  /** Гость выбрал готовый стол на телефоне — после первого плана показать результат. */
  private revealPending = false;

  readonly tableDishes = computed<DishV2[]>(() => this.selected().map(id => this.data.dish(id)).filter((d): d is DishV2 => !!d));
  readonly isFull = computed(() => this.selected().length >= MAX_TABLE_DISHES);
  readonly anySpicy = computed(() => this.tableDishes().some(d => (d.vector?.['heat'] ?? 0) >= 0.3));
  readonly activePreset = computed<string | null>(() => {
    const sel = this.selected();
    const p = TABLE_PRESETS.find(x => x.dishes.length === sel.length && x.dishes.every(id => sel.includes(id)));
    return p?.id ?? null;
  });

  readonly cuisines = computed(() => {
    const counts = new Map<string, number>();
    for (const d of this.data.dishes()) for (const c of d.cuisine ?? []) counts.set(c, (counts.get(c) ?? 0) + 1);
    const loc = this.i18n.locale();
    return [...counts.entries()].map(([id, n]) => ({ id, n, label: cuisineLabel(id, loc) }))
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, loc)).slice(0, 12);
  });
  private readonly pickAll = computed<DishV2[]>(() => {
    const q = this.q().trim();
    if (q) return this.data.searchDishes(q, 24).map(h => h.dish);
    const c = this.cuisine();
    return c ? this.data.dishes().filter(d => (d.cuisine ?? []).includes(c)) : this.data.dishes();
  });
  readonly pickList = computed(() => this.pickAll().slice(0, this.limit()));
  readonly hasMore = computed(() => this.pickAll().length > this.limit());

  /** Контекст движка: повод + личный профиль гостя (R17) — тот же, что на странице пары. */
  readonly ctx = computed<Ctx>(() => ({ occasion: this.occasion(), ...this.prefs.ctx() }));
  private readonly localMenu = computed(() => { const v = this.venue.venue(); return v ? this.saas.localMenu(v.id, null) : null; });
  readonly venueDrinkIds = computed<string[] | null>(() => {
    if (!this.onlyVenue() || !this.venue.venue() || this.data.drinks() === null) return null;
    const menu = this.localMenu();
    return this.pairing.venueDrinkIds(menu ? menu.beers.map(b => b.ref_slug) : this.venue.brandIds());
  });
  readonly venueOn = computed(() => this.venueDrinkIds() !== null);

  /**
   * Карточки «один напиток»: в порядке policy.display_order (окно Efes меняет только порядок). Крупно — лучший по
   * баллам; если политика подняла Efes первым — он, лучший и все запасные, что по баллам выше него (их не прячем в
   * мелкие карточки ниже поднятого Efes). Остальные запасные — мелко.
   */
  private readonly singleCards = computed<SingleCard[]>(() => {
    const p = this.plan();
    if (!p?.single) return [];
    const byId = new Map<string, TableSingle>();
    for (const s of [p.single, ...(p.efes_alternative ? [p.efes_alternative] : []), ...p.runner_ups]) if (!byId.has(s.drink_id)) byId.set(s.drink_id, s);
    const e = p.policy.promoted ? p.efes_alternative : null;
    /** Выше по ключу maximin: больший min, затем больший sum, затем id (как в планировщике). */
    const outranks = (a: TableSingle, b: TableSingle): boolean =>
      a.min > b.min || (a.min === b.min && (a.sum > b.sum || (a.sum === b.sum && pyStrCmp(a.drink_id, b.drink_id) < 0)));
    const out: SingleCard[] = [];
    for (const id of p.policy.display_order) {
      const s = byId.get(id);
      const drink = this.data.drink(id);
      if (!s || !drink) continue;
      const crown = id === p.single.drink_id;
      const promoted = !!e && id === e.drink_id;
      const hero = crown || promoted || (!!e && s.detail && outranks(s, e));
      out.push({ s, drink, crown, promoted, hero });
    }
    return out;
  });
  readonly heroCards = computed(() => this.singleCards().filter(c => c.hero));
  readonly others = computed(() => this.singleCards().filter(c => !c.hero));
  /** Один напиток держит весь стол: ни одно блюдо не ниже порога хорошей пары. */
  readonly singleCoversAll = computed(() => {
    const p = this.plan();
    return !!p?.single && p.single.below_min === 0 && !p.warnings.length;
  });
  /** Колонок сета на широком экране: 4 бокала — 2×2. */
  readonly flightCols = computed(() => { const n = this.flight().length; return n >= 4 ? 2 : Math.max(1, n); });
  readonly flight = computed<FlightCard[]>(() => (this.plan()?.flight ?? [])
    .map(f => ({ f, drink: this.data.drink(f.drink_id) }))
    .filter((x): x is FlightCard => !!x.drink));

  /** Окно Efes подняло напиток Efes первым — говорим об этом прямо: чей он, честные разницы и честное место. */
  readonly policyNote = computed(() => {
    const p = this.plan();
    const e = p?.efes_alternative; const s = p?.single;
    if (!p?.policy.promoted || !e || !s) return '';
    return this.t('table.policy.promoted', {
      drink: e.drink_name, rel: this.relLabel(e.efes_relation, true), best: s.drink_name, n: p.policy.window,
      pts: this.plural('table.pts', p.policy.window), dmin: this.signed(-e.gap), dmean: this.signed(-e.mean_gap),
      rank: e.rank, total: p.n_candidates,
    });
  });

  readonly liveText = computed(() => {
    const p = this.plan();
    if (this.busy()) return this.t('table.computing');
    if (!p?.single) return '';
    return this.t('table.live', { drink: p.single.drink_name, min: p.single.min, n: p.flight.length });
  });

  // ── предпросмотр сторис ──
  readonly previewUrl = signal<string | null>(null);
  readonly shareBlob = signal<Blob | null>(null);
  readonly shareError = signal(false);
  readonly shareMsg = signal('');
  private shareRun = 0;

  constructor() {
    this.data.ensureDrinks().catch(() => { /* ошибку показывает шаблон */ });
    // пересчёт плана: блюда, пул, контекст, язык (тексты причин), карта заведения, размер сета
    effect(() => {
      // название блюда на языке гостя — только для текстов причин, баллы и кеш от него не зависят
      const dishes = this.tableDishes().map(d => this.data.forEngine(d));
      const loaded = this.data.drinks() !== null;
      const pool = this.data.guestPool();
      const params = this.data.activeParams();
      const ctx = this.ctx();
      const venueDrinkIds = this.venueDrinkIds();
      const maxFlight = this.maxFlight();
      untracked(() => this.schedule(dishes, loaded, pool, params, ctx, venueDrinkIds, maxFlight));
    }, { allowSignalWrites: true });
    // стол → ссылка (?d=…) и память устройства. replaceState, а не router.navigate: навигация прокрутила бы страницу наверх
    effect(() => {
      const ids = this.selected();
      if (!this.ready) return;
      try { localStorage.setItem(STORE, JSON.stringify(ids)); } catch { /* приватный режим */ }
      const path = this.location.path().split('?')[0] || '/table';
      this.location.replaceState(path, ids.length ? `d=${ids.map(encodeURIComponent).join(',')}` : '');
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.token) this.token.aborted = true;
      if (this.timer) clearTimeout(this.timer);
      this.revokePreview();
    });
  }

  ngOnInit(): void {
    const known = (id: string) => !!this.data.dish(id);
    let ids: string[] = [];
    if (this.preset()) ids = TABLE_PRESETS.find(p => p.id === this.preset())?.dishes.filter(known) ?? [];
    if (!ids.length && this.d()) ids = this.d().split(',').map(s => s.trim()).filter(known);
    if (!ids.length && !this.d() && !this.preset()) {
      try { const raw = localStorage.getItem(STORE); if (raw) ids = (JSON.parse(raw) as unknown[]).filter((x): x is string => typeof x === 'string' && known(x)); } catch { /* ignore */ }
    }
    this.selected.set([...new Set(ids)].slice(0, MAX_TABLE_DISHES));
    // список блюд свёрнут: готовые столы видны сразу, а пустой стол не уводит кнопку «Начать…» на три экрана вниз.
    // Пришли со страницы подбора с одним блюдом (?d=…) — список открыт: гость пришёл добавлять остальные.
    this.pickerOpen.set(!this.preset() && !!this.d() && this.selected().length === 1);
    this.ready = true;
  }

  private schedule(dishes: DishV2[], loaded: boolean, pool: readonly DrinkProfile[], params: ParamsV2, ctx: Ctx,
    venueDrinkIds: string[] | null, maxFlight: number): void {
    if (this.token) this.token.aborted = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!dishes.length) { this.plan.set(null); this.busy.set(false); return; }
    if (!loaded) { this.busy.set(true); return; }
    const token = { aborted: false };
    this.token = token;
    this.busy.set(true);
    // короткая пауза: гость щёлкает несколько блюд подряд — считаем один раз
    this.timer = setTimeout(() => {
      this.timer = null;
      planTableAsync(dishes, pool, ctx, params, this.data.classics, { cache: this.cache, venueDrinkIds, maxFlight, signal: token })
        .then(p => {
          if (!p || token.aborted) return;
          this.plan.set(p);
          this.busy.set(false);
          if (this.revealPending) {
            this.revealPending = false;
            afterNextRender(() => this.revealResults(), { injector: this.injector });
          }
          // шрифты карточки (и цифры с lnum) — заранее, чтобы «Поделиться» открывалось сразу
          if (!this.fontsWarm) { this.fontsWarm = true; setTimeout(() => ensureShareFonts().catch(() => undefined), 1200); }
        })
        .catch(() => { if (!token.aborted) this.busy.set(false); });
    }, 90);
  }

  // ── действия со столом ──
  isSelected(id: string): boolean { return this.selected().includes(id); }
  toggle(id: string): void {
    this.selected.update(s => (s.includes(id) ? s.filter(x => x !== id) : s.length >= MAX_TABLE_DISHES ? s : [...s, id]));
  }
  clear(): void { this.selected.set([]); this.pickerOpen.set(true); }
  applyPreset(id: string): void {
    const p = TABLE_PRESETS.find(x => x.id === id);
    if (!p) return;
    this.selected.set(p.dishes.filter(d => !!this.data.dish(d)).slice(0, MAX_TABLE_DISHES));
    this.pickerOpen.set(false);
    // на телефоне результат ниже композера: прокрутим к нему, когда план готов (раньше страница ещё коротка)
    try { this.revealPending = matchMedia('(max-width: 1099px)').matches; } catch { this.revealPending = false; }
  }
  private revealResults(): void {
    let calm = false;
    try { calm = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* нет matchMedia */ }
    this.resultsEl()?.nativeElement.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  }
  onQuery(e: Event): void { this.q.set((e.target as HTMLInputElement).value); this.limit.set(PAGE); }
  setCuisine(id: string): void { this.cuisine.set(id); this.limit.set(PAGE); }
  addFirstHit(): void {
    const first = this.pickList().find(d => !this.isSelected(d.id));
    if (first && !this.isFull()) { this.toggle(first.id); this.q.set(''); const el = this.searchEl()?.nativeElement; if (el) el.value = ''; }
  }

  // ── подписи ──
  presetLabel(id: string): I18nKey { return `table.preset.${id}` as I18nKey; }
  name(d: DishV2): string { return this.i18n.dishName({ id: d.id, display_name: d.display_name || d.name }); }
  dishNameById(id: string): string { const d = this.data.dish(id); return d ? this.name(d) : id; }
  emojiOf(id: string): string { return this.data.dish(id)?.emoji || '🍽️'; }
  fmt(x: number): string {
    const s = Number.isInteger(x) ? String(x) : (Math.round(x * 10) / 10).toFixed(1);
    return this.i18n.locale() === 'en' ? s : s.replace('.', ',');
  }
  fx(x: number): string { const s = (Math.round(x * 100) / 100).toFixed(2); return this.i18n.locale() === 'en' ? s : s.replace('.', ','); }
  signed(x: number): string { const v = Math.round(x * 10) / 10; return v > 0 ? `+${this.fmt(v)}` : v < 0 ? `−${this.fmt(-v)}` : '0'; }
  /** «до 2 баллов», «1 балл»: формы из словаря (ru — три, en — две, kk — одна), как i18n.count. */
  plural(base: 'table.upto' | 'table.pts', n: number): string {
    const m10 = n % 10, m100 = n % 100;
    const loc = this.i18n.locale();
    const form = loc === 'ru'
      ? (m10 === 1 && m100 !== 11 ? 'one' : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? 'few' : 'many')
      : loc === 'en' && n === 1 ? 'one' : 'many';
    return this.t(`${base}.${form}` as I18nKey, { n: this.fmt(n) });
  }
  /** Чей напиток — как в каталоге (drinks.page relLabel): свой — «Efes», остальное — «портфель CCI», «дистрибуция Efes». */
  relLabel(rel: string, full = false): string {
    return rel === 'own' ? this.t(full ? 'v2.rel.own' : 'v2.card.efes') : this.t(`v2.rel.${rel}` as I18nKey);
  }
  /** Вклад бокала — в среднем на его блюдо (gain — сумма по блюдам, не балл 0–99). */
  gainText(f: TableFlightItem): string {
    const n = f.dishes.length;
    return this.t('table.flight.gain', { avg: this.fmt(Math.round(((f.gain ?? 0) / n) * 10) / 10), dishes: this.i18n.count(n, 'count.dishes') });
  }
  /** Сета нет: честно — «один напиток справляется» только если ни одно блюдо не ниже порога. */
  flightNoneText(): string {
    const s = this.plan()?.single;
    if (!s || this.singleCoversAll()) return this.t('table.flight.none', { g: this.minGain });
    return this.t('table.flight.noneWeak', {
      drink: s.drink_name, below: this.i18n.count(s.below_min, 'count.dishes'), min: this.minScore(), g: this.minGain,
    });
  }
  drinkSub(d: DrinkV2): string {
    const parts = [d.style?.name || this.t(`v2.cat.${d.category}` as I18nKey)];
    if (d.abv !== null && d.abv !== undefined) parts.push(`${d.flags?.abv_unknown ? '≈' : ''}${this.fmt(d.abv)} %`);
    return parts.join(' · ');
  }
  orderLabel(order: number, n: number): string {
    return this.t(order === 1 ? 'table.flight.first' : order === n ? 'table.flight.last' : 'table.flight.next');
  }
  warnText(w: TableWarning): string {
    if (w.kind === 'no_good_pair') return this.t('table.warn.none', { drink: w.pool_best.drink_name, score: w.pool_best.score });
    if (w.kind === 'small_gain') return this.t('table.warn.gain', { score: w.score, drink: w.pool_best.drink_name, best: w.pool_best.score, g: this.minGain });
    return this.t('table.warn.limit', { score: w.score, drink: w.pool_best.drink_name, best: w.pool_best.score, n: this.plan()?.options.maxFlight ?? this.maxFlight() });
  }

  // ── поделиться ──
  /** На карточке — категория по-человечески («Коктейль · 9 %»), без английских имён стилей. */
  private shareDrink(d: DrinkV2): ShareDrink {
    const parts = [this.t(`v2.cat.${d.category}` as I18nKey)];
    if (d.abv !== null && d.abv !== undefined) parts.push(`${d.flags?.abv_unknown ? '≈' : ''}${this.fmt(d.abv)} %`);
    return { ...d, sub: parts.join(' · ') };
  }

  private cardData(p: TablePlan): TableCardData | null {
    const s = p.single;
    const drink = s ? this.data.drink(s.drink_id) : undefined;
    if (!s || !drink) return null;
    const cells = (list: TablePairCell[]) => list.map(c => this.dishNameById(c.dish_id));
    const flight = this.flight();
    const w = s.weakest_dish;
    return {
      dishes: p.dishes.map(d => ({ id: d.dish_id, name: this.dishNameById(d.dish_id), emoji: this.emojiOf(d.dish_id) })),
      single: {
        drink: this.shareDrink(drink), min: s.min, mean: s.mean, reason: s.why,
        reason_dish: s.why ? this.dishNameById(s.strongest_dish.dish_id) : null,
        below_min: s.below_min,
        weakest: s.below_min > 0
          ? `${this.t('table.weakest', { dish: this.dishNameById(w.dish_id), score: w.score })} · ${w.band_label}` : null,
      },
      flight: flight.length > 1 ? flight.map(fc => ({ drink: this.shareDrink(fc.drink), order: fc.f.order, dishes: cells(fc.f.dishes) })) : [],
      summary: p.flight_summary && flight.length > 1 ? { single_mean: p.flight_summary.single_mean, mean: p.flight_summary.mean } : null,
      locale: this.i18n.locale(),
      labels: {
        eyebrow: `${this.t('table.card.eyebrow')} · ${this.i18n.count(p.dishes.length, 'count.dishes')}`,
        title: this.t('table.card.title'),
        single: this.t('table.single.title'),
        min: this.t('table.min'),
        mean: this.t('table.mean'),
        flight: this.t('table.card.flight'),
        summary: this.t('table.card.summary'),
        flightNone: this.t('table.card.flightNone'),
        flightWeak: this.t('table.card.flightWeak'),
        why: this.t('table.why'),
        serves: this.t('table.card.serves'),
        footer: this.t('table.card.footer'),
        photos: this.t('table.card.photos'),
        more: this.t('table.card.more'),
        credits: this.t('table.card.credits'),
      },
    };
  }

  async openShare(): Promise<void> {
    const p = this.plan();
    const data = p ? this.cardData(p) : null;
    if (!data) return;
    const run = ++this.shareRun;
    this.revokePreview();
    this.shareBlob.set(null);
    this.shareError.set(false);
    this.shareMsg.set('');
    const dlg = this.shareDlg().nativeElement;
    if (!dlg.open) dlg.showModal();
    try {
      const blob = await renderTableCard(data);
      if (run !== this.shareRun) return;
      this.shareBlob.set(blob);
      this.previewUrl.set(URL.createObjectURL(blob));
    } catch {
      if (run === this.shareRun) this.shareError.set(true);
    }
  }
  async doShare(): Promise<void> {
    const blob = this.shareBlob(); const p = this.plan();
    if (!blob || !p?.single) return;
    const res = await shareImage(blob, {
      filename: this.filename(), title: 'Flavor Tree',
      text: this.t('table.share.text', { drink: p.single.drink_name, min: p.single.min, mean: this.fmt(p.single.mean) }),
      url: location.href,
    });
    this.shareMsg.set(res === 'shared' ? this.t('table.share.done') : res === 'downloaded' ? this.t('table.share.saved') : '');
  }
  doDownload(): void {
    const blob = this.shareBlob();
    if (!blob) return;
    downloadBlob(blob, this.filename());
    this.shareMsg.set(this.t('table.share.saved'));
  }
  closeShare(): void { this.shareDlg().nativeElement.close(); }
  onShareClosed(): void { this.shareRun++; this.revokePreview(); this.shareBlob.set(null); }
  /** Щелчок по затемнению вокруг окна закрывает его. */
  backdropClose(e: MouseEvent): void { if (e.target === this.shareDlg().nativeElement) this.closeShare(); }
  private filename(): string { return `flavor-tree-table-${this.selected().slice(0, 3).join('-') || 'set'}.${SHARE_IMAGE_EXT}`; }
  private revokePreview(): void { const u = this.previewUrl(); if (u) URL.revokeObjectURL(u); this.previewUrl.set(null); }
}

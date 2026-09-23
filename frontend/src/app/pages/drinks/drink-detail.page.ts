import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DataV2Service, DrinkFull, DrinkV2, isGuestVisible } from '../../core/data-v2.service';
import { PairingV2Service } from '../../core/pairing-v2.service';
import { ProgressService } from '../../core/progress.service';
import { I18nKey, I18nService } from '../../core/i18n.service';
import { TAG_LABELS_L10N } from '../../core/i18n/data';
import { DRINK_AXES, PairResult } from '../../engine/pairing-engine-v2';
import { IconComponent } from '../../ui/icon.component';
import { DrinkArtComponent } from '../../ui/drink-art.component';
import { DishPhotoComponent } from '../../ui/dish-photo.component';
import { ScoreRingComponent } from '../../ui/score-ring.component';
import { ReviewSummaryComponent } from '../../ui/review-summary.component';

interface Fact { k: I18nKey; v: string; src?: string; est?: boolean }
interface DishHit { r: PairResult; id: string; name: string; emoji: string; reason: string }

const TASTE_AXES = DRINK_AXES.filter(a => a !== 'serve_temp');

/**
 * Карточка напитка v2: иллюстрация/фото, факты с источниками (крепость, IBU, подача, цена, наличие), профиль из
 * 13 осей, «откуда эти числа» (vector_notes из полного каталога, лениво), источники, лучшие блюда по расчёту движка,
 * похожие по профилю, сводка отзывов. Черновик или неподтверждённое наличие — честная плашка «не участвует в подборе».
 */
@Component({
  selector: 'ft-drink-detail',
  standalone: true,
  imports: [RouterLink, IconComponent, DrinkArtComponent, DishPhotoComponent, ScoreRingComponent, ReviewSummaryComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a routerLink="/drinks" class="btn btn-ghost btn-sm"><ft-icon name="arrow-left" [size]="16" /> {{ t('drink.back') }}</a>

    @if (drink(); as d) {
      <section class="hero card mt12" [class.gilded]="isEfes()">
        <div class="stage">
          <ft-drink-art [drink]="d" [size]="artSize()" [preferPhoto]="!!d.image" [glow]="true" [animate]="true" [alt]="name()" />
        </div>
        <div class="info">
          <div class="flex g6 wrap">
            <span class="badge">{{ t(catKey()) }}</span>
            @if (d.style?.name) { <span class="badge badge-type">{{ d.style?.name }}@if (d.style?.bjcp_code) { · BJCP {{ d.style?.bjcp_code }} }</span> }
            @if (isEfes()) { <span class="badge efes">{{ t(relKey()) }}</span> }
            @if (d.flags?.non_alcoholic) { <span class="badge badge-info">{{ t('drinks.na') }}</span> }
            @if (!visible()) { <span class="badge badge-warn">{{ t('drinks.excluded') }}</span> }
          </div>
          <h1 class="nm mt8">{{ name() }}</h1>
          @if (producer()) { <p class="prod accent-serif">{{ producer() }}</p> }
          @if (d.description) { <p class="dim mt8 desc">{{ d.description }}@if (d.legacy_brand_id) { <span class="desc-src"> — {{ t('drink.descBrand') }}</span> }</p> }
          @if (labeledAs()) { <p class="note mt8"><ft-icon name="info" [size]="14" /> {{ t('drink.labeledAs', { label: labeledAs() }) }}</p> }
          @if (d.flags?.['generic_position']) { <p class="note mt8"><ft-icon name="info" [size]="14" /> {{ t('drink.generic') }}</p> }

          <dl class="facts mt16">
            @for (f of facts(); track f.k) {
              <div class="fact">
                <dt>{{ t(f.k) }}</dt>
                <dd><span class="fv num">{{ f.v }}</span>@if (f.src) { <span class="fs">{{ f.src }}</span> }</dd>
              </div>
            }
          </dl>

          <div class="actions mt16">
            @if (d.legacy_brand_id) { <a [routerLink]="['/beers', d.legacy_brand_id]" class="btn btn-secondary btn-sm"><ft-icon name="tree" [size]="16" /> {{ t('drink.pyramid') }}</a> }
            <a routerLink="/pair" class="btn btn-primary btn-sm"><ft-icon name="sparkles" [size]="16" /> {{ t('pair.choose') }}</a>
          </div>
        </div>
      </section>

      @if (!visible()) {
        <div class="soft excluded mt12">
          <ft-icon name="info" [size]="20" />
          <div><b>{{ t('drink.excluded.title') }}</b><p class="sm dim mt4">{{ t(d.status === 'draft' ? 'drink.excluded.draft' : 'drink.excluded.not_confirmed') }}</p></div>
        </div>
      }

      <section class="section two">
        <div class="card card-p">
          <span class="eyebrow">{{ t('drink.profile') }}</span>
          <p class="dim sm mt8">{{ t('drink.profile.sub') }}</p>
          <div class="axes mt16">
            @for (a of axes(); track a.k) {
              <div class="ax"><span class="al">{{ t(a.l) }}</span><div class="bar thin"><i [style.width.%]="a.v * 100"></i></div><b class="num">{{ fx(a.v) }}</b></div>
            }
          </div>
          <p class="temp mt12"><ft-icon name="thermometer" [size]="15" /> {{ t('v2.bax.serve_temp') }} · <b class="num">{{ serveTemp() }}</b></p>
          @if (aromas().length) {
            <div class="mt16">
              <span class="lbl">{{ t('drink.aromas') }}</span>
              <div class="flex g6 wrap mt8">
                @for (a of aromas(); track a.id) { <span class="chip chip-sm tag" [style.--w]="a.w">{{ a.label }} <span class="n num">{{ fx(a.w) }}</span></span> }
              </div>
            </div>
          }
        </div>

        <div class="card card-p">
          <span class="eyebrow">{{ t('drink.numbers') }}</span>
          <p class="dim sm mt8">{{ t('drink.numbers.sub') }}</p>
          <div class="conf mt16">
            <span class="big num">{{ conf() }}%</span>
            <div class="grow">
              <div class="bar"><i [style.width.%]="conf()"></i></div>
              <p class="sm mt8"><b>{{ t('drink.conf.title') }}</b> · {{ t(srcKey()) }}</p>
            </div>
          </div>
          <p class="dim xs mt8">{{ t('drink.conf.expl') }}</p>
          @if (d.flags?.abv_unknown) { <p class="note mt8"><ft-icon name="info" [size]="14" /> {{ t('v2.card.abvUnknown') }}</p> }
          <div class="notes mt16">
            @if (fullLoading()) {
              <p class="dim sm">{{ t('drink.numbers.loading') }}</p>
              <div class="skeleton sk" aria-hidden="true"></div>
            } @else if (notes().length) {
              @if (i18n.locale() !== 'ru') { <p class="dim xs mb8">{{ t('drink.numbers.ru') }}</p> }
              <ol class="steps">
                @for (n of notes(); track $index) { <li>{{ n }}</li> }
              </ol>
            } @else {
              <p class="dim sm">{{ t('drink.numbers.none') }}</p>
            }
          </div>
        </div>
      </section>

      <section class="section">
        <div class="sh"><span class="eyebrow">{{ t('drink.sources') }}</span><h2>{{ t('drink.sources') }}</h2><p class="dim sm">{{ t('drink.sources.sub') }}</p></div>
        @if (fullLoading()) {
          <div class="card skeleton sk mt12" aria-hidden="true"></div>
        } @else if (sources().length) {
          <ul class="srcs mt12">
            @for (s of sources(); track s.url) {
              <li class="card src">
                <a [href]="s.url" target="_blank" rel="noopener noreferrer" class="su">
                  <span class="host">{{ host(s.url) }}</span>
                  <span class="title">{{ s.title || s.url }}</span>
                  <ft-icon name="arrow-right" [size]="16" />
                </a>
                <div class="what">
                  @for (w of s.what ?? []; track w) { <span class="chip chip-sm ghost">{{ what(w) }}</span> }
                  @if (s.accessed) { <span class="muted xs">{{ t('drink.sources.accessed', { date: s.accessed }) }}</span> }
                </div>
              </li>
            }
          </ul>
        } @else {
          <p class="dim sm mt12">{{ t('drink.sources.none') }}</p>
        }
      </section>

      <section class="section">
        <div class="sh"><span class="eyebrow">{{ t('drink.dishes') }}</span><h2>{{ t('drink.dishes') }}</h2><p class="dim sm">{{ t('drink.dishes.sub') }}</p></div>
        @if (visible()) {
          <div class="dishes mt12">
            @for (h of dishes(); track h.id; let i = $index) {
              <a class="card hover dish" [class]="'card hover dish reveal reveal-' + (i + 1 > 5 ? 5 : i + 1)" [routerLink]="['/pair', h.id]">
                <ft-dish-photo [dishId]="h.id" [emoji]="h.emoji" variant="square" [name]="h.name" />
                <div class="dbody">
                  <h3 class="dn">{{ h.name }}</h3>
                  <p class="band" [class.warn]="h.r.capped || h.r.band === 'not_recommended'">{{ h.r.band_label }}</p>
                  @if (h.reason) { <p class="why">{{ h.reason }}</p> }
                </div>
                <ft-score [score]="h.r.score" [size]="54" [stroke]="5" />
              </a>
            } @empty {
              <div class="card card-p dim center">{{ t('drink.dishes.none') }}</div>
            }
          </div>
        } @else {
          <div class="card card-p dim mt12">{{ t('drink.dishes.none') }} {{ t(d.status === 'draft' ? 'drink.excluded.draft' : 'drink.excluded.not_confirmed') }}</div>
        }
      </section>

      @if (similar().length) {
        <section class="section">
          <div class="sh"><span class="eyebrow">{{ t('drink.similar') }}</span><h2>{{ t('drink.similar') }}</h2><p class="dim sm">{{ t('drink.similar.sub') }}</p></div>
          <div class="grid sim-grid mt12">
            @for (s of similar(); track s.drink.id) {
              <a class="card hover sim" [routerLink]="['/drinks', s.drink.id]">
                <span class="sim-art"><ft-drink-art [drink]="s.drink" [size]="60" [preferPhoto]="!!s.drink.image" /></span>
                <span class="sim-b">
                  <b class="sn">{{ s.drink.display_name || s.drink.name }}</b>
                  <span class="muted xs ellipsis">{{ s.drink.style?.name || t(catOf(s.drink)) }}</span>
                  <span class="amber xs b">{{ t('drink.similarity', { n: pct(s.similarity) }) }}</span>
                </span>
                <ft-icon name="chevron-right" [size]="18" />
              </a>
            }
          </div>
        </section>
      }

      <section class="section">
        <div class="card card-p"><ft-review-summary [drinkId]="d.id" /></div>
      </section>
    } @else if (data.drinks() === null) {
      <section class="hero card mt12" aria-busy="true">
        <div class="stage"><div class="skeleton sk-art"></div></div>
        <div class="info"><div class="skeleton sk-l"></div><div class="skeleton sk-h mt12"></div><div class="skeleton sk-l mt12"></div></div>
      </section>
    } @else {
      <div class="card card-p center mt12"><p class="dim">{{ t('drink.notFound') }}</p><a routerLink="/drinks" class="btn btn-primary mt12">{{ t('drink.back') }}</a></div>
    }
  `,
  styles: [`
    .desc-src { font-style: italic; color: var(--ink-4); font-size: .85em; }
    .hero { position: relative; overflow: hidden; display: grid; gap: 14px; padding: 18px; }
    @media (min-width: 720px) { .hero { grid-template-columns: 280px 1fr; gap: 28px; padding: 28px; } }
    .stage { display: grid; place-items: center; min-height: 200px; border-radius: var(--r-md); background: radial-gradient(70% 55% at 50% 88%, var(--gold-glow), transparent), var(--surface-2); border: 1px solid var(--line-2); }
    @media (min-width: 720px) { .stage { min-height: 280px; } }
    .info { position: relative; min-width: 0; }
    .nm { font-size: clamp(1.9rem, 4.6vw + .6rem, 3.1rem); line-height: 1.04; }
    .prod { color: var(--gold-soft); font-size: 1.15rem; margin-top: 4px; }
    .desc { max-width: 60ch; }
    .badge.efes { color: var(--on-gold); background: var(--grad-amber); border-color: transparent; }
    .note { display: flex; gap: 6px; align-items: flex-start; font-size: .8rem; color: var(--ink-3); }
    .note ft-icon { color: var(--gold); flex-shrink: 0; margin-top: 3px; }
    .facts { display: grid; grid-template-columns: 1fr; gap: 10px 20px; }
    @media (min-width: 540px) { .facts { grid-template-columns: 1fr 1fr; } }
    .fact { display: grid; gap: 2px; padding: 10px 12px; border-radius: var(--r-sm); background: rgba(255, 248, 235, .025); border: 1px solid var(--line-2); min-width: 0; }
    dt { font-size: .66rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-3); }
    dd { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; min-width: 0; }
    .fv { font-size: 1.15rem; color: var(--ink); }
    .fs { font-size: .74rem; color: var(--ink-3); }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .excluded { display: flex; gap: 12px; align-items: flex-start; padding: 14px 16px; border-color: rgba(229, 112, 90, .35); }
    .excluded ft-icon { color: var(--warn); flex-shrink: 0; margin-top: 2px; }
    .mt4 { margin-top: 4px; }
    .two { display: grid; gap: 14px; }
    @media (min-width: 900px) { .two { grid-template-columns: 1fr 1fr; align-items: start; } }
    .axes { display: grid; gap: 7px; }
    .ax { display: grid; grid-template-columns: 112px 1fr 38px; align-items: center; gap: 10px; font-size: .8rem; color: var(--ink-2); font-weight: 600; }
    .ax .al { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ax b { text-align: right; color: var(--ink-3); font-size: .9rem; }
    .temp { display: flex; align-items: center; gap: 6px; font-size: .84rem; color: var(--ink-2); }
    .temp ft-icon { color: var(--gold); }
    .temp b { color: var(--ink); font-size: 1rem; }
    .lbl { font-size: .66rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-3); }
    .chip.tag { --w: .5; background: color-mix(in srgb, var(--gold) calc(var(--w) * 22%), var(--surface)); border-color: color-mix(in srgb, var(--gold) calc(var(--w) * 60%), var(--line)); }
    .chip .n { opacity: .65; font-size: .7rem; }
    .conf { display: flex; align-items: center; gap: 14px; }
    .conf .big { font-size: 2.4rem; color: var(--gold-soft); line-height: 1; }
    .steps { padding-left: 20px; display: grid; gap: 8px; font-size: .84rem; color: var(--ink-2); line-height: 1.45; }
    .steps li::marker { color: var(--gold); font-weight: 700; font-family: var(--font-display); }
    .sk { height: 120px; }
    .sk-art { width: 120px; height: 168px; }
    .sk-l { height: 16px; width: 60%; }
    .sk-h { height: 40px; width: 80%; }
    .sh h2 { margin-top: 6px; }
    .srcs { list-style: none; display: grid; gap: 8px; padding: 0; }
    @media (min-width: 900px) { .srcs { grid-template-columns: 1fr 1fr; } }
    .src { padding: 12px 14px; display: grid; gap: 8px; }
    .su { display: grid; grid-template-columns: 1fr auto; grid-template-areas: 'host icon' 'title icon'; align-items: center; column-gap: 10px; color: inherit; }
    .su .host { grid-area: host; font-size: .7rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--gold); }
    .su .title { grid-area: title; font-size: .86rem; color: var(--ink-2); overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .su ft-icon { grid-area: icon; color: var(--ink-3); }
    .su:hover .title { color: var(--gold-soft); }
    .what { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .chip.ghost { background: transparent; border-color: var(--line-2); min-height: 24px; font-size: .7rem; }
    .dishes { display: grid; gap: 10px; }
    @media (min-width: 720px) { .dishes { grid-template-columns: 1fr 1fr; gap: 14px; } }
    .dish { display: grid; grid-template-columns: 84px 1fr auto; gap: 12px; align-items: center; padding: 10px 12px 10px 10px; }
    .dish ft-dish-photo { width: 84px; }
    .dbody { min-width: 0; display: grid; gap: 2px; }
    .dn { font-size: 1.15rem; font-weight: 700; line-height: 1.12; }
    .band { font-family: var(--font-display); font-style: italic; font-weight: 600; color: var(--gold-soft); font-size: .96rem; }
    .band.warn { color: var(--warn); }
    .why { font-size: .76rem; color: var(--ink-3); line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .sim-grid { grid-template-columns: 1fr; gap: 10px; }
    @media (min-width: 640px) { .sim-grid { grid-template-columns: 1fr 1fr; } }
    @media (min-width: 1000px) { .sim-grid { grid-template-columns: repeat(4, 1fr); } }
    .sim { display: flex; align-items: center; gap: 12px; padding: 10px 12px; }
    .sim-art { display: grid; place-items: center; width: 60px; height: 72px; border-radius: 12px; background: radial-gradient(70% 55% at 50% 90%, var(--gold-glow), transparent), var(--surface-2); flex-shrink: 0; }
    .sim-b { display: grid; gap: 2px; min-width: 0; flex: 1; }
    .sn { font-family: var(--font-display); font-size: 1.02rem; line-height: 1.15; }
    .sim ft-icon { color: var(--ink-3); flex-shrink: 0; }
  `],
})
export class DrinkDetailPage {
  data = inject(DataV2Service);
  i18n = inject(I18nService);
  private pairing = inject(PairingV2Service);
  private progress = inject(ProgressService);
  readonly t = this.i18n.t;

  id = input.required<string>();
  readonly wide = signal(typeof matchMedia === 'function' && matchMedia('(min-width: 720px)').matches);
  readonly full = signal<DrinkFull | null>(null);
  readonly fullLoading = signal(false);

  readonly drink = computed<DrinkV2 | null>(() => this.data.drink(this.id()) ?? null);
  /** Фото бутылки (17 брендов Efes) узкое — ему нужна бо́льшая высота, чем нарисованному бокалу. */
  readonly artSize = computed(() => (this.drink()?.image ? (this.wide() ? 268 : 210) : (this.wide() ? 230 : 168)));
  readonly visible = computed(() => { const d = this.drink(); return !!d && isGuestVisible(d); });
  readonly isEfes = computed(() => (this.drink()?.efes_relation ?? 'none') !== 'none');
  readonly name = computed(() => { const d = this.drink(); return d ? d.display_name || d.name : ''; });
  readonly catKey = computed(() => `v2.cat.${this.drink()?.category}` as I18nKey);
  readonly relKey = computed(() => `v2.rel.${this.drink()?.efes_relation}` as I18nKey);
  readonly srcKey = computed(() => `v2.src.${this.drink()?.vector_source ?? 'category_prior'}` as I18nKey);
  readonly conf = computed(() => Math.round((this.drink()?.vector_confidence ?? 0.5) * 100));
  readonly labeledAs = computed(() => { const l = this.drink()?.flags?.['labeled_as']; return typeof l === 'string' ? l : ''; });
  readonly producer = computed(() => {
    const p = this.drink()?.producer; if (!p?.name) return '';
    const parts = [p.name];
    if (p.country && p.country !== 'ZZ') parts.push(p.country);
    if (p.group && p.group !== p.name) parts.push(p.group);
    return parts.join(' · ');
  });

  readonly facts = computed<Fact[]>(() => {
    const d = this.drink(); if (!d) return [];
    const out: Fact[] = [];
    const abv = d.abv === null || d.abv === undefined ? '—' : `${d.flags?.abv_unknown ? '≈' : ''}${String(d.abv).replace('.', ',')} %`;
    out.push({ k: 'drink.abv', v: abv, src: d.abv_source ? this.t('drink.source', { s: this.t(`v2.abvsrc.${d.abv_source}` as I18nKey) }) : undefined });
    if (d.ibu !== null && d.ibu !== undefined) {
      out.push({ k: 'drink.ibu', v: String(d.ibu), src: d.ibu_source ? this.t('drink.source', { s: this.t(`v2.ibusrc.${d.ibu_source}` as I18nKey) }) : undefined });
    } else if (d.ibu_source && d.ibu_source !== 'none') {
      out.push({ k: 'drink.ibu', v: '—', src: `${this.t('v2.ibusrc.none')} · ${this.t('v2.src.bjcp_prior')}` });
    }
    const s = d.serving;
    if (s && s.temp_min_c !== null && s.temp_min_c !== undefined && s.temp_max_c !== null && s.temp_max_c !== undefined) {
      out.push({ k: 'drink.serve', v: `${this.fmt(s.temp_min_c)}–${this.fmt(s.temp_max_c)} °C`, src: s.glass || undefined });
    }
    out.push({ k: 'drink.price', ...this.price(d) });
    const lvl = d.availability_kz?.level ?? 'unknown';
    out.push({ k: 'drink.availability', v: this.t(`v2.av.${lvl}` as I18nKey), src: this.availabilityNote() });
    return out;
  });

  readonly axes = computed(() => {
    const v = this.drink()?.sensory ?? {};
    return TASTE_AXES.map(k => ({ k, l: `v2.bax.${k}` as I18nKey, v: Math.max(0, Math.min(1, v[k] ?? 0)) }));
  });
  readonly serveTemp = computed(() => {
    const d = this.drink(); const t = d?.sensory?.['serve_temp'];
    return t === undefined || t === null ? '—' : `${this.fmt(t)} °C`;
  });
  readonly aromas = computed(() => {
    const tags = this.drink()?.aroma_tags ?? {};
    const ru = this.data.params.labels.tags;
    const l = this.i18n.locale();
    return Object.entries(tags).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([id, w]) => ({ id, w, label: l === 'ru' ? ru[id] ?? id : TAG_LABELS_L10N[id]?.[l] ?? ru[id] ?? id }));
  });
  readonly notes = computed(() => this.full()?.vector_notes ?? []);
  readonly sources = computed(() => this.full()?.sources ?? []);
  readonly availabilityNote = computed(() => {
    const a = this.full()?.availability_kz; if (!a) return undefined;
    const parts: string[] = [];
    if (a.channels?.length) parts.push(a.channels.join(', '));
    if (a.last_checked) parts.push(this.t('drink.sources.accessed', { date: a.last_checked }));
    return parts.join(' · ') || undefined;
  });

  readonly dishes = computed<DishHit[]>(() => {
    const d = this.drink(); if (!d || !this.visible()) return [];
    const res = this.pairing.forDrink(d.id, {}, 8);
    return (res?.items ?? []).map(r => {
      const dish = this.data.dish(r.dish_id);
      return { r, id: r.dish_id, name: this.i18n.dishNameById(r.dish_id, dish?.display_name || dish?.name || r.dish_name), emoji: dish?.emoji || '🍽️', reason: r.reasons[0]?.text ?? '' };
    });
  });
  readonly similar = computed(() => { const d = this.drink(); return d && this.visible() ? this.pairing.similar(d.id, 4) : []; });

  constructor() {
    this.data.ensureDrinks().catch(() => { /* ошибку показывает каталог */ });
    if (typeof matchMedia === 'function') matchMedia('(min-width: 720px)').addEventListener('change', e => this.wide.set(e.matches));
    // полная запись (заметки о расчёте, источники) — лениво, по id
    effect(() => {
      const id = this.id();
      untracked(() => {
        this.full.set(null); this.fullLoading.set(true);
        this.data.fullDrink(id).then(f => { if (this.id() === id) { this.full.set(f); this.fullLoading.set(false); } })
          .catch(() => { if (this.id() === id) this.fullLoading.set(false); });
      });
    }, { allowSignalWrites: true });
    effect(() => {
      const d = this.drink();
      if (d) this.progress.award('explore', d.id, untracked(() => this.t('drink.award', { name: this.name() })));
    }, { allowSignalWrites: true });
  }

  fx(x: number): string { return (Math.round(x * 100) / 100).toFixed(2).replace('.', ','); }
  pct(x: number): number { return Math.round(x * 100); }
  fmt(x: number): string { return String(Math.round(x * 10) / 10).replace('.', ','); }
  catOf(d: DrinkV2): I18nKey { return `v2.cat.${d.category}` as I18nKey; }
  what(w: string): string { const k = `drink.what.${w}` as I18nKey; const s = this.t(k); return s === k ? w : s; }
  host(url: string): string { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } }

  private price(d: DrinkV2): { v: string; src?: string } {
    const p = d.price_kzt; if (!p) return { v: '—', src: this.t('drink.price.none') };
    const extra = p as unknown as Record<string, unknown>;   // retail_is_estimate / horeca_is_estimate / horeca_max — поля полной записи
    const n = (x: number) => x.toLocaleString('ru-RU');
    const est = (flag: unknown) => (flag ? '≈ ' : '');
    const src: string[] = [];
    let v = '';
    if (p.retail_min !== undefined && p.retail_min !== null) {
      const max = p.retail_max ?? p.retail_min;
      v = `${est(extra['retail_is_estimate'] ?? p.is_estimate)}${max !== p.retail_min ? `${n(p.retail_min)}–${n(max)}` : n(p.retail_min)} ₸`;
      if (p.unit_ml) v += ` / ${p.unit_ml} мл`;
      src.push(this.t('drink.price.retail'));
    }
    if (p.horeca !== undefined && p.horeca !== null) {
      const hmax = typeof extra['horeca_max'] === 'number' ? extra['horeca_max'] as number : undefined;
      const h = `${est(extra['horeca_is_estimate'] ?? p.is_estimate)}${hmax && hmax !== p.horeca ? `${n(p.horeca)}–${n(hmax)}` : n(p.horeca)} ₸`;
      if (!v) { v = h; src.push(this.t('drink.price.horeca')); } else src.push(`${this.t('drink.price.horeca')} ${h}`);
    }
    if (!v) return { v: '—', src: this.t('drink.price.none') };
    if (p.is_estimate) src.push(this.t('drink.price.estimate'));
    return { v, src: src.join(' · ') };
  }
}

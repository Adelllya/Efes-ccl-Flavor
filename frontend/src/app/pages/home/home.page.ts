import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../core/data.service';
import { DataV2Service } from '../../core/data-v2.service';
import { cuisineLabel } from '../../core/cuisines-v2';
import { ProgressService } from '../../core/progress.service';
import { VenueService } from '../../core/venue.service';
import { IconComponent, IconName } from '../../ui/icon.component';
import { BeerCardComponent } from '../../ui/beer-card.component';
import { SectionHeadComponent } from '../../ui/section.component';
import { I18nKey, I18nService } from '../../core/i18n.service';
import factsJson from '../../../../../data/facts.json';

interface Scenario { id: string; icon: string; title: I18nKey; desc: I18nKey; link: any[]; query?: Record<string, string>; badge: I18nKey; }

@Component({
  selector: 'ft-home',
  standalone: true,
  imports: [RouterLink, FormsModule, IconComponent, BeerCardComponent, SectionHeadComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- HERO -->
    <section class="hero">
      <span class="eyebrow reveal">OneIdea Championship 2026 × Efes Kazakhstan</span>
      <h1 class="reveal reveal-1">{{ t('home.h1a') }} <span class="grad-text">{{ t('home.h1b') }}</span></h1>
      <p class="lede reveal reveal-2">{{ t('home.lede') }}</p>

      <form class="search hero-search reveal reveal-3" role="search" (submit)="submit($event)">
        <ft-icon name="search" />
        <input class="input" type="search" name="q" autocomplete="off" enterkeyhint="search" [placeholder]="t('home.search.ph')" [ngModel]="q()" (ngModelChange)="q.set($event)" (focus)="focused.set(true)" (blur)="blurSoon()" [attr.aria-label]="t('home.search.aria')" />
        <button type="submit" class="btn btn-primary go" [attr.aria-label]="t('home.search.go')"><ft-icon name="arrow-right" /></button>
        @if (focused() && hits().length) {
          <ul class="suggest" role="listbox">
            @for (h of hits(); track h.dish.id) {
              <li><button type="button" (mousedown)="go(h.dish.id)"><span>{{ h.dish.emoji }}</span><span class="grow">{{ i18n.dishName({ id: h.dish.id, display_name: h.dish.display_name || h.dish.name }) }}</span><span class="muted xs">{{ cuisineOf(h.dish.cuisine) }}</span></button></li>
            }
          </ul>
        }
      </form>
      <a routerLink="/scan" class="scan-cta reveal reveal-4"><span class="sc-ico">📷</span><span><b>{{ t('home.scan.t') }}</b><br><span class="dim sm">{{ t('home.scan.d') }}</span></span><ft-icon name="chevron-right" /></a>

      <div class="choices reveal reveal-4">
        <a routerLink="/pair" class="choice">
          <span class="ch-ico"><ft-icon name="dish" [size]="28" /></span>
          <span class="ch-t">{{ t('home.ch.have') }} <em>{{ t('home.ch.dish') }}</em>{{ t('home.ch.post') }}</span>
          <span class="ch-d">{{ t('home.ch.dishD') }}</span>
          <span class="ch-cta">{{ t('home.ch.cta') }} <ft-icon name="arrow-right" [size]="16" /></span>
        </a>
        <a routerLink="/drinks" class="choice alt">
          <span class="ch-ico"><ft-icon name="glass" [size]="28" /></span>
          <span class="ch-t">{{ t('home.ch.have') }} <em>{{ t('home.ch.drink') }}</em>{{ t('home.ch.post') }}</span>
          <span class="ch-d">{{ t('home.ch.drinkD') }}</span>
          <span class="ch-cta">{{ t('home.ch.cta') }} <ft-icon name="arrow-right" [size]="16" /></span>
        </a>
      </div>
      <a routerLink="/table" [queryParams]="{ preset: 'dastarkhan' }" class="scan-cta table-cta reveal reveal-4"><span class="sc-ico">🍽️</span><span><b>{{ t('home.table.t') }}</b><br><span class="dim sm">{{ t('home.table.d') }}</span></span><ft-icon name="chevron-right" /></a>

      <div class="stats reveal reveal-5">
        <span><b>{{ v2.drinks() ? v2.stats().drinks : '…' }}</b> {{ t('home.st.drinks', { m: v2.drinks() ? v2.stats().nonEfes : '…' }) }}</span>
        <span><b>{{ v2.stats().dishes }}</b> {{ t('home.st.dishes', { c: nCuisines() }) }}</span>
        <span><b>{{ nRules() }}</b> {{ t('home.st.rules', { v: nVetoes() }) }}</span>
        <span><b>{{ v2.classicsList.length }}</b> {{ t('home.st.classics') }}</span>
      </div>
    </section>

    @if (venue.session(); as s) {
      <a class="soft venue-banner" routerLink="/qr/{{ s.token }}">
        <ft-icon name="map-pin" [size]="22" />
        <span><b>{{ s.venue.name }}</b>{{ t('home.venue', { table: s.table, n: s.venue.brands.length }) }}</span>
        <ft-icon name="chevron-right" />
      </a>
    }

    <!-- СЦЕНАРИИ -->
    <section class="section">
      <ft-section-head [eyebrow]="t('home.sc.eyebrow')" [title]="t('home.sc.title')" [sub]="t('home.sc.sub')" />
      <div class="grid grid-3">
        @for (s of scenarios; track s.id) {
          <a class="card hover card-p sc" [routerLink]="s.link" [queryParams]="s.query || null">
            <span class="sc-ico">{{ s.icon }}</span>
            <h3>{{ t(s.title) }}</h3>
            <p class="dim sm">{{ t(s.desc) }}</p>
            <div class="flex jb ac mt12"><span class="badge">{{ t(s.badge) }}</span><span class="amber b sm">{{ t('home.sc.open') }}</span></div>
          </a>
        }
      </div>
    </section>

    <!-- КАК РАБОТАЕТ -->
    <section class="section">
      <ft-section-head [eyebrow]="t('home.how.eyebrow')" [title]="t('home.how.title')" [sub]="t('home.how.sub')" />
      <div class="grid grid-3">
        @for (st of steps(); track st.n) {
          <div class="card card-p step">
            <div class="step-n">{{ st.n }}</div>
            <div class="step-ico"><ft-icon [name]="st.icon" [size]="24" /></div>
            <h3>{{ st.title }}</h3>
            <p class="dim sm">{{ st.text }}</p>
          </div>
        }
      </div>
      <div class="center mt16"><a routerLink="/method" class="btn btn-ghost">{{ t('home.method') }} <ft-icon name="arrow-right" [size]="16" /></a></div>
    </section>

    <!-- СОРТА -->
    <section class="section">
      <ft-section-head [eyebrow]="t('home.pf.eyebrow')" [title]="t('home.pf.title')" [sub]="t('home.pf.sub')"><a routerLink="/beers" class="btn btn-secondary btn-sm hide-mobile">{{ t('home.pf.all', { n: data.stats().brands }) }}</a></ft-section-head>
      <div class="scroll-x">
        @for (b of featured(); track b.id) { <div class="fb"><ft-beer-card [brand]="b" /></div> }
        <a routerLink="/beers" class="card hover fb more"><ft-icon name="arrow-right" [size]="26" /><span>{{ t('home.pf.more') }}</span></a>
      </div>
    </section>

    <!-- ФАКТ + АКАДЕМИЯ -->
    <section class="section grid grid-2">
      <div class="soft card-p fact">
        <span class="eyebrow">{{ t('home.fact') }}</span>
        <div class="fact-body pop" [attr.key]="factIdx()"><span class="fact-emoji">{{ fact().emoji }}</span><p>{{ factText() }}</p></div>
        <div class="flex g8 mt12"><button type="button" class="btn btn-secondary btn-sm" (click)="nextFact()"><ft-icon name="refresh" [size]="16" /> {{ t('home.fact.next') }}</button><span class="muted xs" style="align-self:center">{{ factIdx() + 1 }} / {{ facts.length }}</span></div>
      </div>
      <div class="card card-p acad">
        <span class="eyebrow">{{ t('home.acad') }}</span>
        <h3 class="mt8">{{ progress.level().title }} · {{ progress.xp() }} XP</h3>
        <p class="dim sm mt8">{{ progress.nextLevel() ? t('home.acad.next', { title: progress.nextLevel()!.title, xp: progress.nextLevel()!.xp_required - progress.xp() }) : t('home.acad.max') }}</p>
        <div class="bar mt12"><i [style.width.%]="progress.levelProgress() * 100"></i></div>
        <div class="flex g8 mt16 wrap"><a routerLink="/academy" class="btn btn-primary btn-sm"><ft-icon name="book" [size]="16" /> {{ t('home.acad.learn') }}</a><a routerLink="/dna" class="btn btn-secondary btn-sm"><ft-icon name="user" [size]="16" /> {{ t('home.acad.dna') }}</a></div>
      </div>
    </section>

    <p class="center accent-serif muted mt32" style="font-size:1.25rem">«Don't just drink — listen to the flavor»</p>
  `,
  styles: [`
    .hero { text-align: center; padding: 22px 0 8px; }
    @media (min-width: 900px) { .hero { padding: 40px 0 16px; } }
    .hero h1 { margin: 12px auto 12px; max-width: 14ch; }
    .hero .lede { margin: 0 auto 22px; }
    .hero-search { max-width: 620px; margin: 0 auto; }
    .scan-cta { display: flex; align-items: center; gap: 12px; max-width: 620px; margin: 12px auto 0; padding: 12px 14px; border-radius: var(--r-lg); background: var(--surface); border: 1.5px solid var(--line); box-shadow: var(--shadow-1); text-align: left; transition: transform var(--t-fast), border-color var(--t-fast); }
    .scan-cta:hover { transform: translateY(-2px); border-color: var(--amber-400); }
    .scan-cta > span:nth-child(2) { flex: 1; }
    .table-cta { margin-top: 12px; }
    .sc-ico { width: 44px; height: 44px; border-radius: 14px; background: var(--grad-amber); display: grid; place-items: center; font-size: 1.3rem; flex-shrink: 0; }
    .hero-search .input { min-height: 56px; padding-right: 64px; border-radius: var(--r-lg); box-shadow: var(--shadow-1); }
    .go { position: absolute; right: 6px; top: 6px; bottom: 6px; min-height: 0; width: 48px; padding: 0; border-radius: 12px; }
    .suggest { position: absolute; left: 0; right: 0; top: calc(100% + 6px); background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); box-shadow: var(--shadow-2); list-style: none; z-index: 20; overflow: hidden; text-align: left; }
    .suggest button { width: 100%; display: flex; gap: 10px; align-items: center; padding: 12px 14px; font-weight: 600; }
    .suggest button:hover { background: var(--amber-100); }
    .choices { display: grid; gap: 12px; margin: 22px auto 0; max-width: 760px; }
    @media (min-width: 640px) { .choices { grid-template-columns: 1fr 1fr; gap: 16px; } }
    .choice { position: relative; display: flex; flex-direction: column; align-items: flex-start; text-align: left; gap: 6px; padding: 20px; border-radius: var(--r-xl); background: var(--surface); border: 1.5px solid var(--line); box-shadow: var(--shadow-1); transition: transform var(--t-med) var(--ease), box-shadow var(--t-med), border-color var(--t-med); overflow: hidden; }
    .choice::after { content: ''; position: absolute; right: -40px; top: -40px; width: 160px; height: 160px; border-radius: 50%; background: radial-gradient(circle, rgba(245,185,66,.35), transparent 70%); }
    .choice:hover { transform: translateY(-4px); box-shadow: var(--shadow-2); border-color: var(--amber-400); }
    .ch-ico { width: 52px; height: 52px; border-radius: 16px; background: var(--grad-amber); color: #fff; display: grid; place-items: center; box-shadow: var(--shadow-amber); }
    .alt .ch-ico { background: var(--ink); box-shadow: none; }
    .ch-t { font-family: var(--font-display); font-weight: 800; font-size: 1.35rem; margin-top: 6px; }
    .ch-t em { font-style: normal; color: var(--amber-600); }
    .ch-d { color: var(--ink-3); font-size: .9rem; }
    .ch-cta { margin-top: 6px; display: inline-flex; align-items: center; gap: 6px; font-weight: 700; color: var(--amber-700); }
    .stats { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: center; gap: 8px 22px; margin-top: 26px; color: var(--ink-3); font-size: .85rem; }
    .stats b { color: var(--gold-soft); font-family: var(--font-display); font-size: 1.45rem; font-weight: 600; font-variant-numeric: lining-nums tabular-nums; letter-spacing: -.02em; margin-right: 2px; }
    .venue-banner { display: flex; align-items: center; gap: 12px; padding: 14px 16px; margin-top: 20px; color: var(--amber-900); }
    .venue-banner span { flex: 1; font-size: .92rem; }
    .sc { display: block; }
    .sc-ico { font-size: 2rem; display: block; margin-bottom: 8px; }
    .step { position: relative; }
    .step-n { position: absolute; top: 14px; right: 16px; font-family: var(--font-display); font-weight: 800; font-size: 2.4rem; color: var(--amber-100); line-height: 1; }
    .step-ico { width: 44px; height: 44px; border-radius: 12px; background: var(--grad-amber-soft); color: var(--amber-700); display: grid; place-items: center; margin-bottom: 12px; }
    .fb { width: 210px; }
    .fb.more { display: grid; place-items: center; align-content: center; gap: 8px; font-weight: 700; color: var(--amber-700); min-height: 200px; }
    .fact-body { display: flex; gap: 12px; align-items: flex-start; margin-top: 10px; }
    .fact-emoji { font-size: 2rem; }
    .fact p { font-size: 1.02rem; line-height: 1.5; }
  `],
})
export class HomePage {
  data = inject(DataService);
  v2 = inject(DataV2Service);
  progress = inject(ProgressService);
  venue = inject(VenueService);
  i18n = inject(I18nService);
  t = this.i18n.t;
  private router = inject(Router);

  q = signal('');
  focused = signal(false);
  hits = computed(() => this.v2.searchDishes(this.q(), 6));
  readonly nCuisines = computed(() => new Set(this.v2.dishes().flatMap(d => d.cuisine ?? [])).size);
  /** Правила движка — ключи R* параметров без выключенных (R18 — опция); вето — params.vetoes.order. */
  readonly nRules = computed(() => Object.entries(this.v2.params as unknown as Record<string, { enabled?: boolean }>).filter(([k, v]) => /^R\d+$/.test(k) && v?.enabled !== false).length);
  readonly nVetoes = computed(() => this.v2.params.vetoes.order.length);
  featured = computed(() => ['efes-pilsener', 'kozel', 'legenda-777', 'khmelnoy-los', 'wukong-ju', 'stary-melnik'].map(id => this.data.brand(id)!).filter(Boolean));
  readonly facts = factsJson as { emoji: string; text: string; text_kk?: string; text_en?: string }[];
  factIdx = signal(Math.floor(Math.random() * this.facts.length));
  fact = computed(() => this.facts[this.factIdx()]);
  factText = computed(() => { const f = this.fact(), l = this.i18n.locale(); return (l === 'kk' ? f.text_kk : l === 'en' ? f.text_en : null) ?? f.text; });

  readonly scenarios: Scenario[] = [
    { id: 'kz', icon: '🥩', title: 'home.sc.kz.t', desc: 'home.sc.kz.d', link: ['/pair', 'beshbarmak'], badge: 'home.sc.kz.b' },
    { id: 'grill', icon: '🔥', title: 'home.sc.grill.t', desc: 'home.sc.grill.d', link: ['/pair', 'shashlyk'], query: { occasion: 'evening' }, badge: 'home.sc.grill.b' },
    { id: 'hot', icon: '☀️', title: 'home.sc.hot.t', desc: 'home.sc.hot.d', link: ['/pair', 'edamame'], query: { occasion: 'hot' }, badge: 'home.sc.hot.b' },
    { id: 'sushi', icon: '🍣', title: 'home.sc.sushi.t', desc: 'home.sc.sushi.d', link: ['/pair', 'sushi'], badge: 'home.sc.sushi.b' },
    { id: 'spicy', icon: '🌶️', title: 'home.sc.spicy.t', desc: 'home.sc.spicy.d', link: ['/pair', 'buffalo-wings'], badge: 'home.sc.spicy.b' },
    { id: 'dessert', icon: '🥧', title: 'home.sc.dessert.t', desc: 'home.sc.dessert.d', link: ['/pair', 'strudel'], query: { occasion: 'dessert' }, badge: 'home.sc.dessert.b' },
  ];
  readonly steps = computed<{ n: string; icon: IconName; title: string; text: string }[]>(() => [
    { n: '01', icon: 'glass', title: this.t('home.how.1t'), text: this.t('home.how.1d') },
    { n: '02', icon: 'dish', title: this.t('home.how.2t'), text: this.t('home.how.2d', { n: this.v2.stats().dishes }) },
    { n: '03', icon: 'bolt', title: this.t('home.how.3t', { r: this.nRules() }), text: this.t('home.how.3d', { v: this.nVetoes() }) },
  ]);

  constructor() { effect(() => { const id = setInterval(() => this.nextFact(), 9000); return () => clearInterval(id); }); }

  cuisineOf(c: string[] | undefined): string { return c?.length ? cuisineLabel(c[0], this.i18n.locale()) : ''; }
  submit(e: Event): void { e.preventDefault(); const h = this.hits()[0]; if (h) this.go(h.dish.id); else this.router.navigate(['/pair'], { queryParams: { q: this.q() } }); }
  go(id: string): void { this.router.navigate(['/pair', id]); }
  blurSoon(): void { setTimeout(() => this.focused.set(false), 150); }
  nextFact(): void { this.factIdx.update(i => (i + 1) % this.facts.length); }
}

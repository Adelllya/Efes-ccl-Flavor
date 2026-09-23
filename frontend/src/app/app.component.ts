import { ChangeDetectionStrategy, Component, Injector, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { IconComponent, IconName } from './ui/icon.component';
import { ProgressService } from './core/progress.service';
import { VenueService } from './core/venue.service';
import { ThemeService } from './core/theme.service';
import { I18nKey, I18nService } from './core/i18n.service';
import { LangSwitchComponent } from './ui/lang-switch.component';

interface Tab { id: string; path: string; label: I18nKey; icon: IconName; exact?: boolean; }

/** Оболочка: верхняя навигация (desktop) + нижняя панель вкладок (mobile) + переключатель языка + тост XP + фон с пузырьками. */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent, LangSwitchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bubbles" aria-hidden="true">
      @for (b of bubbles; track b.id) {
        <span class="bubble" [style.left.%]="b.left" [style.width.px]="b.size" [style.height.px]="b.size" [style.animation-duration.s]="b.dur" [style.animation-delay.s]="b.delay"></span>
      }
    </div>

    <header class="hdr" [class.scrolled]="scrolled()" [class.in-venue]="!!venue.session()">
      <div class="container hdr-in">
        <a routerLink="/" class="logo" [attr.aria-label]="t('shell.logo.aria')">
          <span class="mark"><svg viewBox="0 0 64 64" width="26" height="26" aria-hidden="true"><path d="M32 50V30" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M32 36c-6-2-10-6-11-11M32 33c6-2 10-6 11-11M32 41c-5-1-8-4-9-8M32 39c5-1 8-4 9-8" stroke="#fff" stroke-width="3.5" fill="none" stroke-linecap="round"/><circle cx="21" cy="24" r="4.5" fill="#fff"/><circle cx="43" cy="21" r="4.5" fill="#fff"/><circle cx="22.5" cy="32" r="3.8" fill="#fff"/><circle cx="41.5" cy="30" r="3.8" fill="#fff"/><circle cx="32" cy="18" r="5" fill="#fff"/></svg></span>
          <span class="wordmark">Flavor <em>Tree</em></span>
        </a>
        <nav class="nav hide-mobile" [attr.aria-label]="t('shell.nav.aria')">
          @for (tab of tabs; track tab.path) {
            <a [routerLink]="tab.path" [class.on]="navOn(tab)" [attr.aria-current]="navOn(tab) ? 'page' : null">{{ t(tab.label) }}</a>
          }
          <a routerLink="/about" routerLinkActive="on">{{ t('shell.about') }}</a>
          <a routerLink="/business" routerLinkActive="on" class="biz">{{ t('shell.business') }}</a>
        </nav>
        <div class="tools">
          @if (venue.session(); as s) {
            <a routerLink="/qr/{{ s.token }}" class="venue-chip" [title]="t('shell.venue.title')"><ft-icon name="map-pin" [size]="14" /> <span class="ellipsis">{{ t('shell.venue.chip', { venue: s.venue.name, table: s.table }) }}</span></a>
          }
          <a routerLink="/academy" class="xp" [title]="t('shell.xp.title')"><ft-icon name="bolt" [size]="14" /> {{ progress.xp() }} XP</a>
          <ft-lang-switch />
          <button type="button" class="btn btn-icon btn-ghost" (click)="theme.cycle()" [attr.aria-label]="t('shell.theme.aria', { theme: t(themeKey()) })" [title]="t('shell.theme.title')">
            <ft-icon [name]="theme.theme() === 'dark' ? 'moon' : 'sun'" [size]="18" />
          </button>
          <a routerLink="/pair" class="btn btn-primary btn-sm hide-mobile cta"><ft-icon name="sparkles" [size]="16" /> {{ t('shell.cta') }}</a>
        </div>
      </div>
    </header>

    <main class="container page" id="main">
      <router-outlet />
    </main>

    <footer class="ftr hide-mobile">
      <div class="container ftr-in">
        <div><strong>Flavor Tree</strong> · <span class="accent-serif">Don't just drink — listen to the flavor</span></div>
        <div class="muted sm">OneIdea Championship 2026 × Efes Kazakhstan · @if (v2stats(); as s) { @if (s.drinks) { {{ i18n.count(s.drinks, 'count.drinks') }} · } {{ i18n.count(s.dishes, 'count.dishes') }} · }<a routerLink="/method" class="amber">{{ t('shell.footer.engine') }} · {{ t('shell.footer.method') }}</a> · <a routerLink="/insights" class="amber">{{ t('shell.footer.insights') }}</a> · <a routerLink="/admin" class="amber">{{ t('shell.footer.admin') }}</a> · <a routerLink="/cabinet" class="amber">{{ t('shell.footer.cabinet') }}</a> · <a routerLink="/business" class="amber">{{ t('shell.footer.business') }}</a></div>
      </div>
    </footer>

    <nav class="tabbar hide-desktop" [attr.aria-label]="t('shell.tabbar.aria')">
      @for (tab of tabs; track tab.path) {
        <a [routerLink]="tab.path" class="tab" [class.on]="activeTab() === tab.id" [attr.aria-current]="activeTab() === tab.id ? 'page' : null">
          <ft-icon [name]="tab.icon" [size]="22" [stroke]="1.9" /><span class="ellipsis">{{ t(tab.label) }}</span>
        </a>
      }
    </nav>

    @if (progress.lastAward(); as a) {
      <div class="toast" role="status">✨ +{{ a.xp }} XP · {{ a.label }}</div>
    }
  `,
  styles: [`
    .bubbles { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
    .bubble { position: absolute; bottom: -40px; border-radius: 50%; background: radial-gradient(circle at 32% 28%, rgba(247,232,192,.55), rgba(229,184,73,.16) 45%, rgba(229,184,73,0) 72%); border: 1px solid rgba(229,184,73,.16); box-shadow: 0 0 12px rgba(229,184,73,.10); animation: rise linear infinite; opacity: 0; }
    @keyframes rise { 0% { transform: translateY(0); opacity: 0; } 10% { opacity: .7; } 85% { opacity: .35; } 100% { transform: translateY(-110vh) translateX(28px); opacity: 0; } }
    .hdr { position: sticky; top: 0; z-index: 100; background: color-mix(in srgb, var(--bg) 82%, transparent); backdrop-filter: blur(16px) saturate(1.3); -webkit-backdrop-filter: blur(16px) saturate(1.3); border-bottom: 1px solid transparent; transition: border-color var(--t-med), box-shadow var(--t-med); padding-top: var(--safe-t); }
    .hdr.scrolled { border-bottom-color: var(--line); box-shadow: 0 6px 24px -18px rgba(140,63,12,.35); }
    .hdr-in { height: var(--header-h); display: flex; align-items: center; gap: 16px; }
    .logo { display: flex; align-items: center; gap: 10px; font-family: var(--font-display); font-weight: 800; font-size: 1.2rem; letter-spacing: -.02em; white-space: nowrap; flex-shrink: 0; }
    .logo .mark { width: 38px; height: 38px; border-radius: 12px; background: var(--grad-amber); display: grid; place-items: center; box-shadow: var(--shadow-amber); }
    .wordmark em { font-style: normal; color: var(--amber-600); }
    .nav { display: flex; gap: 4px; margin-left: 12px; }
    .nav a { padding: 8px 14px; border-radius: var(--r-full); font-weight: 600; font-size: .9rem; color: var(--ink-2); white-space: nowrap; transition: background var(--t-fast), color var(--t-fast); }
    .nav a:hover { background: var(--amber-100); color: var(--amber-800); }
    .nav a.on { background: var(--ink); color: var(--bg); }
    .nav a.biz { color: var(--gold); }
    /* «Для бизнеса» активна: золотой текст на кремовой заливке не читался — заливаем золотом */
    .nav a.biz.on { background: var(--grad-amber); color: var(--on-gold); }
    .tools { margin-left: auto; display: flex; align-items: center; gap: 8px; min-width: 0; }
    .xp, .venue-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: var(--r-full); font-size: .8rem; font-weight: 700; background: var(--amber-100); color: var(--amber-800); white-space: nowrap; }
    .venue-chip { background: var(--info-bg); color: var(--info); max-width: 220px; }
    @media (max-width: 899px) { .venue-chip span { display: none; } .venue-chip { padding: 8px; } }
    /* телефон: переключатель языка важнее XP-чипа (XP виден в Академии); в заведении чип стола вытесняет словесный знак */
    @media (max-width: 480px) { .hdr-in { gap: 12px; } .xp { display: none; } .in-venue .wordmark { display: none; } }
    @media (max-width: 345px) { .wordmark { display: none; } }
    /* десктоп: переключатель языка занял ~110px — навигация плотнее; до 1280px CTA «Подобрать» (дубль вкладки «Подбор») и текст чипа заведения скрыты */
    @media (min-width: 900px) { .nav { margin-left: 4px; gap: 2px; } .nav a { padding: 8px 10px; } .tools { gap: 6px; } .venue-chip { max-width: 140px; } .in-venue .cta { display: none; } }
    @media (min-width: 900px) and (max-width: 1279px) { .cta { display: none; } .venue-chip span { display: none; } .venue-chip { padding: 8px; } }
    @media (min-width: 900px) and (max-width: 1099px) { .hdr-in { gap: 12px; } .xp { display: none; } .nav a { padding: 8px 8px; font-size: .84rem; } .logo { font-size: 1.05rem; } .in-venue .wordmark { display: none; } }
    .venue-chip span { min-width: 0; }
    main { position: relative; z-index: 1; min-height: 60vh; }
    .ftr { position: relative; z-index: 1; border-top: 1px solid var(--line); padding: 22px 0; color: var(--ink-2); font-size: .92rem; }
    .ftr-in { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .tabbar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 100; display: grid; grid-template-columns: repeat(5, 1fr); height: calc(var(--tabbar-h) + var(--safe-b)); padding-bottom: var(--safe-b); background: color-mix(in srgb, var(--surface) 90%, transparent); backdrop-filter: blur(18px) saturate(1.3); -webkit-backdrop-filter: blur(18px) saturate(1.3); border-top: 1px solid var(--line); }
    .tab { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-width: 0; font-size: .66rem; font-weight: 700; letter-spacing: .02em; color: var(--ink-3); transition: color var(--t-fast); }
    .tab span { max-width: 100%; padding-inline: 2px; }
    .tab.on { color: var(--amber-600); }
    .tab.on ft-icon { filter: drop-shadow(0 4px 8px rgba(224,138,40,.45)); }
  `],
})
export class AppComponent {
  progress = inject(ProgressService);
  venue = inject(VenueService);
  theme = inject(ThemeService);
  i18n = inject(I18nService);
  private router = inject(Router);
  private injector = inject(Injector);
  /** Счётчики v2 для подвала — появляются после ленивой загрузки сервиса (drinks = 0, пока каталог не пришёл). */
  readonly v2stats = signal<{ drinks: number; dishes: number } | null>(null);
  /** t() читает сигнал языка — вызов из шаблона подписывает шаблон на смену языка. */
  readonly t = this.i18n.t;

  /** label — ключ словаря, а не готовая строка: перевод берётся в шаблоне, иначе вкладки не переключались бы вместе с языком. */
  readonly tabs: Tab[] = [
    { id: 'home', path: '/', label: 'shell.tab.home', icon: 'home', exact: true },
    { id: 'pair', path: '/pair', label: 'shell.tab.pair', icon: 'sparkles' },
    { id: 'drinks', path: '/drinks', label: 'shell.tab.drinks', icon: 'glass' },
    { id: 'academy', path: '/academy', label: 'shell.tab.academy', icon: 'book' },
    { id: 'me', path: '/dna', label: 'shell.tab.me', icon: 'user' },
  ];
  readonly themeKey = computed(() => `shell.theme.${this.theme.theme()}` as const);
  readonly bubbles = Array.from({ length: 14 }, (_, i) => ({ id: i, left: 3 + Math.random() * 94, size: 6 + Math.random() * 16, dur: 9 + Math.random() * 12, delay: -Math.random() * 20 }));
  scrolled = signal(false);
  private nav = toSignal(this.router.events.pipe(filter(e => e instanceof NavigationEnd)));
  /** Вкладка нижней панели — из data.tab самого глубокого активного маршрута (пирамиды /beers → «Напитки», /about → «Главная»). */
  readonly activeTab = computed(() => {
    this.nav();
    let r = this.router.routerState.snapshot.root;
    while (r.firstChild) r = r.firstChild;
    return (r.data['tab'] as string | undefined) ?? 'home';
  });
  private readonly path = computed(() => { this.nav(); return this.router.url.split(/[?#]/)[0]; });

  constructor() {
    window.addEventListener('scroll', () => this.scrolled.set(window.scrollY > 8), { passive: true });
    // Каталог v2 (≈ 45 КБ gzip) нужен подбору, подвалу и счётчикам на главной — подгружаем на простое, не мешая первому кадру.
    // Сервис импортируется динамически: параметры движка и блюда (~260 КБ) остаются вне начального бандла.
    const warm = () => import('./core/data-v2.service').then(m => {
      const v2 = this.injector.get(m.DataV2Service);
      this.v2stats.set({ drinks: 0, dishes: v2.stats().dishes });
      return v2.ensureDrinks().then(() => this.v2stats.set({ drinks: v2.stats().drinks, dishes: v2.stats().dishes }));
    }).catch(() => { /* страницы покажут ошибку сами */ });
    if ('requestIdleCallback' in window) (window as Window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(warm);
    else setTimeout(warm, 1200);
  }

  /** Верхняя навигация: «Главная» — только сама главная (у /about и /business свои ссылки), остальные — по data.tab. */
  navOn(tab: Tab): boolean { return tab.exact ? this.path() === '/' : this.activeTab() === tab.id; }
}

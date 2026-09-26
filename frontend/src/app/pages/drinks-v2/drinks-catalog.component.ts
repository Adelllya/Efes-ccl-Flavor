import { Component, ElementRef, EventEmitter, HostListener, OnInit, Output, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { Brand } from '../../models/flavor-tree.models';
import { V2ApiService } from './v2-api.service';
import { V2Drink, V2DrinkDetail, V2Meta } from './v2.models';
import { V2GlassComponent, drinkLine, drinkTitle, isEfes, isEnergy, loadErrorText, priceLabel, reasonLines } from './v2-ui';
import { CATALOG_PATH, isSheetEntry, setUrlParams, urlParam } from './v2-url';
import { countOf } from '../venue-menu/plural';

const PAGE = 48;

/** Порядок в каталоге: сначала собственные марки Efes, потом дистрибуция и CCI, потом весь рынок. */
const EFES_ORDER: Record<string, number> = { own: 0, distribution: 1, cci: 2 };

function efesFirst(list: V2Drink[]): V2Drink[] {
  const rank = (d: V2Drink) => EFES_ORDER[d.efes_relation] ?? 3;
  return [...list].sort((a, b) => rank(a) - rank(b));
}

/**
 * Все 412 напитков движка v2: фильтр по категориям, поиск, портфель Efes (он идёт первым).
 * У 17 сортов Efes из каталога есть фото и своя страница с пирамидой: ведём туда.
 * Категория, поиск, фильтр Efes и открытый напиток живут в адресе (?cat=&q=&efes=1&drink=), см. v2-url.ts.
 */
@Component({
  selector: 'app-drinks-catalog',
  standalone: true,
  imports: [FormsModule, V2GlassComponent],
  template: `
    <div class="glass-panel v2-filters mb-xl">
      <button class="btn-outline" [class.active]="category() === ''" (click)="setCategory('')">
        Все{{ drinks().length ? ' (' + drinks().length + ')' : '' }}
      </button>
      @for (c of meta()?.categories ?? []; track c.id) {
        <button class="btn-outline" [class.active]="category() === c.id" (click)="setCategory(c.id)">
          {{ c.label }} ({{ c.n }})
        </button>
      }
    </div>

    <div class="flex justify-between items-center gap-lg flex-wrap mb-xl">
      <div class="v2-search">
        <input class="input" type="text" [ngModel]="query()" (ngModelChange)="query.set($event); limit.set(PAGE)"
               placeholder="Название, стиль или производитель..." aria-label="Поиск напитка" />
        @if (query()) {
          <button class="v2-clear" (click)="query.set('')" title="Очистить">&#x2715;</button>
        }
      </div>
      <button class="btn-outline" [class.active]="efesOnly()" (click)="efesOnly.set(!efesOnly()); limit.set(PAGE)">
        <span [style.color]="efesOnly() ? 'var(--beer-accent)' : 'inherit'">★</span>
        Только портфель Efes{{ meta() ? ' (' + meta()!.drinks_efes + ')' : '' }}
      </button>
    </div>

    @if (!loaded()) {
      <div class="skeleton-grid" aria-busy="true" aria-label="Загружаем напитки">
        @for (i of [1, 2, 3, 4, 5, 6]; track i) {
          <div class="skeleton-card"><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div></div>
        }
      </div>
    } @else if (loadError()) {
      <!-- Сбой API не выдаём за пустой каталог: честно пишем, что не загрузилось, и даём повторить -->
      <div class="glass-panel text-center p-4xl" role="alert">
        <p class="font-semibold mb-sm">Не удалось загрузить каталог напитков</p>
        <p class="text-muted text-sm mb-lg">{{ loadError() }}</p>
        <button class="btn-amber" (click)="reload()">Повторить</button>
      </div>
    } @else {
      <p class="text-sm text-muted mb-lg">
        Найдено: <strong style="color: var(--foam);">{{ filtered().length }}</strong> из {{ drinks().length }}
      </p>
      <div class="v2-grid">
        @for (d of shown(); track d.id) {
          <button type="button" class="glass-card v2-drink stagger-item" (click)="open(d)">
            @if (d.image || brandFor(d)?.image; as img) {
              <img class="v2-photo" [src]="img" [alt]="d.name" loading="lazy" decoding="async" />
            } @else {
              <v2-glass [category]="d.category" [size]="52" />
            }
            <span class="v2-drink-body">
              <span class="v2-badges">
                <span class="badge">{{ categoryLabel(d.category) }}</span>
                @if (isEfes(d.efes_relation)) { <span class="badge v2-efes">Efes</span> }
              </span>
              <strong class="v2-name">{{ title(d) }}</strong>
              <span class="text-muted text-sm v2-line">{{ drinkLine(d) }}</span>
              @if (priceLabel(d.price_kzt); as price) { <span class="text-xs text-muted">{{ price }}</span> }
            </span>
          </button>
        } @empty {
          <div class="glass-panel text-center p-4xl" style="grid-column: 1 / -1;">
            <p class="text-muted">По вашему запросу напитков не найдено.</p>
          </div>
        }
      </div>
      @if (filtered().length > shown().length) {
        <div class="text-center" style="margin-top: 24px;">
          <button class="btn-outline" (click)="limit.set(limit() + PAGE)">
            Показать ещё ({{ filtered().length - shown().length }})
          </button>
        </div>
      }
    }

    @if (selected(); as d) {
      <!-- dialog + showModal: верхний слой браузера, поверх шапки и кнопки ИИ-сомелье -->
      <dialog #sheet class="v2-sheet" [attr.aria-label]="d.name" (close)="close()" (click)="onDialogClick($event)">
      <div class="v2-sheet-inner">
        <button class="v2-sheet-close" (click)="close()" aria-label="Закрыть">&#x2715;</button>
        <div class="flex gap-lg items-center mb-lg">
          @if (d.image || brandFor(d)?.image; as img) {
            <img class="v2-photo v2-photo-lg" [src]="img" [alt]="d.name" decoding="async" />
          } @else {
            <v2-glass [category]="d.category" [size]="64" />
          }
          <div>
            <div class="v2-badges">
              <span class="badge">{{ categoryLabel(d.category) }}</span>
              @if (isEfes(d.efes_relation)) { <span class="badge v2-efes">Портфель Efes</span> }
            </div>
            <h2 class="v2-sheet-title">{{ title(d) }}</h2>
            <p class="text-muted text-sm">{{ drinkLine(d) }}</p>
          </div>
        </div>

        @if (d.image && d.image_credit; as c) {
          <p class="v2-credit mb-md">
            Фото: <a [href]="c.source" target="_blank" rel="noopener">{{ c.author || 'Wikimedia Commons' }}</a>,
            @if (c.license_url) {
              <a [href]="c.license_url" target="_blank" rel="noopener license">{{ c.license }}</a>
            } @else {
              {{ c.license }}
            }
          </p>
        }

        @if (d.description) { <p class="text-dim mb-lg" style="line-height: 1.5;">{{ d.description }}</p> }

        <div class="v2-facts mb-xl">
          @if (d.serving?.temp_min_c != null) {
            <div><span>Температура</span><strong>{{ d.serving!.temp_min_c }}-{{ d.serving!.temp_max_c }} °C</strong></div>
          }
          @if (d.serving?.glass) { <div><span>Бокал</span><strong>{{ d.serving!.glass }}</strong></div> }
          @if (d.producer?.country) { <div><span>Страна</span><strong>{{ d.producer!.country }}</strong></div> }
          @if (priceLabel(d.price_kzt); as price) { <div><span>Цена</span><strong>{{ price }}</strong></div> }
        </div>

        <h3 class="v2-h3 mb-md">С чем пить</h3>
        @if (isEnergy(d)) {
          <p class="text-muted text-sm">Энергетики к еде мы не советуем, поэтому блюда к ним не подбираем.</p>
        } @else if (detailLoading()) {
          <p class="text-muted text-sm">Подбираем блюда...</p>
        } @else if (detailError()) {
          <p class="text-muted text-sm mb-md">Не удалось подобрать блюда: сервер не ответил.</p>
          <button class="btn-outline btn-sm" (click)="loadDetail(d)">Повторить</button>
        } @else {
          @if (detail(); as det) {
          <ul class="v2-dishes">
            @for (p of det.best_dishes; track p.dish_id; let i = $index) {
              <li>
                <span class="v2-dish-row">
                  <strong>{{ p.dish_name }}</strong>
                  <span class="v2-dish-score" [attr.data-band]="p.band">{{ p.score }}</span>
                </span>
                @if (dishReasons()[i]; as why) {
                  <span class="text-sm text-muted" [attr.title]="why.source || null">{{ why.text }}</span>
                }
              </li>
            }
          </ul>
          }
        }

        @if (brandFor(d); as b) {
          <button class="btn-amber" style="width: 100%; margin-top: 20px;" (click)="openBrand.emit(b.id)">
            Вкусовая пирамида и подача
          </button>
        }
      </div>
      </dialog>
    }
  `,
  styles: [`
    .v2-filters { display: flex; flex-wrap: wrap; gap: 8px; padding: 14px 20px; }
    .v2-search { position: relative; width: 100%; max-width: 380px; }
    .v2-search .input { width: 100%; padding-right: 36px; }
    .v2-clear { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none;
      border: none; color: var(--muted); cursor: pointer; font-size: 16px; padding: 4px; }
    .v2-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
    .v2-drink { display: flex; gap: 14px; align-items: flex-start; padding: 16px 18px; text-align: left;
      cursor: pointer; font: inherit; color: inherit; width: 100%; }
    .v2-drink-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .v2-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 2px; }
    .v2-efes { background: rgba(245, 158, 11, 0.16); color: var(--beer-deep); }
    .v2-name { font-family: var(--font-heading); font-size: 1.05rem; font-weight: 700; line-height: 1.25; }
    .v2-line { overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .v2-photo { width: 52px; height: 52px; object-fit: contain; flex-shrink: 0; }
    .v2-photo-lg { width: 72px; height: 72px; }
    .v2-credit { margin-top: -8px; font-size: 0.72rem; color: var(--muted); }
    .v2-credit a { color: inherit; text-decoration: underline; }
    .v2-h3 { font-family: var(--font-heading); font-size: 1.15rem; font-weight: 700; }

    .v2-sheet { margin: 0 0 0 auto; padding: 0; border: none; height: 100dvh; max-height: 100dvh;
      width: min(460px, 100%); max-width: 100%; overflow-y: auto; color: var(--foam);
      background: #FFFCF8; box-shadow: var(--shadow-md); animation: v2-slide var(--duration-normal) var(--ease-out); }
    .v2-sheet::backdrop { background: rgba(28, 25, 23, 0.35); backdrop-filter: blur(2px); }
    .v2-sheet-inner { position: relative; min-height: 100%; padding: 28px 26px 32px; }
    @keyframes v2-slide { from { transform: translateX(24px); opacity: 0; } to { transform: none; opacity: 1; } }
    .v2-sheet-close { position: absolute; top: 14px; right: 14px; background: none; border: none; font-size: 18px;
      color: var(--muted); cursor: pointer; padding: 6px; }
    .v2-sheet-title { font-family: var(--font-heading); font-size: 1.45rem; font-weight: 800; line-height: 1.2; }
    .v2-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .v2-facts div { background: var(--glass); border: 1px solid var(--line-subtle); border-radius: var(--radius-md); padding: 10px 12px; }
    .v2-facts span { display: block; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
    .v2-facts strong { font-size: 0.92rem; }
    .v2-dishes { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    .v2-dishes li { display: flex; flex-direction: column; gap: 2px; padding-bottom: 10px; border-bottom: 1px solid var(--line-subtle); }
    .v2-dish-row { display: flex; justify-content: space-between; gap: 12px; }
    .v2-dish-score { font-family: var(--font-heading); font-weight: 800; color: var(--beer-mid); }
    .v2-dish-score[data-band="ideal"] { color: var(--success); }

    @media (max-width: 640px) {
      .v2-grid { grid-template-columns: 1fr; }
      /* Категории одной строкой с прокруткой: иначе 17 кнопок занимают весь первый экран */
      .v2-filters { flex-wrap: nowrap; overflow-x: auto; padding: 12px 14px; scrollbar-width: none; }
      .v2-filters::-webkit-scrollbar { display: none; }
      .v2-filters .btn-outline { flex-shrink: 0; white-space: nowrap; }
      .v2-search { max-width: none; }
      .v2-sheet { margin: auto 0 0 0; height: auto; max-height: 88dvh; width: 100%; border-radius: var(--radius-xl) var(--radius-xl) 0 0; }
      .v2-sheet-inner { padding: 24px 18px 28px; }
      @keyframes v2-slide { from { transform: translateY(24px); opacity: 0; } to { transform: none; opacity: 1; } }
    }
  `],
})
export class DrinksCatalogComponent implements OnInit {
  private v2 = inject(V2ApiService);
  private api = inject(ApiService);

  /** id сорта из каталога Efes: страница сорта с пирамидой. */
  @Output() openBrand = new EventEmitter<string>();

  readonly PAGE = PAGE;
  readonly isEfes = isEfes;
  readonly isEnergy = isEnergy;
  readonly drinkLine = drinkLine;
  readonly priceLabel = priceLabel;
  readonly countOf = countOf;

  meta = signal<V2Meta | null>(null);
  drinks = signal<V2Drink[]>([]);
  loaded = signal(false);
  /** Текст ошибки загрузки каталога; null, если всё загрузилось. */
  loadError = signal<string | null>(null);
  brands = signal<Brand[]>([]);
  category = signal(urlParam(CATALOG_PATH, 'cat') ?? '');
  query = signal(urlParam(CATALOG_PATH, 'q') ?? '');
  efesOnly = signal(urlParam(CATALOG_PATH, 'efes') === '1');
  limit = signal(PAGE);
  selected = signal<V2Drink | null>(null);
  detail = signal<V2DrinkDetail | null>(null);
  detailLoading = signal(false);
  detailError = signal(false);

  private categoryLabels = computed(() => new Map((this.meta()?.categories ?? []).map(c => [c.id, c.label])));
  private brandsByName = computed(() => new Map(this.brands().map(b => [b.name, b])));

  filtered = computed(() => {
    const cat = this.category();
    const efes = this.efesOnly();
    const q = this.query().trim().toLowerCase().replace(/ё/g, 'е');
    return this.drinks().filter(d => {
      if (cat && d.category !== cat) return false;
      if (efes && !isEfes(d.efes_relation)) return false;
      if (!q) return true;
      const hay = [d.name, d.display_name ?? '', d.style?.name ?? '', d.producer?.name ?? '']
        .join(' ').toLowerCase().replace(/ё/g, 'е');
      return hay.includes(q);
    });
  });

  shown = computed(() => this.filtered().slice(0, this.limit()));

  /** Одна причина на блюдо и без повторов в списке: иначе у многих блюд одна и та же фраза про баланс. */
  dishReasons = computed(() => {
    const used = new Set<string>();
    return (this.detail()?.best_dishes ?? []).map(p => {
      const [line] = reasonLines(p, 1, used);
      if (line) used.add(line.text);
      return line ?? null;
    });
  });

  constructor() {
    // Фильтры и поиск держим в адресе, не добавляя шагов истории: переживают перезагрузку и возврат со страницы сорта
    effect(() => setUrlParams(CATALOG_PATH, {
      cat: this.category() || null,
      q: this.query().trim() || null,
      efes: this.efesOnly() ? '1' : null,
    }));
  }

  ngOnInit() {
    this.load();
    this.api.getBrands().subscribe({ next: list => this.brands.set(list.filter(b => b.is_active !== false)) });
  }

  private load() {
    if (!this.meta()) {
      this.v2.meta().subscribe({
        next: m => {
          this.meta.set(m);
          // Категория из старой ссылки, которой больше нет: показываем все
          if (this.category() && !m.categories.some(c => c.id === this.category())) this.category.set('');
        },
        error: () => { /* без счётчиков категорий каталог всё равно работает */ },
      });
    }
    this.v2.drinks().subscribe({
      next: list => {
        this.drinks.set(efesFirst(list));
        this.loadError.set(null);
        this.loaded.set(true);
        this.showFromUrl();
      },
      error: err => { this.loadError.set(loadErrorText(err)); this.loaded.set(true); },
    });
  }

  /** Кнопка «Повторить» на экране ошибки. */
  reload() {
    this.loaded.set(false);
    this.loadError.set(null);
    this.load();
  }

  setCategory(id: string) {
    this.category.set(id);
    this.limit.set(PAGE);
  }

  categoryLabel(id: string): string {
    return this.categoryLabels().get(id) ?? id;
  }

  title(d: V2Drink): string {
    return drinkTitle(d.display_name || d.name);
  }

  /** Сорт из каталога Efes с тем же названием: у 17 напитков движка есть legacy_brand_id. */
  brandFor(d: V2Drink): Brand | null {
    return d.legacy_brand_id ? this.brandsByName().get(d.name) ?? null : null;
  }

  /** Карточка из списка: новая запись истории, чтобы «Назад» браузера закрывал карточку, а не уводил с сайта. */
  open(d: V2Drink) {
    this.show(d);
    setUrlParams(CATALOG_PATH, { drink: d.id }, true);
  }

  private show(d: V2Drink) {
    this.selected.set(d);
    this.loadDetail(d);
  }

  loadDetail(d: V2Drink) {
    this.detail.set(null);
    this.detailError.set(false);
    // Энергетики к еде не советуем: блюда к ним не запрашиваем
    this.detailLoading.set(!isEnergy(d));
    if (isEnergy(d)) return;
    this.v2.drinkDetail(d.id).subscribe({
      next: det => { if (this.selected()?.id === d.id) { this.detail.set(det); this.detailLoading.set(false); } },
      error: () => { if (this.selected()?.id === d.id) { this.detailError.set(true); this.detailLoading.set(false); } },
    });
  }

  /** Карточка из адреса: ссылка с ?drink=, «Назад» или «Вперёд» браузера. Незнакомый id убираем из адреса. */
  private showFromUrl() {
    const id = urlParam(CATALOG_PATH, 'drink');
    if (!id) {
      this.selected.set(null);
      return;
    }
    if (this.selected()?.id === id || !this.drinks().length) return;
    const d = this.drinks().find(x => x.id === id);
    if (d) this.show(d);
    else setUrlParams(CATALOG_PATH, { drink: null });
  }

  /** «Назад» и «Вперёд» браузера внутри каталога: фильтры и карточку берём из адреса. */
  @HostListener('window:popstate')
  onPopState() {
    if (location.pathname !== CATALOG_PATH) return;
    this.category.set(urlParam(CATALOG_PATH, 'cat') ?? '');
    this.query.set(urlParam(CATALOG_PATH, 'q') ?? '');
    this.efesOnly.set(urlParam(CATALOG_PATH, 'efes') === '1');
    this.showFromUrl();
  }

  @ViewChild('sheet') set sheet(ref: ElementRef<HTMLDialogElement> | undefined) {
    const dialog = ref?.nativeElement;
    if (dialog && !dialog.open) dialog.showModal();
  }

  /** Клик мимо содержимого приходится на сам dialog, то есть на подложку. */
  onDialogClick(event: MouseEvent) {
    if (event.target === event.currentTarget) this.close();
  }

  /**
   * Крестик, подложка и Escape (dialog закрывается сам и присылает close).
   * Карточку открыли кликом: убираем её шаг из истории. Открыли по ссылке: просто чистим адрес.
   */
  close() {
    if (!this.selected()) return;
    this.selected.set(null);
    if (!urlParam(CATALOG_PATH, 'drink')) return;
    if (isSheetEntry()) history.back();
    else setUrlParams(CATALOG_PATH, { drink: null });
  }
}

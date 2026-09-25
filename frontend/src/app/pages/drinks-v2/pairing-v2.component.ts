import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { V2ApiService } from './v2-api.service';
import { V2Dish, V2Meta, V2Pair, V2PairingResult } from './v2.models';
import { V2GlassComponent, drinkLine, firstWarning, isEfes, priceLabel, topReasons } from './v2-ui';
import { countOf } from '../venue-menu/plural';

/** Сколько блюд видно до «Все блюда»: самые узнаваемые идут первыми в dishes_v2.json. */
const DISHES_PREVIEW = 24;

/**
 * Подбор из всех 412 напитков к блюду: топ-5, лучший сорт Efes и лучшее в каждой категории.
 * Баллы честные (0-99); Efes поднимается выше только при разнице до 2 баллов, это видно на карточке.
 */
@Component({
  selector: 'app-pairing-v2',
  standalone: true,
  imports: [FormsModule, V2GlassComponent],
  template: `
    <div class="glass-panel v2-intro mb-2xl">
      <p>
        <strong>Подбор из {{ meta()?.drinks ?? 412 }} напитков:</strong> пиво, вино, крепкое, коктейли,
        безалкогольное, чай и кофе. Для каждого блюда сравниваем вкус со всеми напитками и ставим балл от 0 до 99.
      </p>
      @if (meta(); as m) {
        <p class="text-muted text-sm">{{ m.policy.note }}</p>
      }
    </div>

    <div class="flex justify-between items-center gap-lg flex-wrap mb-lg">
      <h3 class="v2-h3">Выберите блюдо</h3>
      <div class="v2-search">
        <input class="input" type="text" [ngModel]="query()" (ngModelChange)="query.set($event)"
               placeholder="Плов, суши, стейк..." aria-label="Поиск блюда" />
        @if (query()) {
          <button class="v2-clear" (click)="query.set('')" title="Очистить">&#x2715;</button>
        }
      </div>
    </div>

    <div class="v2-chips mb-2xl">
      @for (d of visibleDishes(); track d.id) {
        <button class="btn-outline v2-chip" [class.active]="d.id === selectedId()" (click)="select(d.id)">
          <span aria-hidden="true">{{ d.emoji }}</span> {{ d.name }}
        </button>
      } @empty {
        @if (dishesLoaded()) {
          <p class="text-muted">Такого блюда пока нет в базе.</p>
        }
      }
      @if (!showAll() && filteredDishes().length > visibleDishes().length) {
        <button class="btn-outline v2-chip v2-more" (click)="showAll.set(true)">
          Все блюда ({{ filteredDishes().length }})
        </button>
      }
    </div>

    @if (loading()) {
      <div class="skeleton-grid" aria-busy="true" aria-label="Подбираем напитки">
        @for (i of [1, 2, 3]; track i) {
          <div class="skeleton-card"><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div></div>
        }
      </div>
    } @else if (error()) {
      <div class="glass-panel text-center p-2xl"><p class="text-muted">Не удалось получить подбор. Попробуйте ещё раз.</p></div>
    } @else {
    @if (result(); as r) {
      <div class="mb-xl">
        <h2 class="section-header v2-title">{{ r.dish.emoji }} {{ r.dish.name }}: лучшие пары</h2>
        <p class="text-muted text-sm">Проверено {{ countOf(r.n_candidates, 'напиток', 'напитка', 'напитков') }}</p>
      </div>

      <div class="v2-list mb-3xl">
        @for (p of r.items; track p.drink_id; let i = $index) {
          <article class="glass-card v2-pair stagger-item">
            <div class="v2-rank">{{ i + 1 }}</div>
            <v2-glass [category]="p.category" [size]="48" />
            <div class="v2-pair-body">
              <div class="v2-badges">
                <span class="badge">{{ categoryLabel(p.category) }}</span>
                @if (isEfes(p.efes_relation)) {
                  <span class="badge v2-efes">Портфель Efes</span>
                }
                @if (promoted(r.items, i)) {
                  <span class="badge v2-promoted" [title]="r.policy.note">выше по правилу Efes, разница до {{ r.policy.partner_tie_window }} баллов</span>
                }
              </div>
              <h3 class="v2-name">{{ p.drink_name }}</h3>
              <p class="text-muted text-sm">{{ drinkLine(p.drink) }}</p>
              <ul class="v2-reasons">
                @for (t of topReasons(p); track t) { <li>{{ t }}</li> }
              </ul>
              @if (firstWarning(p); as w) { <p class="v2-warning">{{ w }}</p> }
              @if (priceLabel(p.drink?.price_kzt); as price) { <p class="text-xs text-muted">{{ price }}</p> }
            </div>
            <div class="v2-score" [attr.data-band]="p.band">
              <strong>{{ p.score }}</strong>
              <span>{{ p.band_label }}</span>
            </div>
          </article>
        }
      </div>

      @if (partnerOutsideTop(r); as bp) {
        <h3 class="v2-h3 mb-lg">Лучший вариант из портфеля Efes</h3>
        <article class="glass-card v2-pair v2-partner mb-3xl">
          <div class="v2-rank">E</div>
          <v2-glass [category]="bp.category" [size]="48" />
          <div class="v2-pair-body">
            <div class="v2-badges">
              <span class="badge">{{ categoryLabel(bp.category) }}</span>
              <span class="badge v2-efes">Портфель Efes</span>
            </div>
            <h3 class="v2-name">{{ bp.drink_name }}</h3>
            <p class="text-muted text-sm">{{ drinkLine(bp.drink) }}</p>
            <ul class="v2-reasons">
              @for (t of topReasons(bp); track t) { <li>{{ t }}</li> }
            </ul>
          </div>
          <div class="v2-score" [attr.data-band]="bp.band">
            <strong>{{ bp.score }}</strong>
            <span>{{ bp.band_label }}</span>
          </div>
        </article>
      }

      <h3 class="v2-h3 mb-lg">Лучшее в каждой категории</h3>
      <div class="v2-cats">
        @for (c of r.categories; track c.category) {
          @if (c.best; as b) {
            <div class="glass-card v2-cat">
              <v2-glass [category]="c.category" [size]="38" />
              <div class="v2-cat-body">
                <span class="text-xs text-muted">{{ c.label }} · {{ c.n }}</span>
                <strong>{{ b.drink_name }}</strong>
              </div>
              <span class="v2-cat-score" [attr.data-band]="b.band">{{ b.score }}</span>
            </div>
          }
        }
      </div>
    }
    }
  `,
  styles: [`
    .v2-intro { padding: 18px 24px; line-height: 1.5; }
    .v2-intro p + p { margin-top: 6px; }
    .v2-h3 { font-family: var(--font-heading); font-size: 1.25rem; font-weight: 700; }
    .v2-title { font-size: clamp(1.4rem, 3vw, 2rem); }
    .v2-search { position: relative; width: 100%; max-width: 340px; }
    .v2-search .input { width: 100%; padding-right: 36px; }
    .v2-clear { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none;
      border: none; color: var(--muted); cursor: pointer; font-size: 16px; padding: 4px; }
    .v2-chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .v2-chip { padding: 8px 14px; font-size: 0.9rem; }
    .v2-more { border-style: dashed; }

    .v2-list { display: flex; flex-direction: column; gap: 14px; }
    .v2-pair { display: grid; grid-template-columns: 28px 48px 1fr auto; gap: 16px; align-items: start; padding: 20px 22px; }
    .v2-partner { box-shadow: var(--shadow-md), inset 0 0 0 1.5px var(--beer-accent); }
    .v2-rank { font-family: var(--font-heading); font-weight: 800; font-size: 1.4rem; color: var(--beer-mid);
      line-height: 48px; text-align: center; }
    .v2-pair-body { min-width: 0; }
    .v2-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
    .v2-efes { background: rgba(245, 158, 11, 0.16); color: var(--beer-deep); }
    .v2-promoted { background: rgba(37, 99, 235, 0.08); color: #1D4ED8; }
    .v2-name { font-family: var(--font-heading); font-size: 1.2rem; font-weight: 700; margin-bottom: 2px; }
    .v2-reasons { margin: 10px 0 6px; padding-left: 18px; color: var(--foam-dim); font-size: 0.92rem; line-height: 1.45; }
    .v2-reasons li + li { margin-top: 4px; }
    .v2-warning { font-size: 0.85rem; color: #B45309; margin-bottom: 4px; }
    .v2-score { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; min-width: 96px; text-align: right; }
    .v2-score strong { font-family: var(--font-heading); font-size: 2.1rem; line-height: 1; color: var(--beer-deep); }
    .v2-score span { font-size: 0.78rem; color: var(--muted); }
    .v2-score[data-band="ideal"] strong { color: var(--success); }

    .v2-cats { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; }
    .v2-cat { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
    .v2-cat-body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .v2-cat-body strong { font-size: 0.95rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .v2-cat-score { font-family: var(--font-heading); font-weight: 800; font-size: 1.2rem; color: var(--beer-mid); }
    .v2-cat-score[data-band="ideal"] { color: var(--success); }

    @media (max-width: 640px) {
      .v2-search { max-width: none; }
      /* Блюда одной строкой с прокруткой, поиск над ними находит любое из 114 */
      .v2-chips { flex-wrap: nowrap; overflow-x: auto; margin-inline: -16px; padding: 2px 16px 6px; scrollbar-width: none; }
      .v2-chips::-webkit-scrollbar { display: none; }
      .v2-chip { flex-shrink: 0; white-space: nowrap; }
      .v2-pair { grid-template-columns: 40px 1fr; gap: 12px; padding: 16px; }
      .v2-rank { display: none; }
      .v2-score { grid-column: 1 / -1; flex-direction: row; align-items: baseline; justify-content: flex-start; gap: 8px; }
      .v2-score strong { font-size: 1.6rem; }
    }
  `],
})
export class PairingV2Component implements OnInit {
  private api = inject(V2ApiService);

  meta = signal<V2Meta | null>(null);
  dishes = signal<V2Dish[]>([]);
  dishesLoaded = signal(false);
  query = signal('');
  showAll = signal(false);
  selectedId = signal<string | null>(null);
  result = signal<V2PairingResult | null>(null);
  loading = signal(false);
  error = signal(false);

  readonly countOf = countOf;
  readonly isEfes = isEfes;
  readonly drinkLine = drinkLine;
  readonly topReasons = topReasons;
  readonly firstWarning = firstWarning;
  readonly priceLabel = priceLabel;

  private categoryLabels = computed(() => new Map((this.meta()?.categories ?? []).map(c => [c.id, c.label])));

  filteredDishes = computed(() => {
    const q = this.query().trim().toLowerCase().replace(/ё/g, 'е');
    if (!q) return this.dishes();
    return this.dishes().filter(d =>
      [d.name, d.display_name ?? '', ...(d.synonyms ?? [])].some(s => s.toLowerCase().replace(/ё/g, 'е').includes(q)));
  });

  visibleDishes = computed(() => {
    const list = this.filteredDishes();
    if (this.showAll() || this.query().trim()) return list;
    const preview = list.slice(0, DISHES_PREVIEW);
    // Выбранное блюдо не должно пропадать из видимых
    const sel = list.find(d => d.id === this.selectedId());
    return sel && !preview.includes(sel) ? [...preview, sel] : preview;
  });

  private requestSeq = 0;

  ngOnInit() {
    this.api.meta().subscribe({ next: m => this.meta.set(m) });
    this.api.dishes().subscribe({
      next: list => {
        this.dishes.set(list);
        this.dishesLoaded.set(true);
        if (list.length && !this.selectedId()) this.select(list[0].id);
      },
      error: () => this.dishesLoaded.set(true),
    });
  }

  select(dishId: string) {
    const seq = ++this.requestSeq;
    this.selectedId.set(dishId);
    this.loading.set(true);
    this.error.set(false);
    this.api.pairingForDish(dishId).subscribe({
      next: r => {
        if (seq !== this.requestSeq) return;
        this.result.set(r);
        this.loading.set(false);
      },
      error: () => {
        if (seq !== this.requestSeq) return;
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }

  categoryLabel(id: string): string {
    return this.categoryLabels().get(id) ?? id;
  }

  /** Сорт Efes стоит выше напитка с большим баллом: сработало правило портфеля (разница до 2 баллов). */
  promoted(items: V2Pair[], i: number): boolean {
    const p = items[i];
    return isEfes(p.efes_relation) && items.slice(i + 1).some(x => x.score > p.score);
  }

  /** Лучший сорт Efes показываем отдельно, только если его нет в топе. */
  partnerOutsideTop(r: V2PairingResult): V2Pair | null {
    const bp = r.best_partner;
    if (!bp || r.items.some(x => x.drink_id === bp.drink_id)) return null;
    return bp;
  }
}

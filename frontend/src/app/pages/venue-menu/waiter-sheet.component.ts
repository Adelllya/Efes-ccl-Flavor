import { Component, EventEmitter, Output, computed, input, signal } from '@angular/core';
import { PAIRING_LABELS, PairingType } from '../../models/flavor-tree.models';
import type { MenuRec, MenuSection } from './venue-menu.component';

/** Строка шпаргалки: блюдо, что советовать и готовая фраза. */
interface WaiterRow {
  id: string;
  dish: string;
  price: string;
  available: boolean;
  /** Совет, который есть в карте бара и в наличии; иначе лучший из каталога. */
  rec: MenuRec | null;
  inBar: boolean;
  phrase: string;
  spare: MenuRec | null;
}

/** Причина по типу пары, когда сомелье не написал объяснение. */
const TYPE_REASON: Record<PairingType, string> = {
  COMPLEMENT: 'похожие вкусы усиливают друг друга',
  CONTRAST: 'он уравновешивает вкус блюда',
  CLEANSE: 'он освежает и снимает жирность',
  BRIDGE: 'у блюда и сорта есть общая нота',
};

function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/**
 * Шпаргалка официанта: у каждого блюда меню сорт из карты бара и готовая фраза для гостя.
 * Официанты часто меняются, и учить каждого долго; подсказка работает в день выхода на смену.
 * Открывается по адресу /menu/<заведение>/staff, входа не требует, печатается на лист.
 */
@Component({
  selector: 'app-waiter-sheet',
  standalone: true,
  template: `
    <section class="ws">
      <header class="ws-head">
        <div>
          <span class="badge mb-xs">Для персонала</span>
          <h1 class="ws-title">Шпаргалка официанта</h1>
          <p class="ws-sub">{{ venue() }}. Что посоветовать к каждому блюду и как это сказать.</p>
        </div>
        <div class="ws-actions">
          <button type="button" class="btn-outline" (click)="print()">Печать</button>
          <button type="button" class="btn-amber" (click)="exit.emit()">К меню гостя</button>
        </div>
      </header>

      <ol class="ws-rules">
        <li><b>Когда.</b> Предлагайте пару в момент, когда гость выбрал блюдо.</li>
        <li><b>Как.</b> Одна фраза: блюдо, сорт и причина. Не три варианта, а один.</li>
        <li><b>Кому нет.</b> Гостям младше 21 года и тем, кто за рулём, алкоголь не предлагаем.</li>
      </ol>

      <label class="ws-search">
        <span class="ws-sr">Поиск блюда</span>
        <input type="search" class="input" placeholder="Найти блюдо" autocomplete="off"
               [value]="query()" (input)="query.set($any($event.target).value)" />
      </label>

      @for (section of visible(); track section.name) {
        <h2 class="ws-section">{{ section.name }}</h2>
        <ul class="ws-list">
          @for (row of section.rows; track row.id) {
            <li class="ws-row" [class.ws-off]="!row.available">
              <div class="ws-dish">
                <b>{{ row.dish }}</b>
                @if (!row.available) { <span class="ws-chip ws-chip-off">сегодня не готовим</span> }
              </div>
              @if (row.rec; as rec) {
                <div class="ws-rec">
                  <span class="ws-rec-name">
                    {{ rec.name }}
                    @if (rec.drink; as d) { <small>{{ d.volume ? d.volume + ' · ' : '' }}{{ row.price }}</small> }
                  </span>
                  <span class="ws-chip">{{ label(rec.type) }}</span>
                  @if (!row.inBar) { <span class="ws-chip ws-chip-off">нет в карте бара</span> }
                </div>
                <p class="ws-phrase">«{{ row.phrase }}»</p>
                @if (row.spare; as spare) {
                  <p class="ws-spare">Запасной вариант: {{ spare.name }}</p>
                }
              } @else {
                <p class="ws-spare">Пары к этому блюду пока нет. Спросите гостя, что он любит: полегче или поплотнее.</p>
              }
            </li>
          }
        </ul>
      } @empty {
        <p class="ws-empty">{{ query() ? 'Такого блюда в меню нет.' : 'В меню пока нет блюд.' }}</p>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .ws { max-width: 920px; margin: 0 auto; }
    .ws-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: var(--space-lg); margin-bottom: var(--space-xl); }
    .ws-title { margin: 0 0 4px; font-family: var(--font-heading); font-size: clamp(1.6rem, 4vw, 2.2rem); font-weight: 800; line-height: 1.15; }
    .ws-sub { margin: 0; color: var(--foam-dim); line-height: 1.5; }
    .ws-actions { display: flex; flex-wrap: wrap; gap: var(--space-sm); }
    .ws-actions .btn-amber, .ws-actions .btn-outline { min-height: 44px; }
    .ws-rules { list-style: none; margin: 0 0 var(--space-xl); padding: var(--space-lg) var(--space-xl); display: grid; gap: var(--space-sm); border: 1px solid rgba(217, 119, 6, 0.3); border-radius: var(--radius-xl); background: #FFF7EA; color: var(--foam-dim); line-height: 1.5; }
    .ws-rules b { color: var(--beer-deep); }
    .ws-search { display: block; margin-bottom: var(--space-lg); }
    .ws-search .input { width: 100%; min-height: 48px; font-size: 1rem; }
    .ws-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
    .ws-section { margin: var(--space-2xl) 0 var(--space-md); font-family: var(--font-heading); font-size: 1.15rem; font-weight: 800; color: var(--foam); }
    .ws-list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-md); }
    .ws-row { display: grid; gap: 6px; padding: var(--space-lg); border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--bg-1); break-inside: avoid; }
    .ws-off { opacity: 0.6; }
    .ws-dish { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-sm); font-size: 1.05rem; }
    .ws-rec { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-sm); }
    .ws-rec-name { font-weight: 700; color: var(--beer-deep); }
    .ws-rec-name small { margin-left: 6px; font-weight: 500; color: var(--muted); }
    .ws-chip { padding: 2px 10px; border-radius: var(--radius-full); background: var(--beer-glow); color: var(--beer-deep); font-size: 0.75rem; font-weight: 700; white-space: nowrap; }
    .ws-chip-off { background: rgba(0, 0, 0, 0.06); color: var(--foam-dim); }
    .ws-phrase { margin: 0; line-height: 1.55; color: var(--foam); }
    .ws-spare { margin: 0; font-size: 0.875rem; color: var(--muted); }
    .ws-empty { padding: var(--space-3xl); text-align: center; color: var(--muted); }

    @media (max-width: 600px) {
      .ws-actions { width: 100%; }
      .ws-actions .btn-amber, .ws-actions .btn-outline { flex: 1 1 140px; justify-content: center; }
      .ws-row { padding: var(--space-md); }
    }
    @media print {
      .ws-actions, .ws-search { display: none; }
      .ws-row { border-color: #999; }
    }
  `],
})
export class WaiterSheetComponent {
  venue = input('');
  sections = input<MenuSection[]>([]);
  /** Функция цены страницы меню: "2 200 ₸" или "цена уточняется". */
  priceLabel = input<(value: string | number) => string>(v => String(v));
  @Output() exit = new EventEmitter<void>();

  readonly query = signal('');

  readonly visible = computed(() => {
    const q = this.query().trim().toLowerCase();
    const price = this.priceLabel();
    return this.sections()
      .map(section => ({
        name: section.name,
        rows: section.items
          .filter(item => !q || item.dish.name.toLowerCase().includes(q))
          .map((item): WaiterRow => {
            const options = [item.rec, ...item.alts].filter((r): r is MenuRec => !!r);
            const inBar = options.filter(r => r.drink?.is_available);
            const rec = inBar[0] ?? options[0] ?? null;
            const spare = inBar.find(r => r !== rec) ?? null;
            return {
              id: item.id,
              dish: item.dish.name,
              price: rec?.drink ? price(rec.drink.price) : '',
              available: item.is_available,
              rec,
              inBar: !!rec?.drink?.is_available,
              phrase: rec ? this.phrase(item.dish.name, rec) : '',
              spare,
            };
          }),
      }))
      .filter(section => section.rows.length);
  });

  label(type: PairingType): string {
    return PAIRING_LABELS[type] ?? type;
  }

  /** Формула из урока Академии: блюдо, сорт, причина. */
  private phrase(dish: string, rec: MenuRec): string {
    const reason = lowerFirst((rec.explanation || '').trim()).replace(/\.+$/, '') || TYPE_REASON[rec.type] || 'они хорошо сочетаются';
    return `К блюду «${dish}» советую ${rec.name}: ${reason}.`;
  }

  print() {
    window.print();
  }
}

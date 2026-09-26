import { Injectable, signal } from '@angular/core';

/** Ключ localStorage со столом гостя для заведения. */
export function tableKey(slug: string): string {
  return `ft_table_${slug}`;
}

/**
 * Какой сорт, какое заведение и какой стол открыты сейчас.
 *
 * Разделы переключаются через activeTab в AppComponent, а не через
 * роутер, поэтому id сорта и slug заведения негде передать параметром -
 * держим их здесь. Стол хранится в localStorage отдельно для каждого
 * заведения, чтобы пережить перезагрузку страницы.
 */
@Injectable({ providedIn: 'root' })
export class SelectionService {
  readonly brandId = signal<string | null>(null);
  readonly venueSlug = signal<string | null>(null);
  /** Стол гостя в открытом заведении: null - не выбран, 0 - с собой. */
  readonly tableNumber = signal<number | null>(null);

  open(id: string): void {
    this.brandId.set(id);
  }

  /** null возвращает к списку заведений. Стол подтягивается из хранилища. */
  openVenue(slug: string | null): void {
    this.venueSlug.set(slug);
    this.tableNumber.set(slug ? this.tableFor(slug) : null);
  }

  /** Сохранённый стол для заведения или null. */
  tableFor(slug: string): number | null {
    try {
      const raw = localStorage.getItem(tableKey(slug));
      if (raw === null) return null;
      const n = Number(raw);
      return Number.isInteger(n) && n >= 0 ? n : null;
    } catch {
      return null;
    }
  }

  /** Запоминает стол для заведения; null убирает выбор. Сигнал меняется, если это заведение открыто. */
  setTable(slug: string, n: number | null): void {
    try {
      if (n === null) localStorage.removeItem(tableKey(slug));
      else localStorage.setItem(tableKey(slug), String(n));
    } catch {
      // без хранилища стол живёт в памяти до перезагрузки
    }
    if (this.venueSlug() === slug) this.tableNumber.set(n);
  }

  /**
   * Стол из QR-ссылки вида /menu/<slug>?table=7. Вызывать после openVenue(slug).
   * Возвращает true, если номер найден и сохранён; убрать query из адреса должен вызывающий.
   */
  setTableFromQuery(slug: string, search: string = location.search): boolean {
    const raw = new URLSearchParams(search).get('table');
    if (raw === null) return false;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) return false;
    this.setTable(slug, n);
    return true;
  }
}

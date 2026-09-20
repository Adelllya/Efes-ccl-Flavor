import { Injectable, signal } from '@angular/core';

/**
 * Какой сорт открыт на странице напитка.
 *
 * Разделы переключаются через activeTab в AppComponent, а не через
 * роутер, поэтому id сорта негде передать параметром — держим его здесь.
 */
@Injectable({ providedIn: 'root' })
export class SelectionService {
  readonly brandId = signal<string | null>(null);

  open(id: string): void {
    this.brandId.set(id);
  }
}

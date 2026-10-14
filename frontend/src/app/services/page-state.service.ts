import { Injectable, signal } from '@angular/core';
import { Brand } from '../models/flavor-tree.models';
import { DishProfile } from '../pages/landing/pairing-engine.data';

/**
 * Шаг подбора на главной: 'idle' - выбор пути в hero, 'wizard' - вопросы
 * о блюде, 'dish-result' - сорта к блюду, 'brand' - витрина сортов и пары.
 */
export type LandingStage = 'idle' | 'wizard' | 'dish-result' | 'brand';

/**
 * Состояние страниц, которое переживает уход в другой раздел и возврат.
 *
 * Роутера нет: при смене раздела AppComponent уничтожает компонент страницы
 * вместе с его сигналами. Гость открывал сорт из результата подбора или из
 * каталога, возвращался и видел всё с начала. Поэтому шаг подбора и фильтры
 * каталога лежат здесь, а компоненты только ссылаются на эти сигналы.
 */
@Injectable({ providedIn: 'root' })
export class PageStateService {
  // Подбор на главной
  readonly stage = signal<LandingStage>('idle');
  /** Ответы мастера или профиль блюда из каталога. */
  readonly dishProfile = signal<DishProfile | null>(null);
  /** Сорт, для которого открыты пары в ветке "у меня есть пиво". */
  readonly selectedBrand = signal<Brand | null>(null);
  /** Текст из поиска в hero, с которым открыт мастер. */
  readonly dishQuery = signal('');

  // Каталог сортов
  readonly catalogQuery = signal('');
  readonly catalogPackaging = signal('');
  readonly catalogHoreca = signal(false);

  /** Подбор с начала: снова выбор пути в hero. */
  resetFlow(): void {
    this.dishProfile.set(null);
    this.selectedBrand.set(null);
    this.dishQuery.set('');
    this.stage.set('idle');
  }

  resetCatalog(): void {
    this.catalogQuery.set('');
    this.catalogPackaging.set('');
    this.catalogHoreca.set(false);
  }
}

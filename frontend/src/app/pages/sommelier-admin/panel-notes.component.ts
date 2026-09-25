import { Component, computed, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FlavorNote, PyramidLayer } from '../../models/flavor-tree.models';
import { PanelIconComponent } from './panel-icons';
import { LAYER_SHORT, initialOf } from './panel-shared';

type NoteFilter = 'all' | PyramidLayer;

/** Вкладка "Ноты": справочник колеса вкусов, список слева и карточка ноты справа. */
@Component({
  selector: 'panel-notes',
  standalone: true,
  imports: [FormsModule, PanelIconComponent],
  template: `
    <div class="wa-page" [class.has-selection]="!!selectedId()">
      <aside class="wa-list">
        <div class="wa-list-head">
          <h2 class="wa-list-title">Ноты @if (loaded()) { <span class="wa-count">{{ notes().length }}</span> }</h2>
        </div>
        <label class="wa-search">
          <panel-icon name="search" />
          <input type="text" placeholder="Название или термин" [ngModel]="search()" (ngModelChange)="search.set($event)" />
        </label>
        <div class="wa-pills">
          @for (p of pills; track p.value) {
            <button type="button" class="wa-pill" [class.active]="filter() === p.value" (click)="filter.set(p.value)">
              {{ p.label }}
            </button>
          }
        </div>
        <div class="wa-rows">
          @if (!loaded()) {
            <p class="wa-empty">Загрузка...</p>
          } @else {
            @for (n of filtered(); track n.id) {
              <button type="button" class="wa-row" [class.active]="selectedId() === n.id" (click)="select(n.id)">
                <span class="wa-avatar">
                  @if (n.image) { <img [src]="n.image" [alt]="n.name" /> } @else { {{ initial(n.name) }} }
                </span>
                <span class="wa-row-body">
                  <span class="wa-row-title">{{ n.name }}</span>
                  <span class="wa-row-sub">{{ n.technical_term || n.description || 'Нота вкусовой пирамиды' }}</span>
                </span>
                <span class="wa-row-meta">
                  <span class="wa-chip" [class.wa-chip-warn]="n.is_off_flavour">{{ layerShort[n.category] || n.category }}</span>
                </span>
              </button>
            } @empty {
              <p class="wa-empty">{{ notes().length ? 'Ничего не найдено' : 'Справочник пуст' }}</p>
            }
          }
        </div>
      </aside>

      <section class="wa-detail">
        @for (n of selectedOne(); track n.id) {
          <div class="wa-detail-enter">
            <button type="button" class="wa-back" (click)="select(null)"><panel-icon name="arrowLeft" /> К списку</button>
            <div class="wa-card">
              <div class="wa-card-head">
                <span class="wa-avatar wa-avatar-lg">
                  @if (n.image) { <img [src]="n.image" [alt]="n.name" /> } @else { {{ initial(n.name) }} }
                </span>
                <div class="wa-card-head-text">
                  <h3 class="wa-card-title">{{ n.name }}</h3>
                  <p class="wa-card-sub">{{ n.category_display || layerShort[n.category] }}
                    @if (n.technical_term) { <span class="wa-dot"></span>{{ n.technical_term }} }
                  </p>
                </div>
                @if (n.is_off_flavour) { <span class="wa-chip wa-chip-warn">Дефект</span> }
              </div>
              <dl class="wa-facts">
                @if (n.wheel_code) {
                  <div><dt>Код колеса</dt><dd>{{ n.wheel_code }}</dd></div>
                }
                <div><dt>Слой пирамиды</dt><dd>{{ n.category_display || layerShort[n.category] }}</dd></div>
                @if (n.reference_material) {
                  <div><dt>Эталон</dt><dd>{{ n.reference_material }}</dd></div>
                }
              </dl>
              <p class="wa-text">{{ n.description || 'Описание ещё не заполнено' }}</p>
              <p class="wa-muted">Справочник нот правится в Django admin, здесь он только для сверки.</p>
            </div>
          </div>
        } @empty {
          <div class="wa-detail-empty">Выберите элемент слева</div>
        }
      </section>
    </div>
  `
})
export class PanelNotesComponent {
  notes = input<FlavorNote[]>([]);
  /** false, пока родитель ждёт справочник: вместо "Справочник пуст" показываем загрузку. */
  loaded = input(false);

  readonly layerShort = LAYER_SHORT;
  readonly initial = initialOf;
  readonly pills: { value: NoteFilter; label: string }[] = [
    { value: 'all', label: 'Все' },
    { value: 'TOP', label: 'Top' },
    { value: 'HEART', label: 'Heart' },
    { value: 'BASE', label: 'Base' }
  ];

  search = signal('');
  filter = signal<NoteFilter>('all');
  selectedId = signal<string | null>(null);

  filtered = computed(() => {
    const q = this.search().toLowerCase().trim();
    const f = this.filter();
    return this.notes().filter(n =>
      (f === 'all' || n.category === f) &&
      (!q || n.name.toLowerCase().includes(q) || (n.technical_term || '').toLowerCase().includes(q))
    );
  });

  selectedOne = computed(() => {
    const n = this.notes().find(x => x.id === this.selectedId());
    return n ? [n] : [];
  });

  select(id: string | null) {
    this.selectedId.set(id);
  }
}

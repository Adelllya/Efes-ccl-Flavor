import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { Brand, Dish, FoodPairing, PAIRING_LABELS, PairingType } from '../../models/flavor-tree.models';
import { FtSelectComponent, SelectOption } from '../../ui/ft-select.component';
import { PanelIconComponent } from './panel-icons';
import { PAIRING_TYPE_CHOICES, confirmTwice, flash, initialOf, isErrorText } from './panel-shared';

interface PairingForm {
  key: string;
  id: string | null;
  brand: string;
  dish: string;
  compatibility_score: number;
  pairing_type: PairingType;
  explanation: string;
}

type PairingFilter = 'all' | PairingType;

/** Вкладка "Сочетания": список слева, форма выбранного сочетания справа, "+" создаёт новое. */
@Component({
  selector: 'panel-pairings',
  standalone: true,
  imports: [FormsModule, PanelIconComponent, FtSelectComponent],
  template: `
    <div class="wa-page" [class.has-selection]="!!form()">
      <aside class="wa-list">
        <div class="wa-list-head">
          <h2 class="wa-list-title">Сочетания @if (loaded()) { <span class="wa-count">{{ pairings().length }}</span> }</h2>
          <button type="button" class="wa-iconbtn" title="Новое сочетание" (click)="openCreate()">
            <panel-icon name="plus" />
          </button>
        </div>
        <label class="wa-search">
          <panel-icon name="search" />
          <input type="text" placeholder="Блюдо или сорт" [ngModel]="search()" (ngModelChange)="search.set($event)" />
        </label>
        <div class="wa-pills">
          @for (p of pills; track p.value) {
            <button type="button" class="wa-pill" [class.active]="filter() === p.value" (click)="filter.set(p.value)">
              {{ p.label }}
            </button>
          }
        </div>
        @if (msg() && !form()) {
          <p class="wa-msg" [class.error]="isError(msg())">{{ msg() }}</p>
        }
        <div class="wa-rows">
          @if (!loaded()) {
            <p class="wa-empty">Загрузка...</p>
          } @else {
            @for (p of filtered(); track p.id) {
              <button type="button" class="wa-row" [class.active]="form()?.id === p.id" (click)="openEdit(p)">
                <span class="wa-avatar">
                  @if (brandImage(p.brand); as img) { <img [src]="img" [alt]="p.brand_name" /> } @else { {{ initial(p.brand_name) }} }
                </span>
                <span class="wa-row-body">
                  <span class="wa-row-title">{{ p.dish_name }}</span>
                  <span class="wa-row-sub">{{ p.brand_name }}</span>
                </span>
                <span class="wa-row-meta">
                  <span class="wa-chip">{{ labels[p.pairing_type] }}</span>
                  <span class="wa-score">{{ p.compatibility_score }}/5</span>
                </span>
              </button>
            } @empty {
              <p class="wa-empty">{{ pairings().length ? 'Ничего не найдено' : 'Сочетаний пока нет' }}</p>
            }
          }
        </div>
      </aside>

      <section class="wa-detail">
        @for (f of formList(); track f.key) {
          <div class="wa-detail-enter">
            <button type="button" class="wa-back" (click)="close()"><panel-icon name="arrowLeft" /> К списку</button>
            <div class="wa-card">
              <div class="wa-card-head">
                <div class="wa-card-head-text">
                  <h3 class="wa-card-title">{{ f.id ? 'Сочетание' : 'Новое сочетание' }}</h3>
                  <p class="wa-card-sub">{{ f.id ? dishName(f.dish) + ' и ' + brandName(f.brand) : 'Выберите сорт и блюдо, объясните, почему они подходят друг другу' }}</p>
                </div>
              </div>
              <div class="wa-fields">
                <div class="wa-field">
                  <span class="wa-label">Сорт</span>
                  <ft-select [options]="brandOptions()" [searchable]="true" placeholder="Выберите сорт" [(ngModel)]="f.brand" />
                </div>
                <div class="wa-field">
                  <span class="wa-label">Блюдо</span>
                  <ft-select [options]="dishOptions()" [searchable]="true" placeholder="Выберите блюдо" [(ngModel)]="f.dish" />
                </div>
                <div class="wa-field">
                  <span class="wa-label">Тип сочетания</span>
                  <ft-select [options]="typeOptions" [(ngModel)]="f.pairing_type" />
                </div>
                <label class="wa-field">
                  <span class="wa-label">Оценка: {{ f.compatibility_score }}/5</span>
                  <input class="wa-range" type="range" min="1" max="5" [(ngModel)]="f.compatibility_score" />
                </label>
                <label class="wa-field wa-field-wide">
                  <span class="wa-label">Почему сочетание работает</span>
                  <textarea class="input" rows="3" [(ngModel)]="f.explanation"
                            placeholder="Например: хмелевая горчинка режет жирность вяленого мяса"></textarea>
                </label>
              </div>
              @if (formError()) {
                <p class="wa-error">{{ formError() }}</p>
              }
              <div class="wa-actions">
                <button type="button" class="btn-amber" [disabled]="saving()" (click)="save()">
                  <panel-icon name="save" /> {{ saving() ? 'Сохраняем...' : 'Сохранить' }}
                </button>
                @if (f.id) {
                  <button type="button" class="btn-outline panel-danger" (click)="askDelete(f.id)">
                    <panel-icon name="trash" /> {{ pendingDelete() === f.id ? 'Точно удалить?' : 'Удалить' }}
                  </button>
                } @else {
                  <button type="button" class="btn-outline" (click)="close()">Отмена</button>
                }
                @if (msg()) {
                  <p class="wa-msg" [class.error]="isError(msg())">{{ msg() }}</p>
                }
              </div>
            </div>
          </div>
        } @empty {
          <div class="wa-detail-empty">Выберите элемент слева</div>
        }
      </section>
    </div>
  `
})
export class PanelPairingsComponent {
  private api = inject(ApiService);

  pairings = input<FoodPairing[]>([]);
  brands = input<Brand[]>([]);
  dishes = input<Dish[]>([]);
  /** false, пока родитель ждёт список: вместо "Сочетаний пока нет" показываем загрузку. */
  loaded = input(false);
  /** Новый список после создания, правки или удаления; родитель хранит его. */
  changed = output<FoodPairing[]>();

  readonly labels = PAIRING_LABELS;
  readonly initial = initialOf;
  readonly typeOptions: SelectOption[] = PAIRING_TYPE_CHOICES;
  readonly pills: { value: PairingFilter; label: string }[] = [
    { value: 'all', label: 'Все' },
    ...PAIRING_TYPE_CHOICES.map(c => ({ value: c.value as PairingFilter, label: c.label }))
  ];

  search = signal('');
  filter = signal<PairingFilter>('all');
  form = signal<PairingForm | null>(null);
  formError = signal<string | null>(null);
  saving = signal(false);
  msg = signal<string | null>(null);
  pendingDelete = signal<string | null>(null);

  isError = isErrorText;

  formList = computed(() => {
    const f = this.form();
    return f ? [f] : [];
  });

  brandOptions = computed<SelectOption[]>(() =>
    this.brands().map(b => ({ value: b.id, label: b.name, hint: b.style }))
  );

  dishOptions = computed<SelectOption[]>(() =>
    this.dishes().map(d => ({ value: d.id, label: d.name, hint: d.category || d.cuisine_display || '' }))
  );

  filtered = computed(() => {
    const q = this.search().toLowerCase().trim();
    const f = this.filter();
    return this.pairings().filter(p =>
      (f === 'all' || p.pairing_type === f) &&
      (!q || (p.brand_name || '').toLowerCase().includes(q) || (p.dish_name || '').toLowerCase().includes(q))
    );
  });

  brandImage(id: string): string | null {
    const b = this.brands().find(x => x.id === id);
    return b?.image || b?.image_hd || null;
  }

  brandName(id: string): string {
    return this.brands().find(x => x.id === id)?.name || '';
  }

  dishName(id: string): string {
    return this.dishes().find(x => x.id === id)?.name || '';
  }

  openCreate() {
    this.formError.set(null);
    this.form.set({
      key: 'new', id: null, brand: '', dish: '', compatibility_score: 4, pairing_type: 'COMPLEMENT', explanation: ''
    });
  }

  openEdit(p: FoodPairing) {
    this.formError.set(null);
    this.form.set({
      key: p.id, id: p.id, brand: p.brand, dish: p.dish, compatibility_score: p.compatibility_score,
      pairing_type: p.pairing_type, explanation: p.explanation || ''
    });
  }

  close() {
    this.form.set(null);
    this.formError.set(null);
  }

  save() {
    const f = this.form();
    if (!f) return;
    if (!f.brand || !f.dish) {
      this.formError.set('Выберите сорт и блюдо');
      return;
    }
    const payload: Partial<FoodPairing> = {
      brand: f.brand,
      dish: f.dish,
      compatibility_score: Number(f.compatibility_score),
      pairing_type: f.pairing_type,
      explanation: f.explanation.trim()
    };
    this.saving.set(true);
    this.formError.set(null);
    const req = f.id ? this.api.updatePairing(f.id, payload) : this.api.createPairing(payload);
    req.subscribe({
      next: saved => {
        this.saving.set(false);
        const list = this.pairings();
        this.changed.emit(f.id ? list.map(p => p.id === saved.id ? saved : p) : [saved, ...list]);
        this.openEdit(saved);
        flash(this.msg, f.id ? 'Сочетание обновлено' : 'Сочетание добавлено');
      },
      error: err => {
        this.saving.set(false);
        this.formError.set('Ошибка: ' + AuthService.errorText(err));
      }
    });
  }

  askDelete(id: string) {
    confirmTwice(this.pendingDelete, id, () => {
      this.api.deletePairing(id).subscribe({
        next: () => {
          this.changed.emit(this.pairings().filter(x => x.id !== id));
          this.close();
          flash(this.msg, 'Сочетание удалено');
        },
        error: err => this.formError.set('Ошибка: ' + AuthService.errorText(err))
      });
    });
  }
}

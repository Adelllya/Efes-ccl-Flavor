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

/** 'ai': пары, которые предложил ИИ и сомелье ещё не подтвердил. */
type PairingFilter = 'all' | 'ai' | PairingType;

/** Подпись поля объяснения: она же стоит в тексте ошибки, когда поле пустое. */
const EXPLANATION_LABEL = 'Почему сочетание работает';

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
          <button type="button" class="wa-iconbtn" title="Новое сочетание" aria-label="Новое сочетание" (click)="openCreate()">
            <panel-icon name="plus" />
          </button>
        </div>
        <label class="wa-search">
          <panel-icon name="search" />
          <input type="text" placeholder="Блюдо или сорт" aria-label="Поиск: блюдо или сорт"
                 [ngModel]="search()" (ngModelChange)="search.set($event)" />
        </label>
        <div class="wa-pills">
          @for (p of pills; track p.value) {
            <button type="button" class="wa-pill" [class.active]="filter() === p.value" (click)="filter.set(p.value)">
              {{ p.label }}
            </button>
          }
        </div>
        @if (msg() && !form()) {
          <p class="wa-msg" [class.error]="isError(msg())" [attr.role]="isError(msg()) ? 'alert' : 'status'">{{ msg() }}</p>
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
                  @if (p.source === 'AI') { <span class="wa-chip wa-chip-pending">ИИ-подбор</span> }
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
                @if (isAi()) { <span class="wa-chip wa-chip-pending">ИИ-подбор</span> }
              </div>
              <div class="wa-fields">
                <div class="wa-field">
                  <span class="wa-label">Сорт</span>
                  <ft-select [options]="brandOptions()" [searchable]="true" placeholder="Выберите сорт" ariaLabel="Сорт" [(ngModel)]="f.brand" />
                </div>
                <div class="wa-field">
                  <span class="wa-label">Блюдо</span>
                  <ft-select [options]="dishOptions()" [searchable]="true" placeholder="Выберите блюдо" ariaLabel="Блюдо" [(ngModel)]="f.dish" />
                </div>
                <div class="wa-field">
                  <span class="wa-label">Тип сочетания</span>
                  <ft-select [options]="typeOptions" ariaLabel="Тип сочетания" [(ngModel)]="f.pairing_type" />
                </div>
                <label class="wa-field">
                  <span class="wa-label">Оценка: {{ f.compatibility_score }}/5</span>
                  <input class="wa-range" type="range" min="1" max="5" [(ngModel)]="f.compatibility_score" />
                </label>
                <label class="wa-field wa-field-wide">
                  <span class="wa-label">{{ explanationLabel }}</span>
                  <textarea class="input" rows="3" required [(ngModel)]="f.explanation"
                            placeholder="Например: хмелевая горчинка режет жирность вяленого мяса"></textarea>
                </label>
              </div>
              @if (formError()) {
                <p class="wa-error" role="alert">{{ formError() }}</p>
              }
              <div class="wa-actions">
                <button type="button" class="btn-amber" [disabled]="saving() || confirming()" (click)="save()">
                  <panel-icon name="save" /> {{ saving() ? 'Сохраняем...' : 'Сохранить' }}
                </button>
                @if (isAi()) {
                  <!-- С правками в форме подтверждать "как есть" нечего: их записывает "Сохранить" -->
                  <button type="button" class="btn-outline" [disabled]="saving() || confirming() || edited(f)"
                          [title]="edited(f) ? 'В форме есть правки: запишите их кнопкой Сохранить' : 'Оставить пару как есть и снять пометку ИИ'"
                          (click)="confirmAi()">
                    <panel-icon name="check" /> {{ confirming() ? 'Подтверждаем...' : 'Подтвердить как сомелье' }}
                  </button>
                }
                @if (f.id) {
                  <button type="button" class="btn-outline panel-danger" (click)="askDelete(f.id)">
                    <panel-icon name="trash" /> {{ pendingDelete() === f.id ? 'Точно удалить?' : 'Удалить' }}
                  </button>
                } @else {
                  <button type="button" class="btn-outline" (click)="close()">Отмена</button>
                }
                @if (msg()) {
                  <p class="wa-msg" [class.error]="isError(msg())" [attr.role]="isError(msg()) ? 'alert' : 'status'">{{ msg() }}</p>
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
  readonly explanationLabel = EXPLANATION_LABEL;
  readonly typeOptions: SelectOption[] = PAIRING_TYPE_CHOICES;
  readonly pills: { value: PairingFilter; label: string }[] = [
    { value: 'all', label: 'Все' },
    { value: 'ai', label: 'От ИИ' },
    ...PAIRING_TYPE_CHOICES.map(c => ({ value: c.value as PairingFilter, label: c.label }))
  ];

  search = signal('');
  filter = signal<PairingFilter>('all');
  form = signal<PairingForm | null>(null);
  formError = signal<string | null>(null);
  saving = signal(false);
  /** Идёт "Подтвердить как сомелье". */
  confirming = signal(false);
  msg = signal<string | null>(null);
  pendingDelete = signal<string | null>(null);

  isError = isErrorText;

  formList = computed(() => {
    const f = this.form();
    return f ? [f] : [];
  });

  /** Сохранённая пара, открытая в форме; у новой пары её нет. */
  current = computed(() => {
    const id = this.form()?.id;
    return id ? this.pairings().find(p => p.id === id) ?? null : null;
  });

  /** Открытую пару предложил ИИ, сомелье её ещё не подтвердил. */
  isAi = computed(() => this.current()?.source === 'AI');

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
      (f === 'all' || (f === 'ai' ? p.source === 'AI' : p.pairing_type === f)) &&
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

  /** В форме есть правки относительно сохранённой пары. */
  edited(f: PairingForm): boolean {
    const p = this.current();
    return !!p && (f.brand !== p.brand || f.dish !== p.dish || Number(f.compatibility_score) !== p.compatibility_score
      || f.pairing_type !== p.pairing_type || f.explanation.trim() !== (p.explanation || '').trim());
  }

  openCreate() {
    this.resetMessages();
    this.form.set({
      key: 'new', id: null, brand: '', dish: '', compatibility_score: 4, pairing_type: 'COMPLEMENT', explanation: ''
    });
  }

  openEdit(p: FoodPairing) {
    this.resetMessages();
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
    // Сервер без объяснения пару не примет: говорим об этом сразу и названием поля из формы
    if (!f.explanation.trim()) {
      this.formError.set(`Ошибка: заполните поле "${EXPLANATION_LABEL}"`);
      return;
    }
    const payload: Partial<FoodPairing> = {
      brand: f.brand,
      dish: f.dish,
      compatibility_score: Number(f.compatibility_score),
      pairing_type: f.pairing_type,
      explanation: f.explanation.trim()
    };
    const title = this.pairTitle(f.dish, f.brand);
    this.saving.set(true);
    this.formError.set(null);
    const req = f.id ? this.api.updatePairing(f.id, payload) : this.api.createPairing(payload);
    req.subscribe({
      next: saved => {
        this.saving.set(false);
        const list = this.pairings();
        this.changed.emit(f.id ? list.map(p => p.id === saved.id ? saved : p) : [saved, ...list]);
        // Пока шёл запрос, могли открыть другое сочетание: его форму и сообщения не трогаем
        if (this.form() !== f) return;
        this.openEdit(saved);
        flash(this.msg, f.id ? 'Сочетание обновлено' : 'Сочетание добавлено');
      },
      error: err => {
        this.saving.set(false);
        this.fail(f, 'не сохранено', title, err);
      }
    });
  }

  /**
   * Сомелье согласен с парой ИИ как есть: отправляем её без правок.
   * После любого удачного PATCH сервер считает пару парой сомелье, строку берём из ответа.
   */
  confirmAi() {
    const f = this.form();
    const p = this.current();
    if (!f || !p) return;
    if (!(p.explanation || '').trim()) {
      this.formError.set(`Ошибка: у пары нет объяснения. Заполните поле "${EXPLANATION_LABEL}" и нажмите "Сохранить"`);
      return;
    }
    const title = this.pairTitle(p.dish, p.brand);
    this.confirming.set(true);
    this.formError.set(null);
    this.api.updatePairing(p.id, {
      brand: p.brand, dish: p.dish, compatibility_score: p.compatibility_score,
      pairing_type: p.pairing_type, explanation: p.explanation
    }).subscribe({
      next: saved => {
        this.confirming.set(false);
        this.changed.emit(this.pairings().map(x => x.id === saved.id ? saved : x));
        if (this.form() === f) flash(this.msg, 'Сочетание подтверждено');
      },
      error: err => {
        this.confirming.set(false);
        this.fail(f, 'не подтверждено', title, err);
      }
    });
  }

  askDelete(id: string) {
    confirmTwice(this.pendingDelete, id, () => {
      const f = this.form();
      const title = f ? this.pairTitle(f.dish, f.brand) : '';
      this.api.deletePairing(id).subscribe({
        next: () => {
          this.changed.emit(this.pairings().filter(x => x.id !== id));
          // Форму закрываем, только если в ней всё ещё удалённое сочетание
          if (this.form()?.id !== id) return;
          this.close();
          flash(this.msg, 'Сочетание удалено');
        },
        error: err => this.fail(f, 'не удалено', title, err)
      });
    });
  }

  /** Сообщения прошлой формы под новой не показываем: "обновлено" относилось к другому сочетанию. */
  private resetMessages() {
    this.formError.set(null);
    this.msg.set(null);
  }

  private pairTitle(dish: string, brand: string): string {
    return [this.dishName(dish), this.brandName(brand)].filter(Boolean).join(' и ');
  }

  /** Ошибка открытой формы встаёт под её полями; ошибка формы, которую уже закрыли, называет своё сочетание. */
  private fail(f: PairingForm | null, what: string, title: string, err: unknown) {
    const reason = AuthService.errorText(err);
    if (f && this.form() === f) this.formError.set('Ошибка: ' + reason);
    else flash(this.msg, `Ошибка: сочетание "${title}" ${what}. ${reason}`, 6000);
  }
}

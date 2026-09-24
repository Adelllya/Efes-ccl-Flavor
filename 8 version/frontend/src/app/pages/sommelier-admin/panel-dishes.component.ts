import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { CookingMethod, CuisineType, Dish, FatType, TasteType, WeightType } from '../../models/flavor-tree.models';
import { FtSelectComponent, SelectOption } from '../../ui/ft-select.component';
import { PanelIconComponent } from './panel-icons';
import { PanelPhotoComponent } from './panel-photo.component';
import {
  COOKING_CHOICES, CUISINE_CHOICES, FAT_CHOICES, TASTE_CHOICES, WEIGHT_CHOICES,
  confirmTwice, flash, initialOf, isErrorText, labelOf
} from './panel-shared';

interface DishForm {
  /** id блюда или 'new': по нему @for понимает, что открыли другую карточку. */
  key: string;
  id: string | null;
  name: string;
  category: string;
  cuisine: CuisineType;
  dominant_taste: TasteType;
  weight: WeightType;
  fat_level: FatType;
  cooking_method: CookingMethod;
  description: string;
  image_url: string;
}

type DishFilter = 'all' | CuisineType;

/** Вкладка "Блюда": список слева, форма и фото выбранного блюда справа, "+" создаёт новое. */
@Component({
  selector: 'panel-dishes',
  standalone: true,
  imports: [FormsModule, PanelIconComponent, FtSelectComponent, PanelPhotoComponent],
  template: `
    <div class="wa-page" [class.has-selection]="!!form()">
      <aside class="wa-list">
        <div class="wa-list-head">
          <h2 class="wa-list-title">Блюда @if (loaded()) { <span class="wa-count">{{ dishes().length }}</span> }</h2>
          <button type="button" class="wa-iconbtn" title="Новое блюдо" (click)="openCreate()">
            <panel-icon name="plus" />
          </button>
        </div>
        <label class="wa-search">
          <panel-icon name="search" />
          <input type="text" placeholder="Название или категория" [ngModel]="search()" (ngModelChange)="search.set($event)" />
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
            @for (d of filtered(); track d.id) {
              <button type="button" class="wa-row" [class.active]="form()?.id === d.id" (click)="openEdit(d)">
                <span class="wa-avatar">
                  @if (d.image) { <img [src]="d.image" [alt]="d.name" /> } @else { {{ initial(d.name) }} }
                </span>
                <span class="wa-row-body">
                  <span class="wa-row-title">{{ d.name }}</span>
                  <span class="wa-row-sub">{{ d.cuisine_display || d.cuisine }}@if (d.category) {<span class="wa-dot"></span>{{ d.category }}}</span>
                </span>
                <span class="wa-row-meta">
                  <span class="wa-chip">{{ d.dominant_taste_display || d.dominant_taste }}</span>
                  @if (d.menu_items_count) { <span class="wa-time">в меню: {{ d.menu_items_count }}</span> }
                </span>
              </button>
            } @empty {
              <p class="wa-empty">{{ dishes().length ? 'Ничего не найдено' : 'Блюд пока нет' }}</p>
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
                <span class="wa-avatar wa-avatar-lg">
                  @if (currentImage(); as img) { <img [src]="img" [alt]="f.name" /> } @else { {{ initial(f.name || 'Н') }} }
                </span>
                <div class="wa-card-head-text">
                  <h3 class="wa-card-title">{{ f.id ? (f.name || 'Блюдо') : 'Новое блюдо' }}</h3>
                  <p class="wa-card-sub">{{ f.id ? subtitle(f) : 'Вкус, вес и способ приготовления нужны подбору сорта' }}</p>
                </div>
                @if (selectedDish(); as d) {
                  <div class="wa-chips">
                    <span class="wa-chip">в меню: {{ d.menu_items_count ?? 0 }}</span>
                    <span class="wa-chip">{{ plural(d.pairings_count ?? 0, 'сочетание', 'сочетания', 'сочетаний') }}</span>
                  </div>
                }
              </div>
              <div class="wa-fields">
                <label class="wa-field">
                  <span class="wa-label">Название</span>
                  <input class="input" type="text" [(ngModel)]="f.name" placeholder="Бешбармак" />
                </label>
                <label class="wa-field">
                  <span class="wa-label">Категория</span>
                  <input class="input" type="text" [(ngModel)]="f.category" placeholder="Мясное" />
                </label>
                <div class="wa-field">
                  <span class="wa-label">Кухня</span>
                  <ft-select [options]="cuisineOptions" [(ngModel)]="f.cuisine" />
                </div>
                <div class="wa-field">
                  <span class="wa-label">Доминирующий вкус</span>
                  <ft-select [options]="tasteOptions" [(ngModel)]="f.dominant_taste" />
                </div>
                <div class="wa-field">
                  <span class="wa-label">Вес блюда</span>
                  <ft-select [options]="weightOptions" [(ngModel)]="f.weight" />
                </div>
                <div class="wa-field">
                  <span class="wa-label">Жирность</span>
                  <ft-select [options]="fatOptions" [(ngModel)]="f.fat_level" />
                </div>
                <div class="wa-field">
                  <span class="wa-label">Способ приготовления</span>
                  <ft-select [options]="cookingOptions" [(ngModel)]="f.cooking_method" />
                </div>
                <label class="wa-field wa-field-wide">
                  <span class="wa-label">Описание</span>
                  <textarea class="input" rows="3" [(ngModel)]="f.description"
                            placeholder="Что в блюде и как его подают: гость увидит это в меню"></textarea>
                </label>
              </div>
              @if (sharedHint(); as hint) {
                <p class="wa-info"><panel-icon name="alert" /> {{ hint }}</p>
              }
              @if (formError()) {
                <p class="wa-error">{{ formError() }}</p>
              }
              <div class="wa-actions">
                <button type="button" class="btn-amber" [disabled]="saving()" (click)="save()">
                  <panel-icon name="save" /> {{ saving() ? 'Сохраняем...' : (f.id ? 'Сохранить' : 'Создать блюдо') }}
                </button>
                @if (f.id) {
                  @if (canDelete()) {
                    <button type="button" class="btn-outline panel-danger" (click)="askDelete(f.id)">
                      <panel-icon name="trash" /> {{ pendingDelete() === f.id ? 'Точно удалить?' : 'Удалить' }}
                    </button>
                  }
                } @else {
                  <button type="button" class="btn-outline" (click)="close()">Отмена</button>
                }
                @if (msg()) {
                  <p class="wa-msg" [class.error]="isError(msg())">{{ msg() }}</p>
                }
              </div>
            </div>

            <div class="wa-card">
              <div class="wa-card-head">
                <div class="wa-card-head-text">
                  <h3 class="wa-card-title">Фото</h3>
                  <p class="wa-card-sub">
                    @if (f.id) { Гость видит его в меню рядом с рекомендацией сорта }
                    @else { Выберите файл сейчас: он загрузится сразу после создания блюда }
                  </p>
                </div>
              </div>
              <panel-photo
                [currentUrl]="f.id ? currentImage() : null"
                [busy]="photoBusy()"
                [error]="photoError()"
                [deferred]="!f.id"
                [showUrl]="true"
                [(url)]="f.image_url"
                title="Фото блюда"
                (fileChosen)="uploadPhoto(f.id, $event)"
                (fileSelected)="pendingFile = $event"
                (removeRequested)="removePhoto(f.id)"
              />
              @if (f.image_url && !f.id) {
                <p class="wa-muted">Ссылка сохранится вместе с блюдом.</p>
              }
            </div>
          </div>
        } @empty {
          <div class="wa-detail-empty">Выберите элемент слева</div>
        }
      </section>
    </div>
  `
})
export class PanelDishesComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  dishes = input<Dish[]>([]);
  /** false, пока родитель ждёт справочник: вместо "Блюд пока нет" показываем загрузку. */
  loaded = input(false);
  /** Новый список после создания, правки, удаления или смены фото; родитель хранит его. */
  changed = output<Dish[]>();
  /** id удалённого блюда: вместе с ним сервер удалил и его сочетания, родитель их перечитывает. */
  deleted = output<string>();

  readonly initial = initialOf;
  readonly cuisineOptions: SelectOption[] = CUISINE_CHOICES;
  readonly tasteOptions: SelectOption[] = TASTE_CHOICES;
  readonly weightOptions: SelectOption[] = WEIGHT_CHOICES;
  readonly fatOptions: SelectOption[] = FAT_CHOICES;
  readonly cookingOptions: SelectOption[] = COOKING_CHOICES;
  readonly pills: { value: DishFilter; label: string }[] = [
    { value: 'all', label: 'Все' },
    ...CUISINE_CHOICES.map(c => ({ value: c.value as DishFilter, label: c.label }))
  ];

  search = signal('');
  filter = signal<DishFilter>('all');
  form = signal<DishForm | null>(null);
  formError = signal<string | null>(null);
  saving = signal(false);
  msg = signal<string | null>(null);
  pendingDelete = signal<string | null>(null);

  // Фото
  photoBusy = signal(false);
  photoError = signal<string | null>(null);
  /** Файл, выбранный для нового блюда: уйдёт на сервер после создания. */
  pendingFile: File | null = null;

  isError = isErrorText;

  /** Удалять блюда может только модератор: они общие для всех заведений и сочетаний. */
  canDelete = computed(() => this.auth.role() === 'moderator');

  formList = computed(() => {
    const f = this.form();
    return f ? [f] : [];
  });

  selectedDish = computed(() => {
    const id = this.form()?.id;
    return id ? this.dishes().find(d => d.id === id) ?? null : null;
  });

  /** Текущее фото с сервера: файл или ссылка. Для нового блюда пусто. */
  currentImage = computed(() => this.selectedDish()?.image || null);

  /** Администратору заведения: чужие меню с этим блюдом трогать нельзя. */
  sharedHint = computed(() => {
    const d = this.selectedDish();
    if (!d || this.auth.role() === 'moderator' || !d.menu_items_count) return null;
    return 'Блюдо есть в меню заведений. Если оно стоит в чужом меню, изменить его сможет только модератор.';
  });

  filtered = computed(() => {
    const q = this.search().toLowerCase().trim();
    const f = this.filter();
    return this.dishes().filter(d =>
      (f === 'all' || d.cuisine === f) &&
      (!q ||
        d.name.toLowerCase().includes(q) ||
        (d.category || '').toLowerCase().includes(q) ||
        (d.cuisine_display || '').toLowerCase().includes(q))
    );
  });

  subtitle(f: DishForm): string {
    const parts = [labelOf(CUISINE_CHOICES, f.cuisine), f.category.trim()].filter(Boolean);
    return parts.join(', ');
  }

  plural(n: number, one: string, few: string, many: string): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    const word = (mod10 === 1 && mod100 !== 11) ? one
      : (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) ? few
      : many;
    return `${n} ${word}`;
  }

  openCreate() {
    this.resetState();
    this.form.set({
      key: 'new', id: null, name: '', category: 'Основное', cuisine: 'KZ', dominant_taste: 'UMAMI',
      weight: 'MEDIUM', fat_level: 'MEDIUM', cooking_method: 'GRILLED', description: '', image_url: ''
    });
  }

  openEdit(d: Dish) {
    this.resetState();
    this.form.set({
      key: d.id, id: d.id, name: d.name, category: d.category || '', cuisine: d.cuisine,
      dominant_taste: d.dominant_taste, weight: d.weight, fat_level: d.fat_level,
      cooking_method: d.cooking_method, description: d.description || '', image_url: d.image_url || ''
    });
  }

  close() {
    this.resetState();
    this.form.set(null);
  }

  save() {
    const f = this.form();
    if (!f) return;
    const name = f.name.trim();
    if (!name) {
      this.formError.set('Укажите название блюда');
      return;
    }
    const payload: Partial<Dish> = {
      name, category: f.category.trim(), cuisine: f.cuisine, dominant_taste: f.dominant_taste,
      weight: f.weight, fat_level: f.fat_level, cooking_method: f.cooking_method,
      description: f.description.trim(), image_url: f.image_url.trim()
    };
    this.saving.set(true);
    this.formError.set(null);
    const isNew = !f.id;
    const req = f.id ? this.api.updateDish(f.id, payload) : this.api.createDish(payload);
    req.subscribe({
      next: saved => {
        this.saving.set(false);
        this.publish(saved, isNew);
        // Файл, выбранный до создания, отправляем сразу после него
        const file = this.pendingFile;
        this.openEdit(saved);
        flash(this.msg, isNew ? 'Блюдо добавлено' : 'Блюдо обновлено');
        if (isNew && file) this.uploadPhoto(saved.id, file);
      },
      error: err => {
        this.saving.set(false);
        this.formError.set('Ошибка: ' + AuthService.errorText(err));
      }
    });
  }

  askDelete(id: string) {
    confirmTwice(this.pendingDelete, id, () => {
      this.api.deleteDish(id).subscribe({
        next: () => {
          this.changed.emit(this.dishes().filter(x => x.id !== id));
          this.deleted.emit(id);
          this.close();
          flash(this.msg, 'Блюдо удалено');
        },
        error: err => this.formError.set('Ошибка: ' + AuthService.errorText(err))
      });
    });
  }

  // Фото

  uploadPhoto(id: string | null, file: File) {
    if (!id) return;
    this.photoBusy.set(true);
    this.photoError.set(null);
    this.api.uploadDishImage(id, file).subscribe({
      next: saved => {
        this.publish(saved, false);
        this.photoBusy.set(false);
        flash(this.msg, 'Фото загружено');
      },
      error: err => {
        this.photoError.set('Ошибка: ' + AuthService.errorText(err));
        this.photoBusy.set(false);
      }
    });
  }

  /** Убирает файл; если фото было ссылкой, чистим и её, чтобы блюдо осталось без фото. */
  removePhoto(id: string | null) {
    if (!id) return;
    this.photoBusy.set(true);
    this.photoError.set(null);
    this.api.deleteDishImage(id).pipe(
      switchMap(saved => saved.image_url ? this.api.updateDish(id, { image_url: '' }) : of(saved))
    ).subscribe({
      next: saved => {
        this.publish(saved, false);
        this.form.update(f => f && f.id === id ? { ...f, image_url: '' } : f);
        this.photoBusy.set(false);
        flash(this.msg, 'Фото удалено');
      },
      error: err => {
        this.photoError.set('Ошибка: ' + AuthService.errorText(err));
        this.photoBusy.set(false);
      }
    });
  }

  private publish(saved: Dish, isNew: boolean) {
    const list = this.dishes();
    this.changed.emit(isNew ? [saved, ...list] : list.map(d => d.id === saved.id ? saved : d));
  }

  private resetState() {
    this.formError.set(null);
    this.photoError.set(null);
    this.pendingDelete.set(null);
    this.pendingFile = null;
  }
}

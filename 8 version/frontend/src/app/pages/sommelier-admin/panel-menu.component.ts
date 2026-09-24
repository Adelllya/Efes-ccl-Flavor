import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { Brand, Dish, MenuDrink, MenuItem, Venue, VenueType } from '../../models/flavor-tree.models';
import { FtSelectComponent, SelectOption } from '../../ui/ft-select.component';
import { PanelIconComponent } from './panel-icons';
import { PanelPhotoComponent } from './panel-photo.component';
import { VENUE_TYPE_CHOICES, confirmTwice, countOf, flash, initialOf, isErrorText } from './panel-shared';

interface VenueForm {
  name: string;
  venue_type: VenueType;
  city: string;
  address: string;
  phone: string;
  working_hours: string;
  description: string;
  logo_url: string;
  cover: string;
  is_published: boolean;
  tables_count: number;
}

/** Что открыто справа: заведение или черновик нового ('new'). */
interface DetailEntry {
  key: string;
  venue: Venue | null;
}

interface MenuSection {
  name: string;
  items: MenuItem[];
  /** Наименьший порядок в разделе: по нему гость видит разделы. */
  order: number;
}

type VenueFilter = 'all' | 'published' | 'hidden';

const DEFAULT_SECTION = 'Основное';
const DEFAULT_TABLES = 20;
const DEFAULT_VOLUME = '0,5 л';

const LOGO_HINT = 'PNG, JPG или WebP, до 5 МБ. Квадратный логотип 400×400 на светлом или прозрачном фоне.';

function emptyVenue(): VenueForm {
  return {
    name: '', venue_type: 'RESTAURANT', city: 'Алматы', address: '', phone: '',
    working_hours: '', description: '', logo_url: '', cover: '', is_published: true,
    tables_count: DEFAULT_TABLES
  };
}

/** Порядок внутри раздела как у бэкенда: порядок, затем название блюда. */
function sortItems(list: MenuItem[]): MenuItem[] {
  return [...list].sort((a, b) =>
    (a.sort_order - b.sort_order) ||
    (a.dish_name || '').localeCompare(b.dish_name || '', 'ru')
  );
}

function sortDrinks(list: MenuDrink[]): MenuDrink[] {
  return [...list].sort((a, b) =>
    (a.sort_order - b.sort_order) ||
    (a.brand_name || '').localeCompare(b.brand_name || '', 'ru')
  );
}

/** Следующий порядок для новой строки: после последней, чтобы она не прыгала наверх. */
const PRICE_ERROR = 'Ошибка: укажите цену не меньше 0';

/** Цена из поля таблицы: число не меньше нуля, иначе null (пустое, нечисловое или отрицательное). */
function priceOf(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function nextOrder(list: { sort_order: number }[]): number {
  return list.length ? Math.max(...list.map(x => Number(x.sort_order) || 0)) + 1 : 0;
}

/** Вкладка "Меню": заведения слева, справа карточка, логотип, позиции меню и карта напитков выбранного. */
@Component({
  selector: 'panel-menu',
  standalone: true,
  imports: [FormsModule, PanelIconComponent, FtSelectComponent, PanelPhotoComponent],
  template: `
    <div class="wa-page" [class.has-selection]="hasSelection()">
      <aside class="wa-list">
        <div class="wa-list-head">
          <h2 class="wa-list-title">Заведения @if (!loadingVenues()) { <span class="wa-count">{{ venues().length }}</span> }</h2>
          @if (canCreate()) {
            <button type="button" class="wa-iconbtn" title="Новое заведение" (click)="startCreate()">
              <panel-icon name="plus" />
            </button>
          }
        </div>
        <label class="wa-search">
          <panel-icon name="search" />
          <input type="text" placeholder="Название или город" [ngModel]="search()" (ngModelChange)="search.set($event)" />
        </label>
        @if (isModerator()) {
          <div class="wa-pills">
            @for (p of pills; track p.value) {
              <button type="button" class="wa-pill" [class.active]="filter() === p.value" (click)="filter.set(p.value)">
                {{ p.label }}
              </button>
            }
          </div>
        }
        <div class="wa-rows">
          @if (loadingVenues()) {
            <p class="wa-empty">Загрузка...</p>
          } @else if (loadError()) {
            <div class="wa-loadbar">
              <panel-icon name="alert" />
              <span>{{ loadError() }}</span>
              <button type="button" class="btn-outline" (click)="loadVenues()"><panel-icon name="refresh" /> Обновить</button>
            </div>
          } @else {
            @for (v of filtered(); track v.id) {
              <button type="button" class="wa-row" [class.active]="!creating() && selectedSlug() === v.slug" (click)="selectVenue(v.slug)">
                <span class="wa-avatar">
                  @if (v.logo) { <img [src]="v.logo" [alt]="v.name" /> } @else { {{ initial(v.name) }} }
                </span>
                <span class="wa-row-body">
                  <span class="wa-row-title">{{ v.name }}</span>
                  <span class="wa-row-sub">{{ v.venue_type_display || v.venue_type }}<span class="wa-dot"></span>{{ venueLine(v) }}</span>
                </span>
                <span class="wa-row-meta">
                  @if (!v.is_published) { <span class="wa-chip wa-chip-pending">Скрыто</span> }
                  <span class="wa-time">{{ countOf(v.items_count ?? 0, 'позиция', 'позиции', 'позиций') }}</span>
                </span>
              </button>
            } @empty {
              <p class="wa-empty">
                @if (venues().length) { Ничего не найдено }
                @else if (isModerator()) { Заведений пока нет }
                @else { У вас пока нет заведения. Заполните карточку справа }
              </p>
            }
          }
        </div>
      </aside>

      <section class="wa-detail">
        @for (d of detailList(); track d.key) {
          <div class="wa-detail-enter">
            <button type="button" class="wa-back" (click)="select(null)"><panel-icon name="arrowLeft" /> К списку</button>

            @if (d.venue; as v) {
              <div class="wa-card">
                <div class="wa-card-head">
                  <span class="wa-avatar wa-avatar-lg">
                    @if (v.logo) { <img [src]="v.logo" [alt]="v.name" /> } @else { {{ initial(v.name) }} }
                  </span>
                  <div class="wa-card-head-text">
                    <h3 class="wa-card-title">{{ v.name }}</h3>
                    <p class="wa-card-sub">{{ v.venue_type_display || v.venue_type }}<span class="wa-dot"></span>{{ venueLine(v) }}</p>
                  </div>
                  <div class="wa-chips">
                    @if (v.is_published) { <span class="wa-chip wa-chip-approved">Видно гостям</span> }
                    @else { <span class="wa-chip wa-chip-pending">Скрыто от гостей</span> }
                    <span class="wa-chip">{{ countOf(v.tables_count || 0, 'стол', 'стола', 'столов') }}</span>
                    @if (isModerator()) {
                      <span class="wa-chip">{{ v.owner ? 'владелец: ' + v.owner.username : 'без владельца' }}</span>
                    }
                  </div>
                </div>
                <div class="wa-guest">
                  <panel-icon name="link" />
                  <code>{{ guestUrl(v) }}</code>
                  <button type="button" class="btn-outline" (click)="openMenu.emit(v.slug)">
                    <panel-icon name="external" /> Открыть меню гостя
                  </button>
                </div>
                <p class="wa-muted wa-guest-hint">Для QR на столе добавьте к ссылке номер стола: {{ guestUrl(v) }}?table=7</p>
              </div>
            }

            <div class="wa-card">
              <h3 class="wa-card-title">{{ d.venue ? 'Карточка заведения' : 'Новое заведение' }}</h3>
              <div class="wa-fields">
                <label class="wa-field">
                  <span class="wa-label">Название</span>
                  <input class="input" type="text" [(ngModel)]="form.name" placeholder="Efes Beer Garden" />
                </label>
                <div class="wa-field">
                  <span class="wa-label">Тип</span>
                  <ft-select [options]="venueTypes" [(ngModel)]="form.venue_type" />
                </div>
                <label class="wa-field">
                  <span class="wa-label">Город</span>
                  <input class="input" type="text" [(ngModel)]="form.city" />
                </label>
                <label class="wa-field">
                  <span class="wa-label">Адрес</span>
                  <input class="input" type="text" [(ngModel)]="form.address" placeholder="пр. Достык 100" />
                </label>
                <label class="wa-field">
                  <span class="wa-label">Телефон</span>
                  <input class="input" type="text" [(ngModel)]="form.phone" placeholder="+7 727 000 00 00" />
                </label>
                <label class="wa-field">
                  <span class="wa-label">Часы работы</span>
                  <input class="input" type="text" [(ngModel)]="form.working_hours" placeholder="12:00-02:00" />
                </label>
                <label class="wa-field">
                  <span class="wa-label">Количество столов</span>
                  <input class="input" type="number" min="1" max="500" [(ngModel)]="form.tables_count" />
                  <span class="wa-hint">Гость выбирает стол из этого диапазона перед заказом</span>
                </label>
                <label class="wa-field">
                  <span class="wa-label">Ссылка на обложку</span>
                  <input class="input" type="url" [(ngModel)]="form.cover" placeholder="https://..." />
                </label>
                <label class="wa-field wa-field-wide">
                  <span class="wa-label">Описание</span>
                  <textarea class="input" rows="3" [(ngModel)]="form.description"
                            placeholder="Пара фраз о заведении: гость увидит их над меню"></textarea>
                </label>
                <label class="wa-check wa-field-wide">
                  <input type="checkbox" [(ngModel)]="form.is_published" /> Показывать гостям
                </label>
              </div>
              <div class="wa-actions">
                <button type="button" class="btn-amber" [disabled]="venueSaving()" (click)="saveVenue()">
                  <panel-icon name="save" /> {{ venueSaving() ? 'Сохраняем...' : (d.venue ? 'Сохранить' : 'Создать заведение') }}
                </button>
                @if (!d.venue && venues().length) {
                  <button type="button" class="btn-outline" (click)="cancelCreate()">Отмена</button>
                }
                @if (venueMsg()) {
                  <p class="wa-msg" [class.error]="isError(venueMsg())">{{ venueMsg() }}</p>
                }
              </div>
            </div>

            <div class="wa-card">
              <div class="wa-card-head">
                <div class="wa-card-head-text">
                  <h3 class="wa-card-title">Логотип</h3>
                  <p class="wa-card-sub">
                    @if (d.venue) { Кружок рядом с названием в списке заведений и над меню }
                    @else { Выберите файл сейчас: он загрузится сразу после создания заведения }
                  </p>
                </div>
              </div>
              <panel-photo
                [currentUrl]="d.venue?.logo || null"
                [busy]="logoBusy()"
                [error]="logoError()"
                [deferred]="!d.venue"
                [showUrl]="true"
                [(url)]="form.logo_url"
                [hint]="logoHint"
                title="Логотип заведения"
                (fileChosen)="uploadLogo(d.venue, $event)"
                (fileSelected)="pendingLogo = $event"
                (removeRequested)="removeLogo(d.venue)"
              />
            </div>

            @if (d.venue; as v) {
              <div class="wa-card">
                <div class="wa-card-head">
                  <div class="wa-card-head-text">
                    <h3 class="wa-card-title">Позиции меню <span class="wa-count">{{ items().length }}</span></h3>
                    <p class="wa-card-sub">Цена в тенге, порция как в меню. Порядок задаёт место в разделе, а раздел с наименьшим порядком гость видит первым</p>
                  </div>
                </div>

                <div class="wa-fields">
                  <div class="wa-field">
                    <span class="wa-label">Добавить блюдо из справочника</span>
                    <ft-select [options]="pickOptions()" [searchable]="true"
                               [placeholder]="loaded() ? 'Выберите блюдо' : 'Загружаем справочник блюд...'"
                               searchPlaceholder="Название блюда" emptyText="Все блюда из справочника уже в меню"
                               [disabled]="!loaded()"
                               [ngModel]="pickDish()" (ngModelChange)="pickDish.set($event)" />
                  </div>
                  <label class="wa-field">
                    <span class="wa-label">Раздел меню</span>
                    <input class="input" type="text" [ngModel]="pickSection()" (ngModelChange)="pickSection.set($event)" placeholder="Основное" list="wa-section-names" />
                    <datalist id="wa-section-names">
                      @for (s of sections(); track s.name) { <option [value]="s.name"></option> }
                    </datalist>
                  </label>
                </div>
                <div class="wa-actions">
                  <button type="button" class="btn-amber" [disabled]="!pickDish() || adding()" (click)="addDish(v)">
                    <panel-icon name="plus" /> {{ adding() ? 'Добавляем...' : 'Добавить в меню' }}
                  </button>
                  @if (itemsMsg()) {
                    <p class="wa-msg" [class.error]="isError(itemsMsg())">{{ itemsMsg() }}</p>
                  }
                </div>

                @if (loadingItems()) {
                  <p class="wa-muted">Загрузка позиций...</p>
                } @else if (!items().length) {
                  <p class="wa-muted">В меню пока нет блюд. Выберите блюдо выше</p>
                } @else {
                  <div class="wa-table">
                    <div class="wa-table-head">
                      <span>Блюдо</span><span>Цена, тг</span><span>Раздел</span><span>Порция</span><span>Порядок</span><span></span>
                    </div>
                    @for (s of sections(); track s.name; let i = $index) {
                      <div class="wa-table-group">{{ i + 1 }}. {{ s.name }}</div>
                      @for (row of s.items; track row.id) {
                        <div class="wa-table-row" [class.off]="!row.is_available">
                          <div class="wa-table-dish">
                            <div class="wa-row-title">{{ row.dish_name }}</div>
                            <label class="wa-check wa-check-sm">
                              <input type="checkbox" [checked]="row.is_available" (change)="toggleAvailable(row, $event)" /> В наличии
                            </label>
                          </div>
                          <input class="input" type="number" min="0" step="50" [(ngModel)]="row.price" />
                          <input class="input" type="text" [(ngModel)]="row.section" />
                          <input class="input" type="text" [(ngModel)]="row.portion" placeholder="350 г" />
                          <input class="input" type="number" [(ngModel)]="row.sort_order" />
                          <div class="wa-table-actions">
                            <button type="button" class="wa-iconbtn" title="Сохранить" (click)="saveItem(row)">
                              <panel-icon name="save" />
                            </button>
                            <button type="button" class="wa-iconbtn wa-danger" title="Убрать из меню" (click)="askDeleteItem(row)">
                              @if (pendingDelete() === row.id) { <span class="wa-confirm">Точно?</span> } @else { <panel-icon name="trash" /> }
                            </button>
                          </div>
                        </div>
                      }
                    }
                  </div>
                }
              </div>

              <div class="wa-card">
                <div class="wa-card-head">
                  <div class="wa-card-head-text">
                    <h3 class="wa-card-title"><panel-icon name="beer" /> Напитки бара <span class="wa-count">{{ drinks().length }}</span></h3>
                    <p class="wa-card-sub">Сорта из каталога с ценой и объёмом. Гость видит их внизу меню и в подборе к блюду, если сорт есть в этой карте</p>
                  </div>
                </div>

                <div class="wa-fields">
                  <div class="wa-field">
                    <span class="wa-label">Добавить сорт из каталога</span>
                    <ft-select [options]="drinkOptions()" [searchable]="true"
                               [placeholder]="brandsLoaded() ? 'Выберите сорт' : 'Загружаем каталог сортов...'"
                               searchPlaceholder="Название или стиль" emptyText="Все сорта каталога уже в карте"
                               [disabled]="!brandsLoaded()"
                               [ngModel]="pickBrand()" (ngModelChange)="pickBrand.set($event)" />
                  </div>
                  <label class="wa-field">
                    <span class="wa-label">Цена, тг</span>
                    <input class="input" type="number" min="0" step="50" [ngModel]="pickPrice()" (ngModelChange)="pickPrice.set($event)" />
                  </label>
                  <label class="wa-field">
                    <span class="wa-label">Объём</span>
                    <input class="input" type="text" [ngModel]="pickVolume()" (ngModelChange)="pickVolume.set($event)" placeholder="0,5 л" />
                  </label>
                </div>
                <div class="wa-actions">
                  <button type="button" class="btn-amber" [disabled]="!pickBrand() || addingDrink()" (click)="addDrink(v)">
                    <panel-icon name="plus" /> {{ addingDrink() ? 'Добавляем...' : 'Добавить в карту' }}
                  </button>
                  @if (drinksMsg()) {
                    <p class="wa-msg" [class.error]="isError(drinksMsg())">{{ drinksMsg() }}</p>
                  }
                </div>

                @if (loadingDrinks()) {
                  <p class="wa-muted">Загрузка карты напитков...</p>
                } @else if (!drinks().length) {
                  <p class="wa-muted">В карте пока нет напитков. Выберите сорт выше</p>
                } @else {
                  <div class="wa-table wa-table-drinks">
                    <div class="wa-table-head">
                      <span>Сорт</span><span>Цена, тг</span><span>Объём</span><span>Порядок</span><span></span>
                    </div>
                    @for (row of drinks(); track row.id) {
                      <div class="wa-table-row" [class.off]="!row.is_available">
                        <div class="wa-table-dish wa-table-brand">
                          <span class="wa-avatar wa-avatar-sm">
                            @if (row.brand_image) { <img [src]="row.brand_image" [alt]="row.brand_name" /> } @else { {{ initial(row.brand_name) }} }
                          </span>
                          <div class="wa-table-brand-text">
                            <div class="wa-row-title">{{ row.brand_name }}</div>
                            <div class="wa-row-sub">{{ row.brand_style }}@if (row.abv !== null && row.abv !== undefined) {<span class="wa-dot"></span>{{ row.abv }}%}</div>
                            <label class="wa-check wa-check-sm">
                              <input type="checkbox" [checked]="row.is_available" (change)="toggleDrinkAvailable(row, $event)" /> В наличии
                            </label>
                          </div>
                        </div>
                        <input class="input" type="number" min="0" step="50" [(ngModel)]="row.price" />
                        <input class="input" type="text" [(ngModel)]="row.volume" placeholder="0,5 л" />
                        <input class="input" type="number" [(ngModel)]="row.sort_order" />
                        <div class="wa-table-actions">
                          <button type="button" class="wa-iconbtn" title="Сохранить" (click)="saveDrink(row)">
                            <panel-icon name="save" />
                          </button>
                          <button type="button" class="wa-iconbtn wa-danger" title="Убрать из карты" (click)="askDeleteDrink(row)">
                            @if (pendingDeleteDrink() === row.id) { <span class="wa-confirm">Точно?</span> } @else { <panel-icon name="trash" /> }
                          </button>
                        </div>
                      </div>
                    }
                  </div>
                }
              </div>
            }
          </div>
        } @empty {
          <div class="wa-detail-empty">Выберите элемент слева</div>
        }
      </section>
    </div>
  `
})
export class PanelMenuComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  dishes = input<Dish[]>([]);
  /** false, пока родитель ждёт справочник блюд: выбор блюда закрыт. */
  loaded = input(false);
  brands = input<Brand[]>([]);
  brandsLoaded = input(false);
  /** Slug заведения, чьё гостевое меню нужно открыть. */
  openMenu = output<string>();

  readonly venueTypes: SelectOption[] = VENUE_TYPE_CHOICES;
  readonly initial = initialOf;
  readonly countOf = countOf;
  readonly logoHint = LOGO_HINT;
  readonly pills: { value: VenueFilter; label: string }[] = [
    { value: 'all', label: 'Все' },
    { value: 'published', label: 'Видны гостям' },
    { value: 'hidden', label: 'Скрытые' }
  ];
  isError = isErrorText;

  isModerator = computed(() => this.auth.role() === 'moderator');

  search = signal('');
  filter = signal<VenueFilter>('all');
  venues = signal<Venue[]>([]);
  loadingVenues = signal(true);
  loadError = signal<string | null>(null);
  selectedSlug = signal<string | null>(null);
  venue = computed(() => this.venues().find(v => v.slug === this.selectedSlug()) ?? null);

  creating = signal(false);
  form: VenueForm = emptyVenue();
  venueSaving = signal(false);
  venueMsg = signal<string | null>(null);

  // Логотип
  logoBusy = signal(false);
  logoError = signal<string | null>(null);
  /** Файл, выбранный для нового заведения: уйдёт на сервер после создания. */
  pendingLogo: File | null = null;

  // Позиции
  items = signal<MenuItem[]>([]);
  loadingItems = signal(false);
  itemsMsg = signal<string | null>(null);
  pendingDelete = signal<string | null>(null);
  pickDish = signal('');
  pickSection = signal(DEFAULT_SECTION);
  adding = signal(false);

  // Карта напитков
  drinks = signal<MenuDrink[]>([]);
  loadingDrinks = signal(false);
  drinksMsg = signal<string | null>(null);
  pendingDeleteDrink = signal<string | null>(null);
  pickBrand = signal('');
  pickPrice = signal<number | string>(0);
  pickVolume = signal(DEFAULT_VOLUME);
  addingDrink = signal(false);

  /** Модератор создаёт сколько угодно, администратор заведения только первое. */
  canCreate = computed(() => this.isModerator() || (!this.loadingVenues() && !this.venues().length));

  hasSelection = computed(() => this.creating() || !!this.venue());

  detailList = computed<DetailEntry[]>(() => {
    if (this.creating()) return [{ key: 'new', venue: null }];
    const v = this.venue();
    return v ? [{ key: v.slug, venue: v }] : [];
  });

  filtered = computed(() => {
    const q = this.search().toLowerCase().trim();
    const f = this.filter();
    return this.venues().filter(v =>
      (f === 'all' || (f === 'published' ? v.is_published : !v.is_published)) &&
      (!q || v.name.toLowerCase().includes(q) || (v.city || '').toLowerCase().includes(q) || (v.address || '').toLowerCase().includes(q))
    );
  });

  /** Разделы в том же порядке, что видит гость: по наименьшему порядку внутри раздела, затем по названию. */
  sections = computed<MenuSection[]>(() => {
    const groups: MenuSection[] = [];
    for (const item of this.items()) {
      const name = item.section || DEFAULT_SECTION;
      let group = groups.find(g => g.name === name);
      if (!group) {
        group = { name, items: [], order: 0 };
        groups.push(group);
      }
      group.items.push(item);
    }
    for (const g of groups) {
      g.items = sortItems(g.items);
      g.order = Math.min(...g.items.map(i => Number(i.sort_order) || 0));
    }
    return groups.sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name, 'ru'));
  });

  /** Блюда, которых ещё нет в меню. */
  pickOptions = computed<SelectOption[]>(() => {
    const inMenu = new Set(this.items().map(i => i.dish));
    return this.dishes()
      .filter(d => !inMenu.has(d.id))
      .map(d => ({ value: d.id, label: d.name, hint: [d.cuisine_display || d.cuisine, d.category].filter(Boolean).join(', ') }));
  });

  /** Сорта каталога, которых ещё нет в карте бара. */
  drinkOptions = computed<SelectOption[]>(() => {
    const inList = new Set(this.drinks().map(d => d.brand));
    return this.brands()
      .filter(b => !inList.has(b.id))
      .map(b => ({
        value: b.id, label: b.name,
        hint: [b.style, b.abv !== null && b.abv !== undefined ? b.abv + '%' : ''].filter(Boolean).join(', ')
      }));
  });

  ngOnInit() {
    this.loadVenues();
  }

  venueLine(v: Venue): string {
    return [v.city, v.address].filter(Boolean).join(', ');
  }

  guestUrl(v: Venue): string {
    return location.origin + '/menu/' + v.slug;
  }

  loadVenues() {
    this.loadingVenues.set(true);
    this.loadError.set(null);
    const req = this.isModerator() ? this.api.getVenues() : this.api.getMyVenues();
    req.subscribe({
      next: list => {
        this.venues.set(list);
        this.loadingVenues.set(false);
        if (list.length) this.selectVenue(list[0].slug);
        else if (!this.isModerator()) this.startCreate();
      },
      error: err => {
        this.loadingVenues.set(false);
        this.loadError.set('Не удалось загрузить заведения: ' + AuthService.errorText(err));
      }
    });
  }

  select(slug: string | null) {
    if (slug) {
      this.selectVenue(slug);
      return;
    }
    this.creating.set(false);
    this.selectedSlug.set(null);
    this.items.set([]);
    this.drinks.set([]);
    this.resetState();
  }

  selectVenue(slug: string) {
    this.resetState();
    this.selectedSlug.set(slug);
    this.creating.set(false);
    const v = this.venue();
    if (!v) return;
    this.form = {
      name: v.name, venue_type: v.venue_type, city: v.city || '', address: v.address || '',
      phone: v.phone || '', working_hours: v.working_hours || '', description: v.description || '',
      logo_url: v.logo_url || '', cover: v.cover || '', is_published: v.is_published,
      tables_count: v.tables_count || DEFAULT_TABLES
    };
    this.loadItems(v.id);
    this.loadDrinks(v.id);
  }

  startCreate() {
    this.resetState();
    this.creating.set(true);
    this.selectedSlug.set(null);
    this.form = emptyVenue();
    this.items.set([]);
    this.drinks.set([]);
  }

  cancelCreate() {
    const first = this.venues()[0];
    if (first) this.selectVenue(first.slug);
    else this.creating.set(false);
  }

  saveVenue() {
    const payload: VenueForm = {
      ...this.form,
      name: this.form.name.trim(),
      address: this.form.address.trim(),
      city: this.form.city.trim(),
      logo_url: this.form.logo_url.trim(),
      cover: this.form.cover.trim(),
      tables_count: Math.trunc(Number(this.form.tables_count) || 0)
    };
    if (!payload.name || !payload.address) {
      flash(this.venueMsg, 'Ошибка: укажите название и адрес', 6000);
      return;
    }
    if (payload.tables_count < 1 || payload.tables_count > 500) {
      flash(this.venueMsg, 'Ошибка: количество столов от 1 до 500', 6000);
      return;
    }
    this.venueSaving.set(true);
    if (this.creating()) {
      this.api.createVenue(payload).subscribe({
        next: v => {
          this.venueSaving.set(false);
          this.venues.update(list => [...list, v]);
          // Файл логотипа, выбранный до создания, отправляем сразу после него
          const file = this.pendingLogo;
          this.selectVenue(v.slug);
          // У пользователя появилось заведение: профиль и ссылки должны это увидеть
          this.auth.loadMe();
          flash(this.venueMsg, 'Заведение создано');
          if (file) this.uploadLogo(v, file);
        },
        error: err => {
          this.venueSaving.set(false);
          flash(this.venueMsg, 'Ошибка: ' + AuthService.errorText(err), 6000);
        }
      });
      return;
    }
    const current = this.venue();
    if (!current) return;
    this.api.updateVenue(current.slug, payload).subscribe({
      next: saved => {
        this.venueSaving.set(false);
        this.replaceVenue(saved);
        if (saved.slug !== current.slug) this.selectedSlug.set(saved.slug);
        flash(this.venueMsg, 'Сохранено');
      },
      error: err => {
        this.venueSaving.set(false);
        flash(this.venueMsg, 'Ошибка: ' + AuthService.errorText(err), 6000);
      }
    });
  }

  // Логотип

  uploadLogo(v: Venue | null, file: File) {
    if (!v) return;
    this.logoBusy.set(true);
    this.logoError.set(null);
    this.api.uploadVenueLogo(v.slug, file).subscribe({
      next: saved => {
        this.replaceVenue(saved);
        this.logoBusy.set(false);
        flash(this.venueMsg, 'Логотип загружен');
      },
      error: err => {
        this.logoError.set('Ошибка: ' + AuthService.errorText(err));
        this.logoBusy.set(false);
      }
    });
  }

  /** Убирает файл; если логотип был ссылкой, чистим и её. */
  removeLogo(v: Venue | null) {
    if (!v) return;
    this.logoBusy.set(true);
    this.logoError.set(null);
    this.api.deleteVenueLogo(v.slug).pipe(
      switchMap(saved => saved.logo_url ? this.api.updateVenue(saved.slug, { logo_url: '' }) : of(saved))
    ).subscribe({
      next: saved => {
        this.replaceVenue(saved);
        this.form.logo_url = '';
        this.logoBusy.set(false);
        flash(this.venueMsg, 'Логотип удалён');
      },
      error: err => {
        this.logoError.set('Ошибка: ' + AuthService.errorText(err));
        this.logoBusy.set(false);
      }
    });
  }

  // Позиции меню

  loadItems(venueId: string) {
    this.loadingItems.set(true);
    this.api.getMenuItems(venueId).subscribe({
      next: list => {
        if (this.venue()?.id !== venueId) return;
        this.items.set(sortItems(list));
        this.loadingItems.set(false);
      },
      error: err => {
        if (this.venue()?.id !== venueId) return;
        this.loadingItems.set(false);
        flash(this.itemsMsg, 'Ошибка: ' + AuthService.errorText(err), 6000);
      }
    });
  }

  saveItem(row: MenuItem) {
    const price = priceOf(row.price);
    if (price === null) {
      flash(this.itemsMsg, PRICE_ERROR, 6000);
      return;
    }
    this.api.updateMenuItem(row.id, {
      price: price.toFixed(2),
      section: (row.section || '').trim() || DEFAULT_SECTION,
      portion: row.portion || '',
      sort_order: Number(row.sort_order) || 0
    }).subscribe({
      next: saved => {
        this.items.update(list => list.map(i => i.id === saved.id ? saved : i));
        flash(this.itemsMsg, (saved.dish_name || 'Позиция') + ': сохранено');
      },
      error: err => flash(this.itemsMsg, 'Ошибка: ' + AuthService.errorText(err), 6000)
    });
  }

  /** Галочка возвращается на место, если сервер отказал. */
  toggleAvailable(row: MenuItem, event: Event) {
    const input = event.target as HTMLInputElement;
    const next = input.checked;
    this.api.updateMenuItem(row.id, { is_available: next }).subscribe({
      // Несохранённые правки цены и порции в строке не трогаем
      next: saved => this.items.update(list => list.map(i => i.id === saved.id ? { ...i, is_available: saved.is_available } : i)),
      error: err => {
        input.checked = row.is_available;
        flash(this.itemsMsg, 'Ошибка: ' + AuthService.errorText(err), 6000);
      }
    });
  }

  askDeleteItem(row: MenuItem) {
    confirmTwice(this.pendingDelete, row.id, () => {
      this.api.deleteMenuItem(row.id).subscribe({
        next: () => {
          this.items.update(list => list.filter(i => i.id !== row.id));
          this.bumpCount(row.venue, -1);
          flash(this.itemsMsg, (row.dish_name || 'Позиция') + ': убрано из меню');
        },
        error: err => flash(this.itemsMsg, 'Ошибка: ' + AuthService.errorText(err), 6000)
      });
    });
  }

  addDish(v: Venue) {
    const d = this.dishes().find(x => x.id === this.pickDish());
    if (!d) return;
    const section = this.pickSection().trim() || DEFAULT_SECTION;
    // Новая позиция встаёт в конец раздела; новый раздел - в конец меню, а не наверх
    const inSection = this.items().filter(i => (i.section || DEFAULT_SECTION) === section);
    const sortOrder = nextOrder(inSection.length ? inSection : this.items());
    this.adding.set(true);
    this.api.createMenuItem({ venue: v.id, dish: d.id, price: '0.00', section, sort_order: sortOrder }).subscribe({
      next: item => {
        this.adding.set(false);
        this.items.update(list => [...list, item]);
        this.bumpCount(v.id, 1);
        this.pickDish.set('');
        flash(this.itemsMsg, d.name + ': добавлено, осталось указать цену');
      },
      error: err => {
        this.adding.set(false);
        flash(this.itemsMsg, 'Ошибка: ' + AuthService.errorText(err), 6000);
      }
    });
  }

  // Карта напитков

  loadDrinks(venueId: string) {
    this.loadingDrinks.set(true);
    this.api.getMenuDrinks(venueId).subscribe({
      next: list => {
        if (this.venue()?.id !== venueId) return;
        this.drinks.set(sortDrinks(list));
        this.loadingDrinks.set(false);
      },
      error: err => {
        if (this.venue()?.id !== venueId) return;
        this.loadingDrinks.set(false);
        flash(this.drinksMsg, 'Ошибка: ' + AuthService.errorText(err), 6000);
      }
    });
  }

  addDrink(v: Venue) {
    const b = this.brands().find(x => x.id === this.pickBrand());
    if (!b) return;
    const price = Number(this.pickPrice()) || 0;
    if (price < 0) {
      flash(this.drinksMsg, PRICE_ERROR, 6000);
      return;
    }
    this.addingDrink.set(true);
    this.api.createMenuDrink({
      venue: v.id, brand: b.id, price: price.toFixed(2),
      volume: this.pickVolume().trim() || DEFAULT_VOLUME, sort_order: nextOrder(this.drinks())
    }).subscribe({
      next: drink => {
        this.addingDrink.set(false);
        this.drinks.update(list => sortDrinks([...list, drink]));
        this.pickBrand.set('');
        this.pickPrice.set(0);
        flash(this.drinksMsg, b.name + ': добавлено в карту' + (price ? '' : ', осталось указать цену'));
      },
      error: err => {
        this.addingDrink.set(false);
        flash(this.drinksMsg, 'Ошибка: ' + AuthService.errorText(err), 6000);
      }
    });
  }

  saveDrink(row: MenuDrink) {
    const price = priceOf(row.price);
    if (price === null) {
      flash(this.drinksMsg, PRICE_ERROR, 6000);
      return;
    }
    this.api.updateMenuDrink(row.id, {
      price: price.toFixed(2),
      volume: (row.volume || '').trim(),
      sort_order: Number(row.sort_order) || 0
    }).subscribe({
      next: saved => {
        this.drinks.update(list => sortDrinks(list.map(d => d.id === saved.id ? saved : d)));
        flash(this.drinksMsg, (saved.brand_name || 'Напиток') + ': сохранено');
      },
      error: err => flash(this.drinksMsg, 'Ошибка: ' + AuthService.errorText(err), 6000)
    });
  }

  toggleDrinkAvailable(row: MenuDrink, event: Event) {
    const input = event.target as HTMLInputElement;
    const next = input.checked;
    this.api.updateMenuDrink(row.id, { is_available: next }).subscribe({
      next: saved => this.drinks.update(list => list.map(d => d.id === saved.id ? { ...d, is_available: saved.is_available } : d)),
      error: err => {
        input.checked = row.is_available;
        flash(this.drinksMsg, 'Ошибка: ' + AuthService.errorText(err), 6000);
      }
    });
  }

  askDeleteDrink(row: MenuDrink) {
    confirmTwice(this.pendingDeleteDrink, row.id, () => {
      this.api.deleteMenuDrink(row.id).subscribe({
        next: () => {
          this.drinks.update(list => list.filter(d => d.id !== row.id));
          flash(this.drinksMsg, (row.brand_name || 'Напиток') + ': убрано из карты');
        },
        error: err => flash(this.drinksMsg, 'Ошибка: ' + AuthService.errorText(err), 6000)
      });
    });
  }

  private replaceVenue(saved: Venue) {
    this.venues.update(list => list.map(v => v.id === saved.id ? saved : v));
  }

  /** Счётчик позиций в строке списка, чтобы не перечитывать заведения. */
  private bumpCount(venueId: string, delta: number) {
    if (!delta) return;
    this.venues.update(list => list.map(v => v.id === venueId ? { ...v, items_count: Math.max(0, (v.items_count ?? 0) + delta) } : v));
  }

  private resetState() {
    this.venueMsg.set(null);
    this.itemsMsg.set(null);
    this.drinksMsg.set(null);
    this.logoError.set(null);
    this.pendingDelete.set(null);
    this.pendingDeleteDrink.set(null);
    this.pendingLogo = null;
    this.pickDish.set('');
    this.pickSection.set(DEFAULT_SECTION);
    this.pickBrand.set('');
    this.pickPrice.set(0);
    this.pickVolume.set(DEFAULT_VOLUME);
  }
}

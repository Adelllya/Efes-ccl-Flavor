import { Component, OnInit, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { Brand, Dish, MenuDrink, MenuItem, Venue, VenueType } from '../../models/flavor-tree.models';
import { FtSelectComponent, SelectOption } from '../../ui/ft-select.component';
import { V2ApiService } from '../drinks-v2/v2-api.service';
import { V2Drink } from '../drinks-v2/v2.models';
import { isEfes } from '../drinks-v2/v2-ui';
import { PanelIconComponent } from './panel-icons';
import { PanelPhotoComponent } from './panel-photo.component';
import { PanelQrPrintComponent } from './panel-qr-print.component';
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

/** Значение числового поля: ngModel отдаёт число или null (пусто), с сервера цена приходит строкой. */
type NumField = string | number | null;

/**
 * Несохранённые правки строки меню. Сохранённые значения лежат в items: разделы и порядок строк
 * считаются только по ним, поэтому строка не прыгает, пока её правят.
 */
interface ItemDraft {
  price: NumField;
  section: string;
  portion: string;
  sort_order: NumField;
  chef_note: string;
}

interface DrinkDraft {
  price: NumField;
  volume: string;
  sort_order: NumField;
}

/** Действие со строкой таблицы: сохранение полей, галочка "В наличии", удаление. */
type RowOp = 'save' | 'toggle' | 'delete';

/**
 * Статус строки таблицы. Ошибка держится до следующей правки строки или до нового такого же действия;
 * удачный ответ одного действия не стирает ошибку другого.
 */
interface RowState {
  kind: 'saving' | 'saved' | 'error';
  op: RowOp;
  text: string;
}

const DEFAULT_SECTION = 'Основное';
const DEFAULT_TABLES = 20;
const DEFAULT_VOLUME = '0.5 L';

const LOGO_HINT = 'PNG, JPG or WebP, up to 4 MB. Square 400×400 logo on a light or transparent background.';

const PRICE_ERROR = 'Error: enter a price above 0';

function emptyVenue(): VenueForm {
  return {
    name: '', venue_type: 'RESTAURANT', city: 'Almaty', address: '', phone: '',
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

/** Цена из поля: число больше нуля, иначе null (пустое, нечисловое, ноль или отрицательное). */
function priceOf(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Число из поля для сравнения: пустое поле не равно ничему, даже нулю. */
function numOf(value: NumField): number {
  return value === null || value === '' ? NaN : Number(value);
}

/** Порядок для сервера: целое, пустое поле считается нулём. */
function orderOf(value: NumField): number {
  return Math.trunc(numOf(value)) || 0;
}

/** Следующий порядок для новой строки: после последней, чтобы она не прыгала наверх. */
function nextOrder(list: { sort_order: number }[]): number {
  return list.length ? Math.max(...list.map(x => Number(x.sort_order) || 0)) + 1 : 0;
}

function itemDraftOf(row: MenuItem): ItemDraft {
  return {
    price: row.price, section: row.section || '', portion: row.portion || '',
    sort_order: row.sort_order, chef_note: row.chef_note || ''
  };
}

function drinkDraftOf(row: MenuDrink): DrinkDraft {
  return { price: row.price, volume: row.volume || '', sort_order: row.sort_order };
}

function sameItem(d: ItemDraft, row: MenuItem): boolean {
  return numOf(d.price) === numOf(row.price) && numOf(d.sort_order) === numOf(row.sort_order)
    && d.section === (row.section || '') && d.portion === (row.portion || '') && d.chef_note === (row.chef_note || '');
}

function sameDrink(d: DrinkDraft, row: MenuDrink): boolean {
  return numOf(d.price) === numOf(row.price) && numOf(d.sort_order) === numOf(row.sort_order)
    && d.volume === (row.volume || '');
}

function without<T>(map: Record<string, T>, id: string): Record<string, T> {
  const next = { ...map };
  delete next[id];
  return next;
}

/** Вкладка "Меню": заведения слева, справа карточка, логотип, позиции меню и карта напитков выбранного. */
@Component({
  selector: 'panel-menu',
  standalone: true,
  imports: [FormsModule, PanelIconComponent, FtSelectComponent, PanelPhotoComponent, PanelQrPrintComponent],
  template: `
    <div class="wa-page" [class.has-selection]="hasSelection()">
      <aside class="wa-list">
        <div class="wa-list-head">
          <h2 class="wa-list-title">Venues @if (!loadingVenues()) { <span class="wa-count">{{ venues().length }}</span> }</h2>
          @if (canCreate()) {
            <button type="button" class="wa-iconbtn" title="New venue" aria-label="New venue" (click)="startCreate()">
              <panel-icon name="plus" />
            </button>
          }
        </div>
        <label class="wa-search">
          <panel-icon name="search" />
          <input type="text" placeholder="Name or city" aria-label="Search by name or city"
                 [ngModel]="search()" (ngModelChange)="search.set($event)" />
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
            <p class="wa-empty">Loading...</p>
          } @else if (loadError()) {
            <div class="wa-loadbar" role="alert">
              <panel-icon name="alert" />
              <span>{{ loadError() }}</span>
              <button type="button" class="btn-outline" (click)="loadVenues()"><panel-icon name="refresh" /> Refresh</button>
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
                  @if (!v.is_published) { <span class="wa-chip wa-chip-pending">Hidden</span> }
                  <span class="wa-time">{{ countOf(v.items_count ?? 0, 'item', 'items') }}</span>
                </span>
              </button>
            } @empty {
              <p class="wa-empty">
                @if (venues().length) { Nothing found }
                @else if (isModerator()) { No venues yet }
                @else { You don't have a venue yet. Fill in the card on the right }
              </p>
            }
          }
        </div>
      </aside>

      <section class="wa-detail">
        @for (d of detailList(); track d.key) {
          <div class="wa-detail-enter">
            <button type="button" class="wa-back" (click)="select(null)"><panel-icon name="arrowLeft" /> Back to list</button>

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
                    @if (v.is_published) { <span class="wa-chip wa-chip-approved">Visible to guests</span> }
                    @else { <span class="wa-chip wa-chip-pending">Hidden from guests</span> }
                    <span class="wa-chip">{{ countOf(v.tables_count || 0, 'table', 'tables') }}</span>
                    @if (isModerator()) {
                      <span class="wa-chip">{{ v.owner ? 'owner: ' + v.owner.username : 'no owner' }}</span>
                    }
                  </div>
                </div>
                <div class="wa-guest">
                  <panel-icon name="link" />
                  <code>{{ guestUrl(v) }}</code>
                  <button type="button" class="btn-outline" (click)="openMenu.emit(v.slug)">
                    <panel-icon name="external" /> Open guest menu
                  </button>
                </div>
                <div class="wa-actions">
                  <button type="button" class="btn-outline" (click)="qrVenue.set(v)">
                    <panel-icon name="qr" /> Table QR codes
                  </button>
                  <span class="wa-muted">Printable table cards: each table gets its own QR, so guests land in the menu with their table already set.</span>
                </div>
              </div>
            }

            <div class="wa-card">
              <h3 class="wa-card-title">{{ d.venue ? 'Venue details' : 'New venue' }}</h3>
              <div class="wa-fields">
                <label class="wa-field">
                  <span class="wa-label">Name</span>
                  <input class="input" type="text" [(ngModel)]="form.name" placeholder="Efes Beer Garden" />
                </label>
                <div class="wa-field">
                  <span class="wa-label">Type</span>
                  <ft-select [options]="venueTypes" ariaLabel="Venue type" [(ngModel)]="form.venue_type" />
                </div>
                <label class="wa-field">
                  <span class="wa-label">City</span>
                  <input class="input" type="text" [(ngModel)]="form.city" />
                </label>
                <label class="wa-field">
                  <span class="wa-label">Address</span>
                  <input class="input" type="text" [(ngModel)]="form.address" placeholder="100 Dostyk Ave" />
                </label>
                <label class="wa-field">
                  <span class="wa-label">Phone</span>
                  <input class="input" type="text" [(ngModel)]="form.phone" placeholder="+7 727 000 00 00" />
                </label>
                <label class="wa-field">
                  <span class="wa-label">Opening hours</span>
                  <input class="input" type="text" [(ngModel)]="form.working_hours" placeholder="12:00-02:00" />
                </label>
                <label class="wa-field">
                  <span class="wa-label">Number of tables</span>
                  <input class="input" type="number" min="1" max="500" [(ngModel)]="form.tables_count" />
                  <span class="wa-hint">Guests pick a table from this range before ordering</span>
                </label>
                <label class="wa-field">
                  <span class="wa-label">Cover image URL</span>
                  <input class="input" type="url" [(ngModel)]="form.cover" placeholder="https://..." />
                </label>
                <label class="wa-field wa-field-wide">
                  <span class="wa-label">Description</span>
                  <textarea class="input" rows="3" [(ngModel)]="form.description"
                            placeholder="A line or two about the venue, shown above the menu"></textarea>
                </label>
                <label class="wa-check wa-field-wide">
                  <input type="checkbox" [(ngModel)]="form.is_published" /> Show to guests
                </label>
              </div>
              <div class="wa-actions">
                <button type="button" class="btn-amber" [disabled]="venueSaving()" (click)="saveVenue()">
                  <panel-icon name="save" /> {{ venueSaving() ? 'Saving...' : (d.venue ? 'Save' : 'Create venue') }}
                </button>
                @if (!d.venue && venues().length) {
                  <button type="button" class="btn-outline" (click)="cancelCreate()">Cancel</button>
                }
                @if (venueMsg()) {
                  <p class="wa-msg" [class.error]="isError(venueMsg())" [attr.role]="isError(venueMsg()) ? 'alert' : 'status'">{{ venueMsg() }}</p>
                }
              </div>
            </div>

            <div class="wa-card">
              <div class="wa-card-head">
                <div class="wa-card-head-text">
                  <h3 class="wa-card-title">Logo</h3>
                  <p class="wa-card-sub">
                    @if (d.venue) { Round badge next to the name in the venue list and above the menu }
                    @else { Pick a file now: it uploads as soon as the venue is created }
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
                title="Venue logo"
                (fileChosen)="uploadLogo(d.venue, $event)"
                (fileSelected)="pendingLogo = $event"
                (removeRequested)="removeLogo(d.venue)"
              />
              @if (form.logo_url && !d.venue) {
                <p class="wa-muted">The link is saved with the venue.</p>
              }
            </div>

            @if (d.venue; as v) {
              <div class="wa-card">
                <div class="wa-card-head">
                  <div class="wa-card-head-text">
                    <h3 class="wa-card-title">Menu items @if (itemsReady()) { <span class="wa-count">{{ items().length }}</span> }</h3>
                    <p class="wa-card-sub">Price in tenge, portion as on the menu. Order sets the position within a section; the section with the lowest order shows first</p>
                  </div>
                </div>

                <div class="wa-fields">
                  <div class="wa-field">
                    <span class="wa-label">Add a dish from the catalog</span>
                    <ft-select [options]="pickOptions()" [searchable]="true" ariaLabel="Add a dish from the catalog"
                               [placeholder]="loaded() ? 'Choose a dish' : 'Loading dish catalog...'"
                               searchPlaceholder="Dish name" emptyText="Every catalog dish is already on the menu"
                               [disabled]="!loaded() || !itemsReady()"
                               [ngModel]="pickDish()" (ngModelChange)="pickDish.set($event); addItemError.set(null)" />
                  </div>
                  <label class="wa-field">
                    <span class="wa-label">Menu section</span>
                    <input class="input" type="text" maxlength="80" [ngModel]="pickSection()" (ngModelChange)="pickSection.set($event)"
                           placeholder="Main" list="wa-section-names" />
                    <datalist id="wa-section-names">
                      @for (s of sections(); track s.name) { <option [value]="s.name"></option> }
                    </datalist>
                  </label>
                  <label class="wa-field">
                    <span class="wa-label">Price, ₸</span>
                    <input class="input" type="number" min="0" step="50" inputmode="decimal" placeholder="e.g. 2500"
                           [ngModel]="pickItemPrice()" (ngModelChange)="pickItemPrice.set($event); addItemError.set(null)" />
                  </label>
                </div>
                <div class="wa-actions">
                  <button type="button" class="btn-amber" [disabled]="!pickDish() || adding() || !itemsReady()" (click)="addDish(v)">
                    <panel-icon name="plus" /> {{ adding() ? 'Adding...' : 'Add to menu' }}
                  </button>
                  <!-- Ошибка формы держится до следующей попытки и живёт отдельно: удачное сообщение её не затирает -->
                  @if (addItemError()) {
                    <p class="wa-msg error" role="alert">{{ addItemError() }}</p>
                  }
                  @if (itemsMsg()) {
                    <p class="wa-msg" role="status">{{ itemsMsg() }}</p>
                  }
                </div>

                @if (loadingItems()) {
                  <p class="wa-muted">Loading items...</p>
                } @else if (itemsError()) {
                  <div class="wa-loadbar" role="alert">
                    <panel-icon name="alert" />
                    <span>{{ itemsError() }}</span>
                    <button type="button" class="btn-outline" (click)="loadItems(v.id)"><panel-icon name="refresh" /> Refresh</button>
                  </div>
                } @else if (!items().length) {
                  <p class="wa-muted">No dishes on the menu yet. Choose one above</p>
                } @else {
                  <div class="wa-table">
                    <div class="wa-table-head">
                      <span>Dish</span><span>Price, ₸</span><span>Section</span><span>Portion</span><span>Order</span><span></span>
                    </div>
                    @for (s of sections(); track s.name; let i = $index) {
                      <div class="wa-table-group">{{ i + 1 }}. {{ s.name }}</div>
                      @for (row of s.items; track row.id) {
                        @if (itemDraft(row); as f) {
                          <div class="wa-table-row" [class.off]="!row.is_available" [class.dirty]="itemDirty(row)">
                            <div class="wa-table-dish">
                              <div class="wa-row-title">{{ row.dish_name }}</div>
                              <label class="wa-check wa-check-sm">
                                <input type="checkbox" [checked]="row.is_available" (change)="toggleAvailable(row, $event)" /> In stock
                              </label>
                            </div>
                            <!-- Подписи над полями видны, когда шапка таблицы спрятана (узкая колонка); aria-label есть всегда -->
                            <label class="wa-cell">
                              <span class="wa-cell-cap" aria-hidden="true">Price, ₸</span>
                              <input class="input" type="number" min="0" step="50" inputmode="decimal" aria-label="Price, ₸"
                                     [ngModel]="f.price" (ngModelChange)="editItem(row, { price: $event })" />
                            </label>
                            <label class="wa-cell">
                              <span class="wa-cell-cap" aria-hidden="true">Section</span>
                              <input class="input" type="text" maxlength="80" aria-label="Section"
                                     [ngModel]="f.section" (ngModelChange)="editItem(row, { section: $event })" />
                            </label>
                            <label class="wa-cell">
                              <span class="wa-cell-cap" aria-hidden="true">Portion</span>
                              <input class="input" type="text" maxlength="60" placeholder="350 g" aria-label="Portion"
                                     [ngModel]="f.portion" (ngModelChange)="editItem(row, { portion: $event })" />
                            </label>
                            <label class="wa-cell">
                              <span class="wa-cell-cap" aria-hidden="true">Order</span>
                              <input class="input" type="number" aria-label="Sort order"
                                     [ngModel]="f.sort_order" (ngModelChange)="editItem(row, { sort_order: $event })" />
                            </label>
                            <label class="wa-cell wa-cell-wide">
                              <span class="wa-cell-cap" aria-hidden="true">Chef's note</span>
                              <input class="input" type="text" maxlength="200" aria-label="Chef's note"
                                     placeholder="Shown to guests under the dish"
                                     [ngModel]="f.chef_note" (ngModelChange)="editItem(row, { chef_note: $event })" />
                            </label>
                            <div class="wa-table-actions">
                              <button type="button" class="wa-iconbtn" title="Save" [attr.aria-label]="'Save: ' + (row.dish_name || 'item')"
                                      [disabled]="!itemDirty(row) || rowState(row.id)?.kind === 'saving'" (click)="saveItem(row)">
                                <panel-icon name="save" />
                              </button>
                              <button type="button" class="wa-iconbtn wa-danger" title="Remove from menu"
                                      [attr.aria-label]="(pendingDelete() === row.id ? 'Remove from menu? Tap again to confirm: ' : 'Remove from menu: ') + (row.dish_name || 'item')"
                                      (click)="askDeleteItem(row)">
                                @if (pendingDelete() === row.id) { <span class="wa-confirm">Sure?</span> } @else { <panel-icon name="trash" /> }
                              </button>
                            </div>
                            @if (rowState(row.id) || itemDirty(row)) {
                              <p class="wa-row-status">
                                @if (itemDirty(row) && rowState(row.id)?.kind !== 'saving') { <span class="dirty">unsaved</span> }
                                @if (rowState(row.id); as st) {
                                  <span [class.error]="st.kind === 'error'" [class.ok]="st.kind === 'saved'"
                                        [attr.role]="st.kind === 'error' ? 'alert' : 'status'">{{ st.text }}</span>
                                }
                              </p>
                            }
                          </div>
                        }
                      }
                    }
                  </div>
                }
              </div>

              <div class="wa-card">
                <div class="wa-card-head">
                  <div class="wa-card-head-text">
                    <h3 class="wa-card-title"><panel-icon name="beer" /> Bar drinks @if (drinksReady()) { <span class="wa-count">{{ drinks().length }}</span> }</h3>
                    <p class="wa-card-sub">Catalog beers and any drink from the pairing database, with price and volume. Guests see them at the bottom of the menu, and pairings only suggest what is on this list and in stock</p>
                  </div>
                </div>

                <div class="wa-fields">
                  <div class="wa-field">
                    <span class="wa-label">Add a beer from the catalog</span>
                    <ft-select [options]="drinkOptions()" [searchable]="true" ariaLabel="Add a beer from the catalog"
                               [placeholder]="brandsLoaded() ? 'Choose a beer' : 'Loading beer catalog...'"
                               searchPlaceholder="Name or style" emptyText="Every catalog beer is already on the list"
                               [disabled]="!brandsLoaded() || !drinksReady()"
                               [ngModel]="pickBrand()" (ngModelChange)="pickCatalogBrand($event); addDrinkError.set(null)" />
                  </div>
                  <div class="wa-field">
                    <span class="wa-label">Or a drink from the pairing database</span>
                    <ft-select [options]="engineOptions()" [searchable]="true" ariaLabel="Drink from the pairing database"
                               [placeholder]="engineState() === 'ready' ? 'Beer, 0.0, cider, wine, lemonade...' : engineState() === 'error' ? 'Pairing database failed to load' : 'Loading pairing database...'"
                               searchPlaceholder="Name, producer or style" emptyText="Every drink in the database is already on the list"
                               [disabled]="engineState() !== 'ready' || !drinksReady()"
                               [ngModel]="pickEngine()" (ngModelChange)="pickEngineDrink($event); addDrinkError.set(null)" />
                    @if (engineState() === 'error') {
                      <button type="button" class="wa-link-btn" (click)="loadEngineDrinks(true)">Retry</button>
                    } @else {
                      <span class="wa-hint">{{ engineCount() }} drinks: beer and 0.0, cider, wine, spirits, kvass, lemonades, water</span>
                    }
                  </div>
                  <label class="wa-field">
                    <span class="wa-label">Price, ₸</span>
                    <input class="input" type="number" min="0" step="50" inputmode="decimal" placeholder="e.g. 1800"
                           [ngModel]="pickPrice()" (ngModelChange)="pickPrice.set($event); addDrinkError.set(null)" />
                  </label>
                  <label class="wa-field">
                    <span class="wa-label">Volume</span>
                    <input class="input" type="text" maxlength="40" [ngModel]="pickVolume()" (ngModelChange)="pickVolume.set($event)" placeholder="0.5 L" />
                  </label>
                </div>
                <div class="wa-actions">
                  <button type="button" class="btn-amber" [disabled]="(!pickBrand() && !pickEngine()) || addingDrink() || !drinksReady()" (click)="addDrink(v)">
                    <panel-icon name="plus" /> {{ addingDrink() ? 'Adding...' : 'Add to list' }}
                  </button>
                  @if (addDrinkError()) {
                    <p class="wa-msg error" role="alert">{{ addDrinkError() }}</p>
                  }
                  @if (drinksMsg()) {
                    <p class="wa-msg" role="status">{{ drinksMsg() }}</p>
                  }
                </div>

                @if (loadingDrinks()) {
                  <p class="wa-muted">Loading drink list...</p>
                } @else if (drinksError()) {
                  <div class="wa-loadbar" role="alert">
                    <panel-icon name="alert" />
                    <span>{{ drinksError() }}</span>
                    <button type="button" class="btn-outline" (click)="loadDrinks(v.id)"><panel-icon name="refresh" /> Refresh</button>
                  </div>
                } @else if (!drinks().length) {
                  <p class="wa-muted">No drinks on the list yet. Choose a beer or drink above</p>
                } @else {
                  <div class="wa-table wa-table-drinks">
                    <div class="wa-table-head">
                      <span>Drink</span><span>Price, ₸</span><span>Volume</span><span>Order</span><span></span>
                    </div>
                    @for (row of drinks(); track row.id) {
                      @if (drinkDraft(row); as f) {
                        <div class="wa-table-row" [class.off]="!row.is_available" [class.dirty]="drinkDirty(row)">
                          <div class="wa-table-dish wa-table-brand">
                            <span class="wa-avatar wa-avatar-sm">
                              @if (row.brand_image) { <img [src]="row.brand_image" [alt]="row.brand_name" /> } @else { {{ initial(row.brand_name) }} }
                            </span>
                            <div class="wa-table-brand-text">
                              <div class="wa-row-title">{{ row.brand_name }}</div>
                              <div class="wa-row-sub">{{ row.brand_style }}@if (row.abv !== null && row.abv !== undefined) {<span class="wa-dot"></span>{{ row.abv }}%}@if (!row.brand) {<span class="wa-dot"></span>from pairing database}</div>
                              <label class="wa-check wa-check-sm">
                                <input type="checkbox" [checked]="row.is_available" (change)="toggleDrinkAvailable(row, $event)" /> In stock
                              </label>
                            </div>
                          </div>
                          <label class="wa-cell">
                            <span class="wa-cell-cap" aria-hidden="true">Price, ₸</span>
                            <input class="input" type="number" min="0" step="50" inputmode="decimal" aria-label="Price, ₸"
                                   [ngModel]="f.price" (ngModelChange)="editDrink(row, { price: $event })" />
                          </label>
                          <label class="wa-cell">
                            <span class="wa-cell-cap" aria-hidden="true">Volume</span>
                            <input class="input" type="text" maxlength="40" placeholder="0.5 L" aria-label="Volume"
                                   [ngModel]="f.volume" (ngModelChange)="editDrink(row, { volume: $event })" />
                          </label>
                          <label class="wa-cell">
                            <span class="wa-cell-cap" aria-hidden="true">Order</span>
                            <input class="input" type="number" aria-label="Sort order"
                                   [ngModel]="f.sort_order" (ngModelChange)="editDrink(row, { sort_order: $event })" />
                          </label>
                          <div class="wa-table-actions">
                            <button type="button" class="wa-iconbtn" title="Save" [attr.aria-label]="'Save: ' + (row.brand_name || 'drink')"
                                    [disabled]="!drinkDirty(row) || rowState(row.id)?.kind === 'saving'" (click)="saveDrink(row)">
                              <panel-icon name="save" />
                            </button>
                            <button type="button" class="wa-iconbtn wa-danger" title="Remove from list"
                                    [attr.aria-label]="(pendingDeleteDrink() === row.id ? 'Remove from list? Tap again to confirm: ' : 'Remove from list: ') + (row.brand_name || 'drink')"
                                    (click)="askDeleteDrink(row)">
                              @if (pendingDeleteDrink() === row.id) { <span class="wa-confirm">Sure?</span> } @else { <panel-icon name="trash" /> }
                            </button>
                          </div>
                          @if (rowState(row.id) || drinkDirty(row)) {
                            <p class="wa-row-status">
                              @if (drinkDirty(row) && rowState(row.id)?.kind !== 'saving') { <span class="dirty">unsaved</span> }
                              @if (rowState(row.id); as st) {
                                <span [class.error]="st.kind === 'error'" [class.ok]="st.kind === 'saved'"
                                      [attr.role]="st.kind === 'error' ? 'alert' : 'status'">{{ st.text }}</span>
                              }
                            </p>
                          }
                        </div>
                      }
                    }
                  </div>
                }
              </div>
            }
          </div>
        } @empty {
          <div class="wa-detail-empty">Select an item on the left</div>
        }
      </section>
    </div>

    @if (qrVenue(); as qv) {
      <panel-qr-print [venue]="qv" (closed)="qrVenue.set(null)" />
    }
  `
})
export class PanelMenuComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private v2 = inject(V2ApiService);

  dishes = input<Dish[]>([]);
  /** false, пока родитель ждёт справочник блюд: выбор блюда закрыт. */
  loaded = input(false);
  brands = input<Brand[]>([]);
  brandsLoaded = input(false);
  /** Растёт, когда позиции меню добавили вне этой вкладки (импорт блюд по фото): перечитываем строки. */
  reload = input(0);
  /** Slug заведения, чьё гостевое меню нужно открыть. */
  openMenu = output<string>();

  readonly venueTypes: SelectOption[] = VENUE_TYPE_CHOICES;
  readonly initial = initialOf;
  readonly countOf = countOf;
  readonly logoHint = LOGO_HINT;
  readonly pills: { value: VenueFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'published', label: 'Visible to guests' },
    { value: 'hidden', label: 'Hidden' }
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
  /** Заведение, для которого открыта печать QR на столы. */
  qrVenue = signal<Venue | null>(null);
  /** Новый объект на каждое открытие карточки: по нему ответы запросов узнают, та же ли форма на экране. */
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
  /** Позиции не прочитались: текст с кнопкой "Обновить" держится до удачной попытки, таблицы и "нет блюд" при этом нет. */
  itemsError = signal<string | null>(null);
  /** Удачные действия с позициями: "добавлено", "убрано". Ошибки сюда не попадают. */
  itemsMsg = signal<string | null>(null);
  addItemError = signal<string | null>(null);
  pendingDelete = signal<string | null>(null);
  pickDish = signal('');
  pickSection = signal(DEFAULT_SECTION);
  pickItemPrice = signal<NumField>(null);
  adding = signal(false);
  /** Несохранённые правки строк меню по id строки. */
  itemDrafts = signal<Record<string, ItemDraft>>({});

  // Карта напитков
  drinks = signal<MenuDrink[]>([]);
  loadingDrinks = signal(false);
  drinksError = signal<string | null>(null);
  drinksMsg = signal<string | null>(null);
  addDrinkError = signal<string | null>(null);
  pendingDeleteDrink = signal<string | null>(null);
  pickBrand = signal('');
  /** Напиток из базы подбора v2 (412 штук): выбирается вместо сорта каталога. */
  pickEngine = signal('');
  engineDrinks = signal<V2Drink[]>([]);
  engineState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  private categoryLabels = signal<Map<string, string>>(new Map());
  pickPrice = signal<NumField>(null);
  pickVolume = signal(DEFAULT_VOLUME);
  addingDrink = signal(false);
  drinkDrafts = signal<Record<string, DrinkDraft>>({});

  /** Статусы строк обеих таблиц по id строки. */
  rowStates = signal<Record<string, RowState>>({});

  /** Модератор создаёт сколько угодно, администратор заведения только первое. */
  canCreate = computed(() => this.isModerator() || (!this.loadingVenues() && !this.venues().length));

  hasSelection = computed(() => this.creating() || !!this.venue());

  /** Позиции выбранного заведения прочитаны: только тогда известно, каких блюд в меню ещё нет. */
  itemsReady = computed(() => !this.loadingItems() && !this.itemsError());
  drinksReady = computed(() => !this.loadingDrinks() && !this.drinksError());

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

  /** Разделы в том же порядке, что видит гость: по наименьшему порядку внутри раздела, затем по названию.
   *  Считаются по сохранённым значениям: правка в строке ничего не двигает, пока её не сохранили. */
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
    const inList = new Set(this.drinks().map(d => d.brand).filter(Boolean));
    return this.brands()
      .filter(b => !inList.has(b.id))
      .map(b => ({
        value: b.id, label: b.name,
        hint: [b.style, b.abv !== null && b.abv !== undefined ? b.abv + '%' : ''].filter(Boolean).join(', ')
      }));
  });

  /**
   * Напитки базы подбора, которых ещё нет в карте. 17 сортов каталога (legacy_brand_id) здесь не показываем:
   * их добавляют из списка слева, тогда у них есть страница сорта и пары команды.
   */
  engineOptions = computed<SelectOption[]>(() => {
    const inList = new Set(this.drinks().map(d => d.engine_drink_id).filter(Boolean));
    const labels = this.categoryLabels();
    return this.engineDrinks()
      .filter(d => !d.legacy_brand_id && !inList.has(d.id))
      .map(d => ({
        value: d.id,
        label: d.display_name || d.name,
        hint: [
          labels.get(d.category) ?? d.category,
          d.abv !== null && d.abv !== undefined ? String(d.abv) + '%' : '',
          d.producer?.name ?? '',
          isEfes(d.efes_relation) ? 'Efes portfolio' : ''
        ].filter(Boolean).join(', ')
      }));
  });

  engineCount = computed(() => this.engineDrinks().length);

  constructor() {
    let seen = 0;
    effect(() => {
      const version = this.reload();
      if (version === seen) return;
      seen = version;
      untracked(() => {
        const v = this.venue();
        if (v) this.loadItems(v.id);
      });
    }, { allowSignalWrites: true });
  }

  ngOnInit() {
    this.loadVenues();
  }

  /** Весь каталог базы подбора одним запросом; повторно только после ошибки. */
  loadEngineDrinks(retry = false) {
    const state = this.engineState();
    if (state === 'loading' || state === 'ready' || (state === 'error' && !retry)) return;
    this.engineState.set('loading');
    this.v2.drinks().subscribe({
      next: list => {
        this.engineDrinks.set(list);
        this.engineState.set('ready');
      },
      error: () => this.engineState.set('error')
    });
    this.v2.meta().subscribe({
      next: meta => this.categoryLabels.set(new Map(meta.categories.map(c => [c.id, c.label]))),
      error: () => undefined
    });
  }

  /** Выбран сорт каталога: выбор из базы подбора сбрасываем, в карту уйдёт что-то одно. */
  pickCatalogBrand(id: string) {
    this.pickBrand.set(id || '');
    if (id) this.pickEngine.set('');
  }

  pickEngineDrink(id: string) {
    this.pickEngine.set(id || '');
    if (id) this.pickBrand.set('');
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
        this.loadError.set('Could not load venues: ' + AuthService.errorText(err));
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
    // Строки прошлого заведения убираем сразу: если новые не прочитаются, правки не уйдут в чужое меню
    this.items.set([]);
    this.drinks.set([]);
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
    this.loadEngineDrinks();
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
      flash(this.venueMsg, 'Error: enter a name and address', 6000);
      return;
    }
    if (payload.tables_count < 1 || payload.tables_count > 500) {
      flash(this.venueMsg, 'Error: tables must be between 1 and 500', 6000);
      return;
    }
    // Ответ может прийти, когда справа уже другая карточка: её форму, выбор и сообщения не трогаем
    const form = this.form;
    if (this.creating()) {
      this.venueSaving.set(true);
      this.api.createVenue(payload).subscribe({
        next: v => {
          this.venueSaving.set(false);
          this.venues.update(list => [...list, v]);
          // У пользователя появилось заведение: профиль и ссылки должны это увидеть
          this.auth.loadMe();
          if (this.form !== form) return;
          // Файл логотипа, выбранный до создания, отправляем сразу после него
          const file = this.pendingLogo;
          this.selectVenue(v.slug);
          flash(this.venueMsg, 'Venue created');
          if (file) this.uploadLogo(v, file);
        },
        error: err => {
          this.venueSaving.set(false);
          if (this.form === form) flash(this.venueMsg, 'Error: ' + AuthService.errorText(err), 6000);
        }
      });
      return;
    }
    const current = this.venue();
    if (!current) return;
    this.venueSaving.set(true);
    this.api.updateVenue(current.slug, payload).subscribe({
      next: saved => {
        this.venueSaving.set(false);
        this.replaceVenue(saved);
        // Slug мог смениться: выбор остаётся на том же заведении, если его не сменили руками
        if (saved.slug !== current.slug && this.selectedSlug() === current.slug) this.selectedSlug.set(saved.slug);
        if (this.form === form) flash(this.venueMsg, 'Saved');
      },
      error: err => {
        this.venueSaving.set(false);
        if (this.form === form) flash(this.venueMsg, 'Error: ' + AuthService.errorText(err), 6000);
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
        // Сообщение относится к заведению, чей логотип грузили: под другим его не показываем
        if (this.venue()?.id === v.id) flash(this.venueMsg, 'Logo uploaded');
      },
      error: err => {
        if (this.venue()?.id === v.id) this.logoError.set('Error: ' + AuthService.errorText(err));
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
        this.logoBusy.set(false);
        // Поле ссылки чистим только в форме того же заведения: в чужой форме оно своё
        if (this.venue()?.id !== v.id) return;
        this.form.logo_url = '';
        flash(this.venueMsg, 'Logo removed');
      },
      error: err => {
        if (this.venue()?.id === v.id) this.logoError.set('Error: ' + AuthService.errorText(err));
        this.logoBusy.set(false);
      }
    });
  }

  // Строки таблиц: правки и статусы

  /** Значения полей строки: правка, если она есть, иначе сохранённое. */
  itemDraft(row: MenuItem): ItemDraft {
    return this.itemDrafts()[row.id] ?? itemDraftOf(row);
  }

  drinkDraft(row: MenuDrink): DrinkDraft {
    return this.drinkDrafts()[row.id] ?? drinkDraftOf(row);
  }

  /** В строке есть правки, которых нет на сервере. */
  itemDirty(row: MenuItem): boolean {
    const d = this.itemDrafts()[row.id];
    return !!d && !sameItem(d, row);
  }

  drinkDirty(row: MenuDrink): boolean {
    const d = this.drinkDrafts()[row.id];
    return !!d && !sameDrink(d, row);
  }

  editItem(row: MenuItem, patch: Partial<ItemDraft>) {
    this.itemDrafts.update(m => ({ ...m, [row.id]: { ...(m[row.id] ?? itemDraftOf(row)), ...patch } }));
    this.rowEdited(row.id);
  }

  editDrink(row: MenuDrink, patch: Partial<DrinkDraft>) {
    this.drinkDrafts.update(m => ({ ...m, [row.id]: { ...(m[row.id] ?? drinkDraftOf(row)), ...patch } }));
    this.rowEdited(row.id);
  }

  rowState(id: string): RowState | null {
    return this.rowStates()[id] ?? null;
  }

  private setRow(id: string, state: RowState | null) {
    this.rowStates.update(m => state ? { ...m, [id]: state } : without(m, id));
  }

  /** Правка строки снимает её прежнюю ошибку и "Сохранено"; идущее сохранение не трогает. */
  private rowEdited(id: string) {
    const cur = this.rowStates()[id];
    if (cur && cur.kind !== 'saving') this.setRow(id, null);
  }

  /** Новое действие снимает ошибку прошлого такого же действия; ошибка другого действия остаётся. */
  private rowBegin(id: string, op: RowOp) {
    const cur = this.rowStates()[id];
    if (cur && cur.op === op && cur.kind === 'error') this.setRow(id, null);
  }

  private rowFailed(id: string, op: RowOp, err: unknown) {
    this.setRow(id, { kind: 'error', op, text: 'Error: ' + AuthService.errorText(err) });
  }

  /**
   * Сохранение строки удалось. "Сохранено" гаснет само и не перекрывает ошибку галочки или удаления,
   * появившуюся за время запроса. clean: за это время строку не правили дальше; иначе она снова "не сохранено".
   */
  private rowSaved(id: string, clean: boolean) {
    const cur = this.rowStates()[id];
    if (cur && cur.kind === 'error' && cur.op !== 'save') return;
    if (!clean) {
      this.setRow(id, null);
      return;
    }
    const state: RowState = { kind: 'saved', op: 'save', text: 'Saved' };
    this.setRow(id, state);
    setTimeout(() => {
      if (this.rowStates()[id] === state) this.setRow(id, null);
    }, 4000);
  }

  // Позиции меню

  loadItems(venueId: string) {
    this.loadingItems.set(true);
    this.itemsError.set(null);
    this.api.getMenuItems(venueId).subscribe({
      next: list => {
        if (this.venue()?.id !== venueId) return;
        this.items.set(sortItems(list));
        this.loadingItems.set(false);
      },
      error: err => {
        if (this.venue()?.id !== venueId) return;
        this.loadingItems.set(false);
        this.itemsError.set('Could not load menu items: ' + AuthService.errorText(err));
      }
    });
  }

  saveItem(row: MenuItem) {
    if (this.rowState(row.id)?.kind === 'saving') return;
    // Отправляем черновик, какой он сейчас; правки, сделанные пока идёт запрос, останутся черновиком
    const sent = this.itemDrafts()[row.id];
    const d = sent ?? itemDraftOf(row);
    const price = priceOf(d.price);
    if (price === null) {
      this.setRow(row.id, { kind: 'error', op: 'save', text: PRICE_ERROR });
      return;
    }
    this.setRow(row.id, { kind: 'saving', op: 'save', text: 'Saving...' });
    this.api.updateMenuItem(row.id, {
      price: price.toFixed(2),
      section: d.section.trim() || DEFAULT_SECTION,
      portion: d.portion.trim(),
      sort_order: orderOf(d.sort_order),
      chef_note: d.chef_note.trim()
    }).subscribe({
      next: saved => {
        // Галочку "В наличии" этот запрос не менял: берём её из строки, а не из ответа
        this.items.update(list => list.map(i => i.id === saved.id ? { ...saved, is_available: i.is_available } : i));
        const clean = this.itemDrafts()[row.id] === sent;
        if (clean) this.itemDrafts.update(m => without(m, row.id));
        this.rowSaved(row.id, clean);
      },
      error: err => this.rowFailed(row.id, 'save', err)
    });
  }

  /** Галочка возвращается на место, если сервер отказал. */
  toggleAvailable(row: MenuItem, event: Event) {
    const input = event.target as HTMLInputElement;
    const next = input.checked;
    this.rowBegin(row.id, 'toggle');
    this.api.updateMenuItem(row.id, { is_available: next }).subscribe({
      // Из ответа берём только галочку: остальные поля строки меняет "Сохранить"
      next: saved => this.items.update(list => list.map(i => i.id === saved.id ? { ...i, is_available: saved.is_available } : i)),
      error: err => {
        input.checked = row.is_available;
        this.rowFailed(row.id, 'toggle', err);
      }
    });
  }

  askDeleteItem(row: MenuItem) {
    confirmTwice(this.pendingDelete, row.id, () => {
      this.rowBegin(row.id, 'delete');
      this.api.deleteMenuItem(row.id).subscribe({
        next: () => {
          this.items.update(list => list.filter(i => i.id !== row.id));
          this.itemDrafts.update(m => without(m, row.id));
          this.setRow(row.id, null);
          this.bumpCount(row.venue, -1);
          if (this.venue()?.id === row.venue) flash(this.itemsMsg, (row.dish_name || 'Item') + ': removed from menu');
        },
        error: err => this.rowFailed(row.id, 'delete', err)
      });
    });
  }

  addDish(v: Venue) {
    const d = this.dishes().find(x => x.id === this.pickDish());
    if (!d) return;
    // Без цены позиция сразу стала бы видна гостю за 0 тенге
    const price = priceOf(this.pickItemPrice());
    if (price === null) {
      this.addItemError.set(PRICE_ERROR);
      return;
    }
    const section = this.pickSection().trim() || DEFAULT_SECTION;
    // Новая позиция встаёт в конец раздела; новый раздел - в конец меню, а не наверх
    const inSection = this.items().filter(i => (i.section || DEFAULT_SECTION) === section);
    const sortOrder = nextOrder(inSection.length ? inSection : this.items());
    this.adding.set(true);
    this.addItemError.set(null);
    this.api.createMenuItem({ venue: v.id, dish: d.id, price: price.toFixed(2), section, sort_order: sortOrder }).subscribe({
      next: item => {
        this.adding.set(false);
        this.bumpCount(v.id, 1);
        // Пока шёл запрос, могли открыть другое заведение: его таблицу, форму и сообщения не трогаем
        if (this.venue()?.id !== v.id) return;
        this.items.update(list => [...list, item]);
        this.pickDish.set('');
        this.pickItemPrice.set(null);
        flash(this.itemsMsg, d.name + ': added to menu');
      },
      error: err => {
        this.adding.set(false);
        if (this.venue()?.id === v.id) this.addItemError.set('Error: ' + AuthService.errorText(err));
      }
    });
  }

  // Карта напитков

  loadDrinks(venueId: string) {
    this.loadingDrinks.set(true);
    this.drinksError.set(null);
    this.api.getMenuDrinks(venueId).subscribe({
      next: list => {
        if (this.venue()?.id !== venueId) return;
        this.drinks.set(sortDrinks(list));
        this.loadingDrinks.set(false);
      },
      error: err => {
        if (this.venue()?.id !== venueId) return;
        this.loadingDrinks.set(false);
        this.drinksError.set('Could not load drink list: ' + AuthService.errorText(err));
      }
    });
  }

  addDrink(v: Venue) {
    const b = this.brands().find(x => x.id === this.pickBrand());
    const e = b ? undefined : this.engineDrinks().find(x => x.id === this.pickEngine());
    if (!b && !e) return;
    const price = priceOf(this.pickPrice());
    if (price === null) {
      this.addDrinkError.set(PRICE_ERROR);
      return;
    }
    const name = b ? b.name : (e!.display_name || e!.name);
    this.addingDrink.set(true);
    this.addDrinkError.set(null);
    this.api.createMenuDrink({
      venue: v.id, ...(b ? { brand: b.id } : { engine_drink_id: e!.id }), price: price.toFixed(2),
      volume: this.pickVolume().trim() || DEFAULT_VOLUME, sort_order: nextOrder(this.drinks())
    }).subscribe({
      next: drink => {
        this.addingDrink.set(false);
        // Пока шёл запрос, могли открыть другое заведение: его карту, форму и сообщения не трогаем
        if (this.venue()?.id !== v.id) return;
        this.drinks.update(list => sortDrinks([...list, drink]));
        this.pickBrand.set('');
        this.pickEngine.set('');
        this.pickPrice.set(null);
        flash(this.drinksMsg, name + ': added to list');
      },
      error: err => {
        this.addingDrink.set(false);
        if (this.venue()?.id === v.id) this.addDrinkError.set('Error: ' + AuthService.errorText(err));
      }
    });
  }

  saveDrink(row: MenuDrink) {
    if (this.rowState(row.id)?.kind === 'saving') return;
    const sent = this.drinkDrafts()[row.id];
    const d = sent ?? drinkDraftOf(row);
    const price = priceOf(d.price);
    if (price === null) {
      this.setRow(row.id, { kind: 'error', op: 'save', text: PRICE_ERROR });
      return;
    }
    this.setRow(row.id, { kind: 'saving', op: 'save', text: 'Saving...' });
    this.api.updateMenuDrink(row.id, {
      price: price.toFixed(2),
      volume: d.volume.trim(),
      sort_order: orderOf(d.sort_order)
    }).subscribe({
      next: saved => {
        this.drinks.update(list => sortDrinks(list.map(x => x.id === saved.id ? { ...saved, is_available: x.is_available } : x)));
        const clean = this.drinkDrafts()[row.id] === sent;
        if (clean) this.drinkDrafts.update(m => without(m, row.id));
        this.rowSaved(row.id, clean);
      },
      error: err => this.rowFailed(row.id, 'save', err)
    });
  }

  toggleDrinkAvailable(row: MenuDrink, event: Event) {
    const input = event.target as HTMLInputElement;
    const next = input.checked;
    this.rowBegin(row.id, 'toggle');
    this.api.updateMenuDrink(row.id, { is_available: next }).subscribe({
      next: saved => this.drinks.update(list => list.map(d => d.id === saved.id ? { ...d, is_available: saved.is_available } : d)),
      error: err => {
        input.checked = row.is_available;
        this.rowFailed(row.id, 'toggle', err);
      }
    });
  }

  askDeleteDrink(row: MenuDrink) {
    confirmTwice(this.pendingDeleteDrink, row.id, () => {
      this.rowBegin(row.id, 'delete');
      this.api.deleteMenuDrink(row.id).subscribe({
        next: () => {
          this.drinks.update(list => list.filter(d => d.id !== row.id));
          this.drinkDrafts.update(m => without(m, row.id));
          this.setRow(row.id, null);
          if (this.venue()?.id === row.venue) flash(this.drinksMsg, (row.brand_name || 'Drink') + ': removed from list');
        },
        error: err => this.rowFailed(row.id, 'delete', err)
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
    this.itemsError.set(null);
    this.drinksError.set(null);
    this.addItemError.set(null);
    this.addDrinkError.set(null);
    this.logoError.set(null);
    this.pendingDelete.set(null);
    this.pendingDeleteDrink.set(null);
    this.pendingLogo = null;
    this.pickDish.set('');
    this.pickSection.set(DEFAULT_SECTION);
    this.pickItemPrice.set(null);
    this.pickBrand.set('');
    this.pickEngine.set('');
    this.pickPrice.set(null);
    this.pickVolume.set(DEFAULT_VOLUME);
    // Правки и статусы строк относятся к строкам прошлого заведения
    this.itemDrafts.set({});
    this.drinkDrafts.set({});
    this.rowStates.set({});
  }
}

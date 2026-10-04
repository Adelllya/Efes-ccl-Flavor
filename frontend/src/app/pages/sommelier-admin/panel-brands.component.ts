import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import {
  Brand, ChangeRequest, FlavorNote, PyramidData, PyramidLayer, PyramidNoteItem,
  REQUEST_STATUS_LABELS, ServingRecommendation
} from '../../models/flavor-tree.models';
import { FtSelectComponent, SelectOption } from '../../ui/ft-select.component';
import { PanelIconComponent } from './panel-icons';
import { PanelPhotoComponent } from './panel-photo.component';
import {
  LAYER_CHOICES, LAYER_SHORT, confirmTwice, flash, formatWhen, initialOf, isErrorText, onTabReturn, statusChipClass
} from './panel-shared';

type BrandFilter = 'all' | 'nophoto' | 'nopyramid' | 'horeca';

/** Значения формы подачи. Температура null, пока поле пустое: ноль подставлять нельзя. */
interface ServingValues {
  min: number | null;
  max: number | null;
  glass: string;
  season: string;
}

const EMPTY_PYRAMID: PyramidData = { top: [], heart: [], base: [] };

/** С чем открывается форма ноты, когда ноты ещё нет в пирамиде. */
const DEFAULT_INTENSITY = 7;
const DEFAULT_SEASON = 'Круглый год';

/** Подача сорта в виде значений формы; если подачи нет, значения по умолчанию. */
function servingOf(rec?: ServingRecommendation): ServingValues {
  return {
    min: rec?.serving_temp_min ?? 5,
    max: rec?.serving_temp_max ?? 8,
    glass: rec?.glass_type ?? '',
    season: rec?.seasonality || DEFAULT_SEASON
  };
}

function sameServing(a: ServingValues, b: ServingValues): boolean {
  return a.min === b.min && a.max === b.max && a.glass === b.glass && a.season === b.season;
}

function isTemp(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const BRAND_PHOTO_HINT =
  'Одно фото в хорошем качестве (PNG или WebP без фона, JPG допустим), до 5 МБ, от 800 px по длинной стороне. '
  + 'Маленькую версию для списков сделаем сами.';

/**
 * Вкладка "Сорта": список сортов слева, справа фото, пирамида и подача выбранного сорта.
 * Модератор правит напрямую, сомелье отправляет запросы модератору.
 */
@Component({
  selector: 'panel-brands',
  standalone: true,
  imports: [FormsModule, PanelIconComponent, FtSelectComponent, PanelPhotoComponent],
  template: `
    <div class="wa-page" [class.has-selection]="!!selectedId()">
      <aside class="wa-list">
        <div class="wa-list-head">
          <h2 class="wa-list-title">Сорта @if (loaded()) { <span class="wa-count">{{ brands().length }}</span> }</h2>
        </div>
        <label class="wa-search">
          <panel-icon name="search" />
          <input type="text" placeholder="Название или стиль" aria-label="Поиск: название или стиль"
                 [ngModel]="search()" (ngModelChange)="search.set($event)" />
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
            @for (b of filtered(); track b.id) {
              <button type="button" class="wa-row" [class.active]="selectedId() === b.id" (click)="select(b.id)">
                <span class="wa-avatar">
                  @if (b.image || b.image_hd) { <img [src]="b.image || b.image_hd" [alt]="b.name" /> } @else { {{ initial(b.name) }} }
                </span>
                <span class="wa-row-body">
                  <span class="wa-row-title">{{ b.name }}</span>
                  <span class="wa-row-sub">{{ b.style }}@if (b.abv !== null && b.abv !== undefined) {<span class="wa-dot"></span>{{ b.abv }}%}</span>
                </span>
                <span class="wa-row-meta">
                  <span class="wa-chip" [class.wa-chip-approved]="b.profile?.status === 'complete'" [class.wa-chip-pending]="b.profile?.status === 'partial'">
                    {{ profileText(b) }}
                  </span>
                </span>
              </button>
            } @empty {
              <p class="wa-empty">{{ brands().length ? 'Ничего не найдено' : 'Сортов пока нет' }}</p>
            }
          }
        </div>
      </aside>

      <section class="wa-detail">
        @for (b of selectedOne(); track b.id) {
          <div class="wa-detail-enter">
            <button type="button" class="wa-back" (click)="select(null)"><panel-icon name="arrowLeft" /> К списку</button>

            <div class="wa-card">
              <div class="wa-card-head">
                <span class="wa-avatar wa-avatar-lg">
                  @if (b.image || b.image_hd) { <img [src]="b.image || b.image_hd" [alt]="b.name" /> } @else { {{ initial(b.name) }} }
                </span>
                <div class="wa-card-head-text">
                  <h3 class="wa-card-title">{{ b.name }}</h3>
                  <p class="wa-card-sub">{{ b.style }}
                    @if (b.brand_owner) { <span class="wa-dot"></span>{{ b.brand_owner }} }
                  </p>
                </div>
                <div class="wa-chips">
                  @if (b.is_horeca_only) { <span class="wa-chip wa-chip-accent">HoReCa</span> }
                  @else { <span class="wa-chip">{{ b.packaging_type_display || b.packaging_type }}</span> }
                </div>
              </div>
              <dl class="wa-facts">
                <div><dt>ABV</dt><dd>{{ b.abv !== null && b.abv !== undefined ? b.abv + '%' : 'нет данных' }}</dd></div>
                <div><dt>Плотность</dt><dd>{{ b.density || 'нет данных' }}</dd></div>
                <div><dt>Брожение</dt><dd>{{ b.fermentation_type || 'нет данных' }}</dd></div>
              </dl>
              @if (b.description) { <p class="wa-text">{{ b.description }}</p> }
              @if (propose()) {
                <p class="wa-info"><panel-icon name="send" /> Изменения пирамиды и подачи уходят модератору. На сайт попадают только принятые.</p>
              }
            </div>

            @if (!propose()) {
              <div class="wa-card">
                <div class="wa-card-head">
                  <div class="wa-card-head-text">
                    <h3 class="wa-card-title">Фото</h3>
                    <p class="wa-card-sub">Оригинал идёт на страницу сорта, уменьшенная копия в списки и карточки</p>
                  </div>
                </div>
                <panel-photo
                  [currentUrl]="b.image_hd || b.image"
                  [busy]="photoBusy()"
                  [error]="photoError()"
                  [hint]="photoHint"
                  title="Фото сорта"
                  (fileChosen)="uploadPhoto(b, $event)"
                  (removeRequested)="removePhoto(b)"
                />
              </div>
            }

            <div class="wa-card">
              <div class="wa-card-head">
                <div class="wa-card-head-text">
                  <h3 class="wa-card-title">Пирамида</h3>
                  <p class="wa-card-sub">Top: аромат, Heart: тело, Base: послевкусие</p>
                </div>
                @if (b.profile?.complete) { <span class="wa-chip wa-chip-approved">Все слои заполнены</span> }
                @else { <span class="wa-chip wa-chip-pending">Заполнены не все слои</span> }
              </div>

              @if (pyramidLoading()) {
                <p class="wa-muted">Загрузка пирамиды...</p>
              } @else if (pyramidError()) {
                <div class="wa-loadbar" role="alert">
                  <panel-icon name="alert" />
                  <span>{{ pyramidError() }}</span>
                  <button type="button" class="btn-outline" (click)="loadPyramid(b.id)"><panel-icon name="refresh" /> Обновить</button>
                </div>
              } @else {
                <div class="wa-layers">
                  @for (layer of pyramidLayers(); track layer.key) {
                    <div class="wa-layer">
                      <h4>{{ layer.label }}</h4>
                      @for (n of layer.notes; track n.id) {
                        <div class="wa-note" [class.active]="noteId() === n.id">
                          <div class="wa-note-body">
                            <div class="wa-note-name">{{ n.name }} <span class="wa-muted">{{ n.intensity }}/10</span></div>
                            <span class="wa-bar"><span [style.width.%]="n.intensity * 10"></span></span>
                            @if (n.sommelier_note) { <p class="wa-note-comment">{{ n.sommelier_note }}</p> }
                          </div>
                          <button type="button" class="wa-iconbtn wa-iconbtn-sm" title="Изменить" [attr.aria-label]="'Изменить: ' + n.name"
                                  (click)="editNote(layer.key, n)">
                            <panel-icon name="edit" />
                          </button>
                          <button type="button" class="wa-iconbtn wa-iconbtn-sm wa-danger"
                                  [title]="propose() ? 'Предложить удаление' : 'Удалить'"
                                  [attr.aria-label]="pendingDelete() === n.id ? 'Точно? Нажмите ещё раз: ' + n.name : (propose() ? 'Предложить удаление: ' : 'Удалить: ') + n.name"
                                  (click)="askDeleteNote(b, n)">
                            @if (pendingDelete() === n.id) { <span class="wa-confirm">Точно?</span> } @else { <panel-icon name="trash" /> }
                          </button>
                        </div>
                      } @empty {
                        <p class="wa-muted">В этом слое пока нет нот</p>
                      }
                    </div>
                  }
                </div>
              }

              <div class="wa-subform">
                <h4 class="wa-subtitle">{{ propose() ? 'Предложить ноту' : 'Добавить или изменить ноту' }}</h4>
                <div class="wa-fields">
                  <div class="wa-field">
                    <span class="wa-label">Нота из справочника</span>
                    <!-- Пока пирамида не прочитана, выбор закрыт: неизвестно, стоит ли нота в пирамиде и с какими значениями -->
                    <ft-select [options]="noteOptions()" [searchable]="true" placeholder="Выберите ноту" ariaLabel="Нота из справочника"
                               [disabled]="pyramidLoading() || !!pyramidError()"
                               [ngModel]="noteId()" (ngModelChange)="onNotePicked($event)" />
                  </div>
                  <div class="wa-field">
                    <span class="wa-label">Слой пирамиды</span>
                    <ft-select [options]="layerOptions" ariaLabel="Слой пирамиды"
                               [ngModel]="noteLayer()" (ngModelChange)="noteLayer.set($event)" />
                  </div>
                  <label class="wa-field">
                    <span class="wa-label">Интенсивность: {{ intensity() }}/10</span>
                    <input class="wa-range" type="range" min="1" max="10" [ngModel]="intensity()" (ngModelChange)="intensity.set(+$event)" />
                  </label>
                  <label class="wa-field wa-field-wide">
                    <span class="wa-label">Комментарий сомелье</span>
                    <textarea class="input" rows="2" [ngModel]="noteComment()" (ngModelChange)="noteComment.set($event)"
                              placeholder="Например: чистая хмелевая волна с травянистым шлейфом"></textarea>
                  </label>
                  @if (propose()) {
                    <label class="wa-field wa-field-wide">
                      <span class="wa-label">Пояснение для модератора</span>
                      <input class="input" type="text" [ngModel]="noteRequestComment()" (ngModelChange)="noteRequestComment.set($event)"
                             placeholder="Почему стоит принять это изменение" />
                    </label>
                  }
                </div>
                <div class="wa-actions">
                  <!-- Пока пирамида не прочитана, неизвестно, есть ли в ней нота: сохранение затёрло бы её комментарий -->
                  <button type="button" class="btn-amber" [disabled]="pyramidSaving() || !noteId() || pyramidLoading() || !!pyramidError()"
                          (click)="saveNote(b)">
                    <panel-icon [name]="propose() ? 'send' : 'save'" /> {{ propose() ? 'Предложить изменение' : 'Сохранить ноту' }}
                  </button>
                  @if (pyramidMsg()) {
                    <p class="wa-msg" [class.error]="isError(pyramidMsg())" [attr.role]="isError(pyramidMsg()) ? 'alert' : 'status'">{{ pyramidMsg() }}</p>
                  }
                </div>
              </div>
            </div>

            <div class="wa-card">
              <div class="wa-card-head">
                <div class="wa-card-head-text">
                  <h3 class="wa-card-title">Подача</h3>
                  <p class="wa-card-sub">
                    @if (b.serving_recommendation) { Температура, бокал и сезон, которые видит гость }
                    @else { Для этого сорта подача ещё не заполнена }
                  </p>
                </div>
              </div>
              <div class="wa-fields">
                <!-- Пустое поле температуры ngModel отдаёт как null: в ноль его не превращаем -->
                <label class="wa-field">
                  <span class="wa-label">Температура от, °C</span>
                  <input class="input" type="number" required [ngModel]="tempMin()" (ngModelChange)="tempMin.set($event)" />
                </label>
                <label class="wa-field">
                  <span class="wa-label">Температура до, °C</span>
                  <input class="input" type="number" required [ngModel]="tempMax()" (ngModelChange)="tempMax.set($event)" />
                </label>
                <label class="wa-field">
                  <span class="wa-label">Бокал, обязательно</span>
                  <input class="input" type="text" required maxlength="100" [ngModel]="glass()" (ngModelChange)="glass.set($event)"
                         placeholder="Пилснер / Тюльпан / Пинта" />
                </label>
                <label class="wa-field">
                  <span class="wa-label">Сезон</span>
                  <input class="input" type="text" maxlength="100" [ngModel]="seasonality()" (ngModelChange)="seasonality.set($event)"
                         placeholder="Круглый год" />
                </label>
                @if (propose()) {
                  <label class="wa-field wa-field-wide">
                    <span class="wa-label">Пояснение для модератора</span>
                    <input class="input" type="text" [ngModel]="servingRequestComment()" (ngModelChange)="servingRequestComment.set($event)"
                           placeholder="Почему стоит принять это изменение" />
                  </label>
                }
              </div>
              <div class="wa-actions">
                <button type="button" class="btn-amber" [disabled]="servingSaving()" (click)="saveServing(b)">
                  <panel-icon [name]="propose() ? 'send' : 'save'" /> {{ propose() ? 'Предложить изменение' : 'Сохранить' }}
                </button>
                @if (servingMsg()) {
                  <p class="wa-msg" [class.error]="isError(servingMsg())" [attr.role]="isError(servingMsg()) ? 'alert' : 'status'">{{ servingMsg() }}</p>
                }
              </div>
            </div>

            @if (propose()) {
              <div class="wa-card">
                <div class="wa-card-head">
                  <div class="wa-card-head-text">
                    <h3 class="wa-card-title">Мои запросы по этому сорту</h3>
                    <p class="wa-card-sub">Ожидающие можно отозвать, пока модератор их не рассмотрел</p>
                  </div>
                  <button type="button" class="wa-iconbtn" title="Обновить" aria-label="Обновить мои запросы"
                          [disabled]="requestsLoading()" (click)="loadMyRequests(b.id)">
                    <panel-icon name="refresh" />
                  </button>
                </div>
                @if (requestsMsg()) {
                  <p class="wa-msg" [class.error]="isError(requestsMsg())" [attr.role]="isError(requestsMsg()) ? 'alert' : 'status'">{{ requestsMsg() }}</p>
                }
                @if (requestsError()) {
                  <div class="wa-loadbar" role="alert">
                    <panel-icon name="alert" />
                    <span>{{ requestsError() }}</span>
                    <button type="button" class="btn-outline" [disabled]="requestsLoading()" (click)="loadMyRequests(b.id)">
                      <panel-icon name="refresh" /> Обновить
                    </button>
                  </div>
                }
                @if (requestsLoading() && !myRequests().length) {
                  <p class="wa-muted">Загрузка...</p>
                } @else if (myRequests().length || !requestsError()) {
                  <!-- После неудачной загрузки "запросов ещё не было" не пишем: список просто не прочитан -->
                  <div class="wa-requests">
                    @for (r of myRequests(); track r.id) {
                      <div class="wa-request">
                        <div class="wa-request-body">
                          <div class="wa-request-title">{{ r.summary }}</div>
                          <div class="wa-request-sub">{{ r.kind_display }}<span class="wa-dot"></span>{{ when(r.created_at) }}
                            @if (r.reviewer) { <span class="wa-dot"></span>{{ r.status === 'APPROVED' ? 'принял' : 'отклонил' }} {{ r.reviewer.username }} }
                          </div>
                          @if (r.review_comment) { <p class="wa-request-review">{{ r.review_comment }}</p> }
                        </div>
                        <span [class]="chip(r.status)">{{ statusLabels[r.status] }}</span>
                        @if (r.status === 'PENDING') {
                          <button type="button" class="btn-outline panel-btn-sm" (click)="askWithdraw(r)">
                            {{ pendingWithdraw() === r.id ? 'Точно отозвать?' : 'Отозвать' }}
                          </button>
                        }
                      </div>
                    } @empty {
                      <p class="wa-muted">По этому сорту запросов ещё не было</p>
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
export class PanelBrandsComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  brands = input<Brand[]>([]);
  notes = input<FlavorNote[]>([]);
  /** false, пока родитель ждёт список сортов: вместо "Сортов пока нет" показываем загрузку. */
  loaded = input(false);
  /** Вкладка на экране. Панель держит её живой и прячет: при возврате перечитываем пирамиду и запросы открытого сорта. */
  active = input(true);
  /** Новый список сортов после фото, подачи или пирамиды; родитель хранит его. */
  brandsChanged = output<Brand[]>();
  /** Сомелье отправил или отозвал запрос: родитель обновляет счётчик. */
  requestsChanged = output<void>();

  readonly initial = initialOf;
  readonly when = formatWhen;
  readonly chip = statusChipClass;
  readonly statusLabels = REQUEST_STATUS_LABELS;
  readonly layerOptions: SelectOption[] = LAYER_CHOICES;
  readonly photoHint = BRAND_PHOTO_HINT;
  readonly pills: { value: BrandFilter; label: string }[] = [
    { value: 'all', label: 'Все' },
    { value: 'nophoto', label: 'Без фото' },
    { value: 'nopyramid', label: 'Без пирамиды' },
    { value: 'horeca', label: 'HoReCa' }
  ];

  /** Сомелье не правит напрямую: формы создают запросы модератору. */
  propose = computed(() => this.auth.role() === 'sommelier');

  search = signal('');
  filter = signal<BrandFilter>('all');
  selectedId = signal<string | null>(null);

  // Пирамида
  pyramid = signal<PyramidData | null>(null);
  /** Номер последнего чтения пирамиды: ответ более старого чтения не применяем поверх свежих данных. */
  private pyramidSeq = 0;
  pyramidLoading = signal(false);
  /** Пирамиду не удалось прочитать: показываем текст и кнопку "Обновить", а не заглушку. */
  pyramidError = signal<string | null>(null);
  pyramidSaving = signal(false);
  pyramidMsg = signal<string | null>(null);
  noteId = signal('');
  noteLayer = signal<PyramidLayer>('TOP');
  intensity = signal(DEFAULT_INTENSITY);
  noteComment = signal('');
  noteRequestComment = signal('');
  pendingDelete = signal<string | null>(null);

  // Подача
  tempMin = signal<number | null>(5);
  tempMax = signal<number | null>(8);
  glass = signal('');
  seasonality = signal(DEFAULT_SEASON);
  servingSaving = signal(false);
  servingMsg = signal<string | null>(null);
  servingRequestComment = signal('');
  /** С какими значениями форма подачи была заполнена: по ним видно, правил ли её пользователь. */
  private servingBase: ServingValues = servingOf();

  // Фото
  photoBusy = signal(false);
  photoError = signal<string | null>(null);

  // Запросы сомелье
  myRequests = signal<ChangeRequest[]>([]);
  requestsLoading = signal(false);
  /** Запросы не прочитались: текст с кнопкой "Обновить" держится до удачной попытки. */
  requestsError = signal<string | null>(null);
  requestsMsg = signal<string | null>(null);
  pendingWithdraw = signal<string | null>(null);

  isError = isErrorText;

  filtered = computed(() => {
    const q = this.search().toLowerCase().trim();
    const f = this.filter();
    return this.brands().filter(b =>
      (!q || b.name.toLowerCase().includes(q) || (b.style || '').toLowerCase().includes(q)) &&
      (f === 'all'
        || (f === 'nophoto' && !b.image && !b.image_hd)
        || (f === 'nopyramid' && !b.profile?.complete)
        || (f === 'horeca' && b.is_horeca_only))
    );
  });

  selectedOne = computed(() => {
    const b = this.brands().find(x => x.id === this.selectedId());
    return b ? [b] : [];
  });

  noteOptions = computed<SelectOption[]>(() =>
    this.notes().map(n => ({ value: n.id, label: n.name, hint: n.category_display || LAYER_SHORT[n.category] }))
  );

  pyramidLayers = computed(() => {
    const py = this.pyramid() ?? EMPTY_PYRAMID;
    return [
      { key: 'TOP' as PyramidLayer, label: 'Top: аромат', notes: py.top ?? [] },
      { key: 'HEART' as PyramidLayer, label: 'Heart: тело', notes: py.heart ?? [] },
      { key: 'BASE' as PyramidLayer, label: 'Base: послевкусие', notes: py.base ?? [] }
    ];
  });

  constructor() {
    // Пока вкладка была спрятана, модератор мог принять запрос по открытому сорту: пирамиду и запросы перечитываем
    onTabReturn(this.active, () => {
      const id = this.selectedId();
      if (!id) return;
      this.loadPyramid(id, true);
      if (this.propose()) this.loadMyRequests(id);
    });

    // Подачу открытого сорта изменили не из этой формы (модератор принял запрос): форму без правок
    // заполняем заново, иначе "Сохранить" записало бы старые значения поверх принятых
    effect(() => {
      const rec = this.selectedOne()[0]?.serving_recommendation;
      untracked(() => this.syncServing(rec));
    }, { allowSignalWrites: true });
  }

  profileText(b: Brand): string {
    const p = b.profile;
    if (!p || p.status === 'empty') return 'без нот';
    if (p.complete) return 'пирамида';
    return `${p.total} ${this.plural(p.total, 'нота', 'ноты', 'нот')}`;
  }

  select(id: string | null) {
    this.selectedId.set(id);
    this.pendingDelete.set(null);
    this.photoError.set(null);
    this.pyramidMsg.set(null);
    this.servingMsg.set(null);
    this.requestsMsg.set(null);
    this.requestsError.set(null);
    this.resetNoteForm();
    const b = this.selectedOne()[0];
    this.fillServing(b?.serving_recommendation);
    // Пирамиду и запросы прошлого сорта убираем сразу: при неудачной загрузке они остались бы под чужим сортом
    this.pyramid.set(null);
    this.loadPyramid(id);
    this.myRequests.set([]);
    if (id && this.propose()) this.loadMyRequests(id);
  }

  // Фото

  uploadPhoto(b: Brand, file: File) {
    this.photoBusy.set(true);
    this.photoError.set(null);
    this.api.uploadBrandImage(b.id, file).subscribe({
      next: updated => this.applyPhoto(updated),
      error: err => {
        this.photoError.set('Ошибка: ' + AuthService.errorText(err));
        this.photoBusy.set(false);
      }
    });
  }

  /** Сервер убирает и оригинал, и уменьшенную копию. */
  removePhoto(b: Brand) {
    this.photoBusy.set(true);
    this.photoError.set(null);
    this.api.deleteBrandImage(b.id).subscribe({
      next: updated => this.applyPhoto(updated),
      error: err => {
        this.photoError.set('Ошибка: ' + AuthService.errorText(err));
        this.photoBusy.set(false);
      }
    });
  }

  private applyPhoto(updated: Brand) {
    this.brandsChanged.emit(this.brands().map(x => x.id === updated.id ? { ...x, image: updated.image, image_hd: updated.image_hd } : x));
    this.photoBusy.set(false);
  }

  // Пирамида

  /** silent: фоновое обновление уже показанной пирамиды, без "Загрузка..." и без ошибки поверх неё. */
  loadPyramid(id: string | null, silent = false) {
    if (!id) {
      this.pyramid.set(null);
      this.pyramidError.set(null);
      return;
    }
    // Нечего обновлять в фоне, если пирамида ещё не показана: тогда читаем как обычно
    if (silent && (this.pyramidLoading() || this.pyramidError() || !this.pyramid())) silent = false;
    if (!silent) {
      this.pyramidLoading.set(true);
      this.pyramidError.set(null);
    }
    const seq = ++this.pyramidSeq;
    // Без заглушек: при ошибке сервера показываем её, а не чужую пирамиду
    this.api.getBrandDetailStrict(id).subscribe({
      next: b => {
        if (seq !== this.pyramidSeq || this.selectedId() !== id) return;
        this.pyramid.set(this.normalizePyramid(b.pyramid));
        this.pyramidLoading.set(false);
        this.pyramidError.set(null);
      },
      error: err => {
        if (seq !== this.pyramidSeq || this.selectedId() !== id || silent) return;
        this.pyramid.set(EMPTY_PYRAMID);
        this.pyramidError.set('Не удалось загрузить пирамиду: ' + AuthService.errorText(err));
        this.pyramidLoading.set(false);
      }
    });
  }

  onNotePicked(id: string) {
    // Нота уже стоит в пирамиде: в форму идут её слой, интенсивность и комментарий, как по кнопке "Изменить".
    // Иначе сохранение затёрло бы комментарий и сбросило интенсивность
    for (const layer of this.pyramidLayers()) {
      const existing = layer.notes.find(n => n.id === id);
      if (existing) {
        this.editNote(layer.key, existing);
        return;
      }
    }
    this.noteId.set(id);
    this.intensity.set(DEFAULT_INTENSITY);
    this.noteComment.set('');
    // слой подсказываем по категории ноты, но его можно поменять
    const note = this.notes().find(n => n.id === id);
    if (note) this.noteLayer.set(note.category);
  }

  editNote(layer: PyramidLayer, n: PyramidNoteItem) {
    this.noteLayer.set(layer);
    this.noteId.set(n.id);
    this.intensity.set(n.intensity);
    this.noteComment.set(n.sommelier_note || '');
  }

  saveNote(b: Brand) {
    const noteId = this.noteId();
    if (!noteId) return;
    const payload = {
      flavor_note_id: noteId,
      layer: this.noteLayer(),
      intensity: Number(this.intensity()),
      sommelier_note: this.noteComment().trim()
    };
    this.pyramidSaving.set(true);
    // Ответы приходят уже после того, как открыли другой сорт: его карточку не трогаем
    if (this.propose()) {
      this.api.createChangeRequest({ brand: b.id, kind: 'NOTE_UPSERT', payload, comment: this.noteRequestComment().trim() }).subscribe({
        next: () => {
          this.pyramidSaving.set(false);
          if (this.selectedId() !== b.id) return;
          this.noteRequestComment.set('');
          flash(this.pyramidMsg, 'Запрос отправлен модератору', 6000);
          this.afterRequestChange(b.id);
        },
        error: err => {
          this.pyramidSaving.set(false);
          if (this.selectedId() !== b.id) return;
          flash(this.pyramidMsg, 'Ошибка: ' + AuthService.errorText(err), 6000);
        }
      });
      return;
    }
    // Без replace: сервер обновляет одну ноту и не трогает остальные
    this.api.saveFlavorProfiles({ brand_id: b.id, notes: [payload] }).subscribe({
      next: res => {
        this.pyramidSaving.set(false);
        this.refreshBrands();
        if (this.selectedId() !== b.id) return;
        const warnings: string[] = Array.isArray(res?.warnings) ? res.warnings : [];
        flash(this.pyramidMsg, warnings.length ? 'Сохранено. ' + warnings.join('. ') : 'Сохранено', 6000);
        if (res?.pyramid) {
          // В ответе свежая пирамида целиком: чтение, начатое до сохранения, вернуло бы её без этой правки
          this.pyramidSeq++;
          this.pyramid.set(this.normalizePyramid(res.pyramid));
          this.pyramidLoading.set(false);
          this.pyramidError.set(null);
        } else {
          this.loadPyramid(b.id);
        }
      },
      error: err => {
        this.pyramidSaving.set(false);
        if (this.selectedId() !== b.id) return;
        flash(this.pyramidMsg, 'Ошибка: ' + AuthService.errorText(err), 6000);
      }
    });
  }

  askDeleteNote(b: Brand, n: PyramidNoteItem) {
    confirmTwice(this.pendingDelete, n.id, () => {
      if (this.propose()) {
        this.api.createChangeRequest({ brand: b.id, kind: 'NOTE_DELETE', payload: { flavor_note_id: n.id } }).subscribe({
          next: () => {
            if (this.selectedId() !== b.id) return;
            flash(this.pyramidMsg, 'Запрос на удаление отправлен модератору', 6000);
            this.afterRequestChange(b.id);
          },
          error: err => {
            if (this.selectedId() !== b.id) return;
            flash(this.pyramidMsg, 'Ошибка: ' + AuthService.errorText(err), 6000);
          }
        });
        return;
      }
      this.api.deleteFlavorProfile(b.id, n.id).subscribe({
        next: () => {
          this.refreshBrands();
          if (this.selectedId() !== b.id) return;
          // Фоновое чтение, начатое до удаления, вернуло бы ноту обратно; обычное чтение пусть закончится само
          if (!this.pyramidLoading()) this.pyramidSeq++;
          this.pyramid.update(py => py ? {
            top: py.top.filter(x => x.id !== n.id),
            heart: py.heart.filter(x => x.id !== n.id),
            base: py.base.filter(x => x.id !== n.id)
          } : py);
          flash(this.pyramidMsg, 'Нота убрана из пирамиды');
        },
        error: err => {
          if (this.selectedId() !== b.id) return;
          flash(this.pyramidMsg, 'Ошибка: ' + AuthService.errorText(err), 6000);
        }
      });
    });
  }

  // Подача

  saveServing(b: Brand) {
    const min = this.tempMin();
    const max = this.tempMax();
    // Пустое поле температуры приходит как null: ноль вместо него сохранять нельзя
    if (!isTemp(min) || !isTemp(max)) {
      flash(this.servingMsg, 'Ошибка: укажите температуру "от" и "до"', 6000);
      return;
    }
    const rec: ServingRecommendation = {
      serving_temp_min: min,
      serving_temp_max: max,
      glass_type: this.glass().trim(),
      seasonality: this.seasonality().trim() || DEFAULT_SEASON
    };
    if (rec.serving_temp_min > rec.serving_temp_max) {
      flash(this.servingMsg, 'Ошибка: температура "от" больше, чем "до"', 6000);
      return;
    }
    // Сервер требует бокал и для прямой записи, и для запроса модератору
    if (!rec.glass_type) {
      flash(this.servingMsg, 'Ошибка: укажите бокал', 6000);
      return;
    }
    this.servingSaving.set(true);
    if (this.propose()) {
      this.api.createChangeRequest({ brand: b.id, kind: 'SERVING', payload: rec, comment: this.servingRequestComment().trim() }).subscribe({
        next: () => {
          this.servingSaving.set(false);
          if (this.selectedId() !== b.id) return;
          this.servingRequestComment.set('');
          flash(this.servingMsg, 'Запрос отправлен модератору', 6000);
          this.afterRequestChange(b.id);
        },
        error: err => {
          this.servingSaving.set(false);
          if (this.selectedId() !== b.id) return;
          flash(this.servingMsg, 'Ошибка: ' + AuthService.errorText(err), 6000);
        }
      });
      return;
    }
    this.api.saveServingRecommendation(b.id, rec).subscribe({
      next: () => {
        this.servingSaving.set(false);
        this.brandsChanged.emit(this.brands().map(x => x.id === b.id ? { ...x, serving_recommendation: rec } : x));
        if (this.selectedId() !== b.id) return;
        // Форма теперь совпадает с сохранённым: дальше её снова можно обновлять вслед за сервером
        this.applyServing(servingOf(rec));
        flash(this.servingMsg, 'Сохранено');
      },
      error: err => {
        this.servingSaving.set(false);
        if (this.selectedId() !== b.id) return;
        flash(this.servingMsg, 'Ошибка: ' + AuthService.errorText(err), 6000);
      }
    });
  }

  // Запросы сомелье

  loadMyRequests(brandId: string) {
    this.requestsLoading.set(true);
    this.requestsError.set(null);
    this.api.getChangeRequests({ brand: brandId }).subscribe({
      next: list => {
        if (this.selectedId() !== brandId) return;
        this.myRequests.set(list);
        this.requestsLoading.set(false);
      },
      error: err => {
        if (this.selectedId() !== brandId) return;
        this.requestsLoading.set(false);
        // Не на несколько секунд: иначе под карточкой осталось бы "запросов ещё не было"
        this.requestsError.set('Не удалось загрузить запросы: ' + AuthService.errorText(err));
      }
    });
  }

  askWithdraw(r: ChangeRequest) {
    confirmTwice(this.pendingWithdraw, r.id, () => {
      this.api.deleteChangeRequest(r.id).subscribe({
        next: () => {
          this.myRequests.update(list => list.filter(x => x.id !== r.id));
          this.requestsChanged.emit();
          // Сообщение относится к сорту запроса: под другим сортом его не показываем
          if (this.selectedId() === r.brand) flash(this.requestsMsg, 'Запрос отозван');
        },
        error: err => {
          if (this.selectedId() === r.brand) flash(this.requestsMsg, 'Ошибка: ' + AuthService.errorText(err), 6000);
        }
      });
    });
  }

  private afterRequestChange(brandId: string) {
    this.loadMyRequests(brandId);
    this.requestsChanged.emit();
  }

  /** Профиль и число нот в списке сортов должны совпадать с пирамидой. При ошибке список остаётся прежним. */
  private refreshBrands() {
    this.api.getBrandsStrict().subscribe({
      next: list => {
        if (list.length) this.brandsChanged.emit(list);
      },
      error: () => {}
    });
  }

  private resetNoteForm() {
    this.noteId.set('');
    this.noteLayer.set('TOP');
    this.intensity.set(DEFAULT_INTENSITY);
    this.noteComment.set('');
    this.noteRequestComment.set('');
  }

  /** Если у сорта подачи нет, форма получает значения по умолчанию, а не чужие. */
  private fillServing(rec?: ServingRecommendation) {
    this.applyServing(servingOf(rec));
    this.servingRequestComment.set('');
  }

  /** Подача открытого сорта на сервере стала другой: форму обновляем, только если пользователь её не правил. */
  private syncServing(rec?: ServingRecommendation) {
    const next = servingOf(rec);
    if (sameServing(next, this.servingBase)) return;
    const shown: ServingValues = { min: this.tempMin(), max: this.tempMax(), glass: this.glass(), season: this.seasonality() };
    if (sameServing(shown, this.servingBase)) this.applyServing(next);
  }

  private applyServing(v: ServingValues) {
    this.tempMin.set(v.min);
    this.tempMax.set(v.max);
    this.glass.set(v.glass);
    this.seasonality.set(v.season);
    this.servingBase = v;
  }

  private normalizePyramid(py: Partial<PyramidData> | null | undefined): PyramidData {
    return { top: py?.top ?? [], heart: py?.heart ?? [], base: py?.base ?? [] };
  }

  private plural(n: number, one: string, few: string, many: string): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
  }
}

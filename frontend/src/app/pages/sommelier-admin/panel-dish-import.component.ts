import {
  Component, DestroyRef, ElementRef, Injector, OnDestroy, OnInit, afterNextRender, computed, inject, input,
  output, signal, viewChild
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { TimeoutError, concatMap, from, timeout, toArray } from 'rxjs';
import { AI_VISION_TIMEOUT_MS, ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import {
  AiDishDraft, AiPairing, AiPhotoKind, Dish, DishImportItem, DishImportResult, PAIRING_LABELS
} from '../../models/flavor-tree.models';
import { FtSelectComponent, SelectOption } from '../../ui/ft-select.component';
import { downscalePhoto, photoProblem } from '../../ui/image-tools';
import { COOKING_CHOICES, CUISINE_CHOICES, FAT_CHOICES, TASTE_CHOICES, WEIGHT_CHOICES, countOf } from './panel-shared';

/** Заведение, в меню которого встают блюда: хватает адреса и названия. */
export interface ImportVenue {
  slug: string;
  name: string;
}

interface PairingRow {
  on: boolean;
  p: AiPairing;
}

/** Черновик блюда в списке проверки: поля правятся прямо здесь, до сохранения ничего не записано. */
interface DraftRow {
  key: number;
  include: boolean;
  open: boolean;
  draft: AiDishDraft;
  /** У блюда есть двойник в каталоге: взять его (true) или всё же создать новое. */
  useExisting: boolean;
  price: string;
  pairings: PairingRow[];
}

type Step = 'pick' | 'busy' | 'review' | 'saving' | 'done';

const CATALOG_ONLY = '';
/** Сколько блюд уходит в один запрос подбора сортов: так ответ приходит за 10-20 секунд. */
const SUGGEST_CHUNK = 8;

/**
 * Блюда по фото: администратор снимает тарелку или страницу меню, ИИ возвращает черновики,
 * администратор проверяет их и сохраняет. Открывается поверх панели из вкладок "Блюда" и "Меню".
 */
@Component({
  selector: 'panel-dish-import',
  standalone: true,
  imports: [FormsModule, FtSelectComponent],
  template: `
    <!-- Родной dialog: открывается поверх всего сайта, сам держит фокус внутри и гасит страницу под собой -->
    <dialog class="aii-sheet" aria-labelledby="aii-title" #sheet (cancel)="onCancel($event)" (click)="onBackdrop($event)">
      <header class="aii-head">
        <span class="aii-head-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9L12 3Z"/><path d="M19 17v4"/><path d="M17 19h4"/></svg>
        </span>
        <div class="aii-head-text">
          <h2 id="aii-title" class="aii-title">Блюда по фото</h2>
          <p class="aii-sub">{{ targetLabel() }}</p>
        </div>
        <ol class="aii-steps" aria-label="Шаги">
          <li [class.current]="stepIndex() === 0" [class.done]="stepIndex() > 0">Фото</li>
          <li [class.current]="stepIndex() === 1" [class.done]="stepIndex() > 1">Проверка</li>
          <li [class.current]="stepIndex() === 2">Готово</li>
        </ol>
        <button type="button" class="wa-iconbtn" aria-label="Закрыть" title="Закрыть" (click)="askClose()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </header>

      <div class="aii-body">
        @switch (step()) {

          @case ('pick') {
            <div class="aii-pick">
              <p class="aii-lead">
                Сфотографируйте тарелку или страницу меню. ИИ распознает блюда, заполнит вкус, вес и способ приготовления,
                а к фото блюда сразу предложит сорта. Вы проверяете список и сохраняете то, что нужно.
              </p>

              @if (aiEnabled() === false) {
                <p class="aii-note aii-note-warn" role="status">
                  ИИ на сервере выключен: не задан ключ ANTHROPIC_API_KEY. Добавьте его в backend/.env
                  (на Vercel в переменные окружения проекта), и распознавание заработает. Пока блюда добавляются вручную.
                </p>
              }

              <div class="aii-drop" [class.over]="dragOver()" [class.has-file]="!!file()" tabindex="0" role="button" autofocus
                   aria-label="Выбрать фото"
                   (click)="fileInput.click()" (keydown.enter)="fileInput.click()"
                   (keydown.space)="fileInput.click(); $event.preventDefault()"
                   (dragover)="onDragOver($event)" (dragleave)="dragOver.set(false)" (drop)="onDrop($event)">
                @if (preview(); as src) {
                  <img class="aii-drop-img" [src]="src" alt="Выбранное фото" />
                  <span class="aii-drop-change">Нажмите, чтобы выбрать другое фото</span>
                } @else {
                  <svg class="aii-drop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
                  <strong>Перетащите фото или нажмите, чтобы выбрать</strong>
                  <span>С телефона можно сразу снять камерой. Одна страница меню на одно фото, текст должен читаться</span>
                }
              </div>
              <input type="file" accept="image/*" hidden #fileInput (change)="onInput($event)" />

              <div class="aii-fields">
                <label class="wa-field">
                  <span class="wa-label">Подсказка для ИИ (необязательно)</span>
                  <input class="input" type="text" maxlength="300" [(ngModel)]="hint"
                         placeholder="Например: страница закусок, цены в тенге" />
                </label>
                @if (!venue() && venueOptions().length > 1) {
                  <div class="wa-field">
                    <span class="wa-label">Куда добавить блюда</span>
                    <ft-select [options]="venueOptions()" [(ngModel)]="pickedVenue" ariaLabel="Куда добавить блюда" />
                  </div>
                }
              </div>

              @if (error(); as text) {
                <p class="aii-note aii-note-error" role="alert">{{ text }}</p>
              }

              <div class="aii-actions">
                <button type="button" class="btn-amber" [disabled]="!file() || aiEnabled() === false" (click)="recognize()">
                  Распознать блюда
                </button>
                <button type="button" class="btn-outline" (click)="askClose()">Отмена</button>
              </div>
            </div>
          }

          @case ('busy') {
            <div class="aii-busy" role="status" aria-live="polite">
              @if (preview(); as src) { <img class="aii-busy-img" [src]="src" alt="" /> }
              <div class="aii-busy-text">
                <span class="aii-spinner" aria-hidden="true"></span>
                <strong>ИИ рассматривает фото</strong>
                <span>Обычно это занимает 10-40 секунд, большая страница меню дольше. Окно можно не закрывать.</span>
              </div>
              <div class="aii-skeleton" aria-hidden="true">
                <span></span><span></span><span></span>
              </div>
            </div>
          }

          @case ('review') {
            <div class="aii-review">
              <aside class="aii-source">
                @if (preview(); as src) { <img [src]="src" alt="Фото, по которому распознаны блюда" /> }
                <span class="wa-chip wa-chip-approved">{{ kindLabel() }}</span>
                @if (summary()) { <p class="aii-summary">{{ summary() }}</p> }
                <p class="aii-hint">
                  Строки с жёлтой меткой ИИ распознал неуверенно: проверьте их в первую очередь.
                  Пока вы не нажали «Добавить», ничего не сохранено.
                </p>
              </aside>

              <div class="aii-list">
                <div class="aii-list-head">
                  <label class="wa-check">
                    <input type="checkbox" [checked]="allIncluded()" (change)="toggleAll($any($event.target).checked)" />
                    Выбрано {{ selectedCount() }} из {{ rows.length }}
                  </label>
                  @if (target(); as t) {
                    <span class="wa-chip">в меню «{{ t.name }}»</span>
                  } @else {
                    <span class="wa-chip">только в каталог</span>
                  }
                </div>

                @for (row of rows; track row.key) {
                  <article class="aii-row" [class.off]="!row.include" [class.low]="row.draft.confidence === 'LOW'"
                           [class.mid]="row.draft.confidence === 'MEDIUM'">
                    <div class="aii-row-top">
                      <label class="aii-row-check">
                        <input type="checkbox" [(ngModel)]="row.include" [attr.aria-label]="'Добавить блюдо ' + row.draft.name" />
                      </label>
                      <input class="input aii-row-name" type="text" maxlength="200" [(ngModel)]="row.draft.name"
                             [disabled]="row.useExisting" aria-label="Название блюда" />
                      @if (target()) {
                        <label class="aii-row-price">
                          <span class="aii-row-price-label" aria-hidden="true">Цена, ₸</span>
                          <input class="input" type="number" min="0" step="50" inputmode="numeric" [(ngModel)]="row.price"
                                 placeholder="Цена" aria-label="Цена, тенге" [class.invalid]="row.include && !priceOk(row)" />
                        </label>
                      }
                      <button type="button" class="wa-iconbtn" [attr.aria-expanded]="row.open"
                              [attr.aria-label]="row.open ? 'Свернуть детали' : 'Показать детали'" (click)="row.open = !row.open">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                             aria-hidden="true" [style.transform]="row.open ? 'rotate(180deg)' : ''"><path d="m6 9 6 6 6-6"/></svg>
                      </button>
                    </div>

                    <div class="aii-row-meta">
                      @if (row.draft.confidence !== 'HIGH') {
                        <span class="wa-chip aii-chip-warn">{{ row.draft.confidence === 'LOW' ? 'ИИ не уверен' : 'Стоит проверить' }}</span>
                      }
                      <span class="wa-chip">{{ label(tasteOptions, row.draft.dominant_taste) }}</span>
                      <span class="wa-chip">{{ label(cookingOptions, row.draft.cooking_method) }}</span>
                      @if (row.draft.section) { <span class="wa-chip">{{ row.draft.section }}</span> }
                      @if (row.pairings.length) { <span class="wa-chip wa-chip-pending">{{ pairingsLabel(row) }}</span> }
                    </div>

                    @if (row.draft.duplicate_of; as dup) {
                      <div class="aii-dup">
                        <span>В каталоге уже есть «{{ dup.name }}».</span>
                        <label class="wa-check wa-check-sm">
                          <input type="radio" [name]="'dup-' + row.key" [value]="true" [(ngModel)]="row.useExisting" /> Взять его
                        </label>
                        <label class="wa-check wa-check-sm">
                          <input type="radio" [name]="'dup-' + row.key" [value]="false" [(ngModel)]="row.useExisting" /> Создать новое
                        </label>
                      </div>
                    }

                    @if (row.open) {
                      <div class="aii-row-details">
                        @if (!row.useExisting) {
                          <div class="wa-fields">
                            <label class="wa-field">
                              <span class="wa-label">Категория</span>
                              <input class="input" type="text" maxlength="100" [(ngModel)]="row.draft.category" />
                            </label>
                            <div class="wa-field">
                              <span class="wa-label">Кухня</span>
                              <ft-select [options]="cuisineOptions" [(ngModel)]="row.draft.cuisine" ariaLabel="Кухня" />
                            </div>
                            <div class="wa-field">
                              <span class="wa-label">Главный вкус</span>
                              <ft-select [options]="tasteOptions" [(ngModel)]="row.draft.dominant_taste" ariaLabel="Главный вкус" />
                            </div>
                            <div class="wa-field">
                              <span class="wa-label">Вес блюда</span>
                              <ft-select [options]="weightOptions" [(ngModel)]="row.draft.weight" ariaLabel="Вес блюда" />
                            </div>
                            <div class="wa-field">
                              <span class="wa-label">Жирность</span>
                              <ft-select [options]="fatOptions" [(ngModel)]="row.draft.fat_level" ariaLabel="Жирность" />
                            </div>
                            <div class="wa-field">
                              <span class="wa-label">Способ приготовления</span>
                              <ft-select [options]="cookingOptions" [(ngModel)]="row.draft.cooking_method" ariaLabel="Способ приготовления" />
                            </div>
                            <label class="wa-field wa-field-wide">
                              <span class="wa-label">Описание</span>
                              <textarea class="input" rows="2" maxlength="500" [(ngModel)]="row.draft.description"></textarea>
                            </label>
                          </div>
                        }
                        @if (target()) {
                          <div class="wa-fields">
                            <label class="wa-field">
                              <span class="wa-label">Раздел меню</span>
                              <input class="input" type="text" maxlength="80" [(ngModel)]="row.draft.section" placeholder="Основное" />
                            </label>
                            <label class="wa-field">
                              <span class="wa-label">Порция</span>
                              <input class="input" type="text" maxlength="60" [(ngModel)]="row.draft.portion" placeholder="350 г" />
                            </label>
                          </div>
                        }
                        @if (row.pairings.length) {
                          <div class="aii-pairs">
                            <span class="wa-label">Сорта от ИИ (сохранятся с пометкой «ИИ-подбор», сомелье сможет подтвердить)</span>
                            @if (row.useExisting && !canPairExisting()) {
                              <p class="wa-muted">К блюду из общего каталога сочетания добавляет сомелье: эти сорта не сохранятся.</p>
                            }
                            @for (pr of row.pairings; track pr.p.brand) {
                              <label class="aii-pair" [class.off]="!pr.on">
                                <input type="checkbox" [(ngModel)]="pr.on" [disabled]="row.useExisting && !canPairExisting()" />
                                <span class="aii-pair-body">
                                  <strong>{{ pr.p.brand_name }}</strong>
                                  <span class="aii-pair-meta">{{ pr.p.compatibility_score }}/5 · {{ pairingLabels[pr.p.pairing_type] }}</span>
                                  <span class="aii-pair-text">{{ pr.p.explanation }}</span>
                                </span>
                              </label>
                            }
                          </div>
                        }
                      </div>
                    }
                  </article>
                } @empty {
                  <p class="wa-empty">Блюд на фото не нашлось. Попробуйте другое фото: крупнее и при хорошем свете.</p>
                }

                @if (canUsePhoto()) {
                  <label class="wa-check aii-use-photo">
                    <input type="checkbox" [(ngModel)]="usePhoto" /> Поставить это фото на карточку блюда
                  </label>
                }

                @if (error(); as text) {
                  <p class="aii-note aii-note-error" role="alert">{{ text }}</p>
                }
              </div>
            </div>
          }

          @case ('saving') {
            <div class="aii-busy" role="status" aria-live="polite">
              <div class="aii-busy-text">
                <span class="aii-spinner" aria-hidden="true"></span>
                <strong>{{ savingText() }}</strong>
              </div>
            </div>
          }

          @case ('done') {
            <div class="aii-done">
              <span class="aii-done-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
              </span>
              <h3 class="aii-done-title">Готово</h3>
              @if (result(); as r) {
                <ul class="aii-done-list">
                  <li>{{ countOf(r.created, 'новое блюдо', 'новых блюда', 'новых блюд') }} в каталоге</li>
                  @if (r.reused) { <li>{{ countOf(r.reused, 'блюдо взято', 'блюда взяты', 'блюд взято') }} из каталога</li> }
                  @if (r.menu_items) { <li>{{ countOf(r.menu_items, 'позиция добавлена', 'позиции добавлены', 'позиций добавлено') }} в меню</li> }
                  @if (r.pairings || pairsSaved()) {
                    <li>{{ countOf(r.pairings + pairsSaved(), 'сочетание', 'сочетания', 'сочетаний') }} с пометкой «ИИ-подбор»</li>
                  }
                </ul>
                @for (w of r.warnings; track $index) {
                  <p class="aii-note" role="status">{{ w }}</p>
                }
              }
              @if (suggestNote(); as n) { <p class="aii-note" role="status">{{ n }}</p> }
              @if (error(); as text) { <p class="aii-note aii-note-error" role="alert">{{ text }}</p> }

              @if (unpaired().length && !pairsDone()) {
                <div class="aii-next">
                  <p>
                    У {{ countOf(unpaired().length, 'блюда', 'блюд', 'блюд') }} пока нет сорта. ИИ может подобрать их сейчас:
                    гость сразу увидит совет в меню, а сомелье позже подтвердит или поправит.
                  </p>
                  <button type="button" class="btn-amber" [disabled]="suggesting()" (click)="suggestForNew()">
                    {{ suggesting() ? 'Подбираем: ' + suggestProgress() : 'Подобрать сорта' }}
                  </button>
                </div>
              }
            </div>
          }
        }
      </div>

      @if (step() === 'review') {
        <footer class="aii-foot">
          <button type="button" class="btn-amber" [disabled]="!selectedCount() || !pricesOk()" (click)="save()">
            Добавить {{ countOf(selectedCount(), 'блюдо', 'блюда', 'блюд') }}
          </button>
          <button type="button" class="btn-outline" (click)="restart()">Другое фото</button>
          @if (selectedCount() && !pricesOk()) {
            <span class="aii-foot-hint">Укажите цену больше нуля у выбранных блюд</span>
          }
        </footer>
      }
      @if (step() === 'done') {
        <footer class="aii-foot">
          <button type="button" class="btn-amber" (click)="closed.emit()">Закрыть</button>
          <button type="button" class="btn-outline" [disabled]="suggesting()" (click)="restart()">Ещё одно фото</button>
        </footer>
      }
    </dialog>
  `
})
export class PanelDishImportComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private destroyRef = inject(DestroyRef);
  private injector = inject(Injector);

  /** Заведение задано снаружи (вкладка "Меню"): выбора нет, блюда идут в его меню. */
  venue = input<ImportVenue | null>(null);
  /** Заведения на выбор (вкладка "Блюда"): пусто значит только каталог. */
  venues = input<ImportVenue[]>([]);

  closed = output<void>();
  /** Блюда сохранены: родитель обновляет каталог и меню. */
  imported = output<DishImportResult>();
  /** Записаны новые сочетания: родитель перечитывает их список. */
  pairingsSaved = output<number>();

  readonly cuisineOptions: SelectOption[] = CUISINE_CHOICES;
  readonly tasteOptions: SelectOption[] = TASTE_CHOICES;
  readonly weightOptions: SelectOption[] = WEIGHT_CHOICES;
  readonly fatOptions: SelectOption[] = FAT_CHOICES;
  readonly cookingOptions: SelectOption[] = COOKING_CHOICES;
  readonly pairingLabels = PAIRING_LABELS;
  readonly countOf = countOf;

  step = signal<Step>('pick');
  aiEnabled = signal<boolean | null>(null);
  file = signal<File | null>(null);
  preview = signal<string | null>(null);
  dragOver = signal(false);
  error = signal<string | null>(null);
  hint = '';
  pickedVenue = CATALOG_ONLY;

  kind = signal<AiPhotoKind>('OTHER');
  summary = signal('');
  /** Обычный массив, а не сигнал: поля строк правит ngModel, шаблон читает их напрямую. */
  rows: DraftRow[] = [];
  usePhoto = true;

  result = signal<DishImportResult | null>(null);
  savingText = signal('Сохраняем блюда...');
  suggesting = signal(false);
  suggestProgress = signal('');
  suggestNote = signal<string | null>(null);
  pairsSaved = signal(0);
  pairsDone = signal(false);

  private readonly sheet = viewChild<ElementRef<HTMLDialogElement>>('sheet');
  private opener: HTMLElement | null = null;

  /** Сомелье и модератор могут записать пару и к блюду из общего каталога. */
  readonly canPairExisting = computed(() => {
    const role = this.auth.role();
    return role === 'moderator' || role === 'sommelier';
  });

  readonly venueOptions = computed<SelectOption[]>(() => [
    { value: CATALOG_ONLY, label: 'Только в каталог блюд' },
    ...this.venues().map(v => ({ value: v.slug, label: 'В меню: ' + v.name }))
  ]);

  readonly stepIndex = computed(() => {
    const s = this.step();
    return s === 'pick' || s === 'busy' ? 0 : s === 'done' ? 2 : 1;
  });

  /** Блюда из последнего сохранения, у которых ещё нет ни одного сорта. */
  readonly unpaired = computed<Dish[]>(() => (this.result()?.dishes ?? []).filter(d => !(d.pairings_count ?? 0)));

  ngOnInit() {
    this.opener = document.activeElement as HTMLElement | null;
    const own = this.venues();
    // У администратора одно заведение: по умолчанию блюда идут сразу в его меню.
    if (!this.venue() && own.length === 1 && this.auth.role() === 'restaurant_admin') this.pickedVenue = own[0].slug;
    this.api.getAiStatus().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: s => this.aiEnabled.set(!!s?.enabled),
      error: () => this.aiEnabled.set(null)
    });
    afterNextRender(() => {
      const dialog = this.sheet()?.nativeElement;
      if (dialog && !dialog.open) dialog.showModal();
    }, { injector: this.injector });
  }

  ngOnDestroy() {
    this.dropPreview();
    const dialog = this.sheet()?.nativeElement;
    if (dialog?.open) dialog.close();
    this.opener?.focus?.();
  }

  /** Escape: окно закрываем сами, чтобы спросить про несохранённый список. */
  onCancel(event: Event) {
    event.preventDefault();
    // Открытый выпадающий список закрывает Escape сам
    if (this.sheet()?.nativeElement.querySelector('.ft-select-menu')) return;
    this.askClose();
  }

  /** Нажатие мимо окна попадает в сам dialog (его подложку), а не во вложенные элементы. */
  onBackdrop(event: MouseEvent) {
    if (event.target === this.sheet()?.nativeElement) this.askClose();
  }

  /** Заведение, в меню которого встанут блюда, или null для каталога. */
  target(): ImportVenue | null {
    const fixed = this.venue();
    if (fixed) return fixed;
    return this.venues().find(v => v.slug === this.pickedVenue) ?? null;
  }

  targetLabel(): string {
    const t = this.target();
    return t ? 'Блюда попадут в каталог и в меню «' + t.name + '»' : 'Блюда попадут в каталог';
  }

  kindLabel(): string {
    return this.kind() === 'MENU' ? 'Страница меню' : 'Фото блюда';
  }

  label(options: SelectOption[], value: string): string {
    return options.find(o => o.value === value)?.label ?? value;
  }

  pairingsLabel(row: DraftRow): string {
    return countOf(row.pairings.filter(p => p.on).length, 'сорт', 'сорта', 'сортов') + ' от ИИ';
  }

  // Выбор фото

  onInput(event: Event) {
    const inputEl = event.target as HTMLInputElement;
    const f = inputEl.files?.[0];
    inputEl.value = '';
    if (f) this.take(f);
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.dragOver.set(true);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.dragOver.set(false);
    const f = event.dataTransfer?.files?.[0];
    if (f) this.take(f);
  }

  private async take(original: File) {
    this.error.set(null);
    const prepared = await downscalePhoto(original);
    const problem = photoProblem(prepared);
    if (problem) {
      this.error.set(problem);
      return;
    }
    this.dropPreview();
    this.file.set(prepared);
    this.preview.set(URL.createObjectURL(prepared));
  }

  private dropPreview() {
    const url = this.preview();
    if (url) URL.revokeObjectURL(url);
    this.preview.set(null);
  }

  // Распознавание

  recognize() {
    const f = this.file();
    if (!f || this.step() === 'busy') return;
    this.error.set(null);
    this.step.set('busy');
    this.api.recognizeDishes(f, this.hint).pipe(timeout(AI_VISION_TIMEOUT_MS), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: r => {
        this.kind.set(r.kind);
        this.summary.set(r.summary || '');
        this.rows = (r.dishes || []).map((d, i) => this.toRow(d, i));
        this.usePhoto = true;
        if (!this.rows.length) {
          this.error.set(r.summary || 'Блюд на фото не нашлось. Попробуйте другое фото: крупнее и при хорошем свете.');
          this.step.set('pick');
          return;
        }
        this.step.set('review');
      },
      error: (err: unknown) => {
        this.error.set(this.errorText(err));
        this.step.set('pick');
      }
    });
  }

  private toRow(d: AiDishDraft, key: number): DraftRow {
    return {
      key,
      include: true,
      // Неуверенные строки сразу раскрыты: их нужно проверить глазами
      open: d.confidence === 'LOW',
      draft: { ...d },
      useExisting: !!d.duplicate_of,
      price: d.price === null || d.price === undefined ? '' : String(d.price),
      pairings: (d.pairings || []).map(p => ({ on: true, p }))
    };
  }

  // Проверка списка

  selectedCount(): number {
    return this.rows.filter(r => r.include).length;
  }

  allIncluded(): boolean {
    return this.rows.length > 0 && this.rows.every(r => r.include);
  }

  toggleAll(on: boolean) {
    for (const r of this.rows) r.include = on;
  }

  /** Цена нужна только когда блюдо встаёт в меню: позиция без цены гостю не продаётся. */
  priceOk(row: DraftRow): boolean {
    if (!this.target()) return true;
    const n = Number(row.price);
    return row.price !== '' && Number.isFinite(n) && n > 0;
  }

  pricesOk(): boolean {
    return this.rows.filter(r => r.include).every(r => this.priceOk(r));
  }

  /** Фото блюда можно поставить на карточку, когда на нём одно новое блюдо. */
  canUsePhoto(): boolean {
    const picked = this.rows.filter(r => r.include);
    return this.kind() === 'DISH' && picked.length === 1 && !picked[0].useExisting;
  }

  // Сохранение

  save() {
    const picked = this.rows.filter(r => r.include);
    if (!picked.length || this.step() === 'saving') return;
    if (picked.some(r => !r.useExisting && !r.draft.name.trim())) {
      this.error.set('У каждого выбранного блюда должно быть название');
      return;
    }
    const target = this.target();
    const items: DishImportItem[] = picked.map(r => {
      const menu = target
        ? { price: Number(r.price).toFixed(2), section: (r.draft.section || '').trim(), portion: (r.draft.portion || '').trim() }
        : null;
      const mayPair = !r.useExisting || this.canPairExisting();
      const pairings = mayPair
        ? r.pairings.filter(p => p.on).map(p => ({
            brand: p.p.brand, compatibility_score: p.p.compatibility_score,
            pairing_type: p.p.pairing_type, explanation: p.p.explanation
          }))
        : [];
      if (r.useExisting && r.draft.duplicate_of) return { dish: r.draft.duplicate_of.id, menu, pairings };
      const d = r.draft;
      return {
        name: d.name.trim(), category: (d.category || '').trim(), cuisine: d.cuisine, dominant_taste: d.dominant_taste,
        weight: d.weight, fat_level: d.fat_level, cooking_method: d.cooking_method,
        description: (d.description || '').trim(), menu, pairings
      };
    });
    const photo = this.canUsePhoto() && this.usePhoto ? this.file() : null;

    this.error.set(null);
    this.savingText.set('Сохраняем блюда...');
    this.step.set('saving');
    this.api.importDishes({ venue: target?.slug ?? null, items }).subscribe({
      next: res => {
        this.result.set(res);
        this.pairsSaved.set(0);
        this.pairsDone.set(false);
        this.suggestNote.set(null);
        const dish = res.dishes[0];
        if (photo && dish && res.created === 1) this.attachPhoto(dish, photo, res);
        else this.finish(res);
      },
      error: (err: unknown) => {
        this.error.set('Ошибка: ' + this.errorText(err));
        this.step.set('review');
      }
    });
  }

  /** Фото ставим отдельным запросом: если он не прошёл, блюда всё равно сохранены. */
  private attachPhoto(dish: Dish, photo: File, res: DishImportResult) {
    this.savingText.set('Загружаем фото блюда...');
    this.api.uploadDishImage(dish.id, photo).subscribe({
      next: saved => {
        const merged = { ...res, dishes: res.dishes.map(d => d.id === saved.id ? { ...d, image: saved.image } : d) };
        this.result.set(merged);
        this.finish(merged);
      },
      error: (err: unknown) => {
        this.finish({ ...res, warnings: [...res.warnings, 'Фото на карточку не загрузилось: ' + this.errorText(err)] });
      }
    });
  }

  private finish(res: DishImportResult) {
    this.result.set(res);
    this.step.set('done');
    this.imported.emit(res);
    if (res.pairings) this.pairingsSaved.emit(res.pairings);
  }

  /** Сорта к новым блюдам без пары: по SUGGEST_CHUNK блюд за запрос, с сохранением. */
  suggestForNew() {
    const ids = this.unpaired().map(d => d.id);
    if (!ids.length || this.suggesting()) return;
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += SUGGEST_CHUNK) chunks.push(ids.slice(i, i + SUGGEST_CHUNK));
    let doneCount = 0;
    this.suggesting.set(true);
    this.error.set(null);
    this.suggestProgress.set(`0 из ${ids.length}`);
    from(chunks).pipe(
      concatMap(chunk => this.api.suggestPairings(chunk, true).pipe(timeout(AI_VISION_TIMEOUT_MS))),
      toArray(),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: replies => {
        const saved = replies.reduce((sum, r) => sum + (r.saved || 0), 0);
        doneCount = ids.length;
        this.suggestProgress.set(`${doneCount} из ${ids.length}`);
        this.suggesting.set(false);
        this.pairsDone.set(true);
        this.pairsSaved.set(saved);
        const note = replies.find(r => r.note)?.note;
        const skipped = replies.some(r => r.results.some(x => !x.can_save));
        this.suggestNote.set([
          note || null,
          skipped ? 'К части блюд сорта не записаны: блюдо есть в меню другого заведения, пару к нему добавит сомелье.' : null
        ].filter(Boolean).join(' ') || null);
        if (saved) this.pairingsSaved.emit(saved);
      },
      error: (err: unknown) => {
        this.suggesting.set(false);
        this.error.set('Ошибка: ' + this.errorText(err));
      }
    });
  }

  // Прочее

  restart() {
    this.error.set(null);
    this.rows = [];
    this.result.set(null);
    this.file.set(null);
    this.dropPreview();
    this.step.set('pick');
  }

  /** На шаге проверки спросим: несохранённый список при закрытии пропадёт. */
  askClose() {
    if (this.step() === 'saving' || this.suggesting()) return;
    if (this.step() === 'review' && this.rows.length && !this.closeArmed) {
      this.closeArmed = true;
      this.error.set('Список ещё не сохранён. Нажмите «Закрыть» ещё раз, чтобы выйти без сохранения.');
      setTimeout(() => { this.closeArmed = false; }, 4000);
      return;
    }
    this.closed.emit();
  }

  private closeArmed = false;

  private errorText(err: unknown): string {
    if (err instanceof TimeoutError) return 'ИИ не успел ответить. Попробуйте ещё раз или снимите меню по частям.';
    if (err instanceof HttpErrorResponse) {
      if (err.status === 413) return 'Фото слишком большое. Снимите его ещё раз или выберите файл поменьше.';
      if (err.status === 429 && !(err.error && err.error.code === 'ai_budget')) {
        return 'Слишком много запросов подряд. Подождите немного и повторите.';
      }
    }
    return AuthService.errorText(err);
  }
}

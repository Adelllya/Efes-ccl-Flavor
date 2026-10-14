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
          <h2 id="aii-title" class="aii-title">Dishes from a photo</h2>
          <p class="aii-sub">{{ targetLabel() }}</p>
        </div>
        <ol class="aii-steps" aria-label="Steps">
          <li [class.current]="stepIndex() === 0" [class.done]="stepIndex() > 0">Photo</li>
          <li [class.current]="stepIndex() === 1" [class.done]="stepIndex() > 1">Review</li>
          <li [class.current]="stepIndex() === 2">Done</li>
        </ol>
        <button type="button" class="wa-iconbtn" aria-label="Close" title="Close" (click)="askClose()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </header>

      <div class="aii-body">
        @switch (step()) {

          @case ('pick') {
            <div class="aii-pick">
              <p class="aii-lead">
                Take a photo of a plate or a menu page. The AI will recognize the dishes, fill in taste, weight and cooking method,
                and for a dish photo it will suggest varieties right away. You review the list and save what you need.
              </p>

              @if (aiEnabled() === false) {
                <p class="aii-note aii-note-warn" role="status">
                  AI is turned off on the server: ANTHROPIC_API_KEY is not set. Add it to backend/.env
                  (on Vercel, to the project's environment variables) and recognition will start working. Until then, add dishes manually.
                </p>
              }

              <div class="aii-drop" [class.over]="dragOver()" [class.has-file]="!!file()" tabindex="0" role="button" autofocus
                   aria-label="Choose a photo"
                   (click)="fileInput.click()" (keydown.enter)="fileInput.click()"
                   (keydown.space)="fileInput.click(); $event.preventDefault()"
                   (dragover)="onDragOver($event)" (dragleave)="dragOver.set(false)" (drop)="onDrop($event)">
                @if (preview(); as src) {
                  <img class="aii-drop-img" [src]="src" alt="Selected photo" />
                  <span class="aii-drop-change">Tap to choose a different photo</span>
                } @else {
                  <svg class="aii-drop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
                  <strong>Drag a photo here or tap to choose one</strong>
                  <span>On a phone you can shoot it with the camera. One menu page per photo, and the text must be legible</span>
                }
              </div>
              <input type="file" accept="image/*" hidden #fileInput (change)="onInput($event)" />

              <div class="aii-fields">
                <label class="wa-field">
                  <span class="wa-label">Hint for the AI (optional)</span>
                  <input class="input" type="text" maxlength="300" [(ngModel)]="hint"
                         placeholder="For example: appetizers page, prices in tenge" />
                </label>
                @if (!venue() && venueOptions().length > 1) {
                  <div class="wa-field">
                    <span class="wa-label">Where to add the dishes</span>
                    <ft-select [options]="venueOptions()" [(ngModel)]="pickedVenue" ariaLabel="Where to add the dishes" />
                  </div>
                }
              </div>

              @if (error(); as text) {
                <p class="aii-note aii-note-error" role="alert">{{ text }}</p>
              }

              <div class="aii-actions">
                <button type="button" class="btn-amber" [disabled]="!file() || aiEnabled() === false" (click)="recognize()">
                  Recognize dishes
                </button>
                <button type="button" class="btn-outline" (click)="askClose()">Cancel</button>
              </div>
            </div>
          }

          @case ('busy') {
            <div class="aii-busy" role="status" aria-live="polite">
              @if (preview(); as src) { <img class="aii-busy-img" [src]="src" alt="" /> }
              <div class="aii-busy-text">
                <span class="aii-spinner" aria-hidden="true"></span>
                <strong>The AI is looking at the photo</strong>
                <span>This usually takes 10-40 seconds, longer for a large menu page. You can keep this window open.</span>
              </div>
              <div class="aii-skeleton" aria-hidden="true">
                <span></span><span></span><span></span>
              </div>
            </div>
          }

          @case ('review') {
            <div class="aii-review">
              <aside class="aii-source">
                @if (preview(); as src) { <img [src]="src" alt="Photo the dishes were recognized from" /> }
                <span class="wa-chip wa-chip-approved">{{ kindLabel() }}</span>
                @if (summary()) { <p class="aii-summary">{{ summary() }}</p> }
                <p class="aii-hint">
                  The AI was unsure about rows with a yellow tag, so check those first.
                  Nothing is saved until you tap "Add".
                </p>
              </aside>

              <div class="aii-list">
                <div class="aii-list-head">
                  <label class="wa-check">
                    <input type="checkbox" [checked]="allIncluded()" (change)="toggleAll($any($event.target).checked)" />
                    {{ selectedCount() }} of {{ rows.length }} selected
                  </label>
                  @if (target(); as t) {
                    <span class="wa-chip">to the "{{ t.name }}" menu</span>
                  } @else {
                    <span class="wa-chip">catalog only</span>
                  }
                </div>

                @for (row of rows; track row.key) {
                  <article class="aii-row" [class.off]="!row.include" [class.low]="row.draft.confidence === 'LOW'"
                           [class.mid]="row.draft.confidence === 'MEDIUM'">
                    <div class="aii-row-top">
                      <label class="aii-row-check">
                        <input type="checkbox" [(ngModel)]="row.include" [attr.aria-label]="'Add dish ' + row.draft.name" />
                      </label>
                      <input class="input aii-row-name" type="text" maxlength="200" [(ngModel)]="row.draft.name"
                             [disabled]="row.useExisting" aria-label="Dish name" />
                      @if (target()) {
                        <label class="aii-row-price">
                          <span class="aii-row-price-label" aria-hidden="true">Price, ₸</span>
                          <input class="input" type="number" min="0" step="50" inputmode="numeric" [(ngModel)]="row.price"
                                 placeholder="Price" aria-label="Price, tenge" [class.invalid]="row.include && !priceOk(row)" />
                        </label>
                      }
                      <button type="button" class="wa-iconbtn" [attr.aria-expanded]="row.open"
                              [attr.aria-label]="row.open ? 'Hide details' : 'Show details'" (click)="row.open = !row.open">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                             aria-hidden="true" [style.transform]="row.open ? 'rotate(180deg)' : ''"><path d="m6 9 6 6 6-6"/></svg>
                      </button>
                    </div>

                    <div class="aii-row-meta">
                      @if (row.draft.confidence !== 'HIGH') {
                        <span class="wa-chip aii-chip-warn">{{ row.draft.confidence === 'LOW' ? 'AI is unsure' : 'Worth checking' }}</span>
                      }
                      <span class="wa-chip">{{ label(tasteOptions, row.draft.dominant_taste) }}</span>
                      <span class="wa-chip">{{ label(cookingOptions, row.draft.cooking_method) }}</span>
                      @if (row.draft.section) { <span class="wa-chip">{{ row.draft.section }}</span> }
                      @if (row.pairings.length) { <span class="wa-chip wa-chip-pending">{{ pairingsLabel(row) }}</span> }
                    </div>

                    @if (row.draft.duplicate_of; as dup) {
                      <div class="aii-dup">
                        <span>The catalog already has "{{ dup.name }}".</span>
                        <label class="wa-check wa-check-sm">
                          <input type="radio" [name]="'dup-' + row.key" [value]="true" [(ngModel)]="row.useExisting" /> Use it
                        </label>
                        <label class="wa-check wa-check-sm">
                          <input type="radio" [name]="'dup-' + row.key" [value]="false" [(ngModel)]="row.useExisting" /> Create a new one
                        </label>
                      </div>
                    }

                    @if (row.open) {
                      <div class="aii-row-details">
                        @if (!row.useExisting) {
                          <div class="wa-fields">
                            <label class="wa-field">
                              <span class="wa-label">Category</span>
                              <input class="input" type="text" maxlength="100" [(ngModel)]="row.draft.category" />
                            </label>
                            <div class="wa-field">
                              <span class="wa-label">Cuisine</span>
                              <ft-select [options]="cuisineOptions" [(ngModel)]="row.draft.cuisine" ariaLabel="Cuisine" />
                            </div>
                            <div class="wa-field">
                              <span class="wa-label">Dominant taste</span>
                              <ft-select [options]="tasteOptions" [(ngModel)]="row.draft.dominant_taste" ariaLabel="Dominant taste" />
                            </div>
                            <div class="wa-field">
                              <span class="wa-label">Dish weight</span>
                              <ft-select [options]="weightOptions" [(ngModel)]="row.draft.weight" ariaLabel="Dish weight" />
                            </div>
                            <div class="wa-field">
                              <span class="wa-label">Fat level</span>
                              <ft-select [options]="fatOptions" [(ngModel)]="row.draft.fat_level" ariaLabel="Fat level" />
                            </div>
                            <div class="wa-field">
                              <span class="wa-label">Cooking method</span>
                              <ft-select [options]="cookingOptions" [(ngModel)]="row.draft.cooking_method" ariaLabel="Cooking method" />
                            </div>
                            <label class="wa-field wa-field-wide">
                              <span class="wa-label">Description</span>
                              <textarea class="input" rows="2" maxlength="500" [(ngModel)]="row.draft.description"></textarea>
                            </label>
                          </div>
                        }
                        @if (target()) {
                          <div class="wa-fields">
                            <label class="wa-field">
                              <span class="wa-label">Menu section</span>
                              <input class="input" type="text" maxlength="80" [(ngModel)]="row.draft.section" placeholder="Mains" />
                            </label>
                            <label class="wa-field">
                              <span class="wa-label">Portion</span>
                              <input class="input" type="text" maxlength="60" [(ngModel)]="row.draft.portion" placeholder="350 g" />
                            </label>
                          </div>
                        }
                        @if (row.pairings.length) {
                          <div class="aii-pairs">
                            <span class="wa-label">AI-suggested varieties (saved with an "AI pick" tag; a sommelier can confirm them)</span>
                            @if (row.useExisting && !canPairExisting()) {
                              <p class="wa-muted">Pairings for a dish from the shared catalog are added by a sommelier, so these varieties will not be saved.</p>
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
                  <p class="wa-empty">No dishes found in the photo. Try another one: closer up and in good light.</p>
                }

                @if (canUsePhoto()) {
                  <label class="wa-check aii-use-photo">
                    <input type="checkbox" [(ngModel)]="usePhoto" /> Use this photo on the dish card
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
              <h3 class="aii-done-title">Done</h3>
              @if (result(); as r) {
                <ul class="aii-done-list">
                  <li>{{ countOf(r.created, 'new dish', 'new dishes', 'new dishes') }} in the catalog</li>
                  @if (r.reused) { <li>{{ countOf(r.reused, 'dish', 'dishes', 'dishes') }} reused from the catalog</li> }
                  @if (r.menu_items) { <li>{{ countOf(r.menu_items, 'item', 'items', 'items') }} added to the menu</li> }
                  @if (r.pairings || pairsSaved()) {
                    <li>{{ countOf(r.pairings + pairsSaved(), 'pairing', 'pairings', 'pairings') }} tagged "AI pick"</li>
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
                    {{ countOf(unpaired().length, 'dish has', 'dishes have', 'dishes have') }} no variety yet. The AI can suggest them now:
                    guests will see the recommendation in the menu right away, and a sommelier can confirm or adjust it later.
                  </p>
                  <button type="button" class="btn-amber" [disabled]="suggesting()" (click)="suggestForNew()">
                    {{ suggesting() ? 'Matching: ' + suggestProgress() : 'Suggest varieties' }}
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
            Add {{ countOf(selectedCount(), 'dish', 'dishes', 'dishes') }}
          </button>
          <button type="button" class="btn-outline" (click)="restart()">Another photo</button>
          @if (selectedCount() && !pricesOk()) {
            <span class="aii-foot-hint">Enter a price above zero for the selected dishes</span>
          }
        </footer>
      }
      @if (step() === 'done') {
        <footer class="aii-foot">
          <button type="button" class="btn-amber" (click)="closed.emit()">Close</button>
          <button type="button" class="btn-outline" [disabled]="suggesting()" (click)="restart()">One more photo</button>
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
  savingText = signal('Saving dishes...');
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
    { value: CATALOG_ONLY, label: 'Dish catalog only' },
    ...this.venues().map(v => ({ value: v.slug, label: 'To the menu: ' + v.name }))
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
    return t ? 'Dishes go to the catalog and the "' + t.name + '" menu' : 'Dishes go to the catalog';
  }

  kindLabel(): string {
    return this.kind() === 'MENU' ? 'Menu page' : 'Dish photo';
  }

  label(options: SelectOption[], value: string): string {
    return options.find(o => o.value === value)?.label ?? value;
  }

  pairingsLabel(row: DraftRow): string {
    return countOf(row.pairings.filter(p => p.on).length, 'variety', 'varieties', 'varieties') + ' from AI';
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
          this.error.set(r.summary || 'No dishes found in the photo. Try another one: closer up and in good light.');
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
      this.error.set('Every selected dish needs a name');
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
    this.savingText.set('Saving dishes...');
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
        this.error.set('Error: ' + this.errorText(err));
        this.step.set('review');
      }
    });
  }

  /** Фото ставим отдельным запросом: если он не прошёл, блюда всё равно сохранены. */
  private attachPhoto(dish: Dish, photo: File, res: DishImportResult) {
    this.savingText.set('Uploading the dish photo...');
    this.api.uploadDishImage(dish.id, photo).subscribe({
      next: saved => {
        const merged = { ...res, dishes: res.dishes.map(d => d.id === saved.id ? { ...d, image: saved.image } : d) };
        this.result.set(merged);
        this.finish(merged);
      },
      error: (err: unknown) => {
        this.finish({ ...res, warnings: [...res.warnings, 'The dish card photo failed to upload: ' + this.errorText(err)] });
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
    this.suggestProgress.set(`0 of ${ids.length}`);
    from(chunks).pipe(
      concatMap(chunk => this.api.suggestPairings(chunk, true).pipe(timeout(AI_VISION_TIMEOUT_MS))),
      toArray(),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: replies => {
        const saved = replies.reduce((sum, r) => sum + (r.saved || 0), 0);
        doneCount = ids.length;
        this.suggestProgress.set(`${doneCount} of ${ids.length}`);
        this.suggesting.set(false);
        this.pairsDone.set(true);
        this.pairsSaved.set(saved);
        const note = replies.find(r => r.note)?.note;
        const skipped = replies.some(r => r.results.some(x => !x.can_save));
        this.suggestNote.set([
          note || null,
          skipped ? 'Varieties were not saved for some dishes: they are on another venue\'s menu, so a sommelier will add the pairing.' : null
        ].filter(Boolean).join(' ') || null);
        if (saved) this.pairingsSaved.emit(saved);
      },
      error: (err: unknown) => {
        this.suggesting.set(false);
        this.error.set('Error: ' + this.errorText(err));
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
      this.error.set('The list is not saved yet. Tap "Close" again to exit without saving.');
      setTimeout(() => { this.closeArmed = false; }, 4000);
      return;
    }
    this.closed.emit();
  }

  private closeArmed = false;

  private errorText(err: unknown): string {
    if (err instanceof TimeoutError) return 'The AI took too long to respond. Try again, or shoot the menu in parts.';
    if (err instanceof HttpErrorResponse) {
      if (err.status === 413) return 'The photo is too large. Retake it or choose a smaller file.';
      if (err.status === 429 && !(err.error && err.error.code === 'ai_budget')) {
        return 'Too many requests in a row. Please wait a moment and try again.';
      }
    }
    return AuthService.errorText(err);
  }
}

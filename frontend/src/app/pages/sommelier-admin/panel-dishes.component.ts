import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { switchMap } from 'rxjs/operators';
import { of, timeout } from 'rxjs';
import { AI_VISION_TIMEOUT_MS, ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import {
  AiPairing, AiPairingResult, CookingMethod, CuisineType, Dish, DishImportResult, FatType, PAIRING_LABELS,
  TasteType, WeightType
} from '../../models/flavor-tree.models';
import { FtSelectComponent, SelectOption } from '../../ui/ft-select.component';
import { PanelIconComponent } from './panel-icons';
import { PanelPhotoComponent } from './panel-photo.component';
import { ImportVenue, PanelDishImportComponent } from './panel-dish-import.component';
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

/** Разбор блюда от ИИ: текст, сорта и то, чем он считался. */
interface DishAnalysis {
  dishId: string;
  result: AiPairingResult;
  mode: 'claude' | 'local';
  note: string;
}

/**
 * Вкладка "Блюда": список слева, форма и фото выбранного блюда справа, "+" создаёт новое.
 * "ИИ по фото" открывает распознавание блюд с фото, в карточке блюда есть ИИ-анализ с подбором сортов.
 */
@Component({
  selector: 'panel-dishes',
  standalone: true,
  imports: [FormsModule, PanelIconComponent, FtSelectComponent, PanelPhotoComponent, PanelDishImportComponent],
  template: `
    <div class="wa-page" [class.has-selection]="!!form()">
      <aside class="wa-list">
        <div class="wa-list-head">
          <h2 class="wa-list-title">Dishes @if (loaded()) { <span class="wa-count">{{ dishes().length }}</span> }</h2>
          <span class="wa-list-tools">
            <button type="button" class="wa-ai-btn" title="Add dishes from a photo with AI"
                    aria-label="Add dishes from a photo with AI" (click)="openImport()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
              <span>AI from photo</span>
            </button>
            <button type="button" class="wa-iconbtn" title="New dish" aria-label="New dish" (click)="openCreate()">
              <panel-icon name="plus" />
            </button>
          </span>
        </div>
        <label class="wa-search">
          <panel-icon name="search" />
          <input type="text" placeholder="Name or category" aria-label="Search dishes"
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
          <p class="wa-msg" [class.error]="isError(msg())" role="status">{{ msg() }}</p>
        }
        <div class="wa-rows">
          @if (!loaded()) {
            <p class="wa-empty">Loading...</p>
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
                  @if (d.menu_items_count) { <span class="wa-time">on menu: {{ d.menu_items_count }}</span> }
                </span>
              </button>
            } @empty {
              <p class="wa-empty">{{ dishes().length ? 'Nothing found' : 'No dishes yet' }}</p>
            }
          }
        </div>
      </aside>

      <section class="wa-detail">
        @for (f of formList(); track f.key) {
          <div class="wa-detail-enter">
            <button type="button" class="wa-back" (click)="close()"><panel-icon name="arrowLeft" /> Back to list</button>

            <div class="wa-card">
              <div class="wa-card-head">
                <span class="wa-avatar wa-avatar-lg">
                  @if (currentImage(); as img) { <img [src]="img" [alt]="f.name" /> } @else { {{ initial(f.name || 'N') }} }
                </span>
                <div class="wa-card-head-text">
                  <h3 class="wa-card-title">{{ f.id ? (f.name || 'Dish') : 'New dish' }}</h3>
                  <p class="wa-card-sub">{{ f.id ? subtitle(f) : 'Taste, weight and cooking method are used to pair a beer' }}</p>
                </div>
                @if (selectedDish(); as d) {
                  <div class="wa-chips">
                    <span class="wa-chip">on menu: {{ d.menu_items_count ?? 0 }}</span>
                    <span class="wa-chip">{{ plural(d.pairings_count ?? 0, 'pairing', 'pairings') }}</span>
                  </div>
                }
              </div>
              <div class="wa-fields">
                <label class="wa-field">
                  <span class="wa-label">Name</span>
                  <input class="input" type="text" [(ngModel)]="f.name" placeholder="Beshbarmak" />
                </label>
                <label class="wa-field">
                  <span class="wa-label">Category</span>
                  <input class="input" type="text" [(ngModel)]="f.category" placeholder="Meat dishes" />
                </label>
                <div class="wa-field">
                  <span class="wa-label">Cuisine</span>
                  <ft-select [options]="cuisineOptions" [(ngModel)]="f.cuisine" ariaLabel="Cuisine" />
                </div>
                <div class="wa-field">
                  <span class="wa-label">Dominant taste</span>
                  <ft-select [options]="tasteOptions" [(ngModel)]="f.dominant_taste" ariaLabel="Dominant taste" />
                </div>
                <div class="wa-field">
                  <span class="wa-label">Dish weight</span>
                  <ft-select [options]="weightOptions" [(ngModel)]="f.weight" ariaLabel="Dish weight" />
                </div>
                <div class="wa-field">
                  <span class="wa-label">Fat level</span>
                  <ft-select [options]="fatOptions" [(ngModel)]="f.fat_level" ariaLabel="Fat level" />
                </div>
                <div class="wa-field">
                  <span class="wa-label">Cooking method</span>
                  <ft-select [options]="cookingOptions" [(ngModel)]="f.cooking_method" ariaLabel="Cooking method" />
                </div>
                <label class="wa-field wa-field-wide">
                  <span class="wa-label">Description</span>
                  <textarea class="input" rows="3" [(ngModel)]="f.description"
                            placeholder="What's in the dish and how it's served: guests will see this on the menu"></textarea>
                </label>
              </div>
              @if (sharedHint(); as hint) {
                <p class="wa-info"><panel-icon name="alert" /> {{ hint }}</p>
              }
              @if (formError()) {
                <p class="wa-error" role="alert">{{ formError() }}</p>
              }
              <div class="wa-actions">
                <button type="button" class="btn-amber" [disabled]="saving()" (click)="save()">
                  <panel-icon name="save" /> {{ saving() ? 'Saving...' : (f.id ? 'Save' : 'Create dish') }}
                </button>
                @if (f.id) {
                  @if (canDelete()) {
                    <button type="button" class="btn-outline panel-danger" (click)="askDelete(f.id)">
                      <panel-icon name="trash" /> {{ pendingDelete() === f.id ? 'Delete for sure?' : 'Delete' }}
                    </button>
                  }
                } @else {
                  <button type="button" class="btn-outline" (click)="close()">Cancel</button>
                }
                @if (msg()) {
                  <p class="wa-msg" [class.error]="isError(msg())" role="status">{{ msg() }}</p>
                }
              </div>
            </div>

            @if (f.id) {
              <div class="wa-card">
                <div class="wa-card-head">
                  <div class="wa-card-head-text">
                    <h3 class="wa-card-title">AI analysis and beers</h3>
                    <p class="wa-card-sub">AI breaks down the dish's flavor and suggests beers from the catalog. You decide which ones to keep</p>
                  </div>
                  <button type="button" class="wa-ai-btn" [disabled]="analysisBusy()" (click)="analyze(f.id)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9L12 3Z"/></svg>
                    <span>{{ analysisBusy() ? 'Thinking...' : (analysisFor(f.id) ? 'Analyze again' : 'Analyze dish') }}</span>
                  </button>
                </div>
                @if (analysisError()) {
                  <p class="wa-error" role="alert">{{ analysisError() }}</p>
                }
                @if (analysisFor(f.id); as a) {
                  <div class="aia">
                    @if (a.result.analysis) { <p class="aia-text">{{ a.result.analysis }}</p> }
                    @if (a.note || a.result.by_rules) {
                      <p class="wa-muted">{{ a.note || 'Beers are matched using pairing rules: weight to weight, bitterness against fat, malt against heat.' }}</p>
                    }
                    @for (p of a.result.pairings; track p.brand) {
                      <div class="aia-pair">
                        <span class="aia-pair-title">
                          {{ p.brand_name }} <small>{{ p.brand_style }} · {{ pairingLabels[p.pairing_type] }}</small>
                        </span>
                        <span class="aia-score" role="img" [attr.aria-label]="'Score ' + p.compatibility_score + ' of 5'">
                          @for (n of pips; track n) { <span [class.on]="n <= p.compatibility_score"></span> }
                          <b>{{ p.compatibility_score }}/5</b>
                        </span>
                        <p class="aia-pair-text">{{ p.explanation }}</p>
                        @if (p.exists) { <span class="wa-chip wa-chip-approved">{{ p.saved ? 'Saved' : 'Already in pairings' }}</span> }
                      </div>
                    } @empty {
                      <p class="wa-muted">There are no beers in the catalog to pair with.</p>
                    }
                    @if (newPairings(a).length) {
                      <div class="wa-actions">
                        @if (a.result.can_save) {
                          <button type="button" class="btn-amber" [disabled]="analysisSaving()" (click)="saveAnalysis(a)">
                            <panel-icon name="save" /> {{ analysisSaving() ? 'Saving...' : saveAnalysisLabel(a) }}
                          </button>
                          <span class="wa-hint">{{ saveAnalysisHint() }}</span>
                        } @else {
                          <span class="wa-hint">This dish is on another venue's menu: pairings for it are added by the sommelier.</span>
                        }
                      </div>
                    }
                  </div>
                }
              </div>
            }

            <div class="wa-card">
              <div class="wa-card-head">
                <div class="wa-card-head-text">
                  <h3 class="wa-card-title">Photo</h3>
                  <p class="wa-card-sub">
                    @if (f.id) { Guests see it on the menu next to the beer recommendation }
                    @else { Choose a file now: it will upload as soon as the dish is created }
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
                title="Dish photo"
                (fileChosen)="uploadPhoto(f.id, $event)"
                (fileSelected)="pendingFile = $event"
                (removeRequested)="removePhoto(f.id)"
              />
              @if (f.image_url && !f.id) {
                <p class="wa-muted">The link will be saved with the dish.</p>
              }
            </div>
          </div>
        } @empty {
          <div class="wa-detail-empty">Select an item on the left</div>
        }
      </section>
    </div>

    @if (importOpen()) {
      <panel-dish-import [venues]="importVenues()" (closed)="importOpen.set(false)"
                         (imported)="onImported($event)" (pairingsSaved)="pairingsChanged.emit()" />
    }
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
  /** ИИ записал новые сочетания: родитель перечитывает их список. */
  pairingsChanged = output<void>();
  /** Импорт по фото добавил позиции в меню заведения: вкладке "Меню" пора их перечитать. */
  menuChanged = output<void>();

  readonly pairingLabels = PAIRING_LABELS;
  readonly pips = [1, 2, 3, 4, 5];
  readonly initial = initialOf;
  readonly cuisineOptions: SelectOption[] = CUISINE_CHOICES;
  readonly tasteOptions: SelectOption[] = TASTE_CHOICES;
  readonly weightOptions: SelectOption[] = WEIGHT_CHOICES;
  readonly fatOptions: SelectOption[] = FAT_CHOICES;
  readonly cookingOptions: SelectOption[] = COOKING_CHOICES;
  readonly pills: { value: DishFilter; label: string }[] = [
    { value: 'all', label: 'All' },
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

  // ИИ: блюда по фото и разбор блюда
  importOpen = signal(false);
  importVenues = signal<ImportVenue[]>([]);
  analysis = signal<DishAnalysis | null>(null);
  analysisBusy = signal(false);
  analysisSaving = signal(false);
  analysisError = signal<string | null>(null);

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
    return 'This dish is on venue menus. If it\'s on another venue\'s menu, only a moderator can edit it.';
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

  plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
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
      this.formError.set('Please enter a dish name');
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
    const key = f.key;
    // Файл, выбранный до создания, отправляем сразу после него
    const file = isNew ? this.pendingFile : null;
    const req = f.id ? this.api.updateDish(f.id, payload) : this.api.createDish(payload);
    req.subscribe({
      next: saved => {
        this.saving.set(false);
        this.publish(saved, isNew);
        // Пока шёл запрос, могли открыть другое блюдо: его форму не трогаем
        if (this.form()?.key === key) {
          this.openEdit(saved);
          flash(this.msg, isNew ? 'Dish added' : 'Dish updated');
        }
        if (file) this.uploadPhoto(saved.id, file);
      },
      error: err => {
        this.saving.set(false);
        if (this.form()?.key === key) this.formError.set('Error: ' + AuthService.errorText(err));
        else flash(this.msg, 'Error: ' + name + ': ' + AuthService.errorText(err), 6000);
      }
    });
  }

  askDelete(id: string) {
    confirmTwice(this.pendingDelete, id, () => {
      this.api.deleteDish(id).subscribe({
        next: () => {
          this.changed.emit(this.dishes().filter(x => x.id !== id));
          this.deleted.emit(id);
          // Закрываем форму только если в ней всё ещё удалённое блюдо
          if (this.form()?.id === id) this.close();
          flash(this.msg, 'Dish deleted');
        },
        error: err => {
          if (this.form()?.id === id) this.formError.set('Error: ' + AuthService.errorText(err));
        }
      });
    });
  }

  // ИИ: блюда по фото

  openImport() {
    const role = this.auth.role();
    const own = this.auth.user()?.venue;
    if (role === 'moderator') {
      // Модератор может поставить блюда в меню любого заведения; без списка остаётся каталог
      this.api.getVenues().subscribe({
        next: list => this.importVenues.set(list.map(v => ({ slug: v.slug, name: v.name }))),
        error: () => this.importVenues.set([])
      });
    } else {
      this.importVenues.set(own ? [{ slug: own.slug, name: own.name }] : []);
    }
    this.importOpen.set(true);
  }

  /** Новые и обновлённые блюда встают в начало списка; счётчики меню и пар берём из ответа. */
  onImported(res: DishImportResult) {
    const fresh = new Map(res.dishes.map(d => [d.id, d]));
    this.changed.emit([...res.dishes, ...this.dishes().filter(d => !fresh.has(d.id))]);
    if (res.menu_items) this.menuChanged.emit();
    flash(this.msg, 'Dishes added: ' + res.created + (res.menu_items ? ', on menu: ' + res.menu_items : ''));
  }

  // ИИ: разбор блюда и сорта к нему

  analysisFor(id: string | null): DishAnalysis | null {
    const a = this.analysis();
    return a && a.dishId === id ? a : null;
  }

  newPairings(a: DishAnalysis): AiPairing[] {
    return a.result.pairings.filter(p => !p.exists);
  }

  /** Сомелье и модератор принимают совет сами: у них пара сразу становится парой сомелье. */
  private acceptsAsSommelier(): boolean {
    const role = this.auth.role();
    return role === 'moderator' || role === 'sommelier';
  }

  saveAnalysisLabel(a: DishAnalysis): string {
    const n = this.newPairings(a).length;
    return (this.acceptsAsSommelier() ? 'Approve ' : 'Save ') + this.plural(n, 'beer', 'beers');
  }

  saveAnalysisHint(): string {
    return this.acceptsAsSommelier()
      ? 'They\'ll be saved as sommelier pairings, since you\'ve reviewed them'
      : 'They\'ll be saved with an "AI pairing" label, and a sommelier can confirm or adjust them';
  }

  analyze(id: string | null) {
    if (!id || this.analysisBusy()) return;
    this.analysisBusy.set(true);
    this.analysisError.set(null);
    this.api.suggestPairings([id]).pipe(timeout(AI_VISION_TIMEOUT_MS)).subscribe({
      next: res => {
        this.analysisBusy.set(false);
        const result = res.results[0];
        if (!result) {
          this.analysisError.set('Error: the AI didn\'t return an analysis. Please try again.');
          return;
        }
        this.analysis.set({ dishId: id, result, mode: res.mode, note: res.note });
      },
      error: err => {
        this.analysisBusy.set(false);
        this.analysisError.set('Error: ' + AuthService.errorText(err));
      }
    });
  }

  saveAnalysis(a: DishAnalysis) {
    const items = this.newPairings(a).map(p => ({
      dish: a.dishId, brand: p.brand, compatibility_score: p.compatibility_score,
      pairing_type: p.pairing_type, explanation: p.explanation
    }));
    if (!items.length || this.analysisSaving()) return;
    this.analysisSaving.set(true);
    this.analysisError.set(null);
    this.api.saveAiPairings(items).subscribe({
      next: res => {
        this.analysisSaving.set(false);
        const savedBrands = new Set(res.pairings.map(p => p.brand));
        this.analysis.update(cur => cur && cur.dishId === a.dishId ? {
          ...cur,
          result: {
            ...cur.result,
            pairings: cur.result.pairings.map(p => savedBrands.has(p.brand) ? { ...p, exists: true, saved: true } : p)
          }
        } : cur);
        if (res.saved) {
          // Счётчик сочетаний в карточке и список во вкладке "Сочетания"
          this.changed.emit(this.dishes().map(d => d.id === a.dishId
            ? { ...d, pairings_count: (d.pairings_count ?? 0) + res.saved } : d));
          this.pairingsChanged.emit();
          flash(this.msg, 'Pairings saved: ' + res.saved);
        } else {
          this.analysisError.set('Error: couldn\'t save. These pairings already exist or the dish doesn\'t belong to you');
        }
      },
      error: err => {
        this.analysisSaving.set(false);
        this.analysisError.set('Error: ' + AuthService.errorText(err));
      }
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
        flash(this.msg, 'Photo uploaded');
      },
      error: err => {
        this.photoError.set('Error: ' + AuthService.errorText(err));
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
        flash(this.msg, 'Photo deleted');
      },
      error: err => {
        this.photoError.set('Error: ' + AuthService.errorText(err));
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
    this.analysisError.set(null);
  }
}

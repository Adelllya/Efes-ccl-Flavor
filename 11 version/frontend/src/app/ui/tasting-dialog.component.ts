import {
  Component, DestroyRef, ElementRef, EventEmitter, Output, computed, inject, signal, viewChild
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '../services/api.service';
import { AuthService } from '../services/auth.service';
import { SelectionService } from '../services/selection.service';
import {
  NoteChip, PointsBalance, TastingReveal, TastingRevealNote, TastingSaved, TastingSheet
} from '../models/flavor-tree.models';

type Step = 'pick' | 'reveal';

/**
 * Отметка сорта в паспорте вкуса: гость выбирает ноты, которые услышал, ставит оценку
 * и сравнивает себя с пирамидой сомелье. Вошедшему отметка сохраняется и приносит баллы,
 * гость без входа видит сравнение, но в паспорт оно не попадает.
 */
@Component({
  selector: 'app-tasting-dialog',
  standalone: true,
  template: `
    <dialog #dlg class="td" aria-labelledby="td-title" (cancel)="onCancel($event)" (click)="onBackdrop($event)">
      @if (brandId()) {
        <div class="td-box">
          <header class="td-head">
            <div class="td-head-text">
              <span class="td-kicker">Паспорт вкуса</span>
              <h2 id="td-title" class="td-title">{{ sheet()?.brand?.name || brandName() || 'Отметка сорта' }}</h2>
            </div>
            <button type="button" class="btn-ghost td-close" (click)="close()" aria-label="Закрыть" autofocus>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </header>

          <div class="td-body">
            @if (loadError()) {
              <div class="td-note td-bad" role="alert">
                <p>Не удалось загрузить ноты сорта. Проверьте соединение.</p>
                <button type="button" class="btn-outline" (click)="load()">Повторить</button>
              </div>
            } @else if (!sheet()) {
              <div class="td-loading" aria-busy="true">
                <div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div>
              </div>
            } @else if (step() === 'pick') {
              <p class="td-lead">
                Сделайте внимательный глоток и отметьте, что услышали. Можно выбрать до {{ maxNotes() }} нот.
              </p>
              <div class="td-chips" role="group" aria-label="Ноты, которые вы услышали">
                @for (note of sheet()!.palette; track note.id) {
                  <button type="button" class="td-chip" [class.on]="picked().has(note.id)"
                          [attr.aria-pressed]="picked().has(note.id)"
                          [disabled]="!picked().has(note.id) && picked().size >= maxNotes()"
                          (click)="toggle(note)">
                    @if (note.image) { <img [src]="note.image" alt="" /> }
                    @else { <span class="td-chip-icon" aria-hidden="true">{{ note.icon }}</span> }
                    {{ note.name }}
                  </button>
                }
              </div>
              <p class="td-count" aria-live="polite">Выбрано {{ picked().size }} из {{ maxNotes() }}</p>

              <fieldset class="td-rating">
                <legend>Насколько понравилось</legend>
                <div class="td-stars" role="radiogroup" aria-label="Оценка от 1 до 5">
                  @for (n of stars; track n) {
                    <button type="button" class="td-star" role="radio" [class.on]="n <= rating()"
                            [attr.aria-checked]="rating() === n" [attr.aria-label]="n + ' из 5'" (click)="rating.set(n)">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 15 8.5l7 1-5 4.9 1.2 7L12 18l-6.2 3.4 1.2-7-5-4.9 7-1L12 2Z"/></svg>
                    </button>
                  }
                </div>
              </fieldset>

              <label class="td-comment">
                <span>Заметка для себя <i>необязательно</i></span>
                <textarea rows="2" maxlength="280" placeholder="Например: свежий, хорошо с шашлыком"
                          [value]="comment()" (input)="comment.set($any($event.target).value)"></textarea>
              </label>
              @if (saveError(); as err) { <p class="td-note td-bad" role="alert">{{ err }}</p> }
            } @else if (reveal()) {
              @let r = reveal()!;
              <div class="td-result" [class.good]="r.matched >= 2">
                <b class="td-result-num">{{ r.matched }} из {{ r.total }}</b>
                <div>
                  <h3 class="td-result-title">{{ resultTitle(r) }}</h3>
                  <p class="td-result-text">
                    @if (awarded() > 0) { В паспорт добавлено <b>+{{ awarded() }} баллов</b>. }
                    @else if (!auth.isLoggedIn()) { Войдите, чтобы отметка сохранилась в паспорте и принесла баллы. }
                    @else { Отметка обновлена. }
                  </p>
                </div>
              </div>
              <h3 class="td-h3">Пирамида сомелье</h3>
              <ul class="td-pyramid">
                @for (note of r.pyramid; track note.id) {
                  <li [class.heard]="note.heard">
                    <span class="td-layer">{{ layerLabel(note) }}</span>
                    <span class="td-pyr-name">{{ note.name }}</span>
                    <span class="td-pyr-state">
                      @if (note.heard) {
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                        услышали
                      } @else { сила {{ note.intensity }} из 10 }
                    </span>
                  </li>
                }
              </ul>
              @if (extra().length) {
                <p class="td-extra">
                  Ещё вы отметили: {{ extraNames() }}. Вкус у каждого свой: такие отметки показывают сомелье, что слышат гости.
                </p>
              }
            }
          </div>

          <footer class="td-foot">
            @if (sheet() && step() === 'pick') {
              <button type="button" class="btn-outline" (click)="close()">Отмена</button>
              <button type="button" class="btn-amber" [disabled]="!rating() || saving()" (click)="save()">
                {{ saving() ? 'Сохраняем...' : (auth.isLoggedIn() ? 'Сохранить и сравнить' : 'Сравнить с сомелье') }}
              </button>
            } @else if (step() === 'reveal') {
              <button type="button" class="btn-outline" (click)="step.set('pick')">Изменить</button>
              @if (!auth.isLoggedIn()) {
                <button type="button" class="btn-amber" (click)="login.emit(); close()">Войти</button>
              } @else {
                <button type="button" class="btn-amber" (click)="close()">Готово</button>
              }
            }
          </footer>
        </div>
      }
    </dialog>
  `,
  styles: [`
    .td {
      width: min(620px, calc(100vw - 32px));
      max-width: none;
      max-height: min(820px, calc(100dvh - 48px));
      margin: auto;
      padding: 0;
      border: none;
      border-radius: var(--radius-2xl);
      background: var(--bg-1);
      color: var(--foam);
      box-shadow: 0 30px 80px -20px rgba(28, 25, 23, 0.45);
      overflow: hidden;
    }
    .td[open] { display: flex; animation: tdIn 240ms var(--ease-out); }
    .td:focus { outline: none; }
    .td::backdrop { background: rgba(28, 25, 23, 0.55); backdrop-filter: blur(4px); }
    @keyframes tdIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
    .td-box { display: flex; flex-direction: column; width: 100%; min-height: 0; }
    .td-head { display: flex; align-items: flex-start; gap: var(--space-md); padding: var(--space-xl) var(--space-2xl) var(--space-lg); border-bottom: 1px solid var(--line); }
    .td-head-text { flex: 1; min-width: 0; }
    .td-kicker { display: block; margin-bottom: 4px; font-size: 0.75rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--beer-mid); }
    .td-title { margin: 0; font-family: var(--font-heading); font-size: clamp(1.2rem, 3.6vw, 1.5rem); font-weight: 800; line-height: 1.2; overflow-wrap: anywhere; }
    .td-close { flex-shrink: 0; width: 44px; height: 44px; display: grid; place-content: center; border-radius: 50%; }
    .td-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: var(--space-xl) var(--space-2xl); }
    .td-foot { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-md); padding: var(--space-lg) var(--space-2xl); padding-bottom: max(var(--space-lg), env(safe-area-inset-bottom)); border-top: 1px solid var(--line); background: var(--bg-0); }
    .td-foot:empty { display: none; }
    .td-foot .btn-amber, .td-foot .btn-outline { min-height: 44px; }
    .td-loading { display: grid; gap: var(--space-md); }
    .td-lead { margin: 0 0 var(--space-lg); line-height: 1.6; color: var(--foam-dim); }

    .td-chips { display: flex; flex-wrap: wrap; gap: var(--space-sm); }
    .td-chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 44px;
      padding: 0 14px;
      border: 1.5px solid var(--line);
      border-radius: var(--radius-full);
      background: var(--bg-0);
      color: var(--foam);
      font: inherit;
      font-size: 0.9375rem;
      cursor: pointer;
      transition: border-color var(--duration-fast) ease, background var(--duration-fast) ease;
    }
    .td-chip img { width: 22px; height: 22px; object-fit: contain; }
    .td-chip-icon { font-size: 1.05rem; line-height: 1; }
    .td-chip:hover:not(:disabled) { border-color: var(--beer-light); }
    .td-chip:focus-visible { outline: 3px solid var(--beer-light); outline-offset: 2px; }
    .td-chip.on { border-color: var(--beer-mid); background: #FFF1D6; font-weight: 700; color: var(--beer-deep); }
    .td-chip:disabled { opacity: 0.45; cursor: default; }
    .td-count { margin: var(--space-sm) 0 var(--space-xl); font-size: 0.8125rem; color: var(--muted); }

    .td-rating { margin: 0 0 var(--space-xl); padding: 0; border: none; }
    .td-rating legend, .td-comment span { display: block; margin-bottom: var(--space-sm); padding: 0; font-weight: 700; color: var(--foam); }
    .td-comment i { font-style: normal; font-weight: 500; font-size: 0.8125rem; color: var(--muted); }
    .td-stars { display: flex; gap: 4px; }
    .td-star { width: 48px; height: 48px; display: grid; place-content: center; border: none; border-radius: 12px; background: none; cursor: pointer; }
    .td-star svg { width: 32px; height: 32px; fill: none; stroke: rgba(180, 83, 9, 0.45); stroke-width: 1.8; stroke-linejoin: round; transition: fill var(--duration-fast) ease, transform var(--duration-fast) ease; }
    .td-star.on svg { fill: var(--beer-accent); stroke: var(--beer-mid); }
    .td-star:hover svg { transform: scale(1.1); }
    .td-star:focus-visible { outline: 3px solid var(--beer-light); outline-offset: 2px; }
    .td-comment { display: block; }
    .td-comment textarea {
      width: 100%;
      padding: 12px 14px;
      border: 1.5px solid var(--line);
      border-radius: var(--radius-md);
      background: var(--bg-0);
      color: var(--foam);
      font: inherit;
      line-height: 1.5;
      resize: vertical;
    }
    .td-comment textarea:focus-visible { outline: 3px solid var(--beer-light); outline-offset: 2px; }

    .td-note { display: grid; gap: var(--space-md); justify-items: start; margin: var(--space-lg) 0 0; padding: var(--space-lg); border-radius: var(--radius-lg); }
    .td-note p { margin: 0; }
    .td-bad { background: #FEF2F2; border: 1px solid rgba(220, 38, 38, 0.3); color: #7f1d1d; }

    .td-result { display: flex; align-items: center; gap: var(--space-lg); padding: var(--space-lg); border-radius: var(--radius-xl); background: #FFF7EA; border: 1px solid rgba(217, 119, 6, 0.3); }
    .td-result.good { background: #F0FDF4; border-color: rgba(22, 163, 74, 0.35); }
    .td-result-num { flex-shrink: 0; font-family: var(--font-heading); font-size: 1.6rem; white-space: nowrap; color: var(--beer-deep); }
    .td-result.good .td-result-num { color: #166534; }
    .td-result-title { margin: 0 0 4px; font-family: var(--font-heading); font-size: 1.1rem; }
    .td-result-text { margin: 0; line-height: 1.5; color: var(--foam-dim); }
    .td-h3 { margin: var(--space-xl) 0 var(--space-md); font-family: var(--font-heading); font-size: 1.05rem; font-weight: 800; }
    .td-pyramid { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-sm); }
    .td-pyramid li { display: flex; align-items: center; gap: var(--space-md); min-height: 48px; padding: 8px 14px; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--bg-0); }
    .td-pyramid li.heard { border-color: rgba(22, 163, 74, 0.4); background: #F7FEF9; }
    .td-layer { flex-shrink: 0; width: 64px; font-size: 0.75rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--beer-mid); }
    .td-pyr-name { flex: 1; min-width: 0; font-weight: 600; }
    .td-pyr-state { flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px; font-size: 0.8125rem; color: var(--muted); }
    .td-pyramid li.heard .td-pyr-state { color: #166534; font-weight: 700; }
    .td-extra { margin: var(--space-lg) 0 0; font-size: 0.875rem; line-height: 1.55; color: var(--muted); }

    @media (max-width: 600px) {
      .td { width: 100vw; max-height: 100dvh; height: 100dvh; border-radius: 0; }
      .td-head { padding: var(--space-lg) var(--space-lg) var(--space-md); }
      .td-body { padding: var(--space-lg); }
      .td-foot { padding: var(--space-md) var(--space-lg); padding-bottom: max(var(--space-md), env(safe-area-inset-bottom)); }
      .td-foot .btn-amber, .td-foot .btn-outline { flex: 1 1 140px; justify-content: center; }
      .td-layer { width: 54px; }
    }
    @media (prefers-reduced-motion: reduce) { .td[open] { animation: none; } }
  `],
})
export class TastingDialogComponent {
  private api = inject(ApiService);
  private destroyRef = inject(DestroyRef);
  private selection = inject(SelectionService);
  readonly auth = inject(AuthService);

  /** Отметка сохранена: родитель обновляет паспорт или страницу сорта. */
  @Output() saved = new EventEmitter<TastingSaved>();
  /** Гость без входа нажал «Войти». */
  @Output() login = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  private dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  readonly brandId = signal<string | null>(null);
  readonly brandName = signal('');
  readonly sheet = signal<TastingSheet | null>(null);
  readonly loadError = signal(false);
  readonly step = signal<Step>('pick');
  readonly picked = signal<Set<string>>(new Set());
  readonly rating = signal(0);
  readonly comment = signal('');
  readonly saving = signal(false);
  readonly saveError = signal('');
  readonly reveal = signal<TastingReveal | null>(null);
  readonly awarded = signal(0);
  readonly points = signal<PointsBalance | null>(null);

  readonly stars = [1, 2, 3, 4, 5];
  readonly maxNotes = computed(() => this.sheet()?.max_notes ?? 6);
  /** Отмеченные ноты, которых нет в пирамиде сомелье. */
  readonly extra = computed<NoteChip[]>(() => {
    const pyramid = new Set((this.reveal()?.pyramid ?? []).map(n => n.id));
    return (this.sheet()?.palette ?? []).filter(n => this.picked().has(n.id) && !pyramid.has(n.id));
  });
  readonly extraNames = computed(() => this.extra().map(n => n.name.toLowerCase()).join(', '));

  /** Открыть окно для сорта. Название показывается, пока грузится палитра. */
  open(brandId: string, brandName = '') {
    this.brandId.set(brandId);
    this.brandName.set(brandName);
    this.sheet.set(null);
    this.step.set('pick');
    this.picked.set(new Set());
    this.rating.set(0);
    this.comment.set('');
    this.reveal.set(null);
    this.awarded.set(0);
    this.saveError.set('');
    queueMicrotask(() => {
      const dialog = this.dlg()?.nativeElement;
      if (dialog && !dialog.open) dialog.showModal();
    });
    this.load();
  }

  load() {
    const id = this.brandId();
    if (!id) return;
    this.loadError.set(false);
    this.api.getTastingSheet(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: sheet => {
        if (this.brandId() !== id) return;
        this.sheet.set(sheet);
        // Отметка уже есть: показываем её, чтобы можно было поправить
        if (sheet.mine) {
          this.picked.set(new Set(sheet.mine.notes.map(n => n.id)));
          this.rating.set(sheet.mine.rating);
          this.comment.set(sheet.mine.comment);
        }
      },
      error: () => { if (this.brandId() === id) this.loadError.set(true); },
    });
  }

  toggle(note: NoteChip) {
    const next = new Set(this.picked());
    if (next.has(note.id)) next.delete(note.id);
    else if (next.size < this.maxNotes()) next.add(note.id);
    this.picked.set(next);
  }

  save() {
    const id = this.brandId();
    if (!id || !this.rating() || this.saving()) return;
    this.saveError.set('');
    if (!this.auth.isLoggedIn()) {
      this.revealForGuest(id);
      return;
    }
    this.saving.set(true);
    this.api.saveTasting(id, {
      rating: this.rating(),
      notes: [...this.picked()],
      comment: this.comment().trim(),
      venue: this.selection.venueSlug() ?? '',
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: res => {
        this.saving.set(false);
        this.reveal.set(res.reveal);
        this.awarded.set(res.awarded);
        this.points.set(res.points);
        this.step.set('reveal');
        this.saved.emit(res);
      },
      error: err => {
        this.saving.set(false);
        // Дневной лимит новых отметок приходит с готовым объяснением
        this.saveError.set(err?.error?.error || AuthService.errorText(err));
      },
    });
  }

  /** Без входа сравниваем на месте: пирамида сорта открыта всем. */
  private revealForGuest(id: string) {
    this.saving.set(true);
    this.api.getBrandDetail(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: brand => {
        this.saving.set(false);
        const picked = this.picked();
        const pyramid: TastingRevealNote[] = [];
        const layers = { TOP: brand.pyramid?.top ?? [], HEART: brand.pyramid?.heart ?? [], BASE: brand.pyramid?.base ?? [] };
        for (const layer of ['TOP', 'HEART', 'BASE'] as const) {
          for (const note of layers[layer]) {
            if (note.is_off_flavour || pyramid.some(p => p.id === note.id)) continue;
            pyramid.push({
              id: note.id, name: note.name, icon: note.icon, image: note.image ?? null, category: layer,
              layer, intensity: note.intensity, heard: picked.has(note.id),
            });
          }
        }
        this.reveal.set({ pyramid, matched: pyramid.filter(n => n.heard).length, total: pyramid.length });
        this.awarded.set(0);
        this.step.set('reveal');
      },
      error: err => {
        this.saving.set(false);
        this.saveError.set(AuthService.errorText(err));
      },
    });
  }

  resultTitle(r: TastingReveal): string {
    if (!r.total) return 'Пирамида этого сорта ещё не заполнена';
    if (r.matched === 0) return 'Пока мимо пирамиды сомелье';
    if (r.matched === r.total) return 'Вы услышали всю пирамиду';
    return r.matched >= 2 ? 'Отличный слух' : 'Одна нота совпала';
  }

  layerLabel(note: TastingRevealNote): string {
    return note.layer === 'TOP' ? 'Верх' : note.layer === 'HEART' ? 'Сердце' : 'База';
  }

  close() {
    const dialog = this.dlg()?.nativeElement;
    if (dialog?.open) dialog.close();
    this.brandId.set(null);
    this.closed.emit();
  }

  onCancel(event: Event) {
    event.preventDefault();
    this.close();
  }

  onBackdrop(event: MouseEvent) {
    if (event.target === this.dlg()?.nativeElement) this.close();
  }
}

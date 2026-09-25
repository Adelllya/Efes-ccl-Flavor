import { Component, EventEmitter, Input, Output, effect, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PanelIconComponent } from './panel-icons';
import { checkImageFile, confirmTwice } from './panel-shared';

export const DEFAULT_PHOTO_HINT =
  'PNG, JPG или WebP, до 5 МБ. Лучше квадратное фото 800×800, блюдо по центру на светлом фоне.';

/**
 * Блок фото для карточек блюда, заведения и сорта.
 *
 * Сам файл не отправляет: по кнопке "Загрузить" отдаёт File через fileChosen,
 * родитель вызывает API и передаёт сюда busy / error / новый currentUrl.
 * Когда родитель закончил без ошибки (busy стал false), выбранный файл сбрасывается.
 * Для новой сущности без id включите deferred: кнопки "Загрузить" нет,
 * родитель берёт файл из fileSelected и загружает после создания.
 */
@Component({
  selector: 'panel-photo',
  standalone: true,
  imports: [FormsModule, PanelIconComponent],
  template: `
    <div class="wa-photo" [class.wa-photo-wide]="shape === 'wide'">
      <div class="wa-photo-box">
        @if (preview(); as p) {
          <img [src]="p" alt="Новое фото" />
          <span class="wa-photo-tag">Новое фото</span>
        } @else if (currentUrl) {
          <img [src]="currentUrl" [alt]="title" />
        } @else {
          <div class="wa-photo-empty">
            <panel-icon name="image" size="lg" />
            <span>Фото не загружено</span>
          </div>
        }
      </div>

      <div class="wa-photo-side">
        <div
          class="wa-dropzone"
          [class.over]="dragOver()"
          [class.disabled]="busy"
          tabindex="0"
          role="button"
          (click)="pick(fileInput)"
          (keydown.enter)="pick(fileInput)"
          (keydown.space)="pick(fileInput); $event.preventDefault()"
          (dragover)="onDragOver($event)"
          (dragleave)="dragOver.set(false)"
          (drop)="onDrop($event)"
        >
          <panel-icon name="upload" />
          <span>Перетащите фото или нажмите, чтобы выбрать</span>
        </div>
        <input type="file" accept="image/png,image/jpeg,image/webp" #fileInput hidden (change)="onInput($event)" />
        <p class="wa-photo-hint">{{ hint }}</p>

        @if (file(); as f) {
          <p class="wa-photo-file">{{ f.name }} <span class="text-muted">({{ sizeText(f) }})</span></p>
        }
        @if (localError() || error) {
          <p class="wa-error">{{ localError() || error }}</p>
        }

        <div class="wa-actions">
          @if (file() && !deferred) {
            <button type="button" class="btn-amber" [disabled]="busy" (click)="upload()">
              <panel-icon name="upload" /> {{ busy ? 'Загрузка...' : 'Загрузить' }}
            </button>
          }
          @if (file()) {
            <button type="button" class="btn-outline" [disabled]="busy" (click)="reset()">Отмена</button>
          }
          @if (currentUrl && removable && !file()) {
            <button type="button" class="btn-outline panel-danger" [disabled]="busy" (click)="askRemove()">
              <panel-icon name="trash" /> {{ pendingRemove() === 'photo' ? 'Точно удалить?' : 'Удалить фото' }}
            </button>
          }
        </div>

        @if (showUrl) {
          <button type="button" class="wa-link-btn" (click)="urlOpen.set(!urlOpen())">
            <panel-icon [name]="urlOpen() ? 'chevron' : 'chevronRight'" /> или укажите ссылку
          </button>
          @if (urlOpen()) {
            <input class="input" type="url" placeholder="https://..." [ngModel]="url" (ngModelChange)="urlChange.emit($event)" />
          }
        }
      </div>
    </div>
  `
})
export class PanelPhotoComponent {
  /** Текущее фото на сервере (абсолютный URL) или пусто. */
  @Input() currentUrl: string | null | undefined = null;
  /** Родитель отправляет файл: кнопки заблокированы. */
  @Input() set busy(v: boolean) { this.busySignal.set(!!v); }
  get busy(): boolean { return this.busySignal(); }
  /** Ошибка от сервера; показывается под зоной загрузки. */
  @Input() error: string | null | undefined = null;
  @Input() removable = true;
  /** Без кнопки "Загрузить": файл заберёт родитель через fileSelected после создания записи. */
  @Input() deferred = false;
  @Input() hint = DEFAULT_PHOTO_HINT;
  @Input() title = 'Фото';
  /** square: 1:1 превью, wide: широкий баннер (обложка). */
  @Input() shape: 'square' | 'wide' = 'square';
  /** Свёрнутое поле "или укажите ссылку"; значение живёт у родителя. */
  @Input() showUrl = false;
  @Input() url = '';
  @Output() urlChange = new EventEmitter<string>();

  /** Нажали "Загрузить": родитель вызывает API. */
  @Output() fileChosen = new EventEmitter<File>();
  /** Файл выбран или сброшен (null): нужно родителю в режиме deferred. */
  @Output() fileSelected = new EventEmitter<File | null>();
  /** Нажали "Удалить фото" (второй клик подтверждения). */
  @Output() removeRequested = new EventEmitter<void>();

  readonly busySignal = signal(false);
  readonly file = signal<File | null>(null);
  readonly preview = signal<string | null>(null);
  readonly localError = signal<string | null>(null);
  readonly dragOver = signal(false);
  readonly urlOpen = signal(false);
  readonly pendingRemove = signal<string | null>(null);

  constructor() {
    // Загрузка закончилась без ошибки: превью больше не нужно
    let wasBusy = false;
    effect(() => {
      const busy = this.busySignal();
      if (wasBusy && !busy && !this.error) untracked(() => this.reset());
      wasBusy = busy;
    }, { allowSignalWrites: true });
  }

  /** Пока идёт загрузка, новый файл не выбираем: иначе его молча сбросит окончание текущей. */
  pick(input: HTMLInputElement): void {
    if (!this.busy) input.click();
  }

  onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (this.busy) return;
    if (f) this.take(f);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (!this.busy) this.dragOver.set(true);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    if (this.busy) return;
    const f = event.dataTransfer?.files?.[0];
    if (f) this.take(f);
  }

  upload(): void {
    const f = this.file();
    if (f && !this.busy) this.fileChosen.emit(f);
  }

  askRemove(): void {
    confirmTwice(this.pendingRemove, 'photo', () => this.removeRequested.emit());
  }

  /** Сбрасывает выбранный файл и превью. Родитель может вызвать через viewChild. */
  reset(): void {
    if (this.file()) this.fileSelected.emit(null);
    this.file.set(null);
    this.preview.set(null);
    this.localError.set(null);
  }

  sizeText(f: File): string {
    return f.size >= 1024 * 1024 ? (f.size / 1024 / 1024).toFixed(1) + ' МБ' : Math.round(f.size / 1024) + ' КБ';
  }

  private take(f: File): void {
    const problem = checkImageFile(f);
    if (problem) {
      this.localError.set(problem);
      this.file.set(null);
      this.preview.set(null);
      this.fileSelected.emit(null);
      return;
    }
    this.localError.set(null);
    this.file.set(f);
    const reader = new FileReader();
    reader.onload = () => this.preview.set(reader.result as string);
    reader.readAsDataURL(f);
    this.fileSelected.emit(f);
  }
}

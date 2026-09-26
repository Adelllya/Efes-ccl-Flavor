import {
  Component, ElementRef, EventEmitter, HostListener, Input, Output, computed, forwardRef, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NG_VALUE_ACCESSOR, ControlValueAccessor } from '@angular/forms';

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * Свой выпадающий список вместо системного <select>.
 * Работает с ngModel: <ft-select [options]="..." [(ngModel)]="value" />
 */
@Component({
  selector: 'ft-select',
  standalone: true,
  imports: [CommonModule, FormsModule],
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => FtSelectComponent), multi: true }],
  template: `
    <button
      type="button"
      class="ft-select-trigger"
      [class.open]="open()"
      [class.placeholder]="!current()"
      [disabled]="disabled()"
      [attr.aria-expanded]="open()"
      aria-haspopup="listbox"
      (click)="toggle()"
      (keydown)="onTriggerKey($event)"
    >
      <span class="ft-select-value">{{ current()?.label || placeholder }}</span>
      <svg class="ft-select-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m6 9 6 6 6-6"/>
      </svg>
    </button>

    @if (open()) {
      <div class="ft-select-menu" role="listbox">
        @if (searchable) {
          <input
            class="ft-select-search"
            type="text"
            [placeholder]="searchPlaceholder"
            [ngModel]="query()"
            (ngModelChange)="query.set($event); active.set(0)"
            (keydown)="onListKey($event)"
            #search
          />
        }
        <div class="ft-select-list">
          @for (o of filtered(); track o.value; let i = $index) {
            <button
              type="button"
              class="ft-select-option"
              role="option"
              [class.selected]="o.value === value()"
              [class.active]="i === active()"
              [attr.aria-selected]="o.value === value()"
              (mouseenter)="active.set(i)"
              (click)="choose(o)"
            >
              <span class="ft-select-option-label">{{ o.label }}</span>
              @if (o.hint) { <span class="ft-select-option-hint">{{ o.hint }}</span> }
              @if (o.value === value()) {
                <svg class="ft-select-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
              }
            </button>
          } @empty {
            <div class="ft-select-empty">{{ query().trim() && opts().length ? noMatchText : emptyText }}</div>
          }
        </div>
      </div>
    }
  `,
})
export class FtSelectComponent implements ControlValueAccessor {
  @Input({ required: true }) set options(v: SelectOption[] | null | undefined) { this.opts.set(v || []); }
  @Input() placeholder = 'Выберите';
  @Input() searchable = false;
  @Input() searchPlaceholder = 'Поиск...';
  /** Текст, когда вариантов нет вообще. */
  @Input() emptyText = 'Ничего не найдено';
  /** Текст, когда варианты есть, но под введённый запрос ничего не подошло. */
  @Input() noMatchText = 'Ничего не найдено';
  @Output() changed = new EventEmitter<string>();

  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly opts = signal<SelectOption[]>([]);
  readonly value = signal<string>('');
  readonly open = signal(false);
  readonly disabled = signal(false);
  readonly query = signal('');
  readonly active = signal(0);

  readonly current = computed(() => this.opts().find(o => o.value === this.value()) || null);
  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.opts();
    return this.opts().filter(o => (o.label + ' ' + (o.hint || '')).toLowerCase().includes(q));
  });

  private onChange: (v: string) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(v: string | null | undefined): void { this.value.set(v == null ? '' : String(v)); }
  registerOnChange(fn: (v: string) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(d: boolean): void { this.disabled.set(d); }

  toggle(): void {
    if (this.disabled()) return;
    if (this.open()) { this.close(); return; }
    this.query.set('');
    const idx = this.opts().findIndex(o => o.value === this.value());
    this.active.set(idx >= 0 ? idx : 0);
    this.open.set(true);
    setTimeout(() => {
      const el = this.host.nativeElement.querySelector<HTMLElement>('.ft-select-search') ||
        this.host.nativeElement.querySelector<HTMLElement>('.ft-select-option.active');
      el?.focus();
      this.host.nativeElement.querySelector<HTMLElement>('.ft-select-option.active')?.scrollIntoView({ block: 'nearest' });
    });
  }

  close(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.onTouched();
  }

  choose(o: SelectOption): void {
    if (o.value !== this.value()) {
      this.value.set(o.value);
      this.onChange(o.value);
      this.changed.emit(o.value);
    }
    this.close();
    this.host.nativeElement.querySelector<HTMLElement>('.ft-select-trigger')?.focus();
  }

  onTriggerKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!this.open()) this.toggle();
      else this.onListKey(e);
    } else if (e.key === 'Escape') {
      this.close();
    }
  }

  onListKey(e: KeyboardEvent): void {
    const list = this.filtered();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.active.set(Math.min(list.length - 1, this.active() + 1));
      this.scrollActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.active.set(Math.max(0, this.active() - 1));
      this.scrollActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = list[this.active()];
      if (o) this.choose(o);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      this.close();
    }
  }

  private scrollActive(): void {
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('.ft-select-option.active')?.scrollIntoView({ block: 'nearest' }));
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(e: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.close();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void { this.close(); }
}

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { API_BASE } from '../../services/api.service';
import { PanelIconComponent } from './panel-icons';
import { flash, isErrorText } from './panel-shared';

interface Knob {
  path: string;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  base: number;
  value: number;
}
interface EfesPromote {
  /** Путь крутилки окна приоритета (recommend.partner_tie_window). */
  path: string;
  /** Окно, которое включает кнопка. */
  window: number;
  base: number;
  active: boolean;
}
interface TuningState {
  version: number;
  updated_by: string;
  updated_at: string | null;
  has_overrides: boolean;
  knobs: Knob[];
  efes_promote: EfesPromote;
}

/**
 * Вкладка "Движок подбора" (сомелье и модератор): подкрутка весов формул подбора.
 * Значения хранятся в БД и накладываются поверх базовых, базовый JSON не меняется.
 * Кнопка сброса возвращает к базовым значениям.
 */
@Component({
  selector: 'panel-engine',
  standalone: true,
  imports: [FormsModule, PanelIconComponent],
  template: `
    <div class="wa-page wa-page-single">
      <div class="wa-card wa-narrow">
        <div class="wa-card-head">
          <div class="wa-card-head-text">
            <h3 class="wa-card-title">Движок подбора</h3>
            <p class="wa-card-sub">Подкрутка весов формул. Меняет подбор для всех гостей сразу.</p>
          </div>
          @if (state(); as s) {
            <span class="badge" [class.v2-efes]="s.has_overrides">
              {{ s.has_overrides ? 'Свои настройки' : 'Базовые' }} · v{{ s.version }}
            </span>
          }
        </div>

        @if (loading()) {
          <p class="wa-muted">Загрузка...</p>
        } @else {
          @if (state(); as s) {
            @if (s.updated_by) {
              <p class="wa-muted text-sm">Последнее изменение: {{ s.updated_by }}</p>
            }
            <div class="wa-efes" [class.wa-efes-on]="s.efes_promote.active">
              <div class="wa-efes-text">
                <strong>Рекомендовать Efes</strong>
                <span class="wa-muted text-xs">
                  @if (s.efes_promote.active) {
                    Включено: напиток портфеля Efes встаёт первым, если уступает лучшему не больше чем на
                    {{ efesWindow(s) }} баллов. Баллы при этом не меняются.
                  } @else {
                    Напитки портфеля Efes будут идти первыми, если уступают лучшему не больше чем на
                    {{ s.efes_promote.window }} баллов. Сейчас окно {{ efesWindow(s) }}.
                  }
                </span>
              </div>
              <button type="button" [class]="s.efes_promote.active ? 'btn-amber' : 'btn-outline'"
                      [disabled]="saving()" (click)="toggleEfes()">
                <panel-icon [name]="s.efes_promote.active ? 'check' : 'refresh'" />
                {{ s.efes_promote.active ? 'Включено' : 'Включить' }}
              </button>
            </div>

            <div class="wa-fields">
              @for (k of s.knobs; track k.path) {
                <label class="wa-field wa-field-wide">
                  <span class="wa-label">
                    {{ k.label }}: <strong>{{ k.value }}</strong>
                    @if (k.value !== k.base) { <span class="badge v2-efes">база {{ k.base }}</span> }
                  </span>
                  <input class="wa-range" type="range"
                         [min]="k.min" [max]="k.max" [step]="k.step" [(ngModel)]="k.value" [name]="k.path" />
                  <span class="wa-muted text-xs">{{ k.hint }}</span>
                </label>
              }
            </div>

            @if (message()) {
              <p class="text-sm" [class.text-danger]="isError()" style="margin-top: 12px;">{{ message() }}</p>
            }

            <div class="flex flex-wrap gap-md" style="margin-top: 16px;">
              <button type="button" class="btn-amber" [disabled]="saving()" (click)="save()">
                <panel-icon name="check" /> {{ saving() ? 'Сохраняю...' : 'Сохранить' }}
              </button>
              <button type="button" class="btn-outline" [disabled]="saving()" (click)="reset()">
                <panel-icon name="refresh" /> Сбросить к базовым
              </button>
            </div>
          } @else {
            <p class="text-danger">Не удалось загрузить настройки движка.</p>
          }
        }
      </div>
    </div>
  `,
  styles: [`
    .wa-efes { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
      padding: 14px 16px; margin-bottom: 18px; border-radius: var(--radius-md, 12px);
      border: 1px solid color-mix(in srgb, var(--amber, #c2410c) 30%, transparent);
      background: color-mix(in srgb, var(--amber, #c2410c) 6%, transparent); }
    .wa-efes-on { border-color: color-mix(in srgb, var(--amber, #c2410c) 60%, transparent);
      background: color-mix(in srgb, var(--amber, #c2410c) 12%, transparent); }
    .wa-efes-text { display: flex; flex-direction: column; gap: 4px; flex: 1 1 240px; }
    .wa-efes button { flex: 0 0 auto; }
  `],
})
export class PanelEngineComponent implements OnInit {
  private http = inject(HttpClient);
  readonly state = signal<TuningState | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly message = signal<string | null>(null);
  readonly isError = computed(() => isErrorText(this.message()));

  ngOnInit() {
    this.load();
  }

  private load() {
    this.loading.set(true);
    this.http.get<TuningState>(`${API_BASE}/v2/tuning/`).subscribe({
      next: s => { this.state.set(s); this.loading.set(false); },
      error: () => { this.state.set(null); this.loading.set(false); },
    });
  }

  private overrides(): Record<string, number> {
    const s = this.state();
    const out: Record<string, number> = {};
    if (!s) return out;
    for (const k of s.knobs) {
      if (k.value !== k.base) out[k.path] = k.value;
    }
    return out;
  }

  /** Текущее окно приоритета Efes: значение крутилки, если она есть в списке, иначе базовое. */
  efesWindow(s: TuningState): number {
    return s.knobs.find(k => k.path === s.efes_promote.path)?.value ?? s.efes_promote.base;
  }

  /** Кнопка «Рекомендовать Efes»: включает окно приоритета портфеля или возвращает базовое, и сразу сохраняет. */
  toggleEfes() {
    const s = this.state();
    if (!s) return;
    const knob = s.knobs.find(k => k.path === s.efes_promote.path);
    if (!knob) return;
    knob.value = s.efes_promote.active ? knob.base : s.efes_promote.window;
    this.save(s.efes_promote.active ? 'Приоритет Efes выключен. Подбор обновлён.' : 'Efes в приоритете. Подбор обновлён.');
  }

  save(done = 'Сохранено. Подбор обновлён.') {
    this.saving.set(true);
    this.http.post<TuningState>(`${API_BASE}/v2/tuning/save/`, { overrides: this.overrides() }).subscribe({
      next: s => { this.state.set(s); this.saving.set(false); flash(this.message, done); },
      error: () => { this.saving.set(false); flash(this.message, 'Ошибка: не удалось сохранить настройки.'); },
    });
  }

  reset() {
    this.saving.set(true);
    this.http.post<TuningState>(`${API_BASE}/v2/tuning/reset/`, {}).subscribe({
      next: s => { this.state.set(s); this.saving.set(false); flash(this.message, 'Сброшено к базовым значениям.'); },
      error: () => { this.saving.set(false); flash(this.message, 'Ошибка: не удалось сбросить настройки.'); },
    });
  }
}

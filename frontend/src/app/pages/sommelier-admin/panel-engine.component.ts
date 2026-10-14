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
interface TuningState {
  version: number;
  updated_by: string;
  updated_at: string | null;
  has_overrides: boolean;
  knobs: Knob[];
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
            <h3 class="wa-card-title">Pairing engine</h3>
            <p class="wa-card-sub">Fine-tune the formula weights. Changes apply to pairings for every guest at once.</p>
          </div>
          @if (state(); as s) {
            <span class="badge" [class.v2-efes]="s.has_overrides">
              {{ s.has_overrides ? 'Custom settings' : 'Default' }} · v{{ s.version }}
            </span>
          }
        </div>

        @if (loading()) {
          <p class="wa-muted">Loading...</p>
        } @else {
          @if (state(); as s) {
            @if (s.updated_by) {
              <p class="wa-muted text-sm">Last changed by: {{ s.updated_by }}</p>
            }
            <div class="wa-fields">
              @for (k of s.knobs; track k.path) {
                <label class="wa-field wa-field-wide">
                  <span class="wa-label">
                    {{ k.label }}: <strong>{{ k.value }}</strong>
                    @if (k.value !== k.base) { <span class="badge v2-efes">default {{ k.base }}</span> }
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

            <div class="flex gap-md" style="margin-top: 16px;">
              <button type="button" class="btn-amber" [disabled]="saving()" (click)="save()">
                <panel-icon name="check" /> {{ saving() ? 'Saving...' : 'Save' }}
              </button>
              <button type="button" class="btn-outline" [disabled]="saving()" (click)="reset()">
                <panel-icon name="refresh" /> Reset to defaults
              </button>
            </div>
          } @else {
            <p class="text-danger">Couldn't load the engine settings.</p>
          }
        }
      </div>
    </div>
  `,
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

  save() {
    this.saving.set(true);
    this.http.post<TuningState>(`${API_BASE}/v2/tuning/save/`, { overrides: this.overrides() }).subscribe({
      next: s => { this.state.set(s); this.saving.set(false); flash(this.message, 'Saved. Pairings updated.'); },
      error: () => { this.saving.set(false); flash(this.message, 'Error: couldn’t save the settings.'); },
    });
  }

  reset() {
    this.saving.set(true);
    this.http.post<TuningState>(`${API_BASE}/v2/tuning/reset/`, {}).subscribe({
      next: s => { this.state.set(s); this.saving.set(false); flash(this.message, 'Reset to default values.'); },
      error: () => { this.saving.set(false); flash(this.message, 'Error: couldn’t reset the settings.'); },
    });
  }
}

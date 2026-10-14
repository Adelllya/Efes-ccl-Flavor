import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { SiteSettings } from '../../models/flavor-tree.models';
import { PanelIconComponent } from './panel-icons';
import { flash, isErrorText } from './panel-shared';

const DEFAULTS: SiteSettings = { alternatives_count: 3, min_score_to_show: 1, show_wheat_decor: true, pairing_intro: '', show_team: false };

/** Вкладка "Настройки" (только модератор): без списка, одна карточка с четырьмя полями витрины. */
@Component({
  selector: 'panel-settings',
  standalone: true,
  imports: [FormsModule, PanelIconComponent],
  template: `
    <div class="wa-page wa-page-single">
      <div class="wa-card wa-narrow">
        <div class="wa-card-head">
          <div class="wa-card-head-text">
            <h3 class="wa-card-title">Storefront settings</h3>
            <p class="wa-card-sub">What guests see on the home page and in dish pairings</p>
          </div>
        </div>

        @if (loading()) {
          <p class="wa-muted">Loading...</p>
        } @else if (loadError()) {
          <div class="wa-loadbar" role="alert">
            <panel-icon name="alert" />
            <span>{{ loadError() }}</span>
            <button type="button" class="btn-outline" (click)="load()"><panel-icon name="refresh" /> Refresh</button>
          </div>
        } @else {
          <div class="wa-fields">
            <label class="wa-field">
              <span class="wa-label">Beers to show per pairing: {{ form.alternatives_count }}</span>
              <input class="wa-range" type="range" min="1" max="10" [(ngModel)]="form.alternatives_count" />
            </label>
            <label class="wa-field">
              <span class="wa-label">Minimum pairing score to show: {{ form.min_score_to_show }}/5</span>
              <input class="wa-range" type="range" min="1" max="5" [(ngModel)]="form.min_score_to_show" />
            </label>
            <label class="wa-field wa-field-wide">
              <span class="wa-label">Pairing intro text</span>
              <textarea class="input" rows="3" [(ngModel)]="form.pairing_intro"
                        placeholder="For example: pick a dish and we'll suggest a beer that brings out its flavor"></textarea>
            </label>
            <label class="wa-check wa-field-wide">
              <input type="checkbox" [(ngModel)]="form.show_wheat_decor" /> Show wheat decor on the home page
            </label>
            <label class="wa-check wa-field-wide">
              <input type="checkbox" [(ngModel)]="form.show_team" /> Show the team section in the Academy
            </label>
          </div>
          <p class="wa-muted">
            Guests won't see beers scored below the minimum. Turn on the team section once the
            "Team" section in Django admin has real people in it: the starter entries are placeholders.
          </p>
          <div class="wa-actions">
            <button type="button" class="btn-amber" [disabled]="saving() || !ready()" (click)="save()">
              <panel-icon name="save" /> {{ saving() ? 'Saving...' : 'Save' }}
            </button>
            <button type="button" class="btn-outline" [disabled]="saving() || !ready()" (click)="reset()">
              <panel-icon name="undo" /> Revert to saved
            </button>
            @if (msg()) {
              <p class="wa-msg" [class.error]="isError(msg())" [attr.role]="isError(msg()) ? 'alert' : 'status'">{{ msg() }}</p>
            }
          </div>
        }
      </div>
    </div>
  `
})
export class PanelSettingsComponent implements OnInit {
  private api = inject(ApiService);

  isError = isErrorText;

  form: SiteSettings = { ...DEFAULTS };
  /** Последнее сохранённое состояние: к нему возвращает "Вернуть сохранённые". */
  private saved: SiteSettings = { ...DEFAULTS };
  loading = signal(true);
  /** Настройки не прочитались: текст держится до удачной попытки, формы при этом нет. */
  loadError = signal<string | null>(null);
  /** true только после настоящего ответа сервера. До него "Сохранить" закрыто: значения по умолчанию не должны лечь поверх настоящих. */
  ready = signal(false);
  saving = signal(false);
  msg = signal<string | null>(null);

  ngOnInit() {
    this.load();
  }

  /** Без значений по умолчанию: при ошибке показываем её и кнопку "Обновить", а не форму с заглушками. */
  load() {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.getSettingsStrict().subscribe({
      next: s => {
        this.saved = { ...s };
        this.form = { ...s };
        this.ready.set(true);
        this.loading.set(false);
      },
      error: err => {
        this.loading.set(false);
        this.loadError.set('Couldn\'t load the settings: ' + AuthService.errorText(err));
      }
    });
  }

  reset() {
    this.form = { ...this.saved };
    this.msg.set(null);
  }

  save() {
    if (!this.ready()) return;
    this.saving.set(true);
    this.api.updateSettings({
      alternatives_count: Number(this.form.alternatives_count) || 1,
      min_score_to_show: Number(this.form.min_score_to_show) || 1,
      show_wheat_decor: !!this.form.show_wheat_decor,
      show_team: !!this.form.show_team,
      pairing_intro: (this.form.pairing_intro || '').trim()
    }).subscribe({
      next: saved => {
        this.saving.set(false);
        this.saved = { ...saved };
        this.form = { ...saved };
        flash(this.msg, 'Saved');
      },
      error: err => {
        this.saving.set(false);
        flash(this.msg, 'Error: ' + AuthService.errorText(err), 6000);
      }
    });
  }
}

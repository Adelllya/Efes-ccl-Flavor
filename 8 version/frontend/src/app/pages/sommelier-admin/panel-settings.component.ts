import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { SiteSettings } from '../../models/flavor-tree.models';
import { PanelIconComponent } from './panel-icons';
import { flash, isErrorText } from './panel-shared';

const DEFAULTS: SiteSettings = { alternatives_count: 3, min_score_to_show: 1, show_wheat_decor: true, pairing_intro: '' };

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
            <h3 class="wa-card-title">Настройки витрины</h3>
            <p class="wa-card-sub">Что видит гость на главной и в подборе к блюду</p>
          </div>
        </div>

        @if (loading()) {
          <p class="wa-muted">Загрузка...</p>
        } @else {
          <div class="wa-fields">
            <label class="wa-field">
              <span class="wa-label">Сколько сортов показывать в подборе: {{ form.alternatives_count }}</span>
              <input class="wa-range" type="range" min="1" max="10" [(ngModel)]="form.alternatives_count" />
            </label>
            <label class="wa-field">
              <span class="wa-label">Минимальная оценка сочетания, чтобы показать: {{ form.min_score_to_show }}/5</span>
              <input class="wa-range" type="range" min="1" max="5" [(ngModel)]="form.min_score_to_show" />
            </label>
            <label class="wa-field wa-field-wide">
              <span class="wa-label">Вступительный текст подбора</span>
              <textarea class="input" rows="3" [(ngModel)]="form.pairing_intro"
                        placeholder="Например: выберите блюдо, и мы подскажем, какой сорт подчеркнёт его вкус"></textarea>
            </label>
            <label class="wa-check wa-field-wide">
              <input type="checkbox" [(ngModel)]="form.show_wheat_decor" /> Показывать декор из колосьев на главной
            </label>
          </div>
          <p class="wa-muted">Сорта с оценкой ниже минимальной гость в подборе не увидит.</p>
          <div class="wa-actions">
            <button type="button" class="btn-amber" [disabled]="saving()" (click)="save()">
              <panel-icon name="save" /> {{ saving() ? 'Сохраняем...' : 'Сохранить' }}
            </button>
            <button type="button" class="btn-outline" [disabled]="saving()" (click)="reset()">
              <panel-icon name="undo" /> Вернуть сохранённые
            </button>
            @if (msg()) {
              <p class="wa-msg" [class.error]="isError(msg())">{{ msg() }}</p>
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
  saving = signal(false);
  msg = signal<string | null>(null);

  ngOnInit() {
    this.api.getSettings().subscribe(s => {
      this.saved = { ...s };
      this.form = { ...s };
      this.loading.set(false);
    });
  }

  reset() {
    this.form = { ...this.saved };
    this.msg.set(null);
  }

  save() {
    this.saving.set(true);
    this.api.updateSettings({
      alternatives_count: Number(this.form.alternatives_count) || 1,
      min_score_to_show: Number(this.form.min_score_to_show) || 1,
      show_wheat_decor: !!this.form.show_wheat_decor,
      pairing_intro: (this.form.pairing_intro || '').trim()
    }).subscribe({
      next: saved => {
        this.saving.set(false);
        this.saved = { ...saved };
        this.form = { ...saved };
        flash(this.msg, 'Сохранено');
      },
      error: err => {
        this.saving.set(false);
        flash(this.msg, 'Ошибка: ' + AuthService.errorText(err), 6000);
      }
    });
  }
}

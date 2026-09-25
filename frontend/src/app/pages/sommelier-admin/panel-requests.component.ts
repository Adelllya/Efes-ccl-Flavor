import { Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ChangeRequest, PyramidLayer, REQUEST_STATUS_LABELS, RequestStatus } from '../../models/flavor-tree.models';
import { PanelIconComponent } from './panel-icons';
import { LAYER_SHORT, flash, formatWhen, initialOf, isErrorText, statusChipClass } from './panel-shared';

type RequestFilter = RequestStatus | 'all';

interface DiffRow {
  label: string;
  before: string;
  after: string;
  changed: boolean;
}

interface RequestGroup {
  brand: string;
  brand_name: string;
  brand_image: string | null;
  items: ChangeRequest[];
}

function layerText(value: unknown): string {
  return LAYER_SHORT[value as PyramidLayer] || String(value ?? '');
}

function tempText(min: unknown, max: unknown): string {
  if (min == null && max == null) return '';
  return `${min ?? '?'}-${max ?? '?'} °C`;
}

/** Вкладка "Запросы" (модератор): что предложил сомелье, было / станет, принять или отклонить. */
@Component({
  selector: 'panel-requests',
  standalone: true,
  imports: [FormsModule, PanelIconComponent],
  template: `
    <div class="wa-page" [class.has-selection]="!!selectedId()">
      <aside class="wa-list">
        <div class="wa-list-head">
          <h2 class="wa-list-title">Запросы
            @if (pendingTotal() > 0) { <span class="wa-count wa-count-accent">{{ pendingTotal() }}</span> }
          </h2>
          <button type="button" class="wa-iconbtn" title="Обновить" [disabled]="loading()" (click)="load()">
            <panel-icon name="refresh" />
          </button>
        </div>
        <label class="wa-search">
          <panel-icon name="search" />
          <input type="text" placeholder="Сорт, нота или автор" [ngModel]="search()" (ngModelChange)="search.set($event)" />
        </label>
        <div class="wa-pills">
          @for (p of pills; track p.value) {
            <button type="button" class="wa-pill" [class.active]="filter() === p.value" (click)="filter.set(p.value)">
              {{ p.label }}
            </button>
          }
        </div>
        @if (msg()) {
          <p class="wa-msg" [class.error]="isError(msg())">{{ msg() }}</p>
        }
        <div class="wa-rows">
          @if (loading() && !requests().length) {
            <p class="wa-empty">Загрузка...</p>
          } @else if (loadError()) {
            <p class="wa-error">{{ loadError() }}</p>
          } @else {
            @for (g of grouped(); track g.brand) {
              <div class="wa-group">{{ g.brand_name }}</div>
              @for (r of g.items; track r.id) {
                <button type="button" class="wa-row" [class.active]="selectedId() === r.id" (click)="select(r.id)">
                  <span class="wa-avatar">
                    @if (g.brand_image) { <img [src]="g.brand_image" [alt]="g.brand_name" /> } @else { {{ initial(g.brand_name) }} }
                  </span>
                  <span class="wa-row-body">
                    <span class="wa-row-title">{{ shortSummary(r) }}</span>
                    <span class="wa-row-sub">{{ r.kind_display }}<span class="wa-dot"></span>{{ r.author.username }}</span>
                  </span>
                  <span class="wa-row-meta">
                    <span class="wa-time">{{ when(r.created_at) }}</span>
                    <span [class]="chip(r.status)">{{ statusLabels[r.status] }}</span>
                  </span>
                </button>
              }
            } @empty {
              <p class="wa-empty">{{ requests().length ? 'В этом фильтре пусто' : 'Запросов пока нет' }}</p>
            }
          }
        </div>
      </aside>

      <section class="wa-detail">
        @for (r of selectedOne(); track r.id) {
          <div class="wa-detail-enter">
            <button type="button" class="wa-back" (click)="select(null)"><panel-icon name="arrowLeft" /> К списку</button>
            <div class="wa-card">
              <div class="wa-card-head">
                <span class="wa-avatar wa-avatar-lg">
                  @if (r.brand_image) { <img [src]="r.brand_image" [alt]="r.brand_name" /> } @else { {{ initial(r.brand_name) }} }
                </span>
                <div class="wa-card-head-text">
                  <h3 class="wa-card-title">{{ r.brand_name }}</h3>
                  <p class="wa-card-sub">{{ r.kind_display }}<span class="wa-dot"></span>{{ r.author.username }}<span class="wa-dot"></span>{{ when(r.created_at) }}</p>
                </div>
                <span [class]="chip(r.status)">{{ statusLabels[r.status] }}</span>
              </div>

              <p class="wa-text"><strong>{{ r.summary }}</strong></p>

              <div class="wa-diff">
                <div class="wa-diff-col">
                  <h4>Сейчас</h4>
                  @if (r.current) {
                    @for (row of diffRows(); track row.label) {
                      <div class="wa-diff-row"><span>{{ row.label }}</span><strong>{{ row.before || 'пусто' }}</strong></div>
                    }
                  } @else {
                    <p class="wa-muted">{{ r.kind === 'SERVING' ? 'Подача ещё не заполнена' : 'Ноты ещё нет в пирамиде' }}</p>
                  }
                </div>
                <div class="wa-diff-col wa-diff-after">
                  <h4>Предлагается</h4>
                  @for (row of diffRows(); track row.label) {
                    <div class="wa-diff-row" [class.changed]="row.changed"><span>{{ row.label }}</span><strong>{{ row.after || 'пусто' }}</strong></div>
                  }
                </div>
              </div>

              @if (r.comment) {
                <div class="wa-quote">
                  <span class="wa-label">Комментарий автора</span>
                  <p>{{ r.comment }}</p>
                </div>
              }

              @if (r.status === 'PENDING') {
                <label class="wa-field wa-field-wide">
                  <span class="wa-label">Комментарий для сомелье</span>
                  <textarea class="input" rows="2" [ngModel]="reviewComment()" (ngModelChange)="reviewComment.set($event)"
                            placeholder="Обязателен при отклонении: сомелье увидит причину"></textarea>
                </label>
                @if (actionError()) {
                  <p class="wa-error">{{ actionError() }}</p>
                }
                <div class="wa-actions">
                  <button type="button" class="btn-amber" [disabled]="acting()" (click)="approve(r)">
                    <panel-icon name="check" /> Принять
                  </button>
                  <button type="button" class="btn-outline panel-danger" [disabled]="acting()" (click)="reject(r)">
                    <panel-icon name="x" /> Отклонить
                  </button>
                </div>
              } @else {
                <div class="wa-review">
                  <span class="wa-label">{{ r.status === 'APPROVED' ? 'Принял' : 'Отклонил' }} {{ r.reviewer?.username || 'модератор' }}
                    @if (r.reviewed_at) { <span class="wa-dot"></span>{{ when(r.reviewed_at) }} }
                  </span>
                  @if (r.review_comment) { <p>{{ r.review_comment }}</p> }
                </div>
              }
            </div>
          </div>
        } @empty {
          <div class="wa-detail-empty">Выберите элемент слева</div>
        }
      </section>
    </div>
  `
})
export class PanelRequestsComponent implements OnInit {
  private api = inject(ApiService);

  /** Запрос принят или отклонён: родитель обновляет бейдж и список сортов. */
  reviewed = output<ChangeRequest>();

  readonly statusLabels = REQUEST_STATUS_LABELS;
  readonly initial = initialOf;
  readonly when = formatWhen;
  readonly chip = statusChipClass;
  readonly pills: { value: RequestFilter; label: string }[] = [
    { value: 'PENDING', label: 'Ожидают' },
    { value: 'APPROVED', label: 'Принятые' },
    { value: 'REJECTED', label: 'Отклонённые' },
    { value: 'all', label: 'Все' }
  ];

  requests = signal<ChangeRequest[]>([]);
  loading = signal(false);
  loadError = signal<string | null>(null);
  search = signal('');
  filter = signal<RequestFilter>('PENDING');
  selectedId = signal<string | null>(null);
  reviewComment = signal('');
  acting = signal(false);
  actionError = signal<string | null>(null);
  msg = signal<string | null>(null);

  isError = isErrorText;

  pendingTotal = computed(() => this.requests().filter(r => r.status === 'PENDING').length);

  filtered = computed(() => {
    const q = this.search().toLowerCase().trim();
    const f = this.filter();
    return this.requests().filter(r =>
      (f === 'all' || r.status === f) &&
      (!q || r.brand_name.toLowerCase().includes(q) || r.summary.toLowerCase().includes(q)
        || r.author.username.toLowerCase().includes(q) || (r.flavor_note_name || '').toLowerCase().includes(q))
    );
  });

  /** Строки собраны по сортам, внутри сорта новые сверху. */
  grouped = computed<RequestGroup[]>(() => {
    const groups = new Map<string, RequestGroup>();
    for (const r of this.filtered()) {
      let g = groups.get(r.brand);
      if (!g) {
        g = { brand: r.brand, brand_name: r.brand_name, brand_image: r.brand_image, items: [] };
        groups.set(r.brand, g);
      }
      g.items.push(r);
    }
    const list = [...groups.values()];
    list.sort((a, b) => a.brand_name.localeCompare(b.brand_name, 'ru'));
    for (const g of list) g.items.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return list;
  });

  selectedOne = computed(() => {
    const r = this.requests().find(x => x.id === this.selectedId());
    return r ? [r] : [];
  });

  diffRows = computed<DiffRow[]>(() => {
    const r = this.selectedOne()[0];
    if (!r) return [];
    const cur = r.current || {};
    const p = r.payload || {};
    const row = (label: string, before: string, after: string): DiffRow => ({ label, before, after, changed: before !== after });
    if (r.kind === 'SERVING') {
      return [
        row('Температура', tempText(cur['serving_temp_min'], cur['serving_temp_max']), tempText(p['serving_temp_min'], p['serving_temp_max'])),
        row('Бокал', String(cur['glass_type'] ?? ''), String(p['glass_type'] ?? '')),
        row('Сезон', String(cur['seasonality'] ?? ''), String(p['seasonality'] ?? ''))
      ];
    }
    const name = r.flavor_note_name || 'нота';
    if (r.kind === 'NOTE_DELETE') {
      return [
        row('Нота', r.current ? name : '', 'Убрать из пирамиды'),
        row('Слой', layerText(cur['layer']), ''),
        row('Интенсивность', cur['intensity'] != null ? cur['intensity'] + '/10' : '', '')
      ];
    }
    return [
      row('Нота', r.current ? name : '', name),
      row('Слой', layerText(cur['layer']), layerText(p['layer'])),
      row('Интенсивность', cur['intensity'] != null ? cur['intensity'] + '/10' : '', p['intensity'] != null ? p['intensity'] + '/10' : ''),
      row('Комментарий сомелье', String(cur['sommelier_note'] ?? ''), String(p['sommelier_note'] ?? ''))
    ];
  });

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.getChangeRequests().subscribe({
      next: list => {
        this.requests.set(list);
        this.loading.set(false);
      },
      error: err => {
        this.loading.set(false);
        this.loadError.set('Ошибка: ' + AuthService.errorText(err));
      }
    });
  }

  select(id: string | null) {
    this.selectedId.set(id);
    this.reviewComment.set('');
    this.actionError.set(null);
  }

  /** В строке списка сорт уже в заголовке группы, поэтому убираем его из сводки. */
  shortSummary(r: ChangeRequest): string {
    const prefix = r.brand_name + ': ';
    const text = r.summary.startsWith(prefix) ? r.summary.slice(prefix.length) : r.summary;
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  approve(r: ChangeRequest) {
    this.acting.set(true);
    this.actionError.set(null);
    const comment = this.reviewComment().trim();
    this.api.approveChangeRequest(r.id, comment || undefined).subscribe({
      next: res => {
        this.acting.set(false);
        this.replace(res);
        flash(this.msg, 'Принято: изменение уже на сайте');
        this.reviewed.emit(res);
        // Колонка "Сейчас" у соседних запросов по той же ноте устарела: перечитываем список
        this.load();
      },
      error: err => {
        this.acting.set(false);
        this.actionError.set('Ошибка: ' + AuthService.errorText(err));
      }
    });
  }

  reject(r: ChangeRequest) {
    const comment = this.reviewComment().trim();
    if (!comment) {
      this.actionError.set('Напишите причину отклонения: сомелье её увидит');
      return;
    }
    this.acting.set(true);
    this.actionError.set(null);
    this.api.rejectChangeRequest(r.id, comment).subscribe({
      next: res => {
        this.acting.set(false);
        this.replace(res);
        flash(this.msg, 'Запрос отклонён');
        this.reviewed.emit(res);
        this.load();
      },
      error: err => {
        this.acting.set(false);
        this.actionError.set('Ошибка: ' + AuthService.errorText(err));
      }
    });
  }

  private replace(updated: ChangeRequest) {
    this.requests.update(list => list.map(x => x.id === updated.id ? { ...x, ...updated } : x));
    this.reviewComment.set('');
  }
}

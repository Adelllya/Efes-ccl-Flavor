import { AfterViewInit, Component, ElementRef, EventEmitter, Output, ViewChild, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { API_BASE } from '../services/api.service';
import { SelectionService } from '../services/selection.service';
import { V2ApiService } from '../pages/drinks-v2/v2-api.service';
import { V2Drink } from '../pages/drinks-v2/v2.models';
import { V2GlassComponent } from '../pages/drinks-v2/v2-ui';
import { AGE_OK_KEY } from './age-storage';

/** Анонимный id сессии гостя для статистики пилота. Ключ общий для всего фронтенда. */
const SESSION_KEY = 'ft_sid';

function newUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // randomUUID есть только на https и localhost, а телефон в локальной сети открывает сайт по http
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function sessionId(): string {
  try {
    let sid = localStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = newUuid();
      localStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  } catch {
    return '';
  }
}

/**
 * Событие AGE_OK для статистики пилота (POST /api/events/). Ошибки молча глотаем.
 * sendBeacon всегда шлёт cookie: на API с другого домена JSON-запрос с credentials
 * CORS не пропустит, поэтому туда уходит fetch с keepalive и без cookie.
 */
function sendAgeOk(venue: string | null, table: number | null): void {
  const event: Record<string, unknown> = { kind: 'AGE_OK' };
  if (venue && table !== null) event['table'] = table;
  const body = JSON.stringify({ session: sessionId(), ...(venue ? { venue } : {}), events: [event] });
  const url = `${API_BASE}/events/`;
  try {
    const sameOrigin = new URL(url, location.href).origin === location.origin;
    if (sameOrigin && navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' }))) return;
    fetch(url, { method: 'POST', body, keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'application/json' } })
      .catch(() => undefined);
  } catch {
    // статистика не должна мешать гостю
  }
}

/** Безалкогольное без пива 0.0: для тех, кому нет 21, пивные бренды не показываем. */
const SOFT_ORDER = ['tea', 'coffee', 'lemonade', 'soda', 'water', 'dairy', 'kvass', 'cocktail'];
const ENERGY = /energy|энергет/i;

interface SoftGroup {
  id: string;
  label: string;
  drinks: V2Drink[];
}

/**
 * Вопрос о возрасте при первом входе. В Казахстане алкоголь продают с 21 года.
 * «Да» запоминается в localStorage, «Нет» ведёт на экран с безалкогольными напитками.
 * Страницу /privacy AppComponent не закрывает этим окном.
 */
@Component({
  selector: 'app-age-gate',
  standalone: true,
  imports: [V2GlassComponent],
  template: `
    <!-- dialog + showModal: верхний слой браузера, страница под ним недоступна до ответа -->
    <dialog #dlg class="ag-dialog" aria-labelledby="ag-title" (cancel)="$event.preventDefault()" (close)="reopen()">
      <div class="ag-card">
        @if (step() === 'ask') {
          <div class="ag-badge" aria-hidden="true">21+</div>
          <h2 id="ag-title" class="ag-title">Вам исполнился 21 год?</h2>
          <p class="ag-text">На сайте есть информация об алкогольных напитках, она предназначена только для гостей старше 21 года.</p>
          <div class="ag-actions">
            <button type="button" class="btn-amber" (click)="yes()">Да</button>
            <button type="button" class="btn-outline" (click)="no()">Нет</button>
          </div>
          <p class="ag-note">
            Чрезмерное употребление алкоголя вредит вашему здоровью.
            <a href="/privacy" (click)="openPrivacy($event)">Конфиденциальность</a>
          </p>
        } @else {
          <div class="ag-badge ag-badge-soft" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v2"/><path d="M14 2v2"/><path d="M6 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/></svg>
          </div>
          <h2 id="ag-title" class="ag-title">Спасибо за честный ответ</h2>
          <p class="ag-text">
            Материалы об алкогольных напитках открыты только гостям старше 21 года.
            Можно посмотреть безалкогольные напитки: чай, кофе, лимонады, айран и воду.
          </p>

          @switch (softState()) {
            @case ('idle') {
              <div class="ag-actions">
                <button type="button" class="btn-amber" (click)="showSoft()">Безалкогольные напитки</button>
              </div>
            }
            @case ('loading') {
              <p class="ag-text text-sm" aria-busy="true">Загружаем напитки...</p>
            }
            @case ('error') {
              <p class="ag-text text-sm">Не получилось загрузить список. Проверьте интернет и попробуйте ещё раз.</p>
              <div class="ag-actions">
                <button type="button" class="btn-outline" (click)="showSoft()">Повторить</button>
              </div>
            }
            @case ('ready') {
              <div class="ag-soft" tabindex="0" aria-label="Безалкогольные напитки">
                @for (g of soft(); track g.id) {
                  <h3 class="ag-soft-title">{{ g.label }}</h3>
                  <ul class="ag-soft-list">
                    @for (d of g.drinks; track d.id) {
                      <li>
                        <v2-glass [category]="d.category" [size]="32" />
                        <span>{{ d.display_name || d.name }}</span>
                      </li>
                    }
                  </ul>
                }
              </div>
            }
          }

          <p class="ag-note">
            <button type="button" class="ag-link" (click)="back()">Мне есть 21, ответить заново</button>
            <a href="/privacy" (click)="openPrivacy($event)">Конфиденциальность</a>
          </p>
        }
      </div>
    </dialog>
  `,
  styles: [`
    .ag-dialog {
      /* margin: auto из стилей браузера сбрасывает общий reset, без него окно прилипает к левому краю */
      margin: auto;
      width: min(440px, calc(100% - 32px));
      max-width: 100%;
      max-height: calc(100dvh - 32px);
      padding: 0;
      border: 1px solid var(--line);
      border-radius: var(--radius-xl);
      background: var(--bg-2);
      color: var(--foam);
      box-shadow: 0 32px 64px -16px rgba(28, 25, 23, 0.3);
      overflow-y: auto;
      animation: agRise var(--duration-slow) var(--ease-out);
    }
    .ag-dialog::backdrop {
      background: rgba(28, 25, 23, 0.55);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }
    @keyframes agRise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }

    .ag-card { padding: var(--space-3xl) var(--space-2xl) var(--space-2xl); text-align: center; }

    .ag-badge {
      width: 56px;
      height: 56px;
      margin: 0 auto var(--space-lg);
      border-radius: var(--radius-lg);
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, var(--beer-light), var(--beer-mid));
      color: #fff;
      font-family: var(--font-heading);
      font-size: 1.15rem;
      font-weight: 800;
      box-shadow: 0 8px 20px -8px rgba(180, 83, 9, 0.5);
    }
    .ag-badge-soft { background: linear-gradient(135deg, #22C55E, var(--success)); box-shadow: 0 8px 20px -8px rgba(22, 163, 74, 0.5); }

    .ag-title { font-size: 1.5rem; margin-bottom: var(--space-sm); }
    .ag-text { color: var(--foam-dim); font-size: 0.95rem; line-height: 1.5; margin-bottom: var(--space-xl); }

    .ag-actions { display: flex; gap: var(--space-md); justify-content: center; margin-bottom: var(--space-xl); }
    .ag-actions button { flex: 1; justify-content: center; min-height: 48px; font-size: 1rem; }

    .ag-note {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 6px 14px;
      margin: 0;
      font-size: 0.8rem;
      line-height: 1.45;
      color: var(--muted);
    }
    .ag-note a, .ag-link {
      color: var(--beer-mid);
      font-weight: 600;
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .ag-link { background: none; border: none; padding: 0; font: inherit; font-weight: 600; cursor: pointer; }

    .ag-soft {
      max-height: 44dvh;
      overflow-y: auto;
      margin-bottom: var(--space-xl);
      padding: var(--space-md) var(--space-lg);
      text-align: left;
      background: var(--glass);
      border: 1px solid var(--line-subtle);
      border-radius: var(--radius-md);
    }
    .ag-soft-title {
      margin: var(--space-md) 0 6px;
      font-size: 0.74rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
    }
    .ag-soft-title:first-child { margin-top: 0; }
    .ag-soft-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .ag-soft-list li { display: flex; align-items: center; gap: 10px; font-size: 0.9rem; line-height: 1.35; }

    @media (prefers-reduced-motion: reduce) { .ag-dialog { animation: none; } }
  `]
})
export class AgeGateComponent implements AfterViewInit {
  private readonly selection = inject(SelectionService);
  private readonly v2 = inject(V2ApiService);

  /** Гость ответил «Да». */
  @Output() confirmed = new EventEmitter<void>();
  /** Ссылка на /privacy: переход делает AppComponent, окно на этой странице не показывается. */
  @Output() privacy = new EventEmitter<void>();

  @ViewChild('dlg') private dlg?: ElementRef<HTMLDialogElement>;

  readonly step = signal<'ask' | 'no'>('ask');
  readonly softState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly soft = signal<SoftGroup[]>([]);

  private answered = false;

  ngAfterViewInit(): void {
    this.dlg?.nativeElement.showModal();
  }

  /** Chrome закрывает dialog по второму Esc даже при preventDefault в cancel: открываем снова. */
  reopen(): void {
    const el = this.dlg?.nativeElement;
    if (!this.answered && el && !el.open) el.showModal();
  }

  yes(): void {
    try {
      localStorage.setItem(AGE_OK_KEY, '1');
    } catch {
      // без хранилища ответ живёт до перезагрузки
    }
    sendAgeOk(this.selection.venueSlug(), this.selection.tableNumber());
    this.answered = true;
    this.dlg?.nativeElement.close();
    this.confirmed.emit();
  }

  no(): void {
    this.step.set('no');
  }

  back(): void {
    this.step.set('ask');
  }

  openPrivacy(event: MouseEvent): void {
    // Ctrl/Cmd-клик и средняя кнопка открывают новую вкладку как обычная ссылка
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    this.answered = true;
    this.privacy.emit();
  }

  /** Безалкогольные напитки из движка v2: категории без алкоголя, крепость 0, без энергетиков. */
  showSoft(): void {
    this.softState.set('loading');
    forkJoin([this.v2.meta(), this.v2.drinks()]).subscribe({
      next: ([meta, drinks]) => {
        const labels = new Map(meta.categories.map(c => [c.id, c.label]));
        const groups = SOFT_ORDER
          .map(id => ({
            id,
            label: id === 'cocktail' ? 'Коктейли без алкоголя' : labels.get(id) ?? id,
            drinks: drinks.filter(d => d.category === id && d.abv === 0
              && !ENERGY.test(`${d.name} ${d.style?.name ?? ''}`))
          }))
          .filter(g => g.drinks.length > 0);
        this.soft.set(groups);
        this.softState.set(groups.length ? 'ready' : 'error');
      },
      error: () => this.softState.set('error')
    });
  }
}

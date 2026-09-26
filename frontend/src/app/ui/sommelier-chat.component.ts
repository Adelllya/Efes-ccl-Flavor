import {
  Component, DestroyRef, ElementRef, EventEmitter, HostListener, Injector, Input, NgZone, Output, afterNextRender, computed, effect,
  inject, signal, untracked, viewChild
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { TimeoutError, timeout } from 'rxjs';
import { AgeService } from '../services/age.service';
import { ApiService } from '../services/api.service';
import { AuthService } from '../services/auth.service';
import { SelectionService } from '../services/selection.service';
import { TrackService } from '../services/track.service';
import {
  AiMessage, AiMode, AiPrefs, AiRequest, AiStatus, AiSuggestion, MenuDrink, MenuEntry, VenueMenu
} from '../models/flavor-tree.models';
import { CartLine, addToCart, notifyCartChanged, readCart } from '../pages/venue-menu/cart-storage';

/** Сколько реплик уходит на сервер и сколько знаков в каждой: лимиты API. */
const MAX_TURNS = 12;
const MAX_CHARS = 1500;
/** Сервер ждёт модель до 8 секунд, потом отвечает вкусовой движок; сверх этого показываем ошибку с повтором. */
const REQUEST_TIMEOUT_MS = 20000;
/** Сколько сообщений храним в sessionStorage. */
const STORED_LIMIT = 40;
const ADDED_FLASH_MS = 1600;

/** Реплика в чате: у ответа сомелье ещё карточки и то, для какого заведения он дан. */
interface ChatMessage extends AiMessage {
  suggestions?: AiSuggestion[];
  mode?: AiMode;
  note?: string;
  /** Сработало правило безопасности: ответ без алкоголя. */
  safety?: string;
  /** «Алкоголь только для гостей старше 21 года», если в карточках есть алкоголь. */
  disclaimer?: string;
  /** slug заведения на момент ответа; по нему решаем, можно ли класть карточку в заказ. */
  venue?: string | null;
}

interface StoredChat {
  messages: ChatMessage[];
  prefs: AiPrefs;
  /** Флаги безопасности (возраст, руль...), которые сервер просил помнить: история уходит на сервер не вся. */
  flags?: string[];
}

const EMPTY_PREFS: AiPrefs = { no_bitter: false, light: false, no_alcohol: false };

/** Ключ sessionStorage: история отдельная для каждого заведения и для каталога. */
function historyKey(slug: string | null): string {
  return `ft_ai_${slug || 'catalog'}`;
}

function readHistory(key: string): StoredChat | null {
  try {
    const raw = sessionStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) as Partial<StoredChat> : null;
    if (!parsed || !Array.isArray(parsed.messages)) return null;
    const flags = Array.isArray(parsed.flags) ? parsed.flags.filter(f => typeof f === 'string') : [];
    return { messages: parsed.messages, prefs: { ...EMPTY_PREFS, ...(parsed.prefs || {}) }, flags };
  } catch {
    return null;
  }
}

function writeHistory(key: string, chat: StoredChat | null): void {
  try {
    if (!chat) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify({ ...chat, messages: chat.messages.slice(-STORED_LIMIT) }));
  } catch {
    // без хранилища история живёт до перезагрузки
  }
}

/** Прокрутка страницы меню, после которой кнопка сомелье прячется, пока гость листает вниз. */
const TUCK_AFTER_PX = 160;
const TUCK_STEP_PX = 6;

/** Строка корзины из чата: откуда позиция, к какому блюду подобран напиток и место карточки (поля CartLine). */
interface AiCartMeta {
  source: 'AI';
  pairedWith?: string;
  rank: number;
}

/** Последние реплики для запроса: не больше MAX_TURNS, первая и последняя от гостя. */
function lastTurns(all: ChatMessage[]): AiMessage[] {
  let turns = all.slice(-MAX_TURNS);
  while (turns.length && turns[0].role !== 'user') turns = turns.slice(1);
  return turns.map(t => ({ role: t.role, content: t.content.slice(0, MAX_CHARS) }));
}

/** Цена из подписи карточки "0,5 л · 2 200 ₸" -> "2200"; когда меню не загрузилось. */
function priceFromSubtitle(subtitle: string): string {
  const m = /(\d[\d\s ]*)\s*₸/.exec(subtitle || '');
  return m ? m[1].replace(/\D/g, '') : '0';
}

/** Объём или порция из подписи: последняя часть без цены. */
function subFromSubtitle(subtitle: string): string {
  const parts = (subtitle || '').split('·').map(p => p.trim()).filter(p => p && !p.includes('₸'));
  return parts.length ? parts[parts.length - 1] : '';
}

/**
 * Сомелье Flavor Tree: плавающая кнопка и чат для гостя.
 *
 * Монтируется один раз в AppComponent. Знает открытое заведение, стол и корзину
 * через SelectionService и общую запись корзины, поэтому советует из карты бара
 * и кладёт карточки прямо в заказ. Без заведения советует по общему каталогу.
 * История хранится в памяти и в sessionStorage отдельно для каждого заведения.
 * Честно показывает, кто отвечает: ИИ Claude или вкусовой движок, и когда сработали
 * правила безопасности. Вопросы сервер пишет в статистику пилота сам (AI_ASK),
 * а добавление карточки в заказ чат отправляет событием AI_ADD.
 */
@Component({
  selector: 'app-sommelier-chat',
  standalone: true,
  template: `
    <button
      type="button"
      class="ai-fab"
      [class.ai-fab-open]="open()"
      [class.ai-fab-lift]="lift && !!slug()"
      [class.ai-fab-tucked]="lift && !!slug() && tucked()"
      (click)="toggle()"
      [attr.aria-expanded]="open()"
      aria-controls="ai-sheet"
      aria-label="Сомелье Flavor Tree"
      #fab
    >
      <!-- Пузырь диалога с кружкой пива внутри -->
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>
        <path d="M9 9h5v6a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1z"/>
        <path d="M14 10.5h1a1.5 1.5 0 0 1 0 3h-1"/>
        <path d="M9 9c0-1 .8-1.5 2.5-1.5S14 8 14 9"/>
      </svg>
      <span class="ai-fab-label">Сомелье</span>
    </button>

    @if (open()) {
      <section class="ai-sheet" id="ai-sheet" role="dialog" aria-labelledby="ai-title">
        <header class="ai-head">
          <div class="ai-head-text">
            <h2 id="ai-title" class="ai-title">Сомелье</h2>
            <span class="ai-sub">{{ contextLabel() }}</span>
          </div>
          @if (status()) {
            <span class="ai-status" [class.ai-status-on]="claudeOn()" [title]="statusTitle()">{{ claudeOn() ? 'ИИ Claude' : 'Ответы по вкусовому движку' }}</span>
          }
          @if (messages().length) {
            <button type="button" class="btn-ghost ai-icon-btn" (click)="clearHistory()" aria-label="Начать заново" title="Начать заново">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
            </button>
          }
          <button type="button" class="btn-ghost ai-icon-btn" (click)="close()" aria-label="Закрыть">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </header>

        <div class="ai-list" #list aria-live="polite">
          @if (!messages().length) {
            <div class="ai-msg ai-msg-bot">
              <div class="ai-bubble">{{ greeting() }}</div>
            </div>
          }
          @for (m of messages(); track $index) {
            <div class="ai-msg" [class.ai-msg-me]="m.role === 'user'" [class.ai-msg-bot]="m.role !== 'user'">
              <div class="ai-bubble">{{ m.content }}</div>
              @if (cardsOf(m); as cards) {
                <div class="ai-cards">
                  @for (s of cards; track $index) {
                    <article class="ai-card">
                      <div class="ai-card-head">
                        <span class="ai-card-kind">{{ s.kind === 'DISH' ? 'Блюдо' : 'Напиток' }}</span>
                        @if (s.score) {
                          <span class="ai-score" role="img" [attr.aria-label]="'Совместимость ' + s.score + ' из 5'">
                            @for (p of pips; track p) {
                              <span class="ai-pip" [class.on]="p <= s.score"></span>
                            }
                            <span class="ai-score-num">{{ s.score }}/5</span>
                          </span>
                        }
                      </div>
                      <h3 class="ai-card-title">{{ s.title }}</h3>
                      @if (s.subtitle) { <p class="ai-card-sub">{{ s.subtitle }}</p> }
                      @if (pairedTitle(m, s); as t) { <p class="ai-card-pair">К блюду «{{ t }}»</p> }
                      @if (s.reason) { <p class="ai-card-reason">{{ s.reason }}</p> }
                      <div class="ai-card-actions">
                        @if (canOrder(m)) {
                          @if (isAvailable(s)) {
                            <button type="button" class="ai-card-btn" [class.ai-card-btn-done]="isAdded(s)" (click)="addToOrder(m, s, $index)">
                              @if (isAdded(s)) {
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                                Добавлено
                              } @else {
                                В заказ
                              }
                            </button>
                          } @else {
                            <span class="ai-card-off">Нет в наличии</span>
                          }
                          @if (brandIdOf(s); as b) {
                            <button type="button" class="ai-card-link" (click)="openBrandPage(b)">О напитке</button>
                          }
                        } @else if (canOpen(m, s)) {
                          <button type="button" class="ai-card-btn ai-card-btn-outline" (click)="openBrandPage(s.brand || s.id)">Открыть</button>
                        }
                      </div>
                    </article>
                  }
                </div>
              }
              @if (m.disclaimer) { <p class="ai-note">{{ m.disclaimer }}</p> }
              @if (m.role !== 'user' && m.mode) {
                <p class="ai-note">{{ modeCaption(m) }}</p>
              }
              @if (m.note) { <p class="ai-note">{{ m.note }}</p> }
            </div>
          }
          @if (busy()) {
            <div class="ai-msg ai-msg-bot">
              <div class="ai-bubble ai-typing" role="status" aria-label="Сомелье печатает">
                <span></span><span></span><span></span>
              </div>
            </div>
          }
          @if (error()) {
            <div class="ai-error" role="alert">
              <span>{{ error() }}</span>
              <button type="button" class="ai-retry" (click)="retry()">Повторить</button>
            </div>
          }
        </div>

        <div class="ai-foot">
          <div class="ai-chips" aria-label="Быстрые вопросы">
            @for (c of chips(); track c) {
              <button type="button" class="ai-chip" (click)="send(c)" [disabled]="busy()">{{ c }}</button>
            }
          </div>
          <div class="ai-prefs" role="group" aria-label="Пожелания">
            <button type="button" class="ai-pref" [class.on]="prefs().no_bitter" [attr.aria-pressed]="!!prefs().no_bitter" (click)="togglePref('no_bitter')">Без горечи</button>
            <button type="button" class="ai-pref" [class.on]="prefs().light" [attr.aria-pressed]="!!prefs().light" (click)="togglePref('light')">Полегче</button>
            <!-- Гостю младше 21 «Без алкоголя» включено всегда -->
            <button type="button" class="ai-pref" [class.on]="prefs().no_alcohol || under21()" [attr.aria-pressed]="!!prefs().no_alcohol || under21()"
                    [disabled]="under21()" (click)="togglePref('no_alcohol')">Без алкоголя</button>
          </div>
          <form class="ai-input-row" (submit)="onSubmit($event); inputEl.value = ''">
            <input
              id="ai-input"
              class="ai-input"
              type="text"
              [attr.maxlength]="maxChars"
              autocomplete="off"
              placeholder="Спросите сомелье..."
              aria-label="Сообщение сомелье"
              [value]="input()"
              (input)="input.set($any($event.target).value)"
              #inputEl
            />
            <button type="submit" class="ai-send" [disabled]="busy() || !input().trim()" aria-label="Отправить">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
            </button>
          </form>
          <p class="ai-foot-note">Алкоголь только для гостей старше 21 года. Чрезмерное употребление алкоголя вредит вашему здоровью. Про аллергию и состав блюд спросите официанта.</p>
        </div>
      </section>
    }
  `,
  styles: [`:host { display: contents; }`],
})
export class SommelierChatComponent {
  private api = inject(ApiService);
  private age = inject(AgeService);
  private selection = inject(SelectionService);
  private track = inject(TrackService);
  private destroyRef = inject(DestroyRef);
  private injector = inject(Injector);
  private zone = inject(NgZone);

  /** На странице меню кнопку поднимаем над полосой корзины и прячем, пока гость листает вниз. */
  @Input() lift = false;
  /** Гость нажал «Открыть» или «О напитке»: AppComponent показывает страницу сорта. */
  @Output() openBrand = new EventEmitter<string>();

  readonly slug = this.selection.venueSlug;
  readonly pips = [1, 2, 3, 4, 5];
  readonly maxChars = MAX_CHARS;
  /** Гость ответил, что ему нет 21: чат советует только безалкогольное из этого меню. */
  readonly under21 = this.age.under21;

  /** Кнопка ушла вниз, пока гость листает меню вниз: не закрывает «Добавить в заказ» и «Подобрать напиток». */
  tucked = signal(false);
  private lastScrollY = 0;
  private scrollTicking = false;

  open = signal(false);
  status = signal<AiStatus | null>(null);
  messages = signal<ChatMessage[]>([]);
  prefs = signal<AiPrefs>({ ...EMPTY_PREFS });
  /** Флаги безопасности этого чата: приходят в safety_flags и уходят обратно с каждым вопросом. */
  private safetyFlags: string[] = [];
  input = signal('');
  busy = signal(false);
  error = signal('');
  /** Карточки, которые только что положили в заказ: короткая подсветка. */
  added = signal<Record<string, boolean>>({});

  /** Меню открытого заведения: первая подсказка, цены и наличие для карточек. */
  private venueMenu = signal<VenueMenu | null>(null);
  private menuSlug: string | null = null;
  /** Для какого ответа о возрасте загружено меню: гостю младше 21 карта только с безалкогольным. */
  private menuUnder21 = false;
  private statusRequested = false;
  private historyLoaded = false;
  private currentKey = historyKey(null);
  private addedTimers: Record<string, ReturnType<typeof setTimeout>> = {};

  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private readonly inputEl = viewChild<ElementRef<HTMLInputElement>>('inputEl');
  private readonly fab = viewChild<ElementRef<HTMLButtonElement>>('fab');

  constructor() {
    // Сменилось заведение: показываем его историю, а не чужую
    effect(() => {
      const key = historyKey(this.selection.venueSlug());
      untracked(() => this.switchHistory(key));
    }, { allowSignalWrites: true });

    // Лист открыт для заведения: подтягиваем его меню один раз (и заново, если поменялся ответ о возрасте)
    effect(() => {
      const open = this.open();
      const slug = this.selection.venueSlug();
      const under21 = this.age.under21();
      untracked(() => {
        if (!open) return;
        if (slug && (slug !== this.menuSlug || under21 !== this.menuUnder21)) this.loadMenu(slug);
        if (!slug) {
          this.menuSlug = null;
          this.venueMenu.set(null);
        }
      });
    }, { allowSignalWrites: true });

    // Прокрутку слушаем вне зоны Angular: в зону заходим, только когда кнопка прячется или появляется
    this.zone.runOutsideAngular(() => window.addEventListener('scroll', this.onScroll, { passive: true }));
    this.destroyRef.onDestroy(() => window.removeEventListener('scroll', this.onScroll));

    // Новые сообщения и индикатор набора: список листаем вниз
    effect(() => {
      this.messages();
      this.busy();
      this.error();
      untracked(() => this.scrollDown());
    });

    this.destroyRef.onDestroy(() => Object.values(this.addedTimers).forEach(t => clearTimeout(t)));
  }

  private readonly entries = computed(() => {
    const m = this.venueMenu();
    return new Map<string, MenuEntry>(m ? m.sections.flatMap(s => s.items).map(i => [i.id, i]) : []);
  });
  private readonly drinks = computed(() => {
    const m = this.venueMenu();
    return new Map<string, MenuDrink>(m ? m.drinks.map(d => [d.id, d]) : []);
  });

  /** Первое блюдо меню, лучше из тех, что в наличии. */
  private readonly firstDish = computed(() => {
    const items = this.venueMenu()?.sections.flatMap(s => s.items) ?? [];
    return (items.find(i => i.is_available) ?? items[0])?.dish.name ?? '';
  });

  readonly chips = computed(() => {
    const dish = this.firstDish();
    return [
      dish ? `Что взять к блюду «${dish}»?` : 'Что взять к бешбармаку?',
      'Чем закусить пиво?',
      'Хочу что-то лёгкое',
      'Что такое лагер?',
      'Посоветуй ужин на двоих',
    ];
  });

  /** Отвечает ли сейчас Claude: ключ на сервере есть и дневной лимит не исчерпан. */
  readonly claudeOn = computed(() => {
    const s = this.status();
    return !!s && s.enabled && s.mode === 'claude' && !s.limit_reached;
  });

  readonly statusTitle = computed(() => {
    const s = this.status();
    if (!s) return '';
    if (this.claudeOn()) return `Отвечает модель ${s.model}; при сбое отвечает вкусовой движок Flavor Tree`;
    if (s.enabled && s.limit_reached) return 'Лимит ответов ИИ на сегодня исчерпан, отвечает вкусовой движок Flavor Tree';
    return 'Ответы подбирает вкусовой движок Flavor Tree по правилам сочетания, без языковой модели';
  });

  readonly contextLabel = computed(() => {
    const slug = this.slug();
    if (!slug) return 'Совет по каталогу сортов';
    const name = this.venueMenu()?.venue.name || 'Меню заведения';
    const table = this.selection.tableNumber();
    return table && table > 0 ? `${name} · стол ${table}` : name;
  });

  readonly greeting = computed(() => {
    if (this.under21()) {
      return this.slug()
        ? 'Здравствуйте! Подскажу блюда из меню и безалкогольный напиток к ним. Спросите или выберите подсказку ниже.'
        : 'Здравствуйте! Подскажу безалкогольный напиток под блюдо или настроение. Спросите или выберите подсказку ниже.';
    }
    return this.slug()
      ? 'Здравствуйте! Подскажу, что взять из меню и какой напиток к этому подойдёт. Спросите или выберите подсказку ниже.'
      : 'Здравствуйте! Помогу выбрать сорт под блюдо или настроение. Спросите или выберите подсказку ниже.';
  });

  /**
   * На странице меню кнопка уходит вниз, пока гость листает вниз (иначе она закрывает кнопки карточек
   * у правого края), и возвращается при прокрутке вверх и в начале страницы.
   */
  private readonly onScroll = () => {
    if (this.scrollTicking) return;
    this.scrollTicking = true;
    requestAnimationFrame(() => {
      this.scrollTicking = false;
      const y = window.scrollY;
      const dy = y - this.lastScrollY;
      if (Math.abs(dy) < TUCK_STEP_PX && y > TUCK_AFTER_PX) return;
      this.lastScrollY = y;
      const tuck = dy > 0 && y > TUCK_AFTER_PX;
      if (tuck !== this.tucked()) this.zone.run(() => this.tucked.set(tuck));
    });
  };

  // Открытие и закрытие

  toggle(): void {
    if (this.open()) this.close();
    else this.show();
  }

  show(): void {
    this.open.set(true);
    if (!this.statusRequested) this.loadStatus();
    // Отрисовка идёт после события (eventCoalescing), поэтому ждём её, а не setTimeout.
    // На телефоне клавиатура закрыла бы половину чата, поэтому фокус только на широком экране
    this.afterRender(() => {
      if (window.matchMedia('(min-width: 769px)').matches) this.inputEl()?.nativeElement.focus();
      this.scrollDown();
    });
  }

  close(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.afterRender(() => this.fab()?.nativeElement.focus());
  }

  /** Escape закрывает чат, но не когда открыт лист стола или корзины: там Escape закрывает его. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (document.querySelector('dialog[open]')) return;
    this.close();
  }

  // Сообщения

  onSubmit(e: Event): void {
    e.preventDefault();
    this.send(this.input());
  }

  send(text: string): void {
    const q = (text || '').trim();
    if (!q || this.busy()) return;
    this.input.set('');
    this.error.set('');
    this.push({ role: 'user', content: q.slice(0, MAX_CHARS) });
    this.ask();
  }

  /** Повтор после ошибки: вопрос гостя уже в истории, заново его не добавляем. */
  retry(): void {
    if (this.busy()) return;
    this.error.set('');
    this.ask();
  }

  togglePref(key: keyof AiPrefs): void {
    this.prefs.update(p => ({ ...p, [key]: !p[key] }));
    this.persist();
  }

  clearHistory(): void {
    this.messages.set([]);
    this.safetyFlags = [];
    this.error.set('');
    this.added.set({});
    this.persist();
  }

  private ask(): void {
    const turns = lastTurns(this.messages());
    if (!turns.length || turns[turns.length - 1].role !== 'user') return;
    const key = this.currentKey;
    const slug = this.slug();
    const table = this.selection.tableNumber();
    const p = this.prefs();
    // Гость ответил, что ему нет 21: флаг minor держит весь разговор без алкоголя, пива 0.0 и энергетиков
    const minor = this.under21();
    const body: AiRequest = {
      venue: slug,
      session: this.track.session,
      table: table && table > 0 ? table : null,
      messages: turns,
      prefs: { no_bitter: !!p.no_bitter, light: !!p.light, no_alcohol: !!p.no_alcohol || minor },
    };
    const flags = minor ? Array.from(new Set([...this.safetyFlags, 'minor'])) : this.safetyFlags;
    if (flags.length) body.safety_flags = [...flags];
    if (slug) {
      const cart = readCart(slug);
      if (cart.length) body.cart = cart.map(l => ({ kind: l.kind, id: l.id, title: l.title, qty: l.qty }));
    }

    this.busy.set(true);
    this.api.askSommelier(body).pipe(timeout(REQUEST_TIMEOUT_MS), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: r => {
        this.busy.set(false);
        // Пока ждали, гость открыл другое заведение: ответ относится к прошлой истории
        if (key !== this.currentKey) return;
        const flags = Array.isArray(r?.safety_flags) ? r.safety_flags : [];
        this.safetyFlags = Array.from(new Set([...this.safetyFlags, ...flags]));
        this.push({
          role: 'assistant',
          content: (r?.reply || '').trim() || 'Не нашёл, что посоветовать. Попробуйте спросить иначе.',
          suggestions: Array.isArray(r?.suggestions) ? r.suggestions : [],
          mode: r?.mode,
          note: r?.note || '',
          safety: r?.safety || '',
          disclaimer: r?.disclaimer || '',
          venue: slug,
        });
      },
      error: (err: unknown) => {
        this.busy.set(false);
        if (key !== this.currentKey) return;
        this.error.set(this.errorText(err));
      },
    });
  }

  private errorText(err: unknown): string {
    if (err instanceof TimeoutError) return 'Сомелье долго не отвечает. Попробуйте ещё раз.';
    if (err instanceof HttpErrorResponse) {
      if (err.status === 429) return 'Слишком много вопросов подряд. Подождите минуту и повторите.';
      if (err.status === 404) return 'Сомелье пока недоступен на сервере.';
    }
    return AuthService.errorText(err);
  }

  private push(m: ChatMessage): void {
    this.messages.update(list => [...list, m]);
    this.persist();
  }

  private persist(): void {
    writeHistory(this.currentKey, { messages: this.messages(), prefs: this.prefs(), flags: this.safetyFlags });
  }

  private switchHistory(key: string): void {
    if (key === this.currentKey && this.historyLoaded) return;
    this.historyLoaded = true;
    this.currentKey = key;
    const saved = readHistory(key);
    this.messages.set(saved?.messages ?? []);
    this.prefs.set(saved?.prefs ?? { ...EMPTY_PREFS });
    this.safetyFlags = saved?.flags ?? [];
    this.error.set('');
    this.added.set({});
  }

  // Карточки

  /**
   * Карточки ответа или null, если показывать нечего. Гостю младше 21 алкогольные карточки не показываем,
   * даже из старых ответов этого чата: напиток должен быть безалкогольным и (если меню загружено) в его карте.
   */
  cardsOf(m: ChatMessage): AiSuggestion[] | null {
    let cards = m.suggestions ?? [];
    if (this.under21()) {
      const menu = this.venueMenu();
      cards = cards.filter(s => s.kind !== 'DRINK'
        || (s.is_alcoholic === false && (!menu || !m.venue || this.drinks().has(s.id))));
    }
    return cards.length ? cards : null;
  }

  /** «В заказ» есть только для ответа по заведению, которое открыто сейчас. */
  canOrder(m: ChatMessage): boolean {
    const slug = this.slug();
    return !!slug && m.venue === slug;
  }

  /** Без заведения у напитка есть страница, только если за ним стоит сорт каталога. */
  canOpen(m: ChatMessage, s: AiSuggestion): boolean {
    return !m.venue && s.kind === 'DRINK' && !!s.brand;
  }

  /** Подпись под ответом: кто отвечал. */
  modeCaption(m: ChatMessage): string {
    if (m.safety) {
      // Флаг из прошлых реплик в режиме Claude: ответ писала модель, но без алкоголя
      return m.mode === 'claude' ? 'Ответ: ИИ Claude, без алкоголя' : 'Ответ по правилам безопасности: без алкоголя';
    }
    return m.mode === 'claude' ? 'Ответ: ИИ Claude' : 'Ответ по вкусовому движку Flavor Tree';
  }

  /** Меню загружено и позиции в нём нет или она снята: класть в заказ нельзя. */
  isAvailable(s: AiSuggestion): boolean {
    if (!this.venueMenu()) return true;
    const row = s.kind === 'DISH' ? this.entries().get(s.id) : this.drinks().get(s.id);
    return !!row?.is_available;
  }

  /** Сорт каталога за напитком карты бара, чтобы дать ссылку «О напитке». */
  brandIdOf(s: AiSuggestion): string | null {
    return s.kind === 'DRINK' ? s.brand ?? this.drinks().get(s.id)?.brand ?? null : null;
  }

  isAdded(s: AiSuggestion): boolean {
    return !!this.added()[`${s.kind}:${s.id}`];
  }

  /** Название блюда, к которому предложен напиток: из этого же ответа или из меню. */
  pairedTitle(m: ChatMessage, s: AiSuggestion): string | null {
    if (!s.pairs_with || s.kind !== 'DRINK') return null;
    const inReply = m.suggestions?.find(x => x.kind === 'DISH' && x.id === s.pairs_with);
    if (inReply) return inReply.title;
    return this.entries().get(s.pairs_with)?.dish.name ?? null;
  }

  addToOrder(m: ChatMessage, s: AiSuggestion, index: number): void {
    const slug = this.slug();
    if (!slug || !this.isAvailable(s)) return;
    // Гостю младше 21 алкоголь в заказ не кладём (страница меню его тоже уберёт из корзины)
    if (this.under21() && s.kind === 'DRINK' && s.is_alcoholic !== false) return;
    // Метка источника уходит в заказ: страница меню отправит source, paired_with и rank
    const line: Omit<CartLine, 'qty'> & AiCartMeta = {
      ...this.lineFor(s),
      source: 'AI',
      pairedWith: s.kind === 'DRINK' && s.pairs_with ? s.pairs_with : undefined,
      rank: index + 1,
    };
    addToCart(slug, line);
    notifyCartChanged(slug);
    this.trackAdd(slug, m, s, index + 1);
    const key = `${s.kind}:${s.id}`;
    this.added.update(a => ({ ...a, [key]: true }));
    if (this.addedTimers[key]) clearTimeout(this.addedTimers[key]);
    this.addedTimers[key] = setTimeout(() => {
      this.added.update(a => ({ ...a, [key]: false }));
      delete this.addedTimers[key];
    }, ADDED_FLASH_MS);
  }

  /**
   * Событие пилота AI_ADD: гость положил карточку сомелье в заказ. Уходит через общую очередь
   * TrackService: при плохой сети не теряется, повтор сервер узнает по cid.
   */
  private trackAdd(slug: string, m: ChatMessage, s: AiSuggestion, rank: number): void {
    this.track.track('AI_ADD', slug, {
      ...(s.kind === 'DISH' ? { menu_item: s.id } : { menu_drink: s.id }),
      dish_ref: s.kind === 'DRINK' ? s.pairs_with || '' : s.id,
      rank,
      source: 'AI',
      table: this.selection.tableNumber() || null,
      meta: { mode: m.mode || '', safety: m.safety || '', ...(this.under21() ? { age: 'under21' } : {}) },
    });
  }

  openBrandPage(brandId: string): void {
    this.selection.open(brandId);
    this.openBrand.emit(brandId);
    this.close();
  }

  /** Строка корзины из меню; если меню не загрузилось, цену и объём берём из подписи карточки. */
  private lineFor(s: AiSuggestion): Omit<CartLine, 'qty'> {
    if (s.kind === 'DISH') {
      const e = this.entries().get(s.id);
      if (e) return { kind: 'DISH', id: e.id, title: e.dish.name, sub: e.portion || '', price: e.price };
    } else {
      const d = this.drinks().get(s.id);
      if (d) return { kind: 'DRINK', id: d.id, title: d.brand_name, sub: d.volume || '', price: d.price };
    }
    return { kind: s.kind, id: s.id, title: s.title, sub: subFromSubtitle(s.subtitle), price: priceFromSubtitle(s.subtitle) };
  }

  // Загрузка

  private loadStatus(): void {
    this.statusRequested = true;
    this.api.getAiStatus().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: s => this.status.set(s),
      error: () => this.status.set({ enabled: false, model: '', mode: 'local' }),
    });
  }

  private loadMenu(slug: string): void {
    const under21 = this.age.under21();
    this.menuSlug = slug;
    this.menuUnder21 = under21;
    // Меню прошлого заведения не подходит для цен и наличия нового
    this.venueMenu.set(null);
    this.api.getVenueMenu(slug, under21).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: m => {
        if (this.menuSlug === slug && this.menuUnder21 === under21) this.venueMenu.set(m);
      },
      error: () => {
        // Без меню карточки работают по подписи, а первая подсказка остаётся общей
        if (this.menuSlug === slug && this.menuUnder21 === under21) this.venueMenu.set(null);
      },
    });
  }

  private scrollDown(): void {
    this.afterRender(() => {
      const el = this.list()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  /** Выполнить после ближайшей отрисовки: к этому моменту @if уже вставил элементы в DOM. */
  private afterRender(fn: () => void): void {
    afterNextRender(fn, { injector: this.injector });
  }
}

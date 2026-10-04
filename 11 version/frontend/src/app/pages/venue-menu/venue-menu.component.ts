import {
  Component, DestroyRef, ElementRef, EventEmitter, OnDestroy, Output, computed, effect, inject, signal, untracked, viewChild
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { SelectionService } from '../../services/selection.service';
import {
  Brand, Dish, FoodPairing, MenuDrink, MenuEntry, MenuPairing, ORDER_FLOW, ORDER_STATUS_LABELS, Order, OrderInput,
  OrderItem, OrderItemKind, OrderStatus, OrderVia, PAIRING_LABELS, PairingType, Venue, VenueMenu, VenueType, isOrderClosed
} from '../../models/flavor-tree.models';
import { DishProfile, Recommendation, recommend, smallImage } from '../landing/pairing-engine.data';
import { countOf, plural } from './plural';
import { WaiterSheetComponent } from './waiter-sheet.component';
import {
  CART_CHANGED_EVENT, CartLine, MAX_QTY, cartKey, deviceId, notifyCartChanged, orderKey, readCart, readJson, writeCart,
  writeJson
} from './cart-storage';

const VENUE_LABEL: Record<VenueType, string> = {
  BAR: 'Бар', RESTAURANT: 'Ресторан', PUB: 'Паб', CAFE: 'Кафе', OTHER: 'Заведение',
};

/** Шаги на экране заказа; закрытие и отмена показываем отдельно. */
const TIMELINE: readonly OrderStatus[] = ['NEW', 'ACCEPTED', 'COOKING', 'SERVED'];
const ORDER_HINT: Record<OrderStatus, string> = {
  NEW: 'Заказ ушёл в заведение. Как только его примут, статус обновится.',
  ACCEPTED: 'Заведение приняло заказ и скоро начнёт готовить.',
  COOKING: 'Уже готовим. Осталось немного.',
  SERVED: 'Заказ подан. Приятного аппетита!',
  DONE: 'Заказ закрыт. Спасибо, что были у нас.',
  CANCELLED: 'Заказ отменён. Если это ошибка, позовите официанта.',
};

const POLL_MS = 15000;
/** Поданный заказ гость видит ещё три часа, любой другой - сутки: дальше страница открывает меню, а не старый заказ. */
const SERVED_TTL_MS = 3 * 60 * 60 * 1000;
const ORDER_TTL_MS = 24 * 60 * 60 * 1000;
/** Псевдораздел в полосе разделов: только карта напитков. */
const DRINKS_SECTION = '__drinks__';

/** Напиток к позиции: выбор сомелье или подбор ИИ с сервера либо расчёт движка. */
export interface MenuRec {
  brandId: string;
  name: string;
  style: string;
  abv: number | null;
  image: string | null;
  rating: number;
  type: PairingType;
  explanation: string;
  bySommelier: boolean;
  /** Пару предложил ИИ, сомелье её ещё не подтвердил. */
  byAi: boolean;
  basedOn?: string;
  /** Позиция карты бара с этим сортом; null - сорта в карте нет. */
  drink: MenuDrink | null;
  /** id пары в каталоге; у расчёта движка его нет. */
  pairingId?: string;
}

/** Сочетание из заказа гостя, которое можно оценить: блюдо и напиток из пары каталога. */
interface OrderPair {
  pairingId: string;
  dish: string;
  drink: string;
}

export interface MenuRow extends MenuEntry {
  rec: MenuRec | null;
  alts: MenuRec[];
}

export interface MenuSection {
  name: string;
  items: MenuRow[];
}

interface StoredOrder {
  id: string;
  token: string;
  /** Когда заказ отправлен, мс по часам гостя. У записей старого формата поля нет. */
  at?: number;
}

interface TimelineStep {
  label: string;
  done: boolean;
  current: boolean;
}

/**
 * Публичное электронное меню и заказ со стола.
 *
 * Гость открывает его по QR со стола, поэтому вёрстка от телефона:
 * одна колонка, липкая полоса со столом и корзиной, крупные фото блюд.
 * Без выбранного заведения показывает список опубликованных заведений.
 * Стол, корзина и последний заказ хранятся в localStorage для каждого заведения.
 */
@Component({
  selector: 'app-venue-menu',
  standalone: true,
  imports: [NgTemplateOutlet, WaiterSheetComponent],
  template: `
    <!-- Кружка пива: lucide beer -->
    <ng-template #mug let-size>
      <svg [attr.width]="size || 20" [attr.height]="size || 20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 11h1a3 3 0 0 1 0 6h-1"/><path d="M9 12v6"/><path d="M13 12v6"/><path d="M14 7.5c-1 0-1.44.5-3 .5s-2-.5-3-.5-1.72.5-2.5.5a2.5 2.5 0 0 1 0-5c.78 0 1.57.5 2.5.5S9.44 2 11 2s2 1.5 3 1.5 1.72-.5 2.5-.5a2.5 2.5 0 0 1 0 5c-.78 0-1.5-.5-2.5-.5Z"/><path d="M5 8v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8"/></svg>
    </ng-template>

    <!-- Степпер напитка: "+ В заказ" или "- n +" -->
    <ng-template #drinkStep let-d let-via="via">
      @if (d.is_available && hasPrice(d.price)) {
        <div class="vm-stepper" [class.vm-stepper-on]="qtyOf('DRINK', d.id) > 0">
          @if (qtyOf('DRINK', d.id) > 0) {
            <button type="button" class="vm-step" (click)="dec('DRINK', d.id)" aria-label="Убрать одну">-</button>
            <span class="vm-step-n" aria-live="polite">{{ qtyOf('DRINK', d.id) }}</span>
            <button type="button" class="vm-step" (click)="addDrink(d, via)" [disabled]="qtyOf('DRINK', d.id) >= maxQty" aria-label="Добавить ещё">+</button>
          } @else {
            <button type="button" class="vm-step vm-step-add" (click)="addDrink(d, via)">Добавить в заказ</button>
          }
        </div>
      } @else if (!d.is_available) {
        <span class="badge vm-badge-off">Нет в наличии</span>
      }
    </ng-template>

    @if (slug()) {
      @if (!menuLoaded()) {
        <div class="vm-strip glass-panel-strong">
          <button type="button" class="vm-strip-back" (click)="backToList()" aria-label="Все заведения">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <div class="skeleton-line short" aria-hidden="true"></div>
        </div>
        <div class="vm-skeleton" aria-busy="true" aria-label="Загружаем меню">
          <div class="skeleton-card">
            <div class="skeleton-line"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line"></div>
          </div>
          <div class="skeleton-grid">
            @for (i of skeletonRows; track i) {
              <div class="skeleton-card">
                <div class="skeleton-line"></div>
                <div class="skeleton-line"></div>
                <div class="skeleton-line"></div>
              </div>
            }
          </div>
        </div>
      } @else if (menuError()) {
        <div class="glass-card vm-empty">
          <p class="text-dim">{{ menuError() }}</p>
          <div class="flex items-center justify-center gap-md flex-wrap">
            <button type="button" class="btn-amber btn-sm" (click)="retry()">Повторить</button>
            <button type="button" class="btn-outline" (click)="backToList()">К списку заведений</button>
          </div>
        </div>
      } @else {
        @if (menu(); as m) {
        @if (staff()) {
          <app-waiter-sheet [venue]="m.venue.name" [sections]="sections()" [priceLabel]="priceText" (exit)="closeStaff()" />
        } @else if (step() === 'order') {
          <!-- Экран заказа -->
          <section class="vm-order">
            @if (!orderLoaded()) {
              <div class="skeleton-card" aria-busy="true" aria-label="Загружаем заказ">
                <div class="skeleton-line"></div>
                <div class="skeleton-line"></div>
                <div class="skeleton-line"></div>
              </div>
            } @else {
            @if (order(); as o) {
              <div class="glass-panel vm-order-card">
                <div class="vm-order-head">
                  <span class="badge" [class.badge-success]="o.status === 'SERVED' || o.status === 'DONE'" [class.vm-badge-cancel]="o.status === 'CANCELLED'">{{ statusLabel(o.status) }}</span>
                  <span class="text-xs text-muted">{{ m.venue.name }}</span>
                </div>
                <h1 class="vm-order-title">{{ orderTitle() }}</h1>
                <p class="text-dim vm-order-hint">{{ orderHint() }}</p>

                @if (o.status !== 'CANCELLED') {
                  <ol class="vm-timeline" aria-label="Статус заказа">
                    @for (s of timeline(); track s.label) {
                      <li [class.done]="s.done" [class.current]="s.current" [attr.aria-current]="s.current ? 'step' : null">
                        <span class="vm-tl-dot" aria-hidden="true"></span>
                        <span>{{ s.label }}</span>
                      </li>
                    }
                  </ol>
                }

                <ul class="vm-order-items">
                  @for (i of o.items; track $index) {
                    <li class="vm-order-item">
                      <span class="vm-order-qty">{{ i.qty }} x</span>
                      <span class="vm-order-item-title">{{ i.title }}@if (i.note) { <span class="text-xs text-muted">{{ i.note }}</span> }</span>
                      <span class="vm-order-item-sum">{{ price(itemSum(i)) }}</span>
                    </li>
                  }
                </ul>

                <dl class="vm-order-facts">
                  <div><dt>Стол</dt><dd>{{ tableText(o.table_number) }}</dd></div>
                  @if (o.guest_name) { <div><dt>Имя</dt><dd>{{ o.guest_name }}</dd></div> }
                  <div><dt>Итого</dt><dd class="vm-total-sum">{{ price(o.total) }}</dd></div>
                </dl>
                @if (o.comment) { <p class="vm-order-comment text-sm text-dim">{{ o.comment }}</p> }
                @if (orderError()) { <p class="vm-form-error">{{ orderError() }}</p> }

                @if (orderPairs().length && o.status !== 'CANCELLED') {
                  <div class="vm-vote" role="group" aria-label="Оценка сочетаний">
                    <p class="vm-vote-title">Как вам сочетание?</p>
                    @for (pair of orderPairs(); track pair.pairingId) {
                      <div class="vm-vote-row">
                        <span class="vm-vote-pair">{{ pair.dish }} + {{ pair.drink }}</span>
                        @if (votes()[pair.pairingId] === undefined) {
                          <span class="vm-vote-btns">
                            <button type="button" class="vm-vote-btn" (click)="vote(pair, true)">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>
                              Подошло
                            </button>
                            <button type="button" class="vm-vote-btn" (click)="vote(pair, false)">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>
                              Не подошло
                            </button>
                          </span>
                        } @else {
                          <span class="vm-vote-done" role="status">Спасибо, {{ votes()[pair.pairingId] ? 'записали: подошло' : 'учтём: не подошло' }}</span>
                        }
                      </div>
                    }
                    <p class="text-xs text-muted">Оценки видит сомелье: так пары в меню становятся точнее.</p>
                  </div>
                }

                <div class="vm-order-actions">
                  <button type="button" class="btn-amber" (click)="backToMenu()">Вернуться к меню</button>
                  <button type="button" class="btn-outline" (click)="repeatOrder()">Повторить заказ</button>
                </div>
                @if (!closed(o)) { <p class="text-xs text-muted">Статус обновляется сам каждые 15 секунд.</p> }
              </div>
            } @else {
              <div class="glass-card vm-empty">
                <p class="text-dim">{{ orderError() || 'Не удалось открыть заказ.' }}</p>
                <div class="flex items-center justify-center gap-md flex-wrap">
                  <button type="button" class="btn-amber btn-sm" (click)="refreshOrder()">Повторить</button>
                  <button type="button" class="btn-outline" (click)="backToMenu()">К меню</button>
                </div>
              </div>
            }
            }
          </section>
        } @else {
        <div class="vm-page">
          <!-- Липкая полоса: назад, название, стол, корзина -->
          <div class="vm-strip glass-panel-strong">
            <button type="button" class="vm-strip-back" (click)="backToList()" aria-label="Все заведения" title="Все заведения">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <span class="vm-strip-name">{{ m.venue.name }}</span>
            @if (order(); as o) {
              @if (!closed(o)) {
                <button type="button" class="vm-chip vm-chip-order" (click)="openOrder()" [attr.aria-label]="'Заказ ' + o.number + ', ' + statusLabel(o.status)">
                  <span class="vm-chip-dot" aria-hidden="true"></span>
                  <span class="vm-chip-text">№{{ o.number }}<span class="vm-chip-status"> · {{ statusLabel(o.status) }}</span></span>
                </button>
              }
            }
            <button type="button" class="vm-chip" [class.vm-chip-empty]="tableNumber() === null" (click)="openTable()">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10h18"/><path d="M5 10v8"/><path d="M19 10v8"/><path d="M8 10V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4"/></svg>
              <span class="vm-chip-text">{{ tableLabel() }}</span>
            </button>
            <button type="button" class="vm-cart-btn" (click)="openCart()" [attr.aria-label]="'Корзина: ' + countOf(cartCount(), 'позиция', 'позиции', 'позиций')">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
              @if (cartCount() > 0) { <span class="vm-cart-n">{{ cartCount() }}</span> }
            </button>
          </div>

          @if (orderNote()) {
            <div class="vm-note" role="status">
              <span>{{ orderNote() }}</span>
              <button type="button" class="btn-ghost vm-note-close" (click)="orderNote.set('')" aria-label="Скрыть">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
          }

          <section class="glass-panel vm-hero" [class.vm-hero-cover]="!!m.venue.cover" [style.--vm-cover]="m.venue.cover ? 'url(' + m.venue.cover + ')' : null">
            <div class="vm-logo vm-hero-logo" aria-hidden="true">
              @if (m.venue.logo) {
                <img [src]="m.venue.logo" alt="" />
              } @else {
                <span>{{ initial(m.venue) }}</span>
              }
            </div>
            <div class="vm-hero-body">
              <span class="badge">{{ venueType(m.venue) }}</span>
              <h1 class="vm-title">{{ m.venue.name }}</h1>
              @if (m.venue.description) { <p class="vm-desc text-dim">{{ m.venue.description }}</p> }
              <button type="button" class="vm-link vm-staff-link" (click)="openStaff()">
                Шпаргалка официанта
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
              </button>
              <ul class="vm-facts">
                @if (m.venue.address) {
                  <li>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                    <span>{{ venueLine(m.venue) }}</span>
                  </li>
                }
                @if (m.venue.working_hours) {
                  <li>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    <span>{{ m.venue.working_hours }}</span>
                  </li>
                }
                @if (m.venue.phone) {
                  <li>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                    <a [href]="telHref(m.venue.phone)">{{ m.venue.phone }}</a>
                  </li>
                }
              </ul>
            </div>
          </section>

          @if (sections().length || drinks().length) {
            <nav class="vm-pills" aria-label="Разделы меню">
              <button type="button" class="vm-pill" [class.active]="activeSection() === ''" (click)="selectSection('')">
                Все <span class="vm-pill-n">{{ totalItems() + drinks().length }}</span>
              </button>
              @for (s of sectionNames(); track s.name) {
                <button type="button" class="vm-pill" [class.active]="activeSection() === s.name" (click)="selectSection(s.name)">
                  {{ s.name }} <span class="vm-pill-n">{{ s.count }}</span>
                </button>
              }
              @if (drinks().length) {
                <button type="button" class="vm-pill" [class.active]="activeSection() === drinksSection" (click)="selectSection(drinksSection)">
                  Напитки <span class="vm-pill-n">{{ drinks().length }}</span>
                </button>
              }
            </nav>

            @for (s of visibleSections(); track s.name) {
              <section class="vm-section">
                <h2 class="vm-section-title">{{ s.name }}</h2>
                <div class="vm-items">
                  @for (it of s.items; track it.id) {
                    <article class="glass-card vm-dish" [class.vm-item-off]="!it.is_available">
                      <div class="vm-dish-photo">
                        @if (it.dish.image) {
                          <img [src]="it.dish.image" alt="" loading="lazy" />
                        } @else {
                          <span class="vm-dish-initial" aria-hidden="true">{{ initialOf(it.dish.name) }}</span>
                        }
                        @if (!it.is_available) { <span class="badge badge-dark vm-dish-off">Нет в наличии</span> }
                      </div>
                      <div class="vm-dish-body">
                        <div class="vm-item-head">
                          <h3 class="vm-dish-name">{{ it.dish.name }}</h3>
                          <span class="vm-price" [class.vm-price-ask]="!hasPrice(it.price)">{{ priceLabel(it.price) }}</span>
                        </div>
                        @if (it.portion || it.dish.cuisine_display) {
                          <div class="vm-item-meta">
                            @if (it.portion) { <span class="text-xs text-muted">{{ it.portion }}</span> }
                            @if (it.dish.cuisine_display) { <span class="text-xs text-muted">{{ it.dish.cuisine_display }}</span> }
                          </div>
                        }
                        @if (it.dish.description) { <p class="vm-dish-desc text-sm text-dim">{{ it.dish.description }}</p> }
                        @if (it.chef_note) {
                          <p class="vm-chef">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z"/><line x1="6" x2="18" y1="17" y2="17"/></svg>
                            <span>{{ it.chef_note }}</span>
                          </p>
                        }
                        <div class="vm-actions">
                          @if (it.is_available && hasPrice(it.price)) {
                            <div class="vm-stepper" [class.vm-stepper-on]="qtyOf('DISH', it.id) > 0">
                              @if (qtyOf('DISH', it.id) > 0) {
                                <button type="button" class="vm-step" (click)="dec('DISH', it.id)" aria-label="Убрать одну">-</button>
                                <span class="vm-step-n" aria-live="polite">{{ qtyOf('DISH', it.id) }}</span>
                                <button type="button" class="vm-step" (click)="addDish(it)" [disabled]="qtyOf('DISH', it.id) >= maxQty" aria-label="Добавить ещё">+</button>
                              } @else {
                                <button type="button" class="vm-step vm-step-add" (click)="addDish(it)">+ В заказ</button>
                              }
                            </div>
                          } @else if (!it.is_available) {
                            <span class="text-xs text-muted">Сегодня не готовим</span>
                          }
                          <button type="button" class="vm-rec-toggle" [class.active]="isOpen(it.id)" (click)="toggleRec(it.id)" [attr.aria-expanded]="isOpen(it.id)">
                            <ng-container *ngTemplateOutlet="mug; context: { $implicit: 18 }" />
                            Подобрать напиток
                            <svg class="vm-rec-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                          </button>
                        </div>
                      </div>

                      @if (isOpen(it.id)) {
                        <div class="vm-rec-panel">
                          @if (it.rec; as r) {
                            <div class="vm-rec">
                              <div class="vm-rec-thumb" aria-hidden="true">
                                @if (r.image) {
                                  <img [src]="r.image" alt="" loading="lazy" />
                                } @else {
                                  <ng-container *ngTemplateOutlet="mug; context: { $implicit: 28 }" />
                                }
                              </div>
                              <div class="vm-rec-body">
                                <div class="vm-rec-top">
                                  <span class="vm-rec-kind" [class.vm-rec-engine]="!r.bySommelier">{{ recKind(r) }}</span>
                                  <span class="badge">{{ label(r.type) }}</span>
                                </div>
                                <p class="vm-rec-name">
                                  {{ r.name }}
                                  <span class="text-muted">{{ r.style }}@if (r.abv) { · {{ r.abv }}% }</span>
                                </p>
                                <div class="vm-score" role="img" [attr.aria-label]="'Совместимость ' + r.rating + ' из 5'">
                                  @for (p of pips; track p) {
                                    <span class="vm-pip" [class.on]="p <= r.rating"></span>
                                  }
                                  <span class="vm-score-num">{{ r.rating }}/5</span>
                                </div>
                                @if (r.explanation) { <p class="vm-rec-text text-sm text-dim">{{ r.explanation }}</p> }
                                @if (!r.bySommelier && r.basedOn && r.basedOn !== it.dish.name) {
                                  <p class="text-xs text-muted">По похожему блюду «{{ r.basedOn }}»</p>
                                }
                                @if (r.drink; as d) {
                                  <div class="vm-rec-buy">
                                    <span class="vm-price" [class.vm-price-ask]="!hasPrice(d.price)">{{ priceLabel(d.price) }}</span>
                                    @if (d.volume) { <span class="text-xs text-muted">{{ d.volume }}</span> }
                                    <ng-container *ngTemplateOutlet="drinkStep; context: { $implicit: d, via: 'PAIRING' }" />
                                  </div>
                                } @else {
                                  <p class="vm-rec-missing text-sm">Этого сорта нет в карте бара.</p>
                                }
                                <button type="button" class="vm-link" (click)="openDrink(r.brandId)">
                                  О напитке
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                                </button>
                              </div>
                            </div>
                            @if (it.alts.length) {
                              <p class="vm-alts-title">{{ r.drink ? 'Ещё из карты бара' : 'Есть в карте бара' }}</p>
                              <ul class="vm-alts">
                                @for (a of it.alts; track a.brandId) {
                                  <li class="vm-alt">
                                    <div class="vm-alt-thumb" aria-hidden="true">
                                      @if (a.image) {
                                        <img [src]="a.image" alt="" loading="lazy" />
                                      } @else {
                                        <ng-container *ngTemplateOutlet="mug; context: { $implicit: 20 }" />
                                      }
                                    </div>
                                    <div class="vm-alt-body">
                                      <button type="button" class="vm-alt-name" (click)="openDrink(a.brandId)" title="О напитке">{{ a.name }}</button>
                                      <span class="text-xs text-muted">{{ a.style }}@if (a.abv) { · {{ a.abv }}% } · {{ label(a.type) }} · {{ a.rating }}/5</span>
                                      @if (a.drink; as d) {
                                        <div class="vm-rec-buy">
                                          <span class="vm-price" [class.vm-price-ask]="!hasPrice(d.price)">{{ priceLabel(d.price) }}</span>
                                          @if (d.volume) { <span class="text-xs text-muted">{{ d.volume }}</span> }
                                          <ng-container *ngTemplateOutlet="drinkStep; context: { $implicit: d, via: 'PAIRING' }" />
                                        </div>
                                      }
                                    </div>
                                  </li>
                                }
                              </ul>
                            }
                          } @else if (engineLoaded()) {
                            <p class="vm-rec-none text-sm text-muted">Напиток к этому блюду ещё не подобран. Загляните в карту напитков ниже.</p>
                          } @else {
                            <p class="vm-rec-none text-sm text-muted">Подбираем напиток...</p>
                          }
                        </div>
                      }
                    </article>
                  }
                </div>
              </section>
            }

            @if (showDrinks()) {
              <section class="vm-section">
                <h2 class="vm-section-title">Напитки бара</h2>
                <div class="vm-drinks">
                  @for (d of drinks(); track d.id) {
                    <article class="glass-card vm-drink" [class.vm-item-off]="!d.is_available">
                      <div class="vm-drink-thumb" aria-hidden="true">
                        @if (d.brand_image) {
                          <img [src]="d.brand_image" alt="" loading="lazy" />
                        } @else {
                          <ng-container *ngTemplateOutlet="mug; context: { $implicit: 26 }" />
                        }
                      </div>
                      <div class="vm-drink-body">
                        <button type="button" class="vm-drink-name" (click)="openDrink(d.brand)" title="О напитке">{{ d.brand_name }}</button>
                        <p class="text-xs text-muted vm-drink-meta">{{ d.brand_style }}@if (d.abv) { · {{ d.abv }}% }@if (d.volume) { · {{ d.volume }} }</p>
                        <div class="vm-drink-foot">
                          <span class="vm-price" [class.vm-price-ask]="!hasPrice(d.price)">{{ priceLabel(d.price) }}</span>
                          <ng-container *ngTemplateOutlet="drinkStep; context: { $implicit: d }" />
                        </div>
                      </div>
                    </article>
                  }
                </div>
              </section>
            }
          } @else {
            <div class="glass-card vm-empty">
              <p class="text-dim">Меню пока пустое.</p>
              <p class="text-sm text-muted">Заведение ещё не добавило блюда.</p>
            </div>
          }

          <section class="glass-panel vm-share">
            <div>
              <h2 class="vm-share-title">Поделиться меню</h2>
              <p class="text-sm text-muted">Ссылку можно отправить гостям или вывести в QR-код на столе.</p>
            </div>
            <div class="vm-share-row">
              <input class="input vm-share-url" type="text" readonly [value]="shareUrl()" (focus)="$any($event.target).select()" aria-label="Ссылка на меню" />
              <button type="button" class="btn-amber btn-sm" (click)="copyLink()">
                @if (copied()) {
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                  Скопировано
                } @else {
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                  Скопировать ссылку
                }
              </button>
            </div>
          </section>

          <!-- Нижняя полоса корзины -->
          @if (cartCount() > 0) {
            <div class="vm-cart-bar" role="region" aria-label="Корзина">
              <button type="button" class="vm-cart-bar-info" (click)="openCart()">
                <span class="vm-cart-bar-n">{{ countOf(cartCount(), 'позиция', 'позиции', 'позиций') }}</span>
                <span class="vm-cart-bar-sum">{{ price(cartTotal()) }}</span>
              </button>
              <button type="button" class="btn-amber btn-sm vm-cart-bar-go" (click)="openCart()">Оформить</button>
            </div>
          }
        </div>
        }

        <!-- Выбор стола: native dialog в top layer, его не ломает transform обёртки страницы.
             Отступы и ручка лежат на .vm-sheet-body, поэтому клик по самому dialog приходит только с подложки -->
        <dialog #tableDlg class="vm-sheet" aria-labelledby="vm-table-title" (close)="tableOpen.set(false)" (click)="onBackdropClick($event, 'table')">
          <div class="vm-sheet-body">
            @if (tableOpen()) {
              <div class="vm-sheet-head">
                <div>
                  <h2 id="vm-table-title" class="vm-sheet-title">Какой у вас стол?</h2>
                  <p class="text-sm text-muted">Номер есть на табличке или в QR-коде на столе.</p>
                </div>
                <button type="button" class="btn-ghost vm-sheet-close" (click)="closeTable()" aria-label="Закрыть">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
              <div class="vm-table-grid">
                @for (n of tableGrid(); track n) {
                  <button type="button" class="vm-table-cell" [class.active]="tableNumber() === n" (click)="pickTable(n)" [attr.aria-pressed]="tableNumber() === n">{{ n }}</button>
                }
              </div>
              <button type="button" class="vm-table-takeaway" [class.active]="tableNumber() === 0" (click)="pickTable(0)" [attr.aria-pressed]="tableNumber() === 0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
                Без стола (с собой)
              </button>
            }
          </div>
        </dialog>

        <!-- Корзина -->
        <dialog #cartDlg class="vm-sheet" aria-labelledby="vm-cart-title" (close)="closeCart()" (click)="onBackdropClick($event, 'cart')">
          <div class="vm-sheet-body">
            @if (cartOpen()) {
              <div class="vm-sheet-head">
                <h2 id="vm-cart-title" class="vm-sheet-title">Ваш заказ</h2>
                <button type="button" class="btn-ghost vm-sheet-close" (click)="closeCart()" aria-label="Закрыть">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
              @if (cart().length) {
                <ul class="vm-cart-lines">
                  @for (l of cart(); track l.kind + l.id) {
                    <li class="vm-cart-line">
                      <div class="vm-cart-line-body">
                        <span class="vm-cart-line-title">{{ l.title }}</span>
                        <span class="text-xs text-muted">{{ lineMeta(l) }}</span>
                      </div>
                      <div class="vm-stepper vm-stepper-on vm-stepper-sm">
                        <button type="button" class="vm-step" (click)="dec(l.kind, l.id)" aria-label="Убрать одну">-</button>
                        <span class="vm-step-n">{{ l.qty }}</span>
                        <button type="button" class="vm-step" (click)="inc(l.kind, l.id)" [disabled]="l.qty >= maxQty" aria-label="Добавить ещё">+</button>
                      </div>
                      <span class="vm-cart-line-sum">{{ price(lineSum(l)) }}</span>
                      <button type="button" class="btn-ghost vm-cart-remove" (click)="remove(l)" aria-label="Убрать из заказа">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                      </button>
                    </li>
                  }
                </ul>

                <div class="vm-cart-table">
                  <span class="text-sm text-dim">Куда нести</span>
                  <button type="button" class="vm-chip" [class.vm-chip-empty]="tableNumber() === null" (click)="openTable()">{{ tableLabel() }}</button>
                </div>
                @if (tableHint()) { <p class="vm-form-error">Выберите стол, чтобы мы знали, куда нести заказ.</p> }

                <label class="vm-field">
                  <span>Ваше имя <em>необязательно</em></span>
                  <input class="input" type="text" maxlength="80" placeholder="Как к вам обращаться" [value]="guestName()" (input)="guestName.set($any($event.target).value)" />
                </label>
                <label class="vm-field">
                  <span>Комментарий к заказу</span>
                  <textarea class="input" rows="2" maxlength="500" placeholder="Без лука, поострее, принести всё сразу..." [value]="comment()" (input)="comment.set($any($event.target).value)"></textarea>
                </label>
                @if (sendError()) { <p class="vm-form-error" role="alert">{{ sendError() }}</p> }

                @if (cartHasDrinks()) {
                  <!-- Ответственное потребление: в заказе есть алкоголь -->
                  <p class="vm-care">
                    <span class="vm-care-age" aria-hidden="true">21+</span>
                    <span>Официант может попросить документ. За руль после алкоголя не садитесь: вызовите такси или услугу «Трезвый водитель».</span>
                  </p>
                }

                <div class="vm-sheet-foot">
                  <div class="vm-total">
                    <span class="text-sm text-dim">Итого</span>
                    <span class="vm-total-sum">{{ price(cartTotal()) }}</span>
                  </div>
                  <button type="button" class="btn-amber btn-block" (click)="send()" [disabled]="sending()">{{ sending() ? 'Отправляем...' : 'Отправить заказ' }}</button>
                </div>
              } @else {
                @if (sendError()) { <p class="vm-form-error" role="alert">{{ sendError() }}</p> }
                <p class="vm-sheet-empty text-dim">Корзина пуста. Добавьте блюда или напитки из меню.</p>
                <button type="button" class="btn-outline" (click)="closeCart()">К меню</button>
              }
            }
          </div>
        </dialog>
        }
      }
    } @else {
      <header class="vm-head">
        <span class="badge mb-sm">Для гостей</span>
        <h1 class="section-header">Электронное меню</h1>
        <p class="section-subtitle">Блюда заведений, напиток к каждому из них и заказ прямо со стола.</p>
      </header>

      @if (!venuesLoaded()) {
        <div class="skeleton-grid" aria-busy="true" aria-label="Загружаем заведения">
          @for (i of skeletonRows; track i) {
            <div class="skeleton-card">
              <div class="skeleton-line"></div>
              <div class="skeleton-line"></div>
              <div class="skeleton-line"></div>
            </div>
          }
        </div>
      } @else if (venuesError()) {
        <div class="glass-card vm-empty">
          <p class="text-dim">{{ venuesError() }}</p>
          <button type="button" class="btn-amber btn-sm" (click)="retry()">Повторить</button>
        </div>
      } @else if (venues().length) {
        <div class="grid grid-cards-sm">
          @for (v of venues(); track v.id) {
            <article class="glass-card interactive vm-venue" (click)="openVenue(v)">
              <div class="vm-logo vm-venue-logo" aria-hidden="true">
                @if (v.logo) {
                  <img [src]="v.logo" alt="" loading="lazy" />
                } @else {
                  <span>{{ initial(v) }}</span>
                }
              </div>
              <div class="vm-venue-body">
                <div class="flex items-center gap-sm flex-wrap">
                  <span class="badge">{{ venueType(v) }}</span>
                  @if (!v.is_published) { <span class="badge vm-badge-off">Скрыто</span> }
                </div>
                <h2 class="vm-venue-name">{{ v.name }}</h2>
                @if (venueLine(v)) { <p class="text-sm text-muted">{{ venueLine(v) }}</p> }
                <p class="text-xs text-muted">{{ v.items_count ?? 0 }} {{ plural(v.items_count ?? 0, 'позиция', 'позиции', 'позиций') }} в меню</p>
              </div>
              <button type="button" class="btn-amber btn-sm vm-venue-btn" (click)="$event.stopPropagation(); openVenue(v)">Открыть меню</button>
            </article>
          }
        </div>
      } @else {
        <div class="glass-card vm-empty">
          <p class="text-dim">Заведений пока нет.</p>
          <p class="text-sm text-muted">Меню появится, как только заведение опубликует его в панели.</p>
        </div>
      }
    }
  `,
  styles: [`:host { display: block; }`],
})
export class VenueMenuComponent implements OnDestroy {
  private api = inject(ApiService);
  private selection = inject(SelectionService);
  private destroyRef = inject(DestroyRef);
  /** После ngOnDestroy опрос заказа не перезапускаем. */
  private destroyed = false;

  /** Гость нажал «О напитке»: AppComponent открывает страницу сорта. */
  @Output() openBrand = new EventEmitter<string>();

  readonly slug = this.selection.venueSlug;
  /** Режим официанта: вместо меню гостя шпаргалка «блюдо, сорт, фраза». */
  readonly staff = this.selection.staffMode;
  /** Цена для шпаргалки: та же запись, что в меню гостя. */
  readonly priceText = (value: string | number) => this.priceLabel(value);
  /** null - стол не выбран, 0 - с собой. Хранится в SelectionService. */
  readonly tableNumber = this.selection.tableNumber;

  venues = signal<Venue[]>([]);
  /** Пока false - скелет; пустое состояние показываем только после загрузки. */
  venuesLoaded = signal(false);
  venuesError = signal('');

  menu = signal<VenueMenu | null>(null);
  menuLoaded = signal(false);
  menuError = signal('');

  readonly skeletonRows = [1, 2, 3];
  readonly plural = plural;
  readonly countOf = countOf;
  readonly maxQty = MAX_QTY;
  readonly drinksSection = DRINKS_SECTION;
  readonly pips = [1, 2, 3, 4, 5];

  /** Нужны только движку подбора, грузятся при первой позиции без пары. */
  brands = signal<Brand[]>([]);
  pairings = signal<FoodPairing[]>([]);
  /** Список сортов уже пришёл, пусть даже пустой: иначе «Подбираем напиток...» висело бы вечно. */
  engineLoaded = signal(false);
  private engineRequested = false;

  activeSection = signal('');
  copied = signal(false);

  /** Экран внутри заведения: меню или текущий заказ. */
  step = signal<'menu' | 'order'>('menu');
  /** Раскрытые панели «Подобрать напиток» по id позиции. */
  expanded = signal<Record<string, boolean>>({});

  cart = signal<CartLine[]>([]);
  cartOpen = signal(false);
  tableOpen = signal(false);
  tableHint = signal(false);
  guestName = signal('');
  comment = signal('');
  sending = signal(false);
  sendError = signal('');

  order = signal<Order | null>(null);
  /** Оценки сочетаний из текущего заказа: id пары -> подошло или нет. */
  votes = signal<Record<string, boolean>>({});
  orderLoaded = signal(true);
  orderError = signal('');
  /** Короткая заметка над меню: прошлый заказ больше не найден. */
  orderNote = signal('');
  private stored: StoredOrder | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private autoTableTimer: ReturnType<typeof setTimeout> | null = null;
  /** Прокрутку страницы сейчас держит эта страница (открыт лист снизу). */
  private scrollLocked = false;

  /** Листы снизу: native dialog, showModal кладёт их в top layer поверх всего. */
  private readonly tableDlg = viewChild<ElementRef<HTMLDialogElement>>('tableDlg');
  private readonly cartDlg = viewChild<ElementRef<HTMLDialogElement>>('cartDlg');

  constructor() {
    // Заведение можно сменить, не покидая страницу: по ссылке или из панели.
    effect(() => {
      const slug = this.selection.venueSlug();
      untracked(() => slug ? this.loadMenu(slug) : this.showList());
    }, { allowSignalWrites: true });

    // Сигнал открытия управляет самим dialog; Escape закрывает его нативно и шлёт close
    effect(() => this.syncDialog(this.tableDlg()?.nativeElement, this.tableOpen()));
    effect(() => this.syncDialog(this.cartDlg()?.nativeElement, this.cartOpen()));

    // Пока открыт лист снизу, страница под ним не листается
    effect(() => this.lockScroll(this.tableOpen() || this.cartOpen()));

    // ИИ-сомелье кладёт позиции в ту же запись корзины и шлёт это событие
    window.addEventListener(CART_CHANGED_EVENT, this.onCartChanged);
  }

  /** Корзину заведения поменяли снаружи: перечитываем запись и сверяем с меню, чтобы обновилась нижняя полоса. */
  private readonly onCartChanged = (e: Event) => {
    const slug = this.slug();
    const detail = (e as CustomEvent<{ slug?: string }>).detail;
    if (!slug || detail?.slug !== slug) return;
    this.cart.set(readCart(slug));
    const m = this.menu();
    if (m) this.reconcileCart(m);
    // Ответ на заказ, отправленный до ухода со страницы, мог прийти только сейчас
    if (!this.stored) this.restoreOrder(slug);
  };

  /**
   * Блокировка прокрутки страницы: класс на html, потому что overflow на body
   * не срабатывает при overflow-x: clip у html. Тем же классом управляет мобильное
   * меню в AppComponent, поэтому трогаем его только при смене своего состояния.
   */
  private lockScroll(on: boolean): void {
    if (on === this.scrollLocked) return;
    this.scrollLocked = on;
    document.documentElement.classList.toggle('ft-no-scroll', on);
  }

  /**
   * Клик по подложке приходит в сам dialog; клики по содержимому не закрывают лист.
   * Рамка dialog тоже даёт target === dialog, поэтому ещё проверяем, что точка вне его прямоугольника.
   */
  onBackdropClick(e: Event, which: 'table' | 'cart'): void {
    if (e.target !== e.currentTarget) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const { clientX: x, clientY: y } = e as MouseEvent;
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return;
    if (which === 'table') this.closeTable();
    else this.closeCart();
  }

  private syncDialog(dlg: HTMLDialogElement | undefined, open: boolean): void {
    if (!dlg) return;
    if (open && !dlg.open) {
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.setAttribute('open', '');
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopPolling();
    if (this.autoTableTimer) clearTimeout(this.autoTableTimer);
    window.removeEventListener(CART_CHANGED_EVENT, this.onCartChanged);
    this.lockScroll(false);
  }

  readonly drinks = computed<MenuDrink[]>(() => this.menu()?.drinks ?? []);
  private readonly drinkByBrand = computed(() => new Map(this.drinks().map(d => [d.brand, d])));

  readonly sections = computed<MenuSection[]>(() => {
    const m = this.menu();
    if (!m) return [];
    const brands = this.brands();
    const pairings = this.pairings();
    const dishes = m.sections.flatMap(s => s.items.map(i => i.dish));
    const brandById = new Map(brands.map(b => [b.id, b]));
    const drinkByBrand = this.drinkByBrand();
    return m.sections.map(s => ({
      name: s.name,
      items: s.items.map(i => ({ ...i, ...this.recsFor(i, brands, dishes, pairings, brandById, drinkByBrand) })),
    }));
  });

  readonly sectionNames = computed(() => this.sections().map(s => ({ name: s.name, count: s.items.length })));
  readonly totalItems = computed(() => this.sections().reduce((n, s) => n + s.items.length, 0));

  readonly visibleSections = computed(() => {
    const active = this.activeSection();
    const all = this.sections();
    if (!active) return all;
    return active === DRINKS_SECTION ? [] : all.filter(s => s.name === active);
  });

  readonly showDrinks = computed(() => {
    const active = this.activeSection();
    return this.drinks().length > 0 && (!active || active === DRINKS_SECTION);
  });

  /** Столов у заведения: сетка 1..tables_count. */
  readonly tablesCount = computed(() => {
    const n = Number(this.menu()?.venue.tables_count);
    return Number.isInteger(n) && n > 0 ? Math.min(n, 500) : 20;
  });
  readonly tableGrid = computed(() => Array.from({ length: this.tablesCount() }, (_, i) => i + 1));

  readonly tableLabel = computed(() => {
    const t = this.tableNumber();
    return t === null ? 'Выбрать стол' : this.tableText(t);
  });

  private readonly qtyByKey = computed(() => new Map(this.cart().map(l => [`${l.kind}:${l.id}`, l.qty])));
  readonly cartCount = computed(() => this.cart().reduce((n, l) => n + l.qty, 0));
  readonly cartTotal = computed(() => this.cart().reduce((s, l) => s + this.lineSum(l), 0));

  readonly orderTitle = computed(() => {
    const o = this.order();
    if (!o) return '';
    // Новый заказ заведение ещё не приняло: гостю говорим только, что он отправлен
    const tail = o.status === 'CANCELLED' ? 'отменён' : o.status === 'DONE' ? 'закрыт' : o.status === 'NEW' ? 'отправлен' : 'принят';
    return `Заказ №${o.number} ${tail}`;
  });
  readonly orderHint = computed(() => {
    const o = this.order();
    return o ? ORDER_HINT[o.status] ?? '' : '';
  });
  readonly timeline = computed<TimelineStep[]>(() => {
    const o = this.order();
    const idx = o ? ORDER_FLOW.indexOf(o.status) : -1;
    const done = o?.status === 'DONE';
    return TIMELINE.map((s, i) => ({
      label: ORDER_STATUS_LABELS[s],
      done: done || i < idx,
      current: !done && i === idx,
    }));
  });

  /** Адрес меню по карте путей AppComponent: /menu/<slug>. */
  readonly shareUrl = computed(() => {
    const slug = this.selection.venueSlug();
    return `${location.origin}/menu${slug ? '/' + slug : ''}`;
  });

  // Навигация

  openVenue(v: Venue): void {
    this.selection.openVenue(v.slug);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  backToList(): void {
    this.selection.openVenue(null);
  }

  selectSection(name: string): void {
    this.activeSection.set(name);
  }

  openDrink(brandId: string): void {
    this.selection.open(brandId);
    this.openBrand.emit(brandId);
  }

  retry(): void {
    const slug = this.selection.venueSlug();
    if (slug) this.loadMenu(slug);
    else this.loadVenues();
  }

  /** Шпаргалке нужны пары ко всем блюдам, в том числе расчёт движка для блюд без пары сомелье. */
  openStaff(): void {
    this.ensureEngineData();
    this.selection.staffMode.set(true);
    window.scrollTo({ top: 0 });
  }

  closeStaff(): void {
    this.selection.staffMode.set(false);
    window.scrollTo({ top: 0 });
  }

  toggleRec(id: string): void {
    this.expanded.update(e => ({ ...e, [id]: !e[id] }));
    this.ensureEngineData();
  }

  isOpen(id: string): boolean {
    return !!this.expanded()[id];
  }

  // Стол

  openTable(): void {
    this.tableOpen.set(true);
  }

  closeTable(): void {
    this.tableOpen.set(false);
  }

  /** 0 - без стола (с собой). */
  pickTable(n: number): void {
    const slug = this.slug();
    if (!slug) return;
    this.selection.setTable(slug, n);
    this.tableHint.set(false);
    this.tableOpen.set(false);
  }

  tableText(n: number): string {
    return n === 0 ? 'С собой' : `Стол ${n}`;
  }

  // Корзина

  qtyOf(kind: OrderItemKind, id: string): number {
    return this.qtyByKey().get(`${kind}:${id}`) ?? 0;
  }

  addDish(it: MenuEntry): void {
    if (!it.is_available || !this.hasPrice(it.price)) return;
    const first = this.qtyOf('DISH', it.id) === 0;
    this.inc('DISH', it.id, { title: it.dish.name, sub: it.portion || '', price: it.price });
    // Блюдо только что выбрано: это лучший момент показать, что к нему взять из карты бара
    if (first && !this.isOpen(it.id)) this.suggestPair(it.id);
  }

  /** Раскрывает совет к блюду, если пара к нему есть в карте бара и её ещё нет в корзине. */
  private suggestPair(itemId: string): void {
    const row = this.sections().flatMap(sec => sec.items).find(i => i.id === itemId);
    const drink = row?.rec?.drink;
    if (!drink || !drink.is_available || !this.hasPrice(drink.price) || this.qtyOf('DRINK', drink.id) > 0) return;
    this.expanded.update(e => ({ ...e, [itemId]: true }));
  }

  /** via: откуда нажали кнопку. Запоминается при первом добавлении и уходит в заказ для аналитики. */
  addDrink(d: MenuDrink, via: OrderVia = 'MENU'): void {
    if (!d.is_available || !this.hasPrice(d.price)) return;
    this.inc('DRINK', d.id, { title: d.brand_name, sub: d.volume || '', price: d.price, via: via || 'MENU' });
  }

  /** Плюс один; новая строка появляется только если переданы её данные. */
  inc(kind: OrderItemKind, id: string, line?: Pick<CartLine, 'title' | 'sub' | 'price' | 'via'>): void {
    const lines = [...this.cart()];
    const i = lines.findIndex(l => l.kind === kind && l.id === id);
    if (i < 0) {
      if (line) lines.push({ kind, id, qty: 1, ...line });
    } else if (lines[i].qty < MAX_QTY) {
      lines[i] = { ...lines[i], qty: lines[i].qty + 1 };
    }
    this.setCart(lines);
  }

  dec(kind: OrderItemKind, id: string): void {
    const lines = [...this.cart()];
    const i = lines.findIndex(l => l.kind === kind && l.id === id);
    if (i < 0) return;
    if (lines[i].qty <= 1) lines.splice(i, 1);
    else lines[i] = { ...lines[i], qty: lines[i].qty - 1 };
    this.setCart(lines);
  }

  remove(line: CartLine): void {
    this.setCart(this.cart().filter(l => !(l.kind === line.kind && l.id === line.id)));
  }

  /** В корзине есть напиток из карты бара: показываем строку про возраст и руль. */
  readonly cartHasDrinks = computed(() => this.cart().some(l => l.kind === 'DRINK'));

  /** "0,5 л · 1 800 ₸" или просто цена, если объёма нет. */
  lineMeta(l: CartLine): string {
    return [l.sub, this.price(l.price)].filter(Boolean).join(' · ');
  }

  lineSum(l: CartLine): number {
    const p = parseFloat(l.price);
    return isFinite(p) ? p * l.qty : 0;
  }

  itemSum(i: OrderItem): number {
    const p = parseFloat(i.price);
    return isFinite(p) ? p * i.qty : 0;
  }

  openCart(): void {
    this.sendError.set('');
    this.cartOpen.set(true);
  }

  closeCart(): void {
    this.cartOpen.set(false);
    this.tableHint.set(false);
  }

  send(): void {
    const slug = this.slug();
    const table = this.tableNumber();
    if (!slug || !this.cart().length || this.sending()) return;
    if (table === null) {
      this.tableHint.set(true);
      this.tableOpen.set(true);
      return;
    }
    this.sending.set(true);
    this.sendError.set('');
    const body: OrderInput = {
      venue: slug,
      table_number: table,
      items: this.cart().map(l => ({ kind: l.kind, id: l.id, qty: l.qty, ...(l.via && l.via !== 'MENU' ? { via: l.via } : {}) })),
    };
    const name = this.guestName().trim();
    if (name) body.guest_name = name;
    const comment = this.comment().trim();
    if (comment) body.comment = comment;

    // Запрос не привязан к жизни страницы: сервер мог уже создать заказ, и без ответа
    // гость остался бы с полной корзиной и без номера заказа
    this.api.createOrder(body).subscribe({
      next: o => {
        // Заказ создан: запоминаем его и чистим корзину под исходным slug, что бы ни было сейчас на экране
        const stored: StoredOrder = { id: o.id, token: o.guest_token ?? '', at: Date.now() };
        writeJson(orderKey(slug), stored);
        writeCart(slug, []);
        if (this.destroyed || this.slug() !== slug) {
          // Страницу закрыли или открыли другое заведение: если меню этого заведения снова на экране, оно подхватит заказ
          notifyCartChanged(slug);
          return;
        }
        this.sending.set(false);
        this.stored = stored;
        this.cart.set([]);
        this.comment.set('');
        this.cartOpen.set(false);
        this.showOrder(o);
      },
      error: (err: unknown) => {
        if (this.destroyed || this.slug() !== slug) return;
        this.sending.set(false);
        const itemsRejected = err instanceof HttpErrorResponse && err.status === 400 && !!err.error?.items;
        if (itemsRejected) this.refreshCartAfterReject(slug);
        else this.sendError.set(AuthService.errorText(err));
      },
    });
  }

  /** Сервер отверг позиции: пока гость выбирал, меню изменилось. Обновляем меню и корзину. */
  private refreshCartAfterReject(slug: string): void {
    this.api.getVenueMenu(slug).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: m => {
        if (this.slug() !== slug) return;
        this.menu.set(m);
        this.reconcileCart(m);
        this.sendError.set('Часть позиций уже недоступна, мы обновили корзину. Проверьте заказ и отправьте снова.');
      },
      error: () => {
        if (this.slug() !== slug) return;
        this.sendError.set('Часть позиций уже недоступна. Обновите страницу и соберите заказ снова.');
      },
    });
  }

  // Заказ

  /**
   * Сочетания из заказа, которые можно оценить: блюдо и напиток, которые в меню стоят парой.
   * Берём пары сомелье и подбор ИИ (у них есть id в каталоге), расчёт движка не оцениваем.
   */
  readonly orderPairs = computed<OrderPair[]>(() => {
    const o = this.order();
    if (!o) return [];
    const rows = new Map(this.sections().flatMap(sec => sec.items).map(i => [i.id, i]));
    const ordered = new Set(o.items.filter(i => i.kind === 'DRINK' && i.menu_drink).map(i => i.menu_drink as string));
    const pairs: OrderPair[] = [];
    for (const item of o.items) {
      const row = item.kind === 'DISH' && item.menu_item ? rows.get(item.menu_item) : undefined;
      if (!row) continue;
      for (const rec of [row.rec, ...row.alts]) {
        if (!rec?.pairingId || !rec.drink || !ordered.has(rec.drink.id)) continue;
        if (!pairs.some(p => p.pairingId === rec.pairingId)) pairs.push({ pairingId: rec.pairingId, dish: row.dish.name, drink: rec.name });
      }
    }
    return pairs;
  });

  /** Один голос гостя за пару. Ошибку не показываем: оценка не должна мешать заказу. */
  vote(pair: OrderPair, liked: boolean): void {
    this.votes.update(v => ({ ...v, [pair.pairingId]: liked }));
    this.api.votePairing(pair.pairingId, liked, deviceId(), this.slug()).subscribe({ error: () => undefined });
  }

  statusLabel(status: OrderStatus): string {
    return ORDER_STATUS_LABELS[status] ?? status;
  }

  closed(o: Order): boolean {
    return isOrderClosed(o.status);
  }

  /**
   * Заказ для гостя завершён: закрыт, отменён, подан больше трёх часов назад
   * или просто старше суток. Такой заказ не опрашиваем и после перезагрузки
   * не показываем. Возраст считаем по часам гостя, если запись их помнит.
   */
  private finished(o: Order): boolean {
    if (isOrderClosed(o.status)) return true;
    const since = this.stored?.at ?? Date.parse(o.created_at);
    const age = Number.isFinite(since) ? Date.now() - since : 0;
    return age > ORDER_TTL_MS || (o.status === 'SERVED' && age > SERVED_TTL_MS);
  }

  openOrder(): void {
    if (!this.order()) return;
    this.step.set('order');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  backToMenu(): void {
    this.step.set('menu');
    this.orderError.set('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * Те же позиции снова в корзину. То, что гость уже успел набрать, остаётся:
   * количество складывается. Позиции, которых больше нет в меню или в наличии,
   * перечисляем в сообщении, чтобы пропажа не была молчаливой.
   */
  repeatOrder(): void {
    const o = this.order();
    const m = this.menu();
    if (!o || !m) return;
    const entries = new Map(m.sections.flatMap(s => s.items).map(i => [i.id, i]));
    const drinks = new Map(m.drinks.map(d => [d.id, d]));
    const lines = [...this.cart()];
    const missing: string[] = [];
    let added = 0;
    const put = (line: Omit<CartLine, 'qty'>, qty: number) => {
      const at = lines.findIndex(l => l.kind === line.kind && l.id === line.id);
      if (at < 0) lines.push({ ...line, qty });
      else lines[at] = { ...line, qty: Math.min(MAX_QTY, lines[at].qty + qty) };
      added++;
    };
    for (const i of o.items) {
      const qty = Math.min(MAX_QTY, Math.max(1, i.qty));
      const e = i.kind === 'DISH' && i.menu_item ? entries.get(i.menu_item) : undefined;
      const d = i.kind === 'DRINK' && i.menu_drink ? drinks.get(i.menu_drink) : undefined;
      if (e?.is_available && this.hasPrice(e.price)) {
        put({ kind: 'DISH', id: e.id, title: e.dish.name, sub: e.portion || '', price: e.price }, qty);
      } else if (d?.is_available && this.hasPrice(d.price)) {
        put({ kind: 'DRINK', id: d.id, title: d.brand_name, sub: d.volume || '', price: d.price }, qty);
      } else if (!missing.includes(i.title)) {
        missing.push(i.title);
      }
    }
    this.setCart(lines);
    this.step.set('menu');
    this.sendError.set(missing.length
      ? `Сейчас нет в меню: ${missing.map(t => `«${t}»`).join(', ')}.${added ? ' Остальное добавили в корзину.' : ''}`
      : '');
    // Корзину открываем и тогда, когда добавить было нечего: в ней видно, чего не хватило
    this.cartOpen.set(lines.length > 0 || missing.length > 0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  refreshOrder(): void {
    const s = this.stored;
    const slug = this.slug();
    if (!s || !slug) return;
    this.api.getGuestOrder(s.id, s.token).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: o => {
        if (this.stored?.id !== o.id) return;
        this.orderLoaded.set(true);
        this.orderError.set('');
        if (!this.finished(o)) {
          this.order.set(o);
          if (!this.pollTimer) this.startPolling();
          return;
        }
        // Заказ для гостя завершён: опрос не нужен, после перезагрузки откроется меню
        const seen = this.order()?.id === o.id;
        this.stopPolling();
        this.stored = null;
        writeJson(orderKey(slug), null);
        if (seen && isOrderClosed(o.status)) {
          // Заказ закрыли или отменили на глазах у гостя: итог показываем
          this.order.set(o);
          return;
        }
        // Давний заказ или заказ, закрытый до захода на страницу: вместо его экрана показываем меню
        this.order.set(null);
        this.step.set('menu');
        if (o.status === 'CANCELLED') {
          this.orderNote.set(`Заказ №${o.number} отменён. Если это ошибка, позовите официанта.`);
        }
      },
      error: (err: unknown) => {
        if (this.stored?.id !== s.id) return;
        this.orderLoaded.set(true);
        const gone = err instanceof HttpErrorResponse && (err.status === 403 || err.status === 404);
        if (gone) {
          // Заказ удалили или токен не подходит: возвращаем гостя в меню с короткой заметкой
          this.stopPolling();
          this.stored = null;
          writeJson(orderKey(slug), null);
          this.order.set(null);
          this.orderError.set('');
          this.step.set('menu');
          this.orderNote.set('Ваш прошлый заказ больше не найден. Если это ошибка, позовите официанта.');
          return;
        }
        this.orderError.set(AuthService.errorText(err));
      },
    });
  }

  copyLink(): void {
    const url = this.shareUrl();
    const done = () => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(done, () => this.copyFallback(url, done));
    } else {
      this.copyFallback(url, done);
    }
  }

  /** Подпись над рекомендацией: кто её дал. */
  recKind(r: MenuRec): string {
    return r.byAi ? 'Подбор ИИ' : r.bySommelier ? 'Выбор сомелье' : 'Подбор движка';
  }

  /** Цена задана и больше нуля: только такую позицию можно заказать. */
  hasPrice(value: string | number): boolean {
    const n = typeof value === 'number' ? value : parseFloat(value);
    return isFinite(n) && n > 0;
  }

  /** Цена для карточки; у позиции без цены вместо "0 ₸" честное "цена уточняется". */
  priceLabel(value: string | number): string {
    return this.hasPrice(value) ? this.price(value) : 'цена уточняется';
  }

  /** Цена из DRF приходит строкой "2400.00", показываем "2 400 ₸". */
  price(value: string | number): string {
    const n = typeof value === 'number' ? value : parseFloat(value);
    if (!isFinite(n)) return `${value} ₸`;
    const abs = Math.abs(n);
    const whole = Math.trunc(abs);
    const frac = Math.round((abs - whole) * 100);
    const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const sign = n < 0 ? '-' : '';
    return frac ? `${sign}${grouped},${String(frac).padStart(2, '0')} ₸` : `${sign}${grouped} ₸`;
  }

  venueType(v: Venue): string {
    return v.venue_type_display || VENUE_LABEL[v.venue_type] || 'Заведение';
  }

  /** "Алматы, пр. Достык 100" без лишних пробелов, если чего-то нет. */
  venueLine(v: Venue): string {
    return [v.city, v.address].map(s => (s || '').trim()).filter(Boolean).join(', ');
  }

  initial(v: Venue): string {
    return this.initialOf(v.name);
  }

  initialOf(name: string): string {
    return (name || '?').trim().charAt(0).toUpperCase();
  }

  telHref(phone: string): string {
    return 'tel:' + phone.replace(/[^\d+]/g, '');
  }

  label(type: PairingType): string {
    return PAIRING_LABELS[type] ?? type;
  }

  // Загрузка

  private showList(): void {
    this.resetVenueState();
    this.menu.set(null);
    this.menuError.set('');
    this.loadVenues();
  }

  private loadVenues(): void {
    this.venuesLoaded.set(false);
    this.venuesError.set('');
    this.api.getVenues().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: v => {
        this.venues.set(v);
        this.venuesLoaded.set(true);
      },
      error: (err: unknown) => {
        this.venuesError.set(AuthService.errorText(err));
        this.venuesLoaded.set(true);
      },
    });
  }

  private loadMenu(slug: string): void {
    this.resetVenueState();
    this.menuLoaded.set(false);
    this.menuError.set('');

    // QR-ссылка /menu/<slug>?table=7: запоминаем стол и убираем query из адреса
    if (location.search) {
      this.selection.setTableFromQuery(slug);
      if (new URLSearchParams(location.search).has('table')) history.replaceState({}, '', location.pathname);
    }

    this.cart.set(readCart(slug));
    this.restoreOrder(slug);

    this.api.getVenueMenu(slug).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: m => {
        // Пока грузилось, гость мог открыть другое заведение
        if (this.selection.venueSlug() !== slug) return;
        this.menu.set(m);
        this.menuLoaded.set(true);
        this.reconcileCart(m);
        // Стол из QR или из хранилища может быть больше, чем столов у заведения: сбрасываем, ниже откроется выбор
        const table = this.tableNumber();
        if (table !== null && table > this.tablesCount()) this.selection.setTable(slug, null);
        // Движок нужен блюдам без пары и блюдам, чья пара не продаётся в этом баре
        const needsEngine = (i: MenuEntry) => !i.pairing
          || (!i.pairing.menu_drink && !(i.alternatives ?? []).some(a => a.menu_drink));
        if (m.sections.some(s => s.items.some(needsEngine))) this.ensureEngineData();
        // Стол ещё не выбран: предлагаем выбрать, когда меню уже на экране
        // Официанту в режиме шпаргалки стол не нужен
        if (this.tableNumber() === null && this.step() === 'menu' && !this.staff()) {
          this.autoTableTimer = setTimeout(() => {
            if (this.selection.venueSlug() === slug && this.tableNumber() === null && this.step() === 'menu' && !this.staff()) {
              this.tableOpen.set(true);
            }
          }, 350);
        }
        // Шпаргалку открыли прямой ссылкой: ей нужны пары и для блюд без пары сомелье
        if (this.staff()) this.ensureEngineData();
      },
      error: (err: unknown) => {
        if (this.selection.venueSlug() !== slug) return;
        const notFound = err instanceof HttpErrorResponse && err.status === 404;
        this.menuError.set(notFound ? 'Такого заведения нет или его меню скрыто.' : AuthService.errorText(err));
        this.menuLoaded.set(true);
      },
    });
  }

  /** Незакрытый заказ из хранилища: открываем его экран и сверяем статус с сервером. */
  private restoreOrder(slug: string): void {
    const saved = readJson<StoredOrder>(orderKey(slug));
    // Запись старше суток на сервере не проверяем: такой заказ гостю уже не нужен
    const stale = !!saved?.at && Date.now() - saved.at > ORDER_TTL_MS;
    if (!saved?.id || stale) {
      if (saved) writeJson(orderKey(slug), null);
      this.stored = null;
      return;
    }
    this.stored = saved;
    this.step.set('order');
    this.orderLoaded.set(false);
    this.refreshOrder();
  }

  /** Сброс всего, что относится к одному заведению. */
  private resetVenueState(): void {
    this.stopPolling();
    if (this.autoTableTimer) {
      clearTimeout(this.autoTableTimer);
      this.autoTableTimer = null;
    }
    this.activeSection.set('');
    this.expanded.set({});
    this.step.set('menu');
    this.cart.set([]);
    this.cartOpen.set(false);
    this.tableOpen.set(false);
    this.tableHint.set(false);
    this.sendError.set('');
    this.sending.set(false);
    this.guestName.set('');
    this.comment.set('');
    this.order.set(null);
    this.orderLoaded.set(true);
    this.orderError.set('');
    this.orderNote.set('');
    this.stored = null;
  }

  private setCart(lines: CartLine[]): void {
    this.cart.set(lines);
    const slug = this.slug();
    if (slug) writeJson(cartKey(slug), lines.length ? lines : null);
  }

  /** Корзина из хранилища против свежего меню: цены обновляем, пропавшее, недоступное и без цены убираем. */
  private reconcileCart(m: VenueMenu): void {
    const entries = new Map(m.sections.flatMap(s => s.items).map(i => [i.id, i]));
    const drinks = new Map(m.drinks.map(d => [d.id, d]));
    const lines: CartLine[] = [];
    for (const l of this.cart()) {
      const qty = Math.min(MAX_QTY, Math.max(1, Math.trunc(Number(l.qty) || 0)));
      if (l.kind === 'DISH') {
        const e = entries.get(l.id);
        if (e?.is_available && this.hasPrice(e.price)) {
          lines.push({ kind: 'DISH', id: e.id, title: e.dish.name, sub: e.portion || '', price: e.price, qty });
        }
      } else if (l.kind === 'DRINK') {
        const d = drinks.get(l.id);
        if (d?.is_available && this.hasPrice(d.price)) {
          lines.push({ kind: 'DRINK', id: d.id, title: d.brand_name, sub: d.volume || '', price: d.price, qty });
        }
      }
    }
    this.setCart(lines);
  }

  private showOrder(o: Order): void {
    // Новый заказ: оценки сочетаний прошлого заказа к нему не относятся
    if (this.order()?.id !== o.id) this.votes.set({});
    this.order.set(o);
    this.orderLoaded.set(true);
    this.orderError.set('');
    this.step.set('order');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    this.startPolling();
  }

  private startPolling(): void {
    this.stopPolling();
    const o = this.order();
    if (this.destroyed || !o || this.finished(o) || !this.stored) return;
    this.pollTimer = setInterval(() => this.refreshOrder(), POLL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private ensureEngineData(): void {
    if (this.engineRequested) return;
    this.engineRequested = true;
    this.api.getBrands().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: b => {
        this.brands.set(b);
        this.engineLoaded.set(true);
      },
      error: () => this.engineLoaded.set(true),
    });
    // Без сочетаний движок считает по правилам: ошибку этого запроса гостю не показываем
    this.api.getPairings().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: p => this.pairings.set(p),
      error: () => undefined,
    });
  }

  private recsFor(
    entry: MenuEntry,
    brands: Brand[],
    dishes: Dish[],
    pairings: FoodPairing[],
    brandById: Map<string, Brand>,
    drinkByBrand: Map<string, MenuDrink>,
  ): { rec: MenuRec | null; alts: MenuRec[] } {
    const d = entry.dish;
    const profile: DishProfile = {
      category: null,
      cooking: d.cooking_method === 'OTHER' ? null : d.cooking_method,
      taste: d.dominant_taste,
      weight: d.weight,
      fat: d.fat_level,
      freeText: d.name,
    };

    const p = entry.pairing;
    if (p) {
      const rec = this.fromPairing(p, brandById, drinkByBrand);
      let alts = (entry.alternatives ?? [])
        .filter(a => a.brand !== p.brand)
        .slice(0, 2)
        .map(a => this.fromPairing(a, brandById, drinkByBrand));
      // Сорта из пары нет в карте бара и запасных с сервера тоже нет: совет не должен кончаться тупиком.
      // Считаем движком лучшее из того, что в этом баре есть в наличии.
      if (!rec.drink && !alts.some(a => a.drink) && brands.length) {
        const inBar = brands.filter(b => b.id !== p.brand && drinkByBrand.get(b.id)?.is_available);
        alts = recommend(profile, inBar, dishes, pairings, 2).map(r => this.fromEngine(r, drinkByBrand)).filter(r => r.drink);
      }
      return { rec, alts };
    }
    if (!brands.length) return { rec: null, alts: [] };

    const [first, ...rest] = recommend(profile, brands, dishes, pairings, 4);
    if (!first) return { rec: null, alts: [] };
    // Альтернативы движка показываем только из того, что есть в карте бара
    const alts = rest.map(r => this.fromEngine(r, drinkByBrand)).filter(r => r.drink).slice(0, 2);
    return { rec: this.fromEngine(first, drinkByBrand), alts };
  }

  private fromPairing(p: MenuPairing, brandById: Map<string, Brand>, drinkByBrand: Map<string, MenuDrink>): MenuRec {
    const brand = brandById.get(p.brand);
    return {
      brandId: p.brand,
      name: p.brand_name,
      style: p.brand_style,
      abv: p.abv,
      image: p.brand_image || (brand ? smallImage(brand) : null),
      rating: p.compatibility_score,
      type: p.pairing_type,
      explanation: p.explanation,
      // Пара без пометки источника - пара сомелье
      bySommelier: p.source !== 'AI',
      byAi: p.source === 'AI',
      drink: drinkByBrand.get(p.brand) ?? null,
      pairingId: p.id,
    };
  }

  private fromEngine(r: Recommendation, drinkByBrand: Map<string, MenuDrink>): MenuRec {
    return {
      brandId: r.brand.id,
      name: r.brand.name,
      style: r.brand.style,
      abv: r.brand.abv ?? null,
      image: smallImage(r.brand),
      rating: r.rating,
      type: r.type,
      explanation: r.explanation,
      bySommelier: false,
      byAi: false,
      basedOn: r.basedOn,
      drink: drinkByBrand.get(r.brand.id) ?? null,
    };
  }

  /** Старые браузеры и http без clipboard API. */
  private copyFallback(text: string, done: () => void): void {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      if (document.execCommand('copy')) done();
    } finally {
      document.body.removeChild(area);
    }
  }
}

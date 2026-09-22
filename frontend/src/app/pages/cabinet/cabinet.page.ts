import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SlicePipe } from '@angular/common';
import { DataService } from '../../core/data.service';
import { SaasService } from '../../core/saas.service';
import { ItemKind, MenuItem, PLANS, Stats, TableRow } from '../../core/saas.models';
import { IconComponent } from '../../ui/icon.component';
import { plural } from '../../core/format';

type Tab = 'overview' | 'menu' | 'tables' | 'settings';
interface Draft extends MenuItem { dirty?: boolean; }

/**
 * Кабинет заведения — то, за что бар платит: своя карта с ценами, стоп-лист,
 * QR-столы и аналитика с оценкой прироста чека. Работает с Django или локально (демо).
 */
@Component({
  selector: 'ft-cabinet',
  standalone: true,
  imports: [RouterLink, FormsModule, SlicePipe, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!saas.authed()) {
      <section class="auth">
        <div class="card card-p">
          <span class="eyebrow">Кабинет заведения</span>
          <h1>{{ mode() === 'login' ? 'Вход' : '14 дней бесплатно' }}</h1>
          <p class="dim mt8">{{ mode() === 'login' ? 'Управляйте меню, ценами и смотрите, что заказывают гости.' : 'Кабинет, QR на столы и подбор пива к вашему меню — без карты и договора.' }}</p>

          <form class="form mt16" (ngSubmit)="submit()">
            @if (mode() === 'register') {
              <label>Название заведения<input class="input" [(ngModel)]="f.venue_name" name="venue_name" required placeholder="Например: Beer Garden" /></label>
              <div class="two">
                <label>Город<input class="input" [(ngModel)]="f.city" name="city" placeholder="Алматы" /></label>
                <label>Столов<input class="input" type="number" min="1" max="200" [(ngModel)]="f.tables" name="tables" /></label>
              </div>
              <label>Телефон<input class="input" [(ngModel)]="f.phone" name="phone" placeholder="+7 7xx xxx xx xx" /></label>
            }
            <label>E-mail<input class="input" type="email" [(ngModel)]="f.email" name="email" required autocomplete="username" /></label>
            <label>Пароль<input class="input" type="password" [(ngModel)]="f.password" name="password" required minlength="6" autocomplete="current-password" /></label>
            @if (error(); as e) { <div class="soft warn">{{ e }}</div> }
            <button type="submit" class="btn btn-primary btn-lg btn-block" [disabled]="busy()">{{ busy() ? 'Секунду…' : (mode() === 'login' ? 'Войти' : 'Создать кабинет') }}</button>
          </form>

          <p class="center sm mt16">
            @if (mode() === 'login') { Нет кабинета? <button type="button" class="link" (click)="mode.set('register')">Подключить заведение бесплатно</button> }
            @else { Уже есть кабинет? <button type="button" class="link" (click)="mode.set('login')">Войти</button> }
          </p>
          <div class="soft demo mt16">
            <b>Демо-доступ:</b> <code>efes&#64;demo.flavortree.kz</code> / <code>flavor2026</code>
            <button type="button" class="link" (click)="demo()">заполнить</button>
            @if (saas.mode === 'local') { <div class="muted xs mt8">Режим без сервера: данные кабинета хранятся в этом браузере.</div> }
          </div>
        </div>
      </section>
    } @else { @if (saas.session(); as s) {
      <section class="head">
        <div class="grow">
          <span class="eyebrow">Кабинет заведения</span>
          <h1 class="vn">{{ s.venue.name }}</h1>
          <div class="flex g8 wrap mt8">
            <span class="chip chip-sm" [class.on]="s.active">{{ s.plan_label }} · {{ s.active ? plural(s.days_left, 'день', 'дня', 'дней') + ' осталось' : 'подписка не активна' }}</span>
            <a class="chip chip-sm" [routerLink]="['/m', s.venue.slug]" target="_blank">Открыть меню гостя ↗</a>
          </div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" (click)="saas.logout()"><ft-icon name="x" [size]="16" /> Выйти</button>
      </section>

      @if (!s.active) {
        <div class="soft warn mt12"><b>Меню гостям сейчас недоступно.</b> Продлите подписку — <a routerLink="/business" fragment="pricing" class="link">тарифы</a>.</div>
      } @else if (s.plan === 'TRIAL' && s.days_left <= 5) {
        <div class="soft mt12">Пробный период заканчивается через {{ plural(s.days_left, 'день', 'дня', 'дней') }}. <a routerLink="/business" fragment="pricing" class="link">Выбрать тариф</a></div>
      }

      <nav class="tabs mt16" aria-label="Разделы кабинета">
        <button type="button" [class.on]="tab() === 'overview'" (click)="go('overview')"><ft-icon name="bolt" [size]="16" /> Обзор</button>
        <button type="button" [class.on]="tab() === 'menu'" (click)="go('menu')"><ft-icon name="dish" [size]="16" /> Меню и цены</button>
        <button type="button" [class.on]="tab() === 'tables'" (click)="go('tables')"><ft-icon name="qr" [size]="16" /> Столы и QR</button>
        <button type="button" [class.on]="tab() === 'settings'" (click)="go('settings')"><ft-icon name="settings" [size]="16" /> Настройки</button>
      </nav>

      <!-- ═══════════ ОБЗОР ═══════════ -->
      @if (tab() === 'overview') {
        @if (stats(); as st) {
          <div class="flex g8 mt16 jsb wrap">
            <div class="seg sm">@for (d of periods; track d) { <button type="button" [class.on]="days() === d" (click)="setDays(d)" [disabled]="d > s.limits.history_days">{{ d }} дн</button> }</div>
            <span class="muted xs">История доступна за {{ s.limits.history_days }} дней на тарифе «{{ s.plan_label }}»</span>
          </div>

          <div class="hero card mt12">
            <div class="hero-l">
              <span class="eyebrow">Эффект подбора за {{ st.days }} дн.</span>
              <div class="big">+{{ fmt(st.revenue_intent_kzt) }} <span class="cur">₸</span></div>
              <p class="dim sm">Сумма пива, которое гости выбрали через подбор к блюду. Средняя добавка к чеку — <b>{{ fmt(st.avg_check_add_kzt) }} ₸</b>.</p>
            </div>
            <div class="hero-r">
              <div class="kpi"><span class="kv">{{ st.scans }}</span><span class="kl">сканов QR</span></div>
              <div class="kpi"><span class="kv">{{ st.guests }}</span><span class="kl">гостей</span></div>
              <div class="kpi"><span class="kv">{{ st.order_intents }}</span><span class="kl">нажали «Заказать»</span></div>
              <div class="kpi"><span class="kv">{{ st.conversion }}%</span><span class="kl">конверсия</span></div>
            </div>
          </div>

          <div class="card card-p mt12">
            <div class="flex jsb ac"><b>Сканы по дням</b><span class="muted xs">{{ (st.series.at(0)?.date ?? '') | slice:5 }} — {{ (st.series.at(-1)?.date ?? '') | slice:5 }} · пик {{ gridLines()[0].v }}/день</span></div>
            <div class="chart mt12" (mouseleave)="hover.set(null)">
              <svg [attr.viewBox]="'0 0 ' + cw + ' ' + ch" preserveAspectRatio="none" role="img" [attr.aria-label]="'Сканы по дням, всего ' + st.scans">
                @for (g of gridLines(); track g.y) { <line x1="0" [attr.x2]="cw" [attr.y1]="g.y" [attr.y2]="g.y" class="grid" /> }
                @for (b of bars(); track b.date; let i = $index) {
                  <rect [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.w" [attr.height]="b.h" rx="3" class="sbar" [class.on]="hover()?.date === b.date" />
                  <rect [attr.x]="b.x - b.gap / 2" y="0" [attr.width]="b.w + b.gap" [attr.height]="ch" fill="transparent" (mouseenter)="hover.set(b)" (touchstart)="hover.set(b)" />
                }
              </svg>
              @if (hover(); as h) { <div class="tip" [style.left.%]="h.cx"><b>{{ h.scans }}</b> {{ plural(h.scans, 'скан', 'скана', 'сканов') }} · {{ h.label }}</div> }
            </div>
          </div>

          <div class="grid grid-2 mt12">
            <div class="card card-p">
              <b>Связки, которые заказывают</b>
              <ol class="list mt12">
                @for (p of st.top_pairs; track p.dish + p.beer) {
                  <li><span class="em">{{ dishEmoji(p.dish) }}</span><span class="grow"><b>{{ dishName(p.dish) }}</b> → {{ beerName(p.beer) }}</span><span class="n">{{ p.count }}</span></li>
                } @empty { <li class="dim">Пока нет заказов через подбор</li> }
              </ol>
            </div>
            <div class="card card-p">
              <b>Что открывают чаще всего</b>
              <ol class="list mt12">
                @for (d of st.top_dishes; track d.slug) { <li><span class="em">{{ dishEmoji(d.slug) }}</span><span class="grow">{{ dishName(d.slug) }}</span><span class="n">{{ d.count }}</span></li> }
                @empty { <li class="dim">Гости ещё не открывали меню</li> }
              </ol>
              <b class="mt16" style="display:block">Пиво-лидер по заказам</b>
              <ol class="list mt8">
                @for (b of st.top_beers.slice(0, 4); track b.slug) { <li><span class="em">🍺</span><span class="grow">{{ beerName(b.slug) }}</span><span class="n">{{ b.count }}</span></li> }
              </ol>
            </div>
          </div>
        } @else { <div class="card card-p center mt16"><div class="spinner"></div></div> }
      }

      <!-- ═══════════ МЕНЮ И ЦЕНЫ ═══════════ -->
      @if (tab() === 'menu') {
        <div class="flex jsb ac wrap g8 mt16">
          <div><b>{{ drafts().length }} из {{ menuLimit() }} позиций</b> <span class="muted xs">· снимите галочку «в наличии» — гость не увидит позицию</span></div>
          <div class="flex g8">
            <button type="button" class="btn btn-secondary btn-sm" (click)="picker.set(picker() ? null : 'BEER')"><ft-icon name="beer" [size]="16" /> Добавить пиво</button>
            <button type="button" class="btn btn-secondary btn-sm" (click)="picker.set(picker() === 'DISH' ? null : 'DISH')"><ft-icon name="dish" [size]="16" /> Добавить блюдо</button>
          </div>
        </div>

        @if (picker(); as k) {
          <div class="card card-p mt12">
            <div class="search"><ft-icon name="search" /><input class="input" type="search" [placeholder]="k === 'BEER' ? 'Найти сорт: Efes, Kozel, 13 регион…' : 'Найти блюдо: шашлык, манты, бургер…'" [ngModel]="pq()" (ngModelChange)="pq.set($event)" /></div>
            <div class="picks mt12">
              @for (c of pickerRows(); track c.id) {
                <button type="button" class="pick" (click)="add(k, c.id)" [disabled]="has(k, c.id)">
                  <span>{{ c.emoji }}</span><span class="grow ellipsis">{{ c.name }}</span><span class="muted xs">{{ has(k, c.id) ? 'уже в меню' : '+' }}</span>
                </button>
              } @empty { <div class="dim sm">Ничего не найдено. Нет нужного сорта? <a routerLink="/business" fragment="lead" class="link">Напишите нам</a> — добавим в каталог.</div> }
            </div>
          </div>
        }

        @for (k of kinds; track k.id) {
          <div class="card mt12">
            <div class="card-p flex jsb ac"><b>{{ k.label }}</b><span class="muted xs">{{ count(k.id) }} поз.</span></div>
            <div class="rows">
              @for (d of byKind(k.id); track d.id) {
                <div class="mrow" [class.off]="!d.is_available">
                  <span class="em">{{ k.id === 'BEER' ? '🍺' : dishEmoji(d.ref_slug) }}</span>
                  <div class="grow min0">
                    <input class="inl nm" [ngModel]="d.name || refName(k.id, d.ref_slug)" (ngModelChange)="patch(d, { name: $event })" [attr.aria-label]="'Название ' + refName(k.id, d.ref_slug)" />
                    <div class="flex g6 wrap mt4">
                      <input class="inl xs" [ngModel]="d.category" (ngModelChange)="patch(d, { category: $event })" placeholder="раздел меню" aria-label="Раздел" />
                      @if (k.id === 'BEER') { <input class="inl xs w70" [ngModel]="d.volume" (ngModelChange)="patch(d, { volume: $event })" placeholder="0.5 л" aria-label="Объём" /> }
                    </div>
                  </div>
                  <label class="price"><input class="inl pr" type="number" min="0" step="50" [ngModel]="d.price" (ngModelChange)="patch(d, { price: +$event })" aria-label="Цена" /><span>₸</span></label>
                  <label class="tog" title="В наличии"><input type="checkbox" [ngModel]="d.is_available" (ngModelChange)="patch(d, { is_available: $event })" /><span>{{ d.is_available ? 'в наличии' : 'стоп' }}</span></label>
                  <button type="button" class="star" [class.on]="d.is_featured" (click)="patch(d, { is_featured: !d.is_featured })" title="Хит / рекомендуем"><ft-icon name="star" [size]="16" /></button>
                  <button type="button" class="btn btn-icon btn-ghost" (click)="remove(d)" aria-label="Удалить"><ft-icon name="x" [size]="16" /></button>
                </div>
              } @empty { <div class="card-p dim sm">Пусто — добавьте из каталога выше.</div> }
            </div>
          </div>
        }

        @if (dirtyCount()) {
          <div class="savebar"><span>Изменено: {{ dirtyCount() }}</span><button type="button" class="btn btn-primary" (click)="save()" [disabled]="busy()"><ft-icon name="check" [size]="16" /> Сохранить и опубликовать</button></div>
        }
      }

      <!-- ═══════════ СТОЛЫ И QR ═══════════ -->
      @if (tab() === 'tables') {
        <div class="flex jsb ac wrap g8 mt16">
          <div><b>{{ tables().length }} из {{ tableLimit() }} столов</b> <span class="muted xs">· каждый QR ведёт на меню с номером стола</span></div>
          <div class="flex g8 ac">
            <input class="input w70" type="number" min="1" max="200" [(ngModel)]="addN" aria-label="Сколько столов добавить" />
            <button type="button" class="btn btn-secondary btn-sm" (click)="addTables()" [disabled]="busy()">+ Добавить</button>
            <a class="btn btn-primary btn-sm" routerLink="/cabinet/print" target="_blank"><ft-icon name="download" [size]="16" /> Печать стендов</a>
          </div>
        </div>
        @if (error(); as e) { <div class="soft warn mt12">{{ e }}</div> }
        <div class="card nfc mt12">
          <div class="card-p flex g12 ac wrap">
            <span class="nfc-ico"><ft-icon name="nfc" [size]="28" /></span>
            <div class="grow"><b>NFC-метки: одно касание вместо камеры</b><div class="dim sm">Наклейка NTAG213 (≈150 ₸) под стендом. Гость прикладывает телефон — меню открывается сразу, и на iPhone, и на Android. Записать метку можно прямо отсюда с Android-телефона (Chrome).</div></div>
            <span class="chip chip-sm" [class.on]="nfcSupported">{{ nfcSupported ? 'Web NFC доступен' : 'откройте кабинет в Chrome на Android' }}</span>
          </div>
        </div>
        <div class="grid grid-3 mt12">
          @for (t of tables(); track t.id) {
            <div class="card card-p tbl">
              <div class="flex jsb ac"><b>{{ t.label }}</b><button type="button" class="btn btn-icon btn-ghost" (click)="removeTable(t)" aria-label="Удалить стол"><ft-icon name="x" [size]="14" /></button></div>
              <code class="tok">{{ t.token }}</code>
              <div class="muted xs mt8">{{ t.scans }} {{ plural(t.scans, 'скан', 'скана', 'сканов') }}@if (t.last_scan_at) { · последний {{ ago(t.last_scan_at) }} }</div>
              <div class="flex g6 mt8 wrap"><a class="chip chip-sm" [routerLink]="['/m', s.venue.slug, t.number]" target="_blank">открыть ↗</a><button type="button" class="chip chip-sm" (click)="copy(menuUrl(s.venue.slug, t.number))"><ft-icon name="copy" [size]="12" /> ссылка</button><button type="button" class="chip chip-sm" (click)="writeNfc(s.venue.slug, t)" [disabled]="nfcBusy() === t.id"><ft-icon name="nfc" [size]="12" /> {{ nfcBusy() === t.id ? 'поднесите метку…' : 'записать NFC' }}</button></div>
            </div>
          } @empty { <div class="card card-p dim">Столов пока нет — добавьте, чтобы напечатать QR.</div> }
        </div>
      }

      <!-- ═══════════ НАСТРОЙКИ ═══════════ -->
      @if (tab() === 'settings') {
        <form class="card card-p form mt16" (ngSubmit)="saveVenue()">
          <b>Как гость видит заведение</b>
          <label>Название<input class="input" [(ngModel)]="v.name" name="name" /></label>
          <label>Заголовок над меню<input class="input" [(ngModel)]="v.headline" name="headline" placeholder="Что взять к вашему блюду?" /></label>
          <div class="two">
            <label>Город<input class="input" [(ngModel)]="v.city" name="city" /></label>
            <label>Адрес<input class="input" [(ngModel)]="v.address" name="address" /></label>
          </div>
          <div class="two">
            <label>Телефон<input class="input" [(ngModel)]="v.phone" name="phone" /></label>
            <label>Instagram<input class="input" [(ngModel)]="v.instagram" name="instagram" placeholder="@beer.garden" /></label>
          </div>
          <label>Пароль Wi-Fi для гостей<input class="input" [(ngModel)]="v.wifi" name="wifi" /></label>
          <label>Описание<textarea class="input" rows="2" [(ngModel)]="v.description" name="description"></textarea></label>

          <b class="mt8">Брендинг @if (!s.limits.branding) { <span class="chip chip-sm">на платных тарифах</span> }</b>
          <div class="two">
            <label>Акцентный цвет<input class="input" type="color" [(ngModel)]="v.accent" name="accent" [disabled]="!s.limits.branding" /></label>
            <label>Логотип (URL)<input class="input" [(ngModel)]="v.logo" name="logo" [disabled]="!s.limits.branding" placeholder="https://…/logo.png" /></label>
          </div>
          <label>Обложка меню (URL)<input class="input" [(ngModel)]="v.cover" name="cover" [disabled]="!s.limits.branding" /></label>
          @if (saved()) { <div class="soft ok">Сохранено — гости уже видят изменения.</div> }
          <button type="submit" class="btn btn-primary" [disabled]="busy()"><ft-icon name="check" [size]="16" /> Сохранить</button>
        </form>

        <div class="card card-p mt12">
          <b>Тариф</b>
          <div class="plans mt12">
            @for (p of plans; track p.id) {
              <div class="plan" [class.on]="p.id === s.plan"><b>{{ p.name }}</b><div class="pp">{{ fmt(p.price) }} ₸/мес</div><div class="muted xs">{{ p.tagline }}</div></div>
            }
          </div>
          <p class="dim sm mt12">Сменить тариф или продлить: <a routerLink="/business" fragment="lead" class="link">оставьте заявку</a> — подключим в тот же день. Аккаунт: {{ s.email }}</p>
        </div>
      }
      @if (toast(); as t) { <div class="toast" role="status">{{ t }}</div> }
    } }
  `,
  styles: [`
    .auth { max-width: 460px; margin: 0 auto; }
    .form { display: grid; gap: 12px; }
    .form label { display: grid; gap: 6px; font-size: .8rem; font-weight: 700; color: var(--ink-2); }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .link { color: var(--amber-700); font-weight: 700; text-decoration: underline; }
    .demo code { background: var(--amber-100); padding: 1px 6px; border-radius: 6px; }
    .head { display: flex; gap: 14px; align-items: flex-start; }
    .vn { font-size: 1.6rem; }
    .tabs { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-full); padding: 4px; }
    .tabs button { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: var(--r-full); font-weight: 700; font-size: .85rem; color: var(--ink-2); white-space: nowrap; }
    .tabs button.on { background: var(--ink); color: var(--bg); }
    .hero { display: grid; gap: 16px; padding: 20px; background: var(--grad-amber-soft); }
    @media (min-width: 720px) { .hero { grid-template-columns: 1.2fr 1fr; align-items: center; } }
    .big { font-family: var(--font-display); font-weight: 800; font-size: 2.6rem; letter-spacing: -.03em; line-height: 1; margin: 6px 0 8px; color: var(--amber-800); }
    .cur { font-size: 1.4rem; }
    .hero-r { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .kpi { background: var(--surface); border-radius: var(--r-md); padding: 12px; display: grid; gap: 2px; }
    .kv { font-family: var(--font-display); font-weight: 800; font-size: 1.5rem; }
    .kl { font-size: .72rem; color: var(--ink-3); }
    .chart { position: relative; height: 150px; }
    .chart svg { width: 100%; height: 100%; display: block; overflow: visible; }
    .grid { stroke: var(--line-2); stroke-width: 1; }
    .sbar { fill: var(--amber-400); transition: fill var(--t-fast); }
    .sbar.on { fill: var(--amber-700); }
    .tip { position: absolute; top: -8px; transform: translateX(-50%); background: var(--ink); color: var(--bg); font-size: .74rem; padding: 4px 8px; border-radius: 8px; white-space: nowrap; pointer-events: none; }
    .list { list-style: none; display: grid; gap: 8px; padding: 0; margin: 0; }
    .list li { display: flex; gap: 10px; align-items: center; font-size: .88rem; }
    .list .em { width: 30px; text-align: center; }
    .list .n { font-family: var(--font-display); font-weight: 800; color: var(--amber-700); }
    .picks { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 6px; max-height: 260px; overflow: auto; }
    .pick { display: flex; gap: 8px; align-items: center; padding: 8px 10px; border-radius: var(--r-md); border: 1px solid var(--line); background: var(--surface-2); text-align: left; font-size: .85rem; }
    .pick:disabled { opacity: .5; }
    .rows { display: grid; }
    .mrow { display: flex; gap: 10px; align-items: center; padding: 10px 14px; border-top: 1px solid var(--line-2); }
    .mrow.off { opacity: .55; }
    .mrow .em { width: 34px; text-align: center; font-size: 1.3rem; flex-shrink: 0; }
    .min0 { min-width: 0; }
    .inl { border: 1px solid transparent; background: transparent; border-radius: 8px; padding: 3px 6px; font: inherit; width: 100%; min-width: 0; }
    .inl:hover, .inl:focus { border-color: var(--line); background: var(--surface-2); outline: none; }
    .inl.nm { font-family: var(--font-display); font-weight: 700; }
    .inl.xs { font-size: .74rem; color: var(--ink-3); width: 140px; }
    .inl.w70, .w70 { width: 70px; }
    .price { display: flex; align-items: center; gap: 4px; font-weight: 800; flex-shrink: 0; }
    .inl.pr { width: 84px; text-align: right; font-family: var(--font-display); font-weight: 800; }
    .tog { display: flex; align-items: center; gap: 6px; font-size: .72rem; color: var(--ink-3); flex-shrink: 0; cursor: pointer; }
    .star { color: var(--ink-4); padding: 6px; border-radius: 8px; }
    .star.on { color: var(--amber-500); }
    .savebar { position: sticky; bottom: calc(var(--tabbar-h) + 8px + var(--safe-b)); margin-top: 12px; display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 14px; border-radius: var(--r-lg); background: var(--ink); color: var(--bg); box-shadow: var(--shadow-3); z-index: 5; }
    @media (min-width: 720px) { .savebar { bottom: 16px; } }
    .nfc-ico { font-size: 1.6rem; } .nfc { background: var(--grad-amber-soft); }
    .tbl .tok { display: inline-block; margin-top: 6px; font-weight: 700; background: var(--amber-100); color: var(--amber-800); padding: 3px 8px; border-radius: 8px; }
    .plans { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .plan { padding: 12px; border-radius: var(--r-md); border: 1.5px solid var(--line); }
    .plan.on { border-color: var(--amber-500); background: var(--amber-100); }
    .pp { font-family: var(--font-display); font-weight: 800; }
    .soft.warn { background: var(--warn-bg); color: var(--warn); padding: 10px 14px; border-radius: var(--r-md); }
    .soft.ok { background: var(--ok-bg); color: var(--ok); padding: 10px 14px; border-radius: var(--r-md); }
    .seg.sm button { padding: 6px 10px; font-size: .78rem; }
    .toast { position: fixed; left: 50%; top: calc(var(--header-h) + var(--safe-t) + 10px); transform: translateX(-50%); background: var(--ink); color: var(--bg); padding: 12px 18px; border-radius: var(--r-full); z-index: 300; box-shadow: var(--shadow-3); font-weight: 600; }
    .spinner { width: 32px; height: 32px; border: 3px solid var(--line); border-top-color: var(--amber-500); border-radius: 50%; margin: 0 auto; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 560px) { .mrow { flex-wrap: wrap; } .mrow .grow { flex-basis: 100%; } .plans { grid-template-columns: 1fr; } }
  `],
})
export class CabinetPage {
  saas = inject(SaasService);
  private data = inject(DataService);
  readonly plural = plural;
  readonly plans = PLANS;
  readonly periods = [7, 30, 90];
  readonly kinds: { id: ItemKind; label: string }[] = [{ id: 'BEER', label: 'Пиво' }, { id: 'DISH', label: 'Блюда' }];
  readonly cw = 600; readonly ch = 150;

  readonly mode = signal<'login' | 'register'>('login');
  readonly tab = signal<Tab>('overview');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly toast = signal<string | null>(null);
  readonly saved = signal(false);
  f = { email: '', password: '', venue_name: '', city: '', phone: '', tables: 8 };
  v = { name: '', headline: '', city: '', address: '', phone: '', instagram: '', wifi: '', description: '', accent: '#F7941D', logo: '', cover: '' };
  addN = 4;
  readonly nfcSupported = typeof window !== 'undefined' && 'NDEFReader' in window;
  readonly nfcBusy = signal<string | null>(null);

  readonly stats = signal<Stats | null>(null);
  readonly days = signal(30);
  readonly hover = signal<{ date: string; label: string; scans: number; cx: number } | null>(null);
  readonly drafts = signal<Draft[]>([]);
  readonly removed = signal<string[]>([]);
  readonly menuLimit = signal(0);
  readonly picker = signal<ItemKind | null>(null);
  readonly pq = signal('');
  readonly tables = signal<TableRow[]>([]);
  readonly tableLimit = signal(0);

  readonly dirtyCount = computed(() => this.drafts().filter(d => d.dirty).length + this.removed().length);
  readonly pickerRows = computed(() => {
    const k = this.picker(); const q = this.pq().trim().toLowerCase();
    if (!k) return [];
    const rows = k === 'BEER'
      ? this.data.brands().map(b => ({ id: b.id, name: b.display_name, emoji: '🍺', hay: `${b.name} ${b.display_name} ${b.style}` }))
      : this.data.dishes().map(d => ({ id: d.id, name: d.display_name, emoji: d.emoji, hay: `${d.name} ${d.display_name} ${d.synonyms.join(' ')} ${d.category}` }));
    return rows.filter(r => !q || r.hay.toLowerCase().includes(q)).slice(0, 40);
  });

  /** Один ряд, один оттенок, 2px зазор, скруглённые верхушки; шкала от нуля. */
  readonly bars = computed(() => {
    const s = this.stats()?.series || []; if (!s.length) return [];
    const max = Math.max(1, ...s.map(p => p.scans)); const slot = this.cw / s.length; const gap = Math.min(4, slot * .25);
    return s.map((p, i) => {
      const h = Math.max(p.scans ? 3 : 0, (p.scans / max) * (this.ch - 6));
      const [y, m, d] = p.date.split('-');
      return { date: p.date, scans: p.scans, x: i * slot + gap / 2, w: slot - gap, gap, y: this.ch - h, h, cx: ((i + .5) / s.length) * 100, label: `${d}.${m}.${y}` };
    });
  });
  readonly gridLines = computed(() => {
    const max = Math.max(1, ...(this.stats()?.series || []).map(p => p.scans));
    return [1, .5].map(f => ({ v: Math.round(max * f), y: this.ch - 6 - f * (this.ch - 6) }));
  });

  constructor() { if (this.saas.authed()) this.go('overview'); }

  // ── вход ──
  demo(): void { this.f.email = 'efes@demo.flavortree.kz'; this.f.password = 'flavor2026'; this.mode.set('login'); }
  async submit(): Promise<void> {
    this.busy.set(true); this.error.set(null);
    const r = this.mode() === 'login' ? await this.saas.login(this.f.email, this.f.password)
      : await this.saas.register({ ...this.f, tables: +this.f.tables || 5 });
    this.busy.set(false);
    if (!r.ok) { this.error.set(r.error || 'Ошибка'); return; }
    this.go('overview');
  }

  // ── навигация по вкладкам с ленивой загрузкой ──
  async go(tab: Tab): Promise<void> {
    this.tab.set(tab); this.error.set(null); this.saved.set(false);
    if (tab === 'overview') this.stats.set(await this.saas.stats(this.days()));
    if (tab === 'menu') await this.loadMenu();
    if (tab === 'tables') await this.loadTables();
    if (tab === 'settings') {
      const ve = this.saas.session()!.venue;
      this.v = { name: ve.name, headline: ve.headline, city: ve.city, address: ve.address, phone: ve.phone, instagram: ve.instagram,
                 wifi: ve.wifi, description: ve.description, accent: ve.accent || '#F7941D', logo: ve.logo, cover: ve.cover };
    }
  }
  async setDays(d: number): Promise<void> { this.days.set(d); this.stats.set(await this.saas.stats(d)); }

  // ── меню ──
  private async loadMenu(): Promise<void> {
    const m = await this.saas.menu();
    this.drafts.set([...m.beers, ...m.dishes].map(i => ({ ...i }))); this.removed.set([]); this.menuLimit.set(m.limit);
  }
  byKind(k: ItemKind): Draft[] { return this.drafts().filter(d => d.kind === k).sort((a, b) => a.sort_order - b.sort_order); }
  count(k: ItemKind): number { return this.drafts().filter(d => d.kind === k).length; }
  has(k: ItemKind, slug: string): boolean { return this.drafts().some(d => d.kind === k && d.ref_slug === slug); }
  refName(k: ItemKind, slug: string): string { return k === 'BEER' ? (this.data.brand(slug)?.display_name || slug) : (this.data.dish(slug)?.display_name || slug); }
  dishEmoji(slug: string): string { return this.data.dish(slug)?.emoji || '🍽️'; }
  dishName(slug: string): string { return this.data.dish(slug)?.display_name || slug; }
  beerName(slug: string): string { return this.data.brand(slug)?.display_name || slug; }
  patch(d: Draft, p: Partial<MenuItem>): void {
    if ('name' in p && p.name === this.refName(d.kind, d.ref_slug)) p.name = '';
    this.drafts.update(list => list.map(x => (x.id === d.id ? { ...x, ...p, dirty: true } : x)));
  }
  add(k: ItemKind, slug: string): void {
    if (this.has(k, slug)) return;
    if (this.drafts().length >= this.menuLimit()) { this.flash(`Лимит тарифа — ${this.menuLimit()} позиций`); return; }
    const brand = k === 'BEER' ? this.data.brand(slug) : null; const dish = k === 'DISH' ? this.data.dish(slug) : null;
    const pack = brand?.packaging_type || 'BOTTLE';
    this.drafts.update(list => [...list, {
      id: `new-${slug}`, kind: k, ref_slug: slug, name: '', description: '',
      category: brand ? (pack === 'DRAFT' ? 'Разливное' : 'Бутылка и банка') : (dish?.category || 'Основное'),
      price: brand ? (pack === 'DRAFT' ? 1800 : 1200) : ({ LIGHT: 1500, MEDIUM: 2500, HEAVY: 3800 } as Record<string, number>)[dish?.weight || 'MEDIUM'],
      volume: brand ? ({ DRAFT: '0.5 л', BOTTLE: '0.45 л', CAN: '0.5 л' } as Record<string, string>)[pack] : '',
      is_available: true, is_featured: false, sort_order: list.length, dirty: true,
    }]);
  }
  remove(d: Draft): void {
    this.drafts.update(list => list.filter(x => x.id !== d.id));
    if (!d.id.startsWith('new-')) this.removed.update(r => [...r, d.id]);
  }
  async save(): Promise<void> {
    this.busy.set(true);
    for (const id of this.removed()) await this.saas.removeItem(id);
    const rows = this.drafts().filter(d => d.dirty).map(({ dirty, id, ...rest }) => rest);
    const r = await this.saas.saveItems(rows);
    this.busy.set(false);
    await this.loadMenu();
    this.flash(r.ok ? (r.skipped ? `Сохранено, ${r.skipped} поз. не вошли в лимит тарифа` : 'Опубликовано — гости видят новые цены') : 'Не удалось сохранить');
  }

  // ── столы ──
  private async loadTables(): Promise<void> { const t = await this.saas.tables(); this.tables.set(t.tables); this.tableLimit.set(t.limit); }
  async addTables(): Promise<void> {
    this.busy.set(true); const r = await this.saas.addTables(+this.addN || 1); this.busy.set(false);
    if (!r.ok) { this.error.set(r.error || 'Не удалось добавить'); return; }
    await this.loadTables();
  }
  async removeTable(t: TableRow): Promise<void> { if (await this.saas.removeTable(t.id)) await this.loadTables(); }
  /** Web NFC (Chrome Android): пишем URL стола в NTAG-метку. iPhone читает такие метки без приложения. */
  async writeNfc(slug: string, t: TableRow): Promise<void> {
    if (!this.nfcSupported) { this.flash('Запись NFC работает в Chrome на Android. Или используйте приложение NFC Tools с этой же ссылкой.'); return; }
    this.nfcBusy.set(t.id);
    try {
      const ndef = new (window as any).NDEFReader();
      await ndef.write({ records: [{ recordType: 'url', data: this.menuUrl(slug, t.number) }] });
      this.flash(`Метка «${t.label}» записана — приклейте под стенд`);
    } catch (e) { this.flash('Не удалось записать: поднесите метку к телефону и повторите'); }
    finally { this.nfcBusy.set(null); }
  }
  menuUrl(slug: string, table: number): string { return `${location.origin}/m/${slug}/${table}`; }
  copy(text: string): void { navigator.clipboard?.writeText(text).then(() => this.flash('Ссылка скопирована')); }
  ago(iso: string): string {
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    return m < 60 ? `${m} мин назад` : m < 1440 ? `${Math.round(m / 60)} ч назад` : `${Math.round(m / 1440)} дн назад`;
  }

  // ── настройки ──
  async saveVenue(): Promise<void> {
    this.busy.set(true); const ok = await this.saas.saveVenue({ ...this.v }); this.busy.set(false); this.saved.set(ok);
  }

  fmt(n: number): string { return Math.round(n).toLocaleString('ru-RU'); }
  private flash(text: string): void { this.toast.set(text); setTimeout(() => this.toast.set(null), 2600); }
}

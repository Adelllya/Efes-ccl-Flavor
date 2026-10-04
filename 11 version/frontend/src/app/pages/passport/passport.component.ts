import { Component, DestroyRef, EventEmitter, OnInit, Output, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ActiveTab } from '../../models/navigation';
import { Brand, Passport, Redemption, Reward, Tasting } from '../../models/flavor-tree.models';
import { TastingDialogComponent } from '../../ui/tasting-dialog.component';

/** Правило начисления для карточки «за что дают баллы». */
interface RuleCard {
  kind: string;
  title: string;
  hint: string;
  each: number;
  count: number;
  points: number;
  tab: ActiveTab;
  action: string;
}

/** Ячейка сетки сортов: отмеченный сорт или ещё не пробованный. */
interface Stamp {
  id: string;
  name: string;
  style: string;
  image: string | null;
  tasting: Tasting | null;
}

/**
 * Паспорт вкуса: баллы знаний, ранг, отмеченные сорта, значки и награды.
 * Баллы даются за уроки, тесты, новые сорта и оценки пар. За покупки баллов нет,
 * алкоголь наградой быть не может.
 */
@Component({
  selector: 'app-passport',
  standalone: true,
  imports: [TastingDialogComponent],
  template: `
    <header class="pp-top">
      <span class="badge mb-md">Паспорт вкуса</span>
      <h1 class="pp-title">Баллы за знания, <span class="pp-accent">а не за количество</span></h1>
      <p class="pp-lede">
        Читайте уроки, отмечайте сорта, которые попробовали, и ноты, которые услышали. За это растут баллы и ранг.
        Баллы меняются на угощения от кухни, сувениры и события. За покупки баллов нет, алкоголь на баллы не выдаётся.
      </p>
    </header>

    @if (!auth.ready()) {
      <div class="skeleton-grid" aria-busy="true" aria-label="Проверяем сессию">
        <div class="skeleton-card"><div class="skeleton-line"></div><div class="skeleton-line"></div></div>
      </div>
    } @else if (!auth.isLoggedIn()) {
      <section class="pp-guest">
        <div>
          <h2 class="pp-h2">Заведите паспорт вкуса</h2>
          <p>Нужен аккаунт: так отметки и баллы сохранятся и будут с вами на любом устройстве.</p>
        </div>
        <div class="pp-guest-actions">
          <button type="button" class="btn-amber" (click)="navigate.emit('register')">Создать аккаунт</button>
          <button type="button" class="btn-outline" (click)="navigate.emit('login')">Войти</button>
        </div>
      </section>
    } @else if (failed()) {
      <div class="glass-panel pp-error" role="alert">
        <p>Не удалось загрузить паспорт. Проверьте соединение.</p>
        <button type="button" class="btn-outline" (click)="load()">Обновить</button>
      </div>
    } @else if (!passport()) {
      <div class="skeleton-grid" aria-busy="true" aria-label="Загружаем паспорт">
        @for (i of [1, 2, 3]; track i) {
          <div class="skeleton-card"><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div></div>
        }
      </div>
    } @else {
      @let p = passport()!;
      <section class="pp-rank" aria-label="Ранг и баллы">
        <div class="pp-rank-main">
          <span class="pp-rank-label">Ваш ранг</span>
          <b class="pp-rank-title">{{ p.rank.title }}</b>
          <div class="pp-bar" role="progressbar" aria-label="До следующего ранга"
               [attr.aria-valuenow]="p.points.earned" [attr.aria-valuemin]="p.rank.from"
               [attr.aria-valuemax]="p.rank.next_at ?? p.points.earned">
            <span [style.width.%]="rankPercent()"></span>
          </div>
          <span class="pp-rank-next">
            @if (p.rank.next_title) { До ранга «{{ p.rank.next_title }}» {{ p.rank.to_next }} баллов }
            @else { Высший ранг: вы прошли весь путь }
          </span>
        </div>
        <dl class="pp-stats">
          <div><dt>Баллов на счёте</dt><dd>{{ p.points.balance }}</dd></div>
          <div><dt>Заработано всего</dt><dd>{{ p.points.earned }}</dd></div>
          <div><dt>Сортов отмечено</dt><dd>{{ p.tastings.length }} из {{ p.brands_total }}</dd></div>
        </dl>
      </section>
    }

    <!-- За что дают баллы: видно и гостю -->
    <section class="pp-section">
      <h2 class="pp-h2">За что дают баллы</h2>
      <ul class="pp-rules">
        @for (rule of rules(); track rule.kind) {
          <li class="pp-rule">
            <span class="pp-rule-points">+{{ rule.each }}</span>
            <div class="pp-rule-body">
              <b>{{ rule.title }}</b>
              <span>{{ rule.hint }}</span>
            </div>
            <div class="pp-rule-foot">
              @if (passport()) { <span class="pp-rule-done">Получено {{ rule.points }}</span> }
              <button type="button" class="pp-rule-go" (click)="navigate.emit(rule.tab)">
                {{ rule.action }}
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>
              </button>
            </div>
          </li>
        }
      </ul>
    </section>

    @if (passport(); as p) {
      <section class="pp-section">
        <div class="pp-section-head">
          <h2 class="pp-h2">Мои сорта</h2>
          <span class="pp-muted">{{ p.tastings.length }} из {{ p.brands_total }}</span>
        </div>
        <ul class="pp-stamps">
          @for (s of stamps(); track s.id) {
            <li>
              <button type="button" class="pp-stamp" [class.done]="!!s.tasting" (click)="tasting.open(s.id, s.name)">
                <span class="pp-stamp-img">
                  @if (s.image) { <img [src]="s.image" [alt]="''" loading="lazy" /> }
                  @else {
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/></svg>
                  }
                </span>
                <span class="pp-stamp-name">{{ s.name }}</span>
                @if (s.tasting; as t) {
                  <span class="pp-stamp-stars" role="img" [attr.aria-label]="'Оценка ' + t.rating + ' из 5'">
                    @for (n of [1, 2, 3, 4, 5]; track n) { <i [class.on]="n <= t.rating"></i> }
                  </span>
                  <span class="pp-stamp-meta">Совпало нот: {{ t.matched }}</span>
                } @else {
                  <span class="pp-stamp-meta">{{ s.style || 'Ещё не пробовали' }}</span>
                  <span class="pp-stamp-add">Отметить</span>
                }
              </button>
            </li>
          }
        </ul>
        @if (!stamps().length) {
          <p class="pp-muted">Каталог сортов пока пуст.</p>
        }
      </section>

      <section class="pp-section">
        <h2 class="pp-h2">Значки</h2>
        <ul class="pp-badges">
          @for (b of p.badges; track b.id) {
            <li class="pp-badge" [class.earned]="b.earned">
              <span class="pp-badge-icon" aria-hidden="true">
                @if (b.earned) {
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                } @else {
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.5 12.9 17 22l-5-3-5 3 1.5-9.1"/></svg>
                }
              </span>
              <div class="pp-badge-body">
                <b>{{ b.title }}</b>
                <span>{{ b.description }}</span>
                <div class="pp-mini-bar" role="progressbar" [attr.aria-label]="b.title"
                     [attr.aria-valuenow]="b.progress" aria-valuemin="0" [attr.aria-valuemax]="b.target">
                  <span [style.width.%]="b.progress * 100 / b.target"></span>
                </div>
                <span class="pp-badge-count">{{ b.earned ? 'Получен' : b.progress + ' из ' + b.target }}</span>
              </div>
            </li>
          }
        </ul>
      </section>
    }

    <section class="pp-section">
      <div class="pp-section-head">
        <h2 class="pp-h2">Награды</h2>
        @if (passport(); as p) { <span class="pp-muted">На счёте {{ p.points.balance }} баллов</span> }
      </div>

      @if (activeCodes().length) {
        <ul class="pp-codes">
          @for (c of activeCodes(); track c.id) {
            <li class="pp-code">
              <div>
                <span class="pp-code-label">{{ c.title }}{{ c.venue ? ' · ' + c.venue.name : '' }}</span>
                <b class="pp-code-value" aria-label="Код награды">{{ c.code }}</b>
                <span class="pp-code-hint">Покажите код сотруднику. {{ c.venue ? 'Награду выдаёт заведение.' : 'Награду выдаёт команда Flavor Tree.' }}</span>
              </div>
              <button type="button" class="btn-outline" [disabled]="busyId() === c.id" (click)="cancel(c)">Вернуть баллы</button>
            </li>
          }
        </ul>
      }
      @if (rewardError(); as err) { <p class="pp-note-bad" role="alert">{{ err }}</p> }

      @if (!rewardsLoaded()) {
        <div class="skeleton-grid" aria-busy="true"><div class="skeleton-card"><div class="skeleton-line"></div><div class="skeleton-line"></div></div></div>
      } @else if (!rewards().length) {
        <p class="pp-empty">
          Наград пока нет. Их добавляют заведения в своей панели: угощение от кухни, сувенир или приглашение на событие.
        </p>
      } @else {
        <ul class="pp-rewards">
          @for (r of rewards(); track r.id) {
            <li class="pp-reward">
              <div class="pp-reward-body">
                <span class="pp-reward-kind">{{ r.kind_display }}{{ r.venue_name ? ' · ' + r.venue_name : '' }}</span>
                <b>{{ r.title }}</b>
                @if (r.description) { <span class="pp-reward-desc">{{ r.description }}</span> }
                @if (r.stock !== null) { <span class="pp-reward-stock">Осталось: {{ r.stock }}</span> }
              </div>
              <div class="pp-reward-side">
                <span class="pp-reward-cost">{{ r.cost }} баллов</span>
                @if (!passport()) {
                  <button type="button" class="btn-outline" (click)="navigate.emit('login')">Войти</button>
                } @else if (confirmId() === r.id) {
                  <div class="pp-confirm" role="group" aria-label="Подтверждение обмена">
                    <button type="button" class="btn-amber" [disabled]="busyId() === r.id" (click)="redeem(r)">
                      {{ busyId() === r.id ? 'Меняем...' : 'Обменять' }}
                    </button>
                    <button type="button" class="btn-outline" (click)="confirmId.set(null)">Отмена</button>
                  </div>
                } @else if (lack(r) > 0) {
                  <span class="pp-reward-lack">Не хватает {{ lack(r) }}</span>
                } @else if (r.stock === 0) {
                  <span class="pp-reward-lack">Закончилась</span>
                } @else {
                  <button type="button" class="btn-amber" (click)="confirmId.set(r.id)">Получить</button>
                }
              </div>
            </li>
          }
        </ul>
      }

      @if (usedCodes().length) {
        <details class="pp-history">
          <summary>История наград ({{ usedCodes().length }})</summary>
          <ul>
            @for (c of usedCodes(); track c.id) {
              <li>{{ c.title }} · {{ c.status_display.toLowerCase() }} · {{ c.cost }} баллов</li>
            }
          </ul>
        </details>
      }
    </section>

    <app-tasting-dialog #tasting (saved)="load()" (login)="navigate.emit('login')" />
  `,
  styles: [`
    :host { display: block; }
    .pp-top { margin-bottom: var(--space-3xl); }
    .pp-title { font-family: var(--font-heading); font-size: clamp(1.9rem, 4.2vw, 3rem); font-weight: 800; line-height: 1.1; letter-spacing: -0.02em; margin: 0 0 var(--space-lg); text-wrap: balance; }
    .pp-accent { background: linear-gradient(120deg, var(--beer-light), var(--beer-deep)); -webkit-background-clip: text; background-clip: text; color: transparent; }
    .pp-lede { max-width: 70ch; margin: 0; font-size: 1.0625rem; line-height: 1.65; color: var(--foam-dim); }
    .pp-h2 { margin: 0; font-family: var(--font-heading); font-size: 1.35rem; font-weight: 800; color: var(--foam); }
    .pp-muted { font-size: 0.875rem; color: var(--muted); }
    .pp-section { margin-top: var(--space-4xl); }
    .pp-section > .pp-h2 { margin-bottom: var(--space-lg); }
    .pp-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-md); margin-bottom: var(--space-lg); }
    .pp-error { display: grid; gap: var(--space-md); justify-items: center; padding: var(--space-3xl); text-align: center; }

    .pp-guest { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-xl); padding: var(--space-2xl); border: 1px solid var(--line); border-radius: var(--radius-2xl); background: linear-gradient(160deg, #fff, #FFF7EA); }
    .pp-guest p { margin: var(--space-sm) 0 0; color: var(--foam-dim); line-height: 1.55; }
    .pp-guest-actions { display: flex; flex-wrap: wrap; gap: var(--space-md); }

    .pp-rank { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr); gap: var(--space-2xl); align-items: center; padding: var(--space-2xl); border-radius: var(--radius-2xl); background: var(--grad-cta); color: #fff; box-shadow: var(--shadow-cta); }
    .pp-rank-main { display: grid; gap: var(--space-sm); }
    .pp-rank-label { font-size: 0.8125rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.9; }
    .pp-rank-title { font-family: var(--font-heading); font-size: clamp(1.6rem, 4vw, 2.3rem); line-height: 1.1; }
    .pp-bar { height: 10px; border-radius: var(--radius-full); background: rgba(255, 255, 255, 0.3); overflow: hidden; }
    .pp-bar span { display: block; height: 100%; border-radius: inherit; background: #fff; transition: width 600ms var(--ease-out); }
    .pp-rank-next { font-size: 0.9375rem; }
    .pp-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-md); margin: 0; }
    .pp-stats div { padding: var(--space-md); border-radius: var(--radius-lg); background: rgba(255, 255, 255, 0.16); }
    .pp-stats dt { font-size: 0.75rem; line-height: 1.3; opacity: 0.92; }
    .pp-stats dd { margin: 4px 0 0; font-family: var(--font-heading); font-size: 1.35rem; font-weight: 800; font-variant-numeric: tabular-nums; }

    .pp-rules { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: var(--space-md); }
    .pp-rule { display: flex; flex-direction: column; gap: var(--space-md); padding: var(--space-lg); border: 1px solid var(--line); border-radius: var(--radius-xl); background: var(--bg-1); }
    .pp-rule-points { align-self: flex-start; min-width: 56px; height: 40px; padding: 0 12px; display: grid; place-content: center; border-radius: 12px; background: var(--beer-glow); color: var(--beer-deep); font-family: var(--font-heading); font-size: 1.1rem; font-weight: 800; }
    .pp-rule-body { flex: 1; min-width: 0; display: grid; gap: 4px; align-content: start; }
    .pp-rule-body span { font-size: 0.8125rem; line-height: 1.45; color: var(--muted); }
    .pp-rule-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px var(--space-sm); }
    .pp-rule-done { font-size: 0.8125rem; font-weight: 700; color: #166534; }
    .pp-rule-go { display: inline-flex; align-items: center; gap: 4px; min-height: 40px; padding: 0; border: none; border-radius: var(--radius-md); background: none; color: var(--beer-mid); font: inherit; font-size: 0.875rem; font-weight: 700; cursor: pointer; }
    .pp-rule-go:hover { text-decoration: underline; }
    .pp-rule-go:focus-visible { outline: 3px solid var(--beer-light); outline-offset: 2px; }

    .pp-stamps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--space-md); }
    .pp-stamp { width: 100%; height: 100%; display: grid; justify-items: center; align-content: start; gap: 6px; padding: var(--space-lg) var(--space-md); border: 1.5px dashed rgba(180, 83, 9, 0.35); border-radius: var(--radius-xl); background: var(--bg-0); color: inherit; font: inherit; text-align: center; cursor: pointer; transition: border-color var(--duration-fast) ease, transform var(--duration-fast) ease; }
    .pp-stamp:hover { border-color: var(--beer-light); transform: translateY(-2px); }
    .pp-stamp:focus-visible { outline: 3px solid var(--beer-light); outline-offset: 2px; }
    .pp-stamp.done { border-style: solid; border-color: rgba(22, 163, 74, 0.45); background: var(--bg-1); }
    .pp-stamp-img { width: 64px; height: 84px; display: grid; place-content: center; color: rgba(180, 83, 9, 0.45); }
    .pp-stamp-img img { max-width: 64px; max-height: 84px; object-fit: contain; filter: grayscale(1) opacity(0.5); }
    .pp-stamp.done .pp-stamp-img img { filter: none; }
    .pp-stamp-img svg { width: 40px; height: 40px; }
    .pp-stamp-name { font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }
    .pp-stamp-meta { font-size: 0.75rem; color: var(--muted); }
    .pp-stamp-add { font-size: 0.8125rem; font-weight: 700; color: var(--beer-mid); }
    .pp-stamp-stars { display: inline-flex; gap: 3px; }
    .pp-stamp-stars i { width: 9px; height: 9px; border-radius: 50%; background: rgba(180, 83, 9, 0.2); }
    .pp-stamp-stars i.on { background: var(--beer-light); }

    .pp-badges { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--space-md); }
    .pp-badge { display: flex; gap: var(--space-md); padding: var(--space-lg); border: 1px solid var(--line); border-radius: var(--radius-xl); background: var(--bg-1); }
    .pp-badge-icon { flex-shrink: 0; width: 44px; height: 44px; display: grid; place-content: center; border-radius: 50%; background: var(--bg-0); border: 1.5px solid var(--line); color: var(--muted); }
    .pp-badge-icon svg { width: 22px; height: 22px; }
    .pp-badge.earned { border-color: rgba(22, 163, 74, 0.4); }
    .pp-badge.earned .pp-badge-icon { background: #16a34a; border-color: #16a34a; color: #fff; }
    .pp-badge-body { flex: 1; min-width: 0; display: grid; gap: 4px; }
    .pp-badge-body > span { font-size: 0.8125rem; line-height: 1.45; color: var(--muted); }
    .pp-mini-bar { height: 6px; margin-top: 4px; border-radius: var(--radius-full); background: rgba(180, 83, 9, 0.12); overflow: hidden; }
    .pp-mini-bar span { display: block; height: 100%; border-radius: inherit; background: var(--beer-light); }
    .pp-badge.earned .pp-mini-bar span { background: #16a34a; }
    .pp-badge-count { font-weight: 700; }
    .pp-badge.earned .pp-badge-count { color: #166534 !important; }

    .pp-codes { list-style: none; margin: 0 0 var(--space-lg); padding: 0; display: grid; gap: var(--space-md); }
    .pp-code { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-lg); padding: var(--space-lg) var(--space-xl); border: 2px solid var(--beer-mid); border-radius: var(--radius-xl); background: #FFF7EA; }
    .pp-code > div { display: grid; gap: 4px; min-width: 0; }
    .pp-code-label { font-weight: 700; }
    .pp-code-value { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: clamp(1.8rem, 7vw, 2.4rem); letter-spacing: 0.18em; color: var(--beer-deep); }
    .pp-code-hint { font-size: 0.8125rem; color: var(--muted); }
    .pp-note-bad { margin: 0 0 var(--space-lg); padding: var(--space-md) var(--space-lg); border-radius: var(--radius-lg); background: #FEF2F2; border: 1px solid rgba(220, 38, 38, 0.3); color: #7f1d1d; }
    .pp-empty { margin: 0; padding: var(--space-xl); border: 1px dashed rgba(180, 83, 9, 0.35); border-radius: var(--radius-xl); color: var(--muted); line-height: 1.6; }
    .pp-rewards { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-md); }
    .pp-reward { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-lg); padding: var(--space-lg) var(--space-xl); border: 1px solid var(--line); border-radius: var(--radius-xl); background: var(--bg-1); }
    .pp-reward-body { flex: 1 1 260px; min-width: 0; display: grid; gap: 4px; }
    .pp-reward-kind { font-size: 0.75rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--beer-mid); }
    .pp-reward-desc, .pp-reward-stock { font-size: 0.875rem; line-height: 1.5; color: var(--muted); }
    .pp-reward-side { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-md); }
    .pp-reward-cost { font-family: var(--font-heading); font-weight: 800; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .pp-reward-lack { font-size: 0.875rem; font-weight: 600; color: var(--muted); }
    .pp-reward .btn-amber, .pp-reward .btn-outline, .pp-code .btn-outline { min-height: 44px; }
    .pp-confirm { display: flex; gap: var(--space-sm); }
    .pp-history { margin-top: var(--space-lg); color: var(--muted); font-size: 0.875rem; }
    .pp-history summary { min-height: 44px; display: inline-flex; align-items: center; cursor: pointer; font-weight: 700; color: var(--foam-dim); }
    .pp-history ul { margin: var(--space-sm) 0 0; padding-left: 20px; display: grid; gap: 6px; }

    @media (max-width: 1100px) {
      .pp-rules { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
    @media (max-width: 860px) {
      .pp-rank { grid-template-columns: 1fr; }
    }
    @media (max-width: 600px) {
      .pp-top { margin-bottom: var(--space-2xl); }
      .pp-section { margin-top: var(--space-3xl); }
      .pp-rank, .pp-guest { padding: var(--space-lg); }
      .pp-stats { gap: var(--space-sm); }
      .pp-stats div { padding: var(--space-sm) var(--space-md); }
      .pp-stats dd { font-size: 1.1rem; }
      .pp-rules { grid-template-columns: 1fr; }
      .pp-rule { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; }
      .pp-rule-foot { grid-column: 2; }
      .pp-stamps { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .pp-reward-side { width: 100%; justify-content: space-between; }
    }
    @media (prefers-reduced-motion: reduce) {
      .pp-bar span { transition: none; }
      .pp-stamp:hover { transform: none; }
    }
  `],
})
export class PassportComponent implements OnInit {
  private api = inject(ApiService);
  private destroyRef = inject(DestroyRef);
  readonly auth = inject(AuthService);

  @Output() navigate = new EventEmitter<ActiveTab>();

  readonly tasting = viewChild.required<TastingDialogComponent>('tasting');

  readonly passport = signal<Passport | null>(null);
  readonly failed = signal(false);
  readonly brands = signal<Brand[]>([]);
  readonly rewards = signal<Reward[]>([]);
  readonly rewardsLoaded = signal(false);
  readonly rewardError = signal('');
  /** Награда, для которой показано подтверждение обмена. */
  readonly confirmId = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);

  readonly rankPercent = computed(() => {
    const p = this.passport();
    if (!p) return 0;
    if (p.rank.next_at === null) return 100;
    const span = p.rank.next_at - p.rank.from;
    return span > 0 ? Math.min(100, Math.round((p.points.earned - p.rank.from) * 100 / span)) : 0;
  });

  readonly rules = computed<RuleCard[]>(() => {
    const p = this.passport();
    const r = p?.rules ?? { lesson: 10, level: 50, tasting: 15, notes: 5, feedback: 3, notes_from: 2, feedback_cap: 20 };
    const row = (kind: string) => p?.breakdown.find(b => b.kind === kind);
    const card = (kind: string, title: string, hint: string, each: number, tab: ActiveTab, action: string): RuleCard =>
      ({ kind, title, hint, each, tab, action, count: row(kind)?.count ?? 0, points: row(kind)?.points ?? 0 });
    return [
      card('lessons', 'Урок Академии', 'Короткий урок на 3-4 минуты', r.lesson, 'academy', 'К урокам'),
      card('levels', 'Тест ступени', 'Сдать тест одной из четырёх ступеней', r.level, 'academy', 'К тестам'),
      card('tastings', 'Новый сорт', 'Отметить сорт, который попробовали. Один раз за сорт', r.tasting, 'explorer', 'В каталог'),
      card('notes', 'Услышанные ноты', `Совпало ${r.notes_from} ноты и больше с пирамидой сомелье`, r.notes, 'explorer', 'В каталог'),
      card('feedback', 'Оценка пары', `Подошло ли пиво к блюду. Первые ${r.feedback_cap} оценок`, r.feedback, 'pairing', 'К парам'),
    ];
  });

  /** Сначала отмеченные сорта, затем остальной каталог. */
  readonly stamps = computed<Stamp[]>(() => {
    const tastings = this.passport()?.tastings ?? [];
    const done = new Set(tastings.map(t => t.brand.id));
    const list: Stamp[] = tastings.map(t => ({ id: t.brand.id, name: t.brand.name, style: t.brand.style, image: t.brand.image, tasting: t }));
    for (const b of this.brands()) {
      if (!done.has(b.id)) list.push({ id: b.id, name: b.name, style: b.style, image: b.image ?? null, tasting: null });
    }
    return list;
  });

  readonly activeCodes = computed(() => (this.passport()?.redemptions ?? []).filter(c => c.status === 'ISSUED'));
  readonly usedCodes = computed(() => (this.passport()?.redemptions ?? []).filter(c => c.status !== 'ISSUED'));

  constructor() {
    // Вошли или вышли: паспорт у каждого свой
    effect(() => {
      const user = this.auth.user();
      const ready = this.auth.ready();
      untracked(() => {
        if (!ready) return;
        if (user) this.load();
        else this.passport.set(null);
      });
    }, { allowSignalWrites: true });
  }

  ngOnInit() {
    this.api.getBrands().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: list => this.brands.set(list.filter(b => b.is_active !== false)),
      error: () => this.brands.set([]),
    });
    this.loadRewards();
  }

  load() {
    this.failed.set(false);
    this.api.getPassport().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: p => this.passport.set(p),
      error: () => { if (!this.passport()) this.failed.set(true); },
    });
  }

  private loadRewards() {
    this.api.getRewards().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: list => { this.rewards.set(list); this.rewardsLoaded.set(true); },
      error: () => { this.rewards.set([]); this.rewardsLoaded.set(true); },
    });
  }

  /** Сколько баллов не хватает до награды. */
  lack(r: Reward): number {
    return Math.max(r.cost - (this.passport()?.points.balance ?? 0), 0);
  }

  redeem(r: Reward) {
    if (this.busyId()) return;
    this.busyId.set(r.id);
    this.rewardError.set('');
    this.api.redeemReward(r.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.busyId.set(null);
        this.confirmId.set(null);
        this.load();
        this.loadRewards();
      },
      error: err => {
        this.busyId.set(null);
        this.confirmId.set(null);
        this.rewardError.set(err?.error?.error || AuthService.errorText(err));
      },
    });
  }

  cancel(c: Redemption) {
    if (this.busyId()) return;
    this.busyId.set(c.id);
    this.rewardError.set('');
    this.api.cancelRedemption(c.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.busyId.set(null);
        this.load();
        this.loadRewards();
      },
      error: err => {
        this.busyId.set(null);
        this.rewardError.set(err?.error?.error || AuthService.errorText(err));
      },
    });
  }
}

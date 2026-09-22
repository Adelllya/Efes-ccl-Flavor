import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { Brand, FlavorNote, PyramidLayer, Dish, FoodPairing, ServingRecommendation } from '../../models/flavor-tree.models';

type AdminTab = 'overview' | 'brands' | 'pyramid' | 'serving' | 'pairings' | 'notes';

@Component({
  selector: 'app-sommelier-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div style="display: grid; grid-template-columns: 260px 1fr; gap: 24px; min-height: 80vh; align-items: start;">
      
      <!-- ═══════════════════════════════════════════════════════════════════════════════
           АТЕРНОС-СТИЛЬ: ЛЕВОЕ БОКОВОЕ МЕНЮ (SIDEBAR)
      ═══════════════════════════════════════════════════════════════════════════════ -->
      <div style="background: var(--bg-1); border: 1px solid var(--line); border-radius: 20px; overflow: hidden; position: sticky; top: 100px; box-shadow: 0 10px 30px rgba(0,0,0,0.04);">
        
        <!-- Шапка сервера / Проекта -->
        <div style="padding: 20px 18px; border-bottom: 1px solid var(--line); background: rgba(0,0,0,0.02);">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
            <span style="font-weight: 800; font-size: 1.1rem; letter-spacing: -0.02em;">Flavor Tree</span>
            <span style="display: inline-flex; align-items: center; gap: 5px; font-size: 0.75rem; font-weight: 700; color: #15803d; background: rgba(22,163,74,0.12); padding: 3px 8px; border-radius: 999px;">
              <span style="width: 7px; height: 7px; border-radius: 50%; background: #16a34a; display: inline-block; box-shadow: 0 0 6px #16a34a;"></span>
              Online
            </span>
          </div>
          <p style="font-size: 0.78rem; color: var(--muted); margin: 0; font-family: monospace;">api.flavortree.kz:8000</p>
        </div>

        <!-- Вкладки навигации -->
        <div style="padding: 12px 8px; display: flex; flex-direction: column; gap: 4px;">
          
          <button
            class="sidebar-tab-btn"
            [class.active]="activeTab === 'overview'"
            (click)="activeTab = 'overview'"
          >
            <svg class="adm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            <span style="font-weight: 600; flex: 1; text-align: left;">Обзор & Статус</span>
          </button>

          <button
            class="sidebar-tab-btn"
            [class.active]="activeTab === 'brands'"
            (click)="activeTab = 'brands'"
          >
            <svg class="adm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3"/></svg>
            <span style="font-weight: 600; flex: 1; text-align: left;">Сорта & Фото</span>
            <span class="badge-mini">{{ brands().length }}</span>
          </button>

          <button
            class="sidebar-tab-btn"
            [class.active]="activeTab === 'pyramid'"
            (click)="activeTab = 'pyramid'"
          >
            <svg class="adm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 21h20L12 3Z"/><path d="M8.5 15h7"/><path d="M10 11h4"/></svg>
            <span style="font-weight: 600; flex: 1; text-align: left;">Вкусовая Пирамида</span>
          </button>

          <button
            class="sidebar-tab-btn"
            [class.active]="activeTab === 'serving'"
            (click)="activeTab = 'serving'"
          >
            <svg class="adm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0Z"/></svg>
            <span style="font-weight: 600; flex: 1; text-align: left;">Подача & Бокалы</span>
          </button>

          <button
            class="sidebar-tab-btn"
            [class.active]="activeTab === 'pairings'"
            (click)="activeTab = 'pairings'"
          >
            <svg class="adm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>
            <span style="font-weight: 600; flex: 1; text-align: left;">Фуд-пейринг</span>
            <span class="badge-mini">{{ pairings().length }}</span>
          </button>

          <button
            class="sidebar-tab-btn"
            [class.active]="activeTab === 'notes'"
            (click)="activeTab = 'notes'"
          >
            <svg class="adm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>
            <span style="font-weight: 600; flex: 1; text-align: left;">Справочник Нот</span>
            <span class="badge-mini">{{ notes().length }}</span>
          </button>

        </div>

        <!-- Нижняя ссылка в Django Admin -->
        <div style="padding: 14px 16px; border-top: 1px solid var(--line); background: rgba(0,0,0,0.01); display: flex; flex-direction: column; gap: 8px;">
          <a
            href="http://127.0.0.1:8000/admin/"
            target="_blank"
            style="display: flex; align-items: center; gap: 8px; font-size: 0.82rem; color: var(--muted); text-decoration: none; font-weight: 600;"
          >
            <svg class="adm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.5.63 1 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg> Django Admin Panel ↗
          </a>
        </div>

      </div>


      <!-- ═══════════════════════════════════════════════════════════════════════════════
           ПРАВАЯ РАБОЧАЯ ОБЛАСТЬ (MAIN CONTENT AREA)
      ═══════════════════════════════════════════════════════════════════════════════ -->
      <div>

        <!-- ─────────────────────────────────────────────────────────────────────────────
             ВКЛАДКА 1: ОБЗОР & СТАТУС (OVERVIEW)
        ───────────────────────────────────────────────────────────────────────────── -->
        @if (activeTab === 'overview') {
          <div style="display: flex; flex-direction: column; gap: 24px;">
            <!-- Большой баннер в стиле Aternos Server Hero -->
            <div class="glass-panel" style="padding: 32px; background: linear-gradient(135deg, rgba(224,138,40,0.1) 0%, rgba(22,163,74,0.06) 100%); border: 1px solid rgba(224,138,40,0.25);">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 16px;">
                <div>
                  <span class="badge" style="background: rgba(22,163,74,0.15); color: #15803d; margin-bottom: 8px;">● Сервер активен & подключен</span>
                  <h1 style="font-size: 2.2rem; margin: 4px 0 8px;">Flavor Tree • Сенсорная Среда</h1>
                  <p style="color: var(--muted); margin: 0; font-size: 0.95rem;">Управление 17 сортами, дегустационными пирамидами и гастрономическими парами</p>
                </div>

                <div style="display: flex; gap: 10px;">
                  <button class="btn-amber" (click)="loadData()"><svg class="adm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg> Обновить данные</button>
                </div>
              </div>
            </div>

            <!-- Сетка статистики -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 18px;">
              <div class="glass-card" style="padding: 22px; cursor: pointer;" (click)="activeTab = 'brands'">
                <svg class="adm-tile-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" x2="6" y1="2" y2="4"/><line x1="10" x2="10" y1="2" y2="4"/><line x1="14" x2="14" y1="2" y2="4"/></svg>
                <h3 style="font-size: 1.8rem; margin: 8px 0 2px;">{{ brands().length }}</h3>
                <p style="color: var(--muted); margin: 0; font-size: 0.88rem; font-weight: 600;">Сортов в базе (100% активны)</p>
              </div>

              <div class="glass-card" style="padding: 22px; cursor: pointer;" (click)="activeTab = 'notes'">
                <svg class="adm-tile-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>
                <h3 style="font-size: 1.8rem; margin: 8px 0 2px;">{{ notes().length }}</h3>
                <p style="color: var(--muted); margin: 0; font-size: 0.88rem; font-weight: 600;">Вкусовых сенсорных нот</p>
              </div>

              <div class="glass-card" style="padding: 22px; cursor: pointer;" (click)="activeTab = 'pairings'">
                <svg class="adm-tile-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>
                <h3 style="font-size: 1.8rem; margin: 8px 0 2px;">{{ pairings().length }}</h3>
                <p style="color: var(--muted); margin: 0; font-size: 0.88rem; font-weight: 600;">Гастропар с блюдами</p>
              </div>

              <!-- Раньше здесь было «PostgreSQL / app_db»: движок базы берётся из
                   настроек и на демо это SQLite, то есть плитка показывала неправду.
                   Заменили на показатель, который сомелье реально ведёт. -->
              <div class="glass-card" style="padding: 22px; cursor: pointer;" (click)="activeTab = 'pyramid'">
                <svg class="adm-tile-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 21h20L12 3Z"/><path d="m9 16 2 2 4-4"/></svg>
                <h3 style="font-size: 1.8rem; margin: 8px 0 2px;">{{ completePyramids() }}<span style="font-size: 1rem; color: var(--muted);">/{{ brands().length }}</span></h3>
                <p style="color: var(--muted); margin: 0; font-size: 0.88rem; font-weight: 600;">Пирамид заполнено до конца</p>
              </div>
            </div>

            <!-- Быстрые действия -->
            <div class="glass-panel" style="padding: 28px;">
              <h3 style="font-size: 1.25rem; margin-bottom: 16px;">Быстрый переход к настройкам:</h3>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px;">
                <div class="glass-card" style="padding: 18px; display: flex; flex-direction: row; align-items: center; gap: 14px; cursor: pointer;" (click)="activeTab = 'brands'">
                  <svg class="adm-tile-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3"/></svg>
                  <div>
                    <h4 style="margin: 0; font-size: 1rem;">Загрузить фото для сорта</h4>
                    <p style="margin: 2px 0 0; font-size: 0.82rem; color: var(--muted);">Прикрепить изображение бутылки/бокала</p>
                  </div>
                </div>

                <div class="glass-card" style="padding: 18px; display: flex; flex-direction: row; align-items: center; gap: 14px; cursor: pointer;" (click)="activeTab = 'pyramid'">
                  <svg class="adm-tile-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 21h20L12 3Z"/><path d="M8.5 15h7"/><path d="M10 11h4"/></svg>
                  <div>
                    <h4 style="margin: 0; font-size: 1rem;">Калибровка пирамиды</h4>
                    <p style="margin: 2px 0 0; font-size: 0.82rem; color: var(--muted);">Top, Heart, Base ноты и интенсивность</p>
                  </div>
                </div>

                <div class="glass-card" style="padding: 18px; display: flex; flex-direction: row; align-items: center; gap: 14px; cursor: pointer;" (click)="activeTab = 'serving'">
                  <svg class="adm-tile-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0Z"/></svg>
                  <div>
                    <h4 style="margin: 0; font-size: 1rem;">Температура подачи & Бокалы</h4>
                    <p style="margin: 2px 0 0; font-size: 0.82rem; color: var(--muted);">Рекомендации для баров и ресторанов</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        }


        <!-- ─────────────────────────────────────────────────────────────────────────────
             ВКЛАДКА 2: СОРТА & ФОТОГРАФИИ (BRANDS & PHOTOS)
        ───────────────────────────────────────────────────────────────────────────── -->
        @if (activeTab === 'brands') {
          <div class="glass-panel" style="padding: 32px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 12px;">
              <div>
                <h2 style="font-size: 1.8rem; margin: 0;">Сорта пива & Фотографии</h2>
                <p style="color: var(--muted); margin-top: 4px; font-size: 0.9rem;">Выберите сорт для прикрепления фотографии бутылки/бокала</p>
              </div>

              <!-- Выбор бренда -->
              <div style="min-width: 320px;">
                <select [(ngModel)]="selectedBrandId" (change)="onBrandChange()" style="padding: 12px 16px; border-radius: 12px; border: 1px solid var(--line); width: 100%; font-size: 1rem; background: var(--bg-1); font-weight: 600;">
                  @for (b of brands(); track b.id) {
                    <option [value]="b.id">{{ b.name }} ({{ b.style }})</option>
                  }
                </select>
              </div>
            </div>

            <!-- 2-колоночный редактор сорта -->
            <div style="display: grid; grid-template-columns: 1fr 340px; gap: 32px; align-items: start;">
              
              <!-- Левая часть: информация о выбранном сорте -->
              @if (currentBrand(); as b) {
                <div style="display: flex; flex-direction: column; gap: 20px;">
                  <div class="glass-card" style="padding: 24px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                      <span class="badge">{{ b.style }}</span>
                      @if (b.is_horeca_only) {
                        <span class="badge" style="background: rgba(168,85,12,0.15); color: var(--beer-deep);">🍷 HoReCa Only</span>
                      } @else {
                        <span class="badge" style="background: rgba(224,138,40,0.08);">{{ b.packaging_type_display || b.packaging_type }}</span>
                      }
                    </div>

                    <h3 style="font-size: 1.6rem; margin-bottom: 4px;">{{ b.name }}</h3>
                    @if (b.brand_owner) {
                      <p style="font-size: 0.85rem; color: var(--muted); margin-bottom: 12px; text-transform: uppercase;">{{ b.brand_owner }}</p>
                    }
                    <p style="font-size: 0.95rem; color: var(--foam-dim); line-height: 1.5; margin-bottom: 20px;">{{ b.description }}</p>

                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding: 14px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); font-size: 0.9rem;">
                      <div>
                        <span style="color: var(--muted); font-size: 0.8rem; display: block;">ABV:</span>
                        <strong>{{ b.abv !== null && b.abv !== undefined ? b.abv + '%' : 'N/A' }}</strong>
                      </div>
                      <div>
                        <span style="color: var(--muted); font-size: 0.8rem; display: block;">Плотность:</span>
                        <strong>{{ b.density || 'N/A' }}</strong>
                      </div>
                      <div>
                        <span style="color: var(--muted); font-size: 0.8rem; display: block;">Брожение:</span>
                        <strong>{{ b.fermentation_type || 'Нижнее' }}</strong>
                      </div>
                    </div>
                  </div>

                  <!-- Статус вкусового профиля -->
                  <div class="glass-card" style="padding: 20px; display: flex; flex-direction: row; justify-content: space-between; align-items: center;">
                    <div>
                      <h4 style="margin: 0 0 4px; font-size: 1.05rem;">Вкусовая пирамида сорта</h4>
                      <p style="margin: 0; font-size: 0.85rem; color: var(--muted);">
                        @if (b.profile?.complete) {
                          <span style="color: #16a34a; font-weight: 700; display: inline-flex; align-items: center; gap: 6px;"><svg class="adm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> Профиль полностью заполнен (Top, Heart, Base)</span>
                        } @else {
                          <span style="color: var(--beer-deep); font-weight: 600;">🟡 Требуется калибровка нот</span>
                        }
                      </p>
                    </div>
                    <button class="btn-outline" (click)="activeTab = 'pyramid'"><svg class="adm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 21h20L12 3Z"/><path d="M8.5 15h7"/><path d="M10 11h4"/></svg> Открыть конструктор</button>
                  </div>
                </div>
              }

              <!-- Правая часть: виджет загрузки фото -->
              <div style="background: var(--bg-1); border: 1px solid var(--line); border-radius: 20px; padding: 24px; display: flex; flex-direction: column; align-items: center; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.03);">
                <div style="font-weight: 700; font-size: 1.05rem; margin-bottom: 14px; display: flex; align-items: center; gap: 6px;">
                  <svg class="adm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3"/></svg> Фотография сорта
                </div>

                <!-- Контейнер для фото -->
                <div style="width: 100%; height: 240px; background: rgba(0,0,0,0.02); border-radius: 14px; border: 1px dashed var(--line); display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden; margin-bottom: 18px; padding: 12px;">
                  @if (previewUrl()) {
                    <img [src]="previewUrl()" alt="Preview" style="max-height: 100%; max-width: 100%; object-fit: contain; filter: drop-shadow(0 6px 14px rgba(0,0,0,0.18)); transform: scale(1.08);" />
                    <span class="badge" style="position: absolute; bottom: 8px; font-size: 0.75rem; background: rgba(0,0,0,0.75); color: #fff;">Новое фото</span>
                  } @else if (currentBrand()?.image) {
                    <img [src]="currentBrand()?.image" alt="Brand" style="max-height: 100%; max-width: 100%; object-fit: contain; filter: drop-shadow(0 6px 14px rgba(0,0,0,0.18)); transform: scale(1.08);" />
                    <span class="badge" style="position: absolute; bottom: 8px; font-size: 0.75rem; background: var(--beer-amber); color: #000;">Сохранено на сервере</span>
                  } @else {
                    <div style="color: var(--muted); font-size: 0.88rem;">
                      <div style="margin-bottom: 6px; opacity: 0.35; color: var(--beer-mid);"><svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4v3.5l2 3V21a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V8.5l2-3V2Z"/><path d="M8 12h8"/></svg></div>
                      Фото не загружено
                    </div>
                  }
                </div>

                <!-- Выбор файла -->
                <input
                  type="file"
                  accept="image/*"
                  #brandPhotoInput
                  (change)="onFileSelected($event)"
                  style="display: none;"
                />

                <div style="display: flex; flex-direction: column; gap: 8px; width: 100%;">
                  <button class="btn-outline" style="width: 100%; justify-content: center;" (click)="brandPhotoInput.click()">
                    <svg class="adm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg> Выбрать фото с диска
                  </button>

                  @if (selectedFile) {
                    <button
                      class="btn-amber"
                      style="width: 100%; justify-content: center; font-size: 0.92rem;"
                      [disabled]="isUploading()"
                      (click)="uploadPhoto()"
                    >
                      @if (isUploading()) {
                        ⏳ Загрузка в Django...
                      } @else {
                        📤 Сохранить фото для «{{ currentBrand()?.name }}»
                      }
                    </button>
                  }
                </div>

                @if (uploadSuccess()) {
                  <span style="color: #1a5e28; font-weight: 700; font-size: 0.88rem; margin-top: 10px; display: inline-flex; align-items: center; gap: 6px;"><svg class="adm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> Фото успешно загружено и обновлено!</span>
                }
                @if (uploadError()) {
                  <span style="color: #991b1b; font-weight: 600; font-size: 0.85rem; margin-top: 10px;">❌ {{ uploadError() }}</span>
                }

                <!-- Подпись рекомендаций -->
                <div style="margin-top: 18px; padding: 12px; background: rgba(224,138,40,0.06); border-radius: 12px; border: 1px dashed rgba(224,138,40,0.3); font-size: 0.78rem; color: var(--foam-dim); text-align: left; line-height: 1.45; width: 100%;">
                  <div style="font-weight: 700; color: var(--beer-deep); margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
                    <svg class="adm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 21h20L12 3Z"/><path d="M8.5 15h7"/><path d="M10 11h4"/></svg> Рекомендации к загрузке:
                  </div>
                  <div>• <strong>Масштаб:</strong> 3:4 (вертикальное) или 1:1</div>
                  <div>• <strong>Оптимальный размер:</strong> 600×800 px или 800×800 px</div>
                  <div>• <strong>Формат:</strong> PNG / WEBP без фона или студийный кадр</div>
                </div>
              </div>

            </div>
          </div>
        }


        <!-- ─────────────────────────────────────────────────────────────────────────────
             ВКЛАДКА 3: ВКУСОВАЯ ПИРАМИДА (PYRAMID BUILDER)
        ───────────────────────────────────────────────────────────────────────────── -->
        @if (activeTab === 'pyramid') {
          <div class="glass-panel" style="padding: 32px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 12px;">
              <div>
                <h2 style="font-size: 1.8rem; margin: 0;">Конструктор Вкусовой Пирамиды</h2>
                <p style="color: var(--muted); margin-top: 4px; font-size: 0.9rem;">Калибровка нот аромата (Top), солодового тела (Heart) и финиша (Base)</p>
              </div>

              <!-- Выбор бренда -->
              <div style="min-width: 320px;">
                <select [(ngModel)]="selectedBrandId" style="padding: 12px 16px; border-radius: 12px; border: 1px solid var(--line); width: 100%; font-size: 1rem; background: var(--bg-1); font-weight: 600;">
                  @for (b of brands(); track b.id) {
                    <option [value]="b.id">{{ b.name }} ({{ b.style }})</option>
                  }
                </select>
              </div>
            </div>

            <!-- Редактор слоя -->
            <div class="glass-card" style="padding: 28px; margin-bottom: 24px;">
              <h3 style="font-size: 1.25rem; margin-bottom: 18px;">Добавление и калибровка ноты:</h3>

              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; margin-bottom: 20px;">
                <div>
                  <label style="display: block; font-weight: 600; font-size: 0.9rem; margin-bottom: 6px; color: var(--muted);">Слой пирамиды:</label>
                  <select [(ngModel)]="selectedLayer" style="padding: 12px; border-radius: 12px; border: 1px solid var(--line); width: 100%; background: var(--bg-1);">
                    <option value="TOP">🌿 TOP (0–3 сек • Аромат)</option>
                    <option value="HEART">🌾 HEART (3–15 сек • Тело)</option>
                    <option value="BASE">⚡ BASE (15+ сек • Послевкусие)</option>
                  </select>
                </div>

                <div>
                  <label style="display: block; font-weight: 600; font-size: 0.9rem; margin-bottom: 6px; color: var(--muted);">Вкусовая нота из справочника:</label>
                  <select [(ngModel)]="selectedNoteId" style="padding: 12px; border-radius: 12px; border: 1px solid var(--line); width: 100%; background: var(--bg-1);">
                    @for (n of notes(); track n.id) {
                      <option [value]="n.id">{{ n.icon }} {{ n.name }} ({{ n.category }})</option>
                    }
                  </select>
                </div>

                <div>
                  <label style="display: block; font-weight: 600; font-size: 0.9rem; margin-bottom: 6px; color: var(--muted);">Интенсивность: {{ intensity }}/10</label>
                  <input type="range" min="1" max="10" [(ngModel)]="intensity" style="width: 100%; margin-top: 12px;" />
                </div>
              </div>

              <!-- Заметка сомелье -->
              <div style="margin-bottom: 20px;">
                <label style="display: block; font-weight: 600; font-size: 0.9rem; margin-bottom: 6px; color: var(--muted);">Дегустационный комментарий сомелье:</label>
                <textarea
                  [(ngModel)]="sommelierComment"
                  rows="2"
                  placeholder="Например: Чистая хмелевая волна с нотами благородных европейских сортов..."
                  style="width: 100%; padding: 12px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg-1);"
                ></textarea>
              </div>

              <div style="display: flex; gap: 16px; align-items: center; flex-wrap: wrap;">
                <button class="btn-amber" (click)="saveToDjango()">
                  💾 Сохранить ноту в Django REST API
                </button>

                @if (saveSuccess()) {
                  <span style="color: #1a5e28; font-weight: 700; display: inline-flex; align-items: center; gap: 6px;"><svg class="adm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> Вкусовой профиль успешно сохранен на сервере!</span>
                }
              </div>
            </div>
          </div>
        }


        <!-- ─────────────────────────────────────────────────────────────────────────────
             ВКЛАДКА 4: ПОДАЧА & БОКАЛЫ (SERVING)
        ───────────────────────────────────────────────────────────────────────────── -->
        @if (activeTab === 'serving') {
          <div class="glass-panel" style="padding: 32px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 12px;">
              <div>
                <h2 style="font-size: 1.8rem; margin: 0;">Рекомендации по подаче & Бокалы</h2>
                <p style="color: var(--muted); margin-top: 4px; font-size: 0.9rem;">Температурный режим и фирменное стекло для сортов</p>
              </div>

              <!-- Выбор бренда -->
              <div style="min-width: 320px;">
                <select [(ngModel)]="selectedBrandId" style="padding: 12px 16px; border-radius: 12px; border: 1px solid var(--line); width: 100%; font-size: 1rem; background: var(--bg-1); font-weight: 600;">
                  @for (b of brands(); track b.id) {
                    <option [value]="b.id">{{ b.name }} ({{ b.style }})</option>
                  }
                </select>
              </div>
            </div>

            <div class="glass-card" style="padding: 28px;">
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; margin-bottom: 24px;">
                <div>
                  <label style="display: block; font-weight: 600; margin-bottom: 8px;">Мин. температура подачи (°C):</label>
                  <input type="number" [(ngModel)]="servingTempMin" style="width: 100%; padding: 12px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg-1);" />
                </div>
                <div>
                  <label style="display: block; font-weight: 600; margin-bottom: 8px;">Макс. температура подачи (°C):</label>
                  <input type="number" [(ngModel)]="servingTempMax" style="width: 100%; padding: 12px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg-1);" />
                </div>
                <div>
                  <label style="display: block; font-weight: 600; margin-bottom: 8px;">Рекомендованный бокал:</label>
                  <input type="text" [(ngModel)]="servingGlass" placeholder="Пилснер / Тюльпан / Пинта" style="width: 100%; padding: 12px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg-1);" />
                </div>
              </div>

              <button class="btn-amber" (click)="saveServing()">
                💾 Сохранить рекомендации подачи
              </button>

              @if (servingSaveSuccess()) {
                <span style="color: #1a5e28; font-weight: 700; margin-left: 14px; display: inline-flex; align-items: center; gap: 6px;"><svg class="adm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> Рекомендации подачи обновлены!</span>
              }
            </div>
          </div>
        }


        <!-- ─────────────────────────────────────────────────────────────────────────────
             ВКЛАДКА 5: ФУД-ПЕЙРИНГ (PAIRINGS)
        ───────────────────────────────────────────────────────────────────────────── -->
        @if (activeTab === 'pairings') {
          <div class="glass-panel" style="padding: 32px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 12px;">
              <div>
                <h2 style="font-size: 1.8rem; margin: 0;">Каталог Гастрономических Пар (51 пара)</h2>
                <p style="color: var(--muted); margin-top: 4px; font-size: 0.9rem;">Принципы сочетаемости: Контраст, Дополнение, Очищение рецепторов и Мост</p>
              </div>

              <input
                type="text"
                [(ngModel)]="pairingSearch"
                placeholder="Поиск по сорту или блюду..."
                style="padding: 10px 16px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg-1); min-width: 260px;"
              />
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px;">
              @for (p of filteredPairings(); track p.id) {
                <div class="glass-card" style="padding: 18px;">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <span class="badge" style="background: rgba(224,138,40,0.12); color: var(--beer-deep);">{{ p.pairing_type_display || p.pairing_type }}</span>
                    <span style="font-weight: 700; color: #d97706;">★ {{ p.compatibility_score }}/5</span>
                  </div>
                  <h4 style="font-size: 1.1rem; margin: 6px 0 2px;">{{ p.brand_name }} ↔ {{ p.dish_name }}</h4>
                  <p style="font-size: 0.85rem; color: var(--foam-dim); margin-top: 6px; font-style: italic;">«{{ p.explanation }}»</p>
                </div>
              }
            </div>
          </div>
        }


        <!-- ─────────────────────────────────────────────────────────────────────────────
             ВКЛАДКА 6: СПРАВОЧНИК НОТ (NOTES)
        ───────────────────────────────────────────────────────────────────────────── -->
        @if (activeTab === 'notes') {
          <div class="glass-panel" style="padding: 32px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 12px;">
              <div>
                <h2 style="font-size: 1.8rem; margin: 0;">Сенсорный Справочник Вкусовых Нот</h2>
                <p style="color: var(--muted); margin-top: 4px; font-size: 0.9rem;">Колесо вкусов Meilgaard: Top, Heart, Base и дефекты. Всего в справочнике: {{ notes().length }}</p>
              </div>

              <input
                type="text"
                [(ngModel)]="noteSearch"
                placeholder="Поиск ноты или термина..."
                style="padding: 10px 16px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg-1); min-width: 260px;"
              />
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px;">
              @for (n of filteredNotes(); track n.id) {
                <div class="glass-card" style="padding: 18px; display: flex; flex-direction: column; justify-content: space-between;">
                  <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                      <span style="font-size: 1.8rem;">{{ n.icon }}</span>
                      <span class="badge" [style.background]="n.category === 'TOP' ? 'rgba(250,204,21,0.2)' : (n.category === 'HEART' ? 'rgba(180,83,9,0.2)' : 'rgba(69,26,3,0.2)')">
                        {{ n.category }}
                      </span>
                    </div>
                    <h4 style="font-size: 1.1rem; margin: 4px 0 2px;">{{ n.name }}</h4>
                    @if (n.technical_term) {
                      <p style="font-size: 0.78rem; color: var(--muted); margin-bottom: 8px; font-family: monospace;">{{ n.technical_term }}</p>
                    }
                    <p style="font-size: 0.85rem; color: var(--foam-dim); margin-top: 4px;">{{ n.description || 'Сенсорная нота вкусовой пирамиды' }}</p>
                  </div>
                </div>
              }
            </div>
          </div>
        }

      </div>
    </div>
  `,
  styles: [`
    /* Иконки панели: один язык линий вместо разнокалиберных эмодзи. */
    .adm-ico {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
      color: var(--beer-mid);
    }
    .sidebar-tab-btn.active .adm-ico { color: var(--beer-deep); }
    .btn-amber .adm-ico { color: currentColor; }

    .adm-tile-ico {
      width: 26px;
      height: 26px;
      color: var(--beer-mid);
      margin-bottom: 4px;
    }

    .sidebar-tab-btn {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--foam-dim);
      cursor: pointer;
      font-size: 0.92rem;
      transition: all 0.2s ease;
      width: 100%;
    }
    .sidebar-tab-btn:hover {
      background: rgba(224,138,40,0.06);
      color: var(--beer-deep);
    }
    .sidebar-tab-btn.active {
      background: rgba(224,138,40,0.14);
      color: var(--beer-deep);
      border-color: rgba(224,138,40,0.25);
      font-weight: 700;
      box-shadow: 0 2px 8px rgba(224,138,40,0.1);
    }
    .badge-mini {
      font-size: 0.72rem;
      font-weight: 700;
      background: rgba(0,0,0,0.06);
      padding: 2px 7px;
      border-radius: 999px;
      color: var(--muted);
    }
    .sidebar-tab-btn.active .badge-mini {
      background: var(--beer-amber);
      color: #000;
    }
  `]
})
export class SommelierAdminComponent implements OnInit {
  private api = inject(ApiService);

  activeTab: AdminTab = 'overview';

  brands = signal<Brand[]>([]);
  notes = signal<FlavorNote[]>([]);
  pairings = signal<FoodPairing[]>([]);

  selectedBrandId = '';
  selectedLayer: PyramidLayer = 'TOP';
  selectedNoteId = '';
  intensity = 7;
  sommelierComment = 'Отчетливая хмелевая свежесть с благородным травянистым шлейфом.';
  saveSuccess = signal(false);

  // Serving recs
  servingTempMin = 5;
  servingTempMax = 8;
  servingGlass = 'Пилснер / Тюльпан';
  servingSaveSuccess = signal(false);

  // Search filters
  pairingSearch = '';
  noteSearch = '';

  // Photo upload states
  selectedFile: File | null = null;
  previewUrl = signal<string | null>(null);
  isUploading = signal(false);
  uploadSuccess = signal(false);
  uploadError = signal<string | null>(null);

  /** Сколько сортов доведено до полной пирамиды: Top, Heart и Base заполнены. */
  completePyramids = computed(() => this.brands().filter(b => b.profile?.complete).length);

  filteredPairings = computed(() => {
    const q = this.pairingSearch.toLowerCase().trim();
    if (!q) return this.pairings();
    return this.pairings().filter(p =>
      p.brand_name?.toLowerCase().includes(q) ||
      p.dish_name?.toLowerCase().includes(q) ||
      p.pairing_type_display?.toLowerCase().includes(q)
    );
  });

  filteredNotes = computed(() => {
    const q = this.noteSearch.toLowerCase().trim();
    if (!q) return this.notes();
    return this.notes().filter(n =>
      n.name.toLowerCase().includes(q) ||
      (n.technical_term && n.technical_term.toLowerCase().includes(q))
    );
  });

  ngOnInit() {
    this.loadData();
  }

  loadData() {
    this.api.getBrands().subscribe(data => {
      this.brands.set(data);
      if (data.length > 0 && !this.selectedBrandId) {
        this.selectedBrandId = data[0].id;
      }
    });

    this.api.getFlavorNotes().subscribe(data => {
      this.notes.set(data);
      if (data.length > 0 && !this.selectedNoteId) {
        this.selectedNoteId = data[0].id;
      }
    });

    this.api.getPairings().subscribe(data => {
      this.pairings.set(data);
    });
  }

  currentBrand(): Brand | undefined {
    return this.brands().find(b => b.id === this.selectedBrandId);
  }

  onBrandChange() {
    this.selectedFile = null;
    this.previewUrl.set(null);
    this.uploadSuccess.set(false);
    this.uploadError.set(null);

    const b = this.currentBrand();
    if (b?.serving_recommendation) {
      this.servingTempMin = b.serving_recommendation.serving_temp_min;
      this.servingTempMax = b.serving_recommendation.serving_temp_max;
      this.servingGlass = b.serving_recommendation.glass_type;
    }
  }

  onFileSelected(event: any) {
    const file = event.target.files?.[0];
    if (file) {
      this.selectedFile = file;
      this.uploadSuccess.set(false);
      this.uploadError.set(null);

      // Create preview
      const reader = new FileReader();
      reader.onload = () => {
        this.previewUrl.set(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  }

  uploadPhoto() {
    if (!this.selectedBrandId || !this.selectedFile) return;

    this.isUploading.set(true);
    this.uploadSuccess.set(false);
    this.uploadError.set(null);

    this.api.uploadBrandImage(this.selectedBrandId, this.selectedFile).subscribe({
      next: (updatedBrand) => {
        this.isUploading.set(false);
        this.uploadSuccess.set(true);
        this.previewUrl.set(null);
        this.selectedFile = null;

        // Update brand in list
        const updatedList = this.brands().map(b => b.id === updatedBrand.id ? { ...b, image: updatedBrand.image } : b);
        this.brands.set(updatedList);
      },
      error: (err) => {
        this.isUploading.set(false);
        this.uploadError.set(err?.error?.error || 'Не удалось загрузить фотографию. Проверьте соединение.');
      }
    });
  }

  saveToDjango() {
    if (!this.selectedBrandId || !this.selectedNoteId) return;

    this.api.saveFlavorProfiles({
      brand_id: this.selectedBrandId,
      notes: [
        {
          flavor_note_id: this.selectedNoteId,
          layer: this.selectedLayer,
          intensity: this.intensity,
          sommelier_note: this.sommelierComment
        }
      ]
    }).subscribe(() => {
      this.saveSuccess.set(true);
      setTimeout(() => this.saveSuccess.set(false), 4000);
    });
  }

  saveServing() {
    if (!this.selectedBrandId) return;

    this.api.saveServingRecommendation(this.selectedBrandId, {
      serving_temp_min: this.servingTempMin,
      serving_temp_max: this.servingTempMax,
      glass_type: this.servingGlass,
      seasonality: 'Круглый год'
    }).subscribe(() => {
      this.servingSaveSuccess.set(true);
      setTimeout(() => this.servingSaveSuccess.set(false), 4000);
    });
  }
}

import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { Brand, FlavorNote, PyramidLayer } from '../../models/flavor-tree.models';

@Component({
  selector: 'app-sommelier-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div style="margin-bottom: 28px;">
      <span class="badge">🔐 Sommelier Admin Desk</span>
      <h1 style="font-size: 2.4rem; margin-top: 6px;">Редактирование сорта & Вкусовой Пирамиды</h1>
      <p style="color: var(--muted);">Настройка сенсорного профиля, нот и фотографии выбранного пива</p>
    </div>

    <div class="glass-panel" style="padding: 36px;">
      <div style="display: grid; grid-template-columns: 1fr 300px; gap: 36px; align-items: start;">
        
        <!-- ЛЕВАЯ КОЛОНКА: СОРТ И ПИРАМИДА -->
        <div>
          <!-- 1. Выбор бренда -->
          <div style="margin-bottom: 24px;">
            <label style="display: block; font-weight: 700; margin-bottom: 8px;">1. Выберите сорт пива для изменения:</label>
            <select [(ngModel)]="selectedBrandId" (change)="onBrandChange()" style="padding: 12px 16px; border-radius: 12px; border: 1px solid var(--line); width: 100%; font-size: 1.05rem; background: var(--bg-1); font-weight: 600;">
              @for (b of brands(); track b.id) {
                <option [value]="b.id">{{ b.name }} ({{ b.style }}, {{ b.packaging_type_display || b.packaging_type }})</option>
              }
            </select>
          </div>

          <!-- 2. Калибровка ноты пирамиды -->
          <div style="padding-top: 18px; border-top: 1px solid var(--line); margin-bottom: 24px;">
            <label style="display: block; font-weight: 700; margin-bottom: 14px;">2. Калибровка вкусовой ноты:</label>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 20px;">
              <div>
                <label style="display: block; font-weight: 600; font-size: 0.9rem; margin-bottom: 6px; color: var(--muted);">Слой пирамиды:</label>
                <select [(ngModel)]="selectedLayer" style="padding: 11px; border-radius: 12px; border: 1px solid var(--line); width: 100%; background: var(--bg-1);">
                  <option value="TOP">🌿 TOP (0–3 сек • Аромат)</option>
                  <option value="HEART">🌾 HEART (3–15 сек • Тело)</option>
                  <option value="BASE">⚡ BASE (15+ сек • Послевкусие)</option>
                </select>
              </div>

              <div>
                <label style="display: block; font-weight: 600; font-size: 0.9rem; margin-bottom: 6px; color: var(--muted);">Вкусовая нота:</label>
                <select [(ngModel)]="selectedNoteId" style="padding: 11px; border-radius: 12px; border: 1px solid var(--line); width: 100%; background: var(--bg-1);">
                  @for (n of notes(); track n.id) {
                    <option [value]="n.id">{{ n.icon }} {{ n.name }} ({{ n.category }})</option>
                  }
                </select>
              </div>

              <div>
                <label style="display: block; font-weight: 600; font-size: 0.9rem; margin-bottom: 6px; color: var(--muted);">Интенсивность: {{ intensity }}/10</label>
                <input type="range" min="1" max="10" [(ngModel)]="intensity" style="width: 100%; margin-top: 10px;" />
              </div>
            </div>

            <!-- Заметка сомелье -->
            <div>
              <label style="display: block; font-weight: 600; font-size: 0.9rem; margin-bottom: 6px; color: var(--muted);">Дегустационный комментарий сомелье:</label>
              <textarea
                [(ngModel)]="sommelierComment"
                rows="2"
                placeholder="Например: Яркий пряный акцент благородного хмеля на первых секундах вдоха..."
                style="width: 100%; padding: 12px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg-1);"
              ></textarea>
            </div>
          </div>

          <!-- Кнопка сохранения -->
          <div style="display: flex; gap: 16px; align-items: center; flex-wrap: wrap; padding-top: 12px;">
            <button class="btn-amber" (click)="saveToDjango()">
              💾 Сохранить профиль в Django REST API
            </button>

            @if (saveSuccess()) {
              <span style="color: #1a5e28; font-weight: 700;">✅ Вкусовой профиль успешно сохранен на сервере!</span>
            }
          </div>
        </div>

        <!-- ПРАВАЯ КОЛОНКА: ФОТОГРАФИЯ СОРТА -->
        <div style="background: rgba(0,0,0,0.03); border: 1px solid var(--line); border-radius: 18px; padding: 22px; display: flex; flex-direction: column; align-items: center; text-align: center;">
          <div style="font-weight: 700; font-size: 1.05rem; margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
            <span>📸</span> Фотография сорта
          </div>

          <!-- Область отображения картинки -->
          <div style="width: 100%; height: 230px; background: var(--bg-1); border-radius: 14px; border: 1px dashed var(--line); display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden; margin-bottom: 16px; padding: 12px;">
            @if (previewUrl()) {
              <img [src]="previewUrl()" alt="Preview" style="max-height: 100%; max-width: 100%; object-fit: contain; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.15));" />
              <span class="badge" style="position: absolute; bottom: 8px; font-size: 0.75rem; background: rgba(0,0,0,0.75); color: #fff;">Новое фото</span>
            } @else if (currentBrand()?.image) {
              <img [src]="currentBrand()?.image" alt="Brand" style="max-height: 100%; max-width: 100%; object-fit: contain; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.15));" />
              <span class="badge" style="position: absolute; bottom: 8px; font-size: 0.75rem; background: var(--beer-amber); color: #000;">Сохранено</span>
            } @else {
              <div style="color: var(--muted); font-size: 0.88rem;">
                <div style="font-size: 2.8rem; margin-bottom: 4px; opacity: 0.4;">🍺</div>
                Нет фото
              </div>
            }
          </div>

          <!-- Выбор файла -->
          <input
            type="file"
            accept="image/*"
            #photoFileInput
            (change)="onFileSelected($event)"
            style="display: none;"
          />

          <div style="display: flex; flex-direction: column; gap: 8px; width: 100%;">
            <button class="btn-outline" style="width: 100%; justify-content: center;" (click)="photoFileInput.click()">
              📁 Выбрать другое фото
            </button>

            @if (selectedFile) {
              <button
                class="btn-amber"
                style="width: 100%; justify-content: center; font-size: 0.9rem;"
                [disabled]="isUploading()"
                (click)="uploadPhoto()"
              >
                @if (isUploading()) {
                  ⏳ Загрузка...
                } @else {
                  📤 Применить фото
                }
              </button>
            }
          </div>

          @if (uploadSuccess()) {
            <span style="color: #1a5e28; font-weight: 600; font-size: 0.85rem; margin-top: 8px;">✅ Фото обновлено!</span>
          }
          @if (uploadError()) {
            <span style="color: #991b1b; font-weight: 600; font-size: 0.85rem; margin-top: 8px;">❌ {{ uploadError() }}</span>
          }

          <!-- Подпись с рекомендациями по масштабу и формату -->
          <div style="margin-top: 16px; padding: 12px; background: rgba(224,138,40,0.06); border-radius: 12px; border: 1px dashed rgba(224,138,40,0.3); font-size: 0.78rem; color: var(--foam-dim); text-align: left; line-height: 1.45; width: 100%;">
            <div style="font-weight: 700; color: var(--beer-deep); margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
              <span>📐</span> Рекомендации к загрузке:
            </div>
            <div>• <strong>Масштаб / Пропорции:</strong> 3:4 (вертикальное) или 1:1</div>
            <div>• <strong>Оптимальный размер:</strong> 600×800 px (или 800×800 px)</div>
            <div>• <strong>Формат:</strong> PNG / WEBP с прозрачным фоном или изолированный объект</div>
          </div>
        </div>

      </div>
    </div>
  `
})
export class SommelierAdminComponent implements OnInit {
  private api = inject(ApiService);

  brands = signal<Brand[]>([]);
  notes = signal<FlavorNote[]>([]);

  selectedBrandId = '';
  selectedLayer: PyramidLayer = 'TOP';
  selectedNoteId = '';
  intensity = 7;
  sommelierComment = 'Отчетливая хмелевая свежесть с благородным травянистым шлейфом.';
  saveSuccess = signal(false);

  // Photo upload states
  selectedFile: File | null = null;
  previewUrl = signal<string | null>(null);
  isUploading = signal(false);
  uploadSuccess = signal(false);
  uploadError = signal<string | null>(null);

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
  }

  currentBrand(): Brand | undefined {
    return this.brands().find(b => b.id === this.selectedBrandId);
  }

  onBrandChange() {
    this.selectedFile = null;
    this.previewUrl.set(null);
    this.uploadSuccess.set(false);
    this.uploadError.set(null);
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
}

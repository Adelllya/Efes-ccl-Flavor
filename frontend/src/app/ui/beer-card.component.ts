import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DataService } from '../core/data.service';
import { Brand, PACKAGING_LABELS } from '../core/models';
import { abv } from '../core/format';
import { IconComponent } from './icon.component';

/** Карточка сорта для каталога и списков. */
@Component({
  selector: 'ft-beer-card',
  standalone: true,
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="card hover bc" [routerLink]="['/beers', brand().id]" [style.--accent]="brand().accent || 'var(--amber-300)'" [style.--accent-soft]="soft()">
      <div class="bottle">
        <div class="glow"></div>
        <img [src]="data.brandImage(brand())" [alt]="brand().display_name" loading="lazy" decoding="async" />
        <span class="badge pk" [class.badge-dark]="brand().packaging_type !== 'DRAFT'" [class.pick]="brand().packaging_type === 'DRAFT'">{{ pkg() }}</span>
      </div>
      <div class="body">
        <div class="meta"><span class="style">{{ brand().style_label }}</span><span class="abv">{{ abvText() }}</span></div>
        <h3 class="name">{{ brand().display_name }}</h3>
        <p class="tag">{{ brand().tagline }}</p>
        <div class="foot"><span class="origin ellipsis">{{ brand().origin }}</span><ft-icon name="chevron-right" [size]="18" /></div>
      </div>
    </a>
  `,
  styles: [`
    .bc { display: flex; flex-direction: column; overflow: hidden; height: 100%; }
    .bottle { border-radius: 0; }
    .pk { position: absolute; top: 10px; left: 10px; }
    .body { padding: 14px 16px 14px; display: flex; flex-direction: column; gap: 4px; flex: 1; }
    .meta { display: flex; justify-content: space-between; font-size: .74rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--amber-700); }
    .abv { color: var(--ink-3); font-variant-numeric: tabular-nums; }
    .name { font-size: 1.05rem; line-height: 1.2; }
    .tag { color: var(--ink-3); font-size: .84rem; }
    .foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: auto; padding-top: 8px; color: var(--ink-3); font-size: .76rem; }
    .origin { min-width: 0; }
  `],
})
export class BeerCardComponent {
  data = inject(DataService);
  brand = input.required<Brand>();
  pkg = computed(() => PACKAGING_LABELS[this.brand().packaging_type]);
  abvText = computed(() => abv(this.brand()));
  soft = computed(() => (this.brand().accent || '#E5B849') + '33');
}

import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DataService } from '../core/data.service';
import { Brand, Layer } from '../core/models';

interface Leaf { id: string; x: number; y: number; r: number; icon: string; name: string; layer: Layer; intensity: number; ax: number; ay: number; }

/**
 * «Дерево вкуса» — фирменная визуализация: корни = Base, ветви = Heart, крона = Top.
 * Размер листа = интенсивность ноты. Детерминированная раскладка.
 */
@Component({
  selector: 'ft-tree',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 320 330" class="tree" role="img" [attr.aria-label]="'Дерево вкуса ' + brand().display_name">
      <defs>
        <linearGradient id="trunk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6A4A17"/><stop offset="1" stop-color="#3E2B0D"/></linearGradient>
        <radialGradient id="ground" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="rgba(224,138,40,.35)"/><stop offset="1" stop-color="rgba(224,138,40,0)"/></radialGradient>
      </defs>
      <ellipse cx="160" cy="290" rx="120" ry="18" fill="url(#ground)"/>
      <path d="M160 292 C158 250 156 210 160 150 C164 210 162 250 160 292 Z" fill="url(#trunk)"/>
      <path d="M150 292 Q160 280 170 292" fill="none" stroke="#3E2B0D" stroke-width="6" stroke-linecap="round"/>
      @for (l of leaves(); track l.id) {
        <path [attr.d]="branch(l)" class="branch" [class.root]="l.layer === 'BASE'"/>
      }
      @for (l of leaves(); track l.id) {
        <g class="leaf" [class.top]="l.layer === 'TOP'" [class.heart]="l.layer === 'HEART'" [class.base]="l.layer === 'BASE'">
          <circle [attr.cx]="l.x" [attr.cy]="l.y" [attr.r]="l.r + 3" class="halo"/>
          <circle [attr.cx]="l.x" [attr.cy]="l.y" [attr.r]="l.r" class="fill"/>
          <text [attr.x]="l.x" [attr.y]="l.y + l.r * 0.36" text-anchor="middle" [attr.font-size]="l.r * 1.05">{{ l.icon }}</text>
          <text [attr.x]="l.x" [attr.y]="l.y + l.r + 12" text-anchor="middle" class="lbl">{{ l.name }}</text>
        </g>
      }
      <text x="12" y="70" class="tag">TOP · крона</text>
      <text x="12" y="170" class="tag">HEART · ветви</text>
      <text x="12" y="258" class="tag">BASE · корни</text>
    </svg>
  `,
  styles: [`
    :host { display: block; }
    .tree { width: 100%; height: auto; }
    .branch { fill: none; stroke: #6A4A17; stroke-width: 3; stroke-linecap: round; opacity: .85; }
    .branch.root { stroke: #3E2B0D; opacity: .7; }
    .halo { fill: none; stroke-width: 2; opacity: .35; }
    .top .halo { stroke: var(--layer-top); } .heart .halo { stroke: var(--layer-heart); } .base .halo { stroke: var(--layer-base); }
    .fill { stroke: #fff; stroke-width: 2; }
    .top .fill { fill: #F7E8C0; } .heart .fill { fill: #E5B849; } .base .fill { fill: #9D6F22; }
    .lbl { font-family: var(--font-body); font-size: 8.5px; font-weight: 600; fill: var(--ink-2); }
    .tag { font-family: var(--font-display); font-size: 9px; font-weight: 700; letter-spacing: .1em; fill: var(--ink-4); }
    .leaf { transition: transform .3s var(--spring); transform-box: fill-box; transform-origin: center; }
    .leaf:hover { transform: scale(1.12); }
  `],
})
export class FlavorTreeComponent {
  private data = inject(DataService);
  brand = input.required<Brand>();

  leaves = computed<Leaf[]>(() => {
    const byId = this.data.notesById();
    const groups: Record<Layer, { id: string; icon: string; name: string; intensity: number }[]> = { TOP: [], HEART: [], BASE: [] };
    for (const p of this.brand().pyramid) { const n = byId[p.note_id]; if (n) groups[p.layer].push({ id: p.note_id, icon: n.icon, name: n.name, intensity: p.intensity }); }
    const out: Leaf[] = [];
    const place = (layer: Layer, items: typeof groups.TOP, cy: number, spread: number, ay: number, arc: number) => {
      const n = items.length;
      items.forEach((it, i) => {
        const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1; // -1..1
        const x = 160 + t * spread;
        const y = cy + Math.abs(t) * arc;
        out.push({ id: it.id, x, y, r: 12 + it.intensity * 1.6, icon: it.icon, name: it.name, layer, intensity: it.intensity, ax: 160, ay });
      });
    };
    place('TOP', groups.TOP, 62, 92, 150, 18);
    place('HEART', groups.HEART, 150, 110, 185, -10);
    place('BASE', groups.BASE, 268, 100, 285, -14);
    return out;
  });

  branch(l: Leaf): string {
    const mx = (l.ax + l.x) / 2, my = l.layer === 'BASE' ? l.ay + 6 : (l.ay + l.y) / 2 - 12;
    return `M${l.ax} ${l.ay} Q${mx} ${my} ${l.x} ${l.y}`;
  }
}

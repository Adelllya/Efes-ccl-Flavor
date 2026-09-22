import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { BEER_AXES, BEER_AXIS_LABELS, BeerVector } from '../engine/pairing-engine';

/** Радар сенсорного вектора пива (10 осей). compare — второй контур пунктиром (Flavor DNA, другой сорт). */
@Component({
  selector: 'ft-radar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.viewBox]="'0 0 ' + W + ' ' + W" class="radar" role="img" aria-label="Радар вкусового профиля">
      @for (g of grid; track g) {
        <polygon [attr.points]="ringPoints(g)" class="ring" />
      }
      @for (p of axisPts(); track p.axis) {
        <line [attr.x1]="cx" [attr.y1]="cx" [attr.x2]="p.x" [attr.y2]="p.y" class="axis" />
      }
      @if (compare(); as cmp) {
        <polygon [attr.points]="poly(cmp)" class="cmp" />
      }
      <polygon [attr.points]="poly(vector())" class="main" [style.fill]="fill()" [style.stroke]="color()" />
      @for (p of axisPts(); track p.axis) {
        <circle [attr.cx]="dot(p.axis).x" [attr.cy]="dot(p.axis).y" r="3" [style.fill]="color()" />
      }
      @if (labels()) {
        @for (p of axisPts(); track p.axis) {
          <text [attr.x]="p.lx" [attr.y]="p.ly" [attr.text-anchor]="p.anchor" class="lbl">{{ label(p.axis) }}</text>
        }
      }
    </svg>
  `,
  styles: [`
    :host { display: block; }
    .radar { width: 100%; height: auto; overflow: visible; }
    .ring { fill: none; stroke: var(--line); }
    .axis { stroke: var(--line-2); }
    .main { stroke-width: 2; stroke-linejoin: round; transition: all .6s var(--ease); }
    .cmp { fill: rgba(123, 79, 166, .12); stroke: var(--violet); stroke-width: 1.5; stroke-dasharray: 4 3; }
    .lbl { font-family: var(--font-body); font-size: 9.5px; font-weight: 600; fill: var(--ink-3); }
  `],
})
export class RadarComponent {
  vector = input.required<BeerVector>();
  compare = input<BeerVector | null>(null);
  labels = input<boolean>(true);
  color = input<string>('var(--amber-500)');
  fill = input<string>('rgba(224, 138, 40, .28)');

  readonly W = 240; readonly cx = 120; readonly R = 84;
  readonly grid = [0.25, 0.5, 0.75, 1];
  readonly axes = BEER_AXES;

  private pt(i: number, r: number): { x: number; y: number } {
    const a = (Math.PI * 2 * i) / this.axes.length - Math.PI / 2;
    return { x: this.cx + Math.cos(a) * r, y: this.cx + Math.sin(a) * r };
  }
  axisPts = computed(() => this.axes.map((axis, i) => {
    const p = this.pt(i, this.R); const l = this.pt(i, this.R + 16);
    const anchor = Math.abs(l.x - this.cx) < 8 ? 'middle' : l.x > this.cx ? 'start' : 'end';
    return { axis, x: p.x, y: p.y, lx: l.x, ly: l.y + 3.5, anchor };
  }));
  ringPoints(g: number): string { return this.axes.map((_, i) => { const p = this.pt(i, this.R * g); return `${p.x},${p.y}`; }).join(' '); }
  poly(v: BeerVector): string { return this.axes.map((a, i) => { const p = this.pt(i, this.R * (v[a] ?? 0)); return `${p.x},${p.y}`; }).join(' '); }
  dot(axis: string): { x: number; y: number } { const i = this.axes.indexOf(axis as any); return this.pt(i, this.R * (this.vector()[axis as keyof BeerVector] ?? 0)); }
  label(a: string): string { return BEER_AXIS_LABELS[a as keyof BeerVector]; }
}

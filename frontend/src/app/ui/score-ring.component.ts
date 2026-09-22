import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { scoreClass } from '../core/format';

/** Кольцо оценки 0–99 с цветом по диапазону. */
@Component({
  selector: 'ft-score',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ring" [class]="'ring ' + cls()" [style.width.px]="size()" [style.height.px]="size()" role="img" [attr.aria-label]="'Оценка ' + score() + ' из 99'">
      <svg [attr.viewBox]="'0 0 ' + size() + ' ' + size()">
        <circle class="track" [attr.cx]="c()" [attr.cy]="c()" [attr.r]="r()" [attr.stroke-width]="stroke()" />
        <circle class="fill" [attr.cx]="c()" [attr.cy]="c()" [attr.r]="r()" [attr.stroke-width]="stroke()"
          [attr.stroke-dasharray]="circ()" [attr.stroke-dashoffset]="offset()" [attr.transform]="'rotate(-90 ' + c() + ' ' + c() + ')'" />
      </svg>
      <div class="num" [style.font-size.px]="size() * 0.34">{{ score() }}</div>
      @if (label()) { <div class="lbl">{{ label() }}</div> }
    </div>
  `,
  styles: [`
    .ring { position: relative; display: grid; place-items: center; flex-shrink: 0; }
    svg { position: absolute; inset: 0; width: 100%; height: 100%; }
    .track { fill: none; stroke: var(--amber-100); }
    .fill { fill: none; stroke: var(--score-c, var(--amber-500)); stroke-linecap: round; transition: stroke-dashoffset .9s var(--ease); }
    .num { font-family: var(--font-display); font-weight: 800; letter-spacing: -.03em; color: var(--score-c, var(--ink)); line-height: 1; }
    .lbl { position: absolute; bottom: -18px; font-size: .62rem; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--ink-3); white-space: nowrap; }
  `],
})
export class ScoreRingComponent {
  score = input.required<number>();
  size = input<number>(64);
  stroke = input<number>(6);
  label = input<string>('');
  cls = computed(() => scoreClass(this.score()));
  c = computed(() => this.size() / 2);
  r = computed(() => this.size() / 2 - this.stroke() / 2 - 1);
  circ = computed(() => 2 * Math.PI * this.r());
  offset = computed(() => this.circ() * (1 - Math.min(99, Math.max(0, this.score())) / 99));
}

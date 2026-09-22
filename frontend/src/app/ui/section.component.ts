import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Заголовок раздела: eyebrow + h2 + подпись + слот справа. */
@Component({
  selector: 'ft-section-head',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="section-head">
      <div>
        @if (eyebrow()) { <span class="eyebrow">{{ eyebrow() }}</span> }
        <h2>{{ title() }}</h2>
        @if (sub()) { <p>{{ sub() }}</p> }
      </div>
      <div class="side"><ng-content /></div>
    </div>
  `,
  styles: [`.side { flex-shrink: 0; } .eyebrow { margin-bottom: 6px; }`],
})
export class SectionHeadComponent {
  title = input.required<string>();
  sub = input<string>('');
  eyebrow = input<string>('');
}

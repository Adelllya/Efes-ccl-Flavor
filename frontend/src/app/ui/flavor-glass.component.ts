import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DataService } from '../core/data.service';
import { Brand, LAYER_META, Layer } from '../core/models';

/**
 * «Бокал вкуса» — пирамида сорта как бокал: пена = Top (0–3 с), тело = Heart (3–15 с), дно = Base (15+ с).
 * Ноты выводятся рядом с соответствующим слоем с полосой интенсивности.
 */
@Component({
  selector: 'ft-glass',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap" [class.compact]="compact()">
      <svg viewBox="0 0 120 230" class="glass" aria-hidden="true">
        <defs>
          <linearGradient id="beerGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#F7E8C0"/><stop offset=".45" stop-color="#E5B849"/><stop offset="1" stop-color="#9D6F22"/>
          </linearGradient>
          <clipPath id="glassClip"><path d="M20 22 H100 L92 196 Q90 206 80 206 H40 Q30 206 28 196 Z"/></clipPath>
        </defs>
        <g clip-path="url(#glassClip)">
          <rect x="0" y="22" width="120" height="200" fill="url(#beerGrad)"/>
          <rect x="0" y="22" width="120" height="30" fill="#FFF8EA" opacity=".96"/>
          <path d="M0 52 Q15 46 30 52 T60 52 T90 52 T120 52 V22 H0 Z" fill="#FFF8EA"/>
          <line x1="0" y1="103" x2="120" y2="103" stroke="#fff" stroke-opacity=".35" stroke-dasharray="3 3"/>
          <line x1="0" y1="152" x2="120" y2="152" stroke="#fff" stroke-opacity=".35" stroke-dasharray="3 3"/>
          @for (b of bubbles; track b.x) { <circle class="bub" [attr.cx]="b.x" [attr.cy]="b.y" [attr.r]="b.r" [style.animation-delay.s]="b.d" [style.animation-duration.s]="b.t"/> }
        </g>
        <path d="M20 22 H100 L92 196 Q90 206 80 206 H40 Q30 206 28 196 Z" fill="none" stroke="rgba(140,63,12,.35)" stroke-width="2"/>
        <path d="M24 30 L30 190" stroke="#fff" stroke-opacity=".55" stroke-width="3" stroke-linecap="round"/>
        <rect x="38" y="210" width="44" height="6" rx="3" fill="rgba(140,63,12,.35)"/>
        <text x="60" y="41" text-anchor="middle" class="tick">0–3 с</text>
        <text x="60" y="130" text-anchor="middle" class="tick dark">3–15 с</text>
        <text x="60" y="180" text-anchor="middle" class="tick dark">15+ с</text>
      </svg>
      <div class="layers">
        @for (l of layers; track l) {
          <div class="layer" [style.--lc]="meta[l].color">
            <div class="lh">
              <span class="dot"></span>
              <span class="ln">{{ meta[l].label }}</span>
              <span class="lt">{{ meta[l].time }}</span>
            </div>
            @for (n of notes()[l]; track n.id) {
              <div class="note">
                <div class="nt"><span class="ico">{{ n.icon }}</span><span class="nn">{{ n.name }}</span><span class="ni">{{ n.intensity }}/10</span></div>
                <div class="bar thin" [class.top]="l === 'TOP'" [class.heart]="l === 'HEART'" [class.base]="l === 'BASE'"><i [style.width.%]="n.intensity * 10"></i></div>
                @if (!compact() && n.note) { <div class="nc">«{{ n.note }}»</div> }
              </div>
            } @empty {
              <div class="empty">Сомелье ещё не заполнил слой</div>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .wrap { display: grid; grid-template-columns: 96px 1fr; gap: 18px; align-items: start; }
    .compact .wrap, .wrap.compact { grid-template-columns: 72px 1fr; gap: 12px; }
    .glass { width: 100%; height: auto; filter: drop-shadow(0 10px 18px rgba(140, 63, 12, .22)); }
    .tick { font-family: var(--font-display); font-size: 9px; font-weight: 700; fill: var(--ink-3); letter-spacing: .04em; }
    .tick.dark { fill: #fff; }
    .bub { fill: #fff; opacity: .7; animation: rise 3.4s linear infinite; }
    @keyframes rise { from { transform: translateY(0); opacity: .7; } to { transform: translateY(-150px); opacity: 0; } }
    .layers { display: grid; gap: 12px; }
    .layer { border-left: 3px solid var(--lc); padding-left: 12px; }
    .lh { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--lc); align-self: center; }
    .ln { font-family: var(--font-display); font-weight: 700; font-size: .9rem; }
    .lt { font-size: .72rem; color: var(--ink-3); font-weight: 600; }
    .note { margin-bottom: 8px; }
    .nt { display: flex; align-items: center; gap: 6px; font-size: .88rem; margin-bottom: 4px; }
    .ico { font-size: 1rem; } .nn { font-weight: 600; flex: 1; } .ni { color: var(--ink-3); font-size: .74rem; font-weight: 700; font-variant-numeric: tabular-nums; }
    .nc { font-family: var(--font-accent); font-style: italic; color: var(--ink-3); font-size: .82rem; margin-top: 4px; }
    .empty { font-size: .8rem; color: var(--ink-4); }
    .compact .nc { display: none; }
  `],
})
export class FlavorGlassComponent {
  private data = inject(DataService);
  brand = input.required<Brand>();
  compact = input<boolean>(false);
  readonly layers: Layer[] = ['TOP', 'HEART', 'BASE'];
  readonly meta = LAYER_META;
  readonly bubbles = [{ x: 45, y: 200, r: 2, d: 0, t: 3.2 }, { x: 62, y: 205, r: 1.5, d: 1.1, t: 4 }, { x: 78, y: 198, r: 2.2, d: 2, t: 3.6 }, { x: 55, y: 210, r: 1.2, d: .6, t: 4.4 }, { x: 88, y: 208, r: 1.6, d: 1.6, t: 3.8 }];
  notes = computed(() => {
    const byId = this.data.notesById();
    const out: Record<Layer, { id: string; name: string; icon: string; intensity: number; note: string }[]> = { TOP: [], HEART: [], BASE: [] };
    for (const p of this.brand().pyramid) {
      const n = byId[p.note_id]; if (!n) continue;
      out[p.layer].push({ id: p.note_id, name: n.name, icon: n.icon, intensity: p.intensity, note: p.sommelier_note });
    }
    for (const l of this.layers) out[l].sort((a, b) => b.intensity - a.intensity);
    return out;
  });
}

import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DataService } from '../../core/data.service';
import { PairingService } from '../../core/pairing.service';
import { ProgressService } from '../../core/progress.service';
import { DnaService } from '../../core/dna.service';
import { PACKAGING_LABELS } from '../../core/models';
import { abv } from '../../core/format';
import { Rating } from '../../engine/pairing-engine';
import { IconComponent } from '../../ui/icon.component';
import { FlavorGlassComponent } from '../../ui/flavor-glass.component';
import { FlavorTreeComponent } from '../../ui/flavor-tree.component';
import { RadarComponent } from '../../ui/radar.component';
import { MatchCardComponent } from '../../ui/match-card.component';
import { SectionHeadComponent } from '../../ui/section.component';

@Component({
  selector: 'ft-beer-detail',
  standalone: true,
  imports: [RouterLink, IconComponent, FlavorGlassComponent, FlavorTreeComponent, RadarComponent, MatchCardComponent, SectionHeadComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (brand(); as b) {
      <a routerLink="/beers" class="btn btn-ghost btn-sm"><ft-icon name="arrow-left" [size]="16" /> Все сорта</a>
      <section class="hero card mt12" [style.--accent]="b.accent || '#E5B849'">
        <div class="glow"></div>
        <div class="img"><img [src]="data.brandImage(b)" [alt]="b.display_name" /></div>
        <div class="info">
          <div class="flex g6 wrap"><span class="badge">{{ b.style_label }}</span><span class="badge" [class.pick]="b.packaging_type === 'DRAFT'">{{ pkg() }}</span>@if (b.is_horeca_only) { <span class="badge badge-info">только HoReCa</span> }</div>
          <h1 class="mt8">{{ b.display_name }}</h1>
          <p class="accent-serif amber lg">{{ b.tagline }}</p>
          <p class="dim mt8">{{ b.description }}</p>
          <div class="facts mt12">
            <div><ft-icon name="flame" [size]="16" /><span>{{ abvText() }} ABV</span></div>
            <div><ft-icon name="thermometer" [size]="16" /><span>{{ b.serving.temp_min }}–{{ b.serving.temp_max }} °C</span></div>
            <div><ft-icon name="glass" [size]="16" /><span>{{ b.serving.glass }}</span></div>
            <div><ft-icon name="map-pin" [size]="16" /><span>{{ b.origin }}</span></div>
          </div>
          <div class="rate mt16">
            <span class="muted xs">Ваша оценка → Flavor DNA:</span>
            <div class="flex g6">
              <button type="button" class="chip chip-sm" [class.on]="rating() === 'dislike'" (click)="rate('dislike')"><ft-icon name="thumbs-down" [size]="14" /> не моё</button>
              <button type="button" class="chip chip-sm" [class.on]="rating() === 'like'" (click)="rate('like')"><ft-icon name="check" [size]="14" /> нравится</button>
              <button type="button" class="chip chip-sm" [class.on]="rating() === 'love'" (click)="rate('love')"><ft-icon name="heart" [size]="14" /> люблю</button>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <ft-section-head eyebrow="Хронометраж глотка" title="Вкусовая пирамида" [sub]="'Уверенность профиля ' + conf() + '% · интенсивность ' + inten() + '/100'">
          <div class="seg">
            <button type="button" [class.on]="viz() === 'glass'" (click)="viz.set('glass')">Бокал</button>
            <button type="button" [class.on]="viz() === 'tree'" (click)="viz.set('tree')">Дерево</button>
            <button type="button" [class.on]="viz() === 'radar'" (click)="viz.set('radar')">Радар</button>
          </div>
        </ft-section-head>
        <div class="card card-p viz">
          @switch (viz()) {
            @case ('glass') { <ft-glass [brand]="b" /> }
            @case ('tree') { <div class="tree-wrap"><ft-tree [brand]="b" /></div> }
            @case ('radar') {
              <div class="radar-wrap">
                <ft-radar [vector]="profile().vector" [compare]="dna.vector()" />
                <div class="axes">
                  @for (a of axes(); track a.k) { <div class="ax"><span>{{ a.l }}</span><div class="bar thin"><i [style.width.%]="a.v * 100"></i></div><b>{{ pct(a.v) }}</b></div> }
                  @if (dna.vector()) { <p class="muted xs mt8">Пунктир — ваш Flavor DNA</p> }
                </div>
              </div>
            }
          }
          @if (conf() < 80) { <p class="draft mt12"><ft-icon name="info" [size]="14" /> Пирамида заполнена частично — движок опирается на приор стиля «{{ b.style_label }}». Сомелье уточнит профиль после дегустации.</p> }
        </div>
      </section>

      <section class="section">
        <ft-section-head eyebrow="Гастропары" title="К чему подать" sub="Лучшие блюда по расчёту движка" />
        <div class="results">
          @for (m of dishes(); track m.dish_id; let i = $index) { <ft-match [m]="m" [rank]="i + 1" mode="dish" /> }
        </div>
      </section>

      @if (similar().length) {
        <section class="section">
          <ft-section-head eyebrow="Похожие по профилю" title="Если понравился этот" />
          <div class="grid grid-3">
            @for (s of similar(); track s.brand.id) {
              <a class="card hover card-p sim" [routerLink]="['/beers', s.brand.id]"><img [src]="data.brandImage(s.brand)" [alt]="s.brand.display_name" /><div><b>{{ s.brand.display_name }}</b><div class="muted xs">{{ s.brand.style_label }} · сходство {{ pct(s.similarity) }}%</div></div><ft-icon name="chevron-right" /></a>
            }
          </div>
        </section>
      }
    } @else {
      <div class="card card-p center"><p class="dim">Сорт не найден.</p><a routerLink="/beers" class="btn btn-primary mt12">К каталогу</a></div>
    }
  `,
  styles: [`
    .hero { position: relative; overflow: hidden; display: grid; grid-template-columns: 120px 1fr; gap: 16px; padding: 18px; }
    @media (min-width: 720px) { .hero { grid-template-columns: 220px 1fr; gap: 28px; padding: 28px; } }
    .glow { position: absolute; left: -40px; top: 10%; width: 260px; height: 260px; border-radius: 50%; background: radial-gradient(circle, color-mix(in srgb, var(--accent) 32%, transparent), transparent 70%); filter: blur(14px); pointer-events: none; }
    @media (min-width: 720px) { .glow { left: -20px; width: 320px; height: 320px; } }
    .img { display: grid; place-items: center; }
    .img img { max-height: 260px; width: auto; filter: drop-shadow(0 18px 24px rgba(60,30,5,.35)); animation: pop .6s var(--spring); }
    .info { position: relative; min-width: 0; }
    .facts { display: grid; grid-template-columns: 1fr; gap: 8px 16px; font-size: .88rem; color: var(--ink-2); }
    @media (min-width: 560px) { .facts { grid-template-columns: 1fr 1fr; } }
    .facts div { display: flex; gap: 8px; align-items: center; }
    .facts ft-icon { color: var(--amber-600); flex-shrink: 0; }
    .rate { display: grid; gap: 6px; } .rate .flex { flex-wrap: wrap; }
    .seg { display: inline-grid; grid-auto-flow: column; gap: 4px; padding: 4px; border-radius: var(--r-md); background: var(--bg-2); }
    .seg button { min-height: 36px; padding: 0 12px; border-radius: 10px; font-weight: 700; font-size: .84rem; color: var(--ink-2); }
    .seg button.on { background: var(--surface); color: var(--amber-800); box-shadow: var(--shadow-1); }
    .tree-wrap { max-width: 560px; margin: 0 auto; }
    .radar-wrap { display: grid; gap: 16px; }
    @media (min-width: 720px) { .radar-wrap { grid-template-columns: 300px 1fr; align-items: center; } }
    .axes { display: grid; gap: 6px; }
    .ax { display: grid; grid-template-columns: 90px 1fr 38px; align-items: center; gap: 10px; font-size: .8rem; color: var(--ink-2); font-weight: 600; }
    .ax b { text-align: right; font-variant-numeric: tabular-nums; color: var(--ink-3); }
    .draft { display: flex; gap: 8px; align-items: flex-start; font-size: .82rem; color: var(--ink-3); background: var(--amber-100); padding: 10px 12px; border-radius: var(--r-md); }
    .results { display: grid; gap: 12px; }
    @media (min-width: 900px) { .results { grid-template-columns: 1fr 1fr; align-items: start; } }
    .sim { display: flex; align-items: center; gap: 12px; }
    .sim img { height: 64px; width: 40px; object-fit: contain; }
    .sim div { flex: 1; }
  `],
})
export class BeerDetailPage {
  data = inject(DataService);
  dna = inject(DnaService);
  private pairing = inject(PairingService);
  private progress = inject(ProgressService);
  id = input.required<string>();
  viz = signal<'glass' | 'tree' | 'radar'>('glass');

  brand = computed(() => this.data.brand(this.id()));
  profile = computed(() => this.data.beerProfileById()[this.id()]);
  pkg = computed(() => PACKAGING_LABELS[this.brand()!.packaging_type]);
  abvText = computed(() => abv(this.brand()!));
  conf = computed(() => Math.round((this.profile()?.confidence ?? 0) * 100));
  inten = computed(() => Math.round((this.profile()?.intensity ?? 0) * 100));
  axes = computed(() => { const v = this.profile().vector; return (Object.keys(v) as (keyof typeof v)[]).map(k => ({ k, l: LABELS[k], v: v[k] })).sort((a, b) => b.v - a.v); });
  dishes = computed(() => this.pairing.forBeer(this.id(), {}, 6));
  similar = computed(() => this.pairing.similar(this.id(), 3));
  rating = computed<Rating | undefined>(() => this.dna.ratings()[this.id()]);

  constructor() { effect(() => { const b = this.brand(); if (b) this.progress.award('explore', b.id, `Изучен сорт «${b.display_name}»`); }, { allowSignalWrites: true }); }
  rate(r: Rating): void { this.dna.rate(this.id(), r); }
  pct(x: number): number { return Math.round(x * 100); }
}
const LABELS: Record<string, string> = { bitter: 'Горечь', body: 'Тело', malt_sweet: 'Солод', carbonation: 'Пузырьки', hop_aroma: 'Хмель', roast: 'Обжарка', alcohol: 'Крепость', caramel: 'Карамель', fruit: 'Фрукты', clean: 'Чистота' };

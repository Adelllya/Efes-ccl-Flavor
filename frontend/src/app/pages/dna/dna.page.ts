import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DataService } from '../../core/data.service';
import { DnaService } from '../../core/dna.service';
import { ProgressService } from '../../core/progress.service';
import { PairingService } from '../../core/pairing.service';
import { BEER_AXES, BEER_AXIS_LABELS, Rating } from '../../engine/pairing-engine';
import { IconComponent } from '../../ui/icon.component';
import { RadarComponent } from '../../ui/radar.component';
import { SectionHeadComponent } from '../../ui/section.component';

/** Flavor DNA: оцениваем сорта → вектор вкуса → архетип → рекомендации → карточка для соцсетей. */
@Component({
  selector: 'ft-dna',
  standalone: true,
  imports: [RouterLink, IconComponent, RadarComponent, SectionHeadComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="eyebrow">Личный профиль</span>
    <h1>Мой <span class="grad-text">Flavor DNA</span></h1>
    <p class="dim mt8">Оцените сорта, которые пробовали. Из оценок движок считает ваш вкусовой отпечаток и подстраивает подбор пар.</p>

    <div class="prog card card-p mt16">
      <div class="flex jb ac"><b>Оценено: {{ dna.ratedCount() }} из {{ data.stats().brands }}</b><span class="muted xs">{{ dna.ready() ? 'профиль готов' : 'нужно минимум 3' }}</span></div>
      <div class="bar mt8"><i [style.width.%]="Math.min(100, dna.ratedCount() / 3 * 100)"></i></div>
    </div>

    @if (dna.ready() && dna.archetype(); as a) {
      <section class="card result mt16 pop" [style.--accent]="'#E5B849'">
        <div class="res-head">
          <div class="arch-e">{{ a.emoji }}</div>
          <div><span class="eyebrow">Ваш архетип</span><h2>{{ a.name }}</h2><p class="accent-serif dim">{{ a.tagline }}</p></div>
        </div>
        <div class="res-body">
          <ft-radar [vector]="dna.vector()!" [compare]="a.vector" color="var(--violet)" fill="rgba(123,79,166,.25)" />
          <div class="axes">
            @for (x of axes(); track x.k) { <div class="ax"><span>{{ x.l }}</span><div class="bar thin"><i [style.width.%]="x.v * 100" style="background: var(--violet)"></i></div></div> }
            <p class="muted xs mt8">Сплошной контур — вы, пунктир — архетип ({{ Math.round(a.similarity * 100) }}% сходства)</p>
          </div>
        </div>
        <div class="flex g8 wrap" style="padding: 0 18px 18px">
          <button type="button" class="btn btn-primary btn-sm" (click)="makeCard()"><ft-icon name="download" [size]="16" /> Карточка для сторис</button>
          <button type="button" class="btn btn-secondary btn-sm" (click)="share()"><ft-icon name="share" [size]="16" /> Поделиться</button>
          <button type="button" class="btn btn-ghost btn-sm" (click)="dna.clear()"><ft-icon name="refresh" [size]="16" /> Сбросить</button>
        </div>
        @if (cardUrl()) { <div class="card-preview"><img [src]="cardUrl()" alt="Карточка Flavor DNA" /><a [href]="cardUrl()" download="flavor-dna.png" class="btn btn-secondary btn-sm mt8"><ft-icon name="download" [size]="16" /> Скачать PNG</a></div> }
      </section>

      <section class="section">
        <ft-section-head eyebrow="Рекомендации" title="Сорта под ваш профиль" sub="Не оценённые вами, ближайшие по вектору" />
        <div class="grid grid-3">
          @for (r of dna.recommendations(); track r.brand.id) {
            <a class="card hover card-p rec" [routerLink]="['/beers', r.brand.id]"><img [src]="data.brandImage(r.brand)" [alt]="r.brand.display_name" /><div><b>{{ r.brand.display_name }}</b><div class="muted xs">{{ r.brand.style_label }} · сходство {{ Math.round(r.similarity * 100) }}%</div></div></a>
          }
        </div>
      </section>
    }

    <section class="section">
      <ft-section-head eyebrow="Дегустационная колода" [title]="dna.ready() ? 'Уточните профиль' : 'Оцените сорта'" sub="Что пробовали? Не пробовали — пропустите" />
      <div class="deck">
        @for (b of deck(); track b.id) {
          <div class="card dcard">
            <img [src]="data.brandImage(b)" [alt]="b.display_name" loading="lazy" />
            <div class="dc-body">
              <b>{{ b.display_name }}</b><div class="muted xs mb8">{{ b.style_label }} · {{ b.abv }}%</div>
              <div class="rbtns">
                <button type="button" [class.on]="dna.ratings()[b.id] === 'dislike'" (click)="rate(b.id, 'dislike')" aria-label="Не моё"><ft-icon name="thumbs-down" [size]="18" /></button>
                <button type="button" [class.on]="dna.ratings()[b.id] === 'like'" (click)="rate(b.id, 'like')" aria-label="Нравится"><ft-icon name="check" [size]="18" /></button>
                <button type="button" class="love" [class.on]="dna.ratings()[b.id] === 'love'" (click)="rate(b.id, 'love')" aria-label="Люблю"><ft-icon name="heart" [size]="18" /></button>
              </div>
            </div>
          </div>
        }
      </div>
    </section>

    <section class="section">
      <ft-section-head eyebrow="Пять архетипов" title="Кем вы можете оказаться" />
      <div class="grid grid-3">
        @for (a of dna.archetypes; track a.id) { <div class="card card-p" [class.soft]="dna.archetype()?.id === a.id"><div style="font-size:1.8rem">{{ a.emoji }}</div><h3 class="mt8">{{ a.name }}</h3><p class="dim sm mt8">{{ a.tagline }}</p></div> }
      </div>
    </section>
  `,
  styles: [`
    .result { overflow: hidden; }
    .res-head { display: flex; gap: 14px; align-items: center; padding: 18px; background: var(--grad-amber-soft); }
    .arch-e { font-size: 2.6rem; width: 68px; height: 68px; border-radius: 20px; background: var(--surface); display: grid; place-items: center; box-shadow: var(--shadow-1); flex-shrink: 0; }
    .res-body { display: grid; gap: 14px; padding: 18px; }
    @media (min-width: 720px) { .res-body { grid-template-columns: 280px 1fr; align-items: center; } }
    .axes { display: grid; gap: 6px; }
    .ax { display: grid; grid-template-columns: 90px 1fr; gap: 10px; align-items: center; font-size: .8rem; font-weight: 600; color: var(--ink-2); }
    .card-preview { padding: 0 18px 18px; display: grid; justify-items: start; gap: 8px; }
    .card-preview img { max-width: 320px; border-radius: 16px; box-shadow: var(--shadow-2); }
    .rec { display: flex; gap: 12px; align-items: center; }
    .rec img { height: 60px; width: 40px; object-fit: contain; }
    .deck { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    @media (min-width: 640px) { .deck { grid-template-columns: repeat(3, 1fr); } }
    @media (min-width: 1000px) { .deck { grid-template-columns: repeat(4, 1fr); } }
    .dcard { padding: 12px; display: grid; grid-template-columns: 44px 1fr; gap: 10px; align-items: center; }
    .dcard img { height: 74px; width: 44px; object-fit: contain; }
    .dc-body { min-width: 0; }
    .rbtns { display: flex; gap: 6px; }
    .rbtns button { width: 40px; height: 36px; border-radius: 10px; border: 1.5px solid var(--line); display: grid; place-items: center; color: var(--ink-3); transition: all var(--t-fast); }
    .rbtns button.on { background: var(--ink); color: var(--bg); border-color: var(--ink); }
    .rbtns button.love.on { background: var(--grad-amber); border-color: transparent; color: #fff; }
  `],
})
export class DnaPage {
  data = inject(DataService);
  dna = inject(DnaService);
  private progress = inject(ProgressService);
  private pairing = inject(PairingService);
  readonly Math = Math;
  cardUrl = signal<string | null>(null);
  deck = computed(() => { const r = this.dna.ratings(); return [...this.data.brands()].sort((a, b) => (r[a.id] ? 1 : 0) - (r[b.id] ? 1 : 0)); });
  axes = computed(() => { const v = this.dna.vector(); if (!v) return []; return BEER_AXES.map(k => ({ k, l: BEER_AXIS_LABELS[k], v: v[k] })).sort((a, b) => b.v - a.v); });

  constructor() { effect(() => { if (this.dna.ready()) this.progress.award('dna'); }, { allowSignalWrites: true }); }
  rate(id: string, r: Rating): void { this.dna.rate(id, this.dna.ratings()[id] === r ? 'meh' : r); }

  async share(): Promise<void> {
    const a = this.dna.archetype(); if (!a) return;
    const text = `Мой Flavor DNA: ${a.emoji} ${a.name} — «${a.tagline}» Узнай свой на Flavor Tree`;
    try { if (navigator.share) await navigator.share({ title: 'Flavor DNA', text, url: location.origin + '/dna' }); else await navigator.clipboard.writeText(text); this.progress.award('share'); } catch { /* cancel */ }
  }

  /** Рендер карточки 1080×1350 на canvas (эффект Spotify Wrapped). */
  makeCard(): void {
    const a = this.dna.archetype(); const v = this.dna.vector(); if (!a || !v) return;
    const c = document.createElement('canvas'); c.width = 1080; c.height = 1350; const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 1080, 1350); grad.addColorStop(0, '#F7E8C0'); grad.addColorStop(.55, '#E5B849'); grad.addColorStop(1, '#6A4A17');
    g.fillStyle = grad; g.fillRect(0, 0, 1080, 1350);
    for (let i = 0; i < 40; i++) { g.beginPath(); g.arc(Math.random() * 1080, Math.random() * 1350, 6 + Math.random() * 26, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,.14)'; g.fill(); }
    g.fillStyle = 'rgba(255,255,255,.92)'; g.font = '700 36px Outfit, sans-serif'; g.fillText('FLAVOR TREE · МОЙ FLAVOR DNA', 80, 120);
    g.font = '200px serif'; g.fillText(a.emoji, 80, 400);
    g.fillStyle = '#fff'; g.font = '800 88px Outfit, sans-serif'; this.wrap(g, a.name, 80, 520, 920, 96);
    g.font = 'italic 44px Fraunces, Georgia, serif'; g.fillStyle = 'rgba(255,255,255,.9)'; this.wrap(g, a.tagline, 80, 700, 920, 56);
    const top = BEER_AXES.map(k => ({ k, v: v[k] })).sort((x, y) => y.v - x.v).slice(0, 5);
    let y = 860; g.font = '600 34px "Plus Jakarta Sans", sans-serif';
    for (const t of top) { g.fillStyle = '#fff'; g.fillText(BEER_AXIS_LABELS[t.k], 80, y); g.fillStyle = 'rgba(255,255,255,.3)'; g.fillRect(360, y - 26, 640, 22); g.fillStyle = '#fff'; g.fillRect(360, y - 26, 640 * t.v, 22); y += 64; }
    g.fillStyle = 'rgba(255,255,255,.85)'; g.font = '600 30px "Plus Jakarta Sans", sans-serif'; g.fillText('Узнай свой вкус · Efes Kazakhstan × OneIdea 2026', 80, 1260);
    this.cardUrl.set(c.toDataURL('image/png'));
    this.progress.award('share');
  }
  private wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, lh: number): void {
    const words = text.split(' '); let line = '';
    for (const wd of words) { const t = line + wd + ' '; if (g.measureText(t).width > w && line) { g.fillText(line, x, y); line = wd + ' '; y += lh; } else line = t; }
    g.fillText(line, x, y);
  }
}

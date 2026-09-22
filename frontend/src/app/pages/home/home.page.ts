import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../core/data.service';
import { PairingService } from '../../core/pairing.service';
import { ProgressService } from '../../core/progress.service';
import { VenueService } from '../../core/venue.service';
import { IconComponent, IconName } from '../../ui/icon.component';
import { BeerCardComponent } from '../../ui/beer-card.component';
import { SectionHeadComponent } from '../../ui/section.component';
import factsJson from '../../../../../data/facts.json';

interface Scenario { id: string; icon: string; title: string; desc: string; link: any[]; query?: Record<string, string>; badge: string; }

@Component({
  selector: 'ft-home',
  standalone: true,
  imports: [RouterLink, FormsModule, IconComponent, BeerCardComponent, SectionHeadComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- HERO -->
    <section class="hero">
      <span class="eyebrow reveal">OneIdea Championship 2026 × Efes Kazakhstan</span>
      <h1 class="reveal reveal-1">Что выберешь <span class="grad-text">сегодня?</span></h1>
      <p class="lede reveal reveal-2">Flavor Tree раскладывает вкус каждого сорта на три слоя — как аромат в парфюмерии — и объясняет, почему это пиво подходит к вашему блюду. Без регистрации, за 15 секунд.</p>

      <form class="search hero-search reveal reveal-3" role="search" (submit)="submit($event)">
        <ft-icon name="search" />
        <input class="input" type="search" name="q" autocomplete="off" enterkeyhint="search" placeholder="Что вы едите? Бешбармак, стейк, суши…" [ngModel]="q()" (ngModelChange)="q.set($event)" (focus)="focused.set(true)" (blur)="blurSoon()" aria-label="Поиск блюда" />
        <button type="submit" class="btn btn-primary go" aria-label="Подобрать"><ft-icon name="arrow-right" /></button>
        @if (focused() && hits().length) {
          <ul class="suggest" role="listbox">
            @for (h of hits(); track h.dish.id) {
              <li><button type="button" (mousedown)="go(h.dish.id)"><span>{{ h.dish.emoji }}</span><span class="grow">{{ h.dish.display_name }}</span><span class="muted xs">{{ h.dish.cuisine_flag }} {{ h.dish.cuisine_label }}</span></button></li>
            }
          </ul>
        }
      </form>
      <a routerLink="/scan" class="scan-cta reveal reveal-4"><span class="sc-ico">📷</span><span><b>Сфотографируйте блюдо</b><br><span class="dim sm">ИИ-сомелье распознает еду и подберёт пиво за 5 секунд</span></span><ft-icon name="chevron-right" /></a>

      <div class="choices reveal reveal-4">
        <a routerLink="/pair" class="choice">
          <span class="ch-ico"><ft-icon name="dish" [size]="28" /></span>
          <span class="ch-t">У меня есть <em>блюдо</em></span>
          <span class="ch-d">Подберу сорт по вкусовой пирамиде и объясню почему</span>
          <span class="ch-cta">Выбрать <ft-icon name="arrow-right" [size]="16" /></span>
        </a>
        <a routerLink="/beers" class="choice alt">
          <span class="ch-ico"><ft-icon name="beer" [size]="28" /></span>
          <span class="ch-t">У меня есть <em>пиво</em></span>
          <span class="ch-d">Покажу пирамиду сорта и блюда, с которыми он звучит</span>
          <span class="ch-cta">Выбрать <ft-icon name="arrow-right" [size]="16" /></span>
        </a>
      </div>

      <div class="stats reveal reveal-5">
        <span><b>{{ data.stats().brands }}</b> сортов Efes KZ</span>
        <span><b>{{ data.stats().dishes }}</b> блюд · 6 кухонь</span>
        <span><b>{{ data.stats().curated }}</b> пара сомелье</span>
        <span><b>15</b> правил гастрономии</span>
      </div>
    </section>

    @if (venue.session(); as s) {
      <a class="soft venue-banner" routerLink="/qr/{{ s.token }}">
        <ft-icon name="map-pin" [size]="22" />
        <span><b>{{ s.venue.name }}</b>, стол {{ s.table }} — подбор учитывает карту заведения ({{ s.venue.brands.length }} сортов в наличии)</span>
        <ft-icon name="chevron-right" />
      </a>
    }

    <!-- СЦЕНАРИИ -->
    <section class="section">
      <ft-section-head eyebrow="Экспресс-сценарии" title="Готовые ответы за один клик" sub="Повод или настроение — движок уже посчитал" />
      <div class="grid grid-3">
        @for (s of scenarios; track s.id) {
          <a class="card hover card-p sc" [routerLink]="s.link" [queryParams]="s.query || null">
            <span class="sc-ico">{{ s.icon }}</span>
            <h3>{{ s.title }}</h3>
            <p class="dim sm">{{ s.desc }}</p>
            <div class="flex jb ac mt12"><span class="badge">{{ s.badge }}</span><span class="amber b sm">Открыть →</span></div>
          </a>
        }
      </div>
    </section>

    <!-- КАК РАБОТАЕТ -->
    <section class="section">
      <ft-section-head eyebrow="Механика" title="Как Flavor Tree подбирает пару" sub="Не «нейросеть угадала», а сенсорика, которую можно проверить" />
      <div class="grid grid-3">
        @for (st of steps; track st.n) {
          <div class="card card-p step">
            <div class="step-n">{{ st.n }}</div>
            <div class="step-ico"><ft-icon [name]="st.icon" [size]="24" /></div>
            <h3>{{ st.title }}</h3>
            <p class="dim sm">{{ st.text }}</p>
          </div>
        }
      </div>
      <div class="center mt16"><a routerLink="/about" class="btn btn-ghost">Подробнее про движок и пирамиду <ft-icon name="arrow-right" [size]="16" /></a></div>
    </section>

    <!-- СОРТА -->
    <section class="section">
      <ft-section-head eyebrow="Портфель" title="Сорта Efes Kazakhstan" sub="Каждый — с вкусовой пирамидой и подачей"><a routerLink="/beers" class="btn btn-secondary btn-sm hide-mobile">Все {{ data.stats().brands }} сортов</a></ft-section-head>
      <div class="scroll-x">
        @for (b of featured(); track b.id) { <div class="fb"><ft-beer-card [brand]="b" /></div> }
        <a routerLink="/beers" class="card hover fb more"><ft-icon name="arrow-right" [size]="26" /><span>Все сорта</span></a>
      </div>
    </section>

    <!-- ФАКТ + АКАДЕМИЯ -->
    <section class="section grid grid-2">
      <div class="soft card-p fact">
        <span class="eyebrow">Интересный факт</span>
        <div class="fact-body pop" [attr.key]="factIdx()"><span class="fact-emoji">{{ fact().emoji }}</span><p>{{ fact().text }}</p></div>
        <div class="flex g8 mt12"><button type="button" class="btn btn-secondary btn-sm" (click)="nextFact()"><ft-icon name="refresh" [size]="16" /> Ещё факт</button><span class="muted xs" style="align-self:center">{{ factIdx() + 1 }} / {{ facts.length }}</span></div>
      </div>
      <div class="card card-p acad">
        <span class="eyebrow">Школа сомелье</span>
        <h3 class="mt8">{{ progress.level().title }} · {{ progress.xp() }} XP</h3>
        <p class="dim sm mt8">{{ progress.nextLevel() ? 'До уровня «' + progress.nextLevel()!.title + '» — ' + (progress.nextLevel()!.xp_required - progress.xp()) + ' XP' : 'Максимальный уровень достигнут' }}</p>
        <div class="bar mt12"><i [style.width.%]="progress.levelProgress() * 100"></i></div>
        <div class="flex g8 mt16 wrap"><a routerLink="/academy" class="btn btn-primary btn-sm"><ft-icon name="book" [size]="16" /> Учиться</a><a routerLink="/dna" class="btn btn-secondary btn-sm"><ft-icon name="user" [size]="16" /> Мой Flavor DNA</a></div>
      </div>
    </section>

    <p class="center accent-serif muted mt32" style="font-size:1.25rem">«Don't just drink — listen to the flavor»</p>
  `,
  styles: [`
    .hero { text-align: center; padding: 22px 0 8px; }
    @media (min-width: 900px) { .hero { padding: 40px 0 16px; } }
    .hero h1 { margin: 12px auto 12px; max-width: 14ch; }
    .hero .lede { margin: 0 auto 22px; }
    .hero-search { max-width: 620px; margin: 0 auto; }
    .scan-cta { display: flex; align-items: center; gap: 12px; max-width: 620px; margin: 12px auto 0; padding: 12px 14px; border-radius: var(--r-lg); background: var(--surface); border: 1.5px solid var(--line); box-shadow: var(--shadow-1); text-align: left; transition: transform var(--t-fast), border-color var(--t-fast); }
    .scan-cta:hover { transform: translateY(-2px); border-color: var(--amber-400); }
    .scan-cta > span:nth-child(2) { flex: 1; }
    .sc-ico { width: 44px; height: 44px; border-radius: 14px; background: var(--grad-amber); display: grid; place-items: center; font-size: 1.3rem; flex-shrink: 0; }
    .hero-search .input { min-height: 56px; padding-right: 64px; border-radius: var(--r-lg); box-shadow: var(--shadow-1); }
    .go { position: absolute; right: 6px; top: 6px; bottom: 6px; min-height: 0; width: 48px; padding: 0; border-radius: 12px; }
    .suggest { position: absolute; left: 0; right: 0; top: calc(100% + 6px); background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); box-shadow: var(--shadow-2); list-style: none; z-index: 20; overflow: hidden; text-align: left; }
    .suggest button { width: 100%; display: flex; gap: 10px; align-items: center; padding: 12px 14px; font-weight: 600; }
    .suggest button:hover { background: var(--amber-100); }
    .choices { display: grid; gap: 12px; margin: 22px auto 0; max-width: 760px; }
    @media (min-width: 640px) { .choices { grid-template-columns: 1fr 1fr; gap: 16px; } }
    .choice { position: relative; display: flex; flex-direction: column; align-items: flex-start; text-align: left; gap: 6px; padding: 20px; border-radius: var(--r-xl); background: var(--surface); border: 1.5px solid var(--line); box-shadow: var(--shadow-1); transition: transform var(--t-med) var(--ease), box-shadow var(--t-med), border-color var(--t-med); overflow: hidden; }
    .choice::after { content: ''; position: absolute; right: -40px; top: -40px; width: 160px; height: 160px; border-radius: 50%; background: radial-gradient(circle, rgba(245,185,66,.35), transparent 70%); }
    .choice:hover { transform: translateY(-4px); box-shadow: var(--shadow-2); border-color: var(--amber-400); }
    .ch-ico { width: 52px; height: 52px; border-radius: 16px; background: var(--grad-amber); color: #fff; display: grid; place-items: center; box-shadow: var(--shadow-amber); }
    .alt .ch-ico { background: var(--ink); box-shadow: none; }
    .ch-t { font-family: var(--font-display); font-weight: 800; font-size: 1.35rem; margin-top: 6px; }
    .ch-t em { font-style: normal; color: var(--amber-600); }
    .ch-d { color: var(--ink-3); font-size: .9rem; }
    .ch-cta { margin-top: 6px; display: inline-flex; align-items: center; gap: 6px; font-weight: 700; color: var(--amber-700); }
    .stats { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: center; gap: 8px 22px; margin-top: 26px; color: var(--ink-3); font-size: .85rem; }
    .stats b { color: var(--gold-soft); font-family: var(--font-display); font-size: 1.45rem; font-weight: 600; font-variant-numeric: lining-nums tabular-nums; letter-spacing: -.02em; margin-right: 2px; }
    .venue-banner { display: flex; align-items: center; gap: 12px; padding: 14px 16px; margin-top: 20px; color: var(--amber-900); }
    .venue-banner span { flex: 1; font-size: .92rem; }
    .sc { display: block; }
    .sc-ico { font-size: 2rem; display: block; margin-bottom: 8px; }
    .step { position: relative; }
    .step-n { position: absolute; top: 14px; right: 16px; font-family: var(--font-display); font-weight: 800; font-size: 2.4rem; color: var(--amber-100); line-height: 1; }
    .step-ico { width: 44px; height: 44px; border-radius: 12px; background: var(--grad-amber-soft); color: var(--amber-700); display: grid; place-items: center; margin-bottom: 12px; }
    .fb { width: 210px; }
    .fb.more { display: grid; place-items: center; align-content: center; gap: 8px; font-weight: 700; color: var(--amber-700); min-height: 200px; }
    .fact-body { display: flex; gap: 12px; align-items: flex-start; margin-top: 10px; }
    .fact-emoji { font-size: 2rem; }
    .fact p { font-size: 1.02rem; line-height: 1.5; }
  `],
})
export class HomePage {
  data = inject(DataService);
  progress = inject(ProgressService);
  venue = inject(VenueService);
  private pairing = inject(PairingService);
  private router = inject(Router);

  q = signal('');
  focused = signal(false);
  hits = computed(() => this.pairing.searchDishes(this.q(), 6));
  featured = computed(() => ['efes-pilsener', 'kozel', 'legenda-777', 'khmelnoy-los', 'wukong-ju', 'stary-melnik'].map(id => this.data.brand(id)!).filter(Boolean));
  readonly facts = factsJson as { emoji: string; text: string }[];
  factIdx = signal(Math.floor(Math.random() * this.facts.length));
  fact = computed(() => this.facts[this.factIdx()]);

  readonly scenarios: Scenario[] = [
    { id: 'kz', icon: '🥩', title: 'Казахское застолье', desc: 'Бешбармак, казы, куырдак — умами и жир против солода и горечи.', link: ['/pair', 'beshbarmak'], badge: 'Казахская кухня' },
    { id: 'grill', icon: '🔥', title: 'Мясо на гриле', desc: 'Шашлык, стейк, рёбрышки — дым ищет смолистый хмель и карамель.', link: ['/pair', 'shashlyk'], query: { occasion: 'evening' }, badge: 'Вечер' },
    { id: 'hot', icon: '☀️', title: 'Освежиться в жару', desc: 'Лёгкие чистые сорта с высокой карбонизацией к любому обеду.', link: ['/pair', 'edamame'], query: { occasion: 'hot' }, badge: 'Свежесть 5–7 °C' },
    { id: 'sushi', icon: '🍣', title: 'Суши и азиатский ужин', desc: 'Деликатная рыба не терпит хмеля — нужна рисовая лёгкость.', link: ['/pair', 'sushi'], badge: 'Японская кухня' },
    { id: 'spicy', icon: '🌶️', title: 'Острое', desc: 'Крылышки Buffalo, тако, чили: солод гасит огонь, хмель разжигает.', link: ['/pair', 'buffalo-wings'], badge: 'Ловушка №1' },
    { id: 'dessert', icon: '🥧', title: 'Десерт', desc: 'Штрудель и яблочный пирог просят карамельный янтарный лагер.', link: ['/pair', 'strudel'], query: { occasion: 'gourmet' }, badge: 'Bridge' },
  ];
  readonly steps: { n: string; icon: IconName; title: string; text: string }[] = [
    { n: '01', icon: 'tree', title: 'Пирамида → вектор', text: 'Сомелье описывает сорт нотами Top / Heart / Base с интенсивностью 1–10. Ноты переводятся в 10 сенсорных осей: горечь, тело, солод, пузырьки, хмель…' },
    { n: '02', icon: 'dish', title: 'Блюдо → вектор', text: '50 блюд размечены по 13 осям: соль, жир, умами, острота, дым, корочка, свежесть. Своё блюдо можно описать за 4 шага.' },
    { n: '03', icon: 'bolt', title: '15 правил → оценка', text: 'Интенсивность, «жир + горечь = очищение», «острое не любит хмель», мосты ароматов, вердикт сомелье. Каждое правило объяснимо словами.' },
  ];

  constructor() { effect(() => { const id = setInterval(() => this.nextFact(), 9000); return () => clearInterval(id); }); }

  submit(e: Event): void { e.preventDefault(); const h = this.hits()[0]; if (h) this.go(h.dish.id); else this.router.navigate(['/pair'], { queryParams: { q: this.q() } }); }
  go(id: string): void { this.router.navigate(['/pair', id]); }
  blurSoon(): void { setTimeout(() => this.focused.set(false), 150); }
  nextFact(): void { this.factIdx.update(i => (i + 1) % this.facts.length); }
}

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DataService } from '../../core/data.service';
import { IconComponent } from '../../ui/icon.component';
import { SectionHeadComponent } from '../../ui/section.component';

/** Питч для жюри: проблема → решение → механика → бизнес → impact → ask → команда → roadmap. */
@Component({
  selector: 'ft-about',
  standalone: true,
  imports: [RouterLink, IconComponent, SectionHeadComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="hero center">
      <span class="eyebrow">О проекте</span>
      <h1>Первая в СНГ платформа <span class="grad-text">сенсорного образования</span> для пива</h1>
      <p class="lede" style="margin:12px auto 0">Помогаем людям слышать вкус, а брендам — быть понятыми. B2B2C через Efes Kazakhstan: QR на столе, без приложения и регистрации.</p>
    </section>

    <section class="section">
      <ft-section-head eyebrow="Проблема" title="Гость выбирает вслепую" sub="CustDev: 20 респондентов, 5 глубинных интервью, 3 заведения Алматы (авг–сен 2026)" />
      <div class="grid grid-4">
        @for (k of kpis; track k.v) { <div class="card card-p center"><div class="kv">{{ k.v }}</div><div class="dim sm">{{ k.t }}</div></div> }
      </div>
      <blockquote class="quote card card-p mt16">«Официант предложил Kozel Dark к стейку. Почему именно это? Не объяснил. Взял, было вкусно, но я до сих пор не понимаю, почему».<footer class="muted sm mt8">— Женщина, 32 года, Алматы</footer></blockquote>
    </section>

    <section class="section">
      <ft-section-head eyebrow="Решение" title="Вкусовая пирамида + движок пар" sub="«Fragrantica + Duolingo для пивной индустрии»" />
      <div class="grid grid-3">
        <div class="card card-p"><h3>🔺 Пирамида</h3><p class="dim sm mt8">Каждый сорт — Top (0–3 с), Heart (3–15 с), Base (15+ с). {{ data.stats().notes }} нот по стандарту FlavorActiV, {{ data.stats().pyramidNotes }} привязок к {{ data.stats().brands }} сортам.</p></div>
        <div class="card card-p"><h3>🧠 Движок</h3><p class="dim sm mt8">Пирамида → 10-осевой сенсорный вектор. Блюдо → 13 осей. 15 объяснимых правил: интенсивность, очищение жира, острота, соль, десерт, кислота, умами, деликатность, корочка, мост, вердикт сомелье, повод, горечь, DNA. Один и тот же код на Python (API) и TypeScript (офлайн), паритет — 874 проверки.</p></div>
        <div class="card card-p"><h3>🎓 Школа сомелье</h3><p class="dim sm mt8">4 уровня, 12 уроков, 20 вопросов, XP и серии. 5000 XP — именной сертификат Efes с QR-верификацией. Учим гостей и официантов одним языком.</p></div>
      </div>
      <div class="flex g8 wrap mt16"><a routerLink="/pair/beshbarmak" class="btn btn-primary btn-sm">Демо: бешбармак</a><a routerLink="/beers/efes-pilsener" class="btn btn-secondary btn-sm">Демо: пирамида Efes Pilsener</a><a routerLink="/qr/EBG-05" class="btn btn-secondary btn-sm">Демо: QR на столе</a><a routerLink="/admin" class="btn btn-secondary btn-sm">Панель сомелье</a></div>
    </section>

    <section class="section">
      <ft-section-head eyebrow="Уникальность" title="Почему это работает в Казахстане" />
      <div class="grid grid-3">
        <div class="card card-p"><h3>🇰🇿 Казахская кухня</h3><p class="dim sm mt8">15 национальных блюд с сенсорной разметкой: бешбармак, казы, куырдак, курт… 0% рынка делает это осознанно — ниша без конкурентов.</p></div>
        <div class="card card-p"><h3>📱 Zero-friction</h3><p class="dim sm mt8">QR на столе → браузер → ответ за 15 секунд. Без установки и аккаунта. Подбор учитывает, что реально на кранах заведения.</p></div>
        <div class="card card-p"><h3>🏢 B2B2C через Efes</h3><p class="dim sm mt8">Не App Store, а партнёрский канал: сомелье Efes ведёт пирамиды, HoReCa получает обученных официантов и рост чека.</p></div>
      </div>
    </section>

    <section class="section">
      <ft-section-head eyebrow="Бизнес-модель" title="Четыре потока монетизации" />
      <div class="grid grid-4">
        @for (m of money; track m.t) { <div class="card card-p"><div class="badge mb8">{{ m.b }}</div><h4>{{ m.t }}</h4><p class="dim sm mt8">{{ m.d }}</p></div> }
      </div>
    </section>

    <section class="section">
      <ft-section-head eyebrow="Impact" title="Эффект для Efes Kazakhstan" />
      <div class="grid grid-3">
        <div class="soft card-p"><div class="kv">+$1.5–3.0M</div><p class="dim sm">чистой прибыли в год при переходе 2% аудитории в премиум-сегмент</p></div>
        <div class="soft card-p"><div class="kv">5–15 мин</div><p class="dim sm">контакта с брендом за сессию вместо 3 секунд рекламы</p></div>
        <div class="soft card-p"><div class="kv">+15–20%</div><p class="dim sm">к среднему чеку пива в партнёрских заведениях за 3 месяца (цель пилота)</p></div>
      </div>
    </section>

    <section class="section">
      <ft-section-head eyebrow="Наш ask" title="Что нужно для пилота" />
      <div class="grid grid-3">
        <div class="card card-p"><h3>📊 Данные</h3><p class="dim sm mt8">Дегустация 17 сортов с сомелье Efes для верификации пирамид (сейчас — черновик, ABV части сортов оценочный).</p></div>
        <div class="card card-p"><h3>🍺 Пилот</h3><p class="dim sm mt8">3 заведения в Алматы, QR на столах, 8 недель. Метрики: QR-конверсия > 65%, time-to-pairing < 15 с, NPS > 50.</p></div>
        <div class="card card-p"><h3>🤝 Менторство</h3><p class="dim sm mt8">Trade-marketing Efes: интеграция в программу обучения персонала HoReCa.</p></div>
      </div>
    </section>

    <section class="section">
      <ft-section-head eyebrow="Roadmap" title="Дорожная карта" />
      <ol class="timeline">
        @for (r of roadmap; track r.t) { <li [class.done]="r.done"><span class="tl-dot"></span><div><b>{{ r.t }}</b><p class="dim sm">{{ r.d }}</p></div></li> }
      </ol>
    </section>

    <section class="section">
      <ft-section-head eyebrow="Команда" title="Кто делает Flavor Tree" />
      <div class="grid grid-2">
        @for (t of data.team(); track t.id) { <div class="card card-p flex g16 ac"><div class="ava">{{ t.name[0] }}</div><div><h3>{{ t.name }}</h3><div class="amber sm b">{{ t.role }}</div><p class="dim sm mt8">{{ t.bio }}</p></div></div> }
      </div>
      <p class="muted sm mt16">Исходники: Angular 18 + Django REST · движок с тестами и golden-паритетом · документация в <code>docs/</code>.</p>
    </section>
  `,
  styles: [`
    .hero { padding: 20px 0 0; } .hero h1 { max-width: 20ch; margin: 12px auto 0; }
    .kv { font-family: var(--font-display); font-weight: 800; font-size: 2rem; color: var(--amber-600); letter-spacing: -.03em; }
    .quote { font-family: var(--font-accent); font-style: italic; font-size: 1.1rem; }
    .timeline { list-style: none; display: grid; gap: 14px; position: relative; padding-left: 26px; }
    .timeline::before { content: ''; position: absolute; left: 8px; top: 6px; bottom: 6px; width: 2px; background: var(--line); }
    .timeline li { position: relative; }
    .tl-dot { position: absolute; left: -24px; top: 5px; width: 14px; height: 14px; border-radius: 50%; background: var(--surface); border: 3px solid var(--amber-300); }
    .done .tl-dot { background: var(--amber-500); border-color: var(--amber-500); }
    .ava { width: 56px; height: 56px; border-radius: 50%; background: var(--grad-amber); color: #fff; display: grid; place-items: center; font-family: var(--font-display); font-weight: 800; font-size: 1.4rem; flex-shrink: 0; }
  `],
})
export class AboutPage {
  data = inject(DataService);
  readonly kpis = [
    { v: '72%', t: 'выбирают пиво по привычке или цене' }, { v: '45%', t: 'боятся заказать «не то»' },
    { v: '80%', t: 'недовольны советами официантов' }, { v: '0%', t: 'осознанно сочетают с казахской кухней' },
  ];
  readonly money = [
    { b: 'B2B', t: 'Подписка HoReCa', d: 'QR-меню + обучение персонала + аналитика кранов, от 25 000 ₸/мес за заведение.' },
    { b: 'B2B', t: 'Бренд-контент Efes', d: 'Верифицированные пирамиды, кампании «сорт месяца», сезонные пары.' },
    { b: 'B2C', t: 'Сертификация', d: 'Платный экзамен сомелье уровня 4 и именной сертификат для персонала.' },
    { b: 'Data', t: 'Инсайты рынка', d: 'Обезличенная статистика: что едят с чем, Flavor DNA по городам, спрос на стили.' },
  ];
  readonly roadmap = [
    { t: 'Q3 2026 — MVP', d: 'Пирамиды 17 сортов, 50 блюд, движок v1, офлайн-SPA, панель сомелье, QR-вход.', done: true },
    { t: 'Q4 2026 — Пилот', d: 'Дегустация с сомелье Efes, 3 заведения Алматы, метрики конверсии и чека.', done: false },
    { t: 'Q1 2027 — Масштаб', d: 'Астана, Шымкент; kk/en локализация; Kozel Dark, пшеничные, сезонные сорта.', done: false },
    { t: 'Q2 2027 — AI Food Scanner', d: 'Фото блюда → сенсорный вектор через vision-модель; Flavor DNA в соцсетях.', done: false },
  ];
}

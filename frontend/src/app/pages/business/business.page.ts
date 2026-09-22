import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../core/data.service';
import { API_URL } from '../../core/config';
import { CONTACT } from '../../core/contact';
import { PLANS } from '../../core/saas.models';
import { IconComponent } from '../../ui/icon.component';

/**
 * Лендинг для владельцев баров — единственная цель: заявка или регистрация пробного.
 * Калькулятор считает окупаемость на их цифрах, тарифы берутся из PLANS.
 */
@Component({
  selector: 'ft-business',
  standalone: true,
  imports: [RouterLink, FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- HERO -->
    <section class="hero">
      <div class="hero-t">
        <span class="eyebrow">Для баров, пабов и ресторанов · Казахстан</span>
        <h1>Гость сканирует QR — и берёт <span class="grad-text">второе пиво</span>, а не «как обычно»</h1>
        <p class="lead">Flavor Tree показывает гостю ваше меню с вашими ценами и к каждому блюду подбирает 3 сорта <b>из вашей карты</b>. Официант не обязан быть сомелье — за него работает движок.</p>
        <div class="flex g10 wrap mt20">
          <a routerLink="/cabinet" class="btn btn-primary btn-lg"><ft-icon name="sparkles" /> 14 дней бесплатно</a>
          <a [routerLink]="['/m', demoSlug, 5]" class="btn btn-secondary btn-lg"><ft-icon name="qr" /> Посмотреть демо-меню</a>
        </div>
        <div class="proof mt16"><span>✔ без договора и карты</span><span>✔ запуск за 1 день</span><span>✔ {{ data.stats().brands }} сортов Efes KZ уже в базе</span></div>
      </div>
      <div class="hero-p" aria-hidden="true">
        <div class="phone">
          <div class="ph-top"><span class="ph-dot"></span>Efes Beer Garden · стол 5</div>
          <div class="ph-h">Что взять к вашему блюду?</div>
          <div class="ph-row"><span>🍖</span><b>Шашлык из баранины</b><i>3 400 ₸</i></div>
          <div class="ph-sug">
            <div class="ph-s top"><span class="ring">92</span><span><b>13 Регион</b><br><small>дым гриля вторит хмелю</small></span><em>1 750 ₸</em></div>
            <div class="ph-s"><span class="ring">87</span><span><b>Бочковое</b><br><small>очистит жир</small></span><em>1 600 ₸</em></div>
            <div class="ph-s"><span class="ring">84</span><span><b>Легенда 777</b><br><small>карамель к корочке</small></span><em>1 900 ₸</em></div>
          </div>
          <div class="ph-btn">Заказать · показать официанту</div>
        </div>
      </div>
    </section>

    <!-- ПРОБЛЕМА -->
    <section class="section">
      <span class="eyebrow">Почему гости пьют меньше, чем могли бы</span>
      <h2>Три дырки в выручке, которые не видно в отчёте</h2>
      <div class="grid grid-3 mt16">
        <div class="card card-p pb"><span class="ico">🤷</span><b>«А что к этому подходит?»</b><p class="dim">Официант не сомелье. Гость получает «ну… Efes?», берёт одно пиво и заканчивает вечер водой.</p></div>
        <div class="card card-p pb"><span class="ico">📄</span><b>Бумажное меню врёт</b><p class="dim">Кран закончился в 21:00, а в меню он есть. Гость заказал, официант вернулся с «нету» — и заказ потерян.</p></div>
        <div class="card card-p pb"><span class="ico">🕳️</span><b>Нет данных</b><p class="dim">Вы не знаете, к чему гости искали пиво, какие связки заходят и сколько столов вообще открыли меню.</p></div>
      </div>
    </section>

    <!-- КАК РАБОТАЕТ -->
    <section class="section">
      <span class="eyebrow">Как это работает</span>
      <h2>Запуск за один вечер</h2>
      <ol class="steps mt16">
        <li><span class="n">1</span><div><b>Вносите карту и цены</b><p class="dim">Выбираете сорта и блюда из каталога, ставите свои цены. Стоп-лист — одна галочка, гость сразу не видит позицию.</p></div></li>
        <li><span class="n">2</span><div><b>Печатаете QR на столы</b><p class="dim">Кабинет сам делает стенды A6 с вашим логотипом и цветом. Каждый QR знает номер стола.</p></div></li>
        <li><span class="n">3</span><div><b>Гость сканирует и заказывает</b><p class="dim">Нажимает на блюдо — получает 3 сорта с вашей карты, с ценой и объяснением «почему». Кнопка «Заказать» — и официант просто приносит.</p></div></li>
        <li><span class="n">4</span><div><b>Вы видите эффект в ₸</b><p class="dim">Сканы по дням, топ связок «блюдо → пиво», конверсия и сумма пива, выбранного через подбор.</p></div></li>
      </ol>
    </section>

    <!-- КАЛЬКУЛЯТОР -->
    <section class="section" id="calc">
      <span class="eyebrow">Калькулятор</span>
      <h2>Сколько это принесёт вашему заведению</h2>
      <div class="calc card mt16">
        <div class="calc-in">
          <label>Столов в зале <b>{{ tables() }}</b><input type="range" class="range" min="4" max="60" [ngModel]="tables()" (ngModelChange)="tables.set(+$event)" /></label>
          <label>Гостей в день <b>{{ guests() }}</b><input type="range" class="range" min="20" max="600" step="10" [ngModel]="guests()" (ngModelChange)="guests.set(+$event)" /></label>
          <label>Средняя цена пива, ₸ <b>{{ fmt(beerPrice()) }}</b><input type="range" class="range" min="800" max="3500" step="50" [ngModel]="beerPrice()" (ngModelChange)="beerPrice.set(+$event)" /></label>
          <label>Доля гостей, открывающих QR <b>{{ scanRate() }}%</b><input type="range" class="range" min="10" max="70" step="5" [ngModel]="scanRate()" (ngModelChange)="scanRate.set(+$event)" /></label>
          <label>Из них берут пиво по подбору <b>{{ convRate() }}%</b><input type="range" class="range" min="10" max="50" step="5" [ngModel]="convRate()" (ngModelChange)="convRate.set(+$event)" /></label>
          <p class="muted xs">Значения по умолчанию — из пилота: 40% сканов, 34% нажимают «Заказать». Считаем консервативно: +1 пиво на гостя, без учёта второго и третьего.</p>
        </div>
        <div class="calc-out">
          <div class="co-big">+{{ fmt(monthly()) }} ₸<span>в месяц дополнительно</span></div>
          <div class="co-row"><span>Дополнительных бокалов в день</span><b>{{ extraPerDay() }}</b></div>
          <div class="co-row"><span>Подходящий тариф</span><b>{{ plan().name }} · {{ fmt(plan().price) }} ₸/мес</b></div>
          <div class="co-row"><span>Окупаемость</span><b>{{ payback() }}</b></div>
          <div class="co-row hl"><span>Возврат на подписку</span><b>×{{ roi() }}</b></div>
          <a routerLink="/cabinet" class="btn btn-primary btn-block mt16">Попробовать бесплатно</a>
        </div>
      </div>
    </section>

    <!-- ЧТО ВИДИТ ВЛАДЕЛЕЦ -->
    <section class="section">
      <span class="eyebrow">Кабинет владельца</span>
      <h2>Цифры, а не ощущения</h2>
      <div class="grid grid-4 mt16">
        <div class="kpi card card-p"><span class="kv">1 240</span><span class="kl">сканов за месяц</span></div>
        <div class="kpi card card-p"><span class="kv">40%</span><span class="kl">гостей открыли подбор</span></div>
        <div class="kpi card card-p"><span class="kv">+75 400 ₸</span><span class="kl">пива через подбор</span></div>
        <div class="kpi card card-p"><span class="kv">1 346 ₸</span><span class="kl">средняя добавка к чеку</span></div>
      </div>
      <div class="grid grid-2 mt12">
        <div class="card card-p"><b>Топ связок, которые заказывают</b><ul class="pairs mt12"><li>🍖 Шашлык → 13 Регион <b>31</b></li><li>🍖 Рёбра BBQ → Efes Pilsener <b>24</b></li><li>🥟 Манты → Бочковое <b>19</b></li><li>🧀 Курт → Северное Сияние <b>17</b></li></ul></div>
        <div class="card card-p"><b>Что ещё умеет кабинет</b><ul class="feat mt12"><li>Стоп-лист и цены — меняются за секунду, без перепечатки меню</li><li>Печать QR-стендов на столы с вашим брендингом</li><li>Хиты и рекомендации — помечаете, гость видит первым</li><li>Wi-Fi, Instagram, телефон — прямо в меню гостя</li><li>Демо-кабинет: <a routerLink="/cabinet" class="link">efes&#64;demo.flavortree.kz / flavor2026</a></li></ul></div>
      </div>
    </section>

    <!-- ТАРИФЫ -->
    <section class="section" id="pricing">
      <span class="eyebrow">Тарифы</span>
      <h2>Дешевле одного лишнего бокала в день</h2>
      <div class="grid grid-3 mt16">
        @for (p of plans; track p.id; let i = $index) {
          <div class="card plan" [class.hot]="i === 1">
            @if (i === 1) { <span class="badge">популярный</span> }
            <div class="card-p">
              <b class="pn">{{ p.name }}</b>
              <div class="pp">{{ fmt(p.price) }} ₸<span>/мес</span></div>
              <p class="dim sm">{{ p.tagline }}</p>
              <ul class="feat mt12">@for (f of p.features; track f) { <li>{{ f }}</li> }</ul>
              <a routerLink="/cabinet" class="btn btn-block mt16" [class.btn-primary]="i === 1" [class.btn-secondary]="i !== 1">Начать с 14 дней бесплатно</a>
            </div>
          </div>
        }
      </div>
      <p class="muted sm center mt12">Оплата по счёту на ИП/ТОО или Kaspi. При оплате за год — 2 месяца в подарок. Для сетей и дистрибьюторов — индивидуальные условия.</p>
    </section>

    <!-- ДЛЯ ПРОИЗВОДИТЕЛЯ -->
    <section class="section">
      <div class="card efes">
        <div class="card-p">
          <span class="eyebrow">Для производителей и дистрибьюторов</span>
          <h2>Ваши сорта — первыми в подборе в сотнях заведений</h2>
          <p class="dim mt8">Единая карта точек, сводная аналитика: какие блюда «тянут» какой сорт, где падают продажи, где нужен промо. Подключение всей сети HoReCa за одно решение.</p>
          <a routerLink="/business" fragment="lead" class="btn btn-secondary mt12">Обсудить партнёрство</a>
        </div>
      </div>
    </section>

    <!-- FAQ -->
    <section class="section">
      <span class="eyebrow">Вопросы</span>
      <h2>Коротко о главном</h2>
      <div class="faq mt16">
        @for (f of faq; track f.q) {
          <details class="card"><summary>{{ f.q }}<ft-icon name="chevron-down" [size]="18" /></summary><p class="dim">{{ f.a }}</p></details>
        }
      </div>
    </section>

    <!-- ЗАЯВКА -->
    <section class="section" id="lead">
      <div class="card lead">
        <div class="card-p">
          <span class="eyebrow">Заявка</span>
          <h2>Подключим за один день</h2>
          @if (sent()) {
            <div class="soft ok mt12"><b>Заявка принята.</b> Свяжемся в течение рабочего дня. Хотите быстрее — напишите в <a [href]="wa()" class="link" target="_blank" rel="noopener">WhatsApp</a>.</div>
          } @else {
            <form class="form mt12" (ngSubmit)="submit()">
              <div class="two">
                <label>Заведение *<input class="input" [(ngModel)]="l.venue_name" name="venue_name" required placeholder="Beer Garden" /></label>
                <label>Город<input class="input" [(ngModel)]="l.city" name="city" placeholder="Алматы" /></label>
              </div>
              <div class="two">
                <label>Телефон *<input class="input" type="tel" [(ngModel)]="l.phone" name="phone" required placeholder="+7 7xx xxx xx xx" /></label>
                <label>Как вас зовут<input class="input" [(ngModel)]="l.contact_name" name="contact_name" /></label>
              </div>
              <div class="two">
                <label>Столов<input class="input" type="number" min="1" [(ngModel)]="l.tables" name="tables" /></label>
                <label>Тариф<select class="input" [(ngModel)]="l.plan" name="plan"><option value="">Не знаю, посоветуйте</option>@for (p of plans; track p.id) { <option [value]="p.id">{{ p.name }}</option> }</select></label>
              </div>
              <label>Комментарий<textarea class="input" rows="2" [(ngModel)]="l.comment" name="comment" placeholder="Например: у нас 3 точки, нужна интеграция с iiko"></textarea></label>
              @if (error(); as e) { <div class="soft warn">{{ e }}</div> }
              <div class="flex g10 wrap ac">
                <button type="submit" class="btn btn-primary btn-lg" [disabled]="busy()">{{ busy() ? 'Отправляем…' : 'Отправить заявку' }}</button>
                <a [href]="wa()" class="btn btn-ghost" target="_blank" rel="noopener">или в WhatsApp →</a>
              </div>
            </form>
          }
          <p class="muted xs mt12">{{ contact.phone }} · {{ contact.email }} · Telegram &#64;{{ contact.telegram }}</p>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .hero { display: grid; gap: 24px; align-items: center; padding: 20px 0 8px; }
    @media (min-width: 900px) { .hero { grid-template-columns: 1.15fr 1fr; padding: 36px 0 16px; } }
    h1 { font-size: clamp(1.9rem, 4.5vw, 3rem); line-height: 1.06; margin-top: 8px; }
    .lead { font-size: 1.05rem; color: var(--ink-2); margin-top: 14px; max-width: 560px; }
    .proof { display: flex; gap: 14px; flex-wrap: wrap; font-size: .82rem; color: var(--ink-3); font-weight: 600; }
    .hero-p { display: flex; justify-content: center; }
    .phone { width: 300px; background: var(--surface); border-radius: 34px; padding: 18px 16px; box-shadow: var(--shadow-3); border: 6px solid var(--ink); display: grid; gap: 10px; transform: rotate(-3deg); }
    .ph-top { font-size: .7rem; color: var(--ink-3); display: flex; gap: 6px; align-items: center; }
    .ph-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); }
    .ph-h { font-family: var(--font-accent); font-style: italic; font-size: 1.05rem; }
    .ph-row { display: flex; gap: 8px; align-items: center; padding: 8px 10px; border-radius: 12px; border: 1.5px solid var(--amber-400); font-size: .85rem; }
    .ph-row i { margin-left: auto; font-style: normal; font-weight: 800; }
    .ph-sug { display: grid; gap: 6px; }
    .ph-s { display: flex; gap: 8px; align-items: center; padding: 8px; border-radius: 12px; background: var(--surface-2); font-size: .78rem; }
    .ph-s.top { background: var(--amber-100); }
    .ph-s em { margin-left: auto; font-style: normal; font-weight: 800; }
    .ph-s small { color: var(--ink-3); }
    .ring { width: 34px; height: 34px; border-radius: 50%; border: 3px solid var(--amber-500); display: grid; place-items: center; font-weight: 800; font-size: .72rem; flex-shrink: 0; }
    .ph-btn { background: var(--grad-amber); color: #fff; text-align: center; padding: 10px; border-radius: 12px; font-weight: 800; font-size: .82rem; }
    .pb { display: grid; gap: 8px; }
    .ico { font-size: 1.8rem; }
    .steps { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }
    @media (min-width: 900px) { .steps { grid-template-columns: repeat(4, 1fr); } }
    .steps li { display: flex; gap: 12px; padding: 16px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); }
    .n { width: 34px; height: 34px; border-radius: 50%; background: var(--grad-amber); color: #fff; display: grid; place-items: center; font-weight: 800; flex-shrink: 0; }
    .calc { display: grid; overflow: hidden; }
    @media (min-width: 900px) { .calc { grid-template-columns: 1.2fr 1fr; } }
    .calc-in { padding: 20px; display: grid; gap: 14px; }
    .calc-in label { display: grid; gap: 6px; font-size: .85rem; font-weight: 600; }
    .calc-in label b { font-family: var(--font-display); color: var(--amber-800); }
    .calc-out { padding: 20px; background: var(--ink); color: var(--bg); display: grid; gap: 10px; align-content: start; }
    .co-big { font-family: var(--font-display); font-weight: 800; font-size: 2.2rem; letter-spacing: -.02em; line-height: 1; display: grid; gap: 4px; margin-bottom: 8px; }
    .co-big span { font-size: .8rem; font-weight: 600; opacity: .7; font-family: var(--font-body); letter-spacing: 0; }
    .co-row { display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; border-top: 1px solid rgba(255,255,255,.12); font-size: .88rem; }
    .co-row.hl b { color: var(--amber-300); font-size: 1.2rem; }
    .kpi { display: grid; gap: 2px; }
    .kv { font-family: var(--font-display); font-weight: 800; font-size: 1.5rem; color: var(--amber-800); }
    .kl { font-size: .74rem; color: var(--ink-3); }
    .pairs, .feat { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; font-size: .88rem; }
    .pairs li { display: flex; justify-content: space-between; }
    .feat li { padding-left: 22px; position: relative; }
    .feat li::before { content: '✔'; position: absolute; left: 0; color: var(--ok); font-weight: 800; }
    .plan { position: relative; }
    .plan.hot { border: 2px solid var(--amber-500); box-shadow: var(--shadow-amber); }
    .badge { position: absolute; top: -12px; left: 18px; background: var(--grad-amber); color: #fff; font-size: .68rem; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; padding: 4px 10px; border-radius: var(--r-full); }
    .pn { font-family: var(--font-display); font-size: 1.1rem; }
    .pp { font-family: var(--font-display); font-weight: 800; font-size: 2rem; margin: 6px 0 2px; letter-spacing: -.02em; }
    .pp span { font-size: .9rem; color: var(--ink-3); font-weight: 600; }
    .efes { background: var(--grad-amber-soft); }
    .faq { display: grid; gap: 8px; }
    details summary { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 14px 18px; font-weight: 700; cursor: pointer; list-style: none; }
    details summary::-webkit-details-marker { display: none; }
    details[open] summary ft-icon { transform: rotate(180deg); }
    details p { padding: 0 18px 14px; }
    .lead { background: var(--surface); }
    .form { display: grid; gap: 12px; }
    .form label { display: grid; gap: 6px; font-size: .8rem; font-weight: 700; color: var(--ink-2); }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    @media (max-width: 560px) { .two { grid-template-columns: 1fr; } }
    .link { color: var(--amber-700); font-weight: 700; text-decoration: underline; }
    .soft.ok { background: var(--ok-bg); color: var(--ok); padding: 12px 14px; border-radius: var(--r-md); }
    .soft.warn { background: var(--warn-bg); color: var(--warn); padding: 10px 14px; border-radius: var(--r-md); }
  `],
})
export class BusinessPage {
  data = inject(DataService);
  readonly plans = PLANS;
  readonly contact = CONTACT;
  readonly demoSlug = 'efes-beer-garden-almaty';

  // калькулятор
  readonly tables = signal(16);
  readonly guests = signal(120);
  readonly beerPrice = signal(1600);
  readonly scanRate = signal(40);
  readonly convRate = signal(30);
  readonly extraPerDay = computed(() => Math.round(this.guests() * this.scanRate() / 100 * this.convRate() / 100));
  readonly monthly = computed(() => this.extraPerDay() * this.beerPrice() * 30);
  readonly plan = computed(() => PLANS.find(p => this.tables() <= p.limits.tables) ?? PLANS[PLANS.length - 1]);
  readonly roi = computed(() => Math.round(this.monthly() / this.plan().price * 10) / 10);
  readonly payback = computed(() => {
    const perDay = this.extraPerDay() * this.beerPrice();
    if (!perDay) return '—';
    const d = Math.ceil(this.plan().price / perDay);
    return d <= 1 ? '1 день' : d < 5 ? `${d} дня` : `${d} дней`;
  });

  // заявка
  l = { venue_name: '', city: '', phone: '', contact_name: '', tables: null as number | null, plan: '', comment: '' };
  readonly busy = signal(false);
  readonly sent = signal(false);
  readonly error = signal<string | null>(null);

  readonly faq = [
    { q: 'Нужно ли ставить что-то на кассу или планшеты?', a: 'Нет. Гость открывает меню в своём телефоне по QR. Вам нужен только кабинет в браузере и напечатанные стенды.' },
    { q: 'У нас сорта, которых нет в каталоге', a: 'Добавим в течение 1–2 дней: сомелье описывает вкусовую пирамиду сорта, и он появляется в подборе. Для сетей делаем это пакетно.' },
    { q: 'Как гость делает заказ?', a: 'Кнопка «Заказать» фиксирует выбор и показывает его на экране — гость называет сорт официанту. Интеграция с iiko/Poster для прямого заказа — в дорожной карте, приоритет отдаём первым клиентам.' },
    { q: 'Подходит для алкогольного законодательства РК?', a: 'Меню — информация о ассортименте заведения, доступная только по QR внутри зала. Никакой рекламы вне заведения и никаких продаж онлайн.' },
    { q: 'Что после 14 дней?', a: 'Кабинет остаётся, меню для гостей отключается до оплаты. Данные не пропадают. Оплата по счёту или Kaspi.' },
  ];

  fmt(n: number): string { return Math.round(n).toLocaleString('ru-RU'); }
  wa(): string {
    const text = encodeURIComponent(`Здравствуйте! Хочу подключить Flavor Tree${this.l.venue_name ? ' для «' + this.l.venue_name + '»' : ''}.`);
    return `https://wa.me/${CONTACT.whatsapp}?text=${text}`;
  }

  async submit(): Promise<void> {
    if (!this.l.venue_name.trim() || !this.l.phone.trim()) { this.error.set('Укажите заведение и телефон'); return; }
    this.busy.set(true); this.error.set(null);
    const payload = { ...this.l, source: 'landing' };
    if (API_URL) {
      const ok = await fetch(`${API_URL}/leads/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(r => r.ok).catch(() => false);
      if (!ok) { this.busy.set(false); this.error.set('Не удалось отправить — напишите в WhatsApp'); return; }
    } else {
      // без сервера — сохраняем локально, чтобы заявка не потерялась при демонстрации
      try { const all = JSON.parse(localStorage.getItem('ft.saas.leads') || '[]'); all.push({ ...payload, ts: new Date().toISOString() }); localStorage.setItem('ft.saas.leads', JSON.stringify(all)); } catch { /* ignore */ }
    }
    this.busy.set(false); this.sent.set(true);
  }
}

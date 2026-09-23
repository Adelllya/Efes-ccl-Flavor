import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DataV2Service, TAB_GROUPS, isGuestVisible } from '../../core/data-v2.service';
import { I18nKey, I18nService } from '../../core/i18n.service';
import { IconComponent } from '../../ui/icon.component';

interface RuleRow { id: string; name: I18nKey; doc: string; evidence: string; range: string; off: boolean }
interface VetoRow { id: string; name: I18nKey; cond: string; cap: number | null; evidence: string }
interface Metric { k: I18nKey; lit: [number, number] | null; cal: [number, number] | null }
type Loose = Record<string, unknown>;

const SECTIONS: { id: string; l: I18nKey }[] = [
  { id: 'what', l: 'method.s.what' }, { id: 'data', l: 'method.s.data' }, { id: 'numbers', l: 'method.s.numbers' },
  { id: 'rules', l: 'method.s.rules' }, { id: 'score', l: 'method.s.score' }, { id: 'calibration', l: 'method.s.calibration' },
  { id: 'efes', l: 'method.s.efes' }, { id: 'limits', l: 'method.s.limits' },
];

/**
 * «Как мы считаем» — страница для жюри: что делает движок, данные, откуда числа, правила и вето с уровнем
 * доказательности, формула балла, калибровка, политика Efes и ограничения. Все числа — из параметров движка
 * и каталога, тексты правил — rules_summary из data/engine_v2_params.json (человеческие описания; формулы — в _doc).
 */
@Component({
  selector: 'ft-method',
  standalone: true,
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="method">
      <header class="hero">
        <span class="eyebrow">{{ t('method.eyebrow') }}</span>
        <h1>{{ t('method.h1') }}</h1>
        <p class="lede mt12">{{ t('method.lede') }}</p>
        <nav class="toc scroll-x mt16" [attr.aria-label]="t('method.toc')">
          @for (s of sections; track s.id; let i = $index) {
            <a class="chip chip-sm" [href]="'#' + s.id" (click)="jump($event, s.id)"><span class="n num">{{ i + 1 }}</span> {{ t(s.l) }}</a>
          }
        </nav>
      </header>

      <!-- 1. Что делает движок -->
      <section id="what" class="sec">
        <h2><span class="no num">01</span> {{ t('method.s.what') }}</h2>
        @if (ru()) {
          <p class="p">Напиток описан 14 числами — сладость, кислотность, горечь, танины, газация, крепость, тело, молочный белок, соль, умами,
            яркость аромата, обжарка, дым и температура подачи — плюс ароматические теги. Блюдо — 16 числами: соль, сладость, кислота, горечь,
            умами, жир, белок, острота, лук и чеснок, сытность, сливочность, корочка, дым, свежесть, рыбий жир, «зелёное железо» — плюс способ
            приготовления, источник белка, соус и тип кислоты. Дальше {{ activeRules() }} правил из учебников сомелье и сенсорных исследований
            смотрят на обе стороны и начисляют или снимают баллы; {{ vetoes().length }} вето ставят потолок, когда пара заведомо не работает.
            Сумма переводится в балл от {{ P.score.min }} до {{ P.score.max }}. Каждое правило объясняется одной фразой с буквой доказательности,
            поэтому любую оценку можно проверить: открыть карточку пары, раскрыть «Разбор по правилам» и увидеть, из чего она сложилась.</p>
          <p class="p">Один и тот же алгоритм работает на сервере (Python) и в браузере (TypeScript) — результаты совпадают до балла, это проверяется
            автоматически. Подбор работает офлайн, без регистрации и без отправки данных гостя.</p>
        } @else { <p class="p dim">{{ t('method.ruOnly') }}</p> <p class="p">{{ t('method.lede') }}</p> }
      </section>

      <!-- 2. Данные -->
      <section id="data" class="sec">
        <h2><span class="no num">02</span> {{ t('method.s.data') }}</h2>
        @if (data.drinks(); as all) {
          <div class="stats">
            <div class="stat"><b class="num">{{ all.length }}</b><span>{{ t('method.data.drinks') }}</span></div>
            <div class="stat"><b class="num">{{ data.stats().nonEfes }}</b><span>{{ t('method.data.nonEfes') }}</span></div>
            <div class="stat"><b class="num">{{ data.stats().inPairing }}</b><span>{{ t('method.data.inPairing') }}</span></div>
            <div class="stat"><b class="num">{{ data.stats().dishes }}</b><span>{{ t('method.data.dishes') }}</span></div>
            <div class="stat"><b class="num">{{ nCuisines() }}</b><span>{{ t('method.data.cuisines') }}</span></div>
            <div class="stat"><b class="num">{{ data.classicsList.length }}</b><span>{{ t('method.data.classics') }}</span></div>
          </div>
          <h3 class="h3 mt24">{{ t('method.data.byCategory') }}</h3>
          <ul class="cats mt12">
            @for (c of byCategory(); track c.id) {
              <li><span class="cl">{{ t(c.l) }}</span><div class="bar thin"><i [style.width.%]="c.n / byCategory()[0].n * 100"></i></div><b class="num">{{ c.n }}</b></li>
            }
          </ul>
          @if (ru()) {
            <p class="p mt16">Каталог собран по рынку Казахстана: {{ efesCount() }} позиций связаны с Efes (собственные бренды, дистрибуция и портфель CCI),
              остальные {{ data.stats().nonEfes }} — конкуренты и альтернативы, от крафтового сидра из Есика до кумыса. {{ hiddenCount() }} позиций
              в каталоге есть, но в подбор не попадают: черновики с неопределённым стилем и напитки, наличие которых в Казахстане не подтверждено.
              Блюда: {{ data.stats().dishes }}, из них {{ prototypeDishes() }} размечены вручную по спецификации, остальные — автозаполнением по той же шкале;
              своё блюдо из мастера считается тем же кодом.</p>
          }
        } @else { <p class="dim sm">{{ t('v2.pair.loading') }}</p> }
      </section>

      <!-- 3. Откуда числа -->
      <section id="numbers" class="sec">
        <h2><span class="no num">03</span> {{ t('method.s.numbers') }}</h2>
        @if (!ru()) { <p class="p dim">{{ t('method.ruOnly') }}</p> }
        <ol class="ladder">
          <li><b>Этикетка и источники.</b> Крепость — с этикетки, сайта производителя или карточки ритейлера; IBU — только если производитель его публикует;
            остаточный сахар вина — по категории на этикетке. Каждый источник записан в карточку напитка со ссылкой и датой проверки.</li>
          <li><b>Стиль.</b> Чего нет в источниках, берётся из типичного профиля стиля: для пива — BJCP 2021 (IBU, плотность, тело, газация), для остальных
            категорий — категорийные приоры со ссылкой на источник.</li>
          <li><b>Уточнения.</b> Экспертные оценки рыночного отчёта и ноты пирамиды сдвигают оси не больше чем на 0,15. Дегустационные ноты уверенность
            не повышают — это описание, а не измерение.</li>
        </ol>
        @if (data.drinks()) {
          <div class="dist mt16">
            <div><span class="lbl">{{ t('drink.conf.title') }}</span>
              <div class="flex g6 wrap mt8">@for (s of bySource(); track s.id) { <span class="chip chip-sm ghost">{{ t(s.l) }} <b class="num">{{ s.n }}</b></span> }</div></div>
            <div><span class="lbl">{{ t('drink.abv') }}</span>
              <div class="flex g6 wrap mt8">@for (s of byAbvSource(); track s.id) { <span class="chip chip-sm ghost">{{ t(s.l) }} <b class="num">{{ s.n }}</b></span> }</div></div>
          </div>
        }
        @if (ru()) {
          <p class="p mt16">У каждого профиля есть надёжность от 0 до 1: она падает, если крепость принята по стилю, IBU неизвестен или стиль определён неточно.
            Надёжность видна в каждой карточке пары и напитка, а в карточке напитка есть раздел «Откуда эти числа» — пошаговая запись расчёта.
            Если крепость не опубликована, мы так и пишем: «крепость не опубликована — принята по стилю». Ничего не додумываем: неизвестное остаётся
            неизвестным с пометкой, а не превращается в красивое число.</p>
        }
      </section>

      <!-- 4. Правила и вето -->
      <section id="rules" class="sec">
        <h2><span class="no num">04</span> {{ t('method.s.rules') }}</h2>
        <p class="dim sm">{{ t('method.rules.count', { rules: activeRules(), vetoes: vetoes().length }) }} · {{ t('method.version', { version: P.version ?? '' }) }}</p>
        <div class="legend mt12" [attr.aria-label]="t('method.rules.evidence')">
          @for (e of evidence; track e) { <span class="ev-l"><span class="ev" [attr.data-ev]="e">{{ e }}</span> {{ t(evKey(e)) }}</span> }
        </div>
        @if (!ru()) { <p class="p dim mt12">{{ t('method.ruOnly') }}</p> }
        <div class="rules mt16" role="table">
          <div class="rh" role="row"><span role="columnheader">{{ t('method.rules.id') }}</span><span role="columnheader">{{ t('method.rules.what') }}</span><span role="columnheader">{{ t('method.rules.range') }}</span><span role="columnheader">{{ t('method.rules.ev') }}</span></div>
          @for (r of rules(); track r.id) {
            <div class="rr" role="row" [class.off]="r.off">
              <span class="rid" role="cell"><b class="num">{{ r.id }}</b><span class="rn">{{ t(r.name) }}</span>@if (r.off) { <span class="badge badge-warn">{{ t('method.rules.off') }}</span> }</span>
              <span class="rd" role="cell">{{ r.doc }}</span>
              <span class="rp num" role="cell">{{ r.range }}</span>
              <span class="re" role="cell">@if (r.evidence) { <span class="ev" [attr.data-ev]="r.evidence" [attr.title]="t(evKey(r.evidence))">{{ r.evidence }}</span> }</span>
            </div>
          }
        </div>

        <h3 class="h3 mt24">{{ t('method.vetoes.title') }}</h3>
        <p class="dim sm">{{ t('method.vetoes.sub') }}</p>
        <div class="vetoes mt12">
          @for (v of vetoes(); track v.id) {
            <div class="vr">
              <span class="vid num">{{ v.id }}</span>
              <span class="vb"><b>{{ t(v.name) }}</b><span class="vc num">{{ v.cond }}</span></span>
              <span class="vcap">{{ v.cap === null ? t('method.vetoes.exclude') : t('method.vetoes.cap', { n: v.cap }) }}</span>
              <span class="ev" [attr.data-ev]="v.evidence" [attr.title]="t(evKey(v.evidence))">{{ v.evidence }}</span>
            </div>
          }
        </div>
      </section>

      <!-- 5. Как формируется балл -->
      <section id="score" class="sec">
        <h2><span class="no num">05</span> {{ t('method.s.score') }}</h2>
        <p class="formula num">{{ t('method.score.formula', { base: P.score.base, k: P.score.k, min: P.score.min, max: P.score.max }) }}</p>
        @if (ru()) {
          <p class="p">Σ — сумма правил пары (R1–R14 и классика R20); контекст гостя — регион, повод и личный профиль (R15–R17). Правила гармонии и
            очищения умножаются на множитель «fit» из R1: напиток, который громче блюда, теряет их бонусы — так «громкий» имперский стаут не выигрывает
            у деликатного блюда за счёт красивых мостов. Округление — половина вверх, затем потолки вето.</p>
        }
        <h3 class="h3 mt16">{{ t('method.score.bands') }}</h3>
        <ul class="bands mt12">
          @for (b of bands(); track b.id) {
            <li><span class="bmin num">{{ t('method.score.from', { n: b.min }) }}</span><span class="bl accent-serif">{{ b.label }}</span><div class="bar thin"><i [style.width.%]="b.min"></i></div></li>
          }
          <li class="avoid"><span class="bmin num">≤ {{ P.bands.avoid_max }}</span><span class="bl accent-serif">{{ t('method.score.avoid', { label: P.bands.avoid.label, n: P.bands.avoid_max }) }}</span></li>
        </ul>
        @if (ru()) {
          <p class="p mt16">Выдача: в топе не больше {{ P.recommend.diversify.max_per_group }} напитков одного семейства стилей; если категории не ограничены,
            в топе есть хотя бы одна безалкогольная позиция и одна не-пивная — при балле не ниже {{ P.recommend.diversify.min_score_guarantee }}.
            Вкладки по категориям показывают лучшее в каждой, чтобы пиво, сидр, вино, коктейли, крепкое и безалкогольное были видны одновременно.</p>
        }
      </section>

      <!-- 6. Калибровка -->
      <section id="calibration" class="sec">
        <h2><span class="no num">06</span> {{ t('method.s.calibration') }}</h2>
        @if (cal(); as c) {
          <p class="p"><b>{{ t('method.cal.applied', { version: c.version ?? '', date: c.fitted_at ?? '', n: changedParams() }) }}</b></p>
          <div class="ctable mt12" role="table">
            <div class="ch" role="row"><span role="columnheader">{{ t('method.cal.set') }}</span><span role="columnheader">{{ t('method.cal.lit') }}</span><span role="columnheader">{{ t('method.cal.cal') }}</span></div>
            @for (m of metrics(); track m.k) {
              <div class="cr" role="row"><span role="cell">{{ t(m.k) }}</span><span class="num" role="cell">{{ rate(m.lit) }}</span><span class="num strong" role="cell">{{ rate(m.cal) }}</span></div>
            }
          </div>
        } @else { @if (cand(); as c) {
          <p class="p"><b>{{ t('method.cal.tried', { n: c.params_changed ?? 0 }) }}</b></p>
          <div class="ctable mt12" role="table">
            <div class="ch" role="row"><span role="columnheader">{{ t('method.cal.set') }}</span><span role="columnheader">{{ t('method.cal.lit') }}</span><span role="columnheader">{{ t('method.cal.cal') }}</span></div>
            @for (m of candMetrics(); track m.k) {
              <div class="cr" role="row"><span role="cell">{{ t(m.k) }}</span><span class="num strong" role="cell">{{ rate(m.lit) }}</span><span class="num" role="cell">{{ rate(m.cal) }}</span></div>
            }
          </div>
          @if (ru() && c.decision?.why) { <p class="p mt12">{{ c.decision?.why }}</p> }
        } @else {
          <p class="p"><b>{{ t('method.cal.none') }}</b></p>
        } }
        @if (ru()) {
          <p class="p mt12">Что вообще можно калибровать: только {{ calibratable() }} масштабов и порогов в заданных границах (base, k, коэффициенты интенсивности,
            масштабы правил). Знаки и направления правил зафиксированы литературой и не подбираются. Эталонный набор — пары из литературы с ожидаемым
            бэндом (top-3 / хорошо / плохо / избегать) и порядковые ограничения вида «к этому блюду хеллес выше двойного IPA». Часть пар отложена и в
            подборе не участвует вовсе — на них проверяется итог. Спорные пары (эксперты расходятся) помечены и не используются как эталон.
            Следующий источник данных — оценки гостей в приложении и дегустация с сомелье Efes по спорным парам.</p>
        }
      </section>

      <!-- 7. Политика Efes -->
      <section id="efes" class="sec">
        <h2><span class="no num">07</span> {{ t('method.s.efes') }}</h2>
        <blockquote class="quote card card-p">
          <p class="accent-serif q">«{{ policyNote() }}»</p>
          <footer class="muted xs mt8">{{ t('method.efes.verbatim') }} · partner_tie_window = {{ P.recommend.partner_tie_window }}</footer>
        </blockquote>
        @if (ru()) {
          <p class="p mt12">Почему это честно. Балл считается одинаково для всех {{ data.stats().inPairing || '' }} напитков и не зависит от бренда — политика
            влияет только на порядок при практически равных баллах: разница до {{ P.recommend.partner_tie_window }} баллов меньше шага, который гость
            способен почувствовать. Если лучший напиток Efes отстаёт сильнее, он показывается отдельным блоком «Лучшее из портфеля Efes» с его настоящим
            баллом — а первым остаётся тот, кто выиграл. Правило записано в ответе движка рядом с результатом и проверяется тестом: выше может оказаться
            только Efes и только внутри окна. Заведение, подключившее Flavor Tree, видит подбор только по своей карте.</p>
        }
      </section>

      <!-- 8. Ограничения -->
      <section id="limits" class="sec">
        <h2><span class="no num">08</span> {{ t('method.s.limits') }}</h2>
        @if (!ru()) { <p class="p dim">{{ t('method.ruOnly') }}</p> }
        <ul class="limits">
          <li><b>Коэффициенты — калибровка, а не измерение.</b> Направление каждого правила взято из источников, величины подобраны по эталонным парам. Эксперты
            не дают численных шкал, и мы не делаем вид, что они есть.</li>
          <li><b>Спорные пары.</b> IPA к острому (Brewers Association и Оливер — «за», дегустационная панель Samuel Adams — «против»), двойной IPA к чизкейку,
            соль и танины (CMS против Гайзера). Движок держит осторожный вариант для обычного гостя и переворачивает его для того, кто «любит поострее»;
            величину разрыва решит дегустация.</li>
          <li><b>Профили — на уровне стиля.</b> Конкретная бутылка может отличаться от типичного представителя стиля; у массовых лагеров почти нет опубликованных
            IBU, поэтому их профили близки друг к другу — и у Efes, и у конкурентов. Различить их смогут только техкарты производителя или дегустация.</li>
          <li><b>Крепкое и русская традиция закусок.</b> Западная литература описывает виски, джин и мескаль с едой, но почти не формализует водку под соленья,
            сало и селёдку. Правила для крепкого опираются на Whisky School и барные руководства; закусочная традиция учтена лишь через региональные пары
            и классику — это заметное белое пятно.</li>
          <li><b>Ароматические мосты</b> (R12) для казахской и среднеазиатской кухни не валидированы — потолок +8 и роль объяснения, не решающего фактора.</li>
          <li><b>Кумыс, айран, шубат:</b> нет измеренных pH, кислотности и жирности казахстанских продуктов — диапазоны взяты из обзоров. Измерение трёх образцов
            стоит ничего и стоит в плане.</li>
          <li><b>Температура восприятия</b> (R18) выключена: экстраполяция лабораторных данных на 4–20 °C не проверена дегустацией.</li>
        </ul>
      </section>

      <footer class="links">
        <a routerLink="/pair" class="btn btn-primary"><ft-icon name="sparkles" [size]="16" /> {{ t('method.links.pair') }}</a>
        <a routerLink="/drinks" class="btn btn-secondary"><ft-icon name="glass" [size]="16" /> {{ t('v2.pair.catalog') }}</a>
        <a routerLink="/credits" class="btn btn-secondary"><ft-icon name="camera" [size]="16" /> {{ t('method.links.credits') }}</a>
      </footer>
    </article>
  `,
  styles: [`
    .method { max-width: 860px; margin: 0 auto; }
    .hero { padding: 12px 0 4px; }
    .hero h1 { margin-top: 10px; }
    .toc { gap: 6px; }
    .toc .chip .n { color: var(--gold); font-weight: 700; }
    .sec { margin-top: 44px; padding-top: 28px; border-top: 1px solid var(--line); scroll-margin-top: calc(var(--header-h) + 12px); }
    @media (min-width: 900px) { .sec { margin-top: 56px; padding-top: 36px; } }
    h2 { display: flex; align-items: baseline; gap: 12px; font-size: clamp(1.7rem, 2.6vw + .6rem, 2.5rem); margin-bottom: 14px; }
    .no { font-size: .8em; color: var(--gold); font-weight: 500; }
    .h3 { font-size: 1.3rem; font-weight: 600; }
    .p { color: var(--ink-2); font-size: 1.02rem; line-height: 1.65; margin-top: 12px; max-width: 72ch; }
    .p b { color: var(--ink); }
    .stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    @media (min-width: 640px) { .stats { grid-template-columns: repeat(3, 1fr); } }
    .stat { display: grid; gap: 2px; padding: 14px 16px; border-radius: var(--r-md); background: var(--grad-amber-soft), var(--surface); border: 1px solid var(--line); }
    .stat b { font-size: 2.2rem; line-height: 1; color: var(--gold-soft); }
    .stat span { font-size: .78rem; color: var(--ink-3); }
    .cats { list-style: none; display: grid; gap: 7px; padding: 0; }
    .cats li { display: grid; grid-template-columns: 150px 1fr 44px; gap: 10px; align-items: center; font-size: .84rem; color: var(--ink-2); }
    @media (max-width: 480px) { .cats li { grid-template-columns: 120px 1fr 40px; font-size: .78rem; } }
    .cats .cl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cats b { text-align: right; color: var(--ink-3); }
    .ladder { padding-left: 24px; display: grid; gap: 12px; margin-top: 12px; color: var(--ink-2); line-height: 1.6; max-width: 72ch; }
    .ladder li::marker { color: var(--gold); font-family: var(--font-display); font-weight: 700; font-size: 1.15em; }
    .ladder b { color: var(--ink); }
    .dist { display: grid; gap: 14px; }
    @media (min-width: 720px) { .dist { grid-template-columns: 1fr 1fr; } }
    .lbl { font-size: .66rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-3); }
    .chip.ghost { background: transparent; border-color: var(--line-2); cursor: default; }
    .chip.ghost b { color: var(--gold-soft); margin-left: 2px; }
    .legend { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: .78rem; color: var(--ink-3); }
    .ev-l { display: inline-flex; align-items: center; gap: 6px; }
    .ev { flex-shrink: 0; display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 6px; font-size: .7rem; font-weight: 800; font-family: var(--font-body); color: var(--evc, var(--gold)); border: 1px solid color-mix(in srgb, var(--evc, var(--gold)) 50%, transparent); background: color-mix(in srgb, var(--evc, var(--gold)) 12%, transparent); }
    .ev[data-ev="A"] { --evc: var(--ok); } .ev[data-ev="B"] { --evc: var(--info); } .ev[data-ev="C"] { --evc: var(--gold); } .ev[data-ev="D"] { --evc: var(--ink-3); }
    .rules { display: grid; gap: 8px; }
    .rh { display: none; }
    .rr { display: grid; gap: 6px; padding: 12px 14px; border-radius: var(--r-md); background: var(--grad-amber-soft), var(--surface); border: 1px solid var(--line); grid-template-columns: 1fr auto; grid-template-areas: 'id ev' 'doc doc' 'pts pts'; }
    .rr.off { opacity: .6; }
    .rid { grid-area: id; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .rid b { color: var(--gold); font-size: 1.05rem; }
    .rn { font-weight: 700; color: var(--ink); }
    .rd { grid-area: doc; font-size: .84rem; color: var(--ink-2); line-height: 1.5; }
    .rp { grid-area: pts; font-size: .84rem; color: var(--ink-3); }
    .re { grid-area: ev; }
    @media (min-width: 720px) {
      .rh { display: grid; grid-template-columns: 190px 1fr 96px 56px; gap: 14px; padding: 0 14px; font-size: .66rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-3); }
      .rr { grid-template-columns: 190px 1fr 96px 56px; grid-template-areas: 'id doc pts ev'; gap: 14px; align-items: start; }
      .rid { display: grid; gap: 2px; align-content: start; }
      .rp { text-align: right; }
      .re { justify-self: end; }
    }
    .vetoes { display: grid; gap: 8px; }
    .vr { display: grid; grid-template-columns: auto 1fr auto; gap: 8px 12px; align-items: center; padding: 10px 14px; border-radius: var(--r-md); border: 1px solid rgba(229, 112, 90, .28); background: rgba(229, 112, 90, .05); }
    .vid { color: var(--warn); font-size: 1.05rem; font-weight: 700; }
    .vb { display: grid; gap: 2px; min-width: 0; }
    .vb b { color: var(--ink); }
    .vc { font-size: .78rem; color: var(--ink-3); }
    .vcap { font-size: .74rem; font-weight: 700; color: var(--warn); white-space: nowrap; }
    @media (min-width: 720px) { .vr { grid-template-columns: 40px 1fr 160px 22px; } }
    @media (max-width: 719px) { .vr .ev { grid-column: 3; grid-row: 1; } .vcap { grid-column: 2; } }
    .formula { font-size: 1.05rem; color: var(--gold-soft); padding: 14px 16px; border-radius: var(--r-md); background: var(--surface-2); border: 1px solid var(--line); overflow-x: auto; font-family: var(--font-display); font-weight: 600; }
    .bands { list-style: none; display: grid; gap: 8px; padding: 0; }
    .bands li { display: grid; grid-template-columns: 64px 1fr; gap: 6px 12px; align-items: center; }
    @media (min-width: 640px) { .bands li { grid-template-columns: 64px 220px 1fr; } }
    .bands .bar { grid-column: 1 / -1; } @media (min-width: 640px) { .bands .bar { grid-column: auto; } }
    .bmin { color: var(--gold); font-weight: 700; }
    .bl { font-size: 1.05rem; color: var(--ink); }
    .avoid .bmin { color: var(--warn); }
    .ctable { display: grid; gap: 6px; max-width: 560px; }
    .ch, .cr { display: grid; grid-template-columns: 1fr 110px 130px; gap: 10px; padding: 8px 12px; align-items: center; }
    .ch { font-size: .66rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-3); }
    .cr { border-radius: var(--r-sm); background: var(--surface-2); border: 1px solid var(--line-2); font-size: .9rem; }
    .cr .num { text-align: right; color: var(--ink-2); } .cr .strong { color: var(--gold-soft); font-weight: 700; }
    .quote { border-color: rgba(229, 184, 73, .3); }
    .q { font-size: 1.25rem; line-height: 1.45; color: var(--ink); }
    .limits { list-style: none; display: grid; gap: 12px; padding: 0; color: var(--ink-2); line-height: 1.6; max-width: 72ch; }
    .limits li { padding-left: 18px; position: relative; }
    .limits li::before { content: ''; position: absolute; left: 0; top: .62em; width: 6px; height: 6px; border-radius: 50%; background: var(--gold); box-shadow: 0 0 8px var(--gold); }
    .limits b { color: var(--ink); }
    .links { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 44px; padding-top: 28px; border-top: 1px solid var(--line); }
  `],
})
export class MethodPage {
  data = inject(DataV2Service);
  i18n = inject(I18nService);
  readonly t = this.i18n.t;
  readonly P = this.data.params;
  readonly sections = SECTIONS;
  readonly evidence = ['A', 'B', 'C', 'D'];

  readonly ru = computed(() => this.i18n.locale() === 'ru');
  readonly nCuisines = computed(() => new Set(this.data.dishes().flatMap(d => d.cuisine ?? [])).size);
  readonly prototypeDishes = computed(() => this.data.dishes().filter(d => (d as unknown as Loose)['vector_source'] === 'prototype').length);
  readonly efesCount = computed(() => (this.data.drinks() ?? []).filter(d => (d.efes_relation ?? 'none') !== 'none').length);
  readonly hiddenCount = computed(() => (this.data.drinks() ?? []).filter(d => !isGuestVisible(d)).length);

  /** Категории по убыванию, в порядке групп подбора. */
  readonly byCategory = computed(() => {
    const counts = new Map<string, number>();
    for (const d of this.data.drinks() ?? []) counts.set(d.category, (counts.get(d.category) ?? 0) + 1);
    const order = TAB_GROUPS.flatMap(g => g.categories);
    return [...counts.entries()].map(([id, n]) => ({ id, n, l: `v2.cat.${id}` as I18nKey }))
      .sort((a, b) => b.n - a.n || order.indexOf(a.id) - order.indexOf(b.id));
  });
  readonly bySource = computed(() => this.countBy(d => d.vector_source ?? 'category_prior', 'v2.src.'));
  readonly byAbvSource = computed(() => this.countBy(d => d.abv_source ?? 'estimate', 'v2.abvsrc.'));

  readonly rules = computed<RuleRow[]>(() => {
    const P = this.P as unknown as Record<string, Loose>;
    return Object.keys(P).filter(k => /^R\d+$/.test(k)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map(id => {
      const r = P[id];
      return { id, name: `method.rule.${id}` as I18nKey, doc: String((this.data.activeParams() as unknown as { rules_summary?: Record<string, string> }).rules_summary?.[id] ?? r['_doc'] ?? ''), evidence: String(r['evidence'] ?? ''), range: this.range(r), off: r['enabled'] === false };
    });
  });
  /** Действующие правила: R18 (температура восприятия) в параметрах выключено и в счёт не идёт. */
  readonly activeRules = computed(() => this.rules().filter(r => !r.off).length);
  readonly vetoes = computed<VetoRow[]>(() => {
    const V = this.P.vetoes as unknown as Record<string, Loose>;
    const f = (x: unknown) => String(x);
    const cond: Record<string, (v: Loose) => string> = {
      V1: v => `ΔF ≥ ${f(v['dF'])} ∨ (ΔF ≥ ${f(v['dF_combo'])} ∧ ΔW ≥ ${f(v['dW_combo'])})`,
      V2: v => `D.sweet ≥ ${f(v['dish_sweet'])} ∧ B.sweet ≤ ${f(v['drink_sweet'])}`,
      V3: v => `D.heat ≥ ${f(v['heat'])} ∧ ABV ≥ ${f(v['abv'])} % ∧ ¬heat_lover`,
      V4: v => `B.tannin ≥ ${f(v['tannin'])} ∧ D.fish_oil ≥ ${f(v['fish_oil'])}`,
      V5: v => `D.fresh ≥ ${f(v['fresh'])} ∧ ABV ≥ ${f(v['abv'])} %`,
      V6: v => `ΔF ≤ ${f(v['dF'])} ∨ (ΔF ≤ ${f(v['dF_combo'])} ∧ ΔW ≤ ${f(v['dW_combo'])})`,
      V7: v => `non_alcoholic ∧ ABV > ${f(v['max_abv'])} %`,
    };
    return (this.P.vetoes.order ?? Object.keys(cond)).filter(id => V[id]).map(id => {
      const v = V[id];
      return { id, name: `method.veto.${id}` as I18nKey, cond: cond[id]?.(v) ?? '', cap: typeof v['cap'] === 'number' ? v['cap'] as number : null, evidence: String(v['evidence'] ?? 'C') };
    });
  });
  readonly bands = computed(() => [...this.P.bands.list].sort((a, b) => b.min - a.min));
  readonly cal = computed(() => this.data.calibration);
  readonly changedParams = computed(() => Object.keys(this.data.calibrationParams ?? {}).length);
  readonly calibratable = computed(() => ((this.P as unknown as Loose)['calibratable'] as { params?: unknown[] } | undefined)?.params?.length ?? 0);
  readonly cand = computed(() => this.data.calibrationCandidate);
  readonly candMetrics = computed<Metric[]>(() => this.metricsOf(this.cand()?.metrics));
  readonly metrics = computed<Metric[]>(() => this.metricsOf(this.cal()?.metrics));
  private metricsOf(m: NonNullable<DataV2Service['calibration']>['metrics'] | undefined): Metric[] {
    if (!m) return [];
    const pair = (x?: { literature: number[]; calibrated: number[] }, k?: I18nKey): Metric | null =>
      x && k ? { k, lit: this.tuple(x.literature), cal: this.tuple(x.calibrated) } : null;
    const rows = [pair(m.train, 'method.cal.train'), pair(m.cv, 'method.cal.cv'), pair(m.holdout, 'method.cal.holdout')];
    if (m.ordinals?.length) rows.push({ k: 'method.cal.ordinals', lit: null, cal: this.tuple(m.ordinals) });
    return rows.filter((r): r is Metric => !!r);
  }
  readonly policyNote = computed(() => this.ru()
    ? this.P.recommend.policy_note.replace('{window}', String(this.P.recommend.partner_tie_window))
    : this.t('v2.pair.policy', { n: this.P.recommend.partner_tie_window }));

  constructor() { this.data.ensureDrinks().catch(() => { /* счётчики останутся скрытыми */ }); }

  evKey(e: string): I18nKey { return `v2.ev.${e}` as I18nKey; }
  rate(x: [number, number] | null): string {
    if (!x) return '—';
    const [ok, n] = x;
    return n ? `${ok}/${n} · ${Math.round(ok / n * 100)}%` : `${ok}`;
  }
  jump(e: Event, id: string): void {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', `#${id}`);
  }

  private tuple(a: number[] | undefined): [number, number] | null { return a && a.length >= 2 ? [a[0], a[1]] : null; }
  private countBy(key: (d: { vector_source?: string; abv_source?: string }) => string, prefix: string) {
    const counts = new Map<string, number>();
    for (const d of this.data.drinks() ?? []) { const k = key(d); counts.set(k, (counts.get(k) ?? 0) + 1); }
    return [...counts.entries()].map(([id, n]) => ({ id, n, l: `${prefix}${id}` as I18nKey })).sort((a, b) => b.n - a.n);
  }
  private range(r: Loose): string {
    const sign = (x: number) => (x > 0 ? `+${x}` : String(x));
    if (typeof r['min'] === 'number' && typeof r['max'] === 'number') return `${sign(r['min'] as number)} … ${sign(r['max'] as number)}`;
    if (typeof r['points'] === 'number') return `0 / ${sign(r['points'] as number)}`;
    if (typeof r['max_bonus'] === 'number') return `0 / ${sign(r['max_bonus'] as number)}`;
    const parts = ['bitter_pref', 'sweet_pref', 'dna'].map(k => (r[k] as Loose | undefined)?.['max']).filter((x): x is number => typeof x === 'number');
    if (parts.length) { const s = parts.reduce((a, b) => a + b, 0); return `−${s} … +${s}`; }
    return '—';
  }
}

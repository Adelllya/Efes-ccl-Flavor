import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DataService } from '../../core/data.service';
import { SectionHeadComponent } from '../../ui/section.component';
import { DISH_PHOTOS, DISH_PHOTOS_META, DishPhoto, DishPhotoComponent, TRADITIONAL_DRINK_PHOTOS } from '../../ui/dish-photo.component';

interface CreditItem { id: string; name: string; photo: DishPhoto; }
interface CreditGroup { cuisine: string; items: CreditItem[]; }

/** «Источники фото и данных»: все фотографии блюд с автором, лицензией и ссылкой на первоисточник. */
@Component({
  selector: 'ft-credits',
  standalone: true,
  imports: [RouterLink, SectionHeadComponent, DishPhotoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="hero">
      <span class="eyebrow">Источники</span>
      <h1>Источники <span class="grad-text">фото и данных</span></h1>
      <p class="lede mt8">
        Фотографии блюд взяты из свободных источников — Wikimedia Commons и Openverse — и используются только
        под лицензиями CC0, Public domain, CC BY и CC BY-SA. Каждое фото кадрировано и слегка выровнено по цвету,
        чтобы набор смотрелся единым; автор и лицензия указаны под каждым снимком, ссылка ведёт на первоисточник.
        Производные файлы под CC BY-SA распространяются на условиях той же лицензии.
      </p>
      <div class="flex g8 wrap mt16">
        <span class="badge">{{ meta.dishes_with_photo }} блюд с фото</span>
        @for (s of sources(); track s.k) { <span class="badge">{{ s.label }}: {{ s.n }}</span> }
        @for (l of licenses(); track l.k) { <span class="badge badge-info">{{ l.k }}: {{ l.n }}</span> }
      </div>
    </section>

    @for (g of groups(); track g.cuisine) {
      <section class="section">
        <ft-section-head [title]="g.cuisine" [sub]="g.items.length + ' ' + plural(g.items.length)" />
        <div class="grid grid-4">
          @for (it of g.items; track it.id) {
            <article class="card ci">
              <ft-dish-photo [dishId]="it.id" [name]="it.name" variant="square" />
              <div class="ci-b">
                <h4>{{ it.name }}</h4>
                <p class="muted xs mt4">
                  Фото: {{ it.photo.author }} ·
                  <a class="lic" [href]="it.photo.license_url" target="_blank" rel="noopener license">{{ it.photo.license }}</a>
                </p>
                <p class="xs mt4">
                  <a class="src" [href]="it.photo.source_page" target="_blank" rel="noopener">{{ sourceLabel(it.photo) }} ↗</a>
                </p>
              </div>
            </article>
          }
        </div>
      </section>
    }

    @if (drinks().length) {
      <section class="section">
        <ft-section-head title="Традиционные напитки" sub="Кумыс, айран, шубат — фото в пиале для карточек напитков" />
        <div class="grid grid-4">
          @for (it of drinks(); track it.id) {
            <article class="card ci">
              <ft-dish-photo [dishId]="it.id" [name]="it.name" variant="square" />
              <div class="ci-b">
                <h4>{{ it.name }}</h4>
                <p class="muted xs mt4">Фото: {{ it.photo.author }} · <a class="lic" [href]="it.photo.license_url" target="_blank" rel="noopener license">{{ it.photo.license }}</a></p>
                <p class="xs mt4"><a class="src" [href]="it.photo.source_page" target="_blank" rel="noopener">{{ sourceLabel(it.photo) }} ↗</a></p>
              </div>
            </article>
          }
        </div>
      </section>
    }

    @if (missing().length) {
      <section class="section">
        <ft-section-head title="Блюда без фото" sub="Подходящего свободного снимка пока нет — показываем эмодзи" />
        <ul class="missing card card-p">
          @for (m of missing(); track m.id) { <li><b>{{ m.name }}</b> <span class="muted sm">— {{ m.why }}</span></li> }
        </ul>
      </section>
    }

    <section class="section">
      <ft-section-head title="Данные" sub="Откуда берутся сенсорные профили, стили и сочетания" />
      <div class="grid grid-2">
        <div class="card card-p">
          <h3>Сенсорные профили</h3>
          <p class="dim sm mt8">Пирамиды сортов и векторы блюд размечены командой проекта по методике FlavorActiV и литературе по сенсорике (см. <code>docs/research/</code>). Значения ABV/IBU берутся с этикеток и сайтов производителей; где данных нет — честно помечены как оценка.</p>
        </div>
        <div class="card card-p">
          <h3>Стили пива</h3>
          <p class="dim sm mt8">Приоры стилей опираются на <a href="https://www.bjcp.org/" target="_blank" rel="noopener">BJCP Style Guidelines</a>; сочетания — на открытые руководства по гастрономическим парам, перечисленные в <code>docs/research/</code>.</p>
        </div>
        <div class="card card-p">
          <h3>Фотографии</h3>
          <p class="dim sm mt8"><a href="https://commons.wikimedia.org/" target="_blank" rel="noopener">Wikimedia Commons</a> и <a href="https://openverse.org/" target="_blank" rel="noopener">Openverse</a> (WordPress Photo Directory). Пайплайн отбора и обработки: <code>scripts/fetch_dish_photos.py</code>, реестр — <code>data/dish_photos.json</code>, описание — <code>docs/DISH_PHOTOS.md</code>.</p>
        </div>
        <div class="card card-p">
          <h3>Лицензии</h3>
          <p class="dim sm mt8">
            <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noopener">CC0</a> ·
            <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY</a> ·
            <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA</a>.
            Материалы с ограничениями NC/ND, «fair use» и без указанной лицензии не используются.
          </p>
        </div>
      </div>
      <p class="muted sm mt16">Нашли ошибку в подписи или хотите, чтобы фото убрали? Напишите нам — исправим в ближайшей сборке. <a routerLink="/about">О проекте</a></p>
    </section>
  `,
  styles: [`
    .hero { padding: 20px 0 0; } .hero h1 { max-width: 22ch; margin-top: 12px; }
    .ci { overflow: hidden; display: grid; grid-template-rows: auto 1fr; }
    .ci ft-dish-photo { --r-md: 0px; }
    .ci-b { padding: 12px 14px 14px; min-width: 0; }
    .ci-b h4 { font-family: var(--font-display); font-weight: 700; font-size: 1.05rem; line-height: 1.2; }
    .lic { color: var(--gold-soft); text-decoration: none; border-bottom: 1px dotted rgba(229, 184, 73, .45); }
    .lic:hover { border-bottom-style: solid; }
    .src { color: var(--ink-3); text-decoration: none; }
    .src:hover { color: var(--gold-soft); }
    .mt4 { margin-top: 4px; }
    .missing { list-style: none; display: grid; gap: 8px; }
  `],
})
export class CreditsPage {
  private data = inject(DataService);
  readonly meta = DISH_PHOTOS_META;

  private readonly SOURCE_LABEL: Record<string, string> = { commons: 'Wikimedia Commons', openverse: 'Openverse' };

  /** Имя блюда: из реестра фото, иначе из базы блюд v1, иначе id. */
  private nameOf(id: string, p?: DishPhoto): string {
    return p?.name || this.data.dish(id)?.display_name || id;
  }
  private cuisineOf(id: string, p: DishPhoto): string {
    return p.cuisine || this.data.dish(id)?.cuisine_label || 'Другие кухни';
  }

  readonly groups = computed<CreditGroup[]>(() => {
    const map = new Map<string, CreditItem[]>();
    for (const [id, photo] of Object.entries(DISH_PHOTOS)) {
      const c = this.cuisineOf(id, photo);
      if (!map.has(c)) map.set(c, []);
      map.get(c)!.push({ id, name: this.nameOf(id, photo), photo });
    }
    const order = ['Казахская', 'Среднеазиатская', 'Уйгурская', 'Русская', 'Кавказская', 'Итальянская', 'Японская', 'Американская', 'Мексиканская', 'Немецкая'];
    const rank = (c: string) => { const i = order.indexOf(c); return i < 0 ? 99 : i; };
    return [...map.entries()]
      .map(([cuisine, items]) => ({ cuisine, items: items.sort((a, b) => a.name.localeCompare(b.name, 'ru')) }))
      .sort((a, b) => rank(a.cuisine) - rank(b.cuisine) || a.cuisine.localeCompare(b.cuisine, 'ru'));
  });

  readonly drinks = computed<CreditItem[]>(() =>
    Object.entries(TRADITIONAL_DRINK_PHOTOS).map(([id, photo]) => ({ id, name: this.nameOf(id, photo), photo })));

  readonly missing = computed(() =>
    Object.entries(this.meta.no_photo ?? {}).map(([id, why]) => ({ id, name: this.nameOf(id), why })));

  readonly sources = computed(() =>
    Object.entries(this.meta.by_source ?? {}).map(([k, n]) => ({ k, n, label: this.SOURCE_LABEL[k] ?? k })));
  readonly licenses = computed(() =>
    Object.entries(this.meta.by_license ?? {}).map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n));

  sourceLabel(p: DishPhoto): string { return this.SOURCE_LABEL[p.source] ?? p.source; }
  plural(n: number): string {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'блюдо';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'блюда';
    return 'блюд';
  }
}

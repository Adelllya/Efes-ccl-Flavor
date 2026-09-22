import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DataService } from '../../core/data.service';
import { PairingService } from '../../core/pairing.service';
import { API_URL } from '../../core/config';
import { Brand, LAYER_META, Layer, PyramidEntry } from '../../core/models';
import { IconComponent } from '../../ui/icon.component';
import { RadarComponent } from '../../ui/radar.component';
import { MatchCardComponent } from '../../ui/match-card.component';
import { SectionHeadComponent } from '../../ui/section.component';

type Tab = 'pyramid' | 'sandbox' | 'qr';

/** Токен сомелье (FT_ADMIN_TOKEN на сервере) живёт до закрытия вкладки; в приватном режиме sessionStorage может бросать. */
const TOKEN_KEY = 'ft.adminToken';
function readToken(): string { try { return sessionStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; } }
function writeToken(t: string): void { try { sessionStorage.setItem(TOKEN_KEY, t); } catch { /* токен останется только в памяти страницы */ } }

/** Панель сомелье: редактор пирамид с живым пересчётом, песочница движка, генератор QR для столов. */
@Component({
  selector: 'ft-admin',
  standalone: true,
  imports: [RouterLink, FormsModule, IconComponent, RadarComponent, MatchCardComponent, SectionHeadComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex jb as g12 wrap">
      <div><span class="eyebrow">Панель сомелье</span><h1>Пирамиды, движок, <span class="grad-text">QR-столы</span></h1><p class="dim mt8">Правки применяются мгновенно в этом браузере. {{ api ? 'Сохранение в API включено.' : 'API не подключён — экспортируйте JSON для data/brands.json.' }}</p></div>
      <div class="seg">
        <button type="button" [class.on]="tab() === 'pyramid'" (click)="tab.set('pyramid')">Пирамида</button>
        <button type="button" [class.on]="tab() === 'sandbox'" (click)="tab.set('sandbox')">Песочница</button>
        <button type="button" [class.on]="tab() === 'qr'" (click)="tab.set('qr')">QR-столы</button>
      </div>
    </div>

    @switch (tab()) {
      @case ('pyramid') {
        <div class="grid two mt16">
          <div>
            <label class="lbl">Сорт</label>
            <select class="input" [ngModel]="brandId()" (ngModelChange)="brandId.set($event)">
              @for (b of data.brands(); track b.id) { <option [value]="b.id">{{ b.display_name }} · {{ b.pyramid.length }} нот</option> }
            </select>
            @if (brand(); as b) {
              <div class="flex g8 mt12 wrap ac">
                <label class="lbl" style="margin:0">Стиль (приор)</label>
                <select class="input" style="max-width:240px" [ngModel]="b.style_family" (ngModelChange)="patch({ style_family: $event })">
                  @for (f of families(); track f.id) { <option [value]="f.id">{{ f.label }}</option> }
                </select>
                <label class="lbl" style="margin:0">ABV</label>
                <input class="input" style="max-width:100px" type="number" step="0.1" [ngModel]="b.abv" (ngModelChange)="patch({ abv: +$event, abv_estimated: false })" />
              </div>
              @for (l of layers; track l) {
                <div class="layer card card-p mt12" [style.--lc]="meta[l].color">
                  <div class="flex jb ac"><b><span class="dot"></span>{{ meta[l].label }} <span class="muted xs">{{ meta[l].time }}</span></b>
                    <select class="input add" [ngModel]="''" (ngModelChange)="addNote(l, $event)" aria-label="Добавить ноту">
                      <option value="" disabled>+ добавить ноту</option>
                      @for (n of notesFor(l); track n.id) { <option [value]="n.id">{{ n.icon }} {{ n.name }}</option> }
                    </select>
                  </div>
                  @for (p of entries(l); track p.note_id) {
                    <div class="entry">
                      <div class="flex jb ac g8"><span><span>{{ data.note(p.note_id)?.icon }}</span> <b>{{ data.note(p.note_id)?.name }}</b></span><span class="flex ac g8"><b class="amber">{{ p.intensity }}/10</b><button type="button" class="btn btn-icon btn-ghost" (click)="remove(p.note_id)" aria-label="Удалить"><ft-icon name="x" [size]="16" /></button></span></div>
                      <input type="range" class="range" min="1" max="10" [ngModel]="p.intensity" (ngModelChange)="setIntensity(p.note_id, +$event)" />
                      <input class="input sm-in" placeholder="Комментарий сомелье" [ngModel]="p.sommelier_note" (ngModelChange)="setNote(p.note_id, $event)" />
                    </div>
                  } @empty { <div class="muted xs mt8">Слой пуст</div> }
                </div>
              }
              <div class="flex g8 wrap mt12">
                <button type="button" class="btn btn-secondary btn-sm" (click)="exportJson()"><ft-icon name="download" [size]="16" /> Экспорт JSON сорта</button>
                @if (api) { <button type="button" class="btn btn-primary btn-sm" (click)="saveApi()" [disabled]="saving()"><ft-icon name="check" [size]="16" /> {{ saving() ? 'Сохраняю…' : 'Сохранить в API' }}</button> }
                @if (msg()) { <span class="muted sm" style="align-self:center">{{ msg() }}</span> }
              </div>
              @if (api && needToken()) {
                <form class="flex g8 wrap mt8 ac" (ngSubmit)="applyToken()">
                  <input class="input sm-in token-in" type="password" name="ft-admin-token" autocomplete="off" placeholder="Токен сомелье" aria-label="Токен сомелье" [ngModel]="token()" (ngModelChange)="token.set($event)" />
                  <button type="submit" class="btn btn-secondary btn-sm" [disabled]="saving() || !token().trim()">Сохранить с токеном</button>
                </form>
              }
            }
          </div>
          <div>
            @if (profile(); as p) {
              <div class="card card-p sticky">
                <div class="flex jb ac"><b>Живой профиль</b><span class="muted xs">уверенность {{ pct(p.confidence) }}% · интенсивность {{ pct(p.intensity) }}</span></div>
                <ft-radar [vector]="p.vector" />
                <div class="muted xs mb8 mt8">Топ-3 блюда прямо сейчас</div>
                @for (m of top(); track m.dish_id) { <div class="flex jb ac sm" style="padding:6px 0;border-top:1px dashed var(--line)"><span>{{ m.dish.emoji }} {{ m.dish.display_name }}</span><b class="amber">{{ m.score }}</b></div> }
              </div>
            }
          </div>
        </div>
      }
      @case ('sandbox') {
        <ft-section-head eyebrow="Песочница" title="Проверка правила на паре" sub="Выберите блюдо и сорт — полный разбор по 15 правилам" />
        <div class="grid grid-2">
          <div><label class="lbl">Блюдо</label><select class="input" [ngModel]="sbDish()" (ngModelChange)="sbDish.set($event)">@for (d of data.dishes(); track d.id) { <option [value]="d.id">{{ d.emoji }} {{ d.display_name }}</option> }</select></div>
          <div><label class="lbl">Сорт</label><select class="input" [ngModel]="sbBeer()" (ngModelChange)="sbBeer.set($event)">@for (b of data.brands(); track b.id) { <option [value]="b.id">{{ b.display_name }}</option> }</select></div>
        </div>
        @if (sbMatch(); as m) { <div class="mt16"><ft-match [m]="m" [rank]="0" /></div> }
        <div class="card card-p mt16">
          <b>Матрица: {{ data.dish(sbDish())?.display_name }} × все сорта</b>
          <div class="matrix mt8">
            @for (m of sbAll(); track m.beer_id) { <button type="button" class="mrow" (click)="sbBeer.set(m.beer_id)"><span class="ellipsis">{{ m.beer.display_name }}</span><span class="bar thin grow"><i [style.width.%]="m.score"></i></span><b>{{ m.score }}</b><span class="badge badge-type xs" [class]="'badge badge-type ' + m.match_type">{{ m.match_type }}</span></button> }
          </div>
        </div>
      }
      @case ('qr') {
        <ft-section-head eyebrow="HoReCa" title="QR-коды для столов" sub="Гость сканирует — попадает на /qr/ТОКЕН с картой заведения" />
        <div class="flex g8 wrap ac">
          <select class="input" style="max-width:300px" [ngModel]="qrVenue()" (ngModelChange)="qrVenue.set($event)">@for (v of data.venues(); track v.id) { <option [value]="v.id">{{ v.name }} · {{ v.city }}</option> }</select>
          <button type="button" class="btn btn-primary btn-sm" (click)="genQr()"><ft-icon name="qr" [size]="16" /> Сгенерировать</button>
          @if (qrs().length) { <button type="button" class="btn btn-ghost btn-sm no-print" onclick="window.print()"><ft-icon name="download" [size]="16" /> Печать</button> }
        </div>
        <div class="qrs mt16">
          @for (q of qrs(); track q.token) {
            <div class="card qr-card"><div class="qr-svg"><img [src]="q.svg" [alt]="'QR стол ' + q.table" /></div><b>Стол {{ q.table }}</b><span class="muted xs">{{ q.token }}</span><a class="amber xs" [routerLink]="['/qr', q.token]">открыть</a></div>
          }
        </div>
      }
    }
  `,
  styles: [`
    .seg { display: inline-grid; grid-auto-flow: column; gap: 4px; padding: 4px; border-radius: var(--r-md); background: var(--bg-2); }
    .seg button { min-height: 40px; padding: 0 14px; border-radius: 10px; font-weight: 700; font-size: .86rem; color: var(--ink-2); }
    .seg button.on { background: var(--surface); color: var(--amber-800); box-shadow: var(--shadow-1); }
    .two { grid-template-columns: 1fr; }
    @media (min-width: 900px) { .two { grid-template-columns: 1.3fr 1fr; align-items: start; } }
    .lbl { display: block; font-size: .74rem; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--ink-3); margin-bottom: 6px; }
    .layer { border-left: 4px solid var(--lc); }
    .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--lc); margin-right: 6px; }
    .add { max-width: 190px; min-height: 36px; font-size: .84rem; }
    .entry { padding: 10px 0; border-top: 1px dashed var(--line); display: grid; gap: 6px; }
    .sm-in { min-height: 36px; font-size: .86rem; }
    .token-in { max-width: 260px; }
    .sticky { position: sticky; top: calc(var(--header-h) + 12px); }
    .matrix { display: grid; gap: 4px; }
    .mrow { display: grid; grid-template-columns: 150px 1fr 36px 100px; gap: 10px; align-items: center; text-align: left; font-size: .84rem; padding: 6px 8px; border-radius: 8px; }
    .mrow:hover { background: var(--amber-100); }
    .badge.xs { font-size: .62rem; padding: 2px 6px; }
    .qrs { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    @media (min-width: 640px) { .qrs { grid-template-columns: repeat(4, 1fr); } }
    @media (min-width: 1000px) { .qrs { grid-template-columns: repeat(6, 1fr); } }
    .qr-card { padding: 14px; display: grid; justify-items: center; gap: 4px; text-align: center; }
    .qr-svg { width: 110px; height: 110px; }
    .qr-svg img { width: 100%; height: 100%; }
  `],
})
export class AdminPage {
  data = inject(DataService);
  private pairing = inject(PairingService);
  private http = inject(HttpClient);
  readonly api = API_URL;
  readonly layers: Layer[] = ['TOP', 'HEART', 'BASE'];
  readonly meta = LAYER_META;
  tab = signal<Tab>('pyramid');
  brandId = signal(this.data.brands()[2]?.id ?? this.data.brands()[0].id);
  saving = signal(false); msg = signal('');
  token = signal(readToken()); needToken = signal(false);
  sbDish = signal('beshbarmak'); sbBeer = signal('kozel');
  qrVenue = signal(this.data.venues()[0]?.id ?? ''); qrs = signal<{ token: string; table: number; svg: string }[]>([]);

  brand = computed(() => this.data.brand(this.brandId()));
  profile = computed(() => this.data.beerProfileById()[this.brandId()]);
  top = computed(() => this.pairing.forBeer(this.brandId(), {}, 3));
  families = computed(() => Object.entries(this.data.priors().labels).map(([id, label]) => ({ id, label })));
  sbMatch = computed(() => this.pairing.explain(this.sbBeer(), this.sbDish()));
  sbAll = computed(() => this.pairing.forDish(this.sbDish(), {}, { limit: 0, diversify: false }));

  entries(l: Layer): PyramidEntry[] { return (this.brand()?.pyramid ?? []).filter(p => p.layer === l); }
  notesFor(l: Layer) { const used = new Set((this.brand()?.pyramid ?? []).map(p => p.note_id)); return this.data.notes().filter(n => n.category === l && !used.has(n.id)); }
  patch(p: Partial<Brand>): void { this.data.updateBrand(this.brandId(), p); }
  private setPyramid(fn: (p: PyramidEntry[]) => PyramidEntry[]): void { this.patch({ pyramid: fn(this.brand()!.pyramid) }); }
  addNote(l: Layer, noteId: string): void { if (!noteId) return; this.setPyramid(p => [...p, { layer: l, note_id: noteId, intensity: 5, sommelier_note: '' }]); }
  remove(noteId: string): void { this.setPyramid(p => p.filter(x => x.note_id !== noteId)); }
  setIntensity(noteId: string, v: number): void { this.setPyramid(p => p.map(x => (x.note_id === noteId ? { ...x, intensity: v } : x))); }
  setNote(noteId: string, s: string): void { this.setPyramid(p => p.map(x => (x.note_id === noteId ? { ...x, sommelier_note: s } : x))); }
  pct(x: number): number { return Math.round(x * 100); }

  exportJson(): void {
    const b = this.brand()!; const blob = new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${b.id}.json`; a.click(); URL.revokeObjectURL(a.href);
    this.msg.set('JSON скачан — вставьте в data/brands.json');
  }
  saveApi(): void {
    const b = this.brand()!; this.saving.set(true); this.msg.set('');
    this.http.get<any>(`${this.api}/brands/?q=${encodeURIComponent(b.name)}`).subscribe({
      next: res => {
        const row = (res.results || res).find((r: any) => r.slug === b.id); if (!row) { this.saving.set(false); this.msg.set('Сорт не найден в API'); return; }
        const notes = this.data.notes();
        this.http.get<any>(`${this.api}/flavor-notes/?page_size=200`).subscribe(nr => {
          const apiNotes: any[] = nr.results || nr;
          const body = { brand_id: row.id, notes: b.pyramid.map(p => ({ flavor_note_id: apiNotes.find(n => n.slug === p.note_id)?.id, layer: p.layer, intensity: p.intensity, sommelier_note: p.sommelier_note })).filter(n => n.flavor_note_id) };
          this.http.put(`${this.api}/admin/flavor-profiles/`, body, { headers: this.adminHeaders() }).subscribe({ next: () => { this.saving.set(false); this.needToken.set(false); this.msg.set(`Сохранено: ${body.notes.length} нот (${notes.length} в справочнике)`); }, error: (e: HttpErrorResponse) => { this.saving.set(false); this.msg.set(this.authError(e) ?? 'Ошибка сохранения'); } });
        });
      }, error: () => { this.saving.set(false); this.msg.set('API недоступен'); },
    });
  }
  /** Bearer-заголовок для /admin/*; без токена заголовка нет — локальный API в DEBUG пускает и так. */
  private adminHeaders(): Record<string, string> { const t = this.token().trim(); return t ? { Authorization: `Bearer ${t}` } : {}; }
  /** 401 — токена нет, 403 — не подошёл (или сервер закрыт: тогда причина в detail). Показываем поле токена. */
  private authError(e: HttpErrorResponse): string | null {
    if (e.status !== 401 && e.status !== 403) return null;
    this.needToken.set(true);
    return e.status === 401 ? 'Нужен токен сомелье' : (typeof e.error?.detail === 'string' ? e.error.detail : 'Токен сомелье не подошёл');
  }
  applyToken(): void { const t = this.token().trim(); if (!t) return; this.token.set(t); writeToken(t); this.saveApi(); }
  async genQr(): Promise<void> {
    const v = this.data.venueById()[this.qrVenue()]; if (!v) return;
    const QRm: any = await import('qrcode'); const QR = QRm.default ?? QRm; const out = [];
    for (let t = 1; t <= v.tables; t++) { const token = `${v.token_prefix}-${String(t).padStart(2, '0')}`; out.push({ token, table: t, svg: await QR.toDataURL(`${location.origin}/qr/${token}`, { margin: 1, width: 220, color: { dark: '#1E1611', light: '#ffffff' } }) }); }
    this.qrs.set(out);
  }
}

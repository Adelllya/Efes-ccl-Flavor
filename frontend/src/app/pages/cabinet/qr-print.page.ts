import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import QRCode from 'qrcode';
import { SaasService } from '../../core/saas.service';
import { TableRow } from '../../core/saas.models';
import { IconComponent } from '../../ui/icon.component';

interface Card extends TableRow { url: string; png: string; }

/** Печатные стенды на столы: A6-карточки с QR, номером стола и подсказкой гостю. Ctrl+P → PDF. */
@Component({
  selector: 'ft-qr-print',
  standalone: true,
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (saas.session(); as s) {
      <div class="bar no-print">
        <a routerLink="/cabinet" class="btn btn-ghost btn-sm"><ft-icon name="arrow-left" [size]="16" /> В кабинет</a>
        <div class="grow"><b>{{ cards().length }} стендов</b> <span class="muted sm">· формат A6, 4 на лист A4. Печатайте на плотной бумаге 250–300 г.</span></div>
        <button type="button" class="btn btn-primary btn-sm" (click)="print()"><ft-icon name="download" [size]="16" /> Печать / PDF</button>
      </div>
      <div class="sheet">
        @for (c of cards(); track c.id) {
          <div class="qr" [style.--accent]="s.venue.accent || '#F7941D'">
            <div class="top"><span class="vn">{{ s.venue.name }}</span><span class="tn">{{ c.label }}</span></div>
            <p class="cta">Что взять к вашему блюду?</p>
            <p class="sub">Сканируйте — подберём пиво из нашей карты</p>
            @if (c.png) { <img [src]="c.png" alt="QR стола {{ c.number }}" /> } @else { <div class="ph"></div> }
            <div class="tok">{{ c.token }}</div>
            <div class="nfc">📡 или приложите телефон</div>
            <div class="foot">🍺 Flavor Tree · подбор пива к еде</div>
          </div>
        }
      </div>
    } @else {
      <div class="card card-p center"><p>Войдите в кабинет, чтобы напечатать QR.</p><a routerLink="/cabinet" class="btn btn-primary mt12">В кабинет</a></div>
    }
  `,
  styles: [`
    .bar { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
    .sheet { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
    .qr { border: 2px solid var(--accent); border-radius: 18px; padding: 18px; text-align: center; background: #fff; color: #1E1611; display: grid; gap: 6px; justify-items: center; break-inside: avoid; }
    .top { width: 100%; display: flex; justify-content: space-between; align-items: center; font-family: var(--font-display); }
    .vn { font-weight: 800; }
    .tn { background: var(--accent); color: #fff; padding: 4px 10px; border-radius: 999px; font-weight: 800; font-size: .8rem; }
    .cta { font-family: var(--font-display); font-weight: 800; font-size: 1.15rem; margin-top: 6px; }
    .sub { font-size: .8rem; color: #4A3D31; }
    img, .ph { width: 180px; height: 180px; margin: 6px 0; }
    .ph { background: #f3ede2; border-radius: 12px; }
    .tok { font-family: monospace; font-weight: 700; letter-spacing: .1em; color: #8A7A69; }
    .nfc { font-size: .78rem; font-weight: 700; color: var(--accent); }
    .foot { font-size: .7rem; color: #8A7A69; margin-top: 4px; }
    @media print {
      .no-print { display: none !important; }
      :host { display: block; }
      .sheet { grid-template-columns: 1fr 1fr; gap: 8mm; }
      .qr { border-radius: 8mm; page-break-inside: avoid; }
      @page { size: A4; margin: 10mm; }
    }
  `],
})
export class QrPrintPage {
  saas = inject(SaasService);
  readonly cards = signal<Card[]>([]);

  constructor() { this.load(); }

  private async load(): Promise<void> {
    const s = this.saas.session(); if (!s) return;
    const { tables } = await this.saas.tables();
    const cards: Card[] = tables.map(t => ({ ...t, url: `${location.origin}/m/${s.venue.slug}/${t.number}`, png: '' }));
    this.cards.set(cards);
    for (const c of cards) {
      c.png = await QRCode.toDataURL(c.url, { width: 360, margin: 1, color: { dark: '#1E1611', light: '#FFFFFF' }, errorCorrectionLevel: 'M' });
      this.cards.set([...cards]);
    }
  }
  print(): void { window.print(); }
}

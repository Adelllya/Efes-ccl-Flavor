import { Component, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { Redemption, Reward, RewardKind, Venue } from '../../models/flavor-tree.models';
import { FtSelectComponent } from '../../ui/ft-select.component';
import { PanelIconComponent } from './panel-icons';
import { flash, isErrorText } from './panel-shared';

const KIND_OPTIONS: { value: RewardKind; label: string }[] = [
  { value: 'FOOD', label: 'Treat from the kitchen' },
  { value: 'SOFT', label: 'Non-alcoholic drink' },
  { value: 'MERCH', label: 'Souvenir' },
  { value: 'EVENT', label: 'Event' },
];

/** Значение «общая награда платформы» в списке заведений модератора. */
const PLATFORM = '__platform__';

interface RewardForm {
  id: string | null;
  title: string;
  description: string;
  kind: RewardKind;
  cost: number | null;
  stock: number | null;
  is_active: boolean;
  venue: string;
}

const EMPTY: RewardForm = { id: null, title: '', description: '', kind: 'FOOD', cost: 50, stock: null, is_active: true, venue: '' };

/**
 * Вкладка "Награды": на что гость меняет баллы знаний и выдача награды по коду.
 * Алкоголь и скидки на него наградой быть не могут, поэтому типов четыре и все без алкоголя.
 */
@Component({
  selector: 'panel-rewards',
  standalone: true,
  imports: [FormsModule, FtSelectComponent, PanelIconComponent],
  template: `
    <div class="wa-page wa-page-single">
      <div class="an">
        <div class="wa-card rw-use">
          <div class="wa-card-head-text">
            <h3 class="wa-card-title">Redeem a reward by code</h3>
            <p class="wa-card-sub">The guest shows the code from their taste passport. Enter it and hand over the reward</p>
          </div>
          <form class="rw-use-form" (submit)="use($event)">
            <label class="rw-sr" for="rw-code">Guest code</label>
            <input id="rw-code" class="input rw-code" type="text" inputmode="text" autocomplete="off" autocapitalize="characters"
                   maxlength="8" placeholder="Guest code" [ngModel]="code()" (ngModelChange)="code.set(($event || '').toUpperCase())" name="code" />
            <button type="submit" class="btn-amber" [disabled]="using() || code().trim().length < 4">
              <panel-icon name="check" /> {{ using() ? 'Checking...' : 'Redeem' }}
            </button>
          </form>
          @if (useMsg(); as m) {
            <p class="wa-msg" [class.error]="isError(m)" [attr.role]="isError(m) ? 'alert' : 'status'">{{ m }}</p>
          }
        </div>

        <div class="an-grid">
          <div class="wa-card">
            <div class="wa-card-head">
              <div class="wa-card-head-text">
                <h3 class="wa-card-title">Rewards</h3>
                <p class="wa-card-sub">Guests earn points for lessons, quizzes and checking off beers. Purchases don't earn points</p>
              </div>
              <button type="button" class="btn-outline" (click)="create()"><panel-icon name="plus" /> New</button>
            </div>
            @if (loadError(); as err) {
              <div class="wa-loadbar" role="alert">
                <panel-icon name="alert" /><span>{{ err }}</span>
                <button type="button" class="btn-outline" (click)="load()"><panel-icon name="refresh" /> Refresh</button>
              </div>
            } @else if (!loaded()) {
              <p class="wa-muted">Loading...</p>
            } @else {
              <ul class="rw-list">
                @for (r of rewards(); track r.id) {
                  <li>
                    <button type="button" class="rw-row" [class.active]="form().id === r.id" [class.off]="!r.is_active" (click)="edit(r)">
                      <span class="rw-row-body">
                        <b>{{ r.title }}</b>
                        <small>{{ r.kind_display }} · {{ r.venue_name || 'platform-wide reward' }}{{ r.stock !== null ? ' · ' + r.stock + ' left' : '' }}</small>
                      </span>
                      <span class="rw-row-cost">{{ r.cost }} {{ r.cost === 1 ? 'point' : 'points' }}</span>
                      @if (!r.is_active) { <span class="wa-chip">disabled</span> }
                    </button>
                  </li>
                } @empty {
                  <li class="wa-muted">No rewards yet. Add the first one: for example, a treat from the kitchen for 60 points.</li>
                }
              </ul>
            }
          </div>

          <div class="wa-card">
            <h3 class="wa-card-title">{{ form().id ? 'Edit reward' : 'New reward' }}</h3>
            <div class="wa-fields">
              <label class="wa-field wa-field-wide">
                <span class="wa-label">Name</span>
                <input class="input" type="text" maxlength="120" [ngModel]="form().title" (ngModelChange)="patch({ title: $event })"
                       placeholder="For example: a basket of baursaks" />
              </label>
              <label class="wa-field wa-field-wide">
                <span class="wa-label">Description</span>
                <textarea class="input" rows="2" maxlength="300" [ngModel]="form().description" (ngModelChange)="patch({ description: $event })"
                          placeholder="What the guest gets and how it's handed out"></textarea>
              </label>
              <div class="wa-field">
                <span class="wa-label">Type</span>
                <ft-select [options]="kinds" [ngModel]="form().kind" (ngModelChange)="patch({ kind: $event })" ariaLabel="Reward type" />
              </div>
              @if (venueOptions().length > 1) {
                <div class="wa-field">
                  <span class="wa-label">Venue</span>
                  <ft-select [options]="venueOptions()" [ngModel]="form().venue" (ngModelChange)="patch({ venue: $event })" ariaLabel="Venue" />
                </div>
              }
              <label class="wa-field">
                <span class="wa-label">Cost in points</span>
                <input class="input" type="number" inputmode="numeric" min="1" max="100000" [ngModel]="form().cost" (ngModelChange)="patch({ cost: $event })" />
              </label>
              <label class="wa-field">
                <span class="wa-label">Quantity left</span>
                <input class="input" type="number" inputmode="numeric" min="0" max="100000" [ngModel]="form().stock" (ngModelChange)="patch({ stock: $event })"
                       placeholder="Leave empty for unlimited" />
              </label>
              <label class="wa-check wa-field-wide">
                <input type="checkbox" [ngModel]="form().is_active" (ngModelChange)="patch({ is_active: $event })" /> Show to guests
              </label>
            </div>
            <p class="wa-muted">A reward can't be alcohol or a discount on alcohol: advertising law prohibits it.</p>
            <div class="wa-actions">
              <button type="button" class="btn-amber" [disabled]="saving() || !valid()" (click)="save()">
                <panel-icon name="save" /> {{ saving() ? 'Saving...' : 'Save' }}
              </button>
              @if (form().id) {
                <button type="button" class="btn-outline" [disabled]="saving()" (click)="remove()"><panel-icon name="trash" /> Delete</button>
              }
              @if (msg(); as m) {
                <p class="wa-msg" [class.error]="isError(m)" [attr.role]="isError(m) ? 'alert' : 'status'">{{ m }}</p>
              }
            </div>
          </div>
        </div>

        <div class="wa-card">
          <h3 class="wa-card-title">Recent redemptions</h3>
          <ul class="rw-history">
            @for (h of history(); track h.id) {
              <li>
                <span class="rw-history-code">{{ h.code }}</span>
                <span class="rw-history-body"><b>{{ h.title }}</b><small>{{ h.guest }} · {{ h.cost }} {{ h.cost === 1 ? 'point' : 'points' }}</small></span>
                <span class="wa-chip" [class.wa-chip-approved]="h.status === 'USED'" [class.wa-chip-pending]="h.status === 'ISSUED'">{{ h.status_display }}</span>
              </li>
            } @empty { <li class="wa-muted">Guests haven't redeemed any points for rewards yet.</li> }
          </ul>
        </div>
      </div>
    </div>
  `
})
export class PanelRewardsComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  /** Вкладка сейчас на экране: список обменов обновляется при каждом открытии. */
  active = input(false);

  readonly kinds = KIND_OPTIONS;
  readonly isError = isErrorText;

  readonly rewards = signal<Reward[]>([]);
  readonly history = signal<Redemption[]>([]);
  readonly venues = signal<Venue[]>([]);
  readonly loaded = signal(false);
  readonly loadError = signal('');
  readonly form = signal<RewardForm>({ ...EMPTY });
  readonly saving = signal(false);
  readonly msg = signal<string | null>(null);
  readonly code = signal('');
  readonly using = signal(false);
  readonly useMsg = signal<string | null>(null);

  /** Модератор выбирает заведение или общую награду; у администратора заведение одно. */
  readonly venueOptions = computed(() => {
    const list = this.venues().map(v => ({ value: v.slug, label: v.name }));
    return this.auth.role() === 'moderator' ? [{ value: PLATFORM, label: 'Platform-wide reward' }, ...list] : list;
  });

  readonly valid = computed(() => {
    const f = this.form();
    return !!f.title.trim() && Number(f.cost) >= 1 && (f.stock === null || Number(f.stock) >= 0);
  });

  constructor() {
    effect(() => {
      if (this.active()) untracked(() => this.loadHistory());
    }, { allowSignalWrites: true });
  }

  ngOnInit() {
    this.api.getMyVenues().subscribe({
      next: list => {
        this.venues.set(list);
        if (!this.form().venue) this.patch({ venue: this.defaultVenue() });
      },
      error: () => this.venues.set([]),
    });
    this.load();
    this.loadHistory();
  }

  private defaultVenue(): string {
    return this.venues()[0]?.slug ?? (this.auth.role() === 'moderator' ? PLATFORM : '');
  }

  load() {
    this.loadError.set('');
    this.api.getManagedRewards().subscribe({
      next: list => { this.rewards.set(list); this.loaded.set(true); },
      error: err => { this.loaded.set(true); this.loadError.set('Couldn\'t load rewards: ' + AuthService.errorText(err)); },
    });
  }

  loadHistory() {
    this.api.getStaffRedemptions().subscribe({ next: list => this.history.set(list), error: () => undefined });
  }

  patch(part: Partial<RewardForm>) {
    this.form.update(f => ({ ...f, ...part }));
  }

  create() {
    this.form.set({ ...EMPTY, venue: this.defaultVenue() });
    this.msg.set(null);
  }

  edit(r: Reward) {
    this.form.set({
      id: r.id, title: r.title, description: r.description, kind: r.kind, cost: r.cost, stock: r.stock,
      is_active: r.is_active, venue: r.venue ?? PLATFORM,
    });
    this.msg.set(null);
  }

  save() {
    const f = this.form();
    if (!this.valid() || this.saving()) return;
    const stock = f.stock === null || (f.stock as unknown) === '' ? null : Number(f.stock);
    const body: Partial<Reward> = {
      title: f.title.trim(), description: f.description.trim(), kind: f.kind, cost: Number(f.cost), stock, is_active: f.is_active,
    };
    // Администратор заведения шлёт награду без заведения: сервер сам подставит его заведение
    if (this.auth.role() === 'moderator') body.venue = f.venue === PLATFORM || !f.venue ? null : f.venue;
    this.saving.set(true);
    const request = f.id ? this.api.updateReward(f.id, body) : this.api.createReward(body);
    request.subscribe({
      next: saved => {
        this.saving.set(false);
        this.rewards.update(list => f.id ? list.map(r => r.id === saved.id ? saved : r) : [...list, saved].sort((a, b) => a.cost - b.cost));
        this.edit(saved);
        flash(this.msg, 'Saved');
      },
      error: err => {
        this.saving.set(false);
        flash(this.msg, 'Error: ' + AuthService.errorText(err), 6000);
      },
    });
  }

  remove() {
    const id = this.form().id;
    if (!id || this.saving()) return;
    this.saving.set(true);
    this.api.deleteReward(id).subscribe({
      next: () => {
        this.saving.set(false);
        this.rewards.update(list => list.filter(r => r.id !== id));
        this.create();
        flash(this.msg, 'Reward deleted');
      },
      error: err => {
        this.saving.set(false);
        flash(this.msg, 'Error: ' + AuthService.errorText(err), 6000);
      },
    });
  }

  use(event: Event) {
    event.preventDefault();
    const code = this.code().trim();
    if (code.length < 4 || this.using()) return;
    this.using.set(true);
    this.useMsg.set(null);
    this.api.useRedemption(code).subscribe({
      next: res => {
        this.using.set(false);
        this.code.set('');
        this.useMsg.set(`Give the guest: ${res.redemption.title}. Guest: ${res.redemption.guest ?? ''}`);
        this.loadHistory();
      },
      error: err => {
        this.using.set(false);
        this.useMsg.set('Error: ' + (err?.error?.error || AuthService.errorText(err)));
      },
    });
  }
}

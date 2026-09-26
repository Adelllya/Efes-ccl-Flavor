import { Injectable, signal } from '@angular/core';

/** Звук новых заказов включён по умолчанию; выбор хранится на устройстве. */
const SOUND_KEY = 'ft_order_sound';
const BLINK_MS = 1000;

/** Минимальный тип Screen Wake Lock API: в lib.dom TypeScript 5.5 его может не быть. */
interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

function readSound(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== '0';
  } catch {
    return true;
  }
}

/**
 * Как персонал узнаёт о новом заказе: короткий сигнал, вибрация на Android и мигающий заголовок вкладки.
 * Плюс Screen Wake Lock, чтобы планшет на стойке не гас.
 *
 * Браузер пускает звук только после действия человека на странице, поэтому AudioContext
 * создаём при первом касании панели. iOS в фоне звук не сыграет: вкладка с заказами
 * должна быть открыта на экране, для этого и нужен режим «Не гасить экран».
 */
@Injectable({ providedIn: 'root' })
export class OrderAlertService {
  readonly soundOn = signal(readSound());
  /** Браузер уже разрешил звук: до первого касания страницы сигнал не прозвучит. */
  readonly audioReady = signal(false);
  readonly wakeSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  /** Пользователь включил «Не гасить экран». */
  readonly wakeWanted = signal(false);
  /** Браузер действительно держит экран включённым. */
  readonly wakeActive = signal(false);
  readonly wakeError = signal('');

  private audio: AudioContext | null = null;
  private wakeLock: WakeLockSentinelLike | null = null;
  private blinkTimer: ReturnType<typeof setInterval> | null = null;
  private blinkTexts: string[] = [];
  private baseTitle = '';
  private listening = false;

  /** Панель открыта: слушаем первое касание (разблокировать звук) и возврат на вкладку (вернуть Wake Lock). */
  attach(): void {
    if (this.listening) return;
    this.listening = true;
    document.addEventListener('pointerdown', this.onInteract, true);
    document.addEventListener('keydown', this.onInteract, true);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Ушли из панели: гасим мигание, отпускаем экран и снимаем слушатели. */
  detach(): void {
    this.listening = false;
    document.removeEventListener('pointerdown', this.onInteract, true);
    document.removeEventListener('keydown', this.onInteract, true);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.stopBlink();
    this.setWake(false);
  }

  toggleSound(): void {
    const on = !this.soundOn();
    this.soundOn.set(on);
    try {
      localStorage.setItem(SOUND_KEY, on ? '1' : '0');
    } catch {
      // без хранилища выбор живёт до перезагрузки
    }
    if (on) {
      this.unlockAudio();
      this.beep();
    }
  }

  /** Появились новые заказы: count - сколько новых сейчас всего. */
  ring(count: number): void {
    if (this.soundOn()) this.beep();
    try {
      navigator.vibrate?.([200, 100, 200]);
    } catch {
      // вибрации нет, ничего страшного
    }
    this.startBlink(count);
  }

  /** Новых заказов не осталось: заголовок больше не мигает. */
  stopBlink(): void {
    if (this.blinkTimer) {
      clearInterval(this.blinkTimer);
      this.blinkTimer = null;
    }
    // Пока мигали, заголовок мог сменить кто-то другой: тогда его не трогаем
    if (this.blinkTexts.includes(document.title)) document.title = this.baseTitle;
    this.blinkTexts = [];
  }

  toggleWake(): void {
    this.setWake(!this.wakeWanted());
  }

  private setWake(on: boolean): void {
    this.wakeWanted.set(on);
    this.wakeError.set('');
    if (on) {
      this.requestWake();
      return;
    }
    const lock = this.wakeLock;
    this.wakeLock = null;
    this.wakeActive.set(false);
    lock?.release().catch(() => undefined);
  }

  private requestWake(): void {
    const api = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
    if (!api || !this.wakeWanted() || document.visibilityState !== 'visible') return;
    api.request('screen').then(lock => {
      if (!this.wakeWanted()) {
        lock.release().catch(() => undefined);
        return;
      }
      this.wakeLock = lock;
      this.wakeActive.set(true);
      // Браузер снимает блокировку, когда вкладку скрывают; вернём её в onVisibility
      lock.addEventListener('release', () => {
        if (this.wakeLock === lock) {
          this.wakeLock = null;
          this.wakeActive.set(false);
        }
      });
    }).catch(() => {
      this.wakeActive.set(false);
      this.wakeError.set('Браузер не дал держать экран включённым. Проверьте режим энергосбережения.');
    });
  }

  private readonly onVisibility = () => {
    if (document.visibilityState === 'visible' && this.wakeWanted() && !this.wakeLock) this.requestWake();
  };

  private readonly onInteract = () => {
    this.unlockAudio();
    // Человек у экрана и видит список: мигание больше не нужно
    if (document.visibilityState === 'visible') this.stopBlink();
  };

  private startBlink(count: number): void {
    const alert = count > 1 ? `(${count}) Новые заказы` : '(1) Новый заказ';
    if (!this.blinkTimer) this.baseTitle = document.title;
    this.stopTimerOnly();
    this.blinkTexts = [alert, this.baseTitle];
    let on = false;
    const tick = () => {
      on = !on;
      document.title = on ? alert : this.baseTitle;
    };
    tick();
    this.blinkTimer = setInterval(tick, BLINK_MS);
  }

  private stopTimerOnly(): void {
    if (this.blinkTimer) {
      clearInterval(this.blinkTimer);
      this.blinkTimer = null;
    }
  }

  private unlockAudio(): void {
    try {
      if (!this.audio) {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        this.audio = new Ctx();
      }
      const ctx = this.audio;
      if (ctx.state === 'running') this.audioReady.set(true);
      else ctx.resume().then(() => this.audioReady.set(ctx.state === 'running'), () => undefined);
    } catch {
      this.audio = null;
    }
  }

  /** Два коротких тона, как у кухонного звонка. Без файла: генерируем в Web Audio. */
  private beep(): void {
    const ctx = this.audio;
    if (!ctx || ctx.state !== 'running') return;
    try {
      const start = ctx.currentTime + 0.02;
      [880, 1175].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t = start + i * 0.22;
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.2);
      });
    } catch {
      // звук не получился, остаются заголовок и бейдж
    }
  }
}

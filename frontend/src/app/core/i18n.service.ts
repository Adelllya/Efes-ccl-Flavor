import { Injectable, signal } from '@angular/core';
import { TAG_LABELS } from '../engine/pairing-engine';
import { Dict, I18nKey, ru } from './i18n/ru';
import { kk } from './i18n/kk';
import { en } from './i18n/en';
import {
  BRIDGE_RU_PATTERN, BRIDGE_WITH_TAGS, COOKING_LABELS_L10N, CUISINE_LABELS, DISH_AXIS_L10N, DISH_CATEGORIES, DISH_NAMES, FAT_LABELS_L10N,
  L10n, MATCH_LABELS, NOTE_NAMES, REASON_RULE_BY_RU, RULE_NAMES_L10N, RULE_REASONS, STYLE_LABELS, TAG_LABELS_L10N, TASTE_LABELS_L10N,
  VERDICTS, WEIGHT_LABELS_L10N,
} from './i18n/data';

export type Locale = 'ru' | 'kk' | 'en';
export type { I18nKey } from './i18n/ru';
export type I18nParams = Record<string, string | number>;
export type CountKey = 'count.beers' | 'count.dishes';

/** Порядок = порядок кнопок в переключателе. label — на кнопке, name — для скринридера и подсказки. */
export const LOCALES: readonly { id: Locale; label: string; name: string }[] = [
  { id: 'ru', label: 'RU', name: 'Русский' }, { id: 'kk', label: 'ҚАЗ', name: 'Қазақша' }, { id: 'en', label: 'EN', name: 'English' },
];
const KEY = 'ft.locale';
const DICTS: Record<Locale, Dict> = { ru, kk, en };
const isLocale = (x: unknown): x is Locale => x === 'ru' || x === 'kk' || x === 'en';
const TAG_ID_BY_RU: Record<string, string> = Object.fromEntries(Object.entries(TAG_LABELS).map(([id, label]) => [label, id]));
type Table = Record<string, L10n | undefined>;

/**
 * Язык гостевых экранов: ru / kk / en. Словари интерфейса — core/i18n/{ru,kk,en}.ts, переводы подписей данных — core/i18n/data.ts.
 * Реактивность: t() и все помощники читают сигнал locale, поэтому шаблон или computed(), который их вызвал, пересчитается при смене
 * языка сам. Pure-pipe для перевода НЕ делаем — он закэшировал бы строку и не перерисовался. Подробности — docs/I18N.md.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly locale = signal<Locale>(this.detect());

  constructor() { this.apply(this.locale()); }

  set(l: Locale): void { this.locale.set(l); this.apply(l); this.persist(l); }

  /** Стрелочная функция — чтобы компонент мог держать короткий алиас `t = this.i18n.t`. Откат: язык → русский → сам ключ. */
  readonly t = (key: I18nKey, params?: I18nParams): string => {
    const raw: string = DICTS[this.locale()][key] ?? ru[key] ?? key;
    return params ? raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : raw;
  };

  /** «8 сортов»: ru — три формы, en — one/other, kk — одна (после числительного мн. число не ставится). */
  count(n: number, base: CountKey): string {
    const l = this.locale(); const m10 = n % 10, m100 = n % 100;
    const form = l === 'ru'
      ? (m10 === 1 && m100 !== 11 ? 'one' : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? 'few' : 'many')
      : l === 'en' && n === 1 ? 'one' : 'many';
    return this.t(`${base}.${form}` as const, { n });
  }

  // ── подписи данных: ru — как в data/*.json и движке; kk/en — из i18n/data.ts; перевода нет → русский ──
  dishName(d: { id: string; display_name: string }): string { return this.pick(DISH_NAMES, d.id, d.display_name); }
  dishNameById(id: string | null | undefined, ruName: string): string { return id ? this.pick(DISH_NAMES, id, ruName) : ruName; }
  category(ruLabel: string): string { return this.pick(DISH_CATEGORIES, ruLabel, ruLabel); }
  cuisineLabel(d: { id: string; cuisine: string; cuisine_label: string }): string {
    if (d.id === 'custom') return this.locale() === 'ru' ? d.cuisine_label : this.t('pair.custom.cuisine');
    return this.pick(CUISINE_LABELS, d.cuisine, d.cuisine_label);
  }
  tasteLabel(code: string, ruLabel: string): string { return this.pick(TASTE_LABELS_L10N, code, ruLabel); }
  weightLabel(code: string, ruLabel: string): string { return this.pick(WEIGHT_LABELS_L10N, code, ruLabel); }
  fatLabel(code: string, ruLabel: string): string { return this.pick(FAT_LABELS_L10N, code, ruLabel); }
  cookingLabel(code: string, ruLabel: string): string { return this.pick(COOKING_LABELS_L10N, code, ruLabel); }
  styleLabel(b: { style_family: string; style_label: string }): string { return this.pick(STYLE_LABELS, b.style_family, b.style_label); }
  matchLabel(type: string, ruLabel: string): string { return this.pick(MATCH_LABELS, type, ruLabel); }
  verdict(ruLabel: string): string { return this.pick(VERDICTS, ruLabel, ruLabel); }
  dishAxis(axis: string, ruLabel: string): string { return this.pick(DISH_AXIS_L10N, axis, ruLabel); }
  ruleName(rule: string, ruLabel: string): string { return this.pick(RULE_NAMES_L10N, rule, ruLabel); }
  noteName(n: { id: string; name: string }): string { return this.pick(NOTE_NAMES, n.id, n.name); }
  /** Описания блюд пока только русские: на kk/en вместо них короткая строка «категория · кухня». */
  dishBlurb(d: { id: string; category: string; cuisine: string; cuisine_label: string; description: string }): string {
    return this.locale() === 'ru' ? d.description : `${this.category(d.category)} · ${this.cuisineLabel(d)}`;
  }
  /** «0.5 л» из карты заведения: на английском литры и миллилитры пишутся латиницей. */
  volume(v: string): string { return this.locale() === 'en' ? v.replace(/мл/g, 'ml').replace(/л/g, 'L') : v; }

  /** Причина из движка: на ru — его текст, на kk/en — обобщённая фраза по rule id (см. RULE_REASONS), нет шаблона — русский текст. */
  reason(c: { rule: string; points: number; text: string; tags?: string[] }): string {
    const l = this.locale(); if (l === 'ru') return c.text;
    if (c.rule === 'bridge' && c.tags?.length) return BRIDGE_WITH_TAGS[l].replace('{tags}', c.tags.map(id => (TAG_LABELS_L10N as Table)[id]?.[l] ?? id).join(', '));
    const tpl = (RULE_REASONS as Record<string, { pos: L10n; neg?: L10n } | undefined>)[c.rule];
    if (!tpl) return c.text;
    const negative = REASON_RULE_BY_RU[c.text]?.[1] ?? c.points < 0;
    return (negative && tpl.neg ? tpl.neg : tpl.pos)[l];
  }
  /** То же для ответа ИИ-сервера, где есть только русский текст без rule id. Сервер уже перевёл сам → текст не узнаётся и идёт как есть. */
  reasonText(text: string): string {
    const l = this.locale(); if (l === 'ru' || !text) return text;
    const bridge = BRIDGE_RU_PATTERN.exec(text);
    if (bridge) return this.reason({ rule: 'bridge', points: 1, text, tags: bridge[1].split(', ').map(name => TAG_ID_BY_RU[name] ?? name) });
    const known = REASON_RULE_BY_RU[text];
    return known ? this.reason({ rule: known[0], points: 1, text }) : text;
  }

  private pick(table: Record<string, L10n>, key: string, ruText: string): string {
    const l = this.locale();
    return l === 'ru' ? ruText : (table as Table)[key]?.[l] ?? ruText;
  }

  /** ?lang= → localStorage → язык браузера (kk* → kk, en* → en, иначе ru). Язык из ссылки запоминаем: это явный выбор. */
  private detect(): Locale {
    try { const q = new URLSearchParams(location.search).get('lang')?.toLowerCase(); if (isLocale(q)) { this.persist(q); return q; } } catch { /* ignore */ }
    try { const saved = localStorage.getItem(KEY); if (isLocale(saved)) return saved; } catch { /* ignore */ }
    let nav = '';
    try { nav = (navigator.language || '').toLowerCase(); } catch { /* ignore */ }
    return nav.startsWith('kk') ? 'kk' : nav.startsWith('en') ? 'en' : 'ru';
  }
  private persist(l: Locale): void { try { localStorage.setItem(KEY, l); } catch { /* приватный режим */ } }
  private apply(l: Locale): void { document.documentElement.lang = l; }
}

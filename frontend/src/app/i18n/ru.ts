/**
 * Русский интерфейс. Отдельный чанк: main.ts грузит его, только если выбран RU,
 * поэтому английская версия не тянет словарь.
 */
import { DomTranslator, Pattern } from './dom-translator';
import { RU_UI } from './ru-ui.dict';
import { RU_DATA } from './ru-data.dict';
import { registerTranslator } from './translate';

const MONTHS_SHORT: Record<string, string> = {
  Jan: 'янв.', Feb: 'февр.', Mar: 'март', Apr: 'апр.', May: 'май', Jun: 'июнь',
  Jul: 'июль', Aug: 'авг.', Sep: 'сент.', Oct: 'окт.', Nov: 'нояб.', Dec: 'дек.'
};
const MONTHS_GEN: Record<string, string> = {
  Jan: 'января', Feb: 'февраля', Mar: 'марта', Apr: 'апреля', May: 'мая', Jun: 'июня',
  Jul: 'июля', Aug: 'августа', Sep: 'сентября', Oct: 'октября', Nov: 'ноября', Dec: 'декабря'
};

/** Строки с числами и датами, которые не описать шаблоном {0} из словаря. */
const PATTERNS: Pattern[] = [
  // date:'MMM d, yyyy' → «14 октября 2026»
  { re: /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{4})$/, out: m => `${m[2]} ${MONTHS_GEN[m[1]]} ${m[3]}` },
  // date:'MMM yyyy' → «окт. 2026»
  { re: /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/, out: m => `${MONTHS_SHORT[m[1]]} ${m[2]}` },
  // «· since Oct 2026» в профиле
  { re: /^· since (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/, out: m => `· с ${MONTHS_SHORT[m[1]]} ${m[2]}` },
  // «4.9% ABV», «ABV 4.9%»
  { re: /^([\d.,~≈]+)\s?% ABV$/, out: m => `${m[1]}% об.` },
  { re: /^ABV ([\d.,~≈]+)\s?%$/, out: m => `Крепость ${m[1]}%` },
  // «5–8 °C»
  { re: /^Serve at ([\d.,]+)\s?[–-]\s?([\d.,]+)\s?°C$/, out: m => `Подавать при ${m[1]}–${m[2]} °C` },
];

let translator: DomTranslator | undefined;

export function startRu(): void {
  document.documentElement.lang = 'ru';
  const t = new DomTranslator([RU_DATA, RU_UI], PATTERNS);
  translator = t;
  registerTranslator(s => t.translate(s));
  t.start(document.body);
}

export function stopRu(): void {
  registerTranslator(null);
  translator?.stop(document.body);
  translator = undefined;
}

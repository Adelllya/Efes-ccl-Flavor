import type { Locale } from './i18n.service';

/** Кухни блюд v2 (data/dishes_v2.json → cuisine[]) → подписи ru / kk / en. Нет в словаре — id как есть. */
export const CUISINE_V2: Record<string, [string, string, string]> = {
  kazakh: ['Казахская', 'Қазақ асханасы', 'Kazakh'], central_asian: ['Среднеазиатская', 'Орта Азия', 'Central Asian'],
  uyghur: ['Уйгурская', 'Ұйғыр асханасы', 'Uyghur'], russian: ['Русская', 'Орыс асханасы', 'Russian'],
  ukrainian: ['Украинская', 'Украин асханасы', 'Ukrainian'], caucasian: ['Кавказская', 'Кавказ асханасы', 'Caucasian'],
  turkish: ['Турецкая', 'Түрік асханасы', 'Turkish'], tatar: ['Татарская', 'Татар асханасы', 'Tatar'],
  german: ['Немецкая', 'Неміс асханасы', 'German'], bavarian: ['Баварская', 'Бавария', 'Bavarian'],
  austrian: ['Австрийская', 'Австрия', 'Austrian'], czech: ['Чешская', 'Чех асханасы', 'Czech'],
  belgian: ['Бельгийская', 'Бельгия', 'Belgian'], english: ['Английская', 'Ағылшын асханасы', 'English'],
  irish: ['Ирландская', 'Ирландия', 'Irish'], french: ['Французская', 'Француз асханасы', 'French'],
  italian: ['Итальянская', 'Итальян асханасы', 'Italian'], spanish: ['Испанская', 'Испан асханасы', 'Spanish'],
  greek: ['Греческая', 'Грек асханасы', 'Greek'], japanese: ['Японская', 'Жапон асханасы', 'Japanese'],
  chinese: ['Китайская', 'Қытай асханасы', 'Chinese'], korean: ['Корейская', 'Корей асханасы', 'Korean'],
  thai: ['Тайская', 'Тай асханасы', 'Thai'], vietnamese: ['Вьетнамская', 'Вьетнам асханасы', 'Vietnamese'],
  indian: ['Индийская', 'Үнді асханасы', 'Indian'], mexican: ['Мексиканская', 'Мексика асханасы', 'Mexican'],
  american: ['Американская', 'Америка асханасы', 'American'], argentinian: ['Аргентинская', 'Аргентина', 'Argentinian'],
  international: ['Интернациональная', 'Халықаралық', 'International'],
};

const COL: Record<Locale, 0 | 1 | 2> = { ru: 0, kk: 1, en: 2 };

export function cuisineLabel(id: string, locale: Locale): string {
  return CUISINE_V2[id]?.[COL[locale]] ?? id;
}

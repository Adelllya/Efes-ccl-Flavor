/*
   ПОИСК БЛЮДА НА ГЛАВНОЙ

   Жюри и гости пишут как привыкли: «бешбармак», «к шашлыку», «шашлик»,
   «баурсаки», «қуырдақ». Поэтому ищем не по точному названию, а по
   нормализованным словам: без регистра, ё = е, казахские буквы сводятся
   к русским, падежные окончания и одна-две опечатки не мешают.

   Источник блюд - каталог движка v2 (114 блюд с синонимами) и каталог
   сомелье (50 блюд с их парами). Одно и то же блюдо из двух каталогов
   сливаем по названию, чтобы подбор знал и id движка, и пары сомелье.
   */

import { Dish } from '../../models/flavor-tree.models';
import { V2Dish } from '../drinks-v2/v2.models';

/** Выбранное блюдо. Простой объект: его кладём в историю браузера. */
export interface DishPick {
  /** id блюда в движке v2; null - блюдо есть только в каталоге сомелье. */
  v2Id: string | null;
  /** id блюда в каталоге сомелье; null - такого блюда там нет. */
  v1Id: string | null;
  name: string;
  emoji: string;
  /** Короткая подпись в подсказках: категория или кухня. */
  hint: string;
}

/** Найденное блюдо и близкие варианты для подсказок под результатом. */
export interface DishChoice {
  pick: DishPick;
  also: DishPick[];
}

interface SearchKey {
  norm: string;
  tokens: string[];
  isName: boolean;
}

export interface IndexedDish extends DishPick {
  keys: SearchKey[];
}

export interface DishMatch {
  dish: IndexedDish;
  score: number;
}

const KZ_LETTERS: Record<string, string> = {
  'ә': 'а', 'ғ': 'г', 'қ': 'к', 'ң': 'н', 'ө': 'о', 'ұ': 'у', 'ү': 'у', 'һ': 'х', 'і': 'и',
};

/** Слова из запроса, которые не называют блюдо: «что выпить к шашлыку». */
const STOP_WORDS = new Set([
  'к', 'ко', 'с', 'со', 'и', 'в', 'во', 'на', 'для', 'под', 'по', 'из', 'что', 'чем', 'как', 'мне', 'нам',
  'выпить', 'пить', 'запить', 'взять', 'подобрать', 'подбери', 'посоветуй', 'посоветуйте', 'хочу', 'буду',
  'пиво', 'пива', 'пивом', 'напиток', 'напитки', 'блюдо', 'блюду', 'какое', 'какой', 'лучше', 'сегодня',
]);

/**
 * Общие слова, у которых в каталоге несколько подходящих блюд. Первым
 * показываем самое узнаваемое, остальные идут подсказками под результатом.
 */
const PREFERRED: Record<string, string> = {
  'рыба': 'salmon-grilled',
  'торт': 'medovik',
};

/** Нижняя граница совпадения: ниже неё считаем, что блюда в каталоге нет. */
export const MIN_MATCH = 60;

export function normalizeDish(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[әғқңөұүһі]/g, c => KZ_LETTERS[c] ?? c)
    // ё -> е, й -> и и латинские диакритики: одна запись для всех вариантов
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensOf(norm: string, dropStopWords: boolean): string[] {
  const all = norm.split(' ').filter(Boolean);
  return dropStopWords ? all.filter(t => !STOP_WORDS.has(t)) : all;
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** Одно слово с разными окончаниями: «шашлыку» и «шашлык», «пиццу» и «пицца». */
function sameStem(a: string, b: string): boolean {
  if (a === b) return true;
  const n = commonPrefix(a, b);
  const longest = Math.max(a.length, b.length);
  const shortest = Math.min(a.length, b.length);
  // Одна буква окончания: «рыба» и «рыбу», «плов» и «плова»
  if (n >= 3 && n >= longest - 1) return true;
  // Окончание длиннее: «шашлык» и «шашлыками». У короткой основы строже: «бауыр» не «бауырсак»
  return n >= 4 && n >= longest - (shortest >= 6 ? 3 : 2);
}

/** Расстояние Дамерау-Левенштейна с ранним выходом, если уже больше limit. */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    rows.push(new Array(b.length + 1).fill(0));
    rows[i][0] = i;
  }
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, rows[i - 2][j - 2] + 1);
      rows[i][j] = v;
      if (v < best) best = v;
    }
    if (best > limit) return limit + 1;
  }
  return rows[a.length][b.length];
}

/** Сколько опечаток прощаем: в коротком слове одну, в длинном две. */
function typoLimit(word: string): number {
  if (word.length < 4) return 0;
  return word.length >= 7 ? 2 : 1;
}

function nearWord(q: string, k: string): boolean {
  if (sameStem(q, k)) return true;
  const limit = typoLimit(q);
  if (!limit) return false;
  if (editDistance(q, k, limit) <= limit) return true;
  // Опечатка и падежное окончание сразу: «шашлику» и «шашлык»
  return k.length >= 4 && q.length > k.length && editDistance(q.slice(0, k.length + 1), k, limit) <= limit;
}

function keyScore(qNorm: string, qTokens: string[], key: SearchKey): number {
  if (!qNorm) return 0;
  if (qNorm === key.norm) return 100;
  if (qNorm.length >= 3 && key.norm.startsWith(qNorm)) return 90;
  if (qTokens.every(t => key.tokens.includes(t))) return 85;
  if (qTokens.every(t => key.tokens.some(k => sameStem(t, k)))) return 78;
  if (qNorm.length >= 4 && key.norm.includes(qNorm)) return 70;
  const limit = typoLimit(qNorm);
  if (limit && editDistance(qNorm, key.norm, limit) <= limit) return 65;
  if (qTokens.every(t => key.tokens.some(k => nearWord(t, k)))) return 60;
  // Лишнее слово в запросе: «пельмени по-домашнему», «плов праздничный»
  if (qTokens.length >= 2) {
    const hit = qTokens.filter(t => key.tokens.some(k => sameStem(t, k)));
    if (hit.length * 2 >= qTokens.length && hit.some(t => t.length >= 4)) return 58;
  }
  return 0;
}

function makeKey(text: string, isName: boolean): SearchKey | null {
  const norm = normalizeDish(text);
  return norm ? { norm, tokens: tokensOf(norm, false), isName } : null;
}

/**
 * Единый список блюд для поиска: блюда движка v2 и каталога сомелье.
 * Блюдо, которое есть в обоих, получает оба id.
 */
export function buildDishIndex(v1: Dish[], v2: V2Dish[]): IndexedDish[] {
  const v1ByName = new Map<string, Dish>();
  for (const d of v1) v1ByName.set(normalizeDish(d.name), d);
  const used = new Set<string>();
  const out: IndexedDish[] = [];

  for (const d of v2) {
    const names = [d.name, d.display_name ?? ''].filter(Boolean);
    const twin = names.map(n => v1ByName.get(normalizeDish(n))).find(Boolean) ?? null;
    if (twin) used.add(twin.id);
    const keys = [
      ...names.map(n => makeKey(n, true)),
      ...(d.synonyms ?? []).map(s => makeKey(s, false)),
    ].filter((k): k is SearchKey => !!k);
    out.push({
      v2Id: d.id,
      v1Id: twin?.id ?? null,
      name: d.name,
      emoji: d.emoji ?? '',
      hint: d.category ?? '',
      keys,
    });
  }

  for (const d of v1) {
    if (used.has(d.id)) continue;
    const key = makeKey(d.name, true);
    out.push({
      v2Id: null,
      v1Id: d.id,
      name: d.name,
      emoji: '',
      hint: [d.cuisine_display || d.cuisine, d.weight_display || d.weight].filter(Boolean).join(' · '),
      keys: key ? [key] : [],
    });
  }
  return out;
}

/** Блюда по запросу, лучшие первыми. Совпадение по названию весит чуть больше синонима. */
export function searchDishes(index: IndexedDish[], query: string, limit = 6): DishMatch[] {
  const qNorm = normalizeDish(query);
  if (qNorm.length < 2) return [];
  // «пиво» или «что выпить» блюда не называют: пусть откроется мастер
  const qTokens = tokensOf(qNorm, true);
  if (!qTokens.length) return [];
  const q = qTokens.join(' ');
  const preferred = qTokens.length === 1
    ? Object.entries(PREFERRED).find(([word]) => sameStem(qTokens[0], word))?.[1]
    : undefined;

  const matches: DishMatch[] = [];
  for (const dish of index) {
    if (preferred && dish.v2Id === preferred) { matches.push({ dish, score: 150 }); continue; }
    let best = 0;
    for (const key of dish.keys) {
      const s = keyScore(q, qTokens, key);
      if (s) best = Math.max(best, s + (key.isName ? 2 : 0));
    }
    if (best < MIN_MATCH) continue;
    // Блюдо с id движка даёт ответ из того же расчёта, что вкладка «К блюду»
    if (dish.v2Id) best += 1;
    matches.push({ dish, score: best });
  }
  return matches
    .sort((a, b) => b.score - a.score || a.dish.name.length - b.dish.name.length)
    .slice(0, limit);
}

/** Простой объект без ключей поиска: его можно хранить в истории браузера. */
export function toPick(d: DishPick): DishPick {
  return { v2Id: d.v2Id, v1Id: d.v1Id, name: d.name, emoji: d.emoji, hint: d.hint };
}

/**
 * Блюдо для запроса и ещё несколько близких вариантов: на «торт» или
 * «плов» в каталоге есть не одно блюдо, их покажем подсказками.
 */
export function resolveDish(index: IndexedDish[], query: string): DishChoice | null {
  const [first, ...rest] = searchDishes(index, query, 5);
  if (!first) return null;
  const also = rest.filter(m => m.score >= 75).slice(0, 4).map(m => toPick(m.dish));
  return { pick: toPick(first.dish), also };
}

/** Блюдо по названию из экспресс-сценария или ссылки. */
export function pickByName(index: IndexedDish[], name: string): DishPick | null {
  const norm = normalizeDish(name);
  const exact = index.find(d => d.keys.some(k => k.isName && k.norm === norm));
  if (exact) return toPick(exact);
  return resolveDish(index, name)?.pick ?? null;
}

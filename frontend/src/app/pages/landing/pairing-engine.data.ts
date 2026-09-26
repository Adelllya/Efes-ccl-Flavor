/*
   МАСТЕР ПОДБОРА ПО БЛЮДУ - данные шагов и алгоритм подбора

   Пользователь не обязан знать своё блюдо по названию. Он отвечает на
   четыре вопроса - категория, способ приготовления, главный вкус и
   сытность - и по этим ответам мы собираем профиль блюда, а затем
   подбираем к нему сорт.

   Подбор двухслойный:
   1. Если блюдо известно (dishId), первыми идут пары, которые сомелье
      написал именно для него (своя 3/5 уступает только расчётным 5/5).
      Иначе берём пары блюд, совпавших со всеми ответами мастера, и
      честно подписываем, что блюдо похожее.
   2. Остальные сорта считаем по правилам сочетания: вес к весу, горечь
      против жира, солод против остроты.

   Для блюда из каталога главная сначала спрашивает движок v2
   (engine-picks.ts), а этот расчёт остаётся запасным, если сервер
   подбора не ответил.
   */

import { Brand, CuisineType, Dish, FoodPairing, PairingType, TasteType, WeightType, FatType, CookingMethod } from '../../models/flavor-tree.models';

/* Варианты ответов */

export interface WizardOption<T extends string = string> {
  id: T;
  emoji: string;
  label: string;
  /** Короткая подсказка под названием - снимает сомнения при выборе. */
  hint?: string;
}

export type CategoryId =
  | 'MEAT' | 'SALAD' | 'SOUP' | 'ASIAN' | 'SEAFOOD'
  | 'PIZZA' | 'STREET' | 'SIDES' | 'DESSERT' | 'SNACK';

export const CATEGORIES: WizardOption<CategoryId>[] = [
  { id: 'MEAT',    emoji: '🥩', label: 'Мясо',                 hint: 'Стейк, шашлык, рёбра' },
  { id: 'SALAD',   emoji: '🥗', label: 'Салаты',               hint: 'Овощи и зелень' },
  { id: 'SOUP',    emoji: '🍲', label: 'Супы / Рагу',          hint: 'Горячее в тарелке' },
  { id: 'ASIAN',   emoji: '🥢', label: 'Азиатское',            hint: 'Вок, лапша, карри' },
  { id: 'SEAFOOD', emoji: '🐟', label: 'Рыба / Морепродукты',  hint: 'Суши, креветки, рыба' },
  { id: 'PIZZA',   emoji: '🍕', label: 'Пицца / Паста',        hint: 'Тесто, сыр, соус' },
  { id: 'STREET',  emoji: '🌮', label: 'Бургеры / Стритфуд',   hint: 'Бургер, тако, шаурма' },
  { id: 'SIDES',   emoji: '🥔', label: 'Гарниры / Закуски',    hint: 'Картофель, овощи' },
  { id: 'DESSERT', emoji: '🍰', label: 'Десерты',              hint: 'Сладкое к столу' },
  { id: 'SNACK',   emoji: '🧀', label: 'Снеки / Тапас',        hint: 'Сыр, орехи, чипсы' },
];

export const COOKING: WizardOption<CookingMethod>[] = [
  { id: 'GRILLED',   emoji: '🔥', label: 'Гриль / мангал', hint: 'На углях, с корочкой' },
  { id: 'FRIED',     emoji: '🍳', label: 'Жареное',        hint: 'На сковороде, во фритюре' },
  { id: 'BAKED',     emoji: '🥧', label: 'Запечённое',     hint: 'Духовка, тандыр' },
  { id: 'CURED',     emoji: '🥓', label: 'Копчёное',       hint: 'Копчение, вяление' },
  { id: 'BOILED',    emoji: '🍜', label: 'Варёное',        hint: 'В бульоне, отварное' },
  { id: 'STEAMED',   emoji: '♨️', label: 'На пару',        hint: 'Манты, дим-самы' },
  { id: 'RAW',       emoji: '🍣', label: 'Сырое',          hint: 'Суши, тартар, карпаччо' },
  { id: 'FERMENTED', emoji: '🥬', label: 'Ферментация',    hint: 'Квашеное, маринованное' },
];

export const TASTES: WizardOption<TasteType>[] = [
  { id: 'UMAMI', emoji: '🍄', label: 'Мясное · умами', hint: 'Насыщенный бульонный вкус' },
  { id: 'SALTY', emoji: '🧂', label: 'Солёное',        hint: 'Соль на первом плане' },
  { id: 'SPICY', emoji: '🌶️', label: 'Острое',         hint: 'Перец, жгучесть' },
  { id: 'SWEET', emoji: '🍯', label: 'Сладкое',        hint: 'Сахар, мёд, глазурь' },
  { id: 'SOUR',  emoji: '🍋', label: 'Кислое',         hint: 'Лимон, уксус, маринад' },
  { id: 'BITTER', emoji: '🌿', label: 'Горькое',       hint: 'Руккола, грейпфрут, какао' },
  { id: 'MIXED', emoji: '🎭', label: 'Всего понемногу', hint: 'Сложный сборный вкус' },
];

export const WEIGHTS: WizardOption<WeightType>[] = [
  { id: 'LIGHT',  emoji: '🪶', label: 'Лёгкое',  hint: 'Съедается незаметно' },
  { id: 'MEDIUM', emoji: '⚖️', label: 'Среднее', hint: 'Обычная порция' },
  { id: 'HEAVY',  emoji: '🪨', label: 'Тяжёлое', hint: 'Сытное, после него тянет отдохнуть' },
];

export const FATS: WizardOption<FatType>[] = [
  { id: 'LOW',    emoji: '', label: 'Постное' },
  { id: 'MEDIUM', emoji: '', label: 'Умеренно жирное' },
  { id: 'HIGH',   emoji: '', label: 'Жирное' },
];

/** Ответы пользователя. Любой шаг можно пропустить - тогда поле пустое. */
export interface DishProfile {
  category: CategoryId | null;
  cooking: CookingMethod | null;
  taste: TasteType | null;
  weight: WeightType | null;
  fat: FatType | null;
  /** Что человек вписал руками, если не нашёл свой вариант. */
  freeText: string;
  /** Блюдо из каталога сомелье, если человек назвал его точно: тогда пары сомелье берём только его. */
  dishId?: string | null;
}

export const emptyProfile = (): DishProfile => ({
  category: null, cooking: null, taste: null, weight: null, fat: null, freeText: '',
});

/** Человеческое название блюда по ответам - для заголовка результата. */
export function profileTitle(p: DishProfile): string {
  if (p.freeText.trim()) return p.freeText.trim();
  const parts: string[] = [];
  if (p.cooking) parts.push(COOKING.find(c => c.id === p.cooking)!.label.toLowerCase());
  if (p.category) parts.push(CATEGORIES.find(c => c.id === p.category)!.label.toLowerCase());
  return parts.length ? parts.join(' · ') : 'ваше блюдо';
}

/* Профиль сорта */

/** Пиво в цифрах 0-10. Из этих пяти чисел и складывается совместимость. */
export interface BeerProfile {
  body: number;        // плотность тела
  bitterness: number;  // хмелевая горечь
  freshness: number;   // свежесть и сухость финиша
  sweetness: number;   // солодовая и карамельная сладость
  roast: number;       // обжарка, дымность, тёмный солод
  strength: number;    // крепость
}

/**
 * Стили идут от частного к общему: первое совпадение задаёт основу.
 * Список открытый - новый стиль в каталоге просто попадёт в «ale» или
 * «lager», а пирамида и крепость доведут профиль до нужного.
 */
const STYLE_RULES: { test: RegExp; base: BeerProfile }[] = [
  { test: /imperial|стаут|stout|porter|портер/i,        base: { body: 9, bitterness: 6, freshness: 2, sweetness: 6, roast: 9, strength: 7 } },
  { test: /ipa|ипа|pale ale|пэйл/i,                      base: { body: 5, bitterness: 9, freshness: 7, sweetness: 3, roast: 1, strength: 6 } },
  { test: /wheat|weiss|weizen|witbier|пшенич|белое/i,    base: { body: 5, bitterness: 2, freshness: 8, sweetness: 5, roast: 0, strength: 4 } },
  { test: /sour|gose|lambic|кисл/i,                      base: { body: 3, bitterness: 2, freshness: 9, sweetness: 3, roast: 0, strength: 4 } },
  { test: /rice|рисов/i,                                 base: { body: 2, bitterness: 2, freshness: 8, sweetness: 3, roast: 0, strength: 4 } },
  { test: /radler|shandy|безалког|non-?alc|0[.,]0/i,     base: { body: 2, bitterness: 1, freshness: 9, sweetness: 5, roast: 0, strength: 0 } },
  { test: /bock|doppel|dunkel|amber|red|тёмн|темн/i,     base: { body: 7, bitterness: 3, freshness: 3, sweetness: 7, roast: 5, strength: 7 } },
  { test: /strong|крепк/i,                               base: { body: 8, bitterness: 5, freshness: 3, sweetness: 5, roast: 3, strength: 9 } },
  { test: /pilsner|pils|пильзн|пилзн/i,                  base: { body: 4, bitterness: 7, freshness: 8, sweetness: 2, roast: 0, strength: 5 } },
  { test: /czech|чешск/i,                                base: { body: 6, bitterness: 5, freshness: 5, sweetness: 6, roast: 1, strength: 5 } },
  { test: /draft|разливн|бочков/i,                       base: { body: 4, bitterness: 3, freshness: 7, sweetness: 4, roast: 0, strength: 4 } },
  { test: /lager|лагер/i,                                base: { body: 5, bitterness: 4, freshness: 6, sweetness: 4, roast: 1, strength: 5 } },
  { test: /ale|эль/i,                                    base: { body: 6, bitterness: 5, freshness: 5, sweetness: 5, roast: 2, strength: 6 } },
];

const NEUTRAL: BeerProfile = { body: 5, bitterness: 4, freshness: 5, sweetness: 4, roast: 1, strength: 5 };

const clamp10 = (n: number) => Math.max(0, Math.min(10, n));

/** По каким словам в ноте видно, за какую характеристику она отвечает. */
const NOTE_WEIGHTS: { test: RegExp; field: keyof BeerProfile; k: number }[] = [
  { test: /горч|горек|горьк|bitter/i,            field: 'bitterness', k: 1.0 },
  { test: /хмел|hop/i,                            field: 'bitterness', k: 0.6 },
  { test: /солод|плотн|тело|malt|body/i,          field: 'body',       k: 1.0 },
  { test: /карамел|мёд|мед|тоффи|caramel|honey/i, field: 'sweetness',  k: 1.0 },
  { test: /жжён|жжен|обжар|дым|кофе|шокол|roast/i, field: 'roast',     k: 1.0 },
  { test: /свеж|сух|чист|цитрус|лимон|fresh|crisp|citrus/i, field: 'freshness', k: 1.0 },
  { test: /рисов|лёгк|легк|воздуш|rice/i,         field: 'freshness',  k: 0.6 },
];

/**
 * Профиль сорта: основа от стиля, поправка от крепости, уточнение - от
 * вкусовой пирамиды, если сомелье её уже заполнил.
 */
export function beerProfile(brand: Brand): BeerProfile {
  const style = `${brand.style ?? ''} ${brand.name ?? ''} ${brand.density ?? ''}`;
  const rule = STYLE_RULES.find(r => r.test.test(style));
  const p: BeerProfile = { ...(rule ? rule.base : NEUTRAL) };

  // Крепость - самый надёжный признак тела: он есть почти у каждого сорта.
  if (typeof brand.abv === 'number' && brand.abv > 0) {
    p.strength = clamp10((brand.abv - 2.5) * 1.6);
    p.body = clamp10(p.body * 0.65 + p.strength * 0.35);
  }

  // Пирамида: интенсивность ноты 1-10 подтягивает свою характеристику.
  const layers = brand.pyramid ? [...brand.pyramid.top, ...brand.pyramid.heart, ...brand.pyramid.base] : [];
  for (const n of layers) {
    const text = `${n.name} ${n.technical_term ?? ''} ${n.description ?? ''}`;
    for (const w of NOTE_WEIGHTS) {
      if (w.test.test(text)) p[w.field] = clamp10(p[w.field] * 0.55 + n.intensity * w.k * 0.45 + 1.2);
    }
  }

  return p;
}

/* Правила подбора */

interface Verdict {
  score: number;              // 0-100
  type: PairingType;
  reasons: { weight: number; text: string }[];
}

/** Словами о плотности тела - для подписи под шкалой. */
export function bodyLabel(body: number): string {
  if (body <= 3.5) return 'лёгкое';
  if (body <= 6.5) return 'среднее';
  return 'плотное';
}

/** Ключевые слова категории - по ним ищем похожие блюда в базе. */
const CATEGORY_MATCH: Record<CategoryId, { words: RegExp; cuisines?: CuisineType[] }> = {
  MEAT:    { words: /мяс|стейк|шашлык|рёбр|ребр|казы|куырдак|шницел|бешбармак|колбас|бекон/i },
  SALAD:   { words: /салат|овощ|зелен|зелён/i },
  SOUP:    { words: /суп|рагу|бульон|сорпа|лапша|том ям|шурпа/i },
  ASIAN:   { words: /азиат|вок|лапша|карри|димсам|дим-сам|темпура|рамен/i, cuisines: ['JAPANESE'] },
  SEAFOOD: { words: /рыб|морепрод|суши|креветк|лосос|тунец|мидии|краб/i },
  PIZZA:   { words: /пицц|паст|спагетт|лазан|тест|фокачч/i, cuisines: ['ITALIAN'] },
  STREET:  { words: /бургер|тако|шаурм|хот-?дог|сэндвич|стритфуд|самса|донер/i },
  SIDES:   { words: /гарнир|картоф|фри|овощ|рис|пюре|закуск/i },
  DESSERT: { words: /десерт|торт|пирож|шокол|мороже|чизкейк|тирамису|сладк/i },
  SNACK:   { words: /снек|тапас|сыр|орех|чипс|брецел|крендел|сухар/i },
};

/** Насколько блюдо из базы похоже на ответы пользователя: 0-1. */
function dishAffinity(dish: Dish, p: DishProfile): number {
  let hits = 0;
  let asked = 0;

  if (p.category) {
    asked++;
    const m = CATEGORY_MATCH[p.category];
    const text = `${dish.name} ${dish.category ?? ''} ${dish.description ?? ''}`;
    if (m.words.test(text) || m.cuisines?.includes(dish.cuisine)) hits++;
  }
  if (p.cooking) { asked++; if (dish.cooking_method === p.cooking) hits++; }
  if (p.taste)   { asked++; if (dish.dominant_taste === p.taste) hits++; }
  if (p.weight)  { asked++; if (dish.weight === p.weight) hits++; }
  if (p.fat)     { asked++; if (dish.fat_level === p.fat) hits++; }

  if (!asked) return 0;
  return hits / asked;
}

const WEIGHT_TARGET: Record<WeightType, number> = { LIGHT: 3, MEDIUM: 5.5, HEAVY: 8 };
const FAT_LOAD: Record<FatType, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

/**
 * Совместимость сорта с профилем блюда.
 * Каждое правило даёт баллы и фразу-объяснение. В карточке показываем
 * одну-две самые весомые фразы, чтобы ответ читался, а не считался.
 */
export function scoreBeer(brand: Brand, p: DishProfile): Verdict {
  const b = beerProfile(brand);
  const reasons: { weight: number; text: string }[] = [];
  let score = 50;
  let type: PairingType = 'COMPLEMENT';
  let typeWeight = 0;

  const setType = (t: PairingType, w: number) => { if (w > typeWeight) { type = t; typeWeight = w; } };

  // 1. Вес к весу - базовое правило сочетания и самый заметный ответ
  // мастера, поэтому вклад у него больше, чем у остальных правил.
  if (p.weight) {
    const target = WEIGHT_TARGET[p.weight];
    const gap = Math.abs(b.body - target);
    score += (2.5 - gap) * 9;

    if (gap <= 1.5 && p.weight === 'HEAVY') {
      reasons.push({ weight: 9, text: 'Плотное тело сорта держит вес сытного блюда и не теряется рядом с ним' });
      setType('COMPLEMENT', 5);
    } else if (gap <= 1.5 && p.weight === 'LIGHT') {
      reasons.push({ weight: 9, text: 'Лёгкое тело не перебивает деликатный вкус - блюдо остаётся главным' });
      setType('COMPLEMENT', 5);
    } else if (gap <= 1.5) {
      reasons.push({ weight: 7, text: 'Тело сорта совпадает по весу с блюдом - ни один не перетягивает внимание' });
      setType('COMPLEMENT', 4);
    } else if (gap > 3.5) {
      reasons.push({ weight: 2, text: p.weight === 'HEAVY'
        ? 'Сорт легче блюда: он освежит, но не составит ему компанию по плотности'
        : 'Сорт плотнее блюда - держите его на второй глоток, после еды' });
    }
  }

  // 2. Жир и жарка - их снимают горечь и карбонизация.
  const fatLoad = (p.fat ? FAT_LOAD[p.fat] : 0)
    + (p.cooking === 'FRIED' ? 2 : 0)
    + (p.cooking === 'GRILLED' ? 1 : 0)
    + (p.category === 'STREET' || p.category === 'PIZZA' ? 1 : 0);

  if (fatLoad >= 2) {
    const cleansing = (b.bitterness + b.freshness) / 2;
    score += (cleansing - 4) * 3.2 * Math.min(fatLoad, 4) / 2;
    if (cleansing >= 6) {
      reasons.push({ weight: 10, text: 'Горчинка и живая карбонизация смывают жир и обновляют вкус перед каждым новым куском' });
      setType('CLEANSE', 6);
    }
  }

  // 3. Острое. Горечь и спирт усиливают жжение, солод и холод - гасят.
  if (p.taste === 'SPICY') {
    score -= b.bitterness * 2.2 + b.strength * 1.8;
    score += b.sweetness * 2.4 + b.freshness * 2.0;
    if (b.bitterness <= 5 && b.strength <= 6) {
      reasons.push({ weight: 10, text: 'Мягкий солод и низкая горечь гасят остроту - хмель и крепость её бы только разогнали' });
      setType('CONTRAST', 7);
    } else {
      reasons.push({ weight: 3, text: 'Горечь и крепость сорта подчеркнут жгучесть - берите только если любите поострее' });
    }
  }

  // 4. Сладкое: десерту нужен солод, иначе пиво покажется пустым и кислым.
  if (p.taste === 'SWEET' || p.category === 'DESSERT') {
    score += (b.sweetness - 4) * 3.6 + (b.roast - 2) * 2.2 - Math.max(0, b.bitterness - 5) * 2.4;
    if (b.sweetness >= 5 || b.roast >= 4) {
      reasons.push({ weight: 9, text: 'Карамельный и жжёный солод перекликаются со сладостью десерта, не споря с ней' });
      setType('COMPLEMENT', 6);
    }
  }

  // 5. Мясо, гриль и копчение: у корочки и тёмного солода общая нота.
  if (p.taste === 'UMAMI' || p.category === 'MEAT' || p.cooking === 'GRILLED' || p.cooking === 'CURED') {
    score += (b.body - 4) * 2.4 + (b.roast - 1) * 2.0 + (b.sweetness - 3) * 1.4;
    if (b.roast >= 3 || b.sweetness >= 5) {
      reasons.push({ weight: 8, text: 'Поджаренный солод повторяет карамельную корочку с огня - вкусы сходятся в одной ноте' });
      setType('BRIDGE', 6);
    }
  }

  // 6. Сырое, на пару, салаты, рыба: главное - не перебить.
  if (p.cooking === 'RAW' || p.cooking === 'STEAMED' || p.category === 'SALAD' || p.category === 'SEAFOOD') {
    score += (b.freshness - 4) * 3.4 - Math.max(0, b.body - 5) * 2.6 - Math.max(0, b.roast - 2) * 2.2;
    if (b.freshness >= 6 && b.body <= 5) {
      reasons.push({ weight: 9, text: 'Чистое сухое тело не забивает деликатный вкус и освежает между кусочками' });
      setType('COMPLEMENT', 5);
    }
  }

  // 7. Солёное: сухой финиш снимает соль и возвращает аппетит.
  if (p.taste === 'SALTY' || p.category === 'SNACK') {
    score += (b.freshness - 4) * 2.6 + (b.bitterness - 3) * 1.8;
    if (b.freshness >= 6) {
      reasons.push({ weight: 8, text: 'Сухой финиш смывает соль и снова открывает аппетит - классика барной закуски' });
      setType('CLEANSE', 5);
    }
  }

  // 8. Кислое и ферментация: острые кислоты не дружат с грубой горечью.
  if (p.taste === 'SOUR' || p.cooking === 'FERMENTED') {
    score += (b.freshness - 4) * 2.8 - Math.max(0, b.bitterness - 6) * 2.4;
    if (b.freshness >= 6 && b.bitterness <= 6) {
      reasons.push({ weight: 7, text: 'Свежесть сорта подхватывает кислинку блюда, а мягкая горечь не даёт ей стать резкой' });
      setType('BRIDGE', 4);
    }
  }

  // 9. Горькое блюдо: две горечи складываются и глушат друг друга.
  if (p.taste === 'BITTER') {
    score -= Math.max(0, b.bitterness - 4) * 2.8;
    score += (b.sweetness - 3) * 2.4;
    if (b.bitterness <= 5) {
      reasons.push({ weight: 7, text: 'Низкая горечь сорта уравновешивает горчинку блюда, а не удваивает её' });
      setType('CONTRAST', 5);
    }
  }

  // 10. Суп: жидкое к жидкому - нужен сорт с характером, иначе он пропадёт.
  if (p.category === 'SOUP') {
    score += (b.bitterness - 3) * 1.8 + (b.freshness - 4) * 1.6;
    if (b.bitterness >= 5) {
      reasons.push({ weight: 6, text: 'Выраженная горчинка слышна даже после ложки горячего бульона' });
      setType('CONTRAST', 4);
    }
  }

  // Ничего не сработало - скажем честно, на чём держится совет.
  if (!reasons.length) {
    reasons.push({ weight: 1, text: 'Универсальный сбалансированный сорт: не спорит с блюдом и подойдёт как нейтральная пара' });
  }

  return { score: Math.max(0, Math.min(100, score)), type, reasons };
}

/* Итоговая рекомендация */

export interface Recommendation {
  brand: Brand;
  /** Плотность тела сорта 0-10 - показываем рядом с весом блюда. */
  body: number;
  /** Какое тело нужно блюду по ответу о сытности; null - не спрашивали. */
  targetBody: number | null;
  /** 1-5, как в парах сомелье. */
  rating: number;
  type: PairingType;
  /** Главное объяснение - фраза сомелье, если она есть, иначе расчёт. */
  explanation: string;
  /** Дополнительная фраза, если правил сработало несколько. */
  extra?: string;
  /** true - оценку поставил человек, а не алгоритм. */
  bySommelier: boolean;
  /** Блюдо из базы, на котором основан совет сомелье. */
  basedOn?: string;
}

const round5 = (score: number) => Math.max(1, Math.min(5, Math.round(score / 20)));

/** С этой крепости сорт считаем крепким (Карагандинское Крепкое 6,5 %, Хмельной Лось 7,3 %). */
export const STRONG_ABV = 6.5;
/** В пределах стольких баллов первым ставим сорт обычной крепости, а не крепкий. */
export const STRONG_WINDOW = 5;

/**
 * Первое место: если лучший сорт крепкий, а сорт обычной крепости отстаёт
 * не больше чем на window баллов, первым идёт обычный. Остальной порядок
 * и баллы не меняются, крепкий сорт остаётся в списке сразу за ним.
 */
export function softenStrong<T>(sorted: T[], score: (x: T) => number, strong: (x: T) => boolean,
                                window = STRONG_WINDOW): T[] {
  const out = [...sorted];
  if (!out.length || !strong(out[0])) return out;
  const top = score(out[0]);
  const mild = out.findIndex(x => !strong(x) && score(x) >= top - window);
  if (mild > 0) out.unshift(...out.splice(mild, 1));
  return out;
}

function strongBrand(brand: Brand): boolean {
  if (typeof brand.abv === 'number') return brand.abv >= STRONG_ABV;
  return /strong|крепк/i.test(`${brand.style ?? ''} ${brand.name ?? ''}`);
}

/**
 * Блюда, пары которых можно показать как «по похожему блюду»: совпали
 * все ответы, и ответов не меньше трёх. По одной категории блюдо ещё
 * не похоже: у бургера и бешбармака разные пары.
 */
function closeDishes(profile: DishProfile, dishes: Dish[]): Map<string, Dish> {
  const asked = [profile.category, profile.cooking, profile.taste, profile.weight, profile.fat].filter(Boolean).length;
  if (asked < 3) return new Map();
  return new Map(dishes.filter(d => dishAffinity(d, profile) === 1).map(d => [d.id, d]));
}

/**
 * Подбор сортов под ответы мастера или под известное блюдо.
 * Пара сомелье забирает текст объяснения и показывает ровно ту оценку,
 * что поставил человек. Для известного блюда берём только его пары.
 */
export function recommend(
  profile: DishProfile,
  brands: Brand[],
  dishes: Dish[],
  pairings: FoodPairing[],
  limit = 4,
): Recommendation[] {
  const dishId = profile.dishId ?? null;
  const similar = dishId ? new Map<string, Dish>() : closeDishes(profile, dishes);

  // Лучшая авторская пара для каждого сорта: своя у блюда или у совпавшего блюда.
  const expert = new Map<string, { pairing: FoodPairing; own: boolean; dishName: string }>();
  for (const p of pairings) {
    const own = !!dishId && p.dish === dishId;
    const close = similar.get(p.dish);
    if (!own && !close) continue;
    const prev = expert.get(p.brand);
    if (!prev || p.compatibility_score > prev.pairing.compatibility_score) {
      expert.set(p.brand, { pairing: p, own, dishName: close?.name ?? '' });
    }
  }

  const scored = brands
    .filter(b => b.is_active !== false)
    .map(brand => {
      const verdict = scoreBeer(brand, profile);
      const hit = expert.get(brand.id);
      const sommelier = hit?.pairing.compatibility_score ?? 0;

      let score = verdict.score;
      if (hit?.own && sommelier >= 4) {
        // Своя пара сомелье идёт первой, между собой такие пары - по оценке человека
        score = 1000 + sommelier * 20 + verdict.score / 100;
      } else if (hit?.own && sommelier === 3) {
        // Своя 3/5 уступает только расчётным 5/5 (round5: от 90 баллов), иначе «Лучший выбор» был бы 3/5 над 5/5
        score = 89.5 + verdict.score / 1000;
      } else if (hit?.own) {
        // Низкую оценку сомелье не поднимаем выше расчёта
        score = Math.min(verdict.score, sommelier * 20);
      } else if (hit) {
        // Пара похожего блюда: оценка 1-5 даёт до 45 баллов
        score = score * 0.55 + (sommelier * 20) * 0.45 + 10;
      }

      const sorted = [...verdict.reasons].sort((a, b) => b.weight - a.weight);

      const rec: Recommendation = {
        brand,
        body: beerProfile(brand).body,
        targetBody: profile.weight ? WEIGHT_TARGET[profile.weight] : null,
        rating: hit ? sommelier : round5(score),
        type: hit ? hit.pairing.pairing_type : verdict.type,
        explanation: hit?.pairing.explanation || sorted[0].text,
        extra: hit ? sorted[0].text : sorted[1]?.text,
        bySommelier: !!hit,
        basedOn: hit && !hit.own ? hit.dishName : undefined,
      };
      return { rec, score, own: !!hit?.own };
    })
    .sort((a, b) => b.score - a.score);

  // Крепкое пиво не ставим первым, если сорт обычной крепости почти не уступает
  const ordered = softenStrong(scored, x => x.score, x => strongBrand(x.rec.brand));
  // Расчёт по правилам грубее движка, поэтому первым крепкое идёт, только если его выбрал сомелье для этого блюда
  if (ordered.length > 1 && strongBrand(ordered[0].rec.brand) && !ordered[0].own) {
    const mild = ordered.findIndex(x => !strongBrand(x.rec.brand));
    if (mild > 0) ordered.unshift(...ordered.splice(mild, 1));
  }
  return ordered.slice(0, limit).map(x => x.rec);
}

/** Блюдо из базы по свободному вводу: точное совпадение важнее частичного, ё = е. */
export function findDish(dishes: Dish[], text: string): Dish | null {
  const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е');
  const q = norm(text);
  if (q.length < 2) return null;
  return dishes.find(d => norm(d.name) === q)
    ?? dishes.find(d => norm(d.name).includes(q))
    ?? null;
}

/* Картинки сорта */

/**
 * Крупные блоки (страница сорта, карточка «лучший выбор») берут файл в
 * высоком качестве, мелкие - лёгкий. Если админ залил только один файл,
 * обе функции вернут его: пустых мест не будет.
 */
export function bigImage(brand: Brand): string | null {
  return brand.image_hd || brand.image || null;
}

export function smallImage(brand: Brand): string | null {
  return brand.image || brand.image_hd || null;
}

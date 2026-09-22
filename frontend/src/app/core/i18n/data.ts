/**
 * Переводы ПОДПИСЕЙ ДАННЫХ на kk/en. Русского здесь нет намеренно: он приходит из data/*.json и из движка,
 * а I18nService откатывается на него, если перевода не нашлось (новое блюдо, новая категория, новая фраза движка).
 * Названия брендов пива не переводятся. Название позиции, заданное самим заведением, всегда важнее перевода.
 */
import type { PairingType } from '../../engine/pairing-engine';
import type { Cooking, Cuisine, Fat, Taste, Weight } from '../models';

export interface L10n { kk: string; en: string; }
const L = (kk: string, en: string): L10n => ({ kk, en });

/** 50 блюд по id из data/dishes.json (display_name). Казахские блюда — в принятом казахском написании. */
export const DISH_NAMES: Record<string, L10n> = {
  'beshbarmak': L('Бешбармақ', 'Beshbarmak'),
  'kazy': L('Қазы', 'Kazy'),
  'shuzhyk': L('Шұжық', 'Shuzhyk'),
  'kuyrdak': L('Қуырдақ', 'Kuyrdak'),
  'zhaya': L('Жая', 'Zhaya'),
  'shashlyk': L('Кәуап', 'Shashlik'),
  'plov': L('Палау', 'Plov'),
  'kurt': L('Құрт', 'Kurt'),
  'irimshik': L('Ірімшік', 'Irimshik'),
  'airan': L('Айран', 'Ayran'),
  'kumys': L('Қымыз', 'Kumis'),
  'baursaki': L('Бауырсақ', 'Baursak'),
  'samsa': L('Самса', 'Samsa'),
  'manty': L('Мәнті', 'Manti'),
  'zheti-as': L('Жеті ас', 'Zheti-as meat platter'),
  'pizza-margherita': L('Маргарита пиццасы', 'Pizza Margherita'),
  'carbonara': L('Карбонара пастасы', 'Pasta Carbonara'),
  'bruschetta': L('Брускетта', 'Bruschetta'),
  'lasagna': L('Лазанья', 'Lasagna'),
  'risotto': L('Ризотто', 'Risotto'),
  'tiramisu': L('Тирамису', 'Tiramisu'),
  'caprese': L('Капрезе', 'Caprese'),
  'sushi': L('Суши', 'Sushi'),
  'ramen': L('Рамен', 'Ramen'),
  'edamame': L('Эдамаме', 'Edamame'),
  'tempura': L('Темпура', 'Tempura'),
  'yakitori': L('Якитори', 'Yakitori'),
  'mochi': L('Моти', 'Mochi'),
  'tonkatsu': L('Тонкацу', 'Tonkatsu'),
  'burger': L('Бургер', 'Burger'),
  'steak': L('Стейк', 'Steak'),
  'nachos': L('Начос', 'Nachos'),
  'bbq-ribs': L('BBQ қабырға', 'BBQ ribs'),
  'buffalo-wings': L('Buffalo қанатшалары', 'Buffalo wings'),
  'mac-and-cheese': L('Мак-энд-чиз', 'Mac and cheese'),
  'apple-pie': L('Алма бәліші', 'Apple pie'),
  'tacos': L('Тако', 'Tacos'),
  'burrito': L('Буррито', 'Burrito'),
  'guacamole': L('Гуакамоле', 'Guacamole'),
  'quesadilla': L('Кесадилья', 'Quesadilla'),
  'chili-con-carne': L('Чили кон карне', 'Chili con carne'),
  'enchilada': L('Энчилада', 'Enchilada'),
  'churros': L('Чуррос', 'Churros'),
  'bratwurst': L('Братвурст', 'Bratwurst'),
  'pretzel': L('Брецель', 'Pretzel'),
  'schnitzel': L('Шницель', 'Schnitzel'),
  'sauerkraut': L('Ашытылған қырыққабат', 'Sauerkraut'),
  'currywurst': L('Карривурст', 'Currywurst'),
  'kartoffelsalat': L('Картоп салаты', 'Potato salad'),
  'strudel': L('Штрудель', 'Strudel'),
};

/** Категории блюд — ключ: русская строка из data/dishes.json (заведение копирует её в свою карту или пишет свою). */
export const DISH_CATEGORIES: Record<string, L10n> = {
  'Бургеры': L('Бургерлер', 'Burgers'),
  'Выпечка/Снеки': L('Нан-тоқаш/Снек', 'Bakery/Snacks'),
  'Гарнир/Закуска': L('Гарнир/Тіскебасар', 'Side/Starter'),
  'Горячее/Закуска': L('Ыстық тағам/Тіскебасар', 'Hot dish/Starter'),
  'Гриль': L('Гриль', 'Grill'),
  'Десерт': L('Десерт', 'Dessert'),
  'Закуска': L('Тіскебасар', 'Starter'),
  'Закуска/Стритфуд': L('Тіскебасар/Стритфуд', 'Starter/Street food'),
  'Закуска/ассорти': L('Тіскебасар/ассорти', 'Starter/Platter'),
  'Запеканка': L('Пеште пісірілген', 'Casserole'),
  'Колбасы/Гриль': L('Шұжық/Гриль', 'Sausages/Grill'),
  'Молочное (напиток)': L('Сүт өнімі (сусын)', 'Dairy (drink)'),
  'Молочное (сушёный сыр)': L('Сүт өнімі (кептірілген ірімшік)', 'Dairy (dried cheese)'),
  'Молочное (творог)': L('Сүт өнімі (сүзбе)', 'Dairy (curd)'),
  'Мясное': L('Ет тағамы', 'Meat'),
  'Мясное (вяленое)': L('Ет тағамы (сүрленген)', 'Meat (cured)'),
  'Мясное (гриль)': L('Ет тағамы (гриль)', 'Meat (grill)'),
  'Мясное (жареные потроха)': L('Ет тағамы (қуырылған ішек-қарын)', 'Meat (fried offal)'),
  'Мясное (колбаса)': L('Ет тағамы (шұжық)', 'Meat (sausage)'),
  'Мясное (конская колбаса)': L('Ет тағамы (жылқы шұжығы)', 'Meat (horse sausage)'),
  'Мясное BBQ': L('BBQ ет', 'BBQ meat'),
  'Мясное с рисом': L('Күріш қосылған ет', 'Meat with rice'),
  'Основное': L('Негізгі тағам', 'Main'),
  'Основное/Рагу': L('Негізгі тағам/Рагу', 'Main/Stew'),
  'Паста': L('Паста', 'Pasta'),
  'Паста/Гарнир': L('Паста/Гарнир', 'Pasta/Side'),
  'Паста/Запеканка': L('Паста/Пеште пісірілген', 'Pasta/Casserole'),
  'Пицца': L('Пицца', 'Pizza'),
  'Птица/Снеки': L('Құс еті/Снек', 'Poultry/Snacks'),
  'Рис': L('Күріш', 'Rice'),
  'Салат/Закуска': L('Салат/Тіскебасар', 'Salad/Starter'),
  'Салаты': L('Салаттар', 'Salads'),
  'Снеки': L('Снектер', 'Snacks'),
  'Соусы/Закуски': L('Соус/Тіскебасар', 'Dips/Starters'),
  'Стритфуд': L('Стритфуд', 'Street food'),
  'Суп/Лапша': L('Сорпа/Кеспе', 'Soup/Noodles'),
  'Суши': L('Суши', 'Sushi'),
  'Тестовое': L('Қамыр тағамы', 'Dough dish'),
  'Тестовое (на пару)': L('Қамыр тағамы (буға пісірілген)', 'Dough dish (steamed)'),
  'Тестовое (с мясом)': L('Қамыр тағамы (етпен)', 'Dough dish (with meat)'),
  // категории из saas.service (демо-карта и «своё блюдо»)
  'Своё': L('Өз тағамы', 'Custom'),
  'Разливное': L('Құйма сыра', 'Draft'),
  'Бутылка и банка': L('Бөтелке және банка', 'Bottle & can'),
};

export const CUISINE_LABELS: Record<Cuisine, L10n> = {
  KZ: L('Қазақ асханасы', 'Kazakh'),
  ITALIAN: L('Итальян асханасы', 'Italian'),
  JAPANESE: L('Жапон асханасы', 'Japanese'),
  AMERICAN: L('Америка асханасы', 'American'),
  MEXICAN: L('Мексика асханасы', 'Mexican'),
  GERMAN: L('Неміс асханасы', 'German'),
  OTHER: L('Басқа асхана', 'Other'),
};

export const TASTE_LABELS_L10N: Record<Taste, L10n> = {
  SALTY: L('Тұзды', 'Salty'), SWEET: L('Тәтті', 'Sweet'), SOUR: L('Қышқыл', 'Sour'), BITTER: L('Ащы', 'Bitter'),
  UMAMI: L('Умами', 'Umami'), SPICY: L('Өткір', 'Spicy'), MIXED: L('Аралас', 'Mixed'),
};
export const WEIGHT_LABELS_L10N: Record<Weight, L10n> = { LIGHT: L('Жеңіл', 'Light'), MEDIUM: L('Орташа', 'Medium'), HEAVY: L('Тойымды', 'Hearty') };
export const FAT_LABELS_L10N: Record<Fat, L10n> = { LOW: L('Төмен', 'Low'), MEDIUM: L('Орташа', 'Medium'), HIGH: L('Жоғары', 'High') };
export const COOKING_LABELS_L10N: Record<Cooking, L10n> = {
  FRIED: L('Қуырылған', 'Fried'), GRILLED: L('Гриль', 'Grilled'), BAKED: L('Пеште пісірілген', 'Baked'), BOILED: L('Асылған', 'Boiled'),
  STEAMED: L('Буға пісірілген', 'Steamed'), RAW: L('Шикі', 'Raw'), CURED: L('Сүрленген', 'Cured'), FERMENTED: L('Ашытылған', 'Fermented'),
  OTHER: L('Термиялық өңдеусіз', 'No cooking'),
};

/** Стили пива — ключ: style_family из data/brands.json (все 13 семейств из data/style_priors.json). */
export const STYLE_LABELS: Record<string, L10n> = {
  PILSNER: L('Пилснер', 'Pilsner'),
  LAGER: L('Ашық түсті лагер', 'Pale lager'),
  AMERICAN_LAGER: L('Америкалық лагер', 'American lager'),
  CZECH_LAGER: L('Чех лагері', 'Czech lager'),
  GERMAN_LAGER: L('Неміс лагері', 'German lager'),
  AMBER_LAGER: L('Кәріптас түсті лагер', 'Amber lager'),
  STRONG_LAGER: L('Күшті лагер', 'Strong lager'),
  RICE_LAGER: L('Күріш лагері', 'Rice lager'),
  DRAFT_LAGER: L('Құйма лагер', 'Draft lager'),
  DARK_LAGER: L('Қара лагер', 'Dark lager'),
  WHEAT: L('Бидай сырасы', 'Wheat beer'),
  IPA: L('IPA', 'IPA'),
  STOUT: L('Стаут', 'Stout'),
};

/** Тип пары — зеркало TYPE_LABELS движка (pairing-engine.ts, только чтение). */
export const MATCH_LABELS: Record<PairingType, L10n> = {
  COMPLEMENT: L('Complement · толықтыру', 'Complement'),
  CONTRAST: L('Contrast · контраст', 'Contrast'),
  CLEANSE: L('Cleanse · тазарту', 'Cleanse'),
  BRIDGE: L('Bridge · көпір', 'Bridge'),
};

/** Вердикты — фиксированный набор verdictLabel() движка; ключ — русский текст. */
export const VERDICTS: Record<string, L10n> = {
  'Идеальная пара': L('Мінсіз жұп', 'Perfect match'),
  'Отличное сочетание': L('Тамаша үйлесім', 'Great pairing'),
  'Хорошая пара': L('Жақсы жұп', 'Good match'),
  'Нейтрально': L('Бейтарап', 'Neutral'),
  'Не рекомендуем': L('Ұсынбаймыз', 'Not recommended'),
};

/** Оси профиля блюда (DISH_AXIS_LABELS движка). */
export const DISH_AXIS_L10N: Record<string, L10n> = {
  salt: L('Тұз', 'Salt'), sweet: L('Тәттілік', 'Sweetness'), sour: L('Қышқылдық', 'Acidity'), bitter: L('Ащылық', 'Bitterness'),
  umami: L('Умами', 'Umami'), heat: L('Өткірлік', 'Heat'), fat: L('Майлылық', 'Fat'), weight: L('Тойымдылық', 'Weight'),
  smoke: L('Түтін', 'Smoke'), maillard: L('Қытырлақ', 'Crust'), fresh: L('Балғындық', 'Freshness'), cream: L('Кілегейлік', 'Creaminess'),
  spice: L('Дәмдеуіш', 'Spices'),
};

/** Названия правил в разборе оценки (RULE_NAMES в match-card). */
export const RULE_NAMES_L10N: Record<string, L10n> = {
  intensity: L('Қарқындылық', 'Intensity'), cut: L('Майды тазарту', 'Fat cut'), heat: L('Өткірлік', 'Heat'), salt: L('Тұз', 'Salt'),
  sweet: L('Тәттілік', 'Sweetness'), sour: L('Қышқылдық', 'Acidity'), umami: L('Умами', 'Umami'), fresh: L('Нәзіктік', 'Delicacy'),
  roast: L('Қытырлақ қабық', 'Crust'), smoke: L('Түтін ↔ құлмақ', 'Smoke ↔ hops'), bridge: L('Хош иіс көпірі', 'Aroma bridge'),
  curated: L('Сомелье', 'Sommelier'), occasion: L('Жағдай', 'Occasion'), bitter_pref: L('Ащылық', 'Bitterness'), dna: L('Flavor DNA', 'Flavor DNA'),
};

/**
 * Причины движка. Contribution.text — русский свободный текст, движок править нельзя, зато Contribution.rule — стабильный id.
 * Поэтому на kk/en показываем одну короткую обобщённую фразу на правило; если у правила бывает минус — отдельную фразу для минуса.
 * Нет шаблона для правила → показывается исходный русский текст.
 */
export const RULE_REASONS: Record<string, { pos: L10n; neg?: L10n }> = {
  intensity: {
    pos: L('Сыра мен тағамның қарқындылығы шамалас — бірін-бірі баспайды', 'Beer and dish are close in intensity — neither drowns out the other'),
    neg: L('Сыра мен тағамның қарқындылығы тым алшақ — бірі екіншісін басып кетеді', 'Beer and dish are too far apart in intensity — one overpowers the other'),
  },
  cut: { pos: L('Ащылық пен көпіршіктер тағамның майлылығын «кесіп», дәм сезуді жаңартады', 'Bitterness and bubbles cut through the richness and reset the palate') },
  heat: {
    pos: L('Уыттың жұмсақтығы мен көпіршіктер тағамның өткірлігін басады', 'Malt softness and bubbles calm the heat of the dish'),
    neg: L('Құлмақ пен алкоголь бұрыштың күйдіруін күшейтеді', 'Hops and alcohol amplify the chilli burn'),
  },
  salt: { pos: L('Тұз ащылықты жұмсартады, ал көпіршіктер шөлді қандырады', 'Salt softens bitterness, and the bubbles quench the thirst it builds') },
  sweet: {
    pos: L('Уыттың тәттілігі десертке тең келеді — сыра ащы болып сезілмейді', 'Malt sweetness keeps up with the dessert — the beer doesn’t taste bitter'),
    neg: L('Тағам сырадан тәттірек: оның қасында сыра қатқыл әрі сулы болып сезіледі', 'The dish is sweeter than the beer, which will seem harsh and watery next to it'),
  },
  sour: {
    pos: L('Тағамның қышқылтым дәмі мен сыраның таза, көпіршікті дәмі бірін-бірі сергітеді', 'The dish’s acidity and the beer’s sparkling cleanness refresh each other'),
    neg: L('Қою, тәттілеу сыра тағамның қышқылдығымен үйлеспейді', 'A full, sweetish beer clashes with the dish’s acidity'),
  },
  umami: {
    pos: L('Ет пен сорпаның умами дәмі сыраның уытты денесімен үндеседі', 'The umami of meat and broth is mirrored by the beer’s malty body'),
    neg: L('Нәзік умамиге күшті құлмақ металл дәмін береді', 'Strong hops on delicate umami leave a metallic note'),
  },
  fresh: {
    pos: L('Жеңіл, таза сыра тағамның балғындығы мен нәзіктігін баспайды', 'A light, clean beer doesn’t mask the dish’s freshness and delicacy'),
    neg: L('Ауыр немесе күшті сыра нәзік тағамды басып тастайды', 'A heavy or strong beer overwhelms a delicate dish'),
  },
  roast: { pos: L('Тағамның қытырлақ қабығы сыраның уыты мен карамелімен үндеседі', 'The dish’s crust and caramelisation echo the beer’s malt and caramel') },
  smoke: { pos: L('Шайырлы құлмақ гриль түтінімен үндеседі', 'Resinous hops echo the smoke of the grill') },
  bridge: { pos: L('Ортақ хош иістер сыра мен тағам арасында «көпір» салады', 'Shared aromas build a bridge between the beer and the dish') },
  curated: {
    pos: L('Бұл жұпты сомелье тексеріп, мақұлдаған', 'This pairing has been checked and approved by the sommelier'),
    neg: L('Сомелье бұл жұпты ұсынбайды', 'The sommelier advises against this pairing'),
  },
  occasion: {
    pos: L('Таңдаған жағдайыңызға сай келеді', 'Fits the occasion you chose'),
    neg: L('Таңдаған жағдайыңызға онша сай келмейді', 'Not the best fit for the occasion you chose'),
  },
  bitter_pref: {
    pos: L('Ащылыққа қатысты талғамыңызға сай келеді', 'Fits your bitterness preference'),
    neg: L('Ащылыққа қатысты талғамыңызға сай келмейді', 'Goes against your bitterness preference'),
  },
  dna: {
    pos: L('Сіздің Flavor DNA-ңызға жақын', 'Close to your Flavor DNA'),
    neg: L('Сіздің Flavor DNA-ңыздан алыс', 'Far from your Flavor DNA'),
  },
};
/** «Общие ароматы — хлеб, лук — …»: у правила bridge есть теги, их можно назвать поимённо. */
export const BRIDGE_WITH_TAGS: L10n = L('Ортақ хош иістер — {tags} — сыра мен тағам арасында «көпір» салады', 'Shared aromas — {tags} — build a bridge between the beer and the dish');

/**
 * Фиксированные фразы движка: русский текст → [rule, это минус?]. Нужны в двух местах:
 *  1) у правила intensity знак очков не равен смыслу фразы («пиво мощнее блюда» бывает и с малым плюсом) — смысл берём из текста;
 *  2) ответ ИИ-сервера (AiPick.why) приходит готовым русским текстом без rule id — узнаём правило по тексту.
 * null — фраза одна на оба знака (повод, горечь): решает знак очков. Фраза в движке изменилась → откат на знак очков / русский текст.
 */
export const REASON_RULE_BY_RU: Record<string, [rule: string, negative: boolean | null]> = {
  'Интенсивность пива и блюда совпадают — никто никого не перекрикивает': ['intensity', false],
  'Пиво чуть плотнее блюда — ведёт в паре': ['intensity', false],
  'Блюдо чуть ярче пива — пиво играет роль фона': ['intensity', false],
  'Пиво мощнее блюда: рискует заглушить его вкус': ['intensity', true],
  'Блюдо мощнее пива: напиток потеряется на его фоне': ['intensity', true],
  'Хмелевая горечь «режет» жирность и обновляет рецепторы': ['cut', false],
  'Карбонизация смывает жир с языка — каждый глоток как первый': ['cut', false],
  'Солодовая мягкость и пузырьки гасят остроту, не споря с ней': ['heat', false],
  'Хмель и алкоголь усиливают жжение перца — пара будет «горячее», чем хочется': ['heat', true],
  'Солёная закуска — классика к пиву: соль будит жажду, пузырьки её утоляют': ['salt', false],
  'Соль смягчает горечь и подчёркивает солодовую сладость': ['salt', false],
  'Солодовая сладость держит уровень десерта — пиво не кажется горьким': ['sweet', false],
  'Десерт слаще пива: на его фоне пиво покажется резким и водянистым': ['sweet', true],
  'Кислинка блюда и игристая чистота пива освежают друг друга': ['sour', false],
  'Плотное сладковатое пиво спорит с кислотой блюда': ['sour', true],
  'Умами мяса/бульона отзеркаливается солодовым телом пива': ['umami', false],
  'Сильный хмель на деликатном умами даёт металлический привкус': ['umami', true],
  'Лёгкое чистое пиво не перебивает свежесть и деликатность блюда': ['fresh', false],
  'Тяжёлое или крепкое пиво давит деликатное блюдо': ['fresh', true],
  'Корочка и карамелизация блюда перекликаются с солодом и карамелью пива': ['roast', false],
  'Смолистый хмель вторит дымку гриля': ['smoke', false],
  'Жаркий день: ценим свежесть и лёгкость': ['occasion', null],
  'Вечер: плотное тело и тепло звучат уместнее': ['occasion', null],
  'Компания: питкое пиво, которое не утомляет': ['occasion', null],
  'Гастро-вечер: чем сложнее ароматика, тем интереснее': ['occasion', null],
  'Ты любишь горечь — плюс к хмелевым сортам': ['bitter_pref', null],
  'Ты избегаешь горечи — минус хмелевым сортам': ['bitter_pref', null],
  'Совпадает с твоим Flavor DNA': ['dna', false],
  'Далеко от твоего Flavor DNA': ['dna', true],
};
/** Та же фраза движка про общие ароматы, но из текста: «Общие ароматы — хлеб, лук — строят …». */
export const BRIDGE_RU_PATTERN = /^Общие ароматы — (.+) — строят/;

/** Ароматические теги (TAG_LABELS движка) — для фразы про «мост». На en id тега уже и есть английское слово. */
export const TAG_LABELS_L10N: Record<string, L10n> = {
  bread: L('нан', 'bread'), grain: L('дән', 'grain'), caramel: L('карамель', 'caramel'), toffee: L('тоффи', 'toffee'), honey: L('бал', 'honey'),
  herbs: L('шөптер', 'herbs'), pine: L('қылқан', 'pine'), grass: L('көк шөп', 'grass'), floral: L('гүл', 'flowers'), citrus: L('цитрус', 'citrus'),
  lime: L('лайм', 'lime'), lemon: L('лимон', 'lemon'), apple: L('алма', 'apple'), pear: L('алмұрт', 'pear'), banana: L('банан', 'banana'),
  fruit: L('жеміс', 'fruit'), rice: L('күріш', 'rice'), coffee: L('кофе', 'coffee'), toast: L('тост', 'toast'), roast: L('қуырылған дән', 'roast'),
  chocolate: L('шоколад', 'chocolate'), cocoa: L('какао', 'cocoa'), fresh: L('балғындық', 'freshness'), fizz: L('көпіршіктер', 'bubbles'),
  warmth: L('жылылық', 'warmth'), smoke: L('түтін', 'smoke'), corn: L('жүгері', 'corn'), sweet: L('тәттілік', 'sweetness'), cheese: L('ірімшік', 'cheese'),
  dairy: L('сүт өнімдері', 'dairy'), sour: L('қышқылтым дәм', 'tartness'), garlic: L('сарымсақ', 'garlic'), pepper: L('бұрыш', 'pepper'),
  onion: L('пияз', 'onion'), cumin: L('зире', 'cumin'), cinnamon: L('даршын', 'cinnamon'), butter: L('сары май', 'butter'), cream: L('кілегей', 'cream'),
};

/** 64 вкусовые ноты по id из data/flavor_notes.json. В гостевых экранах пока не показываются — задел для каталога сортов. */
export const NOTE_NAMES: Record<string, L10n> = {
  'freshness': L('Балғындық', 'Freshness'),
  'hop-aroma': L('Құлмақ хош иісі', 'Hop aroma'),
  'floral': L('Гүл ноталары', 'Floral notes'),
  'light-hop': L('Жеңіл құлмақ', 'Light hops'),
  'effervescence': L('Ойнақы көпіршіктер', 'Sparkling carbonation'),
  'alcoholic': L('Спирт жылуы', 'Alcohol warmth'),
  'kettle-hop': L('Қазандық құлмақ', 'Kettle hops'),
  'citrus': L('Цитрус хош иісі', 'Citrus aroma'),
  'fruity-esters': L('Жеміс эфирлері', 'Fruity esters'),
  'malty': L('Уыт', 'Malt'),
  'rich-malt': L('Уыт қоюлығы', 'Rich malt'),
  'grainy': L('Дән ноталары', 'Grainy notes'),
  'caramel': L('Карамель', 'Caramel'),
  'rice': L('Күріш ноталары', 'Rice notes'),
  'sweetness': L('Тәттілік', 'Sweetness'),
  'worty': L('Сусло (Worty)', 'Wort (worty)'),
  'smooth-malt-balance': L('Уыттың жұмсақ тепе-теңдігі', 'Smooth malt balance'),
  'roasty': L('Қуырылған уыт', 'Roasted malt'),
  'chocolate': L('Шоколад', 'Chocolate'),
  'hop-bitterness': L('Құлмақ ащылығы', 'Hop bitterness'),
  'refreshing-finish': L('Сергітетін соңғы дәм', 'Refreshing finish'),
  'mild-bitterness': L('Орташа ащылық', 'Mild bitterness'),
  'clean-finish': L('Таза соңғы дәм', 'Clean finish'),
  'balanced-finish': L('Теңгерімді соңғы дәм', 'Balanced finish'),
  'hoppy-aftertaste': L('Құлмақты соңғы дәм', 'Hoppy aftertaste'),
  'crisp-dynamic-bitterness': L('Серпінді ащылық', 'Crisp, dynamic bitterness'),
  'sweet-finish': L('Соңғы дәмдегі нәзік тәттілік', 'Subtle sweet finish'),
  'classic-bitterness': L('Классикалық ащылық', 'Classic bitterness'),
  'mouthfeel': L('Дене мен қоюлық (Body)', 'Body & mouthfeel'),
  'amber-sweetness': L('Кәріптас тәттілігі', 'Amber sweetness'),
  'smooth-finish': L('Жұмсақ соңғы дәм', 'Smooth finish'),
  'banana': L('Банан', 'Banana'),
  'tropical-fruit': L('Тропикалық жемістер', 'Tropical fruit'),
  'berry': L('Жидектер', 'Berries'),
  'pine': L('Қарағай мен шайыр', 'Pine & resin'),
  'grassy': L('Көк шөп иісі', 'Grassy'),
  'spicy-hop': L('Дәмдеуішті құлмақ', 'Spicy hops'),
  'honey': L('Бал', 'Honey'),
  'clove': L('Қалампыр', 'Clove'),
  'minty': L('Жалбыз', 'Mint'),
  'biscuit': L('Бисквит', 'Biscuit'),
  'toasty': L('Тост', 'Toast'),
  'nutty': L('Жаңғақ', 'Nutty'),
  'toffee': L('Тоффи', 'Toffee'),
  'dried-fruit': L('Кептірілген жемістер', 'Dried fruit'),
  'coffee': L('Кофе', 'Coffee'),
  'smoky': L('Түтін', 'Smoke'),
  'wheat': L('Бидай жұмсақтығы', 'Wheat softness'),
  'oaty': L('Сұлы кілегейлігі', 'Oat creaminess'),
  'vanilla': L('Ваниль', 'Vanilla'),
  'cooked-corn': L('Пісірілген жүгері (DMS)', 'Cooked corn (DMS)'),
  'buttery': L('Сары май (диацетил)', 'Butter (diacetyl)'),
  'dry': L('Құрғақ соңғы дәм', 'Dry finish'),
  'tart': L('Қышқылтым дәм', 'Tartness'),
  'astringent': L('Кермек дәм', 'Astringency'),
  'mineral': L('Минералдылық', 'Minerality'),
  'warming-finish': L('Жылытатын соңғы дәм', 'Warming finish'),
  'oily': L('Майлы текстура', 'Oily texture'),
  'metallic': L('Металл дәмі', 'Metallic'),
  'sulfury': L('Күкірт иісі', 'Sulphury'),
  'acetaldehyde': L('Жасыл алма (ацетальдегид)', 'Green apple (acetaldehyde)'),
  'papery': L('Картон (тотығу)', 'Cardboard (oxidation)'),
  'lightstruck': L('Скунс (жарық тиген)', 'Skunky (lightstruck)'),
  'acetic': L('Сірке суы дәмі', 'Vinegar (acetic)'),
};

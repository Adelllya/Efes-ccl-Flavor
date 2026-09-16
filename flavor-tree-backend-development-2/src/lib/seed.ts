// Seed data based on FlavorActiV "Beer Flavour Language: A Lexicon of Beer Flavour Terms"
// Note: layer mapping (TOP/HEART/BASE) is a working hypothesis — final call by sommelier.

export interface FlavorNoteSeed {
  name: string;
  technicalTerm?: string;
  wheelCode?: string;
  category: "TOP" | "HEART" | "BASE";
  description: string;
  icon: string;
  referenceMaterial?: string;
  isOffFlavour?: boolean;
}

export const flavorNoteSeeds: FlavorNoteSeed[] = [
  // ═══════════ TOP NOTES (first impression, 0–3 sec) ═══════════
  {
    name: "Хмелевая свежесть",
    technicalTerm: "Kettle Hop / Hop Oil",
    wheelCode: "0170",
    category: "TOP",
    description: "Свежий хмелевой аромат, первое впечатление при поднесении бокала",
    icon: "🌿",
    referenceMaterial: "Свежая хмелевая шишка, хмелевое масло",
  },
  {
    name: "Цитрус",
    technicalTerm: "Isoamyl Acetate",
    wheelCode: "0120",
    category: "TOP",
    description: "Яркие цитрусовые ноты — мандарин, грейпфрут, лимонная цедра",
    icon: "🍊",
    referenceMaterial: "Цедра мандарина, грейпфрутовая кожура",
  },
  {
    name: "Цветочный букет",
    technicalTerm: "Geraniol",
    wheelCode: "0130",
    category: "TOP",
    description: "Деликатные цветочные ароматы, характерные для лагеров и пшеничных сортов",
    icon: "🌸",
    referenceMaterial: "Роза, жасмин, герань",
  },
  {
    name: "Тропические фрукты",
    technicalTerm: "Ethyl Hexanoate",
    wheelCode: "0110",
    category: "TOP",
    description: "Арбуз, манго, ананас — яркие фруктовые эстеровые ароматы",
    icon: "🍍",
    referenceMaterial: "Арбуз, манго, спелый ананас",
  },
  {
    name: "Яблоко и персик",
    technicalTerm: "Isoamyl Acetate",
    wheelCode: "0120",
    category: "TOP",
    description: "Спелое зелёное яблоко, персик — классические эстеровые ноты элей",
    icon: "🍑",
    referenceMaterial: "Спелый персик, зелёное яблоко",
  },
  {
    name: "Свежескошенная трава",
    technicalTerm: "Freshly Cut Grass",
    wheelCode: "0160",
    category: "TOP",
    description: "Зелёный травяной аромат, как в только что скошенной траве",
    icon: "🌱",
    referenceMaterial: "Свежескошенная трава, зелёные листья",
  },
  {
    name: "Спиртовой аромат",
    technicalTerm: "Alcoholic",
    wheelCode: "0010",
    category: "TOP",
    description: "Лёгкий спиртовой шлейф в аромате, заметен в крепких сортах",
    icon: "✨",
    referenceMaterial: "Спирт, ром, бренди",
  },
  {
    name: "Освежающий финиш",
    technicalTerm: "Carbonation",
    wheelCode: "0390",
    category: "TOP",
    description: "Живая карбонизация, искристость и свежесть в носу",
    icon: "❄️",
    referenceMaterial: "Газировка, минеральная вода с пузырьками",
  },
  {
    name: "Дымный шлейф",
    technicalTerm: "Smoky",
    wheelCode: "0300",
    category: "TOP",
    description: "Лёгкий дымный аромат от обжаренного солода или хмеля",
    icon: "💨",
    referenceMaterial: "Сосновый дым, копчёная щепка",
  },
  {
    name: "Пряная свежесть",
    technicalTerm: "Phenolic / Spicy",
    wheelCode: "0210",
    category: "TOP",
    description: "Лёгкие фенольные и пряные акценты в аромате",
    icon: "🌶️",
    referenceMaterial: "Белый перец, гвоздика, имбирь",
  },
  {
    name: "Свежий хлеб",
    technicalTerm: "Bready",
    wheelCode: "0090",
    category: "TOP",
    description: "Аромат тёплого свежевыпеченного хлеба",
    icon: "🥖",
    referenceMaterial: "Свежий батон, ржаной хлеб",
  },
  {
    name: "Медовые ноты",
    technicalTerm: "Honey",
    wheelCode: "0140",
    category: "TOP",
    description: "Сладкий цветочный медовый аромат",
    icon: "🍯",
    referenceMaterial: "Липовый мёд, акациевый мёд",
  },
  // ═══════════ HEART NOTES (main body, 3–15 sec) ═══════════
  {
    name: "Солодовая плотность",
    technicalTerm: "Malty",
    wheelCode: "0080",
    category: "HEART",
    description: "Основное солодовое тело пива, сытность и плотность",
    icon: "🌾",
    referenceMaterial: "Пшеничный солод, ячмень",
  },
  {
    name: "Карамель",
    technicalTerm: "Caramel",
    wheelCode: "0280",
    category: "HEART",
    description: "Карамельная сладость от умеренно обжаренного солода",
    icon: "🍬",
    referenceMaterial: "Карамель, жжёный сахар",
  },
  {
    name: "Хлебно-зерновые ноты",
    technicalTerm: "Grainy / Bread",
    wheelCode: "0090",
    category: "HEART",
    description: "Зерновая сытность, ржаной хлеб, овсяные хлопья",
    icon: "🥣",
    referenceMaterial: "Овсяные хлопья, ржаной хлеб, пшеница",
  },
  {
    name: "Зерновое послевкусие",
    technicalTerm: "Worty",
    wheelCode: "0080",
    category: "HEART",
    description: "Нота сусла, сладковатая зерновая основа",
    icon: "🌰",
    referenceMaterial: "Свежее пиво-сусло, сладкая пшеница",
  },
  {
    name: "Сладость",
    technicalTerm: "Sweet",
    wheelCode: "0370",
    category: "HEART",
    description: "Сладковатое ощущение от неферментированных сахаров",
    icon: "🍮",
    referenceMaterial: "Медовая карамель, варёная кукуруза",
  },
  {
    name: "Ваниль",
    technicalTerm: "Vanilla",
    wheelCode: "0250",
    category: "HEART",
    description: "Ванильный аромат от дубовых дубил и дрожжевых метилантратов",
    icon: "🍦",
    referenceMaterial: "Ванильный стручок, ванильное мороженое",
  },
  {
    name: "Ореховые ноты",
    technicalTerm: "Almond / Nutty",
    wheelCode: "0150",
    category: "HEART",
    description: "Миндаль, грецкий орех, фундук — ореховое тело пива",
    icon: "🌰",
    referenceMaterial: "Миндаль, грецкий орех, фундук",
  },
  {
    name: "Травянистость",
    technicalTerm: "Grassy / Herbal",
    wheelCode: "0160",
    category: "HEART",
    description: "Травяные и фито-ноты в теле пива",
    icon: "🌿",
    referenceMaterial: "Сушёные травы, шалфей, мята",
  },
  {
    name: "Сырная плотность",
    technicalTerm: "Butyric",
    wheelCode: "0290",
    category: "HEART",
    description: "Сливочные и сливочнo-сырные ноты, характерные для некоторых элей",
    icon: "🧈",
    referenceMaterial: "Сливочное масло, выдержанный сыр",
    isOffFlavour: true,
  },
  {
    name: "Горьковатое яблоко",
    technicalTerm: "Acetic",
    wheelCode: "0220",
    category: "HEART",
    description: "Лёгкая кислинка, как в зелёном яблоке или уксусной настойке",
    icon: "🍏",
    referenceMaterial: "Зелёное яблоко, яблочный уксус",
  },
  {
    name: "Молочная сладость",
    technicalTerm: "Diacetyl",
    wheelCode: "0260",
    category: "HEART",
    description: "Сливочно-масляная нота, характерная для барley wine и стаутов",
    icon: "🥛",
    referenceMaterial: "Тёплое сливочное масло, сливки",
    isOffFlavour: true,
  },
  {
    name: "Зерновая пряность",
    technicalTerm: "Spicy",
    wheelCode: "0210",
    category: "HEART",
    description: "Пряные ноты от специй и фенолов — гвоздика, корица",
    icon: "🧂",
    referenceMaterial: "Гвоздика, корица, имбирь",
  },
  {
    name: "Косточковые фрукты",
    technicalTerm: "Fruity",
    wheelCode: "0100",
    category: "HEART",
    description: "Спелые фрукты — слива, абрикос, вишня",
    icon: "🍑",
    referenceMaterial: "Слива, абрикос, вишня",
  },
  // ═══════════ BASE NOTES (finish, 15+ sec) ═══════════
  {
    name: "Хмелевая горчинка",
    technicalTerm: "Bitter",
    wheelCode: "0350",
    category: "BASE",
    description: "Хмелевая горечь — основа послевкусия большинства пив",
    icon: "🌿",
    referenceMaterial: "Горький хмель, артемизия",
  },
  {
    name: "Обжарка",
    technicalTerm: "Burnt / Roasted",
    wheelCode: "0310",
    category: "BASE",
    description: "Обжаренный солод, тост, поджарка — тёмная основа стаутов и портеров",
    icon: "🔥",
    referenceMaterial: "Обжаренный кофе, тост, жжёный солод",
  },
  {
    name: "Кофейные ноты",
    technicalTerm: "Coffee",
    wheelCode: "0310",
    category: "BASE",
    description: "Кофейный финиш — от эспрессо до кофе с молоком",
    icon: "☕",
    referenceMaterial: "Свежесваренный кофе, эспрессо",
  },
  {
    name: "Шоколад",
    technicalTerm: "Chocolate",
    wheelCode: "0310",
    category: "BASE",
    description: "Шоколадный финиш — от молочного до тёмного шоколада",
    icon: "🍫",
    referenceMaterial: "Тёмный шоколад, какао",
  },
  {
    name: "Дрожжевые ноты",
    technicalTerm: "Yeasty",
    wheelCode: "0270",
    category: "BASE",
    description: "Дрожжевой характер — хлеб, банан, гвоздика от дрожжевых метаболических продуктов",
    icon: "🫓",
    referenceMaterial: "Свежие дрожжи, ржаной хлеб",
  },
  {
    name: "Земляные ноты",
    technicalTerm: "Earthy / Musty",
    wheelCode: "0380",
    category: "BASE",
    description: "Земля, мох, луг — землистый финиш",
    icon: "🌍",
    referenceMaterial: "Влага после дождя, мох, земля",
  },
  {
    name: "Соломенная основа",
    technicalTerm: "Papery / Leathery",
    wheelCode: "0380",
    category: "BASE",
    description: "Соломенная, бумажная, кожаная нота в послевкусии",
    icon: "📜",
    referenceMaterial: "Солома, старая бумага, кожа",
  },
  {
    name: "Соленый финиш",
    technicalTerm: "Salty",
    wheelCode: "0360",
    category: "BASE",
    description: "Лёгкая солоноватость в послевкусии, характерная для голландских лагеров",
    icon: "🧂",
    referenceMaterial: "Солёные крекеры, морская соль",
  },
  {
    name: "Сульфидный оттенок",
    technicalTerm: "Sulphitic",
    wheelCode: "0240",
    category: "BASE",
    description: "Сульфидные ноты — от дикого лука до сыра, часто в неферментированных лагерных стилях",
    icon: "🧅",
    referenceMaterial: "Лук, чеснок, мягкий сыр",
    isOffFlavour: true,
  },
  {
    name: "Сероводородный шлейф",
    technicalTerm: "H2S",
    wheelCode: "0240",
    category: "BASE",
    description: "Тухлые яйца, сера — дефект вкуса, требует контроля",
    icon: "🥚",
    referenceMaterial: "Тухлое яйцо, сера",
    isOffFlavour: true,
  },
  {
    name: "Меркаптановая нота",
    technicalTerm: "Mercaptan",
    wheelCode: "0240",
    category: "BASE",
    description: "Кошачья моча, спелая вишня — сернистые соединения",
    icon: "🐱",
    referenceMaterial: "Кошачья моча, спелая вишня",
    isOffFlavour: true,
  },
  {
    name: "Световой дефект",
    technicalTerm: "Lightstruck",
    wheelCode: "0240",
    category: "BASE",
    description: "Дефект от UV-света — запах мокрой мыши, кожаной перчатки",
    icon: "🐭",
    referenceMaterial: "Мокрая мышь, кожаная перчатка",
    isOffFlavour: true,
  },
  {
    name: "Сухое послевкусие",
    technicalTerm: "Dry / Astringent",
    wheelCode: "0400",
    category: "BASE",
    description: "Сухое, чуть вяжущее послевкусие от танинов и хмеля",
    icon: "🍂",
    referenceMaterial: "Чёрный чай, незрелое яблоко",
  },
  {
    name: "Металлический оттенок",
    technicalTerm: "Metallic",
    wheelCode: "0340",
    category: "BASE",
    description: "Металлическая нота — от железа или контакта с оборудованием",
    icon: "🔩",
    referenceMaterial: "Металл, ржавчина",
    isOffFlavour: true,
  },
  {
    name: "Мясистая нота",
    technicalTerm: "Meaty / Catty",
    wheelCode: "0330",
    category: "BASE",
    description: "Мясные, бульонные ноты — часто от DMS или дефектов брожения",
    icon: "🍖",
    referenceMaterial: "Куриный бульон, варёное мясо",
    isOffFlavour: true,
  },
  {
    name: "Варёные овощи",
    technicalTerm: "Cooked Veg",
    wheelCode: "0320",
    category: "BASE",
    description: "Варёный горошек, кукуруза, спаржа — от DMS и хмеля",
    icon: "🥬",
    referenceMaterial: "Варёный горошек, спаржа, кукуруза",
    isOffFlavour: true,
  },
  {
    name: "Финиш — хмель и солод",
    technicalTerm: "Bitter / Malty",
    wheelCode: "0350",
    category: "BASE",
    description: "Общий баланс горечи и солода в послевкусии",
    icon: "🎯",
    referenceMaterial: "Хмель + солод в балансе",
  },
];

// ─── Brand seeds ─────────────────────────────────────────────────────────────
export interface BrandSeed {
  name: string;
  brandOwner: string;
  style: string;
  abv: number;
  density?: string;
  fermentationType?: string;
  description: string;
  image: string;
  isActive?: boolean;
}

export const brandSeeds: BrandSeed[] = [
  {
    name: "Efes Pilsener",
    brandOwner: "Efes Kazakhstan",
    style: "Pilsner",
    abv: 4.5,
    density: "11.8% плато",
    fermentationType: "Нижнее",
    description: "Классический пилснер с чешским характером — чистый солод, хмелевая свежесть и яркий финиш.",
    image: "https://placehold.co/600x800/f59e0b/fff?text=Efes+Pilsener",
  },
  {
    name: "Efes Lager",
    brandOwner: "Efes Kazakhstan",
    style: "Lager",
    abv: 4.8,
    density: "12.0% плато",
    fermentationType: "Нижнее",
    description: "Сбалансированный лагер — солодовая база, лёгкая карамель, хмелевая горчинка.",
    image: "https://placehold.co/600x800/eab308/fff?text=Efes+Lager",
  },
  {
    name: "Tarkum",
    brandOwner: "Efes Kazakhstan",
    style: "Lager",
    abv: 5.0,
    density: "12.5% плато",
    fermentationType: "Нижнее",
    description: "Традиционный казахстанский лагер — плотное тело, солод, хлеб и лёгкая горечь.",
    image: "https://placehold.co/600x800/d97706/fff?text=Tarkum",
  },
  {
    name: "Efes Wheat",
    brandOwner: "Efes Kazakhstan",
    style: "Wheat",
    abv: 5.2,
    density: "12.2% плато",
    fermentationType: "Верхнее",
    description: "Пшеничное пиво — банан, гвоздика, дрожжевая плотность, мягкое послевкусие.",
    image: "https://placehold.co/600x800/fbbf24/fff?text=Efes+Wheat",
  },
  {
    name: "Efes IPA",
    brandOwner: "Efes Kazakhstan",
    style: "IPA",
    abv: 6.5,
    density: "13.0% плато",
    fermentationType: "Верхнее",
    description: "Американский IPA — цитрус, тропики, хмелевая горчинка и солодовая база.",
    image: "https://placehold.co/600x800/84cc16/fff?text=Efes+IPA",
  },
  {
    name: "Efes Stout",
    brandOwner: "Efes Kazakhstan",
    style: "Stout",
    abv: 5.5,
    density: "13.5% плато",
    fermentationType: "Верхнее",
    description: "Тёмный стаут — кофе, шоколад, обжарка, плотное тело и сухой финиш.",
    image: "https://placehold.co/600x800/451a03/fff?text=Efes+Stout",
  },
];

// ─── Flavor profiles for brands ─────────────────────────────────────────────
// brandIndex (0-based) → { TOP: [noteIndex, intensity], HEART: [...], BASE: [...] }
export interface ProfileSeed {
  brandIndex: number;
  TOP: [number, number][];
  HEART: [number, number][];
  BASE: [number, number][];
}

// Indices into flavorNoteSeeds array
export const profileSeeds: ProfileSeed[] = [
  { // Efes Pilsener (idx 0)
    brandIndex: 0,
    TOP: [[0, 8], [7, 7], [2, 5]],       // Хмелевая свежесть, Освежающий финиш, Цветочный букет
    HEART: [[12, 6], [14, 4], [15, 5]],  // Солодовая плотность, Хлебно-зерновые, Зерновое послевкусие
    BASE: [[25, 8], [26, 4], [41, 6]],   // Хмелевая горчинка, Обжарка, Финиш хмель и солод
  },
  { // Efes Lager (idx 1)
    brandIndex: 1,
    TOP: [[0, 7], [10, 5], [7, 6]],      // Хмелевая свежесть, Свежий хлеб, Освежающий финиш
    HEART: [[12, 7], [13, 5], [16, 5]],  // Солодовая плотность, Карамель, Сладость
    BASE: [[25, 7], [41, 7], [37, 4]],   // Хмелевая горчинка, Финиш, Сухое послевкусие
  },
  { // Tarkum (idx 2)
    brandIndex: 2,
    TOP: [[10, 6], [7, 7], [0, 6]],      // Свежий хлеб, Освежающий финиш, Хмелевая свежесть
    HEART: [[12, 8], [14, 7], [13, 5]],  // Солодовая плотность, Хлебно-зерновые, Карамель
    BASE: [[25, 6], [41, 6], [37, 5]],   // Хмелевая горчинка, Финиш, Сухое послевкусие
  },
  { // Efes Wheat (idx 3)
    brandIndex: 3,
    TOP: [[4, 8], [9, 6], [11, 5]],      // Яблоко и персик, Пряная свежесть, Медовые ноты
    HEART: [[12, 6], [20, 7], [22, 5]],  // Солодовая плотность, Сырная плотность, Молочная сладость
    BASE: [[29, 7], [30, 4], [37, 6]],   // Дрожжевые ноты, Земляные ноты, Сухое послевкусие
  },
  { // Efes IPA (idx 4)
    brandIndex: 4,
    TOP: [[1, 9], [3, 8], [0, 9]],       // Цитрус, Тропические фрукты, Хмелевая свежесть
    HEART: [[12, 5], [21, 4], [24, 4]],  // Солодовая плотность, Горьковатое яблоко, Косточковые фрукты
    BASE: [[25, 9], [37, 5], [41, 5]],   // Хмелевая горчинка, Сухое послевкусие, Финиш
  },
  { // Efes Stout (idx 5)
    brandIndex: 5,
    TOP: [[8, 5], [9, 4], [11, 3]],      // Дымный шлейф, Пряная свежесть, Медовые ноты
    HEART: [[12, 7], [18, 6], [16, 5]],  // Солодовая плотность, Ореховые ноты, Сладость
    BASE: [[26, 8], [27, 8], [28, 7], [37, 6]], // Обжарка, Кофейные ноты, Шоколад, Сухое послевкусие
  },
];

// ─── Serving Recommendations ─────────────────────────────────────────────────
export interface ServingRecSeed {
  brandIndex: number;
  servingTempMin: number;
  servingTempMax: number;
  glassType: string;
  seasonality?: string;
}

export const servingRecSeeds: ServingRecSeed[] = [
  { brandIndex: 0, servingTempMin: 4, servingTempMax: 7, glassType: "Пилснер бокал 0.5л" },
  { brandIndex: 1, servingTempMin: 5, servingTempMax: 8, glassType: "Лагерный бокал 0.5л" },
  { brandIndex: 2, servingTempMin: 5, servingTempMax: 8, glassType: "Лагерный бокал 0.5л" },
  { brandIndex: 3, servingTempMin: 4, servingTempMax: 7, glassType: "Вайцен бокал 0.5л" },
  { brandIndex: 4, servingTempMin: 8, servingTempMax: 12, glassType: "Шамрок / IPA бокал" },
  { brandIndex: 5, servingTempMin: 10, servingTempMax: 13, glassType: "Тапира / Пинта" },
];

// ─── Courses ─────────────────────────────────────────────────────────────────
export interface CourseSeed {
  level: number;
  title: string;
  description: string;
  color: string;
}

export const courseSeeds: CourseSeed[] = [
  {
    level: 1,
    title: "Новичок",
    description: "Базовое знакомство с пивом: стили, крепость, плотность, первые ощущения от вкуса",
    color: "#f59e0b",
  },
  {
    level: 2,
    title: "Исследователь",
    description: "Глубже в пирамиду: распознавание TOP/HEART/BASE нот, хмель vs солод",
    color: "#84cc16",
  },
  {
    level: 3,
    title: "Знаток",
    description: "Food pairing, сезонность, температура подачи, анализ полного профиля",
    color: "#0ea5e9",
  },
  {
    level: 4,
    title: "Сомелье",
    description: "Профессиональный уровень: дегустация вслепую, описание по лексикону FlavorActiV, подбор пива для гостей",
    color: "#8b5cf6",
  },
];

// ─── Team ────────────────────────────────────────────────────────────────────
export interface TeamMemberSeed {
  name: string;
  role: string;
  bio: string;
  avatar?: string;
}

export const teamMemberSeeds: TeamMemberSeed[] = [
  {
    name: "Айгерим Нурланова",
    role: "Основатель / Сомелье",
    bio: "Пивной сомелье, сертифицированный по WSET. 8 лет в индустрии HoReCa, автор методологии Flavor Tree.",
    avatar: "https://placehold.co/200x200/f59e0b/fff?text=А",
  },
  {
    name: "Дамир Сапаров",
    role: "Технолог / Brewmaster",
    bio: "Инженер-технолог пивоварения. Разрабатывает рецептуры и контролирует качество пива для программы Flavor Tree.",
    avatar: "https://placehold.co/200x200/84cc16/fff?text=Д",
  },
  {
    name: "Елена Коваль",
    role: "Food Pairing Specialist",
    bio: "Шеф-повар, специалист по подобию еды и пива. Автор курса «Пивной pairing для ресторанов».",
    avatar: "https://placehold.co/200x200/0ea5e9/fff?text=Е",
  },
  {
    name: "Тимур Ахметов",
    role: "Разработка / Product",
    bio: "Fullstack-разработчик. Строит платформу Flavor Tree — от API до мобильного приложения.",
    avatar: "https://placehold.co/200x200/8b5cf6/fff?text=Т",
  },
];

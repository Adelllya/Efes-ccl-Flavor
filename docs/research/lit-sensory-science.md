# Сенсорная наука взаимодействий вкусов для Flavor Tree Pairing Engine v2

> Литературный обзор (сентябрь 2026). Цель — заменить «интуитивные» веса движка v1 на направленные правила,
> у каждого из которых есть механизм, сила эффекта и ссылка. Всё, что не измерено, помечено как экспертный консенсус.
> Ключи данных — по-английски (`dish.salt`, `drink.astringency` …), чтобы их можно было сразу переносить в код.

## 0. Резюме для инженера

1. **Три эффекта измерены количественно и должны быть ядром формул:** соль подавляет горечь (Breslin & Beauchamp 1997);
   жир и вяжущие полифенолы взаимно гасят друг друга (Peyrot des Gachons & Breslin 2012); сладость/жир/белок/холод
   снижают жжение капсаицина, а этанол его усиливает (Nasrawi & Pangborn 1990; Nolden, Lenart & Hayes 2019; Trevisani et al. 2002).
2. **Правила сомелье про сладкое/умами (Hanni; Brewers Association) — сильный консенсус без чисел**: сладкое или
   умами-доминантное блюдо делает напиток горче, кислее и «тоньше»; соль и кислота в блюде делают напиток мягче.
3. **Аромат-мосты (Ahn et al. 2011, Foodpairing) — слабое основание для скоринга.** Гипотеза общих ароматических
   соединений подтверждена только для североамериканской/западноевропейской кухни; для восточноазиатской и
   южноевропейской она инвертируется; сенсорной валидации почти нет (Spence 2020). Использовать как объяснение и tie-breaker, не как +18.
4. **Температура — измеренный модификатор**: между 20 и 36 °C сладость сахарозы и горечь кофеина растут (до 2×), кислое и
   солёное не меняются, жжение капсаицина растёт с температурой; охлаждение до ~25 °C способно убрать умеренное жжение (Green 1986).
5. **Текущему движку не хватает осей** `acid`, `astringency`, `residual_sugar`, `serve_temp`, `dairy_fat_protein` — без них
   невозможно корректно ранжировать сидр, вино, квас, лимонады, айран, коктейли и крепкое.

## 1. Уровни доказательности

| Уровень | Что это | Как использовать в движке |
|---|---|---|
| **A — количественная психофизика** | Рецензируемые эксперименты с рейтингами интенсивности (gLMS, LMS), модельные растворы, n ≥ 20 | Основные множители правил; направление и относительная сила берутся из данных |
| **B — эксперименты на реальных продуктах** | Панели, оценивающие вино/пиво после еды (сыр, мясо), fMRI | Направление правила и порядок величины |
| **C — экспертный консенсус** | Cicerone, Brewers Association, Master of Wine Tim Hanni, интервью 20 экспертов (Eschevins et al. 2019) | Правила «баланса» и интенсивности; веса калибруются по кураторским парам и реакции гостей |
| **D — гипотеза/данные без сенсорной проверки** | Flavor network (Ahn 2011), Foodpairing GC-MS | Только объяснение «почему», вклад ≤ 5–6 баллов |

## 2. Таблица принципов (направленные правила)

Обозначения: `↑` усиливает, `↓` гасит, `×` взаимодействие; `dish.*` — оси блюда, `drink.*` — оси напитка; «восприятие» — как гость почувствует напиток после укуса.

| ID | Правило | Направление (формула словами) | Сила | Уровень | Источник |
|---|---|---|---|---|---|
| P1 | Salt suppresses bitterness | `dish.salt ↑` → воспринимаемая `drink.bitter ↓`, `drink.astringency ↓`; сладость/солод при этом заметнее | strong | A | Breslin & Beauchamp 1997; Brandão et al. 2020 (Na⁺ и танин-белок) |
| P2 | Sweet food harshens the drink | `dish.sweet > drink.sweet` → напиток кажется горче, кислее, «тоньше»; правило «напиток не менее сладок, чем блюдо» | strong (консенсус) | C | Hanni/IntoWine; Brewers Association guide |
| P3 | Umami food harshens the drink (unless salt/acid) | `dish.umami ↑ ∧ dish.salt ↓ ∧ dish.sour ↓` → `drink.bitter ↑`, `drink.astringency ↑`, металлический привкус | medium | C (лабораторные данные противоречат: в смеси MSG *снижает* горечь) | Hanni; обзор PMC 2026 по MSG-подавлению горечи |
| P4 | Acid & salt in food soften the drink | `dish.sour ↑, dish.salt ↑` → напиток «мягче, круглее»; в комбинации сильнее | medium | C | Hanni/IntoWine |
| P5 | Fat ↔ astringency opponency | `dish.fat × drink.astringency` → взаимное гашение: жир снимает вязкость, вяжущие снимают «скользкость» жира; эффект накапливается при чередовании глотков | strong | A | Peyrot des Gachons … Breslin 2012, Current Biology |
| P6 | Fat/protein reduce drink astringency & bitterness | Съеденный сыр/жирное мясо → `drink.astringency ↓`, `drink.bitter ↓`, фруктовость ↓, маслянистость не меняется | strong (для вина) | B | Madrigal-Galan & Heymann 2006 |
| P7 | Bitterness cuts fat («cut») | `dish.fat × drink.bitter` → палитра «сбрасывается» | medium (консенсус, механизм через P5/P6) | C | Cicerone (Food52), Brewers Association |
| P8 | Carbonation cleanses; but is itself an irritant | `drink.carbonation ↑` → сладость ↓ (fMRI), кислое/горькое восприятие ↑, активация ноцицепторов (TRPA1); «смывание» жира — консенсус | medium | B/C | Di Salle et al. 2013; Clark et al. 2011 (модельное пиво); Carstens et al. 2002 |
| P9 | Ethanol potentiates capsaicin burn | `dish.heat × drink.alcohol` → жжение ↑ (этанол снижает порог TRPV1 с ~42 до ~34 °C) | strong | A (механизм, in vitro + психофизика) | Trevisani et al. 2002, Nature Neuroscience |
| P10 | Sweetness reduces capsaicin burn | `dish.heat × drink.sweet` → жжение ↓ (10 % сахарозы при 20 °C ≈ цельное молоко при 5 °C); эффект не дозозависим — работает *ощущение* сладости | strong | A | Nasrawi & Pangborn 1990 |
| P11 | Fat/protein/cold reduce capsaicin burn | Молоко (цельное и обезжиренное) > сладкий напиток > кола/газировка/б/а пиво/вода; белок важнее жира; холод усиливает эффект | strong | A | Nolden, Lenart & Hayes 2019; Gaiser et al. 2024; Green 1986 |
| P12 | Carbonation does not soothe heat | Сельтерская снижает жжение не лучше воды; CO₂ активирует ноцицепторы → в движке `carbonation` **не** должна быть «успокоителем» остроты | medium | A | Nolden et al. 2019; Carstens et al. 2002 |
| P13 | Hop bitterness × heat | `dish.heat × drink.bitter` → взаимное усиление (по мнению экспертов); лабораторно капсаицин сам вызывает горечь и усиливает горечь хинина на части языка, но также подавляет вкусы после экспозиции | contested | C + частично A | Garneau/CraftBeer.com; Green & Hayes 2003; Prescott & Stevenson 1995 |
| P14 | Intensity matching | `|I_drink − I_dish|` минимизировать; ни один не должен «перекрикивать» | strong (консенсус, не измерено) | C | Brewers Association; Cicerone; Eschevins et al. 2019 |
| P15 | Shared-aroma bridge | Общие ключевые одоранты → «мост»; работает статистически для NA/WE кухонь, инвертирован для восточноазиатской и южноевропейской; нет сенсорной валидации | weak | D | Ahn et al. 2011; Foodpairing; Spence 2020 |
| P16 | Temperature modulates taste | 20→36 °C: сладость и горечь (кофеин) ↑ до ~100 %, кислое/солёное ≈ const; жжение капсаицина ↑ с температурой | strong | A | Green & Frankmann 1987/88; Bartoshuk 1982; Green 1986 (NCBI NBK236241) |
| P17 | Low pH raises astringency | pH ↓ → интенсивность и длительность вяжущести ↑ (в вине и модельных растворах) | strong (для напитка), medium (экстраполяция на кислое блюдо + танинный напиток) | A | Kallithraka, Bakker & Clifford 1997 |
| P18 | Drink acidity ≥ dish acidity | Кислое блюдо делает менее кислый напиток «плоским»; нужен напиток с кислотностью/карбонизацией не ниже блюда | medium | C | Hanni; консенсус винной педагогики |
| P19 | Ethanol = bitter-sweet + burn | При низких концентрациях этанол воспринимается как горечь, при высоких — жжение; крепкие напитки на сладком блюде кажутся резче (через P2) | medium | A | Nolden & Hayes 2016 (PubMed 27594968) |
| P20 | Individual bitterness sensitivity | PROP-тестеры воспринимают горечь и жжение сильнее — персональная ось `bitter_pref` оправдана | medium | A | Lanier, Hayes & Duffy 2005; Prescott & Stevenson |

## 3. Подробности по ключевым взаимодействиям

### 3.1 Соль × горечь (P1)
Breslin & Beauchamp (Nature 387:563, 1997) показали, что NaCl *селективно фильтрует* вкусы: горечь (мочевина, хинин)
подавляется сильнее, чем сладость, поэтому солёное блюдо делает солод и фруктовость напитка заметнее, а хмелевую
горечь — мягче. Эффект измерен на модельных растворах; для пива это означает, что курт, солёные орехи, брецель
**расширяют** допустимый диапазон IBU, а не просто «утоляют жажду». Na⁺ дополнительно мешает связыванию танинов
с белками (Brandão 2020) → соль снижает и вяжущесть. **В движке:** множитель `salt_softening = 1 − k·dish.salt`,
применяемый к штрафу за горечь/вяжущесть (k ≈ 0.4–0.5 по порядку величины; точную калибровку из литературы взять нельзя).

### 3.2 Сладкое и умами в блюде → напиток резче (P2, P3)
Tim Hanni (MW): «Sweetness and umami dominating the food will make wine taste more bitter, astringent and acidic», «salt and
acidity dominating a dish will make wine taste more mild». Демонстрация: спаржа + Shiraz — «bitter and acidic», после соли и
лимона — «smooth and delicious». Чисел нет. Механизм — адаптация и контраст: после сладкого сладость напитка воспринимается
ниже, обнажая горечь/кислоту. **Внимание:** лабораторно MSG в *одновременной* смеси **снижает** горечь хинина/мочевины
(обзор PMC13517633, 2026; Reading 2021). Противоречие объясняется последовательностью (еда → напиток) и
тем, что «умами-блюда» экспертов (спаржа, яйцо, гриб) одновременно низкосолёные. Правило должно быть условным:
штраф за умами применять только при `dish.salt < 0.4 ∧ dish.sour < 0.3` и только к горьким/танинным напиткам.

### 3.3 Жир × вяжущесть × карбонизация × горечь (P5–P8)
Самое надёжное — **опонентность жира и вяжущести** (Current Biology 22:R829, 2012): чередование сушёного мяса с
слабовяжущими растворами (экстракт виноградной косточки, зелёный чай, сульфат алюминия) снижало «скользкость» жира,
а жир снижал вяжущесть; эффект аккумулируется по глоткам. Madrigal-Galan & Heymann (AJEV 2006) на панели показали, что сыр
перед вином снижает вяжущесть, дубовость, ягодность и аромат, но не маслянистость. Для пива это означает: «cut» через
хмелевые/солодовые полифенолы (вяжущесть) обоснован; «cut» через чистую *горечь* — консенсус без прямых измерений; «cut»
карбонизацией — консенсус, при этом CO₂ снижает восприятие сладости (Di Salle 2013, fMRI), усиливает кислое/горькое и
активирует ноцицепторы (карбонация — трайгеминальный раздражитель). **В движке:** ввести `drink.astringency` и считать
`cut = dish.fat × (0.5·astringency + 0.3·bitter + 0.2·carbonation)`, а не 0.55·bitter + 0.45·carbonation.

### 3.4 Острота (P9–P13)
- Этанол потенцирует TRPV1 и снижает порог тепловой активации с ~42 до ~34 °C (Trevisani 2002) → крепкое и высокоалкогольное пиво усиливают жжение.
- 10 % сахароза при 20 °C = цельное молоко при 5 °C по снижению жжения; 5 °C эффективнее 20 °C; эффект не дозозависим (Nasrawi & Pangborn 1990).
- Nolden et al. 2019 (n = 72, gLMS, AUC 2 мин): все напитки снижали жжение томатного сока с капсаицином; лучшие — цельное и обезжиренное молоко и сладкий Kool-Aid; сельтерская, кола, безалкогольное пиво, вода — хуже; белок важнее жира. Gaiser 2024: жир, белок и низкая температура вносят независимый вклад.
- Экспертное мнение (Garneau, CraftBeer.com): хмель × капсаицин × алкоголь × карбонация усиливают друг друга; автор признаёт, что рецензируемых исследований «сладкое гасит острое» она не нашла — но они есть (Nasrawi & Pangborn), а вот «горечь усиливает жжение» остаётся спорным.
**В движке:** `heat_relief = dish.heat × (0.35·drink.sweet + 0.30·drink.dairy + 0.20·cold_serve + 0.15·drink.body)`;
`heat_penalty = dish.heat × (0.45·drink.alcohol + 0.25·drink.bitter + 0.15·drink.carbonation + 0.15·drink.astringency)`. Айран/шубат и молочные коктейли получают максимальный `dairy`.

### 3.5 Температура (P16)
Green & Frankmann: сладость сахарозы и горечь кофеина растут с температурой раствора между 20 и 36 °C (до +100 % при
больших сдвигах температуры языка), кислое и солёное — нет; жжение капсаицина прямо зависит от температуры, охлаждение
до ~25 °C способно полностью убрать умеренное жжение. Cruz & Green (Nature 2000): само согревание языка вызывает сладость,
охлаждение — кислое/солёное. **Следствия:** ледяной лагер кажется менее горьким и менее сладким («чище»); тёплый десертный
напиток (глинтвейн, стаут комнатной температуры) — слаще и горче одновременно. Ось `drink.serve_temp` нужна.

### 3.6 Аромат-мосты (P15)
Ahn, Ahnert, Bagrow & Barabási (Sci. Rep. 1:196, 2011): 381 ингредиент, 1 021 соединение, 56 498 рецептов, 5 кухонь.
Североамериканская и западноевропейская кухни используют пары с общими соединениями чаще случайного (Z > 0), восточноазиатская и
южноевропейская — реже (Z < 0); эффект держится на 13 (NA) и 5 (EA) ингредиентах — удаление их роняет Z ниже 2.
Foodpairing.com: GC-MS → ключевые одоранты → совместимость по перекрытию аромапрофилей среди 1 700+ ингредиентов;
сами авторы подчёркивают, что вкус и текстура должны балансироваться отдельно. Spence (Food Res. Int. 2020) —
гипотеза «интеллектуально привлекательна», но без надёжной сенсорной валидации; часть парности — культурная. Казахская
и среднеазиатская кухня (баранина, зира, лук, тесто, кисломолочное) в датасете отсутствует → мосты применять с осторожностью.
**В движке:** `bridge ≤ +6`, только как объяснение, не как решающий вклад.

## 4. Что измерено количественно, а что — консенсус

| Измерено (пороги, шкалы) | Экспертный консенсус |
|---|---|
| Соль ↓ горечь селективно (Breslin 1997) | «Соль будит жажду, пузырьки утоляют» |
| Жир ↔ вяжущесть, накопление по глоткам (Breslin 2012) | Горечь «режет» жир |
| Сыр ↓ вяжущесть/горечь вина (Heymann 2006) | Карбонизация «смывает» жир |
| Этанол ↓ порог TRPV1 42→34 °C (Trevisani 2002) | Хмель усиливает остроту |
| 10 % сахароза ≈ молоко 5 °C против жжения; холод > тепло (Nasrawi 1990) | Совпадение интенсивности |
| Молоко > сладкое > газировка/вода, n = 72, gLMS (Nolden 2019) | Сладкое блюдо делает напиток горче/кислее (Hanni) |
| CO₂ ↓ нейронный ответ на сахарозу (Di Salle 2013) | Умами делает вино горьким/металлическим (Hanni) |
| Температура: сладость/горечь ↑ 20→36 °C (Green & Frankmann) | Мосты по ароматам (Ahn — статистика, не сенсорика) |
| pH ↓ → вяжущесть ↑ (Kallithraka 1997) | Напиток не кислее/не слаще блюда |
| MSG ↓ горечь в смеси (PMC 2026) | «15 принципов» экспертов (Eschevins 2019) |

## 5. Предлагаемые оси

### 5.1 Напиток (единая схема для 200+ позиций всех категорий)
`sweet` (residual sugar, г/л → 0..1) · `acid` (pH/TA → 0..1) · `bitter` (IBU или экспертная шкала) · `astringency` (танин/полифенолы) ·
`carbonation` (vol CO₂) · `alcohol` (ABV) · `body` (экстракт/вязкость) · `dairy` (жир+белок молочной основы: айран, шубат, молочные коктейли, милк-стаут) ·
`salt` (айран, мичелада) · `umami` (томатный сок, саке) · `serve_temp` (°C) · `intensity` (композит) · аромат-семейства
`aroma.{roast, caramel_malt, hop_herbal, citrus, stone_fruit, apple_pear, berry, floral, spice_phenolic, smoke, dairy_cream, honey, nutty}` · `category`.

### 5.2 Блюдо
`salt` · `sweet` · `sour` · `bitter` · `umami` · `fat` · `protein` · `heat` (капсаицин) · `pungent` (лук/чеснок/горчица/хрен — TRPA1, другой рецептор) ·
`astringency` (грецкий орех, гранат, зелень) · `temp` (подаётся горячим/холодным) · `texture.{crisp, creamy, chewy}` · `maillard` · `smoke` · `weight` ·
`cream_dairy` · `cuisine` (для взвешивания P15) · аромат-семейства с теми же ключами, что у напитка.

## 6. Эталонные пары и анти-пары (тест-кейсы)

| Блюдо | Напиток | Верdict | Почему (правило) |
|---|---|---|---|
| Курт / солёные орехи / брецель | Pilsner (горький лагер) | good | P1: соль снимает горечь, солод ярче |
| Бешбармак (жирная баранина, тесто, соль) | Amber/dark lager, венское | good | P14 + P5/P7: жир × полифенолы/горечь; соль смягчает |
| Бешбармак | Rice lager 4 %, лёгкий | bad | P14: напиток теряется |
| Казы (копчёная конина, жир) | Porter / rauchbier / крепкий чёрный чай | good | P5 (жир × вяжущесть), P15 (дым/обжарка) |
| Лагман острый / буффало-крылья | Helles / amber lager с солодом, айран | good | P10, P11: сладость, молочный белок, холод |
| Острое блюдо | IPA 6.5 % высокий IBU | bad | P9 + P13: этанол и хмель усиливают жжение |
| Острое блюдо | Виски / водка neat | bad | P9 (этанол потенцирует TRPV1) |
| Острое блюдо | Сельтерская / содовая | neutral-weak | P12: не лучше воды |
| Чак-чак / баурсаки с мёдом | Milk stout, сладкий сидр, десертное вино | good | P2: напиток ≥ десерта по сладости |
| Чак-чак | Сухой пилснер / брют | bad | P2: напиток покажется горьким и водянистым |
| Спаржа / яйцо / грибы без соли | Танинное красное (Shiraz), IPA | bad | P3: умами без соли → горечь, металл |
| Выдержанный сыр | Танинное красное / IPA | good | P6: жир и белок снижают вяжущесть и горечь |
| Самса / чебуреки (фритюр) | Карбонизированный лагер, квас | good | P8 (консенсус cut), P14 |
| Суши / сашими | Rice lager, чистый лагер, сухое саке | good | P14, деликатность; без обжарки |
| Суши / сашими | Стаут / IPA | bad | P3 + P14: металл, перекрикивание |
| Шашлык (Maillard, дым, жир) | Bock / amber lager; красное с танином | good | P5, P15 (карамель ↔ корочка) |
| Шоколадный десерт | Stout / porter | good | P2 + P15 (обжарка ↔ какао) |
| Салат с уксусной заправкой | Сидр брют, сауэр-эль, лимонад, игристое | good | P18: кислотность напитка ≥ блюда |
| Салат с уксусом | Тяжёлый малокислотный бок | bad | P18: напиток «плоский» |
| Плов (жирный рис, зира) | Amber lager; зелёный чай | good | P5 (чай — вяжущесть), P14 |
| Манты со сметаной | Pilsner; квас | good | P7/P8: горечь и пузырьки против жира и сливок |
| Вобла / солёная рыба | Lager | good | P1 + классика |
| Том-ям (кисло-остро) | Пшеничное / лимонад холодный | good | P10, P11, P18 |

## 7. Критика текущего движка (v1) с точки зрения литературы

1. **Нет осей `acid`, `astringency`, `sweet` (residual), `serve_temp`, `dairy`** — а именно они несут самые сильные измеренные эффекты (P5, P6, P10, P11, P16, P17). `malt_sweet` у лагеров — это солодовость, а не остаточный сахар; для сидра/вина/лимонада ось неприменима.
2. **R2 cut = 0.55·bitter + 0.45·carbonation** — противоположно иерархии доказательств: измерена опонентность *вяжущесть × жир*; горечь и карбонизация — консенсус. Вяжущесть в движке отсутствует.
3. **R3 heat считает карбонизацию успокоителем (+8)**, тогда как сельтерская не лучше воды (Nolden 2019), а CO₂ сам раздражитель; нет вклада молочного белка/жира (айран!) и температуры подачи; веса 14/8/6 и 16/14 не выведены из данных.
4. **R4 salt даёт бонус карбонизации (6) и солоду (5) больше, чем горечи (3)** — тогда как главный измеренный эффект соли — подавление горечи. Соль должна *снижать штрафы* за горечь/вяжущесть у любого напитка, а не начислять баллы «за классику».
5. **R7 umami награждает солод/тело**, но не моделирует условие Hanni (умами без соли/кислоты → горечь/металл). Штраф только за хмель > 0.6 и только при малом жире — модераторы `salt`, `sour` не учтены.
6. **R10 bridge до +18** — вклад больше, чем у измеренных эффектов, при слабейшей доказательной базе (Ahn: культурно-зависимо; Spence: нет сенсорной валидации). Ограничить +6 и использовать как текст.
7. **R11 curated ±16 на 51 паре** фактически переопределяет алгоритм — кураторские пары лучше держать как тест-сет (golden), а не как правило.
8. **R1 intensity: веса композитов (0.30·body + 0.25·bitter …) произвольны**; в литературе нет формулы — это консенсус, но тогда нужны хотя бы ранжирующие тесты с экспертами.
9. **Нет «жёстких вето»**: десерт слаще напитка, острое × крепкое — пары должны получать потолок оценки, а не мягкий минус на фоне +30 базы (медиана 65 делает почти всё «хорошим»).
10. **Последовательность не моделируется**: правила Hanni — про «еда, затем напиток» (адаптация); лабораторные смеси — про одновременность. Движку нужен явный режим «глоток после укуса».
11. **Температура подачи и индивидуальная чувствительность (PROP)** не учтены; `bitter_pref` — правильная идея, но должна модулировать и `heat_penalty`.
12. **Коллинеарность**: `fat` входит в intensity, cut и модератор umami — эффект жира считается трижды.

## 8. Источники

1. Breslin P.A.S., Beauchamp G.K. Salt enhances flavour by suppressing bitterness. Nature 387:563 (1997). https://www.nature.com/articles/42388
2. Peyrot des Gachons C., Mura E., Speziale C., Favreau C.J., Dubreuil G.F., Breslin P.A.S. Opponency of astringent and fat sensations. Current Biology 22(19):R829–R830 (2012). https://www.cell.com/current-biology/fulltext/S0960-9822(12)00945-1 ; пресс-релиз: https://www.sciencedaily.com/releases/2012/10/121008134215.htm
3. Madrigal-Galan B., Heymann H. Sensory Effects of Consuming Cheese Prior to Evaluating Red Wine Flavor. Am. J. Enol. Vitic. 57(1):12–22 (2006). https://www.ajevonline.org/content/57/1/12
4. Trevisani M. et al. Ethanol elicits and potentiates nociceptor responses via the vanilloid receptor-1. Nature Neuroscience 5:546 (2002). https://pubmed.ncbi.nlm.nih.gov/11992116/
5. Nasrawi C.W., Pangborn R.M. Temporal effectiveness of mouth-rinsing on capsaicin mouth-burn. Physiology & Behavior 47(4):617–623 (1990). https://pubmed.ncbi.nlm.nih.gov/2385629/
6. Nolden A.A., Lenart G., Hayes J.E. Putting out the fire – Efficacy of common beverages in reducing oral burn from capsaicin. Physiology & Behavior 208:112557 (2019). https://www.sciencedirect.com/science/article/abs/pii/S0031938419301453
7. Gaiser et al. Fat, protein, and temperature each contribute to reductions in capsaicin oral burn. J. Food Science (2024). https://ift.onlinelibrary.wiley.com/doi/10.1111/1750-3841.17221
8. Di Salle F. et al. Effect of Carbonation on Brain Processing of Sweet Stimuli in Humans. Gastroenterology 145(3):537–539 (2013). https://pubmed.ncbi.nlm.nih.gov/23714381/
9. Carstens E. et al. It hurts so good: oral irritation by spices and carbonated drinks and the underlying neural mechanisms. Food Quality and Preference 13 (2002). https://www.sciencedirect.com/science/article/abs/pii/S0950329301000672
10. Clark R.A. et al. The Interactions of CO2, Ethanol, Hop Acids and Sweetener on Flavour Perception in a Model Beer. Chemosensory Perception 4 (2011). https://link.springer.com/article/10.1007/s12078-011-9087-3 (полный текст не загружен; по аннотации из поиска: CO₂ подавляет сладость и меняет горечь)
11. Nutritional Needs in Hot Environments, гл. «Heat as a Factor in the Perception of Taste, Smell, and Oral Sensation» (Green & Frankmann 1987/88; Bartoshuk 1982; Green 1986). https://www.ncbi.nlm.nih.gov/books/NBK236241/
12. Cruz A., Green B.G. Thermal stimulation of taste. Nature 403:889 (2000). https://www.nature.com/articles/35002581
13. Kallithraka S., Bakker J., Clifford M.N. Red Wine and Model Wine Astringency as Affected by Malic and Lactic Acid. J. Food Science 62 (1997). https://ift.onlinelibrary.wiley.com/doi/10.1111/j.1365-2621.1997.tb04016.x
14. Ahn Y.-Y., Ahnert S.E., Bagrow J.P., Barabási A.-L. Flavor network and the principles of food pairing. Scientific Reports 1:196 (2011). https://www.nature.com/articles/srep00196 ; arXiv: https://arxiv.org/pdf/1111.6074
15. Spence C. Food and beverage flavour pairing: A critical review of the literature. Food Research International 133:109124 (2020). https://ora.ox.ac.uk/objects/uuid:d9e3a3ea-0ffb-4bf6-b355-5e7673d5d0bb
16. Foodpairing.com. The science behind great ingredient pairings. https://www.foodpairing.com/the-science-behind-great-ingredient-pairings/
17. Eschevins A., Giboreau A., Julien P., Dacremont C. From expert knowledge and sensory science to a general model of food and beverage pairing with wine and beer. Int. J. Gastronomy and Food Science 17:100144 (2019). https://doi.org/10.1016/j.ijgfs.2019.100144
18. IntoWine. Revolutionary Pairing Theory Developed by Rebel Master of Wine, Tim Hanni. https://www.intowine.com/revolutionary-pairing-theory-developed-rebel-master-wine-tim-hanni
19. Brewers Association. Craft Beer and Food Pairing Guide. https://www.brewersassociation.org/educational-publications/craft-beer-and-food-pairing-guide/ ; CraftBeer.com «Unscrambling Your Senses»: https://www.craftbeer.com/craft-beer-muses/the-sensory-side-of-craft-beer-pairing
20. Food52. How to Pair Beer With Food, According to a Master Cicerone. https://food52.com/story/how-to-pair-beer-with-food
21. Garneau N. Science Says You're Wrong About Pairing IPAs and Spicy Foods. CraftBeer.com. https://www.craftbeer.com/beer-and-food/science-says-youre-wrong-about-pairing-ipas-and-spicy-foods
22. Taste Modulation by Umami Compounds: Mechanisms, Sensor-Based Evaluation, and Pharmaceutical Applications in Bitterness Suppression. Sensors 26(16):5073 (2026). https://pmc.ncbi.nlm.nih.gov/articles/PMC13517633/
23. Interactions of umami with the four other basic tastes in equi-intense aqueous solutions. Food Quality and Preference (2021). https://www.sciencedirect.com/science/article/abs/pii/S0950329321003852 (аннотация недоступна для загрузки; по поисковой выдержке: умами усиливает сладкое/солёное, подавляет кислое и горькое)
24. Nolden A.A., Hayes J.E. Perceptual Qualities of Ethanol Depend on Concentration… Chemical Senses (2016). https://pubmed.ncbi.nlm.nih.gov/27594968/
25. Lanier S.A., Hayes J.E., Duffy V.B. Sweet and bitter tastes of alcoholic beverages mediate alcohol intake in of-age undergraduates. Physiology & Behavior 83 (2005). https://www.sciencedirect.com/science/article/abs/pii/S0031938404004536
26. Green B.G., Hayes J.E. Capsaicin as a probe of the relationship between bitter taste and chemesthesis. Physiology & Behavior 79 (2003). https://www.sciencedirect.com/science/article/abs/pii/S0031938403002130
27. Brandão E. et al. (2020) — о влиянии Na⁺ на взаимодействие танин–полисахарид, цит. по обзору «Sodium Reduction Through Sensory Interactions With NaCl». https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12231224/

### Чего в литературе НЕ найдено (честно)
- Численной формулы «совпадения интенсивности» — только консенсус.
- Прямого измерения «горечь хмеля режет жир» и «карбонизация смывает жир» — только консенсус и косвенные механизмы.
- Сенсорной проверки аромат-мостов для казахской/среднеазиатской кухни — датасеты Ahn и Foodpairing её не покрывают.
- Пороговых значений для правила «напиток не слаще/не кислее блюда» — только качественные формулировки.

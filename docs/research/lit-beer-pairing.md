# Пивной фуд-пейринг у признанных дегустаторов — литературный разбор для движка Flavor Tree

> Дата: 2026-09-18. Цель: вывести правила подбора напитка к еде из работ реальных экспертов
> (Garrett Oliver, Randy Mosher, Cicerone, Brewers Association, Julia Herz, Charlie Papazian, BJCP,
> русскоязычные сомелье) в виде формул «что с чем усиливает / гасит / режет», собрать эталонные и
> анти-пары как будущие тесты, и покритиковать текущий движок (`docs/PAIRING_ENGINE.md`, `backend/api/pairing/engine.py`).
>
> Честность про источники: тексты книг Оливера («The Brewmaster's Table») и Мошера («Tasting Beer»)
> целиком онлайн недоступны — использованы авторские статьи тех же людей (Oxford Companion to Beer — статья
> Оливера; «Flavor Fever» — статья Мошера в Craft Beer & Brewing), большие интервью/конспекты и официальное
> пособие Brewers Association. Книга Herz & Conley «Beer Pairing» — по рецензиям и статье самой Herz на
> CraftBeer.com. Официальный syllabus Cicerone по URL не открылся (404), профильная статья Profibeer вернула
> «request denied» — их содержание ниже НЕ цитируется. Численные пороги, которых у экспертов нет, помечены как
> «наша оценка».

---

## 1. Как эксперты думают о пейринге: общая рамка

Все источники сходятся на одной последовательности:

1. **Сначала интенсивность.** «Match strength with strength… Intensity of flavor may involve many aspects:
   alcoholic strength, malt character, hop bitterness, sweetness, richness, roastiness» (Brewers Association,
   «American Craft Beer and Food: Perfect Companions», с. 4). Оливер: «Match the impact of the beer to the impact
   of the food. We're looking to create a dance, not a football tackle» (All About Beer). Мошер: «You try to avoid the
   Bambi vs. Godzilla effect. Bud Light and chocolate cake… will be a disaster» (Cheese Professor). Романовский (ОНТ):
   «Лёгкое пиво требует деликатных закусок, иначе его вкус просто потеряется».
2. **Потом «3C»: Complement / Contrast / Cut** — Cicerone-фреймворк базового уровня. На Advanced/Master уровне
   Cicerone требует объяснять взаимодействия глаголами **accentuate / soften / cancel** и использует схему
   **ATE — Analyze the flavors → Think through the interactions → Evaluate** (Cicerone blog «Exam Tactics»).
   Пример «сильного» ответа из того же поста: «The pork belly soy marinade contributes umami and salt, which
   accentuates the malt sweetness. That malt sweetness soothes the heat from jalapeno peppers. The fresh cilantro is
   almost lemon-pepper-like, drawing out the lime and orange peel hop character in the beer.» Это ровно тот формат
   «reasons», который должен генерировать движок.
3. **И complement, и contrast одновременно.** BA: «All beer and food combinations should involve both of these
   principles». Оливер (Oxford Companion / интервью): пиво уникально тем, что делает «contrast and harmony at the same
   time» — карамель/обжарка гармонируют со стейком, а горечь, сладость и фруктовость дают контраст.
4. **«Мост» (flavor hook / bridge).** Оливер: «The flavor hook is the part of the beer's flavor and aroma that matches,
   harmonizes or accentuates the flavors in your food». Herz & Conley ставят intensity и bridges «just as important»,
   как 3C (рецензия PorchDrinking).
5. **Итог — «ребёнок», а не «брак».** Papazian: «Food and craft beer is not about the marriage — it is about the child»:
   оценивается новое ощущение, возникшее в паре, а не сумма двух.

Ключевая таблица взаимодействий из пособия Brewers Association (с. 4, воспроизведена дословно по структуре):

| Компонент пива | Взаимодействие | Компонент еды |
|---|---|---|
| Hop Bitterness, Roasted Malt, Carbonation, Alcohol | **Balances** | Sweetness, Richness (fat) |
| Sweetness, Maltiness | **Balances** | Spiciness (chili heat), Acidity |
| Hop Bitterness | **Emphasizes** | Spiciness (chili heat) |

---

## 2. Принципы как формулы

Обозначения: `↑` усиливает, `↓` гасит/режет, `≈` гармония/мост. Сила: strong — совпадают ≥3 независимых
эксперта и/или есть сенсорная наука; medium — 1–2 эксперта; contested — эксперты расходятся.

| ID | Принцип | Формула | Сила | Источники |
|---|---|---|---|---|
| P1 | Intensity match | `score ∝ −|I_drink − I_dish|`; I включает ABV, солод, горечь, сладость, жирность, обжарку | strong | BA с.4; Oliver; Mosher; Романовский |
| P2 | Bitter cuts fat | `bitter_drink ↓ fat/richness_dish` («Hops slice cleanly through oils and fats» — Oliver; «Bitter cuts sweet, and bitter cuts fat» — Mosher) | strong | Oliver; Mosher; Herz; pivoman |
| P3 | Carbonation cleanses | `CO2 ↓ fat, cream, mouth-coating` («Carbonation… cutting power against fats… can make even very heavy dishes such as cassoulet seem far lighter» — Oliver, Oxford Companion) | strong | Oliver; Storton; BA; pivoman |
| P4 | Roast & alcohol balance richness | `roast_drink ↓ richness`, `alcohol_drink ↓ richness/sweet` (таблица BA) | medium | BA с.4; Mosher (roasty reduces sweet & fat) |
| P5 | Sweet soothes heat | `malt_sweet/residual_sugar ↓ chili_heat` («солодовая сладость понижает остроту пищи» — pivoman; BA; Hastings) | strong | BA; pivoman; Hastings; Sam Adams panel |
| P6 | Bitter & alcohol emphasize heat | `bitter ↑ chili_heat`, `alcohol ↑ chili_heat`; но «хмелевая горечь приятно подчёркивает острую пищу» (pivoman) — приятно или нет, зависит от гостя и дозы | strong (эффект), contested (желательность) | BA «Emphasizes»; CraftBeer.com (Sam Adams panel: 8.4 %/85 IBU ↑ heat, 6.5 %/45 IBU ↓ heat, 4.5 %/45 IBU — жжение дольше); Alcohol Professor (IPA «noticeable spike in the heat»); Oliver («bitterness can intensify flavors in a pleasant fashion») |
| P7 | Carbonation vs heat | Herz/Hastings: пузырьки «cleanse», реально помогают; CraftBeer.com (Sam Adams-панель): «carbonation is shown to activate pain receptors at certain concentrations» | contested | Hastings; CraftBeer.com |
| P8 | Salt suppresses bitterness | `salt_dish ↓ bitter_drink` (сенсорная наука: Breslin & Beauchamp 1995 — Na⁺ подавляет горечь урея/хинина/кофеина, до 70 %, без обратного подавления солёности) | strong | Breslin 1995; Beer & Brewing («Salt reduces the bitterness of beer»); pivoman («солёная пища снижает кислотность в пиве») |
| P9 | Acid cuts salt | `acid_drink ↓ salt_dish` («Acidic calms salt… creates a cleanness» — Herz) | medium | Herz |
| P10 | Sweet calms sweet / bitter calms sweet | десерт: либо `sugar_drink ≥ sugar_dish` (Herz «Sweet calms sweet»), либо очень интенсивная горечь как контраст (BA: «Super-sweet items such as cheesecake, crème brulée or carrot cake… with highly hopped beers such as double IPAs»); всегда при P1 | strong | BA с.7; Herz; pivoman («сладость в пиве и сладость в еде понижают общий уровень сладости») |
| P11 | Umami elevation | `umami_dish ↑ при acid/salt/bitter_drink`; «Umami often subdues sour/acidity, bitter and sweet» и «is elevated by sour/acidity, salt and bitterness» (Papazian); «Umami complements umami» (Herz); «complex acidity of roasted grains in dark beer help elevate» умами | medium | Papazian; Herz; Beer & Brewing (грибы ↔ roasty dark ales) |
| P12 | Maillard/caramel harmony | `caramel_malt ≈ seared/roasted/grilled crust`; `roast_malt ≈ char, chocolate, coffee` («Chocolate loves a dark beer» — BA) | strong | Oliver (brown ale ↔ burgers, pork roast, steak); BA; pivoman |
| P13 | Smoke ≈ smoke | `smoke_drink ≈ smoke_dish` (Rauchbier ↔ smoked meats, smoked porter ↔ smoked cheese) — мост через дым, а НЕ через хмель | strong | Oliver; BA с.7; pivoman |
| P14 | Aroma hook / bridge | общие ароматические семейства: цитрус хмеля ↔ лайм/цедра (Oliver: «citrus hook»: APA ↔ Thai/Mexican с лаймом; witbier ↔ сибас с мандарином); травяной noble hop ↔ зелень; банан/гвоздика weissbier ↔ сливочное/пряное; фруктовые эфиры ↔ фруктовые десерты; Mosher: терпеноиды и продукты Майяра как общие молекулы | strong | Oliver; Mosher «Flavor Fever»; Cicerone exam example; Романовский («синергия») |
| P15 | Delicate needs clean & low-bitter | `fresh/raw/delicate_dish → низкая горечь, лёгкое тело, высокая карбонизация` (BA: аперитив — «light in body and aren't aggressively bitter»; hefeweizen/wheat ↔ salads, seafood, sushi) | strong | BA с.6, 8; Сахаров (drinktime); Романовский |
| P16 | Intense beers overpower food | `ABV ≥ ~9 % / IBU ≥ ~70` → barley wine, imperial stout, DIPA «easily overpowers most main dishes» — только сыр/десерт | strong | BA chart №12, 16; Hop Culture (DIPA «dominate entirely») |
| P17 | Regional | «What grows together goes together»: schnitzel + pale lager, weisswurst + hefeweizen, mussels + witbier, oysters + stout | medium | BA с.5; Storton; Oliver |
| P18 | Serving temp & order | лёгкие 4.5–7 °C, средние 7–10 °C, крепкие/тёмные 10–13 °C (таблица BA с.9); подавать от лёгкого к тяжёлому: «A delicate beer that follows a blockbuster is not likely to show its best» (Oliver) | medium | BA; Oliver |
| P19 | Sour ↔ sour / fat | кислое пиво (и сидр/вино) режет жир; «кислотные пива и пища взаимно снижают общую кислотность» (pivoman); анти: «сладкие компоненты не сочетают с кислотными» | medium | pivoman; Storton (gueuze/gose ↔ Parmesan) |
| P20 | Cheese: carbonation melts coating | «Carbonation allows the coatings to melt in the mouth» (Oliver); интенсивность сыра диктует пиво (Stilton → barley wine) | strong | Oliver; BA с.7; Storton |

**Чего у экспертов НЕТ:** численных шкал вида «на 10 IBU минус столько-то». Единственные цифры —
BJCP vital statistics (IBU/SRM/ABV/OG/FG по стилю), диапазоны температуры в таблице BA и три образца
Sam Adams-панели (4.5 %/45 IBU, 6.5 %/45 IBU, 8.4 %/85 IBU). Все коэффициенты в движке — наша калибровка,
и её надо помечать как таковую.

---

## 3. Кейс «IPA + острое»: кто за, кто против

| Позиция | Кто | Аргумент |
|---|---|---|
| ЗА | Brewers Association (chart №4: IPA — «Strong, spicy food (classic with curry!)»); Julia Herz («residual sugar in the beer»); Garrett Oliver (IPA ↔ Thai/Indian, «bitterness can intensify flavors in a pleasant fashion without clashing»); Hop Culture | Интенсивность совпадает; остаточный сахар и фруктовый хмель дают мост с лаймом/имбирём/кориандром |
| ПРОТИВ | CraftBeer.com «Science says you're wrong…» (Sam Adams-панель с CIA: 8.4 %/85 IBU ↑ жжение); Alcohol Professor (тест с 5 соусами: IPA — «spike in the heat… didn't let go», пилснер/амбер — нейтрально/облегчение); Daily Meal (капсаицин × альфа-кислоты — «feedback loop»); Hastings («it's a bit of a misconception that beer always tempers spice») | Горечь и алкоголь — раздражители, суммируются с капсаицином; после пива жжение не уходит |
| Компромисс | Hastings, Sam Adams-панель | Session/средний IPA (≤6.5 %, ≤45 IBU) с солодовой сладостью ↓ heat; milkshake IPA с лактозой; DIPA — нет |

Вывод для движка: правило heat должно быть **функцией дозы** (IBU и ABV), а не «стиль = IPA». При IBU ≤ 45 и
ABV ≤ 6.5 % горечь — нейтральна или мост (цитрус); при IBU ≥ 70 или ABV ≥ 8 % — штраф. Порог «наша оценка» по
панели Sam Adams. Помимо этого — предпочтение гостя (`heat_lover`): те, кто любит «горячее», должны получать
IPA как контраст, а не штраф (Оливер).

---

## 4. Эталонные пары и анти-пары из источников (кандидаты в тесты)

| # | Блюдо | Напиток | Почему | Источник | Анти? |
|---|---|---|---|---|---|
| 1 | Сырые устрицы | Dry stout | Классика (регион/контраст: обжарка + минеральность) | BA chart №14; BA с.5 | |
| 2 | Мидии на пару | Witbier | «classic with steamed mussels» — регион, цитрус/кориандр | BA chart №19 | |
| 3 | Weisswurst | Hefeweizen | Регион; банан/гвоздика ↔ телятина+петрушка | BA chart №17 | |
| 4 | Шницель / рыба на гриле | Pale lager / Pilsener | «Schnitzel with pale lager may be obvious»; «For lighter items such as grilled fish, a Pilsener is a treat» | BA с.5–6 | |
| 5 | Жареная свинина (roast pork) | Oktoberfest/Märzen | «rich, caramelly flavors… and roasted pork» — Maillard-гармония | BA с.4 | |
| 6 | Шоколадные трюфели / flourless cake | Imperial stout | «deep, roasted flavors» ≈ шоколад; интенсивность | BA с.4, 7; Oliver | |
| 7 | Выдержанный чеддер | English brown ale / stout | Ореховость ≈ ореховость; горечь чистит жир | BA с.4, 7 | |
| 8 | Карри | IPA | «classic with curry!» — интенсивность + остаточный сахар | BA chart №4; Herz | contested |
| 9 | Морковный торт / чизкейк / крем-брюле | Double IPA | Сверхсладкое ↔ сильная горечь при равной интенсивности | BA с.7 | |
| 10 | Mole poblano | Porter / sweet stout | Шоколад-чили ↔ обжарка; сладость гасит перец | Oliver; BA chart №15; Hastings | |
| 11 | Копчёное мясо / грибная кесадилья | Rauchbier (Schlenkerla) | Дым ≈ дым | Oliver | |
| 12 | Бургер, стейк на гриле | Brown ale / porter | Карамелизация ≈ карамельный солод; горечь режет жир | Oliver (Oxford Companion) | |
| 13 | BBQ («sweet heat») | Maibock / abbey dubbel | Солодовая сладость ↓ heat + ↔ сладость соуса | BA с.6 | |
| 14 | Gruyère выдержанный | Doppelbock | Ореховость ≈ солод; интенсивность | Oliver | |
| 15 | Буррата | Hefeweizen | Mosher: «peach ice cream in your mouth» — эфиры ↔ сливки | Mosher (Flavor Fever; Cheese Professor) | |
| 16 | Острая азиатская / каджун / латинская | Helles / Dortmunder | Низкая горечь, солод, пузырьки | BA chart №23 | |
| 17 | Выдержанный прошутто | Pilsner | Соль ↑ умами, соль ↓ горечь | Papazian | |
| 18 | Parmigiano Reggiano | Porter | «complex acidity of roasted grains» ↑ умами | Papazian | |
| 19 | Жирная свинина | Чешский лагер | «Чешские лагеры + жирное свиное мясо» | pivoman (2013) | |
| 20 | Мексиканская кухня | Brown ale | «солодовая сладость понижает остроту» | pivoman | |
| 21 | Сибас с мандариновым соусом | Belgian wheat | Цитрусовый hook | Oliver | |
| 22 | Тайские/мексиканские блюда с лаймом | American pale ale | Цитрус хмеля ↔ лайм | Oliver | |
| 23 | Утка | Kriek (Liefmans) | Кислая вишня ↔ жир утки (классика utка-вишня) | Oliver | |
| 24 | Салаты, суши, морепродукты | Hefeweizen / American wheat | «Best with very light foods» | BA chart №17–18 | |
| A1 | Шоколадный торт | Bud Light (лёгкий лагер) | «Bambi vs Godzilla… will be a disaster» | Mosher | anti |
| A2 | Любое основное блюдо | Barley wine / Imperial stout | «Easily overpowers most main dishes» | BA chart №12, 16 | anti |
| A3 | Острые крылышки | IPA 8.4 %/85 IBU | Панель: «increased heat perception» | CraftBeer.com (Sam Adams) | anti |
| A4 | Чипсы с острым чесночным соусом | IPA | «noticeable spike in the heat… didn't let go» | Alcohol Professor | anti |
| A5 | Мощные, острые, тяжёлые блюда | Лёгкий лагер | «заглушают тонкие нюансы напитка» | Романовский (ОНТ) | anti |
| A6 | Кислое блюдо | Сладкое пиво | «сладкие компоненты не сочетают с кислотными» | pivoman | anti |
| A7 | Деликатное пиво | После «блокбастера» | Порядок подачи | Oliver | anti |
| A8 | Основные блюда | Double/Triple IPA | «dominate entirely» | Hop Culture | anti |

---

## 5. BJCP как источник сенсорных векторов для 100+ сортов

BJCP 2021 описывает каждый стиль блоками Overall Impression / Aroma / Appearance / Flavor / Mouthfeel и
даёт числовые **vital statistics**. Пример 3B Czech Premium Pale Lager: IBU 30–45, SRM 3.5–6, OG 1.044–1.060,
FG 1.013–1.017, ABV 4.2–5.8 %; «Rich, complex, bready maltiness combined with a pronounced yet soft and rounded
bitterness»; «Medium body. Moderate to low carbonation». Это позволяет строить приор стиля не «на глаз», а из
чисел (предложение — наша оценка, не из источников):

| Ось напитка | Из чего | Формула (предложение) |
|---|---|---|
| bitter | IBU | `clamp((IBU − 8) / 62)` → 30 IBU ≈ 0.35, 70 IBU ≈ 1.0 |
| alcohol | ABV | `clamp((ABV − 3) / 9)` → 5 % ≈ 0.22, 8 % ≈ 0.56, 12 % ≈ 1.0 |
| residual_sweet | FG (или сахар г/л для сидра/лимонада) | `clamp((FG − 1.006) / 0.020)` |
| body | OG−FG, овёс/лактоза | `clamp((OG − 1.030) / 0.060)` + модификаторы |
| roast | SRM ≥ 20 + дескрипторы «roast/coffee/chocolate» | `clamp((SRM − 15) / 25)` |
| caramel | SRM 8–25 + дескрипторы «caramel/toffee» | по дескрипторам |
| carbonation | vol CO2 (BJCP mouthfeel: low/moderate/high) | 1.5→0.2, 2.5→0.6, 3.5+→1.0 |
| acidity | pH / описание (sour, cider, wine, lemonade) | по категории |

Сейчас у Efes Pilsener в движке `bitter .83` — для лагера с реальными ~20–30 IBU это завышено втрое и запускает
штраф в правиле heat. Причина — формула `value = prior + (1 − prior)·combined`: каждая нота может только
поднимать ось, и «полная пирамида» раздувает все оси. Это признано в PAIRING_ENGINE.md §8 как «осознанно», но
это стимул для сомелье, а не сенсорная правда.

---

## 6. Критика текущего движка Flavor Tree (по `PAIRING_ENGINE.md` и `engine.py`)

1. **Инфляция осей от «полноты пирамиды».** См. §5. Пилснер с горечью .83 и Cicerone-каноном «лагер к острому»
   получает штраф от R3 (`16·max(0, bitter − 0.4)`). Нужен якорь на IBU/ABV/FG, ноты — только уточняют ±0.15.
2. **R3 heat: карбонизация всегда в плюс (8.0)** — спорно (P7); и штраф идёт от `bitter > 0.4`, тогда как панель
   Sam Adams показывает нейтральность при 45 IBU и усиление при 85 IBU. Порог должен быть ≈ IBU 50–55
   (`bitter ≈ 0.7`), а алкоголь — от ~7 % ABV. Нет учёта предпочтения гостя «люблю пожарче».
3. **R5 sweet: штраф за `bitter > malt_sweet`** противоречит BA-канону «double IPA + carrot cake» и Herz «bitter calms
   sweet». Правильно: сначала P1 (интенсивность десерта ↔ напитка), затем ИЛИ сладость ≥ сладости десерта, ИЛИ
   очень высокая горечь как контраст. Обжарка ↔ шоколад (`6·roast`) недооценена: «Chocolate loves a dark beer».
   Отсутствует мост «фруктовые эфиры/фруктовое пиво ↔ фруктовый десерт».
4. **R2 cut: не учитывает roast и alcohol как балансиры жира** (таблица BA). Формула должна быть
   `richness × (w1·bitter + w2·CO2 + w3·roast + w4·alcohol + w5·acidity)`, где acidity нужна для сидра/вина/кислых элей.
5. **R9 smoke → hop_aroma («смолистый хмель вторит дымку»)** — в литературе нет; канон: дым ↔ дым (rauch, smoked
   porter) и дым ↔ обжарка. Ось `smoke` у напитка отсутствует — добавить.
6. **R7 umami штрафует горечь на постном умами**, а Papazian/Beer & Brewing говорят, что горечь и кислотность
   **поднимают** умами (IPA + сардины, APA + шиитаке). «Металлический привкус» — это конкретно хмель + жирная рыба
   (омега-3), а не умами вообще; правило надо переписать на `fish_oil`/`iodine`-тег.
7. **R4 salt: коэффициент горечи (3.0) меньше карбонизации (6.0) и солода (5.0)**, хотя единственный доказанный
   механизм — соль ↓ горечь (Breslin). Соль должна больше всего «прощать» горькие напитки и, по Papazian, поднимать
   умами.
8. **Нет осей напитка `acidity`, `residual_sugar`, `tannin`, `smoke`, `serving_temp`, `ester/phenol family`,
   `hop_aroma_family`** — без них нельзя загрузить 200+ напитков (сидр, вино, квас, лимонад, коктейли, крепкое).
   `hop_aroma` как одно число не различает цитрус/травы/хвою/тропики — а именно семейство даёт мост (P14).
9. **Нет осей блюда: `acid` есть (sour), но нет `cook_method`, `texture` (crispy/creamy), `protein`, `serving_temp`,
   `cuisine_region`, `fish_oil`.** Регион (P17) и температура (P18) не реализованы вовсе.
10. **R11 curated ±16 — самый тяжёлый вклад.** При 17×50 это работает; при 100 сортов × 200 блюд покрытие 51 пары
    < 0.3 % — движок должен стоять на правилах, кураторство — как тесты (§4) и override.
11. **Explanations.** Cicerone требует называть механизм: «соль маринада подчёркивает солодовую сладость, которая гасит
    халапеньо». Текущие тексты — общие фразы на правило; нужно подставлять конкретные ноты/теги обеих сторон.
12. **Тип пары.** BA: в хорошей паре есть и complement, и contrast. Стоит выдавать два лейбла (основной механизм +
    вторичный), а не один.
13. **Верхняя граница интенсивности (P16)** не реализована: 12 % barley wine к лёгкому салату получит только штраф R1
    (−15), а по BA это «не подавать вообще, кроме сыра/десерта».
14. **Порядок подачи и температура** — нулевая стоимость реализовать (по стилю), а сомелье этого ждут.

---

## 7. Предлагаемые оси (для v2)

**Напиток (category-agnostic):** `bitter` (IBU-якорь) · `alcohol` (ABV) · `residual_sugar` (FG / г/л) · `body` ·
`carbonation` (vol CO2) · `acidity` · `tannin` · `roast` · `caramel` · `smoke` · `hop_family` {citrus, tropical, herbal,
floral, pine, spicy-noble} · `yeast_family` {clean, banana-clove, pepper-phenolic, funky} · `fruit` · `cream/lactose` ·
`serving_temp` · `category`.

**Блюдо:** `salt` · `sweet` · `acid` · `bitter` · `umami` · `chili_heat` · `aromatic_spice` · `fat` · `weight` ·
`cream` · `maillard` · `smoke` · `fresh/raw` · `fish_oil` · `texture` {crispy, creamy, chewy} · `serving_temp` ·
`protein` · `cook_method` · `cuisine_region` · `aroma_tags` (те же семейства, что у напитка — для моста).

---

## 8. Источники

1. Brewers Association. *American Craft Beer and Food: Perfect Companions* (пособие + Beer & Food Matching Chart, 28 стилей, температуры). https://www.cicerone.org/sites/default/files/resources/Beer_and_Food_English.pdf (та же брошюра: https://www.craftbeer.com/attachments/0000/0533/beerandfood.pdf)
2. Garrett Oliver. «food pairing», *The Oxford Companion to Beer* (репринт Craft Beer & Brewing). https://www.beerandbrewing.com/dictionary/9jYnWqXy1G
3. «Matching Beer & Food at the Brewmaster's Table» (конспект книги Оливера с цитатами и парами), All About Beer. https://allaboutbeer.com/article/matching-beer-food-at-the-brewmasters-table/
4. Randy Mosher. «Flavor Fever: Beer, Food, Science, Magic», Craft Beer & Brewing. https://www.beerandbrewing.com/flavor-fever-beer-food-science-magic
5. The Cheese Professor. «Why Beer Pairs Well with Cheese» (цитаты Мошера: Bambi vs Godzilla, bitter cuts fat). https://www.cheeseprofessor.com/blog/pairing-beer-with-cheese
6. Cicerone Certification Program. «Exam Tactics: How to Present Beer and Food Pairing Knowledge in Advanced and Master Exams». https://www.cicerone.org/us-en/blog/presenting-beer-and-food-pairing-knowledge-in-advanced-and-master-exams
7. Julia Herz. «Unscrambling Your Senses: Interpreting Craft Beer and Food Pairings», CraftBeer.com. https://www.craftbeer.com/craft-beer-muses/the-sensory-side-of-craft-beer-pairing
8. Herz & Conley, *Beer Pairing: The Essential Guide from the Pairing Pros* — рецензия и интервью, PorchDrinking. https://porchdrinking.com/articles/2018/05/21/book-review-interview-beer-pairing-julia-herz/
9. Charlie Papazian. «Umami: It's Not About the Marriage — It's About the Child», CraftBeer.com. https://www.craftbeer.com/beer-and-food/umami-its-not-about-the-marriagemdash-its-about-the-child
10. Jeremy Storton. «Pairing Beer and Cheese: Everything You Need to Know», CraftBeer.com. https://www.craftbeer.com/beer-and-food/pairing-beer-and-cheese-10-styles
11. «Science Says You're Wrong About Pairing IPAs and Spicy Foods», CraftBeer.com (панель Sam Adams × CIA). https://www.craftbeer.com/beer-and-food/science-says-youre-wrong-about-pairing-ipas-and-spicy-foods
12. Alcohol Professor. «Taste Test: Does Beer Really Pair With Hot Sauce?». https://www.alcoholprofessor.com/blog-posts/taste-test-can-beer-really-pair-with-hot-sauce
13. Tasting Table (James Hastings). «The Best Beer Pairings To Balance Spicy Foods». https://www.tastingtable.com/1546885/best-beer-pairings-spicy-food/
14. The Daily Meal. «Why IPA Beers Are A Mistake If You're Eating Spicy Food». https://www.thedailymeal.com/1551153/dont-mix-ipa-with-spicy-food/
15. Hop Culture. «The 5-Minute Guide to IPA Food Pairing». https://www.hopculture.com/best-ipa-food-pairing-guide/
16. BJCP 2021 Style Guidelines — 3B Czech Premium Pale Lager. https://www.bjcp.org/style/2021/3/3B/czech-premium-pale-lager/ ; Introduction. https://www.bjcp.org/beer-styles/introduction-to-the-2021-guidelines/
17. Breslin P.A.S., Beauchamp G.K. «Suppression of bitterness by sodium: variation among bitter taste stimuli», *Chemical Senses* 20(6), 1995. https://pubmed.ncbi.nlm.nih.gov/8788095/
18. Пивной Адвокат. «Сочетание пива и еды. Правильный баланс вкусовых ощущений» (2013). https://pivoman.su/?p=4205
19. Пивной Адвокат. «Сочетание пива и еды. Базовые основы. Продолжение». https://pivoman.su/?p=4302
20. ОНТ (Максим Романовский). «Пивная эволюция: как подбирать закуски как сомелье» (2026). https://ont.by/ru/society-ru/view/pivnaja-evoljutsija-kak-podbirat-zakuski-kak-somelje-322159-2026
21. Drinktime (Сергей Сахаров). «Еда и пиво: лучшие сочетания от пивного сомелье». https://drinktime.ru/dnf/51-eda-i-pivo-luchshie-sochetaniya-ot-pivnogo-somele.html
22. Гранд Кулинар. «Сочетание пива и еды». https://grandkulinar.ru/statiy-o-kulinarii/4363-sochetanie-piva-i-edy.html
23. Brewers Association. «Brewers Association Publishes Beer & Food Course» (5-дневный курс, 60 стр.; текст курса не загружался). https://www.brewersassociation.org/communicating-craft/brewers-association-publishes-beer-and-food-course/

Не удалось загрузить (не цитируются): Cicerone Certified syllabus (404), Profibeer «Всё о фуд-пейринге» (доступ запрещён), Food52 «How to Pair Beer With Food, According to a Master Cicerone» (429).

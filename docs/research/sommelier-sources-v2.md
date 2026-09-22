# Что говорят сомелье и сисероне: эталонный набор пар для движка v2

> Документ воркстрима RESEARCH, 22.09.2026. Здесь описано, откуда взялись данные для калибровки движка v2:
> `data/test_pairs.json` (эталонные пары и порядковые ограничения), `data/classic_pairs.json` (белый список R20),
> `data/research/proposed_dishes.json` и `data/research/proposed_archetypes.json` (блюда и стили, которых пока нет
> в `dishes_v2.json` и `style_priors_v2.json`). Уровни доказательности A–D те же, что в спеке (§1).

## 1. Коротко

- В `test_pairs.json` лежит **445 пар**:
  - 68 из спеки (T01–T68), ожидания не меняли;
  - 28 кураторских пар Efes с оценкой 4–5;
  - **349 новых пар** из экспертных текстов.
  - Ещё 23 кураторские пары с оценкой 3 вынесены в `curated_neutral`, требования к ним нет.
- **Порядковых ограничений 19**: 12 из спеки (O01–O12) и 7 новых (O13–O19).
- **26 спорных пар** вынесены в `contested`. По ним эксперты расходятся, в pass/fail они не участвуют.
- **Holdout**: 115 пар (25.8 %) и 5 ограничений из 19. Среди отложенных 19 пар из спеки, 10 кураторских и 86 новых. Правило разбиения — в §3.
- **Цитаты.** Каждая цитата не длиннее 25 слов и сверена с текстом страницы. Страницу скачивали curl, текст нормализовали, цитату искали как подстроку. Цитат с пометкой `snippet` (видели только выдержку поиска) в итоговых файлах нет.
- **Источники.** Использовано 192 уникальных URL. Ещё около 30 страниц не открылись, список в §10.
- **Уровни доказательности новых пар**: 320 пар — C (названный эксперт или профильная организация), 29 — D (традиция, бренд, наш перенос). На уровне A новых пар нет: психофизика подтверждает механизмы, а не конкретные пары.
- **Белый список R20** (`classic_pairs.json`) — 32 пары. 11 из них — прототипные CLASSICS, у всех есть источник и дословная цитата.
- **Предложенные id.** 19 новых блюд и 5 новых архетипов: `saison`, `sake`, `rose`, `sweet_white`, `fino_sherry`. Всё, что уже появилось у DISHES и CATALOG, мы перевели на их id. Например, `doppelbock`, `brandy`, `tea_milk`, `munich_dunkel`, `english_bitter`, `borsch`, `shawarma`, `ice-cream`, `garlic-shrimp`.

Новые пары по категориям напитка:

| Категория | top3 | good | bad | avoid | всего |
|---|---|---|---|---|---|
| пиво | 6 | 104 | 16 | 3 | 129 |
| сидр | 0 | 12 | 2 | 1 | 15 |
| вино (вкл. саке, розовое, сладкое белое) | 6 | 67 | 18 | 5 | 96 |
| игристое | 1 | 18 | 5 | 1 | 25 |
| креплёное (портвейн, херес) | 2 | 9 | 0 | 0 | 11 |
| коктейли | 1 | 13 | 2 | 0 | 16 |
| крепкое | 4 | 20 | 5 | 3 | 32 |
| квас | 0 | 0 | 1 | 0 | 1 |
| кисломолочные (айран, кумыс, шубат) | 1 | 5 | 0 | 0 | 6 |
| чай | 1 | 12 | 2 | 0 | 15 |
| б/а пиво | 0 | 1 | 0 | 0 | 1 |
| лимонад | 0 | 0 | 1 | 0 | 1 |
| газированная вода | 0 | 0 | 1 | 0 | 1 |
| **итого** | **22** | **261** | **53** | **13** | **349** |

Из 349 новых пар 66 отрицательные (bad/avoid, 19 %). В пиве и вине негативов около 15–24 %. У кваса, безалкогольного пива, лимонада и воды пар мало: экспертных текстов о них почти нет, есть только традиция (см. §8).

## 2. Как собирали

1. **Отбор источников.** Брали первоисточники и названных экспертов:
   - профильные организации: Brewers Association / CraftBeer.com, Cicerone, WSET, Court of Master Sommeliers, Comité Champagne, BNIC, Scotch Whisky Association, Japan Sake and Shochu Makers Association, NW Cider Association, American Cider Association, Tea and Herbal Association of Canada;
   - авторы: Оливер, Мошер, Херц, Гайзер, Ханни, Джансис Робинсон, Фиона Беккет, Rich Higgins (Master Cicerone), Похлёбкин;
   - профильные издания: Wine Folly, Decanter, Simple Wine News, РБК Вино.

   Контент-фермы и сгенерированные тексты отбрасывали. Одну такую страницу (Glass & Note) нашли уже в спеке и пометили, см. §7.
2. **Проверка цитат.** Каждую страницу скачивали curl (PDF переводили в текст через `pdftotext`). Цитата попадала в файл, только если нашлась в тексте страницы дословно; учитывались только пробелы, кавычки и переносы.

   Сайты, которые отдают 403 (jancisrobinson.com, wineenthusiast.com, cvindependent.com), читали по копиям Wayback Machine. В URL записана именно копия. У двух страниц (tea.ca, Cider Review) пришлось подставить браузерные заголовки, текст сверен так же.
3. **Сопоставление с id.** Блюдо из источника переносили на id, только если это действительно то же блюдо. Приблизительные случаи помечены в `note` у источника. Например, «beef stew» стал `meat-stew`, «German-style bock» — `doppelbock`, британский pale ale — `english_bitter`.

   Несколько пар выведены из общего правила эксперта: «острое», «сладкие десерты», «деликатное блюдо». В них типичное блюдо выбрали мы, и это тоже написано в `note`.
4. **Ожидания.**
   - `top3` — источник называет пару классикой, идеальной или лучшей;
   - `good` — «работает» или «рекомендуем»;
   - `bad` — «не работает» или «избегать»;
   - `avoid` — явный провал из категории вето V1–V6: громкое на деликатном, сухое к десерту, крепкое к острому, танин к жирной рыбе, крепкое к сырому, лёгкое под тяжёлым.

   Ожидания 68 пар и 12 ограничений из спеки не меняли, только добавили подписи источников.
5. **Кураторские пары Efes.** 5/5 стали `top3`, 4/5 — `good`, 3/5 ушли в `curated_neutral`. Уровень доказательности C, в `note` указано, что это внутренняя оценка команды, а не литература.

   Бренд сопоставлен с архетипом так же, как у CATALOG в `data/drinks.json`. Kozel стал `czech_pale_lager`, Miller — `american_lager`, Кружка Свежего — `light_lager`, Bremen — `helles`, остальные — как раньше. В записи остаётся `brand_id`, поэтому движок может переразрешить архетип сам.

   Если кураторская пара совпадает с парой из спеки или исследования, стоит `duplicate_of`: при подсчёте её нужно считать один раз.
6. **Спорные пары.** Если в выборке один эксперт говорит «хорошо», а другой «плохо», пара уходит в `contested` со всеми цитатами. Если большинство источников на одной стороне, пара остаётся в `pairs` с мнением большинства (поле `in_pairs` в `contested`), а меньшинство записано рядом.

## 3. Как читать `test_pairs.json`

- **Схема** — по контракту: `id, dish, drink, expect, why, sources[{title,url,quote}], evidence, split, origin, heat_lover`. Мы добавили поля:
  - `category` — категория напитка;
  - `ctx` — у T58 это `{"occasion": "meal"}`, как в прототипе;
  - `needs_proposed` — id блюда или архетипа из `data/research/proposed_*.json`;
  - `brand_id`, `curated_score`, `duplicate_of` — для кураторских пар;
  - `spec_source_text`, `prototype_v21` — исходная строка таблицы §7.1.
- **Id.** T01–T68 — спека, C01–C51 — кураторские (номер строки в `pairings_curated.json`), R001–R349 — новые. Ограничения O01–O12 из спеки, O13–O19 новые.
- **Holdout** (детерминированно, без взгляда на баллы движка). Пары делятся на страты `(категория напитка, expect)`. Внутри страты пары сортируются по `sha1("flavor-tree-v2|" + id)`, и первые `int(0.25·n + 0.5)` уходят в holdout. Ограничения делятся тем же правилом по всем 19. Так в holdout попадают все категории и все типы ожиданий, включая 19 пар из спеки.
- **`needs_proposed`.** Пока DISHES и CATALOG не примут предложенные id, движок должен такие пары пропускать и считать отдельно. Их 105 из 445.
- **Id от соседних воркстримов.** 20 id блюд взяты из `dishes_v2.json`: ice-cream, cold-cuts, shawarma, borsch, solyanka, lagman, pelmeni, olivier, vobla, dolma, fish-and-chips, pizza-pepperoni и др. 11 id архетипов взяты из `style_priors_v2.json`: czech_pale_lager, american_lager, munich_dunkel, doppelbock, english_bitter, belgian_dubbel, belgian_tripel, gose, tequila_blanco, brandy, tea_milk. Их нет ни в v1, ни в прототипе. Если DISHES или CATALOG их переименуют, пары нужно поправить.
- **`contested`.** Не участвует в pass/fail. У каждой записи есть `claims` (ожидание и источник) и `note`. Если пара с мнением большинства есть в `pairs`, `in_pairs` указывает её id.

## 4. Принципы, которые повторяются у экспертов

| Принцип | Кто говорит (дословно — в парах) | Уровень | Правило движка |
|---|---|---|---|
| Интенсивность к интенсивности: громкое глушит деликатное, лёгкое «исчезает» рядом с тяжёлым | BA («Match strength with strength»), Оливер («a dance, not a football tackle»; «a lighter beer may seem to disappear… ribs»), Мошер («Bambi vs. Godzilla»), CMS («weight with weight»), WSET 2024 («A complex, powerful stout would overwhelm most seafood»), Стортон, Романовский (ОНТ), Хаширов (winenomad.kz: стейк «задавит» хрупкое белое) | C | R1, V1, V6 |
| Жир режут горечь, газ, кислота, танин, крепость | BA (таблица Balances), Оливер («Carbonation provides… cutting power against fats»), Мошер («Bitter cuts sweet, and bitter cuts fat»), CMS («Tannins love fat»), NW Cider, CIDERCRAFT, Death & Co (цитрусовый коктейль × фри) | C (жир × вяжущее — B, Peyrot des Gachons 2012) | R2 |
| Острое: сахар и молоко гасят, спирт и горечь разжигают; доза решает | CMS («Alcohol + spicy = fire», «Spicy + sugar = no fire»), Гайзер («needs residual sugar–avoid tannin!»), Tidwell («Tannin accentuates peppery spice»), силлабус Cicerone («Accentuates capsaicin heat»), панель Sam Adams (6.5 %/45 IBU лучше всего, DIPA 8.4 %/85 IBU — максимум жжения), VinePair, Nolden 2019 | A (механизм), C (пары) | R3, V3 |
| Напиток не суше десерта | CMS («Sweets need sweets»), Гайзер, Laurent-Perrier («a wine that is too dry… could create a disharmony»), La Cucina Italiana («the wine must be sweet»), Master Cicerone Rich Higgins («watery and bitter»), Punch (Scott Cameron: коктейль «at least as sweet as the dish»), Сологуб (РБК Вино) | C | R4, V2 |
| Исключения из «сладкое к сладкому»: обжарка и очень высокая горечь как контраст; чай к сладостям | BA (DIPA × морковный торт/чизкейк/крем-брюле; «Chocolate loves a dark beer»), Оливер (имперский стаут «works just like strong coffee»), Tea Association of Canada (чёрный чай × медовые десерты), узбекская и казахская традиция (чай × чак-чак, баурсаки) | C/D | R4 (контраст), **V2 — нужен случай для чая** |
| Кислотность напитка ≥ кислотности блюда; уксус — враг | CMS («Acidity needs acidity»), Гайзер, Swan (Page & Dornenburg), Love British Food (Peyton: сидр кислее блюда), Wine Folly (Malbec: «vinaigrette salads… flat») | C | R5 |
| Танин любит белок и жир и ненавидит рыбий жир и зелень | CMS, Гайзер, Wine Folly («metallic aftertaste»), Sayburn MS (Decanter), SWN «Вино к рыбе», Роскачество (сельдь × мощное красное) | C (B для белка: Madrigal-Galan 2006) | R8, V4 |
| Хмель × жирная/солёная рыба = металл | Силлабус Advanced Cicerone («high bitterness and briny fish create clashing, metallic flavors»), Master Cicerone Syllabus («oily fish»), Newton | C | R9 (хмель × fish_oil) — стоит проверить, что штраф срабатывает и для пива |
| Соль гасит горечь и смягчает танин | Breslin 1995 (A), Death & Co («the salt lessens the impression of bitterness»), WSET 2025 («the salt in the cheese softens the feel of the wine»), CMS; против — Гайзер («Salt… exacerbates tannin») | A/C, спорно для танина | R6 |
| Умами ужесточает танин и горечь, даже с солью | WSET 2020 («umami-driven foods tend to make wines taste more bitter… detrimental to tannic wines»), Ханни; против — Papazian («Umami is elevated by… bitterness») | C, спорно | R7 |
| Крепкое — только к тяжёлой еде | Whisky School («High-proof whisky needs heavy food»), Whisky Advocate и scotchwhisky.com (виски «swamp» деликатную рыбу), Marrero (к деликатному — невысокий градус), Death & Co (крепкие коктейли — к «single bites», не к трапезе) | C | R9, V5, R16 |
| Дым к дыму и карамель к корочке | Оливер (раухбир «complements the smoky flavors… smoked chilies and meats»; brown ale × гриль), BA (Oktoberfest × свинина), Del Maguey, SWN (шираз × шашлык «дымными нотками»); против дыма к дыму — силлабус Cicerone («smoky flavors seem diminished») | C, спорно для дыма | R10, R11 |
| Регион к региону | BA («Look to classic cuisines»), CMS («Wines produced in a specific wine region usually compliment the local food»), SWN (арени × долма), Похлёбкин (водка — к «исконно русским» закускам) | C/D | R15 |
| Температура подачи как ограничение | WineState (белые и игристые не подходят к обжигающему лагману «из-за разницы температур»), JSS (у саке результат меняется от 5 до 40 °C), tea.ru (к плову — горячий чай) | C/D | R18 (сейчас выключено) — нужен признак «горячее блюдо × холодный напиток» |
| Кисломолочное к жирному мясу и острому | Традиция (cooks.kz, e-history.kz, Mediterranean Dish: айран «to lighten heavy meat dishes»), Nolden 2019 (молоко против капсаицина, A) | A (острое), D (жирное) | R3, R2 |

## 5. Где эксперты расходятся

Все случаи ниже, кроме последнего пункта, лежат в `contested` с цитатами обеих сторон.

- **IPA × острое** (спековая T10 и `chicken-curry × american_ipa_45`).
  - За: BA («classic with curry!»), Оливер, WSET 2024 («Spicy curry with American IPA»), Hop Culture.
  - Против: Garneau / панель Sam Adams, Alcohol Professor, силлабус Cicerone («accentuates capsaicin»).
  - Разумный компромисс уже в спеке: IPA ≤ 45 IBU и ≤ 6.5 % — да, DIPA — нет.
- **Сухой стаут × шоколадный десерт.** BA (строка 14 чарта) и WSET — да, Оливер — нет («don't have the needed intensity»).
- **Фруктовое пиво × фруктовый десерт.** BA — «obvious affinity». Оливер (2003 и 2002) и силлабус Cicerone — вкусы гасят друг друга.
- **Портвейн × шоколадный торт.** Wine Folly — да. Оливер и сомелье ресторана «Хороший год» (Алматы, winenomad.kz) — нет.
- **Сухое красное × шоколадный фондант.** Алматинский сомелье — да (примитиво), Wine Folly и CMS — нет.
- **Сухое игристое × пахлава.** Автор SWN называет это «пойти от противного», основная рекомендация — сладкий тони. Против — V2.
- **Голубой сыр × IPA.** BA и American Cheese Society — да. Oxford Companion — рокфор и датский голубой «clash with hops».
- **Бри × IPA.** Стортон — да. Oxford Companion и French Dairy Board — нет.
- **IPA × тёмный шоколад.** CraftBeer.com и Rich Higgins — нет, Newton — да.
- **Хмель × жирная рыба.** Силлабус Cicerone — металл, Craft Beer & Brewing — «new dimension».
- **Дым к дыму.** WSET — «Smoked salmon and rauchbier», силлабус Cicerone — дым гасится. Это касается T18 (казы × раухбир) и R11.
- **Ячменное вино × рёбра.** Craft Beer & Brewing — да, BA — «overpowers most main dishes».
- **Крепкое к сырым устрицам** (V5).
  - За: BNIC (молодой коньяк со льдом), традиция Айлы (виски на устрицы), Mezcalistas.
  - Против: Whisky School («High-proof whisky needs heavy food»).
  - Вето V5 в текущем виде эти традиции запрещает. Возможно, нужен случай «крепкое со льдом или как соус», но пока это меньшинство.
- **Коктейль на выдержанном спирте × индийская кухня.** Шеф Maneet Chauhan — да, CMS и The Three Drinkers — нет.
- **Танинное красное × жирная рыба.** Wine Enthusiast 2025 — «natural match», большинство (CMS, Гайзер, Wine Folly, Sayburn MS) — металл. T29 оставлена avoid.
- **Танин × острое.** Тест Wine Folly (охлаждённое полнотелое красное «worked rather well») и одна статья о крыльях — да. Гайзер, WSET, Decanter и Джансис Робинсон — нет.
- **Лёгкое красное × карри.** WSET 2020 — да (к тайскому карри). Karen MacNeil — «red Burgundy will end up tasting like water».
- **Сотерн × мороженое.** Wine Folly — «will do better», Арвид Розенгрен — «rarely a good idea».
- **Вобла × пиво.** Пивные сомелье Сусов и Брусин — нет. Традиция (Гастроном.ру) и винный сомелье Жилина — «правильно, но банально».
- **Водка × пельмени.** Похлёбкин и Жилина — да, Лесниченко — водка «затмевает» начинку.
- **Игристое × оливье.** Сомелье SWN и МК — да. Жилина против: к игристому нельзя блюда с варёными яйцами.
- **Игристое × соленья.** SWN и Жилина — да, Гастроном.ру — в стоп-листе.
- **Плов × алкоголь.** Шеф и историк восточной кухни (tea.ru) — только зелёный чай, алкоголь «неуместен». Это культурная норма, а не дегустация. Винные эксперты (WineState, Руденко, SWN) подбирают вино к плову, T25 ставит к плову янтарный лагер.
- **Внутри одного источника.** Wine Folly противоречит сама себе: голубой сыр с белыми, сухие вина к десертам в одной из статей. Кураторы AlmaWine советуют к бешбармаку то сухой, то полусухой рислинг.

## 6. Что это значит для правил движка

Ниже — что говорят новые пары о правилах. Для ориентира мы прогнали прототип v2.1 (`engine_v2_prototype.py`) на парах с id, которые в нём есть. Holdout выбран до этой проверки, по хешу. Ни одно ожидание по итогам прогона не меняли.

Итоги прогона:
- спека: 66 из 68, как в §7 спеки;
- кураторские: 12 из 17 (11 пропущено — блюда или архетипа нет в прототипе);
- **новые: 132 из 166 проверяемых** (183 пропущено — блюдо или напиток есть только в v2-файлах или в предложенных).

34 провала новых пар группируются так:

| Сигнал | Пары (id) | Источник | Что поправить (решает ENGINE) |
|---|---|---|---|
| V2 срабатывает на чай и кофейные десерты | R259 чак-чак × чёрный чай, R325 чак-чак × зелёный чай (оба 35, вето V2) | Tea Association of Canada, узбекская традиция | Не применять V2 к горячему чаю, либо ослабить для `tea` |
| V2 срабатывает на сухой стаут к тирамису | R014 (35) | Чарт BA, строка 14 | В ветку контраста R4 добавить обжарку (roast ≥ .8), а не только горечь ≥ .75 |
| V6 глушит фруктовое и полусладкое игристое к шоколаду | R046 kriek × фондант (40), R168 demi-sec × фондант (45) | BA («magic with chocolate»), Laurent-Perrier | Кислотность и сладость — такое же «исключение CMS», как у кумыса; проверить V6 для `acid ≥ .8` |
| Снеки × крепкий аперитив | R056 брецель × негрони (33, V1) | Death & Co («one of our favorite combos») | V1 не должен срабатывать на солёный лёгкий снек (правило snack в R6 уже есть) |
| Умами с солью не спасает танин | R193 рамен × каберне (77, ожидали bad) | WSET 2020 | В R7 ветка «умами + соль» даёт плюс горькому и танинному. WSET говорит обратное. Нужен штраф танину при высоком умами независимо от соли (спорно с Papazian) |
| Танин и острое при средней остроте | R194 карри × каберне (67), R195 чили × каберне (66), R181 карри × лёгкое красное (70) | WSET, Decanter, Гайзер, MacNeil | Штраф R3 за танин (0.12) при heat .55–.75 слишком мал. Ещё карри в векторе .55 — ниже порога V3 (.6), и R246 карри × виски avoid не получает вето |
| Танин и чай к острому | R064 лагман × чёрный чай (74, ожидали bad), R230 лагман × сухой сидр (71) | Tidwell, Peyton | Та же причина: танин в R3 почти не штрафуется |
| Белое и лёгкое против тяжёлого мяса | R349 стейк × белое сухое (66), R306 плов × белое (69) | winenomad.kz, Руденко | R1 прощает лёгкое тело за счёт кислоты («исключение CMS») слишком щедро |
| Классика региона проигрывает танину | R144 шницель × грюнер (74, ранг 6 из 6 вин), R156 карри × полусухой рислинг (67, ранг 4), R030 братвурст × пилс (72, ранг 14) | Wine Folly, WSET, BA | R8 даёт красным бонус за белок/жир даже к панированной телятине; R15 и R20 слабее. Кандидаты в R20 |
| Десертный контраст стаута | R020 чизкейк × имперский стаут (45), R238 тёмный шоколад × виски (49) | Оливер, SWA | Нет ветки «кофе/обжарка как контраст сливочному» |
| Квас и плов: традиция, а не дегустация | R343 окрошка × сладкий квас (79, ожидали bad), R310 плов × сладкий лимонад (67) | АиФ, tea.ru | Первое — перенос с кваса как основы супа (D), второе — культурная норма; на калибровку не давить |
| Критерий `bad` при плохой категории | R242 форель × виски (45, ранг 2), R243 суши × виски (22, ранг 2, вето) | scotchwhisky.com, Whisky Advocate | Когда весь ряд категории плохой, условие «не в топ-3» не выполнимо. Предлагаем для bad проверять только балл, если лучший в категории < 60 |

Кураторские пары, которые прототип не проходит:
- C02 куырдак × light_lager (50, V6);
- C07 казы × pale_lager_intl (top3 по оценке 5/5, а в прототипе 64 и ранг 19);
- C32/C46 шашлык × pale_lager_intl (58);
- C35 рёбра × strong_lager (top3 по 5/5, в прототипе ранг 15).

Здесь внутренняя оценка Efes расходится с литературой. К казы и шашлыку источники ставят раухбир, тёмный лагер, мескаль и красное; массовый лагер «does a job» (Matching Food & Wine о кебабе и Efes). Такие пары стоит проверить на дегустации, а не подгонять под них коэффициенты.

По правилам:
- **Подтверждены несколькими независимыми источниками:** R1 (интенсивность), R2, R3 (направление), R4, R5, R8 (V4), R10, V1, V5 (с оговоркой про устриц), V6.
- **Оспорены или требуют уточнения:** R7 (умами), R11 (дым к дыму), знак R6 для танина, V2 для чая и обжарки.
- **R12 (аромат-мосты) и R15 (регион)** имеют слабую базу: эксперты используют их как объяснение, а не как главный довод.


## 7. Что поправили в ссылках спеки (ENGINE_V2_SPEC §7 и §11)

При повторной сверке первоисточников нашлись неточности. Ожидания тест-пар мы не меняли — поменялись только подписи к источникам.

1. **Тирамису × портер (T08).** В чарте BA тирамису стоит в строке 14, это Dry Stout: «Chocolate soufflé, tiramisu, mocha mascarpone mousse». К портеру (строка 13) BA ставит «Chocolate peanut butter cookies, toasted coconut cookie bars». Пару T08 оставили как good, потому что портер из той же обжарочной группы и под общее правило BA «Chocolate loves a dark beer» подходит. Прямую пару из чарта добавили отдельно: тирамису × dry_stout.
2. **Drinktime «Еда и пиво: лучшие сочетания от пивного сомелье» (2016).** В спеке и в lit-beer-pairing.md статья подписана как текст Сергея Сахарова. В самой статье цитируется пивной сомелье **Ю. Сусов**, автор не указан. Подпись исправили.
3. **Whisky School, T40.** Формулировки «palate destruction» в текущей версии страницы нет. Сейчас там написано: «If you drink a 60% ABV Cask Strength whisky with a light salad, you will destroy your palate.» Цитату заменили, смысл тот же.
4. **tea.ru / Очаково, T46 и O01.** Источник пишет про квас как **основу окрошки** («должен быть именно белый, более кислый»), а не про квас в бокале рядом с окрошкой. Пару «окрошка + кислый квас как напиток» мы вывели сами, поэтому уровень доказательности у неё D. Ожидание top3 оставили, чтобы не расходиться со спекой, но на калибровке эту пару стоит взвешивать слабее.
5. **Tatler, T47 и R20 «бешбармак × кумыс».** Статья подтверждает, что в ресторане Yurta есть отдельная кумысная карта и сомелье по кумысу. Что кумыс подают именно к бешбармаку, в ней не сказано. Прямые подпорки нашлись в других источниках: cooks.kz, e-history.kz, бренд-шеф Руслан Закиров. Все они про традицию, поэтому уровень D, см. §8.
6. **Glass & Note, «The Last Spritz Food Pairing Guide» (2026).** Текст очень похож на сгенерированный: псевдонаучные объяснения, TRPV1 «для слюноотделения», много однотипных таблиц. Как единственный источник для пары его брать нельзя. Там, где он был в спеке (T38, T39), мы добавили подпорки от Death & Co и Marrero.
7. **BJCP.** В стилевых описаниях BJCP 2021 **нет раздела про еду**: на страницах 9A и 20C нет ни слова «pair», ни слова «food». BJCP годится только как якорь для векторов (IBU, ABV, OG/FG, mouthfeel), но не для пар.
8. **Court of Master Sommeliers Europe.** Слайд «SOME CLASSIC PAIRINGS…» в PDF — это одна фотография, конкретных пар там нет. Из CMS берём только принципы.
9. **Оливер про раухбир (T18).** Нужная цитата есть в статье All About Beer 2003 («complements the smoky flavors contributed by smoked chilies and meats»), в словаре Oxford Companion её нет. Это совпадает с оговоркой в §1 спеки.


## 8. Казахская и среднеазиатская кухня: что нашли и чего нет

С казахской, узбекской и русской кухней, распространённой в KZ, связаны 110 пар в файле. Из них 72 новые: шашлык, бешбармак, плов, лагман, баурсаки, пельмени, сельдь, борщ, оливье, самса, манты, казы, куырдак, иримшик, вобла и др.

- **Вино к казахской кухне** — лучшие источники:
  - Simple Wine News, страница региона Казахстан. Там цитируется Зульфия Ибрагимова, сомелье AlmaWine и вице-президент Ассоциации сомелье Казахстана: сухой рислинг к бешбармаку и хошану, игристое к баурсакам, полусухой сидр к острому цомяну и иримшику, каберне фран к сірне.
  - Monte Bianco / AlmaWine: рислинг к бешбармаку, лёгкие красные к казы, не лёгкое кислотное белое к баурсакам.
  - Winenomad.kz, сомелье ресторана «Хороший год»: мальбек и шираз к стейку из конины, белое «задавит» стейк.
  - Это отраслевые и ресторанные голоса, а не школа, поэтому уровень C. Мнения внутри AlmaWine расходятся (сухой или полусухой рислинг к бешбармаку).
- **Средняя Азия:** WineState (лагман, самса, плов), Денис Руденко (рислинг «проигрывает зире» плова), tea.ru (шеф и историк: к плову только горячий зелёный чай), РБК Вино (чёрный чай в Ташкенте, зелёный в областях).
- **Кумыс, айран, шубат, чай с молоком.** Опора — традиция: cooks.kz (кумыс к бешбармаку и казы), e-history.kz (порядок дастархана: кумыс, шубат или айран, затем чай с молоком и баурсаки), бренд-шеф Руслан Закиров («Спасает айран и кумыс»), турецкая традиция айрана к донеру.

  Дегустационных оценок нет, поэтому уровень D. Кумысная карта ресторана Yurta (Tatler) существует, но опубликованных рекомендаций «какой кумыс к какому блюду» мы не нашли. Шубат к бешбармаку нашёлся только на туристическом портале: пара оставлена и помечена как слабый источник.
- **Не нашли ничего проверяемого:**
  - пары к шужыку, жае, жети-ас, чебурекам;
  - пиво к бешбармаку и казы: есть только внутренние кураторские пары Efes;
  - «курт к пиву»: только упоминание в Википедии и возражение диетолога;
  - сорпа как напиток к мясу хорошо описана, но архетипа «бульон» нет. Если он нужен, это задача CATALOG.
- **Конфликт интересов.** Статья Газеты.Ru цитирует зитолога AB InBev Efes Александра Смирнова — его пары не брали. Цитату пивного сомелье Кирилла Брусина из той же статьи использовали как подпорку к «вобла × лагер = bad». BNIC (коньяк), Del Maguey (мескаль), Laurent-Perrier, Aperol и Twinings — производители. Их пары оставлены, но это видно в `title`. Для Aperol и Twinings стоит уровень D.
- **Про Efes.** В гостевом посте Matching Food & Wine о кебабе турецкий лагер Efes описан так: «it does a job, but won't shake your shish in an earth-changing way». Как пару мы это не заносили, но ориентир честный: массовый светлый лагер к шашлыку в литературе нейтрален, а не блестящ.

## 9. Белый список классики (`classic_pairs.json`) и предложенные id

- **`classic_pairs.json` — 32 пары.** 11 прототипных CLASSICS и 21 добавление, у каждой дословная цитата. Для европейской и американской кухни это слова «classic», «iconic», «perfect», «ideal» или строка чарта BA. Для традиционных пар — описание обычая. Бонус 8, метка «классика».
  - `chicken-curry × american_ipa_45` помечена `contested`.
  - Традиционные пары (бешбармак × кумыс, плов × зелёный чай, баурсаки × чай с молоком, окрошка × кислый квас, шаурма × айран) идут с уровнем D.
  - Устрицы × сухой стаут подтверждены силлабусом Advanced Cicerone и WSET. Это главный кандидат на то, чтобы R20 закрыл провал T01.
  - Рокфор × торфяной виски (T41) в классику не попал: «классикой» его называет только Whisky School.
- **`proposed_dishes.json` — 19 блюд** в схеме dishes_v2 с вектором, обоснованием и списком пар, где блюдо используется. Больше всего пар у голубого сыра, копчёной рыбы, бри, сельди, козьего сыра и жареной курицы.

  Всё, что DISHES уже опубликовал (борщ, шаурма, креветки, мороженое, лагман, вобла, пельмени, оливье и т. д.), взято из `dishes_v2.json`.

  `meat-stew` объединяет сірне и европейское рагу. `grilled-lamb` — каре и котлетки на кости, в отличие от шашлыка.
- **`proposed_archetypes.json` — 5 архетипов** в схеме style_priors_v2 с 14 осями и якорем:
  - `saison` — BJCP 25B;
  - `sake` — в контракте нет категории для саке, пока `wine`, лучше завести отдельную;
  - `rose`;
  - `sweet_white`: в `white_semi_sweet` сахара ≤ 45 г/л, а сотерн и айсвайн слаще;
  - `fino_sherry`.

## 10. Что не удалось загрузить или проверить

- **Первоисточники, которые не открылись:**
  - силлабус уровня Certified Cicerone (404 ещё в прошлой сессии; в этот раз прочитаны Advanced Cicerone v5.0 и Master Cicerone v3);
  - Food52 «According to a Master Cicerone» (429);
  - живые страницы jancisrobinson.com и wineenthusiast.com (403, прочитаны копии Wayback);
  - IDAC (кальвадос и помо), Glenlivet, Master of Malt, The Whisky Shop, Forbes, Michelin, JETRO, The Kitchn, World of Fine Wine, amwine.ru (503), mega.kz (сомелье Энрико Наппини о вине к бешбармаку: только JavaScript, архив недоступен).

  Полный список — в таблице ниже.
- **Death & Co:** книги недоступны, взят их текст на Drink Fellows. **Wine Folly:** часть страниц противоречит друг другу (см. §5).
- **Спековые ссылки, не подтверждённые в этой сессии:** Glass & Note про сладкий инжир (страница похожа на сгенерированную), Tatler про кумыс к бешбармаку (есть только кумысная карта) — см. §7.
- **Числа.** Порогов вроде «на 10 IBU минус столько-то» в экспертных текстах по-прежнему нет. Все коэффициенты движка — калибровка, наш набор задаёт только знаки и порядок.
- **Id пар R001–R349 зафиксированы в файле.** Holdout считается от них, поэтому при пересборке набора старые id нужно сохранить.

| Кластер | Источник | URL | HTTP / причина |
|---|---|---|---|
| beer | CraftBeer.com — стиль American Light Lager | https://www.craftbeer.com/styles/american-light-lager | 404 Страница не существует (404) |
| beer | CraftBeer.com — стиль American Pilsener | https://www.craftbeer.com/styles/american-pilsener | 404 Страница не существует (404) |
| beer | Coachella Valley Independent — оригинал статьи Brett Newton | https://cvindependent.com/2018/01/desert-cicerone-pairings-of-beer-and-food-can-be-matches-made-in-heaven-or-they-can-be-metallic-tasting-messes/ | 403 403 для curl; использована копия Wayback (см. выше) |
| beer | Food52 — «How to Pair Beer With Food, According to a Master Cicerone» | https://food52.com/story/how-to-pair-beer-with-food | 429 429 Too Many Requests — не прочитано |
| beer | October — «A Foolproof Guide to Beer and Cheese Pairing» | https://oct.co/essays/beer-and-cheese-pairing-guide | 0 Нет ответа (curl код 000) — не прочитано |
| beer | A Perfect Pint — Garrett Oliver Interview Part 2: Beer and Food Pairing (2011) | https://www.aperfectpint.net/2011/11/garrett-oliver-interview-part-2-beer-and-food-pairing/ | 404 404 — не прочитано |
| wine | Consorzio Asti DOCG — How to pair Moscato d'Asti (moscatodastistories.com) | https://www.moscatodastistories.com/moscato-dasti-paired/ | 0 Замена: гид Wine Folly × Consorzio. |
| wine | JancisRobinson.com — Hospo pairings: plant-based, heat and spice | https://www.jancisrobinson.com/articles/hospo-pairings-plant-based-heat-and-spice | 403 Не загружено (HTTP 403; архив не запрашивался) |
| wine | JancisRobinson.com — Matching wine and food – an introduction | https://www.jancisrobinson.com/learn/food-matching/matching-wine-and-food | 403 Не загружено (HTTP 403) |
| wine | JancisRobinson.com — Food matching: food first | https://www.jancisrobinson.com/learn/food-matching/food-first | 403 Не загружено (HTTP 403) |
| wine | Wine Enthusiast — live pages (pair-red-wine-fish, oyster guide) | https://www.wineenthusiast.com/culture/wine/pair-red-wine-fish/ | 403 Живой сайт: HTTP 403 (curl и WebFetch); использованы копии Wayback |
| other | Eve's Cidery — pairing cider with food | https://www.evescidery.com/pair-and-serve/pairing-cider/ | 403 Не получено (HTTP 403) |
| other | Cider Review — Cider Science 101: Understanding Tannin | https://cider-review.com/2024/11/23/cider-science-101-understanding-tannin/ | 403 Не получено (HTTP 403) |
| other | IDAC — Interprofession des Appellations Cidricoles (pommeau/calvados) | https://www.idac-aoc.fr/en/ | 403 Не получено (HTTP 403); официальных гидов по сочетаниям не найдено |
| other | The Glenlivet — Whisky and Food Pairings | https://www.theglenlivet.com/en/our-community/articles/whisky-and-food-pairings/ | 403 Не получено (HTTP 403) |
| other | Master of Malt — What should I pair with whisky? | https://www.masterofmalt.com/blog/post/what-pairs-well-with-whisky/ | 429 Не получено (HTTP 429) |
| other | The Whisky Shop — How To Pair Whisky With Seafood | https://www.whiskyshop.com/blog/seafood-whisky-pairings-for-good-friday | 403 Не получено (HTTP 403) |
| other | Forbes — Spirited BBQ: Best Whiskey, Bourbon & Barbecue Pairings | https://www.forbes.com/sites/larryolmsted/2018/06/04/spirited-bbq-best-whiskey-bourbon-barbecue-pairings/ | 403 Не получено (HTTP 403) |
| other | Wine Enthusiast — How to Pair Sake with Food | https://www.wineenthusiast.com/culture/sake-food-pairings/ | 403 Не получено (HTTP 403) |
| other | The Sake Company — Common Sake Pairing Mistakes to Avoid | https://www.thesakecompany.com/blogs/sake-drops/common-sake-pairing-mistakes-to-avoid | 409 Не получено (HTTP 409) |
| other | Michelin Guide — The art of food and tea pairing | https://guide.michelin.com/mo/en/article/features/art-food-tea-pairing-balane-flavours | 202 Не получено (HTTP 202, пустой ответ) |
| other | JETRO Taste of Japan — Pairing Japanese Green Tea with Food | https://japan-food.jetro.go.jp/en/feature/detail/702.html | 404 Не получено (HTTP 404) |
| other | The Kitchn — A Guide to Drinking with Spicy Foods | https://www.thekitchn.com/a-guide-to-drinking-with-spicy-foods-milk-for-grown-ups-234243 | 403 Не получено (HTTP 403) |
| other | World of Fine Wine — The best aperitif and food pairings | https://worldoffinewine.com/wine-food/wine-food-pairings/aperitifs-and-food-pairings | 403 Не получено (HTTP 403, и с браузерными заголовками тоже) |
| ru | Какое вино подходит к бешбармаку? | http://mega.kz/news/megazine/kakoe-vino-podhodit-k-besbarmaku/ | 200 По сводке WebSearch (не дословно): кьянти/санджовезе, шабли, розовое к бешбармаку — НЕ проверено, в набор не внесено |
| ru | Казахские кисломолочные деликатесы: кумыс, шубат и иримшик | https://gurman-posuda.ru/blog/sredneaziatskaya-kukhnya/kislomolochnyie-produktyi-v-kazahskoj-kuhne-kumyis-shubat-i-irimshik/ | 522 HTTP 522 |
| ru | Курт — драгоценный камень казахов | https://mir24.tv/articles/16403871/kurt-dragocennyi-kamen-kazahov-kak-gotovitsya-blyudo-kotoroe-ne-portitsya-vosem-let | 403 HTTP 403 |
| ru | Выбор алкоголя к шашлыку и барбекю | https://amwine.ru/blog/alkogol-k-shashlyku-i-barbekyu/ | 503 По сводке поиска там же: «сочная баранина рядом с приторным полусладким вызывает оскомину» — не проверено |
| ru | Острые блюда и алкоголь | https://amwine.ru/blog/podbiraem-napitki-k-ostrym-blyudam/ | 503 HTTP 503 |
| ru | Как пьют чай в Узбекистане | https://rukivboki.ru/note/kak-pyut-chaj-v-uzbekistane/ | 0 Нет ответа (HTTP 000) |
| ru | С чем лучше всего пить пиво | https://shop.chinchin.kz/blog/s-chem-luchshe-vsego-pit-pivo/ | 0 Нет ответа (HTTP 000) |
| ru | Пять пальцев одной руки или способы приготовления бешбармака | https://assembly.kz/ru/analitika/pyat-paltsev-odnoy-ruki-ili-sposoby-prigotovleniya-beshbarmaka/ | 0 Нет ответа (HTTP 000) |
| ru | Пивной сомелье (интервью) | https://www.the-village.ru/people/howtobe/335191-pivnoy-somelie | 302 HTTP 302 без тела |
| ru | Вина к шашлыку (топ-15) / Подбираем вино к тортам | https://simplewine.ru/articles/podborki/top-15-vino-i-shashlyk/ | 200 Также https://simplewine.ru/articles/food-and-wine/podbiraem-vino-k-tortam/ |

## 11. Источники, которые реально прочитаны и использованы

В таблицах — все 192 URL, на которые ссылаются `test_pairs.json` и `classic_pairs.json`. Столбец «Пар/записей» — сколько пар, ограничений и спорных или классических записей опирается на источник. Цитаты — в самих записях.

### Пиво (английские источники) (45)

| Источник | Что взяли | Пар/записей |
|---|---|---|
| [Brewers Association, American Craft Beer and Food: Perfect Companions (PDF, © 2009, текст R. Mosher; размещено Cicerone)](https://www.cicerone.org/sites/default/files/resources/Beer_and_Food_English.pdf) | Принципы (Match strength with strength; таблица Balances/Emphasizes; «involve both»), весь чарт на 28 стилей (основные блюда, сыры, десерты), температуры подачи | 80 |
| [Garrett Oliver, «Matching Beer & Food at the Brewmaster’s Table», All About Beer 24(3), 2003](https://allaboutbeer.com/article/matching-beer-food-at-the-brewmasters-table/) | «Impact» и «flavor hook»; большое пиво глушит деликатную рыбу, лёгкое «исчезает» рядом с рёбрами; раухбир ↔ копчёное; сыры (гауда, грюйер, чеддер × IPA, козий × пшеничное/ламбик, стилтон × ячменное вино); утка × kriek; спорные: сухой стаут и портвейн к шоколаду, фруктовое пиво к фруктовым десертам | 28 |
| [WSET, «Mastering the art of beer and food pairing» (2024)](https://www.wsetglobal.com/knowledge-centre/blog/2024/february/mastering-the-art-of-beer-and-food-pairing) | Мощный стаут × мидии = avoid; fish & chips × pale ale = top3; Цезарь × вит, IPA × бургер, фрукт. ламбик × чизкейк = good | 15 |
| [Garrett Oliver, «food pairing», The Oxford Companion to Beer (Craft Beer & Brewing)](https://www.beerandbrewing.com/dictionary/9jYnWqXy1G) | Коричневый эль × стейк; дуббель × карбонара = good | 13 |
| [Cicerone Certification Program, Advanced Cicerone Syllabus v5.0 (2022), раздел Pairing Beer with Food](https://www.cicerone.org/sites/default/files/resources/English_AC_Syllabus_V5.0.pdf) | DIPA × сельдь (горечь + солёная рыба = металл); официальные «классические пары» | 8 |
| [CraftBeer.com — «Everything You Need to Know About Pairing Beer and Cheese» (2017) (Jeremy Storton (Certified Cicerone, BJCP))](https://www.craftbeer.com/beer-and-food/pairing-beer-and-cheese-10-styles) | Пилс × тушёное мясо = bad; имперский стаут × салат = avoid; сезон × камамбер, гозе × пармезан = good | 7 |
| [N. Garneau, «Science Says You’re Wrong About Pairing IPAs and Spicy Foods», CraftBeer.com (панель Sam Adams)](https://www.craftbeer.com/beer-and-food/science-says-youre-wrong-about-pairing-ipas-and-spicy-foods) | Панель Sam Adams × CIA: 8.4 %/85 IBU усиливает жжение, 6.5 %/45 IBU снижает, 4.5 % — жжение дольше; автор сам пишет, что это не научный результат | 6 |
| [CraftBeer.com — «3 Tips for Pairing Beer and Chocolate» (2016) (Jeff (автор CraftBeer.com, ведёт классы пиво+шоколад с шоколатье Sarah Amorese))](https://www.craftbeer.com/beer-and-food/beer-and-chocolates-not-so-secret-love-affair) | 3 негативные пары (пилс/pale ale/IPA × тёмный шоколад) и хефевайцен × лимонный тарт | 5 |
| [Tasting Table — «The Important Rule To Remember When Pairing Beer With Chocolate» (2025) (Gene Gerrard; цитаты Rich Higgins (Master Cicerone, сертифиц. сомелье))](https://www.tastingtable.com/1751103/how-to-pair-beer-with-chocolate/) | IPA/пилс × сладкий шоколадный десерт = bad; шварцбир/портер × тёмный шоколад = good | 5 |
| [CraftBeer.com — «Salinity & Suds: Pairing Beer with Seafood» (2022) (Michael Harlan Turkell; цитаты шефов/байеров (Row 34, Rosella, FIG/The Ordinary))](https://www.craftbeer.com/editors-picks/salinity-suds-pairing-beer-with-seafood) | DIPA × суши = bad; хеллес × суши, pale ale × суши, пилс × устрицы = good | 4 |
| [CraftBeer.com / Brewers Association — «Craft Beer & Pizza Guide» (PDF-чарт, 2017) (Brewers Association (CraftBeer.com, статья Andy Sparhawk))](https://cdn.craftbeer.com/wp-content/uploads/Pizza_Beer_Pairing_Guide.pdf) | Маргарита × богемский пилс, Маргарита × амбер-лагер, пепперони × APA, пепперони (острая) × хефевайцен = good | 4 |
| [The Oxford Companion to Beer — «cheese (pairing)» (Craft Beer & Brewing) (Garrett Oliver)](https://www.beerandbrewing.com/dictionary/xdzEFJBzaA) | Ячменное вино × выдержанный сыр, трипель × тройной крем (бри) = good; оговорки по голубым сырам и созревшим коркам | 4 |
| [Brett Newton (Certified Cicerone), «Desert Cicerone: Pairings of Beer and Food…», Coachella Valley Independent (2018, копия Wayback)](https://web.archive.org/web/2019/https://cvindependent.com/2018/01/desert-cicerone-pairings-of-beer-and-food-can-be-matches-made-in-heaven-or-they-can-be-metallic-tasting-messes/) | IPA × сельдь (жирная рыба) = bad; подтверждения классики стаут × устрицы, APA × тако, коричневый эль × чеддер | 3 |
| [Hop Culture, «The 5-Minute Guide to IPA Food Pairing»](https://www.hopculture.com/best-ipa-food-pairing-guide/) | IPA × fish & chips = good | 3 |
| [CraftBeer.com, «Beer Pairings: Making the Case to Taste» (2012)](https://www.craftbeer.com/craft-beer-muses/making-the-case-to-taste) | Подтверждение классики | 2 |
| [The Cheese Professor, «Why Beer Pairs Well with Cheese» (цитаты Randy Mosher)](https://www.cheeseprofessor.com/blog/pairing-beer-with-cheese) | Мошер: «Bambi vs. Godzilla» (Bud Light × шоколадный торт), «Bitter cuts sweet, and bitter cuts fat», хефевайцен × буррата | 2 |
| [Charlie Papazian, «Umami: It’s Not About the Marriage — It’s About the Child», CraftBeer.com](https://www.craftbeer.com/beer-and-food/umami-its-not-about-the-marriagemdash-its-about-the-child) | Умами поднимается кислотой, солью, горечью; пары пармезан × портер, прошутто × пилснер | 2 |
| [CraftBeer.com, «Grillmasters: Pairing Craft Beer with Your Favorite Grilled Dishes» (2015)](https://www.craftbeer.com/beer-and-food/pairing-craft-beer-favorite-grilled-dishes) | Коричневый эль × шашлык (shish kebab) = good | 2 |
| [Adam Dulye (шеф Brewers Association), «Going Beyond Pairing Basics», CraftBeer.com (2016)](https://www.craftbeer.com/beer-and-food/going-beyond-beer-pairing-basics) | Принципы | 2 |
| [CraftBeer.com — «Spice, Fat, Acid, Beer» (2021) (Michael Harlan Turkell; цитаты шефа Rachel Yang (Joule, Сиэтл))](https://www.craftbeer.com/full-pour/spice-fat-acid-beer) | Большое хмелевое пиво × кислый овощной салат = bad; жареная курица × светлый лагер (чимэк) = good | 2 |
| [InsideHook — «How to Plan a Beer and Cheese Pairing» (2022) (Kirk Miller; цитаты Sam Calagione (Dogfish Head) и Charles Duque (French Dairy Board))](https://www.insidehook.com/drinks/beer-cheese-pairing) | Пилс × голубой сыр = bad (Calagione); бри × крепкий IPA = bad (Duque) | 2 |
| [NPR — «In Matchup Of Beer And Cheese, Everybody Wins — With A Good Coach» (2012) (Bill Chappell; прямые цитаты Garrett Oliver)](https://www.npr.org/2012/02/03/146106524/in-matchup-of-beer-and-cheese-everybody-wins-with-a-good-coach) | Сезон × свежий козий сыр, имперский стаут × стилтон = good | 2 |
| [CraftBeer.com — «A Sensory Experiment: Samuel Adams and the Culinary Institute of America Study the Correlation Between Hops and Heat» (2015) (Samuel Adams (J. Glanville) + эксперты CIA (D. Miller, D. McCue, T. Vaccaro, J. Zearfoss))](https://www.craftbeer.com/news/brewery-news/a-sensory-experiment-samuel-adams-and-the-culinary-institute-of-america-study-the-correlation-between-hops-and-heat) | IPA 6,5 %/45 IBU × Buffalo wings = good (самая гармоничная); DIPA 8,4 %/85 IBU — резко усиливает жжение | 2 |
| [Craft Beer & Brewing, «Beer and Food Pairing 101» (2015)](https://www.beerandbrewing.com/beer-and-food-pairing-101) | Не включено: утверждения спорят с другими источниками | 2 |
| [CraftBeer.com, «Advice for Simple Holiday Beer and Food Pairings» (2020)](https://www.craftbeer.com/beer-and-food/simple-holiday-beer-food-pairings) | Подпорка T07: шоколадный торт × имперский стаут «Richness meets richness» | 1 |
| [James Hastings, «The Best Beer Pairings To Balance Spicy Foods», Tasting Table (2024)](https://www.tastingtable.com/1546885/best-beer-pairings-spicy-food/) | Лагеры «temper the heat»; не всякое пиво гасит острое | 1 |
| [Randy Mosher, «Flavor Fever: Beer, Food, Science, Magic», Craft Beer & Brewing](https://www.beerandbrewing.com/flavor-fever-beer-food-science-magic) | Подтверждения существующих пар (хефевайцен × буррата, IPA × голубой сыр) | 1 |
| [Julia Herz, «Unscrambling Your Senses: Interpreting Craft Beer and Food Pairings», CraftBeer.com](https://www.craftbeer.com/craft-beer-muses/the-sensory-side-of-craft-beer-pairing) | Подтверждение существующей пары IPA × морковный торт | 1 |
| [CraftBeer.com — стиль German-Style Dunkel (блок Food Pairings) (Brewers Association / CraftBeer.com)](https://www.craftbeer.com/styles/german-style-dunkel) | Дункель × колбаски = good | 1 |
| [Tasting Table, «A Cicerone Explains How To Choose The Best Beer Pairing For Spicy Dishes»](https://www.tastingtable.com/1560382/how-choose-best-beer-pairing-spicy-food-explained/) | Принцип без конкретного блюда | 1 |
| [CraftBeer.com — «How to Pair Beer with Desserts That Aren’t Chocolate» (2018) (Bryan M. Richards; цитата Damian McConn (head brewer, Summit))](https://www.craftbeer.com/beer-and-food/no-chocolate-no-problem-how-to-pair-beer-with-desserts-that-arent-chocolate) | Чешский пилснер × клубника со сливками = good | 1 |
| [CraftBeer.com — «Meat & Malt: Beer Makes Burgers Better» (2024) (Michael Harlan Turkell; цитата Richard Hanauer (wine director RPM, Чикаго))](https://www.craftbeer.com/full-pour/meat-malt-beer-makes-burgers-better) | Пилснер × бургер = good | 1 |
| [CraftBeer.com — стиль German-Style Helles (блок Food Pairings) (Brewers Association / CraftBeer.com)](https://www.craftbeer.com/styles/german-style-helles) | Хеллес × пахлава = good (блок Food Pairings: Samosas / Colby / Baklava) | 1 |
| [CraftBeer.com — «Game Day Beer & Food Pairing Playbook» (2020) (Andy Sparhawk (Certified Cicerone, BJCP))](https://www.craftbeer.com/beer-and-food/game-day-beer-and-food-pairing-playbook) | Американский лагер × копчёная грудинка (burnt ends) = good | 1 |
| [CraftBeer.com — стиль German-Style Bock (блок Food Pairings) (Brewers Association / CraftBeer.com)](https://www.craftbeer.com/styles/german-style-bock) | Бок × стейк рибай = good | 1 |
| [Cicerone Certification Program — блог «Ten Ideas for Pairing Beer and Cheese» (Shana Solarte (Cicerone))](https://www.cicerone.org/us-en/blog/ten-ideas-for-pairing-beer-and-cheese) | Доппельбок × голубой сыр = good | 1 |
| [CraftBeer.com — «10 Beer and Food Pairings That Wow Craft Brewers» (2017) (Lori Rice; цитата Randy Mosher (5 Rabbit))](https://www.craftbeer.com/beer-and-food/beer-food-pairings-wow-craft-brewers) | Витбир (с маракуйей) × севиче = good | 1 |
| [CraftBeer.com — «Stumped on How to Pair IPAs? Try These Tips» (2017) (Adam Dulye (шеф Brewers Association, соавтор курса Beer & Food))](https://www.craftbeer.com/beer-and-food/stumped-pair-ipas-try-tips) | DIPA × морковный торт = good | 1 |
| [CraftBeer.com — «Craft Beer and Cheese Style Guide» (2016; предоставлено American Cheese Society) (American Cheese Society / CraftBeer.com)](https://www.craftbeer.com/educational-resources/craft-beer-cheese-style-guide) | DIPA × голубой сыр = good | 1 |
| [CraftBeer.com — стиль English-Style Oatmeal Stout (блок Food Pairings) (Brewers Association / CraftBeer.com)](https://www.craftbeer.com/styles/english-style-oatmeal-stout) | Овсяный стаут × чизкейк (Sweet Potato Cheesecake) = good | 1 |
| [CraftBeer.com — стиль Smoke Beer (блок Food Pairings) (Brewers Association / CraftBeer.com)](https://www.craftbeer.com/styles/smoke-beer) | Копчёное пиво × пармезан = good | 1 |
| [CraftBeer.com — стиль Belgian-Style Saison (блок Food Pairings) (Brewers Association / CraftBeer.com)](https://www.craftbeer.com/styles/belgian-style-saison) | Сезон × мидии = good | 1 |
| [CraftBeer.com — стиль Belgian-Style Tripel (блок Food Pairings) (Brewers Association / CraftBeer.com)](https://www.craftbeer.com/styles/belgian-style-tripel) | Трипель × крем-брюле = good | 1 |
| [CraftBeer.com — стиль Belgian-Style Dubbel (блок Food Pairings) (Brewers Association / CraftBeer.com)](https://www.craftbeer.com/styles/belgian-style-dubbel) | Дуббель × копчёная колбаса = good | 1 |
| [Garrett Oliver, заметки доклада на Craft Brewers Conference 2002 (ClassicCityBrew)](https://www.classiccitybrew.com/garrettoliver.html) | Только как подтверждение (вторичный конспект) | 1 |

### Вино, игристое, креплёное (54)

| Источник | Что взяли | Пар/записей |
|---|---|---|
| [Court of Master Sommeliers Europe, Food and Wine Matching (PDF, 2022)](https://courtofmastersommeliers.org/wp-content/uploads/2022/11/Food-and-Wine-1.pdf) | Quick overview: weight with weight, acidity needs acidity, fish oils/tannin, sweets need sweets, alcohol + spicy = fire, salt softens tannins; конкретных пар нет (слайд «Classic pairings» — фото) | 22 |
| [Wine Folly — 7 Deadly Sins of Wine and Food Pairing (7 Worst Wine and Food Pairings) (Madeline Puckette)](https://winefolly.com/tips/7-worst-wine-and-food-pairings/) | Негативы: Каберне+икра, красное+шоколадный торт, Шардоне+мороженое, Вионье+десертный тарт; позитив: Шампанское+устрицы | 9 |
| [Tim Gaiser MS, «Food and Wine Pairing in Less Than 500 Words»](https://timgaiser.com/wine-blog/food-and-wine-pairing-in-less-than-500-words/) | Элементы вина и блюда: кислотность — самая гибкая, танин — наименее; острое требует сахара, соль усиливает танин | 8 |
| [Decanter, «Pairing wine with tricky ingredients» (Ronan Sayburn MS)](https://www.decanter.com/learn/difficult-food-and-wine-pairing-tricky-ingredients-445974/) | Сельдь+Мюскаде; копчёный лосось+Шампанское/Шабли (классика); копчёности+Фино | 6 |
| [JancisRobinson.com — Wines for tricky foods (10 May 2025; Wayback copy, live page 403) (Jancis Robinson MW)](https://web.archive.org/web/2025/https://www.jancisrobinson.com/articles/wines-tricky-foods) | Козий сыр+Сансер; спаржа+Совиньон; негатив: спаржа+розовое; голубой сыр+сладкие белые | 6 |
| [Laurent-Perrier — Which Champagne for Dessert? (Olivier Vigneron (Champagne Laurent-Perrier))](https://www.laurent-perrier.com/en/guide-and-tips/selecting-the-best-champagne/occasion/champagne-for-dessert/) | Фондан/крем-брюле/мороженое+Demi-Sec; негатив: брют+сладкий десерт; фрукты+брют | 5 |
| [WSET — How to pair wine with your favourite takeaway meals (2020) (Julie Albin DipWSET (WSET Americas))](https://www.wsetglobal.com/knowledge-centre/blog/2020/june/02/how-to-pair-wine-with-your-favourite-takeaway-meals) | Бургер+танинное красное; фритюр+Москато д'Асти; негативы: умами (рамен, тайское карри)+танин | 5 |
| [La Cucina Italiana — Wines to Pair With Tiramisu (Valentina Vercelli)](https://www.lacucinaitaliana.com/italian-food/italian-dishes/tiramisu-best-wine-pairings) | Тирамису: сладкое игристое красное, Марсала; негативы: сухое, Мускат | 4 |
| [Wine Folly — It's All About The Sauce: Pairing Wine with Lamb, Steak, and Other Red Meat (Madeline Puckette)](https://winefolly.com/tutorial/wine-with-lamb-steak-red-meat/) | Шницель+Грюнер, BBQ-рёбра+Шираз/сладкий Ламбруско | 4 |
| [WSET, «Four essential rules to master food and wine pairing» (2023)](https://www.wsetglobal.com/knowledge-centre/blog/2023/july/13/four-rules-to-masterful-food-and-wine-pairing) | Упражнение соль/лимон/сыр с Кьянти; «salty rib eye steak and a tannic and acidic Barolo» | 3 |
| [Wine Folly — Our Advice for Pairing Wine with Salmon (Madeline Puckette)](https://winefolly.com/tutorial/pairing-wine-with-salmon/) | Лосось+Луарский Совиньон; лосось+низкотанинное красное | 3 |
| [Decanter — How to pair wine with sushi (Sylvia Wu (quoting Hiroshi Ishida, Best Sommelier of Asia-Oceania 2015))](https://www.decanter.com/learn/food/how-to-pair-wine-with-sushi-424103/) | Суши+минеральные белые; негатив: суши+Напа Каберне | 3 |
| [Wine Folly — 12 Classic Wine and Cheese Pairings You Must Try (Phil Keeling (WSET II))](https://winefolly.com/wine-pairing/12-classic-wine-and-cheese-pairings-you-have-to-try/) | Бри+Шампанское; Горгонзола+Москато д'Асти; Грюйер+Пино Нуар | 3 |
| [WSET — Traditional vs alternative food and drinks pairings for Christmas (2025) (Lydia Harrison MW (WSET Wine Educator))](https://www.wsetglobal.com/knowledge-centre/blog/2025/december/15/traditional-and-alternative-festive-pairings-wine-versus-spirits) | Стилтон+винтажный портвейн; твёрдые сыры+Мальбек | 3 |
| [Decanter China — The 10 rules of food and wine pairing by Karen MacNeil (excerpt from The Wine Bible)](https://www.decanterchina.com/en/knowledge/trivia/the-10-rules-of-food-and-wine-pairing-by-karen-macneil) | Стейк+Калифорнийский Каберне (классика); негатив: красный бургундский+карри | 2 |
| [Wine Folly — Pairing Wine with Fish (Madeline Puckette)](https://winefolly.com/tutorial/wine-with-fish-pairing-guide/) | Негатив V4: танинное красное + рыба (лосось, форель) | 2 |
| [Wikipedia, «Wine and food pairing» (сводка Goldstein MS, Oldman и др.)](https://en.wikipedia.org/wiki/Wine_and_food_pairing) | Брют со свадебным тортом — «tart and weak»; танин × рыбий жир | 2 |
| [Wine Enthusiast — Four Tried-and-True Oyster and Wine Pairings (Wayback copy, live page 403) (Nils Bernstein)](https://web.archive.org/web/2025/https://www.wineenthusiast.com/basics/how-to-pair/oyster-wine-pairings-guide/) | Устрицы+Мюскаде (классика) | 2 |
| [Decanter — What wines to pair with lamb (offbeat pairings) (Fiona Beckett)](https://www.decanter.com/learn/what-wines-to-pair-with-lamb/) | Баранина на гриле+Ассиртико; +Тавель | 2 |
| [WSET — 15 must-try pairings for pizza night (2025) (WSET Global (staff, 'expert-approved pairings from our colleagues'))](https://www.wsetglobal.com/knowledge-centre/blog/2025/15-must-try-pairings-for-pizza-night) | Маргарита+Вердиккио; мясная пицца+прохладноклиматический Сира | 2 |
| [Wine Folly — Hot Wines, Hot Wings: Pairing Wine and Wings (Phil Keeling (WSET II))](https://winefolly.com/wine-pairing/hot-wines-hot-wings-pairing-wine-and-wings/) | Баффало-крылья+полусухой рислинг/Вувре/Гевюрц | 2 |
| [Wine Folly — Best Wine For Sushi? Try One of These (Haley Mercedes (WSET Diploma candidate))](https://winefolly.com/wine-pairing/best-wine-sushi-try-one/) | Спайси-ролл+Кабинетт; Калифорния-ролл+прованское розовое | 2 |
| [Wine Folly — Definitive Guide to Pairing Wine With Chicken and Other Poultry (Madeline Puckette)](https://winefolly.com/tutorial/what-wine-goes-with-chicken-and-poultry/) | Утка+Пино Нуар (классика) | 2 |
| [Decanter — Best wine with steak: What to choose (Decanter (quoting Patricio Tapia, Peter Richards MW, Karen MacNeil))](https://www.decanter.com/learn/advice/wine-steak-ask-decanter-400770/) | Стейк барбекю+Сира/Шираз; тартар+Пино Нуар | 2 |
| [Decanter — Pairing wine with seafood: Expert advice and five perfect matches (Fiona Sims (quoting sommeliers Marcello Colletti et al.))](https://www.decanter.com/wine/pairing-wine-with-seafood-expert-advice-and-five-perfect-matches-to-try-tonight/) | Фиш-энд-чипс+мансанилья; рыба на гриле+лёгкие красные | 2 |
| [Wine Folly — 10 Wine and Grill Food Pairings Made For The Porch (Phil Keeling (WSET II))](https://winefolly.com/wine-pairing/10-wine-and-grill-food-pairings-made-for-the-porch/) | Братвурст+Цвайгельт; лосось на гриле+розовое из Санджовезе | 2 |
| [Matching Food & Wine (Fiona Beckett's site) — What to drink with a kebab - and it's not lager! (Zeren Wilson (guest post))](https://www.matchingfoodandwine.com/news/recent/what-to-drink-with-a-kebab---and-its-not-lager/) | Шашлык из баранины+Каор/Рибера; Адана+Шираз | 2 |
| [Wine Folly — Malbec Food Pairing Ideas (Madeline Puckette)](https://winefolly.com/wine-pairing/malbec-food-pairing-ideas/) | Негативы: «рыбная» рыба и салаты с винегретом + полнотелое красное | 2 |
| [Wine Folly — What Wines To Pair With Chocolate? (Madeline Puckette)](https://winefolly.com/wine-pairing/what-wines-to-pair-with-chocolate/) | Негатив: тёмный шоколад+сухой Каберне; позитив: красные с остаточным сахаром | 2 |
| [Decanter — What are the best wines for spicy food? (Ask Decanter) (Decanter (with Matthieu Longuère MS, Anne Krebiehl MW, Fiona Beckett))](https://www.decanter.com/learn/advice/what-s-the-wine-style-for-spicy-foods-51397/) | Чили кон карне+Зинфандель; негатив: чили+высокотанинное | 2 |
| [WSET — Sherry and food: the perfect match (2020) (Lauren Denyer DipWSET (WSET School London))](https://www.wsetglobal.com/knowledge-centre/blog/2020/november/03/sherry-and-food-the-perfect-match) | Суши+Фино; ванильное мороженое+PX | 2 |
| [IntoWine, «Revolutionary Pairing Theory Developed by Rebel Master of Wine Tim Hanni»](https://www.intowine.com/revolutionary-pairing-theory-developed-rebel-master-wine-tim-hanni) | Опыт Ханни: спаржа без соли делает шираз горьким и кислым; сладость/умами ужесточают вино | 1 |
| [Fred Swan, «Food & Wine Pairing Made Easy» (по Page & Dornenburg)](https://www.fredswan.wine/2016/04/19/food-wine-pairing-made-easy/) | Уксус «убивает» вино; сладкое требует более сладкого вина | 1 |
| [Wine Folly — Discover the Best Wines for Spaghetti (Phil Keeling (WSET II))](https://winefolly.com/wine-pairing/discover-spaghetti-wine-pairings/) | Карбонара+Соаве | 1 |
| [Wine Folly — Wine and Cheese Pairing Ideas (Madeline Puckette)](https://winefolly.com/tutorial/wine-cheese-pairing-ideas/) | Негатив: голубой сыр+сухие белые | 1 |
| [WSET — A flavourful affair: The art of pairing Indian food with wine (2023) (Nikita Hemani (WSET Level 2 graduate), WSET blog)](https://www.wsetglobal.com/knowledge-centre/blog/2023/september/27/a-flavourful-affair-the-art-of-pairing-indian-food-with-wine) | Карри+полусухой рислинг (названо классикой) | 1 |
| [Wine Folly — 7 Tasty Pairings For Dessert and Wine (Phil Keeling (WSET II))](https://winefolly.com/wine-pairing/7-tasty-pairings-for-dessert-and-wine/) | Яблочный пирог+Гевюрцтраминер | 1 |
| [Wine Folly — Fried Chicken Wine Pairings (Vincent Rendoni)](https://winefolly.com/wine-pairing/fried-chicken-wine-pairings/) | Жареная курица+брют-игристое (good, не top3: сам текст называет пару «soon-to-be classic») | 1 |
| [Comité Champagne (champagne.fr) — Non-vintage Champagne Brut](https://www.champagne.fr/en/champagne-tasting/type-of-champagne/non-vintage-brut) | Овощная темпура+брют | 1 |
| [Comité Champagne (champagne.fr) — Champagne Blanc de Noirs](https://www.champagne.fr/en/champagne-tasting/choosing-your-champagne/blanc-de-noirs) | Молочный поросёнок+блан-де-нуар | 1 |
| [Comité Champagne (champagne.fr) — Champagne Rosé](https://www.champagne.fr/en/champagne-tasting/choosing-your-champagne/champagne-rose) | Жареная птица+розовое шампанское | 1 |
| [Comité Champagne (champagne.fr) — Champagne Demi-sec to Doux](https://www.champagne.fr/en/champagne-tasting/choosing-your-champagne/demi-sec) | Клубнично-фисташковый тарт+демисек | 1 |
| [Decanter — Great wines to drink with lamb (Decanter (quoting Kathrine Larsen-Robert MS))](https://www.decanter.com/learn/food/wine-with-lamb-easter-food-matching-296118/) | Бараньи отбивные+Бароло/Барбареско | 1 |
| [Wine Folly — The Best Wine to Pair with Lasagna (Vincent Rendoni)](https://winefolly.com/wine-pairing/what-kind-of-wine-goes-with-lasagna/) | Лазанья+Альянико (танинное красное) | 1 |
| [Wine Folly — Goat Cheese Wine Pairings You'll Love (Vincent Rendoni)](https://winefolly.com/wine-pairing/goat-cheese-wine-pairing/) | Негатив: крупные фруктовые красные+козий сыр | 1 |
| [WSET — A guide to Easter food & wine pairings (2024) (WSET School London)](https://www.wsetglobal.com/knowledge-centre/blog/2024/march/26/a-guide-to-easter-food-wine-pairings) | Тёмный шоколад+Руби/Тони | 1 |
| [Wine Folly — Wine With Mexican Food: Starting With The Basics (Pamela Ocana)](https://winefolly.com/wine-pairing/wine-with-mexican-food-starting-with-the-basics/) | Тако аль пастор+розовое | 1 |
| [Wine Folly — Wines for Apple Pie, Pumpkin Pie, & More (Madeline Puckette)](https://winefolly.com/wine-pairing/pie-and-wine-pairings-done-right/) | Чизкейк+айсвайн | 1 |
| [WSET — Wine styles to pair with your Thanksgiving dinner (2025) (Christine Kamine (WSET Americas))](https://www.wsetglobal.com/knowledge-centre/blog/2025/november/20/wine-styles-to-pair-with-your-thanksgiving-dinner) | Яблочный тарт+сладкий луарский Шенен | 1 |
| [Decanter — Nightmare food and wine matches: From the sommeliers (Ellie Douglas (quoting Arvid Rosengren, Maria Wallèn et al.))](https://www.decanter.com/learn/nightmare-food-wine-matches-sommeliers-372763/) | Негатив: Сотерн+мороженое (Arvid Rosengren) | 1 |
| [Decanter — Wine with burgers: Pairing advice (Decanter (quoting Beatrice Bessi, Clive Pursehouse, Michaela Morris))](https://www.decanter.com/learn/food/how-to-pair-wine-with-burgers-423106/) | Негатив: сладкое вино (Сотерн)+бургер с голубым сыром | 1 |
| [Matching Food & Wine — The best pairings for fino and manzanilla sherry (free intro, rest paywalled) (Fiona Beckett)](https://www.matchingfoodandwine.com/news/pairings/the-best-pairings-for-fino-and-manzanilla-sherry/) | Спаржа+фино (только бесплатное вступление; остальное платное) | 1 |
| [Wine Enthusiast, «Yes, You Can Pair Red Wine with Fish» (копия Wayback)](https://web.archive.org/web/2025/https://www.wineenthusiast.com/culture/wine/pair-red-wine-fish/) | Только спорные тезисы | 1 |
| [Wine Folly, «Tested: Wine with Spicy Food» (Madeline Puckette)](https://winefolly.com/video/what-wine-with-spicy-food/) | Только спорные тезисы (блюдо — острая тайская лапша с говядиной, нет id) | 1 |

### Сидр, коктейли, крепкое, саке, чай, безалкогольное (48)

| Источник | Что взяли | Пар/записей |
|---|---|---|
| [Death & Co (Drink Fellows), о коктейлях и еде](https://drinkfellows.com/blogs/news/international-workers-day-mothers-day-cinco-de-mayo) | Death & Co: цитрусовый коктейль ↔ жареное солёное; Негрони ↔ брецели; спритц ↔ пармезан; Манхэттен ↔ тёмный шоколад и нарезка; коктейли утомляют в полной трапезе | 12 |
| [The Whisky School, «Whisky Food Pairing Guide»](https://www.thewhiskyschool.com/whisky-food-pairing-guide/) | Бочковая крепость + лёгкий салат (main, avoid, evidence D); Islay-традиция с устрицами (extra) | 8 |
| [Alcohol Professor — How to Pair Hard Cider and Food (Kristen Richard (quoting Jennie Dorsey/ACA, Talia Haykin, Eli Shanks))](https://www.alcoholprofessor.com/blog-posts/how-to-pair-hard-cider-and-food) | Помо + крем-брюле (main); сидр + рамен, айс-сайдер + шоколадные трюфели (extra) | 5 |
| [Food & Wine / AOL: Lynnette Marrero, «How to Pair Cocktails With Food»](https://www.aol.com/articles/pair-cocktails-food-brunch-dessert-170100513.html) | Маргарита + начос, манхэттен + бургер (main) | 5 |
| [CIDERCRAFT — The Takeaway on Takeout (CIDERCRAFT Magazine)](https://cidercraftmag.com/the-takeaway-on-takeout/) | Сладкий сидр + карри (main); танинный «heritage» сидр + рибай (main); полусладкий + BBQ, сухой + жареная курица, кислотный heritage + суши (extra) | 5 |
| [MasterClass — How to Pair Cocktails With Food: 5 Tips for Food Pairings (MasterClass (companion article to the Lynnette Marrero & Ryan Chetiyawardana mixology class))](https://www.masterclass.com/articles/how-to-pair-cocktails-with-food) | Маргарита + тако (top3), негрони/спритц + пармезан (main); олд фэшн + утка (extra) | 4 |
| [Tea and Herbal Association of Canada — Cooking & Pairing (Tea and Herbal Association of Canada (runs the Tea Sommelier® program))](https://www.tea.ca/learn/tea-food-pairing/) | Чёрный чай + говядина, + медовые десерты (main); + голубой сыр; зелёный чай + моллюски на пару (extra) | 4 |
| [Scotch Whisky Association — Whisky Tasting Toolkit (2020), 'Food pairings' (Scotch Whisky Association (SWA))](https://www.scotch-whisky.org.uk/media/1714/swa-tasting-toolkit_2020.pdf) | Islay + голубой сыр, односолодовый + твёрдый сыр, скотч + тёмный шоколад (main); купаж + мягкий сыр (extra) | 4 |
| [WSET — Beyond sushi: discover the full potential of sake pairing (WSET Global, with Natsuki Kikuya (Sake Samurai, WSET School London educator))](https://www.wsetglobal.com/knowledge-centre/blog/2025/beyond-sushi-discover-the-full-potential-of-sake-pairing) | Саке + суши, спаржа, butter chicken (main); устрицы (extra) | 4 |
| [Northwest Cider Association, «Cider Pairings»](https://www.nwcider.com/cider-pairings/) | Пара полусухой игристый сидр + устрицы (main); подтверждение айс-сайдер + голубой сыр, помо + шоколадный торт, хмелевой полусухой + пицца пепперони | 3 |
| [Del Maguey — What Pairs Well with Mezcal? (Del Maguey Single Village Mezcal (producer))](https://delmaguey.com/what-pairs-well-with-mezcal/) | Мескаль + стейк (main, D); мескаль + тако аль пастор (extra); также севиче, выдержанные сыры (Manchego) | 3 |
| [World Tea News: Sharyn Johnston & James Tidwell MS, pairing beverages and food](https://www.worldteanews.com/food-service-hospitality/inside-tea-industry-sharyn-johnston-pairing-beverages-and-food-master) | Гёкуро + козий сыр (main) | 3 |
| [The Takeout — 8 Best Ways To Enjoy Steak With Bourbon, According To Experts (The Takeout, quoting Edward Lee, Victor Muñoz, Charly Naranjo (sommelier))](https://www.thetakeout.com/2031619/best-steak-bourbon-pairing-tips/) | Бурбон + стейк (top3), олд фэшн + стейк (top3), бурбон бочковой крепости + стейк (main) | 3 |
| [The Three Drinkers — What you Should be Drinking with Curry (Helena Nicklin (The Three Drinkers))](https://www.thethreedrinkers.com/magazine-content/the-best-drinks-with-curry) | Негатив: крепкий спирт + карри (avoid); безалкогольный лагер + карри (good) | 3 |
| [Pen Online — The Pairing of Food and Green Tea, A Gateway to Japanese Cuisine (Pen, with Japanese tea instructor Per Oscar Brekell)](https://pen-online.com/food/the-pairing-of-food-and-green-tea-a-gateway-to-japanese-cuisine/) | Маття + вагаси (top3); сенча + тёмный шоколад (bad) | 3 |
| [The Mediterranean Dish — Ayran (Turkish Salty Yogurt Drink) (The Mediterranean Dish (Devin Fuller))](https://www.themediterraneandish.com/ayran-turkish-yogurt-drink/) | Айран + донер (top3), айран + кебаб/шашлык (main) | 3 |
| [Glass & Note, «The Last Spritz Food Pairing Guide» (2026; текст похож на сгенерированный — слабый источник)](https://glassandnote.com/food/the-last-spritz) | ОТКЛОНЁН: не использован | 2 |
| [Love British Food — Tips for Cider & Food Matching (Jane Peyton (UK's first accredited cider sommelier))](https://www.lovebritishfood.co.uk/tips-for-cider-food-matching) | Негативы: танинный сидр + острое (bad), сухой сидр + сладкое (avoid, V2) | 2 |
| [Scotchwhisky.com — How chefs pair food with whisky (Emma Eversham, quoting chef Troy Terrington (Dobson & Parnell))](https://scotchwhisky.com/magazine/food/16508/how-chefs-pair-food-with-whisky/) | Bowmore + копчёная сельдь (main); негатив: виски + деликатная рыба (main, bad) | 2 |
| [Whisky Advocate — How to Pair Whisky and Sushi (Whisky Advocate, with chef Hing Wong)](https://whiskyadvocate.com/how-to-pair-whisky-and-sushi) | Негативы: неразбавленный виски + суши, торфяной + суши (main) | 2 |
| [VinePair — The One Thing to Remember When Pairing Alcohol With Spicy Foods](https://vinepair.com/articles/spicy-food-alcohol-pairing-explainer/) | Принцип V3 (водка + острый лагман, avoid, evidence D); маргарита + острое (extra) | 2 |
| [KQED / NPR The Salt — Drink Vodka, Eat Pickles, Repeat: Mastering the Zakuski Spread (Deena Prichep, quoting Anya von Bremzen (author of 'Mastering the Art of Soviet Cooking'))](https://www.kqed.org/bayareabites/78315/drink-vodka-eat-pickles-repeat-mastering-the-zakuski-spread) | Водка + соленья (top3), водка + сельдь (main) | 2 |
| [The Daily Meal — The Professional Tips You Need For Pairing Foods With Tequila (The Daily Meal, quoting Pablo Antinori (co-founder, Socorro Tequila))](https://www.thedailymeal.com/1581541/pro-tips-pairing-food-tequila/) | Бланко + севиче (good), бланко + крупные мясные блюда (bad) | 2 |
| [Cognac.fr (BNIC) — Cognac-Food Pairings (Bureau National Interprofessionnel du Cognac (pairings from the International Cognac Summit, 45 tasting experts))](https://www.cognac.fr/en/tasting/drinking-cognac/cognac-food-pairings/) | VSOP + выдержанная мимолет (main, B); VS/frozen VS + копчёная сельдь (extra, B) | 2 |
| [Twinings — Food Pairing with… Tea! (Twinings (tea producer))](https://twinings.co.uk/blogs/news/food-pairing-with-tea) | Сенча + суши (main, D); чёрный чай + лазанья (extra, D) | 2 |
| [Imbibe — Chef James Rigato on Pairing Cider with Food (Emma Janzen (Imbibe), quoting chef James Rigato)](https://imbibemagazine.com/pairing-cider-with-food/) | Сухой сидр + жареная курица; сладкий сидр + пикантные сыры (extra) | 2 |
| [Decanter — Sake and food pairing – A beginner's guide (Sylvia Wu (Decanter), quoting Sarah Stewart, Vicky Vecchione, Miho Komatsu)](https://www.decanter.com/learn/sake-and-food-pairing-a-beginners-guide-541948/) | Караагэ + охлаждённое саке, хондзёдзо + чеддер/конте (extra) | 2 |
| [The Daily Pour, «Tequila and Taco Pairings»](https://thedailypour.com/agave/tequila/tequila-taco-pairings-guide/) | Бланко к тако аль пастор | 1 |
| [American Cider Association — Cider And Cheese Pairings For Any Occasion (Jennie Dorsey (ACA Certified Cider Professional working group))](https://ciderassociation.org/cider-and-cheese-pairings-for-any-occasion/) | Айс-сайдер + голубой сыр названа классикой (top3) | 1 |
| [Cider Culture / Pick Cider (official publication of the ACA) — The No-Sweat Guide to Cider-and-Food Pairings (Cider Culture, in partnership with the American Cider Association)](https://www.ciderculture.com/the-no-sweat-guide-to-cider-and-food-pairings/) | Сухой сидр + пицца пепперони (main); высококислотный сидр к японскому ужину (темпура, суши) | 1 |
| [Cider Review — 10 cider and perry food pairings for people who don't eat cheese (Adam Wells (author of 'Perry: A Drinker's Guide', Chair of the International Cider Challenge))](https://cider-review.com/2021/05/29/10-cider-and-perry-food-pairings-for-people-who-dont-eat-cheese/) | Негатив: сидр + шоколадный пудинг (main, bad) | 1 |
| [PUNCH — Can Food and Cocktails Really Pair Well? (Dan Saltzstein (PUNCH), quoting Scott Cameron (Atera), Eamon Rockey, Pascaline Lepeltier)](https://punchdrink.com/articles/can-food-and-cocktails-really-pair-well/) | Принцип десерта (main: негрони + тирамису, bad, evidence D) | 1 |
| [MasterClass — Pairing Cocktails With Food (class chapter transcript) (Lynnette Marrero & Ryan Chetiyawardana)](https://www.masterclass.com/classes/lynnette-marrero-and-ryan-chetiyawardana-teach-mixology/chapters/pairing-cocktails-with-food) | Принцип «крепкое не к деликатному» (main: манхэттен + суши, bad, evidence D) | 1 |
| [Japan Sake and Shochu Makers Association — Why Dessert Pairs Well with Sake (Japan Sake and Shochu Makers Association (JSS))](https://japansake.or.jp/sake/en/professional/sake-food-pairing-advanced/desserts/) | Кимото + чизкейк (main) | 1 |
| [Japan Sake and Shochu Makers Association — Why Sake Pairs Well with Seafood (case study: butter-sautéed salmon) (Japan Sake and Shochu Makers Association (JSS))](https://japansake.or.jp/sake/en/professional/sake-food-pairing-advanced/seafood/) | Дзюнмай 15°C + лосось (main, B — кейс-тест) | 1 |
| [e-history.kz — Kazakh hospitality: at the dastarkhan (e-history.kz (Kazakhstan history portal; after E.T. Dzhelbudin 'Traditions and customs of Kazakhs'))](https://e-history.kz/en/news/show/8497) | Чай с молоком + баурсаки (main, традиция) | 1 |
| [The Conversation — Why doesn't water help with spicy food? What about milk or beer? (Daniel Eldridge (Senior Lecturer in Chemistry, Swinburne University of Technology))](https://theconversation.com/why-doesnt-water-help-with-spicy-food-what-about-milk-or-beer-226624) | Вода + острое (bad) | 1 |
| [CIDERCRAFT — How to Pair Cider with the Savory, the Sweet and the Spicy (CIDERCRAFT (quoting Jana Daisy-Ensign, Joel VandenBrink))](https://cidercraftmag.com/how-to-pair-cider-with-the-savory-the-sweet-and-the-spicy/) | Сухой сидр + тайские/индийские блюда (extra); сухой хмелевой сидр + креветки в темпуре | 1 |
| [Aperol (official) — Aperol Spritz Food Pairings: A Taste of La Dolce Vita (Aperol / Campari Group (brand))](https://www.aperol.com/en-ca/blog/the-ultimate-aperol-spritz-food-pairing/) | Спритц + брускетта (extra, evidence D) | 1 |
| [VinePair — We Asked 10 Barbecue Pros: What's the Best Bourbon and Barbecue Pairing? (VinePair (barbecue pitmasters))](https://vinepair.com/articles/wa-bbq-pros-best-bourbon-bbq-pairing/) | Бурбон + BBQ-рёбра (extra) | 1 |
| [Matching Food & Wine — The best food to pair with vodka (Fiona Beckett)](https://www.matchingfoodandwine.com/news/pairings/the-best-food-to-pair-with-vodka/) | Водка + копчёная рыба (extra) | 1 |
| [Cognac Expert — Cognac Food Pairing: Course-by-Course Guide (Cognac Expert blog (senior editor Jacki))](https://blog.cognac-expert.com/cognac-food-pairing-a-la-carte/) | Коньяк + тёмный шоколад (extra) | 1 |
| [The Whisky Exchange Cognac Show — Cognac and food pairings (menu derived from the BNIC CognacPairing app)](https://cognacshow.com/london/latest-news-social/11697/cognac-and-food-pairings/) | XO + тарт Татен (extra); меню из приложения BNIC CognacPairing | 1 |
| [Japan Sake and Shochu Makers Association — Why Cheese and Charcuterie Pairs Well with Sake (case study: roasted pork) (Japan Sake and Shochu Makers Association (JSS))](https://japansake.or.jp/sake/en/professional/sake-food-pairing-advanced/cheese/) | Тёплое дзюнмай + запечённая свинина (extra, B) | 1 |
| [Matching Food & Wine — Six food pairings for gin that might surprise you (Fiona Beckett)](https://www.matchingfoodandwine.com/news/pairings/six-food-pairings-for-gin-that-might-surprise-you/) | G&T + сэндвичи с копчёным лососем (extra); паштет, prawn toast (нет id) | 1 |
| [Pairing Cocktails With Indian Food Is Easy — Just Ask Maneet Chauhan (Food & Wine, syndicated on Yahoo)](https://www.yahoo.com/lifestyle/pairing-cocktails-indian-food-easy-213456057.html) | Олд фэшн + индийская кухня (main, good) | 1 |
| [Cognac.fr (BNIC) — Cognac and gastronomy](https://www.cognac.fr/en/visit/cognac-and-gastronomy/) | Устрицы Marennes-Oléron + молодой коньяк со льдом (main) | 1 |
| [Mezcalistas — A crash course in what to pair with mezcal](https://www.mezcalistas.com/what-to-pair-with-mezcal/) | Мескаль (тепесте) + устрицы (extra) | 1 |

### Русскоязычные и казахстанские источники (41)

| Источник | Что взяли | Пар/записей |
|---|---|---|
| [Экспресс газета, сомелье Татьяна Жилина: «Почему шампанское с квашеной капустой — идеальная пара, а оливье с водкой — нет» (2023)](https://www.eg.ru/society/3867332-pochemu-olive-ne-sochetaetsya-s-vodkoy/) | Водка — к исконно русским закускам (не к оливье); оливье — к кислотному белому; игристое — не к шоколаду/чесночным соусам/варёным яйцам; игристое с квашеной капустой и огурцом | 18 |
| [Simple Wine News — «Русские сезоны: размышления шефов и сомелье о национальной кухне» (Татьяна Паласова (14.03.2024); сомелье Алексей Заверткин, Дмитрий Туфанов, Юлия Попова, Мария Трыкова, Роман Романов; шеф Владимир Мухин; ресторатор Денис Иванов)](https://swn.ru/articles/russkie-sezony-razmyshleniya-shefov-i-somele-o-natsionalnoy-kukhne) | Пельмени, борщ, оливье, сельдь, соленья, блины с икрой, медовик, окрошка — пары от сомелье московских ресторанов | 13 |
| [Drinktime, «Еда и пиво: лучшие сочетания от пивного сомелье» (2016; пивной сомелье Ю. Сусов)](https://drinktime.ru/dnf/51-eda-i-pivo-luchshie-sochetaniya-ot-pivnogo-somele.html) | Евролагер НЕ к вобле; стаут только к устрицам; стаут к сливочному мороженому; витбир к мидиям; фруктовое пиво к утке | 11 |
| [WineState (школа сомелье) — «Заходи на плов: вина к блюдам Средней Азии» (Алексей Гайворонский, преподаватель WineState)](https://winestate.ru/library/blog/zakhodi-na-plov-vina-k-blyudam-sredney-azii/) | Вина к лагману, самсе, бешбармаку, мантам, плову | 10 |
| [Роскачество — «Смелая гастропара: селедка и вино» (Роскачество (08.04.2023))](https://rskrf.ru/tips/obzory-i-topy/smelaya-gastropara-seledka-i-vino/) | Сельдь — идеальная пара водке; к шубе — экстра-брют; красные сухие мощные и сладкие вина к сельди — нет | 7 |
| [Simple Wine News, Сергей Акинфиев, «С какими винами сочетать кавказскую кухню» (2023)](https://swn.ru/articles/s-kakimi-vinami-stoit-sochetat-kavkazskuyu-kukhnyu) | Шашлык — каберне/мальбек/темпранильо, шираз (дымные ноты); плов — молодая риоха/гарнача, маслянистые белые | 7 |
| [Simple Wine News — «Виноделие в Казахстане», раздел «Гастрономические сочетания» (Валерия Тенисон (18.07.2023); цитата: Зульфия Ибрагимова, сомелье AlmaWine, вице-президент Ассоциации сомелье Казахстана)](https://swn.ru/regions/kazakhstan) | Сидр off-dry к цомяну/лагману и иримшику; игристое к баурсакам; сухой рислинг к хошану и бесбармаку; пино нуар к сур-ету; каберне фран к сырне; баурсаки макают в атканчай | 7 |
| [Monte Bianco (AlmaWine) — «Не кумысом единым: гид по сочетанию казахской кухни с вином» (Даяна Насырова (AlmaWine / Monte Bianco), 2025)](https://monte-bianco.kz/blog/ne-kumysom-edinym-gid-po-sochetaniyu-kazahskoy-kuhni-s-vinom.html) | Вина к бешбармаку, баурсакам, куырдаку, казы, сырне | 7 |
| [ТЧК (tea.ru) — «Как приготовить настоящий плов… советы шеф-повара и историка восточной кухни» (Шакир Юлдашев, шеф-повар Food Lab (09.08.2021))](https://tea.ru/article/kak-prigotovit-nastoyashchiy-plov-a-ne-kashu-s-myasom-sovety-shef-povara-i-istorika-vostochnoy-kukhni/) | К плову — только горячий несладкий зелёный чай; соки, газировки, алкоголь неуместны | 5 |
| [В. В. Похлёбкин, «История водки», приложение о закусках (зеркало vkus.narod.ru) (Вильям Похлёбкин)](https://vkus.narod.ru/vodka/vodka_09.htm) | Водка к пельменям, блинам с икрой, сельди, солёным огурцам, квашеной капусте, копчёной рыбе | 5 |
| [ОНТ, «Пивная эволюция: как подбирать закуски как сомелье» (2026)](https://ont.by/ru/society-ru/view/pivnaja-evoljutsija-kak-podbirat-zakuski-kak-somelje-322159-2026) | Принципы (интенсивность, контраст, связь); IPA к бургерам/тако; стаут к брауни и голубым сырам; вайсвурст + пшеничное — «канонический союз» | 4 |
| [Cooks.kz (Повара Казахстана) — «Кумыс на столе: классические комбинации и смелые эксперименты» (Редакция Cooks.kz)](https://cooks.kz/kumys-na-stole-cooks-kz-o-klassicheskih-kombinacziyah-i-smelyh-eksperimentah/) | Кумыс к бешбармаку и казы; баурсаки запивают кумысом | 4 |
| [e-history.kz (National Digital History) — «Традиции гостеприимства» (Портал «Открытая история» (e-history.kz))](https://e-history.kz/ru/seo-materials/show/28907) | Порядок угощения: кумыс/шубат/айран → чай с молоком с баурсаками, иримшиком, куртом → закуски из конины → бешбармак с сорпой → кумыс → чай | 4 |
| [Wine Nomad (winenomad.kz) — «Как сочетать вино и еду: гид от сомелье алматинского ресторана «Хороший год»» (Асем Тусупбаева (13.05.2026); сомелье Дильшат Хаширов)](https://winenomad.kz/how-to-pair-wine-and-food-good-year-restaurant.html) | Стейк из конины — мальбек/шираз; сочный стейк «задавит» хрупкое белое; фондан — сухой примитиво | 4 |
| [tea.ru (Очаково): как сделать вкуснее окрошку](https://tea.ru/article/kak-sdelat-vkusnee-okroshku-i-chem-mozhno-zamenit-kvas-krome-kefira-i-mineralki/) | Для окрошки — белый кислый квас, тёмный сладкий — «самостоятельный напиток» (о квасе как основе супа) | 3 |
| [РБК Вино — «„Ош“ — просто „еда“: как и где найти самый вкусный плов в Узбекистане» (Наталья Тен, основатель студии путешествий Wai Wai (28.07.2025))](https://www.rbc.ru/wine/news/6880a6f89a79470bd1665c32) | Плов запивают горячим чаем: в Ташкенте чёрным, в областях зелёным; холодные напитки к бараньему плову — плохая идея | 3 |
| [wine-and-spirits.md — «Какое вино выбрать к плову?» (цитирует Дениса Руденко) (Anghelina Taran (29.06.2024); прямая речь: Денис Руденко, российский винный эксперт)](https://wine-and-spirits.md/kakoe-vino-vybrat-k-plovu/) | Руденко: рислинг проигрывает специям плова; мускат/гевюрц/торронтес не держат жир; саперави и оранжевые вина работают; в Узбекистане к плову — зелёный чай | 3 |
| [РБК Вино — «Какие вина сомелье назвали лучшими к шашлыку» (РБК Вино (2026); Александр Герфорт (победитель Российского конкурса сомелье 2025), Кристина Монкус, Евгения Масленникова (Simple), Антон Корчак)](https://www.rbc.ru/wine/news/6852cbb19a79471a44ca7504) | Баранина — танинные красные; свинина — гарнача или кислотный рислинг с остаточным сахаром; пино/гаме — «идеальные варианты» | 3 |
| [Рамблер/Еда — «Какое вино подходит под пельмени» (Екатерина Акимова при участии Антона Обрезчикова (13.04.2018); сомелье Влада Лесниченко)](https://eda.rambler.ru/media/vopros/kakoe-vino-podhodit-pod-pelmeni) | Водка «затмевает» начинку; к жареным пельменям нельзя тонкое белое; к говяжьим — молодой каберне; к бараньим — кьянти/шираз; к свиным — белая бургонь | 3 |
| [Гастроном.ру — «С чем пьют шампанское: лучшие и худшие гастрономические пары к игристому» (Татьяна Меньщикова (26.12.2025))](https://www.gastronom.ru/text/s-chem-pyut-shampanskoe-luchshie-i-hudshie-gastronomicheskie-pary-k-igristomu-1016614) | Стоп-лист к любому игристому: шоколад, лук/чеснок, колбаса, домашние соленья, грибы, приторные восточные сладости | 2 |
| [АиФ — «Какой квас лучше выбрать для окрошки?» (Мария Тихменева; шеф-повар Вячеслав Казаков (ресторан Hands))](https://aif.ru/food/products/kakoy_kvas_luchshe_vybrat_dlya_okroshki) | К окрошке — кисловатый квас живого брожения; магазинный квас слишком сладок | 2 |
| [Открытая кухня (Яндекс Еда) — «Бешбармак, баурсак, кумыс, казы: как устроена национальная кухня Казахстана» (Руслан Закиров, бренд-шеф (Auyl, Алматы))](https://openkitchen.eda.yandex/article/dishes/dishes_stories/beshbarmak-baursak-kumys-kazy-kak-ustroena-natsionalnaya-kukhnya-kazakhstana) | Айран и кумыс «спасают» тяжёлое застолье; кумыс до/после сытной еды; бешбармак подают с сорпой и куртом; чай по-казахски с молоком и тары | 2 |
| [Открытая кухня (Яндекс Еда) — «Плов, димлама, манты, лагман: как устроена национальная кухня Узбекистана» (Редакция; бренд-шеф Сергей Отдельнов)](https://openkitchen.eda.yandex/article/dishes/dishes_stories/plov-dimlama-manty-lagman-kak-ustroena-nacionalnaya-kuhnya-uzbekistana) | Зелёный кук-чой справляется с жирными блюдами; к чаю — нават, халва, чак-чак | 2 |
| [Гастроном.ру, «С чем пьют пиво: гастрономический гид по закускам»](https://www.gastronom.ru/text/s-chem-pyut-pivo-gastronomicheskiy-gid-po-zakuskam-1001549) | Традиция: «У нас пиво традиционно закусывают воблой ... гренками с чесноком» | 2 |
| [Открытая кухня (Яндекс Еда) — «Советы сомелье, как сочетать вино и шашлыки» (Виктория Бродская, шеф-сомелье «Еда и Культура Project»)](https://openkitchen.eda.yandex/article/dishes/food/dym-i-vinograd-sovety-somele-kak-sochetat-vino-i-shashlyki) | Жирная баранина — саперави/риоха; универсально — насыщенное розе (Тавель); шампанское «дополнит всё»; лосось на гриле — лёгкие красные | 2 |
| [Блог Пивного Адвоката (pivoman.su) — «Сочетание пива и еды. Базовые основы. Продолжение» (Пивной Адвокат (курс «Пивной сомелье»), 01.03.2013)](https://pivoman.su/?p=4302) | Солодовые стили к шашлыку/барбекю; коричневый эль к острой мексиканской кухне; принципы | 2 |
| [Лайфхакер — интервью с пивным сомелье Юрием Сусовым (Юрий Сусов, пивной сомелье)](https://lifehacker.ru/rabochie-mesta-pivnoi-somele/) | Бельгийский бланш и мидии — «лучшая пара»; к пиву — нейтральное мясо и сыры, не дорблю, а пармезан | 1 |
| [Pivo.by — «Почему не стоит сочетать IPA с острой пищей?» (перевод CraftBeer.com) (Доктор Николь Гарно (перевод материала CraftBeer.com))](https://pivo.by/articles/reviews/ipa-and-spicy-food-pairing) | Панель Sam Adams: IPA 8,4 %/85 IBU усиливает жар; горечь и алкоголь усиливают остроту | 1 |
| [Simple Wine News — «Какое вино подобрать к рыбе и морепродуктам» (Валерия Труфакина (08.12.2021))](https://swn.ru/articles/vino-k-rybe) | Танины + рыба = металлический привкус; к лососю-типу рыбы — малотанинные красные | 1 |
| [Павел Сюткин (ЖЖ) — «Белый квас для окрошки» (Павел и Ольга Сюткины, историки кулинарии)](https://p-syutkin.livejournal.com/899759.html) | Белый кислый квас — для настоящей окрошки | 1 |
| [Tatler Asia KZ, «Бешбармак, сырне и кумыс: гастротур по Алматы» (2025)](https://tatlerasia.kz/ru/dining/food/8-mest-dlya-autentichnogo-gastrotura-v-almaty) | Кумысная карта и кумыс-сомелье в Yurta; курт с кофе и шоколадом | 1 |
| [Википедия — «Казахская чайная культура»](https://ru.wikipedia.org/wiki/%D0%9A%D0%B0%D0%B7%D0%B0%D1%85%D1%81%D0%BA%D0%B0%D1%8F_%D1%87%D0%B0%D0%B9%D0%BD%D0%B0%D1%8F_%D0%BA%D1%83%D0%BB%D1%8C%D1%82%D1%83%D1%80%D0%B0) | Чай крепкий чёрный с молоком; к чаю баурсаки, выпечка, мясо | 1 |
| [TourProm — «Гастрономическое путешествие в Казахстан: Бешбармак» (TourProm (туристический портал))](https://www.tourprom.ru/news/75784/) | Кумыс или шубат хорошо сочетаются с бешбармаком; к бешбармаку подают бульон в пиалах | 1 |
| [e-history.kz — «Этика поведения за столом» (Махаббат Большина (e-history.kz))](https://e-history.kz/ru/news/show/5754) | Трёхчастная трапеза: холодные закуски (казы, карта, жая) со спиртным/прохладительным → «ет» (бесбармак) → перерыв → чай с молоком | 1 |
| [TeaTerra — «Чайная церемония по-казахски» (перепечатка газетной статьи) (TeaTerra / газета «Заволжские степи»)](https://www.tea-terra.ru/2013/10/09/8621/) | Чай после бешбармака; к чаю курт, иримшик, баурсаки; поговорка «...в обед пьем чай с куырдаком, вечером пьем чай с бешбармаком» | 1 |
| [KZ Прод Импорт (чайный магазин) — «Дастархан» (KZ Прод Импорт (коммерческий сайт продавца чая))](https://kzprod.ru/node/dastarhan) | После бешбармака — чёрный казахский чай с молоком; бешбармак запивают бульоном | 1 |
| [e-history.kz — «Бауырсақ — неотъемлемый атрибут дастархана казахов»](https://e-history.kz/ru/news/show/6722) | Густой чай со сливками/каймаком; чайный дастархан — курт, иримшик, баурсаки | 1 |
| [Газета.Ru — «Забыть о вобле: как выбрать идеальную закуску под пиво» (Мария Каримова (06.01.2022); Кирилл Брусин, пивной сомелье «Бибирево»; Александр Смирнов, зитолог AB InBev Efes)](https://www.gazeta.ru/style/2022/01/06/14371639.shtml) | Вяленая рыба — не идеальное сопровождение пива; витбир к рульке/карпу; американский лагер к бургерам | 1 |
| [Simple Wine News — «Счастливы вместе: самый странный винный пейринг от профессионалов» (Татьяна Паласова (09.09.2024); Илья Кирилин, независимый винный эксперт)](https://swn.ru/articles/schastlivy-vmeste-samyy-strannyy-vinnyy-peyring-ot-professionalov) | Вяленый окунь + альбариньо; курдючный жир из плова + бобаль | 1 |
| [МК — «Сомелье рассказал, какое вино лучше всего подойдет для оливье» (Андрей Зотов, член Российской ассоциации сомелье (29.12.2025))](https://www.mk.ru/social/2025/12/29/somele-rasskazal-kakoe-vino-luchshe-vsego-podoydet-dlya-olive.html) | К оливье — игристое с высокой кислотностью, белый брют из шардоне, розовое игристое | 1 |
| [РБК Вино — «Вино и десерты: правила сочетания вкусов» (Дарья Сологуб, директор по импорту Fort (04.07.2024))](https://www.rbc.ru/wine/news/6681a3d79a79474fef45bc8a) | Вино слаще десерта; клубника+брют — неудачно; руби-портвейн к шоколадным десертам; исключение: выдержанная сухая риоха к тёмному шоколаду | 1 |

### Сенсорная наука (1)

| Источник | Что взяли | Пар/записей |
|---|---|---|
| [PubMed E-utilities: абстракты Trevisani 2002 (PMID 11992116), Nasrawi & Pangborn 1990 (2385629), Nolden 2019 (31121171), Peyrot des Gachons 2012 (23058798), Breslin & Beauchamp 1995/1997 (8788095, 9177340)](https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=11992116,2385629,31121171,23058798,9177340,8788095&rettype=abstract&retmode=text) | Абстракты: этанол снижает порог TRPV1 (Trevisani 2002); сахар = холодное молоко против жжения (Nasrawi 1990); молоко лучше всего (Nolden 2019); вяжущее × жир (Peyrot des Gachons 2012); Na⁺ подавляет горечь (Breslin 1995) | 13 |

### Внутренние материалы Flavor Tree (3)

| Источник | Что взяли | Пар/записей |
|---|---|---|
| Кураторские пары Efes/Flavor Tree v1 (внутренняя экспертная оценка, не литература) (`data/pairings_curated.json`) | 51 кураторская пара Efes v1 (оценки 3–5), маппинг бренд → архетип по data/drinks.json | 35 |
| Flavor Tree, внутренний обзор lit-sensory-science.md §6 (вывод команды из литературы, не первоисточник) (`docs/research/lit-sensory-science.md`) | Внутренние выводы §6 (пары-кандидаты команды) — только как подпорка спековых пар | 8 |
| Flavor Tree, внутренний обзор market-other-drinks-kz.md (кумыс/шубат: рынок и практика ресторанов) (`docs/research/market-other-drinks-kz.md`) | Кумыс/шубат: рынок KZ, кумысная карта Yurta | 1 |

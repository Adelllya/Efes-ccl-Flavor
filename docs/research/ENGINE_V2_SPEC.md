# Flavor Tree Pairing Engine v2 — спецификация движка подбора напитка к еде

> Статус: проект архитектуры для калибровки, 2026-09-18. Единый движок для всех категорий напитков:
> пиво, безалкогольное пиво, радлер, сидр, вино, игристое, коктейли, крепкое и ликёры, квас, лимонады/тоник,
> кумыс/айран/шубат, чай. Основан на трёх литературных отчётах (`lit-beer-pairing.md`, `lit-wine-cider-cocktail-pairing.md`,
> `lit-sensory-science.md`) и на первоисточниках, перепроверенных в этой сессии (BJCP 2021, пособие Brewers Association,
> методичка Court of Master Sommeliers Europe, психофизика: Trevisani 2002, Nasrawi & Pangborn 1990, Breslin & Beauchamp 1995/1997,
> Nolden–Lenart–Hayes 2019, Peyrot des Gachons 2012, Madrigal-Galan & Heymann 2006, Green & Frankmann 1987/88; отраслевые:
> WSET, Tim Gaiser MS, Tim Hanni MW, Northwest Cider Association, American Cider Association, GOST 31494-2012).
>
> **Честность про числа.** Ни один эксперт не даёт числовых шкал «на 10 IBU — минус столько-то». Измерены только: пороги
> TRPV1 (42→34 °C при этаноле), эффект сахарозы/молока/холода на жжение, подавление горечи натрием, опонентность
> жир↔вяжущесть, рост сладости/горечи с температурой, vital statistics BJCP (IBU/ABV/OG/FG/SRM), пороги остаточного сахара
> (EU, BJCP cider), нормы ГОСТ на квас. **Все коэффициенты правил ниже — наша калибровка**, и они проверяются набором эталонных
> пар (§7). Прототип формул лежит рядом: `docs/research/engine_v2_prototype.py` (v2.1, 2026-09-18) — без подгонки он проходит
> **66 из 68 эталонных пар и 12 из 12 порядковых ограничений** (65/68 без белого списка классических пар R20); две оставшиеся —
> пограничные (58 при пороге 60) и разобраны в §7.3. Первоисточники этой версии перепроверены по URL в текущей сессии (§1, §11).

---

## 0. Коротко: что меняется относительно v1

| Было (v1) | Станет (v2) | Зачем |
|---|---|---|
| 10 «пивных» осей (`bitter body malt_sweet carbonation hop_aroma roast alcohol caramel fruit clean`) | 14 категорийно-независимых осей напитка (`sweet acid bitter tannin carbonation alcohol body dairy salt umami aroma_intensity roast smoke serve_temp`) + ароматические теги | Без `acid`, `tannin`, `sweet`(остаточный сахар), `dairy`, `serve_temp` нельзя загрузить сидр, вино, квас, коктейли, кумыс — а именно эти оси несут самые сильные измеренные эффекты |
| Оси растут от «полноты пирамиды» (`prior + (1−prior)·notes`) — Efes Pilsener получает bitter .83 | Якорь на измеримом: IBU → bitter, ABV → alcohol, FG/остаточный сахар → sweet, vol CO₂ → carbonation, SRM+дескрипторы → roast; ноты пирамиды уточняют ±0.15 | Лагер с 20–30 IBU не должен «ловить» штраф за горечь к острому |
| 13 осей блюда, `spice` смешивает остроту и пряности | 16 осей: отдельно `heat` (капсаицин) и `pungent` (лук/горчица/хрен), + `protein`, `fish_oil`, `green_iron`; пряности — в тегах; enum-поля `cook_method`, `serve_temp`, `acid_type`, `cuisine`, `is_dessert` | Танин × белок, танин × рыбий жир, уксус vs лимон, регион и температура невыразимы в v1 |
| 15 правил с интуитивными весами; R11 curated ±16 — самый весомый вклад | 17 правил-формул с семейством (`cut / complement / contrast / bridge / balance / context / penalty`), уровнем доказательности (A–D) и ссылками; 6 жёстких вето; кураторские пары — только тесты и бейдж (override ≤ +6) | При 100 × 200 матрице 51 кураторская пара покрывает <0.3 % — движок должен стоять на правилах |
| Интенсивность — один композит (`0.30·body + 0.25·bitter + …`) | Две размерности: **вес** `W` (CMS «weight of wine and food should match») и **громкость вкуса** `F` (BA «match strength with strength»); напиток, который громче блюда, теряет бонусы cut/complement (множитель `fit`) | Иначе стаут, DIPA и imperial stout «выигрывают» любое жирное солёное блюдо (§7.3 первой итерации: dry stout — №1 к бешбармаку) |
| Один тип пары | Основной + вторичный механизм, бонус когда есть и cut/contrast, и complement/bridge (BA: «all combinations should involve both») | Так формулируют эксперты |
| Тексты — общая фраза на правило | Шаблоны в формате Cicerone ATE с подстановкой конкретных нот/тегов обеих сторон | «Соль казы гасит горечь пилснера, а карбонизация смывает жир» |
| Контекст: повод + `bitter_pref` + DNA (10 пивных осей) | Повод (meal / aperitif / dessert / hot / evening / party / gourmet / non_alcoholic), профиль чувствительности (Vinotype/PROP) как множитель жёсткости, `heat_lover`, DNA на 14 осях, температура подачи и порядок | Ханни: 25 % гиперчувствительных гостей избегают горечи/танина/алкоголя |

Архитектура не меняется: `вектор напитка × вектор блюда → именованные правила → Σ → балл → объяснение`, один код на Python и TypeScript, golden-паритет.

---

## 1. Уровни доказательности и что проверено в первоисточниках

| Уровень | Что это | Как используется |
|---|---|---|
| **A** — количественная психофизика | Рецензируемые эксперименты с рейтингами интенсивности (gLMS/LMS), n ≥ 20 | Направление и относительная сила правила фиксированы; калибруется только масштаб |
| **B** — эксперименты на продуктах | Панели «сыр → вино», модельное пиво, fMRI | Направление правила и порядок величины |
| **C** — экспертный консенсус | BA, Cicerone, CMS, WSET, Oliver, Mosher, Hanni, Gaiser, Death & Co, NW Cider | Правила баланса/интенсивности; масштаб калибруется по эталонным парам |
| **D** — гипотеза без сенсорной валидации | Foodpairing/Ahn 2011 (аромат-мосты) | Только объяснение и tie-breaker, вклад ≤ +8 |

Первоисточники, загруженные и процитированные в этой сессии (полный список с URL — §11):

| Источник | Что взято | Где используется |
|---|---|---|
| BJCP 2021: 1A, 2A, 3B, 3D, 4A, 5D, 6B, 10A, 15B, 20C, 21A, 22A, 22C, 24A | IBU/SRM/OG/FG/ABV и Mouthfeel по стилю (3B Czech Premium Pale Lager: IBU 30–45, FG 1.013–1.017, ABV 4.2–5.8 %, «Medium body. Moderate to low carbonation»; **4A Munich Helles** (проверено в этой сессии): IBU 16–22, SRM 3–5, OG 1.044–1.048, FG 1.006–1.012, ABV 4.7–5.4 %, «Medium body. Medium carbonation», «no residual sweetness»; **3D Czech Dark Lager** (проверено): IBU 18–34, SRM 17–35, OG 1.044–1.060, FG 1.013–1.017, ABV 4.4–5.8 %, «Medium to medium-full body», «Moderate to low carbonation», «very low to moderate roast character») | Якоря осей `bitter`, `sweet`, `body`, `carbonation`, `roast`; стилевые приоры §2.4 |
| BJCP, Introduction to Cider Guidelines | Сладость сидра: dry < 0.4 % RS (FG < 1.002), semi-dry 0.4–0.9 %, medium 0.9–2.0 %, semi-sweet 2–4 %, sweet > 4 % (FG > 1.019); still / pétillant / sparkling | Ось `sweet` и `carbonation` для сидра |
| Brewers Association, *Craft Beer and Food* (PDF на cicerone.org; в этой сессии извлечён текст через `pdftotext`, цитаты сверены дословно) | Таблица взаимодействий (Hop Bitterness/Roasted Malt/Carbonation/Alcohol **balances** Sweetness/Richness; Sweetness/Maltiness **balances** Spiciness/Acidity; Hop Bitterness **emphasizes** Spiciness); «Match strength with strength»; «All beer and food combinations should involve both of these principles»; аперитив — «light in body and aren't aggressively bitter»; десерты: «Rich, full-flavored beers are needed…», «cheesecake, crème brulée or carrot cake… with… double IPAs», «Chocolate loves a dark beer»; «Fruit beers have an obvious affinity for fruit desserts»; chart: Barley Wine — «Easily overpowers most main dishes. Best with strong cheese or dessert», Imperial Stout — «Easily overpowers most main dishes, but stands up to foie gras, smoked goose»; Dry Stout — «a classic with raw oysters»; Hefeweizen — «classic with weisswurst»; Witbier — «classic with steamed mussels»; IPA — «Strong, spicy food (classic with curry!)»; Double IPA — «Smoked beef brisket, grilled lamb»; Helles/Dortmunder — «works with spicy Asian, Cajun, Latin»; Irish stout ↔ «Chocolate soufflé, tiramisu»; шкала чарта 15 IBU … 70+; температуры 4.5–7 / 7–10 / 10–13 °C; с. 10: «Taste from less to more intense» | R1, R2, R3, R4, R9, R20, V1, `serve_temp`, R13, порядок подачи |
| Court of Master Sommeliers Europe, *Food and Wine Matching* (PDF; в этой сессии извлечён текст через `pdftotext`) | «Weight of wine and food should match: full with full, light with light»; «If wine is lighter bodied, must be powerful in flavour/high acid to stand up»; «Acidity of wine must match/exceed acidity of food (or will be “flabby”)»; «Residual sugar of wine must match/exceed residual sugar of food (or will be bitter)»; «Protein and fat will soften tannins. Certain fish + tannin = metallic»; «green vegetables… high iron… metallic aftertaste»; «Alcohol + spicy = fire. Spicy + sugar = no fire»; «Sauces, Condiments and side dishes — can be the dominant factors»; «Creating a complement is safer than designing a contrast»; «lighter to fuller body, drier to sweeter»; **«Salt — Great with sweet or fruity and softens tannins»** (противоречит Гайзеру «salt… exacerbates tannin» — R6 `tann` контестный); «Residual sugar… Is a great match for salty elements in foods»; «Alcohol… accentuated easily with too much spice heat or salt»; «Acidity cuts saltiness» | R1, R4, R5, R8, R3, R6, §3.3, §6 |
| Trevisani et al. 2002, *Nat Neurosci* (PubMed 11992116) | Этанол потенцирует ответ VR1/TRPV1 на капсаицин, порог тепловой активации ≈42 → ≈34 °C, зависимость от концентрации | R3 (`burn`), V3 |
| Nasrawi & Pangborn 1990, *Physiol Behav* (PubMed 2385629) | 10 % сахароза при 20 °C ≈ цельное молоко при 5 °C; 5 °C эффективнее 20 °C; 5 % этанол не лучше воды; эффект сахарозы не дозозависим; молоко 0 % и 10 % жира — одинаково | R3 (relief: сахар, dairy, холод; насыщение) |
| Nolden, Lenart & Hayes 2019, *Physiol Behav* (PubMed 31121171) | n = 72, gLMS; лучшие — цельное и обезжиренное молоко и Kool-Aid; сельтерская/кола/б/а пиво/вода — хуже; «protein may be more relevant than lipid» | R3: `dairy` весомее, карбонизация — не успокоитель |
| Breslin & Beauchamp 1995, *Chem Senses* (PubMed 8788095); 1997, *Nature* 387:563 | Na⁺ подавляет горечь урея/хинина/кофеина без взаимного подавления солёности; эффект периферический | R6 (`salt_soft`), R3 |
| Peyrot des Gachons … Breslin 2012, *Curr Biol* (PubMed 23058798) | Слабые вяжущие растворы при чередовании с жирной едой снижают ощущение жира, а жир — вяжущесть; накапливается по глоткам | R2 (танин — главный «cut») |
| Madrigal-Galan & Heymann 2006, *AJEV* | Сыр перед вином снижает вяжущесть, «bell pepper» и дубовость; эффект одинаков для всех вин | R8 (белок/жир смягчают танин) |
| NCBI NBK236241 (Green & Frankmann 1987/88; Green 1986) | Сладость сахарозы и горечь кофеина растут между 20 и 36 °C; кислое и солёное — нет; охлаждение языка до ≈25 °C убирает умеренное жжение капсаицина | `serve_temp`, §6.4, R3 (`cold`) |
| Eschevins et al. 2019, *IJGFS* (аннотация проверена через Semantic Scholar API) | «Fifteen pairing principles were identified» (перцептивные, концептуальные, аффективные); «generally the same pairing principles may be considered to match food with either wine or beer» | Обоснование единого движка |
| WSET (2023) «Four rules…»; WSET (2022) serving temperatures | Кьянти + соль/лимон → «softer, fruitier and much smoother», + сыр → «even smoother»; переохлаждение < 6 °C маскирует ароматы; полнотелые красные 15–18 °C, полнотелые белые 10–13 °C | R6, R8, `serve_temp` |
| Tim Gaiser MS | «Acidity: the single most flexible element»; «Tannin and oak: the least flexible»; «Higher alcohol… requires more intensity in the dish»; «Spicy heat: needs residual sugar–avoid tannin!»; «Salt: takes the edge off acidity but exacerbates tannin»; «Sugar: makes dry wines taste more austere»; соус/метод диктуют пару | R3, R5, R6, R8, §3.3 |
| Tim Hanni MW (IntoWine) | «Sweetness and umami dominating the food will make wine taste more bitter, astringent and acidic»; «Salt and acidity… more mild»; спаржа + Shiraz; типы дегустаторов ≈25 / 50 / 25 % | R4, R7, R6, R17 |
| Garneau, CraftBeer.com (панель Sam Adams × CIA) | 8.4 % / 85 IBU — ↑ жжение; 6.5 % / 45 IBU — ↓; 4.5 % / 45 IBU — жжение дольше; «Carbonation is shown to activate pain receptors»; автор: «wouldn't hold up to scientific peer-review» | R3 пороги (bitter > 0.6 ≈ 45 IBU; `burn` от 7 % ABV) |
| Garrett Oliver, Oxford Companion (Craft Beer & Brewing; перепроверено в этой сессии) | «Carbonation provides beer with cutting power against fats and other mouth-coating food elements»; «The goal, therefore, is balance»; «A delicate beer that follows a blockbuster is not likely to show its best»; «A brown ale works so nicely with a hamburger, pork roast, or grilled steak»; «the roasted malts match the chocolate, whereas the beer cleanses the palate of sweetness». **Внимание:** цитаты «flavor hook» и Rauchbier ↔ smoked meats в этой статье отсутствуют — они взяты из конспекта книги Оливера на All About Beer (см. `lit-beer-pairing.md`) | R2, R10, R11, R13, §6.5 |
| NW Cider Association; Alcohol Professor (Dorsey/Haykin/Shanks) | Cut / Contrast / Complement / Complete / intensity / regional; «sweetness of the squash enhances… bitter and acidic flavors in the cider»; «bubbles… cut richness and briny flavors»; «carbonated high-acid cider is going to go with just about anything»; «A slightly sweet cider can temper heat»; сидр 4–7 % ABV; ice cider ↔ шоколад; pommeau ↔ крем-брюле | Приоры сидра, R2, R3, R4, R15 |
| Wikipedia «Sweetness of wine» (EU Reg. 753/2002, 607/2009); «Acids in wine» | dry ≤ 4 г/л, medium dry ≤ 12, medium ≤ 45, sweet > 45; brut ≤ 12, extra dry 12–17, sec 17–32, demi-sec 32–50, doux 50+; pH вина 2.9–3.9 | Якоря `sweet`, `acid` |
| Brew Your Own «Appropriate Carbonation Levels» | Cask ale ≈ 1.8 vol; бутылочный эль 2.2–2.4; американский лагер 2.5–2.6 (европейский ≈ −0.1); пшеничные/бельгийские 3–4 vol; негазированное при 13 °C ≈ 1.3 vol | Якорь `carbonation` |
| ГОСТ 31494-2012 (квасы) | Спирт ≤ 1.2 % об.; сухие вещества ≥ 3.5 %; кислотность 1.5–7.0 ед.; CO₂ ≥ 0.30 % масс. (в таре) | Приоры кваса, `alcohol`, `sweet`, `acid`, `carbonation` |
| Shokrollahi et al. 2025, *Foods* 14(22):3954 (PMC12652487); ScienceDirect Topics «Kumis» | Кумыс — «mildly alcoholic beverage (~0.6–3 % v/v)», pH < 4.5 при ферментации; по сводке ScienceDirect: молочная кислота 0.7–1.8 %, этанол 0.6–2.5 %, жир 0.6–1.3 %, белок 1.7–1.9 %, CO₂ 0.5–0.9 % | Приоры кумыса (`acid`, `dairy`, `alcohol`, `carbonation`) |

Перепроверено в текущей сессии (2026-09-18) по URL: BJCP 3B/3D/4A; BA PDF и CMS PDF (полный текст); PubMed E-utilities — Trevisani 2002 («lowered the threshold for heat activation of VR1 from approximately 42 °C to approximately 34 °C»), Nasrawi & Pangborn 1990 («sucrose solutions (10 %) at 20 °C and whole milk at 5 °C were equally effective», «5 % ethanol was no more effective… than water», «Cold solutions (5 °C) were more effective»), Nolden 2019 («the largest reductions in burn were observed for whole milk, skim milk, and Kool-Aid… protein may be more relevant than lipid content»), Peyrot des Gachons 2012 («multiple sips of a mild astringent solution… decrease oral fat sensations… when astringent and fatty stimuli alternate»), Breslin & Beauchamp 1995 («the key component in this effect was the sodium or lithium ion… independent of its perceived saltiness»); Garneau/CraftBeer.com (три пива панели 4.5 %/45, 6.5 %/45, 8.4 %/85 IBU; «wouldn't hold up to scientific peer-review»); Gaiser; Hanni/IntoWine (≈25/50/25 %); Oliver (Oxford Companion); WSET 2023 (Chianti: «softer, fruitier and much smoother»); NW Cider («Sparkling bubbles… cut richness and briny flavors»); Alcohol Professor (Dorsey: «a carbonated high-acid cider is going to go with just about anything»; Haykin: «A slightly sweet cider can temper heat»); NCBI NBK236241 (сладость/горечь ↑ между 20 и 36 °C, кислое/солёное — нет; охлаждение языка до ≈25 °C убирает умеренное жжение); Eschevins 2019.

Не удалось загрузить (используется только через отчёты, помечено): Food52 «Master Cicerone» (403), Clark et al. 2011 (Springer — cookie-wall), Nature 1997 (Breslin & Beauchamp; через E-utilities вернулись только метаданные, содержание — по обзору 1995 и `lit-sensory-science.md`), MDPI-версия обзора о кумысе (403), стандарт TS 3810 на айран (в вебе значения не найдены), целевые значения кислоты/сахара/дилюции Дейва Арнольда (не найдены — в движок не закладываются), сахар кваса в г/л (нет — берётся с этикетки).

---

## 2. Оси напитка (14 числовых + теги + метаданные)

Все оси — `0..1`. Правило заполнения: **сначала измеримое** (этикетка, BJCP vital statistics, pH/Brix, рецепт коктейля), **затем стилевой приор** (§2.4), **затем экспертная поправка ±0.15** (пирамида нот, дегустация). У каждой записи хранится `vector_source` и `vector_confidence` (§8).

### 2.1 Таблица осей

| # | key | Что измеряет | Шкала и якоря | Правило заполнения | Правила, где работает | Источник шкалы |
|---|---|---|---|---|---|---|
| 1 | `sweet` | Остаточный сахар / воспринимаемая сладость | Кусочно-линейно по г/л: 0 → 0; 4 → 0.10; 12 → 0.25; 30 → 0.45; 45 → 0.55; 60 → 0.70; ≥100 → 1.0 | Вино/игристое: категория этикетки (brut ≤ 12 г/л → .15–.25; demi-sec 32–50 → .5–.6; сладкое > 45 → ≥ .55). Сидр: BJCP RS % ×10 = г/л (dry < 4 → .1; semi-dry → .2; medium → .35; semi-sweet → .55; sweet → ≥ .75). Пиво без данных RS: `0.6·clamp((FG − 1.006)/0.024)` + лактоза/фрукты + дескриптор BJCP («dry», «sweet»). Лимонад/квас/кола: углеводы с этикетки г/100 мл × 10. Коктейль: сахар рецепта (г/100 мл) → г/л | R3, R4, R5, R14, W_B | EU Reg. 753/2002, 607/2009; BJCP cider; BJCP FG (наша формула) |
| 2 | `acid` | Кислотность (pH / титруемая) | 0 = нет кислоты (крепкое neat, сливочный коктейль); .25 = лагер/хеллес; .35 = пшеничное/wit; .5 = квас, радлер, спритц; .65 = полусладкий сидр/вино; .75 = сухой сидр, сухое белое (pH вина 2.9–3.9); .85 = брют, кумыс (молочная кислота 0.7–1.8 %); 1 = сауэр, маргарита/сауэры, лимонад с лимонной кислотой | Если есть pH/TA — по ним (pH ≤ 3.0 → 1; 3.0–3.4 → .8; 3.4–3.8 → .6; 3.8–4.3 → .4; ≥ 4.5 → .2); иначе приор категории | R5, R2, R6, R7, R9, R1 (исключение CMS) | Wikipedia «Acids in wine»; ГОСТ 31494 (кислотность 1.5–7.0 ед.); ScienceDirect Kumis; экспертная шкала для остального |
| 3 | `bitter` | Горечь | Пиво: `clamp((IBU − 8)/62)` → Weissbier 8–15 IBU ≈ 0–.11; International Pale Lager 18–25 ≈ .16–.27; Czech Premium 30–45 ≈ .35–.6; American IPA 40–70 ≈ .5–1; Imperial Stout 50–90 ≈ .68–1. Не-пиво (экспертная шкала): тоник .5, спритц .45, негрони .85, фернет 1, чёрный чай .4, эспрессо .7, крепкое neat .15–.25 (этанол в малых концентрациях горчит — Nolden & Hayes 2016), лимонад .05 | IBU производителя → BJCP-середина стиля → дескриптор | R2, R3, R6, R7, R9, R14, F_B | BJCP vital statistics; шкала чарта BA (15 IBU … 70+) |
| 4 | `tannin` | Вяжущесть / полифенолы | 0 = лагер, водка, лимонад; .1 = APA/IPA (полифенолы хмеля); .2 = портер; .3 = сухой стаут («light astringency from the roasted grains» — BJCP 15B), heritage-сидр (мягкие танины из мякоти — Dorsey); .4 = лёгкое красное; .6 = крепкий чёрный чай; .8 = каберне/шираз; 1 = пуэр / очень танинный сидр | Стиль + выдержка; для вина — сорт/дуб | R2, R3, R5, R6, R7, R8, F_B, R1 (кредит лёгкому телу) | Экспертная шкала (CMS, Gaiser, Alcohol Professor); механизм — Peyrot des Gachons 2012 |
| 5 | `carbonation` | Газация | `clamp((vol CO₂ − 1.0)/2.8)`: негазированное 0; нитро (~1.2 vol) .07; cask ale 1.8 → .29; бутылочный эль 2.3 → .46; лагер 2.5–2.6 → .54–.57; пшеничные/бельгийские 3–4 → .71–1; игристое/содовая ≥ 3.8 → 1. Сидр по BJCP: still .05 / pétillant .45 / sparkling .85. Квас: ГОСТ CO₂ ≥ 0.30 % масс. → .3–.6 по продукту. Кумыс .3, шубат .15, айран .1 | vol CO₂ производителя → BJCP mouthfeel (low/moderate/high) → категория | R2, R3, R5, R6, R9, R16 | BYO «Appropriate Carbonation Levels»; BJCP mouthfeel; ГОСТ 31494 |
| 6 | `alcohol` | Крепость | `clamp(ABV/40)`: 0 % → 0; 4.5 % → .11; 5 % → .125; 7.3 % → .18; 8 % → .2; 12 % → .3; 20 % → .5; 40 % → 1. Коктейль — ABV **после дилюции** (по рецепту: Σ объём×ABV / итоговый объём; дилюция stirred ≈ 20–25 %, shaken ≈ 50–60 % — оценка, измерить рефрактометром/ареометром) | ABV с этикетки; коктейль — расчёт | R2, R6, R7, R9, R16, W_B (через `ABV/20`), F_B и R3 (через `burn`) | Этикетка; шкала — наша (v1 `(abv−3.5)/5` насыщалась при 8.5 %) |
| 7 | `body` | Тело / вязкость / экстракт | Пиво: `clamp((OG − 1.030)/0.070)`, затем снап по BJCP mouthfeel: very light .15 / light .3 / medium-light .4 / medium .5 / medium-full .65 / full .8 / very full .95. Вино: лёгкое белое .35, полное белое .5, лёгкое красное .5, полное красное .7, креплёное .85. Крепкое neat .5–.7. Коктейли: сауэр .4, спритц .35, stirred .7–.8, сливочный .9. Квас .35, лимонад .3, айран .5, кумыс .3, шубат .7, б/а пиво .3 | OG/дескриптор BJCP → категория | R1 (W_B), R3, R9, R16 | BJCP OG/mouthfeel; экспертная шкала |
| 8 | `dairy` | Молочный белок + жир основы | 0 = нет; .1 = milk stout (лактоза без белка); .15 = milkshake IPA; .4 = кумыс (белок 1.7–1.9 %, жир 0.6–1.3 %); .6 = айран; .7 = сливочные коктейли; .8 = сливочный ликёр; .9 = шубат | Состав | R3 (главный «успокоитель» жжения) | Nolden 2019 (молоко лучше всего, белок важнее жира); Nasrawi 1990 |
| 9 | `salt` | Соль напитка | 0 обычно; айран .4; шубат .2; мичелада/солёный ободок .3 | Рецепт | R1 (исключение CMS), R6-логика через дегустацию | Breslin 1995/1997 (Na⁺ ↓ горечь) |
| 10 | `umami` | Умами напитка | томатный сок/Bloody Mary .6; фино/саке .3; комбуча .2; кумыс/айран .1; иначе 0 | Рецепт | R7 (умами ≈ умами) | Tidwell (World Tea News), Herz — уровень C |
| 11 | `aroma_intensity` | Громкость ароматики | водка .05; light lager .2; pale lager .3; пилснер/хеллес .35–.4; пшеничное/dark lager .5; IPA .8; стаут .7; раухбир .9; джин .6; торфяной виски/амаро/мескаль 1 | Дескрипторы BJCP «low/moderate/high» + дегустация | F_B, R9, R16 | Экспертная шкала; заменяет v1 `hop_aroma`/`clean` |
| 12 | `roast` | Обжарка (кофе/шоколад/жжёный солод) | Пиво: `clamp((SRM − 15)/25)` с поправкой на дескрипторы: чешский тёмный .35 (обжарка низкая), портер .6, сухой стаут .85, imperial stout .95; кофейные коктейли .7; эспрессо 1 | SRM + описание | R2, R4 (шоколад), R9, R10 (только при char/дыме), R11 | BJCP SRM; BA «Roasted Malt balances Sweetness/Richness»; «Chocolate loves a dark beer» |
| 13 | `smoke` | Дым / торф | rauchbier .7–.9 («low to high» — BJCP 6B), smoked porter .5, торфяной виски .6–.9, мескаль .7, лапсанг .8; иначе 0 | Стиль | R9 (минус к деликатному), R11 | Oliver (Rauchbier ↔ копчёное), BA (smoked porter ↔ smoked cheese), Del Maguey |
| 14 | `serve_temp` | Температура подачи, °C | BA: лёгкие/пшеничные 4.5–7; средние 7–10; крепкие/тёмные 10–13. WSET: игристые и лёгкие белые ≈ 6–10 (ниже 6 °C — маскирует ароматы), полные белые 10–13, лёгкие красные ≈ 13, полные красные 15–18. Крепкое neat 18–20, коктейли на льду 0–5, айран/кумыс/квас/лимонад 4–8, чай 60–70 | По стилю; показывается гостю | R3 (`cold`), §6.4 (восприятие), порядок подачи | BA chart с. 8–9; WSET 2022 |

### 2.2 Производные величины

```
W_B  (вес / богатство напитка)   = 0.55·body + 0.25·clamp(ABV/20) + 0.20·sweet
F_B  (громкость вкуса напитка)   = 0.30·aroma_intensity + 0.25·bitter + 0.20·roast + 0.10·smoke + 0.10·tannin + 0.05·acid + 0.15·burn(ABV)
burn(ABV)        0 при ABV < 7; 7→12 %: 0→0.30; 12→22 %: 0.30→0.60; 22→40 %: 0.60→1.0; ≥40 %: 1.0
cold(T)          clamp((12 − serve_temp_°C)/8)      # 4 °C → 1, 12 °C → 0
alcohol          clamp(ABV/40)
```

Интенсивность в v2 — **две размерности, а не один композит**: вес `W` отвечает за правило CMS «weight of wine and food should match:
full with full, light with light», громкость `F` — за правило BA «match strength with strength… alcoholic strength, malt character,
hop bitterness, sweetness, richness, roastiness» (в v1 и в первой итерации v2 они были смешаны, и тёмные/хмелевые сорта «выигрывали»
любое сытное блюдо). Веса композитов — наша калибровка (§7.4). Ориентиры прототипа (W / F): light lager .18/.08 · international pale
lager .30/.16 · helles .38/.17 · Czech premium .38/.26 · Kozel dark (3.6 %) .43/.30 · weissbier .36/.20 · IPA-45 .40/.42 · DIPA-85 .46/.56 ·
dry stout .41/.54 · imperial stout .74/.74 · barleywine .75/.53 · rauchbier .40/.49 · brut .37/.27 · каберне .56/.47 · негрони .72/.59 ·
маргарита .51/.36 · виски neat .64/.49 · торфяной виски .63/.65 · айран .29/.15 · кумыс .20/.20 · квас .29/.22 · чёрный чай .19/.39.

`burn` — отдельная от `alcohol` нелинейная функция для правила остроты: панель Sam Adams (6.5 % — нейтрально/снижение,
8.4 % — усиление), Nasrawi (5 % этанол — как вода), Trevisani (зависимость от концентрации), при этом CMS/Gaiser/Haykin
единодушно рекомендуют полусухие вина и сидры 8–12 % к острому — поэтому подъём начинается с 7 % и до 12 % остаётся мягким.
Пороги — **наша интерпретация**, калибруются.

### 2.3 Словарь ароматических тегов (общий для напитка и блюда; вес 0..1)

`citrus · tropical_fruit · stone_fruit · orchard_fruit (яблоко/груша) · red_fruit · dark_fruit (изюм/чернослив) · banana · clove ·
pepper · herbal · floral · pine_resin · grass · bread/grain · biscuit · toast · caramel/toffee · honey · nutty · chocolate/cocoa · coffee ·
roast · smoke · oak_vanilla · dairy_cream · sour_lactic · mint · cucumber · brine/mineral · warm_spice (корица/зира/кориандр) ·
anise · juniper · agave · bitter_orange · char · cured · yeast`

Правила заполнения: пиво — из пирамиды нот v1 (`data/flavor_notes.json` уже несёт теги; маппинг ниже) и BJCP-описания;
вино/сидр/крепкое — из дегустационных заметок производителя/импортёра; коктейль — из ингредиентов (лайм → `citrus` 1,
кампари → `bitter_orange` .9, вермут → `herbal` .7). Мост (R12) ограничен +8 — по Ahn 2011 / Spence 2020 у аромат-мостов нет
сенсорной валидации, а казахская кухня в датасетах отсутствует; главная роль тегов — **текст объяснения**.

### 2.4 Стилевые приоры v2 (стартовые значения, калибровать дегустацией)

Значения — экспертные стартовые точки, якоря в последней колонке взяты из BJCP/этикеток/ГОСТ; помеченные «оценка» требуют проверки дегустацией (BJCP-якоря 1A–24A, включая 4A и 3D, проверены по URL). Таблица сгенерирована из `engine_v2_prototype.py`.

| archetype | cat | ABV | IBU | sweet | acid | bitter | tannin | carb | body | dairy | salt | umami | aroma | roast | smoke | T °C | Якорь / примеры KZ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `light_lager` | beer | 3.5 | 10 | 0.15 | 0.25 | 0.05 | 0 | 0.8 | 0.2 | 0 | 0 | 0 | 0.2 | 0 | 0 | 4 | BJCP 1A: IBU 8–12, ABV 2.8–4.2, FG 0.998–1.008 |
| `pale_lager_intl` | beer | 5.0 | 22 | 0.2 | 0.25 | 0.22 | 0.02 | 0.6 | 0.35 | 0 | 0 | 0 | 0.3 | 0 | 0 | 5 | BJCP 2A: IBU 18–25, ABV 4.5–6, FG 1.008–1.012 (Efes Pilsener, Карагандинское, Carlsberg, Tuborg, Heineken) |
| `czech_pale_premium` | beer | 4.4 | 40 | 0.25 | 0.25 | 0.5 | 0.05 | 0.5 | 0.5 | 0 | 0 | 0 | 0.4 | 0 | 0 | 6 | BJCP 3B: IBU 30–45, ABV 4.2–5.8 (Pilsner Urquell IBU ≈ 40, Kozel Světlý, Gambrinus) |
| `german_pils` | beer | 4.8 | 33 | 0.15 | 0.25 | 0.4 | 0.05 | 0.6 | 0.4 | 0 | 0 | 0 | 0.4 | 0 | 0 | 5 | BJCP 5D: IBU 22–40, ABV 4.4–5.2 (Holsten, Bitburger, Warsteiner) |
| `helles` | beer | 5.0 | 19 | 0.2 | 0.2 | 0.2 | 0.02 | 0.55 | 0.5 | 0 | 0 | 0 | 0.35 | 0 | 0 | 6 | BJCP 4A (проверено): IBU 16–22, ABV 4.7–5.4, FG 1.006–1.012, «Medium body. Medium carbonation», «no residual sweetness» — Paulaner Hell, Spaten, Белый Медведь Мягкое |
| `amber_lager` | beer | 5.2 | 25 | 0.3 | 0.25 | 0.3 | 0.05 | 0.5 | 0.5 | 0 | 0 | 0 | 0.45 | 0.15 | 0 | 8 | Vienna/Märzen (Легенда 777, 5 Океан Богемское) |
| `czech_dark` | beer | 3.6 | 26 | 0.35 | 0.25 | 0.29 | 0.1 | 0.45 | 0.58 | 0 | 0 | 0 | 0.5 | 0.3 | 0 | 9 | BJCP 3D (проверено): IBU 18–34, SRM 17–35, ABV 4.4–5.8, «medium to medium-full body», «moderate to low carbonation», «very low to moderate roast»; KZ SKU легче стиля по ABV: Kozel Černý 3.6, Zatecky Gus Cerny 3.5 (ось `alcohol` — с этикетки) |
| `strong_lager` | beer | 7.3 | 25 | 0.3 | 0.2 | 0.35 | 0.05 | 0.5 | 0.6 | 0 | 0 | 0 | 0.45 | 0.05 | 0 | 8 | Хмельной Лось 7.3, Amsterdam Navigator 8, Zatecky Gus Strong 8 |
| `rice_lager` | beer | 4.0 | 15 | 0.1 | 0.25 | 0.15 | 0 | 0.65 | 0.25 | 0 | 0 | 0 | 0.2 | 0 | 0 | 4 | Wùkōng Jū 4.0, Yichang |
| `weissbier` | beer | 5.2 | 12 | 0.25 | 0.35 | 0.08 | 0.02 | 0.9 | 0.45 | 0 | 0 | 0 | 0.55 | 0 | 0 | 6 | BJCP 10A: IBU 8–15, ABV 4.3–5.6 (Paulaner Hefe-Weissbier) |
| `witbier` | beer | 5.0 | 14 | 0.2 | 0.4 | 0.12 | 0.02 | 0.85 | 0.4 | 0 | 0 | 0 | 0.55 | 0 | 0 | 5 | BJCP 24A: IBU 8–20, ABV 4.5–5.5 (1664 Blanc, 5 Океан Бельгийское, Pinta White) |
| `american_pale_ale` | beer | 5.5 | 40 | 0.2 | 0.3 | 0.55 | 0.1 | 0.6 | 0.45 | 0 | 0 | 0 | 0.7 | 0 | 0 | 8 | крафт KZ (Sigma/Auster) |
| `american_ipa_45` | beer | 6.5 | 45 | 0.2 | 0.3 | 0.6 | 0.12 | 0.6 | 0.5 | 0 | 0 | 0 | 0.8 | 0 | 0 | 8 | BJCP 21A: IBU 40–70, ABV 5.5–7.5; точка панели Sam Adams 6.5 % / 45 IBU |
| `double_ipa_85` | beer | 8.4 | 85 | 0.25 | 0.3 | 1.0 | 0.15 | 0.6 | 0.55 | 0 | 0 | 0 | 0.9 | 0 | 0 | 10 | BJCP 22A: IBU 60–100, ABV 7.5–10; точка панели 8.4 % / 85 IBU |
| `brown_ale` | beer | 5.5 | 25 | 0.35 | 0.25 | 0.35 | 0.15 | 0.45 | 0.55 | 0 | 0 | 0 | 0.55 | 0.3 | 0 | 10 | English brown (Oliver: ↔ burger/steak) |
| `porter` | beer | 5.5 | 30 | 0.3 | 0.25 | 0.45 | 0.2 | 0.45 | 0.6 | 0 | 0 | 0 | 0.6 | 0.6 | 0.05 | 11 | BA chart №13 |
| `dry_stout` | beer | 4.3 | 38 | 0.15 | 0.3 | 0.55 | 0.3 | 0.3 | 0.6 | 0 | 0 | 0 | 0.6 | 0.85 | 0.05 | 11 | BJCP 15B: IBU 25–45, ABV 3.8–5; «light astringency from roasted grains» |
| `milk_stout` | beer | 5.2 | 28 | 0.55 | 0.2 | 0.35 | 0.2 | 0.35 | 0.7 | 0.1 | 0 | 0 | 0.6 | 0.7 | 0 | 11 | BA chart №15 (sweet stout) |
| `imperial_stout` | beer | 10.0 | 70 | 0.45 | 0.25 | 0.85 | 0.35 | 0.3 | 0.95 | 0 | 0 | 0 | 0.85 | 0.95 | 0.05 | 12 | BJCP 20C: IBU 50–90, ABV 8–12; BA chart №16 «overpowers most main dishes» |
| `barleywine` | beer | 10.5 | 75 | 0.5 | 0.2 | 0.8 | 0.25 | 0.3 | 0.95 | 0 | 0 | 0 | 0.8 | 0.1 | 0 | 12 | BJCP 22C: IBU 50–100, ABV 8–12; BA chart №12 |
| `rauchbier` | beer | 5.4 | 25 | 0.3 | 0.25 | 0.3 | 0.1 | 0.6 | 0.5 | 0 | 0 | 0 | 0.9 | 0.2 | 0.8 | 9 | BJCP 6B: IBU 20–30, ABV 4.8–6; дым «low to high» |
| `kriek_sour` | beer | 5.5 | 10 | 0.35 | 0.8 | 0.1 | 0.1 | 0.8 | 0.4 | 0 | 0 | 0 | 0.7 | 0 | 0 | 6 | фруктовый ламбик (Oliver: утка ↔ kriek) |
| `na_lager` | na_beer | 0.0 | 18 | 0.3 | 0.3 | 0.2 | 0.02 | 0.6 | 0.3 | 0 | 0 | 0 | 0.3 | 0 | 0 | 4 | Efes 0.0, Bavaria 0.0, Carlsberg 0.0, Кружка Свежего 0.0 |
| `radler` | radler | 2.5 | — | 0.6 | 0.5 | 0.1 | 0 | 0.8 | 0.3 | 0 | 0 | 0 | 0.5 | 0 | 0 | 4 | Кружка Свежего радлер, S&R's Garage, Somersby-подобные |
| `cider_dry` | cider | 5.7 | — | 0.1 | 0.75 | 0.1 | 0.3 | 0.7 | 0.35 | 0 | 0 | 0 | 0.5 | 0 | 0 | 7 | ISSYK Wild Kazakh Cider 5.7 %, Turgen; BJCP dry RS < 0.4 % |
| `cider_semi_dry` | cider | 5.0 | — | 0.35 | 0.6 | 0.05 | 0.2 | 0.8 | 0.35 | 0 | 0 | 0 | 0.55 | 0 | 0 | 6 | Chester's Semi Dry; BJCP semi-dry 0.4–0.9 % RS |
| `cider_sweet_commercial` | cider | 4.0 | — | 0.6 | 0.5 | 0.05 | 0.1 | 0.8 | 0.35 | 0 | 0 | 0 | 0.6 | 0 | 0 | 5 | Somersby 4 % («пивной напиток» в KZ), Chester's Sweet, Kopparberg |
| `white_dry` | wine | 12.0 | — | 0.1 | 0.8 | 0.05 | 0.05 | 0 | 0.35 | 0 | 0 | 0 | 0.6 | 0 | 0 | 8 | рислинг/совиньон сухое (Arba, Bacchus, импорт); EU dry ≤ 4 г/л |
| `riesling_off_dry` | wine | 9.5 | — | 0.4 | 0.8 | 0.05 | 0.05 | 0 | 0.4 | 0 | 0 | 0 | 0.6 | 0 | 0 | 8 | Kabinett/полусухое, 12–45 г/л |
| `brut_sparkling` | sparkling | 12.0 | — | 0.15 | 0.85 | 0.1 | 0.05 | 1 | 0.35 | 0 | 0 | 0 | 0.5 | 0 | 0 | 7 | брют ≤ 12 г/л (Prosecco, Cava, Champagne) |
| `demi_sec_sparkling` | sparkling | 12.0 | — | 0.55 | 0.8 | 0.05 | 0.05 | 1 | 0.4 | 0 | 0 | 0 | 0.5 | 0 | 0 | 7 | demi-sec 32–50 г/л |
| `red_light` | wine | 12.5 | — | 0.05 | 0.65 | 0.15 | 0.4 | 0 | 0.5 | 0 | 0 | 0 | 0.6 | 0 | 0 | 14 | пино нуар / гаме |
| `cabernet` | wine | 13.5 | — | 0.05 | 0.5 | 0.3 | 0.8 | 0 | 0.7 | 0 | 0 | 0 | 0.7 | 0.1 | 0.05 | 17 | каберне/саперави полное танинное |
| `shiraz` | wine | 14.0 | — | 0.05 | 0.5 | 0.3 | 0.8 | 0 | 0.75 | 0 | 0 | 0 | 0.75 | 0.1 | 0.1 | 17 | шираз (демонстрация Ханни со спаржей) |
| `red_semi_sweet` | wine | 12.0 | — | 0.55 | 0.55 | 0.1 | 0.4 | 0 | 0.55 | 0 | 0 | 0 | 0.6 | 0 | 0 | 14 | Киндзмараули-тип, > 45 г/л (оценка) |
| `port` | fortified | 20.0 | — | 0.85 | 0.4 | 0.15 | 0.5 | 0 | 0.9 | 0 | 0 | 0 | 0.8 | 0 | 0 | 16 | портвейн / pommeau / ice cider (Alcohol Professor) |
| `aperol_spritz` | cocktail | 9.0 | — | 0.5 | 0.5 | 0.45 | 0.05 | 0.7 | 0.35 | 0 | 0 | 0 | 0.7 | 0 | 0 | 3 | Glass & Note: 10–12 % ABV, низкий танин; Ösim — топ-3 баров KZ |
| `negroni` | cocktail | 24.0 | — | 0.45 | 0.1 | 0.85 | 0.1 | 0 | 0.7 | 0 | 0 | 0 | 0.9 | 0 | 0 | 4 | ABV после дилюции ≈ 24 % (оценка) |
| `margarita` | cocktail | 17.0 | — | 0.4 | 0.9 | 0.15 | 0 | 0 | 0.4 | 0 | 0 | 0 | 0.7 | 0 | 0 | 2 | сауэр, ABV после шейка ≈ 15–20 % (оценка) |
| `old_fashioned` | cocktail | 30.0 | — | 0.35 | 0.05 | 0.4 | 0.15 | 0 | 0.8 | 0 | 0 | 0 | 0.8 | 0.1 | 0.05 | 5 | stirred ≈ 30 % (оценка) |
| `manhattan` | cocktail | 28.0 | — | 0.4 | 0.05 | 0.45 | 0.15 | 0 | 0.8 | 0 | 0 | 0 | 0.85 | 0.1 | 0 | 5 | stirred ≈ 28 % (оценка) |
| `gin_tonic` | cocktail | 8.0 | — | 0.35 | 0.5 | 0.5 | 0 | 0.9 | 0.3 | 0 | 0 | 0 | 0.6 | 0 | 0 | 3 | хинин → bitter .5 |
| `white_russian` | cocktail | 18.0 | — | 0.6 | 0.05 | 0.15 | 0 | 0 | 0.9 | 0.7 | 0 | 0 | 0.6 | 0.4 | 0 | 3 | сливочный коктейль |
| `whisky_neat` | spirit | 40.0 | — | 0.15 | 0 | 0.2 | 0.2 | 0 | 0.65 | 0 | 0 | 0 | 0.8 | 0.1 | 0.1 | 18 | 40 % neat (Whisky School: «alcohol acts as a solvent») |
| `cask_strength_whisky` | spirit | 58.0 | — | 0.15 | 0 | 0.25 | 0.25 | 0 | 0.7 | 0 | 0 | 0 | 0.9 | 0.1 | 0.1 | 18 | ≈ 58 % («palate destruction» с деликатным) |
| `peated_whisky` | spirit | 46.0 | — | 0.1 | 0 | 0.25 | 0.2 | 0 | 0.65 | 0 | 0 | 0 | 1 | 0.2 | 0.8 | 18 | торф ↔ солёные сыры/копчёности (Whisky School) |
| `vodka_neat` | spirit | 40.0 | — | 0 | 0 | 0.15 | 0 | 0 | 0.5 | 0 | 0 | 0 | 0.05 | 0 | 0 | 0 | 40 %, ароматика ≈ 0 |
| `mezcal` | spirit | 42.0 | — | 0.15 | 0 | 0.2 | 0.1 | 0 | 0.6 | 0 | 0 | 0 | 0.9 | 0.1 | 0.7 | 18 | Del Maguey: дым ↔ карне асада |
| `kvass_classic` | kvass | 0.8 | — | 0.45 | 0.5 | 0.1 | 0.02 | 0.6 | 0.35 | 0 | 0 | 0 | 0.5 | 0.1 | 0 | 5 | ГОСТ 31494: спирт ≤ 1.2 %, СВ ≥ 3.5 %, кислотность 1.5–7 |
| `kvass_sour` | kvass | 1.0 | — | 0.25 | 0.65 | 0.1 | 0.02 | 0.6 | 0.3 | 0 | 0 | 0 | 0.5 | 0.1 | 0 | 5 | «окрошечный» квас (tea.ru/Очаково) |
| `lemonade_sweet` | lemonade | 0.0 | — | 1 | 0.6 | 0.05 | 0 | 0.9 | 0.3 | 0 | 0 | 0 | 0.5 | 0 | 0 | 4 | ≈ 100 г/л по этикетке |
| `soda_water` | water | 0.0 | — | 0 | 0.2 | 0 | 0 | 1 | 0.05 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | Nolden 2019: сельтерская ≈ вода против жжения |
| `ayran` | dairy | 0.0 | — | 0.05 | 0.55 | 0 | 0 | 0.1 | 0.5 | 0.6 | 0.4 | 0.1 | 0.4 | 0 | 0 | 5 | айран (TS 3810 не найден — измерить) |
| `kumys` | dairy | 1.5 | — | 0.1 | 0.8 | 0.05 | 0 | 0.3 | 0.3 | 0.4 | 0.05 | 0.1 | 0.5 | 0 | 0 | 6 | кумыс: молочная к-та 0.7–1.8 %, EtOH 0.6–2.5 %, белок 1.7–1.9 % |
| `shubat` | dairy | 1.0 | — | 0.1 | 0.7 | 0 | 0 | 0.15 | 0.7 | 0.9 | 0.2 | 0.1 | 0.5 | 0 | 0 | 6 | шубат: густой, жирный, солоноватый (market-other-drinks-kz) |
| `black_tea_strong` | tea | 0.0 | — | 0 | 0.15 | 0.4 | 0.6 | 0 | 0.35 | 0 | 0 | 0 | 0.6 | 0.2 | 0 | 70 | Tidwell: танин чая ↔ жир стейка |
| `green_tea` | tea | 0.0 | — | 0 | 0.2 | 0.35 | 0.4 | 0 | 0.25 | 0 | 0 | 0.2 | 0.5 | 0 | 0 | 70 | к плову/рису |

### 2.5 Миграция пивной пирамиды v1 → вектор v2

Пирамида нот (`data/flavor_notes.json`, `brands.json`) остаётся источником **ароматики и уточнений**, но перестаёт быть источником структуры.

| Ось v2 | Из чего считается | Уточнение нотами (max ±0.15) |
|---|---|---|
| `bitter` | IBU производителя → иначе середина BJCP-диапазона стиля (`style_bjcp`): Light Lager 10 → .03; International Pale Lager 21.5 → .22; German Pils 31 → .37; Czech Premium 37.5 → .48; American IPA 55 → .76 | `mild-bitterness` (интенсивность i) → −0.15·(1 − i/10); `hop-bitterness`/`resin` → +0.15·i/10 |
| `sweet` | `0.6·clamp((FG_mid − 1.006)/0.024)` по стилю (International Pale Lager FG 1.008–1.012 → .1; Czech Premium 1.013–1.017 → .22; Imperial Stout 1.018–1.030 → .45) + лактоза/фрукты | `malty`, `caramel`, `honey`, `toffee` → +0.05·i/10 каждая (сумма ≤ +0.15); «сухой финиш» → −0.1 |
| `body` | OG-середина стиля через `clamp((OG − 1.030)/0.070)`, снап по BJCP mouthfeel | «плотное тело»/«кремовость» → +0.1; «водянистое» → −0.1 |
| `acid` | Приор категории (.25 лагер, .35 пшеничное, .8 сауэр) | `sour`, `citrus`, `lemon` → +0.1·i/10 |
| `carbonation` | Приор стиля из vol CO₂ (§2.1) | «искрящаяся карбонация» → +0.1·i/10; нитро/cask → −0.2 |
| `alcohol` | ABV (если `abv_estimated` — confidence −0.2) | — |
| `aroma_intensity` | `0.2 + 0.6·max(i/10)` по нотам TOP-слоя (hop-aroma, floral, fruit, spice); v1 `clean` ≡ `1 − aroma_intensity` | — |
| `roast` | SRM-середина стиля + дескрипторы | `roast`, `coffee`, `chocolate`, `cocoa` → max(i/10·0.9) |
| `smoke` | 0, если нет ноты `smoke` | `smoke` → i/10·0.9 |
| `tannin` | .05 лагер · .1 APA/IPA · .2 портер · .3 стаут | `astringent`/`резкая горечь» → +0.1 |
| `dairy`, `salt`, `umami` | 0 для пива (milk stout dairy .1; gose salt .3) | — |
| `serve_temp` | BA по стилю (§2.1); v1 `serving.temp_min/max` — если заполнено, берётся оно | — |

Маппинг тегов v1 → словарь v2: `herbs`→`herbal`; `pine`,`resin`→`pine_resin`; `citrus`,`lemon`,`lime`→`citrus`; `apple`,`pear`→`orchard_fruit`;
`banana`→`banana`; `clove`→`clove`; `caramel`,`toffee`→`caramel`; `honey`→`honey`; `bread`,`grain`,`biscuit`,`toast`,`wheat`,`corn`→`bread`
(`biscuit`,`toast` сохраняются как отдельные веса); `rice`→`rice`; `coffee`→`coffee`; `chocolate`,`cocoa`→`chocolate`; `smoke`→`smoke`;
`floral`→`floral`; `grass`→`grass`; `tropical`,`mango`→`tropical_fruit`; `berry`→`red_fruit`; `raisin`→`dark_fruit`; `vanilla`→`oak_vanilla`;
`nuts`→`nutty`; `mineral`→`brine`; `mint`→`mint`; `pepper`→`pepper`; `spice`→`warm_spice`; `cream`,`butter`→`dairy_cream`.
Теги `fresh`, `fizz`, `warmth`, `sweet`, `sour`, `fruit` — это оси, а не мосты: они больше не участвуют в R12.

`vector_override` сомелье сохраняется и имеет приоритет; `confidence` = `min(1, n_notes/5)·(layers/3)` × (0.8, если ABV оценочный) × (0.85, если IBU неизвестен).

---

## 3. Оси блюда (16 числовых + enum-поля + теги)

### 3.1 Таблица осей

| # | key | Что измеряет | Шкала (0..1) | Правило заполнения | Правила |
|---|---|---|---|---|---|
| 1 | `salt` | Соль | 0 несолёное · .4 обычная посолка · .6 солёный соус/маринад · .8 курт, брецель, казы, вяленое · 1 солонина/анчоус | Классификация + `cook_method=cured` (+.3) | R6, R7 (условие), R1 (F_D) |
| 2 | `sweet` | Сахар | 0 · .25 плов/BBQ-нотка · .6 глазурь BBQ · .85 десерт · 1 чак-чак, пахлава (мёд) | Категория; десерт ≥ .6 | R4, R14, F_D |
| 3 | `sour` | Кислота | 0 · .3 томат/суши-уксус · .5 картофельный салат, гуакамоле · .7 курт, квашеная капуста, севиче · 1 маринад в уксусе | `acid_type` уточняет агрессивность (уксус +0.2 к эффективной кислоте) | R5, R7 (условие), R1 |
| 4 | `bitter` | Горечь блюда | 0 · .3 руккола/гриль-спаржа · .7 тёмный шоколад 70 % · 1 радиккио/кофе | Ингредиенты | R14, F_D (десерты) |
| 5 | `umami` | Глутамат/нуклеотиды | 0 салат · .5 курица · .7 бульон/сыр/грибы · .85 варёная баранина, стейк, рамен | `protein_source`, бульон, соевый соус, выдержанный сыр | R7, F_D |
| 6 | `fat` | Липиды | .15 овощи/эдамаме · .5 плов, тако · .8 бешбармак, шницель, карбонара · .9 казы, куырдак | `fat_level` + метод (фритюр +.1) | R2, R8, W_D |
| 7 | `protein` | Белок (связывает танин) | 0 салат · .2 картофель/выпечка · .5 птица/бобовые/моцарелла · .8 свинина/птица целиком · .9–.95 говядина, баранина, конина, твёрдый сыр | `protein_source` | R8, V1 (исключение) |
| 8 | `heat` | Капсаицин (острота) | 0 · .3 лёгкая острота · .6 лагман острый, тако · .75 чили кон карне · .85 крылышки Buffalo · 1 «огонь» | Явное поле `heat_level`; ≈ log(Scoville) | R3, V3, R2 (дисконт горечи), R6, F_D |
| 9 | `pungent` | Лук/чеснок/горчица/хрен/редис (TRPA1) | 0 · .3 лук в бешбармаке · .5 чеснок казы, горчица · .8 хрен/васаби | Теги `onion garlic mustard horseradish wasabi radish` | Текст объяснения и F_D (малый вес; отдельный рецептор — Carstens 2002) |
| 10 | `weight` | Вес/сытность | .2 закуска · .5 среднее · .8 бешбармак, плов, лагман · .9 бургер, лазанья | `weight` + `cook_method` (гриль/жарка +.1 — Tidwell) | R1 (W_D), R2, R6 (snack) |
| 11 | `cream` | Сливочность/сырность | 0 · .4 сливочный соус · .7 ризотто · .9 мак-энд-чиз, чизкейк, буррата | Соус/ингредиенты | R2 (ослабляет карбонизацию — Glass & Note), W_D |
| 12 | `maillard` | Корочка/карамелизация | 0 варёное · .35 плов · .6 фритюр, выпечка · .75 шницель · .85 стейк | `cook_method`: fried .6, baked .5, grilled/roasted .7–.85 | R10, `weight` |
| 13 | `smoke` | Дым | 0 · .3 казы (лёгкое копчение) · .5 стейк на углях · .85 шашлык · .9 BBQ, жая | `cook_method=grilled` .7, `smoked` .9 | R11, R10 (roast ↔ char), F_D |
| 14 | `fresh` | Сырое/деликатное/зелёное | 0 · .4 паровое · .6 эдамаме, спаржа · .8 суши, буррата, гуакамоле · .9 устрицы, тартар | `cook_method=raw` .8, `steamed` .4 | R9, V5 |
| 15 | `fish_oil` | Омега-3 жирная рыба | 0 · .3 устрицы/мидии · .4–.5 белая рыба, суши-микс · .9 лосось, скумбрия, сельдь | `protein_source=oily_fish` .9, `white_fish` .4, `shellfish` .3 | R8 (танин → «металл»), V4, R9 (хмель) |
| 16 | `green_iron` | Спаржа/артишок/шпинат | 0 · .5 шпинат-гарнир · .8 спаржа/артишок как главный ингредиент | Теги | R8 (CMS: «metallic aftertaste») |

```
W_D (вес блюда)       = 0.40·weight + 0.30·fat + 0.10·cream + 0.10·protein;              десерт: max(W_D, 0.4·sweet + 0.4·fat + 0.2·cream)
F_D (громкость блюда) = 0.15·heat + 0.15·smoke + 0.20·salt + 0.20·umami + 0.10·maillard + 0.15·sour + 0.05·sweet + 0.05·pungent + 0.05·bitter;
                        десерт: max(F_D, 0.45·sweet + 0.30·bitter + 0.25·max(tags.chocolate, cocoa, coffee))
```
Острота входит в громкость с малым весом (0.15): у неё своё правило R3, а BA ставит к острому и IPA (chart 4), и helles/Märzen/amber
lager (chart 23–25) — острое блюдо не обязано требовать «громкого» напитка. Соль и умами взвешены по 0.20: вяленое, выдержанный сыр и
курт — «громкие» блюда при небольшом весе (BA: «one as powerful as Stilton requires an assertive barley wine»). Для десертов сахар и какао
— это громкость (BA: «Rich, full-flavored beers are needed to balance the sweetness of most desserts»; Mosher: «Bud Light and chocolate
cake… disaster»). Ориентиры прототипа (W / F): бешбармак .69/.29 · казы .68/.42 · шашлык .58/.49 · плов .58/.28 · курт .24/.35 ·
лагман острый .54/.44 · суши .23/.25 · стейк .60/.44 · крылышки Buffalo .54/.45 · капрезе .29/.14 · устрицы .19/.30 · чак-чак .56/.41 ·
шоколадный фондан .64/.72 · чизкейк .80/.38 · выдержанный сыр .60/.33.

### 3.2 Enum-поля и теги

| Поле | Значения | Зачем |
|---|---|---|
| `cook_method` | `raw · cured · fermented · steamed · boiled · braised · baked · fried · grilled · smoked` | Автозаполнение `maillard`, `smoke`, `fresh`, `fat`, `weight` (P12/P13/P15; Tidwell: гриль «тяжелее» варки) |
| `protein_source` | `none · beef · lamb · horse · pork · poultry · white_fish · oily_fish · shellfish · egg · legume · cheese_soft · cheese_hard · dairy` | `protein`, `fish_oil`, `umami` |
| `sauce` | `none · cream · tomato · bbq · soy · vinaigrette · cheese · chili · sweet_glaze · broth` | CMS/Gaiser: соус часто доминирует — смешивание векторов (§3.3) |
| `acid_type` | `none · citrus · vinegar · lactic · tomato` | Уксус агрессивнее лимона/вержуса (Swan/Page & Dornenburg); лактик мягче |
| `serve_temp` | `cold · room · hot` | Порядок/температура (§6), горячее острое усиливает жжение (Green 1986) |
| `texture` | `[crispy, creamy, chewy, silky, crunchy]` | Текст объяснения; `creamy` ↔ `cream` |
| `is_dessert` | bool | Включает десертную ветку R4 и десертную интенсивность |
| `cuisine` | `kazakh · central_asian · uyghur · russian · caucasian · turkish · german · czech · belgian · english · irish · french · italian · spanish · japanese · chinese · korean · indian · thai · mexican · american · international` | R15 регион (BA «Look to classic cuisines», CMS «wines… compliment the local food») |
| `tags` | словарь §2.3 + ингредиентные (`lamb`, `pork`, `beef`, `cheese`, `tomato`, `onion`, `garlic`, `mustard`, `egg`, `rice`, `noodles`, `potato`, `corn`, `beans`, `char`, `cured`, `broth`, `olive`, `green`) | R12 и подстановка в тексты |

### 3.3 Автозаполнение вектора («своё блюдо» и разметка 200+ блюд)

```
1. База по dominant_taste / weight / fat_level — как в v1 (customDishVector), но heat_level — отдельное поле 0..1.
2. protein_source → protein, fish_oil, umami (таблица §3.1 №7, №15).
3. cook_method → maillard/smoke/fresh (+fat .1 при fried; +weight .1 при grilled/roasted; salt +.3, umami +.2 при cured; sour +.3 при fermented).
4. sauce → доминирование соуса (CMS, Gaiser): для осей salt, sweet, sour, fat, cream, heat:
      v = 0.6·sauce_vector + 0.4·base      (cream: cream .7 fat +.2; bbq: sweet .6 smoke .8 salt .5; vinaigrette: sour .6 acid_type vinegar;
      tomato: sour .35 umami +.1; soy: salt .7 umami +.15; chili: heat .7; sweet_glaze: sweet .5; cheese: cream .6 fat +.2 salt +.1)
5. Теги → pungent (onion/garlic .3–.5, mustard/horseradish/wasabi .8), green_iron (asparagus/artichoke/spinach .8/.8/.5).
6. is_dessert → sweet ≥ .6, десертная интенсивность.
```

### 3.4 Что доразметить в текущих 50 блюдах

Добавить `protein`, `fish_oil`, `green_iron`, `pungent`, `acid_type`, `is_dessert`, `serve_temp`, `protein_source`, `sauce`; перевести v1 `spice`
в теги (`warm_spice` для зиры/корицы/карри, `pepper` для перца) и в `pungent` (лук/чеснок/горчица). **Айран и кумыс из `dishes.json`
переезжают в каталог напитков** (категория `dairy`), в блюдах остаются только курт и иримшик. Спорные оценки v1, которые стоит
пересмотреть по литературе: `kazy.smoke` .3 → .5 (казы обычно копчёное, и это ключ к мосту с раухбиром/торфом); `sushi` → `fish_oil` .5,
`acid_type=vinegar` (мягкий, .3); `kartoffelsalat` → `acid_type=vinegar`; `tiramisu`, `mochi`, `apple-pie`, `churros`, `strudel` → `is_dessert`.

---

## 4. Правила

### 4.0 Обозначения

`B` — вектор напитка, `D` — блюда; `pos(x) = max(0, x)`; `clamp(x, lo, hi)`; `dW = W_B_eff − W_D`, `dF = F_B − F_D`, `fit` — см. R1.
Вспомогательные множители: `salt_soft = 1 − 0.45·D.salt` (Breslin: Na⁺ ↓ горечь; k 0.4–0.5 — порядок величины, калибровать);
`harsh_tol` — множитель жёсткости гостя {гиперчувствительный 1.4 · медианный 1.0 · толерантный 0.6} (Hanni ≈ 25/50/25 %; PROP — Lanier 2005);
`heat_lover ∈ {0, 1}`; `burn`, `cold` — §2.2. Семейства: **balance** (интенсивность), **cut** (режет/очищает), **complement** (гармония структур),
**contrast** (осознанный контраст), **bridge** (аромат-мост), **context** (повод/регион/гость), **penalty** (штраф), **veto** (потолок балла).

### 4.1 Сводная таблица

| ID | Правило | Семейство | Диапазон | Категории | Уровень | Ключевые источники |
|---|---|---|---|---|---|---|
| R1 | `intensity_match` — вес к весу (`W`) и громкость к громкости (`F`), асимметрично; громкий напиток теряет бонусы остальных правил (`fit`) | balance (+ V1/V6, множитель `fit`) | −15 … +20 | все | C (консенсус) | BA с.4 «Match strength with strength»; Oliver «a dance, not a football tackle»; Mosher «Bambi vs Godzilla»; CMS «weight with weight… If wine is lighter bodied, must be powerful in flavour/high acid»; BA chart 12/16 (strong cheese / smoked goose — исключение); Романовский; Eschevins 2019 |
| R2 | `cut_richness` — танин, горечь, CO₂, кислота, обжарка, спирт режут жир | cut | 0 … +20 | все, при richness ≥ .3 | A (танин×жир), B (сыр→вино), C (горечь, CO₂, кислота, спирт) | Peyrot des Gachons 2012; Madrigal-Galan 2006; BA таблица; Oliver; WSET/CMS; Whisky School |
| R3 | `chili_heat` — сахар/молоко/холод гасят; спирт, горечь, горечь × спирт, танин, CO₂ усиливают | cut или penalty (+ V3) | −36 … +18 | все, при heat ≥ .15 | A | Trevisani 2002; Nasrawi & Pangborn 1990; Nolden 2019; Green 1986; BA таблица «Hop Bitterness emphasizes Spiciness»; панель Sam Adams (C); CMS «Alcohol + spicy = fire»; Gaiser «avoid tannin!» |
| R4 | `sweet_match` — напиток не менее сладок, чем блюдо; обжарка балансирует сладость; шоколад ↔ обжарка; фрукт ↔ фрукт (по семейству); DIPA-контраст (только пиво) | complement / contrast / penalty (+ V2) | −24 … +22 | все, при D.sweet ≥ .3 | C (сильный консенсус) | CMS «Sweets need sweets»; Gaiser; Hanni; Wikipedia (брют + торт); BA таблица «Roasted Malt balances Sweetness», BA с.7 (DIPA + carrot cake — contested; «Chocolate loves a dark beer»; «Fruit beers… affinity for fruit desserts»); NW Cider |
| R5 | `acid_match` — кислотность напитка ≥ кислотности блюда; уксус агрессивнее; танин + кислое; сладкое ✗ кислое | cut / penalty | −20 … +12 | все, при D.sour ≥ .25 | C (+A для pH↔вяжущесть) | CMS «Acidity needs acidity… flabby»; Gaiser; Swan; Kallithraka 1997; pivoman |
| R6 | `salt_modulation` — соль прощает горечь/танин, кислота/CO₂ дают «чистоту», соль + высокий спирт = минус (жир/белок экранируют) | complement / penalty | −12 … +14 | все, при D.salt ≥ .35 | A (соль↓горечь), C | Breslin 1995/1997; WSET (Chianti + соль/лимон); Hanni; Herz; CMS «Acidity cuts saltiness», «Salt… softens tannins»; Goldstein/CMS (соль + алкоголь); Gaiser (соль + танин — contested); Whisky School (жир защищает рецепторы); Death & Co |
| R7 | `umami` — умами без соли/кислоты ужесточает горькое/танинное; с солью — поднимается горечью/кислотой; умами ≈ умами | complement / penalty | −12 … +10 | все, при D.umami ≥ .4 | C (contested: в смеси MSG ↓ горечь) | Hanni (спаржа + Shiraz); WSET; Papazian; Herz; Tidwell |
| R8 | `tannin_protein` — танин любит белок/жир, ненавидит рыбий жир и «зелёное железо» | complement / penalty (+ V4) | −22 … +16 | **категорийное**: вино, сидр, чай, стауты/портеры, выдержанное крепкое — при B.tannin ≥ .25 | A/B (жир↔вяжущесть, сыр→вино), C (рыба, зелень) | CMS; Gaiser; Tidwell; Madrigal-Galan 2006; Peyrot des Gachons 2012; Wikipedia |
| R9 | `delicate_fresh` — сырое/деликатное требует чистого, лёгкого, негорького; хмель × рыбий жир | cut / penalty (+ V5) | −16 … +12 | все, при D.fresh ≥ .3 | C | BA (аперитив; chart 17–18); Сахаров; Романовский; Whisky School («palate destruction»); Marrero (French 75 ↔ суши) |
| R10 | `maillard_harmony` — карамель/тост/хлеб/дуб ↔ корочка; обжарка ↔ уголь | complement | 0 … +12 | все, при D.maillard ≥ .3 | C | Oliver (brown ale ↔ burger/steak); BA (Oktoberfest ↔ roast pork); Mosher; Whisky School (char ↔ oak) |
| R11 | `smoke_bridge` — дым ↔ дым, дым ↔ обжарка (не хмель) | bridge | 0 … +14 | все, при D.smoke ≥ .3 | C | Oliver (Rauchbier); BA (smoked porter ↔ smoked cheese); Del Maguey; Whisky School (торф) |
| R12 | `aroma_bridge` — общие теги | bridge | 0 … +8 | все | D | Oliver «flavor hook»; Cicerone exam; Ahn 2011; Spence 2020 (ограничение) |
| R13 | `both_principles` — есть и cut/contrast, и complement/bridge | balance | 0 / +4 | все | C | BA «All… should involve both of these principles»; Oliver «contrast and harmony at the same time» |
| R14 | `same_on_same` — горькое на горькое; сладкий коктейль на сладкое несладкое блюдо | penalty | −8 … 0 | все (сладкая ветка — коктейли/креплёное) | C | Marrero; Glass & Note; Death & Co |
| R15 | `regional` — регион кухни ∈ регионы напитка | context | 0 / +4 | все | C (weak) | BA с.5; CMS; NW Cider; Storton |
| R16 | `occasion` — meal / aperitif / dessert / hot / evening / party / gourmet / non_alcoholic | context | −12 … +10 (+ фильтр) | все | C | Death & Co (low-ABV к трапезе); Gaiser (игристое универсально); BA (аперитив); v1 |
| R17 | `personal` — `harsh_tol`, `bitter_pref`, `sweet_pref`, `heat_lover`, DNA-косинус | context / множитель | −8 … +8 | все | A/C | Hanni Vinotypes; Lanier 2005 (PROP); Oliver/BA (IPA + карри для любителей) |
| R18 | `temperature_perception` — сладость/горечь растут с температурой | pre-rule (опция, по умолчанию выкл.) | — | все | A (экстраполяция) | Green & Frankmann 1987/88; Cruz & Green 2000; WSET (< 6 °C маскирует) |
| R20 | `classic_pairs` — белый список канонических пар с источником | complement (core) | 0 / +8 + бейдж | все | C | BA «Look to classic cuisines» + чарт BA (oysters/stout, weisswurst/hefeweizen, mussels/witbier, curry/IPA, chocolate/imperial stout, roast pork/Oktoberfest); Oliver (burger/brown ale); WSET/CMS (стейк/танинное красное); tea.ru (окрошка/кислый квас); национальная классика (бешбармак/кумыс) |

### 4.2 Формулы

**R1 intensity_match (balance) — две размерности.**
```
W_B_eff = W_B + [W_B < W_D]·0.25·max(B.acid, 0.8·B.carbonation, B.salt, B.tannin)   # CMS: «If wine is lighter bodied, must be powerful in flavour/high acid to stand up»; CO₂/танин — «cut»
dW      = W_B_eff − W_D                                   # вес: + напиток тяжелее, − легче
dF      = F_B − F_D                                       # громкость: + напиток громче, − тише
k_loud  = 35, если блюдо «сильный сыр / вяленое» (D.protein ≥ .8 ∧ D.salt ≥ .7 ∧ D.fat ≥ .7), иначе 70
pts     = clamp(20 − [dF > 0]·k_loud·dF − [dF < 0]·45·|dF| − 25·|dW|, −15, +20)
fit     = 1 − clamp((dF − 0.15)/0.35)                     # для «сильного сыра/вяленого»: 1 − clamp((dF − 0.30)/0.35)
```
`fit` умножает **положительные** баллы R2, R6, R7, R8, R10, R11, R12, R13: напиток, который громче блюда на ≥ 0.5, не получает
кредита за то, что «освежает» или «дополняет» его — блюда уже не слышно (BA: intensity — принцип №1; Mosher: «Bambi vs. Godzilla»).
Асимметрия: громкий напиток хуже тихого (Goldstein: «пара — как разговор: один говорит, другой слушает»; Романовский: лёгкое пиво
«потеряется» — потеря для напитка, а не для ужина); при этом слишком тихий/лёгкий напиток ловит V6. Исключение k_loud/fit — из чарта BA:
barley wine «best with strong cheese», imperial stout «stands up to foie gras, smoked goose» (казы, жая, рокфор «выдерживают» громкое).
Текст: «Громкость совпадает (0.30 ↔ 0.29); тело легче блюда — карбонизация и кислотность компенсируют (CMS)» / «Напиток громче блюда:
рискует заглушить {dish_main}» / «{dish_main} громче напитка — {drink_name} играет роль фона».

**R2 cut_richness (cut).**
```
richness  = max(D.fat, 0.8·D.cream, 0.6·D.weight);   если richness < 0.3 → правило не срабатывает
cut_power = 0.30·B.tannin + 0.20·B.bitter·(1 − 0.7·D.heat) + 0.15·B.carbonation·(1 − 0.5·D.cream)
          + 0.15·B.acid + 0.05·B.roast + 0.10·B.alcohol          # roast де-дублирован (0.07 → 0.05): обжарка считается в R4/R10/R11
pts       = clamp(30·richness·cut_power, 0, +20)
```
Иерархия весов — по доказательности: вяжущесть×жир измерена (Peyrot des Gachons 2012; Madrigal-Galan 2006), горечь/CO₂/кислота/спирт —
консенсус (BA таблица, Oliver «cutting power against fats», WSET/CMS «Acid and tannin can balance», Whisky School «alcohol acts as a solvent»).
Горечь дисконтируется остротой (при капсаицине горечь — не «cut», а раздражитель, см. R3); сливочный соус гасит карбонизацию (Glass & Note).
Текст — по доминирующему слагаемому: «Танины {drink} связывают жир {fat_source}» / «Хмелевая горечь режет жирность {fat_source}» /
«Карбонизация смывает {cream_source} с языка — каждый глоток как первый» / «Кислотность {drink} режет жир {fat_source}».

**R3 chili_heat (cut ↔ penalty; V3).**
```
если D.heat < 0.15 → не срабатывает
relief = 0.30·clamp(B.sweet/0.6) + 0.50·B.dairy + 0.15·cold(B.serve_temp) + 0.10·B.body
hop    = pos(B.bitter − 0.5)/0.5                                                     # от ≈ 39 IBU
aggr   = 0.50·burn(ABV) + 0.40·hop·salt_soft + 0.30·hop·clamp((ABV − 5)/4) + 0.12·B.tannin + 0.08·pos(B.carbonation − 0.6)/0.4
pts    = clamp(D.heat·(36·relief − 90·aggr·harsh_tol·(1 − 0.85·heat_lover)), −36, +18)
V3: D.heat ≥ 0.6 ∧ ABV ≥ 30 ∧ ¬heat_lover → потолок 35
```
Член `hop·clamp((ABV − 5)/4)` — взаимодействие горечи и спирта: панель Sam Adams сравнивала 6.5 %/45 IBU (↓ жжение) и 8.4 %/85 IBU
(↑ жжение) — отличаются оба параметра сразу; Daily Meal описывает «feedback loop» альфа-кислот и капсаицина. `heat_lover` снимает
85 % штрафа: для того, кто «любит пожарче», подчёркивание остроты хмелем (BA: «Hop Bitterness emphasizes Spiciness») — желаемый
эффект, и IPA/DIPA к карри становится классикой (BA chart 4, Oliver, Hop Culture).
Основания: сахар (насыщение при ~60 г/л — Nasrawi: не дозозависимо) и молочный белок/жир (Nolden: молоко лучше всего, белок важнее
жира; Nasrawi: 10 % сахароза при 20 °C ≈ молоко при 5 °C) — главные «гасители»; холод — Nasrawi (5 °C > 20 °C), Green 1986; этанол —
TRPV1 (Trevisani), CMS «Alcohol + spicy = fire»; горечь — панель Sam Adams (85 IBU/8.4 % ↑ жжение; 45 IBU/6.5 % ↓) и BA
«Hop Bitterness emphasizes Spiciness» — порог `bitter > 0.5` (≈ 39 IBU), при 45 IBU без крепости штраф мал; танин — Gaiser «avoid tannin!»; карбонизация —
**не** успокоитель (Nolden: сельтерская ≈ вода; Garneau: CO₂ активирует болевые рецепторы), лёгкий минус при очень высокой.
Соль дисконтирует горечь (Breslin). Текст: «Молочный белок айрана связывает капсаицин — жжение {dish} стихает» / «Сладость {drink}
гасит остроту {chili_source}» / «Спирт {ABV} % активирует те же рецепторы, что перец, — пара будет «горячее», чем хочется».

**R4 sweet_match (complement / contrast / penalty; V2).**
```
если D.sweet < 0.3 → не срабатывает
gap = D.sweet − B.sweet
pts = gap ≤ 0:            8 + 6·B.sweet·D.sweet
      0 < gap ≤ 0.2:      8·(1 − gap/0.2)                    # порог восприятия 0.2 — наша оценка
      gap > 0.2:          −30·(gap − 0.2)
contrast: D.is_dessert ∧ B.category = beer ∧ B.bitter ≥ 0.75 ∧ |dF| < 0.3 → pts = max(pts, +6)   # BA: «highly hopped beers such as double IPAs» — только хмелевая горечь пива; негрони/амаро не контрастируют (Glass & Note, Marrero)
pts += 10·min(B.roast, max(D.tags.chocolate, D.tags.cocoa))                     # «Chocolate loves a dark beer»
pts += 8·B.roast·D.sweet                                                         # таблица BA: Roasted Malt balances Sweetness (Irish stout ↔ tiramisu в чарте BA)
pts += 6·min(1, Σ_семейство min(fruit_B[f], fruit_D[f]))·(1 если десерт, иначе 0.5)   # «Fruit beers have an obvious affinity for fruit desserts» — то же семейство (яблоко ≠ цитрус)
pts = clamp(pts, −24, +22)
V2: D.is_dessert ∧ D.sweet ≥ 0.6 ∧ B.sweet ≤ 0.15 ∧ ¬contrast → потолок 35          # брют + свадебный торт
```
Текст: «Сладость {drink} держит уровень {dessert} — напиток не кажется горьким» / «{dessert} слаще напитка: на его фоне {drink} покажется
резким и водянистым» / «Обжаренный солод отзеркаливает какао {dessert}, а горечь снимает приторность (контраст + гармония)».

**R5 acid_match (cut / penalty).**
```
если D.sour < 0.25 → не срабатывает
eff_sour = D.sour + 0.2·[acid_type = vinegar]
eff_acid = max(B.acid, 0.6·B.carbonation)
gap      = eff_sour − eff_acid
pts      = gap > 0 ? −22·gap·(1.5 если vinegar иначе 1) : +10·min(B.acid, D.sour)
pts     −= 8·B.tannin·D.sour·[B.tannin ≥ 0.3]            # низкий pH ↑ вяжущесть (Kallithraka 1997 — экстраполяция)
pts     −= 12·pos(B.sweet − 0.4)·D.sour·[¬десерт]         # «сладкие компоненты не сочетают с кислотными» (pivoman)
pts      = clamp(pts, −20, +12)
```
Текст: «Кислотность {drink} не ниже кислинки {acid_source} — пара звучит чисто» / «После {acid_source} {drink} покажется плоским («flabby»)» /
«Уксус в {dish} — враг танинов {drink}».

**R6 salt_modulation (complement / penalty).**
```
если D.salt < 0.35 → не срабатывает
forgive = min(8·D.salt·(B.bitter·(1 − D.heat) + 0.75·B.tannin), 8)     # Na⁺ подавляет горечь и вяжущесть (Breslin; CMS «Salt… softens tannins»)
clean   = 6·D.salt·max(B.acid, B.carbonation)                          # Herz «cleanness», CMS «Acidity cuts saltiness», NW Cider (bubbles vs briny)
shield  = 1 − 0.6·max(D.fat, D.protein)                                # Whisky School: жир и белок «защищают рецепторы» от спирта
alco    = −12·D.salt·pos(B.alcohol − 0.35)/0.65·shield                 # Goldstein: солёное не любит высокий алкоголь; CMS «Alcohol… accentuated… salt»
tann    = −2·D.salt·pos(B.tannin − 0.6)/0.4                            # Gaiser: соль усиливает танин — contested (CMS: смягчает), поэтому вес вдвое меньше
snack   = +4 если D.salt ≥ 0.7 ∧ D.weight ≤ 0.45 ∧ B.carbonation ≥ 0.5 ∧ B.bitter ≥ 0.3   # курт/брецель/орешки ↔ пиво/спритц/негрони
pts     = clamp(forgive + clean + alco + tann + snack, −12, +14)
```
Текст: «Соль {salt_source} гасит горечь {drink} (≈{IBU} IBU) — солод и фрукт звучат ярче» / «Кислотность {drink} балансирует соль {dish}» /
«Соль {dish} подчёркивает жжение спирта {ABV} %».

**R7 umami (complement / penalty).**
```
если D.umami < 0.4 → не срабатывает
если D.salt < 0.4 ∧ D.sour < 0.3:                                       # условие Ханни: умами БЕЗ соли/кислоты
     pts = −14·D.umami·(0.5·B.tannin + 0.3·B.bitter + 0.2·B.alcohol)·harsh_tol
иначе:
     pts = 8·D.umami·(0.5·B.bitter + 0.5·B.acid) + 4·min(B.umami, D.umami)   # Papazian: умами поднимают горечь/кислота; Herz: umami ≈ umami
pts = clamp(pts, −12, +10)
```
Условность правила — из-за противоречия: лабораторно MSG в смеси *снижает* горечь (обзор PMC13517633), а эксперты описывают
последовательность «еда → напиток» (Hanni: спаржа + Shiraz → «bitter and acidic», после соли и лимона — «smooth»).

**R8 tannin_protein (категорийное; complement / penalty; V4).**
```
если B.tannin < 0.25 → не срабатывает (пиво без выраженной вяжущести, коктейли, лимонады)
plus  = 16·B.tannin·max(D.protein, D.fat)·(1 если D.protein ≥ 0.4 иначе 0.5)
fish  = −20·B.tannin·D.fish_oil
green = −10·B.tannin·D.green_iron
dry   = −6·B.tannin·(1 − max(D.protein, D.fat))·[B.tannin ≥ 0.5]
pts   = clamp(plus + fish + green + dry, −22, +16)
V4: B.tannin ≥ 0.5 ∧ D.fish_oil ≥ 0.6 → потолок 35
```
Текст: «Белок и жир {protein_source} связывают танины {drink} — вино становится мягче и фруктовее (WSET)» / «Рыбий жир {dish} + танины =
металлический привкус» / «Спаржа/артишок дают с танинами металлический финиш».

**R9 delicate_fresh (cut / penalty; V5).**
```
если D.fresh < 0.3 → не срабатывает
pts  = D.fresh·(8·B.carbonation + 6·(1 − B.aroma_intensity) + 4·B.acid − 10·B.roast − 10·pos(B.body − 0.55)/0.45
                − 12·pos(B.alcohol − 0.25)/0.75 − 6·pos(B.bitter − 0.5)/0.5 − 6·B.smoke)
pts −= 8·D.fish_oil·pos(B.bitter − 0.6)/0.4          # хмель × жирная рыба (консенсус, слабый)
pts  = clamp(pts, −16, +12)
V5: D.fresh ≥ 0.6 ∧ ABV ≥ 35 → потолок 35
```

**R10 maillard_harmony (complement).**
```
если D.maillard < 0.3 → не срабатывает
m   = max(B.tags.caramel, B.roast·max(D.smoke, D.tags.char), 0.6·B.tags.bread, B.tags.oak_vanilla, 0.8·B.tags.toast, 0.7·B.tags.nutty)
pts = clamp(12·D.maillard·m, 0, +12)
```
Обжарка бриджит только с углём/дымом (иначе roast трижды считался бы: cut, umami, maillard — и тёмное пиво «выигрывало» всё).

**R11 smoke_bridge (bridge).** `если D.smoke ≥ 0.3: pts = clamp(12·min(D.smoke, B.smoke) + 5·D.smoke·B.roast, 0, +14)`. Хмель не участвует (ошибка v1 R9).

**R12 aroma_bridge (bridge, потолок +8).** `pts = clamp(8·Σ_tag min(w_B[tag], w_D[tag]), 0, +8)`; в объяснение подставляются 1–3 общих тега.

**R13 both_principles (balance).** `+4·fit`, если есть правило семейства cut/contrast с ≥ +3 и правило семейства complement/bridge с ≥ +3.

**R14 same_on_same (penalty).** `pts = −8·B.bitter·D.bitter; −6, если B.cat ∈ {cocktail, fortified} ∧ B.sweet > 0.5 ∧ D.sweet > 0.5 ∧ ¬десерт; clamp(−8, 0)`.

**R15 regional (context).** `+4`, если `B.origin_affinity ∩ D.cuisine ≠ ∅` (кумыс/айран/шубат/квас/локальный лагер ↔ казахская кухня; чешский лагер ↔ шницель; witbier ↔ мидии).

**R16 occasion (context).**
```
meal:       +6·[ABV ≤ 12 ∧ B.carbonation ≥ 0.5] − 8·[ABV ≥ 25 ∧ ¬десерт] − 12·pos(B.alcohol − 0.5)/0.5   # Death & Co: low-ABV к трапезе, крепкие коктейли — «к одному укусу»
aperitif:   +5·B.bitter·B.carbonation + 3·B.acid − 6·pos(B.body − 0.6)                                   # BA: «light in body, not aggressively bitter»; спритц
dessert:    +4·[B.sweet ≥ 0.35] + 2·[B.alcohol ≥ 0.4]                                                    # дижестив
hot:        +8·B.carbonation + 4·B.acid − 8·B.alcohol
evening:    +5·B.body + 4·clamp(ABV/20)
party:      +5·(1 − B.aroma_intensity) + 3·B.carbonation − 6·B.alcohol
gourmet:    +4·B.aroma_intensity + 2·B.tannin + 2·B.body
non_alcoholic (водитель, день, халяль): жёсткий фильтр ABV ≤ 0.5 %
clamp(−12, +10)
```

**R17 personal (context / множители).** `harsh_tol` умножает штрафные части R3, R7, R8(−), R14; `bitter_pref ∈ [−1, 1]` → `clamp(14·pref·(B.bitter − 0.5), −7, +7)`;
`sweet_pref` → `±4·(B.sweet − 0.4)`; `heat_lover` → см. R3 (снимает V3 и 60 % штрафа); DNA — косинус вектора напитка к профилю гостя на 14 осях:
`clamp(40·(cos − 0.85), −6, +6)`. Профиль по умолчанию — медианный.

**R18 temperature_perception (опция).** Перед правилами: `warmth = clamp((T − 6)/14)`; `sweet' = sweet·(1 + 0.25·warmth)`, `bitter' = bitter·(1 + 0.25·warmth)`.
Экстраполяция Green & Frankmann (20→36 °C: до 2×) на диапазон подачи 4–20 °C — **не измерено**, поэтому выключено по умолчанию; включается после дегустации.

**R20 classic_pairs (complement, core).** Белый список задокументированных классических пар — у каждой записи обязательна ссылка (в прототипе:
устрицы ↔ dry stout, вайсвурст ↔ вайсбир, мидии ↔ witbier, карри ↔ IPA, шоколадный фондан ↔ imperial stout, свинина запечённая ↔ Oktoberfest/amber,
шницель ↔ чешский лагер — всё из чарта и текста BA; бургер ↔ brown ale — Oliver; стейк ↔ каберне — WSET/CMS; окрошка ↔ кислый квас — tea.ru;
бешбармак ↔ кумыс — национальная классика, уровень C) даёт `+8` и бейдж «классика». Кураторские пары Efes v1 — в тест-набор (§7), в баллы —
только через этот список (≤ +8, а не ±16). Без R20 прототип проходит 65/68 пар — правила самодостаточны, список лишь поднимает признанные исключения.

### 4.3 Вето (потолки балла)

| ID | Условие | Потолок | Источник |
|---|---|---|---|
| V1 | напиток перекрикивает: `dF ≥ 0.35` или (`dF ≥ 0.20 ∧ dW ≥ 0.30`); блюдо не десерт и не «сильный сыр/вяленое» (`protein ≥ .8 ∧ salt ≥ .7 ∧ fat ≥ .7`) | 35 | BA chart 12/16: barley wine, imperial stout «easily overpowers most main dishes… best with strong cheese or dessert», «stands up to foie gras, smoked goose» |
| V2 | десерт `sweet ≥ .6` × напиток `sweet ≤ .15` и `bitter < .75` | 35 | CMS «Sweets need sweets»; Wikipedia (брют + свадебный торт); Gaiser |
| V3 | `heat ≥ .6` × `ABV ≥ 30` × не `heat_lover` | 35 | CMS «Alcohol + spicy = fire»; Trevisani 2002 |
| V4 | `tannin ≥ .5` × `fish_oil ≥ .6` | 35 | CMS «Certain fish + tannin = metallic»; Gaiser; Swan |
| V5 | `fresh ≥ .6` × `ABV ≥ 35` | 35 | Whisky School (cask strength + деликатное = «palate destruction») |
| V6 | блюдо топит напиток по **громкости**: `dF ≤ −0.40` или (`dF ≤ −0.20 ∧ dW ≤ −0.33`); лёгкое тело само по себе не вето — CMS: лёгкий, но яркий/кислый напиток «stands up» (кумыс, чай, брют) | 50 | Mosher «Bambi vs Godzilla»; Романовский; CMS; сенсорный отчёт («напиток теряется») |
| V7 | контекст `non_alcoholic` и ABV > 0.5 % | исключить из выдачи | продуктовое требование |

Вето срабатывают после суммирования и **всегда показываются гостю как предупреждение** (`warnings`), даже если правило дало плюсы.

### 4.4 Какие правила для каких категорий

| Категория | Специфика |
|---|---|
| Пиво, б/а пиво, радлер | Все базовые; R8 только для стаутов/портеров (`tannin ≥ .25`); `dairy` для milk/milkshake |
| Сидр | R5 (кислота) и R2 (кислота+CO₂) — главные; R8 при heritage-танине; сладкие «пивные напитки» (Somersby) — R4 как сладкий напиток + честная маркировка `labeled_as` |
| Вино тихое | R8 — определяющее (танин × белок / рыбий жир / зелень); R5; R4 для десертов; `carbonation` = 0 |
| Игристое | R2/R5/R9 через `carbonation` = 1 и `acid` ≥ .8; V2 для брюта с десертами |
| Коктейли | `alcohol` после дилюции; R14 (контраст важнее зеркала — Marrero); R16 meal штрафует ≥ 25 %; сауэры — R5/R6; спритц — R6 snack/R16 aperitif |
| Крепкое | R3 через `burn` ≈ 1 и V3; R6 alco; R9/V5 к деликатному; R2 через `alcohol` (растворитель жира) и R11 (торф/мескаль ↔ дым) |
| Квас, лимонады, тоник | R4/R5 через `sweet`/`acid`; R3 relief через сахар (сладкий лимонад к острому — как Kool-Aid у Nolden); `alcohol` ≈ 0 → нет штрафов спирта |
| Кумыс, айран, шубат | R3 через `dairy` (главный «гаситель» остроты); R5 (высокая кислотность); R15 регион; R1 через исключение CMS (`acid`/`salt` «спасают» лёгкое тело) |
| Чай | R8 (танин чая ↔ жир — Tidwell); `serve_temp` 60–70 °C (R18 при включении) |

---

## 5. Итоговый балл, тип пары и объяснимость

### 5.1 Формула

```
S_core = Σ R1…R14 + R20 classic             # механика пары (R2, R6, R7, R8, R10–R13 умножены на fit из R1)
S_ctx  = Σ R15…R17                          # регион, повод, гость
score  = clamp(round(45 + 0.9·S_core + S_ctx), 3, 99)
score  = min(score, cap)  для каждого сработавшего вето (V1–V5 → 35, V6 → 50); V7 — исключение из выдачи
```

Бэнды (совместимы с UI v1, добавлен «Избегать»): **≥ 85** идеальная пара · **72–84** отличное сочетание · **60–71** хорошая пара ·
**48–59** нейтрально · **36–47** не рекомендуем · **≤ 35** избегать (только с вето — гость видит причину).

Прототип v2.1 на матрице 57 архетипов × 44 блюда (2 508 пар) даёт: min 4, p10 35, медиана 65, p90 78, max 99; 28 % пар ≥ 72, 21 % ≤ 47
(первая итерация: медиана 68, 38 % ≥ 72, 15 % ≤ 47). Ещё чуть щедро (критика v1: «медиана 65 делает почти всё хорошим»). Целевое распределение
после калибровки: медиана 58–62, ≤ 25 % пар ≥ 72, ≥ 20 % ≤ 47. Достигается **не ручной правкой**, а подгонкой `base`/`k` и масштабов правил по эталонным парам (§7.4);
первое приближение — `base 42, k 0.85`.

### 5.2 Тип пары и механизмы

- `match_type` (основной) — семейство самого сильного положительного правила среди **cut / complement / contrast / bridge** (R1, R13 и контекст не участвуют — они про «громкость» и про гостя).
- `secondary_type` — сильнейшее положительное правило другого семейства (если ≥ +3). BA и Oliver требуют одновременно контраст и гармонию — гость видит обе стороны: «Контраст: горечь режет жир · Гармония: хлебный солод ↔ сочни».
- `mechanisms[]` — все правила с |pts| ≥ 3: `{rule, family, points, evidence: A|B|C|D, text}`; `reasons` — топ-3 положительных, `warnings` — все отрицательные ≤ −3 и все вето.
- `sommelier_pick` — из белого списка R20; кураторский вердикт больше не переопределяет тип пары.

### 5.3 Как формируется «почему» (формат Cicerone ATE)

Cicerone на уровне Advanced/Master требует называть конкретное взаимодействие глаголом: *accentuate / soften / cancel / cut / bridge*.
Каждое правило имеет шаблон с слотами, которые заполняются **реальными данными обеих сторон**:

| Слот | Откуда берётся | Пример |
|---|---|---|
| `{dish_component}` | По приоритету правила: R2 → `protein_source`/`sauce`/`cream`-тег («жир баранины», «сливочный соус»); R3 → тег `chili`/`pepper`; R5 → `acid_type`/`tomato`/`sour_lactic`; R6 → `cured`/`cheese`/`brine`/`marinade`; R10 → `cook_method` («корочка от жарки»); R11 → «дым углей» | «жир конины», «соль курта», «уксус в заправке» |
| `{drink_component}` | Ось + число + топ-тег: `bitter` → «хмелевая горечь (≈ {IBU} IBU)», `tannin` → «танины {style}», `acid` → «кислотность {style} (pH ≈ {ph})», `dairy` → «молочный белок айрана», `sweet` → «остаточный сахар ({g/l} г/л)», `carbonation` → «карбонизация ({vol} vol CO₂)» | «хмелевая горечь (≈ 40 IBU)» |
| `{effect}` | Фиксированная фраза правила: «обновляет рецепторы», «жжение стихает», «напиток кажется мягче и фруктовее» | — |
| `{evidence}` | Бейдж уровня: A «измерено в лаборатории», B «показано на панели», C «консенсус сомелье», D «гипотеза» | — |

Грамматика: `<{dish_component}> <глагол> <{drink_component}>, поэтому <{effect}>` (+ бейдж). Примеры выдачи прототипа:

| Пара | Балл | Тип | Reasons (топ-3) | Warnings |
|---|---|---|---|---|
| Бешбармак × Kozel Černý (чешский тёмный лагер) | 76 (№3 среди пива) | bridge · вторичный cut | «Громкость совпадает (0.30 ↔ 0.29): тёмный лагер — плотный фон, не перекрикивает мясо; тело легче блюда, карбонизация компенсирует» · «Хлебный солод и лёгкая карамель отзеркаливают сочни и бульон (мост: хлеб)» · «Карбонизация и мягкая горечь (≈ 26 IBU) режут жир баранины» | — |
| Лагман острый × айран | 67 | cut (relief) | «Молочный белок айрана связывает капсаицин — жжение перца стихает (A: Nolden 2019, Nasrawi 1990)» · «Холодная подача (5 °C) усиливает эффект» · «Региональная пара: кухня Средней Азии ↔ айран» | «Айран тише лагмана (0.15 ↔ 0.44) — напиток играет роль фона» |
| Казы × раухбир | 82 (№2 среди пива) | bridge · вторичный cut | «Дым бука в раухбире вторит копчению казы (мост: дым)» · «Соль вяленой конины гасит горечь (≈ 25 IBU) — солод звучит ярче (A: Breslin 1995/1997)» · «Карбонизация и кислотность смывают жир конины» | — |
| Чак-чак × брют | 35 (вето V2) | penalty | «Пузырьки режут масло чак-чака» · «Хлебная нота брюта ↔ тесто (мост)» | «Мёд чак-чака слаще брюта (≈ 90 vs 12 г/л): напиток покажется кислым и тонким (C: CMS «Sweets need sweets»)» |
| Стейк × каберне | 99 (№1 среди вин; классика) | complement · вторичный cut | «Белок и жир говядины связывают танины каберне — вино мягче и фруктовее (B: Madrigal-Galan 2006)» · «Громкость и вес совпадают (0.47 ↔ 0.44; 0.56 ↔ 0.60)» · «Дуб/ваниль и карамелизация корочки перекликаются (мост)» | — |
| Крылышки Buffalo × DIPA 85 IBU / 8.4 % | 44 (гость без `heat_lover`) → 76 с `heat_lover` | penalty → contrast | c `heat_lover`: «Хмель подчёркивает остроту — как вы любите (BA: «Hop Bitterness emphasizes Spiciness»)» | без флага: «85 IBU и 8.4 % спирта усиливают жжение перца (A: Trevisani 2002; панель Sam Adams)» |

### 5.4 Диверсификация выдачи

В топ-N: не более двух позиций одного стиля-архетипа; при наличии — минимум одна безалкогольная позиция (айран/квас/лимонад/б/а пиво) и минимум
одна не-пивная категория, если её балл ≥ 60. Вкладки по категориям (пиво · сидр · вино/игристое · коктейли · крепкое · безалкогольное)
показывают лучшие в категории — так и Efes-портфель, и «честные» альтернативы видны одновременно.

---

## 6. Интенсивность, повод, личный профиль, температура

### 6.1 Интенсивность
`W`/`F` (§2.2, §3.1) — две шкалы по образцу чарта BA «Flavor impact: Delicate … Intense» (громкость; шкала горечи 15 → 70+ IBU) и
правила CMS «weight with weight» (вес). Ориентиры по архетипам — в §2.2 и §3.1. Гостю показываются обе пары чисел («вес 0.43 ↔ 0.69 ·
громкость 0.30 ↔ 0.29») — это и есть «Match strength with strength» (BA) с объяснением, за счёт чего лёгкий напиток «держит» тяжёлое блюдо
(карбонизация, кислота, танин — CMS-исключение).

### 6.2 Повод (`occasion`)
R16 + фильтры: `meal` — полноценная трапеза (Death & Co: только low-ABV/игристое «тянут» ужин, крепкие коктейли — к одному укусу);
`aperitif` (BA: лёгкое тело, не агрессивная горечь; спритц/G&T/пилснер); `dessert` (дижестивы, десертные вина, milk stout);
`hot` / `evening` / `party` / `gourmet` — как в v1, пересчитаны на новые оси; `non_alcoholic` — жёсткий фильтр ABV ≤ 0.5 % (водитель, дневное
время, халяль-контекст) — в выдаче кумыс/айран/шубат/квас/лимонады/б/а пиво/чай.

### 6.3 Личный профиль
- **Чувствительность (`harsh_tol`)** — 3 вопроса анкеты (горький кофе без сахара? тоник? крепкий чай?) → {гиперчувствительный 1.4 · медианный 1.0 · толерантный 0.6}
  (Hanni: ≈ 25 / 50 / 25 %; PROP — Lanier 2005). Множитель на все штрафы за горечь/танин/спирт/жжение.
- `bitter_pref`, `sweet_pref` ∈ [−1, 1]; `heat_lover` (снимает V3, режет штраф R3 на 60 % — IPA + карри для тех, кто «любит пожарче»: BA, Oliver, Hop Culture).
- **Flavor DNA v2** — взвешенный вектор оценок на 14 осях (love +2 / like +1 / dislike −1), косинус к напитку ±6. Архетипы v1 переносятся на новые оси
  (Хмелевой исследователь → `bitter`/`aroma_intensity`; Солодовый классик → `sweet`/`body`; Освежающий минималист → `carbonation`/низкая `aroma`;
  Крепкий философ → `alcohol`/`body`; Янтарный гурман → `roast`/тег `caramel`) и дополняются двумя не-пивными: «Кислотный» (`acid`, `carbonation`) и
  «Мягкий сладкоежка» (`sweet`, `dairy`).

### 6.4 Температура подачи и порядок
- На карточке напитка — диапазон подачи (§2.1, ось 14): BA для пива (4.5–7 / 7–10 / 10–13 °C), WSET для вина (игристое и лёгкие белые ≈ 6–10, полные белые 10–13,
  лёгкие красные ≈ 13, полные красные 15–18; ниже 6 °C — маскирует ароматы).
- В правилах: холод — часть `relief` в R3 (Nasrawi: 5 °C > 20 °C; Green 1986: охлаждение языка до ≈ 25 °C снимает умеренное жжение).
- Опция R18 (выкл.): тёплая подача поднимает воспринимаемую сладость и горечь (Green & Frankmann: до 2× между 20 и 36 °C) — включать после дегустации.
- **Порядок в сете/дегустации:** сортировать по громкости `F_B` по возрастанию (при равной — по весу `W_B`), затем от сухого к сладкому (Oliver: «A delicate beer that follows a blockbuster is not likely
  to show its best»; CMS: «lighter to fuller body, drier to sweeter»); горячее острое блюдо ставить после деликатного.

---

## 7. Эталонные тест-пары (калибровочный набор)

Критерии прохождения: **top3** — ранг ≤ 3 внутри своей категории напитка для этого блюда и балл ≥ 70; **good** — балл ≥ 60 без вето; **bad** — балл ≤ 57 и не в топ-3 категории (для категорий из ≤ 3 позиций — только балл); **avoid** — балл ≤ 35 и сработало вето. Колонка «Прототип» — результат `engine_v2_prototype.py` v2.1 без калибровки (архетипы §2.4, блюда §3), с белым списком R20; без R20 проходит 65/68 (дополнительно не проходят устрицы × стаут = 51 и вайсвурст × вайсбир = ранг 4). Блюда, которых нет в `data/dishes.json` (устрицы, мидии, форель, свинина запечённая, фондан, карри, чизкейк, буррата, вайсвурст, лосось, спаржа, чак-чак, лагман, тартар, выдержанный сыр, тёмный шоколад, окрошка), нужно разметить.

### 7.1 Таблица

| # | Блюдо | Напиток (архетип) | Ожидание | Почему | Источник | Прототип: балл / ранг в категории / вето | Статус |
|---|---|---|---|---|---|---|---|
| T01 | Устрицы сырые (`oysters-raw`) | `dry_stout` | good | Классика BA (регион/контраст: минеральность ↔ обжарка); у v2 — good, не top: «минеральность ↔ обжарка» не моделируется → кандидат в classic_pairs | BA chart №14; BA с.5 «who would have thought to put stout together with oysters?» | 58 / 16 / — | FAIL |
| T02 | Устрицы сырые (`oysters-raw`) | `brut_sparkling` | top3 | Кислота к кислоте/брину, пузырьки, нулевой танин | CMS «Acidity needs acidity»; Marrero (French 75 ↔ суши); Hanni/deBary | 87 / 1 / — | OK |
| T03 | Мидии на пару (`mussels-steamed`) | `witbier` | top3 | Регион (Бельгия), цитрус/кориандр wit ↔ лимон и травы | BA chart №19 «classic with steamed mussels» | 88 / 1 / — | OK |
| T04 | Шницель (`schnitzel`) | `czech_pale_premium` | good | Горечь и CO₂ режут фритюр; регион | BA с.5 «Schnitzel with pale lager may be obvious»; кураторская пара Efes (Kozel × шницель 4/5) | 90 / 1 / — | OK |
| T05 | Форель на гриле (`grilled-trout`) | `german_pils` | good | Лёгкое к лёгкому, чистая горечь | BA с.6 «For lighter items such as grilled fish, a Pilsener is a treat» | 75 / 4 / — | OK |
| T06 | Свинина запечённая (`roast-pork`) | `amber_lager` | top3 | Карамельный солод ↔ корочка запечённой свинины (Maillard) | BA с.4 «rich, caramelly flavors of an Oktoberfest lager and roasted pork» | 90 / 1 / — | OK |
| T07 | Шоколадный фондан (`chocolate-fondant`) | `imperial_stout` | top3 | Обжарка ↔ какао; интенсивность десерта ↔ imperial stout | BA с.7 «Flourless chocolate cake or truffles call for an inky imperial stout»; «Chocolate loves a dark beer» | 99 / 1 / — | OK |
| T08 | Тирамису (`tiramisu`) | `porter` | good | Обжарка ↔ кофе/какао, сладость сопоставима | BA chart, десертная колонка (chocolate soufflé, tiramisu, mocha) | 66 / 5 / — | OK |
| T09 | Рёбрышки BBQ (`bbq-ribs`) | `strong_lager` | good | Солодовая сладость гасит «sweet heat» соуса, тело держит вес | BA с.6 «sweet heat of barbecue can be tamed by a beer like a Maibock or an abbey-style dubbel» (крепкий солодовый лагер — ближайший в KZ) | 61 / 15 / — | OK |
| T10 | Карри с курицей (`chicken-curry`) | `american_ipa_45` | good | Интенсивность совпадает; 45 IBU / 6.5 % не усиливают жжение; цитрус хмеля ↔ лайм/кориандр — contested | BA chart №4 «classic with curry!»; панель Sam Adams (6.5 %/45 IBU ↓ heat); Herz | 81 / 1 / — | OK |
| T11 | Крылышки Buffalo (`buffalo-wings`) | `double_ipa_85` | bad | 85 IBU / 8.4 % усиливают жжение; критерий: ниже helles и IPA-45 на ≥ 8 баллов и ≤ 60 | Garneau/CraftBeer.com (панель Sam Adams: «increased sensation of heat»); Alcohol Professor | 44 / 21 / — | OK |
| T12 | Крылышки Buffalo (`buffalo-wings`) | `helles` | good | Низкая горечь, солод, холод — не усиливают жжение | BA chart №23 (Helles/Dortmunder ↔ spicy); Hastings; панель Sam Adams | 71 / 13 / — | OK |
| T13 | Чизкейк (`cheesecake`) | `double_ipa_85` | good | Контраст: мощная горечь снимает приторность при равной интенсивности (спорно с сенсорикой P2 — ветка dessert_contrast) | BA с.7 «cheesecake, crème brulée or carrot cake… with… double IPAs» | 66 / 3 / — | OK |
| T14 | Шоколадный фондан (`chocolate-fondant`) | `light_lager` | avoid | Десерт слаще и мощнее напитка: пиво водянистое и горькое (V2, V6) | Mosher «Bud Light and chocolate cake… disaster»; CMS «Sweets need sweets» | 21 / 21 / V6_drowned,V2_dry_vs_dessert | OK |
| T15 | Капрезе (`caprese`) | `barleywine` | avoid | Напиток перекрикивает салат (V1) | BA chart №12 «Easily overpowers most main dishes. Best with strong cheese or dessert» | 18 / 21 / V1_overpower | OK |
| T16 | Суши (нигири) (`sushi`) | `rice_lager` | top3 | Чистое, лёгкое, рис ↔ рис; нет обжарки и горечи | BA chart №17–18 («very light foods: salads, sushi»); кураторская пара Efes 5/5 (Wùkōng Jū × суши) | 82 / 1 / — | OK |
| T17 | Суши (нигири) (`sushi`) | `imperial_stout` | avoid | Перекрикивает деликатное, обжарка на сырой рыбе (V1) | BA chart №16; BA аперитив («light in body, not aggressively bitter») | 15 / 22 / V1_overpower | OK |
| T18 | Казы (`kazy`) | `rauchbier` | top3 | Дым ↔ дым; соль гасит горечь; CO₂ режет жир конины | Oliver (Rauchbier ↔ smoked meats); BA (smoked porter ↔ smoked cheese); pivoman | 82 / 2 / — | OK |
| T19 | Казы (`kazy`) | `czech_pale_premium` | good | Соль вяленой конины «прощает» 40 IBU, горечь и CO₂ режут жир | Кураторская пара Efes 5/5 (Efes Pilsener × казы); Breslin & Beauchamp 1995 | 69 / 14 / — | OK |
| T20 | Бешбармак (`beshbarmak`) | `czech_dark` | top3 | Плотный солод — фон для варёной баранины; хлеб ↔ сочни; CO₂ и горечь режут жир | Кураторская пара Efes 5/5 (Kozel × бешбармак); сенсорный отчёт (amber/dark lager) | 76 / 3 / — | OK |
| T21 | Бешбармак (`beshbarmak`) | `rice_lager` | bad | Блюдо топит напиток (V6) | Романовский «лёгкое пиво… вкус потеряется»; сенсорный отчёт («напиток теряется») | 55 / 20 / — | OK |
| T22 | Курт (`kurt`) | `german_pils` | good | Соль курта подавляет горечь пилса, кислинка ↔ карбонизация | Breslin & Beauchamp 1995/1997; сенсорный отчёт (курт/орехи/брецель ↔ пилснер) | 60 / 3 / — | OK |
| T23 | Бургер (`burger`) | `brown_ale` | good | Карамель/орех бурого эля ↔ корочка котлеты; горечь режет жир | Oliver: «brown ale works so nicely with a hamburger» | 83 / 3 / — | OK |
| T24 | Стейк (`steak`) | `porter` | good | Обжарка ↔ уголь, тело ↔ вес стейка | BA chart №13–14 (porter/dry stout ↔ steak); Oliver («grilled steak») | 81 / 4 / — | OK |
| T25 | Плов (`plov`) | `amber_lager` | good | Карамельный солод ↔ зирвак, тело ↔ вес плова | Сенсорный отчёт; Maillard-гармония (Oliver, BA) | 77 / 1 / — | OK |
| T26 | Буррата (`burrata`) | `weissbier` | good | Эфиры пшеничного ↔ сливки: «peach ice cream» | Mosher (Flavor Fever; Cheese Professor) | 70 / 2 / — | OK |
| T27 | Вайсвурст (`weisswurst`) | `weissbier` | top3 | Регион (Бавария); дрожжевая пряность ↔ петрушка/телятина | BA chart №17 «classic with weisswurst» | 84 / 1 / — | OK |
| T28 | Стейк (`steak`) | `cabernet` | top3 | Белок и жир связывают танин; соль и корочка смягчают вино | CMS «Tannins love fat»; WSET (Кьянти + соль/лимон/сыр); Peyrot des Gachons 2012; Madrigal-Galan 2006 | 99 / 1 / — | OK |
| T29 | Лосось на гриле (`salmon-grilled`) | `cabernet` | avoid | Рыбий жир + танин = металл (V4) | CMS «Fish oils… hate tannins», «Certain fish + tannin = metallic»; Gaiser; Swan | 35 / 6 / V4_tannin_fish | OK |
| T30 | Лосось на гриле (`salmon-grilled`) | `white_dry` | good | Кислота любит рыбий жир, нет танина | CMS «Fish oils love acidity» | 75 / 1 / — | OK |
| T31 | Спаржа на гриле (`asparagus-grilled`) | `shiraz` | bad | Умами без соли + железо зелени → вино горькое и металлическое | Hanni (спаржа + Shiraz «bitter and acidic»); CMS (green vegetables → metallic) | 22 / 6 / V1_overpower | OK |
| T32 | Чак-чак (`chak-chak`) | `brut_sparkling` | avoid | Мёд слаще брюта: напиток кислый и тонкий (V2) | CMS «Sweets need sweets»; Wikipedia (брют + свадебный торт — классическая ошибка) | 35 / 2 / V2_dry_vs_dessert | OK |
| T33 | Чак-чак (`chak-chak`) | `milk_stout` | good | Лактоза и обжарка держат сладость мёда | Сенсорный отчёт (milk stout / сладкий сидр / десертное вино к чак-чаку); принцип P2 | 71 / 1 / — | OK |
| T34 | Чак-чак (`chak-chak`) | `port` | good | Напиток слаще десерта, интенсивность сопоставима | CMS; Alcohol Professor (pommeau ↔ crème brûlée; ice cider ↔ шоколад) | 69 / 1 / — | OK |
| T35 | Лагман острый (`lagman-spicy`) | `riesling_off_dry` | good | Остаточный сахар гасит перец, низкий алкоголь, нет танина | CMS «Spicy + sugar = no fire»; Gaiser «Spicy heat: needs residual sugar–avoid tannin!»; Haykin (сладкий сидр) | 63 / 5 / — | OK |
| T36 | Лагман острый (`lagman-spicy`) | `whisky_neat` | avoid | Этанол потенцирует TRPV1 (V3) | CMS «Alcohol + spicy = fire»; Trevisani 2002 | 35 / 1 / V3_fire | OK |
| T37 | Тако (`tacos`) | `margarita` | good | Кислота и соль против жира, лайм ↔ лайм; умеренный ABV после шейка | Death & Co (цитрусовый коктейль ↔ солёное жареное); Daily Pour (текила + лайм к тако); Marrero | 73 / 3 / — | OK |
| T38 | Начос (`nachos`) | `aperol_spritz` | good | Горечь + пузырьки режут соль и жир; низкий ABV | Glass & Note; Death & Co (Negroni ↔ солёное хрустящее) | 79 / 1 / — | OK |
| T39 | Штрудель (`strudel`) | `negroni` | bad | Сладкое глушит горечь; интенсивность не совпадает | Glass & Note (сладкий инжир ↔ спритц — анти); Marrero («sweet on sweet, bitter on bitter») | 40 / 7 / — | OK |
| T40 | Тартар из говядины (`beef-tartare`) | `cask_strength_whisky` | avoid | 58 % на сырое — «palate destruction» (V5) | The Whisky School | 26 / 3 / V1_overpower,V5_spirit_vs_delicate | OK |
| T41 | Выдержанный сыр / рокфор (`cheese-aged`) | `peated_whisky` | good | Торф ↔ солёный сыр, жир защищает рецепторы от спирта | The Whisky School (торф → рокфор; «fat… protects») | 58 / 3 / — | FAIL |
| T42 | Тёмный шоколад 70% (`dark-chocolate`) | `manhattan` | good | Горечь вермута и сухофрукт ↔ какао, сладость сопоставима | Death & Co (Manhattan ↔ dark chocolate); Whisky School (херес-каск ↔ 70 %+) | 61 / 2 / — | OK |
| T43 | Рёбрышки BBQ (`bbq-ribs`) | `cider_semi_dry` | good | Кислота и пузырьки режут жир, яблоко ↔ свинина | NW Cider; Alcohol Professor | 61 / 2 / — | OK |
| T44 | Мак-энд-чиз (`mac-and-cheese`) | `cider_dry` | good | Пузырьки и кислота смывают сливочность | NW Cider «bubbles… cut richness»; Oliver (карбонизация ↔ mouth-coating) | 76 / 1 / — | OK |
| T45 | Рамен (`ramen`) | `czech_pale_premium` | good | Соль бульона ↓ горечь, горечь ↑ умами | Papazian («umami is elevated by… salt and bitterness»); Breslin | 76 / 2 / — | OK |
| T46 | Окрошка (`okroshka`) | `kvass_sour` | top3 | Кислотность ↔ кислотность, регион, холод к холодному | tea.ru/Очаково (к окрошке — кислый, не сладкий квас); CMS «Acidity needs acidity» | 93 / 1 / — | OK |
| T47 | Бешбармак (`beshbarmak`) | `kumys` | good | Национальная классика; кислота режет жир; уровень C — калибровать дегустацией | Tatler (кумысная карта Yurta); CMS «wines… compliment the local food»; market-other-drinks-kz | 77 / 1 / — | OK |
| T48 | Лагман острый (`lagman-spicy`) | `ayran` | good | Молочный белок и холод гасят перец; регион | Nolden 2019 (молоко — лучший «гаситель»); Nasrawi 1990; deBary | 67 / 3 / — | OK |
| T49 | Лагман острый (`lagman-spicy`) | `soda_water` | bad | Сельтерская не лучше воды; CO₂ — раздражитель; блюдо топит напиток (V6) | Nolden 2019; Carstens 2002; Garneau | 44 / 1 / V6_drowned | OK |
| T50 | Самса (`samsa`) | `pale_lager_intl` | good | CO₂ и горечь режут фритюр; хлеб ↔ солод | Сенсорный отчёт; BA таблица (Carbonation balances Richness) | 68 / 16 / — | OK |
| T51 | Манты (`manty`) | `czech_pale_premium` | good | Горечь и пузырьки против жира и теста | Сенсорный отчёт; кураторская пара Efes 4/5 (Белый Медведь × манты) | 77 / 1 / — | OK |
| T52 | Картофельный салат (`kartoffelsalat`) | `cabernet` | bad | Уксус агрессивнее кислотности вина, кислота ↑ вяжущесть, мало белка | CMS «Acidity of wine must match/exceed»; Swan (уксус — враг); Kallithraka 1997 | 46 / 5 / — | OK |
| T53 | Картофельный салат (`kartoffelsalat`) | `cider_dry` | good | Кислотность сидра ≥ кислотности салата | CMS/Gaiser; NW Cider | 74 / 1 / — | OK |
| T54 | Чили кон карне (`chili-con-carne`) | `ayran` | good | Молочный белок против капсаицина | Nolden 2019; deBary (Ma Po Tofu ↔ полусладкое/сливочное) | 67 / 3 / — | OK |
| T55 | Шашлык (`shashlyk`) | `mezcal` | good | Дым мескаля ↔ уголь, жир мяса защищает от 42 % | Del Maguey (мескаль ↔ карне асада); Whisky School | 75 / 4 / — | OK |
| T56 | Шашлык (`shashlyk`) | `czech_dark` | good | Карамель/тост ↔ корочка, тело ↔ вес | Кураторская пара Efes 4/5 (Жигулёвское × шашлык «классика»); Oliver/BA (Maillard) | 71 / 10 / — | OK |
| T57 | Брецель (`pretzel`) | `na_lager` | good | Соль ↓ горечь, CO₂ утоляет — работает и без алкоголя | BA (классическая пивная закуска); Breslin & Beauchamp | 64 / 1 / — | OK |
| T58 | Бешбармак (`beshbarmak`) | `old_fashioned` | bad | В контексте трапезы 30 % коктейль — «к одному укусу»; соль + высокий алкоголь | Death & Co; Goldstein (salty foods… don't work with high alcohol) | 39 / 6 / — | OK |
| T59 | Бешбармак (`beshbarmak`) | `imperial_stout` | avoid | Imperial stout перекрикивает варёную баранину: громкость .74 против .29 (V1) | BA chart №16 «easily overpowers most main dishes»; Романовский | 35 / 22 / V1_overpower | OK |
| T60 | Бешбармак (`beshbarmak`) | `double_ipa_85` | bad | 85 IBU / 8.4 % доминируют над мягким варёным мясом, моста нет; BA ставит DIPA к брискету и баранине на гриле, а не к варёному | Hop Culture (DIPA «dominate entirely»); BA chart №5 | 57 / 19 / — | OK |
| T61 | Вайсвурст (`weisswurst`) | `dry_stout` | bad | Обжарка и громкость стаута против деликатной варёной телятины; BA ставит вайсвурст с хефевайценом | BA chart №14/17; Сахаров (лёгкие сорта — к белому мясу) | 55 / 19 / — | OK |
| T62 | Суши (нигири) (`sushi`) | `brut_sparkling` | good | Пузырьки, кислота, ноль танина к сырой рыбе | Marrero (French 75 ↔ суши); CMS «Fish oils love acidity» | 76 / 1 / — | OK |
| T63 | Курт (`kurt`) | `aperol_spritz` | good | Горечь + пузырьки к солёному; соль гасит горечь спритца | Death & Co (Negroni ↔ солёное хрустящее); Glass & Note; Breslin & Beauchamp | 64 / 3 / — | OK |
| T64 | Плов (`plov`) | `green_tea` | good | Танин чая режет жир плова; лёгкое тело чая «держится» за счёт танина (CMS-исключение); традиция зелёного чая к плову | Tidwell (World Tea News); сенсорный отчёт | 70 / 2 / — | OK |
| T65 | Стейк (`steak`) | `black_tea_strong` | good | Танин чая ↔ жир и белок стейка | Tidwell (World Tea News) | 78 / 1 / — | OK |
| T66 | Капрезе (`caprese`) | `white_dry` | good | Кислотность вина ≥ кислотности томата, лёгкое к лёгкому, нет танина | CMS «Acidity needs acidity»; Gaiser | 69 / 1 / — | OK |
| T67 | Лагман острый (`lagman-spicy`) | `lemonade_sweet` | good | Сахар гасит капсаицин (как Kool-Aid у Nolden), холодная подача | Nolden 2019; Nasrawi & Pangborn 1990 | 67 / 1 / — | OK |
| T68 | Тирамису (`tiramisu`) | `brut_sparkling` | avoid | Брют суше десерта — покажется кислым и тонким (V2) | CMS «Sweets need sweets»; Wikipedia (брют + свадебный торт) | 35 / 2 / V2_dry_vs_dessert | OK |

**Итог прототипа v2.1: 66 из 68 без калибровки (с R20); 65 из 68 без R20.**

### 7.2 Относительные (порядковые) ограничения — проверяются вместе с таблицей

| Ограничение | Источник | Прототип v2.1 |
|---|---|---|
| okroshka: `kvass_sour` > `kvass_classic` на ≥ 1 | tea.ru/Ochakovo: кислый квас > сладкий к окрошке | 93 vs 79 — OK |
| buffalo-wings: `helles` > `double_ipa_85` на ≥ 8 | панель Sam Adams: helles > DIPA-85 (обычный гость) | 71 vs 44 — OK |
| buffalo-wings: `american_ipa_45` > `helles` ≥ | панель: 45 IBU/6.5 % ↓ heat; BA IPA+curry | 80 vs 71 — OK |
| buffalo-wings: `double_ipa_85` > `helles` ≥ (heat_lover) | heat_lover переворачивает порядок (Oliver, BA, Hop Culture) | 76 vs 71 — OK |
| lagman-spicy: `ayran` > `soda_water` на ≥ 15 | Nolden 2019: молоко >> сельтерская | 67 vs 44 — OK |
| lagman-spicy: `ayran` > `lemonade_sweet` (допуск −5) | Nolden/Nasrawi: молоко ≥ сахар (−5 допуск) | 67 vs 67 — OK |
| steak: `cabernet` > `czech_pale_premium` на ≥ 1 | CMS/WSET: танин × белок | 99 vs 73 — OK |
| sushi: `rice_lager` > `brut_sparkling` на ≥ 1 | BA/Marrero | 82 vs 76 — OK |
| sushi: `brut_sparkling` > `imperial_stout` на ≥ 20 | BA chart 16 | 76 vs 15 — OK |
| beshbarmak: `czech_dark` > `dry_stout` на ≥ 1 | кураторская пара Efes 5/5; интенсивность вкуса | 76 vs 57 — OK |
| kazy: `rauchbier` > `czech_pale_premium` на ≥ 5 | Oliver: дым ↔ дым даёт раухбиру преимущество над светлым лагером | 82 vs 69 — OK |
| chak-chak: `milk_stout` > `brut_sparkling` на ≥ 15 | CMS sweets need sweets | 71 vs 35 — OK |

### 7.3 Разбор расхождений прототипа v2.1 (что это значит для калибровки)

| Пара | Прототип | Почему не прошло | Что делать |
|---|---|---|---|
| Устрицы × сухой стаут (T01) | 58, ранг 16 в пиве (51 без R20) | Стаут громче (F .54 vs .30) и тяжелее (W .41 vs .19) сырых устриц, R9 штрафует обжарку на сыром; BA сам называет пару неожиданной («who would have thought») — это признанное исключение из правила интенсивности, а не его следствие | Оставить как «классика-исключение» с бейджем R20 (+8); не поднимать бонус ради одной пары; на дегустации проверить, нужен ли мост «обжарка ↔ минеральность/бриз» (в литературе не формализован) |
| Рокфор × торфяной виски (T41) | 58, ранг 2 в крепком | R1 −11 за громкость торфа (F .65 vs .33, даже с k_loud 35), R6 −4.4 за соль × спирт (Goldstein/CMS) — против единственного источника «за» (Whisky School) | Пограничная; спор источников — на дегустацию; кандидат в R20, если сомелье Efes подтвердит |
| Вайсвурст × вайсбир без R20 (T27) | 76, ранг 4 (с R20 — 82, ранг 2) | German pils и чешский лагер получают тот же регион (+4) и больше cut; дрожжевая пряность ↔ петрушка/горчица не в словаре мостов | Норма: пара из чарта BA — ровно то, для чего существует R20 |

Что изменилось относительно первой итерации (50/58): интенсивность разведена на вес и громкость, громкий напиток теряет бонусы (`fit`),
вето V1/V6 считаются по громкости, в R3 добавлено взаимодействие горечь × спирт, десертный контраст ограничен пивом, фруктовый мост —
семейством, соль × спирт экранируется жиром/белком, обжарка балансирует сладость (таблица BA). Все восемь прежних провалов (казы × раухбир,
бешбармак × чешский тёмный, свинина × янтарный, вайсвурст × вайсбир, крылышки × DIPA, штрудель × негрони, спаржа и др.) закрыты этими правками,
а не точечными коэффициентами: например, dry stout к бешбармаку упал с 83 (№1) до 57 (ранг 18), imperial stout — под вето V1.

### 7.4 Процедура калибровки (вместо ручной подгонки)

1. Зафиксировать тест-набор: 68 пар §7.1 + 12 порядковых ограничений §7.2 + 51 кураторская пара v1 (оценка 5 → `top3`, 4 → `good`, 3 → без требования) → `data/test_pairs.json`.
2. Параметры калибровки: `base`, `k`, масштабы правил (30 в R2, 36/90 в R3, 30 в R4, 22 в R5 …), коэффициенты R1 (70/45/25) и порог `fit`, порог `burn`. **Знаки и направления не калибруются** — они из литературы.
3. Функция потерь — hinge по границам бэндов (top3 ≥ 70, good ≥ 60, bad ≤ 50, avoid ≤ 35) + hinge по порядковым ограничениям; поиск — сеточный/CMA-ES по 12–15 параметрам, leave-one-out по парам, чтобы не переобучиться.
4. Дегустация с сомелье Efes по спорным парам: IPA × острое (3 точки панели Sam Adams повторить на локальных сортах: Efes Pilsener, IPA Sigma/Auster, крепкий лагер), DIPA × чизкейк, спаржа/грибы без соли × горькое, кумыс/шубат × бешбармак/куырдак, сладкий vs кислый квас × окрошка.
5. Сбор реакций гостей в приложении («помогло / нет») → пересчёт раз в спринт.

---

## 8. Схемы данных

### 8.1 Запись напитка в каталоге (`data/drinks.json`) — JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://flavortree.kz/schemas/drink.v2.json",
  "title": "FlavorTree Drink v2",
  "type": "object",
  "required": ["id", "name", "category", "producer", "abv", "abv_source", "sensory", "vector_source", "vector_confidence", "aroma_tags", "serving", "availability_kz", "sources", "status"],
  "properties": {
    "id": {"type": "string", "pattern": "^[a-z0-9-]+$"},
    "name": {"type": "string"},
    "display_name": {"type": "string"},
    "name_en": {"type": "string"},
    "category": {"enum": ["beer", "na_beer", "radler", "cider", "wine", "sparkling", "fortified", "cocktail", "spirit", "liqueur", "kvass", "lemonade", "soda", "dairy", "tea", "coffee", "water"]},
    "style": {
      "type": "object",
      "properties": {
        "archetype": {"type": "string", "description": "id стилевого приора из §2.4 (czech_pale_premium, cider_dry, aperol_spritz …)"},
        "bjcp_code": {"type": "string", "description": "например 3B, 21A, C1A (cider)"},
        "name": {"type": "string"},
        "family": {"type": "string", "description": "группа для диверсификации выдачи (LAGER, WHEAT, IPA, STOUT, CIDER, WHITE, RED, SOUR_COCKTAIL …)"}
      },
      "required": ["archetype", "family"]
    },
    "producer": {
      "type": "object",
      "required": ["name", "country"],
      "properties": {
        "name": {"type": "string"},
        "group": {"type": "string", "description": "Anadolu Efes, Carlsberg Group, Plzeňský Prazdroj, Diageo …"},
        "country": {"type": "string", "description": "ISO 3166-1 alpha-2 страны производства"},
        "region": {"type": "string"},
        "license_origin": {"type": "string", "description": "страна бренда при лицензионном розливе (Kozel: CZ, розлив KZ/RU)"}
      }
    },
    "efes_relation": {"enum": ["own", "distribution", "cci", "none"], "description": "own — собственный бренд Efes KZ; distribution — в дистрибуции; cci — Coca-Cola İçecek (Anadolu Efes); none — конкурент"},
    "abv": {"type": "number", "minimum": 0, "maximum": 75},
    "abv_source": {"enum": ["label", "producer_site", "retailer", "bjcp_midpoint", "recipe_calc", "estimate"]},
    "abv_after_dilution": {"type": "number", "description": "коктейли: ABV в бокале после льда/шейка; используется движком вместо abv"},
    "ibu": {"type": ["number", "null"]},
    "ibu_source": {"enum": ["producer", "retailer", "bjcp_midpoint", "estimate", "none"]},
    "og": {"type": ["number", "null"]}, "fg": {"type": ["number", "null"]}, "srm": {"type": ["number", "null"]},
    "residual_sugar_g_l": {"type": ["number", "null"], "description": "остаточный сахар; для лимонадов/кваса — углеводы с этикетки ×10"},
    "ph": {"type": ["number", "null"]}, "titratable_acidity_g_l": {"type": ["number", "null"]},
    "co2_volumes": {"type": ["number", "null"]},
    "recipe": {
      "type": "array",
      "description": "коктейли: ингредиенты для расчёта ABV/сахара/кислоты",
      "items": {"type": "object", "required": ["ingredient", "ml"], "properties": {"ingredient": {"type": "string"}, "ml": {"type": "number"}, "abv": {"type": "number"}, "sugar_g_per_100ml": {"type": "number"}, "acid_pct": {"type": "number"}}}
    },
    "dilution_pct": {"type": "number", "description": "оценка дилюции: stirred ≈ 20–25, shaken ≈ 50–60 (не верифицировано — измерить)"},
    "sensory": {
      "type": "object",
      "required": ["sweet", "acid", "bitter", "tannin", "carbonation", "alcohol", "body", "dairy", "salt", "umami", "aroma_intensity", "roast", "smoke", "serve_temp"],
      "properties": {
        "sweet": {"type": "number", "minimum": 0, "maximum": 1}, "acid": {"type": "number", "minimum": 0, "maximum": 1},
        "bitter": {"type": "number", "minimum": 0, "maximum": 1}, "tannin": {"type": "number", "minimum": 0, "maximum": 1},
        "carbonation": {"type": "number", "minimum": 0, "maximum": 1}, "alcohol": {"type": "number", "minimum": 0, "maximum": 1},
        "body": {"type": "number", "minimum": 0, "maximum": 1}, "dairy": {"type": "number", "minimum": 0, "maximum": 1},
        "salt": {"type": "number", "minimum": 0, "maximum": 1}, "umami": {"type": "number", "minimum": 0, "maximum": 1},
        "aroma_intensity": {"type": "number", "minimum": 0, "maximum": 1}, "roast": {"type": "number", "minimum": 0, "maximum": 1},
        "smoke": {"type": "number", "minimum": 0, "maximum": 1},
        "serve_temp": {"type": "number", "minimum": -5, "maximum": 95, "description": "°C, середина рекомендуемого диапазона"}
      },
      "additionalProperties": false
    },
    "vector_source": {"enum": ["measured", "label_derived", "bjcp_prior", "category_prior", "expert_tasting", "sommelier_override"]},
    "vector_confidence": {"type": "number", "minimum": 0, "maximum": 1},
    "vector_override": {"type": "object", "additionalProperties": {"type": "number", "minimum": 0, "maximum": 1}, "description": "ручная правка сомелье по осям — приоритет над расчётом"},
    "pyramid": {"type": "array", "description": "пивная пирамида v1 (TOP/HEART/BASE, note_id, intensity 1–10) — сохраняется для ароматики и UI",
      "items": {"type": "object", "required": ["layer", "note_id", "intensity"], "properties": {"layer": {"enum": ["TOP", "HEART", "BASE"]}, "note_id": {"type": "string"}, "intensity": {"type": "integer", "minimum": 1, "maximum": 10}, "sommelier_note": {"type": "string"}}}},
    "aroma_tags": {
      "type": "object",
      "propertyNames": {"enum": ["citrus", "tropical_fruit", "stone_fruit", "orchard_fruit", "red_fruit", "dark_fruit", "banana", "clove", "pepper", "herbal", "floral", "pine_resin", "grass", "bread", "grain", "biscuit", "toast", "caramel", "honey", "nutty", "chocolate", "coffee", "roast", "smoke", "oak_vanilla", "dairy_cream", "sour_lactic", "mint", "cucumber", "brine", "mineral", "warm_spice", "anise", "juniper", "agave", "bitter_orange", "char", "cured", "yeast", "rice", "wheat", "cherry", "warmth"]},
      "additionalProperties": {"type": "number", "minimum": 0, "maximum": 1}
    },
    "serving": {
      "type": "object",
      "required": ["temp_min_c", "temp_max_c"],
      "properties": {"temp_min_c": {"type": "number"}, "temp_max_c": {"type": "number"}, "glass": {"type": "string"}, "garnish": {"type": "string"}, "ice": {"enum": ["none", "cubes", "crushed", "large_cube"]}, "portion_ml": {"type": "number"}, "seasonality": {"type": "string"}}
    },
    "occasions": {"type": "array", "items": {"enum": ["meal", "aperitif", "dessert", "hot", "evening", "party", "gourmet", "non_alcoholic"]}},
    "origin_affinity": {"type": "array", "items": {"enum": ["kazakh", "central_asian", "uyghur", "russian", "caucasian", "turkish", "german", "czech", "belgian", "english", "irish", "french", "italian", "spanish", "japanese", "chinese", "korean", "indian", "thai", "mexican", "american", "international"]}},
    "price_kzt": {
      "type": "object",
      "properties": {"retail_min": {"type": "number"}, "retail_max": {"type": "number"}, "horeca": {"type": "number"}, "unit_ml": {"type": "number"}, "as_of": {"type": "string", "format": "date"}, "source": {"type": "string"}, "is_estimate": {"type": "boolean"}}
    },
    "availability_kz": {
      "type": "object",
      "required": ["level", "last_checked"],
      "properties": {
        "level": {"enum": ["wide", "horeca", "import", "niche", "unknown", "not_confirmed"]},
        "channels": {"type": "array", "items": {"type": "string"}, "description": "kaspi, arbuz, alco24, elitalco, magnum, bar_menu:<venue>"},
        "cities": {"type": "array", "items": {"type": "string"}},
        "last_checked": {"type": "string", "format": "date"},
        "note": {"type": "string"}
      }
    },
    "flags": {
      "type": "object",
      "properties": {"non_alcoholic": {"type": "boolean"}, "contains_dairy": {"type": "boolean"}, "contains_gluten": {"type": "boolean"}, "nitro": {"type": "boolean"}, "labeled_as": {"type": "string", "description": "юридическая категория на этикетке в KZ, например «пивной напиток» (Somersby)"}}
    },
    "sources": {
      "type": "array", "minItems": 1,
      "items": {"type": "object", "required": ["url", "what"], "properties": {"url": {"type": "string", "format": "uri"}, "title": {"type": "string"}, "accessed": {"type": "string", "format": "date"}, "what": {"type": "array", "items": {"enum": ["abv", "ibu", "price", "availability", "tasting_notes", "style", "sugar", "acidity", "co2", "recipe"]}}}}
    },
    "image": {"type": "string"}, "accent": {"type": "string"}, "description": {"type": "string"}, "tagline": {"type": "string"},
    "status": {"enum": ["draft", "auto", "reviewed", "published"]},
    "reviewed_by": {"type": "string"},
    "updated_at": {"type": "string", "format": "date-time"}
  },
  "additionalProperties": false
}
```

Примеры записей:

```json
{"id": "efes-pilsener", "name": "Efes Pilsener", "category": "beer",
 "style": {"archetype": "pale_lager_intl", "bjcp_code": "2A", "name": "International Pale Lager", "family": "LAGER"},
 "producer": {"name": "Efes Kazakhstan", "group": "Anadolu Efes", "country": "KZ", "license_origin": "TR"}, "efes_relation": "own",
 "abv": 5.0, "abv_source": "label", "ibu": null, "ibu_source": "bjcp_midpoint",
 "sensory": {"sweet": 0.2, "acid": 0.25, "bitter": 0.22, "tannin": 0.02, "carbonation": 0.6, "alcohol": 0.125, "body": 0.35, "dairy": 0, "salt": 0, "umami": 0, "aroma_intensity": 0.35, "roast": 0, "smoke": 0, "serve_temp": 5},
 "vector_source": "bjcp_prior", "vector_confidence": 0.7,
 "aroma_tags": {"grain": 0.5, "bread": 0.3, "herbal": 0.3, "citrus": 0.2},
 "serving": {"temp_min_c": 4, "temp_max_c": 7, "glass": "пилснер"}, "occasions": ["meal", "hot", "party"], "origin_affinity": ["kazakh", "international"],
 "price_kzt": {"retail_min": 285, "retail_max": 449, "unit_ml": 500, "as_of": "2026-09-18", "source": "alco24.kz / arbuz.kz"},
 "availability_kz": {"level": "wide", "channels": ["kaspi", "arbuz", "alco24"], "last_checked": "2026-09-18"},
 "flags": {"non_alcoholic": false, "contains_gluten": true},
 "sources": [{"url": "https://alco24.kz/c/pivo/fabricator/efes-kazahstan", "what": ["abv", "price", "availability"], "accessed": "2026-09-18"}],
 "status": "auto"}
```
```json
{"id": "issyk-wild-dry-cider", "name": "ISSYK Wild Kazakh Cider сухой", "category": "cider",
 "style": {"archetype": "cider_dry", "bjcp_code": "C1A", "name": "New World Cider, dry", "family": "CIDER"},
 "producer": {"name": "ISSYK", "country": "KZ"}, "efes_relation": "none",
 "abv": 5.7, "abv_source": "retailer", "residual_sugar_g_l": null,
 "sensory": {"sweet": 0.1, "acid": 0.75, "bitter": 0.1, "tannin": 0.3, "carbonation": 0.7, "alcohol": 0.14, "body": 0.35, "dairy": 0, "salt": 0, "umami": 0, "aroma_intensity": 0.5, "roast": 0, "smoke": 0, "serve_temp": 7},
 "vector_source": "category_prior", "vector_confidence": 0.5, "aroma_tags": {"orchard_fruit": 1, "sour_lactic": 0.2},
 "serving": {"temp_min_c": 6, "temp_max_c": 9}, "occasions": ["meal", "aperitif", "hot"], "origin_affinity": ["kazakh"],
 "availability_kz": {"level": "wide", "channels": ["kaspi"], "last_checked": "2026-09-18"},
 "sources": [{"url": "https://kaspi.kz/shop/p/issyk-wild-kazakh-cider-sidr-suhoi-jabloko-5-7-0-45-l-119675159/", "what": ["abv", "availability"], "accessed": "2026-09-18"}],
 "status": "auto"}
```
```json
{"id": "aperol-spritz", "name": "Aperol Spritz", "category": "cocktail",
 "style": {"archetype": "aperol_spritz", "name": "Spritz (low-ABV aperitivo)", "family": "SPRITZ"},
 "producer": {"name": "барная классика", "country": "IT"}, "efes_relation": "none",
 "abv": 9.0, "abv_source": "recipe_calc", "abv_after_dilution": 8.0, "dilution_pct": 15,
 "recipe": [{"ingredient": "Aperol", "ml": 60, "abv": 11, "sugar_g_per_100ml": 24}, {"ingredient": "Prosecco brut", "ml": 90, "abv": 11, "sugar_g_per_100ml": 1}, {"ingredient": "содовая", "ml": 30, "abv": 0}],
 "sensory": {"sweet": 0.5, "acid": 0.5, "bitter": 0.45, "tannin": 0.05, "carbonation": 0.7, "alcohol": 0.2, "body": 0.35, "dairy": 0, "salt": 0, "umami": 0, "aroma_intensity": 0.7, "roast": 0, "smoke": 0, "serve_temp": 3},
 "vector_source": "expert_tasting", "vector_confidence": 0.6, "aroma_tags": {"bitter_orange": 0.8, "citrus": 0.9, "herbal": 0.5},
 "serving": {"temp_min_c": 2, "temp_max_c": 5, "glass": "винный бокал", "ice": "cubes", "garnish": "апельсин"}, "occasions": ["aperitif", "hot", "party"], "origin_affinity": ["italian"],
 "price_kzt": {"horeca": 5800, "unit_ml": 180, "as_of": "2026-09-18", "source": "restolife.kz (меню)", "is_estimate": false},
 "availability_kz": {"level": "wide", "channels": ["bar_menu:Alberto Bar"], "last_checked": "2026-09-18"},
 "sources": [{"url": "https://alberto.kz/menyu/napitki/koktejli", "what": ["price"], "accessed": "2026-09-18"}],
 "status": "auto"}
```
```json
{"id": "kumys", "name": "Кумыс (қымыз)", "category": "dairy",
 "style": {"archetype": "kumys", "name": "ферментированное кобылье молоко", "family": "FERMENTED_DAIRY"},
 "producer": {"name": "фермерские хозяйства (Боз бие и др.)", "country": "KZ"}, "efes_relation": "none",
 "abv": 1.5, "abv_source": "estimate", "ph": null,
 "sensory": {"sweet": 0.1, "acid": 0.8, "bitter": 0.05, "tannin": 0, "carbonation": 0.3, "alcohol": 0.04, "body": 0.3, "dairy": 0.4, "salt": 0.05, "umami": 0.1, "aroma_intensity": 0.5, "roast": 0, "smoke": 0, "serve_temp": 6},
 "vector_source": "category_prior", "vector_confidence": 0.5, "aroma_tags": {"sour_lactic": 1, "dairy_cream": 0.5, "yeast": 0.5},
 "serving": {"temp_min_c": 4, "temp_max_c": 8, "glass": "пиала"}, "occasions": ["meal", "non_alcoholic", "hot"], "origin_affinity": ["kazakh", "central_asian"],
 "price_kzt": {"retail_min": 1000, "retail_max": 1500, "unit_ml": 1000, "as_of": "2025-03-21", "source": "inform.kz"},
 "availability_kz": {"level": "wide", "channels": ["farm_brands", "bar_menu:Yurta"], "last_checked": "2026-09-18", "note": "производство падает: 2 500 т (2023) → 1 100 т (2025)"},
 "flags": {"non_alcoholic": false, "contains_dairy": true, "labeled_as": "кисломолочный продукт"},
 "sources": [{"url": "https://www.inform.kz/ru/skolko-stoyat-kumis-i-shubat-v-gorodah-kazahstana-a83153", "what": ["price"], "accessed": "2026-09-18"}, {"url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC12652487/", "what": ["abv", "acidity"], "accessed": "2026-09-18"}],
 "status": "draft"}
```

Примечание к `flags.non_alcoholic`: кумыс (0.6–3 % v/v) и квас (≤ 1.2 % по ГОСТ) **не** проходят фильтр `non_alcoholic` при пороге 0.5 % — порог выносится в конфиг
(`non_alcoholic_max_abv`, по умолчанию 0.5; для «традиционные напитки» — 1.5).

### 8.2 Запись блюда (`data/dishes.json`) — дельта к v1

Добавляются: `vector` — 16 осей §3.1 (вместо 13; `spice` удаляется, `heat` остаётся, добавляются `protein pungent fish_oil green_iron`), `cook_method`, `protein_source`,
`sauce`, `acid_type`, `serve_temp`, `texture[]`, `is_dessert`, `heat_level`, `cuisine` (enum вместо строки «KZ»), `tags` — словарь `{tag: weight}` (вместо списка),
`vector_source` (`manual` / `auto_from_fields`), `sources[]` (для новых блюд — откуда рецептура/классификация). Существующие поля (`dominant_taste`, `weight`, `fat_level`, `cooking_method`,
`synonyms`, `emoji`, `description`) сохраняются.

### 8.3 Правила наполнения каталога 100+ пива / 200+ напитков

- Источники записей: `docs/research/market-beer-kz.md` (213 позиций: 192 пива, 12 б/а, 3 сидра, 5 пивных напитков, 1 квас; ABV подтверждён для 159, IBU — для 24) и
  `docs/research/market-other-drinks-kz.md` (212: сидры 23, б/а пиво 15, радлеры 6, квас 8, вина 32, игристые 3, вермуты 5, коктейли 36, крепкое 53, национальные/чай/кофе 31).
- Конвейер `scripts/build_catalog_v2.py`: строка таблицы → `style.archetype` (маппинг BJCP-стиль → архетип §2.4) → приор → якоря из ABV/IBU/RS → `vector_source`
  (`label_derived` если есть ABV+IBU/RS; иначе `bjcp_prior`/`category_prior`) → `availability_kz`, `price_kzt`, `sources` из таблицы → `status: auto`.
- Ничего не публикуется без `sources[]` и `availability_kz.level`; позиции с уровнем `not_confirmed` не показываются гостю, но участвуют в тестах.
- Сомелье в админке видит только `auto`-записи с `vector_confidence < 0.6` и правит через `vector_override` (десятки, а не сотни правок).

---

## 9. План внедрения (3 недели до финала OneIdea)

| Неделя | Что | Артефакты |
|---|---|---|
| 1 | Модель данных v2 (`drinks.json`, `style_priors_v2.json`, `dishes.json` v2, `test_pairs.json`, `classic_pairs.json`); конвейер каталога из двух market-отчётов; движок v2 на Python (`backend/api/pairing/engine_v2.py`) по §4 с прототипа; golden | 300+ напитков `status: auto`; 80+ блюд; `engine_golden_v2.py` |
| 2 | TS-порт (`frontend/src/app/engine/pairing-engine-v2.ts`) с паритетом (`_fsum`, `floor(x·100+.5)/100`); UI: вкладки категорий, диверсификация, объяснения ATE с бейджами A–D, предупреждения/вето, температура подачи; анкета профиля (3 вопроса) и DNA v2 | `npm run test:engine` 0 расхождений; Cypress/скриншоты |
| 3 | Калибровка §7.4 (подгонка масштабов по тест-набору), дегустация с сомелье Efes по спорным парам, правка приоров локальных сортов (Efes Pilsener, Карагандинское, Kozel, Белый Медведь, Хмельной Лось, Wùkōng Jū), демо-сценарии для жюри (бешбармак, лагман, казы, чак-чак — каждый с пивом, сидром/вином, коктейлем и безалкогольным вариантом) | отчёт калибровки; `PAIRING_ENGINE_V2.md` для жюри |

Обратная совместимость: v1 остаётся за флагом до прохождения golden v2; API отдаёт `engine_version`.

---

## 10. Открытые вопросы и что не подтверждено

1. **Все числовые коэффициенты — наша калибровка.** Единственные измеренные величины: TRPV1 42→34 °C, «10 % сахароза ≈ молоко при 5 °C», молоко > сладкое > газировка/вода (Nolden), соль ↓ горечь, жир ↔ вяжущесть, +100 % сладости/горечи при 20→36 °C, BJCP vital statistics, пороги сахара EU/BJCP, ГОСТ на квас.
2. **IPA × острое** — спор в литературе (BA/Herz/Oliver «за», панель Sam Adams/Alcohol Professor «против»). Движок держит порядок helles > DIPA для обычного гостя и переворачивает его для `heat_lover`; величину разрыва решать дегустацией.
3. **DIPA × чизкейк/морковный торт** (BA) против сенсорного правила «сладкое ужесточает напиток» — включено как контраст-ветка с флагом `dessert_contrast`.
4. **Умами без соли → «металл»** (Hanni) против лабораторного «MSG в смеси ↓ горечь» — правило условное; проверить на грибах/яйце/спарже с местным IPA.
5. **Кумыс/айран/шубат**: нет верифицированных значений pH/кислотности/жира для KZ-продуктов (диапазоны — из обзора по кумысу; TS 3810 для айрана не найден) — измерить в трёх образцах (pH-метр, рефрактометр) — стоимость нулевая.
6. **Квас**: сахар г/л — только с этикетки; «сладкий vs кислый» — один источник (tea.ru/Очаково), оформлено как порядковое ограничение, не как жёсткий бэнд.
7. **Коктейли**: ABV после дилюции и сахар — расчёт по рецепту с оценочной дилюцией; целевые значения Дейва Арнольда в вебе не найдены — не закладывать, измерить.
8. **Somersby в KZ маркируется «пивной напиток»** (солодовая основа, 4 %) — в каталоге `category: cider`, `flags.labeled_as` обязателен; вопрос к юристам, как показывать гостю.
9. **Аромат-мосты (R12)** для казахской кухни не валидированы (Ahn 2011 не покрывает Среднюю Азию) — потолок +8 и роль объяснения; при появлении данных гостей — пересмотреть.
10. **Температурное восприятие (R18)** — экстраполяция Green & Frankmann на 4–20 °C — выключено до дегустации.
11. **«Сильный сыр / вяленое» как исключение из громкости**: по BA imperial stout «stands up to foie gras, smoked goose», barley wine — «best with strong cheese», поэтому для казы/жая/рокфора k_loud и `fit` смягчены; imperial stout к казы (82, ранг 3) стоит рядом с раухбиром (82, ранг 2) — оба в топ-3. Порядок между ними литература не задаёт — решать дегустацией.
11a. **Соль × танин**: CMS («Salt… softens tannins») и Гайзер («exacerbates tannin») противоречат друг другу — член `tann` в R6 оставлен с половинным весом, помечен contested.
11b. **Веса композитов W/F** (§2.2, §3.1) и множитель `fit` — наша калибровка; направление (вес ↔ вес, громкость ↔ громкость, «громкий напиток хуже тихого») — из CMS/BA/Goldstein, числа — нет.
11c. **Семантика `heat_lover`**: движок трактует флаг как «усиление остроты желательно» (снимает 85 % штрафа R3 и V3) — DIPA к крылышкам для такого гостя становится 76 против 71 у хеллеса. Проверить формулировку вопроса анкеты на первых гостях.
12. **Личный профиль**: доли Vinotype (25/50/25) — из книги Ханни, не из KZ-выборки; анкету валидировать на первых 200 гостях.
13. Не загружено: Food52 (Master Cicerone, 403), TS 3810 (айран), полный текст Clark 2011 (Springer cookie-wall; CO₂ ↓ сладость — по аннотации из поиска), Nature 1997 (только метаданные). BJCP 4A/3D — теперь проверены (§1), приоры helles/czech_dark обновлены.
14. **Устрицы × сухой стаут и рокфор × торфяной виски** остаются на 58 (порог good — 60): первое — признанное BA исключение из правила интенсивности, второе — единственный источник против Goldstein/CMS. Не подгонять коэффициенты под две пары; проверить на дегустации.

---

## 11. Источники (проверены по URL 18.09.2026 — см. §1, какие именно перепроверены в последней сессии, если не указано иное)

1. BJCP 2021 Style Guidelines — 1A American Light Lager https://www.bjcp.org/style/2021/1/1A/american-light-lager/ ; 2A International Pale Lager https://www.bjcp.org/style/2021/2/2A/international-pale-lager/ ; 3B Czech Premium Pale Lager https://www.bjcp.org/style/2021/3/3B/czech-premium-pale-lager/ ; 3D Czech Dark Lager https://www.bjcp.org/style/2021/3/3D/czech-dark-lager/ (проверено 2026-09-18) ; 4A Munich Helles https://www.bjcp.org/style/2021/4/4A/munich-helles/ (проверено 2026-09-18) ; 5D German Pils https://www.bjcp.org/style/2021/5/5D/german-pils/ ; 6B Rauchbier https://www.bjcp.org/style/2021/6/6B/rauchbier/ ; 10A Weissbier https://www.bjcp.org/style/2021/10/10A/weissbier/ ; 15B Irish Stout https://www.bjcp.org/style/2021/15/15B/irish-stout/ ; 20C Imperial Stout https://www.bjcp.org/style/2021/20/20C/imperial-stout/ ; 21A American IPA https://www.bjcp.org/style/2021/21/21A/american-ipa/ ; 22A Double IPA https://www.bjcp.org/style/2021/22/22A/double-ipa/ ; 22C American Barleywine https://www.bjcp.org/style/2021/22/22C/american-barleywine/ ; 24A Witbier https://www.bjcp.org/style/2021/24/24A/witbier/
2. BJCP, Introduction to Cider Guidelines (sweetness/carbonation definitions) https://www.bjcp.org/beer-styles/introduction-to-cider-guidelines/
3. Brewers Association, *American Craft Beer and Food: Perfect Companions* (PDF, hosted by Cicerone) https://www.cicerone.org/sites/default/files/resources/Beer_and_Food_English.pdf
4. Court of Master Sommeliers Europe, *Food and Wine Matching* (PDF) https://courtofmastersommeliers.org/wp-content/uploads/2022/11/Food-and-Wine-1.pdf
5. Trevisani M. et al. Ethanol elicits and potentiates nociceptor responses via the vanilloid receptor-1. *Nat Neurosci* 5:546 (2002). https://pubmed.ncbi.nlm.nih.gov/11992116/
6. Nasrawi C.W., Pangborn R.M. Temporal effectiveness of mouth-rinsing on capsaicin mouth-burn. *Physiol Behav* 47:617 (1990). https://pubmed.ncbi.nlm.nih.gov/2385629/
7. Nolden A.A., Lenart G., Hayes J.E. Putting out the fire — Efficacy of common beverages in reducing oral burn from capsaicin. *Physiol Behav* 208:112557 (2019). https://pubmed.ncbi.nlm.nih.gov/31121171/ (абстракты 5–9 получены через PubMed E-utilities: https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=11992116,2385629,31121171,23058798,9177340,8788095&rettype=abstract&retmode=text)
8. Breslin P.A.S., Beauchamp G.K. Suppression of bitterness by sodium: variation among bitter taste stimuli. *Chem Senses* 20:609 (1995). https://pubmed.ncbi.nlm.nih.gov/8788095/ ; Salt enhances flavour by suppressing bitterness. *Nature* 387:563 (1997). https://pubmed.ncbi.nlm.nih.gov/9177340/
9. Peyrot des Gachons C. … Breslin P.A.S. Opponency of astringent and fat sensations. *Curr Biol* 22:R829 (2012). https://pubmed.ncbi.nlm.nih.gov/23058798/
10. Madrigal-Galan B., Heymann H. Sensory Effects of Consuming Cheese Prior to Evaluating Red Wine Flavor. *Am J Enol Vitic* 57:12 (2006). https://www.ajevonline.org/content/57/1/12 (аннотация через Semantic Scholar)
11. Kallithraka S., Bakker J., Clifford M.N. Red wine and model wine astringency as affected by malic and lactic acid. *J Food Sci* 62 (1997). https://ift.onlinelibrary.wiley.com/doi/10.1111/j.1365-2621.1997.tb04016.x (только метаданные)
12. Eschevins A., Giboreau A., Julien P., Dacremont C. From expert knowledge and sensory science to a general model of food and beverage pairing with wine and beer. *IJGFS* 17:100144 (2019). https://doi.org/10.1016/j.ijgfs.2019.100144 (аннотация: https://api.semanticscholar.org/graph/v1/paper/DOI:10.1016/j.ijgfs.2019.100144?fields=title,abstract,year,authors,venue)
13. NCBI Bookshelf NBK236241 — Heat as a Factor in the Perception of Taste, Smell, and Oral Sensation (Green & Frankmann; Green 1986). https://www.ncbi.nlm.nih.gov/books/NBK236241/
14. Garneau N. Science Says You're Wrong About Pairing IPAs and Spicy Foods. CraftBeer.com. https://www.craftbeer.com/beer-and-food/science-says-youre-wrong-about-pairing-ipas-and-spicy-foods
15. Garrett Oliver, «food pairing», *Oxford Companion to Beer* (Craft Beer & Brewing). https://www.beerandbrewing.com/dictionary/9jYnWqXy1G
16. WSET. Four essential rules to master food and wine pairing (2023). https://www.wsetglobal.com/knowledge-centre/blog/2023/july/13/four-rules-to-masterful-food-and-wine-pairing ; Ideal serving temperatures (2022). https://www.wsetglobal.com/knowledge-centre/blog/2022/april/26/ideal-serving-temperatures-and-top-tips-for-wine-storage
17. Tim Gaiser MS. Food and Wine Pairing in Less Than 500 Words. https://timgaiser.com/wine-blog/food-and-wine-pairing-in-less-than-500-words/
18. IntoWine. Revolutionary Pairing Theory Developed by Rebel Master of Wine Tim Hanni. https://www.intowine.com/revolutionary-pairing-theory-developed-rebel-master-wine-tim-hanni
19. Northwest Cider Association. Cider Pairings. https://www.nwcider.com/cider-pairings/
20. Alcohol Professor. How to Pair Hard Cider and Food. https://www.alcoholprofessor.com/blog-posts/how-to-pair-hard-cider-and-food
21. Brew Your Own. Appropriate Carbonation Levels. https://byo.com/mr-wizard/appropriate-carbonation-levels/
22. Wikipedia. Sweetness of wine (EU Reg. 753/2002, 607/2009). https://en.wikipedia.org/wiki/Sweetness_of_wine ; Acids in wine. https://en.wikipedia.org/wiki/Acids_in_wine
23. ГОСТ 31494-2012 Квасы. Общие технические условия. https://allgosts.ru/67/160/gost_31494-2012
24. Shokrollahi B. et al. Koumiss (Fermented Mare's Milk) as a Functional Food. *Foods* 14(22):3954 (2025). https://pmc.ncbi.nlm.nih.gov/articles/PMC12652487/ ; ScienceDirect Topics «Kumis» (диапазоны состава — по поисковой выдержке). https://www.sciencedirect.com/topics/agricultural-and-biological-sciences/kumis
25. Внутренние отчёты Flavor Tree (с собственными списками источников): `docs/research/lit-beer-pairing.md`, `docs/research/lit-wine-cider-cocktail-pairing.md`, `docs/research/lit-sensory-science.md`, `docs/research/market-beer-kz.md`, `docs/research/market-other-drinks-kz.md`. Через них цитируются (в этой сессии не перезагружались): Mosher (Cheese Professor, Flavor Fever), Cicerone «Exam Tactics», Herz, Papazian, Storton, Hastings, Alcohol Professor (hot sauce), Death & Co, Marrero, Glass & Note, The Whisky School, Del Maguey / Daily Pour, deBary, Tidwell, tea.ru (квас), pivoman, Романовский, Сахаров, Ahn 2011, Spence 2020, Carstens 2002, Di Salle 2013, Nolden & Hayes 2016, Lanier 2005, Goldstein, Page & Dornenburg / Swan.

Прототип формул и генератор таблиц §2.4/§7: `docs/research/engine_v2_prototype.py` (запуск: `python3 docs/research/engine_v2_prototype.py`).

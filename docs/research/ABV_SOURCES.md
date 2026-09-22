# ABV 17 сортов — источники и статус проверки

**Дата доступа ко всем ссылкам: 2026-09-18.** Рынок — Казахстан (розлив Efes Kazakhstan, а не импорт и не Россия).
Значения живут в `scripts/build_data.py` (`BRANDS_EXTRA`, поля `abv` / `abv_estimated`) → `data/brands.json` → `frontend/api/_data/brands.json`. Руками JSON не правим.

## 1. Итог

| | Было | Стало |
|---|---|---|
| `abv_estimated: false` (подтверждено) | 2 | **11** |
| `abv_estimated: true` (оценка, в интерфейсе со звёздочкой `4.0%*`) | 15 | **6** |
| Изменено значений ABV | — | 7 (Кружка Свежего, Белый Медведь, Miller, Bremen, Bavaria, Карагандинское, Старый мельник) |

Влияние на движок: **нет**. `python3 scripts/engine_golden.py` дал побайтно тот же `data/golden_scores.json` — у всех затронутых лагеров ось `alcohol` определяется приором стиля (0,25–0,30), а «пол» от ABV `(abv − 3,5) / 5` ниже него. Паритет Python ↔ TypeScript: 0 расхождений.

## 2. Правило решения

- Флаг снимаем (`false`), **только если** есть авторитетный источник (производитель / текст этикетки) **или** совпали минимум два независимых ритейлера рынка КЗ.
- Если данные слабее, но лучше прежнего допущения — число правим, флаг `true` оставляем.
- Иначе не трогаем.

Пометки у ссылок: **[открыта]** — страница открыта 2026-09-18, значение прочитано с неё; **[индекс]** — значение видно в заголовке карточки в поисковой выдаче, сама страница в этот день не открылась (404 / 403 / таймаут). Alco24 и Elitalco считаем **одним** источником (одинаковый каталог и формат названий).

## 3. Таблица по сортам

| # | Сорт (id) | Было | Стало | Флаг `abv_estimated` | Уверенность |
|---|---|---|---|---|---|
| 1 | Кружка Свежего (`kruzhka-svezhego`) | 4,4* | **4,0** | true → **false** | высокая |
| 2 | Белый Медведь (`belyi-medved`) — вариант «Светлое» | 5,0* | **4,8** | true → **false** | высокая |
| 3 | Efes Pilsener (`efes-pilsener`) | 5,0 | 5,0 | false (без изменений) | высокая |
| 4 | Miller Genuine Draft (`miller-genuine-draft`) — розлив КЗ | 4,7* | **4,4** | true → **false** | высокая |
| 5 | Velkopopovický Kozel (`kozel`) | 4,0* | 4,0* | true (без изменений) | низкая — источники расходятся |
| 6 | Bremen von Lustig (`bremen-von-lustig`) | 4,9* | **4,0** | true → **false** | высокая |
| 7 | Bavaria (`bavaria`) — розлив КЗ | 5,0* | **4,9** | true → **false** | высокая |
| 8 | Wùkōng Jū (`wukong-ju`) | 4,0* | 4,0 | true → **false** | высокая |
| 9 | Карагандинское (`karagandinskoe`) — вариант «Светлое» | 4,8* | **4,6** | true → **false** | высокая |
| 10 | Slavna ПРАГА (`slavna-praga`) | 4,5* | 4,5 | true → **false** | средняя–высокая |
| 11 | Жигулевское (`zhigulevskoe`) — «Разливное» Efes KZ | 4,5* | 4,5 | true → **false** | средняя–высокая |
| 12 | Хмельной Лось (`khmelnoy-los`) | 7,3 | 7,3 | false (без изменений) | высокая |
| 13 | Северное Сияние (`severnoe-siyanie`) — кег | 4,5* | 4,5* | true (без изменений) | нет данных |
| 14 | Легенда 777 (`legenda-777`) — кег | 4,7* | 4,7* | true (без изменений) | нет данных |
| 15 | 13 регион (`13-region`) — кег | 4,5* | 4,5* | true (без изменений) | нет данных |
| 16 | Старый мельник из бочонка (`stary-melnik`) — кег | 4,3* | **3,9*** | true (без изменений) | низкая — по фасованному «Мягкому» |
| 17 | Бочковое (`bochkovoe`) — кег | 4,6* | 4,6* | true (без изменений) | нет данных |

## 4. Источники по каждому сорту

### 1. Кружка Свежего — 4,0 %
- Kaspi, 0,5 л ж/б: «Крепость 4», страна — Казахстан, стиль — лагер. **[открыта]** https://kaspi.kz/shop/p/kruzhka-svezhego-pivo-fil-trovannoe-svetloe-4-0-5-l-102201889/
- MagnumOpt, 0,45 л ж/б «Мягкое», 4 %, Казахстан. **[открыта]** https://magnumopt.kz/catalog/product/258719-pivo-0-45l-4-svetloe-pasterizovannoe-myagkoe-kruzhka-svezhego-zh-b/
- Alco24: «Кружка Свежего Мягкое 4% Glass (0,475L)». **[открыта]** https://alco24.kz/c/pivo/fabricator/efes-kazahstan/
- BeerTasting (Kruzhka Svezhego Myagkoe 4,0 %) **[открыта]** https://www.beertasting.com/en/brewery/efes-kazakhstan/beers ; Pint Please (4 %) **[открыта]** https://pintplease.com/en/brewery/23044/efes_kazakhstan
- Других светлых вариантов в КЗ не найдено (есть фруктовые Hit 3,6 % и 0.0).

### 2. Белый Медведь — 4,8 % (вариант «Светлое», флагман бренда)
- Kaspi, 0,5 л стекло: «Крепость 4.8», Казахстан. **[открыта]** https://kaspi.kz/shop/p/belyi-medved-pivo-svetloe-4-8-0-5-l-102034500/
- MagnumOpt, 0,45 л ж/б, 4,8 %, Казахстан. **[открыта]** https://magnumopt.kz/catalog/product/258706-pivo-0-45l-4-8-svetloe-pasterizovannoe-belyy-medved-zh-b/
- ТС «Меркурий», розлив: «Пиво набор Белый Медведь, Светлое 4,8% 1л». **[открыта]** https://tsmerkury.kz/catalog/pivo-na-rozliv_1/
- BeerTasting и Pint Please — 4,8 % **[открыты]** (ссылки выше).
- Другие варианты бренда: «Мягкое», «Особое», «в розлив» — 4,5 %; «Крепкое» — 7,2 %. В каталоге Flavor Tree сорт записан без варианта — принят флагман «Светлое».

### 3. Efes Pilsener — 5,0 % (проверка ранее подтверждённого)
- Kaspi, 0,9 л ж/б: «Крепость 5», Казахстан, состав: вода, солод ячменный светлый, крупа рисовая, хмель. **[открыта]** https://kaspi.kz/shop/p/efes-kazakhstan-pivo-fil-trovannoe-svetloe-5-0-9-l-101557104/
- Alco24: «EFES 5% Can (0,45L)», «EFES 5% Glass (0,5L)». **[открыта]** https://alco24.kz/c/pivo/fabricator/efes-kazahstan/

### 4. Miller Genuine Draft — 4,4 % (розлив Казахстан)
- Kaspi, 0,45 л ж/б: «Крепость 4.4», страна — Казахстан, «экстрактивность начального сусла 11,3%», состав: «вода питьевая, солод пивоваренный ячменный, патока крахмальная, хмелепродукты» (данные уровня этикетки). **[открыта]** https://kaspi.kz/shop/p/pivo-miller-genuine-draft-fil-trovannoe-svetloe-4-4-0-45-l-101606800/
- MagnumOpt, 0,45 л ж/б, 4,4 %, Казахстан («MILLER GENUINE DRAFT СЫРА 4,4% 0,45Л Ж/Б»). **[открыта]** https://magnumopt.kz/catalog/product/255935-pivo-0-45l-4-4-svetloe-pasterizovannoe-genuine-draft-miller-zh-b/
- MagnumOpt, 0,33 л бутылка, 4,4 %, Казахстан. **[индекс]** https://magnumopt.kz/catalog/product/51856-pivo-0-33l-4-4-svetloe-pasterizovannoe-genuine-draft-miller-but/
- Противоречие: Alco24 пишет «Miller Genuine Draft 4,7% Glass (0,33L / 0,5L)» **[открыта]** https://alco24.kz/c/pivo/fabricator/efes-kazahstan/ — это международное значение (импортная чешская банка продаётся отдельно: https://winestyle.kz/products/Miller-Genuine-Draft-Czechia-in-can.html **[индекс]**). Для портфеля Efes KZ берём локальный розлив — 4,4 %.

### 5. Velkopopovický Kozel (светлый) — оставлено 4,0 %*, флаг не снят
- Kaspi, 0,45 л ж/б: «Крепость 3.9», страна — Казахстан, состав с карамельным солодом, 35 ккал, срок 270 дней. **[открыта]** https://kaspi.kz/shop/p/velkopopovicky-kozel-pivo-svetloe-3-9-0-45-l-101556904/
- Elitalco, 0,5 л ж/б: «Крепость: 4%», «Регион: Казахстан», «Производитель: Эфес Казахстан». **[открыта]** https://newelitalco.kz/ru/catalog/kozel-velkopopovicky-svetly-4-can-05l_66 ; то же в Alco24 («Kozel Velkopopovicky Svetly 4% Can (0,5L)») **[открыта]** https://alco24.kz/c/pivo/fabricator/efes-kazahstan/
- Newxo, 0,45 л ж/б: «Крепость: 4,5%» — выброс. **[открыта]** https://newxo.kz/product/velkopopovicky-kozel-svetlyy-045-l
- Наблюдение: по тёмному Kozel Elitalco/Alco24 показывают 3,8 % (чешское значение), а Kaspi, MagnumOpt и Fix Price KZ — 3,6 % для розлива КЗ (https://fix-price.kz/ru/catalog/produkty-i-napitki/p-1431162-pivo-ozel-tmnoe-36-045-l **[индекс]**). Похоже, Elitalco ставит международные цифры, и реальное значение светлого в КЗ — 3,9 %. Но это один источник против одного → число не меняем, ждём этикетку.

### 6. Bremen von Lustig — 4,0 %
- Kaspi, «BREMEN Premium… 4% 0.45 л»: «Крепость 4», Казахстан, состав: вода, солод ячменный светлый, ячмень пивоваренный, хмель. **[открыта]** https://kaspi.kz/shop/p/bremen-premium-pivo-fil-trovannoe-svetloe-4-0-45-l-102228743/
- Kaspi, «BREMEN пиво светлое 4% 0.45 л». **[индекс]** https://kaspi.kz/shop/p/bremen-pivo-svetloe-4-0-45-l-101557311/
- MagnumOpt, «Пиво Bremen Premium Светлое 4% 0,5л с/б (Казахстан)». **[индекс]** (таймаут) https://magnumopt.kz/catalog/product/302727-pivo-bremen-premium-svetloe-4-0-5l-s-b/
- Обзор с цитатой этикетки: производитель АО ИП «Эфес Казахстан», «алк. не менее 4,0 % об.» (2020). **[открыта]** https://etc.pretich.com/bremen-pivo-iz-kz/
- BeerTasting: Bremen Premium 4,0 %. **[открыта]** https://www.beertasting.com/en/brewery/efes-kazakhstan/beers
- Связка названия «Bremen» ↔ «Von Lustig»: карточки «Пиво BREMEN, Von Lustig мультипак 0,45л*4шт» (https://tsmerkury.kz/product/pivo-bremen-von-lustig-multipak-0-45l-4sht/ **[индекс]**, 404) и заметка https://www.inside-getraenke.de/nachrichten/detail/news/im-kuehlschrank-bremen-von-lustig **[индекс]**. Российский «Бремен разливное 4,7 %» — другой продукт, не переносим.

### 7. Bavaria — 4,9 % (розлив Казахстан)
- Kaspi, «Bavaria Holland… 4.9% 0.5 л» стекло: «Крепость 4.9», страна — Казахстан. **[открыта]** https://kaspi.kz/shop/p/bavaria-pivo-fil-trovannoe-svetloe-4-9-0-5-l-102034476/
- Alco24: «Bavaria 4,9% Can (0,5L)». **[открыта]** https://alco24.kz/c/pivo/fabricator/efes-kazahstan/
- MagnumOpt, 0,45 л ж/б, 4,9 %, Казахстан. **[индекс]** (404) https://magnumopt.kz/catalog/product/271527-pivo-0-45l-4-9-svetloe-pasterizovannoe-bavaria-zh-b/

### 8. Wùkōng Jū — 4,0 %
- Kaspi, «Wukong JU Chinese classic пиво светлое 4% 0.45 л»: «Крепость 4», Казахстан, состав: вода, солод ячменный светлый, рис, хмель, хмелепродукты. **[открыта]** https://kaspi.kz/shop/p/wukong-ju-pivo-svetloe-4-0-45-l-142311781/
- ТС «Меркурий», «Пиво Wukong Ju, 4%, 0,5л. ж/б»: «Крепость: 4», Казахстан. **[открыта]** https://tsmerkury.kz/product/pivo-wukong-ju-4-0-5l-zh-b/
- Pint Please — 4 %. **[открыта]** https://pintplease.com/en/brewery/23044/efes_kazakhstan

### 9. Карагандинское — 4,6 % (вариант «Светлое»)
- «Семейный» (Семей), «Пиво Карагандинское светлое 4,6% 0,45л ж/б». **[открыта]** https://semeiniy.kz/pivo-karagandinskoe-svetloe-4-6-0-45l-zh-b/
- ТС «Меркурий», розлив: «Пиво набор Карагандинское, светлое 4,6% 1л». **[открыта]** https://tsmerkury.kz/catalog/pivo-na-rozliv_1/
- Pint Please: Karagandinskoe Svetloe 4,6 %. **[открыта]** https://pintplease.com/en/brewery/23044/efes_kazakhstan
- Fix Price: «Пиво "Карагандинское", 4,6%, 0,45 л». **[индекс]** (403) https://fix-price.com/catalog/produkty-i-napitki/p-1431151-pivo-karagandinskoe-46-045-l
- Retail Content Service, 0,9 л ж/б 4,6 %, штрихкод 4870003986191. **[индекс]** https://retailcontentservice.com/product/4870003986191-kz-pivo-efes-karagandinskoe-svetloe-46-09l-zhb
- Другие варианты бренда: Light 4,4 %, «Крепкое» 6,5 %.

### 10. Slavna ПРАГА — 4,5 %
- Kaspi, «Slavna Pivnice Большая Прага пиво светлое 4.5% 0.65 л»: «Крепость 4.5», Казахстан; описание совпадает с нашим («Золотистый благородный цвет, сбалансированный вкус хмеля и солода»). **[открыта]** https://kaspi.kz/shop/p/slavna-pivnice-bol-shaja-praga-pivo-svetloe-4-5-0-65-l-103600471/
- MagnumOpt, «Пиво Slavna Большая Прага Светлое 4,5% 0,65 с/б (Казахстан)». **[индекс]** (404) https://magnumopt.kz/catalog/product/307485-pivo-slavna-bolshaya-praga-svetloe-4-5-0-65-s-b/
- ТС «Меркурий», карточка «…praga-bolshaya-svetloe-4-5-0-65l-st-b». **[индекс]** (404) https://tsmerkury.kz/product/pivo-slavna-pivnice-praga-bolshaya-svetloe-4-5-0-65l-st-b/
- Не путать: «Прага Светлое 4% 0,45л с/б» на MagnumOpt (https://magnumopt.kz/catalog/product/301430-pivo-praga-svetloe-4-0-45l-s-b/ **[открыта]**) — бренд «Прага» другого производителя (в розливе ТС «Меркурий» идёт как «ARASAN, Прага Светлое»); «Slavna Pivnice Большая Прага крепкое» — 7,5 %.
- Уверенность «средняя–высокая»: второй ритейлер виден только по заголовку в индексе.

### 11. Жигулевское — 4,5 % («Жигулевское Разливное» Efes Kazakhstan)
- Kaspi, «Жигулевское на розлив пиво светлое 4.5% 0.45 л» ж/б: «Крепость 4.5», Казахстан. **[открыта]** https://kaspi.kz/shop/p/zhigulevskoe-na-rozliv-pivo-svetloe-4-5-0-45-l-101593399/
- MagnumOpt, «…4.5% Светлое Пастеризованное Разливное Жигулевское ж/б (Казахстан)», 0,45 и 0,9 л. **[индекс]** (404) https://magnumopt.kz/catalog/product/259284-pivo-0-45l-4-5-svetloe-pasterizovannoe-razlivnoe-zhigulevskoe-zh-b/ , https://magnumopt.kz/catalog/product/255500-pivo-0-9l-4-5-svetloe-pasterizovannoe-razlivnoe-zhigulevskoe-zh-b/
- BeerTasting (Zhigulevskoe Razlivnoe 4,5 %) и Pint Please (4,5 %). **[открыты]**
- Выбросы: Kaspi, «Жигулевское Разливное 4.6% 0.5 л» стекло, производитель не указан **[открыта]** https://kaspi.kz/shop/p/zhigulevskoe-razlivnoe-pivo-svetloe-4-6-0-5-l-102096503/ ; агрегатор rus-beer.ru показывает «5» **[открыта]** https://rus-beer.ru/beer/78276_zhigulevskoe_razlivnoe/ . «Жигулевское» в КЗ варят многие заводы — сверить, что в каталоге именно SKU Efes.

### 12. Хмельной Лось — 7,3 % (проверка ранее подтверждённого)
- Kaspi, 0,45 л ж/б: «Крепость 7.3», Казахстан. **[открыта]** https://kaspi.kz/shop/p/hmel-noi-los-pivo-svetloe-krepkoe-7-3-0-45-l-102098188/
- BeerTasting и Pint Please — 7,3 %. **[открыты]** MagnumOpt (https://magnumopt.kz/catalog/product/253363-pivo-0-45l-7-3-svetloe-pasterizovannoe-krepkoe-khmelnoy-los-zh-b/) и mela.kz — 7,3 %. **[индекс]**

### 13–15, 17. Северное Сияние, Легенда 777, 13 регион, Бочковое — без изменений
Разливные HoReCa-сорта: в рознице, маркетплейсах, на Untappd / BeerTasting / Pint Please значений нет. Единственная найденная карточка — «Пиво Легенда 777 кега разливное» (https://astykzhan.kz/catalog/alkogol/pivo-slaboalkogolnye-napitki/pivo/pivo-razlivnoe/pivo-legenda-777-kega-razlivnoe/) — не открылась и ABV в заголовке не содержит. Российское «Жигулевское Бочковое» (Efes Rus) — другой продукт, на «Бочковое» не переносим. Значения остаются допущением от стиля.

### 16. Старый мельник из бочонка — 4,3 %* → 3,9 %* (флаг оставлен)
- «Семейный», «Пиво Старый мельник мягкое 3,9% 0,45л ж/б». **[открыта]** https://semeiniy.kz/pivo-staryy-melnik-myagkoe-3-9-0-45l-zh-b/
- MagnumOpt, «Пиво 0.45л 3.9% Светлое Пастеризованное из Бочонка Мягкое Старый Мельник Бут (Казахстан)». **[индекс]** https://magnumopt.kz/catalog/product/255689-pivo-0-45l-3-9-svetloe-pasterizovannoe-iz-bochonka-myagkoe-staryy-melnik-but/
- mela.kz, «Старый Мельник из Бочонка мягкое светлое бутылочное 3,9% 0,45л». **[индекс]** https://mela.kz/index.php?product_id=1110&route=product%2Fproduct
- Противоречие: instashop Караганда, «Старый мельник из бочонка мягкое 4,3% 0,5л» **[индекс]** (карточка снята) — 4,3 % это российская этикетка (Перекрёсток, Лента).
- Логика: прежние 4,3 % были взяты с российского «Мягкого»; фасованное «Мягкое» розлива КЗ — 3,9 %, это ближе к нашему рынку. Но в каталоге стоит **кеговый** сорт, а разлив может отличаться от бутылки (у «Белого Медведя»: бутылка 4,8 %, «в розлив» 4,5 %) → флаг `true` остаётся.

## 5. Ограничения проверки

- **efeskazakhstan.kz** закрыт возрастным гейтом «21+» с вводом даты рождения. Вымышленную дату я не вводил — официальные карточки не прочитаны. Владелец проекта может открыть их сам (по поисковой выдаче: `/brands/13/` — Карагандинское, `/brands/14/` — Slavná Pivnice, `/brands/18/` — Miller Genuine Draft, `/brands/43/` — вероятно Старый мельник; `/brands/8/`, `/brands/9/`, `/brands/17/` всплывали в поиске по Wùkōng Jū, Белому Медведю и Кружке Свежего).
- **MagnumOpt**: 4 карточки открылись, затем сайт стал отдавать 404 на все товарные страницы — такие ссылки помечены **[индекс]**.
- **Untappd** отдаёт 403; arbuz.kz в выдаче по этим сортам не появился.
- Ритейлеры иногда ставят международный ABV на локальный розлив (Alco24/Elitalco: Miller 4,7 %, Kozel тёмный 3,8 %) — поэтому приоритет у карточек с данными этикетки (состав, экстрактивность, страна «Казахстан»).

## 6. Что подтвердить на дегустации с сомелье Efes

1. **Velkopopovický Kozel светлый, розлив КЗ** — на этикетке 3,9 % или 4,0 %? (Kaspi 3,9 против Elitalco 4,0.)
2. **Старый мельник из бочонка, кег** — ABV разливной версии (фасованное «Мягкое» КЗ — 3,9 %; российское — 4,3 %) и какой именно вариант идёт в HoReCa.
3. **Северное Сияние, кег** — ABV (сейчас 4,5 %* от стиля).
4. **Легенда 777, кег** — ABV (сейчас 4,7 %* от стиля).
5. **13 регион, кег** — ABV (сейчас 4,5 %* от стиля).
6. **Бочковое, кег** — ABV (сейчас 4,6 %* от стиля).
7. **Белый Медведь** — подтвердить, что в каталоге Flavor Tree имеется в виду «Светлое» 4,8 %, а не «Мягкое» / «в розлив» 4,5 %.
8. **Карагандинское** — подтвердить вариант «Светлое» 4,6 % (а не Light 4,4 %).
9. **Miller Genuine Draft** — сверить этикетку локального розлива: 4,4 % (Alco24 показывает 4,7 %).
10. **Жигулевское** — сверить этикетку SKU Efes: 4,5 % (на Kaspi есть стеклянная 0,5 л с 4,6 %).
11. **Slavna ПРАГА** — сверить этикетку 0,65 л: 4,5 %, и ABV кеговой версии, если в HoReCa идёт она.
12. Попросить у Efes Kazakhstan **официальный продуктовый лист** (ABV, экстрактивность, IBU) на все 17 сортов — он закрывает пункты 1–11 разом и даёт IBU для оси горечи.

После дегустации: поправить `abv` / `abv_estimated` в `scripts/build_data.py`, затем `python3 scripts/build_data.py && python3 scripts/engine_golden.py`, `cd frontend && node scripts/sync-data.mjs && npm run test:engine`, `cd backend && .venv/bin/python -m unittest api.tests.test_engine && .venv/bin/python manage.py load_flavor_data`.

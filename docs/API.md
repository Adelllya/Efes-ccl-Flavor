# Flavor Tree API v2

База: `/api/`. Все ответы JSON.

## Доступ

| Контур | Что входит | Как авторизоваться |
|---|---|---|
| Публичный | подбор, DNA, чтение справочников, `/api/menu/<slug>/`, `/api/track/`, `/api/leads/`, `/api/ai/` | не нужно |
| Кабинет заведения | `/api/cabinet/*` (кроме `register` и `login`) | `Authorization: Bearer <api_token>` — токен из ответа `register` / `login`; см. [SAAS.md](SAAS.md) |
| Сомелье (служебный) | `/api/admin/*`, `/api/seed/`, запись в `/api/brands/` и `/api/flavor-notes/` | токен `FT_ADMIN_TOKEN` или вход сотрудника Django |

Токен кабинета и токен сомелье — разные контуры: токен заведения в служебный API не пускает.

### Служебный API сомелье

Реализация — `backend/api/auth.py` (`IsSommelierAdmin`, декоратор `@sommelier_only`). Пускает, если выполнено одно из двух:

* в запросе есть токен, равный переменной окружения `FT_ADMIN_TOKEN`: заголовок `Authorization: Bearer <token>`
  **или** `X-Admin-Token: <token>` (сравнение за постоянное время, `hmac.compare_digest`; в query-строке токен не принимается);
* запрос идёт от вошедшего сотрудника Django (`is_staff`, сессия из `/admin/`).

| Ситуация | Ответ |
|---|---|
| учётных данных нет | `401` + `WWW-Authenticate: Bearer realm="flavor-tree-admin"` |
| токен не подошёл, чужая схема (`Basic`), вошёл не сотрудник | `403` |
| `FT_ADMIN_TOKEN` не задан, `DEBUG=False` | `403` всем, кроме сотрудника Django — служебный API закрыт |
| `FT_ADMIN_TOKEN` не задан, `DEBUG=True` | пускает всех, в лог пишется предупреждение (локальное демо работает без настройки) |

Тело отказа: `{ "detail": "…" }`. Браузерный preflight (`OPTIONS`) токена не требует; оба заголовка разрешены в CORS.

```bash
# сгенерировать токен и положить в backend/.env → FT_ADMIN_TOKEN=…
python -c "import secrets; print(secrets.token_urlsafe(32))"

curl -X PUT http://127.0.0.1:8000/api/admin/flavor-profiles/ \
  -H "Authorization: Bearer $FT_ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"brand_id": "<uuid>", "notes": [{"flavor_note_id": "<uuid>", "layer": "TOP", "intensity": 7}]}'
```

Панель сомелье во фронтенде (`/admin`) при `401/403` показывает поле токена, хранит его в `sessionStorage`
(`ft.adminToken`, до закрытия вкладки) и шлёт как `Authorization: Bearer`. Без API (`FT_API_URL` пуст) панель работает как раньше.

Переменные окружения бэкенда — в [BACKEND_DOCUMENTATION.md](../BACKEND_DOCUMENTATION.md#переменные-окружения-env) и `backend/.env.example`.

## Движок подбора v2 (`/api/v2/…`)

Все категории напитков (412 позиций), вкладки категорий, объяснения с уровнем доказательности. Реализация —
`backend/api/views_engine_v2.py`, движок — [PAIRING_ENGINE_V2.md](PAIRING_ENGINE_V2.md). Баллы от бренда не зависят;
политика Efes (порядок при разнице ≤ 2 баллов) описана в каждом ответе подбора в поле `policy.note`.

| Метод и адрес | Что делает |
|---|---|
| `GET /api/v2/meta/` | версия движка и калибровки, оси, категории с числом напитков, политика Efes |
| `GET /api/v2/drinks/?category=beer,cider&q=kozel&efes=1&limit=50&offset=0` | каталог; у каждой позиции `in_pairing` — участвует ли в подборе (черновики и неподтверждённые — нет) |
| `GET /api/v2/drinks/<id>/?top=8` | карточка: полная запись (откуда числа, источники), вектор, W/F, профиль стиля, лучшие блюда |
| `GET /api/v2/dishes/?q=&cuisine=kazakh` | блюда v2 (114) |
| `GET /api/v2/pairing/dish/<id>/` | подбор к блюду: `items` (топ с диверсификацией), `categories` (вкладки, по 3 лучших), `best_partner` (лучший Efes с честным баллом), `policy` |
| `POST /api/v2/pairing/recommend/` | то же для своего блюда: `{"dish": {"name", "vector": {16 осей}, "cook_method", "protein_source", "sauce", "acid_type", "is_dessert", "cuisine"}, "context": {…}}` или `{"dish_id": "…"}` |
| `GET /api/v2/pairing/explain/?drink=&dish=` | полный разбор одной пары по правилам (mechanisms, reasons, warnings, vetoes, W/F) |

Контекст (query или `context` в теле): `occasion` = `meal | aperitif | dessert | hot | evening | party | gourmet | non_alcoholic`,
`bitter_pref` и `sweet_pref` от −1 до 1, `heat_lover=1`, `harsh_tol` = `sensitive | median | tolerant`, `non_alcoholic=1`,
`categories=wine,tea`, `top` (0 — весь список без диверсификации), `venue=<slug>` — только напитки из карты заведения
(позиции карты могут ссылаться на id напитка v2 или на slug сорта v1 — он переводится через `legacy_brand_id`).
`locale=kk|en` — объяснения, вердикты и подписи на казахском / английском ([ENGINE_TEXTS.md](ENGINE_TEXTS.md)); напитки, порядок и баллы от языка не зависят (это проверяет тест).

Пример ответа `GET /api/v2/pairing/dish/beshbarmak/` (сокращён):

```json
{
  "engine": "2.2.1", "calibration": "cal-2026-09-23",
  "dish": {"id": "beshbarmak", "name": "Бешбармак", "cuisine": ["kazakh"]},
  "items": [
    {"drink_id": "…", "score": 83, "band_label": "Отличное сочетание", "match_type": "cut", "secondary_type": "bridge",
     "efes_partner": true, "reasons": [{"rule": "R2", "evidence": "C", "text": "Хмелевая горечь режет жирность баранины…"}],
     "warnings": [], "drink": {"name": "…", "category": "beer", "abv": 7.3, "vector_confidence": 0.51, "in_pairing": true}}
  ],
  "best_partner": null,
  "categories": [{"category": "wine", "label": "Вино", "n": 27, "best": {"…": "…"}, "items": ["…"]}],
  "policy": {"partner_tie_window": 2, "note": "Баллы честные и не зависят от бренда. Если напитки отличаются не более чем на 2 балла, первым показывается напиток из портфеля Efes."}
}
```

## Отзывы гостей (`/api/v2/reviews/…`)

Подробно — [REVIEWS.md](REVIEWS.md): что храним и чего не храним, как считаются средние, как отзывы попадают в калибровку.

| Метод и адрес | Доступ | Что делает |
|---|---|---|
| `POST /api/v2/reviews/` | публичный, лимиты | оценка пары 1–5, метки, текст; одна оценка на пару с устройства (повтор обновляет); в ответе — `applied_prefs` (что поменять в профиле гостя) и свежая сводка по паре |
| `GET /api/v2/reviews/pair/?drink=&dish=` | публичный | сводка по паре (сглаженное среднее, показывается от 3 оценок) и последние опубликованные тексты |
| `GET /api/v2/reviews/drink/<id>/` | публичный | сводка по напитку со всеми блюдами |
| `GET /api/cabinet/reviews/?days=30` | кабинет | отзывы в заведении, слабые пары, частые метки |
| `GET /api/v2/reviews/moderation/`, `POST /api/v2/reviews/<uuid>/moderate/` | сомелье | очередь модерации и решение по отзыву |

## Движок подбора v1 (17 сортов Efes, остаётся для совместимости)

### `POST /api/pairing/recommend/`
```json
{ "dish_id": "beshbarmak",             // или "dish": { "name": "...", "vector": { "heat": 0.8, ... }, "tags": [...] }
  "context": { "occasion": "hot", "bitter_pref": 0.5, "dna": { "bitter": 0.8, ... } },
  "limit": 5, "venue": "efes-beer-garden-almaty", "diversify": true }
```
Ответ: `{ dish, dish_vector, context, engine, results: [ { beer_id, dish_id, score, verdict, match_type, match_label,
reasons[], warnings[], contributions[], sommelier_pick, curated, intensity, confidence, beer{…}, beer_vector } ] }`

### `GET /api/pairing/dish/<slug>/?occasion=hot&bitter_pref=-1&limit=5&venue=<slug>` — то же, GET-форма.
### `GET /api/pairing/beer/<slug>/dishes/?limit=6` — обратный подбор + `similar` (похожие сорта по косинусу).
### `POST /api/pairing/explain/` `{ beer_id, dish_id, context }` — полный разбор одной пары.
### `GET /api/engine/meta/` — версия, оси, описание правил, архетипы DNA.

## Flavor DNA
### `POST /api/dna/` `{ "ratings": [ { "beer_id": "efes-pilsener", "rating": "love" } ] }`
→ `{ vector, archetype: { id, name, emoji, tagline, similarity }, top: [ { beer_id, similarity } ] }`.
Рейтинги: `love | like | meh | dislike`.

## HoReCa
* `GET /api/venues/`, `GET /api/venues/<slug>/` — заведение, сорта в наличии, меню, число столов.
* `GET /api/qr/<token>/` — разрешает токен стола (`EBG-05`), увеличивает `scans_count`, отдаёт заведение.
* `POST /api/qr-generate/` `{ "venue": "<slug>", "tables": 12, "prefix": "EBG" }` — генерирует токены столов.
  Пока без авторизации (унаследованный эндпоинт из `views_engine.py`); столы заведений SaaS создаются через `/api/cabinet/tables/`.

## Справочники (DRF ViewSets, пагинация `page_size`)
* `GET /api/brands/` (фильтры `style`, `packaging_type`, `is_horeca_only`, `q`; сортировка `ordering`), `GET /api/brands/<uuid>/` (с пирамидой), `GET /api/brands/<uuid>/pyramid/`.
* `GET /api/flavor-notes/` (`category=TOP|HEART|BASE`, `off_flavour`), `GET /api/flavor-notes/<uuid>/brands/`.
* Запись в эти два справочника — `POST/PUT/PATCH/DELETE /api/brands/…`, `POST /api/brands/<uuid>/upload-image/`, `POST/PUT/PATCH/DELETE /api/flavor-notes/…` — **только сомелье** (см. «Доступ»). Чтение открыто.
* `GET /api/dishes/` (`cuisine`, `dominant_taste`, `weight`, `fat_level`, `q`), `GET /api/pairings/` (кураторские).
* `GET /api/courses/`, `GET /api/team/`, `GET /api/landing/`, `GET /api/health/`.
* `POST /api/seed/` — перезаливка из `data/*.json`, **только сомелье**: перезаписывает сорта и пирамиды. `GET` оставлен для совместимости и закрыт так же.

## Админка сомелье
Все эндпоинты раздела требуют токен сомелье или сессию сотрудника (см. «Доступ»), включая `GET`.
* `GET/POST /api/admin/brands/`
* `PUT /api/admin/flavor-profiles/` `{ brand_id, notes: [ { flavor_note_id, layer, intensity, sommelier_note } ] }` — заменить пирамиду целиком.
* `PUT /api/admin/serving-recommendations/`, `POST/PATCH/DELETE /api/admin/flavor-notes/`.

## Пример
```bash
curl -s "http://127.0.0.1:8000/api/pairing/dish/kazy/?limit=3&occasion=hot" | jq '.results[] | {score, beer: .beer.display_name, match_type, why: .reasons[0].text}'
```

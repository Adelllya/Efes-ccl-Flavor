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

## Движок подбора

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

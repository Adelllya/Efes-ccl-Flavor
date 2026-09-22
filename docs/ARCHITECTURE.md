# Архитектура Flavor Tree v2

```
Efes-ccl-Flavor/
├── data/                      ← ЕДИНЫЙ ИСТОЧНИК ПРАВДЫ (JSON): ноты, сорта+пирамиды, блюда, кураторские пары,
│                                 приоры стилей, курсы, академия, факты, команда, заведения, golden движка
├── scripts/
│   ├── build_data.py          ← генерирует data/*.json из CSV-фикстур + справочников (ноты→оси, векторы блюд…)
│   └── engine_golden.py       ← golden-матрица 17×50 + метрики калибровки
├── backend/                   ← Django 4.2 + DRF (Python 3.10+, SQLite локально / PostgreSQL на проде)
│   ├── api/pairing/           ← движок: engine.py (чистый Python), dataset.py, adapters.py (ORM→движок), cli.py
│   ├── api/views_engine.py    ← /api/pairing/*, /api/dna/, /api/venues/, /api/qr/*
│   ├── api/management/commands/load_flavor_data.py ← загрузка data/*.json в БД (идемпотентно)
│   └── api/tests/test_engine.py
├── frontend/                  ← Angular 18 standalone + signals + router, PWA-манифест
│   ├── src/app/engine/pairing-engine.ts   ← ТОТ ЖЕ движок на TypeScript (паритет по golden)
│   ├── src/app/core/          ← data / pairing / progress (XP) / dna / venue / theme сервисы
│   ├── src/app/ui/            ← icon, score-ring, radar, flavor-glass, flavor-tree, beer/dish/match-card
│   ├── src/app/pages/         ← home, pair (+results), beers (+detail), dishes, academy (+lesson), dna, qr, admin, about
│   └── scripts/               ← engine-parity.mjs, screenshots.mjs
└── docs/                      ← PAIRING_ENGINE, ARCHITECTURE, API, MOBILE_DESIGN, screenshots/
```

## Ключевое решение: движок живёт в двух местах, данные — в одном

* **Офлайн-first.** Vercel-демо (`efes-ccl.vercel.app`) — это только фронтенд. Поэтому SPA импортирует `data/*.json`
  напрямую (esbuild бандлит JSON) и считает подбор в браузере за миллисекунды. Нет бэкенда — нет проблем.
* **API для интеграций.** Django отдаёт тот же результат для QR-меню заведений, Telegram-бота, партнёров:
  `POST /api/pairing/recommend/`. Алгоритм — тот же файл-близнец на Python.
* **Паритет гарантирован тестом.** `scripts/engine_golden.py` фиксирует 850 пар + профили + контекстные кейсы;
  `npm run test:engine` компилирует TS-движок и сверяет. Любое расхождение = красный тест.
* **Сомелье правит в одном месте.** Панель сомелье (`/admin`) меняет пирамиду локально с живым пересчётом;
  при подключённом API (`window.FT_API_URL`) сохраняет через `PUT /api/admin/flavor-profiles/`;
  без API — экспортирует JSON сорта для `data/brands.json`. `DataService.syncFromApi()` подтягивает правки
  из БД при старте SPA, если API задан.

## Поток данных

```
CSV фикстуры + справочники ──build_data.py──► data/*.json ──┬──► Angular (import JSON) ──► TS-движок ──► UI
                                                            └──► load_flavor_data ──► Django ORM ──► adapters ──► Py-движок ──► API
```

## Фронтенд

* **Роутинг:** lazy standalone-страницы, `withComponentInputBinding` (параметры маршрута и query → `input()`),
  `withViewTransitions` (плавные переходы, как в нативных приложениях), scroll-to-top.
* **Состояние:** только Angular signals. `DataService` держит данные, `computed()` пересчитывает профили движка
  при любой правке (админка). Персистентность — `localStorage` (XP, DNA, тема) и `sessionStorage` (стол заведения).
* **Без регистрации.** Всё персональное — локально в браузере гостя. Это осознанный zero-friction.
* **Дизайн-система:** `src/styles.css` — токены (свет/тьма), утилиты, компоненты. Шрифты Outfit / Plus Jakarta Sans / Fraunces.
* **Мобильный shell:** нижняя панель вкладок, safe-area, `100dvh`, сетки схлопываются в 1 колонку. См. `MOBILE_DESIGN.md`.

## Бэкенд

* Модели v2: `Brand` (+slug, style_family, abv_estimated, origin, tagline, accent, vector_override),
  `Dish` (+slug, emoji, vector, tags, synonyms), `FlavorNote` (+slug, axes, tags),
  `Venue` (+slug, city, brands M2M, menu_dishes M2M), `QRCode`, `AnonymousSession`.
* Миграция `0006_flavor_tree_v2`. Настройки БД: `DATABASE_URL` → PostgreSQL, иначе `DB_NAME`, иначе SQLite.
* `EngineContext` собирает профили из БД на запрос (17×50 — дёшево; при росте каталога — кеш на 5 минут).

## Тесты

| Что | Команда |
|---|---|
| Движок (30 тестов) | `cd backend && .venv/bin/python -m unittest api.tests.test_engine` |
| Паритет TS↔Py | `cd frontend && npm run test:engine` |
| Сборка SPA | `cd frontend && npm run build` |
| Скриншоты mobile+desktop | `cd frontend && npm run shots` → `docs/screenshots/` |
| Django | `cd backend && .venv/bin/python manage.py check` |

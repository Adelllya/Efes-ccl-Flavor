# Flavor Tree для заведений — SaaS-слой

Бар платит за: своё QR/NFC-меню с их ценами, подбор пива только из их карты, стоп-лист в один клик и аналитику «сколько ₸ принёс подбор».

## Роли и экраны

| Кто | Где | Что делает |
|---|---|---|
| Гость | `/m/<slug>/<стол>` | Сканирует QR или прикладывает телефон к NFC-метке → меню заведения с ценами → нажимает блюдо → 3 сорта с кранов → «Заказать». Кнопка «Сфотографировать блюдо» и чат сомелье — в контексте карты заведения. |
| Владелец | `/cabinet` | Вход/регистрация (14 дней пробного без карты). Вкладки: **Обзор** (эффект в ₸, сканы, конверсия, топ связок), **Меню и цены** (каталог → своя карта, цены, стоп-лист, хиты), **Столы и QR** (генерация, печать A6, запись NFC с Android), **Настройки** (брендинг, Wi-Fi, контакты). |
| Продажи | `/business` | Лендинг: боль → решение → калькулятор окупаемости → тарифы → заявка. |
| Админ | Django admin | Аккаунты, продление подписки, воронка заявок (`Lead`), события. |

## Тарифы (`frontend/src/app/core/saas.models.ts` = `VenueAccount.PLAN_LIMITS`)

| Тариф | ₸/мес | Столы | Позиции | История | Брендинг |
|---|---|---|---|---|---|
| Пробный | 0 (14 дней) | 5 | 40 | 14 дн | — |
| Старт | 14 900 | 15 | 80 | 60 дн | ✓ |
| Про | 34 900 | 60 | 300 | 365 дн | ✓ |
| Сеть | 89 000 | ∞ | ∞ | 3 года | ✓ + API/выгрузка |

## Модели (`backend/api/models.py`)

`VenueAccount` (email, пароль-хеш, тариф, `trial_ends_at`/`paid_until`, `api_token`) · `Venue` (+ `accent`, `cover_url`, `wifi_password`, `menu_headline`, …) · `VenueMenuItem` (kind BEER/DISH, `ref_slug` каталога, `price`, `volume`, `is_available`, `is_featured`) · `QRCode` (+ `label`, `last_scan_at`) · `ScanEvent` · `MenuEvent` (DISH_VIEW / PAIR_VIEW / BEER_VIEW / ORDER_INTENT с ценой) · `Lead` (воронка NEW → WON).

## API (`backend/api/views_saas.py`)

Публичное: `GET /api/menu/<slug>/?table=5` · `POST /api/track/` · `POST /api/leads/`
Кабинет (`Authorization: Bearer <api_token>`): `POST /api/cabinet/register/` · `POST /api/cabinet/login/` · `GET /api/cabinet/overview/` · `PATCH /api/cabinet/venue/` · `GET|POST /api/cabinet/menu/` · `DELETE /api/cabinet/menu/<id>/` · `GET|POST /api/cabinet/tables/` · `DELETE /api/cabinet/tables/<id>/` · `GET /api/cabinet/stats/?days=30`

Подписка неактивна → публичное меню отвечает **402**, кабинет остаётся доступен.

## Демо без бэкенда

`frontend/src/app/core/saas.service.ts` при пустом `API_URL` работает локально (localStorage): три демо-заведения с ценами, столами и 30 днями истории, где гости заказывают то, что советует движок. Демо-вход: `efes@demo.flavortree.kz / flavor2026`. Тот же код при заданном `API_URL` ходит в Django.

Сид для Django: `python manage.py seed_saas --reset --events 420`.

## QR и NFC

- QR: `qrcode` в браузере, стенды A6 (`/cabinet/print`, Ctrl+P → PDF), ссылка вида `/m/<slug>/<стол>`; токен `EBG-05` напечатан для ручного ввода.
- NFC: Web NFC (`NDEFReader.write`) из кабинета в Chrome на Android записывает URL стола в NTAG213-наклейку (~150 ₸). iPhone 7+ и Android читают такие метки без приложения. Стенд: «наведите камеру или приложите телефон».

## Аналитика (что видит владелец)

`revenue_intent_kzt` = Σ цены сортов, выбранных через «Заказать» (намерение, не чек — честно называем «эффект подбора»). Дальше — интеграция с iiko/Poster для факта.

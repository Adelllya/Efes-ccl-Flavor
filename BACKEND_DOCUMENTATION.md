# Flavor Tree — Бэкенд

> **v2 (сентябрь 2026):** добавлен движок подбора (`api/pairing/`), эндпоинты `/api/pairing/*`, `/api/dna/`, `/api/venues/`, `/api/qr/*`, поля v2 у моделей (slug, style_family, vector/axes/tags), загрузка из `data/*.json`, SQLite по умолчанию. Актуальное описание API — в [docs/API.md](docs/API.md), архитектура — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), движок — [docs/PAIRING_ENGINE.md](docs/PAIRING_ENGINE.md). Ниже — исходная документация v1 (модели и CRUD по-прежнему актуальны).

---

## Переменные окружения (.env)

`flavor_tree/settings.py` сам читает файл `backend/.env` — без `python-dotenv` и других пакетов. Образец со всеми переменными и пояснениями: `backend/.env.example`.

```bash
cd backend
cp .env.example .env      # и заполнить значения; .env в git не попадает
```

Правила разбора: `KEY=VALUE`, строки с `#` — комментарии, кавычки вокруг значения необязательны, допустим префикс `export `, пустое значение = переменная не задана. **Реальное окружение главнее файла**: если переменная уже задана в системе (systemd, Docker, панель хостинга), значение из `.env` её не перезапишет.

Значения кладутся в `os.environ` при импорте настроек, поэтому их видит и код, который читает окружение сам: `api/ai.py` создаёт клиент `anthropic.Anthropic()` при первом запросе и берёт `ANTHROPIC_API_KEY` из окружения, `api/auth.py` читает `FT_ADMIN_TOKEN` при каждом запросе.

| Переменная | Зачем | Если не задана |
|---|---|---|
| `DJANGO_SECRET_KEY` | подпись сессий и токенов сброса пароля | dev-ключ из репозитория; при `DJANGO_DEBUG=False` сервер **не запустится** (`ImproperlyConfigured`) |
| `DJANGO_DEBUG` | `True` — разработка, `False` — прод | `True` |
| `DJANGO_ALLOWED_HOSTS` | домены через запятую | `DEBUG=True` → любой хост; `DEBUG=False` → пустой список, то есть `400` на каждый запрос, пока не заполнить |
| `CORS_ALLOWED_ORIGINS` | адреса фронтенда через запятую (`https://app.example.com`) | только `localhost:4200` / `:3000`; при `DEBUG=True` разрешены все источники |
| `FT_ADMIN_TOKEN` | токен служебного API сомелье | `DEBUG=True` → служебный API открыт, в лог пишется предупреждение; `DEBUG=False` → закрыт для всех, кроме сотрудника Django |
| `ANTHROPIC_API_KEY` | ИИ-сомелье `POST /api/ai/` | эндпоинт отвечает `503` с понятным текстом, остальной API работает |
| `DATABASE_URL` или `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT` | PostgreSQL | SQLite `backend/db.sqlite3` |
| `FLAVOR_DATA_DIR` | папка с `data/*.json` | `../data` относительно `backend/` |

Сгенерировать секреты:

```bash
python -c "from django.core.management.utils import get_random_secret_key as k; print(k())"   # DJANGO_SECRET_KEY
python -c "import secrets; print(secrets.token_urlsafe(32))"                                  # FT_ADMIN_TOKEN
```

Проверка перед выкладкой: `DJANGO_DEBUG=False python manage.py check --deploy`.

## Доступ к служебному API

Пишущие эндпоинты сомелье закрыты классом `IsSommelierAdmin` из `api/auth.py`:

- все `/api/admin/*` (включая `GET /api/admin/brands/`) и `/api/seed/` — декоратор `@sommelier_only`;
- `BrandViewSet` и `FlavorNoteViewSet` — `IsSommelierAdminOrReadOnly`: чтение открыто, `POST/PUT/PATCH/DELETE` и `upload-image` закрыты.

Пускает токен `FT_ADMIN_TOKEN` (заголовок `Authorization: Bearer <token>` или `X-Admin-Token: <token>`, сравнение через `hmac.compare_digest`) либо вошедший сотрудник Django (`is_staff`). Нет учётных данных — `401` с `WWW-Authenticate`, не подошли — `403`. Подробная таблица ответов — в [docs/API.md](docs/API.md#доступ).

Чтобы закрыть ещё одну функцию-вьюху, декоратор ставится **под** `@api_view`:

```python
from .auth import sommelier_only

@api_view(['POST'])
@sommelier_only
def my_view(request): ...
```

Кабинет заведения (`/api/cabinet/*`) — отдельный контур со своим токеном `VenueAccount.api_token`; он описан в [docs/SAAS.md](docs/SAAS.md).

## Тесты

```bash
cd backend
.venv/bin/python manage.py test api.tests                      # всё: движок, доступ, SaaS
.venv/bin/python manage.py test api.tests.test_admin_auth      # 401/403, оба заголовка, сотрудник, DEBUG on/off
.venv/bin/python manage.py test api.tests.test_saas            # регистрация, кабинет, меню, стоп-лист, столы, аналитика, лимиты, изоляция заведений
```

База — SQLite в памяти, сеть не нужна. В `test_saas.py` класс `TestKnownBugs` собран из тестов с `@expectedFailure`: каждый описывает найденную ошибку `views_saas.py`. После исправления тест даёт «unexpected success» — тогда декоратор снимается.

---


Документация по серверной части проекта. Здесь описано как устроен API, какие модели в базе, какие запросы можно делать и что они возвращают.

---

## Стек

- Python 3.10
- Django 4.2
- Django REST Framework
- PostgreSQL (на проде), SQLite (локально для разработки)

---

## Структура папок

```
backend/
├── manage.py
├── requirements.txt
├── flavor_tree/          # настройки django (settings, urls, wsgi)
└── api/                  # само приложение
    ├── models.py         # модели БД
    ├── serializers.py    # сериализаторы для JSON
    ├── views.py          # вьюхи и логика
    ├── urls.py           # маршруты
    └── admin.py          # настройка админки
```

---

## Модели

### FlavorNote (вкусовая нота)

Это отдельный дескриптор вкуса. У каждой ноты есть категория — к какому слою пирамиды она относится.

| Поле | Тип | Что хранит |
|------|-----|-----------|
| name | CharField(100) | название ("Хмель", "Карамель", "Цитрус") |
| category | CharField | слой пирамиды: `BASE`, `HEART` или `TOP` |
| description | TextField | описание что это за нота |
| icon | CharField(10) | эмодзи для UI |

Категории:
- `BASE` — базовые вкусы (горечь, сладость, кислотность, плотность)
- `HEART` — ароматика (травы, фрукты, пряности, дрожжи)
- `TOP` — эмоции/ассоциации (свежесть, уют, бодрость)

### Beer (пиво)

Основная сущность каталога. Привязана к нотам через Many-to-Many по каждому слою отдельно (чтобы не мешать всё в кучу).

| Поле | Тип | Что хранит |
|------|-----|-----------|
| name | CharField(200) | название сорта |
| brand | CharField(100) | бренд (Efes, Белый Медведь и тд) |
| style | CharField(100) | стиль (Lager, Pilsner, Wheat, IPA) |
| abv | FloatField | крепость в % |
| description | TextField | описание |
| image | URLField | ссылка на картинку |
| base_notes | M2M → FlavorNote | базовые ноты (фильтр category=BASE) |
| heart_notes | M2M → FlavorNote | ноты сердца (фильтр category=HEART) |
| top_notes | M2M → FlavorNote | верхние ноты (фильтр category=TOP) |

Связь M2M с `limit_choices_to` — Django сам не даст засунуть BASE-ноту в heart_notes, что удобно.

### Course (курс в Школе Сомелье)

4 уровня обучения, от новичка до сомелье.

| Поле | Тип | Что хранит |
|------|-----|-----------|
| level | IntegerField | 1–4 (Новичок / Исследователь / Знаток / Сомелье) |
| title | CharField(100) | название уровня |
| description | TextField | чему учим на этом уровне |
| color | CharField(7) | hex-цвет для плашки в интерфейсе |

### TeamMember (команда)

| Поле | Тип | Что хранит |
|------|-----|-----------|
| name | CharField(200) | имя |
| role | CharField(100) | роль |
| photo | URLField | фото |
| order | IntegerField | порядок отображения |

---

## API эндпоинты

Всё висит на `/api/`. Роутер DRF генерирует стандартные CRUD-маршруты для ViewSet-ов.

| Метод | URL | Что делает |
|-------|-----|-----------|
| GET | `/api/beers/` | список всего пива, можно фильтровать по `?brand=efes` или `?style=lager` |
| GET | `/api/beers/{id}/` | одно конкретное пиво со всеми нотами |
| POST | `/api/beers/` | создать новый сорт (для админки / сомелье) |
| PUT/PATCH | `/api/beers/{id}/` | обновить |
| DELETE | `/api/beers/{id}/` | удалить |
| GET | `/api/notes/` | все вкусовые ноты, фильтр `?category=BASE` / `HEART` / `TOP` |
| GET | `/api/courses/` | список курсов (read-only) |
| GET | `/api/team/` | команда (read-only) |
| GET | `/api/landing/` | всё для лендинга одним запросом — проект, команда, курсы, цифры, цитата |

`/api/landing/` — это отдельная вьюха (не ViewSet), которая собирает данные из нескольких моделей и отдаёт одним куском. Сделано чтобы фронт не делал 4 запроса при загрузке страницы.

---

## Примеры ответов

### GET /api/beers/1/

```json
{
  "id": 1,
  "name": "Efes Pilsener",
  "brand": "Efes Kazakhstan",
  "style": "Pilsner",
  "abv": 5.0,
  "description": "Светлое пиво с хмелевой горчинкой и чистым солодовым послевкусием.",
  "image": "https://flavortree.kz/assets/efes_pilsener.png",
  "base_notes": [
    {
      "id": 1,
      "name": "Хмелевая горчинка",
      "category": "BASE",
      "category_display": "Базовые вкусы",
      "description": "Благородная горечь хмеля Hallertau",
      "icon": "🌿"
    },
    {
      "id": 2,
      "name": "Солодовая плотность",
      "category": "BASE",
      "category_display": "Базовые вкусы",
      "description": "Сладость ячменного солода",
      "icon": "🌾"
    }
  ],
  "heart_notes": [
    {
      "id": 5,
      "name": "Цветочный букет",
      "category": "HEART",
      "category_display": "Ароматические ноты",
      "description": "Лёгкие ноты луговых трав",
      "icon": "🌸"
    }
  ],
  "top_notes": [
    {
      "id": 9,
      "name": "Освежающий финиш",
      "category": "TOP",
      "category_display": "Эмоции",
      "description": "Бодрящее послевкусие с карбонизацией",
      "icon": "❄️"
    }
  ]
}
```

### GET /api/landing/

```json
{
  "project": {
    "name": "Flavor Tree",
    "slogan": "Don't just drink – listen to the flavor",
    "description": "Первая в СНГ платформа сенсорного образования для напитков.",
    "championship": "OneIdea Championship 2026"
  },
  "team": [
    { "id": 1, "name": "Аджибаева Аделия", "role": "Co-founder", "photo": "", "order": 1 },
    { "id": 2, "name": "Абуталифулы Ералы", "role": "Co-founder", "photo": "", "order": 2 }
  ],
  "courses": [
    { "id": 1, "level": 1, "level_display": "Новичок", "title": "Азбука вкуса", "description": "...", "color": "#F7941D" },
    { "id": 2, "level": 2, "level_display": "Исследователь", "title": "Пирамида стилей", "description": "...", "color": "#E08A28" },
    { "id": 3, "level": 3, "level_display": "Знаток", "title": "Гастрономический пэринг", "description": "...", "color": "#D47519" },
    { "id": 4, "level": 4, "level_display": "Сомелье", "title": "Слепая дегустация", "description": "...", "color": "#A8550C" }
  ],
  "stats": {
    "market_size": "$1.8B",
    "market_label": "рынок пива KZ",
    "brands_count": "15+",
    "brands_label": "брендов Efes KZ"
  },
  "quote": {
    "text": "We don't rate beer. We teach people to understand it.",
    "author": "Flavor Tree Team — OneIdea Championship 2026"
  }
}
```

---

## Как запустить локально

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env              # необязательно: без .env работают значения по умолчанию для разработки
python manage.py migrate
python manage.py load_flavor_data # канонические данные из ../data/*.json
python manage.py runserver
# http://127.0.0.1:8000/api/
```

Для админки нужно создать суперюзера:
```bash
python manage.py createsuperuser
# http://127.0.0.1:8000/admin/
```

---

## Заметки по реализации

- В `BeerViewSet` используется `prefetch_related('base_notes', 'heart_notes', 'top_notes')` — без этого Django делал бы отдельный запрос в БД на каждую связь каждого пива, а так всё загружается за 4 запроса.
- `CourseViewSet` и `TeamMemberViewSet` сделаны как `ReadOnlyModelViewSet` — редактировать их можно только через админку, снаружи только чтение.
- В сериализаторах для `FlavorNote` и `Course` добавлены поля `category_display` и `level_display` — они отдают человекочитаемые названия вместо кодов (т.е. "Базовые вкусы" вместо "BASE").

---

## Что дальше

- Добавить модель `FoodItem` для блюд (бешбармак, шашлык и тд) и таблицу пар блюдо-пиво с процентом совместимости вкусовых нот
- Сервис подбора — пользователь выбирает блюдо, бэкенд считает пересечение нот и выдаёт топ-3 сорта
- Потом личный кабинет и трекинг прохождения курсов

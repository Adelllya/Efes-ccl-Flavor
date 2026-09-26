# Flavor Tree — Бэкенд

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
python manage.py migrate
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

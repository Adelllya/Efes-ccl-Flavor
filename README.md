# 🍺 Flavor Tree

> *«Don't just drink - listen to the flavor»*

Подбор напитка к еде для гостей баров и ресторанов Казахстана и витрина вкусов сортов Efes Kazakhstan.
Гость открывает меню заведения по ссылке или QR, выбирает блюдо и видит, какое пиво или другой напиток
к нему подходит и почему.

**OneIdea Championship 2026 × Efes Kazakhstan**

---

## 👥 Команда

- **Аджибаева Аделия**, сооснователь
- **Абуталифулы Ералы**, сооснователь

Сомелье в команде нет. Вкусовые пирамиды 17 сортов и 51 пара «сорт и блюдо» пока черновик команды:
ноты подобраны по стилю и описанию сорта, без дегустации (см. `Flavor_Tree_Beer_Data_Draft.md` и
`Flavor_Tree_Food_Pairings.md`). На сайте они так и подписаны.

Все публичные утверждения (сайт, питч, роадмап, Lean Canvas, CustDev) со статусом «правда / исправить»
собраны в [docs/CLAIMS.md](docs/CLAIMS.md). Перед защитой сверяйте слайды с этой таблицей.

---

## Что есть сейчас

**Для гостя**
- **Главная** (`/`): поиск блюда, мастер подбора пива к блюду за 4 шага, обратный путь «у меня есть пиво».
- **Каталог** (`/catalog`, `/beer/<id>`): 17 сортов Efes Kazakhstan с вкусовой пирамидой (верхние ноты,
  сердце, послевкусие), подачей и парами с блюдами. Вкладка «Все напитки»: каталог движка подбора,
  412 напитков 17 категорий (пиво, безалкогольное пиво, сидр, вино, крепкое, коктейли, квас, чай, кофе и
  другие), из них 44 позиции портфеля Efes.
- **К блюду** (`/pairings`): 51 пара «сорт и блюдо» из черновика команды, каталог 50 блюд и подбор
  движком по 114 блюдам.
- **Меню заведения** (`/menu/<slug>`): блюда и напитки бара с ценами и стоп-листом, подбор напитка к блюду,
  заказ на стол.
- **Академия** (`/academy`): программа из 4 курсов (помечены «Скоро»), урок про вкусовую пирамиду на
  примере сорта из каталога и экспресс-тест из 5 вопросов. Сертификатов и дипломов нет.
- **ИИ-сомелье** (кнопка чата): отвечает через Claude, если на сервере задан `ANTHROPIC_API_KEY`.
  Без ключа чат отвечает локальным подбором по правилам, и на главной он назван «Сомелье-бот».

**Для заведения и команды** (`/panel`, вход по роли)
- Модератор: сорта, запросы сомелье, сочетания, блюда, заведения, меню и заказы, пользователи.
- Сомелье (роль в панели): предлагает правки пирамид и подачи, модератор принимает или отклоняет.
- Администратор заведения: своё меню, карта напитков, заказы.

**Как считается подбор.** Движок v2 (`backend/api/pairing/engine_v2.py`) сравнивает вкусовой профиль
блюда и напитка по правилам с весами. Балл от бренда не зависит. Если напитки отличаются не больше чем
на 2 балла, первым показывается напиток из портфеля Efes: это правило отдаётся в ответе `/api/v2/meta/`.

---

## 🛠 Технологии

| Слой | Что |
|------|-----|
| Фронтенд | Angular 18 (standalone, signals), TypeScript, CSS |
| Бэкенд | Python 3.12, Django 4.2, Django REST Framework |
| База | PostgreSQL на проде (Vercel), SQLite для локальной разработки и тестов |
| ИИ | Anthropic Claude (`anthropic`), модель задаёт `FT_AI_MODEL` |
| Деплой | Vercel: два проекта, `frontend` и `backend` |

---

## 📁 Структура

```
backend/
  api/                  модели, API, права ролей, ИИ-сомелье
  api/pairing/          движок подбора v2
  api/management/commands/
                        seed, load_flavor_data, load_food_pairings, seed_roles,
                        update_public_content, regen_brand_thumbs, import_dish_photos
  api/fixtures/         17 сортов, 50 блюд, 51 пара (CSV)
  data/engine/          каталог движка: drinks.json (412), dishes_v2.json (114), параметры
  data/media_map.json   пути к фото сортов и блюд в media/
  media/                фото сортов и блюд
  index.py              вход для Vercel: миграции и начальная загрузка при холодном старте
frontend/
  src/app/pages/        главная, каталог, сорт, к блюду, меню заведения, академия, панель, вход
  src/app/ui/           чат ИИ-сомелье
  src/environments/     адрес API: environment.ts (локально), environment.prod.ts (прод)
docs/CLAIMS.md          публичные утверждения и их статус
```

---

## 🚀 Запуск локально

### Бэкенд

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
export DATABASE_URL=sqlite:///$PWD/db.sqlite3     # без неё settings ждут PostgreSQL (DB_* переменные)
.venv/bin/python manage.py migrate
# Пустая база: порядок важен, seed удаляет сорта (а с ними меню и пары).
.venv/bin/python manage.py seed                   # ноты, курсы, команда
.venv/bin/python manage.py load_flavor_data       # 17 сортов, пирамиды, 50 блюд, 51 пара
.venv/bin/python manage.py seed_roles             # роли, демо-пользователи, демо-бар с меню
.venv/bin/python manage.py runserver              # http://127.0.0.1:8000/api/
```

Уже заполненную базу (в том числе прод) не пересевать: `seed` стирает сорта, а каскадом меню, пары и
запросы. Чтобы привести её к честным данным (команда, курсы, подписи пирамид, крепость и фото сортов,
демо-бар без выдуманных адреса и телефона), достаточно:

```bash
DATABASE_URL="<строка базы>" .venv/bin/python manage.py update_public_content
```

Команда ничего не пересоздаёт и не трогает правки людей, её можно запускать повторно.

### Фронтенд

```bash
cd frontend
npm ci
npm start                                         # http://localhost:4200, API из environment.ts
npx ng build --configuration production           # прод-сборка, API из environment.prod.ts
```

### Переменные бэкенда

| Переменная | Зачем |
|---|---|
| `DATABASE_URL` (или `POSTGRES_URL` от Vercel) | строка подключения к базе |
| `DJANGO_SECRET_KEY` | секрет Django, на проде обязателен |
| `DJANGO_DEBUG` | `False` на проде |
| `DJANGO_ALLOWED_HOSTS` | домены бэкенда через запятую |
| `DJANGO_CORS_ALLOWED_ORIGINS`, `DJANGO_CSRF_TRUSTED_ORIGINS` | домен фронтенда |
| `ANTHROPIC_API_KEY` | включает ИИ-сомелье; без ключа чат работает по правилам |
| `FT_AI_MODEL` | модель Claude для чата |

Файл `backend/.env` читается автоматически, образец в `backend/.env.example`.

### Тесты

```bash
cd backend && DATABASE_URL=sqlite:////tmp/ft-test.sqlite3 .venv/bin/python manage.py test api
cd frontend && npx ng build --configuration production
```

---

## 🌐 Деплой

Два проекта Vercel из одного репозитория: Root Directory `backend` и `frontend`. Подробно в
[DEPLOY.md](DEPLOY.md). Бэкенд при холодном старте сам применяет миграции (`backend/index.py`).
Адрес API для прод-сборки фронтенда задан в `frontend/src/environments/environment.prod.ts`.

---

## 📄 Материалы OneIdea

`research.md` (CustDev), `Flavor_Tree_Roadmap.pdf`, `GANTT.pdf`, `Lean Canvas.pdf`, `🍺 FLAVOR TREE.pdf`.
Часть цифр и обещаний в них не совпадает с продуктом и данными опроса: что поправить, в
[docs/CLAIMS.md](docs/CLAIMS.md). Папки `1 version/`, `2 version/`, `5 version/`: предыдущие итерации кода.

---

*© 2026 Flavor Tree.*

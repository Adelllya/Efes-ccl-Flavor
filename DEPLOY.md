# Деплой Flavor Tree — всё на Vercel

Два отдельных проекта Vercel из одного репозитория, ветка `deploy`:
- бекенд (Django) — папка `backend`
- фронтенд (Angular) — папка `frontend`

## 1. Бекенд (проект Vercel #1)
1. Vercel → Add New → Project → импортировать репозиторий `Adelllya/Efes-ccl-Flavor`,
   ветка `deploy`. Если репо не видно — подключить GitHub-аккаунт `Adelllya`.
2. **Root Directory** = `backend`. Framework Preset = Other.
3. **Storage** → Create Database → Postgres → Connect к проекту.
   Vercel сам добавит переменные `POSTGRES_URL` и т.д. — бекенд их читает автоматически.
4. **Environment Variables** добавить:
   - `DJANGO_DEBUG` = `False`
   - `DJANGO_SECRET_KEY` = длинная случайная строка (50+ символов)
   - `DJANGO_ALLOWED_HOSTS` = `.vercel.app`
   - `DJANGO_CSRF_TRUSTED_ORIGINS` = `https://<домен-бекенда>.vercel.app,https://<домен-фронта>.vercel.app`
   - `DJANGO_CORS_ALLOWED_ORIGINS` = `https://<домен-фронта>.vercel.app`
   - (опц.) `ANTHROPIC_API_KEY`, `FT_AI_MODEL`
5. Deploy → получите домен бекенда, напр. `flavor-backend.vercel.app`.
6. **Миграции и данные** (serverless сам не запускает команды):
   скопируйте строку подключения из Vercel (Storage → база → `POSTGRES_URL`)
   и выполните локально из папки `backend`:
   ```
   DATABASE_URL="<строка>" .venv/bin/python manage.py migrate
   DATABASE_URL="<строка>" .venv/bin/python manage.py seed_roles
   DATABASE_URL="<строка>" .venv/bin/python manage.py seed
   DATABASE_URL="<строка>" .venv/bin/python manage.py createsuperuser
   ```

## 2. Прописать адрес бекенда во фронтенд
В `frontend/src/environments/environment.prod.ts` заменить `REPLACE_WITH_RAILWAY_DOMAIN`
на домен бекенда (без слэша), напр. `flavor-backend.vercel.app`. Закоммитить и запушить в `deploy`.

## 3. Фронтенд (проект Vercel #2)
1. Vercel → Add New → Project → тот же репозиторий, ветка `deploy`.
2. **Root Directory** = `frontend`.
3. Сборка и папка вывода уже заданы в `frontend/vercel.json`.
4. Deploy → домен фронта. Добавьте его в переменные бекенда
   (`DJANGO_CSRF_TRUSTED_ORIGINS`, `DJANGO_CORS_ALLOWED_ORIGINS`) и передеплойте бекенд.

## Заметки
- Django на Vercel работает как serverless. Картинки пива из репозитория показываются,
  но новые загрузки через админку не сохраняются (нужен внешний storage типа S3).
- Локальная разработка не меняется: `environment.ts` смотрит на `127.0.0.1:8000`.

## Пилот в баре: QR, мониторинг, выгрузка данных
- **QR-коды столов.** `GET /api/venues/<slug>/qr.svg?table=N` рисует QR со ссылкой
  `<сайт>/menu/<slug>?table=N&src=qr`. Адрес сайта задаёт переменная бекенда
  `FT_PUBLIC_SITE_URL` = `https://<домен-фронта>.vercel.app` (без слэша в конце).
  Без неё берётся сайт, с которого открыли картинку, затем первый не локальный адрес
  из `DJANGO_CORS_ALLOWED_ORIGINS`. Перед печатью табличек отсканируйте один код телефоном.
- **Мониторинг.** `GET /api/health/` проверяет базу (`SELECT 1`) и при сбое отвечает 503.
  Поставьте на него внешний монитор (например, UptimeRobot, раз в 5 минут),
  второй монитор на страницу меню `https://<домен-фронта>/menu/<slug>`.
- **Цифры пилота.** В панели: `GET /api/pilot/report/?venue=<slug>&from=ГГГГ-ММ-ДД&to=ГГГГ-ММ-ДД`
  и `GET /api/pilot/export.csv?venue=<slug>&kind=events|orders|feedback` (владелец заведения или модератор).
  Из терминала то же самое плюс CSV для слайдов:
  ```
  DATABASE_URL="<строка>" .venv/bin/python manage.py pilot_report --venue <slug> --from 2026-10-05 --to 2026-10-12 --csv ../pilot-out
  ```
- **Резервная копия раз в день**, пока идёт пилот. Выгрузку хранить вне репозитория: в ней хэши паролей.
  Запускать из копии того же коммита, что стоит на проде, иначе dumpdata упадёт на таблице, которой в базе нет.
  ```
  DATABASE_URL="<строка>" .venv/bin/python manage.py dumpdata api auth.user --indent 1 > pilot_ГГГГММДД.json
  ```
- Заведение, у которого есть заказы, API не удаляет (ответ 409): снимите его с публикации.

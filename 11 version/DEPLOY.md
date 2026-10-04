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
- Django на Vercel работает как serverless. Диск там только для чтения, поэтому с версии 11
  загруженные через панель фото сохраняются в базу (таблица StoredFile) и отдаются по тому же адресу `/media/...`.
- Локальная разработка не меняется: `environment.ts` смотрит на `127.0.0.1:8000`.

## Версия 11: что добавить при выкладке

1. Живой сайт собирается из ветки `vercel-deploy`. Перенесите туда изменения из `deploy`.
2. Миграции. В версии 11 пять новых миграций (`0013`-`0017`):
   ```
   DATABASE_URL="<строка>" .venv/bin/python manage.py migrate
   ```
   Миграция `0017` сама записывает 12 уроков Академии и 32 новых вопроса теста.
3. Переменные окружения бекенда:
   - `ANTHROPIC_API_KEY` - без него фото блюд не распознаются, чат и подбор пар работают по правилам;
   - `FT_AI_MODEL` - модель, по умолчанию `claude-opus-5-5`;
   - `FT_AI_DAILY_LIMIT` и `FT_AI_GUEST_DAILY_LIMIT` - дневные лимиты платных обращений к ИИ (400 и 150);
   - `DJANGO_DEBUG` теперь по умолчанию выключен.
4. Адрес бекенда во фронтенде уже прописан: `frontend/src/environments/environment.prod.ts`
   смотрит на `https://flavor-tree-backend.vercel.app`. Если домен другой, поменяйте.
5. Снимок данных. В ветке `vercel-deploy` сервер при старте заливает базу из `data/snapshot.json`,
   а при изменении файла сначала стирает базу. После обновления пересоберите снимок из локальной
   базы, иначе на живом сайте останется 20 вопросов теста вместо 52. Перед пилотом с живыми гостями
   этот механизм лучше отключить: заказы, отметки и баллы при перезаливке пропадут.
6. Пароли демо-аккаунтов показаны на странице входа. Перед показом за пределами команды
   смените их или выключите блок: `showDemoAccounts: false` в `frontend/src/environments/environment.prod.ts`.
7. Демо-заказы для экрана аналитики (по желанию):
   ```
   DATABASE_URL="<строка>" .venv/bin/python manage.py seed_demo_orders --venue efes-beer-garden --days 30
   ```
   В аналитике они подписаны как демо-данные. Убрать: та же команда с `--clear`.

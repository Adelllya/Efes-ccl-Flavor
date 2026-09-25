# Деплой Flavor Tree

Бекенд (Django) → Railway. Фронтенд (Angular) → Vercel. Ветка: `deploy`.

## 1. Бекенд на Railway
1. https://railway.app → New Project → **Deploy from GitHub repo** → `Adelllya/Efes-ccl-Flavor`, ветка `deploy`.
2. В сервисе → **Settings → Root Directory** = `backend`.
3. **+ New → Database → PostgreSQL** (в том же проекте). Он сам добавит переменную `DATABASE_URL`.
4. Сервис бекенда → **Variables**, добавить:
   - `DJANGO_DEBUG` = `False`
   - `DJANGO_SECRET_KEY` = длинная случайная строка (50+ символов)
   - `DJANGO_ALLOWED_HOSTS` = домен Railway, напр. `flavor-production-xxxx.up.railway.app`
   - `DJANGO_CSRF_TRUSTED_ORIGINS` = `https://<домен-railway>,https://<домен-vercel>`
   - `DJANGO_CORS_ALLOWED_ORIGINS` = `https://<домен-vercel>`
   - (опц.) `ANTHROPIC_API_KEY`, `FT_AI_MODEL` для ИИ-сомелье
   - `DATABASE_URL` уже проброшен из плагина Postgres.
5. Deploy. Старт-команда сама делает `migrate` + `collectstatic` + `gunicorn` (см. `backend/Procfile`).
6. **Домен**: Settings → Networking → Generate Domain. Это адрес бекенда.
7. **Суперпользователь и данные** — в Railway → сервис → вкладка с shell/командой (или Railway CLI `railway run`):
   - `python manage.py createsuperuser`
   - `python manage.py seed_roles`
   - `python manage.py seed`

## 2. Прописать адрес бекенда во фронтенд
В `frontend/src/environments/environment.prod.ts` заменить `REPLACE_WITH_RAILWAY_DOMAIN`
на домен Railway (без слэша на конце), закоммитить и запушить в `deploy`.

## 3. Фронтенд на Vercel
1. https://vercel.com → Add New → Project → тот же GitHub repo, ветка `deploy`.
2. **Root Directory** = `frontend`. Framework: Angular (или Other).
3. Build Command и Output уже заданы в `frontend/vercel.json`
   (`npm run build`, `dist/frontend/browser`).
4. Deploy → получите домен Vercel.
5. Добавьте этот домен в переменные Railway `DJANGO_CSRF_TRUSTED_ORIGINS` и
   `DJANGO_CORS_ALLOWED_ORIGINS`, передеплойте бекенд.

## Заметки
- Медиа (`backend/media`) закоммичены — картинки пива будут видны сразу.
  Загруженные через админку файлы на бесплатном Railway не переживут передеплой,
  пока не подключить Volume на `/app/media`.
- Локальная разработка не изменилась: `environment.ts` смотрит на `127.0.0.1:8000`.

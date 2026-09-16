# 🍺 Flavor Tree

> *"Don't just drink – listen to the flavor"*

**Первая в СНГ платформа сенсорного образования для напитков.**  
Помогаем людям слышать вкус, а брендам — быть понятыми.

**OneIdea Championship 2026 × Efes Kazakhstan**

---

## 👥 Команда

- **Аджибаева Аделия** — Co-founder
- **Абуталифулы Ералы** — Co-founder

---

## 🛠 Технологии

| Слой | Технология |
|------|-----------|
| Frontend | Angular 18, TypeScript, CSS |
| Backend | Django 4.2, Django REST Framework |
| Deploy | Vercel (frontend) |

---

## 📁 Структура проекта

```
Flavor/
├── backend/          # Django DRF API
│   ├── manage.py
│   ├── requirements.txt
│   ├── flavor_tree/  # Django settings
│   └── api/          # REST API (models, views, serializers)
├── frontend/         # Angular 18 SPA
│   ├── src/
│   │   ├── app/
│   │   │   └── components/  # 10 landing page sections
│   │   ├── styles.css       # Global design system
│   │   └── index.html
│   ├── vercel.json          # Vercel deployment config
│   └── angular.json
└── README.md
```

---

## 🚀 Запуск

### Frontend (Angular)

```bash
cd frontend
npm install
ng serve
# → http://localhost:4200
```

### Backend (Django)

```bash
cd backend
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
# → http://localhost:8000/api/
```

---

## 🌐 Деплой на Vercel

### Frontend

```bash
cd frontend
ng build --configuration=production
# Результат → dist/frontend/browser/
```

На Vercel:
1. Подключить репозиторий
2. Framework Preset: **Other**
3. Build Command: `cd frontend && npm install && npx ng build --configuration=production`
4. Output Directory: `frontend/dist/frontend/browser`

---

## 📡 API Endpoints

| Метод | URL | Описание |
|-------|-----|----------|
| GET | `/api/landing/` | Все данные для лендинга |
| GET | `/api/beers/` | Список пива |
| GET | `/api/notes/` | Вкусовые ноты |
| GET | `/api/courses/` | Курсы сомелье |
| GET | `/api/team/` | Команда |

---

## 🎨 Дизайн

Лендинг включает 10 секций:
1. **Hero** — Логотипы, название, слоган, команда
2. **Проблема** — Почему люди не понимают пиво
3. **Решение** — Вкусовая пирамида (TOP / HEART / BASE)
4. **Как это работает** — Двусторонняя навигация
5. **Образование** — Школа Пивных Сомелье (4 уровня)
6. **Уникальные фичи** — Flavor DNA, казахская кухня, scan
7. **Бизнес-модель** — 4 потока монетизации
8. **Impact** — Влияние на потребителя, Efes, рынок
9. **Наш Ask** — Данные, пилот, менторство
10. **Footer** — Цитата и кредиты

---

*© 2026 Flavor Tree. Все права защищены.*

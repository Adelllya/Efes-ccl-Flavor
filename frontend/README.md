# Flavor Tree — фронтенд (Angular 18)

SPA работает полностью офлайн на данных из `../data/*.json`; движок подбора — `src/app/engine/pairing-engine.ts`.

```bash
npm install
npm start            # dev-сервер http://localhost:4200
npm run build        # production → dist/frontend/browser
npm run test:engine  # паритет TS-движка с Python (data/golden_scores.json)
npm run smoke        # интерактивный smoke-тест (нужен Google Chrome, после build)
npm run shots        # скриншоты mobile+desktop → ../docs/screenshots (DARK=1 — тёмная тема, FULL=1 — вся страница)
```

Подключить Django API (правки сомелье, QR-статистика): в `src/index.html` добавить
`<script>window.FT_API_URL = 'https://…/api'</script>`.

Структура: `core/` сервисы (data, pairing, progress/XP, dna, venue, theme) · `ui/` компоненты (icon, score-ring, radar,
flavor-glass, flavor-tree, beer/dish/match-card) · `pages/` экраны · `engine/` движок. Дизайн-система — `src/styles.css`.
Подробнее — `../README.md` и `../docs/`.

#!/usr/bin/env bash
# Быстрая проверка прода (или локального стенда) после деплоя и перед показом.
#
#   scripts/smoke.sh                       # прод: flavor-tree-backend / flavor-tree-frontend на vercel.app
#   BACKEND=http://127.0.0.1:8000 FRONTEND=http://127.0.0.1:4200 scripts/smoke.sh
#   VENUE=efes-beer-garden scripts/smoke.sh
#
# Первый запрос будит функцию Vercel (холодный старт 3-5 с), поэтому скрипт заодно прогревает сайт.
set -u
BACKEND=${BACKEND:-https://flavor-tree-backend.vercel.app}
FRONTEND=${FRONTEND:-https://flavor-tree-frontend.vercel.app}
VENUE=${VENUE:-efes-beer-garden}
fails=0

check() {
  # check "название" URL ожидаемый_код [строка, которая должна быть в ответе]
  local name=$1 url=$2 want=$3 needle=${4:-}
  local body code
  body=$(curl -s -m 30 -w '\n%{http_code}' "$url")
  code=${body##*$'\n'}
  body=${body%$'\n'*}
  if [ "$code" != "$want" ]; then
    echo "FAIL  $name: HTTP $code, ждали $want ($url)"; fails=$((fails + 1)); return
  fi
  if [ -n "$needle" ] && ! grep -q -- "$needle" <<<"$body"; then
    echo "FAIL  $name: в ответе нет $needle ($url)"; fails=$((fails + 1)); return
  fi
  echo "ok    $name"
}

check "health и база" "$BACKEND/api/health/" 200 '"db":true'
check "движок v2" "$BACKEND/api/v2/meta/" 200
check "каталог 412 напитков" "$BACKEND/api/v2/drinks/?limit=500" 200 '"id"'
check "заведение $VENUE" "$BACKEND/api/venues/$VENUE/" 200 '"slug"'
check "меню $VENUE" "$BACKEND/api/venues/$VENUE/menu/" 200 '"sections"'
check "статус ИИ" "$BACKEND/api/ai/status/" 200 '"mode"'
check "статика админки" "$BACKEND/static/admin/css/base.css" 200

if curl -s -m 30 "$BACKEND/api/venues/" | grep -q '"owner"'; then
  echo "FAIL  публичный список заведений показывает логин владельца"; fails=$((fails + 1))
else
  echo "ok    логин владельца скрыт"
fi

code=$(curl -s -m 30 -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
  -d '{"username":"moderator","password":"moderator12345"}' "$BACKEND/api/auth/login/")
if [ "$code" = "200" ]; then
  echo "FAIL  публичный демо-пароль moderator работает"; fails=$((fails + 1))
else
  echo "ok    публичный демо-пароль не работает (HTTP $code)"
fi

check "главная" "$FRONTEND/" 200
check "меню по QR" "$FRONTEND/menu/$VENUE?table=1&src=qr" 200

echo
if [ "$fails" -gt 0 ]; then
  echo "Проблем: $fails"; exit 1
fi
echo "Всё в порядке"

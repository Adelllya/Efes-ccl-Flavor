"""Доступ к служебному API сомелье: /api/admin/*, /api/seed/ и запись в справочники.

Пускаем в двух случаях:
  1. токен из переменной окружения FT_ADMIN_TOKEN — заголовком
     `Authorization: Bearer <token>` или `X-Admin-Token: <token>`;
  2. вошедший сотрудник Django (is_staff) — сессия из /admin/.

Если FT_ADMIN_TOKEN не задан:
  DEBUG=False → по токену не пройти никому (403), работает только вход сотрудника;
  DEBUG=True  → пускаем с предупреждением в лог, чтобы локальное демо работало без настройки.

Нет учётных данных → 401 + WWW-Authenticate. Есть, но не подошли → 403.

Токен кабинета заведения (views_saas) сюда не имеет отношения: это другой контур.
"""
from __future__ import annotations

import hmac
import logging
import os

from django.conf import settings
from rest_framework.authentication import BaseAuthentication, SessionAuthentication
from rest_framework.exceptions import NotAuthenticated, PermissionDenied
from rest_framework.permissions import SAFE_METHODS, BasePermission

logger = logging.getLogger(__name__)

ADMIN_TOKEN_ENV = 'FT_ADMIN_TOKEN'


def admin_token() -> str:
    """Читаем при каждом запросе, а не при импорте: токен можно сменить без правки кода, а тесты — подменить."""
    return os.environ.get(ADMIN_TOKEN_ENV, '').strip()


def presented_tokens(request) -> list[str]:
    """Токены из запроса. Пустой список — заголовков нет вовсе (это 401, а не 403)."""
    found = []
    header = request.META.get('HTTP_AUTHORIZATION')
    if header is not None:
        scheme, _, value = header.strip().partition(' ')
        # Чужая схема (Basic и т.п.) — учётные данные предъявлены, но не наши: даст 403.
        found.append(value.strip() if scheme.lower() == 'bearer' else '')
    direct = request.META.get('HTTP_X_ADMIN_TOKEN')
    if direct is not None:
        found.append(direct.strip())
    return found


def _same(a: str, b: str) -> bool:
    # Сравнение за постоянное время; в байтах — compare_digest не принимает не-ASCII строки.
    return hmac.compare_digest(a.encode('utf-8'), b.encode('utf-8'))


class AdminTokenAuthentication(BaseAuthentication):
    """Сам никого не аутентифицирует (токен — не пользователь), решение принимает IsSommelierAdmin.

    Нужен, чтобы DRF отдал 401 с WWW-Authenticate: заголовок берётся у ПЕРВОГО аутентификатора,
    а у SessionAuthentication его нет — без этого класса 401 превращается в 403.
    """

    def authenticate(self, request):
        return None

    def authenticate_header(self, request):
        return 'Bearer realm="flavor-tree-admin"'


# Порядок важен: первый класс задаёт WWW-Authenticate, второй даёт вход сотрудника по сессии.
ADMIN_AUTHENTICATION = [AdminTokenAuthentication, SessionAuthentication]


class IsSommelierAdmin(BasePermission):
    """Токен FT_ADMIN_TOKEN или сотрудник Django. Проверяет токен сам — не зависит от аутентификаторов вьюхи."""

    def has_permission(self, request, view) -> bool:
        user = getattr(request, 'user', None)
        if user is not None and user.is_authenticated and user.is_staff:
            return True

        expected = admin_token()
        if not expected:
            if settings.DEBUG:
                logger.warning('%s не задан: %s %s открыт только потому, что DEBUG=True',
                               ADMIN_TOKEN_ENV, request.method, request.path)
                return True
            logger.error('%s не задан при DEBUG=False: %s %s отклонён', ADMIN_TOKEN_ENV, request.method, request.path)
            raise PermissionDenied(f'Служебный API закрыт: на сервере не задан {ADMIN_TOKEN_ENV}')

        tokens = presented_tokens(request)
        # Проверяем все предъявленные токены без раннего выхода.
        if any([_same(t, expected) for t in tokens]):
            return True
        if not tokens and not (user is not None and user.is_authenticated):
            raise NotAuthenticated('Нужен токен сомелье')
        raise PermissionDenied('Токен сомелье не подошёл' if tokens else 'Недостаточно прав')


class IsSommelierAdminOrReadOnly(IsSommelierAdmin):
    """Для справочников: читать можно всем, менять — только сомелье."""

    def has_permission(self, request, view) -> bool:
        return request.method in SAFE_METHODS or super().has_permission(request, view)


def sommelier_only(view):
    """Для функций-вьюх; ставится ПОД @api_view — тот читает эти атрибуты при оборачивании."""
    view.authentication_classes = ADMIN_AUTHENTICATION
    view.permission_classes = [IsSommelierAdmin]
    return view

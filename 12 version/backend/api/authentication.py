"""
Токен DRF со сроком жизни. Токен старше settings.FT_TOKEN_TTL_DAYS дней не принимается,
при следующем входе пользователь получает новый.
"""
from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework.authentication import TokenAuthentication
from rest_framework.exceptions import AuthenticationFailed

EXPIRED_MESSAGE = 'Сессия истекла, войдите снова'


def token_expired(token):
    days = getattr(settings, 'FT_TOKEN_TTL_DAYS', 0)
    return bool(days) and token.created < timezone.now() - timedelta(days=days)


class ExpiringTokenAuthentication(TokenAuthentication):
    def authenticate_credentials(self, key):
        user, token = super().authenticate_credentials(key)
        if token_expired(token):
            raise AuthenticationFailed(EXPIRED_MESSAGE)
        return user, token

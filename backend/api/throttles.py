"""
Ограничения частоты для входа, регистрации, смены пароля и заказов гостей.

Лимиты задаются в settings.THROTTLE_RATES (REST_FRAMEWORK['DEFAULT_THROTTLE_RATES']).
Если для scope лимита нет (своя машина и тесты), ограничение не действует.
Счётчики лежат в кэше; на Vercel это таблица базы, общая для всех инстансов.
"""
import logging

from rest_framework.settings import api_settings
from rest_framework.throttling import AnonRateThrottle, SimpleRateThrottle, UserRateThrottle

log = logging.getLogger(__name__)


class OptionalRateMixin:
    """Лимит берётся из настроек при каждом запросе; без лимита и при сбое кэша запрос пропускается."""

    def get_rate(self):
        return api_settings.DEFAULT_THROTTLE_RATES.get(self.scope)

    def allow_request(self, request, view):
        try:
            return super().allow_request(request, view)
        except Exception:
            # Не пустить гостя из-за сломанного кэша хуже, чем на минуту остаться без лимита.
            log.exception('Throttle %s: кэш недоступен, запрос пропущен без проверки', self.scope)
            return True


class LoginThrottle(OptionalRateMixin, AnonRateThrottle):
    """Попытки входа с одного IP: защита от подбора пароля."""
    scope = 'login'


class RegisterThrottle(OptionalRateMixin, AnonRateThrottle):
    """Регистрации с одного IP."""
    scope = 'register'


class PasswordChangeThrottle(OptionalRateMixin, UserRateThrottle):
    """Смена пароля: попытки угадать текущий пароль из чужой сессии."""
    scope = 'password'


class OrderCreateThrottle(OptionalRateMixin, SimpleRateThrottle):
    """Новые заказы с одного IP, со входом и без: иначе кухню можно завалить фальшивыми заказами."""
    scope = 'orders'

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}

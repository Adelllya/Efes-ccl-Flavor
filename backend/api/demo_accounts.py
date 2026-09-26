"""
Пароли демо-учёток из seed_roles (moderator, sommelier, restaurant, guest).

Публичные пароли из репозитория (moderator12345 и т.д.) работают только на своей машине:
DEBUG и локальная база. На сервере пароль берётся из переменной FT_PASSWORD_<ИМЯ>
(FT_PASSWORD_MODERATOR, FT_PASSWORD_RESTAURANT, ...), а без неё вход по паролю закрыт.

secure_public_passwords() вызывается при холодном старте на Vercel: если у демо-учётки
всё ещё публичный пароль (например, база перенесена с локальной машины), он заменяется,
а выданные токены отзываются.
"""
import hashlib
import logging
import os
import secrets

from django.conf import settings
from django.contrib.auth.models import User
from django.core.cache import cache
from django.utils.crypto import salted_hmac
from rest_framework.authtoken.models import Token

log = logging.getLogger(__name__)

LOCAL_HOSTS = ('', 'localhost', '127.0.0.1', '::1')
CHECKED_KEY = 'ft:demo-passwords-checked'


def demo_users():
    """{username: публичный пароль} из seed_roles.DEMO_USERS."""
    from api.management.commands.seed_roles import DEMO_USERS
    return {username: password for username, password, *_rest in DEMO_USERS}


def env_name(username):
    return 'FT_PASSWORD_' + username.upper()


def env_password(username):
    return os.environ.get(env_name(username), '').strip()


def local_demo_allowed():
    """Публичные демо-пароли допустимы только на своей машине: DEBUG, не Vercel и локальная база."""
    if not settings.DEBUG or os.environ.get('VERCEL'):
        return False
    db = settings.DATABASES['default']
    return 'sqlite' in db.get('ENGINE', '') or (db.get('HOST') or '') in LOCAL_HOSTS


def initial_password(username, public_password):
    """Пароль новой демо-учётки: из окружения, публичный (только локально) или None (вход закрыт)."""
    return env_password(username) or (public_password if local_demo_allowed() else None)


def apply_password(user, password):
    if password:
        user.set_password(password)
    else:
        user.set_unusable_password()


def revoke_tokens(users):
    """Удаляет токены входа: все устройства этих учёток выходят из системы. Возвращает число токенов."""
    deleted, _ = Token.objects.filter(user__in=users).delete()
    return deleted


def generate_password():
    return secrets.token_urlsafe(12)


def _state_digest(users):
    """
    Отпечаток хэшей паролей и переменных FT_PASSWORD_*: изменилось что-то одно, проверяем заново.
    Значение переменной входит только через HMAC на SECRET_KEY, чтобы по отпечатку его нельзя было подобрать.
    """
    raw = '|'.join(
        '{}:{}:{}'.format(u.username, u.password, salted_hmac('ft-demo-password', env_password(u.username)).hexdigest())
        for u in sorted(users, key=lambda u: u.username))
    return hashlib.sha256(raw.encode()).hexdigest()


def secure_public_passwords():
    """
    Для сервера: публичный пароль демо-учётки заменяется на FT_PASSWORD_<ИМЯ> (без переменной
    вход по паролю закрывается), токены этой учётки отзываются. Если вход закрыт, а переменная
    появилась, ставится пароль из неё. Возвращает список (username, что сделано).

    check_password дорогой (PBKDF2), поэтому уже проверенное состояние паролей запоминается
    в кэше (на Vercel это таблица базы) и при следующих холодных стартах не проверяется.
    """
    if local_demo_allowed():
        return []
    public = demo_users()
    users = list(User.objects.filter(username__in=public))
    if not users:
        return []
    digest = _state_digest(users)
    try:
        if cache.get(CHECKED_KEY) == digest:
            return []
    except Exception:
        log.warning('Кэш недоступен: проверяю пароли демо-учёток без него')

    changed = []
    for user in users:
        password = env_password(user.username)
        source = 'пароль из ' + env_name(user.username)
        if user.check_password(public[user.username]):
            apply_password(user, password)
            user.save(update_fields=['password'])
            revoke_tokens([user])
            changed.append((user.username, 'публичный пароль заменён: ' + (source if password else 'вход закрыт')))
        elif password and not user.has_usable_password():
            apply_password(user, password)
            user.save(update_fields=['password'])
            changed.append((user.username, source))
    try:
        cache.set(CHECKED_KEY, _state_digest(users), timeout=None)
    except Exception:
        pass
    for username, what in changed:
        log.warning('Демо-учётка %s: %s', username, what)
    return changed

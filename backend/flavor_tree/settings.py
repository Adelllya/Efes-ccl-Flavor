"""
Django settings for flavor_tree project.
"""

import os
import re
from pathlib import Path

from corsheaders.defaults import default_headers
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """backend/.env → os.environ, без сторонних пакетов. Образец — backend/.env.example.

    Формат: KEY=VALUE, строки с # — комментарии, кавычки вокруг значения необязательны,
    префикс `export ` допустим. Пустое значение = переменная не задана.
    Реальное окружение главнее файла: уже заданные переменные НЕ перезаписываются.
    Значения попадают в os.environ при импорте настроек, поэтому их видит и код,
    который читает окружение сам (api/ai.py → ANTHROPIC_API_KEY, api/auth.py → FT_ADMIN_TOKEN).
    """
    if not path.is_file():
        return
    for raw in path.read_text(encoding='utf-8-sig').splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('export '):
            line = line[7:].lstrip()
        key, sep, value = line.partition('=')
        key, value = key.strip(), value.strip()
        if not sep or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key):
            continue
        if value[:1] in ('"', "'"):
            end = value.find(value[0], 1)
            value = value[1:end] if end != -1 else value[1:]
        else:
            # хвостовой комментарий у значения без кавычек: KEY=value  # пояснение
            value = re.split(r'\s+#', value, maxsplit=1)[0].strip()
        if value:
            os.environ.setdefault(key, value)


_load_dotenv(BASE_DIR / '.env')


def _env_list(name: str) -> list[str]:
    return [v.strip() for v in os.environ.get(name, '').split(',') if v.strip()]


_DEV_SECRET_KEY = 'django-insecure-flavor-tree-dev-key-change-in-production'

SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY') or _DEV_SECRET_KEY

DEBUG = os.environ.get('DJANGO_DEBUG', 'True').lower() in ('true', '1', 'yes')

# Прод с ключом из репозитория не запускаем: им подписаны сессии и токены сброса пароля.
if not DEBUG and SECRET_KEY.startswith('django-insecure-'):
    raise ImproperlyConfigured(
        'DJANGO_DEBUG=False, а DJANGO_SECRET_KEY не задан (или это dev-ключ). '
        'Задайте свой ключ в окружении или в backend/.env — см. backend/.env.example.'
    )

# В разработке пускаем любой Host; в проде — только перечисленные в DJANGO_ALLOWED_HOSTS.
# Пустой список при DEBUG=False означает 400 на любой запрос — это безопаснее, чем '*'.
ALLOWED_HOSTS = _env_list('DJANGO_ALLOWED_HOSTS') or (['*'] if DEBUG else [])

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # Third party
    'rest_framework',
    'corsheaders',
    'django_filters',
    # Local
    'api',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'flavor_tree.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'flavor_tree.wsgi.application'

# Database — PostgreSQL на проде (DATABASE_URL или DB_*), SQLite локально по умолчанию
from urllib.parse import urlparse

_db_url = os.environ.get('DATABASE_URL', '')
if _db_url:
    _u = urlparse(_db_url)
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': _u.path.lstrip('/'),
            'USER': _u.username or '',
            'PASSWORD': _u.password or '',
            'HOST': _u.hostname or '127.0.0.1',
            'PORT': str(_u.port or 5432),
        }
    }
elif os.environ.get('DB_NAME'):
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': os.environ.get('DB_NAME', 'app_db'),
            'USER': os.environ.get('DB_USER', 'postgres'),
            'PASSWORD': os.environ.get('DB_PASSWORD', 'postgres'),
            'HOST': os.environ.get('DB_HOST', '127.0.0.1'),
            'PORT': os.environ.get('DB_PORT', '5432'),
        }
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }

# Канонические данные Flavor Tree (общие с фронтендом): /data/*.json
FLAVOR_DATA_DIR = Path(os.environ.get('FLAVOR_DATA_DIR', BASE_DIR.parent / 'data'))

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'ru-ru'
TIME_ZONE = 'Asia/Almaty'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# CORS settings — Angular dev server
CORS_ALLOWED_ORIGINS = [
    'http://localhost:4200',
    'http://127.0.0.1:4200',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
] + _env_list('CORS_ALLOWED_ORIGINS')
CORS_ALLOW_ALL_ORIGINS = DEBUG
# Authorization разрешён по умолчанию; X-Admin-Token — второй способ передать токен сомелье (api/auth.py)
CORS_ALLOW_HEADERS = (*default_headers, 'x-admin-token')

# REST Framework
REST_FRAMEWORK = {
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.AllowAny',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 20,
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ],
}

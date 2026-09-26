"""
Django settings for flavor_tree project.
"""

import os
import sys
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent


def load_dotenv(path):
    """
    Читает backend/.env: строки KEY=VALUE, комментарии и пустые строки пропускаются,
    кавычки вокруг значения не обязательны. Настоящие переменные окружения важнее файла,
    пустое значение в файле ничего не задаёт.
    """
    try:
        lines = Path(path).read_text(encoding='utf-8').splitlines()
    except OSError:
        return
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        if key and value:
            os.environ.setdefault(key, value)


load_dotenv(BASE_DIR / '.env')


def env_flag(name, default=False):
    value = os.environ.get(name, '').strip().lower()
    if not value:
        return default
    return value in ('true', '1', 'yes', 'on')


def env_list(name):
    return [item.strip() for item in os.environ.get(name, '').split(',') if item.strip()]


# Vercel сам ставит переменную VERCEL=1 во всех своих функциях.
ON_VERCEL = bool(os.environ.get('VERCEL'))

# Без явного DJANGO_DEBUG отладка включена только на своей машине, когда Django запущен
# через manage.py (runserver, test, команды). На Vercel и под gunicorn она выключена.
DEBUG = env_flag('DJANGO_DEBUG', default=not ON_VERCEL and Path(sys.argv[0]).name == 'manage.py')

SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', '').strip()
if not SECRET_KEY or SECRET_KEY.startswith('django-insecure'):
    if not DEBUG:
        raise ImproperlyConfigured(
            'Задайте DJANGO_SECRET_KEY: длинная случайная строка, например из '
            'python -c "import secrets; print(secrets.token_urlsafe(50))"')
    SECRET_KEY = SECRET_KEY or 'django-insecure-flavor-tree-dev-key-change-in-production'

# Домены через запятую в DJANGO_ALLOWED_HOSTS. На Vercel к ним добавляются адреса,
# которые Vercel сообщает сам: основной домен проекта, адрес ветки и конкретного деплоя.
ALLOWED_HOSTS = env_list('DJANGO_ALLOWED_HOSTS')
if ON_VERCEL:
    ALLOWED_HOSTS += [host for host in (
        os.environ.get('VERCEL_PROJECT_PRODUCTION_URL', ''),
        os.environ.get('VERCEL_BRANCH_URL', ''),
        os.environ.get('VERCEL_URL', ''),
    ) if host]
if not ALLOWED_HOSTS:
    ALLOWED_HOSTS = ['*'] if DEBUG else ['localhost', '127.0.0.1']

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # Third party
    'rest_framework',
    'rest_framework.authtoken',
    'corsheaders',
    'django_filters',
    # Local
    'api',
    # Загруженные фото в базе: на Vercel нет постоянного диска (см. STORAGES ниже)
    'media_db',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
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

# Database - PostgreSQL.
# На проде (Railway) подключаемся по DATABASE_URL, который выдаёт плагин Postgres.
# Локально — по отдельным переменным DB_* или их значениям по умолчанию.
# DATABASE_URL — общий стандарт; Vercel Postgres кладёт строку в POSTGRES_URL.
DATABASE_URL = (
    os.environ.get('DATABASE_URL')
    or os.environ.get('POSTGRES_URL_NON_POOLING')
    or os.environ.get('POSTGRES_URL')
)
if DATABASE_URL:
    import dj_database_url
    DATABASES = {
        # conn_health_checks: соединение, которое база закрыла за время простоя, заменяется новым, а не даёт 500
        'default': dj_database_url.parse(DATABASE_URL, conn_max_age=600, conn_health_checks=True, ssl_require=False)
    }
else:
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
# WhiteNoise: раздаёт статику Django (админка, DRF) прямо из приложения на проде.
STORAGES = {
    'default': {
        'BACKEND': 'django.core.files.storage.FileSystemStorage',
    },
    'staticfiles': {
        'BACKEND': 'whitenoise.storage.CompressedStaticFilesStorage',
    },
}

# На Vercel collectstatic не запускается, поэтому WhiteNoise берёт статику
# (админка, DRF) прямо из пакетов.
WHITENOISE_USE_FINDERS = True

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

# На Vercel диск функции только для чтения: новые фото (логотип, блюда, сорта) пишутся в базу
# (приложение media_db), а фото из репозитория по-прежнему читаются из media/.
# Локально файлы лежат на диске, как раньше. Переключить вручную: FT_MEDIA_IN_DB=1 или 0.
FT_MEDIA_IN_DB = env_flag('FT_MEDIA_IN_DB', default=ON_VERCEL)
if FT_MEDIA_IN_DB:
    STORAGES['default'] = {'BACKEND': 'media_db.storage.DatabaseStorage'}

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# CORS. Локальные адреса dev-сервера плюс дополнительные origin из окружения
# (например, домен фронтенда на Vercel), заданные через запятую в DJANGO_CORS_ALLOWED_ORIGINS.
CORS_ALLOWED_ORIGINS = [
    'http://localhost:4200',
    'http://127.0.0.1:4200',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:4201',
    'http://127.0.0.1:4201',
]
_extra_cors = os.environ.get('DJANGO_CORS_ALLOWED_ORIGINS', '')
CORS_ALLOWED_ORIGINS += [o.strip() for o in _extra_cors.split(',') if o.strip()]
CORS_ALLOW_ALL_ORIGINS = DEBUG

# CSRF: домены, которым доверяем для форм админки и session-запросов на проде (https).
# Задаются через запятую, каждый со схемой, напр. https://myapp.up.railway.app,https://myfront.vercel.app
_csrf_origins = os.environ.get('DJANGO_CSRF_TRUSTED_ORIGINS', '')
CSRF_TRUSTED_ORIGINS = [o.strip() for o in _csrf_origins.split(',') if o.strip()]

# За обратным прокси Railway/Vercel запрос приходит по https — сообщаем об этом Django,
# иначе ломаются CSRF-проверка админки и secure-cookie.
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

# Счётчики лимитов запросов (вход, регистрация, заказы, ИИ) живут в кэше. На Vercel у каждого
# инстанса функции своя память, поэтому там кэш общий, в таблице базы ft_cache.
# Таблицу создаёт холодный старт (index.py) или manage.py createcachetable.
if ON_VERCEL or env_flag('FT_DB_CACHE'):
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.db.DatabaseCache',
            'LOCATION': 'ft_cache',
            'OPTIONS': {'MAX_ENTRIES': 5000},
        }
    }

# Лимиты: ИИ ограничен всегда, вход, регистрация, смена пароля и заказы гостей только на сервере
# (на своей машине и в manage.py test их нет, даже с DJANGO_DEBUG=False). Значения: переменные FT_RATE_*.
TESTING = len(sys.argv) > 1 and sys.argv[1] == 'test'
THROTTLE_RATES = {
    'ai': '30/min',
    'ai_user': '60/min',
}
if not DEBUG and not TESTING:
    THROTTLE_RATES.update({
        'login': os.environ.get('FT_RATE_LOGIN', '10/min'),
        'register': os.environ.get('FT_RATE_REGISTER', '10/hour'),
        'password': os.environ.get('FT_RATE_PASSWORD', '10/hour'),
        # Гости бара часто сидят в одном Wi-Fi, то есть за одним IP: лимит с запасом.
        'orders': os.environ.get('FT_RATE_ORDERS', '60/hour'),
    })

# REST Framework
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        # Токен DRF с ограниченным сроком жизни (FT_TOKEN_TTL_DAYS, по умолчанию 30 дней)
        'api.authentication.ExpiringTokenAuthentication',
        'rest_framework.authentication.SessionAuthentication',
    ],
    # Чтение открыто всем, доступ на запись задаётся в каждой view отдельно.
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
    # Глобальное ограничение не включаем: классы throttle указаны в самих view.
    'DEFAULT_THROTTLE_RATES': THROTTLE_RATES,
}
if not DEBUG:
    # На сервере API отвечает только JSON: HTML-страницы DRF там не нужны.
    REST_FRAMEWORK['DEFAULT_RENDERER_CLASSES'] = ['rest_framework.renderers.JSONRenderer']
if ON_VERCEL:
    # Перед функцией один прокси Vercel: IP гостя последний в X-Forwarded-For.
    # Без этого лимиты обходятся подделкой заголовка.
    REST_FRAMEWORK['NUM_PROXIES'] = int(os.environ.get('DJANGO_NUM_PROXIES', '1'))

# Срок жизни токена входа в днях. 0 - бессрочно.
FT_TOKEN_TTL_DAYS = int(os.environ.get('FT_TOKEN_TTL_DAYS', '30'))

# ИИ-сомелье. Ключ ANTHROPIC_API_KEY берётся из окружения или backend/.env и в настройках не хранится;
# без ключа работает локальный подбор. Модель можно заменить через FT_AI_MODEL.
FT_AI_MODEL = os.environ.get('FT_AI_MODEL', 'claude-opus-5')
# Сколько ответов Claude можно за сутки (по Алматы) на весь сервис; дальше отвечает вкусовой движок.
# 0 выключает Claude. Число разбирает ai_usage.daily_limit(), поэтому опечатка не роняет весь бэкенд.
FT_AI_DAILY_LIMIT = os.environ.get('FT_AI_DAILY_LIMIT', '300')

# Адрес сайта (фронтенда), на который ведут QR-коды столов: FT_PUBLIC_SITE_URL/menu/<slug>?table=N&src=qr.
# На проде задать обязательно, например https://<домен-фронта>.vercel.app. Пусто: берётся сайт,
# с которого открыли картинку QR (Origin или Referer), а в DEBUG - http://localhost:4200.
FT_PUBLIC_SITE_URL = os.environ.get('FT_PUBLIC_SITE_URL', '').strip().rstrip('/')

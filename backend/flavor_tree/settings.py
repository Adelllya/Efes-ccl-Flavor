"""
Django settings for flavor_tree project.
"""

import hashlib
import os
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

# Отладка включается только явно (DJANGO_DEBUG=True в backend/.env для локальной работы).
# Забытая переменная на сервере не должна открывать страницу отладки с настройками.
DEBUG = os.environ.get('DJANGO_DEBUG', 'False').lower() in ('true', '1', 'yes')

# Строка подключения к базе. Имя со строчной буквы: так её не видит страница отладки Django.
# DATABASE_URL - общий стандарт; Vercel Postgres кладёт строку в POSTGRES_URL.
_database_url = (
    os.environ.get('DATABASE_URL')
    or os.environ.get('POSTGRES_URL_NON_POOLING')
    or os.environ.get('POSTGRES_URL')
)

SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', '').strip()
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = 'django-insecure-flavor-tree-dev-key-change-in-production'
    elif _database_url:
        # Ключ не задан: берём производный от строки базы. Он не лежит в репозитории
        # и одинаков у всех экземпляров сервера. Лучше всё же задать DJANGO_SECRET_KEY.
        SECRET_KEY = hashlib.sha256(('flavor-tree:' + _database_url).encode('utf-8')).hexdigest()
    else:
        raise ImproperlyConfigured('Задайте DJANGO_SECRET_KEY (или DJANGO_DEBUG=True для локальной работы)')

_default_hosts = '*' if DEBUG else '.vercel.app,.railway.app,localhost,127.0.0.1,[::1]'
ALLOWED_HOSTS = [h.strip() for h in os.environ.get('DJANGO_ALLOWED_HOSTS', _default_hosts).split(',') if h.strip()]

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
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'api.middleware.RejectNulMiddleware',
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
# На проде подключаемся по строке из окружения (см. _database_url выше).
# Локально - по отдельным переменным DB_* или их значениям по умолчанию.
if _database_url:
    import dj_database_url
    DATABASES = {
        # Проверка соединения перед запросом: база на серверлесс-тарифе засыпает,
        # и тёплый экземпляр иначе отдавал бы 500 на оборванном соединении.
        'default': dj_database_url.parse(_database_url, conn_max_age=600, conn_health_checks=True, ssl_require=False)
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
        # Файлы на диске; если диск только для чтения (Vercel), загрузка уходит в базу.
        'BACKEND': 'api.storage.MediaStorage',
    },
    'staticfiles': {
        'BACKEND': 'whitenoise.storage.CompressedStaticFilesStorage',
    },
}

# Там, где collectstatic не запускается (Vercel), WhiteNoise берёт статику
# админки и DRF прямо из пакетов.
WHITENOISE_USE_FINDERS = True

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

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
    'https://flavor-tree-frontend.vercel.app',
]
_extra_cors = os.environ.get('DJANGO_CORS_ALLOWED_ORIGINS', '')
CORS_ALLOWED_ORIGINS += [o.strip() for o in _extra_cors.split(',') if o.strip()]
# Пробные выкладки фронтенда на Vercel получают адреса вида flavor-tree-<хвост>.vercel.app.
CORS_ALLOWED_ORIGIN_REGEXES = [r'^https://flavor-tree-[a-z0-9-]+\.vercel\.app$']
CORS_ALLOW_ALL_ORIGINS = DEBUG

# CSRF: домены, которым доверяем для форм админки и session-запросов на проде (https).
# Задаются через запятую, каждый со схемой, напр. https://myapp.up.railway.app,https://myfront.vercel.app
_csrf_origins = os.environ.get('DJANGO_CSRF_TRUSTED_ORIGINS', '')
CSRF_TRUSTED_ORIGINS = ['https://flavor-tree-backend.vercel.app']
CSRF_TRUSTED_ORIGINS += [o.strip() for o in _csrf_origins.split(',') if o.strip()]

# За обратным прокси Railway/Vercel запрос приходит по https — сообщаем об этом Django,
# иначе ломаются CSRF-проверка админки и secure-cookie.
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

# REST Framework
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.TokenAuthentication',
        'rest_framework.authentication.SessionAuthentication',
    ],
    # Чтение открыто всем, доступ на запись задаётся в каждой view отдельно.
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.AllowAny',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 20,
    # Общий OrderingFilter не подключаем: он принимал в ?ordering= любое поле сериализатора
    # и падал с 500 на вычисляемых. Сортировку каждая view разбирает сама.
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
    ],
    # Лимиты запросов к ИИ-сомелье. Глобальное ограничение не включаем:
    # классы throttle указаны только в самой view.
    'DEFAULT_THROTTLE_RATES': {
        'ai': '30/min',
        'ai_user': '60/min',
        # Фото дороже текста: гостю по фото, панели по распознаванию и подбору.
        'ai_photo': '12/hour',
        'ai_photo_user': '40/hour',
        'ai_vision': '90/hour',
        # Вход, регистрация и смена пароля: перебор паролей и массовая регистрация.
        'auth': '20/min',
        # Заказы гостей без входа.
        'orders': '30/min',
        # Оценки пар: гость голосует без входа.
        'feedback': '40/min',
    },
}

# ИИ-сомелье. Ключ ANTHROPIC_API_KEY берётся из окружения или backend/.env и в настройках не хранится;
# без ключа работает локальный подбор. Модель можно заменить через FT_AI_MODEL.
FT_AI_MODEL = os.environ.get('FT_AI_MODEL', '').strip() or 'claude-opus-5-5'

# Журнал: без него ошибки 500 на сервере не оставляют следа, кроме кода ответа.
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'short': {'format': '%(levelname)s %(name)s: %(message)s'},
    },
    'handlers': {
        'console': {'class': 'logging.StreamHandler', 'formatter': 'short'},
    },
    'loggers': {
        'django.request': {'handlers': ['console'], 'level': 'ERROR', 'propagate': False},
        'api': {'handlers': ['console'], 'level': 'INFO', 'propagate': False},
        'flavor_tree': {'handlers': ['console'], 'level': 'INFO', 'propagate': False},
    },
}

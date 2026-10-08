"""Точка входа для Vercel (@vercel/python). Отдаёт WSGI-приложение Django.

На Vercel нельзя запустить manage.py руками, поэтому при холодном старте
бекенд сам готовит базу: применяет новые миграции, создаёт таблицу кэша для лимитов,
а если база пустая, заливает роли и данные. Пароль от базы при этом не покидает Vercel.

Данные в непустой базе этот файл никогда не стирает.
Демо-учётки получают пароли только из FT_PASSWORD_<ИМЯ>, без переменной вход по паролю закрыт.
"""
import logging
import os
import sys

# При сборке из git Vercel берёт корень репозитория (см. vercel.json в корне), и этот файл лежит
# в backend/, а не в корне деплоя. Чтобы нашлись flavor_tree и api, добавляем свою папку в sys.path.
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'flavor_tree.settings')

import django  # noqa: E402

django.setup()

log = logging.getLogger('flavor_tree.bootstrap')

# Порядок для пустой базы: seed заводит ноты и курсы (и временные демо-сорта),
# load_flavor_data заменяет демо-сорта на 17 настоящих и заливает блюда с парами,
# seed_roles последним, потому что демо-заведению нужны готовые блюда и сорта.
SEED_COMMANDS = ('seed', 'load_flavor_data', 'seed_roles')


def _bootstrap_db():
    from django.core.management import call_command
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor

    executor = MigrationExecutor(connection)
    if executor.migration_plan(executor.loader.graph.leaf_nodes()):
        _step('migrate', call_command, 'migrate', interactive=False, verbosity=0)
    # Таблица общего кэша (лимиты запросов). Если она уже есть, это один запрос к списку таблиц.
    _step('createcachetable', call_command, 'createcachetable', verbosity=0)

    loaded = _step('snapshot', _load_snapshot)

    from api.models import Brand
    if not loaded and not Brand.objects.exists():
        for cmd in SEED_COMMANDS:
            _step(cmd, call_command, cmd, verbosity=0)

    from api.demo_accounts import secure_public_passwords
    _step('demo passwords', secure_public_passwords)
    _step('media map', _apply_media_map)


def _step(name, func, *args, **kwargs):
    """Один шаг подготовки: ошибка пишется в лог и не мешает остальным шагам."""
    try:
        return func(*args, **kwargs)
    except Exception:
        log.exception('Bootstrap step %s failed', name)
        return None


def _database_is_empty():
    """В базе нет ни пользователей, ни каталога, ни заведений, ни заказов."""
    from django.contrib.auth.models import User

    from api.models import Brand, Dish, FlavorNote, Order, Venue

    return not any(model.objects.exists() for model in (User, Brand, Dish, FlavorNote, Venue, Order))


def _load_snapshot(path=None):
    """Переносит на сервер копию локальной базы из data/snapshot.json, но только в пустую базу.

    Снимок делается локально командой dumpdata и в git не хранится (в нём хэши паролей),
    в деплой не попадает (backend/.vercelignore). Загрузка идёт, только если в окружении
    FT_LOAD_SNAPSHOT=1, файл есть в деплое и база пустая. В непустую базу снимок
    не заливается никогда: так деплой не может стереть заказы и данные пилота.
    Возвращает True, если снимок загружен.
    """
    from pathlib import Path

    from django.core.management import call_command
    from django.db import connection, transaction

    path = Path(path or Path(__file__).parent / 'data' / 'snapshot.json')
    if os.environ.get('FT_LOAD_SNAPSHOT') != '1' or not path.exists():
        return False
    if not _database_is_empty():
        log.warning('Snapshot skipped: database is not empty, nothing is overwritten')
        return False
    with transaction.atomic():
        if connection.vendor == 'postgresql':
            # Два инстанса, стартующих одновременно, не зальют снимок дважды.
            with connection.cursor() as cur:
                cur.execute('SELECT pg_advisory_xact_lock(%s)', [0x46545342])
        if not _database_is_empty():
            return False
        call_command('flush', interactive=False, verbosity=0)
        call_command('loaddata', str(path), verbosity=0)
    log.warning('Loaded database snapshot into an empty database')
    return True


def _apply_media_map():
    """Проставляет пути к картинкам из data/media_map.json, если поле пустое.

    Файлы лежат в media/ внутри деплоя, а в базе нужны только пути к ним.
    """
    import json
    from pathlib import Path

    from django.db.models import Q

    from api.models import Brand, Dish, FoodIcon

    mapping = json.loads((Path(__file__).parent / 'data' / 'media_map.json').read_text(encoding='utf-8'))
    for model, key in ((Brand, 'brands'), (Dish, 'dishes'), (FoodIcon, 'food_icons')):
        entries = mapping.get(key, {})
        if not entries:
            continue
        fields = {f for v in entries.values() for f in v}
        empty = Q()
        for f in fields:
            empty |= Q(**{f: ''}) | Q(**{f + '__isnull': True})
        for obj in model.objects.filter(empty, name__in=entries.keys()):
            changed = {f: path for f, path in entries[obj.name].items() if not getattr(obj, f)}
            if changed:
                # update() вместо save(): save() пересобирает миниатюры,
                # а на Vercel диск только для чтения.
                model.objects.filter(pk=obj.pk).update(**changed)


if os.environ.get('VERCEL'):
    try:
        _bootstrap_db()
    except Exception:
        log.exception('Database bootstrap failed')

from flavor_tree.wsgi import application  # noqa: E402

app = application

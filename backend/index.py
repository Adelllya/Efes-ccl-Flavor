"""Точка входа для Vercel (@vercel/python). Отдаёт WSGI-приложение Django.

На Vercel нельзя запустить manage.py руками, поэтому при холодном старте
бекенд сам готовит базу: применяет новые миграции, а если база пустая,
заливает роли и данные. Пароль от базы при этом не покидает Vercel.
"""
import logging
import os

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'flavor_tree.settings')

import django  # noqa: E402

django.setup()

log = logging.getLogger('flavor_tree.bootstrap')


def _bootstrap_db():
    from django.core.management import call_command
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor

    executor = MigrationExecutor(connection)
    if executor.migration_plan(executor.loader.graph.leaf_nodes()):
        call_command('migrate', interactive=False, verbosity=0)

    from api.models import Brand
    if not Brand.objects.exists():
        # Порядок из BACKEND_DOCUMENTATION.md: seed чистит ноты, поэтому идёт первым,
        # load_flavor_data заменяет демо-сорта на 17 настоящих и заливает пары с блюдами.
        for cmd in ('seed_roles', 'seed', 'load_flavor_data'):
            try:
                call_command(cmd, verbosity=0)
            except Exception:
                log.exception('Bootstrap command %s failed', cmd)
    _apply_media_map()


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

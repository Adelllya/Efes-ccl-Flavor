import json
from pathlib import Path

from django.conf import settings
from django.core.files import File
from django.core.management.base import BaseCommand

from api.models import Dish


class Command(BaseCommand):
    """Подставляет блюдам фото со свободной лицензией из data/dish_photos.json.

    Файлы берём из папки с картинками (по умолчанию соседняя копия проекта),
    совпадение ищем по названию блюда. Уже загруженные фото не трогаем,
    если не передан --force.
    """

    help = 'Импорт фото блюд по названиям из data/dish_photos.json'

    def add_arguments(self, parser):
        parser.add_argument('--images', default='/Users/ailachu/Documents/projects2026/Flavor_github/frontend/public/img/dishes',
                            help='Папка с файлами <slug>.webp')
        parser.add_argument('--force', action='store_true', help='Заменить и уже загруженные фото')

    def handle(self, *args, **options):
        base = Path(settings.BASE_DIR) / 'data'
        photos = json.loads((base / 'dish_photos.json').read_text(encoding='utf-8'))
        names = json.loads((base / 'dishes_names.json').read_text(encoding='utf-8'))
        images = Path(options['images'])

        # Название -> slug: сначала из dish_photos.json, затем из списка блюд
        by_name = {}
        for slug, info in photos.items():
            if slug == '_meta':
                continue
            for key in (info.get('name'),):
                if key:
                    by_name[key.strip().lower()] = slug
        for row in names:
            for key in (row.get('name'), row.get('display_name')):
                if key and row.get('id') in photos:
                    by_name.setdefault(key.strip().lower(), row['id'])

        done = skipped = missing = 0
        for dish in Dish.objects.all().order_by('name'):
            if dish.photo and not options['force']:
                skipped += 1
                continue
            slug = by_name.get(dish.name.strip().lower())
            if not slug:
                # Совпадение по началу: "Суши (нигири)" -> "суши"
                short = dish.name.split('(')[0].strip().lower()
                slug = by_name.get(short)
            src = images / f'{slug}.webp' if slug else None
            if not slug or not src.exists():
                missing += 1
                self.stdout.write(f'  нет фото: {dish.name}')
                continue
            with src.open('rb') as fh:
                dish.photo.save(f'{slug}.webp', File(fh), save=True)
            done += 1
        self.stdout.write(f'Фото загружено: {done}, пропущено (уже есть): {skipped}, не найдено: {missing}')

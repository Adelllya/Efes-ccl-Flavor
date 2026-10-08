"""
python manage.py regen_brand_thumbs

Пересобирает уменьшенную копию (image) из оригинала (image_hd) у всех сортов,
где оригинал есть. Команду можно запускать повторно.
"""
from django.core.management.base import BaseCommand

from api.images import regenerate_brand_thumb
from api.models import Brand


def with_file(field_name):
    return Brand.objects.exclude(**{field_name: ''}).exclude(**{field_name + '__isnull': True})


class Command(BaseCommand):
    help = 'Пересобирает image из image_hd для всех сортов с оригиналом (идемпотентно)'

    def report(self, label):
        self.stdout.write('{}: с image {}, с image_hd {}, всего сортов {}'.format(
            label, with_file('image').count(), with_file('image_hd').count(), Brand.objects.count()))

    def handle(self, *args, **options):
        self.report('До')
        done = failed = 0
        for brand in with_file('image_hd').order_by('name'):
            try:
                regenerate_brand_thumb(brand)
            except Exception as exc:  # оригинал мог пропасть с диска
                failed += 1
                self.stderr.write('  {}: не удалось ({})'.format(brand.name, exc))
                continue
            done += 1
            self.stdout.write('  {}: {}'.format(brand.name, brand.image.name))
        self.report('После')
        self.stdout.write(self.style.SUCCESS('Готово: пересобрано {}, ошибок {}'.format(done, failed)))

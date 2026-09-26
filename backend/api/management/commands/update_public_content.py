"""
python manage.py update_public_content

Приводит уже заполненную базу к честным публичным данным (api/public_content.py):
- команда: убирает выдуманных «экспертов» старого seed, добавляет настоящих сооснователей;
- школа: курсы с текстом старого seed заменяет описаниями без обещаний сертификатов и чужих стандартов;
- пирамиды: подпись «Главный Сомелье Efes» меняет на «Команда Flavor Tree»;
- ноты: убирает английские подписи в скобках из названий, пары: английские слова из объяснений;
- сорта: пустую крепость берёт из каталога движка, пустое фото из data/media_map.json;
- демо-заведение: название «Демо-бар Flavor Tree», без выдуманных адреса и телефона,
  и то же имя у демо-аккаунта restaurant.

Ничего не пересоздаёт и не трогает правки, которые сделали люди. Можно запускать повторно,
в том числе на проде: DATABASE_URL="<строка>" python manage.py update_public_content
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from api import public_content


class Command(BaseCommand):
    help = 'Честные публичные данные: команда, курсы, подписи пирамид, крепость и фото сортов, демо-заведение'

    @transaction.atomic
    def handle(self, *args, **options):
        removed = public_content.sync_team()
        self.stdout.write(f'Команда: убрано выдуманных записей {removed}, в команде {len(public_content.TEAM)} человека')
        courses = public_content.sync_courses()
        self.stdout.write(f'Курсы: обновлено {courses}')
        relabeled = public_content.relabel_profiles()
        self.stdout.write(f'Пирамиды: подпись исправлена у {relabeled} нот')
        renamed = public_content.rename_notes()
        self.stdout.write(f'Ноты: переименовано {renamed}')
        texts = public_content.fix_pairing_texts()
        self.stdout.write(f'Пары: исправлено объяснений {texts}')
        filled = public_content.backfill_brands()
        self.stdout.write(f'Сорта: крепость дополнена у {filled["abv"]}, фото у {filled["images"]}')
        venue = public_content.fix_demo_venue()
        self.stdout.write('Демо-заведение: ' + ('исправлено' if venue else 'без изменений'))
        self.stdout.write(self.style.SUCCESS('Готово'))

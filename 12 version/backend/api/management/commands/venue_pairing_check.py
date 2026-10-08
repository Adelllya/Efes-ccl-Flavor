"""
Проверка подбора в меню заведения перед пилотом: что гость увидит у каждого блюда.

    python manage.py venue_pairing_check --venue efes-beer-garden

По каждой позиции: с каким блюдом движка v2 связано блюдо (по названию, по части названия
или по похожему блюду каталога), статус подбора и до трёх напитков из карты бара с баллом.
В конце список блюд без единого напитка для заказа. Гость у них увидит честную подпись и ссылку
на карту напитков; если это неожиданно, назовите блюдо как в базе подбора или добавьте в карту
подходящий напиток (например, безалкогольный или чай к десерту).
"""
from django.core.management.base import BaseCommand, CommandError

from api.models import Venue
from api.serializers import build_venue_menu

STATUS_LABELS = {
    'ok': 'есть сильная пара',
    'weak': 'сильной пары в карте нет',
    'none': 'нечего предложить',
    'no_drinks': 'карта напитков пустая',
}
MATCH_LABELS = {'exact': 'по названию', 'partial': 'по части названия', 'similar': 'по похожему блюду'}


class Command(BaseCommand):
    help = 'Что советует подбор к каждому блюду меню заведения и где он заводит в тупик.'

    def add_arguments(self, parser):
        parser.add_argument('--venue', required=True, help='slug заведения')

    def handle(self, *args, **options):
        venue = Venue.objects.filter(slug=options['venue']).first()
        if venue is None:
            raise CommandError('Заведение не найдено: %s' % options['venue'])
        menu = build_venue_menu(venue, None)
        drinks = [d for d in menu['drinks'] if d['is_available']]
        self.stdout.write('%s: %d напитков в наличии из %d в карте' % (venue.name, len(drinks), len(menu['drinks'])))

        dead = []
        counts = {}
        for section in menu['sections']:
            self.stdout.write('\n[%s]' % section['name'])
            for entry in section['items']:
                info = entry['pairing_info']
                counts[info['status']] = counts.get(info['status'], 0) + 1
                if info['engine_dish']:
                    how = MATCH_LABELS.get(info['dish_match'], '')
                    if info['based_on']:
                        how += ' «%s»' % info['based_on']
                    dish = '%s (%s)' % (info['engine_dish_name'] or info['engine_dish'], how)
                else:
                    dish = 'не найдено в движке'
                self.stdout.write('%s -> %s: %s' % (entry['dish']['name'], dish, STATUS_LABELS[info['status']]))
                for rec in entry['recommendations']:
                    score = '%s из 100' % rec['score'] if rec['score'] is not None else 'без балла движка'
                    source = 'команда %s/5' % rec['team_rating'] if rec['source'] == 'TEAM' else 'движок'
                    self.stdout.write('    %d. %s: %s, %s' % (rec['rank'], rec['brand_name'], score, source))
                if not entry['recommendations'] and info['status'] != 'no_drinks':
                    dead.append(entry['dish']['name'])

        self.stdout.write('\nИтого: ' + ', '.join('%s %d' % (STATUS_LABELS[k], v) for k, v in sorted(counts.items())))
        if dead:
            self.stdout.write('Без напитка для заказа: ' + ', '.join(dead))

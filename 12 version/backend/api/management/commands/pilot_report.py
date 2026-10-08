"""
Отчёт пилота в терминале и CSV для слайдов.

    python manage.py pilot_report --venue efes-beer-garden --from 2026-10-01 --to 2026-10-10 --csv ../pilot-out

Цифры те же, что в GET /api/pilot/report/. С --csv в папку пишутся events.csv, orders.csv,
feedback.csv, by_day.csv и top_pairs.csv (UTF-8 с BOM, разделитель ;). Без --venue - все заведения.
"""
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from api import pilot_report
from api.models import Venue

TOTAL_LABELS = (
    ('sessions', 'Гостей (сессий)'),
    ('scans', 'Сканов QR'),
    ('menu_opens', 'Открытий меню'),
    ('pair_opens', 'Открытий подбора'),
    ('pair_adds', 'Добавлений из подбора'),
    ('ai_asks', 'Вопросов ИИ-сомелье'),
    ('ai_adds', 'Добавлений из чата ИИ'),
    ('orders', 'Заказов'),
    ('orders_with_pairing', 'Заказов с напитком из подбора'),
    ('orders_cancelled', 'Отменённых заказов'),
    ('items', 'Позиций в заказах'),
    ('items_from_pairing', 'Позиций из подбора'),
    ('share_items_from_pairing', 'Доля позиций из подбора'),
    ('drinks', 'Напитков в заказах'),
    ('drinks_from_pairing', 'Напитков из подбора'),
    ('share_drinks_from_pairing', 'Доля напитков из подбора'),
    ('avg_check', 'Средний чек, тг'),
    ('avg_check_with_pairing', 'Средний чек с подбором, тг'),
    ('avg_check_without_pairing', 'Средний чек без подбора, тг'),
    ('revenue', 'Сумма заказов, тг'),
    ('feedback_count', 'Оценок пар'),
    ('avg_rating', 'Средняя оценка'),
)


def fmt(key, value):
    if value is None:
        return 'нет данных'
    if key.startswith('share_'):
        return '{:.1f}%'.format(value * 100)
    return str(value)


class Command(BaseCommand):
    help = 'Цифры пилота по заведению за период и выгрузка CSV'

    def add_arguments(self, parser):
        parser.add_argument('--venue', help='slug заведения; без него - все заведения')
        parser.add_argument('--from', dest='date_from', help='первый день, ГГГГ-ММ-ДД (по Алматы)')
        parser.add_argument('--to', dest='date_to', help='последний день, ГГГГ-ММ-ДД (по Алматы)')
        parser.add_argument('--csv', dest='csv_dir', help='папка для CSV-файлов')

    def handle(self, *args, **options):
        venue = None
        if options.get('venue'):
            venue = Venue.objects.filter(slug=options['venue']).first()
            if venue is None:
                raise CommandError('Заведение {} не найдено'.format(options['venue']))
        try:
            date_from, date_to = pilot_report.parse_period(options.get('date_from'), options.get('date_to'), venue)
        except ValueError as exc:
            raise CommandError(str(exc))

        report = pilot_report.build_report(venue, date_from, date_to)
        title = '{} ({})'.format(venue.name, venue.slug) if venue else 'все заведения'
        self.stdout.write('Отчёт пилота: {}, {} - {}, время Алматы'.format(title, date_from, date_to))
        totals = report['totals']
        for key, label in TOTAL_LABELS:
            self.stdout.write('  {}: {}'.format(label, fmt(key, totals.get(key))))
        self.stdout.write('Воронка (уникальные гости):')
        for step in report['funnel']:
            self.stdout.write('  {}: {}'.format(step['label'], step['count']))
        if report['top_pairs']:
            self.stdout.write('Лучшие пары:')
            for pair in report['top_pairs'][:10]:
                rating = ', оценка {}'.format(pair['avg_rating']) if pair['avg_rating'] is not None else ''
                self.stdout.write('  {} + {}: открыли {}, добавили {}, заказали {}{}'.format(
                    pair['dish'], pair['drink'], pair['opens'], pair['adds'], pair['ordered'], rating))

        if options.get('csv_dir'):
            folder = Path(options['csv_dir'])
            folder.mkdir(parents=True, exist_ok=True)
            tables = {kind: pilot_report.export_rows(kind, venue, date_from, date_to)
                      for kind in pilot_report.EXPORT_KINDS}
            tables.update(pilot_report.summary_rows(report))
            for name, (header, rows) in tables.items():
                path = folder / '{}.csv'.format(name)
                path.write_text(pilot_report.csv_text(header, rows), encoding='utf-8', newline='')
                self.stdout.write('CSV: {} ({} строк)'.format(path, len(rows)))

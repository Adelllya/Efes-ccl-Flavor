"""
Отчёт пилота: воронка гостя, заказы с подбором и без, дни, столы, лучшие пары и оценки гостей.
Одна и та же логика для GET /api/pilot/report/, выгрузки CSV и команды manage.py pilot_report.

Как считаем:
- гость = сессия браузера (ft_sid) из событий и заказов;
- заказы без отменённых; позиция «из подбора» - source PAIRING (панель «Подобрать напиток») или AI (чат);
- доли - число от 0 до 1, средний чек в тенге; где делить не на что, там null;
- дни и границы периода по времени Алматы, период включает обе даты.
"""
import csv
import io
import json
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.db.models import Min, Prefetch
from django.utils import timezone

from .engine_catalog import engine_dish, engine_drink
from .models import Brand, Dish, MenuDrink, MenuItem, Order, OrderItem, PairingFeedback, PilotEvent
from .pilot import RECOMMENDED_SOURCES

REPORT_TZ = ZoneInfo('Asia/Almaty')
MAX_DAYS = 366
TOP_PAIRS = 20
RECENT_FEEDBACK = 20
EXPORT_KINDS = ('events', 'orders', 'feedback')

FUNNEL = (
    ('scan', 'Отсканировали QR'),
    ('menu_open', 'Открыли меню'),
    ('pair_open', 'Открыли подбор напитка'),
    ('pair_add', 'Добавили напиток из подбора'),
    ('order', 'Отправили заказ'),
    ('order_with_pairing', 'Заказали напиток из подбора'),
)


# Период

def local_today():
    return timezone.now().astimezone(REPORT_TZ).date()


def local_date(moment):
    return moment.astimezone(REPORT_TZ).date()


def bounds(date_from, date_to):
    """Начало первого дня и начало дня после последнего, по Алматы."""
    start = datetime.combine(date_from, time.min, tzinfo=REPORT_TZ)
    end = datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=REPORT_TZ)
    return start, end


def _parse_date(value, name):
    try:
        return date.fromisoformat(str(value).strip())
    except ValueError:
        raise ValueError('{}: дата в формате ГГГГ-ММ-ДД'.format(name))


def first_activity(venue):
    """Первый день, когда у заведения было событие, заказ или оценка."""
    firsts = []
    for model in (PilotEvent, Order, PairingFeedback):
        qs = model.objects.all()
        if venue is not None:
            qs = qs.filter(venue=venue)
        first = qs.aggregate(first=Min('created_at'))['first']
        if first:
            firsts.append(local_date(first))
    return min(firsts) if firsts else None


def parse_period(raw_from, raw_to, venue):
    """
    Даты отчёта. Без to - сегодня, без from - первый день с данными (но не раньше года до to).
    Ошибки - ValueError с текстом для ответа 400.
    """
    date_to = _parse_date(raw_to, 'to') if raw_to else local_today()
    if raw_from:
        date_from = _parse_date(raw_from, 'from')
    else:
        date_from = first_activity(venue) or date_to
        date_from = min(max(date_from, date_to - timedelta(days=MAX_DAYS - 1)), date_to)
    if date_from > date_to:
        raise ValueError('Дата from позже даты to')
    if (date_to - date_from).days + 1 > MAX_DAYS:
        raise ValueError('Период не длиннее {} дней'.format(MAX_DAYS))
    return date_from, date_to


# Названия блюд и напитков из ссылок событий и оценок

def _as_uuid(value):
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


class Labels:
    """
    dish_ref и drink_ref бывают id позиции меню или напитка карты, id блюда или сорта каталога,
    id из базы движка или просто название. Приводим всё к названию, с кэшем на отчёт.
    """

    def __init__(self):
        self._dish = {}
        self._drink = {}

    def dish(self, ref):
        ref = (ref or '').strip()
        if not ref:
            return ''
        if ref not in self._dish:
            self._dish[ref] = self._resolve_dish(ref)
        return self._dish[ref]

    def drink(self, ref):
        ref = (ref or '').strip()
        if not ref:
            return ''
        if ref not in self._drink:
            self._drink[ref] = self._resolve_drink(ref)
        return self._drink[ref]

    @staticmethod
    def _resolve_dish(ref):
        pk = _as_uuid(ref)
        if pk is not None:
            item = MenuItem.objects.select_related('dish').filter(pk=pk).first()
            if item is not None:
                return item.dish.name
            dish = Dish.objects.filter(pk=pk).first()
            return dish.name if dish is not None else ref
        raw = engine_dish(ref)
        return (raw.get('display_name') or raw.get('name') or ref) if raw else ref

    @staticmethod
    def _resolve_drink(ref):
        pk = _as_uuid(ref)
        if pk is not None:
            drink = MenuDrink.objects.select_related('brand').filter(pk=pk).first()
            if drink is not None:
                return drink.display_name
            brand = Brand.objects.filter(pk=pk).first()
            return brand.name if brand is not None else ref
        raw = engine_drink(ref)
        return (raw.get('display_name') or raw.get('name') or ref) if raw else ref

    def event_dish(self, event):
        if event.menu_item_id and event.menu_item is not None:
            return event.menu_item.dish.name
        return self.dish(event.dish_ref)

    def event_drink(self, event):
        if event.menu_drink_id and event.menu_drink is not None:
            return event.menu_drink.display_name
        return self.drink(event.drink_ref)


# Выборки

def scoped(queryset, venue, start, end):
    queryset = queryset.filter(created_at__gte=start, created_at__lt=end)
    return queryset.filter(venue=venue) if venue is not None else queryset


def load_events(venue, start, end):
    return list(
        scoped(PilotEvent.objects.all(), venue, start, end)
        .select_related('venue', 'menu_item__dish', 'menu_drink__brand')
        .order_by('created_at', 'id')
    )


def load_orders(venue, start, end):
    items = OrderItem.objects.select_related('paired_menu_item__dish').order_by('id')
    return list(
        scoped(Order.objects.all(), venue, start, end)
        .select_related('venue').prefetch_related(Prefetch('items', queryset=items))
        .order_by('created_at', 'number')
    )


def load_feedback(venue, start, end):
    return list(
        scoped(PairingFeedback.objects.all(), venue, start, end)
        .select_related('venue', 'order').order_by('-created_at', '-id')
    )


# Отчёт

def _avg(values):
    values = list(values)
    if not values:
        return None
    return round(float(sum(values, Decimal('0')) / len(values)), 2)


def _share(part, whole):
    return round(part / whole, 3) if whole else None


def _is_recommended(item):
    return item.source in RECOMMENDED_SOURCES


def build_report(venue, date_from, date_to):
    start, end = bounds(date_from, date_to)
    labels = Labels()
    events = load_events(venue, start, end)
    orders = load_orders(venue, start, end)
    feedback = load_feedback(venue, start, end)
    live = [o for o in orders if o.status != Order.STATUS_CANCELLED]

    kinds = Counter(e.kind for e in events)
    kind_sessions = defaultdict(set)
    for event in events:
        if event.session:
            kind_sessions[event.kind].add(event.session)
    sessions = set(e.session for e in events if e.session) | set(o.session for o in orders if o.session)

    # Заказы: с подсказкой Flavor Tree и без неё.
    with_rec, without_rec = [], []
    items = items_rec = items_ai = drinks = drinks_rec = 0
    for order in live:
        lines = list(order.items.all())
        (with_rec if any(_is_recommended(i) for i in lines) else without_rec).append(order)
        for line in lines:
            items += line.qty
            if _is_recommended(line):
                items_rec += line.qty
            if line.source == OrderItem.SOURCE_AI:
                items_ai += line.qty
            if line.kind == OrderItem.KIND_DRINK:
                drinks += line.qty
                if _is_recommended(line):
                    drinks_rec += line.qty
    ratings = [f.rating for f in feedback]

    totals = {
        'sessions': len(sessions),
        'scans': kinds[PilotEvent.KIND_SCAN],
        'menu_opens': kinds[PilotEvent.KIND_MENU_OPEN],
        'pair_opens': kinds[PilotEvent.KIND_PAIR_OPEN],
        'pair_adds': kinds[PilotEvent.KIND_PAIR_ADD],
        'orders': len(live),
        'orders_with_pairing': len(with_rec),
        'items': items,
        'items_from_pairing': items_rec,
        'share_items_from_pairing': _share(items_rec, items),
        'avg_check': _avg(o.total for o in live),
        'avg_check_with_pairing': _avg(o.total for o in with_rec),
        'avg_check_without_pairing': _avg(o.total for o in without_rec),
        'feedback_count': len(feedback),
        'avg_rating': round(sum(ratings) / len(ratings), 2) if ratings else None,
        'ai_asks': kinds[PilotEvent.KIND_AI_ASK],
        'ai_adds': kinds[PilotEvent.KIND_AI_ADD],
        # Дополнительно к контракту: для слайдов и проверки цифр.
        'age_confirmations': kinds[PilotEvent.KIND_AGE_OK],
        'orders_cancelled': len(orders) - len(live),
        'items_from_ai': items_ai,
        'drinks': drinks,
        'drinks_from_pairing': drinks_rec,
        'share_drinks_from_pairing': _share(drinks_rec, drinks),
        'revenue': round(float(sum((o.total for o in live), Decimal('0'))), 2),
    }

    def order_guests(order_list):
        # Заказ без сессии (старый фронтенд) считаем отдельным гостем.
        return len(set(o.session for o in order_list if o.session)) + sum(1 for o in order_list if not o.session)

    funnel_counts = {
        'scan': len(kind_sessions[PilotEvent.KIND_SCAN]),
        'menu_open': len(kind_sessions[PilotEvent.KIND_MENU_OPEN]),
        'pair_open': len(kind_sessions[PilotEvent.KIND_PAIR_OPEN]),
        'pair_add': len(kind_sessions[PilotEvent.KIND_PAIR_ADD]),
        'order': order_guests(live),
        'order_with_pairing': order_guests(with_rec),
    }
    funnel = [{'step': step, 'label': label, 'count': funnel_counts[step]} for step, label in FUNNEL]

    return {
        'venue': {'slug': venue.slug, 'name': venue.name} if venue is not None else None,
        'period': {'from': date_from.isoformat(), 'to': date_to.isoformat(), 'tz': 'Asia/Almaty'},
        'totals': totals,
        'funnel': funnel,
        'by_day': _by_day(date_from, date_to, events, orders, live, with_rec),
        'by_table': _by_table(events, orders, live),
        'top_pairs': _top_pairs(labels, events, live, feedback),
        'feedback': [_feedback_row(labels, f) for f in feedback[:RECENT_FEEDBACK]],
    }


def _by_day(date_from, date_to, events, orders, live, with_rec):
    days = {}
    day = date_from
    while day <= date_to:
        days[day] = {'sessions': set(), 'scans': 0, 'pair_opens': 0, 'pair_adds': 0,
                     'orders': 0, 'orders_with_pairing': 0, 'totals': []}
        day += timedelta(days=1)
    for event in events:
        row = days.get(local_date(event.created_at))
        if row is None:
            continue
        if event.session:
            row['sessions'].add(event.session)
        if event.kind == PilotEvent.KIND_SCAN:
            row['scans'] += 1
        elif event.kind == PilotEvent.KIND_PAIR_OPEN:
            row['pair_opens'] += 1
        elif event.kind == PilotEvent.KIND_PAIR_ADD:
            row['pair_adds'] += 1
    for order in orders:
        row = days.get(local_date(order.created_at))
        if row is not None and order.session:
            row['sessions'].add(order.session)
    rec_ids = set(o.pk for o in with_rec)
    for order in live:
        row = days.get(local_date(order.created_at))
        if row is None:
            continue
        row['orders'] += 1
        row['orders_with_pairing'] += 1 if order.pk in rec_ids else 0
        row['totals'].append(order.total)
    return [{
        'date': day.isoformat(),
        'sessions': len(row['sessions']),
        'scans': row['scans'],
        'pair_opens': row['pair_opens'],
        'pair_adds': row['pair_adds'],
        'orders': row['orders'],
        'orders_with_pairing': row['orders_with_pairing'],
        'avg_check': _avg(row['totals']),
        'revenue': round(float(sum(row['totals'], Decimal('0'))), 2),
    } for day, row in days.items()]


def _by_table(events, orders, live):
    tables = defaultdict(lambda: {'sessions': set(), 'scans': 0, 'orders': 0})
    for event in events:
        if event.table_number is None:
            continue
        row = tables[event.table_number]
        if event.session:
            row['sessions'].add(event.session)
        if event.kind == PilotEvent.KIND_SCAN:
            row['scans'] += 1
    for order in orders:
        if order.session:
            tables[order.table_number]['sessions'].add(order.session)
    for order in live:
        tables[order.table_number]['orders'] += 1
    return [{'table': table, 'sessions': len(row['sessions']), 'scans': row['scans'], 'orders': row['orders']}
            for table, row in sorted(tables.items())]


def _top_pairs(labels, events, live, feedback):
    pairs = {}

    def pair(dish, drink):
        if not dish or not drink:
            return None
        key = (dish.casefold(), drink.casefold())
        if key not in pairs:
            pairs[key] = {'dish': dish, 'drink': drink, 'opens': 0, 'adds': 0, 'ordered': 0, 'ratings': []}
        return pairs[key]

    for event in events:
        if event.kind not in (PilotEvent.KIND_PAIR_OPEN, PilotEvent.KIND_PAIR_ADD):
            continue
        row = pair(labels.event_dish(event), labels.event_drink(event))
        if row is not None:
            row['opens' if event.kind == PilotEvent.KIND_PAIR_OPEN else 'adds'] += 1
    for order in live:
        for line in order.items.all():
            if line.kind != OrderItem.KIND_DRINK or not _is_recommended(line) or line.paired_menu_item is None:
                continue
            row = pair(line.paired_menu_item.dish.name, line.title)
            if row is not None:
                row['ordered'] += line.qty
    for item in feedback:
        row = pair(labels.dish(item.dish_ref), labels.drink(item.drink_ref))
        if row is not None:
            row['ratings'].append(item.rating)

    ranked = sorted(pairs.values(), key=lambda p: (
        -p['ordered'], -p['adds'], -p['opens'], -len(p['ratings']), p['dish'], p['drink']))
    return [{
        'dish': p['dish'],
        'drink': p['drink'],
        'opens': p['opens'],
        'adds': p['adds'],
        'ordered': p['ordered'],
        'avg_rating': round(sum(p['ratings']) / len(p['ratings']), 2) if p['ratings'] else None,
        'ratings': len(p['ratings']),
    } for p in ranked[:TOP_PAIRS]]


def _feedback_row(labels, item):
    return {
        'created_at': item.created_at.astimezone(REPORT_TZ).isoformat(timespec='seconds'),
        'dish': labels.dish(item.dish_ref),
        'drink': labels.drink(item.drink_ref),
        'rating': item.rating,
        'comment': item.comment,
        'order_number': item.order.number if item.order_id and item.order is not None else None,
    }


# CSV

def num_cell(value, decimal_comma=True):
    """Число для Excel: целое без хвоста .00, дробное с запятой, если разделитель столбцов ;."""
    if value is None or value == '':
        return ''
    value = Decimal(str(value))
    if value == value.to_integral_value():
        return str(int(value))
    text = format(value.quantize(Decimal('0.01')).normalize(), 'f')
    return text.replace('.', ',') if decimal_comma else text


def safe_cell(value):
    """Текст, который Excel принял бы за формулу, прячем за апострофом."""
    if isinstance(value, str) and value[:1] in ('=', '+', '-', '@', '\t', '\r'):
        return "'" + value
    return value


def local_stamp(moment):
    return moment.astimezone(REPORT_TZ).strftime('%Y-%m-%d %H:%M:%S')


def export_rows(kind, venue, date_from, date_to, decimal_comma=True):
    """Заголовок и строки для выгрузки events, orders или feedback. Имени гостя и комментария к заказу нет."""
    start, end = bounds(date_from, date_to)
    labels = Labels()
    if kind == 'events':
        header = ['Время', 'Заведение', 'Сессия', 'Событие', 'Код события', 'Стол',
                  'Блюдо', 'Напиток', 'Место в подборе', 'Источник', 'Подробности']
        rows = [[
            local_stamp(e.created_at), e.venue.slug if e.venue_id and e.venue else '', e.session,
            e.get_kind_display(), e.kind, e.table_number if e.table_number is not None else '',
            labels.event_dish(e), labels.event_drink(e), e.rank if e.rank is not None else '', e.source,
            json.dumps(e.meta, ensure_ascii=False) if e.meta else '',
        ] for e in load_events(venue, start, end)]
        return header, rows
    if kind == 'orders':
        header = ['Время', 'Заведение', 'Заказ №', 'Статус', 'Стол', 'Сессия', 'Возраст подтверждён',
                  'Сумма заказа', 'Тип позиции', 'Позиция', 'Кол-во', 'Цена', 'Откуда', 'Подобрано к блюду',
                  'Место в подборе']
        rows = []
        for order in load_orders(venue, start, end):
            for line in order.items.all():
                rows.append([
                    local_stamp(order.created_at), order.venue.slug, order.number, order.get_status_display(),
                    order.table_number, order.session, 'да' if order.age_confirmed else 'нет',
                    num_cell(order.total, decimal_comma), line.get_kind_display(), line.title, line.qty,
                    num_cell(line.price, decimal_comma), line.get_source_display(),
                    line.paired_menu_item.dish.name if line.paired_menu_item is not None else '',
                    line.rec_rank if line.rec_rank is not None else '',
                ])
        return header, rows
    if kind == 'feedback':
        header = ['Время', 'Заведение', 'Заказ №', 'Стол', 'Сессия', 'Блюдо', 'Напиток', 'Оценка', 'Комментарий']
        rows = [[
            local_stamp(f.created_at), f.venue.slug if f.venue_id and f.venue else '',
            f.order.number if f.order_id and f.order else '',
            f.order.table_number if f.order_id and f.order else '', f.session,
            labels.dish(f.dish_ref), labels.drink(f.drink_ref), f.rating, f.comment,
        ] for f in reversed(load_feedback(venue, start, end))]
        return header, rows
    raise ValueError('kind: events, orders или feedback')


def csv_text(header, rows, delimiter=';'):
    """CSV с BOM: Excel без него показывает кириллицу кракозябрами. Разделитель ; - для русского Excel."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=delimiter, lineterminator='\r\n')
    writer.writerow(header)
    for row in rows:
        writer.writerow([safe_cell(cell) for cell in row])
    return '﻿' + buffer.getvalue()


def summary_rows(report, decimal_comma=True):
    """Дни и лучшие пары из отчёта - для CSV команды pilot_report."""
    days = (['Дата', 'Гостей', 'Сканов', 'Открыли подбор', 'Добавили из подбора', 'Заказов',
             'Заказов с подбором', 'Средний чек', 'Выручка'],
            [[d['date'], d['sessions'], d['scans'], d['pair_opens'], d['pair_adds'], d['orders'],
              d['orders_with_pairing'], num_cell(d['avg_check'], decimal_comma), num_cell(d['revenue'], decimal_comma)]
             for d in report['by_day']])
    pairs = (['Блюдо', 'Напиток', 'Открыли', 'Добавили', 'Заказали', 'Средняя оценка', 'Оценок'],
             [[p['dish'], p['drink'], p['opens'], p['adds'], p['ordered'],
               num_cell(p['avg_rating'], decimal_comma), p['ratings']]
              for p in report['top_pairs']])
    return {'by_day': days, 'top_pairs': pairs}

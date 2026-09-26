"""
События пилота. record_event() зовут другие view (заказ, оценка пары, ИИ-сомелье):
запись события не должна ломать основное действие, поэтому функция никогда не бросает исключение.
"""
import json
import logging
import re

from django.db import transaction
from django.db.models import F

from .models import OrderItem, PilotEvent, QRCode

logger = logging.getLogger(__name__)

EVENT_KINDS = frozenset(kind for kind, _ in PilotEvent.KIND_CHOICES)
# Заказ и оценку пишет сервер сам (views_orders, views_pilot.feedback); из браузера их не принимаем,
# иначе заказ посчитается дважды.
SERVER_ONLY_KINDS = frozenset({PilotEvent.KIND_ORDER, PilotEvent.KIND_FEEDBACK})
CLIENT_KINDS = EVENT_KINDS - SERVER_ONLY_KINDS

# Подсказка Flavor Tree: панель «Подобрать напиток» и чат ИИ-сомелье.
RECOMMENDED_SOURCES = (OrderItem.SOURCE_PAIRING, OrderItem.SOURCE_AI)

SESSION_MAX = 36
REF_MAX = 64
SOURCE_MAX = 16
META_MAX_CHARS = 2000
RANK_MAX = 999
_SESSION_RE = re.compile(r'^[A-Za-z0-9_-]{1,%d}$' % SESSION_MAX)
_EVENT_FIELDS = frozenset({
    'table_number', 'menu_item', 'menu_item_id', 'menu_drink', 'menu_drink_id',
    'dish_ref', 'drink_ref', 'rank', 'source', 'meta',
})


def clean_session(value):
    """id браузера из localStorage (ft_sid). Всё, что на него не похоже, превращаем в пустую строку."""
    value = str(value or '').strip()
    return value if _SESSION_RE.match(value) else ''


def clean_ref(value):
    return str(value or '').strip()[:REF_MAX]


def clean_source(value):
    return str(value or '').strip().upper()[:SOURCE_MAX]


def clean_rank(value):
    if isinstance(value, bool):
        return None
    try:
        rank = int(value)
    except (TypeError, ValueError):
        return None
    return rank if 0 <= rank <= RANK_MAX else None


def clean_meta(value):
    """Только объект и не больше пары килобайт: meta для подробностей, а не для чужих данных."""
    if not isinstance(value, dict):
        return {}
    try:
        text = json.dumps(value, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return {}
    if len(text) > META_MAX_CHARS:
        return {'truncated': True}
    return json.loads(text)


def build_event(kind, *, venue=None, session='', **fields):
    """Несохранённое событие с очищенными полями; неизвестные поля и тип - ValueError."""
    if kind not in EVENT_KINDS:
        raise ValueError('Неизвестное событие: {}'.format(kind))
    unknown = set(fields) - _EVENT_FIELDS
    if unknown:
        raise ValueError('Неизвестные поля события: {}'.format(', '.join(sorted(unknown))))
    for key in ('dish_ref', 'drink_ref'):
        if key in fields:
            fields[key] = clean_ref(fields[key])
    if 'source' in fields:
        fields['source'] = clean_source(fields['source'])
    if 'rank' in fields:
        fields['rank'] = clean_rank(fields['rank'])
    if 'meta' in fields:
        fields['meta'] = clean_meta(fields['meta'])
    return PilotEvent(kind=kind, venue=venue, session=clean_session(session), **fields)


def count_qr_scans(events):
    """Скан со стола увеличивает счётчик QR-кода этого стола, если такой код заведён в админке."""
    for event in events:
        if event.kind == PilotEvent.KIND_SCAN and event.venue_id and event.table_number:
            QRCode.objects.filter(venue_id=event.venue_id, table_number=event.table_number).update(
                scans_count=F('scans_count') + 1)


def record_event(kind, *, venue=None, session='', **fields):
    """
    Записать одно событие пилота. Никогда не бросает исключение: ошибку пишет в лог и возвращает None.
    Поля: table_number, menu_item, menu_drink, dish_ref, drink_ref, rank, source, meta.
    """
    try:
        event = build_event(kind, venue=venue, session=session, **fields)
        # Своя точка сохранения: сбой записи не откатывает внешнюю транзакцию вызывающего кода.
        with transaction.atomic():
            event.save()
            count_qr_scans([event])
        return event
    except Exception:  # noqa: BLE001 - событие пилота не должно ломать основное действие
        logger.exception('Пилот: событие %s не записано', kind)
        return None


def record_order_event(order, lines=None):
    """Событие ORDER для только что созданного заказа: номер, сумма, стол, сессия и откуда каждая позиция."""
    try:
        items = lines if lines is not None else list(order.items.all())
        meta = {
            'order': str(order.id),
            'number': order.number,
            'total': '{:.2f}'.format(order.total),
            'age_confirmed': order.age_confirmed,
            'items': [{
                'kind': item.kind,
                'id': str(item.menu_item_id or item.menu_drink_id or ''),
                'qty': item.qty,
                'source': item.source,
                'paired_with': str(item.paired_menu_item_id) if item.paired_menu_item_id else None,
                'rank': item.rec_rank,
            } for item in items],
        }
        recommended = any(item.source in RECOMMENDED_SOURCES for item in items)
        table = order.table_number if 0 <= order.table_number <= 32767 else None
    except Exception:  # noqa: BLE001
        logger.exception('Пилот: не удалось собрать событие заказа %s', getattr(order, 'id', '?'))
        return None
    return record_event(
        PilotEvent.KIND_ORDER, venue=order.venue, session=order.session, table_number=table,
        source=OrderItem.SOURCE_PAIRING if recommended else OrderItem.SOURCE_MENU, meta=meta,
    )

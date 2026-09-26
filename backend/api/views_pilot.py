"""
Пилот в баре: события гостя, оценка пары, отчёт, выгрузка CSV и QR-коды столов.

POST /api/events/                          - гость без входа: пачка до 20 событий, ответ 204
POST /api/feedback/                        - гость без входа: оценка пары 1-5 и комментарий, ответ 201
GET  /api/pilot/report/?venue=&from=&to=   - владелец заведения или модератор: цифры пилота
GET  /api/pilot/export.csv?venue=&kind=    - то же построчно в CSV: events, orders или feedback
GET  /api/venues/<slug>/qr.svg?table=N     - QR-код стола со ссылкой на меню

События и оценку принимаем и как application/json, и как text/plain с JSON внутри:
navigator.sendBeacon отправляет строку именно так и без предварительного CORS-запроса.
"""
import io
from urllib.parse import urlencode, urlsplit

import segno
from django.conf import settings
from django.db import transaction
from django.http import HttpResponse
from rest_framework import serializers, status
from rest_framework.decorators import (
    api_view, authentication_classes, parser_classes, permission_classes, throttle_classes,
)
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.negotiation import BaseContentNegotiation
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.settings import api_settings
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from . import pilot_report
from .models import MenuDrink, MenuItem, Order, PairingFeedback, PilotEvent, Venue
from .permissions import ROLE_MODERATOR, has_role
from .pilot import CLIENT_KINDS, build_event, clean_ref, clean_session, count_qr_scans, record_event
from .serializers import parse_uuid
from .views_orders import find_venue

MAX_EVENTS = 20
MAX_TABLE = 32767
COMMENT_MAX = 500


class PlainTextJSONParser(JSONParser):
    """navigator.sendBeacon со строкой шлёт text/plain: внутри тот же JSON."""
    media_type = 'text/plain'


class PilotRateThrottle(SimpleRateThrottle):
    """
    Лимит по IP для анонимных эндпоинтов пилота. Частоту можно поменять
    в REST_FRAMEWORK['DEFAULT_THROTTLE_RATES'] по имени scope, иначе берётся default_rate.
    """
    default_rate = None

    def get_rate(self):
        return api_settings.DEFAULT_THROTTLE_RATES.get(self.scope) or self.default_rate

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}


class EventsThrottle(PilotRateThrottle):
    # С запасом: в баре гости часто сидят в одном Wi-Fi, то есть за одним IP.
    scope = 'events'
    default_rate = '240/min'


class FeedbackThrottle(PilotRateThrottle):
    scope = 'feedback'
    default_rate = '20/min'


class IgnoreAcceptNegotiation(BaseContentNegotiation):
    """Картинка и файл отдаются как есть, даже если клиент просит только image/svg+xml или text/csv."""

    def select_parser(self, request, parsers):
        return parsers[0]

    def select_renderer(self, request, renderers, format_suffix=None):
        return renderers[0], renderers[0].media_type


def _venue_by_slug(value):
    slug = str(value or '').strip()
    return Venue.objects.filter(slug=slug).first() if slug else None


def _table(value, venue):
    if isinstance(value, bool):
        return None
    try:
        table = int(value)
    except (TypeError, ValueError):
        return None
    limit = venue.tables_count if venue is not None else MAX_TABLE
    return table if 0 <= table <= min(limit, MAX_TABLE) else None


def _can_manage(user, venue):
    return bool(user and user.is_authenticated and (has_role(user, ROLE_MODERATOR) or venue.owner_id == user.id))


# События

@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([EventsThrottle])
@parser_classes([JSONParser, PlainTextJSONParser])
def events(request):
    """
    {session, venue: slug, events: [{kind, table, menu_item, menu_drink, dish_ref, drink_ref, rank, source, meta}]}.
    Неизвестные типы и кривые поля молча пропускаем: аналитика не должна мешать гостю.
    ORDER и FEEDBACK пишет сервер сам, из браузера они не принимаются.
    """
    data = request.data if isinstance(request.data, dict) else {}
    raw_events = data.get('events')
    if not isinstance(raw_events, list):
        raise ValidationError({'events': ['Ожидается список событий']})
    if len(raw_events) > MAX_EVENTS:
        raise ValidationError({'events': ['Не больше {} событий за раз'.format(MAX_EVENTS)]})
    venue = _venue_by_slug(data.get('venue'))
    session = clean_session(data.get('session'))
    raw_events = [e for e in raw_events if isinstance(e, dict)]

    # Позиции меню и напитки ищем одним запросом и только в карте этого заведения.
    items, drinks = {}, {}
    if venue is not None:
        item_ids = set(filter(None, (parse_uuid(e.get('menu_item')) for e in raw_events if e.get('menu_item'))))
        drink_ids = set(filter(None, (parse_uuid(e.get('menu_drink')) for e in raw_events if e.get('menu_drink'))))
        if item_ids:
            items = {i.pk: i for i in MenuItem.objects.filter(venue=venue, pk__in=item_ids)}
        if drink_ids:
            drinks = {d.pk: d for d in MenuDrink.objects.filter(venue=venue, pk__in=drink_ids)}

    batch = []
    for raw in raw_events:
        kind = str(raw.get('kind') or '').strip().upper()
        if kind not in CLIENT_KINDS:
            continue
        menu_item = items.get(parse_uuid(raw.get('menu_item')))
        menu_drink = drinks.get(parse_uuid(raw.get('menu_drink')))
        # Позицию не нашли в карте: id всё равно сохраняем ссылкой, чтобы не потерять.
        dish_ref = clean_ref(raw.get('dish_ref')) or ('' if menu_item else clean_ref(raw.get('menu_item')))
        drink_ref = clean_ref(raw.get('drink_ref')) or ('' if menu_drink else clean_ref(raw.get('menu_drink')))
        batch.append(build_event(
            kind, venue=venue, session=session,
            table_number=_table(raw.get('table'), venue),
            menu_item=menu_item, menu_drink=menu_drink,
            dish_ref=dish_ref, drink_ref=drink_ref,
            rank=raw.get('rank'), source=raw.get('source'), meta=raw.get('meta'),
        ))
    if batch:
        with transaction.atomic():
            PilotEvent.objects.bulk_create(batch)
            count_qr_scans(batch)
    return Response(status=status.HTTP_204_NO_CONTENT)


# Оценка пары

class FeedbackSerializer(serializers.Serializer):
    session = serializers.CharField(required=False, allow_blank=True, allow_null=True, default='')
    venue = serializers.CharField(required=False, allow_blank=True, allow_null=True, default='')
    order = serializers.CharField(required=False, allow_blank=True, allow_null=True, default='')
    dish_ref = serializers.CharField(required=False, allow_blank=True, allow_null=True, default='')
    drink_ref = serializers.CharField(required=False, allow_blank=True, allow_null=True, default='')
    rating = serializers.IntegerField(min_value=1, max_value=5, error_messages={
        'min_value': 'Оценка от 1 до 5', 'max_value': 'Оценка от 1 до 5',
        'invalid': 'Оценка от 1 до 5', 'required': 'Поставьте оценку от 1 до 5',
        'null': 'Поставьте оценку от 1 до 5',
    })
    comment = serializers.CharField(required=False, allow_blank=True, allow_null=True, default='',
                                    trim_whitespace=True)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([FeedbackThrottle])
@parser_classes([JSONParser, PlainTextJSONParser])
def feedback(request):
    """
    {session, venue: slug, order: id, dish_ref, drink_ref, rating: 1..5, comment} -> 201.
    Заказ привязываем, только если он из того же заведения; без venue заведение берём из заказа.
    """
    serializer = FeedbackSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    venue = _venue_by_slug(data.get('venue'))
    order_id = parse_uuid(data.get('order'))
    order = Order.objects.select_related('venue').filter(pk=order_id).first() if order_id else None
    if order is not None:
        if venue is None:
            venue = order.venue
        elif order.venue_id != venue.pk:
            order = None
    session = clean_session(data.get('session')) or (order.session if order is not None else '')
    item = PairingFeedback.objects.create(
        venue=venue, order=order, session=session,
        dish_ref=clean_ref(data.get('dish_ref')), drink_ref=clean_ref(data.get('drink_ref')),
        rating=data['rating'], comment=(data.get('comment') or '').strip()[:COMMENT_MAX],
    )
    meta = {'feedback': item.pk, 'rating': item.rating}
    if order is not None:
        meta['order'] = str(order.pk)
    record_event(
        PilotEvent.KIND_FEEDBACK, venue=venue, session=session,
        table_number=order.table_number if order is not None and order.table_number >= 0 else None,
        dish_ref=item.dish_ref, drink_ref=item.drink_ref, meta=meta,
    )
    return Response({'id': item.pk, 'rating': item.rating}, status=status.HTTP_201_CREATED)


# Отчёт и выгрузка

def report_venue(request):
    """
    Заведение для отчёта. Модератор - любое или все сразу (без ?venue=),
    владелец - только своё; без ?venue= берём его заведение. Остальным 403.
    """
    user = request.user
    is_moderator = has_role(user, ROLE_MODERATOR)
    raw = (request.query_params.get('venue') or '').strip()
    if raw:
        venue = find_venue(raw)
        if venue is None:
            raise NotFound('Заведение не найдено')
        if not (is_moderator or venue.owner_id == user.id):
            raise PermissionDenied('Отчёт пилота видят владелец заведения и модератор')
        return venue
    if is_moderator:
        return None
    venue = Venue.objects.filter(owner=user).order_by('name').first()
    if venue is None:
        raise PermissionDenied('Отчёт пилота видят владелец заведения и модератор')
    return venue


def report_period(request, venue):
    try:
        return pilot_report.parse_period(
            request.query_params.get('from'), request.query_params.get('to'), venue)
    except ValueError as exc:
        raise ValidationError({'detail': str(exc)})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def report(request):
    venue = report_venue(request)
    date_from, date_to = report_period(request, venue)
    return Response(pilot_report.build_report(venue, date_from, date_to))


class ExportCsvView(APIView):
    """CSV для Excel: UTF-8 с BOM, разделитель ; (или , при ?sep=comma)."""
    permission_classes = [IsAuthenticated]
    content_negotiation_class = IgnoreAcceptNegotiation

    def get(self, request):
        venue = report_venue(request)
        date_from, date_to = report_period(request, venue)
        kind = (request.query_params.get('kind') or 'orders').strip().lower()
        if kind not in pilot_report.EXPORT_KINDS:
            raise ValidationError({'kind': ['Выгрузка бывает events, orders или feedback']})
        comma = (request.query_params.get('sep') or '').strip().lower() in ('comma', ',')
        header, rows = pilot_report.export_rows(kind, venue, date_from, date_to, decimal_comma=not comma)
        text = pilot_report.csv_text(header, rows, delimiter=',' if comma else ';')
        name = 'pilot-{}-{}-{}-{}.csv'.format(
            venue.slug if venue is not None else 'all', kind, date_from.isoformat(), date_to.isoformat())
        response = HttpResponse(text.encode('utf-8'), content_type='text/csv; charset=utf-8')
        response['Content-Disposition'] = 'attachment; filename="{}"'.format(name)
        return response


# QR-коды столов

def _origin(value):
    parts = urlsplit(str(value or '').strip())
    if parts.scheme in ('http', 'https') and parts.netloc:
        return '{}://{}'.format(parts.scheme, parts.netloc)
    return ''


LOCAL_HOSTS = ('localhost', '127.0.0.1')


def public_site_url(request):
    """
    Адрес сайта с меню. FT_PUBLIC_SITE_URL из окружения важнее всего; без него - сайт,
    с которого пришёл запрос (Origin или Referer, если это не сам бэкенд), потом домен фронтенда
    из DJANGO_CORS_ALLOWED_ORIGINS; в DEBUG - localhost:4200.
    """
    configured = (getattr(settings, 'FT_PUBLIC_SITE_URL', '') or '').strip().rstrip('/')
    if configured:
        return configured
    own_host = request.get_host()
    for header in ('HTTP_ORIGIN', 'HTTP_REFERER'):
        origin = _origin(request.META.get(header))
        if origin and urlsplit(origin).netloc != own_host:
            return origin
    for allowed in getattr(settings, 'CORS_ALLOWED_ORIGINS', []):
        origin = _origin(allowed)
        if origin and urlsplit(origin).hostname not in LOCAL_HOSTS:
            return origin
    return 'http://localhost:4200' if settings.DEBUG else ''


def menu_url(site, slug, table=None):
    query = {'table': table, 'src': 'qr'} if table else {'src': 'qr'}
    return '{}/menu/{}?{}'.format(site.rstrip('/'), slug, urlencode(query))


class VenueQrView(APIView):
    """SVG с QR-кодом. ?table=N - номер стола, ?download=1 - отдать файлом."""
    permission_classes = [AllowAny]
    content_negotiation_class = IgnoreAcceptNegotiation

    def get(self, request, slug):
        venue = Venue.objects.filter(slug=slug).first()
        if venue is None or not (venue.is_published or _can_manage(request.user, venue)):
            raise NotFound('Заведение не найдено')
        raw_table = (request.query_params.get('table') or '').strip()
        table = None
        if raw_table:
            table = _table(raw_table, venue)
            if not table:
                raise ValidationError({'table': ['Стол от 1 до {}'.format(venue.tables_count)]})
        site = public_site_url(request)
        if not site:
            return Response({'detail': 'Не задан адрес сайта для QR: укажите FT_PUBLIC_SITE_URL'},
                            status=status.HTTP_503_SERVICE_UNAVAILABLE)
        title = '{}, стол {}'.format(venue.name, table) if table else venue.name
        buffer = io.BytesIO()
        # Уровень коррекции M: код читается и с чуть помятой или поцарапанной таблички.
        segno.make_qr(menu_url(site, venue.slug, table), error='m').save(
            buffer, kind='svg', scale=10, border=4, xmldecl=False, title=title)
        response = HttpResponse(buffer.getvalue(), content_type='image/svg+xml')
        response['Cache-Control'] = 'private, max-age=300'
        if request.query_params.get('download') in ('1', 'true', 'yes'):
            name = 'qr-{}-{}.svg'.format(venue.slug, 'table-{}'.format(table) if table else 'menu')
            response['Content-Disposition'] = 'attachment; filename="{}"'.format(name)
        return response

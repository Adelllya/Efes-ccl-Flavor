"""SaaS-API Flavor Tree для заведений (то, за что платит бар).

Публичное (без авторизации):
  GET  /api/menu/<slug>/                меню заведения: брендинг, позиции, цены, стоп-лист
  POST /api/track/                      событие гостя (скан, просмотр, «заказать»)
  POST /api/leads/                      заявка с лендинга

Кабинет заведения (Authorization: Bearer <api_token>):
  POST   /api/cabinet/register/         самостоятельная регистрация + 14 дней пробного
  POST   /api/cabinet/login/            вход по e-mail и паролю
  GET    /api/cabinet/overview/         заведение, тариф, лимиты, сводка
  PATCH  /api/cabinet/venue/            брендинг и контакты
  GET    /api/cabinet/menu/             позиции карты
  POST   /api/cabinet/menu/             создать/обновить (bulk или одну)
  POST   /api/cabinet/menu/import/      разбор выгрузки iiko/Poster/CSV (mode=preview) и запись (mode=apply)
  DELETE /api/cabinet/menu/<id>/        убрать позицию
  GET    /api/cabinet/tables/           столы и их QR-токены
  POST   /api/cabinet/tables/           создать столы (tables=N) или один (label=…)
  DELETE /api/cabinet/tables/<id>/      удалить стол
  GET    /api/cabinet/stats/?days=30    аналитика: сканы, топ-блюда, топ-связки, эффект в ₸
"""
from __future__ import annotations

import re
import secrets
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.db.models import Count, F, Sum
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from . import importers
from .models import Lead, MenuEvent, QRCode, ScanEvent, Venue, VenueAccount, VenueMenuItem

MAX_TABLES_PER_CALL = 200


# ─────────────────────────────  вспомогательное  ─────────────────────────────

def _account(request) -> VenueAccount | None:
    """Аккаунт по Bearer-токену. Токен вечный до ротации — кабинету этого достаточно."""
    header = request.META.get('HTTP_AUTHORIZATION', '')
    token = header[7:].strip() if header.lower().startswith('bearer ') else request.query_params.get('token', '')
    if not token:
        return None
    return VenueAccount.objects.filter(api_token=token, is_active=True).select_related('venue').first()


def _unauth():
    return Response({'detail': 'Нужен вход в кабинет'}, status=status.HTTP_401_UNAUTHORIZED)


def _dec(value, default='0') -> Decimal:
    try:
        return Decimal(str(value if value not in (None, '') else default)).quantize(Decimal('0.01'))
    except (InvalidOperation, ValueError):
        return Decimal(default)


MAX_PRICE = Decimal('99999999.99')      # DecimalField(max_digits=10, decimal_places=2)
MAX_INT = 2 ** 31 - 1                   # IntegerField и в SQLite, и в PostgreSQL


def _price(value) -> Decimal | None:
    """Цена от гостя или из кабинета. Отрицательная, NaN или не влезающая в поле — None, а не 500."""
    d = _dec(value, default='NaN')
    if not d.is_finite() or d < 0 or d > MAX_PRICE:
        return None
    return d


def _int(value, lo: int = 0, hi: int = MAX_INT) -> int | None:
    """Целое из запроса. str.isdigit() тут не годится: '²'.isdigit() → True, а int('²') падает."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        n = value
    elif isinstance(value, str) and re.fullmatch(r'-?[0-9]{1,12}', value.strip()):
        n = int(value.strip())
    else:
        return None
    return n if lo <= n <= hi else None


def _body(request) -> dict | None:
    """Тело запроса, если это JSON-объект (или форма). Массив, строка, число — None."""
    data = request.data
    if data is None or data == '':
        return {}
    return data if isinstance(data, dict) else None


def _bad_body():
    return Response({'detail': 'Ожидается JSON-объект'}, status=status.HTTP_400_BAD_REQUEST)


def _unique_slug(name: str) -> str:
    base = slugify(name, allow_unicode=False) or f'venue-{secrets.token_hex(3)}'
    slug, i = base[:70], 2
    while Venue.objects.filter(slug=slug).exists():
        slug = f'{base[:66]}-{i}'
        i += 1
    return slug


def _token_prefix(name: str) -> str:
    letters = re.sub(r'[^A-Za-z]', '', slugify(name, allow_unicode=False).replace('-', '')).upper()
    base = (letters[:3] or 'FTV')
    prefix, i = base, 2
    while Venue.objects.filter(slug__isnull=False).filter(qrcodes__unique_token__startswith=f'{prefix}-').exists():
        prefix = f'{base[:2]}{i}'
        i += 1
    return prefix


def _item_payload(item: VenueMenuItem) -> dict:
    return {
        'id': str(item.id), 'kind': item.kind, 'ref_slug': item.ref_slug,
        'name': item.custom_name, 'description': item.custom_description, 'category': item.category,
        'price': float(item.price), 'volume': item.volume,
        'is_available': item.is_available, 'is_featured': item.is_featured, 'sort_order': item.sort_order,
    }


def _venue_public(venue: Venue) -> dict:
    account = getattr(venue, 'account', None)
    return {
        'slug': venue.slug or str(venue.id), 'name': venue.name, 'city': venue.city, 'address': venue.address,
        'venue_type': venue.venue_type, 'description': venue.description,
        'logo': venue.logo, 'cover': venue.cover_url, 'accent': venue.accent or '#F7941D',
        'phone': venue.phone, 'instagram': venue.instagram, 'wifi': venue.wifi_password,
        'headline': venue.menu_headline or 'Что взять к вашему блюду?',
        'currency': venue.currency or '₸',
        'branding': bool(account and account.limits['branding']),
        'plan': account.plan if account else 'TRIAL',
    }


def _table_payload(qr: QRCode) -> dict:
    return {
        'id': str(qr.id), 'number': qr.table_number, 'label': qr.label or f'Стол {qr.table_number}',
        'token': qr.unique_token, 'scans': qr.scans_count, 'is_active': qr.is_active,
        'last_scan_at': qr.last_scan_at.isoformat() if qr.last_scan_at else None,
    }


# ───────────────────────────────  публичное  ────────────────────────────────

@api_view(['GET'])
def menu_public(request, slug):
    """Меню заведения для гостя. Стоп-лист режется здесь — гость не увидит того, чего нет."""
    venue = Venue.objects.filter(slug=slug, is_active=True).select_related('account').first()
    if not venue:
        return Response({'detail': 'Заведение не найдено'}, status=status.HTTP_404_NOT_FOUND)

    account = getattr(venue, 'account', None)
    if account and not account.subscription_ok:
        return Response({'detail': 'Подписка заведения неактивна', 'venue': _venue_public(venue), 'expired': True},
                        status=status.HTTP_402_PAYMENT_REQUIRED)

    items = venue.menu_items.filter(is_available=True)
    table = request.query_params.get('table')
    return Response({
        'venue': _venue_public(venue),
        'table': _int(table or ''),
        'beers': [_item_payload(i) for i in items.filter(kind='BEER')],
        'dishes': [_item_payload(i) for i in items.filter(kind='DISH')],
        'updated_at': venue.updated_at.isoformat() if venue.updated_at else None,
    })


@api_view(['POST'])
def track(request):
    """Событие гостя. Без него нечего показать владельцу при продлении подписки."""
    data = _body(request)
    if data is None:
        return _bad_body()
    # Пустой slug нельзя отдавать в filter: slug=None превращается в slug IS NULL и находит чужое заведение.
    venue_slug = str(data.get('venue') or '').strip()
    venue = Venue.objects.filter(slug=venue_slug).first() if venue_slug else None
    if not venue:
        return Response({'ok': False}, status=status.HTTP_204_NO_CONTENT)

    kind = data.get('kind', '')
    session_key = str(data.get('session') or '')[:64]
    table = _int(data.get('table'))

    if kind == 'SCAN':
        qr = QRCode.objects.filter(venue=venue, table_number=table).first() if table is not None else None
        if qr:
            QRCode.objects.filter(pk=qr.pk).update(scans_count=F('scans_count') + 1, last_scan_at=timezone.now())
        ScanEvent.objects.create(venue=venue, qrcode=qr, table_number=table, session_key=session_key,
                                 user_agent=request.META.get('HTTP_USER_AGENT', '')[:300])
        return Response({'ok': True})

    if kind in dict(MenuEvent.KIND_CHOICES):
        # id гостя в событиях меню храним только как HMAC трекинга (тот же, что у PairingAction: по нему аналитика
        # бренда склеивает дубли «Заказать»). Сырой id остаётся лишь в ScanEvent — по нему отзыв получает «гость
        # заведения» (views_reviews). Импорт здесь: views_tracking сам импортирует этот модуль.
        from .views_tracking import session_hash
        MenuEvent.objects.create(
            venue=venue, kind=kind,
            dish_slug=str(data.get('dish') or '')[:80], beer_slug=str(data.get('beer') or '')[:80],
            score=_int(data.get('score'), lo=-MAX_INT),
            price=_price(data.get('price')) or Decimal('0'), table_number=table,
            session_key=session_hash(session_key) if session_key else '',
        )
        return Response({'ok': True})

    return Response({'ok': False, 'detail': 'Неизвестное событие'}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
def lead_create(request):
    """Заявка с лендинга — то, ради чего лендинг вообще существует."""
    data = _body(request)
    if data is None:
        return _bad_body()
    venue_name = str(data.get('venue_name') or '').strip()
    phone = str(data.get('phone') or '').strip()
    if not venue_name or not phone:
        return Response({'detail': 'Укажите название заведения и телефон'}, status=status.HTTP_400_BAD_REQUEST)

    lead = Lead.objects.create(
        venue_name=venue_name[:200], contact_name=str(data.get('contact_name') or '')[:150], phone=phone[:40],
        email=str(data.get('email') or '')[:254], city=str(data.get('city') or '')[:100],
        tables=_int(data.get('tables')),
        plan_interest=str(data.get('plan') or '')[:20], comment=str(data.get('comment') or '')[:2000],
        source=str(data.get('source') or 'landing')[:80],
    )
    return Response({'ok': True, 'id': str(lead.id),
                     'message': 'Заявка принята. Свяжемся в течение рабочего дня.'}, status=status.HTTP_201_CREATED)


# ──────────────────────────────  регистрация  ───────────────────────────────

@api_view(['POST'])
def cabinet_register(request):
    """Self-serve: бар заводит кабинет сам и сразу получает 14 дней пробного."""
    data = _body(request)
    if data is None:
        return _bad_body()
    email = str(data.get('email') or '').strip().lower()
    password = str(data.get('password') or '')
    venue_name = str(data.get('venue_name') or '').strip()

    if not email or len(password) < 6 or not venue_name:
        return Response({'detail': 'Нужны e-mail, пароль от 6 символов и название заведения'},
                        status=status.HTTP_400_BAD_REQUEST)
    try:
        validate_email(email)
    except ValidationError:
        return Response({'detail': 'Проверьте e-mail: на него придут счёт и сброс пароля'},
                        status=status.HTTP_400_BAD_REQUEST)
    if VenueAccount.objects.filter(email=email).exists():
        return Response({'detail': 'Такой e-mail уже зарегистрирован'}, status=status.HTTP_409_CONFLICT)

    # Регистрация идёт на пробном тарифе, значит и столов не больше, чем разрешает он.
    tables_n = _int(data.get('tables'))
    tables_n = min(5 if tables_n is None else tables_n, VenueAccount.PLAN_LIMITS['TRIAL']['tables'])

    try:
        with transaction.atomic():
            venue = Venue.objects.create(
                name=venue_name[:200], slug=_unique_slug(venue_name),
                city=str(data.get('city') or '')[:100], address=str(data.get('address') or '')[:300],
                venue_type=data.get('venue_type') if data.get('venue_type') in dict(Venue.VENUE_TYPE_CHOICES) else 'BAR',
                phone=str(data.get('phone') or '')[:40], accent='#F7941D',
            )
            account = VenueAccount(
                venue=venue, email=email, contact_name=str(data.get('contact_name') or '')[:150],
                phone=str(data.get('phone') or '')[:40], plan='TRIAL',
            )
            account.set_password(password)
            account.save()
            _create_tables(venue, tables_n)
    except IntegrityError:
        return Response({'detail': 'Не удалось создать заведение, попробуйте другое название'},
                        status=status.HTTP_409_CONFLICT)

    return Response(_session_payload(account), status=status.HTTP_201_CREATED)


@api_view(['POST'])
def cabinet_login(request):
    data = _body(request)
    if data is None:
        return _bad_body()
    account = VenueAccount.objects.filter(email=str(data.get('email') or '').strip().lower()) \
                                  .select_related('venue').first()
    if not account or not account.check_password(str(data.get('password') or '')):
        return Response({'detail': 'Неверный e-mail или пароль'}, status=status.HTTP_401_UNAUTHORIZED)
    if not account.is_active:
        return Response({'detail': 'Аккаунт отключён'}, status=status.HTTP_403_FORBIDDEN)

    account.last_login_at = timezone.now()
    account.save(update_fields=['last_login_at'])
    return Response(_session_payload(account))


def _session_payload(account: VenueAccount) -> dict:
    return {'token': account.api_token, 'venue': _venue_public(account.venue), **_plan_payload(account)}


def _plan_payload(account: VenueAccount) -> dict:
    return {
        'plan': account.plan, 'plan_label': account.get_plan_display(), 'limits': account.limits,
        'days_left': account.days_left, 'active': account.subscription_ok,
        'active_until': account.active_until.isoformat() if account.active_until else None,
        'email': account.email,
    }


# ────────────────────────────────  кабинет  ─────────────────────────────────

@api_view(['GET'])
def cabinet_overview(request):
    account = _account(request)
    if not account:
        return _unauth()
    venue = account.venue
    since = timezone.now() - timedelta(days=30)
    return Response({
        **_session_payload(account),
        'summary': {
            'items': venue.menu_items.count(),
            'items_available': venue.menu_items.filter(is_available=True).count(),
            'tables': venue.qrcodes.count(),
            'scans_30d': venue.scan_events.filter(created_at__gte=since).count(),
            'order_intents_30d': venue.menu_events.filter(kind='ORDER_INTENT', created_at__gte=since).count(),
        },
    })


@api_view(['PATCH'])
def cabinet_venue(request):
    account = _account(request)
    if not account:
        return _unauth()
    venue, data = account.venue, _body(request)
    if data is None:
        return _bad_body()
    branding_ok = account.limits['branding']

    plain = {'name': 200, 'city': 100, 'address': 300, 'description': 2000, 'phone': 40,
             'instagram': 120, 'wifi_password': 80, 'menu_headline': 200}
    for field, size in plain.items():
        if field in data:
            setattr(venue, field, str(data[field] or '')[:size])
    if data.get('venue_type') in dict(Venue.VENUE_TYPE_CHOICES):
        venue.venue_type = data['venue_type']
    # Свой логотип и цвет — платная часть: на пробном тарифе остаётся оформление Flavor Tree.
    if branding_ok:
        for field in ('logo', 'cover_url'):
            if field in data:
                setattr(venue, field, str(data[field] or '')[:500])
        if 'accent' in data and re.fullmatch(r'#[0-9A-Fa-f]{6}', str(data['accent'] or '')):
            venue.accent = data['accent']
    venue.save()
    return Response({'ok': True, 'venue': _venue_public(venue), 'branding_locked': not branding_ok})


@api_view(['GET', 'POST'])
def cabinet_menu(request):
    account = _account(request)
    if not account:
        return _unauth()
    venue = account.venue

    if request.method == 'GET':
        items = venue.menu_items.all()
        return Response({'beers': [_item_payload(i) for i in items.filter(kind='BEER')],
                         'dishes': [_item_payload(i) for i in items.filter(kind='DISH')],
                         'limit': account.limits['items'], 'used': items.count()})

    payload = request.data or {}
    rows = payload.get('items') if isinstance(payload, dict) and 'items' in payload else payload
    if isinstance(rows, dict):
        rows = [rows]
    if not isinstance(rows, list) or not rows:
        return Response({'detail': 'Нет позиций'}, status=status.HTTP_400_BAD_REQUEST)

    limit = account.limits['items']
    existing = {(i.kind, i.ref_slug): i for i in venue.menu_items.all()}
    saved, skipped = [], 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        kind = row.get('kind')
        ref_slug = str(row.get('ref_slug') or '')[:80]
        if kind not in ('BEER', 'DISH') or not ref_slug:
            continue
        item = existing.get((kind, ref_slug))
        if not item:
            if len(existing) >= limit:
                skipped += 1
                continue
            item = VenueMenuItem(venue=venue, kind=kind, ref_slug=ref_slug)
            existing[(kind, ref_slug)] = item
        # Кривую цену не сохраняем: у новой позиции останется 0, у старой — прежняя.
        if 'price' in row and _price(row.get('price')) is not None:
            item.price = _price(row.get('price'))
        for src, dst, size in (('name', 'custom_name', 200), ('description', 'custom_description', 300),
                               ('category', 'category', 80), ('volume', 'volume', 40)):
            if src in row:
                setattr(item, dst, str(row.get(src) or '')[:size])
        if 'is_available' in row:
            item.is_available = bool(row['is_available'])
        if 'is_featured' in row:
            item.is_featured = bool(row['is_featured'])
        sort_order = _int(row.get('sort_order'), lo=-MAX_INT)
        if sort_order is not None:
            item.sort_order = sort_order
        item.save()
        saved.append(item)

    return Response({'ok': True, 'saved': len(saved), 'skipped_over_limit': skipped,
                     'items': [_item_payload(i) for i in saved], 'limit': limit})


MAX_IMPORT_REQUEST = 8 * 1024 * 1024    # конверт запроса; сам файл ограничен importers.MAX_BYTES


def _import_source(request, data) -> str:
    """Текст выгрузки: поле content, либо файл из multipart. Имени файла не верим — формат определяем по содержимому.
    Бросает MenuImportError с понятным владельцу текстом."""
    upload = request.FILES.get('file')
    if upload is not None:
        return importers.decode_bytes(upload.read())[0]
    content = data.get('content')
    if not isinstance(content, str) or not content.strip():
        raise importers.MenuImportError('empty')
    return content


@api_view(['POST'])
def cabinet_menu_import(request):
    """Импорт меню из выгрузки iiko / Poster / CSV.

    Тело: {"content": "<текст файла>", "dry_run": true|false, "choices": {"<index>": "<slug>"|""}}
    или multipart с полем file. Два шага, оба без состояния на сервере:
      dry_run=true  — только разбор: строки, кандидаты, спорные позиции (владелец выбирает);
      без dry_run   — запись в карту: новые создаются, уже имеющиеся обновляются, лимит тарифа соблюдается.
    Логика разбора — importers.py (зеркало frontend/src/app/core/menu-import.ts), здесь только HTTP и запись.
    """
    if int(request.META.get('CONTENT_LENGTH') or 0) > MAX_IMPORT_REQUEST:
        return Response({'detail': importers.ERRORS['too_large'], 'code': 'too_large'},
                        status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
    account = _account(request)
    if not account:
        return _unauth()
    venue = account.venue
    data = request.data if isinstance(request.data, dict) else {}

    try:
        cat = importers.catalog()
        parsed = importers.parse_menu(_import_source(request, data), cat)
    except importers.MenuImportError as exc:
        return Response({'detail': exc.message, 'code': exc.code}, status=status.HTTP_400_BAD_REQUEST)

    limit = account.limits['items']
    items = {(i.kind, i.ref_slug): i for i in venue.menu_items.all()}
    existing = [f'{kind}:{slug}' for kind, slug in items]

    if data.get('dry_run'):
        return Response({**parsed, 'limit': limit, 'used': len(existing)})

    choices = data.get('choices') if isinstance(data.get('choices'), dict) else {}
    plan = importers.plan_import(parsed['rows'], choices, cat, existing, limit)

    saved = []
    with transaction.atomic():
        for row in plan['items']:
            item = items.get((row['kind'], row['ref_slug']))
            if not item:
                item = VenueMenuItem(venue=venue, kind=row['kind'], ref_slug=row['ref_slug'])
                items[(row['kind'], row['ref_slug'])] = item
            if row['name']:
                item.custom_name = row['name'][:200]
            if row['category']:
                item.category = row['category'][:80]
            if row['volume']:
                item.volume = row['volume'][:40]
            if row['price']:
                item.price = _dec(row['price'])
            item.save()
            saved.append(item)

    return Response({
        'ok': True, 'format': parsed['format'], 'total': parsed['total'], 'warnings': parsed['warnings'],
        'created': plan['created'], 'updated': plan['updated'], 'skipped_over_limit': plan['over_limit'],
        'skipped_by_user': plan['skipped_by_user'], 'duplicates': plan['duplicates'],
        'needs_choice': plan['needs_choice'], 'unmatched': plan['unmatched'],
        'items': [_item_payload(i) for i in saved], 'limit': limit, 'used': venue.menu_items.count(),
    })


@api_view(['DELETE'])
def cabinet_menu_item(request, item_id):
    account = _account(request)
    if not account:
        return _unauth()
    deleted, _ = VenueMenuItem.objects.filter(venue=account.venue, id=item_id).delete()
    if not deleted:
        return Response({'detail': 'Позиция не найдена'}, status=status.HTTP_404_NOT_FOUND)
    return Response({'ok': True})


def _create_tables(venue: Venue, count: int, start: int | None = None) -> list[QRCode]:
    """Столы нумеруются подряд; токен вида EBG-07 читается на печатном стенде."""
    prefix = None
    first = venue.qrcodes.order_by('table_number').first()
    if first and '-' in first.unique_token:
        prefix = first.unique_token.rsplit('-', 1)[0]
    prefix = prefix or _token_prefix(venue.name)

    taken = set(venue.qrcodes.values_list('table_number', flat=True))
    number = start or (max(taken) + 1 if taken else 1)
    created = []
    for _ in range(max(0, count)):
        while number in taken:
            number += 1
        token = f'{prefix}-{number:02d}'
        if QRCode.objects.filter(unique_token=token).exists():
            token = f'{prefix}{secrets.token_hex(2).upper()}-{number:02d}'
        created.append(QRCode.objects.create(venue=venue, table_number=number, unique_token=token,
                                             label=f'Стол {number}'))
        taken.add(number)
    return created


@api_view(['GET', 'POST'])
def cabinet_tables(request):
    account = _account(request)
    if not account:
        return _unauth()
    venue = account.venue

    if request.method == 'GET':
        return Response({'tables': [_table_payload(q) for q in venue.qrcodes.order_by('table_number')],
                         'limit': account.limits['tables']})

    data = _body(request)
    if data is None:
        return _bad_body()
    limit = account.limits['tables']
    have = venue.qrcodes.count()
    want = _int(data.get('tables', 1))
    want = 1 if want is None else want
    allowed = max(0, min(want, limit - have, MAX_TABLES_PER_CALL))
    if allowed == 0:
        return Response({'detail': f'Лимит тарифа — {limit} столов. Перейдите на старший тариф.',
                         'limit': limit, 'used': have}, status=status.HTTP_402_PAYMENT_REQUIRED)

    created = _create_tables(venue, allowed)
    return Response({'ok': True, 'created': [_table_payload(q) for q in created],
                     'tables': [_table_payload(q) for q in venue.qrcodes.order_by('table_number')],
                     'skipped_over_limit': want - allowed}, status=status.HTTP_201_CREATED)


@api_view(['DELETE'])
def cabinet_table(request, table_id):
    account = _account(request)
    if not account:
        return _unauth()
    deleted, _ = QRCode.objects.filter(venue=account.venue, id=table_id).delete()
    if not deleted:
        return Response({'detail': 'Стол не найден'}, status=status.HTTP_404_NOT_FOUND)
    return Response({'ok': True})


@api_view(['GET'])
def cabinet_stats(request):
    """Аргумент для продления: сколько сканов, что читают, сколько ₸ в намерениях заказать."""
    account = _account(request)
    if not account:
        return _unauth()
    venue = account.venue

    days = _int(request.query_params.get('days', '30'))
    days = 30 if days is None else days
    days = max(1, min(days, account.limits['history_days']))
    since = timezone.now() - timedelta(days=days)

    scans = venue.scan_events.filter(created_at__gte=since)
    events = venue.menu_events.filter(created_at__gte=since)
    intents = events.filter(kind='ORDER_INTENT')

    by_day: dict[str, int] = {}
    for dt in scans.values_list('created_at', flat=True):
        key = timezone.localtime(dt).date().isoformat()
        by_day[key] = by_day.get(key, 0) + 1
    series = []
    today = timezone.localdate()
    for i in range(days - 1, -1, -1):
        day = (today - timedelta(days=i)).isoformat()
        series.append({'date': day, 'scans': by_day.get(day, 0)})

    def _top(qs, field, limit=8):
        return [{'slug': r[field], 'count': r['n']} for r in
                qs.exclude(**{field: ''}).values(field).annotate(n=Count('id')).order_by('-n')[:limit]]

    top_pairs = [{'dish': r['dish_slug'], 'beer': r['beer_slug'], 'count': r['n']} for r in
                 intents.exclude(dish_slug='').exclude(beer_slug='')
                        .values('dish_slug', 'beer_slug').annotate(n=Count('id')).order_by('-n')[:8]]

    scan_count = scans.count()
    intent_count = intents.count()
    revenue = intents.aggregate(s=Sum('price'))['s'] or Decimal('0')
    guests = scans.exclude(session_key='').values('session_key').distinct().count()

    return Response({
        'days': days,
        'scans': scan_count,
        'guests': guests,
        'pair_views': events.filter(kind='PAIR_VIEW').count(),
        'order_intents': intent_count,
        'conversion': round(intent_count / scan_count * 100, 1) if scan_count else 0.0,
        'revenue_intent_kzt': float(revenue),
        'avg_check_add_kzt': float(revenue / intent_count) if intent_count else 0.0,
        'series': series,
        'top_dishes': _top(events.filter(kind__in=['DISH_VIEW', 'PAIR_VIEW']), 'dish_slug'),
        'top_beers': _top(intents, 'beer_slug'),
        'top_pairs': top_pairs,
        'tables': [_table_payload(q) for q in venue.qrcodes.order_by('-scans_count')[:12]],
    })

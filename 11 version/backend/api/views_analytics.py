"""
Аналитика: что рекомендации дают заведению и что о сортах говорят гости.

Заведение видит долю заказов с напитком, долю заказов с парой по совету и выручку напитков,
добавленных из подсказки. Сомелье и модератор видят сводку по сортам: отметки гостей,
услышанные ноты и оценки пар.
"""
import csv
from collections import Counter, defaultdict
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.db.models import Avg, Count, Q, Sum
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import (
    Brand, FoodPairing, LessonProgress, MenuDrink, MenuItem, Order, OrderItem, PairingFeedback,
    QuizAttempt, Tasting,
)
from .permissions import IsSommelierOrModerator, ROLE_MODERATOR, has_role
from .serializers_passport import brand_card
from .views_orders import find_venue
from .views_passport import MIN_GUESTS, heard_notes

DEFAULT_DAYS = 30
MAX_DAYS = 365
TOP_LIMIT = 8


def money(value):
    return int(Decimal(value or 0).quantize(Decimal('1')))


def share(part, whole):
    """Доля в процентах, целое число. Без знаменателя доли нет."""
    return round(part * 100 / whole) if whole else None


def period_days(request):
    try:
        days = int(request.query_params.get('days') or DEFAULT_DAYS)
    except (TypeError, ValueError):
        days = DEFAULT_DAYS
    return min(max(days, 1), MAX_DAYS)


def venue_for(request, slug):
    """Заведение, к аналитике которого у пользователя есть доступ: владелец или модератор."""
    venue = find_venue(slug)
    if venue is None:
        return None, Response({'error': 'Заведение не найдено'}, status=status.HTTP_404_NOT_FOUND)
    user = request.user
    if not (has_role(user, ROLE_MODERATOR) or venue.owner_id == user.id):
        return None, Response({'error': 'Это заведение вам не принадлежит'}, status=status.HTTP_403_FORBIDDEN)
    return venue, None


def period_orders(venue, days, include_demo):
    since = timezone.now() - timedelta(days=days)
    orders = (Order.objects.filter(venue=venue, created_at__gte=since)
              .exclude(status=Order.STATUS_CANCELLED)
              .prefetch_related('items__menu_item', 'items__menu_drink__brand')
              .order_by('created_at'))
    if not include_demo:
        orders = orders.filter(is_demo=False)
    return since, list(orders)


def recommended_pairs(venue):
    """Пары (блюдо, сорт) из каталога для блюд меню: по ним узнаём заказ «по совету»."""
    dish_ids = list(MenuItem.objects.filter(venue=venue).values_list('dish_id', flat=True))
    return {(dish_id, brand_id): source for dish_id, brand_id, source in
            FoodPairing.objects.filter(dish_id__in=dish_ids).values_list('dish_id', 'brand_id', 'source')}


def order_facts(order, pairs):
    """Разбор одного заказа: блюда, напитки и был ли напиток парой к блюду из этого же заказа."""
    dishes = []
    drinks = []
    for item in order.items.all():
        total = item.price * item.qty
        if item.kind == OrderItem.KIND_DISH:
            dish_id = item.menu_item.dish_id if item.menu_item_id else None
            dishes.append({'dish_id': dish_id, 'title': item.title, 'qty': item.qty, 'sum': total})
        else:
            brand = item.menu_drink.brand if item.menu_drink_id else None
            drinks.append({
                'brand_id': brand.id if brand else None, 'title': item.title, 'qty': item.qty, 'sum': total,
                'via': item.via, 'draught': bool(brand and brand.packaging_type == 'DRAFT'),
            })
    matched = [(d, b) for d in dishes for b in drinks if (d['dish_id'], b['brand_id']) in pairs]
    return {'dishes': dishes, 'drinks': drinks, 'matched': matched}


def average(values):
    return money(sum(values) / len(values)) if values else None


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def venue_analytics(request, slug):
    """
    GET /api/analytics/venue/<slug>/?days=30&demo=1 - сводка по заказам заведения за период.
    demo=0 убирает демо-заказы (их создаёт команда seed_demo_orders для показа экрана).
    """
    venue, error = venue_for(request, slug)
    if error:
        return error
    days = period_days(request)
    include_demo = request.query_params.get('demo', '1') != '0'
    since, orders = period_orders(venue, days, include_demo)
    pairs = recommended_pairs(venue)

    revenue = Decimal('0')
    food_only = []
    with_drink = []
    with_pair = []
    pair_counter = Counter()
    drink_stats = defaultdict(lambda: {'qty': 0, 'sum': Decimal('0'), 'draught': False})
    dish_stats = defaultdict(lambda: {'qty': 0, 'sum': Decimal('0')})
    advice = {OrderItem.VIA_PAIRING: {'qty': 0, 'sum': Decimal('0')}, OrderItem.VIA_AI: {'qty': 0, 'sum': Decimal('0')}}
    drinks_qty = 0
    draught_qty = 0
    by_day = defaultdict(lambda: {'orders': 0, 'revenue': Decimal('0'), 'with_pair': 0})
    demo_count = 0
    local = timezone.get_current_timezone()

    for order in orders:
        facts = order_facts(order, pairs)
        revenue += order.total
        demo_count += order.is_demo
        day = by_day[order.created_at.astimezone(local).date()]
        day['orders'] += 1
        day['revenue'] += order.total
        if facts['dishes']:
            if facts['matched']:
                with_pair.append(order.total)
                day['with_pair'] += 1
            if facts['drinks']:
                with_drink.append(order.total)
            else:
                food_only.append(order.total)
        for dish, drink in set((d['title'], b['title']) for d in facts['dishes'] for b in facts['drinks']):
            pair_counter[(dish, drink)] += 1
        for dish in facts['dishes']:
            dish_stats[dish['title']]['qty'] += dish['qty']
            dish_stats[dish['title']]['sum'] += dish['sum']
        for drink in facts['drinks']:
            row = drink_stats[drink['title']]
            row['qty'] += drink['qty']
            row['sum'] += drink['sum']
            row['draught'] = row['draught'] or drink['draught']
            drinks_qty += drink['qty']
            draught_qty += drink['qty'] if drink['draught'] else 0
            if drink['via'] in advice:
                advice[drink['via']]['qty'] += drink['qty']
                advice[drink['via']]['sum'] += drink['sum']

    # Названия блюда и напитка -> пара из каталога (по названию на момент заказа)
    titles = {}
    for item in MenuItem.objects.filter(venue=venue).select_related('dish'):
        for drink in MenuDrink.objects.filter(venue=venue).select_related('brand'):
            source = pairs.get((item.dish_id, drink.brand_id))
            if source:
                titles[(item.dish.name, drink.brand.name)] = source
    top_pairs = [
        {'dish': dish, 'drink': drink, 'orders': count, 'recommended': (dish, drink) in titles,
         'source': titles.get((dish, drink), '')}
        for (dish, drink), count in pair_counter.most_common(TOP_LIMIT)
    ]

    dish_orders = len(food_only) + len(with_drink)
    feedback = PairingFeedback.objects.filter(venue=venue, created_at__gte=since).aggregate(
        likes=Count('id', filter=Q(liked=True)), dislikes=Count('id', filter=Q(liked=False)))

    # Блюда меню, к которым в карте бара заведения нет ни одной пары: их стоит подобрать.
    venue_brands = set(MenuDrink.objects.filter(venue=venue).values_list('brand_id', flat=True))
    unpaired = []
    for item in MenuItem.objects.filter(venue=venue).select_related('dish').order_by('section', 'sort_order'):
        if not any((item.dish_id, brand_id) in pairs for brand_id in venue_brands):
            unpaired.append(item.dish.name)

    start = since.astimezone(local).date()
    today = timezone.now().astimezone(local).date()
    series = []
    for offset in range((today - start).days + 1):
        date = start + timedelta(days=offset)
        row = by_day.get(date)
        series.append({
            'day': date.isoformat(),
            'orders': row['orders'] if row else 0,
            'revenue': money(row['revenue']) if row else 0,
            'with_pair': row['with_pair'] if row else 0,
        })

    return Response({
        'venue': {'slug': venue.slug, 'name': venue.name},
        'period': {'days': days, 'from': start.isoformat(), 'to': today.isoformat()},
        'demo': {'included': include_demo, 'orders': demo_count},
        'totals': {
            'orders': len(orders),
            'revenue': money(revenue),
            'avg_check': money(revenue / len(orders)) if orders else None,
        },
        'pairing': {
            'dish_orders': dish_orders,
            'with_drink': len(with_drink),
            'with_pair': len(with_pair),
            'drink_rate': share(len(with_drink), dish_orders),
            'pair_rate': share(len(with_pair), dish_orders),
            'avg_food_only': average(food_only),
            'avg_with_drink': average(with_drink),
            'avg_with_pair': average(with_pair),
        },
        'advice': {
            'pairing': {'qty': advice[OrderItem.VIA_PAIRING]['qty'], 'revenue': money(advice[OrderItem.VIA_PAIRING]['sum'])},
            'ai': {'qty': advice[OrderItem.VIA_AI]['qty'], 'revenue': money(advice[OrderItem.VIA_AI]['sum'])},
        },
        'drinks': {
            'qty': drinks_qty,
            'draught_qty': draught_qty,
            'draught_rate': share(draught_qty, drinks_qty),
            'top': [{'title': title, 'qty': row['qty'], 'revenue': money(row['sum']), 'draught': row['draught']}
                    for title, row in sorted(drink_stats.items(), key=lambda kv: (-kv[1]['qty'], kv[0]))[:TOP_LIMIT]],
        },
        'dishes': {
            'top': [{'title': title, 'qty': row['qty'], 'revenue': money(row['sum'])}
                    for title, row in sorted(dish_stats.items(), key=lambda kv: (-kv[1]['qty'], kv[0]))[:TOP_LIMIT]],
            'unpaired': unpaired,
        },
        'top_pairs': top_pairs,
        'feedback': {'likes': feedback['likes'] or 0, 'dislikes': feedback['dislikes'] or 0},
        'by_day': series,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def venue_export(request, slug):
    """GET /api/analytics/venue/<slug>/export/?days=30&demo=1 - строки заказов в CSV для Excel."""
    venue, error = venue_for(request, slug)
    if error:
        return error
    days = period_days(request)
    include_demo = request.query_params.get('demo', '1') != '0'
    _, orders = period_orders(venue, days, include_demo)
    pairs = recommended_pairs(venue)
    local = timezone.get_current_timezone()

    response = HttpResponse(content_type='text/csv; charset=utf-8')
    response['Content-Disposition'] = 'attachment; filename="flavor-tree-{}-{}d.csv"'.format(venue.slug, days)
    # BOM и точка с запятой: так файл сразу открывается в Excel с русской локалью.
    response.write('﻿')
    writer = csv.writer(response, delimiter=';')
    writer.writerow(['Дата', 'Время', 'Заказ', 'Стол', 'Статус', 'Тип', 'Позиция', 'Количество',
                     'Цена', 'Сумма', 'Откуда добавлено', 'Пара по совету', 'Демо'])
    via_labels = dict(OrderItem.VIA_CHOICES)
    for order in orders:
        facts = order_facts(order, pairs)
        paired_drinks = set(b['title'] for _, b in facts['matched'])
        paired_dishes = set(d['title'] for d, _ in facts['matched'])
        created = order.created_at.astimezone(local)
        for item in order.items.all():
            is_dish = item.kind == OrderItem.KIND_DISH
            paired = item.title in (paired_dishes if is_dish else paired_drinks)
            writer.writerow([
                created.strftime('%d.%m.%Y'), created.strftime('%H:%M'), order.number, order.table_number,
                order.get_status_display(), 'Блюдо' if is_dish else 'Напиток', item.title, item.qty,
                money(item.price), money(item.price * item.qty), via_labels.get(item.via, ''),
                'да' if paired else '', 'да' if order.is_demo else '',
            ])
    return response


@api_view(['GET'])
@permission_classes([IsSommelierOrModerator])
def brands_analytics(request):
    """
    GET /api/analytics/brands/ - сводка по сортам для сомелье и модератора: отметки гостей,
    средняя оценка, услышанные ноты, избранное, заказы и оценки пар.
    """
    brands = list(Brand.objects.filter(is_active=True).order_by('name'))
    tastings = {row['brand_id']: row for row in Tasting.objects.values('brand_id').annotate(
        n=Count('id'), rating=Avg('rating'), matched=Avg('matched'))}
    fans = dict(Brand.objects.annotate(n=Count('fans')).values_list('id', 'n'))
    ordered = dict(OrderItem.objects.filter(kind=OrderItem.KIND_DRINK, order__is_demo=False)
                   .exclude(order__status=Order.STATUS_CANCELLED)
                   .values('menu_drink__brand_id').annotate(n=Sum('qty')).values_list('menu_drink__brand_id', 'n'))
    pairings = {row['brand_id']: row for row in FoodPairing.objects.values('brand_id').annotate(
        n=Count('id'), ai=Count('id', filter=Q(source=FoodPairing.SOURCE_AI)))}
    votes = {row['pairing__brand_id']: row for row in PairingFeedback.objects.values('pairing__brand_id').annotate(
        likes=Count('id', filter=Q(liked=True)), n=Count('id'))}

    rows = []
    for brand in brands:
        tasted = tastings.get(brand.id, {})
        count = tasted.get('n', 0)
        vote = votes.get(brand.id, {})
        pairing = pairings.get(brand.id, {})
        row = brand_card(brand, request)
        row.update({
            'tastings': count,
            'rating_avg': round(tasted['rating'], 1) if count else None,
            'matched_avg': round(tasted['matched'], 1) if count else None,
            'favorites': fans.get(brand.id, 0),
            'ordered': ordered.get(brand.id, 0) or 0,
            'pairings': pairing.get('n', 0),
            'ai_pairings': pairing.get('ai', 0),
            'votes': vote.get('n', 0),
            'liked_rate': share(vote.get('likes', 0), vote.get('n', 0)),
            'heard': heard_notes(brand, count, request, limit=4) if count >= MIN_GUESTS else [],
        })
        rows.append(row)
    rows.sort(key=lambda r: (-r['tastings'], -r['favorites'], r['name']))

    return Response({
        'min_guests': MIN_GUESTS,
        'totals': {
            'users': User.objects.filter(is_active=True).count(),
            'tasters': Tasting.objects.values('user_id').distinct().count(),
            'tastings': Tasting.objects.count(),
            'lessons_done': LessonProgress.objects.count(),
            'levels_passed': QuizAttempt.objects.filter(passed=True).values('user_id', 'level').distinct().count(),
            'votes': PairingFeedback.objects.count(),
            'pairings': FoodPairing.objects.count(),
            'ai_pairings': FoodPairing.objects.filter(source=FoodPairing.SOURCE_AI).count(),
        },
        'brands': rows,
    })

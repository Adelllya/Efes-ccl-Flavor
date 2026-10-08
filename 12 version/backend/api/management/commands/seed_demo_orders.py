import random
import secrets
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from api.models import FoodPairing, MenuDrink, MenuItem, Order, OrderItem, Venue


class Command(BaseCommand):
    help = ('Создаёт демо-заказы заведения, чтобы показать экран аналитики. Заказы помечены is_demo: '
            'в списке заказов их нет, в аналитике они подписаны как демо-данные. Это не результат пилота.')

    def add_arguments(self, parser):
        parser.add_argument('--venue', required=True, help='slug заведения')
        parser.add_argument('--days', type=int, default=30, help='за сколько дней создать заказы')
        parser.add_argument('--clear', action='store_true', help='только удалить демо-заказы заведения')
        parser.add_argument('--seed', type=int, default=2026, help='зерно генератора: одинаковое даёт одинаковый набор')

    def handle(self, *args, **options):
        venue = Venue.objects.filter(slug=options['venue']).first()
        if venue is None:
            raise CommandError('Заведение не найдено: ' + options['venue'])
        removed, _ = Order.objects.filter(venue=venue, is_demo=True).delete()
        if options['clear']:
            self.stdout.write(self.style.SUCCESS('Удалено демо-записей: {}'.format(removed)))
            return

        dishes = list(MenuItem.objects.filter(venue=venue, is_available=True, price__gt=0).select_related('dish'))
        drinks = list(MenuDrink.objects.filter(venue=venue, is_available=True, price__gt=0).select_related('brand'))
        if not dishes or not drinks:
            raise CommandError('В меню заведения нужны блюда и напитки с ценой')
        pairs = set(FoodPairing.objects.filter(dish_id__in=[d.dish_id for d in dishes])
                    .values_list('dish_id', 'brand_id'))
        rng = random.Random(options['seed'])
        days = max(1, min(options['days'], 365))
        now = timezone.now()
        created = 0

        with transaction.atomic():
            number = Order.objects.filter(venue=venue).aggregate(last=Max('number'))['last'] or 0
            for offset in range(days, 0, -1):
                day = now - timedelta(days=offset)
                weekend = day.weekday() >= 4
                for _ in range(rng.randint(8, 16) if weekend else rng.randint(4, 10)):
                    number += 1
                    lines = []
                    chosen = rng.sample(dishes, k=min(len(dishes), rng.choice([1, 1, 2, 2, 3])))
                    for item in chosen:
                        lines.append((OrderItem.KIND_DISH, item, item.dish.name, rng.choice([1, 1, 1, 2]), OrderItem.SOURCE_MENU))
                    if rng.random() < 0.6:
                        matching = [d for d in drinks if any((item.dish_id, d.brand_id) in pairs for item in chosen)]
                        if matching and rng.random() < 0.65:
                            drink = rng.choice(matching)
                            origin = rng.choices([OrderItem.SOURCE_PAIRING, OrderItem.SOURCE_AI, OrderItem.SOURCE_MENU], [6, 1, 3])[0]
                        else:
                            drink = rng.choice(drinks)
                            origin = OrderItem.SOURCE_MENU
                        # Напиток движка подбора (без сорта каталога) называется сам.
                        title = drink.brand.name if drink.brand_id else drink.name
                        lines.append((OrderItem.KIND_DRINK, drink, title, rng.choice([1, 1, 2, 2, 3]), origin))
                    order = Order.objects.create(
                        venue=venue, number=number, table_number=rng.randint(1, max(venue.tables_count, 1)),
                        status=Order.STATUS_DONE, guest_token=secrets.token_hex(24), is_demo=True)
                    total = Decimal('0')
                    rows = []
                    for kind, position, title, qty, origin in lines:
                        is_dish = kind == OrderItem.KIND_DISH
                        rows.append(OrderItem(
                            order=order, kind=kind, menu_item=position if is_dish else None,
                            menu_drink=None if is_dish else position, title=title, price=position.price, qty=qty,
                            source=origin))
                        total += position.price * qty
                    OrderItem.objects.bulk_create(rows)
                    moment = day.replace(hour=rng.randint(12, 22), minute=rng.randint(0, 59))
                    Order.objects.filter(pk=order.pk).update(total=total, created_at=moment, updated_at=moment)
                    created += 1
        self.stdout.write(self.style.SUCCESS(
            'Создано демо-заказов: {} за {} дн. Убрать: seed_demo_orders --venue {} --clear'.format(created, days, venue.slug)))

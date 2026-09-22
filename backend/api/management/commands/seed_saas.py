"""Демо-данные SaaS: аккаунты заведений, карта с ценами, столы с QR и живая аналитика.

    python manage.py seed_saas                 # 3 заведения из data/venues.json
    python manage.py seed_saas --events 400    # + сгенерировать историю сканов для графиков
    python manage.py seed_saas --reset

Пароль демо-аккаунтов: flavor2026 (e-mail печатается в конце).
Нужен, чтобы показать бару рабочий кабинет с цифрами, а не пустые таблицы.
"""
from __future__ import annotations

import json
import random
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from api.models import (Lead, MenuEvent, QRCode, ScanEvent, Venue, VenueAccount, VenueMenuItem)
from api.views_saas import _create_tables

DEMO_PASSWORD = 'flavor2026'

# Цены под рынок Казахстана, ₸ (2026). Розлив дороже бутылки — как в реальной карте.
BEER_PRICE = {'DRAFT': (1400, 2200), 'BOTTLE': (900, 1600), 'CAN': (1100, 1700)}
DISH_PRICE = {'LIGHT': (900, 1800), 'MEDIUM': (1800, 3200), 'HEAVY': (2900, 5200)}
VOLUME = {'DRAFT': '0.5 л', 'BOTTLE': '0.45 л', 'CAN': '0.5 л'}


def _price(lo: int, hi: int, rnd: random.Random) -> Decimal:
    """Цена, округлённая до 50 ₸ — так их пишут в меню."""
    return Decimal(rnd.randrange(lo, hi, 50))


class Command(BaseCommand):
    help = 'Создаёт демо-аккаунты заведений с картой, ценами, столами и аналитикой'

    def add_arguments(self, parser):
        parser.add_argument('--events', type=int, default=350, help='Сколько событий гостей сгенерировать')
        parser.add_argument('--reset', action='store_true', help='Удалить прежние SaaS-данные')
        parser.add_argument('--seed', type=int, default=17, help='Seed генератора (воспроизводимость)')

    @transaction.atomic
    def handle(self, *args, **opts):
        rnd = random.Random(opts['seed'])
        data_dir = Path(settings.FLAVOR_DATA_DIR)
        venues_json = json.loads((data_dir / 'venues.json').read_text(encoding='utf-8'))
        brands = {b['id']: b for b in json.loads((data_dir / 'brands.json').read_text(encoding='utf-8'))}
        dishes = {d['id']: d for d in json.loads((data_dir / 'dishes.json').read_text(encoding='utf-8'))}

        if opts['reset']:
            for model in (MenuEvent, ScanEvent, VenueMenuItem, VenueAccount, Lead):
                model.objects.all().delete()
            QRCode.objects.all().delete()
            self.stdout.write(self.style.WARNING('SaaS-данные очищены'))

        accounts = []
        for row in venues_json:
            venue, _ = Venue.objects.update_or_create(
                slug=row['id'],
                defaults=dict(
                    name=row['name'], city=row['city'], address=row['address'], venue_type=row['venue_type'],
                    description=row['description'], is_active=True,
                    accent=rnd.choice(['#F7941D', '#C8102E', '#1B7F5A']),
                    menu_headline='Что взять к вашему блюду?', currency='₸',
                    phone='+7 777 000 00 0' + str(rnd.randint(0, 9)),
                ),
            )
            email = f"{row['id'].split('-')[0]}@demo.flavortree.kz"
            account = VenueAccount.objects.filter(venue=venue).first() or VenueAccount(venue=venue, email=email)
            account.email = email
            account.contact_name = 'Управляющий'
            account.phone = venue.phone
            account.plan = 'PRO' if row is venues_json[0] else 'START'
            account.paid_until = timezone.now() + timedelta(days=rnd.randint(20, 300))
            account.set_password(DEMO_PASSWORD)
            account.save()

            # ── карта заведения с ценами ──
            for i, slug in enumerate(row['brands']):
                brand = brands.get(slug)
                if not brand:
                    continue
                pack = brand.get('packaging_type', 'BOTTLE')
                VenueMenuItem.objects.update_or_create(
                    venue=venue, kind='BEER', ref_slug=slug,
                    defaults=dict(price=_price(*BEER_PRICE.get(pack, BEER_PRICE['BOTTLE']), rnd=rnd),
                                  volume=VOLUME.get(pack, '0.5 л'),
                                  category='Разливное' if pack == 'DRAFT' else 'Бутылка и банка',
                                  is_available=True, is_featured=i < 2, sort_order=i),
                )
            for i, slug in enumerate(row['menu']):
                dish = dishes.get(slug)
                if not dish:
                    continue
                VenueMenuItem.objects.update_or_create(
                    venue=venue, kind='DISH', ref_slug=slug,
                    defaults=dict(price=_price(*DISH_PRICE.get(dish.get('weight', 'MEDIUM'), DISH_PRICE['MEDIUM']), rnd=rnd),
                                  volume='', category=dish.get('category', 'Основное'),
                                  is_available=True, is_featured=i < 3, sort_order=i),
                )

            # ── столы ──
            have = venue.qrcodes.count()
            if have < row['tables']:
                _create_tables(venue, row['tables'] - have)
            accounts.append(account)

        if opts['events']:
            self._events(accounts, opts['events'], rnd)

        if not Lead.objects.exists():
            Lead.objects.create(venue_name='Paulaner Brauhaus', contact_name='Асхат', phone='+7 701 111 22 33',
                                city='Алматы', tables=22, plan_interest='PRO', source='landing',
                                comment='Интересует интеграция с iiko')

        self.stdout.write(self.style.SUCCESS(
            f'\nГотово. Аккаунты (пароль {DEMO_PASSWORD}):\n' +
            '\n'.join(f'  {a.email:38} → {a.venue.name} [{a.plan}] /m/{a.venue.slug}' for a in accounts)
        ))

    def _events(self, accounts, total: int, rnd: random.Random) -> None:
        """История за 30 дней: вечерние часы, пятница-суббота плотнее — график выглядит как жизнь."""
        now = timezone.now()
        made = 0
        for account in accounts:
            venue = account.venue
            tables = list(venue.qrcodes.values_list('table_number', flat=True)) or [1]
            beers = list(venue.menu_items.filter(kind='BEER'))
            meals = list(venue.menu_items.filter(kind='DISH'))
            if not beers or not meals:
                continue
            for _ in range(total // max(1, len(accounts))):
                days_ago = rnd.randint(0, 29)
                ts = now - timedelta(days=days_ago, hours=rnd.randint(0, 6), minutes=rnd.randint(0, 59))
                if ts.weekday() in (4, 5) and rnd.random() < 0.35:
                    ts -= timedelta(minutes=rnd.randint(0, 120))
                table = rnd.choice(tables)
                session = f's{rnd.randrange(10**8):08d}'

                scan = ScanEvent.objects.create(venue=venue, table_number=table, session_key=session,
                                                user_agent='Mozilla/5.0 (iPhone)')
                ScanEvent.objects.filter(pk=scan.pk).update(created_at=ts)
                QRCode.objects.filter(venue=venue, table_number=table).update(last_scan_at=ts)

                dish = rnd.choice(meals)
                beer = rnd.choice(beers)
                steps = [('DISH_VIEW', dish, None, Decimal('0')), ('PAIR_VIEW', dish, beer, Decimal('0'))]
                if rnd.random() < 0.34:                       # треть гостей жмёт «Заказать»
                    steps.append(('ORDER_INTENT', dish, beer, beer.price))
                for offset, (kind, d, b, price) in enumerate(steps, start=1):
                    ev = MenuEvent.objects.create(
                        venue=venue, kind=kind, dish_slug=d.ref_slug, beer_slug=b.ref_slug if b else '',
                        score=rnd.randint(72, 96) if b else None, price=price,
                        table_number=table, session_key=session)
                    MenuEvent.objects.filter(pk=ev.pk).update(created_at=ts + timedelta(minutes=offset))
                    made += 1
        # счётчик на самом QR — его владелец видит в списке столов
        for qr in QRCode.objects.all():
            qr.scans_count = ScanEvent.objects.filter(venue_id=qr.venue_id, table_number=qr.table_number).count()
            qr.save(update_fields=['scans_count'])
        self.stdout.write(f'Сгенерировано событий гостей: {made}')

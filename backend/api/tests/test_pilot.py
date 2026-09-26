import csv
import io
import json
import shutil
import tempfile
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from unittest import mock
from zoneinfo import ZoneInfo

import segno
from django.core.cache import cache
from django.core.management import call_command
from django.db import OperationalError
from django.test import TestCase, override_settings

from api import pilot
from api.models import MenuDrink, Order, OrderItem, PairingFeedback, PilotEvent, QRCode
from api.views_pilot import EventsThrottle
from .helpers import make_user, client_for, make_brand, make_dish, make_venue, make_menu_item

ALMATY = ZoneInfo('Asia/Almaty')
SID_A = '11111111-1111-4111-8111-111111111111'


def at(day, hour=12, minute=0):
    """Момент по времени Алматы: 2026-10-<day> hour:minute."""
    return datetime(2026, 10, day, hour, minute, tzinfo=ALMATY)


class PilotBase(TestCase):
    def setUp(self):
        cache.clear()
        self.rest = make_user('rest', role='restaurant_admin')
        self.other = make_user('other', role='restaurant_admin')
        self.mod = make_user('mod', role='moderator')
        self.venue = make_venue(owner=self.rest, tables_count=10)
        self.other_venue = make_venue('Бар 13', owner=self.other)
        self.besh = make_menu_item(self.venue, make_dish('Бешбармак'), price='4500')
        self.foreign_item = make_menu_item(self.other_venue, make_dish('Самса'), price='1500')
        self.kozel = MenuDrink.objects.create(
            venue=self.venue, brand=make_brand('Velkopopovický Kozel'), price='2200', volume='0,5 л')


class EventsTests(PilotBase):
    url = '/api/events/'

    def send(self, events, client=None, **extra):
        body = dict({'session': SID_A, 'venue': 'efes-beer-garden', 'events': events}, **extra)
        return (client or client_for()).post(self.url, body, format='json')

    def test_batch_is_stored_with_links(self):
        resp = self.send([
            {'kind': 'SCAN', 'table': 3, 'meta': {'src': 'qr'}},
            {'kind': 'menu_open', 'table': 3},
            {'kind': 'PAIR_OPEN', 'table': 3, 'menu_item': str(self.besh.id), 'menu_drink': str(self.kozel.id),
             'rank': 1, 'source': 'sommelier'},
            {'kind': 'PAIR_ADD', 'menu_item': str(self.foreign_item.id), 'drink_ref': 'kozel', 'rank': 'x'},
            {'kind': 'AI_ASK', 'table': 99, 'meta': 'не объект'},
            {'kind': 'ORDER', 'meta': {'order': 'fake'}},
            {'kind': 'FEEDBACK'},
            {'kind': 'NO_SUCH_KIND'},
            'не событие',
        ])
        self.assertEqual(resp.status_code, 204, resp.content)
        events = list(PilotEvent.objects.order_by('id'))
        self.assertEqual([e.kind for e in events], ['SCAN', 'MENU_OPEN', 'PAIR_OPEN', 'PAIR_ADD', 'AI_ASK'])
        self.assertTrue(all(e.venue == self.venue and e.session == SID_A for e in events))
        scan, menu_open, pair_open, pair_add, ai_ask = events
        self.assertEqual((scan.table_number, scan.meta), (3, {'src': 'qr'}))
        self.assertEqual((pair_open.menu_item, pair_open.menu_drink, pair_open.rank, pair_open.source),
                         (self.besh, self.kozel, 1, 'SOMMELIER'))
        # Блюдо другого заведения не привязываем, но id сохраняем ссылкой.
        self.assertIsNone(pair_add.menu_item)
        self.assertEqual((pair_add.dish_ref, pair_add.drink_ref, pair_add.rank),
                         (str(self.foreign_item.id), 'kozel', None))
        # Стол вне заведения и meta не объектом отбрасываются.
        self.assertEqual((ai_ask.table_number, ai_ask.meta), (None, {}))

    def test_plain_text_body_from_send_beacon(self):
        body = json.dumps({'session': SID_A, 'venue': 'efes-beer-garden', 'events': [{'kind': 'MENU_OPEN'}]})
        resp = client_for().post(self.url, body, content_type='text/plain;charset=UTF-8')
        self.assertEqual(resp.status_code, 204, resp.content)
        self.assertEqual(PilotEvent.objects.get().kind, 'MENU_OPEN')

    def test_without_venue_and_bad_session(self):
        resp = client_for().post(self.url, {'session': 'drop table;', 'events': [
            {'kind': 'CATALOG_OPEN'}, {'kind': 'PAIRING_V2', 'dish_ref': 'beshbarmak', 'drink_ref': 'kozel'},
        ]}, format='json')
        self.assertEqual(resp.status_code, 204, resp.content)
        self.assertEqual(list(PilotEvent.objects.values_list('venue', 'session')), [(None, ''), (None, '')])

    def test_limits(self):
        self.assertEqual(self.send([{'kind': 'MENU_OPEN'}] * 21).status_code, 400)
        self.assertEqual(self.send({'kind': 'MENU_OPEN'}).status_code, 400)
        self.assertEqual(self.send([{'kind': 'MENU_OPEN'}] * 20).status_code, 204)
        self.assertEqual(PilotEvent.objects.count(), 20)

    def test_scan_counts_qr_code(self):
        qr = QRCode.objects.create(venue=self.venue, table_number=4, unique_token='t4')
        self.send([{'kind': 'SCAN', 'table': 4}])
        self.send([{'kind': 'SCAN', 'table': 4}, {'kind': 'SCAN', 'table': 5}])
        qr.refresh_from_db()
        self.assertEqual(qr.scans_count, 2)

    def test_throttled_per_ip(self):
        with mock.patch.object(EventsThrottle, 'default_rate', '3/min'):
            codes = [self.send([{'kind': 'MENU_OPEN'}]).status_code for _ in range(4)]
            # Вход не спасает от лимита: он считается по адресу.
            logged = self.send([{'kind': 'MENU_OPEN'}], client=client_for(self.rest)).status_code
        self.assertEqual(codes, [204, 204, 204, 429])
        self.assertEqual(logged, 429)
        self.assertEqual(PilotEvent.objects.count(), 3)

    def test_record_event_never_raises(self):
        with self.assertLogs('api.pilot', level='ERROR') as logs:
            self.assertIsNone(pilot.record_event('NOPE', venue=self.venue))
            self.assertIsNone(pilot.record_event('SCAN', venue=self.venue, unknown_field=1))
        self.assertEqual(len(logs.records), 2)
        event = pilot.record_event('AGE_OK', venue=self.venue, session=SID_A, meta={'age': 21})
        self.assertEqual(event.kind, 'AGE_OK')
        self.assertEqual(PilotEvent.objects.count(), 1)


class FeedbackTests(PilotBase):
    url = '/api/feedback/'

    def make_order(self, venue=None, table=6):
        venue = venue or self.venue
        return Order.objects.create(venue=venue, number=Order.objects.filter(venue=venue).count() + 1,
                                    table_number=table, guest_token='tok-{}'.format(Order.objects.count()),
                                    session=SID_A)

    def test_feedback_with_order(self):
        order = self.make_order()
        resp = client_for().post(self.url, {
            'order': str(order.id), 'dish_ref': str(self.besh.id), 'drink_ref': str(self.kozel.id),
            'rating': 5, 'comment': '  Kozel отлично к бешбармаку  ',
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        item = PairingFeedback.objects.get()
        # Заведение и сессия берутся из заказа.
        self.assertEqual((item.venue, item.order, item.session, item.rating), (self.venue, order, SID_A, 5))
        self.assertEqual(item.comment, 'Kozel отлично к бешбармаку')
        event = PilotEvent.objects.get(kind='FEEDBACK')
        self.assertEqual((event.venue, event.session, event.table_number), (self.venue, SID_A, 6))
        self.assertEqual(event.meta, {'feedback': item.pk, 'rating': 5, 'order': str(order.id)})
        self.assertEqual(resp.json(), {'id': item.pk, 'rating': 5})

    def test_foreign_order_not_linked_and_long_comment_cut(self):
        foreign = self.make_order(venue=self.other_venue)
        resp = client_for().post(self.url, {
            'venue': 'efes-beer-garden', 'session': SID_A, 'order': str(foreign.id),
            'rating': 3, 'comment': 'а' * 800,
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        item = PairingFeedback.objects.get()
        self.assertEqual((item.venue, item.order), (self.venue, None))
        self.assertEqual(len(item.comment), 500)

    def test_rating_validation(self):
        for rating in (0, 6, 'пять', None):
            resp = client_for().post(self.url, {'venue': 'efes-beer-garden', 'rating': rating}, format='json')
            self.assertEqual(resp.status_code, 400, rating)
            self.assertIn('rating', resp.data)
        self.assertFalse(PairingFeedback.objects.exists())
        self.assertFalse(PilotEvent.objects.exists())


class ReportFixture(PilotBase):
    """
    Два дня пилота в Efes Beer Garden и немного шума вокруг.
    1 октября: гость A (стол 3) сканирует, открывает подбор к бешбармаку, берёт Kozel из подбора и заказывает;
               гость B (стол 5) сканирует и заказывает два бешбармака без подбора.
    2 октября: гость C (стол 7) открывает меню по ссылке, смотрит подбор, спрашивает ИИ и заказывает
               два Kozel из чата; гость D отменяет заказ; гость E заходит в 23:30.
    Вне отчёта: гость F в 00:30 3 октября и события другого заведения.
    """

    def setUp(self):
        super().setUp()
        self.orders = {}
        ev = self.event
        ev(1, 10, 'A', 'SCAN', table=3)
        ev(1, 10, 'A', 'MENU_OPEN', table=3)
        ev(1, 11, 'A', 'PAIR_OPEN', table=3, menu_item=self.besh, menu_drink=self.kozel, rank=1)
        ev(1, 11, 'A', 'PAIR_ADD', table=3, menu_item=self.besh, menu_drink=self.kozel, rank=1)
        ev(1, 12, 'B', 'SCAN', table=5)
        ev(1, 12, 'B', 'MENU_OPEN', table=5)
        ev(2, 19, 'C', 'MENU_OPEN', table=7)
        # Ссылки по id движка тоже сводятся к названиям.
        ev(2, 19, 'C', 'PAIR_OPEN', table=7, dish_ref=str(self.besh.id), drink_ref=str(self.kozel.id), rank=1)
        ev(2, 20, 'C', 'AI_ASK', table=7)
        ev(2, 20, 'C', 'AI_ADD', table=7)
        ev(2, 23, 'E', 'MENU_OPEN', minute=30)
        ev(3, 0, 'F', 'MENU_OPEN', minute=30)
        ev(1, 12, 'X', 'SCAN', table=1, venue=self.other_venue)

        self.order(1, 13, 'A', 3, [('DISH', self.besh, 1, 'MENU', None),
                                   ('DRINK', self.kozel, 1, 'PAIRING', self.besh)])
        self.order(1, 14, 'B', 5, [('DISH', self.besh, 2, 'MENU', None)])
        self.order(2, 21, 'C', 7, [('DRINK', self.kozel, 2, 'AI', None)])
        self.order(2, 22, 'D', 7, [('DISH', self.besh, 1, 'MENU', None)], status=Order.STATUS_CANCELLED)
        self.order(1, 15, 'X', 1, [('DISH', self.foreign_item, 1, 'MENU', None)], venue=self.other_venue)

        self.feedback(1, 16, 'A', str(self.besh.id), str(self.kozel.id), 5, 'Идеально, возьму ещё')
        self.feedback(2, 22, 'C', str(self.besh.id), 'Velkopopovický Kozel', 4, '')

    def sid(self, letter):
        return letter.lower() * 8 + '-0000-4000-8000-000000000000'

    def event(self, day, hour, who, kind, minute=0, venue=None, table=None, **fields):
        event = pilot.record_event(kind, venue=venue or self.venue, session=self.sid(who),
                                   table_number=table, **fields)
        assert event is not None
        PilotEvent.objects.filter(pk=event.pk).update(created_at=at(day, hour, minute))

    def order(self, day, hour, who, table, lines, status=Order.STATUS_NEW, venue=None):
        venue = venue or self.venue
        total = sum(Decimal(src.price) * qty for _, src, qty, _, _ in lines)
        order = Order.objects.create(
            venue=venue, number=Order.objects.filter(venue=venue).count() + 1, table_number=table,
            guest_name='Имя гостя {}'.format(who), guest_token='token-{}'.format(who), session=self.sid(who),
            status=status, total=total, age_confirmed=True)
        for kind, src, qty, source, paired in lines:
            OrderItem.objects.create(
                order=order, kind=kind, menu_item=src if kind == 'DISH' else None,
                menu_drink=src if kind == 'DRINK' else None,
                title=src.dish.name if kind == 'DISH' else src.display_name,
                price=src.price, qty=qty, source=source, paired_menu_item=paired,
                rec_rank=1 if paired else None)
        Order.objects.filter(pk=order.pk).update(created_at=at(day, hour))
        self.orders[who] = order

    def feedback(self, day, hour, who, dish_ref, drink_ref, rating, comment):
        item = PairingFeedback.objects.create(
            venue=self.venue, order=self.orders.get(who), session=self.sid(who),
            dish_ref=dish_ref, drink_ref=drink_ref, rating=rating, comment=comment)
        PairingFeedback.objects.filter(pk=item.pk).update(created_at=at(day, hour))

    def report(self, user=None, **params):
        query = dict({'venue': 'efes-beer-garden', 'from': '2026-10-01', 'to': '2026-10-02'}, **params)
        query = {k: v for k, v in query.items() if v is not None}
        return client_for(self.rest if user is None else user).get('/api/pilot/report/', query)


class ReportTests(ReportFixture):
    def test_numbers(self):
        resp = self.report()
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertEqual(data['venue'], {'slug': 'efes-beer-garden', 'name': 'Efes Beer Garden'})
        self.assertEqual(data['period'], {'from': '2026-10-01', 'to': '2026-10-02', 'tz': 'Asia/Almaty'})
        totals = data['totals']
        expected = {
            'sessions': 5,  # A, B, C, E и D (только отменённый заказ)
            'scans': 2, 'menu_opens': 4, 'pair_opens': 2, 'pair_adds': 1,
            'orders': 3, 'orders_with_pairing': 2,
            'items': 6, 'items_from_pairing': 3, 'share_items_from_pairing': 0.5,
            'avg_check': 6700.0,  # (6700 + 9000 + 4400) / 3
            'avg_check_with_pairing': 5550.0, 'avg_check_without_pairing': 9000.0,
            'feedback_count': 2, 'avg_rating': 4.5, 'ai_asks': 1, 'ai_adds': 1,
            'orders_cancelled': 1, 'items_from_ai': 2, 'drinks': 3, 'drinks_from_pairing': 3,
            'share_drinks_from_pairing': 1.0, 'revenue': 20100.0, 'age_confirmations': 0,
        }
        for key, value in expected.items():
            self.assertEqual(totals[key], value, key)

        self.assertEqual([(s['step'], s['count']) for s in data['funnel']], [
            ('scan', 2), ('menu_open', 4), ('pair_open', 2), ('pair_add', 1), ('order', 3), ('order_with_pairing', 2),
        ])
        self.assertEqual(data['funnel'][0]['label'], 'Отсканировали QR')

        day1, day2 = data['by_day']
        self.assertEqual(day1, {'date': '2026-10-01', 'sessions': 2, 'scans': 2, 'pair_opens': 1, 'pair_adds': 1,
                                'orders': 2, 'orders_with_pairing': 1, 'avg_check': 7850.0, 'revenue': 15700.0})
        # Событие в 23:30 по Алматы - ещё 2 октября, в 00:30 3 октября - уже вне периода.
        self.assertEqual(day2, {'date': '2026-10-02', 'sessions': 3, 'scans': 0, 'pair_opens': 1, 'pair_adds': 0,
                                'orders': 1, 'orders_with_pairing': 1, 'avg_check': 4400.0, 'revenue': 4400.0})

        self.assertEqual(data['by_table'], [
            {'table': 3, 'sessions': 1, 'scans': 1, 'orders': 1},
            {'table': 5, 'sessions': 1, 'scans': 1, 'orders': 1},
            {'table': 7, 'sessions': 2, 'scans': 0, 'orders': 1},
        ])
        self.assertEqual(data['top_pairs'], [{
            'dish': 'Бешбармак', 'drink': 'Velkopopovický Kozel',
            'opens': 2, 'adds': 1, 'ordered': 1, 'avg_rating': 4.5, 'ratings': 2,
        }])
        self.assertEqual([(f['rating'], f['comment'], f['order_number']) for f in data['feedback']],
                         [(4, '', 3), (5, 'Идеально, возьму ещё', 1)])

    def test_single_day_and_default_period(self):
        totals = self.report(**{'from': '2026-10-02', 'to': '2026-10-02'}).json()['totals']
        self.assertEqual((totals['orders'], totals['scans'], totals['avg_check']), (1, 0, 4400.0))
        # Без дат: с первого дня с данными до сегодня.
        with mock.patch('api.pilot_report.local_today', return_value=date(2026, 10, 3)):
            data = self.report(**{'from': None, 'to': None}).json()
        self.assertEqual(data['period']['to'], '2026-10-03')
        self.assertEqual(data['period']['from'], '2026-10-01')
        self.assertEqual(data['totals']['menu_opens'], 5)

    def test_empty_period(self):
        totals = self.report(**{'from': '2026-11-01', 'to': '2026-11-01'}).json()['totals']
        self.assertEqual(totals['orders'], 0)
        self.assertIsNone(totals['avg_check'])
        self.assertIsNone(totals['share_items_from_pairing'])
        self.assertIsNone(totals['avg_rating'])

    def test_bad_dates(self):
        self.assertEqual(self.report(**{'from': '01.10.2026'}).status_code, 400)
        self.assertEqual(self.report(**{'from': '2026-10-05', 'to': '2026-10-01'}).status_code, 400)
        self.assertEqual(self.report(**{'from': '2024-01-01', 'to': '2026-10-01'}).status_code, 400)

    def test_permissions(self):
        self.assertEqual(client_for().get('/api/pilot/report/?venue=efes-beer-garden').status_code, 401)
        self.assertEqual(self.report(user=make_user('plain')).status_code, 403)
        self.assertEqual(self.report(user=make_user('somm', role='sommelier')).status_code, 403)
        self.assertEqual(self.report(user=self.other).status_code, 403)
        self.assertEqual(self.report(user=self.rest, venue='nope').status_code, 404)
        # Владелец без ?venue= получает своё заведение, чужой владелец - своё.
        self.assertEqual(self.report(venue=None).json()['venue']['slug'], 'efes-beer-garden')
        self.assertEqual(self.report(user=self.other, venue=None).json()['totals']['orders'], 1)
        # Модератор видит любое заведение и все сразу.
        self.assertEqual(self.report(user=self.mod).json()['totals']['orders'], 3)
        everything = self.report(user=self.mod, venue=None).json()
        self.assertIsNone(everything['venue'])
        self.assertEqual(everything['totals']['orders'], 4)
        self.assertEqual(everything['totals']['scans'], 3)


class ExportTests(ReportFixture):
    def export(self, user=None, **params):
        query = dict({'venue': 'efes-beer-garden', 'from': '2026-10-01', 'to': '2026-10-02', 'kind': 'orders'},
                     **params)
        return client_for(self.rest if user is None else user).get('/api/pilot/export.csv', query)

    def rows(self, resp, delimiter=';'):
        text = resp.content.decode('utf-8')
        self.assertTrue(text.startswith('﻿'))
        return list(csv.reader(io.StringIO(text[1:]), delimiter=delimiter))

    def test_orders_csv(self):
        resp = self.export()
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp['Content-Type'], 'text/csv; charset=utf-8')
        self.assertIn('pilot-efes-beer-garden-orders-2026-10-01-2026-10-02.csv', resp['Content-Disposition'])
        rows = self.rows(resp)
        self.assertEqual(rows[0][:4], ['Время', 'Заведение', 'Заказ №', 'Статус'])
        # Строка на каждую позицию, отменённый заказ тоже виден по статусу.
        self.assertEqual(len(rows) - 1, 5)
        first_kozel = rows[2]
        self.assertEqual(first_kozel[0], '2026-10-01 13:00:00')
        self.assertEqual(first_kozel[9:], ['Velkopopovický Kozel', '1', '2200', 'Подбор', 'Бешбармак', '1'])
        self.assertEqual(rows[-1][3], 'Отменён')
        # Имени гостя в выгрузке нет.
        self.assertNotIn('Имя гостя', resp.content.decode('utf-8'))

    def test_events_and_feedback_csv(self):
        rows = self.rows(self.export(kind='events'))
        self.assertEqual(len(rows) - 1, 11)  # события заведения за два дня, без F и чужого бара
        self.assertIn('Открыл подбор', [r[3] for r in rows])
        pair_open = next(r for r in rows if r[4] == 'PAIR_OPEN')
        self.assertEqual(pair_open[6:8], ['Бешбармак', 'Velkopopovický Kozel'])

        PairingFeedback.objects.filter(rating=4).update(comment='=HYPERLINK("http://evil")')
        rows = self.rows(self.export(kind='feedback'))
        self.assertEqual([r[7] for r in rows[1:]], ['5', '4'])
        self.assertEqual(rows[2][8], '\'=HYPERLINK("http://evil")')

        rows = self.rows(self.export(kind='orders', sep='comma'), delimiter=',')
        self.assertEqual(len(rows) - 1, 5)

    def test_export_errors_and_permissions(self):
        self.assertEqual(self.export(kind='users').status_code, 400)
        self.assertEqual(self.export(user=self.other).status_code, 403)
        self.assertEqual(client_for().get('/api/pilot/export.csv?venue=efes-beer-garden').status_code, 401)
        resp = client_for(self.mod).get('/api/pilot/export.csv?kind=orders&from=2026-10-01&to=2026-10-02',
                                        HTTP_ACCEPT='text/csv')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(self.rows(resp)) - 1, 6)

    def test_management_command(self):
        folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, folder, True)
        out = io.StringIO()
        call_command('pilot_report', '--venue', 'efes-beer-garden', '--from', '2026-10-01', '--to', '2026-10-02',
                     '--csv', str(folder), stdout=out)
        text = out.getvalue()
        self.assertIn('Заказов: 3', text)
        self.assertIn('Доля позиций из подбора: 50.0%', text)
        self.assertIn('Средний чек с подбором, тг: 5550.0', text)
        self.assertIn('Бешбармак + Velkopopovický Kozel: открыли 2, добавили 1, заказали 1, оценка 4.5', text)
        names = sorted(p.name for p in folder.iterdir())
        self.assertEqual(names, ['by_day.csv', 'events.csv', 'feedback.csv', 'orders.csv', 'top_pairs.csv'])
        by_day = (folder / 'by_day.csv').read_text(encoding='utf-8')
        self.assertTrue(by_day.startswith('﻿Дата;Гостей'))
        self.assertIn('2026-10-01;2;2;1;1;2;1;7850;15700', by_day)


@override_settings(FT_PUBLIC_SITE_URL='https://pilot.example.kz')
class QrTests(PilotBase):
    def expected_svg(self, url, title):
        buffer = io.BytesIO()
        segno.make_qr(url, error='m').save(buffer, kind='svg', scale=10, border=4, xmldecl=False, title=title)
        return buffer.getvalue()

    def test_qr_encodes_menu_link(self):
        resp = client_for().get('/api/venues/efes-beer-garden/qr.svg?table=3')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp['Content-Type'], 'image/svg+xml')
        self.assertTrue(resp.content.startswith(b'<svg'))
        self.assertEqual(resp.content, self.expected_svg(
            'https://pilot.example.kz/menu/efes-beer-garden?table=3&src=qr', 'Efes Beer Garden, стол 3'))
        self.assertNotIn('Content-Disposition', resp)
        # Без стола - ссылка просто на меню; с download=1 - файлом.
        resp = client_for().get('/api/venues/efes-beer-garden/qr.svg?download=1', HTTP_ACCEPT='image/svg+xml')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.content, self.expected_svg(
            'https://pilot.example.kz/menu/efes-beer-garden?src=qr', 'Efes Beer Garden'))
        self.assertIn('qr-efes-beer-garden-menu.svg', resp['Content-Disposition'])

    @override_settings(FT_PUBLIC_SITE_URL='', CORS_ALLOWED_ORIGINS=['http://localhost:4200', 'http://127.0.0.1:4200'])
    def test_site_from_referer_or_debug(self):
        resp = client_for().get('/api/venues/efes-beer-garden/qr.svg?table=2',
                                HTTP_REFERER='https://front.example.kz/sommelier-admin?tab=qr')
        self.assertEqual(resp.content, self.expected_svg(
            'https://front.example.kz/menu/efes-beer-garden?table=2&src=qr', 'Efes Beer Garden, стол 2'))
        # Запрос со страницы самого бэкенда адрес сайта не задаёт; тогда берём домен фронтенда из CORS.
        with self.settings(CORS_ALLOWED_ORIGINS=['http://localhost:4200', 'https://flavor.example.kz']):
            resp = client_for().get('/api/venues/efes-beer-garden/qr.svg', HTTP_REFERER='http://testserver/admin/')
        self.assertEqual(resp.content, self.expected_svg(
            'https://flavor.example.kz/menu/efes-beer-garden?src=qr', 'Efes Beer Garden'))
        with self.assertLogs('django.request', level='ERROR'):
            resp = client_for().get('/api/venues/efes-beer-garden/qr.svg', HTTP_REFERER='http://testserver/admin/')
        self.assertEqual(resp.status_code, 503)
        self.assertIn('FT_PUBLIC_SITE_URL', resp.json()['detail'])
        with self.settings(DEBUG=True):
            resp = client_for().get('/api/venues/efes-beer-garden/qr.svg?table=2')
        self.assertEqual(resp.content, self.expected_svg(
            'http://localhost:4200/menu/efes-beer-garden?table=2&src=qr', 'Efes Beer Garden, стол 2'))

    def test_qr_errors_and_hidden_venue(self):
        for table in ('0', '11', 'abc'):
            resp = client_for().get('/api/venues/efes-beer-garden/qr.svg?table=' + table)
            self.assertEqual(resp.status_code, 400, table)
        self.assertEqual(client_for().get('/api/venues/nope/qr.svg').status_code, 404)
        self.venue.is_published = False
        self.venue.save()
        self.assertEqual(client_for().get('/api/venues/efes-beer-garden/qr.svg').status_code, 404)
        self.assertEqual(client_for(self.other).get('/api/venues/efes-beer-garden/qr.svg').status_code, 404)
        self.assertEqual(client_for(self.rest).get('/api/venues/efes-beer-garden/qr.svg').status_code, 200)
        self.assertEqual(client_for(self.mod).get('/api/venues/efes-beer-garden/qr.svg').status_code, 200)


class HealthTests(TestCase):
    def test_health_checks_database(self):
        resp = client_for().get('/api/health/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {'ok': True, 'db': True})
        with mock.patch('api.views.connection.cursor', side_effect=OperationalError('down')), \
                self.assertLogs('api.views', level='ERROR'), self.assertLogs('django.request', level='ERROR'):
            resp = client_for().get('/api/health/')
        self.assertEqual(resp.status_code, 503)
        self.assertEqual(resp.json(), {'ok': False, 'db': False})

from datetime import timedelta

from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from api.models import FlavorNote, FlavorProfile, FoodPairing, MenuDrink, Order, PairingFeedback, Tasting
from .helpers import client_for, make_brand, make_dish, make_menu_item, make_pairing, make_user, make_venue


class AnalyticsBase(TestCase):
    def setUp(self):
        cache.clear()
        self.owner = make_user('rest', role='restaurant_admin')
        self.other = make_user('other', role='restaurant_admin')
        self.mod = make_user('mod', role='moderator')
        self.somm = make_user('somm', role='sommelier')
        self.venue = make_venue(owner=self.owner, tables_count=10)
        make_venue('Бар 13', owner=self.other)
        self.kozel_brand = make_brand('Velkopopovický Kozel', style='Czech Lager')
        self.draught_brand = make_brand('Бочковое', style='Draft Lager', packaging_type='DRAFT')
        self.besh = make_menu_item(self.venue, make_dish('Бешбармак'), price='4500')
        self.plov = make_menu_item(self.venue, make_dish('Плов'), price='3000')
        self.salad = make_menu_item(self.venue, make_dish('Салат'), price='1500')
        self.kozel = MenuDrink.objects.create(venue=self.venue, brand=self.kozel_brand, price='2200')
        self.draught = MenuDrink.objects.create(venue=self.venue, brand=self.draught_brand, price='1800')
        self.pairing = make_pairing(self.kozel_brand, self.besh.dish, score=5)
        make_pairing(self.draught_brand, self.plov.dish, score=4)
        FoodPairing.objects.filter(brand=self.draught_brand).update(source=FoodPairing.SOURCE_AI)
        self.url = '/api/analytics/venue/{}/'.format(self.venue.slug)

    def order(self, *lines, table=3):
        """lines: (позиция меню, количество[, via])."""
        items = []
        for line in lines:
            source, qty = line[0], line[1]
            item = {'kind': 'DRINK' if isinstance(source, MenuDrink) else 'DISH', 'id': str(source.id), 'qty': qty}
            if len(line) > 2:
                item['via'] = line[2]
            items.append(item)
        resp = client_for().post('/api/orders/', {'venue': self.venue.slug, 'table_number': table, 'items': items}, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        return Order.objects.get(pk=resp.json()['id'])


class OrderViaTests(AnalyticsBase):
    def test_via_is_saved_and_defaults_to_menu(self):
        order = self.order((self.besh, 1), (self.kozel, 2, 'PAIRING'), (self.draught, 1, 'AI'))
        self.assertEqual([i.via for i in order.items.all()], ['MENU', 'PAIRING', 'AI'])
        resp = client_for().post('/api/orders/', {
            'venue': self.venue.slug, 'table_number': 1,
            'items': [{'kind': 'DISH', 'id': str(self.besh.id), 'qty': 1, 'via': 'BRIBE'}]}, format='json')
        self.assertEqual(resp.status_code, 400)


class VenueAnalyticsTests(AnalyticsBase):
    def fill(self):
        self.order((self.besh, 1), (self.kozel, 2, 'PAIRING'))             # 8900, пара по совету
        self.order((self.salad, 1))                                        # 1500, только еда
        self.order((self.plov, 1), (self.kozel, 1))                        # 5200, напиток не из пары
        self.order((self.plov, 2), (self.draught, 1, 'AI'))                # 7800, пара ИИ, разливное
        self.order((self.kozel, 1))                                        # 2200, только напиток
        cancelled = self.order((self.besh, 3))
        Order.objects.filter(pk=cancelled.pk).update(status=Order.STATUS_CANCELLED)
        old = self.order((self.besh, 1))
        Order.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=60))
        demo = self.order((self.besh, 1), (self.kozel, 1, 'PAIRING'))      # 6700, демо
        Order.objects.filter(pk=demo.pk).update(is_demo=True)

    def test_access(self):
        self.assertEqual(client_for().get(self.url).status_code, 401)
        self.assertEqual(client_for(self.other).get(self.url).status_code, 403)
        self.assertEqual(client_for(make_user('plain')).get(self.url).status_code, 403)
        self.assertEqual(client_for(self.owner).get(self.url).status_code, 200)
        self.assertEqual(client_for(self.mod).get(self.url).status_code, 200)
        self.assertEqual(client_for(self.mod).get('/api/analytics/venue/nope/').status_code, 404)

    def test_empty_period(self):
        data = client_for(self.owner).get(self.url).json()
        self.assertEqual(data['totals'], {'orders': 0, 'revenue': 0, 'avg_check': None})
        self.assertIsNone(data['pairing']['drink_rate'])
        self.assertIsNone(data['pairing']['avg_with_pair'])
        self.assertEqual(data['top_pairs'], [])
        self.assertEqual(data['dishes']['unpaired'], ['Салат'])
        self.assertEqual(len(data['by_day']), 31)

    def test_numbers_without_demo(self):
        self.fill()
        data = client_for(self.owner).get(self.url + '?demo=0').json()
        self.assertEqual(data['demo'], {'included': False, 'orders': 0})
        self.assertEqual(data['totals'], {'orders': 5, 'revenue': 25600, 'avg_check': 5120})
        pairing = data['pairing']
        self.assertEqual((pairing['dish_orders'], pairing['with_drink'], pairing['with_pair']), (4, 3, 2))
        self.assertEqual((pairing['drink_rate'], pairing['pair_rate']), (75, 50))
        self.assertEqual(pairing['avg_food_only'], 1500)
        self.assertEqual(pairing['avg_with_drink'], 7300)
        self.assertEqual(pairing['avg_with_pair'], 8350)
        self.assertEqual(data['advice'], {'pairing': {'qty': 2, 'revenue': 4400}, 'ai': {'qty': 1, 'revenue': 1800}})
        self.assertEqual((data['drinks']['qty'], data['drinks']['draught_qty'], data['drinks']['draught_rate']), (5, 1, 20))
        self.assertEqual(data['drinks']['top'][0], {'title': 'Velkopopovický Kozel', 'qty': 4, 'revenue': 8800, 'draught': False})
        self.assertEqual(data['dishes']['top'][0]['title'], 'Плов')
        pairs = {(p['dish'], p['drink']): p for p in data['top_pairs']}
        self.assertEqual(pairs[('Бешбармак', 'Velkopopovický Kozel')]['recommended'], True)
        self.assertEqual(pairs[('Бешбармак', 'Velkopopovický Kozel')]['source'], 'SOMMELIER')
        self.assertEqual(pairs[('Плов', 'Бочковое')]['source'], 'AI')
        self.assertEqual(pairs[('Плов', 'Velkopopovický Kozel')]['recommended'], False)
        today = data['by_day'][-1]
        self.assertEqual((today['orders'], today['revenue'], today['with_pair']), (5, 25600, 2))

    def test_demo_orders_are_counted_and_labelled(self):
        self.fill()
        data = client_for(self.owner).get(self.url).json()
        self.assertEqual(data['demo'], {'included': True, 'orders': 1})
        self.assertEqual(data['totals']['orders'], 6)
        self.assertEqual(data['pairing']['with_pair'], 3)
        # В рабочем списке заказов демо-заказа нет
        numbers = [o['id'] for o in client_for(self.owner).get('/api/orders/?venue=' + self.venue.slug).json()]
        demo_id = str(Order.objects.get(is_demo=True).id)
        self.assertNotIn(demo_id, numbers)

    def test_period_filter(self):
        self.fill()
        data = client_for(self.owner).get(self.url + '?demo=0&days=90').json()
        self.assertEqual(data['totals']['orders'], 6)
        self.assertEqual(data['period']['days'], 90)
        self.assertEqual(client_for(self.owner).get(self.url + '?days=abc').json()['period']['days'], 30)
        self.assertEqual(client_for(self.owner).get(self.url + '?days=100000').json()['period']['days'], 365)

    def test_feedback_of_the_venue(self):
        PairingFeedback.objects.create(pairing=self.pairing, device='d' * 20, venue=self.venue, liked=True)
        PairingFeedback.objects.create(pairing=self.pairing, device='e' * 20, venue=self.venue, liked=False)
        PairingFeedback.objects.create(pairing=self.pairing, device='f' * 20, liked=True)
        data = client_for(self.owner).get(self.url).json()
        self.assertEqual(data['feedback'], {'likes': 1, 'dislikes': 1})

    def test_export_csv(self):
        self.fill()
        self.assertEqual(client_for(self.other).get(self.url + 'export/').status_code, 403)
        resp = client_for(self.owner).get(self.url + 'export/?demo=0')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp['Content-Type'].startswith('text/csv'))
        self.assertIn('attachment', resp['Content-Disposition'])
        text = resp.content.decode('utf-8')
        self.assertTrue(text.startswith('﻿'))
        lines = text.lstrip('﻿').strip().splitlines()
        self.assertEqual(lines[0].split(';')[:7], ['Дата', 'Время', 'Заказ', 'Стол', 'Статус', 'Тип', 'Позиция'])
        self.assertEqual(len(lines), 1 + 8)
        first = lines[1].split(';')
        self.assertEqual(first[5:13], ['Блюдо', 'Бешбармак', '1', '4500', '4500', 'Из меню', 'да', ''])
        self.assertEqual(lines[2].split(';')[5:12], ['Напиток', 'Velkopopovický Kozel', '2', '2200', '4400', 'По совету пары', 'да'])


class DemoOrdersCommandTests(AnalyticsBase):
    def test_seed_and_clear(self):
        call_command('seed_demo_orders', '--venue', self.venue.slug, '--days', '7', verbosity=0)
        demo = Order.objects.filter(venue=self.venue, is_demo=True)
        self.assertGreater(demo.count(), 20)
        self.assertTrue(all(o.status == Order.STATUS_DONE and o.total > 0 for o in demo))
        self.assertEqual(client_for(self.owner).get('/api/orders/?venue=' + self.venue.slug).json(), [])
        self.assertEqual(client_for(self.owner).get('/api/orders/new-count/').json(), {'count': 0})
        data = client_for(self.owner).get(self.url + '?days=7').json()
        self.assertEqual(data['demo']['orders'], data['totals']['orders'])
        self.assertGreater(data['pairing']['with_pair'], 0)
        # Настоящий заказ после демо получает следующий свободный номер
        real = self.order((self.besh, 1))
        self.assertEqual(real.number, demo.count() + 1)
        # Повторный запуск не удваивает демо-данные
        count = demo.count()
        call_command('seed_demo_orders', '--venue', self.venue.slug, '--days', '7', verbosity=0)
        self.assertEqual(Order.objects.filter(is_demo=True).count(), count)
        call_command('seed_demo_orders', '--venue', self.venue.slug, '--clear', verbosity=0)
        self.assertEqual(Order.objects.filter(is_demo=True).count(), 0)
        self.assertTrue(Order.objects.filter(pk=real.pk).exists())


class BrandsAnalyticsTests(AnalyticsBase):
    def test_roles(self):
        url = '/api/analytics/brands/'
        self.assertEqual(client_for().get(url).status_code, 401)
        self.assertEqual(client_for(make_user('plain')).get(url).status_code, 403)
        self.assertEqual(client_for(self.owner).get(url).status_code, 403)
        self.assertEqual(client_for(self.somm).get(url).status_code, 200)
        self.assertEqual(client_for(self.mod).get(url).status_code, 200)

    def test_brand_rows(self):
        note = FlavorNote.objects.create(name='Карамель', category='HEART', description='x', icon='*')
        other = FlavorNote.objects.create(name='Банан', category='TOP', description='x', icon='*')
        FlavorProfile.objects.create(brand=self.kozel_brand, flavor_note=note, layer='HEART', intensity=7)
        for i, rating in enumerate((5, 4, 3)):
            tasting = Tasting.objects.create(user=make_user('t{}'.format(i)), brand=self.kozel_brand, rating=rating, matched=1)
            tasting.notes.set([note] if i else [note, other])
        PairingFeedback.objects.create(pairing=self.pairing, device='d' * 20, liked=True)
        PairingFeedback.objects.create(pairing=self.pairing, device='e' * 20, liked=True)
        PairingFeedback.objects.create(pairing=self.pairing, device='f' * 20, liked=False)
        self.order((self.besh, 1), (self.kozel, 3))
        demo = self.order((self.kozel, 5))
        Order.objects.filter(pk=demo.pk).update(is_demo=True)

        data = client_for(self.somm).get('/api/analytics/brands/').json()
        self.assertEqual(data['totals']['tastings'], 3)
        self.assertEqual(data['totals']['tasters'], 3)
        self.assertEqual(data['totals']['votes'], 3)
        self.assertEqual((data['totals']['pairings'], data['totals']['ai_pairings']), (2, 1))
        row = data['brands'][0]
        self.assertEqual(row['name'], 'Velkopopovický Kozel')
        self.assertEqual((row['tastings'], row['rating_avg'], row['matched_avg']), (3, 4.0, 1.0))
        self.assertEqual((row['votes'], row['liked_rate']), (3, 67))
        self.assertEqual(row['ordered'], 3)  # демо-заказ в счёт не идёт
        self.assertEqual([(n['name'], n['share'], n['in_pyramid']) for n in row['heard']],
                         [('Карамель', 100, True), ('Банан', 33, False)])
        quiet = [r for r in data['brands'] if r['name'] == 'Бочковое'][0]
        self.assertEqual((quiet['tastings'], quiet['rating_avg'], quiet['heard'], quiet['liked_rate']), (0, None, [], None))
        self.assertEqual(quiet['ai_pairings'], 1)

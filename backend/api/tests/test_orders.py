from django.test import TestCase

from api.models import MenuDrink, MenuItem, Order, PilotEvent, Venue
from .helpers import make_user, client_for, make_brand, make_dish, make_venue, make_menu_item


class OrderTestsBase(TestCase):
    def setUp(self):
        self.rest = make_user('rest', role='restaurant_admin')
        self.other = make_user('other', role='restaurant_admin')
        self.mod = make_user('mod', role='moderator')
        self.venue = make_venue(owner=self.rest, tables_count=10)
        self.other_venue = make_venue('Бар 13', owner=self.other)
        self.besh = make_menu_item(self.venue, make_dish('Бешбармак'), price='4500')
        self.manty = make_menu_item(self.venue, make_dish('Манты'), price='2600', is_available=False)
        self.foreign_item = make_menu_item(self.other_venue, make_dish('Самса'), price='1500')
        self.kozel = MenuDrink.objects.create(
            venue=self.venue, brand=make_brand('Velkopopovický Kozel'), price='2200', volume='0,5 л')
        self.url = '/api/orders/'

    def body(self, **extra):
        data = {
            'venue': 'efes-beer-garden',
            'table_number': 7,
            'guest_name': 'Айдар',
            'comment': 'Без лука',
            'age_confirmed': True,
            'items': [
                {'kind': 'DISH', 'id': str(self.besh.id), 'qty': 2},
                {'kind': 'DRINK', 'id': str(self.kozel.id), 'qty': 1, 'note': 'похолоднее'},
            ],
        }
        data.update(extra)
        return data

    def place(self, **extra):
        resp = client_for().post(self.url, self.body(**extra), format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        return resp.json()


class OrderGuestTests(OrderTestsBase):
    def test_public_create_shape_and_numbering(self):
        order = self.place()
        for key in ('id', 'number', 'status', 'status_display', 'total', 'guest_token', 'items',
                    'created_at', 'venue', 'table_number', 'guest_name', 'comment'):
            self.assertIn(key, order)
        self.assertEqual(order['number'], 1)
        self.assertEqual(order['status'], 'NEW')
        self.assertEqual(order['status_display'], 'Новый')
        self.assertEqual(order['total'], '11200.00')
        self.assertEqual(order['venue'], {'slug': 'efes-beer-garden', 'name': 'Efes Beer Garden'})
        self.assertEqual(order['table_number'], 7)
        self.assertEqual(order['guest_name'], 'Айдар')
        self.assertEqual(len(order['guest_token']), 48)
        items = order['items']
        self.assertEqual([(i['kind'], i['title'], i['price'], i['qty']) for i in items], [
            ('DISH', 'Бешбармак', '4500.00', 2),
            ('DRINK', 'Velkopopovický Kozel', '2200.00', 1),
        ])
        self.assertEqual(items[0]['menu_item'], str(self.besh.id))
        self.assertEqual(items[1]['menu_drink'], str(self.kozel.id))
        self.assertEqual(items[1]['note'], 'похолоднее')

        # Номер сквозной внутри заведения; в другом заведении своя нумерация.
        second = self.place(items=[{'kind': 'DRINK', 'id': str(self.kozel.id), 'qty': 3}])
        self.assertEqual(second['number'], 2)
        self.assertEqual(second['total'], '6600.00')
        other = client_for().post(self.url, {
            'venue': str(self.other_venue.id), 'table_number': 1,
            'items': [{'kind': 'DISH', 'id': str(self.foreign_item.id), 'qty': 1}],
        }, format='json')
        self.assertEqual(other.status_code, 201, other.content)
        self.assertEqual(other.data['number'], 1)

        # Цена в заказе не меняется, если позицию потом переоценили.
        self.besh.price = '9000'
        self.besh.save()
        stored = Order.objects.get(pk=order['id'])
        self.assertEqual(str(stored.items.first().price), '4500.00')

    def test_negative_price_in_menu_blocks_order(self):
        # Через API такую цену не сохранить, но и записанную мимо API в заказ не считаем.
        MenuItem.objects.filter(pk=self.besh.pk).update(price='-100')
        resp = client_for().post(self.url, self.body(), format='json')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(resp.data['items'], ['У позиции «Бешбармак» неверная цена'])
        self.assertEqual(Order.objects.count(), 0)

    def test_takeaway_table_zero(self):
        order = self.place(table_number=0)
        self.assertEqual(order['table_number'], 0)

    def test_guest_token_get(self):
        order = self.place()
        url = f'{self.url}{order["id"]}/'
        resp = client_for().get(url + '?token=' + order['guest_token'])
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['number'], 1)
        self.assertEqual(len(resp.data['items']), 2)
        self.assertEqual(client_for().get(url + '?token=wrong').status_code, 403)
        self.assertEqual(client_for().get(url).status_code, 403)
        self.assertEqual(client_for().get(f'{self.url}nope/?token=x').status_code, 404)
        # Владелец и модератор видят заказ без токена, чужой владелец - нет.
        self.assertEqual(client_for(self.rest).get(url).status_code, 200)
        self.assertEqual(client_for(self.mod).get(url).status_code, 200)
        self.assertEqual(client_for(self.other).get(url).status_code, 403)

    def test_validation(self):
        anon = client_for()

        def bad(field, **extra):
            resp = anon.post(self.url, self.body(**extra), format='json')
            self.assertEqual(resp.status_code, 400, resp.content)
            self.assertIn(field, resp.data)
            return resp.data[field]

        self.assertEqual(bad('table_number', table_number=11), ['Стол от 1 до 10'])
        bad('table_number', table_number=-1)
        bad('table_number', table_number='седьмой')
        bad('venue', venue='nope')
        bad('items', items=[])
        bad('items', items=[{'kind': 'DISH', 'id': str(self.besh.id), 'qty': 0}])
        bad('items', items=[{'kind': 'DISH', 'id': str(self.besh.id), 'qty': 21}])
        bad('items', items=[{'kind': 'SOUP', 'id': str(self.besh.id), 'qty': 1}])
        errors = bad('items', items=[{'kind': 'DISH', 'id': str(self.manty.id), 'qty': 1}])
        self.assertEqual(errors, ['«Манты» сейчас нет в наличии'])
        # Позиция другого заведения и напиток, переданный как блюдо.
        bad('items', items=[{'kind': 'DISH', 'id': str(self.foreign_item.id), 'qty': 1}])
        bad('items', items=[{'kind': 'DISH', 'id': str(self.kozel.id), 'qty': 1}])
        self.kozel.is_available = False
        self.kozel.save()
        bad('items', items=[{'kind': 'DRINK', 'id': str(self.kozel.id), 'qty': 1}])
        self.kozel.is_available = True
        self.kozel.save()
        # Больше 50 позиций не принимаем.
        bad('items', items=[{'kind': 'DISH', 'id': str(self.besh.id), 'qty': 1}] * 51)
        # Скрытое заведение заказов не принимает.
        self.venue.is_published = False
        self.venue.save()
        bad('venue')
        self.assertEqual(Order.objects.count(), 0)


class OrderOwnerTests(OrderTestsBase):
    def test_owner_list_and_status_filter(self):
        first = self.place()
        second = self.place(table_number=2, items=[{'kind': 'DRINK', 'id': str(self.kozel.id), 'qty': 1}])
        client_for().post(self.url, {
            'venue': str(self.other_venue.id), 'table_number': 1,
            'items': [{'kind': 'DISH', 'id': str(self.foreign_item.id), 'qty': 1}],
        }, format='json')

        self.assertEqual(client_for().get(self.url).status_code, 401)
        self.assertEqual(client_for(make_user('plain')).get(self.url).json(), [])

        client = client_for(self.rest)
        listed = client.get(self.url + '?venue=efes-beer-garden').json()
        self.assertEqual([o['number'] for o in listed], [2, 1])
        self.assertEqual(listed[1]['id'], first['id'])
        self.assertEqual(len(listed[1]['items']), 2)
        # Без ?venue= владелец видит своё заведение.
        self.assertEqual(len(client.get(self.url).json()), 2)
        # Чужое заведение - 403, несуществующее - 400.
        self.assertEqual(client.get(self.url + '?venue=bar-13').status_code, 403)
        self.assertEqual(client.get(self.url + '?venue=nope').status_code, 400)

        client.patch(f'{self.url}{second["id"]}/', {'status': 'ACCEPTED'}, format='json')
        self.assertEqual([o['number'] for o in client.get(self.url + '?status=NEW').json()], [1])
        self.assertEqual([o['number'] for o in client.get(self.url + '?status=accepted,cooking').json()], [2])

    def test_transitions(self):
        order = self.place()
        url = f'{self.url}{order["id"]}/'
        client = client_for(self.rest)

        def move(new_status):
            return client.patch(url, {'status': new_status}, format='json')

        self.assertEqual(move('COOKING').status_code, 400)
        self.assertEqual(move('DONE').status_code, 400)
        self.assertEqual(move('WEIRD').status_code, 400)
        resp = move('ACCEPTED')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['status_display'], 'Принят')
        self.assertEqual(move('NEW').status_code, 400)
        self.assertEqual(move('COOKING').status_code, 200)
        self.assertEqual(move('SERVED').status_code, 200)
        self.assertEqual(move('DONE').status_code, 200)
        self.assertEqual(move('CANCELLED').status_code, 400)

        cancelled = self.place()
        cancel_url = f'{self.url}{cancelled["id"]}/'
        self.assertEqual(client.patch(cancel_url, {'status': 'ACCEPTED'}, format='json').status_code, 200)
        self.assertEqual(client.patch(cancel_url, {'status': 'CANCELLED'}, format='json').status_code, 200)
        self.assertEqual(client.patch(cancel_url, {'status': 'CANCELLED'}, format='json').status_code, 400)
        self.assertEqual(client.patch(cancel_url, {'status': 'COOKING'}, format='json').status_code, 400)
        self.assertEqual(client.put(cancel_url, {'status': 'NEW'}, format='json').status_code, 405)

    def test_patch_permissions(self):
        order = self.place()
        url = f'{self.url}{order["id"]}/'
        self.assertEqual(client_for().patch(url, {'status': 'ACCEPTED'}, format='json').status_code, 401)
        self.assertEqual(client_for(self.other).patch(url, {'status': 'ACCEPTED'}, format='json').status_code, 403)
        self.assertEqual(client_for(make_user('somm', role='sommelier')).patch(url, {'status': 'ACCEPTED'}, format='json').status_code, 403)
        resp = client_for(self.mod).patch(url, {'status': 'ACCEPTED'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_moderator_sees_everything(self):
        self.place()
        client_for().post(self.url, {
            'venue': str(self.other_venue.id), 'table_number': 1,
            'items': [{'kind': 'DISH', 'id': str(self.foreign_item.id), 'qty': 1}],
        }, format='json')
        mod = client_for(self.mod)
        self.assertEqual(len(mod.get(self.url).json()), 2)
        self.assertEqual(len(mod.get(self.url + '?venue=bar-13').json()), 1)

    def test_new_count(self):
        self.place()
        self.place()
        client = client_for(self.rest)
        self.assertEqual(client.get(self.url + 'new-count/?venue=efes-beer-garden').json(), {'count': 2})
        self.assertEqual(client.get(self.url + 'new-count/').json(), {'count': 2})
        self.assertEqual(client.get(self.url + 'new-count/?venue=bar-13').status_code, 403)
        self.assertEqual(client_for().get(self.url + 'new-count/').status_code, 401)
        first = Order.objects.order_by('number').first()
        client.patch(f'{self.url}{first.id}/', {'status': 'ACCEPTED'}, format='json')
        self.assertEqual(client.get(self.url + 'new-count/?venue=efes-beer-garden').json(), {'count': 1})
        self.assertEqual(client_for(self.mod).get(self.url + 'new-count/').json(), {'count': 1})
        self.assertEqual(client_for(self.other).get(self.url + 'new-count/').json(), {'count': 0})

    def test_new_count_without_venue_spans_venues(self):
        self.place()
        self.place()
        for _ in range(3):
            resp = client_for().post(self.url, {
                'venue': 'bar-13', 'table_number': 1,
                'items': [{'kind': 'DISH', 'id': str(self.foreign_item.id), 'qty': 1}],
            }, format='json')
            self.assertEqual(resp.status_code, 201, resp.content)
        # Без ?venue= владелец получает свои заведения, модератор - сумму по всем.
        self.assertEqual(client_for(self.rest).get(self.url + 'new-count/').json(), {'count': 2})
        self.assertEqual(client_for(self.other).get(self.url + 'new-count/').json(), {'count': 3})
        mod = client_for(self.mod)
        self.assertEqual(mod.get(self.url + 'new-count/').json(), {'count': 5})
        self.assertEqual(mod.get(self.url + 'new-count/?venue=bar-13').json(), {'count': 3})
        self.assertEqual(mod.get(self.url + 'new-count/?venue=efes-beer-garden').json(), {'count': 2})
        self.assertEqual(client_for(make_user('somm', role='sommelier')).get(self.url + 'new-count/').json(), {'count': 0})


class OrderPilotTests(OrderTestsBase):
    """Метки пилота в заказе, проверка возраста и выключенные заказы."""

    def test_source_fields_session_and_order_event(self):
        order = self.place(session='3f2c7a9e-1b2d-4c5e-8f90-123456789abc', items=[
            {'kind': 'DISH', 'id': str(self.besh.id), 'qty': 1},
            {'kind': 'DRINK', 'id': str(self.kozel.id), 'qty': 2,
             'source': 'pairing', 'paired_with': str(self.besh.id), 'rank': 1},
        ])
        stored = Order.objects.get(pk=order['id'])
        self.assertEqual(stored.session, '3f2c7a9e-1b2d-4c5e-8f90-123456789abc')
        self.assertTrue(stored.age_confirmed)
        dish, drink = stored.items.order_by('id')
        self.assertEqual((dish.source, dish.paired_menu_item, dish.rec_rank), ('MENU', None, None))
        self.assertEqual((drink.source, drink.paired_menu_item_id, drink.rec_rank), ('PAIRING', self.besh.id, 1))
        self.assertEqual(order['items'][1]['source'], 'PAIRING')
        self.assertEqual(order['items'][1]['source_display'], 'Подбор')
        self.assertEqual(order['items'][1]['paired_menu_item'], str(self.besh.id))
        self.assertTrue(order['age_confirmed'])

        # Сервер сам пишет событие ORDER: стол, сессия, откуда каждая позиция.
        event = PilotEvent.objects.get(kind='ORDER')
        self.assertEqual(event.venue, self.venue)
        self.assertEqual(event.session, stored.session)
        self.assertEqual(event.table_number, 7)
        self.assertEqual(event.source, 'PAIRING')
        self.assertEqual(event.meta['order'], order['id'])
        self.assertEqual(event.meta['number'], 1)
        self.assertEqual(event.meta['total'], '8900.00')
        self.assertEqual(
            [(i['kind'], i['source'], i['qty'], i['paired_with'], i['rank']) for i in event.meta['items']], [
                ('DISH', 'MENU', 1, None, None),
                ('DRINK', 'PAIRING', 2, str(self.besh.id), 1),
            ])

    def test_pilot_labels_never_break_order(self):
        # Кривые метки не мешают заказу: источник по умолчанию MENU, чужое блюдо и странное место не пишем.
        order = self.place(session='<script>', items=[
            {'kind': 'DRINK', 'id': str(self.kozel.id), 'qty': 1,
             'source': 'something', 'paired_with': str(self.foreign_item.id), 'rank': 'first'},
            {'kind': 'DRINK', 'id': str(self.kozel.id), 'qty': 1, 'source': 'ai', 'paired_with': 'nope', 'rank': -3},
            {'kind': 'DRINK', 'id': str(self.kozel.id), 'qty': 1, 'source': None, 'paired_with': None, 'rank': None},
        ])
        rows = list(Order.objects.get(pk=order['id']).items.order_by('id')
                    .values_list('source', 'paired_menu_item', 'rec_rank'))
        self.assertEqual(rows, [('MENU', None, None), ('AI', None, None), ('MENU', None, None)])
        self.assertEqual(Order.objects.get(pk=order['id']).session, '')
        self.assertEqual(PilotEvent.objects.get(kind='ORDER').session, '')

    def test_age_confirmation_required_for_alcohol(self):
        body = self.body()
        del body['age_confirmed']
        resp = client_for().post(self.url, body, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(resp.json(), {'detail': 'Подтвердите, что вам исполнился 21 год'})
        resp = client_for().post(self.url, dict(body, age_confirmed=False), format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(Order.objects.count(), 0)
        self.assertFalse(PilotEvent.objects.exists())

        # Еда и безалкогольное пиво заказываются без подтверждения.
        zero = MenuDrink.objects.create(venue=self.venue, brand=make_brand('Efes 0.0', abv=0.0), price='900')
        resp = client_for().post(self.url, {
            'venue': 'efes-beer-garden', 'table_number': 1,
            'items': [{'kind': 'DISH', 'id': str(self.besh.id), 'qty': 1},
                      {'kind': 'DRINK', 'id': str(zero.id), 'qty': 1}],
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertFalse(resp.data['age_confirmed'])
        # Сорт каталога без крепости считаем пивом с алкоголем.
        unknown = MenuDrink.objects.create(venue=self.venue, brand=make_brand('Разливное', abv=None), price='800')
        resp = client_for().post(self.url, {
            'venue': 'efes-beer-garden', 'table_number': 1,
            'items': [{'kind': 'DRINK', 'id': str(unknown.id), 'qty': 1}],
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_age_check_uses_engine_drinks(self):
        # Напитки из базы движка без сорта каталога: крепость и категория берутся из drinks.json.
        na = MenuDrink.objects.create(venue=self.venue, engine_drink_id='efes-0-0', name='Efes 0.0', price='900')
        beer = MenuDrink.objects.create(venue=self.venue, engine_drink_id='kozel', price='2000')
        kvass = MenuDrink.objects.create(venue=self.venue, engine_drink_id='kvas-ochakovskiy', price='700')

        def order(drink, **extra):
            return client_for().post(self.url, dict({
                'venue': 'efes-beer-garden', 'table_number': 2,
                'items': [{'kind': 'DRINK', 'id': str(drink.id), 'qty': 1}],
            }, **extra), format='json')

        resp = order(na)
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.data['items'][0]['title'], 'Efes 0.0')
        self.assertEqual(order(beer).status_code, 400)
        # Квас 1,2% тоже просит подтверждение: порог 0,5%.
        self.assertEqual(order(kvass).status_code, 400)
        resp = order(beer, age_confirmed=True)
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.data['items'][0]['title'], 'Velkopopovický Kozel')

    def test_venue_not_accepting_orders(self):
        self.venue.accepts_orders = False
        self.venue.save()
        resp = client_for().post(self.url, self.body(), format='json')
        self.assertEqual(resp.status_code, 409, resp.content)
        self.assertEqual(resp.json(), {'detail': 'Заведение сейчас не принимает заказы через приложение'})
        self.assertEqual(Order.objects.count(), 0)
        # Меню при этом открыто и сообщает, что заказ через приложение выключен.
        menu = client_for().get('/api/venues/efes-beer-garden/menu/').json()
        self.assertFalse(menu['venue']['accepts_orders'])

    def test_owner_toggles_accepts_orders(self):
        url = '/api/venues/efes-beer-garden/'
        self.assertTrue(client_for().get(url).json()['accepts_orders'])
        resp = client_for(self.rest).patch(url, {'accepts_orders': False}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertFalse(resp.data['accepts_orders'])
        self.assertEqual(client_for(self.other).patch(url, {'accepts_orders': True}, format='json').status_code, 403)
        self.assertEqual(client_for().patch(url, {'accepts_orders': True}, format='json').status_code, 401)
        self.assertFalse(client_for().get(url).json()['accepts_orders'])

    def test_venue_with_orders_is_not_deleted(self):
        self.place()
        resp = client_for(self.mod).delete('/api/venues/efes-beer-garden/')
        self.assertEqual(resp.status_code, 409, resp.content)
        self.assertIn('Снимите его с публикации', resp.json()['detail'])
        self.assertTrue(Venue.objects.filter(slug='efes-beer-garden').exists())
        self.assertEqual(Order.objects.filter(venue=self.venue).count(), 1)
        self.assertEqual(MenuItem.objects.filter(venue=self.venue).count(), 2)
        # Заведение без заказов удаляется как раньше.
        self.assertEqual(client_for(self.mod).delete('/api/venues/bar-13/').status_code, 204)

from django.test import TestCase

from api.models import MenuDrink, MenuItem, Order
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

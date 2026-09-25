from django.test import TestCase

from api.models import MenuDrink
from .helpers import (
    make_user, client_for, make_brand, make_dish, make_pairing, make_venue, make_menu_item,
)


def make_menu_drink(venue, brand, price='1200.00', **extra):
    fields = {'volume': '0,5 л'}
    fields.update(extra)
    return MenuDrink.objects.create(venue=venue, brand=brand, price=price, **fields)


class MenuDrinkApiTests(TestCase):
    def setUp(self):
        self.rest = make_user('rest', role='restaurant_admin')
        self.other = make_user('other', role='restaurant_admin')
        self.mod = make_user('mod', role='moderator')
        self.venue = make_venue(owner=self.rest)
        self.other_venue = make_venue('Бар 13', owner=self.other)
        self.lager = make_brand('Efes Pilsener', image='brands/efes.png')
        self.kozel = make_brand('Velkopopovický Kozel', style='Dark lager', abv=3.8)
        self.url = '/api/menu-drinks/'

    def test_owner_crud_and_serializer_fields(self):
        client = client_for(self.rest)
        body = {'venue': str(self.venue.id), 'brand': str(self.lager.id), 'price': '1200', 'volume': '0,5 л'}
        resp = client.post(self.url, body, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        drink = resp.data
        for key in ('id', 'venue', 'brand', 'brand_name', 'brand_style', 'brand_image', 'abv',
                    'price', 'volume', 'is_available', 'sort_order'):
            self.assertIn(key, drink)
        self.assertEqual(drink['brand_name'], 'Efes Pilsener')
        self.assertEqual(drink['brand_style'], 'Lager')
        self.assertEqual(drink['abv'], 5.0)
        self.assertEqual(drink['price'], '1200.00')
        self.assertEqual(drink['brand_image'], 'http://testserver/media/brands/efes.png')
        self.assertTrue(drink['is_available'])

        # Второй раз тот же сорт в ту же карту не добавить.
        self.assertEqual(client.post(self.url, body, format='json').status_code, 400)

        resp = client.patch(f'{self.url}{drink["id"]}/', {'price': '1350', 'is_available': False}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['price'], '1350.00')
        self.assertFalse(resp.data['is_available'])

        self.assertEqual(client.delete(f'{self.url}{drink["id"]}/').status_code, 204)
        self.assertEqual(MenuDrink.objects.count(), 0)

    def test_negative_price_rejected(self):
        client = client_for(self.rest)
        body = {'venue': str(self.venue.id), 'brand': str(self.lager.id), 'price': '-500'}
        resp = client.post(self.url, body, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn('price', resp.data)
        self.assertEqual(MenuDrink.objects.count(), 0)
        drink = make_menu_drink(self.venue, self.lager, price='1200')
        resp = client.patch(f'{self.url}{drink.id}/', {'price': '-1'}, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn('price', resp.data)
        self.assertEqual(str(MenuDrink.objects.get(pk=drink.pk).price), '1200.00')
        # Ноль допустим: комплимент от заведения.
        self.assertEqual(client.patch(f'{self.url}{drink.id}/', {'price': '0'}, format='json').status_code, 200)

    def test_list_public_filter_and_order(self):
        make_menu_drink(self.venue, self.kozel, sort_order=1)
        make_menu_drink(self.venue, self.lager, sort_order=0)
        make_menu_drink(self.other_venue, self.lager, price='900')
        by_slug = client_for().get(self.url + '?venue=efes-beer-garden').json()
        self.assertEqual([d['brand_name'] for d in by_slug], ['Efes Pilsener', 'Velkopopovický Kozel'])
        by_id = client_for().get(self.url + '?venue=' + str(self.other_venue.id)).json()
        self.assertEqual(len(by_id), 1)
        self.assertEqual(by_id[0]['price'], '900.00')
        self.assertEqual(len(client_for().get(self.url).json()), 3)

    def test_hidden_venue_rule(self):
        make_menu_drink(self.venue, self.lager)
        self.venue.is_published = False
        self.venue.save()
        self.assertEqual(client_for().get(self.url + '?venue=efes-beer-garden').json(), [])
        self.assertEqual(client_for(self.other).get(self.url + '?venue=efes-beer-garden').json(), [])
        self.assertEqual(len(client_for(self.rest).get(self.url + '?venue=efes-beer-garden').json()), 1)
        self.assertEqual(len(client_for(self.mod).get(self.url + '?venue=efes-beer-garden').json()), 1)

    def test_writes_owner_or_moderator_only(self):
        body = {'venue': str(self.venue.id), 'brand': str(self.lager.id), 'price': '1200'}
        self.assertEqual(client_for().post(self.url, body, format='json').status_code, 401)
        self.assertEqual(client_for(make_user('somm', role='sommelier')).post(self.url, body, format='json').status_code, 403)
        self.assertEqual(client_for(self.other).post(self.url, body, format='json').status_code, 403)
        foreign = make_menu_drink(self.venue, self.kozel)
        self.assertEqual(client_for(self.other).patch(f'{self.url}{foreign.id}/', {'price': '1'}, format='json').status_code, 403)
        self.assertEqual(client_for(self.other).delete(f'{self.url}{foreign.id}/').status_code, 403)
        # Перенести напиток в чужое заведение тоже нельзя.
        self.assertEqual(client_for(self.rest).patch(
            f'{self.url}{foreign.id}/', {'venue': str(self.other_venue.id)}, format='json').status_code, 403)
        resp = client_for(self.mod).post(self.url, body, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)


class VenueMenuDrinksTests(TestCase):
    """Карта напитков и сочетания в публичном меню."""

    def setUp(self):
        self.rest = make_user('rest', role='restaurant_admin')
        self.venue = make_venue(owner=self.rest, tables_count=12)
        self.besh = make_dish('Бешбармак')
        self.manty = make_dish('Манты', cooking_method='STEAMED')
        self.lager = make_brand('Efes Pilsener')
        self.kozel = make_brand('Velkopopovický Kozel', style='Dark lager')
        self.stout = make_brand('Stout', style='Stout')
        self.ipa = make_brand('IPA', style='IPA')
        self.wheat = make_brand('Wheat', style='Wheat')
        # Бешбармак: лучший Kozel (в карте), потом Stout (нет в карте), IPA (в карте, нет в наличии),
        # Wheat (в карте), Efes (в карте).
        make_pairing(self.kozel, self.besh, score=5)
        make_pairing(self.stout, self.besh, score=4)
        make_pairing(self.ipa, self.besh, score=4)
        make_pairing(self.wheat, self.besh, score=3)
        make_pairing(self.lager, self.besh, score=2)
        # Манты: лучший Stout (нет в карте), альтернатива Efes.
        make_pairing(self.stout, self.manty, score=4)
        make_pairing(self.lager, self.manty, score=3)
        make_menu_item(self.venue, self.besh, price='4500', section='Горячее', sort_order=0)
        make_menu_item(self.venue, self.manty, price='2600', section='Горячее', sort_order=1)
        self.kozel_drink = make_menu_drink(self.venue, self.kozel, price='2200', sort_order=1)
        self.lager_drink = make_menu_drink(self.venue, self.lager, price='1200', sort_order=0)
        self.ipa_drink = make_menu_drink(self.venue, self.ipa, price='1800', sort_order=2, is_available=False)
        self.wheat_drink = make_menu_drink(self.venue, self.wheat, price='1600', sort_order=3)

    def test_menu_has_drinks_tables_and_menu_drink_in_pairing(self):
        data = client_for().get('/api/venues/efes-beer-garden/menu/').json()
        self.assertEqual(data['tables_count'], 12)
        self.assertEqual(data['venue']['tables_count'], 12)
        # Все напитки карты, в том числе не в наличии, по sort_order.
        self.assertEqual([d['brand_name'] for d in data['drinks']],
                         ['Efes Pilsener', 'Velkopopovický Kozel', 'IPA', 'Wheat'])
        self.assertEqual(data['drinks'][2]['is_available'], False)
        self.assertEqual(data['drinks'][1]['price'], '2200.00')
        self.assertEqual(data['drinks'][1]['volume'], '0,5 л')

        besh = data['sections'][0]['items'][0]
        self.assertEqual(besh['pairing']['brand_name'], 'Velkopopovický Kozel')
        self.assertEqual(besh['pairing']['menu_drink'], {
            'id': str(self.kozel_drink.id), 'price': '2200.00', 'volume': '0,5 л', 'is_available': True,
        })
        # Альтернативы только из карты бара, не больше двух, сначала те, что в наличии:
        # Wheat (3) и Efes (2); IPA (4) не в наличии, Stout не в карте.
        self.assertEqual([a['brand_name'] for a in besh['alternatives']], ['Wheat', 'Efes Pilsener'])
        self.assertEqual(besh['alternatives'][0]['menu_drink']['price'], '1600.00')
        self.assertEqual(besh['alternatives'][1]['menu_drink']['id'], str(self.lager_drink.id))
        self.assertEqual(besh['alternatives'][0]['compatibility_score'], 3)

        manty = data['sections'][0]['items'][1]
        self.assertEqual(manty['pairing']['brand_name'], 'Stout')
        self.assertIsNone(manty['pairing']['menu_drink'])
        self.assertEqual([a['brand_name'] for a in manty['alternatives']], ['Efes Pilsener'])
        self.assertEqual(manty['alternatives'][0]['menu_drink']['id'], str(self.lager_drink.id))

        # Когда сортов в наличии не хватает, добираем теми, что временно закончились.
        self.lager_drink.delete()
        data = client_for().get('/api/venues/efes-beer-garden/menu/').json()
        besh = data['sections'][0]['items'][0]
        self.assertEqual([a['brand_name'] for a in besh['alternatives']], ['Wheat', 'IPA'])
        self.assertFalse(besh['alternatives'][1]['menu_drink']['is_available'])
        self.assertEqual(data['sections'][0]['items'][1]['alternatives'], [])

    def test_menu_without_drinks(self):
        MenuDrink.objects.all().delete()
        data = client_for().get('/api/venues/efes-beer-garden/menu/').json()
        self.assertEqual(data['drinks'], [])
        besh = data['sections'][0]['items'][0]
        self.assertIsNone(besh['pairing']['menu_drink'])
        self.assertEqual(besh['alternatives'], [])

    def test_tables_count_editable_by_owner(self):
        client = client_for(self.rest)
        resp = client.patch('/api/venues/efes-beer-garden/', {'tables_count': 30}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['tables_count'], 30)
        self.assertEqual(client.patch('/api/venues/efes-beer-garden/', {'tables_count': 0}, format='json').status_code, 400)
        self.assertEqual(client_for().get('/api/venues/').json()[0]['tables_count'], 30)

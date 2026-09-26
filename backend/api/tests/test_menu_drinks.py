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
        self.assertEqual(besh['pairing']['source'], 'TEAM')
        self.assertEqual(besh['pairing']['menu_drink'], {
            'id': str(self.kozel_drink.id), 'price': '2200.00', 'volume': '0,5 л', 'is_available': True,
        })
        # Дальше только то, что есть в карте и в наличии: Efes по баллу движка, затем пара команды Wheat (3).
        # IPA (4) закончился, Stout в карте нет.
        self.assertEqual([a['brand_name'] for a in besh['alternatives']], ['Efes Pilsener', 'Wheat'])
        self.assertEqual([a['source'] for a in besh['alternatives']], ['ENGINE', 'TEAM'])
        self.assertEqual(besh['alternatives'][0]['menu_drink']['id'], str(self.lager_drink.id))
        self.assertEqual(besh['alternatives'][0]['team_rating'], 2)
        self.assertEqual(besh['alternatives'][1]['menu_drink']['price'], '1600.00')
        self.assertEqual(besh['alternatives'][1]['compatibility_score'], 3)
        self.assertEqual(besh['recommendations'], [besh['pairing']] + besh['alternatives'])

        # Лучшая пара команды к мантам (Stout) в баре не продаётся: её нет, советуем то, что можно заказать.
        manty = data['sections'][0]['items'][1]
        names = [r['brand_name'] for r in manty['recommendations']]
        self.assertNotIn('Stout', names)
        self.assertEqual(sorted(names), ['Efes Pilsener', 'Velkopopovický Kozel'])
        self.assertTrue(all(r['menu_drink'] for r in manty['recommendations']))
        self.assertEqual(manty['pairing'], manty['recommendations'][0])

        # Закончившиеся сорта не советуем, даже если больше нечего.
        self.lager_drink.delete()
        data = client_for().get('/api/venues/efes-beer-garden/menu/').json()
        besh = data['sections'][0]['items'][0]
        self.assertEqual([a['brand_name'] for a in besh['alternatives']], ['Wheat'])
        manty = data['sections'][0]['items'][1]
        self.assertEqual([r['brand_name'] for r in manty['recommendations']], ['Velkopopovický Kozel'])
        self.assertEqual(manty['alternatives'], [])

    def test_menu_without_drinks(self):
        MenuDrink.objects.all().delete()
        data = client_for().get('/api/venues/efes-beer-garden/menu/').json()
        self.assertEqual(data['drinks'], [])
        besh = data['sections'][0]['items'][0]
        # Карты напитков нет: пара команды остаётся советом без позиции для заказа.
        self.assertEqual(besh['pairing']['brand_name'], 'Velkopopovický Kozel')
        self.assertIsNone(besh['pairing']['menu_drink'])
        self.assertEqual(besh['pairing_info']['status'], 'no_drinks')
        self.assertEqual(besh['alternatives'], [])
        self.assertEqual(besh['recommendations'], [])

    def test_tables_count_editable_by_owner(self):
        client = client_for(self.rest)
        resp = client.patch('/api/venues/efes-beer-garden/', {'tables_count': 30}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['tables_count'], 30)
        self.assertEqual(client.patch('/api/venues/efes-beer-garden/', {'tables_count': 0}, format='json').status_code, 400)
        self.assertEqual(client_for().get('/api/venues/').json()[0]['tables_count'], 30)


class EngineMenuDrinkTests(TestCase):
    """В карту бара можно поставить любой напиток базы подбора v2, не только сорт каталога."""

    def setUp(self):
        self.rest = make_user('rest', role='restaurant_admin')
        self.venue = make_venue(owner=self.rest)
        self.lager = make_brand('Efes Pilsener')
        self.url = '/api/menu-drinks/'
        self.client_rest = client_for(self.rest)

    def post(self, **body):
        body = dict({'venue': str(self.venue.id), 'price': '900'}, **body)
        return self.client_rest.post(self.url, body, format='json')

    def test_engine_drink_create_and_fields(self):
        resp = self.post(engine_drink_id='efes-0-0', volume='0,45 л')
        self.assertEqual(resp.status_code, 201, resp.content)
        drink = resp.data
        self.assertIsNone(drink['brand'])
        self.assertEqual(drink['engine_drink_id'], 'efes-0-0')
        self.assertEqual(drink['name'], 'Efes 0.0 (классическое)')
        self.assertEqual(drink['brand_name'], 'Efes 0.0 (классическое)')
        self.assertEqual(drink['category'], 'na_beer')
        self.assertEqual(drink['abv'], 0.0)
        self.assertFalse(drink['is_alcoholic'])

        # Картинка напитка движка лежит на сайте фронтенда.
        kozel = self.post(engine_drink_id='kozel', name='Kozel разливной').data
        self.assertEqual(kozel['brand_name'], 'Kozel разливной')
        self.assertEqual(kozel['brand_image'], '/img/beers/kozel.webp')
        self.assertEqual(kozel['abv'], 4.0)
        self.assertTrue(kozel['is_alcoholic'])
        self.assertTrue(kozel['brand_style'])

        # Сорт каталога работает как раньше и тоже знает, что он алкогольный.
        brand_drink = self.post(brand=str(self.lager.id)).data
        self.assertEqual(brand_drink['brand_name'], 'Efes Pilsener')
        self.assertEqual(brand_drink['category'], 'beer')
        self.assertTrue(brand_drink['is_alcoholic'])
        self.assertEqual(brand_drink['engine_drink_id'], '')

        # В публичном меню напитки движка стоят рядом с сортами каталога.
        menu = client_for().get('/api/venues/efes-beer-garden/menu/').json()
        self.assertEqual(sorted(d['brand_name'] for d in menu['drinks']),
                         ['Efes 0.0 (классическое)', 'Efes Pilsener', 'Kozel разливной'])

    def test_engine_drink_validation(self):
        resp = self.post()
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['brand'], ['Выберите сорт из каталога или напиток из базы подбора'])
        resp = self.post(engine_drink_id='no-such-drink')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('engine_drink_id', resp.data)
        self.assertEqual(self.post(engine_drink_id='efes-0-0').status_code, 201)
        resp = self.post(engine_drink_id='efes-0-0')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['engine_drink_id'], ['Этот напиток уже есть в карте заведения'])
        self.assertEqual(self.post(brand=str(self.lager.id)).status_code, 201)
        resp = self.post(brand=str(self.lager.id))
        self.assertEqual(resp.data['brand'], ['Этот сорт уже есть в карте заведения'])
        self.assertEqual(MenuDrink.objects.count(), 2)

    def test_engine_drink_update_refreshes_name(self):
        drink = self.post(engine_drink_id='efes-0-0').data
        url = f'{self.url}{drink["id"]}/'
        resp = self.client_rest.patch(url, {'price': '950'}, format='json')
        self.assertEqual(resp.data['name'], 'Efes 0.0 (классическое)')
        resp = self.client_rest.patch(url, {'engine_drink_id': 'kruzhka-svezhego-0-0'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['name'], 'Кружка Свежего 0.0')
        # Без сорта и без напитка движка позиция не остаётся.
        self.assertEqual(self.client_rest.patch(url, {'engine_drink_id': ''}, format='json').status_code, 400)

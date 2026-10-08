from django.test import TestCase

from api.models import SiteSettings, Venue, Dish
from .helpers import make_user, client_for, make_brand, make_dish, make_pairing, make_venue, make_menu_item

BRAND_BODY = {'name': 'Новый сорт', 'style': 'Lager', 'abv': 4.5}
DISH_BODY = {'name': 'Плов', 'cuisine': 'KZ', 'dominant_taste': 'UMAMI', 'weight': 'HEAVY',
             'fat_level': 'HIGH', 'cooking_method': 'BOILED'}


class RolePermissionTests(TestCase):
    def setUp(self):
        self.brand = make_brand()
        self.dish = make_dish()
        self.user = make_user('plain')
        self.somm = make_user('somm', role='sommelier')
        self.rest = make_user('rest', role='restaurant_admin')
        self.mod = make_user('mod', role='moderator')

    def pairing_body(self):
        return {'brand': str(self.brand.id), 'dish': str(self.dish.id),
                'compatibility_score': 5, 'pairing_type': 'CLEANSE', 'explanation': 'Освежает'}

    def test_anonymous_cannot_write(self):
        client = client_for()
        self.assertEqual(client.post('/api/brands/', BRAND_BODY, format='json').status_code, 401)
        self.assertEqual(client.post('/api/dishes/', DISH_BODY, format='json').status_code, 401)
        self.assertEqual(client.post('/api/pairings/', self.pairing_body(), format='json').status_code, 401)
        self.assertEqual(client.post('/api/admin/brands/', BRAND_BODY, format='json').status_code, 401)
        self.assertEqual(client.post('/api/admin/flavor-notes/', {}, format='json').status_code, 401)
        self.assertEqual(client.patch('/api/settings/', {'alternatives_count': 2}, format='json').status_code, 401)
        self.assertEqual(client.post('/api/seed/').status_code, 401)

    def test_reads_stay_public(self):
        client = client_for()
        self.assertEqual(client.get('/api/brands/').status_code, 200)
        self.assertEqual(client.get('/api/dishes/').status_code, 200)
        self.assertEqual(client.get('/api/pairings/').status_code, 200)
        self.assertEqual(client.get('/api/settings/').status_code, 200)
        self.assertEqual(client.get('/api/admin/brands/').status_code, 200)
        self.assertEqual(client.get('/api/venues/').status_code, 200)
        self.assertEqual(client.get('/api/menu-items/').status_code, 200)

    def test_plain_user_cannot_write(self):
        client = client_for(self.user)
        self.assertEqual(client.post('/api/brands/', BRAND_BODY, format='json').status_code, 403)
        self.assertEqual(client.post('/api/dishes/', DISH_BODY, format='json').status_code, 403)
        self.assertEqual(client.post('/api/pairings/', self.pairing_body(), format='json').status_code, 403)
        self.assertEqual(client.patch('/api/settings/', {'alternatives_count': 2}, format='json').status_code, 403)
        self.assertEqual(client.post('/api/venues/', {'name': 'X', 'address': 'Y', 'venue_type': 'BAR'}, format='json').status_code, 403)

    def test_sommelier_pairing_yes_brand_no(self):
        client = client_for(self.somm)
        resp = client.post('/api/pairings/', self.pairing_body(), format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        pairing_id = resp.data['id']
        self.assertEqual(client.patch(f'/api/pairings/{pairing_id}/', {'compatibility_score': 3}, format='json').status_code, 200)
        self.assertEqual(client.post('/api/brands/', BRAND_BODY, format='json').status_code, 403)
        self.assertEqual(client.post('/api/dishes/', DISH_BODY, format='json').status_code, 403)
        self.assertEqual(client.delete(f'/api/pairings/{pairing_id}/').status_code, 204)

    def test_restaurant_admin_dish_yes_pairing_no(self):
        client = client_for(self.rest)
        self.assertEqual(client.post('/api/dishes/', DISH_BODY, format='json').status_code, 201)
        self.assertEqual(client.post('/api/pairings/', self.pairing_body(), format='json').status_code, 403)
        self.assertEqual(client.post('/api/brands/', BRAND_BODY, format='json').status_code, 403)

    def test_moderator_writes_everything(self):
        client = client_for(self.mod)
        self.assertEqual(client.post('/api/brands/', BRAND_BODY, format='json').status_code, 201)
        self.assertEqual(client.post('/api/dishes/', DISH_BODY, format='json').status_code, 201)
        self.assertEqual(client.post('/api/pairings/', self.pairing_body(), format='json').status_code, 201)
        resp = client.patch('/api/settings/', {'alternatives_count': 5, 'pairing_intro': 'Текст'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(SiteSettings.load().alternatives_count, 5)
        self.assertEqual(resp.data['pairing_intro'], 'Текст')

    def test_seed_is_post_only(self):
        self.assertEqual(client_for(self.mod).get('/api/seed/').status_code, 405)

    def test_dish_delete_moderator_only(self):
        dish_id = str(self.dish.id)
        self.assertEqual(client_for(self.rest).delete(f'/api/dishes/{dish_id}/').status_code, 403)
        self.assertTrue(Dish.objects.filter(pk=dish_id).exists())
        self.assertEqual(client_for(self.mod).delete(f'/api/dishes/{dish_id}/').status_code, 204)

    def test_dish_update_refused_when_in_another_venue_menu(self):
        own_venue = make_venue('Своё', owner=self.rest)
        other_venue = make_venue('Чужое', owner=make_user('other', role='restaurant_admin'))
        client = client_for(self.rest)
        # Пока блюдо только в своём меню, править можно.
        make_menu_item(own_venue, self.dish)
        self.assertEqual(client.patch(f'/api/dishes/{self.dish.id}/', {'category': 'Мясо'}, format='json').status_code, 200)
        # Как только блюдо появилось в чужом меню, менять его может только модератор.
        make_menu_item(other_venue, self.dish)
        resp = client.patch(f'/api/dishes/{self.dish.id}/', {'category': 'Другое'}, format='json')
        self.assertEqual(resp.status_code, 403)
        self.assertIn('другого заведения', resp.data['detail'])
        self.assertEqual(Dish.objects.get(pk=self.dish.pk).category, 'Мясо')
        self.assertEqual(client_for(self.mod).patch(f'/api/dishes/{self.dish.id}/', {'category': 'Другое'}, format='json').status_code, 200)

    def test_dish_counts(self):
        venue = make_venue(owner=self.rest)
        make_menu_item(venue, self.dish)
        make_pairing(self.brand, self.dish)
        make_pairing(make_brand('Stout'), self.dish)
        listed = client_for().get('/api/dishes/').json()['results'][0]
        self.assertEqual(listed['menu_items_count'], 1)
        self.assertEqual(listed['pairings_count'], 2)
        single = client_for().get(f'/api/dishes/{self.dish.id}/').json()
        self.assertEqual((single['menu_items_count'], single['pairings_count']), (1, 2))
        self.assertEqual(single['image'], '')
        self.assertEqual(single['image_url'], '')


class VenueOwnershipTests(TestCase):
    def setUp(self):
        self.dish = make_dish()
        self.other_dish = make_dish('Манты')
        self.rest = make_user('rest', role='restaurant_admin')
        self.other = make_user('other', role='restaurant_admin')
        self.mod = make_user('mod', role='moderator')
        self.venue = make_venue(owner=self.rest)
        self.other_venue = make_venue('Бар 13', owner=self.other)

    def test_menu_item_only_for_own_venue(self):
        client = client_for(self.rest)
        body = {'venue': str(self.venue.id), 'dish': str(self.dish.id), 'price': '2400', 'section': 'Горячее'}
        resp = client.post('/api/menu-items/', body, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.data['dish_name'], 'Бешбармак')
        self.assertEqual(resp.data['price'], '2400.00')

        body['venue'] = str(self.other_venue.id)
        self.assertEqual(client.post('/api/menu-items/', body, format='json').status_code, 403)

        foreign = make_menu_item(self.other_venue, self.other_dish)
        self.assertEqual(client.patch(f'/api/menu-items/{foreign.id}/', {'price': '1'}, format='json').status_code, 403)
        self.assertEqual(client.delete(f'/api/menu-items/{foreign.id}/').status_code, 403)
        # Перенести свою позицию в чужое заведение тоже нельзя.
        own_id = resp.data['id']
        self.assertEqual(client.patch(f'/api/menu-items/{own_id}/', {'venue': str(self.other_venue.id)}, format='json').status_code, 403)
        self.assertEqual(client.patch(f'/api/menu-items/{own_id}/', {'price': '2500'}, format='json').status_code, 200)

    def test_menu_item_negative_price_rejected(self):
        client = client_for(self.rest)
        body = {'venue': str(self.venue.id), 'dish': str(self.dish.id), 'price': '-2400', 'section': 'Горячее'}
        resp = client.post('/api/menu-items/', body, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn('price', resp.data)
        item = make_menu_item(self.venue, self.dish)
        resp = client.patch(f'/api/menu-items/{item.id}/', {'price': '-1'}, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn('price', resp.data)
        self.assertEqual(client.patch(f'/api/menu-items/{item.id}/', {'price': '0'}, format='json').status_code, 200)

    def test_duplicate_dish_in_venue_rejected(self):
        make_menu_item(self.venue, self.dish)
        resp = client_for(self.rest).post('/api/menu-items/', {
            'venue': str(self.venue.id), 'dish': str(self.dish.id), 'price': '1000',
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_venue_patch_owner_or_moderator(self):
        self.assertEqual(client_for(self.rest).patch('/api/venues/efes-beer-garden/', {'city': 'Астана'}, format='json').status_code, 200)
        self.assertEqual(client_for(self.other).patch('/api/venues/efes-beer-garden/', {'city': 'Астана'}, format='json').status_code, 403)
        self.assertEqual(client_for().patch('/api/venues/efes-beer-garden/', {'city': 'Астана'}, format='json').status_code, 401)
        self.assertEqual(client_for(self.mod).patch('/api/venues/efes-beer-garden/', {'city': 'Шымкент'}, format='json').status_code, 200)
        self.assertEqual(Venue.objects.get(slug='efes-beer-garden').city, 'Шымкент')

    def test_owner_cannot_reassign_owner(self):
        resp = client_for(self.rest).patch('/api/venues/efes-beer-garden/', {'owner': self.other.id}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(Venue.objects.get(slug='efes-beer-garden').owner, self.rest)
        # Модератор может передать заведение пользователю, у которого ещё нет своего.
        free = make_user('free', role='restaurant_admin')
        resp = client_for(self.mod).patch('/api/venues/efes-beer-garden/', {'owner': free.id}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['owner'], {'id': free.id, 'username': 'free'})

    def test_venue_delete_moderator_only(self):
        self.assertEqual(client_for(self.rest).delete('/api/venues/efes-beer-garden/').status_code, 403)
        self.assertEqual(client_for(self.mod).delete('/api/venues/efes-beer-garden/').status_code, 204)

    def test_restaurant_admin_creates_one_venue(self):
        newcomer = make_user('newcomer', role='restaurant_admin')
        client = client_for(newcomer)
        body = {'name': 'Паб у моста', 'address': 'ул. Абая 1', 'venue_type': 'PUB'}
        resp = client.post('/api/venues/', body, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.data['slug'], 'pab-u-mosta')
        self.assertEqual(resp.data['owner']['username'], 'newcomer')
        resp = client.post('/api/venues/', dict(body, name='Второй'), format='json')
        self.assertEqual(resp.status_code, 400)

    def test_moderator_creates_venue_for_user(self):
        # У rest уже есть заведение: второе назначить нельзя.
        resp = client_for(self.mod).post('/api/venues/', {
            'name': 'Кафе', 'address': 'ул. Толе би 5', 'venue_type': 'CAFE', 'owner': self.rest.id,
        }, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn('owner', resp.data)
        self.assertEqual(Venue.objects.filter(owner=self.rest).count(), 1)
        # Пользователю без заведения - можно.
        free = make_user('free', role='restaurant_admin')
        resp = client_for(self.mod).post('/api/venues/', {
            'name': 'Кафе', 'address': 'ул. Толе би 5', 'venue_type': 'CAFE', 'owner': free.id,
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.data['owner']['id'], free.id)
        # И через PATCH второе заведение тому же владельцу не отдать.
        resp = client_for(self.mod).patch('/api/venues/efes-beer-garden/', {'owner': free.id}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(Venue.objects.get(slug='efes-beer-garden').owner, self.rest)

    def test_menu_items_of_hidden_venue_visible_only_to_owner_and_moderator(self):
        make_menu_item(self.venue, self.dish)
        make_menu_item(self.other_venue, self.other_dish)
        self.venue.is_published = False
        self.venue.save()
        self.assertEqual(client_for().get('/api/menu-items/?venue=efes-beer-garden').json(), [])
        self.assertEqual([i['dish_name'] for i in client_for().get('/api/menu-items/').json()], ['Манты'])
        self.assertEqual(len(client_for(self.other).get('/api/menu-items/?venue=efes-beer-garden').json()), 0)
        self.assertEqual(len(client_for(self.rest).get('/api/menu-items/?venue=efes-beer-garden').json()), 1)
        self.assertEqual(len(client_for(self.mod).get('/api/menu-items/').json()), 2)

    def test_mine(self):
        resp = client_for(self.rest).get('/api/venues/mine/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual([v['slug'] for v in resp.data], ['efes-beer-garden'])
        self.assertEqual(len(client_for(self.mod).get('/api/venues/mine/').data), 2)
        self.assertEqual(client_for().get('/api/venues/mine/').status_code, 401)

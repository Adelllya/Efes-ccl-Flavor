from django.test import TestCase

from .helpers import (
    make_user, client_for, make_brand, make_dish, make_pairing, make_venue, make_menu_item,
)


class VenueMenuTests(TestCase):
    def setUp(self):
        self.owner = make_user('rest', role='restaurant_admin')
        self.venue = make_venue(owner=self.owner, phone='+7 727 000 00 00', working_hours='12:00-02:00')
        self.besh = make_dish('Бешбармак')
        self.manty = make_dish('Манты', cooking_method='STEAMED')
        self.samsa = make_dish('Самса', cooking_method='BAKED')
        self.lager = make_brand('Efes Pilsener', image='brands/efes.png')
        self.stout = make_brand('Stout', style='Stout')
        self.hidden = make_brand('Hidden', is_active=False)
        make_pairing(self.lager, self.besh, score=4, pairing_type='CLEANSE')
        make_pairing(self.stout, self.besh, score=3)
        make_pairing(self.hidden, self.besh, score=5)
        make_pairing(self.stout, self.manty, score=2, pairing_type='BRIDGE')
        make_menu_item(self.venue, self.besh, price='4500', section='Горячее', sort_order=0)
        make_menu_item(self.venue, self.manty, price='2600', section='Горячее', sort_order=1, is_available=False)
        make_menu_item(self.venue, self.samsa, price='1500', section='Закуски', sort_order=0, portion='2 шт')

    def test_menu_shape_and_best_pairing(self):
        resp = client_for().get('/api/venues/efes-beer-garden/menu/')
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertEqual(data['venue']['slug'], 'efes-beer-garden')
        self.assertEqual(data['venue']['items_count'], 3)
        self.assertEqual(data['venue']['phone'], '+7 727 000 00 00')
        # Логин владельца гостю не показываем.
        self.assertNotIn('owner', data['venue'])
        # Разделы упорядочены по минимальному sort_order, затем по имени.
        self.assertEqual([s['name'] for s in data['sections']], ['Горячее', 'Закуски'])

        hot = data['sections'][0]['items']
        self.assertEqual([i['dish']['name'] for i in hot], ['Бешбармак', 'Манты'])
        besh = hot[0]
        self.assertEqual(besh['price'], '4500.00')
        self.assertEqual(besh['section'], 'Горячее')
        self.assertTrue(besh['is_available'])
        self.assertEqual(besh['dish']['cooking_method_display'], 'Варка')
        for key in ('id', 'price', 'section', 'portion', 'sort_order', 'is_available', 'chef_note', 'dish', 'pairing'):
            self.assertIn(key, besh)

        pairing = besh['pairing']
        # Неактивный бренд с оценкой 5 не учитывается, побеждает лагер с 4.
        self.assertEqual(pairing['brand'], str(self.lager.id))
        self.assertEqual(pairing['brand_name'], 'Efes Pilsener')
        self.assertEqual(pairing['brand_style'], 'Lager')
        self.assertEqual(pairing['abv'], 5.0)
        self.assertEqual(pairing['compatibility_score'], 4)
        self.assertEqual(pairing['pairing_type'], 'CLEANSE')
        self.assertEqual(pairing['pairing_type_display'], 'Очищает (Cleanse)')
        self.assertEqual(pairing['explanation'], 'Подходит')
        self.assertEqual(pairing['brand_image'], 'http://testserver/media/brands/efes.png')

        manty = hot[1]
        self.assertFalse(manty['is_available'])
        self.assertEqual(manty['pairing']['brand_name'], 'Stout')
        self.assertIsNone(manty['pairing']['brand_image'])

        samsa = data['sections'][1]['items'][0]
        self.assertEqual(samsa['portion'], '2 шт')
        self.assertIsNone(samsa['pairing'])

    def test_unpublished_venue_hidden_from_public(self):
        self.venue.is_published = False
        self.venue.save()
        self.assertEqual(client_for().get('/api/venues/efes-beer-garden/menu/').status_code, 404)
        self.assertEqual(client_for().get('/api/venues/').json(), [])
        self.assertEqual(client_for(self.owner).get('/api/venues/efes-beer-garden/menu/').status_code, 200)
        mod = make_user('mod', role='moderator')
        self.assertEqual(len(client_for(mod).get('/api/venues/').json()), 1)

    def test_venue_list_fields(self):
        data = client_for().get('/api/venues/').json()
        self.assertIsInstance(data, list)
        venue = data[0]
        for key in ('id', 'slug', 'name', 'city', 'address', 'venue_type', 'venue_type_display', 'logo',
                    'cover', 'description', 'phone', 'working_hours', 'is_published', 'items_count'):
            self.assertIn(key, venue)
        # Логин владельца видят только он сам и модератор.
        self.assertNotIn('owner', venue)
        self.assertEqual(venue['venue_type_display'], 'Ресторан')
        self.assertEqual(venue['city'], 'Алматы')

    def test_menu_items_filter_by_slug_or_uuid(self):
        other = make_venue('Бар 13')
        make_menu_item(other, self.besh, price='100')
        by_slug = client_for().get('/api/menu-items/?venue=efes-beer-garden').json()
        self.assertEqual(len(by_slug), 3)
        by_id = client_for().get('/api/menu-items/?venue=' + str(other.id)).json()
        self.assertEqual(len(by_id), 1)
        self.assertEqual(by_id[0]['dish_name'], 'Бешбармак')
        self.assertEqual(len(client_for().get('/api/menu-items/').json()), 4)

    def test_unknown_slug_404(self):
        self.assertEqual(client_for().get('/api/venues/nope/menu/').status_code, 404)

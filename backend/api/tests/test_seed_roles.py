import io

from django.contrib.auth.models import User
from django.core.management import call_command
from django.test import TestCase

from api.models import ChangeRequest, FlavorNote, FlavorProfile, MenuDrink, ServingRecommendation
from .helpers import client_for, make_brand, make_dish


class SeedRolesTests(TestCase):
    def test_seed_roles_menu_order_and_demo_requests(self):
        for name in ('Самса', 'Бешбармак', 'Шашлык', 'Чизкейк'):
            make_dish(name)
        brand = make_brand('Бочковое')
        make_brand('Velkopopovický Kozel', style='Dark lager')
        note = FlavorNote.objects.create(name='Солод', category='HEART', description='', icon='m')
        FlavorProfile.objects.create(brand=brand, flavor_note=note, layer='HEART', intensity=6)
        ServingRecommendation.objects.create(brand=brand, serving_temp_min=5, serving_temp_max=7, glass_type='Кружка')

        out = io.StringIO()
        call_command('seed_roles', stdout=out)
        call_command('seed_roles', stdout=out)  # повторный запуск ничего не дублирует

        self.assertEqual(User.objects.filter(username__in=['moderator', 'sommelier', 'restaurant', 'guest']).count(), 4)
        menu = client_for().get('/api/venues/efes-beer-garden/menu/').json()
        # Горячее первым.
        self.assertEqual([s['name'] for s in menu['sections']], ['Горячее', 'Гриль', 'Закуски', 'Десерты'])
        self.assertEqual(menu['tables_count'], 24)
        # Карта напитков: сорта, которые есть в каталоге, плюс напитки базы подбора (0.0, тёмный лагер,
        # чай, эспрессо), без дублей при повторном запуске.
        self.assertEqual(MenuDrink.objects.filter(brand__isnull=False).count(), 2)
        self.assertEqual(
            sorted(MenuDrink.objects.exclude(engine_drink_id='').values_list('engine_drink_id', flat=True)),
            ['chay-chernyy', 'efes-0-0', 'espresso-amerikano', 'kruzhka-svezhego-0-0', 'velkopopovicky-kozel-cerny'])
        self.assertEqual([d['brand_name'] for d in menu['drinks']][:2], ['Бочковое', 'Velkopopovický Kozel'])
        self.assertEqual(menu['drinks'][1]['price'], '2200.00')
        self.assertEqual(menu['drinks'][0]['volume'], '0,5 л')
        efes_zero = next(d for d in menu['drinks'] if d['engine_drink_id'] == 'efes-0-0')
        self.assertFalse(efes_zero['is_alcoholic'])

        requests = list(ChangeRequest.objects.filter(status='PENDING').order_by('kind'))
        self.assertEqual([r.kind for r in requests], ['NOTE_UPSERT', 'SERVING'])
        self.assertTrue(all(r.author.username == 'sommelier' and r.brand == brand for r in requests))
        self.assertEqual(requests[0].payload['intensity'], 8)
        self.assertEqual(requests[1].payload['serving_temp_min'], 4)

        # Модератор видит их в списке и может принять.
        mod = client_for(User.objects.get(username='moderator'))
        self.assertEqual(mod.get('/api/change-requests/pending-count/').json(), {'count': 2})
        resp = mod.post(f'/api/change-requests/{requests[0].id}/approve/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(FlavorProfile.objects.get(brand=brand, flavor_note=note).intensity, 8)

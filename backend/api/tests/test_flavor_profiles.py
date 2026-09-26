from django.test import TestCase

from api.models import FlavorNote, FlavorProfile
from .helpers import make_user, client_for, make_brand

URL = '/api/admin/flavor-profiles/'


class FlavorProfilesTests(TestCase):
    def setUp(self):
        self.brand = make_brand()
        self.top = FlavorNote.objects.create(name='Цитрус', category='TOP', description='', icon='c')
        self.heart = FlavorNote.objects.create(name='Солод', category='HEART', description='', icon='m')
        self.base = FlavorNote.objects.create(name='Горчинка', category='BASE', description='', icon='b')
        self.mod = make_user('mod', role='moderator')
        self.client_mod = client_for(self.mod)

    def note(self, flavor_note, intensity=5, sommelier_note=''):
        return {'flavor_note_id': str(flavor_note.id), 'layer': flavor_note.category,
                'intensity': intensity, 'sommelier_note': sommelier_note}

    def post(self, notes, client=None, **extra):
        body = {'brand_id': str(self.brand.id), 'notes': notes}
        body.update(extra)
        return (client or self.client_mod).post(URL, body, format='json')

    def test_second_save_keeps_other_notes(self):
        resp = self.post([self.note(self.top), self.note(self.heart, 7)])
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(FlavorProfile.objects.filter(brand=self.brand).count(), 2)

        resp = self.post([self.note(self.base, 3, 'финиш')])
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(FlavorProfile.objects.filter(brand=self.brand).count(), 3)
        self.assertTrue(resp.data['ok'])
        self.assertTrue(resp.data['profile']['complete'])
        self.assertEqual(resp.data['warnings'], [])
        pyramid = resp.data['pyramid']
        self.assertEqual(pyramid['brand_id'], str(self.brand.id))
        self.assertEqual([n['name'] for n in pyramid['top']], ['Цитрус'])
        self.assertEqual([n['name'] for n in pyramid['base']], ['Горчинка'])
        self.assertEqual(pyramid['base'][0]['sommelier_note'], 'финиш')
        self.assertEqual(pyramid['base'][0]['sommelier_name'], 'mod')

    def test_update_existing_note(self):
        self.post([self.note(self.top, 4)])
        self.post([self.note(self.top, 9, 'ярче')])
        profile = FlavorProfile.objects.get(brand=self.brand, flavor_note=self.top)
        self.assertEqual(profile.intensity, 9)
        self.assertEqual(profile.sommelier_note, 'ярче')

    def test_replace_flag_removes_others(self):
        self.post([self.note(self.top), self.note(self.heart), self.note(self.base)])
        resp = self.post([self.note(self.top)], replace=True)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(list(FlavorProfile.objects.filter(brand=self.brand).values_list('flavor_note__name', flat=True)), ['Цитрус'])
        self.assertIn('Не заполнены слои: BASE, HEART', resp.data['warnings'])

    def test_delete_single_note(self):
        self.post([self.note(self.top), self.note(self.heart)])
        resp = self.client_mod.delete(f'{URL}?brand_id={self.brand.id}&flavor_note_id={self.top.id}')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(FlavorProfile.objects.filter(brand=self.brand).count(), 1)
        self.assertEqual([n['name'] for n in resp.data['pyramid']['heart']], ['Солод'])
        self.assertEqual(self.client_mod.delete(f'{URL}?brand_id={self.brand.id}').status_code, 400)
        self.assertEqual(self.client_mod.delete(f'{URL}?brand_id=abc&flavor_note_id={self.top.id}').status_code, 400)

    def test_layer_mismatch_warning(self):
        bad = dict(self.note(self.top), layer='BASE')
        resp = self.post([bad])
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(any('Цитрус' in w for w in resp.data['warnings']))

    def test_permissions(self):
        self.assertEqual(self.post([self.note(self.top)], client=client_for()).status_code, 401)
        self.assertEqual(self.post([self.note(self.top)], client=client_for(make_user('plain'))).status_code, 403)
        self.assertEqual(self.post([self.note(self.top)], client=client_for(make_user('rest', role='restaurant_admin'))).status_code, 403)
        # Сомелье больше не правит пирамиду напрямую: только через запрос модератору.
        somm = client_for(make_user('somm', role='sommelier'))
        self.assertEqual(self.post([self.note(self.top)], client=somm).status_code, 403)
        self.assertEqual(somm.delete(f'{URL}?brand_id={self.brand.id}&flavor_note_id={self.top.id}').status_code, 403)
        self.assertEqual(somm.post('/api/admin/serving-recommendations/', {
            'brand_id': str(self.brand.id), 'serving_temp_min': 4, 'serving_temp_max': 6, 'glass_type': 'Пилснер',
        }, format='json').status_code, 403)
        self.assertEqual(self.post([self.note(self.top)], client=self.client_mod).status_code, 200)

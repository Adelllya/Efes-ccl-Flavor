from django.test import TestCase

from api.models import ChangeRequest, FlavorNote, FlavorProfile, ServingRecommendation
from .helpers import make_user, client_for, make_brand

URL = '/api/change-requests/'


class ChangeRequestTests(TestCase):
    def setUp(self):
        self.brand = make_brand('Бочковое')
        self.top = FlavorNote.objects.create(name='Свежесть', category='TOP', description='', icon='f')
        self.heart = FlavorNote.objects.create(name='Солод', category='HEART', description='', icon='m')
        FlavorProfile.objects.create(brand=self.brand, flavor_note=self.heart, layer='HEART', intensity=5)
        self.somm = make_user('somm', role='sommelier')
        self.other_somm = make_user('somm2', role='sommelier')
        self.mod = make_user('mod', role='moderator')
        self.client_somm = client_for(self.somm)
        self.client_mod = client_for(self.mod)

    def note_body(self, note=None, intensity=7, **extra):
        note = note or self.top
        body = {
            'brand': str(self.brand.id), 'kind': 'NOTE_UPSERT',
            'payload': {'flavor_note_id': str(note.id), 'layer': note.category, 'intensity': intensity,
                        'sommelier_note': 'ярко'},
            'comment': 'После дегустации',
        }
        body.update(extra)
        return body

    def create(self, body=None, client=None):
        return (client or self.client_somm).post(URL, body or self.note_body(), format='json')

    def test_sommelier_creates_request_with_summary(self):
        resp = self.create()
        self.assertEqual(resp.status_code, 201, resp.content)
        data = resp.data
        self.assertEqual(data['status'], 'PENDING')
        self.assertEqual(data['status_display'], 'Ожидает')
        self.assertEqual(data['kind_display'], 'Нота пирамиды')
        self.assertEqual(data['brand_name'], 'Бочковое')
        self.assertEqual(data['author'], {'id': self.somm.id, 'username': 'somm'})
        self.assertIsNone(data['reviewer'])
        self.assertEqual(data['flavor_note_name'], 'Свежесть')
        self.assertIsNone(data['current'])
        self.assertEqual(data['summary'], 'Бочковое: нота Свежесть (Top), интенсивность 7/10')
        for key in ('id', 'brand', 'brand_image', 'payload', 'comment', 'review_comment', 'created_at', 'reviewed_at'):
            self.assertIn(key, data)
        # Ноты ещё нет в пирамиде: данные не изменились.
        self.assertFalse(FlavorProfile.objects.filter(brand=self.brand, flavor_note=self.top).exists())

    def test_current_shows_live_value(self):
        resp = self.create(self.note_body(self.heart, intensity=9))
        self.assertEqual(resp.data['current'], {
            'flavor_note_id': str(self.heart.id), 'layer': 'HEART', 'intensity': 5, 'sommelier_note': '',
        })

    def test_payload_validation(self):
        bad_note = self.note_body()
        bad_note['payload']['flavor_note_id'] = '00000000-0000-0000-0000-000000000000'
        self.assertEqual(self.create(bad_note).status_code, 400)
        self.assertEqual(self.create(self.note_body(intensity=11)).status_code, 400)
        self.assertEqual(self.create(self.note_body(intensity=0)).status_code, 400)
        bad_layer = self.note_body()
        bad_layer['payload']['layer'] = 'MIDDLE'
        self.assertEqual(self.create(bad_layer).status_code, 400)
        serving = {'brand': str(self.brand.id), 'kind': 'SERVING',
                   'payload': {'serving_temp_min': 8, 'serving_temp_max': 4, 'glass_type': 'Пилснер'}}
        resp = self.create(serving)
        self.assertEqual(resp.status_code, 400)
        self.assertIn('serving_temp_min', resp.data['payload'])
        serving['payload'] = {'serving_temp_min': 4, 'serving_temp_max': 6, 'glass_type': ''}
        self.assertEqual(self.create(serving).status_code, 400)
        self.assertEqual(self.create({'brand': str(self.brand.id), 'kind': 'SERVING', 'payload': 'text'}).status_code, 400)

    def test_permissions(self):
        self.assertEqual(self.create(client=client_for()).status_code, 401)
        self.assertEqual(self.create(client=client_for(make_user('plain'))).status_code, 403)
        self.assertEqual(self.create(client=client_for(make_user('rest', role='restaurant_admin'))).status_code, 403)
        self.assertEqual(self.create(client=self.client_mod).status_code, 201)

    def test_sommelier_cannot_approve_or_reject(self):
        req_id = self.create().data['id']
        self.assertEqual(self.client_somm.post(f'{URL}{req_id}/approve/').status_code, 403)
        self.assertEqual(self.client_somm.post(f'{URL}{req_id}/reject/', {'review_comment': 'нет'}, format='json').status_code, 403)
        self.assertEqual(self.client_somm.get(f'{URL}pending-count/').status_code, 403)
        self.assertEqual(ChangeRequest.objects.get(pk=req_id).status, 'PENDING')

    def test_moderator_approves_note_and_pyramid_changes(self):
        req_id = self.create().data['id']
        resp = self.client_mod.post(f'{URL}{req_id}/approve/', {'review_comment': 'Согласен'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['status'], 'APPROVED')
        self.assertEqual(resp.data['reviewer'], {'id': self.mod.id, 'username': 'mod'})
        self.assertEqual(resp.data['review_comment'], 'Согласен')
        self.assertIsNotNone(resp.data['reviewed_at'])
        self.assertEqual([n['name'] for n in resp.data['pyramid']['top']], ['Свежесть'])
        self.assertEqual(resp.data['pyramid']['top'][0]['intensity'], 7)
        self.assertEqual(resp.data['pyramid']['top'][0]['sommelier_name'], 'somm')
        profile = FlavorProfile.objects.get(brand=self.brand, flavor_note=self.top)
        self.assertEqual((profile.layer, profile.intensity, profile.sommelier_note), ('TOP', 7, 'ярко'))
        # Публичная пирамида тоже изменилась.
        public = client_for().get(f'/api/brands/{self.brand.id}/pyramid/').json()
        self.assertEqual([n['name'] for n in public['top']], ['Свежесть'])
        # Второй approve - 400.
        self.assertEqual(self.client_mod.post(f'{URL}{req_id}/approve/').status_code, 400)
        self.assertEqual(self.client_mod.post(f'{URL}{req_id}/reject/').status_code, 400)

    def test_approve_updates_existing_note(self):
        req_id = self.create(self.note_body(self.heart, intensity=9)).data['id']
        self.assertEqual(self.client_mod.post(f'{URL}{req_id}/approve/').status_code, 200)
        self.assertEqual(FlavorProfile.objects.get(brand=self.brand, flavor_note=self.heart).intensity, 9)
        self.assertEqual(FlavorProfile.objects.filter(brand=self.brand).count(), 1)

    def test_approve_note_delete(self):
        body = {'brand': str(self.brand.id), 'kind': 'NOTE_DELETE', 'payload': {'flavor_note_id': str(self.heart.id)}}
        resp = self.create(body)
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.data['summary'], 'Бочковое: удалить ноту Солод')
        self.assertEqual(resp.data['current']['intensity'], 5)
        resp = self.client_mod.post(f'{URL}{resp.data["id"]}/approve/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertFalse(FlavorProfile.objects.filter(brand=self.brand, flavor_note=self.heart).exists())
        self.assertEqual(resp.data['pyramid']['heart'], [])

    def test_approve_serving(self):
        ServingRecommendation.objects.create(brand=self.brand, serving_temp_min=6, serving_temp_max=8, glass_type='Кружка')
        body = {'brand': str(self.brand.id), 'kind': 'SERVING',
                'payload': {'serving_temp_min': 4, 'serving_temp_max': 6, 'glass_type': 'Пилснер', 'seasonality': 'Лето'}}
        resp = self.create(body)
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.data['summary'], 'Бочковое: подача 4-6 °C, бокал Пилснер')
        self.assertIsNone(resp.data['flavor_note_name'])
        self.assertEqual(resp.data['current']['glass_type'], 'Кружка')
        self.assertEqual(self.client_mod.post(f'{URL}{resp.data["id"]}/approve/').status_code, 200)
        rec = ServingRecommendation.objects.get(brand=self.brand)
        self.assertEqual((rec.serving_temp_min, rec.serving_temp_max, rec.glass_type, rec.seasonality), (4, 6, 'Пилснер', 'Лето'))

    def test_reject(self):
        req_id = self.create().data['id']
        resp = self.client_mod.post(f'{URL}{req_id}/reject/', {'review_comment': 'Слишком ярко'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['status'], 'REJECTED')
        self.assertEqual(resp.data['status_display'], 'Отклонено')
        self.assertEqual(resp.data['review_comment'], 'Слишком ярко')
        self.assertFalse(FlavorProfile.objects.filter(brand=self.brand, flavor_note=self.top).exists())
        # Сомелье видит причину в своём списке.
        mine = self.client_somm.get(URL).json()
        self.assertEqual(mine[0]['review_comment'], 'Слишком ярко')

    def test_delete_own_pending_only(self):
        req_id = self.create().data['id']
        self.assertEqual(client_for(self.other_somm).delete(f'{URL}{req_id}/').status_code, 404)
        self.assertEqual(self.client_somm.delete(f'{URL}{req_id}/').status_code, 204)
        self.assertFalse(ChangeRequest.objects.filter(pk=req_id).exists())
        req_id = self.create().data['id']
        self.client_mod.post(f'{URL}{req_id}/reject/')
        self.assertEqual(self.client_somm.delete(f'{URL}{req_id}/').status_code, 403)
        self.assertEqual(self.client_mod.delete(f'{URL}{req_id}/').status_code, 204)

    def test_list_visibility_and_filters(self):
        self.create()
        other_id = self.create(client=client_for(self.other_somm)).data['id']
        self.client_mod.post(f'{URL}{other_id}/reject/')
        self.assertEqual([r['author']['username'] for r in self.client_somm.get(URL).json()], ['somm'])
        everything = self.client_mod.get(URL).json()
        self.assertIsInstance(everything, list)
        self.assertEqual(len(everything), 2)
        self.assertEqual(len(self.client_mod.get(URL + '?status=PENDING').json()), 1)
        self.assertEqual(len(self.client_mod.get(URL + '?status=rejected').json()), 1)
        self.assertEqual(len(self.client_mod.get(URL + '?brand=' + str(self.brand.id)).json()), 2)
        self.assertEqual(self.client_mod.get(URL + '?brand=abc').json(), [])

    def test_pending_count(self):
        self.assertEqual(self.client_mod.get(f'{URL}pending-count/').json(), {'count': 0})
        self.create()
        req_id = self.create(self.note_body(self.heart)).data['id']
        self.assertEqual(self.client_mod.get(f'{URL}pending-count/').json(), {'count': 2})
        self.client_mod.post(f'{URL}{req_id}/approve/')
        self.assertEqual(self.client_mod.get(f'{URL}pending-count/').json(), {'count': 1})

from django.test import TestCase

from api.models import Brand
from .helpers import make_user, client_for, make_brand


class BrandVisibilityTests(TestCase):
    """Снятые с публикации сорта видят только сомелье и модератор."""

    def setUp(self):
        self.active = make_brand('Efes Pilsener')
        self.hidden = make_brand('Hidden', is_active=False)

    def names(self, client, query=''):
        resp = client.get('/api/brands/' + query)
        self.assertEqual(resp.status_code, 200, resp.content)
        return sorted(b['name'] for b in resp.json()['results'])

    def test_guest_and_other_roles_see_only_active(self):
        clients = (
            client_for(),
            client_for(make_user('plain')),
            client_for(make_user('rest', role='restaurant_admin')),
        )
        for client in clients:
            self.assertEqual(self.names(client), ['Efes Pilsener'])
            self.assertEqual(self.names(client, '?is_active=false'), [])
            self.assertEqual(client.get(f'/api/brands/{self.active.id}/').status_code, 200)
            self.assertEqual(client.get(f'/api/brands/{self.hidden.id}/').status_code, 404)
            self.assertEqual(client.get(f'/api/brands/{self.hidden.id}/pyramid/').status_code, 404)

    def test_sommelier_and_moderator_see_all(self):
        for client in (client_for(make_user('somm', role='sommelier')), client_for(make_user('mod', role='moderator'))):
            self.assertEqual(self.names(client), ['Efes Pilsener', 'Hidden'])
            self.assertEqual(self.names(client, '?is_active=false'), ['Hidden'])
            self.assertEqual(self.names(client, '?is_active=true'), ['Efes Pilsener'])
            self.assertEqual(client.get(f'/api/brands/{self.hidden.id}/').status_code, 200)
            self.assertEqual(client.get(f'/api/brands/{self.hidden.id}/pyramid/').status_code, 200)

    def test_moderator_can_republish_hidden_brand(self):
        resp = client_for(make_user('mod', role='moderator')).patch(
            f'/api/brands/{self.hidden.id}/', {'is_active': True}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(Brand.objects.get(pk=self.hidden.pk).is_active)
        self.assertEqual(client_for().get(f'/api/brands/{self.hidden.id}/').status_code, 200)

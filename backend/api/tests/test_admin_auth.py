"""Доступ к служебному API сомелье (api/auth.py): /api/admin/*, /api/seed/, запись в справочники.

Запуск: python manage.py test api.tests.test_admin_auth
База — sqlite в памяти, сети нет. FT_ADMIN_TOKEN подменяется в каждом тесте,
так что реальное окружение и backend/.env разработчика на результат не влияют.
"""
from __future__ import annotations

import os
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.models import Brand, FlavorNote, FlavorProfile, ServingRecommendation, Venue, VenueAccount

TOKEN = 'test-sommelier-token-5f2c9a'
WRONG = 'test-sommelier-token-XXXXXX'


class AdminAuthBase(TestCase):
    def setUp(self):
        env = mock.patch.dict(os.environ)  # всё, что тест положит в окружение, откатится
        env.start()
        self.addCleanup(env.stop)
        os.environ['FT_ADMIN_TOKEN'] = TOKEN

        self.client = APIClient()
        self.brand = Brand.objects.create(name='Test Lager', style='Lager', slug='test-lager')
        self.note = FlavorNote.objects.create(name='Хмель', category='TOP', description='—', icon='🌿', slug='hop')
        FlavorProfile.objects.create(brand=self.brand, flavor_note=self.note, layer='TOP', intensity=3)

    def unset_token(self):
        os.environ.pop('FT_ADMIN_TOKEN', None)

    def profile_body(self, intensity=7):
        return {'brand_id': str(self.brand.id),
                'notes': [{'flavor_note_id': str(self.note.id), 'layer': 'TOP', 'intensity': intensity}]}

    def put_profile(self, intensity=7, **headers):
        return self.client.put('/api/admin/flavor-profiles/', self.profile_body(intensity), format='json', **headers)

    def intensity(self):
        return FlavorProfile.objects.get(brand=self.brand, flavor_note=self.note).intensity

    def protected_calls(self):
        """Все закрытые маршруты: (метод, url, тело). Каждый пишет данные или лежит под /api/admin/."""
        b, n = self.brand.id, self.note.id
        return [
            ('get', '/api/admin/brands/', None),
            ('post', '/api/admin/brands/', {'name': 'Injected', 'style': 'Lager'}),
            ('put', '/api/admin/flavor-profiles/', self.profile_body(9)),
            ('put', '/api/admin/serving-recommendations/',
             {'brand_id': str(b), 'serving_temp_min': 4, 'serving_temp_max': 8, 'glass_type': 'Pint'}),
            ('post', '/api/admin/flavor-notes/', {'name': 'Injected', 'category': 'TOP', 'description': '—', 'icon': '🧪'}),
            ('patch', '/api/admin/flavor-notes/', {'id': str(n), 'name': 'Hacked'}),
            ('delete', f'/api/admin/flavor-notes/?id={n}', None),
            ('get', '/api/seed/', None),
            ('post', '/api/seed/', None),
            # ViewSet-ы справочников: чтение открыто, запись — нет
            ('post', '/api/brands/', {'name': 'Injected', 'style': 'Lager'}),
            ('put', f'/api/brands/{b}/', {'name': 'Hacked', 'style': 'Lager'}),
            ('patch', f'/api/brands/{b}/', {'name': 'Hacked'}),
            ('delete', f'/api/brands/{b}/', None),
            ('post', f'/api/brands/{b}/upload-image/', None),
            ('post', '/api/flavor-notes/', {'name': 'Injected', 'category': 'TOP', 'description': '—', 'icon': '🧪'}),
            ('patch', f'/api/flavor-notes/{n}/', {'name': 'Hacked'}),
            ('delete', f'/api/flavor-notes/{n}/', None),
        ]

    def call(self, method, url, body, **headers):
        return getattr(self.client, method)(url, body, format='json', **headers)

    def assert_untouched(self):
        self.assertEqual(list(Brand.objects.values_list('name', flat=True)), ['Test Lager'])
        self.assertEqual(list(FlavorNote.objects.values_list('name', flat=True)), ['Хмель'])
        self.assertEqual(self.intensity(), 3)
        self.assertFalse(ServingRecommendation.objects.exists())


class TestTokenConfigured(AdminAuthBase):
    """FT_ADMIN_TOKEN задан — обычный режим продакшена (тесты идут с DEBUG=False)."""

    def test_no_credentials_is_401_with_challenge(self):
        with mock.patch('django.core.management.call_command') as seed:
            for method, url, body in self.protected_calls():
                with self.subTest(method=method, url=url):
                    r = self.call(method, url, body)
                    self.assertEqual(r.status_code, 401, r.content)
                    self.assertTrue(r['WWW-Authenticate'].startswith('Bearer'), r['WWW-Authenticate'])
        seed.assert_not_called()
        self.assert_untouched()

    def test_wrong_token_is_403_for_both_headers(self):
        with mock.patch('django.core.management.call_command') as seed:
            for headers in ({'HTTP_AUTHORIZATION': f'Bearer {WRONG}'}, {'HTTP_X_ADMIN_TOKEN': WRONG}):
                for method, url, body in self.protected_calls():
                    with self.subTest(method=method, url=url, header=list(headers)[0]):
                        self.assertEqual(self.call(method, url, body, **headers).status_code, 403)
        seed.assert_not_called()
        self.assert_untouched()

    def test_malformed_or_foreign_credentials_are_403(self):
        account = VenueAccount.objects.create(
            venue=Venue.objects.create(name='Bar', address='—', venue_type='BAR', slug='bar'), email='bar@example.com')
        cases = {
            'пустой Bearer': {'HTTP_AUTHORIZATION': 'Bearer '},
            'пустой X-Admin-Token': {'HTTP_X_ADMIN_TOKEN': ''},
            'префикс токена': {'HTTP_AUTHORIZATION': f'Bearer {TOKEN[:-1]}'},
            'токен с хвостом': {'HTTP_AUTHORIZATION': f'Bearer {TOKEN}x'},
            'другой регистр': {'HTTP_AUTHORIZATION': f'Bearer {TOKEN.upper()}'},
            'схема Basic': {'HTTP_AUTHORIZATION': f'Basic {TOKEN}'},
            'схема Token': {'HTTP_AUTHORIZATION': f'Token {TOKEN}'},
            'не-ASCII': {'HTTP_X_ADMIN_TOKEN': 'токен'},
            # токен кабинета заведения — другой контур, в админку сомелье не пускает
            'токен кабинета': {'HTTP_AUTHORIZATION': f'Bearer {account.api_token}'},
        }
        for name, headers in cases.items():
            with self.subTest(name):
                self.assertEqual(self.put_profile(**headers).status_code, 403)
        self.assert_untouched()

    def test_token_in_query_string_is_not_accepted(self):
        r = self.client.put(f'/api/admin/flavor-profiles/?token={TOKEN}', self.profile_body(), format='json')
        self.assertEqual(r.status_code, 401)
        self.assert_untouched()

    def test_correct_token_via_bearer(self):
        r = self.put_profile(7, HTTP_AUTHORIZATION=f'Bearer {TOKEN}')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()['ok'])
        self.assertEqual(self.intensity(), 7)

    def test_correct_token_via_x_admin_token(self):
        r = self.put_profile(8, HTTP_X_ADMIN_TOKEN=TOKEN)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.intensity(), 8)

    def test_bearer_scheme_is_case_insensitive(self):
        self.assertEqual(self.put_profile(HTTP_AUTHORIZATION=f'bearer {TOKEN}').status_code, 200)

    def test_valid_x_admin_token_wins_over_foreign_authorization(self):
        """Authorization может быть занят другим (прокси, кабинет) — X-Admin-Token проверяется независимо."""
        r = self.put_profile(HTTP_AUTHORIZATION='Bearer something-else', HTTP_X_ADMIN_TOKEN=TOKEN)
        self.assertEqual(r.status_code, 200)

    def test_correct_token_opens_every_protected_route(self):
        auth = {'HTTP_AUTHORIZATION': f'Bearer {TOKEN}'}
        with mock.patch('django.core.management.call_command') as seed:
            for method, url, body in self.protected_calls():
                with self.subTest(method=method, url=url):
                    # 400 допустим (upload-image без файла): важно, что это уже не отказ в доступе
                    self.assertNotIn(self.call(method, url, body, **auth).status_code, (401, 403))
        self.assertEqual(seed.call_count, 2)
        seed.assert_called_with('load_flavor_data')

    def test_surrounding_whitespace_in_env_token_is_ignored(self):
        os.environ['FT_ADMIN_TOKEN'] = f'  {TOKEN}\n'
        self.assertEqual(self.put_profile(HTTP_AUTHORIZATION=f'Bearer {TOKEN}').status_code, 200)

    def test_staff_session(self):
        staff = get_user_model().objects.create_user('sommelier', password='pw-12345-xyz', is_staff=True)
        self.client.force_login(staff)
        r = self.put_profile(6)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.intensity(), 6)
        self.assertEqual(self.client.get('/api/admin/brands/').status_code, 200)

    def test_non_staff_session_is_403(self):
        user = get_user_model().objects.create_user('guest', password='pw-12345-xyz')
        self.client.force_login(user)
        self.assertEqual(self.put_profile().status_code, 403)
        self.assert_untouched()

    def test_non_staff_session_with_correct_token_passes(self):
        self.client.force_login(get_user_model().objects.create_user('guest', password='pw-12345-xyz'))
        self.assertEqual(self.put_profile(HTTP_X_ADMIN_TOKEN=TOKEN).status_code, 200)

    @override_settings(CORS_ALLOW_ALL_ORIGINS=False, CORS_ALLOWED_ORIGINS=['https://app.example.com'])
    def test_browser_preflight_needs_no_token_and_allows_both_headers(self):
        """SPA с другого домена: preflight идёт без Authorization — он не должен упираться в 401."""
        r = self.client.options('/api/admin/flavor-profiles/', HTTP_ORIGIN='https://app.example.com',
                                HTTP_ACCESS_CONTROL_REQUEST_METHOD='PUT',
                                HTTP_ACCESS_CONTROL_REQUEST_HEADERS='authorization,x-admin-token,content-type')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r['Access-Control-Allow-Origin'], 'https://app.example.com')
        allowed = r['Access-Control-Allow-Headers'].lower()
        self.assertIn('authorization', allowed)
        self.assertIn('x-admin-token', allowed)

    def test_public_reads_stay_open(self):
        for url in ('/api/health/', '/api/brands/', f'/api/brands/{self.brand.id}/',
                    f'/api/brands/{self.brand.id}/pyramid/', '/api/flavor-notes/',
                    f'/api/flavor-notes/{self.note.id}/', f'/api/flavor-notes/{self.note.id}/brands/',
                    '/api/dishes/', '/api/pairings/', '/api/courses/', '/api/team/'):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 200)


class TestTokenUnset(AdminAuthBase):
    """FT_ADMIN_TOKEN не задан: в проде закрыто, в DEBUG открыто с предупреждением."""

    def setUp(self):
        super().setUp()
        self.unset_token()

    @override_settings(DEBUG=False)
    def test_debug_false_denies_everything(self):
        attempts = [{}, {'HTTP_AUTHORIZATION': f'Bearer {TOKEN}'}, {'HTTP_X_ADMIN_TOKEN': TOKEN},
                    # пустой токен не должен совпасть с «пустым» ожидаемым
                    {'HTTP_AUTHORIZATION': 'Bearer '}, {'HTTP_AUTHORIZATION': 'Bearer'}, {'HTTP_X_ADMIN_TOKEN': ''}]
        with mock.patch('django.core.management.call_command') as seed, self.assertLogs('api.auth', 'ERROR'):
            for headers in attempts:
                for method, url, body in self.protected_calls():
                    with self.subTest(method=method, url=url, headers=headers):
                        self.assertEqual(self.call(method, url, body, **headers).status_code, 403)
        seed.assert_not_called()
        self.assert_untouched()

    @override_settings(DEBUG=False)
    def test_debug_false_blank_token_counts_as_unset(self):
        os.environ['FT_ADMIN_TOKEN'] = '   '
        with self.assertLogs('api.auth', 'ERROR'):
            self.assertEqual(self.put_profile(HTTP_AUTHORIZATION='Bearer ').status_code, 403)
            self.assertEqual(self.put_profile(HTTP_X_ADMIN_TOKEN='   ').status_code, 403)
        self.assert_untouched()

    @override_settings(DEBUG=False)
    def test_debug_false_staff_session_still_works(self):
        """Вход сотрудника — отдельные учётные данные, от токена не зависит."""
        self.client.force_login(get_user_model().objects.create_user('sommelier', password='pw-12345-xyz', is_staff=True))
        self.assertEqual(self.put_profile(5).status_code, 200)
        self.assertEqual(self.intensity(), 5)

    @override_settings(DEBUG=False)
    def test_debug_false_public_reads_stay_open(self):
        self.assertEqual(self.client.get('/api/brands/').status_code, 200)
        self.assertEqual(self.client.get('/api/flavor-notes/').status_code, 200)

    @override_settings(DEBUG=True)
    def test_debug_true_allows_with_logged_warning(self):
        with self.assertLogs('api.auth', 'WARNING') as logs:
            r = self.put_profile(4)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self.intensity(), 4)
        self.assertIn('FT_ADMIN_TOKEN', logs.output[0])

    @override_settings(DEBUG=True)
    def test_debug_true_opens_every_protected_route(self):
        with mock.patch('django.core.management.call_command'), self.assertLogs('api.auth', 'WARNING'):
            for method, url, body in self.protected_calls():
                with self.subTest(method=method, url=url):
                    self.assertNotIn(self.call(method, url, body).status_code, (401, 403))

    @override_settings(DEBUG=True)
    def test_debug_true_does_not_relax_a_configured_token(self):
        os.environ['FT_ADMIN_TOKEN'] = TOKEN
        self.assertEqual(self.put_profile().status_code, 401)
        self.assertEqual(self.put_profile(HTTP_AUTHORIZATION=f'Bearer {WRONG}').status_code, 403)
        self.assert_untouched()

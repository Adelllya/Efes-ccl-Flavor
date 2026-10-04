"""
Кэш браузера для публичного каталога (api/http_cache.py): анонимные GET каталога кэшируются
на минуту только в браузере, всё личное, меню, заказы и ошибки не кэшируются никогда.
"""
from django.test import TestCase, override_settings
from django.utils.cache import cc_delim_re

from api.http_cache import CATALOG_CACHE_CONTROL
from .helpers import client_for, make_brand, make_dish, make_menu_item, make_user, make_venue


def vary_of(response):
    return {v.strip().lower() for v in cc_delim_re.split(response.get('Vary', '')) if v.strip()}


class CatalogBrowserCacheTests(TestCase):
    def setUp(self):
        self.brand = make_brand()
        self.dish = make_dish()

    def assertCached(self, response):
        self.assertEqual(response.status_code, 200, response.content[:200])
        self.assertEqual(response['Cache-Control'], CATALOG_CACHE_CONTROL)
        # private: только браузер гостя, CDN такой ответ не хранит
        self.assertTrue(response['Cache-Control'].startswith('private'))
        self.assertTrue({'authorization', 'cookie', 'origin'} <= vary_of(response), response.get('Vary'))

    def assertNotCached(self, response):
        self.assertNotEqual(response.get('Cache-Control'), CATALOG_CACHE_CONTROL)

    def test_anonymous_catalog_is_cached_in_browser(self):
        client = client_for()
        for url in ('/api/brands/', f'/api/brands/{self.brand.id}/', '/api/dishes/', '/api/pairings/',
                    '/api/flavor-notes/', '/api/food-icons/', '/api/settings/',
                    '/api/v2/meta/', '/api/v2/dishes/', '/api/v2/drinks/?limit=3'):
            with self.subTest(url=url):
                self.assertCached(client.get(url))

    def test_head_is_cached_like_get(self):
        self.assertCached(client_for().head('/api/brands/'))

    def test_logged_in_user_gets_fresh_catalog(self):
        # Сомелье видит снятые с публикации сорта и сразу свои правки.
        somm = make_user('somm', role='sommelier')
        for url in ('/api/brands/', '/api/v2/meta/'):
            with self.subTest(url=url):
                response = client_for(somm).get(url)
                self.assertEqual(response.status_code, 200)
                self.assertNotCached(response)

    def test_session_login_gets_fresh_catalog(self):
        make_user('somm', role='sommelier')
        client = client_for()
        self.assertTrue(client.login(username='somm', password='strong-pass-12345'))
        self.assertNotCached(client.get('/api/brands/'))

    def test_menu_orders_and_errors_are_not_cached(self):
        venue = make_venue(tables_count=5)
        make_menu_item(venue, self.dish)
        client = client_for()
        self.assertNotCached(client.get(f'/api/venues/{venue.slug}/menu/'))
        self.assertNotCached(client.get(f'/api/venues/{venue.slug}/'))
        self.assertNotCached(client.get('/api/ai/status/'))
        missing = client.get('/api/v2/drinks/no-such-drink/')
        self.assertEqual(missing.status_code, 404)
        self.assertNotCached(missing)
        # Подбор под карту конкретного бара зависит от наличия в смене
        self.assertNotCached(client.get('/api/v2/pairing/dish/beshbarmak/', {'venue': venue.slug}))

    def test_writes_are_not_cached(self):
        response = client_for().post('/api/brands/', {'name': 'X'}, format='json')
        self.assertIn(response.status_code, (401, 403))
        self.assertNotCached(response)

    def test_own_cache_headers_are_kept(self):
        client = client_for()
        self.assertEqual(client.get('/api/health/')['Cache-Control'], 'no-store')
        # У главной свой cache_page на 5 минут
        self.assertEqual(client.get('/api/landing/')['Cache-Control'], 'max-age=300')

    @override_settings(DEBUG=True)
    def test_no_cache_locally(self):
        self.assertNotCached(client_for().get('/api/brands/'))

"""SaaS-API заведений (api/views_saas.py): регистрация, кабинет, меню, столы, аналитика, заявки.

Запуск: python manage.py test api.tests.test_saas
База — sqlite в памяти, сети нет. Эндпоинт импорта меню здесь не проверяется.

Ошибки views_saas.py, найденные этим набором, собраны в конце файла в TestKnownBugs:
каждый такой тест помечен @expectedFailure. Набор с ними остаётся зелёным; когда ошибку
исправят, тест даст «unexpected success» — тогда декоратор нужно снять.
"""
from __future__ import annotations

from datetime import timedelta
from unittest import expectedFailure

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import Lead, MenuEvent, QRCode, ScanEvent, Venue, VenueAccount, VenueMenuItem

TRIAL = VenueAccount.PLAN_LIMITS['TRIAL']
START = VenueAccount.PLAN_LIMITS['START']


def bearer(token: str) -> dict:
    return {'HTTP_AUTHORIZATION': f'Bearer {token}'}


class SaasBase(TestCase):
    def setUp(self):
        self.client = APIClient()

    def register(self, email='owner@example.com', venue_name='Hop House', password='secret-1', **extra):
        return self.client.post('/api/cabinet/register/',
                                {'email': email, 'password': password, 'venue_name': venue_name, **extra}, format='json')

    def new_venue(self, email='owner@example.com', venue_name='Hop House', **extra):
        """Регистрирует заведение и возвращает (заголовки с токеном, slug, аккаунт)."""
        r = self.register(email=email, venue_name=venue_name, **extra)
        self.assertEqual(r.status_code, 201, r.content)
        body = r.json()
        return bearer(body['token']), body['venue']['slug'], VenueAccount.objects.get(email=email)

    def upgrade(self, account: VenueAccount, plan='START', days=30):
        account.plan = plan
        account.paid_until = timezone.now() + timedelta(days=days)
        account.save()

    def post_menu(self, auth, payload):
        return self.client.post('/api/cabinet/menu/', payload, format='json', **auth)

    def track(self, slug, kind, **extra):
        return self.client.post('/api/track/', {'venue': slug, 'kind': kind, **extra}, format='json')

    def public_slugs(self, slug):
        body = self.client.get(f'/api/menu/{slug}/').json()
        return [i['ref_slug'] for i in body['beers']], [i['ref_slug'] for i in body['dishes']]


# ───────────────────────────  регистрация и вход  ───────────────────────────

class TestRegister(SaasBase):
    def test_register_creates_venue_trial_account_and_tables(self):
        r = self.register(email='  Owner@Example.COM ', venue_name='Hop House', city='Алматы', tables=3)
        self.assertEqual(r.status_code, 201, r.content)
        body = r.json()
        self.assertEqual(body['plan'], 'TRIAL')
        self.assertEqual(body['limits'], TRIAL)
        self.assertTrue(body['active'])
        self.assertIn(body['days_left'], (13, 14))
        self.assertEqual(body['email'], 'owner@example.com')  # e-mail нормализуется
        self.assertEqual(body['venue']['slug'], 'hop-house')
        self.assertEqual(body['venue']['city'], 'Алматы')
        self.assertFalse(body['venue']['branding'])

        account = VenueAccount.objects.get(email='owner@example.com')
        self.assertEqual(body['token'], account.api_token)
        self.assertGreaterEqual(len(account.api_token), 32)
        self.assertEqual(account.venue.qrcodes.count(), 3)

    def test_password_is_stored_hashed_and_never_returned(self):
        r = self.register(password='secret-1')
        account = VenueAccount.objects.get()
        self.assertNotIn('secret-1', account.password_hash)
        self.assertTrue(account.check_password('secret-1'))
        self.assertNotIn('secret-1', r.content.decode())
        self.assertNotIn(account.password_hash, r.content.decode())

    def test_default_table_count_fits_trial(self):
        _, _, account = self.new_venue()
        self.assertEqual(account.venue.qrcodes.count(), 5)
        self.assertLessEqual(account.venue.qrcodes.count(), TRIAL['tables'])

    def test_validation(self):
        bad = [{'email': ''}, {'password': '12345'}, {'venue_name': '   '}]
        for override in bad:
            with self.subTest(override):
                self.assertEqual(self.register(**override).status_code, 400)
        self.assertFalse(Venue.objects.exists())
        self.assertFalse(VenueAccount.objects.exists())

    def test_duplicate_email_is_409_case_insensitive(self):
        self.assertEqual(self.register(email='owner@example.com').status_code, 201)
        r = self.register(email='OWNER@example.com', venue_name='Another')
        self.assertEqual(r.status_code, 409)
        self.assertEqual(Venue.objects.count(), 1)

    def test_same_venue_name_gets_own_slug_and_qr_tokens(self):
        _, slug_a, acc_a = self.new_venue('a@example.com', 'Hop House')
        _, slug_b, acc_b = self.new_venue('b@example.com', 'Hop House')
        self.assertNotEqual(slug_a, slug_b)
        tokens_a = set(acc_a.venue.qrcodes.values_list('unique_token', flat=True))
        tokens_b = set(acc_b.venue.qrcodes.values_list('unique_token', flat=True))
        self.assertEqual(len(tokens_a), 5)
        self.assertEqual(len(tokens_b), 5)
        self.assertFalse(tokens_a & tokens_b)
        self.assertNotEqual(acc_a.api_token, acc_b.api_token)

    def test_cyrillic_venue_name_still_gets_a_slug(self):
        r = self.register(venue_name='Пивная №1')
        self.assertEqual(r.status_code, 201, r.content)
        slug = r.json()['venue']['slug']
        self.assertTrue(slug)
        self.assertEqual(self.client.get(f'/api/menu/{slug}/').status_code, 200)




class TestLogin(SaasBase):
    def setUp(self):
        super().setUp()
        self.auth, self.slug, self.account = self.new_venue(email='owner@example.com', password='secret-1')

    def login(self, email='owner@example.com', password='secret-1'):
        return self.client.post('/api/cabinet/login/', {'email': email, 'password': password}, format='json')

    def test_login_returns_same_session_payload(self):
        r = self.login(email=' OWNER@example.com ')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()['token'], self.account.api_token)
        self.assertEqual(r.json()['venue']['slug'], self.slug)
        self.account.refresh_from_db()
        self.assertIsNotNone(self.account.last_login_at)

    def test_wrong_password_and_unknown_email_are_401_with_same_message(self):
        wrong, unknown = self.login(password='secret-2'), self.login(email='nobody@example.com')
        self.assertEqual(wrong.status_code, 401)
        self.assertEqual(unknown.status_code, 401)
        self.assertEqual(wrong.json(), unknown.json())  # не подсказываем, какие e-mail зарегистрированы
        self.assertNotIn('token', wrong.json())

    def test_empty_credentials_are_401(self):
        self.assertEqual(self.client.post('/api/cabinet/login/', {}, format='json').status_code, 401)
        self.assertEqual(self.login(password='').status_code, 401)

    def test_disabled_account_cannot_login_or_use_token(self):
        VenueAccount.objects.filter(pk=self.account.pk).update(is_active=False)
        self.assertEqual(self.login().status_code, 403)
        self.assertEqual(self.client.get('/api/cabinet/overview/', **self.auth).status_code, 401)

    def test_cabinet_requires_token(self):
        item = VenueMenuItem.objects.create(venue=self.account.venue, kind='BEER', ref_slug='efes')
        table = self.account.venue.qrcodes.first()
        calls = [('get', '/api/cabinet/overview/'), ('patch', '/api/cabinet/venue/'), ('get', '/api/cabinet/menu/'),
                 ('post', '/api/cabinet/menu/'), ('delete', f'/api/cabinet/menu/{item.id}/'),
                 ('get', '/api/cabinet/tables/'), ('post', '/api/cabinet/tables/'),
                 ('delete', f'/api/cabinet/tables/{table.id}/'), ('get', '/api/cabinet/stats/')]
        for headers in ({}, bearer('no-such-token'), bearer(''), {'HTTP_AUTHORIZATION': self.account.api_token}):
            for method, url in calls:
                with self.subTest(method=method, url=url, headers=headers):
                    r = getattr(self.client, method)(url, {'name': 'Hacked', 'tables': 1}, format='json', **headers)
                    self.assertEqual(r.status_code, 401)
        self.account.venue.refresh_from_db()
        self.assertEqual(self.account.venue.name, 'Hop House')
        self.assertTrue(VenueMenuItem.objects.filter(pk=item.pk).exists())
        self.assertEqual(self.account.venue.qrcodes.count(), 5)

    def test_token_rotation_invalidates_old_token(self):
        self.account.rotate_token()
        self.assertEqual(self.client.get('/api/cabinet/overview/', **self.auth).status_code, 401)
        self.assertEqual(self.client.get('/api/cabinet/overview/', **bearer(self.account.api_token)).status_code, 200)


# ─────────────────────────────  обзор и заведение  ──────────────────────────

class TestOverviewAndVenue(SaasBase):
    def setUp(self):
        super().setUp()
        self.auth, self.slug, self.account = self.new_venue(tables=4)

    def test_overview_summary(self):
        self.post_menu(self.auth, {'items': [{'kind': 'BEER', 'ref_slug': 'efes', 'price': 1200},
                                             {'kind': 'DISH', 'ref_slug': 'kazy', 'price': 3500, 'is_available': False}]})
        self.track(self.slug, 'SCAN', table=1)
        self.track(self.slug, 'ORDER_INTENT', beer='efes', dish='kazy', price=1200)
        self.track(self.slug, 'PAIR_VIEW', beer='efes', dish='kazy')

        r = self.client.get('/api/cabinet/overview/', **self.auth)
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body['summary'], {'items': 2, 'items_available': 1, 'tables': 4,
                                           'scans_30d': 1, 'order_intents_30d': 1})
        self.assertEqual(body['venue']['slug'], self.slug)
        self.assertEqual(body['plan'], 'TRIAL')
        self.assertEqual(body['token'], self.account.api_token)

    def test_venue_update_is_visible_to_guests(self):
        r = self.client.patch('/api/cabinet/venue/', {
            'name': 'Hop House Almaty', 'city': 'Алматы', 'address': 'Абая 1', 'phone': '+7 000 000 00 00',
            'instagram': '@hophouse', 'wifi_password': 'hops2026', 'menu_headline': 'Что к пиву?',
            'description': 'Крафтовый бар', 'venue_type': 'PUB',
        }, format='json', **self.auth)
        self.assertEqual(r.status_code, 200, r.content)
        public = self.client.get(f'/api/menu/{self.slug}/').json()['venue']
        self.assertEqual(public['name'], 'Hop House Almaty')
        self.assertEqual(public['city'], 'Алматы')
        self.assertEqual(public['wifi'], 'hops2026')
        self.assertEqual(public['headline'], 'Что к пиву?')
        self.assertEqual(public['venue_type'], 'PUB')
        self.assertEqual(public['slug'], self.slug)  # slug не меняется — напечатанные QR живут дальше

    def test_venue_update_ignores_unknown_type_and_protected_fields(self):
        venue_id = self.account.venue.id
        self.client.patch('/api/cabinet/venue/', {'venue_type': 'CASINO', 'slug': 'stolen', 'id': 'x', 'is_active': False,
                                                  'currency': '$'}, format='json', **self.auth)
        venue = Venue.objects.get(pk=venue_id)
        self.assertEqual(venue.venue_type, 'BAR')
        self.assertEqual(venue.slug, self.slug)
        self.assertTrue(venue.is_active)
        self.assertEqual(venue.currency, '₸')

    def test_long_values_are_truncated_not_rejected(self):
        r = self.client.patch('/api/cabinet/venue/', {'name': 'x' * 500}, format='json', **self.auth)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(Venue.objects.get(slug=self.slug).name), 200)


# ─────────────────────────────────  меню  ───────────────────────────────────

class TestMenu(SaasBase):
    def setUp(self):
        super().setUp()
        self.auth, self.slug, self.account = self.new_venue()

    def test_create_single_bulk_and_bare_list(self):
        one = self.post_menu(self.auth, {'kind': 'BEER', 'ref_slug': 'efes-pilsener', 'price': '1200.50', 'volume': '0.5 л'})
        self.assertEqual(one.status_code, 200, one.content)
        self.assertEqual(one.json()['saved'], 1)
        self.assertEqual(one.json()['items'][0]['price'], 1200.5)

        bulk = self.post_menu(self.auth, {'items': [{'kind': 'DISH', 'ref_slug': 'kazy', 'price': 3500, 'name': 'Казы'},
                                                    {'kind': 'DISH', 'ref_slug': 'manty', 'price': 2800}]})
        self.assertEqual(bulk.json()['saved'], 2)
        bare = self.post_menu(self.auth, [{'kind': 'BEER', 'ref_slug': 'kozel', 'price': 1100}])
        self.assertEqual(bare.json()['saved'], 1)

        menu = self.client.get('/api/cabinet/menu/', **self.auth).json()
        self.assertEqual(sorted(i['ref_slug'] for i in menu['beers']), ['efes-pilsener', 'kozel'])
        self.assertEqual(sorted(i['ref_slug'] for i in menu['dishes']), ['kazy', 'manty'])
        self.assertEqual(menu['used'], 4)
        self.assertEqual(menu['limit'], TRIAL['items'])

    def test_post_same_position_updates_instead_of_duplicating(self):
        self.post_menu(self.auth, {'kind': 'BEER', 'ref_slug': 'efes', 'price': 1000, 'name': 'Efes', 'is_featured': True})
        r = self.post_menu(self.auth, {'kind': 'BEER', 'ref_slug': 'efes', 'price': 1300})
        self.assertEqual(r.status_code, 200)
        item = VenueMenuItem.objects.get(venue=self.account.venue)
        self.assertEqual(float(item.price), 1300.0)
        self.assertEqual(item.custom_name, 'Efes')  # непереданные поля не затираются
        self.assertTrue(item.is_featured)

    def test_same_slug_can_be_beer_and_dish(self):
        self.post_menu(self.auth, [{'kind': 'BEER', 'ref_slug': 'special'}, {'kind': 'DISH', 'ref_slug': 'special'}])
        self.assertEqual(VenueMenuItem.objects.filter(venue=self.account.venue).count(), 2)

    def test_invalid_rows_are_skipped_and_empty_payload_is_400(self):
        r = self.post_menu(self.auth, {'items': [{'kind': 'WINE', 'ref_slug': 'merlot'}, {'kind': 'BEER'},
                                                 {'kind': 'BEER', 'ref_slug': 'efes'}]})
        self.assertEqual(r.json()['saved'], 1)
        self.assertEqual(VenueMenuItem.objects.count(), 1)
        for payload in ({'items': []}, {'items': 'efes'}):
            with self.subTest(payload=payload):
                self.assertEqual(self.post_menu(self.auth, payload).status_code, 400)
        # пустое тело целиком сейчас отвечает 200 c saved=0 — важно лишь, что ничего не создаётся
        for payload in ({}, []):
            with self.subTest(payload=payload):
                self.assertIn(self.post_menu(self.auth, payload).status_code, (200, 400))
        self.assertEqual(VenueMenuItem.objects.count(), 1)

    def test_unparseable_price_falls_back_to_zero(self):
        r = self.post_menu(self.auth, {'kind': 'BEER', 'ref_slug': 'efes', 'price': 'дорого'})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['items'][0]['price'], 0.0)

    def test_delete_item(self):
        item_id = self.post_menu(self.auth, {'kind': 'BEER', 'ref_slug': 'efes'}).json()['items'][0]['id']
        self.assertEqual(self.client.delete(f'/api/cabinet/menu/{item_id}/', **self.auth).status_code, 200)
        self.assertFalse(VenueMenuItem.objects.exists())
        self.assertEqual(self.client.delete(f'/api/cabinet/menu/{item_id}/', **self.auth).status_code, 404)

    def test_stop_list_toggle_is_visible_in_public_menu(self):
        self.post_menu(self.auth, [{'kind': 'BEER', 'ref_slug': 'efes', 'price': 1200},
                                   {'kind': 'BEER', 'ref_slug': 'kozel', 'price': 1100},
                                   {'kind': 'DISH', 'ref_slug': 'kazy', 'price': 3500}])
        self.assertEqual(self.public_slugs(self.slug), (['efes', 'kozel'], ['kazy']))

        # в стоп — гость позицию не видит, владелец видит
        r = self.post_menu(self.auth, {'kind': 'BEER', 'ref_slug': 'kozel', 'is_available': False})
        self.assertFalse(r.json()['items'][0]['is_available'])
        self.assertEqual(self.public_slugs(self.slug), (['efes'], ['kazy']))
        cabinet = self.client.get('/api/cabinet/menu/', **self.auth).json()
        self.assertEqual({i['ref_slug']: i['is_available'] for i in cabinet['beers']}, {'efes': True, 'kozel': False})
        self.assertEqual(float(VenueMenuItem.objects.get(ref_slug='kozel').price), 1100.0)  # цена не потерялась

        self.post_menu(self.auth, {'kind': 'DISH', 'ref_slug': 'kazy', 'is_available': False})
        self.assertEqual(self.public_slugs(self.slug), (['efes'], []))

        # из стопа — снова видна
        self.post_menu(self.auth, {'kind': 'BEER', 'ref_slug': 'kozel', 'is_available': True})
        self.assertEqual(self.public_slugs(self.slug), (['efes', 'kozel'], []))

    def test_public_menu_payload_and_sort_order(self):
        self.post_menu(self.auth, [{'kind': 'BEER', 'ref_slug': 'b', 'sort_order': 2, 'price': 900, 'volume': '0.5 л'},
                                   {'kind': 'BEER', 'ref_slug': 'a', 'sort_order': 5},
                                   {'kind': 'BEER', 'ref_slug': 'c', 'sort_order': 1}])
        r = self.client.get(f'/api/menu/{self.slug}/?table=7')
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual([i['ref_slug'] for i in body['beers']], ['c', 'b', 'a'])
        self.assertEqual(body['table'], 7)
        self.assertEqual(body['venue']['currency'], '₸')
        self.assertEqual(body['beers'][1]['price'], 900.0)
        self.assertEqual(body['beers'][1]['volume'], '0.5 л')
        self.assertIsNone(self.client.get(f'/api/menu/{self.slug}/?table=abc').json()['table'])

    def test_public_menu_never_exposes_account_data(self):
        text = self.client.get(f'/api/menu/{self.slug}/').content.decode()
        self.assertNotIn(self.account.api_token, text)
        self.assertNotIn(self.account.email, text)

    def test_public_menu_unknown_inactive_and_expired(self):
        self.assertEqual(self.client.get('/api/menu/no-such-bar/').status_code, 404)

        VenueAccount.objects.filter(pk=self.account.pk).update(trial_ends_at=timezone.now() - timedelta(days=1))
        r = self.client.get(f'/api/menu/{self.slug}/')
        self.assertEqual(r.status_code, 402)
        self.assertTrue(r.json()['expired'])
        self.assertNotIn('beers', r.json())

        Venue.objects.filter(slug=self.slug).update(is_active=False)
        self.assertEqual(self.client.get(f'/api/menu/{self.slug}/').status_code, 404)




# ─────────────────────────────────  столы  ──────────────────────────────────

class TestTables(SaasBase):
    def setUp(self):
        super().setUp()
        self.auth, self.slug, self.account = self.new_venue(tables=2)

    def test_list_create_delete(self):
        listed = self.client.get('/api/cabinet/tables/', **self.auth).json()
        self.assertEqual([t['number'] for t in listed['tables']], [1, 2])
        self.assertEqual(listed['limit'], TRIAL['tables'])
        self.assertEqual(listed['tables'][0]['label'], 'Стол 1')
        self.assertEqual(listed['tables'][0]['scans'], 0)

        r = self.client.post('/api/cabinet/tables/', {'tables': 2}, format='json', **self.auth)
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual([t['number'] for t in r.json()['created']], [3, 4])
        self.assertEqual(len(r.json()['tables']), 4)
        tokens = [t['token'] for t in r.json()['tables']]
        self.assertEqual(len(set(tokens)), 4)

        victim = r.json()['tables'][1]
        self.assertEqual(self.client.delete(f"/api/cabinet/tables/{victim['id']}/", **self.auth).status_code, 200)
        self.assertEqual(self.client.delete(f"/api/cabinet/tables/{victim['id']}/", **self.auth).status_code, 404)
        left = self.client.get('/api/cabinet/tables/', **self.auth).json()['tables']
        self.assertEqual([t['number'] for t in left], [1, 3, 4])

    def test_post_without_count_adds_one_table(self):
        r = self.client.post('/api/cabinet/tables/', {}, format='json', **self.auth)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(len(r.json()['created']), 1)

    def test_new_tables_never_reuse_a_taken_number_or_token(self):
        first = self.account.venue.qrcodes.get(table_number=1)
        self.client.delete(f'/api/cabinet/tables/{first.id}/', **self.auth)
        r = self.client.post('/api/cabinet/tables/', {'tables': 2}, format='json', **self.auth)
        numbers = [t['number'] for t in r.json()['tables']]
        self.assertEqual(len(numbers), len(set(numbers)))
        self.assertEqual(QRCode.objects.count(), QRCode.objects.values('unique_token').distinct().count())

    def test_table_scan_counter_shows_up_in_cabinet(self):
        self.track(self.slug, 'SCAN', table=2)
        self.track(self.slug, 'SCAN', table=2)
        tables = {t['number']: t for t in self.client.get('/api/cabinet/tables/', **self.auth).json()['tables']}
        self.assertEqual(tables[2]['scans'], 2)
        self.assertIsNotNone(tables[2]['last_scan_at'])
        self.assertEqual(tables[1]['scans'], 0)


# ─────────────────────────────  лимиты тарифов  ─────────────────────────────

class TestPlanLimits(SaasBase):
    def setUp(self):
        super().setUp()
        self.auth, self.slug, self.account = self.new_venue(tables=3)

    def test_tables_limit(self):
        r = self.client.post('/api/cabinet/tables/', {'tables': 10}, format='json', **self.auth)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(len(r.json()['created']), TRIAL['tables'] - 3)
        self.assertEqual(r.json()['skipped_over_limit'], 10 - (TRIAL['tables'] - 3))
        self.assertEqual(self.account.venue.qrcodes.count(), TRIAL['tables'])

        full = self.client.post('/api/cabinet/tables/', {'tables': 1}, format='json', **self.auth)
        self.assertEqual(full.status_code, 402)
        self.assertEqual(full.json()['limit'], TRIAL['tables'])
        self.assertEqual(self.account.venue.qrcodes.count(), TRIAL['tables'])

    def test_tables_limit_grows_with_plan(self):
        self.client.post('/api/cabinet/tables/', {'tables': 10}, format='json', **self.auth)
        self.upgrade(self.account, 'START')
        r = self.client.post('/api/cabinet/tables/', {'tables': 100}, format='json', **self.auth)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(self.account.venue.qrcodes.count(), START['tables'])

    def test_items_limit(self):
        rows = [{'kind': 'BEER', 'ref_slug': f'beer-{i}', 'price': 1000 + i} for i in range(TRIAL['items'] + 5)]
        r = self.post_menu(self.auth, {'items': rows})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['saved'], TRIAL['items'])
        self.assertEqual(r.json()['skipped_over_limit'], 5)
        self.assertEqual(VenueMenuItem.objects.filter(venue=self.account.venue).count(), TRIAL['items'])

        # на лимите: новую позицию не добавить, существующую — править можно (иначе стоп-лист перестанет работать)
        extra = self.post_menu(self.auth, {'kind': 'DISH', 'ref_slug': 'one-more'})
        self.assertEqual(extra.json()['saved'], 0)
        self.assertEqual(extra.json()['skipped_over_limit'], 1)
        edit = self.post_menu(self.auth, {'kind': 'BEER', 'ref_slug': 'beer-0', 'is_available': False})
        self.assertEqual(edit.json()['saved'], 1)
        self.assertEqual(VenueMenuItem.objects.filter(venue=self.account.venue).count(), TRIAL['items'])

        # удалили позицию — место освободилось
        victim = VenueMenuItem.objects.get(ref_slug='beer-1')
        self.client.delete(f'/api/cabinet/menu/{victim.id}/', **self.auth)
        self.assertEqual(self.post_menu(self.auth, {'kind': 'DISH', 'ref_slug': 'one-more'}).json()['saved'], 1)

    def test_items_limit_counts_repeats_in_one_request_once(self):
        rows = [{'kind': 'BEER', 'ref_slug': 'same', 'price': i} for i in range(TRIAL['items'] + 5)]
        r = self.post_menu(self.auth, {'items': rows})
        self.assertEqual(r.json()['skipped_over_limit'], 0)
        self.assertEqual(VenueMenuItem.objects.count(), 1)

    def test_history_window_is_capped_by_plan(self):
        self.assertEqual(self.client.get('/api/cabinet/stats/?days=365', **self.auth).json()['days'], TRIAL['history_days'])
        self.assertEqual(self.client.get('/api/cabinet/stats/?days=0', **self.auth).json()['days'], 1)
        self.assertEqual(self.client.get('/api/cabinet/stats/?days=abc', **self.auth).json()['days'], TRIAL['history_days'])
        self.upgrade(self.account, 'START')
        self.assertEqual(self.client.get('/api/cabinet/stats/?days=365', **self.auth).json()['days'], START['history_days'])
        self.assertEqual(self.client.get('/api/cabinet/stats/?days=30', **self.auth).json()['days'], 30)

    def test_branding_is_locked_on_trial_and_open_on_paid_plan(self):
        custom = {'accent': '#112233', 'logo': 'https://example.com/logo.png', 'cover_url': 'https://example.com/c.jpg'}
        r = self.client.patch('/api/cabinet/venue/', custom, format='json', **self.auth)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()['branding_locked'])
        public = self.client.get(f'/api/menu/{self.slug}/').json()['venue']
        self.assertEqual(public['accent'], '#F7941D')
        self.assertEqual(public['logo'], '')
        self.assertFalse(public['branding'])

        self.upgrade(self.account, 'START')
        r = self.client.patch('/api/cabinet/venue/', custom, format='json', **self.auth)
        self.assertFalse(r.json()['branding_locked'])
        public = self.client.get(f'/api/menu/{self.slug}/').json()['venue']
        self.assertEqual(public['accent'], '#112233')
        self.assertEqual(public['logo'], 'https://example.com/logo.png')
        self.assertTrue(public['branding'])

        # мусор вместо цвета не принимается — иначе он попадёт в style гостевой страницы
        for bad in ('red', '#12345', '#1122334', 'url(javascript:1)', '#11223g'):
            self.client.patch('/api/cabinet/venue/', {'accent': bad}, format='json', **self.auth)
            self.assertEqual(Venue.objects.get(slug=self.slug).accent, '#112233', bad)

    def test_plan_payload_follows_subscription(self):
        self.upgrade(self.account, 'PRO', days=10)
        body = self.client.get('/api/cabinet/overview/', **self.auth).json()
        self.assertEqual(body['plan'], 'PRO')
        self.assertEqual(body['limits'], VenueAccount.PLAN_LIMITS['PRO'])
        self.assertTrue(body['active'])
        self.assertIn(body['days_left'], (9, 10))

        self.upgrade(self.account, 'PRO', days=-1)  # оплата кончилась
        body = self.client.get('/api/cabinet/overview/', **self.auth).json()
        self.assertFalse(body['active'])
        self.assertEqual(body['days_left'], 0)
        self.assertEqual(self.client.get(f'/api/menu/{self.slug}/').status_code, 402)


# ───────────────────────────  трекинг и аналитика  ──────────────────────────

class TestTrackAndStats(SaasBase):
    def setUp(self):
        super().setUp()
        self.auth, self.slug, self.account = self.new_venue(tables=3)

    def stats(self, query=''):
        r = self.client.get(f'/api/cabinet/stats/{query}', **self.auth)
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    def test_empty_stats(self):
        s = self.stats()
        self.assertEqual((s['scans'], s['guests'], s['pair_views'], s['order_intents']), (0, 0, 0, 0))
        self.assertEqual(s['conversion'], 0.0)
        self.assertEqual(s['revenue_intent_kzt'], 0.0)
        self.assertEqual(s['avg_check_add_kzt'], 0.0)
        self.assertEqual(len(s['series']), s['days'])
        self.assertEqual((s['top_dishes'], s['top_beers'], s['top_pairs']), ([], [], []))

    def test_events_change_stats(self):
        before = self.stats()
        self.assertEqual(self.track(self.slug, 'SCAN', table=1, session='guest-1').status_code, 200)
        self.track(self.slug, 'SCAN', table=1, session='guest-1')  # тот же гость ещё раз
        self.track(self.slug, 'SCAN', table=2, session='guest-2')
        self.track(self.slug, 'SCAN', session='')                   # скан без стола и сессии
        self.track(self.slug, 'DISH_VIEW', dish='kazy', session='guest-1')
        self.track(self.slug, 'PAIR_VIEW', dish='kazy', beer='efes', score=91)
        self.track(self.slug, 'PAIR_VIEW', dish='manty', beer='kozel', score=77)
        self.track(self.slug, 'BEER_VIEW', beer='efes')
        self.track(self.slug, 'ORDER_INTENT', dish='kazy', beer='efes', price=1200, table=1)
        self.track(self.slug, 'ORDER_INTENT', dish='kazy', beer='efes', price='1300.50', table=2)
        self.track(self.slug, 'ORDER_INTENT', dish='manty', beer='kozel', price=1000)

        s = self.stats()
        self.assertEqual(before['scans'], 0)
        self.assertEqual(s['scans'], 4)
        self.assertEqual(s['guests'], 2)
        self.assertEqual(s['pair_views'], 2)
        self.assertEqual(s['order_intents'], 3)
        self.assertEqual(s['conversion'], 75.0)
        self.assertEqual(s['revenue_intent_kzt'], 3500.5)
        self.assertAlmostEqual(s['avg_check_add_kzt'], 3500.5 / 3, places=2)
        self.assertEqual(s['series'][-1], {'date': timezone.localdate().isoformat(), 'scans': 4})
        self.assertEqual(sum(d['scans'] for d in s['series']), 4)
        self.assertEqual(s['top_dishes'][0], {'slug': 'kazy', 'count': 2})
        self.assertEqual(s['top_beers'][0], {'slug': 'efes', 'count': 2})
        self.assertEqual(s['top_pairs'][0], {'dish': 'kazy', 'beer': 'efes', 'count': 2})
        self.assertEqual({t['number']: t['scans'] for t in s['tables']}, {1: 2, 2: 1, 3: 0})
        self.assertEqual(s['tables'][0]['number'], 1)  # самый сканируемый стол — первым

        event = MenuEvent.objects.get(kind='PAIR_VIEW', dish_slug='kazy')
        self.assertEqual(event.score, 91)
        scan = ScanEvent.objects.filter(table_number=2).get()
        self.assertEqual(scan.qrcode, self.account.venue.qrcodes.get(table_number=2))
        self.assertEqual(scan.session_key, 'guest-2')

    def test_scan_of_unknown_table_is_counted_without_qr(self):
        self.assertEqual(self.track(self.slug, 'SCAN', table=99).status_code, 200)
        scan = ScanEvent.objects.get()
        self.assertIsNone(scan.qrcode)
        self.assertEqual(scan.table_number, 99)
        self.assertEqual(sum(self.account.venue.qrcodes.values_list('scans_count', flat=True)), 0)

    def test_events_outside_the_window_are_not_counted(self):
        self.track(self.slug, 'SCAN', table=1)
        self.track(self.slug, 'ORDER_INTENT', beer='efes', dish='kazy', price=1200)
        old = timezone.now() - timedelta(days=TRIAL['history_days'] + 6)
        ScanEvent.objects.update(created_at=old)
        MenuEvent.objects.update(created_at=old)
        self.track(self.slug, 'SCAN', table=1)

        s = self.stats('?days=365')
        self.assertEqual(s['scans'], 1)
        self.assertEqual(s['order_intents'], 0)
        self.assertEqual(s['revenue_intent_kzt'], 0.0)

    def test_unknown_kind_is_400_and_unknown_venue_is_ignored(self):
        self.assertEqual(self.track(self.slug, 'HACK').status_code, 400)
        self.assertEqual(self.track(self.slug, '').status_code, 400)
        self.assertEqual(self.track('no-such-bar', 'SCAN').status_code, 204)
        self.assertFalse(ScanEvent.objects.exists())
        self.assertFalse(MenuEvent.objects.exists())

    def test_long_strings_are_truncated(self):
        self.assertEqual(self.track(self.slug, 'SCAN', session='s' * 500).status_code, 200)
        self.assertEqual(len(ScanEvent.objects.get().session_key), 64)
        self.assertEqual(self.track(self.slug, 'DISH_VIEW', dish='d' * 500).status_code, 200)
        self.assertEqual(len(MenuEvent.objects.get().dish_slug), 80)

    def test_track_is_public(self):
        """Гость не авторизован — событие принимается без токена, а чужой токен ничего не меняет."""
        self.assertEqual(self.track(self.slug, 'SCAN').status_code, 200)
        r = self.client.post('/api/track/', {'venue': self.slug, 'kind': 'SCAN'}, format='json', **bearer('junk'))
        self.assertEqual(r.status_code, 200)





# ────────────────────────────────  заявки  ──────────────────────────────────

class TestLeadCreate(SaasBase):
    def post(self, **data):
        return self.client.post('/api/leads/', data, format='json')

    def test_valid_lead(self):
        r = self.post(venue_name=' Hop House ', phone=' +7 000 000 00 00 ', contact_name='Айгерим', email='a@example.com',
                      city='Алматы', tables='12', plan='PRO', comment='Перезвоните после 15:00', source='business')
        self.assertEqual(r.status_code, 201, r.content)
        self.assertTrue(r.json()['ok'])
        lead = Lead.objects.get(pk=r.json()['id'])
        self.assertEqual((lead.venue_name, lead.phone), ('Hop House', '+7 000 000 00 00'))
        self.assertEqual((lead.contact_name, lead.city, lead.tables, lead.plan_interest), ('Айгерим', 'Алматы', 12, 'PRO'))
        self.assertEqual((lead.source, lead.status), ('business', 'NEW'))

    def test_minimal_lead_gets_defaults(self):
        self.assertEqual(self.post(venue_name='Hop House', phone='1').status_code, 201)
        lead = Lead.objects.get()
        self.assertEqual((lead.source, lead.tables, lead.email, lead.status), ('landing', None, '', 'NEW'))

    def test_venue_name_and_phone_are_required(self):
        for data in ({}, {'venue_name': 'Hop House'}, {'phone': '+7 000'}, {'venue_name': '   ', 'phone': '+7 000'},
                     {'venue_name': 'Hop House', 'phone': '   '}, {'venue_name': None, 'phone': None}):
            with self.subTest(data):
                r = self.post(**data)
                self.assertEqual(r.status_code, 400)
                self.assertIn('detail', r.json())
        self.assertFalse(Lead.objects.exists())

    def test_client_cannot_set_status_and_long_values_are_truncated(self):
        self.post(venue_name='x' * 500, phone='9' * 100, status='WON', tables='много', comment='c' * 5000)
        lead = Lead.objects.get()
        self.assertEqual(lead.status, 'NEW')
        self.assertEqual((len(lead.venue_name), len(lead.phone), len(lead.comment)), (200, 40, 2000))
        self.assertIsNone(lead.tables)




# ────────────────────────  изоляция заведений друг от друга  ────────────────

class TestIsolation(SaasBase):
    """Токен кабинета A не должен ни читать, ни менять меню, столы и аналитику B."""

    def setUp(self):
        super().setUp()
        self.a, self.slug_a, self.acc_a = self.new_venue('a@example.com', 'Alpha Bar', tables=2)
        self.b, self.slug_b, self.acc_b = self.new_venue('b@example.com', 'Bravo Pub', tables=3)
        self.post_menu(self.a, [{'kind': 'BEER', 'ref_slug': 'efes', 'price': 1000},
                                {'kind': 'DISH', 'ref_slug': 'a-only', 'price': 2000}])
        self.post_menu(self.b, [{'kind': 'BEER', 'ref_slug': 'efes', 'price': 7777, 'name': 'Bravo Efes'},
                                {'kind': 'DISH', 'ref_slug': 'b-only', 'price': 9999}])
        for _ in range(3):
            self.track(self.slug_b, 'SCAN', table=1, session='b-guest')
        self.track(self.slug_b, 'ORDER_INTENT', beer='efes', dish='b-only', price=7777)

    def b_item(self, ref_slug='efes'):
        return VenueMenuItem.objects.get(venue=self.acc_b.venue, ref_slug=ref_slug)

    def test_menu_read_is_scoped(self):
        text = self.client.get('/api/cabinet/menu/', **self.a).content.decode()
        self.assertNotIn('b-only', text)
        self.assertNotIn('Bravo Efes', text)
        self.assertNotIn('7777', text)
        menu = self.client.get('/api/cabinet/menu/', **self.a).json()
        self.assertEqual(menu['used'], 2)
        self.assertEqual([i['ref_slug'] for i in menu['dishes']], ['a-only'])

    def test_menu_write_never_touches_other_venue(self):
        before = self.b_item()
        # тот же (kind, ref_slug), что и у B, плюс попытки «подсказать» чужие id / venue
        r = self.post_menu(self.a, {'kind': 'BEER', 'ref_slug': 'efes', 'price': 1, 'is_available': False, 'name': 'Hacked',
                                    'id': str(before.id), 'venue': self.slug_b, 'venue_id': str(self.acc_b.venue.id)})
        self.assertEqual(r.status_code, 200)
        self.assertNotEqual(r.json()['items'][0]['id'], str(before.id))

        after = self.b_item()
        self.assertEqual((float(after.price), after.is_available, after.custom_name), (7777.0, True, 'Bravo Efes'))
        self.assertEqual(VenueMenuItem.objects.filter(venue=self.acc_b.venue).count(), 2)
        self.assertEqual(self.public_slugs(self.slug_b), (['efes'], ['b-only']))   # стоп-лист A не спрятал пиво у B
        self.assertEqual(self.public_slugs(self.slug_a), ([], ['a-only']))

    def test_menu_delete_of_foreign_item_is_404(self):
        item = self.b_item('b-only')
        self.assertEqual(self.client.delete(f'/api/cabinet/menu/{item.id}/', **self.a).status_code, 404)
        self.assertTrue(VenueMenuItem.objects.filter(pk=item.pk).exists())
        self.assertEqual(self.client.delete(f'/api/cabinet/menu/{item.id}/', **self.b).status_code, 200)  # владелец — может

    def test_tables_read_is_scoped(self):
        tables = self.client.get('/api/cabinet/tables/', **self.a).json()['tables']
        self.assertEqual(len(tables), 2)
        b_tokens = set(self.acc_b.venue.qrcodes.values_list('unique_token', flat=True))
        b_ids = {str(i) for i in self.acc_b.venue.qrcodes.values_list('id', flat=True)}
        self.assertFalse(b_tokens & {t['token'] for t in tables})
        self.assertFalse(b_ids & {t['id'] for t in tables})
        self.assertTrue(all(t['scans'] == 0 for t in tables))  # сканы B не видны в A

    def test_tables_write_never_touches_other_venue(self):
        table = self.acc_b.venue.qrcodes.get(table_number=1)
        self.assertEqual(self.client.delete(f'/api/cabinet/tables/{table.id}/', **self.a).status_code, 404)
        self.assertTrue(QRCode.objects.filter(pk=table.pk).exists())

        r = self.client.post('/api/cabinet/tables/', {'tables': 1, 'venue': self.slug_b,
                                                     'venue_id': str(self.acc_b.venue.id)}, format='json', **self.a)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(self.acc_b.venue.qrcodes.count(), 3)
        self.assertEqual(self.acc_a.venue.qrcodes.count(), 3)

    def test_table_limit_is_counted_per_venue(self):
        """B упёрся в лимит — A это не мешает."""
        self.client.post('/api/cabinet/tables/', {'tables': 50}, format='json', **self.b)
        self.assertEqual(self.client.post('/api/cabinet/tables/', {'tables': 1}, format='json', **self.b).status_code, 402)
        self.assertEqual(self.client.post('/api/cabinet/tables/', {'tables': 1}, format='json', **self.a).status_code, 201)

    def test_stats_and_overview_are_scoped(self):
        s = self.client.get('/api/cabinet/stats/', **self.a).json()
        self.assertEqual((s['scans'], s['guests'], s['order_intents'], s['revenue_intent_kzt']), (0, 0, 0, 0.0))
        self.assertEqual((s['top_beers'], s['top_pairs'], s['top_dishes']), ([], [], []))
        self.assertEqual(len(s['tables']), 2)
        self.assertNotIn('b-only', self.client.get('/api/cabinet/stats/', **self.a).content.decode())

        summary = self.client.get('/api/cabinet/overview/', **self.a).json()
        self.assertEqual(summary['summary'], {'items': 2, 'items_available': 2, 'tables': 2,
                                              'scans_30d': 0, 'order_intents_30d': 0})
        self.assertEqual(summary['venue']['slug'], self.slug_a)
        self.assertEqual(summary['email'], 'a@example.com')

        # у B при этом всё на месте
        sb = self.client.get('/api/cabinet/stats/', **self.b).json()
        self.assertEqual((sb['scans'], sb['guests'], sb['order_intents'], sb['revenue_intent_kzt']), (3, 1, 1, 7777.0))

    def test_stats_cannot_be_redirected_by_query_params(self):
        for query in (f'?venue={self.slug_b}', f'?slug={self.slug_b}', f'?venue_id={self.acc_b.venue.id}'):
            with self.subTest(query):
                self.assertEqual(self.client.get(f'/api/cabinet/stats/{query}', **self.a).json()['scans'], 0)
                self.assertEqual(self.client.get(f'/api/cabinet/menu/{query}', **self.a).json()['used'], 2)

    def test_track_with_same_table_number_hits_only_its_venue(self):
        self.track(self.slug_a, 'SCAN', table=1)
        self.assertEqual(self.acc_a.venue.qrcodes.get(table_number=1).scans_count, 1)
        self.assertEqual(self.acc_b.venue.qrcodes.get(table_number=1).scans_count, 3)

    def test_venue_update_is_scoped(self):
        self.client.patch('/api/cabinet/venue/', {'name': 'Renamed', 'slug': self.slug_b, 'wifi_password': 'a-wifi'},
                          format='json', **self.a)
        venue_b = Venue.objects.get(pk=self.acc_b.venue.pk)
        self.assertEqual((venue_b.name, venue_b.slug, venue_b.wifi_password), ('Bravo Pub', self.slug_b, ''))
        self.assertEqual(Venue.objects.get(pk=self.acc_a.venue.pk).slug, self.slug_a)

    def test_token_in_query_string_is_scoped_too(self):
        menu = self.client.get(f'/api/cabinet/menu/?token={self.acc_a.api_token}').json()
        self.assertEqual([i['ref_slug'] for i in menu['dishes']], ['a-only'])

    def test_header_token_wins_over_query_token(self):
        """Чужой ?token= в ссылке не должен подменять личность того, кто пришёл со своим заголовком."""
        menu = self.client.get(f'/api/cabinet/menu/?token={self.acc_b.api_token}', **self.a).json()
        self.assertEqual([i['ref_slug'] for i in menu['dishes']], ['a-only'])

    def test_upgrade_of_one_venue_does_not_unlock_another(self):
        self.upgrade(self.acc_b, 'PRO')
        r = self.client.patch('/api/cabinet/venue/', {'accent': '#000000'}, format='json', **self.a)
        self.assertTrue(r.json()['branding_locked'])
        self.assertEqual(self.client.get('/api/cabinet/overview/', **self.a).json()['plan'], 'TRIAL')

# ═══════════════════════════════════════════════════════════════════════════
#  НАЙДЕННЫЕ ОШИБКИ api/views_saas.py
#  Каждый тест ниже описывает ПРАВИЛЬНОЕ поведение и сейчас падает — поэтому
#  @expectedFailure. Файл views_saas.py этим набором не правился намеренно.
#  После исправления тест станет «unexpected success»: снимите декоратор,
#  и тест останется обычной регрессионной проверкой.
# ═══════════════════════════════════════════════════════════════════════════

class TestKnownBugs(SaasBase):
    def setUp(self):
        super().setUp()
        self.auth, self.slug, self.account = self.new_venue(tables=2)

    @expectedFailure
    def test_BUG_register_ignores_trial_table_limit(self):
        """БАГ: cabinet_register создаёт столько столов, сколько попросили (до 200), хотя на TRIAL лимит 5.

        Обход лимита тарифа без оплаты: POST /cabinet/tables/ лимит соблюдает, регистрация — нет.
        """
        _, _, account = self.new_venue('big@example.com', 'Big Bar', tables=50)
        self.assertLessEqual(account.venue.qrcodes.count(), TRIAL['tables'])

    @expectedFailure
    def test_BUG_register_accepts_invalid_email(self):
        """БАГ: e-mail не проверяется — в базу попадает адрес, на который нельзя написать (счёт, сброс пароля)."""
        self.assertEqual(self.register(email='not-an-email', venue_name='Typo Bar').status_code, 400)

    @expectedFailure
    def test_BUG_track_without_venue_lands_on_slugless_venue(self):
        """БАГ: нет поля venue → filter(slug=None) → Django ищет slug IS NULL и находит заведение без slug.

        События анонимно пишутся в чужую статистику (у заведений из админки slug может быть пустым).
        """
        legacy = Venue.objects.create(name='Legacy', address='—', venue_type='BAR', slug=None)
        self.client.post('/api/track/', {'kind': 'SCAN'}, format='json')
        self.client.post('/api/track/', {'kind': 'ORDER_INTENT', 'price': 5000}, format='json')
        self.assertEqual(legacy.scan_events.count() + legacy.menu_events.count(), 0)

    @expectedFailure
    def test_BUG_negative_menu_price_is_accepted(self):
        """БАГ: цена -500 сохраняется и уходит гостю в меню."""
        r = self.post_menu(self.auth, {'kind': 'BEER', 'ref_slug': 'efes', 'price': -500})
        self.assertGreaterEqual(r.json()['items'][0]['price'], 0)

    @expectedFailure
    def test_BUG_negative_track_price_lowers_revenue(self):
        """БАГ: любой аноним может увести «эффект в ₸» в минус событием с отрицательной ценой."""
        self.track(self.slug, 'ORDER_INTENT', beer='efes', price=1200)
        self.track(self.slug, 'ORDER_INTENT', beer='efes', price=-100000)
        stats = self.client.get('/api/cabinet/stats/', **self.auth).json()
        self.assertGreaterEqual(stats['revenue_intent_kzt'], 1200.0)

    @expectedFailure
    def test_BUG_superscript_digit_is_500(self):
        """БАГ: проверка str.isdigit() перед int(): '²'.isdigit() → True, int('²') → ValueError → 500.

        Шесть мест, три из них публичные (track, leads, menu).
        """
        calls = [
            lambda: self.track(self.slug, 'SCAN', table='²'),
            lambda: self.client.post('/api/leads/', {'venue_name': 'Hop House', 'phone': '1', 'tables': '²'}, format='json'),
            lambda: self.client.get(f'/api/menu/{self.slug}/?table=²'),
            lambda: self.register(email='sup@example.com', venue_name='Sup Bar', tables='²'),
            lambda: self.client.post('/api/cabinet/tables/', {'tables': '²'}, format='json', **self.auth),
            lambda: self.client.get('/api/cabinet/stats/?days=²', **self.auth),
        ]
        for i, call in enumerate(calls):
            self.assertLess(call().status_code, 500, f'вызов №{i + 1}')

    @expectedFailure
    def test_BUG_huge_integer_is_500(self):
        """БАГ: 10**20 проходит isdigit(), но не помещается в IntegerField → OverflowError (SQLite) / DataError (PostgreSQL)."""
        big = str(10 ** 20)
        calls = [
            lambda: self.track(self.slug, 'SCAN', table=big),
            lambda: self.track(self.slug, 'PAIR_VIEW', score=big),
            lambda: self.client.post('/api/leads/', {'venue_name': 'Hop House', 'phone': '1', 'tables': big}, format='json'),
            lambda: self.post_menu(self.auth, {'kind': 'BEER', 'ref_slug': 'kozel', 'sort_order': 10 ** 20}),
        ]
        for i, call in enumerate(calls):
            self.assertLess(call().status_code, 500, f'вызов №{i + 1}')

    @expectedFailure
    def test_BUG_huge_price_is_500(self):
        """БАГ: цена длиннее DecimalField(max_digits=10) проходит _dec() и падает в save() с decimal.InvalidOperation."""
        self.assertLess(self.track(self.slug, 'ORDER_INTENT', price='1e12').status_code, 500)
        self.assertLess(self.post_menu(self.auth, {'kind': 'BEER', 'ref_slug': 'efes', 'price': 99999999999}).status_code, 500)

    @expectedFailure
    def test_BUG_non_object_json_is_500(self):
        """БАГ: JSON-массив вместо объекта → 'list'.get(...) → AttributeError → 500. Первые четыре адреса публичные."""
        for url in ('/api/leads/', '/api/track/', '/api/cabinet/register/', '/api/cabinet/login/'):
            self.assertLess(self.client.post(url, ['x'], format='json').status_code, 500, url)
        self.assertLess(self.client.post('/api/cabinet/tables/', ['x'], format='json', **self.auth).status_code, 500)
        self.assertLess(self.client.patch('/api/cabinet/venue/', ['x'], format='json', **self.auth).status_code, 500)
        self.assertLess(self.post_menu(self.auth, ['efes']).status_code, 500)  # строка вместо объекта-позиции

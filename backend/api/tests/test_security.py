"""
Защита публичного сервера: лимиты запросов, демо-пароли, срок жизни токена, логин владельца
заведения, health, снимок базы при холодном старте, фото в базе (media_db), настройки по умолчанию.
"""
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth.models import Group, User
from django.contrib.contenttypes.models import ContentType
from django.core.cache import cache
from django.core.exceptions import SuspiciousFileOperation
from django.core.management import CommandError, call_command
from django.http import Http404
from django.test import RequestFactory, TestCase, override_settings
from django.urls import resolve, reverse
from django.utils import timezone
from rest_framework.authtoken.models import Token

from api import ai_sommelier
from api.demo_accounts import secure_public_passwords
from api.models import Order, Venue
from media_db.models import StoredFile
from media_db.views import serve_media
from .helpers import PASSWORD, client_for, make_brand, make_dish, make_menu_item, make_user, make_venue
from .test_uploads import png_bytes, upload

BACKEND_DIR = Path(settings.BASE_DIR)
DEMO_NAMES = ['guest', 'moderator', 'restaurant', 'sommelier']
NO_DEMO_ENV = {'FT_PASSWORD_' + name.upper(): '' for name in DEMO_NAMES}


def with_rates(**rates):
    """Лимиты как на сервере (в тестах вход и заказы по умолчанию не ограничены)."""
    return override_settings(REST_FRAMEWORK={
        **settings.REST_FRAMEWORK,
        'DEFAULT_THROTTLE_RATES': {**settings.REST_FRAMEWORK['DEFAULT_THROTTLE_RATES'], **rates},
    })


class ThrottleTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def test_login_limited_per_ip(self):
        make_user('somm')
        client = client_for()
        with with_rates(login='3/min'):
            codes = [client.post('/api/auth/login/', {'username': 'somm', 'password': 'nope'}, format='json').status_code
                     for _ in range(4)]
        self.assertEqual(codes, [400, 400, 400, 429])

    def test_register_limited_per_ip(self):
        client = client_for()
        with with_rates(register='1/hour'):
            first = client.post('/api/auth/register/', {
                'username': 'new1', 'email': 'new1@example.kz', 'password': 'another-secret-456'}, format='json')
            second = client.post('/api/auth/register/', {
                'username': 'new2', 'email': 'new2@example.kz', 'password': 'another-secret-456'}, format='json')
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(second.status_code, 429)

    def test_order_create_limited_but_panel_polling_is_not(self):
        owner = make_user('rest', role='restaurant_admin')
        venue = make_venue(owner=owner, tables_count=10)
        item = make_menu_item(venue, make_dish('Бешбармак'), price='4500')
        body = {'venue': venue.slug, 'table_number': 3, 'items': [{'kind': 'DISH', 'id': str(item.id), 'qty': 1}]}
        with with_rates(orders='2/hour'):
            codes = [client_for().post('/api/orders/', body, format='json').status_code for _ in range(3)]
            polls = [client_for(owner).get('/api/orders/new-count/').status_code for _ in range(5)]
        self.assertEqual(codes, [201, 201, 429])
        self.assertEqual(polls, [200] * 5)

    def test_no_limits_without_rates(self):
        # На своей машине и в тестах лимита на вход нет: только ИИ ограничен всегда.
        self.assertNotIn('login', settings.REST_FRAMEWORK['DEFAULT_THROTTLE_RATES'])
        make_user('somm')
        client = client_for()
        codes = {client.post('/api/auth/login/', {'username': 'somm', 'password': 'nope'}, format='json').status_code
                 for _ in range(12)}
        self.assertEqual(codes, {400})

    def test_broken_cache_does_not_block_login(self):
        make_user('somm')
        with with_rates(login='3/min'), patch('rest_framework.throttling.SimpleRateThrottle.cache') as broken, \
                self.assertLogs('api.throttles', level='ERROR'):
            broken.get.side_effect = RuntimeError('cache down')
            resp = client_for().post('/api/auth/login/', {'username': 'somm', 'password': PASSWORD}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_order_comment_length_capped(self):
        venue = make_venue(tables_count=10)
        item = make_menu_item(venue, make_dish('Бешбармак'), price='4500')
        resp = client_for().post('/api/orders/', {
            'venue': venue.slug, 'table_number': 3, 'comment': 'а' * 501,
            'items': [{'kind': 'DISH', 'id': str(item.id), 'qty': 1}],
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('comment', resp.json())


class TokenTests(TestCase):
    def setUp(self):
        self.user = make_user('rest', role='restaurant_admin')

    def test_expired_token_rejected_and_login_issues_new(self):
        token = Token.objects.create(user=self.user)
        Token.objects.filter(pk=token.pk).update(created=timezone.now() - timedelta(days=settings.FT_TOKEN_TTL_DAYS + 1))
        client = client_for()
        client.credentials(HTTP_AUTHORIZATION='Token ' + token.key)
        resp = client.get('/api/auth/me/')
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.json()['detail'], 'Сессия истекла, войдите снова')

        login = client_for().post('/api/auth/login/', {'username': 'rest', 'password': PASSWORD}, format='json')
        self.assertEqual(login.status_code, 200)
        self.assertNotEqual(login.json()['token'], token.key)
        fresh = client_for()
        fresh.credentials(HTTP_AUTHORIZATION='Token ' + login.json()['token'])
        self.assertEqual(fresh.get('/api/auth/me/').status_code, 200)

    def test_two_devices_share_token_until_logout_everywhere(self):
        first = client_for().post('/api/auth/login/', {'username': 'rest', 'password': PASSWORD}, format='json').json()
        second = client_for().post('/api/auth/login/', {'username': 'rest', 'password': PASSWORD}, format='json').json()
        tablet = client_for()
        tablet.credentials(HTTP_AUTHORIZATION='Token ' + first['token'])
        phone = client_for()
        phone.credentials(HTTP_AUTHORIZATION='Token ' + second['token'])
        # Выход на телефоне не выкидывает планшет бара.
        self.assertEqual(phone.post('/api/auth/logout/').status_code, 204)
        self.assertEqual(tablet.get('/api/orders/new-count/').status_code, 200)
        self.assertEqual(phone.post('/api/auth/logout/', {'everywhere': True}, format='json').status_code, 204)
        self.assertEqual(tablet.get('/api/orders/new-count/').status_code, 401)


class VenueOwnerPrivacyTests(TestCase):
    def setUp(self):
        self.owner = make_user('rest', role='restaurant_admin')
        self.mod = make_user('mod', role='moderator')
        self.venue = make_venue(owner=self.owner)

    def test_owner_login_hidden_from_public(self):
        url = f'/api/venues/{self.venue.slug}/'
        self.assertNotIn('owner', client_for().get(url).json())
        self.assertNotIn('owner', client_for().get('/api/venues/').json()[0])
        self.assertNotIn('owner', client_for(make_user('other')).get(url).json())
        self.assertNotIn('owner', client_for().get(url + 'menu/').json()['venue'])
        self.assertEqual(client_for(self.owner).get(url).json()['owner'], {'id': self.owner.id, 'username': 'rest'})
        self.assertEqual(client_for(self.mod).get('/api/venues/').json()[0]['owner']['username'], 'rest')
        self.assertEqual(client_for(self.owner).get('/api/venues/mine/').json()[0]['owner']['username'], 'rest')


class HealthAndSeedTests(TestCase):
    def test_health_checks_database(self):
        resp = client_for().get('/api/health/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {'ok': True, 'db': True})
        self.assertEqual(resp['Cache-Control'], 'no-store')
        self.assertEqual(client_for().head('/api/health/').status_code, 200)

    def test_health_reports_database_failure(self):
        # assertLogs забирает запись django.request об ответе 5xx себе (письмо админам в тестах не нужно).
        with patch('django.db.backends.base.base.BaseDatabaseWrapper.cursor', side_effect=RuntimeError('db down')), \
                self.assertLogs('django.request', level='ERROR'):
            resp = client_for().get('/api/health/')
        self.assertEqual(resp.status_code, 503)
        self.assertEqual(resp.json(), {'ok': False, 'db': False})

    def test_seed_endpoint_disabled_on_server(self):
        mod = make_user('mod', role='moderator')
        with patch('django.core.management.call_command') as called:
            resp = client_for(mod).post('/api/seed/')
        self.assertEqual(resp.status_code, 403)
        called.assert_not_called()

    def test_seed_command_refuses_working_database(self):
        make_venue()
        make_brand('Efes Pilsener')
        with self.assertRaises(CommandError):
            call_command('seed', stdout=io.StringIO())
        self.assertTrue(Venue.objects.exists())

    def test_ai_request_fits_function_limit(self):
        # Запрос к модели с повтором не должен пережить лимит функции Vercel (10 с без Fluid compute).
        self.assertEqual(ai_sommelier.MAX_RETRIES, 0)
        self.assertLess(ai_sommelier.REQUEST_TIMEOUT, 10)


@patch.dict(os.environ, NO_DEMO_ENV)
class DemoPasswordTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def demo_user(self, username, password):
        user = User.objects.create_user(username=username, password=password)
        Token.objects.create(user=user)
        return user

    def test_seed_roles_on_server_closes_password_login(self):
        # В тестах DEBUG выключен, как на сервере: публичный пароль не ставится.
        call_command('seed_roles', stdout=io.StringIO())
        moderator = User.objects.get(username='moderator')
        self.assertFalse(moderator.has_usable_password())
        resp = client_for().post('/api/auth/login/', {'username': 'moderator', 'password': 'moderator12345'}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_seed_roles_takes_password_from_env_and_keeps_it(self):
        with patch.dict(os.environ, {'FT_PASSWORD_RESTAURANT': 'bar-tablet-secret-77'}):
            call_command('seed_roles', stdout=io.StringIO())
        restaurant = User.objects.get(username='restaurant')
        self.assertTrue(restaurant.check_password('bar-tablet-secret-77'))
        restaurant.set_password('changed-in-profile-88')
        restaurant.is_active = False
        restaurant.save()
        # Повторный запуск не возвращает старый пароль и не включает отключённую учётку.
        call_command('seed_roles', stdout=io.StringIO())
        restaurant.refresh_from_db()
        self.assertTrue(restaurant.check_password('changed-in-profile-88'))
        self.assertFalse(restaurant.is_active)

    @override_settings(DEBUG=True)
    def test_seed_roles_local_keeps_public_demo_passwords(self):
        # Своя машина: DEBUG и локальная база (SQLite в тестах).
        with patch.dict(os.environ, {'VERCEL': ''}):
            call_command('seed_roles', stdout=io.StringIO())
        self.assertTrue(User.objects.get(username='guest').check_password('guest12345'))

    def test_secure_public_passwords_on_cold_start(self):
        moderator = self.demo_user('moderator', 'moderator12345')
        restaurant = self.demo_user('restaurant', 'restaurant12345')
        sommelier = self.demo_user('sommelier', 'own-strong-pass-99')
        with patch.dict(os.environ, {'FT_PASSWORD_RESTAURANT': 'bar-tablet-secret-77'}), \
                self.assertLogs('api.demo_accounts', level='WARNING'):
            changed = dict(secure_public_passwords())
            # Повторный холодный старт ничего не проверяет заново: состояние запомнено.
            with patch.object(User, 'check_password') as check:
                self.assertEqual(secure_public_passwords(), [])
            check.assert_not_called()
        self.assertEqual(set(changed), {'moderator', 'restaurant'})
        moderator.refresh_from_db()
        restaurant.refresh_from_db()
        sommelier.refresh_from_db()
        self.assertFalse(moderator.has_usable_password())
        self.assertTrue(restaurant.check_password('bar-tablet-secret-77'))
        self.assertTrue(sommelier.check_password('own-strong-pass-99'))
        # Токены, выданные по публичному паролю, отозваны; чужие не тронуты.
        self.assertFalse(Token.objects.filter(user__in=[moderator, restaurant]).exists())
        self.assertTrue(Token.objects.filter(user=sommelier).exists())

        # Появилась переменная для закрытой учётки: пароль ставится из неё.
        with patch.dict(os.environ, {'FT_PASSWORD_MODERATOR': 'moderator-secret-55'}), \
                self.assertLogs('api.demo_accounts', level='WARNING'):
            self.assertEqual([name for name, _ in secure_public_passwords()], ['moderator'])
        moderator.refresh_from_db()
        self.assertTrue(moderator.check_password('moderator-secret-55'))

    def test_rotate_demo_passwords_revokes_tokens(self):
        moderator = self.demo_user('moderator', 'moderator12345')
        guest = self.demo_user('guest', 'guest12345')
        other = make_user('someone')
        Token.objects.create(user=other)
        out = io.StringIO()
        with patch.dict(os.environ, {'FT_PASSWORD_MODERATOR': 'moderator-secret-55'}):
            call_command('rotate_demo_passwords', stdout=out)
        moderator.refresh_from_db()
        guest.refresh_from_db()
        self.assertTrue(moderator.check_password('moderator-secret-55'))
        self.assertFalse(guest.check_password('guest12345'))
        self.assertTrue(guest.has_usable_password())
        self.assertIn('guest: новый пароль: ', out.getvalue())
        self.assertNotIn('moderator-secret-55', out.getvalue())
        self.assertFalse(Token.objects.filter(user__in=[moderator, guest]).exists())
        self.assertTrue(Token.objects.filter(user=other).exists())

        call_command('rotate_demo_passwords', '--users', 'guest', '--close', stdout=io.StringIO())
        guest.refresh_from_db()
        self.assertFalse(guest.has_usable_password())
        with self.assertRaises(CommandError):
            call_command('rotate_demo_passwords', '--users', 'someone', stdout=io.StringIO())


class SnapshotGuardTests(TestCase):
    def setUp(self):
        import index
        self.index = index
        # flush внутри теста пересоздаёт типы контента с новыми id: их кэш не должен пережить откат.
        self.addCleanup(ContentType.objects.clear_cache)
        self.tmp = tempfile.mkdtemp(prefix='ft-snapshot-')
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.path = Path(self.tmp) / 'snapshot.json'
        self.path.write_text(json.dumps([
            {'model': 'auth.group', 'pk': 900, 'fields': {'name': 'snapshot-group', 'permissions': []}},
        ]), encoding='utf-8')

    def test_snapshot_needs_flag(self):
        with patch.dict(os.environ, {'FT_LOAD_SNAPSHOT': ''}):
            self.assertFalse(self.index._load_snapshot(self.path))
        self.assertFalse(Group.objects.filter(name='snapshot-group').exists())

    def test_snapshot_never_overwrites_working_database(self):
        venue = make_venue()
        Order.objects.create(venue=venue, number=1, table_number=1, guest_token='t' * 48)
        with patch.dict(os.environ, {'FT_LOAD_SNAPSHOT': '1'}), self.assertLogs('flavor_tree.bootstrap', 'WARNING'):
            self.assertFalse(self.index._load_snapshot(self.path))
        self.assertEqual(Order.objects.count(), 1)
        self.assertFalse(Group.objects.filter(name='snapshot-group').exists())

    def test_snapshot_loads_into_empty_database(self):
        with patch.dict(os.environ, {'FT_LOAD_SNAPSHOT': '1'}), self.assertLogs('flavor_tree.bootstrap', 'WARNING'):
            self.assertTrue(self.index._load_snapshot(self.path))
        self.assertTrue(Group.objects.filter(name='snapshot-group').exists())

    def test_seed_order_for_empty_database(self):
        # Демо-заведению нужны блюда и сорта, поэтому seed_roles последним.
        self.assertEqual(self.index.SEED_COMMANDS, ('seed', 'load_flavor_data', 'seed_roles'))


MEDIA_TMP = tempfile.mkdtemp(prefix='ft-media-db-')
DB_STORAGES = {
    'default': {'BACKEND': 'media_db.storage.DatabaseStorage'},
    'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
}


@override_settings(MEDIA_ROOT=MEDIA_TMP, STORAGES=DB_STORAGES)
class MediaInDatabaseTests(TestCase):
    """Как на Vercel: диск только для чтения, новые фото в базе, фото из репозитория с диска."""

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA_TMP, ignore_errors=True)

    def setUp(self):
        self.owner = make_user('rest', role='restaurant_admin')
        self.venue = make_venue(owner=self.owner)
        os.makedirs(os.path.join(MEDIA_TMP, 'dishes'), exist_ok=True)
        self.bundled = os.path.join(MEDIA_TMP, 'dishes', 'bundled.png')
        with open(self.bundled, 'wb') as fh:
            fh.write(png_bytes())

    def test_logo_upload_serve_and_replace(self):
        url = f'/api/venues/{self.venue.slug}/upload-logo/'
        client = client_for(self.owner)
        resp = client.post(url, {'image': upload('logo.png')}, format='multipart')
        self.assertEqual(resp.status_code, 200, resp.content)
        row = StoredFile.objects.get()
        self.assertTrue(row.name.startswith('venues/logo_'))
        self.assertIn('/media/' + row.name, resp.json()['logo'])

        served = client_for().get('/media/' + row.name)
        self.assertEqual(served.status_code, 200)
        self.assertEqual(served['Content-Type'], 'image/png')
        self.assertIn('immutable', served['Cache-Control'])
        self.assertEqual(served.content, bytes(row.content))

        # Замена: новое имя, старая запись удалена.
        resp = client.post(url, {'image': upload('logo.png', png_bytes(color=(0, 0, 0)))}, format='multipart')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(StoredFile.objects.count(), 1)
        self.assertNotEqual(StoredFile.objects.get().name, row.name)
        with self.assertRaises(Http404):
            serve_media(RequestFactory().get('/media/' + row.name), row.name)

        resp = client.delete(url)
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(StoredFile.objects.exists())

    def test_bundled_photo_is_served_and_replace_keeps_file(self):
        dish = make_dish('Бешбармак', photo='dishes/bundled.png')
        served = client_for().get('/media/dishes/bundled.png')
        self.assertEqual(served.status_code, 200)
        self.assertEqual(served['Cache-Control'], 'public, max-age=86400, s-maxage=604800')

        # Фото из репозитория заменяется новым: файл с диска не удаляется, новое фото в базе.
        mod = make_user('mod', role='moderator')
        resp = client_for(mod).post(f'/api/dishes/{dish.id}/upload-image/', {'image': upload('dish.png')},
                                    format='multipart')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(os.path.exists(self.bundled))
        dish.refresh_from_db()
        self.assertTrue(StoredFile.objects.filter(name=dish.photo.name).exists())
        self.assertEqual(dish.photo.size, StoredFile.objects.get().size)

    def test_only_images_are_served(self):
        # Страницы 404 Django в тестах на Python 3.14 не рендерятся, поэтому view вызываем напрямую.
        self.assertEqual(resolve('/media/dishes/bundled.png').func, serve_media)
        with open(os.path.join(MEDIA_TMP, 'notes.txt'), 'w') as fh:
            fh.write('secret')
        for path in ('notes.txt', 'page.html', 'logo.svg'):
            with self.assertRaises(Http404):
                serve_media(RequestFactory().get('/media/' + path), path)
        with self.assertRaises((Http404, SuspiciousFileOperation)):
            serve_media(RequestFactory().get('/media/../settings.png'), '../settings.png')
        # Расширение в верхнем регистре (так сохраняют фото некоторые телефоны) тоже картинка.
        shutil.copy(self.bundled, os.path.join(MEDIA_TMP, 'dishes', 'PHONE.JPG'))
        self.assertEqual(serve_media(RequestFactory().get('/media/dishes/PHONE.JPG'), 'dishes/PHONE.JPG').status_code, 200)

    def test_urls_stay_reversible(self):
        # Маршрут /media/ не должен ломать reverse(): на нём держатся админка и ссылки DRF.
        self.assertEqual(reverse('admin:index'), '/admin/')
        self.assertEqual(reverse('health-check'), '/api/health/')


class SettingsDefaultsTests(TestCase):
    """Настройки читаются в отдельном процессе с окружением, как на Vercel."""

    def settings_in(self, **env):
        base = {k: v for k, v in os.environ.items() if not k.startswith(('DJANGO_', 'VERCEL', 'FT_'))}
        base.update({'DJANGO_SETTINGS_MODULE': 'flavor_tree.settings', 'DJANGO_DEBUG': '',
                     'DJANGO_SECRET_KEY': '', 'DJANGO_ALLOWED_HOSTS': ''})
        base.update(env)
        code = (
            'import json, django; from django.conf import settings; django.setup(); '
            'print(json.dumps({"debug": settings.DEBUG, "hosts": settings.ALLOWED_HOSTS, '
            '"renderers": settings.REST_FRAMEWORK.get("DEFAULT_RENDERER_CLASSES"), '
            '"cache": settings.CACHES["default"]["BACKEND"], "storage": settings.STORAGES["default"]["BACKEND"], '
            '"rates": settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"], '
            '"proxies": settings.REST_FRAMEWORK.get("NUM_PROXIES")}))'
        )
        return subprocess.run([sys.executable, '-c', code], cwd=BACKEND_DIR, env=base,
                              capture_output=True, text=True, timeout=60)

    def test_vercel_without_secret_key_refuses_to_start(self):
        result = self.settings_in(VERCEL='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('DJANGO_SECRET_KEY', result.stderr)

    def test_vercel_defaults_are_safe(self):
        result = self.settings_in(VERCEL='1', DJANGO_SECRET_KEY='x' * 50, VERCEL_URL='ft-abc.vercel.app',
                                  VERCEL_PROJECT_PRODUCTION_URL='flavor-tree-backend.vercel.app')
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertFalse(data['debug'])
        self.assertEqual(data['hosts'], ['flavor-tree-backend.vercel.app', 'ft-abc.vercel.app'])
        self.assertEqual(data['renderers'], ['rest_framework.renderers.JSONRenderer'])
        self.assertEqual(data['cache'], 'django.core.cache.backends.db.DatabaseCache')
        self.assertEqual(data['storage'], 'media_db.storage.DatabaseStorage')
        self.assertEqual(data['rates']['login'], '10/min')
        self.assertEqual(data['proxies'], 1)

    def test_gunicorn_without_debug_flag_is_production(self):
        # Не manage.py и не Vercel (например, gunicorn): DEBUG тоже выключен, ключ обязателен.
        result = self.settings_in(DJANGO_SECRET_KEY='x' * 50, DJANGO_ALLOWED_HOSTS='bar.example.kz')
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertFalse(data['debug'])
        self.assertEqual(data['hosts'], ['bar.example.kz'])
        self.assertEqual(data['storage'], 'django.core.files.storage.FileSystemStorage')

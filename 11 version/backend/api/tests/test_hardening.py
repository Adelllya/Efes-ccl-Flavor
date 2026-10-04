"""Тесты защиты: хранилище файлов, раздача media, лимиты входа, гонки и неверный ввод."""
import io
import shutil
import tempfile
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.files.storage import FileSystemStorage, default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from PIL import Image

from api.models import Brand, Dish, FoodPairing, Order, SiteSettings, StoredFile, Venue
from .helpers import (
    PASSWORD, make_user, client_for, make_brand, make_dish, make_pairing, make_venue, make_menu_item,
)

MEDIA_TMP = tempfile.mkdtemp(prefix='flavor-test-hardening-')


def png(size=(8, 8), name='dish.png', content_type='image/png'):
    buffer = io.BytesIO()
    Image.new('RGB', size, (200, 100, 30)).save(buffer, format='PNG')
    return SimpleUploadedFile(name, buffer.getvalue(), content_type=content_type)


def read_only(*args, **kwargs):
    raise OSError(30, 'Read-only file system')


@override_settings(MEDIA_ROOT=MEDIA_TMP)
class ReadOnlyDiskTests(TestCase):
    """Хостинг с диском только для чтения: загрузка уходит в базу и отдаётся тем же адресом."""

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA_TMP, ignore_errors=True)

    def setUp(self):
        self.rest = make_user('rest', role='restaurant_admin')
        self.dish = make_dish()
        self.url = f'/api/dishes/{self.dish.id}/upload-image/'

    def test_upload_falls_back_to_database_and_is_served(self):
        client = client_for(self.rest)
        with patch.object(FileSystemStorage, '_save', side_effect=read_only):
            resp = client.post(self.url, {'image': png(name='../../evil.html')}, format='multipart')
        self.assertEqual(resp.status_code, 200, resp.content)
        url = resp.data['image']
        self.assertTrue(url.startswith('http://testserver/media/dishes/'))
        # Имя файла выдаёт сервер: от клиентского не остаётся ни пути, ни расширения.
        self.assertRegex(url, r'/media/dishes/[0-9a-f]{32}\.png$')
        stored = StoredFile.objects.get()
        self.assertEqual((stored.content_type, stored.size > 0), ('image/png', True))

        served = client_for().get(url.replace('http://testserver', ''))
        self.assertEqual(served.status_code, 200)
        self.assertEqual(served['Content-Type'], 'image/png')
        self.assertEqual(served['X-Content-Type-Options'], 'nosniff')
        self.assertEqual(Image.open(io.BytesIO(served.content)).size, (8, 8))
        self.assertTrue(default_storage.exists(stored.name))
        self.assertEqual(default_storage.size(stored.name), stored.size)

        # Удаление фото убирает и запись в базе, даже если диск не даёт ничего стирать.
        with patch.object(FileSystemStorage, 'delete', side_effect=read_only):
            resp = client.delete(self.url)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(StoredFile.objects.count(), 0)
        self.assertFalse(Dish.objects.get(pk=self.dish.pk).photo)

    def test_media_route_serves_disk_files_and_hides_everything_else(self):
        resp = client_for(self.rest).post(self.url, {'image': png()}, format='multipart')
        path = resp.data['image'].replace('http://testserver', '')
        self.assertEqual(client_for().get(path).status_code, 200)
        self.assertEqual(client_for().get('/media/dishes/no-such.png').status_code, 404)
        self.assertEqual(client_for().get('/media/../flavor_tree/settings.py').status_code, 404)
        self.assertEqual(client_for().post(path).status_code, 405)
        # Не картинку отдаём только на скачивание.
        StoredFile.objects.create(name='dishes/page.html', content=b'<script>1</script>', content_type='text/html', size=17)
        served = client_for().get('/media/dishes/page.html')
        self.assertEqual(served['Content-Type'], 'application/octet-stream')
        self.assertEqual(served['Content-Disposition'], 'attachment')

    def test_pixel_bomb_rejected(self):
        with patch('api.images.IMAGE_MAX_PIXELS', 50):
            resp = client_for(self.rest).post(self.url, {'image': png(size=(10, 10))}, format='multipart')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('слишком большое', resp.data['detail'])


class AuthHardeningTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = make_user('aidar')

    def test_login_is_throttled_and_bad_bodies_do_not_crash(self):
        client = client_for()
        for body in ([], ['a'], 'строка'):
            self.assertEqual(client.post('/api/auth/login/', body, format='json').status_code, 400)
            self.assertEqual(client.post('/api/auth/register/', body, format='json').status_code, 400)
        self.assertEqual(client.post('/api/quiz/1/submit/', [], format='json').status_code, 400)
        cache.clear()
        codes = [client.post('/api/auth/login/', {'username': 'aidar', 'password': 'wrong'}, format='json').status_code
                 for _ in range(21)]
        self.assertEqual(codes[:20], [400] * 20)
        self.assertEqual(codes[20], 429)
        # Верный пароль тоже не проходит, пока лимит не истёк: перебор не ускорить.
        self.assertEqual(client.post('/api/auth/login/', {'username': 'aidar', 'password': PASSWORD}, format='json').status_code, 429)

    def test_register_race_gives_400_not_500(self):
        body = {'username': 'twin', 'email': 'twin@example.kz', 'password': 'very-secret-987'}
        with patch('api.serializers.User.objects.create_user', side_effect=IntegrityError('duplicate')):
            resp = client_for().post('/api/auth/register/', body, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn('username', resp.json()['errors'])


class InputHardeningTests(TestCase):
    def setUp(self):
        cache.clear()
        self.mod = make_user('mod', role='moderator')
        self.somm = make_user('somm', role='sommelier')
        self.active = make_brand('Efes Pilsener', style='Pilsner', abv=5.0)
        self.hidden = make_brand('Снятый сорт', is_active=False)

    def test_unknown_ordering_and_nul_byte_are_not_500(self):
        client = client_for()
        for path in ('/api/brands/?ordering=get_packaging_type_display', '/api/dishes/?ordering=cuisine_display',
                     '/api/pairings/?ordering=source_display', '/api/venues/?ordering=venue_type_display'):
            self.assertEqual(client.get(path).status_code, 200, path)
        self.assertEqual(client.get('/api/brands/?ordering=-name').status_code, 200)
        self.assertEqual(client.get('/api/brands/?q=%00').status_code, 400)
        mod = client_for(self.mod)
        self.assertEqual(mod.patch('/api/admin/flavor-notes/', {'id': 'not-a-uuid', 'name': 'x'}, format='json').status_code, 400)
        self.assertEqual(mod.delete('/api/admin/flavor-notes/?id=not-a-uuid').status_code, 400)

    def test_inactive_brands_do_not_leak(self):
        guest = client_for()
        names = [b['name'] for b in guest.get('/api/admin/brands/').json()]
        self.assertEqual(names, ['Efes Pilsener'])
        self.assertEqual(len(client_for(self.somm).get('/api/admin/brands/').json()), 2)
        from api.models import FlavorNote, FlavorProfile
        note = FlavorNote.objects.create(name='Солод', category='HEART', description='', icon='m')
        for brand in (self.active, self.hidden):
            FlavorProfile.objects.create(brand=brand, flavor_note=note, layer='HEART', intensity=5)
        self.assertEqual([b['brand_name'] for b in guest.get(f'/api/flavor-notes/{note.id}/brands/').json()], ['Efes Pilsener'])
        self.assertEqual(len(client_for(self.somm).get(f'/api/flavor-notes/{note.id}/brands/').json()), 2)

    def test_brand_list_has_taste_profile_and_large_pages(self):
        for i in range(30):
            make_brand('Сорт %02d' % i)
        data = client_for().get('/api/brands/').json()
        self.assertEqual(len(data['results']), 31)
        self.assertIsNone(data['next'])
        pils = next(b for b in data['results'] if b['name'] == 'Efes Pilsener')
        self.assertEqual(sorted(pils['taste_profile']), ['bitterness', 'body', 'freshness', 'roast', 'strength', 'sweetness'])
        self.assertGreater(pils['taste_profile']['bitterness'], 5)
        detail = client_for().get(f'/api/brands/{self.active.id}/').json()
        self.assertEqual(detail['taste_profile'], pils['taste_profile'])

    def test_brand_update_ignores_image_fields_and_validates_serving(self):
        mod = client_for(self.mod)
        resp = mod.patch(f'/api/brands/{self.active.id}/', {'image': 'brands/x.html', 'tagline': 'Классика'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertFalse(Brand.objects.get(pk=self.active.pk).image)
        resp = mod.patch(f'/api/brands/{self.active.id}/',
                         {'serving_recommendation': {'serving_temp_min': 'тёплое', 'serving_temp_max': 8, 'glass_type': 'Пинта'}}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('serving_recommendation', resp.json())
        body = {'brand_id': str(self.active.id), 'serving_temp_min': 9, 'serving_temp_max': 4, 'glass_type': 'Пинта'}
        self.assertEqual(mod.post('/api/admin/serving-recommendations/', body, format='json').status_code, 400)
        body.update(serving_temp_min=4, serving_temp_max=8, glass_type='x' * 101)
        self.assertEqual(mod.post('/api/admin/serving-recommendations/', body, format='json').status_code, 400)
        body.update(glass_type='Пинта')
        self.assertEqual(mod.post('/api/admin/serving-recommendations/', body, format='json').status_code, 200)

    def test_settings_singleton_and_ranges(self):
        mod = client_for(self.mod)
        self.assertEqual(mod.patch('/api/settings/', {'alternatives_count': 2}, format='json').status_code, 200)
        SiteSettings(alternatives_count=4).save()
        self.assertEqual(SiteSettings.objects.count(), 1)
        self.assertEqual(SiteSettings.load().alternatives_count, 4)
        self.assertEqual(mod.patch('/api/settings/', {'alternatives_count': -1}, format='json').status_code, 400)
        self.assertEqual(mod.patch('/api/settings/', {'min_score_to_show': 9}, format='json').status_code, 400)

    def test_seed_endpoint_refuses_a_filled_catalog(self):
        dish = make_dish()
        make_pairing(self.active, dish)
        resp = client_for(self.mod).post('/api/seed/')
        self.assertEqual(resp.status_code, 409)
        self.assertTrue(Brand.objects.filter(pk=self.hidden.pk).exists())
        self.assertEqual(FoodPairing.objects.count(), 1)
        with self.assertRaises(CommandError):
            call_command('seed', stdout=io.StringIO())
        self.assertTrue(Brand.objects.filter(pk=self.active.pk).exists())

    def test_pairing_loader_keeps_panel_pairs(self):
        make_dish('Казы')
        mine = make_pairing(self.active, make_dish('Плов'), explanation='Пара из панели')
        out = io.StringIO()
        call_command('load_food_pairings', stdout=out)
        call_command('load_food_pairings', stdout=out)
        self.assertTrue(FoodPairing.objects.filter(pk=mine.pk).exists())
        kazy = FoodPairing.objects.filter(brand=self.active, dish__name='Казы')
        self.assertEqual(kazy.count(), 1)
        self.assertEqual(kazy.get().compatibility_score, 5)

    def test_seed_roles_does_not_reset_changed_passwords(self):
        out = io.StringIO()
        call_command('seed_roles', stdout=out)
        user = User.objects.get(username='moderator')
        user.set_password('new-strong-pass-777')
        user.save()
        call_command('seed_roles', stdout=out)
        self.assertTrue(User.objects.get(username='moderator').check_password('new-strong-pass-777'))
        call_command('seed_roles', reset_passwords=True, stdout=out)
        self.assertTrue(User.objects.get(username='moderator').check_password('moderator12345'))


class RaceTests(TestCase):
    def setUp(self):
        cache.clear()
        self.rest = make_user('rest', role='restaurant_admin')
        self.venue = make_venue(owner=self.rest)
        self.item = make_menu_item(self.venue, make_dish(), price='4500')

    def test_one_venue_per_owner_is_enforced_by_the_database(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            Venue.objects.create(name='Второй бар', address='x', venue_type='BAR', owner=self.rest)
        # Проверка в API прошла, а база отказала (два запроса сразу): ответ 400, а не 500.
        other = make_user('other', role='restaurant_admin')
        with patch('api.views.Venue.objects.filter') as mocked:
            mocked.return_value.exists.return_value = False
            with patch('api.serializers.VenueSerializer.save', side_effect=IntegrityError('one_venue_per_owner')):
                resp = client_for(other).post('/api/venues/', {'name': 'Бар', 'address': 'ул. 1', 'venue_type': 'BAR'}, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)
        # Заведения без владельца ограничение не касается.
        Venue.objects.create(name='Ничей бар', address='x', venue_type='BAR')
        Venue.objects.create(name='Ещё ничей', address='x', venue_type='BAR')

    def test_reserved_slug(self):
        venue = Venue.objects.create(name='Mine', address='x', venue_type='BAR')
        self.assertEqual(venue.slug, 'mine-2')

    def test_order_status_changed_by_someone_else_gives_409(self):
        body = {'venue': self.venue.slug, 'table_number': 1, 'items': [{'kind': 'DISH', 'id': str(self.item.id), 'qty': 1}]}
        order_id = client_for().post('/api/orders/', body, format='json').json()['id']
        client = client_for(self.rest)
        real_get_object = None

        from api.views_orders import OrderViewSet
        real_get_object = OrderViewSet.get_object

        def stale(view):
            order = real_get_object(view)
            # Пока этот запрос проверял переход, другой сотрудник уже отменил заказ.
            Order.objects.filter(pk=order.pk).update(status=Order.STATUS_CANCELLED)
            return order

        with patch.object(OrderViewSet, 'get_object', stale):
            resp = client.patch(f'/api/orders/{order_id}/', {'status': 'ACCEPTED'}, format='json')
        self.assertEqual(resp.status_code, 409, resp.content)
        self.assertEqual(Order.objects.get(pk=order_id).status, Order.STATUS_CANCELLED)

    def test_orders_list_limit(self):
        body = {'venue': self.venue.slug, 'table_number': 1, 'items': [{'kind': 'DISH', 'id': str(self.item.id), 'qty': 1}]}
        for _ in range(3):
            self.assertEqual(client_for().post('/api/orders/', body, format='json').status_code, 201)
        client = client_for(self.rest)
        self.assertEqual(len(client.get(f'/api/orders/?venue={self.venue.slug}').json()), 3)
        self.assertEqual(len(client.get(f'/api/orders/?venue={self.venue.slug}&limit=2').json()), 2)
        self.assertEqual(len(client.get(f'/api/orders/?venue={self.venue.slug}&status=NEW,ACCEPTED&limit=1').json()), 1)
        self.assertEqual(client.get(f'/api/orders/?venue={self.venue.slug}&limit=0').status_code, 400)
        self.assertEqual(client.get(f'/api/orders/?venue={self.venue.slug}&limit=abc').status_code, 400)

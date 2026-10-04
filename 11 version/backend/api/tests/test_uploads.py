import io
import os
import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from PIL import Image

from api.images import set_brand_photo
from api.models import Brand, Dish, Venue
from .helpers import make_user, client_for, make_brand, make_dish, make_venue, make_menu_item

MEDIA_TMP = tempfile.mkdtemp(prefix='flavor-test-media-')


def png_bytes(size=(4, 4), color=(255, 160, 0), mode='RGB'):
    buffer = io.BytesIO()
    Image.new(mode, size, color).save(buffer, format='PNG')
    return buffer.getvalue()


def jpeg_bytes(size=(1200, 600), color=(30, 90, 200), orientation=None):
    buffer = io.BytesIO()
    options = {}
    if orientation:
        # Как телефон: кадр лежит на боку, а поворот записан в EXIF Orientation.
        exif = Image.Exif()
        exif[0x0112] = orientation
        options['exif'] = exif
    Image.new('RGB', size, color).save(buffer, format='JPEG', **options)
    return buffer.getvalue()


def half_of(data):
    return data[:len(data) // 2]


def mpo_bytes(size=(640, 480)):
    # Многокадровый JPEG, как снимают некоторые телефоны.
    first = Image.new('RGB', size, (200, 40, 40))
    second = Image.new('RGB', size, (40, 40, 200))
    buffer = io.BytesIO()
    first.save(buffer, format='MPO', save_all=True, append_images=[second])
    return buffer.getvalue()


def upload(name='dish.png', content=None, content_type='image/png'):
    return SimpleUploadedFile(name, content if content is not None else png_bytes(), content_type=content_type)


@override_settings(MEDIA_ROOT=MEDIA_TMP)
class DishPhotoUploadTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA_TMP, ignore_errors=True)

    def setUp(self):
        self.rest = make_user('rest', role='restaurant_admin')
        self.dish = make_dish(image='https://example.kz/besh.jpg')
        self.url = f'/api/dishes/{self.dish.id}/upload-image/'

    def test_upload_then_delete(self):
        client = client_for(self.rest)
        resp = client.post(self.url, {'image': upload()}, format='multipart')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(resp.data['image'].startswith('http://testserver/media/dishes/'))
        self.assertEqual(resp.data['image_url'], 'https://example.kz/besh.jpg')
        self.assertIn('menu_items_count', resp.data)
        self.assertTrue(Dish.objects.get(pk=self.dish.pk).photo)
        # В списке и в меню гостя тоже файл.
        listed = client_for().get(f'/api/dishes/{self.dish.id}/').json()
        self.assertEqual(listed['image'], resp.data['image'])
        venue = make_venue(owner=self.rest)
        make_menu_item(venue, self.dish)
        menu = client_for().get('/api/venues/efes-beer-garden/menu/').json()
        self.assertEqual(menu['sections'][0]['items'][0]['dish']['image'], resp.data['image'])
        items = client_for().get('/api/menu-items/?venue=efes-beer-garden').json()
        self.assertEqual(items[0]['dish_image'], resp.data['image'])

        resp = client.delete(self.url)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['image'], 'https://example.kz/besh.jpg')
        self.assertFalse(Dish.objects.get(pk=self.dish.pk).photo)

    def test_field_name_file_and_permissions(self):
        self.assertEqual(client_for().post(self.url, {'file': upload()}, format='multipart').status_code, 401)
        self.assertEqual(client_for(make_user('somm', role='sommelier')).post(self.url, {'file': upload()}, format='multipart').status_code, 403)
        resp = client_for(make_user('mod', role='moderator')).post(self.url, {'file': upload()}, format='multipart')
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_validation(self):
        client = client_for(self.rest)
        resp = client.post(self.url, {}, format='multipart')
        self.assertEqual(resp.status_code, 400)
        resp = client.post(self.url, {'image': upload('a.gif', b'GIF89a', 'image/gif')}, format='multipart')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['detail'], 'Подходят только PNG, JPG или WebP')
        big = upload('big.png', b'x' * (5 * 1024 * 1024 + 1))
        resp = client.post(self.url, {'image': big}, format='multipart')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['detail'], 'Файл больше 5 МБ')
        resp = client.post(self.url, {'image': upload('fake.png', b'not an image')}, format='multipart')
        self.assertEqual(resp.status_code, 400)
        resp = client.post(self.url, {'image': upload('half.jpg', half_of(jpeg_bytes()), 'image/jpeg')}, format='multipart')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['detail'], 'Файл повреждён или не является изображением')
        self.assertFalse(Dish.objects.get(pk=self.dish.pk).photo)

    def test_image_url_writable_and_image_read_only(self):
        client = client_for(self.rest)
        resp = client.patch(f'/api/dishes/{self.dish.id}/', {'image_url': 'https://example.kz/new.jpg'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['image'], 'https://example.kz/new.jpg')
        resp = client.patch(f'/api/dishes/{self.dish.id}/', {'image': 'https://example.kz/ignored.jpg'}, format='json')
        self.assertEqual(resp.data['image'], 'https://example.kz/new.jpg')


@override_settings(MEDIA_ROOT=MEDIA_TMP)
class VenueLogoUploadTests(TestCase):
    def setUp(self):
        self.rest = make_user('rest', role='restaurant_admin')
        self.venue = make_venue(owner=self.rest, logo='https://example.kz/logo.png')
        self.url = '/api/venues/efes-beer-garden/upload-logo/'

    def test_owner_uploads_and_deletes(self):
        client = client_for(self.rest)
        resp = client.post(self.url, {'image': upload('logo.png')}, format='multipart')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(resp.data['logo'].startswith('http://testserver/media/venues/'))
        self.assertEqual(resp.data['logo_url'], 'https://example.kz/logo.png')
        self.assertTrue(Venue.objects.get(pk=self.venue.pk).logo_file)
        menu = client_for().get('/api/venues/efes-beer-garden/menu/').json()
        self.assertEqual(menu['venue']['logo'], resp.data['logo'])
        resp = client.delete(self.url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['logo'], 'https://example.kz/logo.png')
        self.assertFalse(Venue.objects.get(pk=self.venue.pk).logo_file)

    def test_permissions_and_validation(self):
        other = make_user('other', role='restaurant_admin')
        self.assertEqual(client_for().post(self.url, {'image': upload()}, format='multipart').status_code, 401)
        self.assertEqual(client_for(other).post(self.url, {'image': upload()}, format='multipart').status_code, 403)
        self.assertEqual(client_for(other).delete(self.url).status_code, 403)
        mod = client_for(make_user('mod', role='moderator'))
        self.assertEqual(mod.post(self.url, {'image': upload('a.txt', b'hello', 'text/plain')}, format='multipart').status_code, 400)
        self.assertEqual(mod.post(self.url, {'image': upload()}, format='multipart').status_code, 200)

    def test_logo_url_writable(self):
        resp = client_for(self.rest).patch('/api/venues/efes-beer-garden/', {'logo_url': 'https://example.kz/x.png'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['logo'], 'https://example.kz/x.png')

    def test_multiframe_jpeg_accepted(self):
        resp = client_for(self.rest).post(self.url, {'image': upload('phone.jpg', mpo_bytes(), 'image/jpeg')}, format='multipart')
        self.assertEqual(resp.status_code, 200, resp.content)


@override_settings(MEDIA_ROOT=MEDIA_TMP)
class BrandPhotoUploadTests(TestCase):
    """Одно фото сорта: оригинал в image_hd, уменьшенная копия в image."""

    def setUp(self):
        self.mod = make_user('mod', role='moderator')
        self.brand = make_brand('Velkopopovický Kozel')
        self.url = f'/api/brands/{self.brand.id}/upload-image/'

    def sizes(self):
        brand = Brand.objects.get(pk=self.brand.pk)
        with Image.open(brand.image_hd.path) as hd, Image.open(brand.image.path) as small:
            return brand, hd.size, small.size, small.format

    def test_upload_generates_both_then_delete_clears_both(self):
        client = client_for(self.mod)
        resp = client.post(self.url, {'image': upload('kozel photo.jpg', jpeg_bytes(), 'image/jpeg')}, format='multipart')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(resp.data['image_hd'].startswith('http://testserver/media/brands/hd/'))
        self.assertTrue(resp.data['image'].startswith('http://testserver/media/brands/'))
        self.assertNotIn('/hd/', resp.data['image'])
        self.assertTrue(resp.data['image'].endswith('_sm.jpg'))
        self.assertIn('pyramid', resp.data)
        brand, hd_size, small_size, small_format = self.sizes()
        self.assertEqual(hd_size, (1200, 600))
        self.assertEqual(small_size, (480, 240))
        self.assertEqual(small_format, 'JPEG')
        old_hd, old_small = brand.image_hd.path, brand.image.path

        # Повторная загрузка: PNG с прозрачностью даёт PNG-миниатюру, старые файлы удаляются.
        resp = client.post(self.url, {'file': upload('logo.png', png_bytes((300, 900), (255, 160, 0, 0), 'RGBA'))}, format='multipart')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(resp.data['image'].endswith('_sm.png'))
        brand, hd_size, small_size, small_format = self.sizes()
        self.assertEqual(hd_size, (300, 900))
        self.assertEqual(small_size, (160, 480))
        self.assertEqual(small_format, 'PNG')
        self.assertFalse(os.path.exists(old_hd))
        self.assertFalse(os.path.exists(old_small))
        # Каталог и карточка отдают новые файлы.
        listed = client_for().get('/api/brands/').json()['results'][0]
        self.assertEqual(listed['image'], resp.data['image'])
        self.assertEqual(listed['image_hd'], resp.data['image_hd'])

        current_hd, current_small = brand.image_hd.path, brand.image.path
        resp = client.delete(self.url)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIsNone(resp.data['image'])
        self.assertIsNone(resp.data['image_hd'])
        brand = Brand.objects.get(pk=self.brand.pk)
        self.assertFalse(brand.image)
        self.assertFalse(brand.image_hd)
        self.assertFalse(os.path.exists(current_hd))
        self.assertFalse(os.path.exists(current_small))
        # Повторное удаление безопасно.
        self.assertEqual(client.delete(self.url).status_code, 200)

    def test_small_source_is_not_upscaled(self):
        resp = client_for(self.mod).post(self.url, {'image': upload('tiny.png', png_bytes((64, 32)))}, format='multipart')
        self.assertEqual(resp.status_code, 200, resp.content)
        _, hd_size, small_size, _ = self.sizes()
        self.assertEqual(hd_size, (64, 32))
        self.assertEqual(small_size, (64, 32))

    def test_validation_and_permissions(self):
        client = client_for(self.mod)
        resp = client.post(self.url, {}, format='multipart')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['detail'], 'Файл изображения (поле image или file) не передан')
        resp = client.post(self.url, {'image': upload('a.gif', b'GIF89a', 'image/gif')}, format='multipart')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['detail'], 'Подходят только PNG, JPG или WebP')
        resp = client.post(self.url, {'image': upload('big.png', b'x' * (5 * 1024 * 1024 + 1))}, format='multipart')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['detail'], 'Файл больше 5 МБ')
        resp = client.post(self.url, {'image': upload('fake.png', b'not an image')}, format='multipart')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['detail'], 'Файл повреждён или не является изображением')
        brand = Brand.objects.get(pk=self.brand.pk)
        self.assertFalse(brand.image)
        self.assertFalse(brand.image_hd)

        self.assertEqual(client_for().post(self.url, {'image': upload()}, format='multipart').status_code, 401)
        self.assertEqual(client_for(make_user('rest', role='restaurant_admin')).post(self.url, {'image': upload()}, format='multipart').status_code, 403)
        self.assertEqual(client_for(make_user('somm', role='sommelier')).delete(self.url).status_code, 403)
        resp = client.post(self.url, {'image': upload('phone.jpg', mpo_bytes(), 'image/jpeg')}, format='multipart')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(resp.data['image'].endswith('_sm.jpg'))

    def test_exif_orientation_applied_to_thumbnail(self):
        # Вертикальное фото с телефона: в файле 600x300 и Orientation=6, миниатюра должна стоять прямо.
        resp = client_for(self.mod).post(
            self.url, {'image': upload('phone.jpg', jpeg_bytes((600, 300), orientation=6), 'image/jpeg')}, format='multipart')
        self.assertEqual(resp.status_code, 200, resp.content)
        _, hd_size, small_size, _ = self.sizes()
        self.assertEqual(hd_size, (600, 300))
        self.assertEqual(small_size, (240, 480))

    def test_truncated_jpeg_rejected_and_fields_untouched(self):
        client = client_for(self.mod)
        resp = client.post(self.url, {'image': upload('good.jpg', jpeg_bytes(), 'image/jpeg')}, format='multipart')
        self.assertEqual(resp.status_code, 200, resp.content)
        brand = Brand.objects.get(pk=self.brand.pk)
        hd_name, small_name = brand.image_hd.name, brand.image.name

        broken = (('half.jpg', half_of(jpeg_bytes())), ('half_phone.jpg', half_of(mpo_bytes())))
        for name, content in broken:
            resp = client.post(self.url, {'image': upload(name, content, 'image/jpeg')}, format='multipart')
            self.assertEqual(resp.status_code, 400, resp.content)
            self.assertEqual(resp.data['detail'], 'Файл повреждён или не является изображением')
        # Сама set_brand_photo тоже не трогает поля, если миниатюра не собралась.
        self.assertEqual(
            set_brand_photo(brand, upload('half.jpg', half_of(jpeg_bytes()), 'image/jpeg')),
            'Файл повреждён или не является изображением')
        brand = Brand.objects.get(pk=self.brand.pk)
        self.assertEqual((brand.image_hd.name, brand.image.name), (hd_name, small_name))
        self.assertTrue(os.path.exists(brand.image_hd.path))
        self.assertTrue(os.path.exists(brand.image.path))

    def test_regen_brand_thumbs_command(self):
        with_hd = make_brand('Bavaria', image_hd=SimpleUploadedFile('bavaria_hd.png', png_bytes((1000, 500))))
        without = make_brand('Бочковое', image=SimpleUploadedFile('bochka.png', png_bytes((900, 900))))
        out = io.StringIO()
        call_command('regen_brand_thumbs', stdout=out)
        call_command('regen_brand_thumbs', stdout=out)  # повторный запуск даёт тот же результат
        with_hd = Brand.objects.get(pk=with_hd.pk)
        self.assertTrue(with_hd.image.name.startswith('brands/bavaria_hd'))
        self.assertTrue(with_hd.image.name.endswith('_sm.jpg'))
        with Image.open(with_hd.image.path) as small:
            self.assertEqual(small.size, (480, 240))
        without = Brand.objects.get(pk=without.pk)
        self.assertEqual(without.image.name, 'brands/bochka.png')
        self.assertFalse(without.image_hd)
        self.assertFalse(Brand.objects.get(pk=self.brand.pk).image)
        self.assertIn('пересобрано 1', out.getvalue())

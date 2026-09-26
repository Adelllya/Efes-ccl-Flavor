import io

from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase

from api import public_content
from api.models import Brand, Course, FlavorNote, FlavorProfile, TeamMember, Venue
from .helpers import client_for, make_brand, make_dish, make_pairing, make_venue

INVENTED_WORDS = ('WSET', 'Brewmaster', 'FlavorActiV', 'Сертификац', 'пилотной дегустации')


def run(command):
    call_command(command, stdout=io.StringIO())


class UpdatePublicContentTests(TestCase):
    """Команда чинит уже заполненную базу и не трогает то, что правили люди."""

    def setUp(self):
        for name in ('Айгерим Нурланова', 'Дамир Сапаров', 'Елена Коваль', 'Тимур Ахметов'):
            TeamMember.objects.create(name=name, role='Сомелье', bio='Сертифицирован по WSET')
        self.guest_expert = TeamMember.objects.create(name='Настоящий консультант', role='Бармен', bio='Проверил пары')
        Course.objects.create(level=4, title='Сомелье', description='Описание по лексикону FlavorActiV и сертификация')

        self.region = make_brand('13 регион', abv=None)
        self.pils = make_brand('Efes Pilsener', abv=5.0, density='11.8% плато',
                               image='https://placehold.co/600x800/f59e0b/fff?text=Efes+Pilsener')
        self.los = make_brand('Хмельной Лось', abv=7.3, image='brands/свой-файл.png')

        self.worty = FlavorNote.objects.create(name='Сусло (Worty)', category='HEART', description='', icon='w')
        self.draft = FlavorProfile.objects.create(brand=self.region, flavor_note=self.worty, layer='HEART',
                                                  intensity=4, sommelier_name='Главный Сомелье Efes')
        note = FlavorNote.objects.create(name='Солод', category='HEART', description='', icon='m')
        self.edited = FlavorProfile.objects.create(brand=self.pils, flavor_note=note, layer='HEART',
                                                   intensity=6, sommelier_name='somm')

        self.pair = make_pairing(self.pils, make_dish('Казы'), score=5, pairing_type='CONTRAST',
                                 explanation='Высокая base-горечь пильзнера режет жирность вяленого мяса')

        self.demo = make_venue(slug='efes-beer-garden', phone='+7 727 000 00 00')
        self.real = make_venue(name='Бар на Абая', address='пр. Абая 1', phone='+7 700 111 22 33')

    def test_command_fixes_content_and_is_idempotent(self):
        run('update_public_content')
        run('update_public_content')

        names = sorted(TeamMember.objects.values_list('name', flat=True))
        self.assertEqual(names, sorted(['Аджибаева Аделия', 'Абуталифулы Ералы', 'Настоящий консультант']))
        self.assertTrue(TeamMember.objects.filter(pk=self.guest_expert.pk).exists())

        self.assertEqual(Course.objects.count(), 4)
        for course in Course.objects.all():
            for word in INVENTED_WORDS:
                self.assertNotIn(word, course.title + course.description)

        self.draft.refresh_from_db()
        self.edited.refresh_from_db()
        self.assertEqual(self.draft.sommelier_name, 'Команда Flavor Tree')
        self.assertEqual(self.edited.sommelier_name, 'somm')

        self.worty.refresh_from_db()
        self.assertEqual(self.worty.name, 'Сусло')
        self.assertEqual(self.draft.flavor_note_id, self.worty.id)

        self.pair.refresh_from_db()
        self.assertNotIn('base', self.pair.explanation)

        self.region.refresh_from_db()
        self.pils.refresh_from_db()
        self.los.refresh_from_db()
        self.assertEqual(self.region.abv, 4.5)
        self.assertEqual(self.region.image.name, 'brands/13_region_hd_sm.png')
        self.assertEqual(self.region.image_hd.name, 'brands/hd/13_region_hd.png')
        self.assertEqual(self.pils.image.name, 'brands/efes_ingredients_hd_sm.png')
        self.assertEqual(self.pils.density, '')
        self.assertEqual(self.pils.abv, 5.0)
        # Своё фото и своя крепость остаются.
        self.assertEqual(self.los.image.name, 'brands/свой-файл.png')
        self.assertEqual(self.los.abv, 7.3)

        self.demo.refresh_from_db()
        self.real.refresh_from_db()
        self.assertEqual(self.demo.name, 'Демо-бар Flavor Tree')
        self.assertEqual((self.demo.address, self.demo.phone), ('', ''))
        self.assertEqual(self.demo.slug, 'efes-beer-garden')
        self.assertEqual((self.real.name, self.real.address, self.real.phone),
                         ('Бар на Абая', 'пр. Абая 1', '+7 700 111 22 33'))

    def test_keeps_team_and_courses_edited_in_admin(self):
        founder = TeamMember.objects.create(name='Аджибаева Аделия', role='CEO', bio='Своя биография',
                                            avatar='https://example.com/a.png')
        Course.objects.create(level=1, title='Новичок', description='Свой текст курса из админки')
        old_level2 = public_content.OLD_COURSES[2]
        Course.objects.create(level=2, title=old_level2[0], description=old_level2[1])
        run('update_public_content')
        run('update_public_content')

        founder.refresh_from_db()
        self.assertEqual((founder.role, founder.bio, founder.avatar), ('CEO', 'Своя биография', 'https://example.com/a.png'))
        new = TeamMember.objects.get(name='Абуталифулы Ералы')
        self.assertEqual((new.role, new.bio, new.avatar), ('Сооснователь', '', ''))

        courses = {c.level: c for c in Course.objects.all()}
        self.assertEqual(sorted(courses), [1, 2, 3, 4])
        self.assertEqual(courses[1].description, 'Свой текст курса из админки')
        self.assertEqual(courses[2].title, 'Вкусовая пирамида')
        self.assertEqual(courses[4].title, 'Подбор для гостей')

    def test_demo_account_name(self):
        demo = User.objects.create_user('restaurant', first_name='Efes Beer Garden')
        owner = User.objects.create_user('bar', first_name='Efes Beer Garden')
        run('update_public_content')
        demo.refresh_from_db()
        owner.refresh_from_db()
        self.assertEqual(demo.first_name, 'Демо-бар Flavor Tree')
        # Другой аккаунт с тем же именем может быть настоящим заведением.
        self.assertEqual(owner.first_name, 'Efes Beer Garden')

    def test_demo_venue_keeps_real_data_entered_later(self):
        self.demo.name = 'Пилотный бар'
        self.demo.address = 'ул. Настоящая 5'
        self.demo.save()
        run('update_public_content')
        self.demo.refresh_from_db()
        self.assertEqual((self.demo.name, self.demo.address, self.demo.phone), ('Пилотный бар', 'ул. Настоящая 5', ''))


class PublicApiTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_landing_has_no_invented_quote_or_people(self):
        run('seed')
        data = client_for().get('/api/landing/').json()
        self.assertIsNone(data['quote'])
        self.assertEqual(sorted(m['name'] for m in data['team']), ['Абуталифулы Ералы', 'Аджибаева Аделия'])
        text = str(data)
        for word in INVENTED_WORDS + ('Айгерим', 'Нурланова'):
            self.assertNotIn(word, text)
        team = client_for().get('/api/team/').json()
        team = team['results'] if isinstance(team, dict) else team
        self.assertEqual(len(team), 2)

    def test_brand_marks_estimated_abv(self):
        region = make_brand('13 регион', abv=4.5)
        pils = make_brand('Efes Pilsener', abv=5.0)
        by_name = {b['name']: b for b in client_for().get('/api/brands/').json()['results']}
        self.assertTrue(by_name['13 регион']['abv_estimated'])
        self.assertFalse(by_name['Efes Pilsener']['abv_estimated'])
        self.assertFalse(client_for().get(f'/api/brands/{pils.id}/').json()['abv_estimated'])
        # Модератор поставил число с этикетки: это уже не оценка.
        region.abv = 4.8
        region.save()
        self.assertFalse(client_for().get(f'/api/brands/{region.id}/').json()['abv_estimated'])


class LoadFlavorDataTests(TestCase):
    def test_all_17_brands_get_abv_photo_and_russian_notes(self):
        run('load_flavor_data')
        brands = Brand.objects.all()
        self.assertEqual(brands.count(), 17)
        self.assertEqual([b.name for b in brands if b.abv is None], [])
        self.assertEqual([b.name for b in brands if not b.image], [])
        facts = public_content.engine_brand_facts()
        for brand in brands:
            self.assertEqual(brand.abv, facts[brand.name]['abv'], brand.name)
        self.assertFalse(FlavorNote.objects.filter(name__contains='(').exists())
        self.assertEqual(set(FlavorProfile.objects.values_list('sommelier_name', flat=True)), {'Команда Flavor Tree'})

    def test_seed_roles_demo_venue_is_marked_as_demo(self):
        run('seed_roles')
        venue = Venue.objects.get(slug='efes-beer-garden')
        self.assertEqual(venue.name, 'Демо-бар Flavor Tree')
        self.assertEqual((venue.address, venue.phone), ('', ''))
        self.assertIn('Демонстрационное', venue.description)
        self.assertEqual(User.objects.get(username='restaurant').first_name, 'Демо-бар Flavor Tree')

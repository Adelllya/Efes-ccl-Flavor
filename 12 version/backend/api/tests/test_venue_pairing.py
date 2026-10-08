"""Подбор напитка к блюду в меню заведения: только то, что бар продаёт, по движку v2."""
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from api import venue_pairing
from api.models import MenuDrink
from .helpers import client_for, make_brand, make_dish, make_pairing, make_venue, make_menu_item

MENU_URL = '/api/venues/efes-beer-garden/menu/'
EM_DASH, EN_DASH = '\u2014', '\u2013'


def entries(data):
    return {e['dish']['name']: e for s in data['sections'] for e in s['items']}


class ThreeSortBarTests(TestCase):
    """Бар продаёт только три сорта. Любое блюдо должно вести к напитку, который можно заказать."""

    def setUp(self):
        self.venue = make_venue()
        # Названия как в каталоге: сорта связаны с напитками движка через legacy_brand_id.
        self.efes = make_brand('Efes Pilsener')
        self.kozel = make_brand('Velkopopovický Kozel', style='Czech Lager', abv=4.0)
        self.los = make_brand('Хмельной Лось', style='Strong Lager', abv=7.3)
        self.medved = make_brand('Белый Медведь')
        self.bochka = make_brand('Бочковое', style='Draft Lager')
        self.drinks = {
            'efes': MenuDrink.objects.create(venue=self.venue, brand=self.efes, price='1200', sort_order=0),
            'kozel': MenuDrink.objects.create(venue=self.venue, brand=self.kozel, price='1500', sort_order=1),
            'los': MenuDrink.objects.create(venue=self.venue, brand=self.los, price='1400', sort_order=2),
        }
        # Бочковое в карте, но закончилось.
        MenuDrink.objects.create(venue=self.venue, brand=self.bochka, price='900', sort_order=3, is_available=False)

        self.manty = make_dish('Манты', cooking_method='STEAMED', fat_level='MEDIUM')
        self.besh = make_dish('Бешбармак')
        self.samsa = make_dish('Самса', cooking_method='BAKED', fat_level='MEDIUM')
        # Пара команды к мантам - сорт, которого в баре нет; к бешбармаку - сорт из карты.
        make_pairing(self.medved, self.manty, score=5, explanation='Зерновые ноты вторят тесту')
        make_pairing(self.kozel, self.besh, score=5, pairing_type='COMPLEMENT', explanation='Солод и умами')
        make_pairing(self.bochka, self.besh, score=4)
        for i, dish in enumerate((self.manty, self.besh, self.samsa)):
            make_menu_item(self.venue, dish, price='2500', section='Горячее', sort_order=i)
        self.available_ids = {str(d.id) for d in self.drinks.values()}

    def menu(self):
        resp = client_for().get(MENU_URL)
        self.assertEqual(resp.status_code, 200, resp.content)
        return resp.json()

    def assert_orderable(self, entry):
        recs = entry['recommendations']
        self.assertTrue(recs, entry['dish']['name'])
        self.assertLessEqual(len(recs), 3)
        for rank, rec in enumerate(recs, start=1):
            self.assertEqual(rec['rank'], rank)
            self.assertIn(rec['menu_drink']['id'], self.available_ids)
            self.assertTrue(rec['menu_drink']['is_available'])
            self.assertIn(rec['source'], ('TEAM', 'ENGINE'))
            self.assertEqual(rec['curated'], rec['source'] == 'TEAM')
        # Старые поля на месте: первый вариант и остальные.
        self.assertEqual(entry['pairing'], recs[0])
        self.assertEqual(entry['alternatives'], recs[1:])
        self.assertEqual(len({r['menu_drink']['id'] for r in recs}), len(recs))

    def test_team_pair_outside_bar_is_replaced_by_engine_options(self):
        manty = entries(self.menu())['Манты']
        self.assert_orderable(manty)
        names = [r['brand_name'] for r in manty['recommendations']]
        self.assertNotIn('Белый Медведь', names)
        self.assertTrue(all(r['source'] == 'ENGINE' for r in manty['recommendations']))
        scores = [r['score'] for r in manty['recommendations']]
        self.assertTrue(all(isinstance(s, int) and 0 <= s <= 100 for s in scores))
        self.assertEqual(manty['pairing_info']['engine_dish'], 'manty')
        self.assertEqual(manty['pairing_info']['dish_match'], 'exact')
        self.assertIn(manty['pairing_info']['status'], ('ok', 'weak'))
        first = manty['pairing']
        self.assertTrue(first['band_label'])
        self.assertTrue(first['reasons'])
        self.assertEqual(first['explanation'], first['reasons'][0])
        self.assertIn(first['pairing_type'], ('CLEANSE', 'COMPLEMENT', 'CONTRAST', 'BRIDGE', None))

    def test_team_pair_in_bar_goes_first_and_is_marked(self):
        besh = entries(self.menu())['Бешбармак']
        self.assert_orderable(besh)
        first = besh['pairing']
        self.assertEqual(first['brand_name'], 'Velkopopovický Kozel')
        self.assertEqual(first['source'], 'TEAM')
        self.assertTrue(first['curated'])
        self.assertEqual(first['team_rating'], 5)
        self.assertEqual(first['compatibility_score'], 5)
        self.assertEqual(first['explanation'], 'Солод и умами')
        self.assertEqual(first['brand'], str(self.kozel.id))
        # Балл движка есть и у пары команды: сорт связан с напитком движка.
        self.assertIsInstance(first['score'], int)
        self.assertEqual(first['engine_drink_id'], 'kozel')
        self.assertEqual(besh['pairing_info']['status'], 'ok')
        # Остальные варианты от движка, Kozel не повторяется, Бочковое закончилось.
        others = besh['alternatives']
        self.assertTrue(others)
        self.assertTrue(all(r['source'] == 'ENGINE' for r in others))
        self.assertNotIn('Бочковое', [r['brand_name'] for r in besh['recommendations']])

    def test_every_dish_has_something_to_order(self):
        for name, entry in entries(self.menu()).items():
            with self.subTest(dish=name):
                self.assert_orderable(entry)

    def test_reasons_are_clean(self):
        for entry in entries(self.menu()).values():
            for rec in entry['recommendations']:
                for text in rec['reasons'] + [rec['explanation']]:
                    self.assertNotIn(EM_DASH, text)
                    self.assertNotIn(EN_DASH, text)
                    self.assertNotIn('↔', text)
                    self.assertNotRegex(text, r'\([^)]*[A-Za-z0-9][^)]*\)')

    def test_out_of_stock_and_absent_sorts_never_recommended(self):
        data = self.menu()
        for entry in entries(data).values():
            names = {r['brand_name'] for r in entry['recommendations']}
            self.assertFalse(names & {'Бочковое', 'Белый Медведь'})
        # Карта напитков в ответе по-прежнему целиком, с закончившимся сортом.
        self.assertEqual([d['brand_name'] for d in data['drinks']],
                         ['Efes Pilsener', 'Velkopopovický Kozel', 'Хмельной Лось', 'Бочковое'])

    def test_engine_drink_from_card_is_recommended(self):
        # Бар продаёт только Efes 0.0 из базы подбора, без сорта каталога.
        MenuDrink.objects.filter(venue=self.venue).delete()
        zero = MenuDrink.objects.create(venue=self.venue, engine_drink_id='efes-0-0', price='900')
        besh = entries(self.menu())['Бешбармак']
        self.assertEqual(len(besh['recommendations']), 1)
        rec = besh['pairing']
        self.assertEqual(rec['source'], 'ENGINE')
        self.assertIsNone(rec['brand'])
        self.assertEqual(rec['engine_drink_id'], 'efes-0-0')
        self.assertEqual(rec['brand_name'], 'Efes 0.0 (классическое)')
        self.assertEqual(rec['category'], 'na_beer')
        self.assertFalse(rec['is_alcoholic'])
        self.assertEqual(rec['menu_drink']['id'], str(zero.id))
        self.assertEqual(venue_pairing.venue_engine_drink_ids(self.venue), ['efes-0-0'])

    def test_weak_and_none_statuses(self):
        # Порог «хорошей пары» выше любого балла: варианты есть, но подбор честно помечен как слабый.
        real_band_min = venue_pairing.band_min

        def strict_good(ds, band_id, default):
            return 101 if band_id == 'good' else real_band_min(ds, band_id, default)

        with mock.patch.object(venue_pairing, 'band_min', strict_good):
            manty = entries(self.menu())['Манты']
        self.assertTrue(manty['recommendations'])
        self.assertEqual(manty['pairing_info']['status'], 'weak')

        # Порог «нейтрально» выше любого балла: выше порога ничего нет, но гость не остаётся без выбора,
        # отдаём до трёх ближайших по баллу напитков карты, подбор честно помечен как слабый.
        def strict_all(ds, band_id, default):
            return 101

        with mock.patch.object(venue_pairing, 'band_min', strict_all):
            data = entries(self.menu())
        manty = data['Манты']
        self.assertTrue(manty['recommendations'])
        self.assertLessEqual(len(manty['recommendations']), 3)
        self.assertEqual(manty['pairing_info']['status'], 'weak')
        self.assertEqual(manty['pairing']['source'], 'ENGINE')
        names = {r['brand_name'] for r in manty['recommendations']}
        self.assertFalse(names & {'Бочковое', 'Белый Медведь'})
        # Пару команды движок отверг, но как «ближайшую» её всё же можно предложить, и тоже со слабым статусом.
        self.assertEqual(data['Бешбармак']['pairing_info']['status'], 'weak')
        self.assertTrue(data['Бешбармак']['recommendations'])

    def test_check_command_lists_every_dish(self):
        out = StringIO()
        call_command('venue_pairing_check', '--venue', 'efes-beer-garden', stdout=out)
        text = out.getvalue()
        self.assertIn('Efes Beer Garden: 3 напитков в наличии из 4 в карте', text)
        self.assertIn('Манты -> Манты (по названию)', text)
        self.assertIn('1. Velkopopovický Kozel', text)
        self.assertIn('команда 5/5', text)
        self.assertNotIn('Без напитка для заказа', text)
        with self.assertRaises(CommandError):
            call_command('venue_pairing_check', '--venue', 'nope', stdout=StringIO())

    def test_menu_works_without_engine(self):
        with mock.patch.object(venue_pairing, 'dataset', return_value=None):
            data = entries(self.menu())
        besh = data['Бешбармак']
        self.assertEqual([r['brand_name'] for r in besh['recommendations']], ['Velkopopovický Kozel'])
        self.assertIsNone(besh['pairing']['score'])
        self.assertEqual(data['Манты']['pairing_info']['status'], 'none')


class DishMatchingTests(TestCase):
    """Блюдо меню ищем в движке по названию и синонимам, иначе по похожему блюду каталога."""

    def setUp(self):
        self.ds = venue_pairing.dataset()
        self.idx = venue_pairing.index_for(self.ds)

    def test_match_by_name_synonym_and_part(self):
        self.assertEqual(self.idx.match_dish('Манты'), ('manty', 'exact'))
        self.assertEqual(self.idx.match_dish('Гренки с чесноком'), ('garlic-croutons', 'exact'))
        self.assertEqual(self.idx.match_dish('КАЛЬМАРЫ ФРИ'), ('calamari-rings', 'exact'))
        self.assertEqual(self.idx.match_dish('Сырные палочки с соусом'), ('mozzarella-sticks', 'partial'))
        self.assertEqual(self.idx.match_dish('Цезарь с креветками'), ('caesar-salad', 'partial'))
        # По одному общему слову блюдо не угадываем.
        self.assertEqual(self.idx.match_dish('Салат из огурцов'), (None, None))
        self.assertEqual(self.idx.match_dish('Десерт дня'), (None, None))

    def test_similar_dish_from_catalog_and_log_for_unmapped(self):
        venue = make_venue()
        make_dish('Братвурст (сосиски)', cuisine='GERMAN', dominant_taste='SALTY', cooking_method='GRILLED')
        hotdog = make_dish('Хот-дог по-домашнему', cuisine='GERMAN', dominant_taste='SALTY',
                           cooking_method='GRILLED')
        odd = make_dish('Фирменное блюдо шефа', cuisine='OTHER', dominant_taste='BITTER', weight='LIGHT',
                        fat_level='LOW', cooking_method='RAW')
        make_menu_item(venue, hotdog, sort_order=0)
        make_menu_item(venue, odd, sort_order=1)
        MenuDrink.objects.create(venue=venue, brand=make_brand('Efes Pilsener'), price='1200')
        venue_pairing._warned_dishes.discard(odd.name)
        with self.assertLogs('api.venue_pairing', level='WARNING') as logs:
            data = entries(client_for().get(MENU_URL).json())
        self.assertTrue(any('Фирменное блюдо шефа' in line for line in logs.output))
        info = data['Хот-дог по-домашнему']['pairing_info']
        self.assertEqual(info['engine_dish'], 'bratwurst')
        self.assertEqual(info['dish_match'], 'similar')
        self.assertEqual(info['based_on'], 'Братвурст (сосиски)')
        self.assertTrue(data['Хот-дог по-домашнему']['recommendations'])
        odd_info = data['Фирменное блюдо шефа']['pairing_info']
        self.assertIsNone(odd_info['engine_dish'])
        self.assertEqual(odd_info['status'], 'none')

    def test_brand_maps_to_engine_drink(self):
        venue = make_venue()
        kozel = MenuDrink.objects.create(venue=venue, brand=make_brand('Velkopopovický Kozel'), price='1')
        custom = MenuDrink.objects.create(venue=venue, brand=make_brand('Своё нефильтрованное'), price='1')
        engine = MenuDrink.objects.create(venue=venue, engine_drink_id='velkopopovicky-kozel-cerny', price='1',
                                          name='Kozel тёмный')
        self.assertEqual(self.idx.engine_drink(self.ds, kozel), 'kozel')
        self.assertIsNone(self.idx.engine_drink(self.ds, custom))
        self.assertEqual(self.idx.engine_drink(self.ds, engine), 'velkopopovicky-kozel-cerny')
        self.assertEqual(sorted(venue_pairing.venue_engine_drink_ids(venue, self.ds)),
                         ['kozel', 'velkopopovicky-kozel-cerny'])

    def test_clean_reason(self):
        clean = venue_pairing.clean_reason
        self.assertEqual(clean(f'Пузырьки смывают жир баранины с языка {EM_DASH} каждый глоток как первый (Oliver)'),
                         'Пузырьки смывают жир баранины с языка, каждый глоток как первый')
        self.assertEqual(clean(f'Общие ароматы {EM_DASH} хлеб, карамель {EN_DASH} строят мост между напитком и блюдом'),
                         'Общие ароматы (хлеб, карамель) строят мост между напитком и блюдом')
        self.assertEqual(clean('Сладость пива гасит остроту перца чили (CMS: «Spicy + sugar = no fire»)'),
                         'Сладость пива гасит остроту перца чили')
        self.assertEqual(clean('Региональная пара: казахская кухня ↔ Efes 0.0 (классическое)'),
                         'Региональная пара: казахская кухня и Efes 0.0 (классическое)')

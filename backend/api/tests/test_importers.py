"""Импорт меню: паритет importers.py с frontend/src/app/core/menu-import.ts по data/samples/expected_import.json
и эндпоинт POST /api/cabinet/menu/import/. Запуск: python manage.py test api.tests.test_importers
(паритет без Django: python -m unittest api.tests.test_importers.TestParity)."""
from __future__ import annotations

import json
import unittest

from api import importers
from api.pairing.dataset import DATA_DIR

SAMPLES = DATA_DIR / 'samples'
GOLDEN = SAMPLES / 'expected_import.json'

# те же сценарии, что в frontend/scripts/menu-import-test.mjs
ERROR_CASES = [
    ('', 'empty'), ('   \n\n', 'empty'), ('{bad json', 'bad_json'), ('{"foo": 1}', 'unknown_format'), ('[1, 2, 3]', 'unknown_format'),
    ('{"products": "нет"}', 'unknown_format'), ('Цена;Себестоимость\n100;50', 'no_name_column'), ('Название;Цена\n', 'no_rows'),
    ('{"products": []}', 'no_rows'), ('{"response": [{"product_name": "", "price": {"1": "100"}}]}', 'no_rows'),
    ('Название;Цена\n' + '\n'.join(f'Позиция {i};100' for i in range(2001)), 'too_many_rows'),
    ('x' * (2 * 1024 * 1024 + 1), 'too_large'),
]
PLAN_CASES = [
    {'fixture': 'iiko_nomenclature.json', 'choices': {}, 'existing': [], 'limit': 40},
    {'fixture': 'iiko_nomenclature.json', 'choices': {'8': 'kozel', '24': '', '25': 'buffalo-wings', '49': 'airan', '3': 'no-such-slug'},
     'existing': ['BEER:efes-pilsener', 'DISH:shashlyk', 'BEER:kozel'], 'limit': 12},
    {'fixture': 'poster_products.json', 'choices': {'1': 'efes-pilsener', '5': ''}, 'existing': ['BEER:legenda-777'], 'limit': 300},
    {'fixture': 'bar_menu_tab.csv', 'choices': {}, 'existing': [], 'limit': 5},
]
DECODE_CHECKS = [
    (bytes([0xef, 0xbb, 0xbf, 0x41]), 'A', 'utf-8'),
    (bytes([0xd0, 0x9f, 0xd0, 0xb8, 0xd0, 0xb2, 0xd0, 0xbe]), 'Пиво', 'utf-8'),
    (bytes([0xcf, 0xe8, 0xe2, 0xee, 0x20, 0xb8, 0x98]), 'Пиво ё�', 'windows-1251'),
    (bytes([0xff, 0xfe, 0x1f, 0x04, 0x38, 0x04]), 'Пи', 'utf-16le'),
    (bytes([0xfe, 0xff, 0x04, 0x1f, 0x04, 0x38]), 'Пи', 'utf-16be'),
]


def _golden() -> dict:
    with open(GOLDEN, encoding='utf-8') as f:
        return json.load(f)


def _parse_fixture(name: str) -> tuple[str, dict]:
    text, encoding = importers.decode_bytes((SAMPLES / name).read_bytes())
    return encoding, importers.parse_menu(text)


class TestParity(unittest.TestCase):
    """Python даёт ровно то же, что TypeScript: эталон сгенерирован node-скриптом."""

    @classmethod
    def setUpClass(cls):
        cls.golden = _golden()

    def test_config_matches(self):
        self.assertEqual(importers.importer_config(), self.golden['config'])

    def test_fixtures_match(self):
        for name, exp in self.golden['fixtures'].items():
            with self.subTest(fixture=name):
                encoding, result = _parse_fixture(name)
                self.assertEqual(encoding, exp['encoding'])
                for key in ('format', 'delimiter', 'total', 'skipped', 'matched', 'ambiguous', 'unmatched', 'warnings'):
                    self.assertEqual(result[key], exp['result'][key], key)
                self.assertEqual(len(result['rows']), len(exp['result']['rows']))
                for got, want in zip(result['rows'], exp['result']['rows']):
                    self.assertEqual(got, want, want['name'])

    def test_every_sample_file_is_in_golden(self):
        files = sorted(p.name for p in SAMPLES.iterdir() if p.name != 'expected_import.json')
        self.assertEqual(files, sorted(self.golden['fixtures'].keys()))

    def test_errors(self):
        for i, (text, expected) in enumerate(ERROR_CASES):
            with self.subTest(case=i):
                with self.assertRaises(importers.MenuImportError) as ctx:
                    importers.parse_menu(text)
                self.assertEqual(ctx.exception.code, expected)
                self.assertEqual(self.golden['errors'][i]['code'], expected)

    def test_plans(self):
        cat = importers.catalog()
        for i, case in enumerate(PLAN_CASES):
            with self.subTest(case=i):
                _, result = _parse_fixture(case['fixture'])
                plan = importers.plan_import(result['rows'], case['choices'], cat, case['existing'], case['limit'])
                self.assertEqual(plan, self.golden['plans'][i]['plan'])

    def test_decode(self):
        for data, text, enc in DECODE_CHECKS:
            self.assertEqual(importers.decode_bytes(data), (text, enc))
        with self.assertRaises(importers.MenuImportError):
            importers.decode_bytes(b'x' * (importers.MAX_BYTES + 1))

    def test_deterministic(self):
        a = _parse_fixture('poster_products.json')
        b = _parse_fixture('poster_products.json')
        self.assertEqual(a, b)

    def test_control_chars_and_length_caps(self):
        text = 'Название;Цена\n' + '‮\x00Efes​ Pilsener 0,5;1 490,00\n' + ('Ш' * 300) + ';100\n'
        r = importers.parse_menu(text)
        self.assertEqual(r['rows'][0]['name'], 'Efes Pilsener 0,5')
        self.assertEqual(r['rows'][0]['ref_slug'], 'efes-pilsener')
        self.assertEqual(r['rows'][0]['volume'], '0.5 л')
        self.assertEqual(r['rows'][0]['price'], 1490)
        self.assertEqual(len(r['rows'][1]['name']), importers.MAX_NAME)


try:
    from django.test import TestCase as DjangoTestCase
except ImportError:      # pragma: no cover — запуск через unittest без Django
    DjangoTestCase = None

if DjangoTestCase:
    from django.test import Client

    class TestImportEndpoint(DjangoTestCase):
        """POST /api/cabinet/menu/import/: авторизация, лимиты, upsert без дублей."""

        def setUp(self):
            self.client = Client()
            res = self.client.post('/api/cabinet/register/', data=json.dumps({
                'email': 'import@test.kz', 'password': 'secret123', 'venue_name': 'Import Bar', 'tables': 3,
            }), content_type='application/json')
            self.assertEqual(res.status_code, 201, res.content)
            self.token = res.json()['token']
            self.limit = res.json()['limits']['items']

        def post(self, body, token=None, raw=None):
            return self.client.post('/api/cabinet/menu/import/', data=raw if raw is not None else json.dumps(body),
                                    content_type='application/json',
                                    HTTP_AUTHORIZATION=f'Bearer {token or self.token}')

        def test_requires_auth(self):
            res = self.client.post('/api/cabinet/menu/import/', data='{}', content_type='application/json')
            self.assertEqual(res.status_code, 401)
            self.assertEqual(self.post({'filename': 'a.csv', 'content': 'Название;Цена\nEfes;100'}, token='wrong').status_code, 401)

        def test_bad_payloads(self):
            self.assertEqual(self.post({}, raw='{not json').status_code, 400)
            self.assertEqual(self.post({'content': 123}).status_code, 400)
            res = self.post({'filename': '../../etc/passwd', 'content': '{"foo": 1}'})
            self.assertEqual(res.status_code, 400)
            self.assertEqual(res.json()['code'], 'unknown_format')
            self.assertNotIn('Traceback', res.content.decode())

        def test_import_upserts_and_respects_limit(self):
            content = (SAMPLES / 'poster_export_utf8_bom.csv').read_text(encoding='utf-8-sig')
            preview = self.post({'filename': 'menu.csv', 'content': content, 'dry_run': True})
            self.assertEqual(preview.status_code, 200, preview.content)
            self.assertEqual(preview.json()['format'], 'csv')
            self.assertFalse(preview.json().get('created'))

            res = self.post({'filename': 'menu.csv', 'content': content})
            self.assertEqual(res.status_code, 200, res.content)
            body = res.json()
            self.assertTrue(body['ok'])
            self.assertGreater(body['created'], 10)
            self.assertEqual(body['updated'], 0)
            self.assertLessEqual(body['used'], self.limit)
            first_used = body['used']

            menu = self.client.get('/api/cabinet/menu/', HTTP_AUTHORIZATION=f'Bearer {self.token}').json()
            efes = [b for b in menu['beers'] if b['ref_slug'] == 'efes-pilsener']
            self.assertEqual(len(efes), 1)                       # «Efes 0,5» и «Efes 0,3» → одна позиция, первая строка
            self.assertEqual(efes[0]['price'], 1600.0)
            self.assertEqual(efes[0]['volume'], '0.5 л')
            self.assertEqual(efes[0]['category'], 'Пиво разливное')
            self.assertEqual(efes[0]['name'], '')                # название совпало с каталожным — своё не нужно

            # повторный импорт с новой ценой обновляет, а не дублирует
            res2 = self.post({'filename': 'menu.csv', 'content': 'Название;Цена\nEfes Pilsener 0,5;1 750\nKozel тёмный;2 000\n',
                              'choices': {'1': ''}})
            self.assertEqual(res2.status_code, 200, res2.content)
            self.assertEqual(res2.json()['updated'], 1)
            self.assertEqual(res2.json()['created'], 0)
            self.assertEqual(res2.json()['skipped_by_user'], 1)
            menu = self.client.get('/api/cabinet/menu/', HTTP_AUTHORIZATION=f'Bearer {self.token}').json()
            self.assertEqual(menu['used'], first_used)
            self.assertEqual([b['price'] for b in menu['beers'] if b['ref_slug'] == 'efes-pilsener'], [1750.0])

        def test_limit_message(self):
            rows = '\n'.join(f'{n};1000' for n in ['Бешбармак', 'Казы', 'Шужык', 'Куырдак', 'Жая', 'Шашлык', 'Плов', 'Курт', 'Иримшик', 'Айран',
                                                     'Кумыс', 'Баурсаки', 'Самса', 'Манты', 'Пицца Маргарита', 'Паста Карбонара', 'Брускетта',
                                                     'Лазанья', 'Ризотто', 'Тирамису', 'Капрезе', 'Рамен', 'Эдамаме', 'Темпура', 'Якитори',
                                                     'Моти', 'Тонкацу', 'Бургер', 'Стейк', 'Начос', 'Брецель', 'Шницель', 'Карривурст', 'Штрудель',
                                                     'Чуррос', 'Энчилада', 'Буррито', 'Гуакамоле', 'Кесадилья', 'Тако', 'Чили кон карне', 'Братвурст',
                                                     'Квашеная капуста', 'Картофельный салат', 'Яблочный пирог'])
            res = self.post({'filename': 'x.csv', 'content': 'Название;Цена\n' + rows})
            self.assertEqual(res.status_code, 200, res.content)
            self.assertEqual(res.json()['created'], self.limit)
            self.assertEqual(res.json()['skipped_over_limit'], 45 - self.limit)
            self.assertEqual(res.json()['used'], self.limit)

        def test_request_too_big(self):
            res = self.client.post('/api/cabinet/menu/import/', data='{"content": ""}', content_type='application/json',
                                   HTTP_AUTHORIZATION=f'Bearer {self.token}', CONTENT_LENGTH=str(50 * 1024 * 1024))
            self.assertEqual(res.status_code, 413)

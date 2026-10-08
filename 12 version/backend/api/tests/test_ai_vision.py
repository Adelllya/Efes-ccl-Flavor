"""Тесты ИИ в панели и у гостя: блюда по фото, импорт пачкой, подбор сортов, пометка источника пары."""
import base64
import io
import json
import os
import uuid
from datetime import timedelta
from unittest.mock import patch

import anthropic
import httpx
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from PIL import Image

from api import ai_sommelier, ai_vision, pairing_rules
from api.models import AiUsage, Dish, FlavorNote, FlavorProfile, FoodPairing, MenuDrink, MenuItem
from .helpers import (
    make_user, client_for, make_brand, make_dish, make_pairing, make_venue, make_menu_item,
)

RECOGNIZE_URL = '/api/ai/dishes/recognize/'
IMPORT_URL = '/api/dishes/import/'
SUGGEST_URL = '/api/ai/pairings/suggest/'
PHOTO_URL = '/api/ai/sommelier/photo/'
NO_KEY = {'ANTHROPIC_API_KEY': ''}
WITH_KEY = {'ANTHROPIC_API_KEY': 'test-key-not-real'}


def photo(size=(64, 48), color=(200, 120, 40), fmt='JPEG', name='dish.jpg', content_type='image/jpeg'):
    buffer = io.BytesIO()
    Image.new('RGB', size, color).save(buffer, format=fmt)
    return SimpleUploadedFile(name, buffer.getvalue(), content_type=content_type)


def raw_dish(**extra):
    dish = {
        'name': 'Плов', 'category': 'Мясное', 'cuisine': 'OTHER', 'dominant_taste': 'UMAMI',
        'weight': 'HEAVY', 'fat_level': 'HIGH', 'cooking_method': 'FRIED',
        'description': 'Рис с бараниной, морковью и специями', 'confidence': 'HIGH',
        'section': '', 'portion': '', 'price': None, 'pairings': [],
    }
    dish.update(extra)
    return dish


class VisionBase(TestCase):
    def setUp(self):
        cache.clear()
        self.mod = make_user('mod', role='moderator')
        self.rest = make_user('rest', role='restaurant_admin')
        self.somm = make_user('somm', role='sommelier')
        self.user = make_user('plain')
        self.pils = make_brand('Efes Pilsener', style='Pilsner', abv=5.0)
        self.kozel = make_brand('Velkopopovický Kozel', style='Czech Lager', abv=None)
        self.los = make_brand('Хмельной Лось', style='Strong Lager', abv=7.3)
        self.hidden = make_brand('Снятый сорт', style='Lager', is_active=False)
        self.besh = make_dish('Бешбармак')

    def model_reply(self, **extra):
        data = {'kind': 'DISH', 'summary': 'На фото плов.', 'dishes': [raw_dish()]}
        data.update(extra)
        return json.dumps(data, ensure_ascii=False)


class EncodeImageTests(TestCase):
    def decode(self, data):
        return Image.open(io.BytesIO(base64.b64decode(data)))

    def test_downscale_and_jpeg(self):
        image = self.decode(ai_vision.encode_image(photo(size=(4000, 3000))))
        self.assertEqual(image.format, 'JPEG')
        self.assertEqual(image.size, (ai_vision.MAX_SIDE, 1536))

    def test_alpha_goes_on_white_and_small_stays(self):
        buffer = io.BytesIO()
        Image.new('RGBA', (40, 20), (0, 0, 0, 0)).save(buffer, format='PNG')
        image = self.decode(ai_vision.encode_image(SimpleUploadedFile('a.png', buffer.getvalue(), 'image/png')))
        self.assertEqual(image.size, (40, 20))
        self.assertEqual(image.mode, 'RGB')
        self.assertGreater(min(image.getpixel((5, 5))), 240)

    def test_exif_rotation_applied(self):
        buffer = io.BytesIO()
        exif = Image.Exif()
        exif[0x0112] = 6
        Image.new('RGB', (600, 300), (10, 10, 10)).save(buffer, format='JPEG', exif=exif)
        image = self.decode(ai_vision.encode_image(SimpleUploadedFile('p.jpg', buffer.getvalue(), 'image/jpeg')))
        self.assertEqual(image.size, (300, 600))

    def test_broken_file(self):
        with self.assertRaises(ai_vision.AiFailed) as caught:
            ai_vision.encode_image(SimpleUploadedFile('x.jpg', b'not an image', 'image/jpeg'))
        self.assertEqual(caught.exception.code, 'bad_image')


class CleanRecognitionTests(VisionBase):
    def clean(self, data):
        return ai_vision.clean_recognition(data, ai_vision.load_brands())

    def test_codes_names_and_duplicates(self):
        result = self.clean({'kind': 'DISH', 'summary': '  Плов и бешбармак  ', 'dishes': [
            raw_dish(name='  «Плов»  ', cuisine='UZBEK', dominant_taste='umami', price='oops'),
            raw_dish(name='плов'),
            raw_dish(name='Бешбармак.'),
            raw_dish(name='Бешбармяк'),
            raw_dish(name=''),
            'мусор',
        ]})
        self.assertEqual(result['kind'], 'DISH')
        self.assertEqual(result['summary'], 'Плов и бешбармак')
        self.assertEqual([d['name'] for d in result['dishes']], ['Плов', 'Бешбармак.', 'Бешбармяк'])
        plov, besh, typo = result['dishes']
        self.assertEqual(plov['cuisine'], 'OTHER')
        self.assertEqual(plov['dominant_taste'], 'UMAMI')
        self.assertIsNone(plov['price'])
        self.assertIsNone(plov['duplicate_of'])
        self.assertEqual(besh['duplicate_of'], {'id': str(self.besh.id), 'name': 'Бешбармак'})
        # Опечатка в названии всё равно находит блюдо каталога.
        self.assertEqual(typo['duplicate_of']['id'], str(self.besh.id))

    def test_pairings_only_from_catalog(self):
        result = self.clean({'kind': 'DISH', 'summary': '', 'dishes': [raw_dish(pairings=[
            {'brand_id': str(self.pils.id), 'score': 4, 'pairing_type': 'CLEANSE', 'explanation': 'Горечь смывает жир'},
            {'brand_id': str(self.pils.id), 'score': 5, 'pairing_type': 'CLEANSE', 'explanation': 'повтор'},
            {'brand_id': str(self.hidden.id), 'score': 5, 'pairing_type': 'CLEANSE', 'explanation': 'снят'},
            {'brand_id': str(uuid.uuid4()), 'score': 5, 'pairing_type': 'CLEANSE', 'explanation': 'нет такого'},
            {'brand_id': str(self.kozel.id), 'score': 9, 'pairing_type': 'CLEANSE', 'explanation': 'оценка вне шкалы'},
            {'brand_id': str(self.los.id), 'score': 3, 'pairing_type': 'WRONG', 'explanation': 'x' * 500},
        ])]})
        pairings = result['dishes'][0]['pairings']
        self.assertEqual([p['brand'] for p in pairings], [str(self.pils.id), str(self.los.id)])
        self.assertEqual(pairings[0], {
            'brand': str(self.pils.id), 'brand_name': 'Efes Pilsener', 'brand_style': 'Pilsner',
            'compatibility_score': 4, 'pairing_type': 'CLEANSE', 'explanation': 'Горечь смывает жир',
        })
        self.assertEqual(pairings[1]['pairing_type'], 'COMPLEMENT')
        self.assertEqual(len(pairings[1]['explanation']), 300)

    def test_dish_without_pairings_gets_rule_based_ones(self):
        result = self.clean({'kind': 'DISH', 'summary': '', 'dishes': [raw_dish()]})
        pairings = result['dishes'][0]['pairings']
        self.assertEqual(len(pairings), 3)
        for pairing in pairings:
            self.assertIn(pairing['brand'], [str(self.pils.id), str(self.kozel.id), str(self.los.id)])
            self.assertTrue(1 <= pairing['compatibility_score'] <= 5)
            self.assertTrue(pairing['explanation'])

    def test_menu_has_prices_and_no_pairings(self):
        result = self.clean({'kind': 'MENU', 'summary': 'Страница меню', 'dishes': [
            raw_dish(name='Лагман', section='Горячее', portion='350 г', price=2400,
                     pairings=[{'brand_id': str(self.pils.id), 'score': 4, 'pairing_type': 'CLEANSE', 'explanation': 'x'}]),
            raw_dish(name='Самса', price=-5),
            raw_dish(name='Чай', price=True),
        ]})
        self.assertEqual(result['kind'], 'MENU')
        lagman, samsa, tea = result['dishes']
        self.assertEqual((lagman['section'], lagman['portion'], lagman['price']), ('Горячее', '350 г', 2400))
        self.assertEqual(lagman['pairings'], [])
        self.assertIsNone(samsa['price'])
        self.assertIsNone(tea['price'])

    def test_limits_and_kind_fixups(self):
        many = self.clean({'kind': 'MENU', 'summary': '', 'dishes': [raw_dish(name='Блюдо %d' % i) for i in range(45)]})
        self.assertEqual(len(many['dishes']), ai_vision.MAX_DISHES)
        self.assertEqual(self.clean({'kind': 'DISH', 'summary': 'пусто', 'dishes': []})['kind'], 'OTHER')
        self.assertEqual(self.clean({'kind': 'OTHER', 'summary': '', 'dishes': [raw_dish()]})['kind'], 'DISH')
        self.assertEqual(self.clean({'kind': 'странное', 'dishes': 'не список'}), {'kind': 'OTHER', 'summary': '', 'dishes': []})


class RecognizeEndpointTests(VisionBase):
    def post(self, user, reply=None, env=WITH_KEY, **data):
        body = {'image': photo()}
        body.update(data)
        kwargs = {'side_effect': reply} if isinstance(reply, Exception) else {'return_value': reply or self.model_reply()}
        with patch.dict(os.environ, env), patch('api.ai_vision.call_claude_json', **kwargs) as mocked:
            resp = client_for(user).post(RECOGNIZE_URL, body, format='multipart')
        return resp, mocked

    def test_permissions(self):
        self.assertEqual(self.post(None)[0].status_code, 401)
        self.assertEqual(self.post(self.user)[0].status_code, 403)
        self.assertEqual(self.post(self.somm)[0].status_code, 403)
        self.assertEqual(self.post(self.rest)[0].status_code, 200)
        self.assertEqual(self.post(self.mod)[0].status_code, 200)

    def test_result_and_what_goes_to_the_model(self):
        resp, mocked = self.post(self.mod, hint='Это страница закусок')
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertEqual(data['kind'], 'DISH')
        self.assertEqual(data['mode'], 'claude')
        self.assertEqual(data['model'], ai_sommelier.ai_model())
        self.assertEqual(data['dishes'][0]['name'], 'Плов')
        self.assertEqual(len(data['dishes'][0]['pairings']), 3)
        # Ничего не сохранено: распознавание отдаёт только черновики.
        self.assertFalse(Dish.objects.filter(name='Плов').exists())

        system, content, schema = mocked.call_args[0][:3]
        self.assertEqual(mocked.call_args[0][3], 'low')
        self.assertIn('по фотографии определяешь блюда', system[0]['text'])
        self.assertEqual(system[1]['cache_control'], {'type': 'ephemeral'})
        self.assertIn(str(self.pils.id), system[1]['text'])
        self.assertNotIn(str(self.hidden.id), system[1]['text'])
        self.assertEqual(content[0]['type'], 'image')
        self.assertEqual(content[0]['source']['media_type'], 'image/jpeg')
        self.assertEqual(Image.open(io.BytesIO(base64.b64decode(content[0]['source']['data']))).size, (64, 48))
        self.assertIn('Это страница закусок', content[1]['text'])
        self.assertEqual(schema, ai_vision.RECOGNIZE_SCHEMA)

    def test_without_key_and_bad_file(self):
        resp, mocked = self.post(self.mod, env=NO_KEY)
        self.assertEqual(resp.status_code, 503)
        self.assertEqual(resp.json()['code'], 'ai_disabled')
        mocked.assert_not_called()
        with patch.dict(os.environ, WITH_KEY):
            client = client_for(self.mod)
            self.assertEqual(client.post(RECOGNIZE_URL, {}, format='multipart').status_code, 400)
            bad = SimpleUploadedFile('x.gif', b'GIF89a', 'image/gif')
            resp = client.post(RECOGNIZE_URL, {'image': bad}, format='multipart')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['detail'], 'Подходят только PNG, JPG или WebP')

    def test_model_failures_are_reported(self):
        request = httpx.Request('POST', 'https://api.anthropic.com/v1/messages')
        cases = (
            (ai_vision.AiFailed('refusal', 'ИИ отказался обрабатывать этот запрос'), 502, 'refusal'),
            (anthropic.APIConnectionError(request=request), 503, 'network'),
            (anthropic.APIStatusError('overloaded', response=httpx.Response(529, request=request), body=None), 503, 'busy'),
            (anthropic.APIStatusError('bad', response=httpx.Response(400, request=request), body=None), 502, 'rejected'),
        )
        for error, code, name in cases:
            resp, _ = self.post(self.mod, reply=error)
            self.assertEqual(resp.status_code, code, name)
            self.assertEqual(resp.json()['code'], name)
            self.assertTrue(resp.json()['detail'])
        resp, _ = self.post(self.mod, reply='это не json')
        self.assertEqual(resp.status_code, 502)
        self.assertEqual(resp.json()['code'], 'bad_response')

    def test_daily_limit(self):
        with patch.dict(os.environ, {'FT_AI_PANEL_DAILY_LIMIT': '2'}):
            codes = [self.post(self.mod, env=dict(WITH_KEY, FT_AI_PANEL_DAILY_LIMIT='2'))[0].status_code for _ in range(3)]
        self.assertEqual(codes, [200, 200, 429])
        usage = AiUsage.objects.get(kind=AiUsage.KIND_PANEL)
        self.assertEqual((usage.day, usage.count), (timezone.localdate(), 2))
        # Вчерашний расход сегодняшнему не мешает.
        AiUsage.objects.update(day=timezone.localdate() - timedelta(days=1))
        self.assertEqual(self.post(self.mod, env=dict(WITH_KEY, FT_AI_PANEL_DAILY_LIMIT='2'))[0].status_code, 200)


class ClaudeCallTests(TestCase):
    """Вызов SDK: поток, запасная модель, отказ и обрезанный ответ."""

    class FakeStream:
        def __init__(self, message):
            self.message = message

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get_final_message(self):
            return self.message

    class FakeMessages:
        def __init__(self, outcome, calls):
            self.outcome = outcome
            self.calls = calls

        def stream(self, **kwargs):
            self.calls.append(kwargs)
            if isinstance(self.outcome, Exception):
                raise self.outcome
            return ClaudeCallTests.FakeStream(self.outcome)

    class Message:
        def __init__(self, text='{"ok": true}', stop_reason='end_turn'):
            thinking = type('Block', (), {'type': 'thinking', 'thinking': ''})()
            block = type('Block', (), {'type': 'text', 'text': text})()
            self.content = [thinking, block] if text else [thinking]
            self.stop_reason = stop_reason

    def fake_client(self, beta_outcome, plain_outcome=None):
        beta_calls, plain_calls = [], []
        fake = type('Client', (), {})()
        fake.beta = type('Beta', (), {})()
        fake.beta.messages = self.FakeMessages(beta_outcome, beta_calls)
        fake.messages = self.FakeMessages(plain_outcome, plain_calls)
        return fake, beta_calls, plain_calls

    def call(self, fake):
        with patch.dict(os.environ, dict(WITH_KEY, FT_AI_MODEL='claude-opus-5-5')), \
                patch('api.ai_vision.anthropic.Anthropic', return_value=fake) as factory:
            text = ai_vision.call_claude_json([{'type': 'text', 'text': 'sys'}], [{'type': 'text', 'text': 'hi'}],
                                              {'type': 'object'}, effort='low')
        return text, factory

    def test_request_shape_with_fallbacks(self):
        fake, beta_calls, plain_calls = self.fake_client(self.Message())
        text, factory = self.call(fake)
        self.assertEqual(text, '{"ok": true}')
        self.assertEqual(factory.call_args[1], {'timeout': ai_vision.REQUEST_TIMEOUT, 'max_retries': ai_vision.MAX_RETRIES})
        self.assertEqual(plain_calls, [])
        params = beta_calls[0]
        self.assertEqual(params['model'], 'claude-opus-5-5')
        self.assertEqual(params['betas'], ['server-side-fallback-2026-07-01'])
        self.assertEqual(params['fallbacks'], 'default')
        self.assertEqual(params['output_config'], {'effort': 'low', 'format': {'type': 'json_schema', 'schema': {'type': 'object'}}})
        self.assertEqual(params['messages'], [{'role': 'user', 'content': [{'type': 'text', 'text': 'hi'}]}])
        self.assertNotIn('thinking', params)
        self.assertNotIn('temperature', params)

    def test_retry_without_fallbacks_when_beta_is_rejected(self):
        request = httpx.Request('POST', 'https://api.anthropic.com/v1/messages')
        rejected = anthropic.BadRequestError('unknown field', response=httpx.Response(400, request=request), body=None)
        fake, beta_calls, plain_calls = self.fake_client(rejected, self.Message('{"a": 1}'))
        text, _ = self.call(fake)
        self.assertEqual(text, '{"a": 1}')
        self.assertEqual(len(beta_calls), 1)
        self.assertEqual(len(plain_calls), 1)
        self.assertNotIn('fallbacks', plain_calls[0])
        self.assertNotIn('betas', plain_calls[0])

    def test_refusal_truncation_and_empty(self):
        for message, code in (
            (self.Message('', 'refusal'), 'refusal'),
            (self.Message('{"dishes": [', 'max_tokens'), 'too_long'),
            (self.Message(''), 'empty'),
        ):
            fake, _, _ = self.fake_client(message)
            with self.assertRaises(ai_vision.AiFailed) as caught:
                self.call(fake)
            self.assertEqual(caught.exception.code, code)


class ImportTests(VisionBase):
    def setUp(self):
        super().setUp()
        self.venue = make_venue(owner=self.rest)
        make_menu_item(self.venue, self.besh, price='4500', section='Горячее', sort_order=3)

    def item(self, **extra):
        item = {'name': 'Плов', 'category': 'Мясное', 'cuisine': 'OTHER', 'dominant_taste': 'UMAMI',
                'weight': 'HEAVY', 'fat_level': 'HIGH', 'cooking_method': 'FRIED', 'description': 'Рис с бараниной'}
        item.update(extra)
        return item

    def pairing(self, brand, score=4):
        return {'brand': str(brand.id), 'compatibility_score': score, 'pairing_type': 'CLEANSE', 'explanation': 'Горечь смывает жир'}

    def post(self, user, body):
        return client_for(user).post(IMPORT_URL, body, format='json')

    def test_permissions(self):
        body = {'items': [self.item()]}
        self.assertEqual(self.post(None, body).status_code, 401)
        self.assertEqual(self.post(self.user, body).status_code, 403)
        self.assertEqual(self.post(self.somm, body).status_code, 403)
        self.assertEqual(self.post(self.rest, body).status_code, 201)

    def test_catalog_import_with_ai_pairings(self):
        resp = self.post(self.mod, {'items': [
            self.item(pairings=[self.pairing(self.pils), self.pairing(self.pils, 5), self.pairing(self.los, 3)]),
            self.item(name='  плов '),
            self.item(name='Лагман', description='', category=''),
        ]})
        self.assertEqual(resp.status_code, 201, resp.content)
        data = resp.json()
        self.assertEqual((data['created'], data['reused'], data['menu_items'], data['pairings']), (2, 0, 0, 2))
        self.assertEqual([d['name'] for d in data['dishes']], ['Плов', 'Лагман'])
        self.assertEqual(data['dishes'][0]['pairings_count'], 2)
        plov = Dish.objects.get(name='Плов')
        self.assertEqual((plov.cuisine, plov.cooking_method, plov.description), ('OTHER', 'FRIED', 'Рис с бараниной'))
        self.assertEqual(Dish.objects.get(name='Лагман').category, 'Основное')
        pairs = list(FoodPairing.objects.filter(dish=plov).order_by('brand__name'))
        self.assertEqual([(p.brand_id, p.compatibility_score, p.source) for p in pairs],
                         [(self.pils.id, 4, 'AI'), (self.los.id, 3, 'AI')])

    def test_existing_dish_is_reused_and_pairings_need_a_sommelier(self):
        body = {'items': [
            {'dish': str(self.besh.id), 'pairings': [self.pairing(self.pils)]},
            self.item(name='бешбармак', pairings=[self.pairing(self.kozel)]),
            self.item(pairings=[self.pairing(self.pils)]),
        ]}
        resp = self.post(self.rest, body)
        self.assertEqual(resp.status_code, 201, resp.content)
        data = resp.json()
        self.assertEqual((data['created'], data['reused'], data['pairings']), (1, 2, 1))
        self.assertEqual([d.name for d in Dish.objects.all() if d.name.lower() == 'бешбармак'], ['Бешбармак'])
        self.assertFalse(FoodPairing.objects.filter(dish=self.besh).exists())
        self.assertTrue(any('добавляет сомелье' in w for w in data['warnings']))
        self.assertTrue(any('уже есть в каталоге' in w for w in data['warnings']))

        # Модератор может записать пару ИИ и к блюду из каталога; готовую пару импорт не трогает.
        make_pairing(self.kozel, self.besh, score=5, explanation='Слово сомелье')
        resp = self.post(self.mod, {'items': [
            {'dish': str(self.besh.id), 'pairings': [self.pairing(self.pils), self.pairing(self.kozel, 2)]}]})
        self.assertEqual(resp.json()['pairings'], 1)
        kozel = FoodPairing.objects.get(dish=self.besh, brand=self.kozel)
        self.assertEqual((kozel.compatibility_score, kozel.source), (5, 'SOMMELIER'))
        self.assertEqual(FoodPairing.objects.get(dish=self.besh, brand=self.pils).source, 'AI')

    def test_menu_import_sets_prices_sections_and_order(self):
        resp = self.post(self.rest, {'venue': self.venue.slug, 'items': [
            self.item(menu={'price': 3200, 'section': 'Горячее', 'portion': '350 г'}),
            self.item(name='Самса', menu={'price': '900.50', 'section': 'Выпечка', 'portion': ''}),
            self.item(name='Чак-чак', menu={'section': 'Выпечка'}),
            {'dish': str(self.besh.id), 'menu': {'price': 1, 'section': 'Горячее', 'portion': ''}},
            self.item(name='Только в каталог'),
        ]})
        self.assertEqual(resp.status_code, 201, resp.content)
        data = resp.json()
        self.assertEqual((data['created'], data['reused'], data['menu_items']), (4, 1, 3))
        self.assertTrue(any('уже стоит в меню' in w for w in data['warnings']))
        items = {i.dish.name: i for i in MenuItem.objects.filter(venue=self.venue).select_related('dish')}
        self.assertEqual(str(items['Бешбармак'].price), '4500.00')
        self.assertEqual((str(items['Плов'].price), items['Плов'].section, items['Плов'].portion, items['Плов'].sort_order),
                         ('3200.00', 'Горячее', '350 г', 4))
        # Новый раздел встаёт после всех старых позиций, вторая позиция раздела сразу за первой.
        self.assertEqual((str(items['Самса'].price), items['Самса'].sort_order), ('900.50', 5))
        self.assertEqual((str(items['Чак-чак'].price), items['Чак-чак'].sort_order), ('0.00', 6))
        self.assertNotIn('Только в каталог', items)
        self.assertEqual(data['dishes'][0]['menu_items_count'], 1)

    def test_foreign_venue_and_validation(self):
        other = make_venue('Чужой бар', owner=make_user('other', role='restaurant_admin'))
        resp = self.post(self.rest, {'venue': other.slug, 'items': [self.item(menu={'price': 100})]})
        self.assertEqual(resp.status_code, 400)
        self.assertIn('venue', resp.json())
        self.assertEqual(self.post(self.mod, {'venue': other.slug, 'items': [self.item(menu={'price': 100})]}).status_code, 201)
        self.assertEqual(self.post(self.mod, {'venue': 'no-such', 'items': [self.item(name='X')]}).status_code, 400)
        self.assertEqual(self.post(self.mod, {'items': []}).status_code, 400)
        self.assertEqual(self.post(self.mod, {'items': [self.item(name='N %d' % i) for i in range(61)]}).status_code, 400)

    def test_one_bad_row_saves_nothing(self):
        before = Dish.objects.count()
        for bad in (
            self.item(name=' '),
            self.item(name='Острое', dominant_taste='HOT'),
            self.item(name='Минус', menu={'price': -1}),
            self.item(name='Оценка', pairings=[self.pairing(self.pils, 6)]),
            self.item(name='Снятый', pairings=[self.pairing(self.hidden)]),
            {'dish': str(uuid.uuid4())},
        ):
            resp = self.post(self.mod, {'venue': self.venue.slug, 'items': [self.item(name='Хорошее'), bad]})
            self.assertEqual(resp.status_code, 400, bad)
        self.assertEqual(Dish.objects.count(), before)
        self.assertEqual(MenuItem.objects.filter(venue=self.venue).count(), 1)


class SuggestTests(VisionBase):
    def setUp(self):
        super().setUp()
        self.plov = make_dish('Плов', cooking_method='FRIED')
        self.wings = make_dish('Крылышки', dominant_taste='SPICY', weight='MEDIUM', fat_level='MEDIUM', cooking_method='FRIED')

    def post(self, user, body, reply=None, env=NO_KEY):
        kwargs = {'side_effect': reply} if isinstance(reply, Exception) else {'return_value': reply}
        with patch.dict(os.environ, env), patch('api.ai_vision.call_claude_json', **kwargs) as mocked:
            resp = client_for(user).post(SUGGEST_URL, body, format='json')
        return resp, mocked

    def test_permissions_and_validation(self):
        body = {'dishes': [str(self.plov.id)]}
        self.assertEqual(self.post(None, body)[0].status_code, 401)
        self.assertEqual(self.post(self.user, body)[0].status_code, 403)
        for user in (self.somm, self.rest, self.mod):
            self.assertEqual(self.post(user, body)[0].status_code, 200)
        self.assertEqual(self.post(self.mod, {'dishes': []})[0].status_code, 400)
        self.assertEqual(self.post(self.mod, {'dishes': ['not-uuid']})[0].status_code, 400)
        self.assertEqual(self.post(self.mod, {'dishes': [str(uuid.uuid4())]})[0].status_code, 404)
        self.assertEqual(self.post(self.mod, {'dishes': [str(uuid.uuid4()) for _ in range(13)]})[0].status_code, 400)

    def test_rules_without_key(self):
        make_pairing(self.kozel, self.plov, score=5)
        resp, mocked = self.post(self.somm, {'dishes': [str(self.plov.id), str(self.wings.id), str(self.plov.id)]})
        mocked.assert_not_called()
        data = resp.json()
        self.assertEqual((data['mode'], data['note'], data['saved']), ('local', '', 0))
        self.assertEqual([r['dish_name'] for r in data['results']], ['Плов', 'Крылышки'])
        plov, wings = data['results']
        self.assertTrue(plov['by_rules'])
        self.assertTrue(plov['can_save'])
        self.assertEqual(len(plov['pairings']), 3)
        self.assertEqual([p['exists'] for p in plov['pairings'] if p['brand'] == str(self.kozel.id)], [True])
        # К острому правила ставят первым самый мягкий сорт, а не крепкий и не горький.
        self.assertEqual(wings['pairings'][0]['brand'], str(self.kozel.id))
        self.assertEqual(wings['pairings'][0]['pairing_type'], 'CONTRAST')
        self.assertEqual(FoodPairing.objects.filter(source='AI').count(), 0)

    def model_reply(self):
        return json.dumps({'results': [
            {'dish_id': str(self.plov.id), 'analysis': 'Жирный рис с бараниной просит горечь и газ.', 'pairings': [
                {'brand_id': str(self.pils.id), 'score': 4, 'pairing_type': 'CLEANSE', 'explanation': 'Горечь режет жир баранины'},
                {'brand_id': str(self.hidden.id), 'score': 5, 'pairing_type': 'BRIDGE', 'explanation': 'снят'},
            ]},
            {'dish_id': str(uuid.uuid4()), 'analysis': 'чужое блюдо', 'pairings': []},
        ]}, ensure_ascii=False)

    def test_claude_reply_saved_as_ai(self):
        make_pairing(self.pils, self.wings, score=3)
        resp, mocked = self.post(self.mod, {'dishes': [str(self.plov.id), str(self.wings.id)], 'save': True},
                                 reply=self.model_reply(), env=WITH_KEY)
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertEqual((data['mode'], data['note']), ('claude', ''))
        plov, wings = data['results']
        self.assertFalse(plov['by_rules'])
        self.assertEqual(plov['analysis'], 'Жирный рис с бараниной просит горечь и газ.')
        self.assertEqual([(p['brand'], p['saved']) for p in plov['pairings']], [(str(self.pils.id), True)])
        # Про второе блюдо модель промолчала: его считаем по правилам.
        self.assertTrue(wings['by_rules'])
        saved = FoodPairing.objects.get(dish=self.plov)
        self.assertEqual((saved.brand_id, saved.source, saved.explanation), (self.pils.id, 'AI', 'Горечь режет жир баранины'))
        self.assertEqual(data['saved'], 1 + sum(1 for p in wings['pairings'] if p['saved']))
        self.assertEqual(FoodPairing.objects.get(dish=self.wings, brand=self.pils).source, 'SOMMELIER')

        system, content, schema = mocked.call_args[0][:3]
        self.assertIn('сомелье-аналитик', system[0]['text'])
        self.assertIn(str(self.plov.id) + ' | Плов', content[0]['text'])
        self.assertEqual(schema, ai_vision.SUGGEST_SCHEMA)
        self.assertEqual(AiUsage.objects.get(kind=AiUsage.KIND_PANEL).count, 1)

    def test_model_failure_falls_back_to_rules(self):
        request = httpx.Request('POST', 'https://api.anthropic.com/v1/messages')
        resp, _ = self.post(self.mod, {'dishes': [str(self.plov.id)]}, env=WITH_KEY,
                            reply=anthropic.APIConnectionError(request=request))
        data = resp.json()
        self.assertEqual((data['mode'], data['note']), ('local', ai_vision.LOCAL_NOTE))
        self.assertEqual(len(data['results'][0]['pairings']), 3)

    def test_restaurant_admin_saves_only_for_own_dishes(self):
        venue = make_venue(owner=self.rest)
        other = make_venue('Чужой бар', owner=make_user('other', role='restaurant_admin'))
        make_menu_item(venue, self.plov)
        make_menu_item(venue, self.wings)
        make_menu_item(other, self.wings)
        resp, _ = self.post(self.rest, {'dishes': [str(self.plov.id), str(self.wings.id), str(self.besh.id)], 'save': True})
        data = resp.json()
        self.assertEqual([r['can_save'] for r in data['results']], [True, False, False])
        self.assertEqual(data['saved'], 3)
        self.assertEqual(FoodPairing.objects.filter(dish=self.plov, source='AI').count(), 3)
        self.assertFalse(FoodPairing.objects.filter(dish__in=[self.wings, self.besh]).exists())


class PairingSaveTests(VisionBase):
    URL = '/api/ai/pairings/save/'

    def item(self, dish, brand, score=4):
        return {'dish': str(dish.id), 'brand': str(brand.id), 'compatibility_score': score,
                'pairing_type': 'CLEANSE', 'explanation': 'Горечь смывает жир'}

    def test_sommelier_accepts_and_restaurant_admin_keeps_the_ai_label(self):
        plov = make_dish('Плов')
        venue = make_venue(owner=self.rest)
        make_menu_item(venue, plov)
        make_pairing(self.kozel, plov, score=5)
        body = {'items': [self.item(plov, self.pils), self.item(plov, self.kozel, 2), self.item(self.besh, self.pils)]}

        self.assertEqual(client_for().post(self.URL, body, format='json').status_code, 401)
        self.assertEqual(client_for(self.user).post(self.URL, body, format='json').status_code, 403)

        resp = client_for(self.rest).post(self.URL, body, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        # Своё блюдо из меню: пара записана как ИИ-подбор. Готовая пара и чужое блюдо пропущены.
        self.assertEqual((resp.json()['saved'], resp.json()['skipped']), (1, 2))
        self.assertEqual(resp.json()['pairings'][0]['source'], 'AI')
        self.assertEqual(FoodPairing.objects.get(dish=plov, brand=self.kozel).compatibility_score, 5)
        self.assertFalse(FoodPairing.objects.filter(dish=self.besh).exists())

        resp = client_for(self.somm).post(self.URL, {'items': [self.item(self.besh, self.pils)]}, format='json')
        self.assertEqual((resp.status_code, resp.json()['saved']), (201, 1))
        self.assertEqual(FoodPairing.objects.get(dish=self.besh).source, 'SOMMELIER')
        # Повтор ничего не дублирует.
        resp = client_for(self.somm).post(self.URL, {'items': [self.item(self.besh, self.pils)]}, format='json')
        self.assertEqual((resp.status_code, resp.json()['saved'], resp.json()['skipped']), (200, 0, 1))

    def test_validation(self):
        client = client_for(self.mod)
        self.assertEqual(client.post(self.URL, {'items': []}, format='json').status_code, 400)
        self.assertEqual(client.post(self.URL, {'items': [self.item(self.besh, self.hidden)]}, format='json').status_code, 400)
        self.assertEqual(client.post(self.URL, {'items': [self.item(self.besh, self.pils, 7)]}, format='json').status_code, 400)
        self.assertFalse(FoodPairing.objects.exists())


class GuestPhotoTests(VisionBase):
    def setUp(self):
        super().setUp()
        self.venue = make_venue(owner=self.rest)
        self.item = make_menu_item(self.venue, self.besh, price='4500', portion='400 г')
        self.bar_pils = MenuDrink.objects.create(venue=self.venue, brand=self.pils, price='1200', volume='0,5 л')
        self.bar_kozel = MenuDrink.objects.create(venue=self.venue, brand=self.kozel, price='2200', volume='0,5 л')
        make_pairing(self.kozel, self.besh, score=5, explanation='Плотная солодовая база отзеркаливает умами варёного мяса')
        make_pairing(self.los, self.besh, score=4, explanation='Крепость держит жир')

    def post(self, reply=None, env=WITH_KEY, user=None, **data):
        body = {'image': photo()}
        body.update(data)
        kwargs = {'side_effect': reply} if isinstance(reply, Exception) else {'return_value': reply or self.model_reply()}
        with patch.dict(os.environ, env), patch('api.ai_vision.call_claude_json', **kwargs) as mocked:
            resp = client_for(user).post(PHOTO_URL, body, format='multipart')
        return resp, mocked

    def test_without_key_chat_asks_for_the_name(self):
        resp, mocked = self.post(env=NO_KEY)
        self.assertEqual(resp.status_code, 200)
        mocked.assert_not_called()
        self.assertEqual(resp.json(), {'reply': ai_sommelier.PHOTO_OFF_REPLY, 'suggestions': [], 'mode': 'local', 'note': '', 'dish': None})

    def test_known_dish_in_venue_gets_the_sommelier_pairing_first(self):
        reply = self.model_reply(dishes=[raw_dish(name='Бешбармак', pairings=[
            {'brand_id': str(self.pils.id), 'score': 4, 'pairing_type': 'CLEANSE', 'explanation': 'Горечь смывает жир'}])])
        resp, mocked = self.post(reply, venue=self.venue.slug)
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertEqual(data['mode'], 'claude')
        self.assertEqual(data['dish'], {'name': 'Бешбармак', 'confidence': 'HIGH'})
        self.assertIn('На фото Бешбармак.', data['reply'])
        self.assertIn('Kozel', data['reply'])
        self.assertIn('пара от нашего сомелье, оценка 5 из 5', data['reply'])
        # Лось есть в каталоге, но не в карте бара: его не советуем. Дальше идёт подбор ИИ из карты.
        self.assertEqual([(s['kind'], s['id'], s['score'], s['pairs_with']) for s in data['suggestions']], [
            ('DRINK', str(self.bar_kozel.id), 5, str(self.item.id)),
            ('DRINK', str(self.bar_pils.id), 4, str(self.item.id)),
        ])
        self.assertEqual(data['suggestions'][0]['subtitle'], 'Czech Lager · 0,5 л · 2 200 ₸')
        # В модель ушли только сорта из карты бара.
        catalog = mocked.call_args[0][0][1]['text']
        self.assertIn(str(self.pils.id), catalog)
        self.assertNotIn(str(self.los.id), catalog)
        self.assertEqual(AiUsage.objects.get(kind=AiUsage.KIND_GUEST).count, 1)

    def test_unknown_dish_in_catalog_mode_and_prefs(self):
        reply = self.model_reply(dishes=[raw_dish(confidence='MEDIUM', pairings=[
            {'brand_id': str(self.pils.id), 'score': 4, 'pairing_type': 'CLEANSE', 'explanation': 'Горечь смывает жир'},
            {'brand_id': str(self.kozel.id), 'score': 3, 'pairing_type': 'COMPLEMENT', 'explanation': 'Мягкий солод рядом с рисом'}])])
        data = self.post(reply)[0].json()
        self.assertIn('Не уверен, но на фото похоже на «Плов»', data['reply'])
        # Без заведения карточки - напитки каталога движка; сорт каталога за ними в поле brand.
        self.assertEqual([s['brand'] for s in data['suggestions']], [str(self.pils.id), str(self.kozel.id)])
        self.assertIsNone(data['suggestions'][0]['pairs_with'])

        resp, mocked = self.post(reply, prefs=json.dumps({'no_bitter': True}))
        self.assertEqual([s['brand'] for s in resp.json()['suggestions']], [str(self.kozel.id)])
        self.assertNotIn(str(self.pils.id), mocked.call_args[0][0][1]['text'])

    def test_menu_page_unclear_photo_and_errors(self):
        menu = self.model_reply(kind='MENU', dishes=[raw_dish(name='Лагман'), raw_dish(name='Самса')])
        data = self.post(menu)[0].json()
        self.assertIn('страницу меню: Лагман, Самса', data['reply'])
        self.assertEqual(data['suggestions'], [])
        data = self.post(self.model_reply(kind='OTHER', dishes=[]))[0].json()
        self.assertEqual(data['reply'], ai_sommelier.PHOTO_UNCLEAR_REPLY)
        self.assertEqual(self.post(venue='no-such-bar')[0].status_code, 404)
        resp, _ = self.post(ai_vision.AiFailed('refusal', 'ИИ отказался обрабатывать этот запрос'))
        self.assertEqual(resp.status_code, 502)
        with patch.dict(os.environ, WITH_KEY):
            self.assertEqual(client_for().post(PHOTO_URL, {}, format='multipart').status_code, 400)

    def test_guest_daily_limit(self):
        env = dict(WITH_KEY, FT_AI_GUEST_DAILY_LIMIT='1')
        with patch.dict(os.environ, env):
            self.assertEqual(self.post(env=env)[0].status_code, 200)
            resp = self.post(env=env)[0]
        self.assertEqual(resp.status_code, 429)
        self.assertEqual(resp.json()['code'], 'ai_budget')


class PairingSourceTests(VisionBase):
    def body(self, **extra):
        body = {'brand': str(self.pils.id), 'dish': str(self.besh.id), 'compatibility_score': 4,
                'pairing_type': 'CLEANSE', 'explanation': 'Освежает'}
        body.update(extra)
        return body

    def test_source_is_set_by_server_and_confirmed_by_edit(self):
        client = client_for(self.somm)
        resp = client.post('/api/pairings/', self.body(source='AI'), format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual((resp.data['source'], resp.data['source_display']), ('SOMMELIER', 'Сомелье'))

        ai = FoodPairing.objects.create(brand=self.kozel, dish=self.besh, compatibility_score=3,
                                        pairing_type='COMPLEMENT', explanation='ИИ', source='AI')
        listed = client_for().get('/api/pairings/?source=AI').json()['results']
        self.assertEqual([p['id'] for p in listed], [str(ai.id)])
        self.assertEqual(listed[0]['source_display'], 'ИИ-подбор')
        # Подтверждение без правок: пустой PATCH от сомелье.
        resp = client.patch(f'/api/pairings/{ai.id}/', {}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['source'], 'SOMMELIER')

    def test_duplicates_and_score_range(self):
        client = client_for(self.somm)
        self.assertEqual(client.post('/api/pairings/', self.body(), format='json').status_code, 201)
        resp = client.post('/api/pairings/', self.body(), format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('dish', resp.json())
        for score in (0, 6, 80):
            resp = client.post('/api/pairings/', self.body(brand=str(self.kozel.id), compatibility_score=score), format='json')
            self.assertEqual(resp.status_code, 400, score)
        other = client.post('/api/pairings/', self.body(brand=str(self.kozel.id)), format='json').data['id']
        # Правка не должна превращать пару в повтор другой, а сама себя парой-повтором не считает.
        self.assertEqual(client.patch(f'/api/pairings/{other}/', {'brand': str(self.pils.id)}, format='json').status_code, 400)
        self.assertEqual(client.patch(f'/api/pairings/{other}/', {'compatibility_score': 5}, format='json').status_code, 200)

    def test_inactive_brand_pairings_hidden_from_guests(self):
        make_pairing(self.hidden, self.besh)
        make_pairing(self.pils, self.besh)
        self.assertEqual(client_for().get('/api/pairings/').json()['count'], 1)
        self.assertEqual(client_for(self.somm).get('/api/pairings/').json()['count'], 2)

    def test_menu_prefers_the_sommelier_over_a_higher_ai_score(self):
        venue = make_venue(owner=self.rest)
        make_menu_item(venue, self.besh)
        MenuDrink.objects.create(venue=venue, brand=self.pils, price='1200', volume='0,5 л')
        MenuDrink.objects.create(venue=venue, brand=self.kozel, price='2200', volume='0,5 л')
        make_pairing(self.kozel, self.besh, score=3, explanation='Слово сомелье')
        FoodPairing.objects.create(brand=self.pils, dish=self.besh, compatibility_score=5,
                                   pairing_type='CLEANSE', explanation='ИИ', source='AI')
        entry = client_for().get('/api/venues/efes-beer-garden/menu/').json()['sections'][0]['items'][0]
        self.assertEqual(entry['pairing']['brand_name'], 'Velkopopovický Kozel')

        # Сочетания из базы для сомелье: слово человека раньше подбора ИИ, даже с меньшей оценкой.
        ctx = ai_sommelier.build_context(venue=venue)
        ranked = sorted(ctx['pairings_by_dish'][str(self.besh.id)], key=ai_sommelier.pairing_rank)
        self.assertEqual([(p['brand_name'], p['source']) for p in ranked],
                         [('Velkopopovický Kozel', 'SOMMELIER'), ('Efes Pilsener', 'AI')])


class PairingRulesTests(TestCase):
    def brands(self):
        pils = make_brand('Efes Pilsener', style='Pilsner', abv=5.0)
        dark = make_brand('Тёмное бархатное', style='Dunkel', abv=5.5)
        strong = make_brand('Хмельной Лось', style='Strong Lager', abv=7.3)
        rice = make_brand('Wukong', style='Rice Beer', abv=4.2)
        return [(b, pairing_rules.beer_profile(b, [])) for b in (pils, dark, strong, rice)]

    def top(self, brands, **dish):
        return pairing_rules.rank_brands(dish, brands, limit=1)[0]

    def test_classic_rules(self):
        brands = self.brands()
        fried = self.top(brands, name='Картофель фри', taste='SALTY', weight='MEDIUM', fat='HIGH', cooking='FRIED')
        self.assertEqual((fried['brand'].name, fried['pairing_type']), ('Efes Pilsener', 'CLEANSE'))
        dessert = self.top(brands, name='Штрудель', category='Десерт', taste='SWEET', weight='MEDIUM', fat='MEDIUM', cooking='BAKED')
        self.assertEqual(dessert['brand'].name, 'Тёмное бархатное')
        sushi = self.top(brands, name='Суши', taste='UMAMI', weight='LIGHT', fat='LOW', cooking='RAW')
        self.assertEqual(sushi['brand'].name, 'Wukong')
        # Острое без жарки: мягкий солод гасит жжение, а горечь и крепость его разгоняют.
        spicy = self.top(brands, name='Карри', taste='SPICY', weight='MEDIUM', fat='LOW', cooking='BOILED')
        self.assertEqual((spicy['brand'].name, spicy['pairing_type']), ('Тёмное бархатное', 'CONTRAST'))
        for pick in (fried, dessert, sushi, spicy):
            self.assertTrue(1 <= pick['score'] <= 5)
            self.assertTrue(pick['explanation'])

    def test_profile_uses_abv_and_notes(self):
        strong = make_brand('Крепкое', style='Lager', abv=8.0)
        light = make_brand('Лёгкое', style='Lager', abv=3.5)
        self.assertGreater(pairing_rules.beer_profile(strong, [])['body'], pairing_rules.beer_profile(light, [])['body'])
        note = FlavorNote.objects.create(name='Хмелевая горчинка', category='BASE', description='Горечь', icon='x')
        FlavorProfile.objects.create(brand=light, flavor_note=note, layer='BASE', intensity=9)
        self.assertGreater(pairing_rules.beer_profile(light)['bitterness'], pairing_rules.beer_profile(light, [])['bitterness'])
        self.assertEqual(pairing_rules.rating_of(0), 1)
        self.assertEqual(pairing_rules.rating_of(100), 5)

    def test_order_is_stable(self):
        brands = self.brands()
        dish = {'name': 'Что-то', 'taste': 'MIXED', 'weight': 'MEDIUM', 'fat': 'MEDIUM', 'cooking': 'OTHER'}
        first = [r['brand'].name for r in pairing_rules.rank_brands(dish, brands, limit=4)]
        second = [r['brand'].name for r in pairing_rules.rank_brands(dish, list(reversed(brands)), limit=4)]
        self.assertEqual(first, second)

"""Тесты ИИ-сомелье: статус, локальный подбор, проверка запроса, путь через Claude с замоканным SDK."""
import json
import os
import uuid
from unittest.mock import patch

import anthropic
try:
    # anthropic 1.x (его ставит requirements.txt) работает на httpx2, 0.x - на httpx
    import httpx2 as httpx
except ImportError:
    import httpx
from django.conf import settings
from django.core.cache import cache
from django.test import TestCase

from api import ai_sommelier
from api.models import MenuDrink, Venue
from api.views_ai import AiAnonThrottle, AiUserThrottle
from .helpers import (
    make_user, client_for, make_brand, make_dish, make_pairing, make_venue, make_menu_item,
)

URL = '/api/ai/sommelier/'
STATUS_URL = '/api/ai/status/'
NO_KEY = {'ANTHROPIC_API_KEY': ''}
WITH_KEY = {'ANTHROPIC_API_KEY': 'test-key-not-real'}


class AiTestsBase(TestCase):
    def setUp(self):
        cache.clear()  # счётчики throttle живут в кэше
        self.owner = make_user('rest', role='restaurant_admin')
        self.venue = make_venue(owner=self.owner)
        self.besh = make_menu_item(
            self.venue, make_dish('Бешбармак'), price='4500', section='Горячее', portion='400 г', sort_order=0)
        self.manty = make_menu_item(
            self.venue, make_dish('Манты', cooking_method='STEAMED'), price='2600', section='Горячее', sort_order=1)
        self.kazy = make_menu_item(
            self.venue, make_dish('Казы', dominant_taste='SALTY', cooking_method='CURED'),
            price='5200', section='Гриль', portion='200 г', sort_order=10)
        self.tiramisu = make_menu_item(
            self.venue,
            make_dish('Тирамису', cuisine='ITALIAN', dominant_taste='SWEET', weight='MEDIUM',
                      fat_level='MEDIUM', cooking_method='OTHER'),
            price='2100', section='Десерты', portion='150 г', sort_order=30)
        self.kozel_brand = make_brand('Velkopopovický Kozel', style='Czech Lager', abv=None)
        self.efes_brand = make_brand('Efes Pilsener', style='Pilsner', abv=5.0)
        self.los_brand = make_brand('Хмельной Лось', style='Strong Lager', abv=7.3)
        # Сорт из каталога, которого нет в карте бара.
        self.bear = make_brand('Белый Медведь', style='Lager', abv=4.8)
        self.efes = MenuDrink.objects.create(venue=self.venue, brand=self.efes_brand, price='1200', volume='0,5 л', sort_order=0)
        self.kozel = MenuDrink.objects.create(venue=self.venue, brand=self.kozel_brand, price='2200', volume='0,5 л', sort_order=4)
        self.los = MenuDrink.objects.create(venue=self.venue, brand=self.los_brand, price='1900', volume='0,5 л', sort_order=5)
        make_pairing(self.kozel_brand, self.besh.dish, score=5,
                     explanation='Плотная солодовая база отзеркаливает умами варёного мяса')
        make_pairing(self.efes_brand, self.kazy.dish, score=5, pairing_type='CONTRAST',
                     explanation='Горечь пильзнера режет жирность вяленого мяса')
        make_pairing(self.kozel_brand, self.kazy.dish, score=3, explanation='Мягкий солод рядом с казы')
        make_pairing(self.bear, self.manty.dish, score=4, explanation='Лёгкий лагер к мантам')

    def ask(self, text, venue='efes-beer-garden', **extra):
        body = {'venue': venue, 'messages': [{'role': 'user', 'content': text}]}
        body.update(extra)
        with patch.dict(os.environ, NO_KEY):
            return client_for().post(URL, body, format='json')


class AiStatusTests(AiTestsBase):
    def test_status_without_key(self):
        with patch.dict(os.environ, {'ANTHROPIC_API_KEY': '', 'FT_AI_MODEL': 'claude-opus-5'}):
            resp = client_for().get(STATUS_URL)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {'enabled': False, 'model': 'claude-opus-5', 'mode': 'local'})

    def test_status_with_key_and_model_override(self):
        with patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'test-key', 'FT_AI_MODEL': 'claude-sonnet-5'}):
            data = client_for().get(STATUS_URL).json()
        self.assertEqual(data, {'enabled': True, 'model': 'claude-sonnet-5', 'mode': 'claude'})


class LocalSommelierTests(AiTestsBase):
    def test_drink_for_named_dish(self):
        resp = self.ask('что взять к бешбармаку', table=7)
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertEqual(data['mode'], 'local')
        self.assertEqual(data['note'], '')
        self.assertIn('Kozel', data['reply'])
        self.assertIn('2 200 ₸', data['reply'])
        self.assertEqual(data['suggestions'], [{
            'kind': 'DRINK',
            'id': str(self.kozel.id),
            'title': 'Velkopopovický Kozel',
            'subtitle': 'Czech Lager · 0,5 л · 2 200 ₸',
            'reason': 'Плотная солодовая база отзеркаливает умами варёного мяса',
            'score': 5,
            'pairs_with': str(self.besh.id),
        }])

    def test_cart_dish_is_used_when_question_names_none(self):
        cart = [{'kind': 'DISH', 'id': str(self.besh.id), 'title': 'Бешбармак', 'qty': 2}]
        data = self.ask('что взять к моему заказу', cart=cart).json()
        self.assertIn('из вашего заказа', data['reply'])
        self.assertEqual([s['id'] for s in data['suggestions']], [str(self.kozel.id)])
        self.assertEqual(data['suggestions'][0]['pairs_with'], str(self.besh.id))

    def test_no_bitter_pref_filters_pilsner(self):
        plain = self.ask('что взять к казы').json()
        self.assertEqual([s['id'] for s in plain['suggestions']], [str(self.efes.id)])
        self.assertEqual(plain['suggestions'][0]['score'], 5)

        filtered = self.ask('что взять к казы', prefs={'no_bitter': True}).json()
        self.assertEqual([s['id'] for s in filtered['suggestions']], [str(self.kozel.id)])
        self.assertEqual(filtered['suggestions'][0]['score'], 3)

        # Пожелание словами работает так же, как переключатель.
        spoken = self.ask('не люблю горькое, что взять к казы').json()
        self.assertEqual([s['id'] for s in spoken['suggestions']], [str(self.kozel.id)])

    def test_light_wish_prefers_lightest_drinks(self):
        data = self.ask('Хочу что-то лёгкое').json()
        drinks = [s['id'] for s in data['suggestions'] if s['kind'] == 'DRINK']
        self.assertEqual(drinks, [str(self.efes.id), str(self.kozel.id)])
        self.assertIn('?', data['reply'])

    def test_no_bitter_wish_without_dish(self):
        data = self.ask('Не люблю горькое').json()
        ids = [s['id'] for s in data['suggestions']]
        self.assertNotIn(str(self.efes.id), ids)
        self.assertEqual(ids[0], str(self.kozel.id))

    def test_no_alcohol_without_zero_drinks(self):
        data = self.ask('что взять к бешбармаку', prefs={'no_alcohol': True}).json()
        self.assertEqual(data['suggestions'], [])
        self.assertIn('Безалкогольных', data['reply'])
        spoken = self.ask('есть что-то без алкоголя?').json()
        self.assertEqual(spoken['suggestions'], [])
        self.assertIn('Безалкогольных', spoken['reply'])

    def test_advice_gives_popular_dishes_with_drinks(self):
        data = self.ask('Посоветуй ужин на двоих').json()
        kinds = [(s['kind'], s['title']) for s in data['suggestions']]
        self.assertEqual(kinds, [
            ('DISH', 'Бешбармак'), ('DRINK', 'Velkopopovický Kozel'),
            ('DISH', 'Казы'), ('DRINK', 'Efes Pilsener'),
        ])
        self.assertEqual(data['suggestions'][0]['subtitle'], '400 г · 4 500 ₸')
        self.assertIsNone(data['suggestions'][0]['score'])
        self.assertEqual(data['suggestions'][1]['pairs_with'], str(self.besh.id))
        self.assertEqual(data['suggestions'][1]['score'], 5)

    def test_dessert_wish(self):
        data = self.ask('а что на десерт?').json()
        self.assertEqual(data['suggestions'][0]['id'], str(self.tiramisu.id))
        self.assertIn('Тирамису', data['reply'])
        drink = data['suggestions'][-1]
        self.assertEqual(drink['kind'], 'DRINK')
        self.assertEqual(drink['pairs_with'], str(self.tiramisu.id))

    def test_unclear_question_asks_back(self):
        data = self.ask('хм, даже не знаю').json()
        self.assertIn('?', data['reply'])
        self.assertTrue(data['suggestions'])

    def test_greeting_explains_what_it_can_do(self):
        data = self.ask('привет').json()
        self.assertIn('сомелье', data['reply'].lower())
        self.assertEqual(data['suggestions'], [])

    def test_sad_message_gets_warm_reply_with_comfort(self):
        data = self.ask('я рассталась с парнем').json()
        self.assertIn('Сочувствую', data['reply'])
        kinds = [x['kind'] for x in data['suggestions']]
        self.assertIn('DISH', kinds)
        self.assertIn('DRINK', kinds)

    def test_celebration_gets_festive_reply(self):
        data = self.ask('у меня сегодня день рождения').json()
        self.assertIn('Поздравляю', data['reply'])
        self.assertTrue(data['suggestions'])

    def test_thanks_gets_short_reply(self):
        data = self.ask('спасибо большое').json()
        self.assertEqual(data['suggestions'], [])
        self.assertIn('Рад помочь', data['reply'])

    def test_wish_beats_mood(self):
        data = self.ask('устала, хочу что-то лёгкое').json()
        self.assertNotIn('Сочувствую', data['reply'])
        self.assertTrue(any(x['kind'] == 'DRINK' for x in data['suggestions']))

    def test_catalog_mode_uses_catalog_ids(self):
        data = self.ask('что взять к бешбармаку', venue=None).json()
        self.assertEqual(data['mode'], 'local')
        suggestion = data['suggestions'][0]
        self.assertEqual(suggestion['id'], str(self.kozel_brand.id))
        self.assertEqual(suggestion['subtitle'], 'Czech Lager')
        self.assertEqual(suggestion['pairs_with'], str(self.besh.dish_id))
        self.assertEqual(suggestion['score'], 5)

        # В каталоге доступен сорт, которого нет в карте бара.
        catalog = self.ask('что к мантам', venue=None).json()
        self.assertEqual(catalog['suggestions'][0]['id'], str(self.bear.id))
        # В заведении его нет: срабатывает эвристика по весу блюда, оценки нет.
        venue = self.ask('что к мантам').json()
        self.assertEqual(venue['suggestions'][0]['id'], str(self.los.id))
        self.assertIsNone(venue['suggestions'][0]['score'])

    def test_unavailable_drink_is_skipped(self):
        self.kozel.is_available = False
        self.kozel.save()
        data = self.ask('что взять к бешбармаку').json()
        self.assertNotIn(str(self.kozel.id), [s['id'] for s in data['suggestions']])
        self.assertTrue(data['suggestions'])


class AiRequestValidationTests(AiTestsBase):
    def post(self, body):
        with patch.dict(os.environ, NO_KEY):
            return client_for().post(URL, body, format='json')

    def test_messages_required(self):
        self.assertEqual(self.post({}).status_code, 400)
        resp = self.post({'venue': None, 'messages': []})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json(), {'messages': ['Напишите сообщение']})

    def test_last_message_must_be_user(self):
        resp = self.post({'messages': [
            {'role': 'user', 'content': 'привет'}, {'role': 'assistant', 'content': 'здравствуйте'},
        ]})
        self.assertEqual(resp.status_code, 400)
        self.assertIn('messages', resp.json())

    def test_message_too_long(self):
        resp = self.post({'messages': [{'role': 'user', 'content': 'а' * 1501}]})
        self.assertEqual(resp.status_code, 400)
        ok = self.post({'messages': [{'role': 'user', 'content': 'а' * 1500}]})
        self.assertEqual(ok.status_code, 200, ok.content)

    def test_too_many_turns(self):
        turns = [{'role': 'user' if i % 2 == 0 else 'assistant', 'content': 'x'} for i in range(12)]
        turns.append({'role': 'user', 'content': 'ещё'})
        self.assertEqual(self.post({'messages': turns}).status_code, 400)

    def test_bad_role_and_bad_cart(self):
        resp = self.post({'messages': [{'role': 'system', 'content': 'x'}]})
        self.assertEqual(resp.status_code, 400)
        resp = self.post({'messages': [{'role': 'user', 'content': 'x'}], 'cart': [{'kind': 'DISH', 'id': 'not-uuid'}]})
        self.assertEqual(resp.status_code, 400)

    def test_unknown_venue(self):
        resp = self.post({'venue': 'no-such-bar', 'messages': [{'role': 'user', 'content': 'привет'}]})
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.json(), {'detail': 'Заведение не найдено'})

    def test_unpublished_venue_hidden_for_guest(self):
        other = make_user('other', role='restaurant_admin')
        hidden = make_venue('Скрытый бар', owner=other, is_published=False)
        body = {'venue': hidden.slug, 'messages': [{'role': 'user', 'content': 'привет'}]}
        self.assertEqual(self.post(body).status_code, 404)
        with patch.dict(os.environ, NO_KEY):
            self.assertEqual(client_for(other).post(URL, body, format='json').status_code, 200)


class ClaudePathTests(AiTestsBase):
    def ask_claude(self, text, reply, **extra):
        body = {'venue': 'efes-beer-garden', 'messages': [{'role': 'user', 'content': text}]}
        body.update(extra)
        kwargs = {'side_effect': reply} if isinstance(reply, Exception) else {'return_value': reply}
        with patch.dict(os.environ, WITH_KEY), patch('api.ai_sommelier.call_claude', **kwargs) as mocked:
            resp = client_for().post(URL, body, format='json')
        return resp, mocked

    def test_claude_reply_with_validated_suggestions(self):
        payload = json.dumps({'reply': 'К бешбармаку возьмите Kozel.', 'suggestions': [
            {'kind': 'DRINK', 'id': str(self.kozel.id), 'title': 'Выдуманное имя', 'subtitle': '999 ₸',
             'score': 1, 'reason': 'Солод к мясу', 'pairs_with': str(self.besh.id)},
            {'kind': 'DRINK', 'id': str(uuid.uuid4()), 'reason': 'такого нет'},
            {'kind': 'DISH', 'id': str(self.kozel.id)},
            {'kind': 'DRINK', 'id': str(self.kozel.id)},
            {'kind': 'DISH', 'id': str(self.kazy.id), 'reason': 'Хорошо к пиву', 'pairs_with': str(self.besh.id)},
        ]}, ensure_ascii=False)
        resp, mocked = self.ask_claude(
            'что взять к бешбармаку', payload, table=7,
            cart=[{'kind': 'DISH', 'id': str(self.besh.id), 'qty': 1}], prefs={'no_bitter': True})
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertEqual(data['mode'], 'claude')
        self.assertEqual(data['note'], '')
        self.assertEqual(data['reply'], 'К бешбармаку возьмите Kozel.')
        self.assertEqual([(s['kind'], s['id']) for s in data['suggestions']],
                         [('DRINK', str(self.kozel.id)), ('DISH', str(self.kazy.id))])
        drink, dish = data['suggestions']
        # Название, подпись и оценка из базы, а не из текста модели.
        self.assertEqual(drink['title'], 'Velkopopovický Kozel')
        self.assertEqual(drink['subtitle'], 'Czech Lager · 0,5 л · 2 200 ₸')
        self.assertEqual(drink['score'], 5)
        self.assertEqual(drink['reason'], 'Солод к мясу')
        self.assertEqual(drink['pairs_with'], str(self.besh.id))
        self.assertEqual(dish['title'], 'Казы')
        self.assertIsNone(dish['pairs_with'])
        self.assertIsNone(dish['score'])

        system_blocks, messages = mocked.call_args[0][:2]
        self.assertEqual(len(system_blocks), 3)
        self.assertIn('ИИ-сомелье Flavor Tree', system_blocks[0]['text'])
        self.assertEqual(system_blocks[1]['cache_control'], {'type': 'ephemeral'})
        self.assertIn(str(self.kozel.id), system_blocks[1]['text'])
        self.assertIn(str(self.besh.id), system_blocks[1]['text'])
        self.assertIn('Стол: 7', system_blocks[2]['text'])
        self.assertIn('Бешбармак x1', system_blocks[2]['text'])
        self.assertIn('без горечи', system_blocks[2]['text'])
        self.assertEqual(messages, [{'role': 'user', 'content': 'что взять к бешбармаку'}])

    def test_tolerant_json_and_plain_text(self):
        fenced = ('Вот ответ:\n```json\n{"reply": "Берите Kozel", "suggestions": [{"kind": "DRINK", "id": "%s"}]}\n```'
                  % self.kozel.id)
        data = self.ask_claude('что взять', fenced)[0].json()
        self.assertEqual(data['reply'], 'Берите Kozel')
        self.assertEqual([s['id'] for s in data['suggestions']], [str(self.kozel.id)])

        data = self.ask_claude('что взять', 'Просто текст без JSON')[0].json()
        self.assertEqual(data['mode'], 'claude')
        self.assertEqual(data['reply'], 'Просто текст без JSON')
        self.assertEqual(data['suggestions'], [])

        data = self.ask_claude('что взять', '{"reply": "Начало ответа", "suggestions": [{"kind": "DR')[0].json()
        self.assertEqual(data['reply'], 'Начало ответа')
        self.assertEqual(data['suggestions'], [])

    def test_sdk_error_falls_back_to_local(self):
        request = httpx.Request('POST', 'https://api.anthropic.com/v1/messages')
        for error in (
            anthropic.APIConnectionError(request=request),
            anthropic.APIStatusError('overloaded', response=httpx.Response(529, request=request), body=None),
        ):
            data = self.ask_claude('что взять к бешбармаку', error)[0].json()
            self.assertEqual(data['mode'], 'local')
            self.assertEqual(data['note'], ai_sommelier.LOCAL_NOTE)
            self.assertEqual(data['suggestions'][0]['id'], str(self.kozel.id))

    def test_empty_model_reply_falls_back(self):
        data = self.ask_claude('что взять к бешбармаку', '   ')[0].json()
        self.assertEqual(data['mode'], 'local')
        self.assertEqual(data['note'], ai_sommelier.LOCAL_NOTE)

    def test_without_key_sdk_is_not_called(self):
        with patch.dict(os.environ, NO_KEY), patch('api.ai_sommelier.call_claude') as mocked:
            data = client_for().post(URL, {
                'venue': 'efes-beer-garden', 'messages': [{'role': 'user', 'content': 'что взять к бешбармаку'}],
            }, format='json').json()
        mocked.assert_not_called()
        self.assertEqual(data['mode'], 'local')
        self.assertEqual(data['note'], '')


class ContextTests(AiTestsBase):
    def test_venue_context(self):
        ctx = ai_sommelier.build_context('efes-beer-garden')
        self.assertEqual(ctx['venue']['slug'], 'efes-beer-garden')
        self.assertEqual([d['name'] for d in ctx['dishes']], ['Бешбармак', 'Манты', 'Казы', 'Тирамису'])
        self.assertEqual([d['name'] for d in ctx['drinks']], ['Efes Pilsener', 'Velkopopovický Kozel', 'Хмельной Лось'])
        self.assertIn('4 500 ₸', ctx['text'])
        self.assertIn('Манты -> Белый Медведь [нет в карте бара]', ctx['text'])
        self.assertIn('Бешбармак -> Velkopopovický Kozel | 5 | дополняет', ctx['text'])
        self.assertEqual(ctx['text'], ai_sommelier.build_context('efes-beer-garden')['text'])
        with self.assertRaises(Venue.DoesNotExist):
            ai_sommelier.build_context('no-such-bar')

    def test_catalog_context_is_deterministic_and_capped(self):
        brands = [make_brand('Сорт {:02d}'.format(i), style='Lager') for i in range(6)]
        for i in range(90):
            dish = make_dish('Блюдо номер {:02d} с длинным описательным названием'.format(i))
            for brand in brands[:(i % 6) + 1]:
                make_pairing(brand, dish, score=(i % 5) + 1, explanation='Объяснение сомелье ' * 8)
        first = ai_sommelier.build_context(None)
        second = ai_sommelier.build_context(None)
        self.assertEqual(first['text'], second['text'])
        self.assertLessEqual(len(first['text']), ai_sommelier.CONTEXT_MAX_CHARS)
        self.assertLessEqual(len(first['dishes']), ai_sommelier.CATALOG_DISHES_LIMIT)
        self.assertTrue(first['pairings'])
        self.assertIsNone(first['venue'])
        for dish in first['dishes']:
            self.assertIn(dish['id'], first['text'])
        self.assertEqual(set(first['dish_by_id']), set(d['id'] for d in first['dishes']))
        self.assertEqual(set(first['drink_by_id']), set(str(b.id) for b in [
            self.kozel_brand, self.efes_brand, self.los_brand, self.bear] + brands))


class ThrottleTests(AiTestsBase):
    def test_scopes_configured_without_global_throttling(self):
        self.assertEqual(AiAnonThrottle().get_rate(), '30/min')
        self.assertEqual(AiUserThrottle().get_rate(), '60/min')
        self.assertNotIn('DEFAULT_THROTTLE_CLASSES', settings.REST_FRAMEWORK)

    def test_anonymous_limit_is_enforced(self):
        body = {'venue': None, 'messages': [{'role': 'user', 'content': 'привет'}]}
        client = client_for()
        with patch.dict(os.environ, NO_KEY):
            codes = [client.post(URL, body, format='json').status_code for _ in range(31)]
        self.assertEqual(codes[:30], [200] * 30)
        self.assertEqual(codes[30], 429)

"""
Гость младше 21 (флаг minor: ответил «Нет» на вопрос о возрасте или сказал об этом в чате) спрашивает
про алкоголь: справка о стилях, сорт и его цена, закуска к пиву, «какое пиво посоветуешь». Сомелье
не объясняет и не рекламирует алкоголь, стили и марки: коротко отказывает на языке вопроса и предлагает
безалкогольное из карты или блюдо. Взрослому с одной кнопкой «Без алкоголя» справка по-прежнему доступна.
"""
import os
from unittest.mock import patch

from api import ai_engine, ai_sommelier
from .helpers import client_for
from .test_ai import URL, WITH_KEY, AiTestsBase, claude_reply

# Так чат шлёт вопрос гостя, который ответил, что ему нет 21 (sommelier-chat.component.ts, ask())
MINOR = {'safety_flags': ['minor'], 'prefs': {'no_alcohol': True}}
# Начала слов, которых не должно быть в ответе гостю младше 21 на вопрос про алкоголь
ALCOHOL_STEMS = ('лагер', 'эль', 'эля', 'стаут', 'портер', 'ipa', 'пилснер', 'пильзнер', 'хмел', 'брожен',
                 'крепост', 'efes', 'kozel', 'velkopopovicky', 'guinness', 'лось', 'lager', 'ale', 'stout')


class MinorAlcoholTopicsTests(AiTestsBase):
    def ask_minor(self, text, **extra):
        return self.ask(text, **dict(MINOR, **extra)).json()

    def assert_no_alcohol_talk(self, data, text):
        leaked = [w for w in ai_engine.norm(data['reply']).split() if w.startswith(ALCOHOL_STEMS)]
        self.assertEqual(leaked, [], '{}: {}'.format(text, data['reply']))
        self.assertFalse([s for s in data['suggestions'] if s['kind'] == 'DRINK' and s['is_alcoholic']], text)
        self.assertEqual(data['disclaimer'], '', text)
        self.assertEqual(data['safety'], 'minor', text)
        self.assertEqual(data['mode'], 'local', text)

    def soft_ids(self):
        return {str(self.tea.id), str(self.lemonade.id)}

    def test_style_questions_get_a_short_redirect(self):
        self.add_zero_drinks()
        for text in ('Что такое лагер?', 'что такое IPA', 'чем отличается стаут от портера', 'что такое сидр',
                     'что такое безалкогольное пиво', 'что такое крепость', 'что такое IBU'):
            data = self.ask_minor(text)
            self.assert_no_alcohol_talk(data, text)
            self.assertIn('Про пиво и другой алкоголь я не рассказываю', data['reply'], text)
            drinks = [s['id'] for s in data['suggestions'] if s['kind'] == 'DRINK']
            # Взамен безалкогольное из карты: лимонад и чай, но не пиво 0.0
            self.assertTrue(drinks, text)
            self.assertLessEqual(set(drinks), self.soft_ids(), text)
        en = self.ask_minor('What is a lager?')
        self.assertEqual(en['lang'], 'en')
        self.assert_no_alcohol_talk(en, 'en')
        self.assertIn("I don't talk about beer", en['reply'])

    def test_food_for_beer_gets_dishes_and_soft_drinks(self):
        self.add_zero_drinks()
        for text in ('Чем закусить пиво?', 'что к вину из закусок'):
            data = self.ask_minor(text)
            self.assert_no_alcohol_talk(data, text)
            self.assertIn('Закуску к алкоголю не подбираю', data['reply'])
            self.assertNotIn('К пиву', data['reply'])
            self.assertTrue([s for s in data['suggestions'] if s['kind'] == 'DISH'], text)
            drinks = [s['id'] for s in data['suggestions'] if s['kind'] == 'DRINK']
            self.assertTrue(drinks and set(drinks) <= self.soft_ids(), text)

    def test_food_for_beer_without_soft_drinks_in_the_bar(self):
        data = self.ask_minor('Чем закусить пиво?')
        self.assert_no_alcohol_talk(data, 'no soft drinks')
        self.assertTrue([s for s in data['suggestions'] if s['kind'] == 'DISH'])
        self.assertIn('Безалкогольных напитков в карте этого бара сейчас нет', data['reply'])

    def test_named_drinks_and_their_prices_are_not_described(self):
        self.add_zero_drinks()
        for text in ('сколько стоит козел', 'что за Kozel', 'сколько градусов в хмельном лосе',
                     'что легче: козел или хмельной лось', 'расскажи про Guinness', 'Efes'):
            data = self.ask_minor(text)
            self.assert_no_alcohol_talk(data, text)
            self.assertIn('не рассказываю', data['reply'], text)
        # Цену блюда гость младше 21 узнаёт как обычно, а напиток к нему безалкогольный
        price = self.ask_minor('сколько стоит бешбармак')
        self.assertIn('4 500 ₸', price['reply'])
        self.assert_no_alcohol_talk(price, 'price')

    def test_beer_requests_offer_soft_drinks_from_the_card(self):
        self.add_zero_drinks()
        for text in ('какое пиво посоветуешь', 'что покрепче', 'самое горькое пиво', 'есть вино?',
                     'посоветуй коктейль', 'что взять к пиву', 'есть квас?'):
            data = self.ask_minor(text)
            self.assert_no_alcohol_talk(data, text)
            # Чай и лимонад в карте есть: «безалкогольных напитков нет» было бы неправдой
            self.assertNotIn('Безалкогольных напитков', data['reply'], text)
            drinks = [s['id'] for s in data['suggestions'] if s['kind'] == 'DRINK']
            self.assertTrue(drinks and set(drinks) <= self.soft_ids(), text)
        kk = self.ask_minor('Сыраға не жейміз?')
        self.assertEqual(kk['lang'], 'kk')
        self.assert_no_alcohol_talk(kk, 'kk')
        self.assertIn('Алкогольсіз', kk['reply'])

    def test_vodka_to_a_dish_gets_no_false_absence_note(self):
        self.add_zero_drinks()
        data = self.ask_minor('хочу водку к бешбармаку')
        self.assert_no_alcohol_talk(data, 'vodka')
        self.assertNotIn('Водки здесь сейчас нет', data['reply'])
        self.assertEqual(data['suggestions'][0]['pairs_with'], str(self.besh.id))

    def test_safe_topics_are_still_answered(self):
        self.add_zero_drinks()
        ayran = self.ask_minor('что такое айран')
        self.assertIn('Айран:', ayran['reply'])
        smalltalk = self.ask_minor('как дела')
        self.assert_no_alcohol_talk(smalltalk, 'smalltalk')
        self.assertIn('безалкогольный напиток', smalltalk['reply'])
        unknown = self.ask_minor('что такое блокчейн')
        self.assert_no_alcohol_talk(unknown, 'unknown')
        self.assertIn('не могу', unknown['reply'])
        # Напиток к блюду: безалкогольный, пара команды (пиво) гостю младше 21 не подходит
        dish = self.ask_minor('что взять к бешбармаку')
        self.assert_no_alcohol_talk(dish, 'dish')
        self.assertEqual(dish['suggestions'][0]['pairs_with'], str(self.besh.id))
        self.assertNotIn('подбор команды', dish['reply'])

    def test_age_said_earlier_in_the_chat(self):
        self.add_zero_drinks()
        history = [{'role': 'user', 'content': 'мне 16'}, {'role': 'assistant', 'content': 'Подберу безалкогольное.'}]
        data = self.ask('а что такое лагер?', history=history).json()
        self.assert_no_alcohol_talk(data, 'history')
        self.assertIn('не рассказываю', data['reply'])

    def test_adult_with_no_alcohol_toggle_keeps_the_glossary(self):
        self.add_zero_drinks()
        data = self.ask('Что такое лагер?', prefs={'no_alcohol': True}).json()
        self.assertEqual(data['safety'], '')
        self.assertIn('Лагер:', data['reply'])
        self.assertFalse([s for s in data['suggestions'] if s['kind'] == 'DRINK' and s['is_alcoholic']])
        snack = self.ask('Чем закусить пиво?', prefs={'no_alcohol': True}).json()
        self.assertIn('К пиву', snack['reply'])
        self.assertFalse([s for s in snack['suggestions'] if s['kind'] == 'DRINK' and s['is_alcoholic']])

    def test_catalog_without_venue(self):
        data = self.ask_minor('Что такое лагер?', venue=None)
        self.assert_no_alcohol_talk(data, 'catalog')
        self.assertIn('не рассказываю', data['reply'])
        self.assertTrue([s for s in data['suggestions'] if s['kind'] == 'DRINK'])


class MinorClaudeTests(AiTestsBase):
    """
    Режим Claude: вопрос про алкоголь от гостя младше 21 не уходит в модель, а ответ модели
    со стилем пива не показываем.
    """

    def ask_claude(self, text, reply, **extra):
        body = dict(MINOR, venue='efes-beer-garden', messages=[{'role': 'user', 'content': text}], **extra)
        with patch.dict(os.environ, WITH_KEY), \
                patch('api.ai_sommelier.call_claude', return_value=claude_reply(reply)) as mocked:
            resp = client_for().post(URL, body, format='json')
        return resp.json(), mocked

    def test_alcohol_questions_skip_the_model(self):
        for text in ('что такое лагер', 'чем закусить пиво', 'сколько стоит козел', 'какое пиво посоветуешь'):
            data, mocked = self.ask_claude(text, {'reply': 'Лагер это пиво низового брожения.', 'suggestions': []})
            mocked.assert_not_called()
            self.assertEqual(data['mode'], 'local', text)
            self.assertEqual(data['safety'], 'minor', text)
            self.assertNotIn('низового', data['reply'], text)

    def test_model_answer_naming_a_beer_style_is_replaced(self):
        reply = {'reply': 'К бешбармаку лучше чай, а лагер оставьте взрослым.', 'suggestions': []}
        data, mocked = self.ask_claude('что взять к бешбармаку', reply)
        mocked.assert_called_once()
        self.assertEqual(data['mode'], 'local')
        self.assertEqual(data['note'], ai_sommelier.ENGINE_NOTE)
        self.assertIn('Гостю нет 21', mocked.call_args[0][0][2]['text'])
        clean, _ = self.ask_claude('что взять к бешбармаку', {'reply': 'К бешбармаку подойдёт горячий чай.',
                                                            'suggestions': []})
        self.assertEqual(clean['mode'], 'claude')

"""
Первый совет чата к блюду меню совпадает с тем, что меню заведения показывает в «Подобрать напиток»
с подписью «Подбор команды Flavor Tree»: тот же напиток, та же оценка 1-5 и то же объяснение.
Пожелания гостя (чай, подешевле, без алкоголя) важнее пары команды.

Какая пара команды стоит в меню первой, решает venue_pairing (её не меняем), поэтому ожидания
берутся из ответа GET /api/venues/<slug>/menu/, а не записаны в тесте.
"""
from api import ai_engine, ai_sommelier, venue_pairing
from .helpers import make_pairing
from .test_ai import AiTestsBase


class TeamPickTests(AiTestsBase):
    def curated_items(self):
        items = []
        for item in (self.besh, self.manty, self.kazy, self.tiramisu):
            menu = self.menu_first(item)
            if menu and menu['curated']:
                items.append((item, menu))
        return items

    def first_drink(self, data):
        return next(s for s in data['suggestions'] if s['kind'] == 'DRINK')

    def test_context_marks_the_menu_team_pick(self):
        ctx = ai_sommelier.build_context('efes-beer-garden')
        for item in (self.besh, self.manty, self.kazy, self.tiramisu):
            menu = self.menu_first(item)
            pick = ctx['dish_by_id'][str(item.id)].get('team_pick')
            if menu and menu['curated']:
                self.assertEqual(pick, {'drink': menu['menu_drink']['id'], 'rating': menu['compatibility_score'],
                                        'reason': ai_engine.clean_reason(menu['explanation'])}, item.dish.name)
            else:
                self.assertIsNone(pick, item.dish.name)

    def test_first_pick_matches_the_curated_menu_pick(self):
        curated = self.curated_items()
        # В фикстуре команда советует Kozel к бешбармаку и Efes Pilsener к казы (5 из 5)
        self.assertTrue(curated)
        for item, menu in curated:
            data = self.ask('что взять к блюду «{}»?'.format(item.dish.name)).json()
            first = self.first_drink(data)
            self.assertEqual(first['id'], menu['menu_drink']['id'], item.dish.name)
            self.assertEqual(first['pairs_with'], str(item.id))
            self.assertEqual(first['score'], menu['compatibility_score'])
            self.assertIn('Это подбор команды Flavor Tree с оценкой {} из 5'.format(menu['compatibility_score']),
                          data['reply'])
            self.assertNotIn('\u2014', data['reply'])

    def test_team_pick_goes_first_even_when_the_engine_ranks_it_lower(self):
        engine_first = self.expected_first(self.manty)[0]
        neutral = venue_pairing.band_min(ai_engine.dataset(), 'neutral', 48)
        brands = {str(self.efes.id): self.efes_brand, str(self.kozel.id): self.kozel_brand,
                  str(self.los.id): self.los_brand}
        candidate = next((e for e, r in self.engine_ranked(self.manty)
                          if e['id'] != engine_first['id'] and e['id'] in brands and r['score'] >= neutral), None)
        if candidate is None:
            self.skipTest('движок не оставил второго удачного сорта к мантам')
        make_pairing(brands[candidate['id']], self.manty.dish, score=4, explanation='Проверено на дегустации команды')
        menu = self.menu_first(self.manty)
        self.assertTrue(menu['curated'])
        self.assertEqual(menu['menu_drink']['id'], candidate['id'])

        data = self.ask('что взять к мантам').json()
        first = data['suggestions'][0]
        self.assertEqual(first['id'], candidate['id'])
        self.assertEqual(first['score'], 4)
        self.assertEqual(first['reason'], 'Проверено на дегустации команды')
        self.assertIn('проверено на дегустации команды', data['reply'])
        self.assertIn('подбор команды Flavor Tree', data['reply'])
        # Блюдо с напитком в подборке блюд берёт ту же пару
        combo = self.ask('посоветуй ужин на двоих').json()
        paired = [s['id'] for s in combo['suggestions']
                  if s['kind'] == 'DRINK' and s['pairs_with'] == str(self.manty.id)]
        if paired:
            self.assertEqual(paired[0], candidate['id'])

    def test_english_guest_gets_the_same_pick_with_an_english_reason(self):
        menu = self.menu_first(self.besh)
        self.assertTrue(menu['curated'])
        data = self.ask('What beer goes well with beshbarmak?').json()
        self.assertEqual(data['lang'], 'en')
        first = self.first_drink(data)
        self.assertEqual(first['id'], menu['menu_drink']['id'])
        self.assertEqual(first['score'], menu['compatibility_score'])
        self.assertIn('Flavor Tree team pick, rated {} out of 5'.format(menu['compatibility_score']), data['reply'])
        # Объяснение команды написано по-русски: английскому гостю объяснение движка на его языке
        self.assertNotIn('солодовая', data['reply'])

    def test_guest_wishes_come_before_the_team_pick(self):
        menu = self.menu_first(self.besh)
        self.assertTrue(menu['curated'])
        # «А подешевле?»: самый дешёвый из удачных, пару команды не навязываем
        history = [{'role': 'user', 'content': 'что взять к бешбармаку'}, {'role': 'assistant', 'content': 'Kozel'}]
        cheaper = self.ask('а подешевле есть?', history=history).json()
        self.assertEqual(cheaper['suggestions'][0]['id'], str(self.efes.id))
        self.assertNotIn('подбор команды', cheaper['reply'])
        self.add_zero_drinks()
        # Гость просил чай: первым чай
        tea = self.ask('какой чай к бешбармаку?').json()
        self.assertEqual(tea['suggestions'][0]['id'], str(self.tea.id))
        self.assertNotIn('подбор команды', tea['reply'])
        # Кнопка «Без алкоголя»: пивная пара команды не подходит
        zero = self.ask('что взять к бешбармаку', prefs={'no_alcohol': True}).json()
        self.assertTrue(zero['suggestions'])
        self.assertFalse([s for s in zero['suggestions'] if s['is_alcoholic']])
        self.assertNotIn('подбор команды', zero['reply'])

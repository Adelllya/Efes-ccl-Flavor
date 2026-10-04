from django.core.cache import cache
from django.test import TestCase

from api import passport
from api.models import (
    FlavorNote, FlavorProfile, Lesson, LessonProgress, PairingFeedback, QuizAttempt, Redemption, Reward, Tasting,
)
from api.views_passport import MIN_GUESTS, PALETTE_SIZE, build_palette
from .helpers import client_for, make_brand, make_dish, make_pairing, make_user, make_venue


def make_note(name, category='TOP', off=False, order=0):
    return FlavorNote.objects.create(name=name, category=category, description=name, icon='*',
                                     is_off_flavour=off, sort_order=order)


class PassportBase(TestCase):
    def setUp(self):
        cache.clear()
        self.user = make_user('guest')
        self.client_ = client_for(self.user)
        self.brand = make_brand('Efes Pilsener', style='Pilsner')
        self.citrus = make_note('Цитрус')
        self.bread = make_note('Свежий хлеб', 'HEART')
        self.hops = make_note('Хмелевая горечь', 'BASE')
        for note, layer, intensity in ((self.citrus, 'TOP', 7), (self.bread, 'HEART', 6), (self.hops, 'BASE', 8)):
            FlavorProfile.objects.create(brand=self.brand, flavor_note=note, layer=layer, intensity=intensity)
        self.others = [make_note(name, order=i) for i, name in enumerate([
            'Карамель', 'Мёд', 'Банан', 'Гвоздика', 'Кофе', 'Шоколад', 'Дым', 'Ваниль', 'Груша', 'Перец',
            'Травы', 'Орех', 'Изюм', 'Цитрусовый аромат', 'Хлебная корка'])]
        self.skunk = make_note('Засвеченный', off=True)

    def put(self, client=None, **body):
        data = {'rating': 4, 'notes': [str(self.citrus.id), str(self.bread.id)]}
        data.update(body)
        return (client or self.client_).put('/api/tastings/{}/'.format(self.brand.id), data, format='json')


class PaletteTests(PassportBase):
    def test_palette_has_pyramid_and_distractors(self):
        palette = build_palette(self.brand)
        ids = [n.id for n in palette]
        self.assertEqual(len(palette), PALETTE_SIZE)
        self.assertEqual(len(set(ids)), PALETTE_SIZE)
        for note in (self.citrus, self.bread, self.hops):
            self.assertIn(note.id, ids)
        self.assertNotIn(self.skunk.id, ids)
        names = [n.name for n in palette]
        # Почти одинаковые с пирамидой ноты в палитру не попадают: гость не должен гадать между ними
        self.assertNotIn('Цитрусовый аромат', names)
        self.assertNotIn('Хлебная корка', names)
        self.assertEqual(ids, [n.id for n in build_palette(self.brand)])

    def test_guest_gets_palette_without_answers(self):
        resp = client_for().get('/api/tastings/{}/'.format(self.brand.id))
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data['palette']), PALETTE_SIZE)
        self.assertEqual(set(data['palette'][0]), {'id', 'name', 'icon', 'image', 'category'})
        self.assertIsNone(data['mine'])
        self.assertIsNone(data['reveal'])
        self.assertEqual(data['max_notes'], Tasting.MAX_NOTES)
        self.assertEqual(client_for().get('/api/tastings/00000000-0000-0000-0000-000000000001/').status_code, 404)


class TastingTests(PassportBase):
    def test_guest_cannot_save(self):
        self.assertEqual(self.put(client_for()).status_code, 401)
        self.assertEqual(client_for().get('/api/passport/').status_code, 401)

    def test_new_sort_gives_points_and_reveals_pyramid(self):
        resp = self.put(comment='  Свежо  ')
        self.assertEqual(resp.status_code, 201, resp.content)
        data = resp.json()
        self.assertEqual(data['awarded'], passport.POINTS_TASTING + passport.POINTS_NOTES)
        self.assertEqual(data['tasting']['matched'], 2)
        self.assertEqual(data['tasting']['comment'], 'Свежо')
        self.assertEqual(data['reveal']['matched'], 2)
        self.assertEqual(data['reveal']['total'], 3)
        self.assertEqual([n['name'] for n in data['reveal']['pyramid'] if n['heard']], ['Цитрус', 'Свежий хлеб'])
        self.assertEqual(data['points']['earned'], 20)
        self.assertEqual(data['points']['rank']['title'], 'Гость')

        # Та же отметка ещё раз: баллы не растут, отметка одна
        again = self.put(rating=5)
        self.assertEqual(again.status_code, 200)
        self.assertEqual(again.json()['awarded'], 0)
        self.assertEqual(Tasting.objects.filter(user=self.user).count(), 1)
        self.assertEqual(Tasting.objects.get(user=self.user).rating, 5)

        mine = self.client_.get('/api/tastings/{}/'.format(self.brand.id)).json()
        self.assertEqual(mine['mine']['rating'], 5)
        self.assertEqual(mine['reveal']['matched'], 2)

    def test_one_matched_note_gives_no_bonus(self):
        data = self.put(notes=[str(self.citrus.id), str(self.others[0].id)]).json()
        self.assertEqual(data['awarded'], passport.POINTS_TASTING)
        # Гость переслушал и нашёл вторую ноту: бонус приходит при правке
        data = self.put(notes=[str(self.citrus.id), str(self.hops.id)]).json()
        self.assertEqual(data['awarded'], passport.POINTS_NOTES)

    def test_validation(self):
        self.assertEqual(self.put(rating=0).status_code, 400)
        self.assertEqual(self.put(rating=6).status_code, 400)
        self.assertEqual(self.put(notes=[str(self.skunk.id)]).status_code, 400)
        self.assertEqual(self.put(notes=['00000000-0000-0000-0000-000000000009']).status_code, 400)
        too_many = [str(n.id) for n in self.others[:Tasting.MAX_NOTES + 1]]
        self.assertEqual(self.put(notes=too_many).status_code, 400)
        self.assertEqual(self.put(comment='x' * 281).status_code, 400)
        resp = self.client_.put('/api/tastings/00000000-0000-0000-0000-000000000001/', {'rating': 3}, format='json')
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(Tasting.objects.count(), 0)

    def test_notes_are_optional_and_venue_is_saved(self):
        venue = make_venue()
        resp = self.put(notes=[], venue=venue.slug)
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['tasting']['venue'], {'slug': venue.slug, 'name': venue.name})
        self.assertEqual(resp.json()['awarded'], passport.POINTS_TASTING)
        # Неизвестное заведение не ошибка: отметка сохраняется без него
        other = make_brand('Kozel', style='Czech Lager')
        resp = self.client_.put('/api/tastings/{}/'.format(other.id), {'rating': 3, 'venue': 'nope'}, format='json')
        self.assertEqual(resp.status_code, 201)

    def test_delete_removes_the_stamp(self):
        self.put()
        self.assertEqual(self.client_.delete('/api/tastings/{}/'.format(self.brand.id)).status_code, 204)
        self.assertEqual(Tasting.objects.count(), 0)
        self.assertEqual(self.client_.get('/api/passport/').json()['points']['earned'], 0)

    def test_third_new_sort_of_the_day_waits_until_tomorrow(self):
        from datetime import timedelta
        from django.utils import timezone
        from api.views_passport import DAILY_NEW_TASTINGS
        self.assertEqual(self.put().status_code, 201)
        second = make_brand('Kozel', style='Czech Lager')
        third = make_brand('Bavaria', style='Holland Lager')
        url = '/api/tastings/{}/'
        self.assertEqual(self.client_.put(url.format(second.id), {'rating': 4}, format='json').status_code, 201)
        resp = self.client_.put(url.format(third.id), {'rating': 4}, format='json')
        self.assertEqual(resp.status_code, 429)
        self.assertEqual(resp.json()['code'], 'daily_limit')
        self.assertEqual(Tasting.objects.filter(user=self.user).count(), DAILY_NEW_TASTINGS)
        # Правка уже поставленной отметки в лимит не входит
        self.assertEqual(self.put(rating=2).status_code, 200)
        # На следующий день новая отметка снова доступна
        Tasting.objects.filter(user=self.user).update(created_at=timezone.now() - timedelta(days=1))
        self.assertEqual(self.client_.put(url.format(third.id), {'rating': 4}, format='json').status_code, 201)

    def test_inactive_brand_cannot_be_tasted(self):
        self.brand.is_active = False
        self.brand.save()
        self.assertEqual(self.put().status_code, 404)


class GuestsHeardTests(PassportBase):
    def test_summary_needs_enough_guests(self):
        url = '/api/brands/{}/guests/'.format(self.brand.id)
        self.put()
        data = client_for().get(url).json()
        self.assertEqual((data['count'], data['enough'], data['notes'], data['rating_avg']), (1, False, [], None))

        for i in range(MIN_GUESTS - 1):
            client = client_for(make_user('g{}'.format(i)))
            self.put(client, rating=5, notes=[str(self.citrus.id), str(self.others[0].id)])
        data = client_for().get(url).json()
        self.assertTrue(data['enough'])
        self.assertEqual(data['count'], MIN_GUESTS)
        self.assertEqual(data['rating_avg'], 4.7)
        top = data['notes'][0]
        self.assertEqual((top['name'], top['share'], top['in_pyramid']), ('Цитрус', 100, True))
        by_name = {n['name']: n for n in data['notes']}
        self.assertEqual(by_name['Карамель']['share'], 67)
        self.assertFalse(by_name['Карамель']['in_pyramid'])
        self.assertEqual(client_for().get('/api/brands/00000000-0000-0000-0000-000000000001/guests/').status_code, 404)


class PassportSummaryTests(PassportBase):
    def test_empty_passport(self):
        data = self.client_.get('/api/passport/').json()
        self.assertEqual(data['points'], {'earned': 0, 'spent': 0, 'balance': 0})
        self.assertEqual(data['rank']['title'], 'Гость')
        self.assertEqual(data['rank']['next_title'], 'Дегустатор')
        self.assertEqual(data['rank']['to_next'], 40)
        self.assertFalse(any(b['earned'] for b in data['badges']))
        self.assertEqual(data['tastings'], [])
        self.assertEqual(data['brands_total'], 1)
        self.assertEqual(len(data['ranks']), 5)

    def test_points_come_from_events(self):
        lesson = Lesson.objects.first()
        LessonProgress.objects.create(user=self.user, lesson=lesson)
        QuizAttempt.objects.create(user=self.user, level=1, correct=7, total=7, passed=True)
        QuizAttempt.objects.create(user=self.user, level=1, correct=7, total=7, passed=True)
        QuizAttempt.objects.create(user=self.user, level=2, correct=1, total=7, passed=False)
        self.put()
        data = self.client_.get('/api/passport/').json()
        rows = {r['kind']: r for r in data['breakdown']}
        self.assertEqual(rows['lessons']['points'], 10)
        self.assertEqual(rows['levels']['points'], 50)
        self.assertEqual(rows['tastings']['points'], 15)
        self.assertEqual(rows['notes']['points'], 5)
        self.assertEqual(rows['feedback']['points'], 0)
        self.assertEqual(data['points']['earned'], 80)
        self.assertEqual(data['rank']['title'], 'Дегустатор')
        badges = {b['id']: b for b in data['badges']}
        self.assertTrue(badges['first-stamp']['earned'])
        self.assertTrue(badges['full-line']['earned'])  # в каталоге один сорт
        self.assertEqual((badges['five-sorts']['progress'], badges['five-sorts']['target']), (1, 5))
        self.assertFalse(badges['sommelier']['earned'])
        self.assertEqual(len(data['tastings']), 1)
        self.assertEqual(data['tastings'][0]['brand']['name'], 'Efes Pilsener')

    def test_rank_thresholds(self):
        self.assertEqual(passport.rank_for(39)['title'], 'Гость')
        self.assertEqual(passport.rank_for(40)['title'], 'Дегустатор')
        self.assertEqual(passport.rank_for(149)['to_next'], 1)
        top = passport.rank_for(10000)
        self.assertEqual((top['title'], top['next_title'], top['to_next']), ('Амбассадор вкуса', None, 0))


class FeedbackTests(PassportBase):
    def setUp(self):
        super().setUp()
        self.pairing = make_pairing(self.brand, make_dish())
        self.url = '/api/pairings/{}/feedback/'.format(self.pairing.id)
        self.device = 'device-0123456789abcdef'

    def test_guest_votes_by_device_and_can_change_vote(self):
        self.assertEqual(client_for().post(self.url, {'liked': True}, format='json').status_code, 400)
        self.assertEqual(client_for().post(self.url, {'liked': True, 'device': 'short'}, format='json').status_code, 400)
        self.assertEqual(client_for().post(self.url, {'liked': 'yes', 'device': self.device}, format='json').status_code, 400)
        resp = client_for().post(self.url, {'liked': True, 'device': self.device}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json(), {'likes': 1, 'dislikes': 0, 'mine': True, 'awarded': 0})
        resp = client_for().post(self.url, {'liked': False, 'device': self.device}, format='json')
        self.assertEqual(resp.json(), {'likes': 0, 'dislikes': 1, 'mine': False, 'awarded': 0})
        self.assertEqual(PairingFeedback.objects.count(), 1)
        other = client_for().post(self.url, {'liked': True, 'device': 'another-device-1234567'}, format='json').json()
        self.assertEqual((other['likes'], other['dislikes']), (1, 1))
        seen = client_for().get(self.url + '?device=' + self.device).json()
        self.assertEqual(seen, {'likes': 1, 'dislikes': 1, 'mine': False})
        self.assertIsNone(client_for().get(self.url).json()['mine'])

    def test_user_vote_gives_points_once(self):
        first = self.client_.post(self.url, {'liked': True}, format='json').json()
        self.assertEqual(first['awarded'], passport.POINTS_FEEDBACK)
        second = self.client_.post(self.url, {'liked': False}, format='json').json()
        self.assertEqual(second['awarded'], 0)
        self.assertEqual((second['likes'], second['dislikes'], second['mine']), (0, 1, False))
        self.assertEqual(PairingFeedback.objects.filter(user=self.user).count(), 1)

    def test_feedback_points_are_capped(self):
        dishes = [make_dish('Блюдо {}'.format(i)) for i in range(passport.FEEDBACK_CAP + 3)]
        for dish in dishes:
            PairingFeedback.objects.create(pairing=make_pairing(self.brand, dish), user=self.user, liked=True)
        data = self.client_.get('/api/passport/').json()
        row = {r['kind']: r for r in data['breakdown']}['feedback']
        self.assertEqual(row['count'], passport.FEEDBACK_CAP + 3)
        self.assertEqual(row['points'], passport.FEEDBACK_CAP * passport.POINTS_FEEDBACK)

    def test_unknown_pairing(self):
        url = '/api/pairings/00000000-0000-0000-0000-000000000001/feedback/'
        self.assertEqual(client_for().post(url, {'liked': True, 'device': self.device}, format='json').status_code, 404)

    def test_pairing_routes_still_work(self):
        # Маршрут оценок стоит перед роутером и не должен ломать /api/pairings/<id>/
        self.assertEqual(client_for().get('/api/pairings/{}/'.format(self.pairing.id)).status_code, 200)
        self.assertEqual(client_for().get('/api/brands/{}/'.format(self.brand.id)).status_code, 200)


class RewardTests(PassportBase):
    def setUp(self):
        super().setUp()
        self.owner = make_user('rest', role='restaurant_admin')
        self.other_owner = make_user('other', role='restaurant_admin')
        self.mod = make_user('mod', role='moderator')
        self.venue = make_venue(owner=self.owner)
        self.other_venue = make_venue('Бар 13', owner=self.other_owner)
        self.reward = Reward.objects.create(venue=self.venue, title='Сырная тарелка', cost=60, stock=2)
        self.platform = Reward.objects.create(title='Экскурсия на пивоварню', kind='EVENT', cost=500)
        self.hidden = Reward.objects.create(venue=self.venue, title='Выключена', cost=10, is_active=False)

    def give_points(self, user, lessons=7):
        """Баллы через пройденные уроки: по 10 за урок."""
        for lesson in Lesson.objects.all()[:lessons]:
            LessonProgress.objects.get_or_create(user=user, lesson=lesson)

    def test_public_list_shows_active_rewards(self):
        titles = [r['title'] for r in client_for().get('/api/rewards/').json()]
        self.assertEqual(titles, ['Сырная тарелка', 'Экскурсия на пивоварню'])
        other = [r['title'] for r in client_for().get('/api/rewards/?venue=' + self.other_venue.slug).json()]
        self.assertEqual(other, ['Экскурсия на пивоварню'])
        row = client_for().get('/api/rewards/?venue=' + self.venue.slug).json()[0]
        self.assertEqual((row['venue'], row['venue_name'], row['kind_display']),
                         (self.venue.slug, self.venue.name, 'Угощение от кухни'))

    def test_manage_list_and_roles(self):
        self.assertEqual(client_for().get('/api/rewards/?manage=1').status_code, 403)
        self.assertEqual(self.client_.get('/api/rewards/?manage=1').status_code, 403)
        mine = [r['title'] for r in client_for(self.owner).get('/api/rewards/?manage=1').json()]
        self.assertEqual(sorted(mine), ['Выключена', 'Сырная тарелка'])
        self.assertEqual(len(client_for(self.mod).get('/api/rewards/?manage=1').json()), 3)

    def test_create_update_delete_permissions(self):
        body = {'title': 'Баурсаки к столу', 'cost': 40, 'kind': 'FOOD'}
        self.assertEqual(client_for().post('/api/rewards/', body, format='json').status_code, 401)
        self.assertEqual(self.client_.post('/api/rewards/', body, format='json').status_code, 403)
        resp = client_for(self.owner).post('/api/rewards/', body, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()['venue'], self.venue.slug)
        # Чужое заведение и общая награда администратору заведения недоступны
        foreign = dict(body, venue=self.other_venue.slug)
        self.assertEqual(client_for(self.owner).post('/api/rewards/', foreign, format='json').status_code, 400)
        self.assertEqual(client_for(self.owner).post('/api/rewards/', dict(body, venue=None), format='json').status_code, 400)
        self.assertEqual(client_for(self.owner).post('/api/rewards/', dict(body, cost=0), format='json').status_code, 400)
        self.assertEqual(client_for(self.owner).post('/api/rewards/', dict(body, kind='BEER'), format='json').status_code, 400)
        url = '/api/rewards/{}/'.format(self.reward.id)
        self.assertEqual(client_for(self.other_owner).patch(url, {'cost': 1}, format='json').status_code, 403)
        self.assertEqual(client_for(self.owner).patch(url, {'cost': 70}, format='json').status_code, 200)
        self.assertEqual(client_for(self.owner).patch('/api/rewards/{}/'.format(self.platform.id), {'cost': 1}, format='json').status_code, 403)
        self.assertEqual(client_for(self.mod).post('/api/rewards/', dict(body, venue=None, title='Мерч'), format='json').status_code, 201)
        self.assertEqual(client_for(self.other_owner).delete(url).status_code, 403)
        self.assertEqual(client_for(self.owner).delete(url).status_code, 204)

    def test_alcohol_cannot_be_a_reward(self):
        client = client_for(self.owner)
        for title in ('Кружка пива в подарок', 'Скидка 20% на лагер', 'Бокал вина', 'Free beer'):
            resp = client.post('/api/rewards/', {'title': title, 'cost': 30}, format='json')
            self.assertEqual(resp.status_code, 400, title)
            self.assertIn('алкоголь', str(resp.json()))
        resp = client.post('/api/rewards/', {'title': 'Сырная тарелка', 'description': 'К пиву', 'cost': 30}, format='json')
        self.assertEqual(resp.status_code, 400)
        # Обычные слова с похожими буквами проходят
        for title in ('Винегрет от шефа', 'Экскурсия на пивоварню', 'Фирменный бокал'):
            self.assertEqual(client.post('/api/rewards/', {'title': title, 'cost': 30}, format='json').status_code, 201, title)
        url = '/api/rewards/{}/'.format(self.reward.id)
        self.assertEqual(client.patch(url, {'description': 'и пиво'}, format='json').status_code, 400)
        self.assertEqual(client.patch(url, {'cost': 65}, format='json').status_code, 200)

    def test_redeem_needs_points(self):
        url = '/api/rewards/{}/redeem/'.format(self.reward.id)
        self.assertEqual(client_for().post(url).status_code, 401)
        resp = self.client_.post(url)
        self.assertEqual(resp.status_code, 400)
        self.assertIn('Не хватает баллов: нужно ещё 60', resp.json()['error'])
        self.assertEqual(Redemption.objects.count(), 0)
        self.assertEqual(self.client_.post('/api/rewards/{}/redeem/'.format(self.hidden.id)).status_code, 404)

    def test_redeem_issues_one_code_and_spends_points(self):
        self.give_points(self.user, 7)
        url = '/api/rewards/{}/redeem/'.format(self.reward.id)
        resp = self.client_.post(url)
        self.assertEqual(resp.status_code, 201, resp.content)
        data = resp.json()
        code = data['redemption']['code']
        self.assertRegex(code, r'^[A-HJ-NP-Z2-9]{6}$')
        self.assertEqual(data['redemption']['status'], 'ISSUED')
        self.assertEqual(data['points'], {**data['points'], 'earned': 70, 'spent': 60, 'balance': 10})
        self.reward.refresh_from_db()
        self.assertEqual(self.reward.stock, 1)
        # Повторное нажатие отдаёт тот же код и не списывает баллы второй раз
        again = self.client_.post(url)
        self.assertEqual(again.status_code, 200)
        self.assertEqual(again.json()['redemption']['code'], code)
        self.assertEqual(Redemption.objects.count(), 1)
        self.assertEqual(self.client_.get('/api/redemptions/').json()[0]['code'], code)
        passport_data = self.client_.get('/api/passport/').json()
        self.assertEqual(passport_data['points']['balance'], 10)
        self.assertEqual(passport_data['redemptions'][0]['title'], 'Сырная тарелка')
        # Ранг считается по заработанным баллам и после обмена не падает
        self.assertEqual(passport_data['rank']['title'], 'Дегустатор')

    def test_out_of_stock(self):
        Reward.objects.filter(pk=self.reward.pk).update(stock=0)
        self.give_points(self.user, 7)
        resp = self.client_.post('/api/rewards/{}/redeem/'.format(self.reward.id))
        self.assertEqual(resp.status_code, 400)
        self.assertIn('закончилась', resp.json()['error'])

    def test_cancel_returns_points_and_stock(self):
        self.give_points(self.user, 7)
        row = self.client_.post('/api/rewards/{}/redeem/'.format(self.reward.id)).json()['redemption']
        stranger = client_for(make_user('stranger'))
        self.assertEqual(stranger.post('/api/redemptions/{}/cancel/'.format(row['id'])).status_code, 404)
        resp = self.client_.post('/api/redemptions/{}/cancel/'.format(row['id']))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['points']['balance'], 70)
        self.reward.refresh_from_db()
        self.assertEqual(self.reward.stock, 2)
        self.assertEqual(self.client_.post('/api/redemptions/{}/cancel/'.format(row['id'])).status_code, 409)

    def test_staff_gives_reward_by_code(self):
        self.give_points(self.user, 7)
        code = self.client_.post('/api/rewards/{}/redeem/'.format(self.reward.id)).json()['redemption']['code']
        use = '/api/redemptions/use/'
        self.assertEqual(client_for().post(use, {'code': code}, format='json').status_code, 401)
        self.assertEqual(self.client_.post(use, {'code': code}, format='json').status_code, 403)
        self.assertEqual(client_for(self.other_owner).post(use, {'code': code}, format='json').status_code, 403)
        self.assertEqual(client_for(self.owner).post(use, {'code': ''}, format='json').status_code, 400)
        self.assertEqual(client_for(self.owner).post(use, {'code': 'ZZZZZZ'}, format='json').status_code, 404)
        resp = client_for(self.owner).post(use, {'code': ' ' + code.lower() + ' '}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()['redemption']
        self.assertEqual((data['status'], data['guest'], data['title']), ('USED', 'guest', 'Сырная тарелка'))
        self.assertEqual(client_for(self.owner).post(use, {'code': code}, format='json').status_code, 409)
        # Полученную награду гость отменить уже не может
        row = Redemption.objects.get(code=code)
        self.assertEqual(self.client_.post('/api/redemptions/{}/cancel/'.format(row.id)).status_code, 409)
        self.assertEqual(row.used_by, self.owner)

        staff = client_for(self.owner).get('/api/redemptions/staff/').json()
        self.assertEqual([r['code'] for r in staff], [code])
        self.assertEqual(client_for(self.other_owner).get('/api/redemptions/staff/').json(), [])
        self.assertEqual(self.client_.get('/api/redemptions/staff/').status_code, 403)

    def test_platform_reward_is_given_by_moderator(self):
        self.give_points(self.user, 12)
        for level in (1, 2, 3, 4):
            QuizAttempt.objects.create(user=self.user, level=level, correct=7, total=7, passed=True)
        for i in range(12):
            brand = make_brand('Сорт {}'.format(i))
            Tasting.objects.create(user=self.user, brand=brand, rating=4)
        self.assertEqual(passport.balance(self.user)['earned'], 120 + 200 + 180)
        code = self.client_.post('/api/rewards/{}/redeem/'.format(self.platform.id)).json()['redemption']['code']
        self.assertEqual(client_for(self.owner).post('/api/redemptions/use/', {'code': code}, format='json').status_code, 403)
        self.assertEqual(client_for(self.mod).post('/api/redemptions/use/', {'code': code}, format='json').status_code, 200)
        cancelled = self.client_.post('/api/rewards/{}/redeem/'.format(self.reward.id))
        self.assertEqual(cancelled.status_code, 400)  # баллы ушли на экскурсию

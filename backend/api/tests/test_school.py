from django.test import TestCase

from api.models import QuizAttempt, QuizQuestion, UserPreferences
from .helpers import client_for, make_brand, make_user


def answer_all(level, right=True):
    """Ответы на все активные вопросы ступени: все верные или все неверные."""
    answers = {}
    for q in QuizQuestion.objects.filter(level=level, is_active=True):
        answers[str(q.id)] = q.correct_index if right else (q.correct_index + 1) % len(q.options)
    return answers


class PreferencesTests(TestCase):
    def test_guest_cannot_read_preferences(self):
        resp = client_for().get('/api/auth/preferences/')
        self.assertEqual(resp.status_code, 401)

    def test_user_gets_empty_preferences_then_saves_them(self):
        user = make_user('guest1')
        brand = make_brand()
        client = client_for(user)

        resp = client.get('/api/auth/preferences/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['taste'], {})
        self.assertEqual(resp.data['favorite_brands'], [])
        self.assertEqual(resp.data['sommelier_level'], 0)

        resp = client.patch('/api/auth/preferences/', {
            'taste': {'bitterness': 3, 'sweetness': 7.4, 'roast': None},
            'cuisines': ['KZ', 'ITALIAN', 'KZ'],
            'favorite_brands': [str(brand.id)],
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['taste'], {'bitterness': 3, 'sweetness': 7})
        self.assertEqual(resp.data['cuisines'], ['ITALIAN', 'KZ'])
        self.assertEqual(resp.data['favorite_brands'], [brand.id])

        # Сохранилось в базе и переживает новый запрос
        prefs = UserPreferences.objects.get(user=user)
        self.assertEqual(list(prefs.favorite_brands.all()), [brand])
        self.assertEqual(client.get('/api/auth/preferences/').data['taste']['sweetness'], 7)

    def test_bad_values_rejected(self):
        client = client_for(make_user('guest2'))
        for body in (
            {'taste': {'bitterness': 11}},
            {'taste': {'hoppiness': 5}},
            {'taste': {'body': True}},
            {'cuisines': ['MARS']},
        ):
            resp = client.patch('/api/auth/preferences/', body, format='json')
            self.assertEqual(resp.status_code, 400, body)

    def test_sommelier_level_is_read_only(self):
        client = client_for(make_user('cheater'))
        resp = client.patch('/api/auth/preferences/', {'sommelier_level': 4}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['sommelier_level'], 0)


class QuizTests(TestCase):
    def test_seeded_questions_exist_for_every_level(self):
        for level in (1, 2, 3, 4):
            self.assertGreaterEqual(QuizQuestion.objects.filter(level=level).count(), 5)

    def test_public_quiz_hides_answers(self):
        resp = client_for().get('/api/quiz/1/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['title'], 'Новичок')
        q = resp.data['questions'][0]
        self.assertEqual(set(q), {'id', 'text', 'options'})

    def test_unknown_level_is_404(self):
        self.assertEqual(client_for().get('/api/quiz/9/').status_code, 404)
        self.assertEqual(client_for().post('/api/quiz/9/submit/', {'answers': {}}, format='json').status_code, 404)

    def test_guest_gets_result_but_nothing_is_saved(self):
        resp = client_for().post('/api/quiz/1/submit/', {'answers': answer_all(1)}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data['passed'])
        self.assertEqual(resp.data['percent'], 100)
        self.assertFalse(resp.data['saved'])
        self.assertEqual(QuizAttempt.objects.count(), 0)

    def test_failed_attempt_keeps_level(self):
        user = make_user('learner')
        resp = client_for(user).post('/api/quiz/1/submit/', {'answers': answer_all(1, right=False)}, format='json')
        self.assertFalse(resp.data['passed'])
        self.assertEqual(resp.data['correct'], 0)
        self.assertEqual(resp.data['sommelier_level'], 0)
        self.assertTrue(all(r['explanation'] for r in resp.data['results']))

    def test_levels_count_only_in_order(self):
        user = make_user('learner2')
        client = client_for(user)
        # Сразу третья ступень: сдана, но ступень школы не растёт, пока нет первой и второй
        resp = client.post('/api/quiz/3/submit/', {'answers': answer_all(3)}, format='json')
        self.assertTrue(resp.data['passed'])
        self.assertEqual(resp.data['sommelier_level'], 0)
        client.post('/api/quiz/1/submit/', {'answers': answer_all(1)}, format='json')
        resp = client.post('/api/quiz/2/submit/', {'answers': answer_all(2)}, format='json')
        self.assertEqual(resp.data['sommelier_level'], 3)
        prefs = client.get('/api/auth/preferences/').data
        self.assertEqual(prefs['sommelier_level'], 3)
        self.assertEqual(prefs['passed_levels'], [1, 2, 3])

    def test_bad_answers_payload(self):
        resp = client_for().post('/api/quiz/1/submit/', {'answers': [1, 2]}, format='json')
        self.assertEqual(resp.status_code, 400)


class QuizQuestionPanelTests(TestCase):
    def test_guest_and_user_cannot_see_answers(self):
        self.assertEqual(client_for().get('/api/quiz-questions/').status_code, 401)
        self.assertEqual(client_for(make_user('u1')).get('/api/quiz-questions/').status_code, 403)

    def test_moderator_creates_edits_and_deletes(self):
        client = client_for(make_user('mod', role='moderator'))
        resp = client.post('/api/quiz-questions/', {
            'level': 2, 'text': 'Новый вопрос?', 'options': ['Да', ' Нет '], 'correct_index': 1,
            'explanation': 'Потому что',
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        qid = resp.data['id']
        self.assertEqual(resp.data['options'], ['Да', 'Нет'])

        resp = client.patch(f'/api/quiz-questions/{qid}/', {'correct_index': 0, 'is_active': False}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertFalse(resp.data['is_active'])
        # Выключенный вопрос гость не видит
        public = client_for().get('/api/quiz/2/').data['questions']
        self.assertNotIn(qid, [q['id'] for q in public])

        self.assertEqual(client.delete(f'/api/quiz-questions/{qid}/').status_code, 204)

    def test_sommelier_can_edit(self):
        client = client_for(make_user('som', role='sommelier'))
        self.assertEqual(client.get('/api/quiz-questions/').status_code, 200)

    def test_invalid_question_rejected(self):
        client = client_for(make_user('mod2', role='moderator'))
        bad = [
            {'level': 1, 'text': 'Q', 'options': ['один'], 'correct_index': 0},
            {'level': 1, 'text': 'Q', 'options': ['а', 'б'], 'correct_index': 5},
            {'level': 1, 'text': 'Q', 'options': ['а', ''], 'correct_index': 0},
        ]
        for body in bad:
            self.assertEqual(client.post('/api/quiz-questions/', body, format='json').status_code, 400, body)
        q = QuizQuestion.objects.first()
        resp = client.patch(f'/api/quiz-questions/{q.id}/', {'correct_index': 99}, format='json')
        self.assertEqual(resp.status_code, 400)

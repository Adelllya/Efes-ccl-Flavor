from django.core.management import call_command
from django.test import TestCase

from api import passport
from api.academy_content import EXTRA_QUESTIONS, LESSONS
from api.models import Lesson, LessonProgress, QuizQuestion
from api.views_school import QUIZ_SIZE
from .helpers import client_for, make_user


def right_answers(questions, right=True):
    """Ответы на вопросы теста из выдачи /api/quiz/<level>/."""
    bank = {str(q.id): q for q in QuizQuestion.objects.filter(pk__in=[q['id'] for q in questions])}
    answers = {}
    for item in questions:
        q = bank[item['id']]
        answers[item['id']] = q.correct_index if right else (q.correct_index + 1) % len(q.options)
    return answers


class AcademyContentTests(TestCase):
    def test_lessons_are_seeded_three_per_level(self):
        self.assertEqual(Lesson.objects.count(), len(LESSONS))
        for level in (1, 2, 3, 4):
            self.assertEqual(Lesson.objects.filter(level=level).count(), 3)

    def test_blocks_are_well_formed(self):
        for lesson in Lesson.objects.all():
            lesson.clean()
            self.assertTrue(lesson.summary)
            types = [b['type'] for b in lesson.blocks]
            self.assertEqual(types[0], 'text', lesson.slug)
            self.assertIn('check', types, lesson.slug)
            for block in lesson.blocks:
                if block['type'] == 'check':
                    self.assertGreaterEqual(len(block['options']), 3)
                    self.assertIn(block['correct_index'], range(len(block['options'])))
                    self.assertTrue(block['explanation'])
                if block['type'] in ('facts', 'steps'):
                    self.assertTrue(block['items'])
                if block['type'] == 'practice':
                    self.assertIn(block['action'], ('explorer', 'pairing', 'landing', 'menu'))

    def test_texts_have_no_long_dashes(self):
        for lesson in Lesson.objects.all():
            self.assertNotRegex(str(lesson.blocks) + lesson.title + lesson.summary, '[—–]')
        for q in QuizQuestion.objects.all():
            self.assertNotRegex(q.text + q.explanation + ' '.join(q.options), '[—–]')

    def test_question_bank_has_more_than_fifty(self):
        self.assertGreaterEqual(QuizQuestion.objects.count(), 20 + len(EXTRA_QUESTIONS))
        self.assertGreaterEqual(QuizQuestion.objects.count(), 50)
        for level in (1, 2, 3, 4):
            self.assertGreaterEqual(QuizQuestion.objects.filter(level=level, is_active=True).count(), 13)
        for q in QuizQuestion.objects.all():
            q.clean()
            self.assertTrue(q.explanation)
            self.assertEqual(len(set(q.options)), len(q.options), q.text)

    def test_load_academy_command_is_idempotent(self):
        lessons, questions = Lesson.objects.count(), QuizQuestion.objects.count()
        Lesson.objects.filter(slug='ingredients').update(title='Правка модератора')
        call_command('load_academy', '--keep', verbosity=0)
        self.assertEqual((Lesson.objects.count(), QuizQuestion.objects.count()), (lessons, questions))
        self.assertEqual(Lesson.objects.get(slug='ingredients').title, 'Правка модератора')
        call_command('load_academy', verbosity=0)
        self.assertEqual(Lesson.objects.get(slug='ingredients').title, 'Из чего состоит пиво')


class AcademyApiTests(TestCase):
    def test_guest_sees_the_whole_path(self):
        resp = client_for().get('/api/academy/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual([lv['level'] for lv in data['levels']], [1, 2, 3, 4])
        self.assertEqual(data['levels'][0]['name'], 'Новичок')
        first = data['levels'][0]
        self.assertEqual(len(first['lessons']), 3)
        self.assertEqual(set(first['lessons'][0]), {'id', 'slug', 'level', 'title', 'summary', 'minutes', 'done'})
        self.assertFalse(first['lessons'][0]['done'])
        self.assertEqual(first['quiz_size'], QUIZ_SIZE)
        self.assertGreaterEqual(first['questions'], 13)
        self.assertFalse(first['passed'])
        self.assertEqual(data['progress'], {
            'authenticated': False, 'lessons_done': 0, 'lessons_total': 12, 'passed_levels': [], 'points': None})
        self.assertFalse(data['show_team'])

    def test_empty_lessons_table_is_refilled(self):
        Lesson.objects.all().delete()
        data = client_for().get('/api/academy/').json()
        self.assertEqual(data['progress']['lessons_total'], 12)
        self.assertEqual(Lesson.objects.count(), 12)

    def test_lesson_detail_and_next(self):
        resp = client_for().get('/api/lessons/ingredients/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['title'], 'Из чего состоит пиво')
        self.assertFalse(data['done'])
        self.assertEqual(data['next']['slug'], 'lager-and-ale')
        self.assertTrue(data['blocks'])
        # Последний урок ступени ведёт в первый урок следующей, последний урок пути - никуда
        self.assertEqual(client_for().get('/api/lessons/read-the-label/').json()['next']['slug'], 'flavor-pyramid')
        self.assertIsNone(client_for().get('/api/lessons/service-problems/').json()['next'])
        self.assertEqual(client_for().get('/api/lessons/nope/').status_code, 404)
        Lesson.objects.filter(slug='ingredients').update(is_active=False)
        self.assertEqual(client_for().get('/api/lessons/ingredients/').status_code, 404)

    def test_complete_gives_points_once(self):
        self.assertEqual(client_for().post('/api/lessons/ingredients/complete/').status_code, 401)
        user = make_user('reader')
        client = client_for(user)
        first = client.post('/api/lessons/ingredients/complete/').json()
        self.assertEqual((first['done'], first['awarded']), (True, passport.POINTS_LESSON))
        self.assertEqual(first['points']['earned'], passport.POINTS_LESSON)
        again = client.post('/api/lessons/ingredients/complete/').json()
        self.assertEqual(again['awarded'], 0)
        self.assertEqual(again['points']['earned'], passport.POINTS_LESSON)
        self.assertEqual(LessonProgress.objects.filter(user=user).count(), 1)

        data = client.get('/api/academy/').json()
        self.assertTrue(data['levels'][0]['lessons'][0]['done'])
        self.assertEqual(data['progress']['lessons_done'], 1)
        self.assertEqual(data['progress']['points']['balance'], passport.POINTS_LESSON)
        self.assertTrue(client.get('/api/lessons/ingredients/').json()['done'])
        self.assertEqual(client.post('/api/lessons/nope/complete/').status_code, 404)


class QuizSamplingTests(TestCase):
    def test_quiz_is_a_sample_of_the_bank(self):
        questions = client_for().get('/api/quiz/1/').json()['questions']
        self.assertEqual(len(questions), QUIZ_SIZE)
        bank = set(str(pk) for pk in QuizQuestion.objects.filter(level=1, is_active=True).values_list('id', flat=True))
        self.assertTrue(set(q['id'] for q in questions) <= bank)
        self.assertEqual(len(set(q['id'] for q in questions)), QUIZ_SIZE)

    def test_small_bank_gives_all_questions(self):
        keep = list(QuizQuestion.objects.filter(level=2).values_list('id', flat=True)[:3])
        QuizQuestion.objects.filter(level=2).exclude(pk__in=keep).delete()
        questions = client_for().get('/api/quiz/2/').json()['questions']
        self.assertEqual(len(questions), 3)
        resp = client_for().post('/api/quiz/2/submit/', {'answers': right_answers(questions)}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['total'], 3)

    def test_submit_grades_only_asked_questions(self):
        user = make_user('learner')
        client = client_for(user)
        questions = client.get('/api/quiz/1/').json()['questions']
        resp = client.post('/api/quiz/1/submit/', {'answers': right_answers(questions)}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertEqual((data['correct'], data['total'], data['percent'], data['passed']), (QUIZ_SIZE, QUIZ_SIZE, 100, True))
        self.assertEqual(data['points']['earned'], passport.POINTS_LEVEL)
        # Вторая сдача той же ступени баллов не добавляет
        again = client.post('/api/quiz/1/submit/', {'answers': right_answers(questions)}, format='json').json()
        self.assertEqual(again['points']['earned'], passport.POINTS_LEVEL)

    def test_five_of_seven_passes_four_fails(self):
        questions = client_for().get('/api/quiz/3/').json()['questions']
        answers = right_answers(questions)
        wrong = right_answers(questions, right=False)
        for miss, passed in ((2, True), (3, False)):
            mixed = dict(answers)
            for key in list(answers)[:miss]:
                mixed[key] = wrong[key]
            data = client_for().post('/api/quiz/3/submit/', {'answers': mixed}, format='json').json()
            self.assertEqual(data['correct'], QUIZ_SIZE - miss)
            self.assertEqual(data['passed'], passed)

    def test_too_few_answers_rejected(self):
        questions = client_for().get('/api/quiz/1/').json()['questions']
        answers = right_answers(questions[:QUIZ_SIZE - 1])
        resp = client_for().post('/api/quiz/1/submit/', {'answers': answers}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('answers', resp.json()['errors'])
        # Чужие и выдуманные id вопросов не засчитываются
        fake = {'00000000-0000-0000-0000-00000000000{}'.format(i): 0 for i in range(QUIZ_SIZE)}
        self.assertEqual(client_for().post('/api/quiz/1/submit/', {'answers': fake}, format='json').status_code, 400)
        self.assertEqual(client_for().post('/api/quiz/1/submit/', {'answers': {}}, format='json').status_code, 400)

    def test_unanswered_question_counts_as_wrong(self):
        questions = client_for().get('/api/quiz/1/').json()['questions']
        answers = right_answers(questions)
        answers[questions[0]['id']] = None
        data = client_for().post('/api/quiz/1/submit/', {'answers': answers}, format='json').json()
        self.assertEqual(data['correct'], QUIZ_SIZE - 1)

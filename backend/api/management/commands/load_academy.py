from django.core.management.base import BaseCommand

from api.academy_content import load_lessons, load_questions, refresh_course_descriptions
from api.models import Course, Lesson, QuizQuestion


class Command(BaseCommand):
    help = 'Записывает стартовые уроки Академии и добавляет недостающие вопросы теста.'

    def add_arguments(self, parser):
        parser.add_argument('--keep', action='store_true',
                            help='Не трогать уже существующие уроки (правки модератора сохранятся).')

    def handle(self, *args, **options):
        created, updated = load_lessons(Lesson, only_new=options['keep'])
        added = load_questions(QuizQuestion)
        refresh_course_descriptions(Course)
        self.stdout.write(self.style.SUCCESS(
            'Уроки: создано {}, обновлено {}. Вопросов добавлено: {}.'.format(created, updated, added)))

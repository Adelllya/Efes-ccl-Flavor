from django.db import migrations

from api.academy_content import load_lessons, load_questions, refresh_course_descriptions


def load(apps, schema_editor):
    """Стартовые уроки и дополнительные вопросы теста. Существующие уроки и вопросы не трогаем."""
    load_lessons(apps.get_model('api', 'Lesson'), only_new=True)
    load_questions(apps.get_model('api', 'QuizQuestion'))
    refresh_course_descriptions(apps.get_model('api', 'Course'))


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0016_academy_passport_rewards'),
    ]

    operations = [
        migrations.RunPython(load, migrations.RunPython.noop),
    ]

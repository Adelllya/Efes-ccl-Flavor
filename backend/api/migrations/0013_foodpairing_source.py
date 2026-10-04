from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0012_seed_quiz_questions'),
    ]

    operations = [
        migrations.AddField(
            model_name='foodpairing',
            name='source',
            field=models.CharField(
                choices=[('SOMMELIER', 'Сомелье'), ('AI', 'ИИ-подбор')], default='SOMMELIER',
                help_text='ИИ-подбор: пару предложил ИИ, сомелье её ещё не подтвердил. '
                          'После правки сомелье или модератором пара становится парой сомелье.',
                max_length=10, verbose_name='Источник'),
        ),
    ]

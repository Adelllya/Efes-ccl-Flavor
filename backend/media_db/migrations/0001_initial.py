from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name='StoredFile',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=500, unique=True, verbose_name='Путь')),
                ('content', models.BinaryField(verbose_name='Содержимое')),
                ('content_type', models.CharField(blank=True, default='', max_length=100, verbose_name='Тип')),
                ('size', models.PositiveIntegerField(default=0, verbose_name='Размер, байт')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='Загружен')),
            ],
            options={
                'verbose_name': 'Файл',
                'verbose_name_plural': 'Файлы',
            },
        ),
    ]

from django.db import models


class StoredFile(models.Model):
    """Файл из ImageField (логотип заведения, фото блюда или сорта), целиком в базе."""

    name = models.CharField('Путь', max_length=500, unique=True)
    content = models.BinaryField('Содержимое')
    content_type = models.CharField('Тип', max_length=100, blank=True, default='')
    size = models.PositiveIntegerField('Размер, байт', default=0)
    created_at = models.DateTimeField('Загружен', auto_now_add=True)

    class Meta:
        verbose_name = 'Файл'
        verbose_name_plural = 'Файлы'

    def __str__(self):
        return self.name

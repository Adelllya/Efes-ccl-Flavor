from django.apps import AppConfig


class MediaDbConfig(AppConfig):
    """Загруженные фото в самой базе: на Vercel у функции нет постоянного диска."""
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'media_db'
    verbose_name = 'Файлы в базе'

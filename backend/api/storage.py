"""
Хранилище загруженных картинок.

Обычно файлы лежат на диске в MEDIA_ROOT. На хостинге, где диск только для чтения
(Vercel), запись на диск падает: тогда файл уходит в таблицу StoredFile и отдаётся
тем же адресом /media/<имя>. Чтение сначала смотрит на диск, потом в базу, поэтому
картинки из поставки и загруженные через панель живут рядом.
"""
import mimetypes

from django.core.files.base import ContentFile
from django.core.files.storage import FileSystemStorage


class MediaStorage(FileSystemStorage):

    @staticmethod
    def _rows():
        # Импорт внутри: хранилище создаётся раньше, чем готовы модели.
        from .models import StoredFile
        return StoredFile.objects

    def _save(self, name, content):
        try:
            return super()._save(name, content)
        except OSError:
            # Диск только для чтения или нет прав: кладём файл в базу под тем же именем.
            if hasattr(content, 'seek'):
                content.seek(0)
            data = content.read()
            name = str(name).replace('\\', '/')
            self._rows().update_or_create(name=name, defaults={
                'content': data,
                'content_type': mimetypes.guess_type(name)[0] or 'application/octet-stream',
                'size': len(data),
            })
            return name

    def _open(self, name, mode='rb'):
        if super().exists(name):
            return super()._open(name, mode)
        row = self._rows().filter(name=name).first()
        if row is None:
            raise FileNotFoundError(name)
        return ContentFile(bytes(row.content), name=name)

    def exists(self, name):
        return super().exists(name) or self._rows().filter(name=name).exists()

    def delete(self, name):
        if not name:
            return
        try:
            super().delete(name)
        except OSError:
            # Файл из поставки на диске только для чтения: убрать его нельзя, но и мешать он не будет.
            pass
        self._rows().filter(name=name).delete()

    def size(self, name):
        if super().exists(name):
            return super().size(name)
        row = self._rows().filter(name=name).only('size').first()
        if row is None:
            raise FileNotFoundError(name)
        return row.size

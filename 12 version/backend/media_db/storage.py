"""
Хранилище Django для загруженных файлов в базе (PostgreSQL на Vercel, SQLite в тестах).
Включается в settings.py, когда FT_MEDIA_IN_DB (на Vercel по умолчанию).

Новые файлы пишутся в таблицу media_db_storedfile. Фото, которые лежат в репозитории
(backend/media: сорта, блюда), читаются с диска функции как раньше: удалить их нельзя,
поэтому delete() для них ничего не делает, а при замене фото новое просто ложится в базу.

Имя каждого нового файла получает случайный суффикс, поэтому ответ /media/... можно
кэшировать надолго: заменённое фото получает другой адрес.
"""
import mimetypes
import os

from django.conf import settings
from django.core.exceptions import SuspiciousFileOperation
from django.core.files.base import ContentFile
from django.core.files.storage import Storage
from django.utils._os import safe_join
from django.utils.crypto import get_random_string
from django.utils.deconstruct import deconstructible
from django.utils.encoding import filepath_to_uri


def bundled_path(name):
    """Путь к файлу из репозитория (MEDIA_ROOT) или None, если такого файла нет."""
    try:
        path = safe_join(settings.MEDIA_ROOT, name)
    except (SuspiciousFileOperation, ValueError):
        return None
    return path if os.path.isfile(path) else None


@deconstructible
class DatabaseStorage(Storage):

    @staticmethod
    def _files():
        from .models import StoredFile
        return StoredFile.objects

    def _open(self, name, mode='rb'):
        row = self._files().filter(name=name).only('content').first()
        if row is not None:
            return ContentFile(bytes(row.content), name=name)
        path = bundled_path(name)
        if path is None:
            raise FileNotFoundError(name)
        with open(path, 'rb') as fh:
            return ContentFile(fh.read(), name=name)

    def _save(self, name, content):
        # Storage.save() всегда передаёт File: chunks() сам перематывает его в начало.
        data = b''.join(content.chunks())
        self._files().create(
            name=name,
            content=data,
            content_type=mimetypes.guess_type(name)[0] or 'application/octet-stream',
            size=len(data),
        )
        return name

    def get_available_name(self, name, max_length=None):
        name = name.replace('\\', '/')
        root, ext = os.path.splitext(name)
        while True:
            suffix = '_' + get_random_string(7)
            if max_length:
                root = root[:max(1, max_length - len(ext) - len(suffix))]
            candidate = f'{root}{suffix}{ext}'
            if not self.exists(candidate):
                return candidate

    def exists(self, name):
        return self._files().filter(name=name).exists() or bundled_path(name) is not None

    def delete(self, name):
        # Файлы из репозитория на Vercel только для чтения: их оставляем, из базы удаляем.
        self._files().filter(name=name).delete()

    def size(self, name):
        row = self._files().filter(name=name).only('size').first()
        if row is not None:
            return row.size
        path = bundled_path(name)
        if path is None:
            raise FileNotFoundError(name)
        return os.path.getsize(path)

    def url(self, name):
        return settings.MEDIA_URL + filepath_to_uri(name)

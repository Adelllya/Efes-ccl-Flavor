"""
Раздача /media/: файл с диска, а если его там нет, из таблицы StoredFile
(туда попадают загрузки на хостинге с диском только для чтения).
"""
import mimetypes
import os

from django.conf import settings
from django.http import Http404, HttpResponse
from django.utils.http import http_date
from django.views.decorators.http import require_safe
from django.views.static import serve

from .models import StoredFile

# Картинки отдаём как картинки; всё остальное только на скачивание, чтобы файл
# с чужим содержимым не открылся в браузере как страница.
INLINE_TYPES = {'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/x-icon'}
CACHE_SECONDS = 24 * 60 * 60


def _harden(response, name):
    content_type = (mimetypes.guess_type(name)[0] or 'application/octet-stream').lower()
    if content_type not in INLINE_TYPES:
        response['Content-Type'] = 'application/octet-stream'
        response['Content-Disposition'] = 'attachment'
    response['X-Content-Type-Options'] = 'nosniff'
    response.setdefault('Cache-Control', 'public, max-age={}'.format(CACHE_SECONDS))
    return response


@require_safe
def serve_media(request, path):
    full = os.path.join(str(settings.MEDIA_ROOT), path)
    if os.path.isfile(full):
        return _harden(serve(request, path, document_root=settings.MEDIA_ROOT), path)
    row = StoredFile.objects.filter(name=path).first()
    if row is None:
        raise Http404('Файл не найден')
    response = HttpResponse(bytes(row.content), content_type=row.content_type or 'application/octet-stream')
    response['Content-Length'] = str(row.size)
    response['Last-Modified'] = http_date(row.created_at.timestamp())
    return _harden(response, path)

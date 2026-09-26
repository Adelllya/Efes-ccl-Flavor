import os

from django.conf import settings
from django.core.files.storage import default_storage
from django.http import Http404, HttpResponse
from django.views.static import serve

from .models import StoredFile
from .storage import DatabaseStorage

# Из /media отдаём только картинки: что бы ни лежало в media/ или в базе, как страница сайта оно не откроется.
IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.ico'}
# Загруженный файл получает новое имя при каждой замене, поэтому его можно кэшировать навсегда.
CACHE_UPLOADED = 'public, max-age=31536000, s-maxage=31536000, immutable'
# Фото из репозитория могут замениться под тем же именем со следующим деплоем:
# браузер держит их сутки, CDN Vercel неделю (новый деплой сбрасывает кэш CDN).
CACHE_BUNDLED = 'public, max-age=86400, s-maxage=604800'


def serve_media(request, path):
    """GET /media/<путь>: сначала файл из базы (если включён media_db), иначе файл из media/."""
    if os.path.splitext(path)[1].lower() not in IMAGE_EXTENSIONS:
        raise Http404()
    if isinstance(default_storage, DatabaseStorage):
        row = StoredFile.objects.filter(name=path).only('content', 'content_type').first()
        if row is not None:
            response = HttpResponse(bytes(row.content), content_type=row.content_type or 'application/octet-stream')
            response['Cache-Control'] = CACHE_UPLOADED
            return response
    response = serve(request, path, document_root=settings.MEDIA_ROOT)
    # Локально фото меняют и сразу смотрят, поэтому там без долгого кэша.
    response['Cache-Control'] = 'no-cache' if settings.DEBUG else CACHE_BUNDLED
    return response

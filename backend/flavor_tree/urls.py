from django.contrib import admin
from django.urls import path, include, re_path

from media_db.views import serve_media

urlpatterns = [
    # Админка Django пускает только сотрудников (is_staff), как и раньше.
    path('admin/', admin.site.urls),
    path('api/', include('api.urls')),
]

# Картинки из media/ отдаём и на продакшене: на Vercel нет отдельного сервера для файлов.
# Загруженные на Vercel фото лежат в базе (media_db), фото из репозитория на диске.
# Отдаются только картинки (проверяет serve_media).
urlpatterns += [
    re_path(r'^media/(?P<path>.+)$', serve_media),
]

from django.contrib import admin
from django.urls import path, include, re_path

from api.media import serve_media

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('api.urls')),
    # Картинки отдаём и на сервере: отдельного сервера для файлов на Vercel нет.
    # Файл берётся с диска, а загруженный через панель на таком хостинге - из базы.
    re_path(r'^media/(?P<path>.*)$', serve_media, name='media'),
]

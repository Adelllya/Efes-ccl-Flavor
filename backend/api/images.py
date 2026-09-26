"""
Работа с загруженными картинками: проверка файла, замена файла в поле,
уменьшенная копия для списков и фото сорта в один шаг.
"""
import io
import os

from django.core.files.base import ContentFile
from PIL import Image, ImageOps

IMAGE_TYPES = {'image/jpeg', 'image/png', 'image/webp'}
# MPO - JPEG с несколькими кадрами, такие снимают некоторые телефоны; для браузера это обычный JPEG.
IMAGE_FORMATS = {'JPEG', 'MPO', 'PNG', 'WEBP'}
# Vercel не принимает запрос больше 4,5 МБ, поэтому предел 4 МБ с запасом на остальную форму.
IMAGE_MAX_BYTES = 4 * 1024 * 1024
THUMB_MAX_SIDE = 480


def read_image_upload(request):
    """
    Файл из multipart (поле image или file) с проверкой типа и размера.
    Возвращает (файл, None) или (None, текст ошибки).
    """
    file_obj = request.FILES.get('image') or request.FILES.get('file')
    if not file_obj:
        return None, 'Файл изображения (поле image или file) не передан'
    if (file_obj.content_type or '').lower() not in IMAGE_TYPES:
        return None, 'Подходят только PNG, JPG или WebP'
    if file_obj.size > IMAGE_MAX_BYTES:
        return None, 'Файл больше 4 МБ'
    try:
        image = Image.open(file_obj)
        image_format = image.format
        image.verify()
        # verify() у JPEG и WebP почти ничего не проверяет, поэтому файл ещё и честно декодируем.
        file_obj.seek(0)
        Image.open(file_obj).load()
    except Exception:
        return None, 'Файл повреждён или не является изображением'
    if image_format not in IMAGE_FORMATS:
        return None, 'Подходят только PNG, JPG или WebP'
    file_obj.seek(0)
    return file_obj, None


def replace_image(instance, field_name, file_obj):
    """Кладёт новый файл в ImageField (или очищает при None), старый файл удаляется из хранилища."""
    current = getattr(instance, field_name)
    if current:
        current.delete(save=False)
    setattr(instance, field_name, file_obj)
    instance.save(update_fields=[field_name])


def make_thumbnail(source, stem, max_side=THUMB_MAX_SIDE):
    """
    Уменьшенная копия: длинная сторона max_side px.
    PNG, если у исходника есть прозрачность, иначе JPEG качества 85.
    """
    source.seek(0)
    image = Image.open(source)
    image.load()
    # Телефоны хранят поворот кадра в EXIF; пиксели надо повернуть, иначе миниатюра ляжет на бок.
    image = ImageOps.exif_transpose(image)
    has_alpha = image.mode in ('RGBA', 'LA') or (image.mode == 'P' and 'transparency' in image.info)
    if has_alpha:
        image = image.convert('RGBA')
        image_format, ext, options = 'PNG', 'png', {'optimize': True}
    else:
        image = image.convert('RGB')
        image_format, ext, options = 'JPEG', 'jpg', {'quality': 85, 'optimize': True}
    image.thumbnail((max_side, max_side), Image.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, format=image_format, **options)
    return ContentFile(buffer.getvalue(), name='{}_sm.{}'.format(stem, ext))


def regenerate_brand_thumb(brand):
    """Пересобирает image из image_hd. Возвращает False, если оригинала нет."""
    if not brand.image_hd:
        return False
    stem = os.path.splitext(os.path.basename(brand.image_hd.name))[0]
    with brand.image_hd.storage.open(brand.image_hd.name, 'rb') as source:
        thumb = make_thumbnail(source, stem)
    replace_image(brand, 'image', thumb)
    return True


def set_brand_photo(brand, file_obj):
    """
    Одно фото: оригинал в image_hd, уменьшенная копия в image. Старые файлы обоих полей удаляются.
    Миниатюра собирается до записи в модель: с битым файлом вернём текст ошибки, поля останутся прежними.
    Возвращает None или текст ошибки.
    """
    try:
        thumb = make_thumbnail(file_obj, 'thumb')
    except Exception:
        return 'Файл повреждён или не является изображением'
    file_obj.seek(0)
    replace_image(brand, 'image_hd', file_obj)
    # Имя миниатюры повторяет имя сохранённого оригинала, как в regen_brand_thumbs.
    stem = os.path.splitext(os.path.basename(brand.image_hd.name))[0]
    thumb.name = '{}_sm{}'.format(stem, os.path.splitext(thumb.name)[1])
    replace_image(brand, 'image', thumb)
    return None


def clear_brand_images(brand):
    for field_name in ('image', 'image_hd'):
        if getattr(brand, field_name):
            replace_image(brand, field_name, None)

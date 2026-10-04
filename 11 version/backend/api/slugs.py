"""
Slug для адреса меню: "Efes Beer Garden" -> efes-beer-garden, "Бар 13" -> bar-13.
Кириллицу переводим сами, потому что slugify без allow_unicode её просто выбрасывает.
"""
from django.utils.text import slugify

CYRILLIC_TABLE = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh',
    'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
    'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts',
    'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu',
    'я': 'ya',
    # Казахские буквы
    'ә': 'a', 'ғ': 'g', 'қ': 'q', 'ң': 'n', 'ө': 'o', 'ұ': 'u', 'ү': 'u', 'һ': 'h', 'і': 'i',
}


def transliterate(text):
    out = []
    for ch in str(text or ''):
        low = ch.lower()
        if low in CYRILLIC_TABLE:
            out.append(CYRILLIC_TABLE[low])
        else:
            out.append(ch)
    return ''.join(out)


def make_slug(text, max_length=120):
    base = slugify(transliterate(text))[:max_length].strip('-')
    return base or 'venue'


def unique_slug(text, exists, max_length=120):
    """
    Подбирает свободный slug: base, base-2, base-3...
    exists(candidate) -> True, если такой slug уже занят.
    """
    base = make_slug(text, max_length)
    candidate = base
    counter = 2
    while exists(candidate):
        suffix = '-%d' % counter
        candidate = base[:max_length - len(suffix)] + suffix
        counter += 1
    return candidate

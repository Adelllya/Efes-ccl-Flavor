"""
Кэш браузера для публичного каталога: телефон гостя не ходит за одними и теми же списками
(сорта, напитки и блюда движка, пары, ноты) при каждом переходе между экранами.

Кэшируется только ответ 200 на анонимный GET или HEAD по адресам каталога (CATALOG_PREFIXES),
и только в браузере гостя: private, max-age=CATALOG_MAX_AGE. Общий кэш (CDN Vercel) такой ответ
не хранит. Один и тот же адрес API открывают с двух доменов: сайт на flavor-tree-frontend
ходит через CORS, тот же сайт на flavor-tree-backend без него. Ответ из CDN без
Access-Control-Allow-Origin сломал бы каталог на основном домене, а проверить на проде,
что CDN разделяет ответы по Vary: Origin, нельзя без деплоя.

Не кэшируются: запросы с токеном или сессией (сомелье, модератор, заведение видят черновики
и сразу свои правки), меню и заведения (наличие меняется в смене), заказы, пилот, ИИ,
подбор с ?venue= (карта бара), любые ошибки. Vary: Authorization, Cookie не даёт браузеру
отдать ответ гостя после входа. Локально (DEBUG) кэша нет, как и у /media: данные меняют
и сразу смотрят.
"""
from django.conf import settings
from django.utils.cache import patch_vary_headers

# Минута: правка модератора видна гостю не позже чем через минуту, а переходы по экранам
# и возврат назад обходятся без сети.
CATALOG_MAX_AGE = 60
CATALOG_CACHE_CONTROL = 'private, max-age={}'.format(CATALOG_MAX_AGE)

# /api/landing/ сюда не входит: у него свой cache_page на 5 минут (views.landing_data).
CATALOG_PREFIXES = (
    '/api/brands/',
    '/api/dishes/',
    '/api/pairings/',
    '/api/flavor-notes/',
    '/api/food-icons/',
    '/api/courses/',
    '/api/team/',
    '/api/settings/',
    '/api/v2/meta/',
    '/api/v2/drinks/',
    '/api/v2/dishes/',
    '/api/v2/pairing/dish/',
    '/api/v2/pairing/explain/',
)


def is_catalog_request(request):
    """Анонимный GET или HEAD к публичному каталогу (без карты конкретного бара)."""
    if request.method not in ('GET', 'HEAD') or not request.path.startswith(CATALOG_PREFIXES):
        return False
    if request.META.get('HTTP_AUTHORIZATION') or 'venue' in request.GET:
        return False
    # DRF после проверки токена кладёт пользователя и в request Django, поэтому здесь
    # видна и сессия, и токен.
    user = getattr(request, 'user', None)
    return not (user is not None and user.is_authenticated)


class CatalogBrowserCacheMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if (
            not settings.DEBUG
            and response.status_code == 200
            and not response.has_header('Cache-Control')
            and not response.cookies
            and is_catalog_request(request)
        ):
            response['Cache-Control'] = CATALOG_CACHE_CONTROL
            patch_vary_headers(response, ('Authorization', 'Cookie'))
        return response

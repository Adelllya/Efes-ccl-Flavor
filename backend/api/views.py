import logging
import uuid

from rest_framework import viewsets, status, filters
from rest_framework.decorators import api_view, action, permission_classes
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated, IsAuthenticatedOrReadOnly
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from django.db import connection
from django.db.models import Count, Q, Prefetch, ProtectedError
from django.shortcuts import get_object_or_404
from django.views.decorators.cache import cache_page
from django.utils.decorators import method_decorator

from .images import (  # noqa: F401 - имена нужны и другим модулям
    IMAGE_TYPES, IMAGE_FORMATS, IMAGE_MAX_BYTES,
    read_image_upload, replace_image, set_brand_photo, clear_brand_images,
)
from .models import (
    FlavorNote, Brand, FlavorProfile, ServingRecommendation,
    Course, TeamMember, Dish, FoodPairing, FoodIcon, SiteSettings,
    Venue, MenuItem, MenuDrink,
)
from .permissions import (
    ROLE_MODERATOR, ROLE_SOMMELIER, has_role,
    ReadOnlyOrModerator, ReadOnlyOrSommelier, ReadOnlyOrRestaurant,
    IsModerator, IsRestaurantOrModerator,
    IsOwnerOfVenueOrModerator,
)
from .serializers import (
    FoodIconSerializer, SiteSettingsSerializer,
    FlavorNoteSerializer, BrandListSerializer, BrandDetailSerializer,
    BrandCreateUpdateSerializer, FlavorProfileSerializer,
    PyramidNoteSerializer, CourseSerializer, TeamMemberSerializer,
    DishSerializer, FoodPairingSerializer,
    FlavorProfileBulkSerializer, ServingRecommendationUpsertSerializer,
    ServingRecommendationSerializer,
    VenueSerializer, MenuItemSerializer, MenuDrinkSerializer, build_venue_menu, parse_uuid,
)

logger = logging.getLogger(__name__)


class Conflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = 'conflict'


def pyramid_payload(brand, request=None):
    """Пирамида бренда в том же виде, что отдаёт GET /api/brands/{id}/pyramid/."""
    profiles = FlavorProfile.objects.filter(brand=brand).select_related('flavor_note')
    context = {'request': request}
    data = {'brand': brand.name, 'brand_id': str(brand.id)}
    for key, layer in (('top', 'TOP'), ('heart', 'HEART'), ('base', 'BASE')):
        layer_profiles = profiles.filter(layer=layer).order_by('-intensity')
        data[key] = PyramidNoteSerializer(layer_profiles, many=True, context=context).data
    return data


# PUBLIC VIEWSETS

class BrandViewSet(viewsets.ModelViewSet):
    """
    GET  /api/brands/           - список с фильтрами и пагинацией
    POST /api/brands/           - создать бренд
    GET  /api/brands/{id}/      - детальная карточка
    PATCH/PUT /api/brands/{id}/ - обновить
    DELETE /api/brands/{id}/    - удалить (каскадно)
    GET  /api/brands/{id}/pyramid/ - вкусовая пирамида
    Запись только модератору. Снятые с публикации сорта видят только сомелье и модератор.
    """
    queryset = Brand.objects.prefetch_related(
        'flavor_profiles__flavor_note',
        'serving_recommendation',
    ).all()
    permission_classes = [ReadOnlyOrModerator]

    def get_serializer_class(self):
        if self.action == 'list':
            return BrandListSerializer
        if self.action in ('create', 'update', 'partial_update'):
            return BrandCreateUpdateSerializer
        return BrandDetailSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        params = self.request.query_params

        # Гостю и остальным ролям неактивные сорта не показываем: в списке их нет, карточка даёт 404.
        if not has_role(self.request.user, ROLE_SOMMELIER):
            queryset = queryset.filter(is_active=True)

        style = params.get('style')
        if style:
            queryset = queryset.filter(style__icontains=style)

        q = params.get('q')
        if q:
            queryset = queryset.filter(name__icontains=q)

        is_active = params.get('is_active')
        if is_active is not None and is_active != '':
            queryset = queryset.filter(is_active=is_active.lower() in ('true', '1'))

        packaging_type = params.get('packaging_type')
        if packaging_type:
            queryset = queryset.filter(packaging_type=packaging_type.upper())

        is_horeca_only = params.get('is_horeca_only')
        if is_horeca_only is not None and is_horeca_only != '':
            queryset = queryset.filter(is_horeca_only=is_horeca_only.lower() in ('true', '1'))

        # Ordering filter
        ordering = params.get('ordering')
        if ordering:
            allowed = {'name', '-name', 'abv', '-abv', 'created_at', '-created_at', 'style', '-style'}
            if ordering in allowed:
                queryset = queryset.order_by(ordering)

        return queryset

    def perform_update(self, serializer):
        instance = serializer.save()
        # Вложенный servingRecommendation при PATCH
        sr_data = self.request.data.get('serving_recommendation')
        if sr_data and isinstance(sr_data, dict):
            ServingRecommendation.objects.update_or_create(
                brand=instance,
                defaults={
                    'serving_temp_min': sr_data.get('serving_temp_min', 4),
                    'serving_temp_max': sr_data.get('serving_temp_max', 8),
                    'glass_type': sr_data.get('glass_type', 'Standard'),
                    'seasonality': sr_data.get('seasonality', ''),
                },
            )

    @action(detail=True, methods=['get'], url_path='pyramid')
    def pyramid(self, request, pk=None):
        """GET /api/brands/{id}/pyramid/ - вкусовая пирамида."""
        brand = self.get_object()
        return Response(pyramid_payload(brand, request))

    @action(detail=True, methods=['post', 'delete'], url_path='upload-image',
            parser_classes=[MultiPartParser, FormParser], permission_classes=[IsModerator])
    def upload_image(self, request, pk=None):
        """
        POST   /api/brands/{id}/upload-image/ - одно фото в хорошем качестве (поле image или file):
               оригинал ложится в image_hd, уменьшенная копия для списков в image делается сама.
        DELETE /api/brands/{id}/upload-image/ - убрать оба файла.
        """
        brand = self.get_object()
        if request.method == 'DELETE':
            clear_brand_images(brand)
            return Response(BrandDetailSerializer(brand, context={'request': request}).data)
        file_obj, error = read_image_upload(request)
        if not error:
            error = set_brand_photo(brand, file_obj)
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)
        return Response(BrandDetailSerializer(brand, context={'request': request}).data)


class FlavorNoteViewSet(viewsets.ModelViewSet):
    """
    GET /api/flavor-notes/              - справочник нот, фильтр ?category=, ?off_flavour=
    GET /api/flavor-notes/{id}/brands/  - обратный поиск: нота → бренды
    """
    queryset = FlavorNote.objects.all()
    serializer_class = FlavorNoteSerializer
    permission_classes = [ReadOnlyOrModerator]
    # Справочник небольшой, панели он нужен целиком одним запросом.
    pagination_class = None

    def get_queryset(self):
        queryset = super().get_queryset()
        params = self.request.query_params

        category = params.get('category')
        if category:
            queryset = queryset.filter(category=category.upper())

        off_flavour = params.get('off_flavour')
        if off_flavour is not None and off_flavour != '':
            queryset = queryset.filter(is_off_flavour=off_flavour.lower() in ('true', '1'))

        return queryset

    @action(detail=True, methods=['get'], url_path='brands')
    def brands(self, request, pk=None):
        """GET /api/flavor-notes/{id}/brands/ - бренды, содержащие эту ноту."""
        note = self.get_object()
        profiles = FlavorProfile.objects.filter(flavor_note=note).select_related('brand')
        brands_data = []
        for p in profiles:
            brands_data.append({
                'brand_id': str(p.brand.id),
                'brand_name': p.brand.name,
                'layer': p.layer,
                'intensity': p.intensity,
            })
        return Response(brands_data)


class CourseViewSet(viewsets.ReadOnlyModelViewSet):
    """GET /api/courses/ - курсы Школы Пивных Сомелье (read-only)."""
    queryset = Course.objects.all()
    serializer_class = CourseSerializer


class TeamMemberViewSet(viewsets.ReadOnlyModelViewSet):
    """GET /api/team/ - команда Flavor Tree (read-only)."""
    queryset = TeamMember.objects.all()
    serializer_class = TeamMemberSerializer


class DishViewSet(viewsets.ModelViewSet):
    """
    Каталог блюд. Чтение открыто всем, запись администратору заведения и модератору.

    GET    /api/dishes/       - список с фильтрами:
    ?cuisine=KZ|ITALIAN|JAPANESE|AMERICAN|MEXICAN|GERMAN
    ?dominant_taste=SALTY|SWEET|SOUR|BITTER|UMAMI|SPICY|MIXED
    ?weight=LIGHT|MEDIUM|HEAVY
    ?fat_level=LOW|MEDIUM|HIGH
    ?cooking_method=FRIED|GRILLED|BAKED|BOILED|STEAMED|RAW|CURED|FERMENTED|OTHER
    ?category=подстрока_категории
    ?q=поиск_по_названию
    POST   /api/dishes/       - добавить блюдо
    PATCH  /api/dishes/{id}/  - изменить (администратор заведения - только если блюда нет в чужом меню)
    DELETE /api/dishes/{id}/  - удалить вместе с его парами (только модератор)
    POST   /api/dishes/{id}/upload-image/   - загрузить фото (multipart, поле image или file)
    DELETE /api/dishes/{id}/upload-image/   - убрать фото
    """
    queryset = Dish.objects.all()
    serializer_class = DishSerializer
    permission_classes = [ReadOnlyOrRestaurant]

    def get_permissions(self):
        # Блюдо общее для всех заведений: удалять его может только модератор.
        if self.action == 'destroy':
            return [IsModerator()]
        return super().get_permissions()

    def get_queryset(self):
        # После annotate с GROUP BY Django не применяет Meta.ordering, задаём порядок явно.
        queryset = super().get_queryset().annotate(
            menu_items_count=Count('menu_items', distinct=True),
            pairings_count=Count('food_pairings', distinct=True),
        ).order_by('cuisine', 'name')
        params = self.request.query_params

        cuisine = params.get('cuisine')
        if cuisine:
            queryset = queryset.filter(cuisine=cuisine.upper())

        dominant_taste = params.get('dominant_taste')
        if dominant_taste:
            queryset = queryset.filter(dominant_taste=dominant_taste.upper())

        weight = params.get('weight')
        if weight:
            queryset = queryset.filter(weight=weight.upper())

        fat_level = params.get('fat_level')
        if fat_level:
            queryset = queryset.filter(fat_level=fat_level.upper())

        # Мастер подбора спрашивает способ приготовления отдельным шагом,
        # поэтому фильтр по нему нужен так же, как по вкусу и весу.
        cooking_method = params.get('cooking_method')
        if cooking_method:
            queryset = queryset.filter(cooking_method=cooking_method.upper())

        # Категория - свободный текст, ищем по вхождению.
        category = params.get('category')
        if category:
            queryset = queryset.filter(category__icontains=category)

        q = params.get('q')
        if q:
            queryset = queryset.filter(name__icontains=q)

        return queryset

    def _check_can_edit(self, dish):
        """Администратор заведения не меняет блюдо, которое стоит в меню другого заведения."""
        user = self.request.user
        if has_role(user, ROLE_MODERATOR):
            return
        if dish.menu_items.exclude(venue__owner=user).exists():
            raise PermissionDenied('Блюдо есть в меню другого заведения, изменить его может только модератор')

    def perform_update(self, serializer):
        self._check_can_edit(serializer.instance)
        serializer.save()

    @action(detail=True, methods=['post', 'delete'], url_path='upload-image',
            parser_classes=[MultiPartParser, FormParser])
    def upload_image(self, request, pk=None):
        dish = self.get_object()
        self._check_can_edit(dish)
        if request.method == 'DELETE':
            if dish.photo:
                replace_image(dish, 'photo', None)
            return Response(self.get_serializer(dish).data)
        file_obj, error = read_image_upload(request)
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)
        replace_image(dish, 'photo', file_obj)
        return Response(self.get_serializer(dish).data)


class FoodPairingViewSet(viewsets.ModelViewSet):
    """
    Пары «пиво + блюдо». Чтение открыто всем, запись сомелье и модератору.

    GET    /api/pairings/       - список с фильтрами:
    ?brand_id=uuid / ?brand_name=...
    ?dish_id=uuid / ?dish_name=...
    ?pairing_type=COMPLEMENT|CONTRAST|CLEANSE|BRIDGE
    POST   /api/pairings/       - добавить пару
    PATCH  /api/pairings/{id}/  - изменить
    DELETE /api/pairings/{id}/  - удалить
    """
    queryset = FoodPairing.objects.select_related('brand', 'dish').all()
    serializer_class = FoodPairingSerializer
    permission_classes = [ReadOnlyOrSommelier]

    def get_queryset(self):
        queryset = super().get_queryset()
        params = self.request.query_params

        brand_id = params.get('brand_id')
        if brand_id:
            queryset = queryset.filter(brand_id=_uuid_or_400(brand_id, 'brand_id'))

        brand_name = params.get('brand_name')
        if brand_name:
            queryset = queryset.filter(brand__name__icontains=brand_name)

        dish_id = params.get('dish_id')
        if dish_id:
            queryset = queryset.filter(dish_id=_uuid_or_400(dish_id, 'dish_id'))

        dish_name = params.get('dish_name')
        if dish_name:
            queryset = queryset.filter(dish__name__icontains=dish_name)

        pairing_type = params.get('pairing_type')
        if pairing_type:
            queryset = queryset.filter(pairing_type=pairing_type.upper())

        return queryset


# STANDALONE VIEWS

class VenueViewSet(viewsets.ModelViewSet):
    """
    Заведения и их электронное меню. Адресуются по slug.

    GET    /api/venues/              - опубликованные заведения (модератор видит все)
    POST   /api/venues/              - администратор заведения (одно на пользователя) или модератор
    GET    /api/venues/<slug>/       - карточка
    PATCH  /api/venues/<slug>/       - владелец или модератор
    DELETE /api/venues/<slug>/       - модератор; заведение с заказами не удаляется (409), его снимают с публикации
    GET    /api/venues/mine/         - заведения текущего пользователя
    GET    /api/venues/<slug>/menu/  - публичное меню с сочетаниями
    POST   /api/venues/<slug>/upload-logo/   - загрузить логотип (владелец или модератор)
    DELETE /api/venues/<slug>/upload-logo/   - убрать логотип
    """
    serializer_class = VenueSerializer
    lookup_field = 'slug'
    pagination_class = None

    def get_permissions(self):
        if self.action == 'create':
            classes = [IsRestaurantOrModerator]
        elif self.action in ('update', 'partial_update', 'upload_logo'):
            classes = [IsAuthenticated, IsOwnerOfVenueOrModerator]
        elif self.action == 'destroy':
            classes = [IsModerator]
        elif self.action == 'mine':
            classes = [IsAuthenticated]
        else:
            classes = []
        return [cls() for cls in classes]

    def get_queryset(self):
        queryset = Venue.objects.select_related('owner').annotate(items_count=Count('menu_items'))
        user = self.request.user
        if has_role(user, ROLE_MODERATOR):
            return queryset
        # Неопубликованное заведение видит только его владелец.
        if user.is_authenticated:
            return queryset.filter(Q(is_published=True) | Q(owner=user))
        return queryset.filter(is_published=True)

    def get_serializer(self, *args, **kwargs):
        serializer = super().get_serializer(*args, **kwargs)
        # Владельца задаёт только модератор: остальным поле owner доступно лишь на чтение.
        if not kwargs.get('many') and not has_role(self.request.user, ROLE_MODERATOR):
            serializer.fields['owner'].read_only = True
        return serializer

    def perform_create(self, serializer):
        user = self.request.user
        if has_role(user, ROLE_MODERATOR):
            serializer.save()
            return
        if Venue.objects.filter(owner=user).exists():
            raise ValidationError({'detail': 'У вас уже есть заведение'})
        serializer.save(owner=user)

    def perform_destroy(self, instance):
        # Заказы держат заведение (on_delete=PROTECT): данные пилота не должны пропасть вместе с ним.
        try:
            instance.delete()
        except ProtectedError:
            raise Conflict('У заведения есть заказы, удалить его нельзя. Снимите его с публикации.')

    @action(detail=True, methods=['post', 'delete'], url_path='upload-logo',
            parser_classes=[MultiPartParser, FormParser])
    def upload_logo(self, request, slug=None):
        venue = self.get_object()
        if request.method == 'DELETE':
            if venue.logo_file:
                replace_image(venue, 'logo_file', None)
            return Response(self.get_serializer(venue).data)
        file_obj, error = read_image_upload(request)
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)
        replace_image(venue, 'logo_file', file_obj)
        return Response(self.get_serializer(venue).data)

    @action(detail=False, methods=['get'], url_path='mine')
    def mine(self, request):
        queryset = Venue.objects.select_related('owner').annotate(items_count=Count('menu_items'))
        if not has_role(request.user, ROLE_MODERATOR):
            queryset = queryset.filter(owner=request.user)
        return Response(VenueSerializer(queryset, many=True, context={'request': request}).data)

    @action(detail=True, methods=['get'], url_path='menu')
    def menu(self, request, slug=None):
        """?age=under21 - гость ответил, что ему нет 21: блюда те же, напитки только безалкогольные."""
        venue = self.get_object()
        minor = (request.query_params.get('age') or '').strip().lower() == 'under21'
        return Response(build_venue_menu(venue, request, minor=minor))


class VenueScopedViewSet(viewsets.ModelViewSet):
    """
    Общее для позиций меню и напитков бара. GET открыт всем, ?venue=<uuid или slug>.
    Запись только владельцу заведения или модератору.
    """
    pagination_class = None
    permission_classes = [IsAuthenticatedOrReadOnly, IsOwnerOfVenueOrModerator]

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        # Позиции скрытого заведения видят только его владелец и модератор.
        if not has_role(user, ROLE_MODERATOR):
            if user.is_authenticated:
                queryset = queryset.filter(Q(venue__is_published=True) | Q(venue__owner=user))
            else:
                queryset = queryset.filter(venue__is_published=True)
        venue = self.request.query_params.get('venue')
        if venue:
            venue_id = parse_uuid(venue)
            queryset = queryset.filter(venue_id=venue_id) if venue_id else queryset.filter(venue__slug=venue)
        return queryset

    def _check_venue_owner(self, venue):
        user = self.request.user
        if has_role(user, ROLE_MODERATOR) or venue.owner_id == user.id:
            return
        raise PermissionDenied('Это заведение вам не принадлежит')

    def perform_create(self, serializer):
        self._check_venue_owner(serializer.validated_data['venue'])
        serializer.save()

    def perform_update(self, serializer):
        new_venue = serializer.validated_data.get('venue')
        if new_venue is not None and new_venue.pk != serializer.instance.venue_id:
            self._check_venue_owner(new_venue)
        serializer.save()


class MenuItemViewSet(VenueScopedViewSet):
    """Позиции меню (блюда): /api/menu-items/."""
    queryset = MenuItem.objects.select_related('venue', 'dish').all()
    serializer_class = MenuItemSerializer


class MenuDrinkViewSet(VenueScopedViewSet):
    """Карта напитков заведения: /api/menu-drinks/."""
    queryset = MenuDrink.objects.select_related('venue', 'brand').all()
    serializer_class = MenuDrinkSerializer


@api_view(['GET'])
@cache_page(60 * 5)  # Кеширование на 5 минут
def landing_data(request):
    """
    GET /api/landing/ - агрегирующий эндпоинт: project info, team, courses, stats, quote.
    Один запрос вместо четырёх.
    """
    brands_count = Brand.objects.filter(is_active=True).count()
    notes_count = FlavorNote.objects.count()
    profiles_count = FlavorProfile.objects.count()
    courses_qs = Course.objects.all()
    team_qs = TeamMember.objects.all()

    return Response({
        'project': {
            'name': 'Flavor Tree',
            'tagline': "Don't just drink - listen to the flavor",
            'description': (
                'Платформа сенсорного образования и подбора пива. '
                'Каждый сорт раскладывается на «Вкусовую пирамиду»: '
                'верхние ноты, сердце и послевкусие.'
            ),
            'partner': 'EFES Kazakhstan · One Idea University / Anadolu Group',
            'market': 'Казахстан',
        },
        # Отзывов гостей пока нет. После пилота сюда идёт настоящая цитата с согласия гостя.
        'quote': None,
        'stats': {
            'brands': brands_count,
            'flavor_notes': notes_count,
            'flavor_profiles': profiles_count,
            'courses': courses_qs.count(),
            'team_members': team_qs.count(),
        },
        'courses': CourseSerializer(courses_qs, many=True).data,
        'team': TeamMemberSerializer(team_qs, many=True).data,
        'pyramid_layers': [
            {'key': 'TOP', 'label': 'Top Notes', 'time': '0-3 сек', 'color': '#facc15'},
            {'key': 'HEART', 'label': 'Heart Notes', 'time': '3-15 сек', 'color': '#b45309'},
            {'key': 'BASE', 'label': 'Base Notes', 'time': '15+ сек', 'color': '#451a03'},
        ],
    })


@api_view(['GET', 'HEAD'])
def health_check(request):
    """
    GET /api/health/ - сервер жив и база отвечает: {ok, db}; без базы 503, так падение увидит внешний мониторинг.
    Дёшево: один SELECT 1. Его же дёргает cron Vercel (backend/vercel.json) и внешний мониторинг.
    """
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
            cursor.fetchone()
    except Exception:  # любая поломка базы или драйвера: монитору нужен 503, а не 500
        logger.exception('Health check: база не отвечает')
        response = Response({'ok': False, 'db': False}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    else:
        response = Response({'ok': True, 'db': True})
    response['Cache-Control'] = 'no-store'
    return response


@api_view(['POST'])
@permission_classes([IsModerator])
def seed_data(request):
    """
    POST /api/seed/ - загрузка демо-данных и 17 сортов (идемпотентно). Только модератор.
    На сервере выключено: команда стирает пары блюд и сортов и правки сомелье.
    Включить на время: FT_ALLOW_SEED=1.
    """
    import os

    from django.conf import settings
    from django.core.management import call_command
    if not settings.DEBUG and os.environ.get('FT_ALLOW_SEED') != '1':
        return Response(
            {'ok': False, 'detail': 'На сервере перезагрузка каталога выключена: она стирает пары и правки сомелье'},
            status=status.HTTP_403_FORBIDDEN,
        )
    try:
        call_command('load_flavor_data')
        return Response({'ok': True, 'message': '17 brands and flavor pyramid data loaded successfully'})
    except Exception as e:
        return Response(
            {'ok': False, 'error': str(e)[:200]},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ADMIN (SOMMELIER) VIEWS

@api_view(['GET', 'POST'])
@permission_classes([ReadOnlyOrModerator])
def admin_brands(request):
    """
    GET  /api/admin/brands/ - список брендов со статусом профиля
    POST /api/admin/brands/ - создать бренд из админки (модератор)
    """
    if request.method == 'GET':
        brands = Brand.objects.prefetch_related('flavor_profiles').all()
        serializer = BrandListSerializer(brands, many=True, context={'request': request})
        return Response(serializer.data)

    # POST
    serializer = BrandCreateUpdateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    brand = serializer.save()
    return Response(BrandDetailSerializer(brand, context={'request': request}).data, status=status.HTTP_201_CREATED)


def _flavor_profiles_response(brand, request, warnings):
    layers = set(FlavorProfile.objects.filter(brand=brand).values_list('layer', flat=True))
    complete = len(layers) == 3
    if not complete:
        missing = sorted({'TOP', 'HEART', 'BASE'} - layers)
        warnings.append(f'Не заполнены слои: {", ".join(missing)}')
    return Response({
        'ok': True,
        'warnings': warnings,
        'profile': {'complete': complete},
        'pyramid': pyramid_payload(brand, request),
    })


def _uuid_or_400(raw, name):
    """UUID из строки запроса; иначе 400, а не 500 от базы данных."""
    try:
        return uuid.UUID(str(raw))
    except (TypeError, ValueError):
        raise ValidationError({name: ['Некорректный идентификатор']})


def _uuid_param(request, name):
    raw = request.query_params.get(name)
    if not raw:
        raise ValidationError({name: ['Обязательный параметр']})
    return _uuid_or_400(raw, name)


@api_view(['PUT', 'POST', 'DELETE'])
@permission_classes([IsModerator])
def admin_flavor_profiles(request):
    """
    PUT (или POST) /api/admin/flavor-profiles/ - сохранить ноты пирамиды бренда (модератор;
    сомелье отправляет запрос через /api/change-requests/).
    Body: { brand_id, notes: [{ flavor_note_id, layer, intensity, sommelier_note }], replace? }
    Каждая нота обновляется или создаётся; остальные ноты бренда удаляются только при replace=true.
    DELETE /api/admin/flavor-profiles/?brand_id=&flavor_note_id= - убрать одну ноту.
    """
    if request.method == 'DELETE':
        brand = get_object_or_404(Brand, id=_uuid_param(request, 'brand_id'))
        note_id = _uuid_param(request, 'flavor_note_id')
        deleted, _ = FlavorProfile.objects.filter(brand=brand, flavor_note_id=note_id).delete()
        warnings = [] if deleted else ['Такой ноты у бренда не было']
        return _flavor_profiles_response(brand, request, warnings)

    serializer = FlavorProfileBulkSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    brand_id = serializer.validated_data['brand_id']
    notes_data = serializer.validated_data['notes']
    replace = serializer.validated_data.get('replace', False)

    brand = get_object_or_404(Brand, id=brand_id)

    # Валидация: layer ноты должен соответствовать category ноты
    warnings = []
    for item in notes_data:
        try:
            note = FlavorNote.objects.get(id=item['flavor_note_id'])
            if note.category != item['layer']:
                warnings.append(
                    f'Нота «{note.name}» ({note.category}) указана в слое {item["layer"]}'
                )
        except FlavorNote.DoesNotExist:
            return Response(
                {'error': f'Нота {item["flavor_note_id"]} не найдена'},
                status=status.HTTP_400_BAD_REQUEST,
            )

    author = ''
    if request.user.is_authenticated:
        author = request.user.get_full_name() or request.user.username

    posted_ids = []
    for item in notes_data:
        posted_ids.append(item['flavor_note_id'])
        defaults = {
            'layer': item['layer'],
            'intensity': item['intensity'],
            'sommelier_note': item.get('sommelier_note', ''),
        }
        if author:
            defaults['sommelier_name'] = author
        FlavorProfile.objects.update_or_create(
            brand=brand, flavor_note_id=item['flavor_note_id'], defaults=defaults,
        )

    if replace:
        FlavorProfile.objects.filter(brand=brand).exclude(flavor_note_id__in=posted_ids).delete()

    return _flavor_profiles_response(brand, request, warnings)


@api_view(['PUT', 'POST'])
@permission_classes([IsModerator])
def admin_serving_recommendations(request):
    """
    PUT (или POST) /api/admin/serving-recommendations/ - сохранить рекомендации по подаче.
    Body: { brand_id, serving_temp_min, serving_temp_max, glass_type, seasonality }
    """
    serializer = ServingRecommendationUpsertSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    brand = get_object_or_404(Brand, id=data['brand_id'])
    ServingRecommendation.objects.update_or_create(
        brand=brand,
        defaults={
            'serving_temp_min': data['serving_temp_min'],
            'serving_temp_max': data['serving_temp_max'],
            'glass_type': data['glass_type'],
            'seasonality': data.get('seasonality', ''),
        },
    )
    return Response({'ok': True})


@api_view(['POST', 'PATCH', 'DELETE'])
@permission_classes([IsModerator])
def admin_flavor_notes(request):
    """
    POST   /api/admin/flavor-notes/ - создать ноту
    PATCH  /api/admin/flavor-notes/ - обновить ноту (body: {id, ...fields})
    DELETE /api/admin/flavor-notes/?id= - удалить ноту
    """
    if request.method == 'POST':
        serializer = FlavorNoteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    if request.method == 'PATCH':
        note_id = request.data.get('id')
        if not note_id:
            return Response({'error': 'id is required'}, status=status.HTTP_400_BAD_REQUEST)
        note = get_object_or_404(FlavorNote, id=note_id)
        serializer = FlavorNoteSerializer(note, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    if request.method == 'DELETE':
        note_id = request.query_params.get('id')
        if not note_id:
            return Response({'error': 'id query param is required'}, status=status.HTTP_400_BAD_REQUEST)
        note = get_object_or_404(FlavorNote, id=note_id)
        note.delete()
        return Response({'ok': True, 'deleted': str(note_id)})


# Витрина: иллюстрации и настройки

class FoodIconViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Картинки характеристик блюда для мастера подбора и карточек пар.

    GET /api/food-icons/         - все
    GET /api/food-icons/?kind=COOKING  - только способы приготовления
    """
    queryset = FoodIcon.objects.all()
    serializer_class = FoodIconSerializer
    pagination_class = None

    def get_queryset(self):
        queryset = super().get_queryset()
        kind = self.request.query_params.get('kind')
        if kind:
            queryset = queryset.filter(kind=kind.upper())
        return queryset


@api_view(['GET', 'PATCH'])
@permission_classes([ReadOnlyOrModerator])
def site_settings(request):
    """
    GET   /api/settings/ - сколько сортов показывать в подборе и прочие настройки витрины.
    PATCH /api/settings/ - изменить их (модератор).
    """
    settings_obj = SiteSettings.load()
    if request.method == 'PATCH':
        serializer = SiteSettingsSerializer(settings_obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)
    return Response(SiteSettingsSerializer(settings_obj).data)

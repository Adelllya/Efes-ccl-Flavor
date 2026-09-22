from rest_framework import viewsets, status, filters
from rest_framework.decorators import api_view, action
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from django.db.models import Count, Q, Prefetch
from django.shortcuts import get_object_or_404
from django.views.decorators.cache import cache_page
from django.utils.decorators import method_decorator

from .models import (
    FlavorNote, Brand, FlavorProfile, ServingRecommendation,
    Course, TeamMember, Dish, FoodPairing,
)
from .serializers import (
    FlavorNoteSerializer, BrandListSerializer, BrandDetailSerializer,
    BrandCreateUpdateSerializer, FlavorProfileSerializer,
    PyramidNoteSerializer, CourseSerializer, TeamMemberSerializer,
    DishSerializer, FoodPairingSerializer,
    FlavorProfileBulkSerializer, ServingRecommendationUpsertSerializer,
    ServingRecommendationSerializer,
)
from .auth import ADMIN_AUTHENTICATION, IsSommelierAdminOrReadOnly, sommelier_only


# ═══════════════════════════════════════════════════════════════════════════════
#  PUBLIC VIEWSETS
# ═══════════════════════════════════════════════════════════════════════════════

class BrandViewSet(viewsets.ModelViewSet):
    """
    GET  /api/brands/           — список с фильтрами и пагинацией
    POST /api/brands/           — создать бренд
    GET  /api/brands/{id}/      — детальная карточка
    PATCH/PUT /api/brands/{id}/ — обновить
    DELETE /api/brands/{id}/    — удалить (каскадно)
    GET  /api/brands/{id}/pyramid/ — вкусовая пирамида

    Чтение открыто всем; POST/PUT/PATCH/DELETE и upload-image — только сомелье (см. api/auth.py).
    """
    authentication_classes = ADMIN_AUTHENTICATION
    permission_classes = [IsSommelierAdminOrReadOnly]
    queryset = Brand.objects.prefetch_related(
        'flavor_profiles__flavor_note',
        'serving_recommendation',
    ).all()

    def get_serializer_class(self):
        if self.action == 'list':
            return BrandListSerializer
        if self.action in ('create', 'update', 'partial_update'):
            return BrandCreateUpdateSerializer
        return BrandDetailSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        params = self.request.query_params

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
        """GET /api/brands/{id}/pyramid/ — вкусовая пирамида."""
        brand = self.get_object()
        profiles = FlavorProfile.objects.filter(brand=brand).select_related('flavor_note')

        top = profiles.filter(layer='TOP').order_by('-intensity')
        heart = profiles.filter(layer='HEART').order_by('-intensity')
        base = profiles.filter(layer='BASE').order_by('-intensity')

        return Response({
            'brand': brand.name,
            'brand_id': str(brand.id),
            'top': PyramidNoteSerializer(top, many=True).data,
            'heart': PyramidNoteSerializer(heart, many=True).data,
            'base': PyramidNoteSerializer(base, many=True).data,
        })

    @action(detail=True, methods=['post'], url_path='upload-image', parser_classes=[MultiPartParser, FormParser])
    def upload_image(self, request, pk=None):
        """POST /api/brands/{id}/upload-image/ — загрузка фотографии бренда."""
        brand = self.get_object()
        file_obj = request.FILES.get('image') or request.FILES.get('file')
        if not file_obj:
            return Response(
                {'error': 'Файл изображения (поле image или file) не передан'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        brand.image = file_obj
        brand.save()
        serializer = BrandDetailSerializer(brand, context={'request': request})
        return Response(serializer.data, status=status.HTTP_200_OK)


class FlavorNoteViewSet(viewsets.ModelViewSet):
    """
    GET /api/flavor-notes/              — справочник нот, фильтр ?category=, ?off_flavour=
    GET /api/flavor-notes/{id}/brands/  — обратный поиск: нота → бренды

    Чтение открыто всем; POST/PUT/PATCH/DELETE — только сомелье (см. api/auth.py).
    """
    authentication_classes = ADMIN_AUTHENTICATION
    permission_classes = [IsSommelierAdminOrReadOnly]
    queryset = FlavorNote.objects.all()
    serializer_class = FlavorNoteSerializer

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
        """GET /api/flavor-notes/{id}/brands/ — бренды, содержащие эту ноту."""
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
    """GET /api/courses/ — курсы Школы Пивных Сомелье (read-only)."""
    queryset = Course.objects.all()
    serializer_class = CourseSerializer


class TeamMemberViewSet(viewsets.ReadOnlyModelViewSet):
    """GET /api/team/ — команда Flavor Tree (read-only)."""
    queryset = TeamMember.objects.all()
    serializer_class = TeamMemberSerializer


class DishViewSet(viewsets.ReadOnlyModelViewSet):
    """
    GET /api/dishes/ — каталог блюд для food pairing с фильтрами:
    ?cuisine=KZ|ITALIAN|JAPANESE|AMERICAN|MEXICAN|GERMAN
    ?dominant_taste=SALTY|SWEET|SOUR|BITTER|UMAMI|SPICY|MIXED
    ?weight=LIGHT|MEDIUM|HEAVY
    ?fat_level=LOW|MEDIUM|HIGH
    ?q=поиск_по_названию
    """
    queryset = Dish.objects.all()
    serializer_class = DishSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
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

        q = params.get('q')
        if q:
            queryset = queryset.filter(name__icontains=q)

        return queryset


class FoodPairingViewSet(viewsets.ReadOnlyModelViewSet):
    """
    GET /api/pairings/ — пары пиво ↔ блюдо с фильтрами:
    ?brand_id=uuid / ?brand_name=...
    ?dish_id=uuid / ?dish_name=...
    ?pairing_type=COMPLEMENT|CONTRAST|CLEANSE|BRIDGE
    """
    queryset = FoodPairing.objects.select_related('brand', 'dish').all()
    serializer_class = FoodPairingSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        params = self.request.query_params

        brand_id = params.get('brand_id')
        if brand_id:
            queryset = queryset.filter(brand_id=brand_id)

        brand_name = params.get('brand_name')
        if brand_name:
            queryset = queryset.filter(brand__name__icontains=brand_name)

        dish_id = params.get('dish_id')
        if dish_id:
            queryset = queryset.filter(dish_id=dish_id)

        dish_name = params.get('dish_name')
        if dish_name:
            queryset = queryset.filter(dish__name__icontains=dish_name)

        pairing_type = params.get('pairing_type')
        if pairing_type:
            queryset = queryset.filter(pairing_type=pairing_type.upper())

        return queryset


# ═══════════════════════════════════════════════════════════════════════════════
#  STANDALONE VIEWS
# ═══════════════════════════════════════════════════════════════════════════════

@api_view(['GET'])
@cache_page(60 * 5)  # Кеширование на 5 минут
def landing_data(request):
    """
    GET /api/landing/ — агрегирующий эндпоинт: project info, team, courses, stats, quote.
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
            'tagline': "Don't just drink — listen to the flavor",
            'description': (
                'Платформа сенсорного образования и подбора пива. '
                'Каждый сорт раскладывается на «Вкусовую пирамиду»: '
                'Top Notes, Heart Notes, Base Notes.'
            ),
            'partner': 'EFES Kazakhstan · One Idea University / Anadolu Group',
            'market': 'Казахстан',
        },
        'quote': {
            'text': (
                'Сегодня я услышал пиво, а не просто выпил его. '
                'Flavor Tree меняет то, как я отношусь к любимому напитку.'
            ),
            'author': 'Участник пилотной дегустации, Алматы',
        },
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
            {'key': 'TOP', 'label': 'Top Notes', 'time': '0–3 сек', 'color': '#facc15'},
            {'key': 'HEART', 'label': 'Heart Notes', 'time': '3–15 сек', 'color': '#b45309'},
            {'key': 'BASE', 'label': 'Base Notes', 'time': '15+ сек', 'color': '#451a03'},
        ],
    })


@api_view(['GET'])
def health_check(request):
    """GET /api/health/ — health check."""
    return Response({'ok': True})


@api_view(['GET', 'POST'])
@sommelier_only
def seed_data(request):
    """POST /api/seed/ — загрузка демо-данных и 17 сортов (идемпотентно). Только сомелье.

    Перезаписывает сорта и пирамиды данными из data/*.json, поэтому закрыт токеном.
    GET оставлен для совместимости со старыми скриптами.
    """
    from django.core.management import call_command
    try:
        call_command('load_flavor_data')
        return Response({'ok': True, 'message': '17 brands and flavor pyramid data loaded successfully'})
    except Exception as e:
        return Response(
            {'ok': False, 'error': str(e)[:200]},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ═══════════════════════════════════════════════════════════════════════════════
#  ADMIN (SOMMELIER) VIEWS
#  Все закрыты @sommelier_only: токен FT_ADMIN_TOKEN или сотрудник Django (api/auth.py).
# ═══════════════════════════════════════════════════════════════════════════════

@api_view(['GET', 'POST'])
@sommelier_only
def admin_brands(request):
    """
    GET  /api/admin/brands/ — список брендов со статусом профиля
    POST /api/admin/brands/ — создать бренд из админки
    """
    if request.method == 'GET':
        brands = Brand.objects.prefetch_related('flavor_profiles').all()
        serializer = BrandListSerializer(brands, many=True)
        return Response(serializer.data)

    # POST
    serializer = BrandCreateUpdateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    brand = serializer.save()
    return Response(BrandDetailSerializer(brand).data, status=status.HTTP_201_CREATED)


@api_view(['PUT'])
@sommelier_only
def admin_flavor_profiles(request):
    """
    PUT /api/admin/flavor-profiles/ — заменить вкусовую пирамиду бренда целиком.
    Body: { brand_id, notes: [{ flavor_note_id, layer, intensity, sommelier_note }] }
    """
    serializer = FlavorProfileBulkSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    brand_id = serializer.validated_data['brand_id']
    notes_data = serializer.validated_data['notes']

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

    # Удалить старые профили и вставить новые
    FlavorProfile.objects.filter(brand=brand).delete()
    for item in notes_data:
        FlavorProfile.objects.create(
            brand=brand,
            flavor_note_id=item['flavor_note_id'],
            layer=item['layer'],
            intensity=item['intensity'],
            sommelier_note=item.get('sommelier_note', ''),
        )

    # Проверка полноты
    layers = set(FlavorProfile.objects.filter(brand=brand).values_list('layer', flat=True))
    complete = len(layers) == 3

    if not complete:
        missing = {'TOP', 'HEART', 'BASE'} - layers
        warnings.append(f'Не заполнены слои: {", ".join(missing)}')

    return Response({
        'ok': True,
        'warnings': warnings,
        'profile': {'complete': complete},
    })


@api_view(['PUT'])
@sommelier_only
def admin_serving_recommendations(request):
    """
    PUT /api/admin/serving-recommendations/ — upsert рекомендаций по подаче.
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
@sommelier_only
def admin_flavor_notes(request):
    """
    POST   /api/admin/flavor-notes/ — создать ноту
    PATCH  /api/admin/flavor-notes/ — обновить ноту (body: {id, ...fields})
    DELETE /api/admin/flavor-notes/?id= — удалить ноту
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

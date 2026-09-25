import secrets
import uuid
from decimal import Decimal

from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.validators import UnicodeUsernameValidator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Max
from rest_framework import serializers
from .models import (
    FlavorNote, Brand, FlavorProfile, ServingRecommendation,
    Course, TeamMember, Dish, FoodPairing, Venue, QRCode, AnonymousSession,
    FoodIcon, SiteSettings, MenuItem, MenuDrink, Order, OrderItem, ChangeRequest,
)
from .permissions import user_role, ROLE_LABELS, ROLE_USER


def media_url(request, file_field):
    """Полный URL картинки: фронтенд живёт на другом домене, относительный путь ему не поможет."""
    if not file_field:
        return None
    name = str(getattr(file_field, 'name', '') or '')
    if name.startswith(('http://', 'https://')):
        return name
    return request.build_absolute_uri(file_field.url) if request else file_field.url


def absolute_media(serializer, file_field):
    return media_url(serializer.context.get('request'), file_field)


def dish_image_url(serializer, dish):
    """Картинка блюда: загруженный файл важнее ссылки."""
    if dish.photo:
        return absolute_media(serializer, dish.photo)
    return dish.image or ''


def parse_uuid(value):
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


# FlavorNote

class FlavorNoteSerializer(serializers.ModelSerializer):
    category_display = serializers.CharField(source='get_category_display', read_only=True)
    image = serializers.SerializerMethodField()

    class Meta:
        model = FlavorNote
        fields = [
            'id', 'name', 'technical_term', 'wheel_code',
            'category', 'category_display', 'description', 'icon', 'image',
            'reference_material', 'is_off_flavour', 'sort_order',
        ]

    def get_image(self, obj):
        return absolute_media(self, obj.image)


class FlavorNoteMinimalSerializer(serializers.ModelSerializer):
    """Минимальный сериализатор для вложенных данных."""
    image = serializers.SerializerMethodField()

    class Meta:
        model = FlavorNote
        fields = ['id', 'name', 'icon', 'image', 'category']

    def get_image(self, obj):
        return absolute_media(self, obj.image)


# ServingRecommendation

class ServingRecommendationSerializer(serializers.ModelSerializer):
    class Meta:
        model = ServingRecommendation
        fields = ['serving_temp_min', 'serving_temp_max', 'glass_type', 'seasonality']


# Brand

class BrandListSerializer(serializers.ModelSerializer):
    """Для списка - с метриками профиля, без вложенных нот."""
    note_count = serializers.SerializerMethodField()
    profile = serializers.SerializerMethodField()
    serving_recommendation = ServingRecommendationSerializer(read_only=True)
    packaging_type_display = serializers.CharField(source='get_packaging_type_display', read_only=True)
    image = serializers.SerializerMethodField()
    image_hd = serializers.SerializerMethodField()

    def get_image_hd(self, obj):
        return absolute_media(self, obj.image_hd)

    class Meta:
        model = Brand
        fields = [
            'id', 'name', 'brand_owner', 'style', 'abv',
            'density', 'fermentation_type', 'packaging_type', 'packaging_type_display',
            'is_horeca_only', 'description', 'image', 'image_hd', 'accent_color', 'tagline',
            'is_active', 'note_count', 'profile', 'serving_recommendation',
        ]

    def get_image(self, obj):
        if not obj.image:
            return None
        if hasattr(obj.image, 'name') and str(obj.image.name).startswith(('http://', 'https://')):
            return str(obj.image.name)
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(obj.image.url)
        return obj.image.url

    def get_note_count(self, obj):
        return obj.flavor_profiles.count()

    def get_profile(self, obj):
        profiles = obj.flavor_profiles.all()
        layers = set(p.layer for p in profiles)
        total = profiles.count()
        top = sum(1 for p in profiles if p.layer == 'TOP')
        heart = sum(1 for p in profiles if p.layer == 'HEART')
        base = sum(1 for p in profiles if p.layer == 'BASE')
        complete = len(layers) == 3 and total >= 3
        if total == 0:
            status = 'empty'
        elif complete:
            status = 'complete'
        else:
            status = 'partial'
        return {
            'top': top,
            'heart': heart,
            'base': base,
            'total': total,
            'complete': complete,
            'status': status,
        }


class BrandDetailSerializer(serializers.ModelSerializer):
    """Для детальной карточки - с serving recommendation и вкусовой пирамидой."""
    serving_recommendation = ServingRecommendationSerializer(read_only=True)
    packaging_type_display = serializers.CharField(source='get_packaging_type_display', read_only=True)
    image = serializers.SerializerMethodField()
    image_hd = serializers.SerializerMethodField()
    pyramid = serializers.SerializerMethodField()

    def get_image_hd(self, obj):
        return absolute_media(self, obj.image_hd)

    class Meta:
        model = Brand
        fields = [
            'id', 'name', 'brand_owner', 'style', 'abv',
            'density', 'fermentation_type', 'packaging_type', 'packaging_type_display',
            'is_horeca_only', 'description', 'image', 'image_hd', 'accent_color', 'tagline',
            'is_active', 'serving_recommendation', 'pyramid',
        ]

    def get_image(self, obj):
        if not obj.image:
            return None
        if hasattr(obj.image, 'name') and str(obj.image.name).startswith(('http://', 'https://')):
            return str(obj.image.name)
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(obj.image.url)
        return obj.image.url

    def get_pyramid(self, obj):
        profiles = obj.flavor_profiles.select_related('flavor_note').all()
        # context нужен, чтобы ссылки на картинки нот были абсолютными
        ctx = self.context
        top = [PyramidNoteSerializer(p, context=ctx).data for p in profiles if p.layer == 'TOP']
        heart = [PyramidNoteSerializer(p, context=ctx).data for p in profiles if p.layer == 'HEART']
        base = [PyramidNoteSerializer(p, context=ctx).data for p in profiles if p.layer == 'BASE']
        top.sort(key=lambda x: x['intensity'], reverse=True)
        heart.sort(key=lambda x: x['intensity'], reverse=True)
        base.sort(key=lambda x: x['intensity'], reverse=True)
        return {
            'top': top,
            'heart': heart,
            'base': base,
        }


class BrandCreateUpdateSerializer(serializers.ModelSerializer):
    """Для создания и обновления бренда."""
    class Meta:
        model = Brand
        fields = [
            'name', 'brand_owner', 'style', 'abv',
            'density', 'fermentation_type', 'packaging_type', 'is_horeca_only',
            'description', 'image', 'image_hd', 'accent_color', 'tagline', 'is_active',
        ]


# FlavorProfile

class FlavorProfileSerializer(serializers.ModelSerializer):
    flavor_note = FlavorNoteSerializer(read_only=True)

    class Meta:
        model = FlavorProfile
        fields = [
            'id', 'flavor_note', 'layer', 'intensity',
            'sommelier_note', 'sommelier_name',
        ]


# Pyramid

class PyramidNoteSerializer(serializers.ModelSerializer):
    """Нота внутри пирамиды - вкусовая нота + данные профиля."""
    name = serializers.CharField(source='flavor_note.name')
    icon = serializers.CharField(source='flavor_note.icon')
    description = serializers.CharField(source='flavor_note.description')
    technical_term = serializers.CharField(source='flavor_note.technical_term')
    reference_material = serializers.CharField(source='flavor_note.reference_material')
    is_off_flavour = serializers.BooleanField(source='flavor_note.is_off_flavour')
    category_label = serializers.CharField(source='get_layer_display')
    image = serializers.SerializerMethodField()
    # id здесь = id ноты (не профиля), для совместимости с Next.js API
    id = serializers.UUIDField(source='flavor_note.id')

    class Meta:
        model = FlavorProfile
        fields = [
            'id', 'name', 'icon', 'image', 'description',
            'technical_term', 'reference_material', 'is_off_flavour',
            'intensity', 'sommelier_note', 'sommelier_name', 'category_label',
        ]

    def get_image(self, obj):
        return absolute_media(self, obj.flavor_note.image)


# Course

class CourseSerializer(serializers.ModelSerializer):
    level_display = serializers.CharField(source='get_level_display', read_only=True)

    class Meta:
        model = Course
        fields = ['id', 'level', 'level_display', 'title', 'description', 'color', 'required_score']


# TeamMember

class TeamMemberSerializer(serializers.ModelSerializer):
    class Meta:
        model = TeamMember
        fields = ['id', 'name', 'role', 'bio', 'avatar']


# Dish

class DishSerializer(serializers.ModelSerializer):
    cuisine_display = serializers.CharField(source='get_cuisine_display', read_only=True)
    dominant_taste_display = serializers.CharField(source='get_dominant_taste_display', read_only=True)
    weight_display = serializers.CharField(source='get_weight_display', read_only=True)
    fat_level_display = serializers.CharField(source='get_fat_level_display', read_only=True)
    cooking_method_display = serializers.CharField(source='get_cooking_method_display', read_only=True)
    # image только на чтение: загруженный файл, иначе ссылка. Ссылку меняют через image_url.
    image = serializers.SerializerMethodField()
    image_url = serializers.URLField(source='image', required=False, allow_blank=True, max_length=500)
    menu_items_count = serializers.SerializerMethodField()
    pairings_count = serializers.SerializerMethodField()

    class Meta:
        model = Dish
        fields = [
            'id', 'name', 'cuisine', 'cuisine_display', 'category',
            'dominant_taste', 'dominant_taste_display',
            'weight', 'weight_display',
            'fat_level', 'fat_level_display',
            'cooking_method', 'cooking_method_display',
            'description', 'image', 'image_url',
            'menu_items_count', 'pairings_count',
        ]

    def get_image(self, obj):
        return dish_image_url(self, obj)

    def get_menu_items_count(self, obj):
        annotated = getattr(obj, 'menu_items_count', None)
        if annotated is not None:
            return annotated
        return obj.menu_items.count()

    def get_pairings_count(self, obj):
        annotated = getattr(obj, 'pairings_count', None)
        if annotated is not None:
            return annotated
        return obj.food_pairings.count()


# FoodPairing

class FoodPairingSerializer(serializers.ModelSerializer):
    brand_name = serializers.CharField(source='brand.name', read_only=True)
    dish_name = serializers.CharField(source='dish.name', read_only=True)
    pairing_type_display = serializers.CharField(source='get_pairing_type_display', read_only=True)

    class Meta:
        model = FoodPairing
        fields = [
            'id', 'brand', 'brand_name', 'dish', 'dish_name',
            'compatibility_score', 'pairing_type', 'pairing_type_display', 'explanation',
        ]


# Admin flavor profiles (bulk PUT)

class FlavorProfileBulkItemSerializer(serializers.Serializer):
    """Один элемент при массовом сохранении профиля."""
    flavor_note_id = serializers.UUIDField()
    layer = serializers.ChoiceField(choices=['TOP', 'HEART', 'BASE'])
    intensity = serializers.IntegerField(min_value=1, max_value=10)
    sommelier_note = serializers.CharField(required=False, allow_blank=True, default='')


class FlavorProfileBulkSerializer(serializers.Serializer):
    """Тело запроса для PUT /api/admin/flavor-profiles/."""
    brand_id = serializers.UUIDField()
    notes = FlavorProfileBulkItemSerializer(many=True)
    # replace=true удаляет ноты бренда, которых нет в списке. По умолчанию только дописываем.
    replace = serializers.BooleanField(required=False, default=False)


# Admin serving recommendation

class ServingRecommendationUpsertSerializer(serializers.Serializer):
    """Тело запроса для PUT /api/admin/serving-recommendations/."""
    brand_id = serializers.UUIDField()
    serving_temp_min = serializers.FloatField()
    serving_temp_max = serializers.FloatField()
    glass_type = serializers.CharField()
    seasonality = serializers.CharField(required=False, allow_blank=True, default='')


# FoodIcon и настройки витрины

class FoodIconSerializer(serializers.ModelSerializer):
    image = serializers.SerializerMethodField()
    kind_display = serializers.CharField(source='get_kind_display', read_only=True)

    class Meta:
        model = FoodIcon
        fields = ['id', 'kind', 'kind_display', 'key', 'label', 'image', 'sort_order']

    def get_image(self, obj):
        return absolute_media(self, obj.image)


class SiteSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = SiteSettings
        fields = ['alternatives_count', 'min_score_to_show', 'show_wheat_decor', 'pairing_intro']


# Пользователи и роли

class VenueRefSerializer(serializers.ModelSerializer):
    """Короткая ссылка на заведение внутри объекта пользователя."""

    class Meta:
        model = Venue
        fields = ['id', 'slug', 'name']


class UserSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()
    role_display = serializers.SerializerMethodField()
    venue = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'role', 'role_display',
            'is_superuser', 'venue', 'date_joined', 'is_active',
        ]
        read_only_fields = ['id', 'username', 'is_superuser', 'date_joined', 'is_active']

    def get_role(self, obj):
        return user_role(obj) or ROLE_USER

    def get_role_display(self, obj):
        return ROLE_LABELS.get(self.get_role(obj), ROLE_LABELS[ROLE_USER])

    def get_venue(self, obj):
        # venues.all() использует prefetch из списка пользователей, если он есть.
        venues = list(obj.venues.all())
        if not venues:
            return None
        venues.sort(key=lambda v: v.name)
        return VenueRefSerializer(venues[0]).data


class RegisterSerializer(serializers.Serializer):
    # Те же правила, что у Django: буквы, цифры и @/./+/-/_, без пробелов.
    username = serializers.CharField(max_length=150, validators=[UnicodeUsernameValidator()])
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default='')

    def validate_username(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Введите логин')
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError('Такой логин уже занят')
        return value

    def validate_email(self, value):
        value = value.strip().lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('Пользователь с такой почтой уже есть')
        return value

    def validate_password(self, value):
        # Проверяем на уровне поля, чтобы ошибки пароля приходили вместе с ошибками логина.
        raw = self.initial_data if isinstance(self.initial_data, dict) else {}
        probe = User(username=str(raw.get('username') or ''), email=str(raw.get('email') or ''),
                     first_name=str(raw.get('first_name') or ''))
        try:
            validate_password(value, user=probe)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages))
        return value

    def create(self, validated_data):
        return User.objects.create_user(
            username=validated_data['username'],
            email=validated_data['email'],
            password=validated_data['password'],
            first_name=validated_data.get('first_name', ''),
        )


class ProfileUpdateSerializer(serializers.ModelSerializer):
    """PATCH /api/auth/me/: пользователь меняет только имя и почту."""

    class Meta:
        model = User
        fields = ['first_name', 'email']

    def validate_email(self, value):
        value = (value or '').strip().lower()
        if value and User.objects.filter(email__iexact=value).exclude(pk=self.instance.pk).exists():
            raise serializers.ValidationError('Пользователь с такой почтой уже есть')
        return value


# Заведения и меню

class OwnerField(serializers.PrimaryKeyRelatedField):
    """На вход принимает id пользователя, наружу отдаёт {id, username}."""

    def use_pk_only_optimization(self):
        return False

    def to_representation(self, value):
        return {'id': value.pk, 'username': value.username}


class VenueSerializer(serializers.ModelSerializer):
    venue_type_display = serializers.CharField(source='get_venue_type_display', read_only=True)
    items_count = serializers.SerializerMethodField()
    owner = OwnerField(queryset=User.objects.all(), required=False, allow_null=True)
    # logo только на чтение: загруженный файл, иначе ссылка. Ссылку меняют через logo_url.
    logo = serializers.SerializerMethodField()
    logo_url = serializers.URLField(source='logo', required=False, allow_blank=True, max_length=500)

    class Meta:
        model = Venue
        fields = [
            'id', 'slug', 'name', 'city', 'address', 'venue_type', 'venue_type_display',
            'logo', 'logo_url', 'cover', 'description', 'phone', 'working_hours', 'is_published',
            'tables_count', 'items_count', 'owner', 'created_at',
        ]
        read_only_fields = ['id', 'slug', 'created_at']
        extra_kwargs = {'tables_count': {'min_value': 1, 'max_value': 500}}

    def get_logo(self, obj):
        if obj.logo_file:
            return absolute_media(self, obj.logo_file)
        return obj.logo or ''

    def get_items_count(self, obj):
        annotated = getattr(obj, 'items_count', None)
        if annotated is not None:
            return annotated
        return obj.menu_items.count()

    def validate_owner(self, owner):
        # Одно заведение на пользователя, в том числе когда владельца назначает модератор.
        if owner is None:
            return owner
        others = Venue.objects.filter(owner=owner)
        if self.instance is not None:
            others = others.exclude(pk=self.instance.pk)
        if others.exists():
            raise serializers.ValidationError('У этого пользователя уже есть заведение')
        return owner


class MenuItemSerializer(serializers.ModelSerializer):
    dish_name = serializers.CharField(source='dish.name', read_only=True)
    dish_category = serializers.CharField(source='dish.category', read_only=True)
    dish_image = serializers.SerializerMethodField()

    class Meta:
        model = MenuItem
        fields = [
            'id', 'venue', 'dish', 'dish_name', 'dish_category', 'dish_image',
            'price', 'section', 'portion', 'sort_order', 'is_available', 'chef_note',
        ]
        extra_kwargs = {'price': {'min_value': Decimal('0')}}

    def get_dish_image(self, obj):
        return dish_image_url(self, obj.dish)


class MenuDrinkSerializer(serializers.ModelSerializer):
    brand_name = serializers.CharField(source='brand.name', read_only=True)
    brand_style = serializers.CharField(source='brand.style', read_only=True)
    brand_image = serializers.SerializerMethodField()
    abv = serializers.FloatField(source='brand.abv', read_only=True)

    class Meta:
        model = MenuDrink
        fields = [
            'id', 'venue', 'brand', 'brand_name', 'brand_style', 'brand_image', 'abv',
            'price', 'volume', 'is_available', 'sort_order',
        ]
        extra_kwargs = {'price': {'min_value': Decimal('0')}}

    def get_brand_image(self, obj):
        return absolute_media(self, obj.brand.image or obj.brand.image_hd)


def money(value):
    return '{:.2f}'.format(value)


def menu_drink_payload(drink):
    """Короткая ссылка на напиток из карты бара внутри сочетания."""
    return {
        'id': str(drink.id),
        'price': money(drink.price),
        'volume': drink.volume,
        'is_available': drink.is_available,
    }


def pairing_payload(pairing, request, menu_drink=None):
    """Сочетание для позиции меню: сорт, оценка, тип, объяснение сомелье и позиция в карте бара."""
    brand = pairing.brand
    return {
        'brand': str(brand.id),
        'brand_name': brand.name,
        'brand_image': media_url(request, brand.image or brand.image_hd),
        'brand_style': brand.style,
        'abv': brand.abv,
        'compatibility_score': pairing.compatibility_score,
        'pairing_type': pairing.pairing_type,
        'pairing_type_display': pairing.get_pairing_type_display(),
        'explanation': pairing.explanation,
        'menu_drink': menu_drink_payload(menu_drink) if menu_drink else None,
    }


def build_venue_menu(venue, request):
    """
    Ответ GET /api/venues/<slug>/menu/: карточка заведения, разделы с позициями и карта напитков.
    К каждой позиции прикладываем сочетание с самой высокой оценкой среди активных сортов
    и до двух альтернатив из тех сортов, которые есть в карте этого бара.
    """
    items = list(
        venue.menu_items.select_related('dish')
        .prefetch_related('dish__menu_items', 'dish__food_pairings')
        .order_by('section', 'sort_order', 'dish__name')
    )
    drinks = list(venue.menu_drinks.select_related('brand').order_by('sort_order', 'brand__name'))
    drink_by_brand = {drink.brand_id: drink for drink in drinks}

    dish_ids = set(item.dish_id for item in items)
    by_dish = {}
    pairings = (
        FoodPairing.objects.filter(dish_id__in=dish_ids, brand__is_active=True)
        .select_related('brand')
        .order_by('dish_id', '-compatibility_score', 'brand__name')
    )
    for pairing in pairings:
        by_dish.setdefault(pairing.dish_id, []).append(pairing)

    def alternatives_for(rest):
        # Только сорта из карты бара; те, что в наличии, идут первыми.
        listed = [p for p in rest if p.brand_id in drink_by_brand]
        listed.sort(key=lambda p: (not drink_by_brand[p.brand_id].is_available,
                                   -p.compatibility_score, p.brand.name))
        return [pairing_payload(p, request, drink_by_brand[p.brand_id]) for p in listed[:2]]

    sections = {}
    for item in items:
        dish_pairings = by_dish.get(item.dish_id, [])
        best = dish_pairings[0] if dish_pairings else None
        entry = {
            'id': str(item.id),
            'price': money(item.price),
            'section': item.section,
            'portion': item.portion,
            'sort_order': item.sort_order,
            'is_available': item.is_available,
            'chef_note': item.chef_note,
            'dish': DishSerializer(item.dish, context={'request': request}).data,
            'pairing': pairing_payload(best, request, drink_by_brand.get(best.brand_id)) if best else None,
            'alternatives': alternatives_for(dish_pairings[1:]),
        }
        sections.setdefault(item.section, []).append(entry)

    ordered = sorted(
        sections.items(),
        key=lambda pair: (min(e['sort_order'] for e in pair[1]), pair[0]),
    )
    context = {'request': request}
    return {
        'venue': VenueSerializer(venue, context=context).data,
        'tables_count': venue.tables_count,
        'sections': [{'name': name, 'items': entries} for name, entries in ordered],
        'drinks': MenuDrinkSerializer(drinks, many=True, context=context).data,
    }


# Заказы гостей

class OrderItemSerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(source='get_kind_display', read_only=True)

    class Meta:
        model = OrderItem
        fields = ['id', 'kind', 'kind_display', 'menu_item', 'menu_drink', 'title', 'price', 'qty', 'note']


class OrderSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    items = OrderItemSerializer(many=True, read_only=True)
    venue = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = [
            'id', 'number', 'status', 'status_display', 'table_number', 'guest_name', 'comment',
            'total', 'guest_token', 'items', 'venue', 'created_at', 'updated_at',
        ]
        read_only_fields = fields

    def get_venue(self, obj):
        return {'slug': obj.venue.slug, 'name': obj.venue.name}


class OrderItemInputSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=[OrderItem.KIND_DISH, OrderItem.KIND_DRINK])
    id = serializers.UUIDField()
    qty = serializers.IntegerField(min_value=1, max_value=20)
    note = serializers.CharField(max_length=200, required=False, allow_blank=True, default='')


class OrderCreateSerializer(serializers.Serializer):
    """
    POST /api/orders/: заказ от гостя без входа. Позиции должны быть из карты этого заведения
    и в наличии; названия и цены сохраняются на момент заказа.
    """
    MAX_ITEMS = 50

    venue = serializers.CharField()
    table_number = serializers.IntegerField()
    guest_name = serializers.CharField(max_length=80, required=False, allow_blank=True, default='')
    comment = serializers.CharField(required=False, allow_blank=True, default='')
    items = OrderItemInputSerializer(many=True)

    def validate_venue(self, value):
        venue_id = parse_uuid(value)
        venue = Venue.objects.filter(pk=venue_id).first() if venue_id else Venue.objects.filter(slug=value).first()
        if venue is None or not venue.is_published:
            raise serializers.ValidationError('Заведение не найдено')
        return venue

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError('Добавьте хотя бы одну позицию')
        if len(value) > self.MAX_ITEMS:
            raise serializers.ValidationError('В одном заказе не больше {} позиций'.format(self.MAX_ITEMS))
        return value

    def validate(self, attrs):
        venue = attrs.get('venue')
        if venue is None:
            return attrs
        table = attrs['table_number']
        # 0 - заказ с собой, без стола.
        if table < 0 or table > venue.tables_count:
            raise serializers.ValidationError({'table_number': ['Стол от 1 до {}'.format(venue.tables_count)]})

        errors = []
        lines = []
        for raw in attrs['items']:
            if raw['kind'] == OrderItem.KIND_DISH:
                source = MenuItem.objects.select_related('dish').filter(pk=raw['id'], venue=venue).first()
                title = source.dish.name if source else None
            else:
                source = MenuDrink.objects.select_related('brand').filter(pk=raw['id'], venue=venue).first()
                title = source.brand.name if source else None
            if source is None:
                errors.append('Позиция {} не найдена в меню заведения'.format(raw['id']))
                continue
            if not source.is_available:
                errors.append('«{}» сейчас нет в наличии'.format(title))
                continue
            # Отрицательную цену API в меню не пускает, но заказ с ней всё равно не считаем.
            if source.price < 0:
                errors.append('У позиции «{}» неверная цена'.format(title))
                continue
            lines.append((raw, source, title))
        if errors:
            raise serializers.ValidationError({'items': errors})
        attrs['lines'] = lines
        return attrs

    def create(self, validated_data):
        venue = validated_data['venue']
        with transaction.atomic():
            # Блокируем заведение, чтобы два гостя не получили один номер заказа.
            Venue.objects.select_for_update().get(pk=venue.pk)
            last = Order.objects.filter(venue=venue).aggregate(last=Max('number'))['last'] or 0
            order = Order.objects.create(
                venue=venue,
                number=last + 1,
                table_number=validated_data['table_number'],
                guest_name=validated_data.get('guest_name', '').strip(),
                comment=validated_data.get('comment', '').strip(),
                guest_token=secrets.token_hex(24),
            )
            total = Decimal('0')
            rows = []
            for raw, source, title in validated_data['lines']:
                is_dish = raw['kind'] == OrderItem.KIND_DISH
                rows.append(OrderItem(
                    order=order,
                    kind=raw['kind'],
                    menu_item=source if is_dish else None,
                    menu_drink=None if is_dish else source,
                    title=title,
                    price=source.price,
                    qty=raw['qty'],
                    note=raw.get('note', ''),
                ))
                total += source.price * raw['qty']
            OrderItem.objects.bulk_create(rows)
            order.total = total
            order.save(update_fields=['total'])
        return order


# Запросы сомелье на изменение сорта

LAYER_SHORT = {'TOP': 'Top', 'HEART': 'Heart', 'BASE': 'Base'}


def format_temp(value):
    """4.0 -> '4', 4.5 -> '4.5'."""
    try:
        value = float(value)
    except (TypeError, ValueError):
        return '?'
    return str(int(value)) if value.is_integer() else ('%g' % value)


class UserRefSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username']


class ChangeRequestSerializer(serializers.ModelSerializer):
    """
    Запрос на изменение пирамиды или подачи. На запись: brand, kind, payload, comment.
    Наружу добавляем сводку, название ноты и текущее живое значение, чтобы модератор видел "было / станет".
    """
    kind_display = serializers.CharField(source='get_kind_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    brand_name = serializers.CharField(source='brand.name', read_only=True)
    brand_image = serializers.SerializerMethodField()
    payload = serializers.JSONField()
    comment = serializers.CharField(required=False, allow_blank=True, default='')
    summary = serializers.SerializerMethodField()
    author = UserRefSerializer(read_only=True)
    reviewer = UserRefSerializer(read_only=True)
    flavor_note_name = serializers.SerializerMethodField()
    current = serializers.SerializerMethodField()

    class Meta:
        model = ChangeRequest
        fields = [
            'id', 'kind', 'kind_display', 'status', 'status_display',
            'brand', 'brand_name', 'brand_image', 'payload', 'comment', 'summary',
            'author', 'reviewer', 'review_comment', 'created_at', 'reviewed_at',
            'flavor_note_name', 'current',
        ]
        read_only_fields = ['id', 'status', 'review_comment', 'created_at', 'reviewed_at']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Кеш нот: в списке запросов одна нота встречается много раз.
        self._notes = {}

    def _note(self, raw_id):
        note_id = parse_uuid(raw_id)
        if note_id is None:
            return None
        key = str(note_id)
        if key not in self._notes:
            self._notes[key] = FlavorNote.objects.filter(pk=note_id).first()
        return self._notes[key]

    def get_brand_image(self, obj):
        brand = obj.brand
        return absolute_media(self, brand.image or brand.image_hd)

    def get_flavor_note_name(self, obj):
        if obj.kind == ChangeRequest.KIND_SERVING:
            return None
        note = self._note((obj.payload or {}).get('flavor_note_id'))
        return note.name if note else None

    def get_summary(self, obj):
        brand = obj.brand.name
        payload = obj.payload or {}
        if obj.kind == ChangeRequest.KIND_SERVING:
            text = '{}: подача {}-{} °C'.format(
                brand, format_temp(payload.get('serving_temp_min')), format_temp(payload.get('serving_temp_max')))
            if payload.get('glass_type'):
                text += ', бокал {}'.format(payload['glass_type'])
            return text
        note = self._note(payload.get('flavor_note_id'))
        name = note.name if note else 'нота удалена'
        if obj.kind == ChangeRequest.KIND_NOTE_DELETE:
            return '{}: удалить ноту {}'.format(brand, name)
        layer = LAYER_SHORT.get(payload.get('layer'), payload.get('layer') or '?')
        return '{}: нота {} ({}), интенсивность {}/10'.format(brand, name, layer, payload.get('intensity', '?'))

    def get_current(self, obj):
        payload = obj.payload or {}
        if obj.kind == ChangeRequest.KIND_SERVING:
            rec = ServingRecommendation.objects.filter(brand_id=obj.brand_id).first()
            return ServingRecommendationSerializer(rec, context=self.context).data if rec else None
        note_id = parse_uuid(payload.get('flavor_note_id'))
        if note_id is None:
            return None
        profile = FlavorProfile.objects.filter(brand_id=obj.brand_id, flavor_note_id=note_id).first()
        if profile is None:
            return None
        return {
            'flavor_note_id': str(profile.flavor_note_id),
            'layer': profile.layer,
            'intensity': profile.intensity,
            'sommelier_note': profile.sommelier_note,
        }

    def validate(self, attrs):
        kind = attrs.get('kind', getattr(self.instance, 'kind', None))
        payload = attrs.get('payload', getattr(self.instance, 'payload', None))
        if not isinstance(payload, dict):
            raise serializers.ValidationError({'payload': ['Ожидается объект с данными изменения']})
        attrs['payload'] = self._clean_payload(kind, payload)
        return attrs

    def _clean_payload(self, kind, payload):
        errors = {}
        clean = {}
        if kind in (ChangeRequest.KIND_NOTE_UPSERT, ChangeRequest.KIND_NOTE_DELETE):
            note = self._note(payload.get('flavor_note_id'))
            if note is None:
                errors['flavor_note_id'] = ['Нота не найдена']
            else:
                clean['flavor_note_id'] = str(note.id)
        if kind == ChangeRequest.KIND_NOTE_UPSERT:
            layer = payload.get('layer')
            if layer not in LAYER_SHORT:
                errors['layer'] = ['Слой должен быть TOP, HEART или BASE']
            else:
                clean['layer'] = layer
            raw = payload.get('intensity')
            intensity = None
            if isinstance(raw, bool) or (isinstance(raw, float) and not raw.is_integer()):
                intensity = None
            else:
                try:
                    intensity = int(raw)
                except (TypeError, ValueError):
                    intensity = None
            if intensity is None or not 1 <= intensity <= 10:
                errors['intensity'] = ['Интенсивность от 1 до 10']
            else:
                clean['intensity'] = intensity
            clean['sommelier_note'] = str(payload.get('sommelier_note') or '')
        elif kind == ChangeRequest.KIND_SERVING:
            temps = {}
            for key in ('serving_temp_min', 'serving_temp_max'):
                raw = payload.get(key)
                try:
                    if isinstance(raw, bool):
                        raise ValueError
                    temps[key] = float(raw)
                except (TypeError, ValueError):
                    errors[key] = ['Укажите температуру числом']
            if len(temps) == 2 and temps['serving_temp_min'] > temps['serving_temp_max']:
                errors['serving_temp_min'] = ['Минимальная температура больше максимальной']
            clean.update(temps)
            glass = str(payload.get('glass_type') or '').strip()
            if not glass:
                errors['glass_type'] = ['Укажите бокал']
            else:
                clean['glass_type'] = glass[:100]
            clean['seasonality'] = str(payload.get('seasonality') or '').strip()[:100]
        if errors:
            raise serializers.ValidationError({'payload': errors})
        return clean

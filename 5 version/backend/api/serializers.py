from rest_framework import serializers
from .models import (
    FlavorNote, Brand, FlavorProfile, ServingRecommendation,
    Course, TeamMember, Dish, FoodPairing, Venue, QRCode, AnonymousSession,
    FoodIcon, SiteSettings,
)


def absolute_media(serializer, file_field):
    """Полный URL картинки: фронтенд живёт на другом домене, относительный путь ему не поможет."""
    if not file_field:
        return None
    name = str(getattr(file_field, 'name', '') or '')
    if name.startswith(('http://', 'https://')):
        return name
    request = serializer.context.get('request')
    return request.build_absolute_uri(file_field.url) if request else file_field.url


# ─── FlavorNote ──────────────────────────────────────────────────────────────

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


# ─── ServingRecommendation ───────────────────────────────────────────────────

class ServingRecommendationSerializer(serializers.ModelSerializer):
    class Meta:
        model = ServingRecommendation
        fields = ['serving_temp_min', 'serving_temp_max', 'glass_type', 'seasonality']


# ─── Brand ───────────────────────────────────────────────────────────────────

class BrandListSerializer(serializers.ModelSerializer):
    """Для списка — с метриками профиля, без вложенных нот."""
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
    """Для детальной карточки — с serving recommendation и вкусовой пирамидой."""
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
        top = [PyramidNoteSerializer(p).data for p in profiles if p.layer == 'TOP']
        heart = [PyramidNoteSerializer(p).data for p in profiles if p.layer == 'HEART']
        base = [PyramidNoteSerializer(p).data for p in profiles if p.layer == 'BASE']
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


# ─── FlavorProfile ───────────────────────────────────────────────────────────

class FlavorProfileSerializer(serializers.ModelSerializer):
    flavor_note = FlavorNoteSerializer(read_only=True)

    class Meta:
        model = FlavorProfile
        fields = [
            'id', 'flavor_note', 'layer', 'intensity',
            'sommelier_note', 'sommelier_name',
        ]


# ─── Pyramid ─────────────────────────────────────────────────────────────────

class PyramidNoteSerializer(serializers.ModelSerializer):
    """Нота внутри пирамиды — вкусовая нота + данные профиля."""
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


# ─── Course ──────────────────────────────────────────────────────────────────

class CourseSerializer(serializers.ModelSerializer):
    level_display = serializers.CharField(source='get_level_display', read_only=True)

    class Meta:
        model = Course
        fields = ['id', 'level', 'level_display', 'title', 'description', 'color', 'required_score']


# ─── TeamMember ──────────────────────────────────────────────────────────────

class TeamMemberSerializer(serializers.ModelSerializer):
    class Meta:
        model = TeamMember
        fields = ['id', 'name', 'role', 'bio', 'avatar']


# ─── Dish ────────────────────────────────────────────────────────────────────

class DishSerializer(serializers.ModelSerializer):
    cuisine_display = serializers.CharField(source='get_cuisine_display', read_only=True)
    dominant_taste_display = serializers.CharField(source='get_dominant_taste_display', read_only=True)
    weight_display = serializers.CharField(source='get_weight_display', read_only=True)
    fat_level_display = serializers.CharField(source='get_fat_level_display', read_only=True)
    cooking_method_display = serializers.CharField(source='get_cooking_method_display', read_only=True)

    class Meta:
        model = Dish
        fields = [
            'id', 'name', 'cuisine', 'cuisine_display', 'category',
            'dominant_taste', 'dominant_taste_display',
            'weight', 'weight_display',
            'fat_level', 'fat_level_display',
            'cooking_method', 'cooking_method_display',
            'description', 'image',
        ]


# ─── FoodPairing ─────────────────────────────────────────────────────────────

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


# ─── Admin flavor profiles (bulk PUT) ────────────────────────────────────────

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


# ─── Admin serving recommendation ────────────────────────────────────────────

class ServingRecommendationUpsertSerializer(serializers.Serializer):
    """Тело запроса для PUT /api/admin/serving-recommendations/."""
    brand_id = serializers.UUIDField()
    serving_temp_min = serializers.FloatField()
    serving_temp_max = serializers.FloatField()
    glass_type = serializers.CharField()
    seasonality = serializers.CharField(required=False, allow_blank=True, default='')


# ─── FoodIcon и настройки витрины ────────────────────────────────────────────

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

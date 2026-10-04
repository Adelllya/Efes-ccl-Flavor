"""Сериализаторы Академии, паспорта вкуса, оценок пар и наград."""
import re

from rest_framework import serializers

from .models import Brand, FlavorNote, Lesson, Redemption, Reward, Tasting, Venue
from .permissions import ROLE_MODERATOR, has_role
from .serializers import FlavorNoteMinimalSerializer, media_url, parse_uuid


class LessonCardSerializer(serializers.ModelSerializer):
    """Урок в списке ступени: без содержимого."""

    class Meta:
        model = Lesson
        fields = ['id', 'slug', 'level', 'title', 'summary', 'minutes']


class LessonSerializer(serializers.ModelSerializer):
    level_display = serializers.CharField(source='get_level_display', read_only=True)

    class Meta:
        model = Lesson
        fields = ['id', 'slug', 'level', 'level_display', 'title', 'summary', 'minutes', 'blocks']


def brand_card(brand, request):
    """Сорт в паспорте и аналитике: только то, что нужно карточке."""
    return {
        'id': str(brand.id),
        'name': brand.name,
        'style': brand.style,
        'image': media_url(request, brand.image),
        'accent_color': brand.accent_color,
        'packaging_type': brand.packaging_type,
    }


class TastingSerializer(serializers.ModelSerializer):
    brand = serializers.SerializerMethodField()
    notes = FlavorNoteMinimalSerializer(many=True, read_only=True)
    venue = serializers.SerializerMethodField()

    class Meta:
        model = Tasting
        fields = ['id', 'brand', 'venue', 'notes', 'rating', 'comment', 'matched', 'created_at', 'updated_at']

    def get_brand(self, obj):
        return brand_card(obj.brand, self.context.get('request'))

    def get_venue(self, obj):
        return {'slug': obj.venue.slug, 'name': obj.venue.name} if obj.venue_id else None


class TastingInputSerializer(serializers.Serializer):
    """PUT /api/tastings/<brand>/: оценка, услышанные ноты, заметка и где пробовал."""

    rating = serializers.IntegerField(min_value=1, max_value=5)
    notes = serializers.ListField(child=serializers.UUIDField(), required=False, default=list,
                                  max_length=Tasting.MAX_NOTES)
    comment = serializers.CharField(max_length=280, required=False, allow_blank=True, default='', trim_whitespace=True)
    venue = serializers.CharField(required=False, allow_blank=True, default='')

    def validate_notes(self, value):
        ids = list(dict.fromkeys(value))
        notes = list(FlavorNote.objects.filter(pk__in=ids, is_off_flavour=False))
        if len(notes) != len(ids):
            raise serializers.ValidationError('Одна из нот не найдена')
        return notes

    def validate_venue(self, value):
        value = (value or '').strip()
        if not value:
            return None
        venue_id = parse_uuid(value)
        venue = Venue.objects.filter(pk=venue_id).first() if venue_id else Venue.objects.filter(slug=value).first()
        # Заведение - необязательная подпись к отметке: неизвестное просто не записываем.
        return venue if venue is not None and venue.is_published else None


# Алкоголь и скидки на него наградой быть не могут (закон о рекламе: призы, которые стимулируют спрос
# на алкоголь, запрещены). Проверка по словам грубая, но ловит очевидное; остальное на совести заведения.
ALCOHOL_WORDS = re.compile(
    r'\bпив(о|а|у|е|ом)\b|алкогол|\bвин(о|а|у|е|ом)\b|водк|виски|коньяк|шампанск|коктейл|\bсидр|\bэл[ья]\b'
    r'|\bлагер|\bстаут|\bbeer|\bwine|vodka|whisk',
    re.IGNORECASE)
NO_ALCOHOL_REWARD = 'Наградой не может быть алкоголь или скидка на него. Выберите угощение, сувенир или событие'


class RewardSerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(source='get_kind_display', read_only=True)
    venue = serializers.SlugRelatedField(slug_field='slug', queryset=Venue.objects.all(),
                                         required=False, allow_null=True)
    venue_name = serializers.SerializerMethodField()

    class Meta:
        model = Reward
        fields = ['id', 'venue', 'venue_name', 'title', 'description', 'kind', 'kind_display',
                  'cost', 'stock', 'is_active', 'created_at']
        read_only_fields = ['id', 'created_at']
        extra_kwargs = {
            'cost': {'min_value': 1, 'max_value': 100000},
            'stock': {'min_value': 0, 'max_value': 100000},
        }

    def get_venue_name(self, obj):
        return obj.venue.name if obj.venue_id else ''

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Введите название награды')
        return value

    def validate(self, attrs):
        current = self.instance
        text = ' '.join([
            attrs.get('title', current.title if current else ''),
            attrs.get('description', current.description if current else ''),
        ])
        if ALCOHOL_WORDS.search(text):
            raise serializers.ValidationError({'title': [NO_ALCOHOL_REWARD]})
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if user is None or has_role(user, ROLE_MODERATOR):
            return attrs
        # Администратор заведения ведёт награды только своего заведения.
        own = Venue.objects.filter(owner=user).first()
        if own is None:
            raise serializers.ValidationError('У вашей учётной записи нет заведения')
        target = attrs.get('venue', self.instance.venue if self.instance else None)
        if self.instance is None and 'venue' not in attrs:
            target = own
            attrs['venue'] = own
        if target is None or target.pk != own.pk:
            raise serializers.ValidationError({'venue': ['Награду можно создать только для своего заведения']})
        return attrs


class RedemptionSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    venue = serializers.SerializerMethodField()
    kind = serializers.SerializerMethodField()

    class Meta:
        model = Redemption
        fields = ['id', 'title', 'cost', 'code', 'status', 'status_display', 'venue', 'kind',
                  'created_at', 'used_at']

    def get_venue(self, obj):
        return {'slug': obj.venue.slug, 'name': obj.venue.name} if obj.venue_id else None

    def get_kind(self, obj):
        return obj.reward.kind if obj.reward_id else ''


class StaffRedemptionSerializer(RedemptionSerializer):
    """Для сотрудника заведения: ещё и кто получил."""

    guest = serializers.SerializerMethodField()

    class Meta(RedemptionSerializer.Meta):
        fields = RedemptionSerializer.Meta.fields + ['guest']

    def get_guest(self, obj):
        return obj.user.first_name or obj.user.username


class BrandRefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Brand
        fields = ['id', 'name', 'style']

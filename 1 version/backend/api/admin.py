from django.contrib import admin
from django.utils.html import format_html
from .models import (
    FlavorNote, Brand, FlavorProfile, ServingRecommendation,
    Course, TeamMember, Dish, FoodPairing, Venue, QRCode, AnonymousSession,
)


# ─── Inlines ─────────────────────────────────────────────────────────────────

class FlavorProfileInline(admin.TabularInline):
    model = FlavorProfile
    extra = 1
    fields = ['flavor_note', 'layer', 'intensity', 'sommelier_note', 'sommelier_name']
    autocomplete_fields = ['flavor_note']


class ServingRecommendationInline(admin.StackedInline):
    model = ServingRecommendation
    extra = 0
    max_num = 1


class FoodPairingInline(admin.TabularInline):
    model = FoodPairing
    extra = 0
    fk_name = 'brand'
    autocomplete_fields = ['dish']


class QRCodeInline(admin.TabularInline):
    model = QRCode
    extra = 0


# ─── Model Admins ────────────────────────────────────────────────────────────

@admin.register(FlavorNote)
class FlavorNoteAdmin(admin.ModelAdmin):
    list_display = ['icon', 'name', 'category', 'technical_term', 'is_off_flavour', 'sort_order']
    list_filter = ['category', 'is_off_flavour']
    search_fields = ['name', 'technical_term']
    ordering = ['sort_order']


@admin.register(Brand)
class BrandAdmin(admin.ModelAdmin):
    list_display = ['image_preview', 'name', 'brand_owner', 'style', 'abv', 'packaging_type', 'is_horeca_only', 'is_active', 'profile_status']
    list_filter = ['packaging_type', 'is_horeca_only', 'brand_owner', 'style', 'is_active']
    search_fields = ['name', 'brand_owner', 'style']
    readonly_fields = ['image_preview_large']
    inlines = [FlavorProfileInline, ServingRecommendationInline, FoodPairingInline]

    @admin.display(description='Фото')
    def image_preview(self, obj):
        if obj.image:
            return format_html('<img src="{}" style="height: 38px; width: auto; border-radius: 4px; object-fit: contain;" />', obj.image.url)
        return '—'

    @admin.display(description='Предпросмотр фото')
    def image_preview_large(self, obj):
        if obj.image:
            return format_html('<img src="{}" style="max-height: 200px; border-radius: 8px;" />', obj.image.url)
        return 'Нет загруженного изображения'

    @admin.display(description='Профиль')
    def profile_status(self, obj):
        profiles = obj.flavor_profiles.all()
        layers = set(p.layer for p in profiles)
        total = profiles.count()
        if total == 0:
            return '⚪ Пустой'
        if len(layers) == 3 and total >= 3:
            return '✅ Заполнен'
        return '⚠️ Частично'


@admin.register(FlavorProfile)
class FlavorProfileAdmin(admin.ModelAdmin):
    list_display = ['brand', 'flavor_note', 'layer', 'intensity', 'sommelier_name']
    list_filter = ['layer', 'brand']
    search_fields = ['brand__name', 'flavor_note__name']
    autocomplete_fields = ['brand', 'flavor_note']


@admin.register(ServingRecommendation)
class ServingRecommendationAdmin(admin.ModelAdmin):
    list_display = ['brand', 'serving_temp_min', 'serving_temp_max', 'glass_type', 'seasonality']
    search_fields = ['brand__name']
    autocomplete_fields = ['brand']


@admin.register(Course)
class CourseAdmin(admin.ModelAdmin):
    list_display = ['level', 'title', 'color', 'required_score']
    ordering = ['level']


@admin.register(TeamMember)
class TeamMemberAdmin(admin.ModelAdmin):
    list_display = ['name', 'role']


@admin.register(Dish)
class DishAdmin(admin.ModelAdmin):
    list_display = ['name', 'cuisine', 'category', 'dominant_taste', 'weight', 'fat_level', 'cooking_method']
    list_filter = ['cuisine', 'dominant_taste', 'weight', 'fat_level', 'cooking_method']
    search_fields = ['name', 'category', 'description']


@admin.register(FoodPairing)
class FoodPairingAdmin(admin.ModelAdmin):
    list_display = ['brand', 'dish', 'compatibility_score', 'pairing_type']
    list_filter = ['pairing_type']
    autocomplete_fields = ['brand', 'dish']


@admin.register(Venue)
class VenueAdmin(admin.ModelAdmin):
    list_display = ['name', 'venue_type', 'address']
    list_filter = ['venue_type']
    search_fields = ['name']
    inlines = [QRCodeInline]


@admin.register(QRCode)
class QRCodeAdmin(admin.ModelAdmin):
    list_display = ['venue', 'table_number', 'unique_token', 'scans_count']
    search_fields = ['unique_token', 'venue__name']


@admin.register(AnonymousSession)
class AnonymousSessionAdmin(admin.ModelAdmin):
    list_display = ['id', 'qr_code', 'completed_levels', 'score', 'created_at']
    list_filter = ['completed_levels']
    ordering = ['-created_at']

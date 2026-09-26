from django.contrib import admin
from django.utils.html import format_html
from .models import (
    FlavorNote, Brand, FlavorProfile, ServingRecommendation,
    Course, TeamMember, Dish, FoodPairing, Venue, QRCode, AnonymousSession,
    FoodIcon, SiteSettings, MenuItem, MenuDrink, Order, OrderItem, ChangeRequest,
    PilotEvent, PairingFeedback,
)


# Inlines

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


class MenuItemInline(admin.TabularInline):
    model = MenuItem
    extra = 0
    fields = ['dish', 'section', 'price', 'portion', 'sort_order', 'is_available', 'chef_note']
    autocomplete_fields = ['dish']


class MenuDrinkInline(admin.TabularInline):
    model = MenuDrink
    extra = 0
    fields = ['brand', 'engine_drink_id', 'name', 'price', 'volume', 'sort_order', 'is_available']
    autocomplete_fields = ['brand']


class OrderItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0
    fields = ['kind', 'title', 'price', 'qty', 'note', 'source', 'paired_menu_item', 'rec_rank',
              'menu_item', 'menu_drink']
    readonly_fields = ['menu_item', 'menu_drink', 'paired_menu_item']


# Model Admins

@admin.register(FlavorNote)
class FlavorNoteAdmin(admin.ModelAdmin):
    list_display = ['thumb', 'icon', 'name', 'category', 'technical_term', 'is_off_flavour', 'sort_order']
    list_filter = ['category', 'is_off_flavour', 'image']
    search_fields = ['name', 'technical_term']
    ordering = ['sort_order']
    readonly_fields = ['preview']
    fields = [
        'name', 'technical_term', 'wheel_code', 'category', 'description',
        'icon', 'image', 'preview', 'reference_material', 'is_off_flavour', 'sort_order',
    ]

    @admin.display(description='Фото')
    def thumb(self, obj):
        if obj.image:
            return format_html('<img src="{}" style="height:34px;width:auto;object-fit:contain" />', obj.image.url)
        return '-'

    @admin.display(description='Предпросмотр')
    def preview(self, obj):
        if obj.image:
            return format_html('<img src="{}" style="max-height:220px;width:auto;object-fit:contain" />', obj.image.url)
        return 'Загрузите фото - оно встанет вокруг бутылки на странице сорта.'


@admin.register(FoodIcon)
class FoodIconAdmin(admin.ModelAdmin):
    list_display = ['thumb', 'kind', 'key', 'label', 'sort_order']
    list_filter = ['kind']
    search_fields = ['key', 'label']
    ordering = ['kind', 'sort_order']
    readonly_fields = ['preview']

    @admin.display(description='Картинка')
    def thumb(self, obj):
        if obj.image:
            return format_html('<img src="{}" style="height:40px;width:auto;object-fit:contain" />', obj.image.url)
        return '-'

    @admin.display(description='Предпросмотр')
    def preview(self, obj):
        if obj.image:
            return format_html('<img src="{}" style="max-height:220px;width:auto;object-fit:contain" />', obj.image.url)
        return 'Загрузите PNG без фона - он заменит emoji в мастере подбора.'


@admin.register(SiteSettings)
class SiteSettingsAdmin(admin.ModelAdmin):
    list_display = ['__str__', 'alternatives_count', 'min_score_to_show', 'show_wheat_decor']

    def has_add_permission(self, request):
        # Запись одна: добавить вторую нельзя, только править существующую.
        return not SiteSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Brand)
class BrandAdmin(admin.ModelAdmin):
    list_display = ['image_preview', 'name', 'brand_owner', 'style', 'abv', 'packaging_type', 'is_horeca_only', 'is_active', 'profile_status']
    list_filter = ['packaging_type', 'is_horeca_only', 'brand_owner', 'style', 'is_active']
    search_fields = ['name', 'brand_owner', 'style']
    readonly_fields = ['image_preview_large']
    inlines = [FlavorProfileInline, ServingRecommendationInline, FoodPairingInline]
    fields = [
        'name', 'brand_owner', 'style', 'abv', 'density', 'fermentation_type',
        'packaging_type', 'is_horeca_only', 'description',
        'image', 'image_hd', 'image_preview_large',
        'accent_color', 'tagline', 'is_active',
    ]

    @admin.display(description='Фото')
    def image_preview(self, obj):
        if obj.image:
            return format_html('<img src="{}" style="height: 38px; width: auto; border-radius: 4px; object-fit: contain;" />', obj.image.url)
        return '-'

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
    list_display = ['thumb', 'name', 'cuisine', 'category', 'dominant_taste', 'weight', 'fat_level', 'cooking_method']
    list_filter = ['cuisine', 'dominant_taste', 'weight', 'fat_level', 'cooking_method']
    search_fields = ['name', 'category', 'description']

    @admin.display(description='Фото')
    def thumb(self, obj):
        if obj.photo:
            return format_html('<img src="{}" style="height:34px;width:auto;object-fit:cover;border-radius:4px" />', obj.photo.url)
        return '-'


@admin.register(FoodPairing)
class FoodPairingAdmin(admin.ModelAdmin):
    list_display = ['brand', 'dish', 'compatibility_score', 'pairing_type']
    list_filter = ['pairing_type']
    autocomplete_fields = ['brand', 'dish']


@admin.register(Venue)
class VenueAdmin(admin.ModelAdmin):
    list_display = ['name', 'slug', 'venue_type', 'city', 'owner', 'is_published', 'created_at']
    list_filter = ['venue_type', 'is_published', 'city']
    search_fields = ['name', 'slug', 'address']
    autocomplete_fields = ['owner']
    readonly_fields = ['created_at']
    fields = [
        'name', 'slug', 'venue_type', 'city', 'address', 'phone', 'working_hours',
        'description', 'logo', 'logo_file', 'cover', 'tables_count', 'accepts_orders', 'owner', 'is_published',
        'created_at',
    ]
    inlines = [MenuItemInline, MenuDrinkInline, QRCodeInline]


@admin.register(MenuItem)
class MenuItemAdmin(admin.ModelAdmin):
    list_display = ['dish', 'venue', 'section', 'price', 'portion', 'sort_order', 'is_available']
    list_filter = ['venue', 'section', 'is_available']
    search_fields = ['dish__name', 'venue__name', 'section']
    autocomplete_fields = ['venue', 'dish']
    ordering = ['venue', 'section', 'sort_order']


@admin.register(MenuDrink)
class MenuDrinkAdmin(admin.ModelAdmin):
    list_display = ['__str__', 'brand', 'engine_drink_id', 'venue', 'price', 'volume', 'sort_order', 'is_available']
    list_filter = ['venue', 'is_available']
    search_fields = ['brand__name', 'name', 'engine_drink_id', 'venue__name']
    autocomplete_fields = ['venue', 'brand']
    ordering = ['venue', 'sort_order']


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ['number', 'venue', 'table_number', 'status', 'total', 'guest_name', 'age_confirmed', 'created_at']
    list_filter = ['status', 'venue']
    search_fields = ['guest_name', 'comment', 'venue__name', 'items__title']
    readonly_fields = ['number', 'total', 'guest_token', 'session', 'age_confirmed', 'created_at', 'updated_at']
    autocomplete_fields = ['venue']
    ordering = ['-created_at']
    inlines = [OrderItemInline]


@admin.register(OrderItem)
class OrderItemAdmin(admin.ModelAdmin):
    list_display = ['title', 'order', 'kind', 'price', 'qty', 'source']
    list_filter = ['kind', 'source']
    search_fields = ['title', 'order__venue__name']
    readonly_fields = ['menu_item', 'menu_drink', 'paired_menu_item']


@admin.register(PilotEvent)
class PilotEventAdmin(admin.ModelAdmin):
    """События пилота только для просмотра: их пишет сайт, руками их не правят."""
    list_display = ['created_at', 'kind', 'venue', 'table_number', 'session', 'dish_ref', 'drink_ref', 'rank', 'source']
    list_filter = ['kind', 'venue']
    search_fields = ['session', 'dish_ref', 'drink_ref']
    date_hierarchy = 'created_at'
    ordering = ['-created_at']

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(PairingFeedback)
class PairingFeedbackAdmin(admin.ModelAdmin):
    list_display = ['created_at', 'venue', 'rating', 'dish_ref', 'drink_ref', 'comment']
    list_filter = ['rating', 'venue']
    search_fields = ['comment', 'dish_ref', 'drink_ref', 'session']
    readonly_fields = ['venue', 'order', 'session', 'dish_ref', 'drink_ref', 'rating', 'created_at']
    date_hierarchy = 'created_at'
    ordering = ['-created_at']

    def has_add_permission(self, request):
        return False


@admin.register(ChangeRequest)
class ChangeRequestAdmin(admin.ModelAdmin):
    list_display = ['brand', 'kind', 'status', 'author', 'reviewer', 'created_at', 'reviewed_at']
    list_filter = ['status', 'kind', 'brand']
    search_fields = ['brand__name', 'author__username', 'comment', 'review_comment']
    autocomplete_fields = ['brand', 'author', 'reviewer']
    readonly_fields = ['created_at']
    ordering = ['-created_at']


@admin.register(QRCode)
class QRCodeAdmin(admin.ModelAdmin):
    list_display = ['venue', 'table_number', 'unique_token', 'scans_count']
    search_fields = ['unique_token', 'venue__name']


@admin.register(AnonymousSession)
class AnonymousSessionAdmin(admin.ModelAdmin):
    list_display = ['id', 'qr_code', 'completed_levels', 'score', 'created_at']
    list_filter = ['completed_levels']
    ordering = ['-created_at']

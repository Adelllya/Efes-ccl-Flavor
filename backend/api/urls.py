from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views
from . import views_engine
from . import views_saas
from . import views_engine_v2
from . import ai

router = DefaultRouter()
router.register(r'brands', views.BrandViewSet)
router.register(r'flavor-notes', views.FlavorNoteViewSet)
router.register(r'courses', views.CourseViewSet)
router.register(r'team', views.TeamMemberViewSet)
router.register(r'dishes', views.DishViewSet)
router.register(r'pairings', views.FoodPairingViewSet)

urlpatterns = [
    # Router-generated CRUD + custom actions (pyramid, brands)
    path('', include(router.urls)),

    # Standalone views
    path('landing/', views.landing_data, name='landing-data'),
    path('health/', views.health_check, name='health-check'),
    path('seed/', views.seed_data, name='seed-data'),

    # Движок подбора v2: все категории напитков, вкладки, объяснения (docs/PAIRING_ENGINE_V2.md)
    path('v2/meta/', views_engine_v2.meta, name='v2-meta'),
    path('v2/drinks/', views_engine_v2.drinks_list, name='v2-drinks'),
    path('v2/drinks/<slug:drink_id>/', views_engine_v2.drink_detail, name='v2-drink-detail'),
    path('v2/dishes/', views_engine_v2.dishes_list, name='v2-dishes'),
    path('v2/pairing/dish/<slug:dish_id>/', views_engine_v2.pairing_for_dish, name='v2-pairing-dish'),
    path('v2/pairing/recommend/', views_engine_v2.pairing_recommend, name='v2-pairing-recommend'),
    path('v2/pairing/explain/', views_engine_v2.pairing_explain, name='v2-pairing-explain'),

    # Flavor Tree v2 — движок подбора, Flavor DNA, HoReCa
    path('engine/meta/', views_engine.engine_meta, name='engine-meta'),
    path('pairing/recommend/', views_engine.pairing_recommend, name='pairing-recommend'),
    path('pairing/dish/<slug:slug>/', views_engine.pairing_for_dish, name='pairing-for-dish'),
    path('pairing/beer/<slug:slug>/dishes/', views_engine.pairing_for_beer, name='pairing-for-beer'),
    path('pairing/explain/', views_engine.pairing_explain, name='pairing-explain'),
    path('dna/', views_engine.dna, name='dna'),
    path('venues/', views_engine.venues_list, name='venues'),
    path('venues/<slug:slug>/', views_engine.venue_detail, name='venue-detail'),
    path('qr/<str:token>/', views_engine.qr_resolve, name='qr-resolve'),
    path('qr-generate/', views_engine.qr_generate, name='qr-generate'),

    # ── SaaS для заведений: публичное меню, трекинг, заявки ──
    path('menu/<slug:slug>/', views_saas.menu_public, name='menu-public'),
    path('track/', views_saas.track, name='track'),
    path('leads/', views_saas.lead_create, name='lead-create'),

    # ── ИИ-сомелье: вопрос текстом или фото блюда ──
    path('ai/', ai.ai_sommelier, name='ai-sommelier'),

    # ── Кабинет заведения ──
    path('cabinet/register/', views_saas.cabinet_register, name='cabinet-register'),
    path('cabinet/login/', views_saas.cabinet_login, name='cabinet-login'),
    path('cabinet/overview/', views_saas.cabinet_overview, name='cabinet-overview'),
    path('cabinet/venue/', views_saas.cabinet_venue, name='cabinet-venue'),
    path('cabinet/menu/', views_saas.cabinet_menu, name='cabinet-menu'),
    path('cabinet/menu/import/', views_saas.cabinet_menu_import, name='cabinet-menu-import'),
    path('cabinet/menu/<uuid:item_id>/', views_saas.cabinet_menu_item, name='cabinet-menu-item'),
    path('cabinet/tables/', views_saas.cabinet_tables, name='cabinet-tables'),
    path('cabinet/tables/<uuid:table_id>/', views_saas.cabinet_table, name='cabinet-table'),
    path('cabinet/stats/', views_saas.cabinet_stats, name='cabinet-stats'),

    # Admin (sommelier) endpoints
    path('admin/brands/', views.admin_brands, name='admin-brands'),
    path('admin/flavor-profiles/', views.admin_flavor_profiles, name='admin-flavor-profiles'),
    path('admin/serving-recommendations/', views.admin_serving_recommendations, name='admin-serving-recs'),
    path('admin/flavor-notes/', views.admin_flavor_notes, name='admin-flavor-notes'),
]

# ── REVIEWS: отзывы гостей о парах напиток × блюдо (docs/REVIEWS.md, api/views_reviews.py) ──────────────
from . import views_reviews  # noqa: E402

urlpatterns += [
    path('v2/reviews/', views_reviews.reviews_create, name='v2-reviews'),
    path('v2/reviews/pair/', views_reviews.reviews_pair, name='v2-reviews-pair'),
    path('v2/reviews/drink/<slug:drink_id>/', views_reviews.reviews_drink, name='v2-reviews-drink'),
    path('v2/reviews/moderation/', views_reviews.moderation_queue, name='v2-reviews-moderation'),
    path('v2/reviews/<uuid:review_id>/moderate/', views_reviews.moderate, name='v2-reviews-moderate'),
    path('cabinet/reviews/', views_reviews.cabinet_reviews, name='cabinet-reviews'),
]
# ── конец блока REVIEWS ──

# ── BRAND-TRACKING: показы подбора и действия гостей → аналитика бренда (docs/EFES_ANALYTICS.md) ──────────
from . import views_brand, views_tracking  # noqa: E402

urlpatterns += [
    path('v2/track/', views_tracking.track, name='v2-track'),
    path('brand/overview/', views_brand.overview, name='brand-overview'),
]
# ── конец блока BRAND-TRACKING ──

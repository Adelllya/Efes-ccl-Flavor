from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views
from . import views_engine
from . import views_saas
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

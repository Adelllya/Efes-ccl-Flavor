from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views, views_ai, views_auth, views_orders, views_requests

router = DefaultRouter()
router.register(r'brands', views.BrandViewSet)
router.register(r'flavor-notes', views.FlavorNoteViewSet)
router.register(r'courses', views.CourseViewSet)
router.register(r'team', views.TeamMemberViewSet)
router.register(r'dishes', views.DishViewSet)
router.register(r'pairings', views.FoodPairingViewSet)
router.register(r'food-icons', views.FoodIconViewSet)
router.register(r'venues', views.VenueViewSet, basename='venue')
router.register(r'menu-items', views.MenuItemViewSet)
router.register(r'menu-drinks', views.MenuDrinkViewSet)
router.register(r'orders', views_orders.OrderViewSet, basename='order')
router.register(r'change-requests', views_requests.ChangeRequestViewSet, basename='change-request')

urlpatterns = [
    # Router-generated CRUD + custom actions (pyramid, brands)
    path('', include(router.urls)),

    # Вход, профиль, пользователи
    path('auth/register/', views_auth.register, name='auth-register'),
    path('auth/login/', views_auth.login, name='auth-login'),
    path('auth/logout/', views_auth.logout, name='auth-logout'),
    path('auth/me/', views_auth.me, name='auth-me'),
    path('auth/change-password/', views_auth.change_password, name='auth-change-password'),
    path('auth/users/', views_auth.users_list, name='auth-users'),
    path('auth/users/<int:id>/', views_auth.user_update, name='auth-user-update'),

    # ИИ-сомелье
    path('ai/status/', views_ai.ai_status, name='ai-status'),
    path('ai/sommelier/', views_ai.SommelierView.as_view(), name='ai-sommelier'),

    # Standalone views
    path('landing/', views.landing_data, name='landing-data'),
    path('health/', views.health_check, name='health-check'),
    path('settings/', views.site_settings, name='site-settings'),
    path('seed/', views.seed_data, name='seed-data'),

    # Admin (sommelier) endpoints
    path('admin/brands/', views.admin_brands, name='admin-brands'),
    path('admin/flavor-profiles/', views.admin_flavor_profiles, name='admin-flavor-profiles'),
    path('admin/serving-recommendations/', views.admin_serving_recommendations, name='admin-serving-recs'),
    path('admin/flavor-notes/', views.admin_flavor_notes, name='admin-flavor-notes'),
]

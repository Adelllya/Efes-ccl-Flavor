from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import (
    views, views_academy, views_ai, views_analytics, views_auth, views_engine_v2, views_engine_tuning,
    views_orders, views_passport, views_pilot, views_requests, views_school,
)

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
router.register(r'quiz-questions', views_school.QuizQuestionViewSet, basename='quiz-question')
router.register(r'rewards', views_passport.RewardViewSet, basename='reward')

urlpatterns = [
    # Пилот в баре: события гостя, оценка пары, отчёт и выгрузка, QR столов.
    # QR стоит раньше роутера, чтобы venues/<slug>/qr.svg не разбирался как адрес заведения.
    path('events/', views_pilot.events, name='pilot-events'),
    path('feedback/', views_pilot.feedback, name='pilot-feedback'),
    path('pilot/report/', views_pilot.report, name='pilot-report'),
    path('pilot/export.csv', views_pilot.ExportCsvView.as_view(), name='pilot-export'),
    path('venues/<slug:slug>/qr.svg', views_pilot.VenueQrView.as_view(), name='venue-qr'),
    path('venues/<slug:slug>/qr-link/', views_pilot.venue_qr_link, name='venue-qr-link'),
    # Раньше роутера: иначе /brands/<id>/guests/ и /pairings/<id>/feedback/ перехватят его маршруты
    path('brands/<uuid:brand_id>/guests/', views_passport.brand_guests, name='brand-guests'),
    path('pairings/<uuid:pairing_id>/feedback/', views_passport.pairing_feedback, name='pairing-feedback'),

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
    path('auth/preferences/', views_school.preferences, name='auth-preferences'),

    # Тест Школы сомелье
    path('quiz/<int:level>/', views_school.quiz, name='quiz'),
    path('quiz/<int:level>/submit/', views_school.quiz_submit, name='quiz-submit'),

    # Академия: путь из ступеней и уроки
    path('academy/', views_academy.academy, name='academy'),
    path('lessons/<slug:slug>/', views_academy.lesson_detail, name='lesson-detail'),
    path('lessons/<slug:slug>/complete/', views_academy.lesson_complete, name='lesson-complete'),

    # Паспорт вкуса, отметки сортов и награды
    path('passport/', views_passport.passport_view, name='passport'),
    path('tastings/<uuid:brand_id>/', views_passport.TastingView.as_view(), name='tasting'),
    path('redemptions/', views_passport.redemptions, name='redemptions'),
    path('redemptions/use/', views_passport.redemption_use, name='redemption-use'),
    path('redemptions/staff/', views_passport.redemptions_staff, name='redemptions-staff'),
    path('redemptions/<uuid:pk>/cancel/', views_passport.redemption_cancel, name='redemption-cancel'),

    # Аналитика заведения и сортов
    path('analytics/venue/<str:slug>/', views_analytics.venue_analytics, name='analytics-venue'),
    path('analytics/venue/<str:slug>/export/', views_analytics.venue_export, name='analytics-venue-export'),
    path('analytics/brands/', views_analytics.brands_analytics, name='analytics-brands'),

    # ИИ-сомелье
    path('ai/status/', views_ai.ai_status, name='ai-status'),
    path('ai/sommelier/', views_ai.SommelierView.as_view(), name='ai-sommelier'),
    path('ai/sommelier/photo/', views_ai.SommelierPhotoView.as_view(), name='ai-sommelier-photo'),
    path('ai/dishes/recognize/', views_ai.DishRecognizeView.as_view(), name='ai-dishes-recognize'),
    path('ai/pairings/suggest/', views_ai.PairingSuggestView.as_view(), name='ai-pairings-suggest'),
    path('ai/pairings/save/', views_ai.PairingSaveView.as_view(), name='ai-pairings-save'),

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

    # Подбор v2: 412 напитков всех категорий, 114 блюд (движок api/pairing/engine_v2.py)
    path('v2/meta/', views_engine_v2.meta, name='v2-meta'),
    path('v2/drinks/', views_engine_v2.drinks_list, name='v2-drinks'),
    path('v2/drinks/<slug:drink_id>/', views_engine_v2.drink_detail, name='v2-drink-detail'),
    path('v2/dishes/', views_engine_v2.dishes_list, name='v2-dishes'),
    path('v2/pairing/dish/<slug:dish_id>/', views_engine_v2.pairing_for_dish, name='v2-pairing-dish'),
    path('v2/pairing/recommend/', views_engine_v2.pairing_recommend, name='v2-pairing-recommend'),
    path('v2/pairing/explain/', views_engine_v2.pairing_explain, name='v2-pairing-explain'),

    # Подкрутка весов движка из админ-панели (moderator/sommelier)
    path('v2/tuning/', views_engine_tuning.tuning_state, name='v2-tuning'),
    path('v2/tuning/save/', views_engine_tuning.tuning_save, name='v2-tuning-save'),
    path('v2/tuning/reset/', views_engine_tuning.tuning_reset, name='v2-tuning-reset'),
]

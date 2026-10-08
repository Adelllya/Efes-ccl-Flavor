"""
ИИ-сомелье: статус, чат и фото блюда для гостя; распознавание блюд по фото и подбор сортов для панели.
Чат и фото гостя открыты без входа и ограничены по частоте. У чата дневной лимит ответов Claude (ai_usage),
у фото и панели свой дневной счётчик в базе (AiUsage). Каждый вопрос чата записывается событием пилота AI_ASK.
"""
import json

from django.db import transaction
from django.db.models import F
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import NotFound
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle
from rest_framework.views import APIView

from . import ai_sommelier, ai_usage, ai_vision
from .images import read_image_upload
from .models import AiUsage, Brand, Dish, FoodPairing, PilotEvent, Venue
from .permissions import (
    ROLE_MODERATOR, ROLE_RESTAURANT, ROLE_SOMMELIER, IsRestaurantOrModerator, has_role, roles_required,
)
from .pilot import record_event
from .serializers import FoodPairingSerializer, parse_uuid

MAX_TURNS = 12
MAX_MESSAGE_CHARS = 1500
MAX_CART_ITEMS = 50

AI_DISABLED = {
    'detail': 'ИИ выключен: на сервере не задан ключ ANTHROPIC_API_KEY',
    'code': 'ai_disabled',
}
AI_BUDGET = {
    'detail': 'Дневной лимит обращений к ИИ исчерпан. Попробуйте завтра',
    'code': 'ai_budget',
}
IsPanelUser = roles_required(ROLE_SOMMELIER, ROLE_RESTAURANT)


class AiAnonThrottle(AnonRateThrottle):
    scope = 'ai'


class AiUserThrottle(UserRateThrottle):
    scope = 'ai_user'


class AiVisionThrottle(UserRateThrottle):
    scope = 'ai_vision'


class AiPhotoAnonThrottle(AnonRateThrottle):
    scope = 'ai_photo'


class AiPhotoUserThrottle(UserRateThrottle):
    scope = 'ai_photo_user'


def charge_ai(kind):
    """
    Занимает одно обращение в дневном лимите ИИ. False: лимит на сегодня исчерпан.
    Счётчик лежит в базе: лимиты по частоте у каждого экземпляра сервера свои.
    """
    limit = ai_sommelier.daily_limit(kind)
    if limit <= 0:
        return True
    today = timezone.localdate()
    with transaction.atomic():
        usage, _ = AiUsage.objects.select_for_update().get_or_create(day=today, kind=kind)
        if usage.count >= limit:
            return False
        AiUsage.objects.filter(pk=usage.pk).update(count=F('count') + 1)
    return True


class AiMessageSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=['user', 'assistant'])
    content = serializers.CharField(max_length=MAX_MESSAGE_CHARS)


class AiCartItemSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=[ai_sommelier.KIND_DISH, ai_sommelier.KIND_DRINK])
    id = serializers.UUIDField()
    title = serializers.CharField(max_length=200, required=False, allow_blank=True, default='')
    qty = serializers.IntegerField(min_value=1, max_value=99, required=False, default=1)


class AiPrefsSerializer(serializers.Serializer):
    no_bitter = serializers.BooleanField(required=False, default=False)
    light = serializers.BooleanField(required=False, default=False)
    no_alcohol = serializers.BooleanField(required=False, default=False)
    spicy_ok = serializers.BooleanField(required=False, default=False)


class AiRequestSerializer(serializers.Serializer):
    """Тело POST /api/ai/sommelier/: заведение, стол, история, корзина, пожелания и запомненные флаги."""
    venue = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)
    # id браузера гостя (localStorage ft_sid) для статистики пилота; кривое значение просто не пишется
    session = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=64, default='')
    table = serializers.IntegerField(required=False, allow_null=True, min_value=0, max_value=9999, default=None)
    messages = AiMessageSerializer(many=True)
    cart = AiCartItemSerializer(many=True, required=False, default=list)
    prefs = AiPrefsSerializer(required=False, default=dict)
    # Флаги безопасности, которые чат запомнил из прошлых ответов (safety_flags). Они только запрещают,
    # поэтому клиенту можно верить; незнакомые значения ai_safety.assess просто пропускает.
    safety_flags = serializers.ListField(
        child=serializers.CharField(max_length=24), required=False, default=list, max_length=12)

    def validate_messages(self, value):
        if not value:
            raise serializers.ValidationError('Напишите сообщение')
        if len(value) > MAX_TURNS:
            raise serializers.ValidationError('Не больше {} реплик в истории'.format(MAX_TURNS))
        if value[-1]['role'] != 'user':
            raise serializers.ValidationError('Последняя реплика должна быть от гостя')
        return value

    def validate_cart(self, value):
        if len(value) > MAX_CART_ITEMS:
            raise serializers.ValidationError('В корзине не больше {} позиций'.format(MAX_CART_ITEMS))
        return value


def resolve_venue(request, raw):
    """Заведение по slug или uuid. Скрытое заведение видят только его владелец и модератор."""
    raw = (raw or '').strip()
    venue_id = parse_uuid(raw)
    venue = Venue.objects.filter(pk=venue_id).first() if venue_id else Venue.objects.filter(slug=raw).first()
    if venue is not None and not venue.is_published:
        user = request.user
        if not (user.is_authenticated and (has_role(user, ROLE_MODERATOR) or venue.owner_id == user.id)):
            venue = None
    if venue is None:
        raise NotFound('Заведение не найдено')
    return venue


def ai_error_response(exc):
    """AiFailed -> ответ с понятным текстом. Плохой файл это ошибка запроса, остальное сбой сервиса."""
    code = status.HTTP_400_BAD_REQUEST if exc.code == 'bad_image' else status.HTTP_502_BAD_GATEWAY
    if exc.code in ('busy', 'timeout', 'network', 'auth'):
        code = status.HTTP_503_SERVICE_UNAVAILABLE
    return Response({'detail': exc.message, 'code': exc.code}, status=code)


@api_view(['GET'])
@permission_classes([AllowAny])
def ai_status(request):
    """
    GET /api/ai/status/ -> {enabled, model, mode, limit_reached}. mode: claude, когда есть ключ
    и не исчерпан дневной лимит, иначе local (вкусовой движок). Модератор видит ещё расход за сутки.
    """
    enabled = ai_sommelier.ai_enabled()
    limit_reached = enabled and ai_usage.limit_reached()
    data = {
        'enabled': enabled,
        'model': ai_sommelier.ai_model(),
        'mode': 'claude' if enabled and not limit_reached else 'local',
        'limit_reached': limit_reached,
    }
    if request.user.is_authenticated and has_role(request.user, ROLE_MODERATOR):
        data['usage'] = ai_usage.snapshot()
    return Response(data)


class SommelierView(APIView):
    """
    POST /api/ai/sommelier/ - ответ ИИ-сомелье на историю чата гостя.
    Без ключа или при ошибке API отвечает локальный подбор (mode: local).
    """
    permission_classes = [AllowAny]
    throttle_classes = [AiAnonThrottle, AiUserThrottle]

    def post(self, request):
        serializer = AiRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        venue = resolve_venue(request, data['venue']) if data.get('venue') else None
        ctx = ai_sommelier.build_context(venue=venue)
        cart = [dict(item, id=str(item['id'])) for item in data['cart']]
        result = ai_sommelier.answer(ctx, data['messages'], cart=cart, prefs=data['prefs'], table=data['table'],
                                     safety_flags=data['safety_flags'])
        meta = result.pop('_meta', {})
        record_ask(venue, data, result, meta)
        return Response(result)


def record_ask(venue, data, result, meta):
    """Событие AI_ASK для отчёта пилота: режим, язык, флаг безопасности, карточки, время и токены."""
    table = data.get('table')
    first_drink = next((s['id'] for s in result['suggestions'] if s['kind'] == ai_sommelier.KIND_DRINK), '')
    record_event(
        PilotEvent.KIND_AI_ASK, venue=venue, session=data.get('session') or '',
        table_number=table if table and 0 < table <= 32767 else None,
        dish_ref=meta.get('dish') or '', drink_ref=first_drink, source=result['mode'],
        meta={key: meta[key] for key in ('mode', 'lang', 'safety', 'intent', 'ms', 'tokens', 'model', 'limit',
                                         'rejected', 'suggestions', 'q') if meta.get(key) not in (None, '', [])},
    )


class SommelierPhotoView(APIView):
    """
    POST /api/ai/sommelier/photo/ (multipart: image, venue?, prefs?) - гость прислал фото блюда.
    Сомелье узнаёт блюдо и советует напиток: из карты бара заведения или из каталога.
    Ответ в формате чата: {reply, suggestions, mode, note, dish}.
    """
    permission_classes = [AllowAny]
    throttle_classes = [AiPhotoAnonThrottle, AiPhotoUserThrottle]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        file_obj, error = read_image_upload(request)
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)
        raw_venue = (request.data.get('venue') or '').strip()
        venue = resolve_venue(request, raw_venue) if raw_venue else None
        prefs = self._prefs(request.data.get('prefs'))

        if not ai_sommelier.ai_enabled():
            return Response(self._photo_off())
        if not charge_ai(AiUsage.KIND_GUEST):
            return Response(AI_BUDGET, status=status.HTTP_429_TOO_MANY_REQUESTS)

        ctx = ai_sommelier.build_context(venue=venue)
        drinks = [d for d in ctx['drinks'] if d['is_available'] and ai_sommelier.fits_prefs(d, prefs)]
        # Напитки движка без сорта каталога распознавание не знает: передаём только сорта каталога.
        brand_ids = [d['brand_id'] for d in drinks if d.get('brand_id')]
        try:
            result = ai_vision.recognize(file_obj, brand_ids=brand_ids)
        except ai_vision.AiUnavailable:
            return Response(self._photo_off())
        except ai_vision.AiFailed as exc:
            return ai_error_response(exc)
        return Response(ai_sommelier.photo_reply(result, ctx, prefs))

    @staticmethod
    def _photo_off():
        """Без ключа фото не разобрать: чат получает обычный ответ с просьбой написать название."""
        return {'reply': ai_sommelier.PHOTO_OFF_REPLY, 'suggestions': [], 'mode': 'local', 'note': '', 'dish': None}

    @staticmethod
    def _prefs(raw):
        """Пожелания приходят строкой JSON в multipart; мусор молча считаем пустым набором."""
        try:
            data = json.loads(raw) if isinstance(raw, str) and raw.strip() else {}
        except ValueError:
            data = {}
        serializer = AiPrefsSerializer(data=data if isinstance(data, dict) else {})
        return serializer.validated_data if serializer.is_valid() else {}


class DishRecognizeView(APIView):
    """
    POST /api/ai/dishes/recognize/ (multipart: image, hint?) - блюда с фото тарелки или страницы меню.
    Ничего не сохраняет: возвращает черновики, которые администратор проверяет и отправляет
    в POST /api/dishes/import/. Доступно администратору заведения и модератору.
    """
    permission_classes = [IsRestaurantOrModerator]
    throttle_classes = [AiVisionThrottle]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        file_obj, error = read_image_upload(request)
        if error:
            return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)
        if not ai_sommelier.ai_enabled():
            return Response(AI_DISABLED, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if not charge_ai(AiUsage.KIND_PANEL):
            return Response(AI_BUDGET, status=status.HTTP_429_TOO_MANY_REQUESTS)
        try:
            result = ai_vision.recognize(file_obj, hint=request.data.get('hint') or '')
        except ai_vision.AiUnavailable:
            return Response(AI_DISABLED, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except ai_vision.AiFailed as exc:
            return ai_error_response(exc)
        return Response(result)


class PairingSuggestSerializer(serializers.Serializer):
    dishes = serializers.ListField(child=serializers.UUIDField(), allow_empty=False,
                                   max_length=ai_vision.MAX_SUGGEST_DISHES)
    save = serializers.BooleanField(required=False, default=False)


def can_save_pairings(user, dish):
    """
    Кто может записать пары ИИ к блюду: сомелье и модератор к любому; администратор заведения
    к блюду из своего меню, которого нет в чужих меню (то же правило, что и для правки блюда).
    """
    if has_role(user, ROLE_SOMMELIER):
        return True
    own = dish.menu_items.filter(venue__owner=user).exists()
    foreign = dish.menu_items.exclude(venue__owner=user).exists()
    return own and not foreign


class PairingSuggestView(APIView):
    """
    POST /api/ai/pairings/suggest/ {dishes: [uuid], save?} - сорта к блюдам каталога.
    С ключом отвечает Claude, без ключа и при сбое считает локальный расчёт по правилам.
    save=true сразу записывает новые пары с пометкой "ИИ-подбор" там, где это разрешено роли;
    пары, которые уже есть, не трогает.
    """
    permission_classes = [IsPanelUser]
    throttle_classes = [AiVisionThrottle]

    def post(self, request):
        serializer = PairingSuggestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ids = list(dict.fromkeys(serializer.validated_data['dishes']))
        found = {dish.id: dish for dish in Dish.objects.filter(pk__in=ids)}
        dishes = [found[i] for i in ids if i in found]
        if not dishes:
            raise NotFound('Блюда не найдены')

        if ai_sommelier.ai_enabled() and not charge_ai(AiUsage.KIND_PANEL):
            return Response(AI_BUDGET, status=status.HTTP_429_TOO_MANY_REQUESTS)

        results, mode, note = ai_vision.suggest_pairings(
            [(str(dish.id), ai_vision.dish_fields(dish)) for dish in dishes])

        existing = set(
            (str(dish_id), str(brand_id)) for dish_id, brand_id in
            FoodPairing.objects.filter(dish__in=dishes).values_list('dish_id', 'brand_id'))
        save = serializer.validated_data['save']
        saved = 0
        by_id = {str(dish.id): dish for dish in dishes}
        with transaction.atomic():
            for result in results:
                dish = by_id[result['dish']]
                result['can_save'] = can_save_pairings(request.user, dish)
                allowed = save and result['can_save']
                for pairing in result['pairings']:
                    key = (result['dish'], pairing['brand'])
                    pairing['exists'] = key in existing
                    pairing['saved'] = False
                    if allowed and not pairing['exists']:
                        FoodPairing.objects.create(
                            brand_id=pairing['brand'], dish=dish,
                            compatibility_score=pairing['compatibility_score'],
                            pairing_type=pairing['pairing_type'],
                            explanation=pairing['explanation'] or 'Подбор ИИ по вкусовому профилю блюда и сорта',
                            source=FoodPairing.SOURCE_AI,
                        )
                        existing.add(key)
                        pairing['exists'] = True
                        pairing['saved'] = True
                        saved += 1
        return Response({'results': results, 'mode': mode, 'note': note, 'saved': saved})


class PairingSaveItemSerializer(serializers.Serializer):
    dish = serializers.PrimaryKeyRelatedField(queryset=Dish.objects.all())
    brand = serializers.PrimaryKeyRelatedField(queryset=Brand.objects.filter(is_active=True))
    compatibility_score = serializers.IntegerField(min_value=1, max_value=5)
    pairing_type = serializers.ChoiceField(choices=FoodPairing.PAIRING_TYPE_CHOICES)
    explanation = serializers.CharField(max_length=500, required=False, allow_blank=True, default='')


class PairingSaveSerializer(serializers.Serializer):
    items = PairingSaveItemSerializer(many=True, allow_empty=False, max_length=60)


class PairingSaveView(APIView):
    """
    POST /api/ai/pairings/save/ {items: [{dish, brand, compatibility_score, pairing_type, explanation}]}
    Записывает пары, которые ИИ предложил в /suggest/, без повторного обращения к модели.
    Сомелье и модератор принимают совет сами, поэтому их пары считаются парами сомелье;
    у администратора заведения пара остаётся "ИИ-подбором" до подтверждения сомелье.
    Готовые пары не трогает, чужие блюда пропускает.
    """
    permission_classes = [IsPanelUser]

    def post(self, request):
        serializer = PairingSaveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        source = FoodPairing.SOURCE_SOMMELIER if has_role(request.user, ROLE_SOMMELIER) else FoodPairing.SOURCE_AI
        saved = []
        skipped = 0
        allowed = {}
        with transaction.atomic():
            for item in serializer.validated_data['items']:
                dish = item['dish']
                if dish.id not in allowed:
                    allowed[dish.id] = can_save_pairings(request.user, dish)
                if not allowed[dish.id] or FoodPairing.objects.filter(brand=item['brand'], dish=dish).exists():
                    skipped += 1
                    continue
                saved.append(FoodPairing.objects.create(
                    brand=item['brand'], dish=dish,
                    compatibility_score=item['compatibility_score'],
                    pairing_type=item['pairing_type'],
                    explanation=item['explanation'].strip() or 'Подбор ИИ по вкусовому профилю блюда и сорта',
                    source=source,
                ))
        return Response({
            'saved': len(saved), 'skipped': skipped,
            'pairings': FoodPairingSerializer(saved, many=True).data,
        }, status=status.HTTP_201_CREATED if saved else status.HTTP_200_OK)

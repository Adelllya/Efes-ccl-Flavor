"""
ИИ-сомелье: статус и чат. Оба эндпоинта открыты без входа, чат ограничен по частоте
и дневным лимитом ответов Claude (ai_usage). Каждый вопрос записывается событием пилота AI_ASK.
"""
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle
from rest_framework.views import APIView

from . import ai_sommelier, ai_usage
from .models import PilotEvent, Venue
from .permissions import ROLE_MODERATOR, has_role
from .pilot import record_event
from .serializers import parse_uuid

MAX_TURNS = 12
MAX_MESSAGE_CHARS = 1500
MAX_CART_ITEMS = 50


class AiAnonThrottle(AnonRateThrottle):
    scope = 'ai'


class AiUserThrottle(UserRateThrottle):
    scope = 'ai_user'


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
    """Тело POST /api/ai/sommelier/: заведение, стол, история, корзина и пожелания."""
    venue = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)
    # id браузера гостя (localStorage ft_sid) для статистики пилота; кривое значение просто не пишется
    session = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=64, default='')
    table = serializers.IntegerField(required=False, allow_null=True, min_value=0, max_value=9999, default=None)
    messages = AiMessageSerializer(many=True)
    cart = AiCartItemSerializer(many=True, required=False, default=list)
    prefs = AiPrefsSerializer(required=False, default=dict)

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
        result = ai_sommelier.answer(ctx, data['messages'], cart=cart, prefs=data['prefs'], table=data['table'])
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
                                         'suggestions', 'q') if meta.get(key) not in (None, '', [])},
    )

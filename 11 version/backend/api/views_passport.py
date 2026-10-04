"""
Паспорт вкуса, оценки пар и награды за баллы знаний.

Гость отмечает сорт: какие ноты услышал и насколько понравилось. Отметки складываются
в паспорт и в общую картину «что слышат гости», которую видит сомелье.
"""
import random
import re
import secrets

from django.contrib.auth.models import User
from django.db import IntegrityError, transaction
from django.db.models import Avg, Count, F, Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes, throttle_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticated, SAFE_METHODS
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle
from rest_framework.views import APIView

from . import passport
from .models import (
    Brand, FlavorNote, FlavorProfile, FoodPairing, PairingFeedback, Redemption, Reward, Tasting, Venue,
)
from .permissions import ROLE_MODERATOR, ROLE_RESTAURANT, has_role
from .serializers import FlavorNoteMinimalSerializer, parse_uuid
from .serializers_passport import (
    RedemptionSerializer, RewardSerializer, StaffRedemptionSerializer, TastingInputSerializer,
    TastingSerializer, brand_card,
)
from .views_orders import find_venue

# Сколько нот в палитре выбора и с какого числа отметок показываем «что слышат гости»
PALETTE_SIZE = 12
MIN_GUESTS = 3
# Сколько новых сортов можно отметить за день. Паспорт поощряет знакомство с сортами,
# а не количество выпитого за вечер, поэтому третья новая отметка ждёт завтра.
DAILY_NEW_TASTINGS = 2
DEVICE_RE = re.compile(r'^[A-Za-z0-9_-]{16,64}$')
CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
CODE_LENGTH = 6


class FeedbackAnonThrottle(AnonRateThrottle):
    scope = 'feedback'


class FeedbackUserThrottle(UserRateThrottle):
    scope = 'feedback'


# Слова, которые есть в названии почти любой ноты: по ним ноты не сравниваем
COMMON_WORDS = ('ноты', 'нота', 'нотк', 'аром', 'посл', 'вкус', 'легк', 'отте', 'тона')


def note_words(name):
    """Значимые слова названия ноты в нижнем регистре, без ё."""
    words = re.findall(r'[a-zа-я]+', name.lower().replace('ё', 'е'))
    return [w for w in words if len(w) >= 3 and w[:4] not in COMMON_WORDS]


def similar_words(a, b):
    """
    Однокоренные слова: «цитрус» и «цитрусовый», «мёд» и «медовые», «горечь» и «горчинка».
    Сравниваем по первым трём буквам: лишнее совпадение только убирает ноту из запасных.
    """
    return a[:3] == b[:3]


def too_close(words, taken):
    return any(similar_words(a, b) for a in words for b in taken)


def build_palette(brand):
    """
    Ноты для выбора: вся пирамида сорта и посторонние ноты до PALETTE_SIZE.
    Посторонние ноты не должны быть похожи на ноты пирамиды и друг на друга: между
    «Цитрус» и «Цитрусовый аромат» гость выбирал бы наугад.
    Набор и порядок зависят только от сорта, поэтому у всех гостей палитра одна.
    """
    own = [p.flavor_note for p in FlavorProfile.objects.filter(brand=brand).select_related('flavor_note')
           if not p.flavor_note.is_off_flavour]
    palette = list({note.id: note for note in own}.values())
    taken = []
    for note in palette:
        taken += note_words(note.name)
    rng = random.Random(str(brand.id))
    others = list(FlavorNote.objects.filter(is_off_flavour=False).exclude(pk__in=[n.id for n in palette])
                  .order_by('sort_order', 'name', 'id'))
    rng.shuffle(others)
    for note in others:
        if len(palette) >= PALETTE_SIZE:
            break
        words = note_words(note.name)
        if not words or too_close(words, taken):
            continue
        taken += words
        palette.append(note)
    rng.shuffle(palette)
    return palette


def new_tastings_today(user):
    """Сколько сортов пользователь впервые отметил сегодня (по местному времени)."""
    today = timezone.localdate()
    return Tasting.objects.filter(user=user, created_at__date=today).count()


def reveal_for(brand, chosen_ids, request):
    """Пирамида сомелье и что из неё услышал гость."""
    profiles = FlavorProfile.objects.filter(brand=brand).select_related('flavor_note').order_by('-intensity')
    pyramid = []
    seen = set()
    for profile in profiles:
        note = profile.flavor_note
        if note.id in seen:
            continue
        seen.add(note.id)
        item = FlavorNoteMinimalSerializer(note, context={'request': request}).data
        item['layer'] = profile.layer
        item['intensity'] = profile.intensity
        item['heard'] = note.id in chosen_ids
        pyramid.append(item)
    return {'pyramid': pyramid, 'matched': sum(1 for item in pyramid if item['heard']), 'total': len(pyramid)}


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def passport_view(request):
    """GET /api/passport/ - баллы, ранг, значки, отметки сортов и коды наград пользователя."""
    user = request.user
    data = passport.collect(user)
    rows = passport.breakdown(data)
    earned = sum(row['points'] for row in rows)
    spent = passport.spent_points(user)
    context = {'request': request}
    redemptions = Redemption.objects.filter(user=user).select_related('venue', 'reward')[:30]
    return Response({
        'points': {'earned': earned, 'spent': spent, 'balance': max(earned - spent, 0)},
        'rank': passport.rank_for(earned),
        'ranks': [{'title': title, 'from': threshold} for threshold, title in passport.RANKS],
        'breakdown': rows,
        'badges': passport.badges(data),
        'tastings': TastingSerializer(data['tastings'], many=True, context=context).data,
        'brands_total': Brand.objects.filter(is_active=True).count(),
        'rules': {
            'lesson': passport.POINTS_LESSON, 'level': passport.POINTS_LEVEL,
            'tasting': passport.POINTS_TASTING, 'notes': passport.POINTS_NOTES,
            'feedback': passport.POINTS_FEEDBACK, 'notes_from': passport.NOTES_BONUS_FROM,
            'feedback_cap': passport.FEEDBACK_CAP,
        },
        'redemptions': RedemptionSerializer(redemptions, many=True).data,
    })


class TastingView(APIView):
    """
    GET    /api/tastings/<brand>/ - палитра нот сорта и отметка пользователя, если она есть
    PUT    /api/tastings/<brand>/ - {rating, notes, comment?, venue?}: поставить или изменить отметку
    DELETE /api/tastings/<brand>/ - убрать отметку
    """

    def get_permissions(self):
        return [AllowAny()] if self.request.method in SAFE_METHODS else [IsAuthenticated()]

    def _brand(self, brand_id):
        return Brand.objects.filter(pk=brand_id, is_active=True).first()

    def get(self, request, brand_id):
        brand = self._brand(brand_id)
        if brand is None:
            return Response({'error': 'Сорт не найден'}, status=status.HTTP_404_NOT_FOUND)
        context = {'request': request}
        mine = None
        if request.user.is_authenticated:
            mine = Tasting.objects.filter(user=request.user, brand=brand).prefetch_related('notes').first()
        payload = {
            'brand': brand_card(brand, request),
            'palette': FlavorNoteMinimalSerializer(build_palette(brand), many=True, context=context).data,
            'max_notes': Tasting.MAX_NOTES,
            'mine': None,
            'reveal': None,
        }
        if mine is not None:
            payload['mine'] = TastingSerializer(mine, context=context).data
            payload['reveal'] = reveal_for(brand, set(n.id for n in mine.notes.all()), request)
        return Response(payload)

    def put(self, request, brand_id):
        brand = self._brand(brand_id)
        if brand is None:
            return Response({'error': 'Сорт не найден'}, status=status.HTTP_404_NOT_FOUND)
        serializer = TastingInputSerializer(data=request.data)
        if not serializer.is_valid():
            return Response({'errors': serializer.errors}, status=status.HTTP_400_BAD_REQUEST)
        data = serializer.validated_data
        notes = data['notes']
        chosen = set(note.id for note in notes)
        matched = len(chosen & passport.pyramid_note_ids(brand.id))
        user = request.user
        is_new = not Tasting.objects.filter(user=user, brand=brand).exists()
        if is_new and new_tastings_today(user) >= DAILY_NEW_TASTINGS:
            return Response({
                'code': 'daily_limit',
                'error': 'Сегодня в паспорте уже {} новые отметки. Паспорт про вкус, а не про количество: '
                         'следующий сорт отметьте завтра.'.format(DAILY_NEW_TASTINGS),
            }, status=status.HTTP_429_TOO_MANY_REQUESTS)
        before = passport.balance(user)['earned']
        fields = {'rating': data['rating'], 'comment': data['comment'], 'matched': matched}
        if data['venue'] is not None:
            fields['venue'] = data['venue']
        try:
            with transaction.atomic():
                tasting, created = Tasting.objects.update_or_create(user=user, brand=brand, defaults=fields)
                tasting.notes.set(notes)
        except IntegrityError:
            # Двойное нажатие: отметку уже создал соседний запрос, обновляем её.
            tasting = Tasting.objects.get(user=user, brand=brand)
            for key, value in fields.items():
                setattr(tasting, key, value)
            tasting.save()
            tasting.notes.set(notes)
            created = False
        points = passport.balance(user)
        context = {'request': request}
        return Response({
            'tasting': TastingSerializer(tasting, context=context).data,
            'reveal': reveal_for(brand, chosen, request),
            'awarded': max(points['earned'] - before, 0),
            'points': points,
        }, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    def delete(self, request, brand_id):
        Tasting.objects.filter(user=request.user, brand_id=brand_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET'])
@permission_classes([AllowAny])
def brand_guests(request, brand_id):
    """
    GET /api/brands/<id>/guests/ - что слышат гости: сколько отметок, средняя оценка и самые частые ноты.
    Пока отметок меньше MIN_GUESTS, сводка не показывается: по двум голосам выводов не делают.
    """
    brand = Brand.objects.filter(pk=brand_id).first()
    if brand is None:
        return Response({'error': 'Сорт не найден'}, status=status.HTTP_404_NOT_FOUND)
    tastings = Tasting.objects.filter(brand=brand)
    count = tastings.count()
    payload = {'count': count, 'min': MIN_GUESTS, 'enough': count >= MIN_GUESTS, 'rating_avg': None, 'notes': []}
    if count < MIN_GUESTS:
        return Response(payload)
    payload['rating_avg'] = round(tastings.aggregate(avg=Avg('rating'))['avg'] or 0, 1)
    payload['notes'] = heard_notes(brand, count, request)
    return Response(payload)


def heard_notes(brand, count, request, limit=6):
    """Самые частые ноты в отметках гостей: доля гостей и есть ли нота в пирамиде сомелье."""
    rows = (Tasting.notes.through.objects.filter(tasting__brand=brand)
            .values('flavornote_id').annotate(n=Count('id')).order_by('-n', 'flavornote_id')[:limit])
    rows = list(rows)
    notes = {n.id: n for n in FlavorNote.objects.filter(pk__in=[r['flavornote_id'] for r in rows])}
    pyramid = passport.pyramid_note_ids(brand.id)
    result = []
    for row in rows:
        note = notes.get(row['flavornote_id'])
        if note is None:
            continue
        item = FlavorNoteMinimalSerializer(note, context={'request': request}).data
        item['share'] = round(row['n'] * 100 / count)
        item['in_pyramid'] = note.id in pyramid
        result.append(item)
    return result


def feedback_counts(pairing):
    totals = PairingFeedback.objects.filter(pairing=pairing).aggregate(
        likes=Count('id', filter=Q(liked=True)), dislikes=Count('id', filter=Q(liked=False)))
    return {'likes': totals['likes'] or 0, 'dislikes': totals['dislikes'] or 0}


@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
@throttle_classes([FeedbackAnonThrottle, FeedbackUserThrottle])
def pairing_feedback(request, pairing_id):
    """
    GET  /api/pairings/<id>/feedback/?device= - сколько гостей пара устроила и мой голос
    POST /api/pairings/<id>/feedback/ {liked, device?, venue?} - оценить пару. Один голос на гостя,
         повторный запрос меняет голос. Без входа гость узнаётся по случайному идентификатору устройства.
    """
    pairing = FoodPairing.objects.filter(pk=pairing_id).first()
    if pairing is None:
        return Response({'error': 'Пара не найдена'}, status=status.HTTP_404_NOT_FOUND)
    user = request.user if request.user.is_authenticated else None
    source = request.query_params if request.method == 'GET' else request.data
    source = source if hasattr(source, 'get') else {}
    device = str(source.get('device') or '').strip()
    if device and not DEVICE_RE.match(device):
        device = ''

    def mine():
        if user is not None:
            row = PairingFeedback.objects.filter(pairing=pairing, user=user).first()
        elif device:
            row = PairingFeedback.objects.filter(pairing=pairing, user__isnull=True, device=device).first()
        else:
            row = None
        return row

    if request.method == 'GET':
        row = mine()
        return Response({**feedback_counts(pairing), 'mine': row.liked if row else None})

    liked = source.get('liked')
    if not isinstance(liked, bool):
        return Response({'errors': {'liked': ['Ожидается true или false']}}, status=status.HTTP_400_BAD_REQUEST)
    if user is None and not device:
        return Response({'errors': {'device': ['Нужен идентификатор устройства']}}, status=status.HTTP_400_BAD_REQUEST)
    venue = find_venue(str(source.get('venue') or '').strip()) if source.get('venue') else None
    before = passport.balance(user)['earned'] if user is not None else 0
    key = {'pairing': pairing, 'user': user} if user is not None else {'pairing': pairing, 'user': None, 'device': device}
    defaults = {'liked': liked}
    if venue is not None:
        defaults['venue'] = venue
    try:
        with transaction.atomic():
            PairingFeedback.objects.update_or_create(defaults=defaults, **key)
    except IntegrityError:
        PairingFeedback.objects.filter(**key).update(liked=liked)
    payload = {**feedback_counts(pairing), 'mine': liked, 'awarded': 0}
    if user is not None:
        points = passport.balance(user)
        payload['awarded'] = max(points['earned'] - before, 0)
        payload['points'] = points
    return Response(payload)


# Награды

def own_venue(user):
    return Venue.objects.filter(owner=user).first()


class RewardViewSet(viewsets.ModelViewSet):
    """
    GET    /api/rewards/?venue=<slug>  - доступные награды: общие и этого заведения (без входа)
    GET    /api/rewards/?manage=1      - для панели: все награды своего заведения (модератору все), с выключенными
    POST   /api/rewards/               - новая награда (администратор заведения: только своя; модератор: любая)
    PATCH  /api/rewards/<id>/, DELETE  - правка и удаление
    POST   /api/rewards/<id>/redeem/   - обменять баллы на код (пользователь)
    """
    queryset = Reward.objects.select_related('venue')
    serializer_class = RewardSerializer
    pagination_class = None
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def get_permissions(self):
        if self.action in ('list', 'retrieve'):
            return [AllowAny()]
        return [IsAuthenticated()]

    def _can_manage(self, user):
        return has_role(user, ROLE_RESTAURANT)

    def get_queryset(self):
        queryset = super().get_queryset()
        request = self.request
        user = request.user
        if self.action == 'list' and request.query_params.get('manage'):
            if not (user.is_authenticated and self._can_manage(user)):
                raise PermissionDenied('Награды ведут администратор заведения и модератор')
            if has_role(user, ROLE_MODERATOR):
                return queryset
            return queryset.filter(venue__owner=user)
        if self.action in ('list', 'retrieve', 'redeem'):
            queryset = queryset.filter(is_active=True).filter(Q(venue__isnull=True) | Q(venue__is_published=True))
            raw = (request.query_params.get('venue') or '').strip()
            if raw and self.action == 'list':
                venue = find_venue(raw)
                queryset = queryset.filter(Q(venue__isnull=True) | Q(venue=venue)) if venue else queryset.filter(venue__isnull=True)
            return queryset
        return queryset

    def _check_manage(self, reward=None):
        user = self.request.user
        if not self._can_manage(user):
            raise PermissionDenied('Награды ведут администратор заведения и модератор')
        if reward is not None and not has_role(user, ROLE_MODERATOR):
            if reward.venue_id is None or reward.venue.owner_id != user.id:
                raise PermissionDenied('Это награда другого заведения')

    def create(self, request, *args, **kwargs):
        self._check_manage()
        return super().create(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        self._check_manage(self.get_object())
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        self._check_manage(self.get_object())
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=['post'])
    def redeem(self, request, pk=None):
        user = request.user
        reward_id = parse_uuid(pk)
        with transaction.atomic():
            reward = self.get_queryset().select_for_update(of=('self',)).filter(pk=reward_id).first() if reward_id else None
            if reward is None:
                return Response({'error': 'Награда не найдена или уже недоступна'}, status=status.HTTP_404_NOT_FOUND)
            # Строка пользователя под замком: два запроса подряд не потратят одни и те же баллы.
            User.objects.select_for_update().get(pk=user.pk)
            existing = Redemption.objects.filter(user=user, reward=reward, status=Redemption.STATUS_ISSUED).first()
            if existing is not None:
                return Response({'redemption': RedemptionSerializer(existing).data, 'points': passport.balance(user)})
            if reward.stock is not None and reward.stock <= 0:
                return Response({'error': 'Эта награда закончилась'}, status=status.HTTP_400_BAD_REQUEST)
            points = passport.balance(user)
            if points['balance'] < reward.cost:
                return Response({'error': 'Не хватает баллов: нужно ещё {}'.format(reward.cost - points['balance'])},
                                status=status.HTTP_400_BAD_REQUEST)
            redemption = Redemption.objects.create(
                user=user, reward=reward, venue=reward.venue, title=reward.title, cost=reward.cost, code=new_code())
            if reward.stock is not None:
                Reward.objects.filter(pk=reward.pk).update(stock=F('stock') - 1)
        return Response({'redemption': RedemptionSerializer(redemption).data, 'points': passport.balance(user)},
                        status=status.HTTP_201_CREATED)


def new_code():
    """Короткий код награды без похожих символов (0 и O, 1 и I)."""
    for _ in range(20):
        code = ''.join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
        if not Redemption.objects.filter(code=code).exists():
            return code
    return secrets.token_hex(4).upper()


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def redemptions(request):
    """GET /api/redemptions/ - мои коды наград, новые сверху."""
    rows = Redemption.objects.filter(user=request.user).select_related('venue', 'reward')[:50]
    return Response(RedemptionSerializer(rows, many=True).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def redemption_cancel(request, pk):
    """POST /api/redemptions/<id>/cancel/ - вернуть баллы, пока награда не получена."""
    with transaction.atomic():
        row = Redemption.objects.select_for_update().filter(pk=pk, user=request.user).first()
        if row is None:
            return Response({'error': 'Код не найден'}, status=status.HTTP_404_NOT_FOUND)
        if row.status != Redemption.STATUS_ISSUED:
            return Response({'error': 'Эту награду уже нельзя отменить'}, status=status.HTTP_409_CONFLICT)
        row.status = Redemption.STATUS_CANCELLED
        row.save(update_fields=['status'])
        if row.reward_id:
            Reward.objects.filter(pk=row.reward_id, stock__isnull=False).update(stock=F('stock') + 1)
    return Response({'redemption': RedemptionSerializer(row).data, 'points': passport.balance(request.user)})


def staff_venue_filter(user):
    """Какие обмены видит сотрудник: модератор все, администратор только своего заведения."""
    if has_role(user, ROLE_MODERATOR):
        return Q()
    return Q(venue__owner=user)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def redemption_use(request):
    """POST /api/redemptions/use/ {code} - сотрудник выдал награду по коду гостя."""
    user = request.user
    if not has_role(user, ROLE_RESTAURANT):
        raise PermissionDenied('Выдавать награды может администратор заведения или модератор')
    code = str((request.data.get('code') if hasattr(request.data, 'get') else '') or '').strip().upper().replace(' ', '')
    if not code:
        return Response({'errors': {'code': ['Введите код гостя']}}, status=status.HTTP_400_BAD_REQUEST)
    with transaction.atomic():
        row = Redemption.objects.select_for_update(of=('self',)).select_related('venue', 'user', 'reward').filter(code=code).first()
        if row is None:
            return Response({'error': 'Такого кода нет. Проверьте буквы и цифры'}, status=status.HTTP_404_NOT_FOUND)
        if not has_role(user, ROLE_MODERATOR) and (row.venue_id is None or row.venue.owner_id != user.id):
            return Response({'error': 'Этот код выдан для другого заведения'}, status=status.HTTP_403_FORBIDDEN)
        if row.status == Redemption.STATUS_USED:
            return Response({'error': 'Награда по этому коду уже выдана'}, status=status.HTTP_409_CONFLICT)
        if row.status == Redemption.STATUS_CANCELLED:
            return Response({'error': 'Гость отменил этот код'}, status=status.HTTP_409_CONFLICT)
        row.status = Redemption.STATUS_USED
        row.used_at = timezone.now()
        row.used_by = user
        row.save(update_fields=['status', 'used_at', 'used_by'])
    return Response({'redemption': StaffRedemptionSerializer(row).data})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def redemptions_staff(request):
    """GET /api/redemptions/staff/ - последние обмены по наградам заведения (для панели)."""
    user = request.user
    if not has_role(user, ROLE_RESTAURANT):
        raise PermissionDenied('Раздел доступен администратору заведения и модератору')
    rows = (Redemption.objects.filter(staff_venue_filter(user))
            .select_related('venue', 'user', 'reward')[:50])
    return Response(StaffRedemptionSerializer(rows, many=True).data)

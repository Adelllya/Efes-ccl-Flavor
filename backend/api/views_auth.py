"""
Вход, регистрация, профиль и управление пользователями (для модератора).
Токен DRF выдаётся при входе и регистрации. Выход на одном устройстве токен не трогает
(иначе вылетят остальные устройства этого аккаунта, например планшет бара),
выход на всех устройствах и смена пароля его отзывают.
"""
import uuid

from django.contrib.auth import authenticate
from django.contrib.auth.models import Group, User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .authentication import token_expired
from .models import Venue
from .permissions import ALL_ROLES, GROUP_ROLES, ROLE_MODERATOR, ROLE_USER, IsModerator
from .serializers import UserSerializer, RegisterSerializer, ProfileUpdateSerializer
from .throttles import LoginThrottle, PasswordChangeThrottle, RegisterThrottle

LOGIN_ERROR = 'Неверный логин или пароль'


def auth_payload(user, token):
    return {'token': token.key, 'user': UserSerializer(user).data}


def _user_queryset():
    return User.objects.prefetch_related('groups', 'venues')


def _token_for(user):
    """Токен пользователя; просроченный заменяется новым."""
    token, created = Token.objects.get_or_create(user=user)
    if not created and token_expired(token):
        token.delete()
        token = Token.objects.create(user=user)
    return token


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([RegisterThrottle])
def register(request):
    """POST /api/auth/register/ {username, email, password, first_name?} -> 201 {token, user}."""
    serializer = RegisterSerializer(data=request.data)
    if not serializer.is_valid():
        return Response({'errors': serializer.errors}, status=status.HTTP_400_BAD_REQUEST)
    user = serializer.save()
    token, _ = Token.objects.get_or_create(user=user)
    return Response(auth_payload(user, token), status=status.HTTP_201_CREATED)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([LoginThrottle])
def login(request):
    """POST /api/auth/login/ {username, password} -> {token, user}. В username можно передать почту."""
    username = str(request.data.get('username') or '').strip()
    password = str(request.data.get('password') or '')
    if not username or not password:
        return Response({'detail': LOGIN_ERROR}, status=status.HTTP_400_BAD_REQUEST)

    user = authenticate(request, username=username, password=password)
    if user is None and '@' in username:
        by_email = User.objects.filter(email__iexact=username).order_by('id').first()
        if by_email is not None:
            user = authenticate(request, username=by_email.username, password=password)

    if user is None or not user.is_active:
        return Response({'detail': LOGIN_ERROR}, status=status.HTTP_400_BAD_REQUEST)

    token = _token_for(user)
    user = _user_queryset().get(pk=user.pk)
    return Response(auth_payload(user, token))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout(request):
    """
    POST /api/auth/logout/ -> 204. Фронт забывает токен, другие устройства остаются в системе.
    POST /api/auth/logout/ {everywhere: true} -> 204, токен отзывается на всех устройствах.
    """
    data = request.data if isinstance(request.data, dict) else {}
    if _parse_bool(data.get('everywhere', False)):
        Token.objects.filter(user=request.user).delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def me(request):
    """GET /api/auth/me/ -> объект пользователя. PATCH {first_name?, email?}."""
    user = _user_queryset().get(pk=request.user.pk)
    if request.method == 'PATCH':
        serializer = ProfileUpdateSerializer(user, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response({'errors': serializer.errors}, status=status.HTTP_400_BAD_REQUEST)
        serializer.save()
    return Response(UserSerializer(user).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([PasswordChangeThrottle])
def change_password(request):
    """POST /api/auth/change-password/ {old_password, new_password} -> {token} (новый токен)."""
    user = request.user
    old_password = str(request.data.get('old_password') or '')
    new_password = str(request.data.get('new_password') or '')

    errors = {}
    if not user.check_password(old_password):
        errors['old_password'] = ['Неверный текущий пароль']
    if not new_password:
        errors['new_password'] = ['Введите новый пароль']
    else:
        try:
            validate_password(new_password, user=user)
        except DjangoValidationError as exc:
            errors['new_password'] = list(exc.messages)
    if errors:
        return Response({'errors': errors}, status=status.HTTP_400_BAD_REQUEST)

    user.set_password(new_password)
    user.save(update_fields=['password'])
    # Старый токен больше не действует, выдаём новый.
    Token.objects.filter(user=user).delete()
    token = Token.objects.create(user=user)
    return Response({'token': token.key})


@api_view(['GET'])
@permission_classes([IsModerator])
def users_list(request):
    """GET /api/auth/users/ -> все пользователи без пагинации (модератор)."""
    users = _user_queryset().order_by('username')
    return Response(UserSerializer(users, many=True).data)


def _set_role(user, role):
    groups = {g.name: g for g in Group.objects.filter(name__in=GROUP_ROLES)}
    user.groups.remove(*[g for g in groups.values()])
    if role != ROLE_USER:
        group = groups.get(role) or Group.objects.get_or_create(name=role)[0]
        user.groups.add(group)


def _resolve_venue(raw_venue):
    """Заведение из тела запроса: None (снять), объект Venue или словарь ошибок."""
    if raw_venue in (None, ''):
        return None, None
    try:
        venue_id = uuid.UUID(str(raw_venue))
    except ValueError:
        return None, {'venue': ['Некорректный идентификатор заведения']}
    venue = Venue.objects.filter(pk=venue_id).first()
    if venue is None:
        return None, {'venue': ['Заведение не найдено']}
    return venue, None


def _set_venue(user, venue):
    """Пользователь владеет одним заведением. Другие его заведения снимаются только при смене."""
    if venue is None:
        Venue.objects.filter(owner=user).update(owner=None)
        return
    if venue.owner_id != user.id:
        Venue.objects.filter(owner=user).exclude(pk=venue.pk).update(owner=None)
        venue.owner = user
        venue.save(update_fields=['owner'])


def _parse_bool(value):
    if isinstance(value, str):
        return value.lower() in ('true', '1', 'yes')
    return bool(value)


@api_view(['PATCH'])
@permission_classes([IsModerator])
def user_update(request, id):
    """
    PATCH /api/auth/users/<id>/ {role?, venue?, is_active?} -> объект пользователя (модератор).
    Сначала проверяем всё, потом пишем одной транзакцией: при ошибке ничего не меняется.
    """
    user = get_object_or_404(User, pk=id)
    data = request.data
    is_self = user.pk == request.user.pk

    if user.is_superuser and not request.user.is_superuser:
        return Response({'detail': 'Суперпользователя может менять только суперпользователь'},
                        status=status.HTTP_400_BAD_REQUEST)

    role = None
    if 'role' in data:
        role = data.get('role')
        if role not in ALL_ROLES:
            return Response({'errors': {'role': ['Неизвестная роль']}}, status=status.HTTP_400_BAD_REQUEST)
        if is_self and role != ROLE_MODERATOR:
            return Response({'detail': 'Нельзя понизить собственную роль'}, status=status.HTTP_400_BAD_REQUEST)
        if user.is_superuser and role != ROLE_MODERATOR:
            return Response({'detail': 'Роль суперпользователя изменить нельзя'}, status=status.HTTP_400_BAD_REQUEST)

    is_active = None
    if 'is_active' in data:
        is_active = _parse_bool(data.get('is_active'))
        if is_self and not is_active:
            return Response({'detail': 'Нельзя отключить собственный аккаунт'}, status=status.HTTP_400_BAD_REQUEST)

    venue = None
    if 'venue' in data:
        venue, errors = _resolve_venue(data.get('venue'))
        if errors:
            return Response({'errors': errors}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        if role is not None:
            _set_role(user, role)
        if is_active is not None:
            user.is_active = is_active
            user.save(update_fields=['is_active'])
            if not is_active:
                Token.objects.filter(user=user).delete()
        if 'venue' in data:
            _set_venue(user, venue)

    user = _user_queryset().get(pk=user.pk)
    return Response(UserSerializer(user).data)

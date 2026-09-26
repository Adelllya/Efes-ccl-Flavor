"""
Роли проекта живут в группах Django. Суперпользователь всегда считается модератором.
"""
from rest_framework.permissions import BasePermission, SAFE_METHODS

ROLE_USER = 'user'
ROLE_SOMMELIER = 'sommelier'
ROLE_RESTAURANT = 'restaurant_admin'
ROLE_MODERATOR = 'moderator'

GROUP_ROLES = (ROLE_SOMMELIER, ROLE_RESTAURANT, ROLE_MODERATOR)
ALL_ROLES = (ROLE_USER,) + GROUP_ROLES

ROLE_LABELS = {
    ROLE_USER: 'Пользователь',
    ROLE_SOMMELIER: 'Сомелье',
    ROLE_RESTAURANT: 'Администратор заведения',
    ROLE_MODERATOR: 'Модератор',
}


def user_role(user):
    """Роль пользователя: None для анонима, иначе одно из четырёх имён."""
    if user is None or not getattr(user, 'is_authenticated', False):
        return None
    if user.is_superuser:
        return ROLE_MODERATOR
    # groups.all() берёт данные из prefetch, если он был.
    names = set(g.name for g in user.groups.all())
    # Если пользователь состоит в нескольких группах, побеждает старшая роль.
    for role in reversed(GROUP_ROLES):
        if role in names:
            return role
    return ROLE_USER


def has_role(user, *roles):
    """Модератор проходит любую проверку; остальным нужна одна из перечисленных ролей."""
    role = user_role(user)
    if role is None:
        return False
    if role == ROLE_MODERATOR:
        return True
    return role in roles


class ReadOnlyOrRoles(BasePermission):
    """Чтение открыто всем, запись только перечисленным ролям (и модератору)."""
    roles = ()

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        return has_role(request.user, *self.roles)


class ReadOnlyOrModerator(ReadOnlyOrRoles):
    roles = (ROLE_MODERATOR,)


class ReadOnlyOrSommelier(ReadOnlyOrRoles):
    roles = (ROLE_SOMMELIER,)


class ReadOnlyOrRestaurant(ReadOnlyOrRoles):
    roles = (ROLE_RESTAURANT,)


def roles_required(*roles):
    """Фабрика permission-класса для function views и @permission_classes."""
    class RolesRequired(BasePermission):
        required_roles = roles

        def has_permission(self, request, view):
            return has_role(request.user, *self.required_roles)

    RolesRequired.__name__ = 'RolesRequired_' + '_'.join(roles or ('moderator',))
    return RolesRequired


IsModerator = roles_required(ROLE_MODERATOR)
IsSommelierOrModerator = roles_required(ROLE_SOMMELIER)
IsRestaurantOrModerator = roles_required(ROLE_RESTAURANT)


class IsOwnerOfVenueOrModerator(BasePermission):
    """
    Объектная проверка: заведение принадлежит пользователю (obj.owner или obj.venue.owner)
    либо пользователь модератор. Чтение не ограничивает.
    """

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True
        user = request.user
        if not getattr(user, 'is_authenticated', False):
            return False
        if has_role(user, ROLE_MODERATOR):
            return True
        venue = obj if hasattr(obj, 'owner_id') else getattr(obj, 'venue', None)
        if venue is None:
            return False
        return venue.owner_id == user.id

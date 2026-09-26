"""
Заказы гостей. Гость оформляет заказ без входа и следит за ним по guest_token,
заведение (владелец или модератор) видит свои заказы и ведёт их по статусам.
"""
import secrets

from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import Order, Venue
from .permissions import ROLE_MODERATOR, has_role, IsOwnerOfVenueOrModerator
from .pilot import record_order_event
from .serializers import OrderCreateSerializer, OrderSerializer, parse_uuid
from .throttles import OrderCreateThrottle


def find_venue(value):
    venue_id = parse_uuid(value)
    if venue_id:
        return Venue.objects.filter(pk=venue_id).first()
    return Venue.objects.filter(slug=value).first()


class OrderViewSet(mixins.CreateModelMixin, mixins.RetrieveModelMixin, mixins.ListModelMixin,
                   mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """
    POST  /api/orders/                   - гость: новый заказ (без входа); session, age_confirmed,
                                           у позиций source (MENU, PAIRING, AI), paired_with, rank
    GET   /api/orders/<id>/?token=       - гость: свой заказ по токену; владелец и модератор - без токена
    GET   /api/orders/?venue=&status=    - владелец или модератор: заказы заведения, новые сверху
    PATCH /api/orders/<id>/  {status}    - владелец или модератор: следующий статус или отмена
    GET   /api/orders/new-count/?venue=  - владелец или модератор: {count} новых заказов;
                                           без ?venue= владелец получает свои заведения, модератор все
    """
    queryset = Order.objects.select_related('venue').prefetch_related('items')
    serializer_class = OrderSerializer
    pagination_class = None
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_permissions(self):
        if self.action in ('create', 'retrieve'):
            return [AllowAny()]
        if self.action == 'partial_update':
            return [IsAuthenticated(), IsOwnerOfVenueOrModerator()]
        return [IsAuthenticated()]

    def get_throttles(self):
        # Лимит только на новые заказы: панель заведения опрашивает список часто.
        if self.action == 'create':
            return [OrderCreateThrottle()]
        return super().get_throttles()

    def _venue_from_query(self, request):
        """Заведение из ?venue=. Чужое заведение для владельца - 403."""
        raw = (request.query_params.get('venue') or '').strip()
        if not raw:
            return None
        venue = find_venue(raw)
        if venue is None:
            raise ValidationError({'venue': ['Заведение не найдено']})
        if not (has_role(request.user, ROLE_MODERATOR) or venue.owner_id == request.user.id):
            raise PermissionDenied('Это заведение вам не принадлежит')
        return venue

    def _owned_orders(self, request):
        queryset = self.get_queryset()
        venue = self._venue_from_query(request)
        if venue is not None:
            return queryset.filter(venue=venue)
        if has_role(request.user, ROLE_MODERATOR):
            return queryset
        return queryset.filter(venue__owner=request.user)

    def create(self, request, *args, **kwargs):
        serializer = OrderCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        order = serializer.save()
        # Событие для отчёта пилота: стол, сессия гостя и откуда каждая позиция. Сбой записи заказ не ломает.
        record_order_event(order)
        return Response(self.get_serializer(order).data, status=status.HTTP_201_CREATED)

    def retrieve(self, request, *args, **kwargs):
        order = get_object_or_404(self.get_queryset(), pk=kwargs.get('pk'))
        token = (request.query_params.get('token') or '').strip()
        allowed = bool(token) and secrets.compare_digest(token.encode(), order.guest_token.encode())
        if not allowed:
            user = request.user
            allowed = user.is_authenticated and (
                has_role(user, ROLE_MODERATOR) or order.venue.owner_id == user.id)
        if not allowed:
            raise PermissionDenied('Неверный токен заказа')
        return Response(self.get_serializer(order).data)

    def list(self, request, *args, **kwargs):
        queryset = self._owned_orders(request)
        # ?status=NEW или несколько через запятую: ?status=ACCEPTED,COOKING,SERVED
        statuses = [s.strip().upper() for s in (request.query_params.get('status') or '').split(',') if s.strip()]
        if statuses:
            queryset = queryset.filter(status__in=statuses)
        return Response(self.get_serializer(queryset, many=True).data)

    def partial_update(self, request, *args, **kwargs):
        order = self.get_object()
        labels = dict(Order.STATUS_CHOICES)
        new_status = str(request.data.get('status') or '').strip().upper()
        if new_status not in labels:
            raise ValidationError({'status': ['Неизвестный статус']})
        if not Order.can_transition(order.status, new_status):
            raise ValidationError({'status': [
                'Нельзя перевести заказ из «{}» в «{}»'.format(order.get_status_display(), labels[new_status])]})
        order.status = new_status
        order.save(update_fields=['status', 'updated_at'])
        return Response(self.get_serializer(order).data)

    @action(detail=False, methods=['get'], url_path='new-count')
    def new_count(self, request):
        count = self._owned_orders(request).filter(status=Order.STATUS_NEW).count()
        return Response({'count': count})

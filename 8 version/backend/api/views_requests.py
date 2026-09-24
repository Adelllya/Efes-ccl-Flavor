"""
Запросы сомелье на изменение сорта. Сомелье не правит пирамиду и подачу напрямую:
он отправляет запрос, модератор подтверждает (и тогда данные меняются) или отклоняет.
"""
from django.db import transaction
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from .models import ChangeRequest, FlavorNote, FlavorProfile, ServingRecommendation
from .permissions import ROLE_MODERATOR, has_role, IsModerator, IsSommelierOrModerator
from .serializers import ChangeRequestSerializer, parse_uuid
from .views import pyramid_payload

ALREADY_REVIEWED = 'Запрос уже рассмотрен'


def apply_change(req):
    """Переносит запрос в живые данные. Возвращает текст ошибки, если применить нельзя."""
    payload = req.payload or {}
    if req.kind in (ChangeRequest.KIND_NOTE_UPSERT, ChangeRequest.KIND_NOTE_DELETE):
        note_id = parse_uuid(payload.get('flavor_note_id'))
        note = FlavorNote.objects.filter(pk=note_id).first() if note_id else None
        if note is None:
            return 'Нота не найдена, запрос применить нельзя'
        if req.kind == ChangeRequest.KIND_NOTE_DELETE:
            FlavorProfile.objects.filter(brand=req.brand, flavor_note=note).delete()
            return None
        try:
            intensity = int(payload.get('intensity'))
        except (TypeError, ValueError):
            return 'В запросе нет интенсивности'
        layer = payload.get('layer') if payload.get('layer') in ('TOP', 'HEART', 'BASE') else note.category
        FlavorProfile.objects.update_or_create(
            brand=req.brand, flavor_note=note,
            defaults={
                'layer': layer,
                'intensity': max(1, min(10, intensity)),
                'sommelier_note': str(payload.get('sommelier_note') or ''),
                'sommelier_name': req.author.get_full_name() or req.author.username,
            },
        )
        return None
    if req.kind == ChangeRequest.KIND_SERVING:
        try:
            temp_min = float(payload.get('serving_temp_min'))
            temp_max = float(payload.get('serving_temp_max'))
        except (TypeError, ValueError):
            return 'В запросе нет температуры подачи'
        ServingRecommendation.objects.update_or_create(
            brand=req.brand,
            defaults={
                'serving_temp_min': temp_min,
                'serving_temp_max': temp_max,
                'glass_type': str(payload.get('glass_type') or '')[:100],
                'seasonality': str(payload.get('seasonality') or '')[:100],
            },
        )
        return None
    return 'Неизвестный тип запроса'


class ChangeRequestViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin,
                           mixins.CreateModelMixin, mixins.DestroyModelMixin,
                           viewsets.GenericViewSet):
    """
    GET    /api/change-requests/?status=&brand=   - сомелье видит свои, модератор все
    POST   /api/change-requests/                  - создать запрос (сомелье или модератор)
    DELETE /api/change-requests/<id>/             - автор, пока запрос ожидает, или модератор
    POST   /api/change-requests/<id>/approve/     - модератор: применить и принять
    POST   /api/change-requests/<id>/reject/      - модератор: отклонить {review_comment}
    GET    /api/change-requests/pending-count/    - модератор: {count} для бейджа
    """
    serializer_class = ChangeRequestSerializer
    pagination_class = None
    permission_classes = [IsSommelierOrModerator]

    def get_queryset(self):
        queryset = ChangeRequest.objects.select_related('author', 'reviewer', 'brand')
        user = self.request.user
        if not has_role(user, ROLE_MODERATOR):
            queryset = queryset.filter(author=user)
        params = self.request.query_params
        status_param = (params.get('status') or '').strip().upper()
        if status_param:
            queryset = queryset.filter(status=status_param)
        brand = (params.get('brand') or '').strip()
        if brand:
            brand_id = parse_uuid(brand)
            queryset = queryset.filter(brand_id=brand_id) if brand_id else queryset.none()
        return queryset

    def perform_create(self, serializer):
        serializer.save(author=self.request.user)

    def perform_destroy(self, instance):
        user = self.request.user
        if not has_role(user, ROLE_MODERATOR):
            if instance.author_id != user.id:
                raise PermissionDenied('Это не ваш запрос')
            if instance.status != ChangeRequest.STATUS_PENDING:
                raise PermissionDenied('Рассмотренный запрос отозвать нельзя')
        instance.delete()

    def _finish(self, req, request, new_status):
        req.status = new_status
        req.reviewer = request.user
        req.reviewed_at = timezone.now()
        req.review_comment = str(request.data.get('review_comment') or '').strip()
        req.save(update_fields=['status', 'reviewer', 'reviewed_at', 'review_comment'])

    @action(detail=True, methods=['post'], permission_classes=[IsModerator])
    def approve(self, request, pk=None):
        req = self.get_object()
        if req.status != ChangeRequest.STATUS_PENDING:
            return Response({'detail': ALREADY_REVIEWED}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            error = apply_change(req)
            if error:
                return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)
            self._finish(req, request, ChangeRequest.STATUS_APPROVED)
        data = self.get_serializer(req).data
        data['pyramid'] = pyramid_payload(req.brand, request)
        return Response(data)

    @action(detail=True, methods=['post'], permission_classes=[IsModerator])
    def reject(self, request, pk=None):
        req = self.get_object()
        if req.status != ChangeRequest.STATUS_PENDING:
            return Response({'detail': ALREADY_REVIEWED}, status=status.HTTP_400_BAD_REQUEST)
        self._finish(req, request, ChangeRequest.STATUS_REJECTED)
        return Response(self.get_serializer(req).data)

    @action(detail=False, methods=['get'], url_path='pending-count', permission_classes=[IsModerator])
    def pending_count(self, request):
        count = ChangeRequest.objects.filter(status=ChangeRequest.STATUS_PENDING).count()
        return Response({'count': count})

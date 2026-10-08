"""Админ-эндпоинты подкрутки весов движка подбора.

GET  /api/v2/tuning/         — крутилки с базовым и текущим значением, версия.
POST /api/v2/tuning/save/    — {overrides: {путь: число}} сохранить (санитизация + диапазоны).
POST /api/v2/tuning/reset/   — сбросить к базовым (пустой overrides).

Права: только сомелье и модератор (админ-конфигурация, не публичные данные).
"""
from __future__ import annotations

from django.conf import settings
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from . import engine_tuning
from .permissions import IsSommelierOrModerator


def _data_dir():
    return str(getattr(settings, "FLAVOR_DATA_DIR", "")) or None


@api_view(["GET"])
@permission_classes([IsSommelierOrModerator])
def tuning_state(request):
    return Response(engine_tuning.knobs_state(_data_dir()))


@api_view(["POST"])
@permission_classes([IsSommelierOrModerator])
def tuning_save(request):
    body = request.data if isinstance(request.data, dict) else {}
    overrides = body.get("overrides")
    if not isinstance(overrides, dict):
        return Response({"detail": "overrides должен быть объектом вида {путь: число}"}, status=400)
    engine_tuning.save_overrides(overrides, getattr(request.user, "username", ""))
    return Response(engine_tuning.knobs_state(_data_dir()))


@api_view(["POST"])
@permission_classes([IsSommelierOrModerator])
def tuning_reset(request):
    engine_tuning.reset(getattr(request.user, "username", ""))
    return Response(engine_tuning.knobs_state(_data_dir()))

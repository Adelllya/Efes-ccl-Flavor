"""Flavor Tree Pairing Engine — детерминированный, объяснимый алгоритм подбора пива к еде.

Чистый Python без Django: используется и API-эндпоинтами, и тестами, и CLI.
Точная копия алгоритма живёт во фронтенде (frontend/src/app/engine/pairing-engine.ts),
паритет проверяется golden-тестом (scripts/engine_golden.py + npm run test:engine).
"""
from .engine import (  # noqa: F401
    BEER_AXES, DISH_AXES, ARCHETYPES,
    build_beer_profile, build_dish_profile, score_pair, recommend_beers,
    recommend_dishes, dna_vector, dna_archetype, similar_beers, verdict_label,
)

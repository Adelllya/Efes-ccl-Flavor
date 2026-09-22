"""API движка подбора, Flavor DNA и HoReCa (QR-вход).

POST /api/pairing/recommend/      {dish_id | dish: {...}, context, limit, venue, diversify}
GET  /api/pairing/dish/<slug>/     ?occasion=hot&limit=5&venue=<slug>
GET  /api/pairing/beer/<slug>/dishes/
POST /api/pairing/explain/        {beer_id, dish_id, context}
GET  /api/engine/meta/
POST /api/dna/                    {ratings: [{beer_id, rating}]}
GET  /api/venues/                 GET /api/venues/<slug>/
GET  /api/qr/<token>/             (scans_count += 1)
POST /api/qr/generate/            {venue: <slug>, tables: 12}
"""
from __future__ import annotations

from django.db.models import F
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import Venue, QRCode
from .pairing.adapters import EngineContext
from .pairing.engine import (
    ARCHETYPES, BEER_AXES, DISH_AXES, build_dish_profile, score_pair, recommend_beers,
    recommend_dishes, dna_vector, dna_archetype, similar_beers, SCORE_BASE, SCORE_K,
)

ENGINE_VERSION = "1.0"

RULES_DOC = [
    {"rule": "intensity", "name": "Интенсивность", "range": "-15…+22", "text": "Сила пива должна совпадать с силой блюда"},
    {"rule": "cut", "name": "Очищение", "range": "0…+20", "text": "Жир и тяжесть × (горечь + карбонизация)"},
    {"rule": "heat", "name": "Острота", "range": "-15…+20", "text": "Острое любит солод и пузырьки, не любит хмель и алкоголь"},
    {"rule": "salt", "name": "Соль", "range": "0…+15", "text": "Соль смягчает горечь; солёная закуска — классика к пиву"},
    {"rule": "sweet", "name": "Сладость", "range": "-18…+25", "text": "Десерт не должен быть слаще пива"},
    {"rule": "sour", "name": "Кислота", "range": "-10…+14", "text": "Кислое → чистые, игристые, лёгкие сорта"},
    {"rule": "umami", "name": "Умами", "range": "-6…+16", "text": "Умами дружит с солодом и телом; деликатное умами — не с хмелем"},
    {"rule": "fresh", "name": "Деликатность", "range": "-12…+14", "text": "Сырое и свежее → чистота и лёгкость"},
    {"rule": "roast", "name": "Корочка", "range": "0…+12", "text": "Реакция Майяра и дым ↔ карамель, обжарка, солод"},
    {"rule": "smoke", "name": "Дым ↔ хмель", "range": "0…+6", "text": "Смолистый хмель вторит дымку гриля"},
    {"rule": "bridge", "name": "Мост", "range": "0…+18", "text": "Общие ароматические теги пива и блюда"},
    {"rule": "curated", "name": "Сомелье", "range": "-16…+16", "text": "Вердикт сомелье из кураторской матрицы"},
    {"rule": "occasion", "name": "Повод", "range": "-8…+10", "text": "Жара / вечер / компания / гастро-вечер"},
    {"rule": "bitter_pref", "name": "Горечь", "range": "-8…+8", "text": "Личное отношение к горечи"},
    {"rule": "dna", "name": "Flavor DNA", "range": "-8…+8", "text": "Близость к личному профилю вкуса"},
]


def _ctx_from(data) -> dict:
    ctx = {}
    occ = data.get("occasion")
    if occ in ("hot", "evening", "party", "gourmet"):
        ctx["occasion"] = occ
    try:
        bp = float(data.get("bitter_pref") or 0)
        if bp:
            ctx["bitter_pref"] = max(-1.0, min(1.0, bp))
    except (TypeError, ValueError):
        pass
    dna = data.get("dna")
    if isinstance(dna, dict):
        ctx["dna"] = {a: float(dna.get(a, 0)) for a in BEER_AXES}
    return ctx


def _venue_brand_ids(venue_slug):
    if not venue_slug:
        return None
    venue = Venue.objects.filter(slug=venue_slug).first()
    if not venue:
        return None
    return [b.slug or str(b.id) for b in venue.brands.all()]


def _enrich(engine: EngineContext, result: dict) -> dict:
    beer = engine.beer_by_id.get(result["beer_id"])
    dish = engine.dish_by_id.get(result["dish_id"])
    out = dict(result)
    if beer:
        out["beer"] = {k: v for k, v in beer["brand"].items() if k != "pyramid"}
        out["beer_vector"] = beer["vector"]
    if dish:
        out["dish"] = {k: v for k, v in dish["dish"].items() if k not in ("vector",)}
        out["dish_vector"] = dish["vector"]
    return out


@api_view(["GET"])
def engine_meta(request):
    return Response({
        "version": ENGINE_VERSION, "score": {"base": SCORE_BASE, "k": SCORE_K, "range": [3, 99]},
        "beer_axes": BEER_AXES, "dish_axes": DISH_AXES, "rules": RULES_DOC, "archetypes": ARCHETYPES,
    })


@api_view(["POST"])
def pairing_recommend(request):
    data = request.data or {}
    engine = EngineContext(request)
    ctx = _ctx_from(data.get("context") or data)
    limit = int(data.get("limit") or 5)
    diversify = bool(data.get("diversify", True))
    if data.get("dish_id"):
        dish = engine.find_dish(str(data["dish_id"]))
        if not dish:
            return Response({"error": "dish not found"}, status=status.HTTP_404_NOT_FOUND)
    elif isinstance(data.get("dish"), dict):
        spec = data["dish"]
        vec = {a: float((spec.get("vector") or {}).get(a, 0)) for a in DISH_AXES}
        dish = build_dish_profile({"id": spec.get("id", "custom"), "name": spec.get("name", "Ваше блюдо"),
                                   "vector": vec, "tags": spec.get("tags") or []})
    else:
        return Response({"error": "dish_id or dish required"}, status=status.HTTP_400_BAD_REQUEST)
    available = _venue_brand_ids(data.get("venue"))
    results = recommend_beers(dish, engine.beers, engine.curated_index, ctx, limit, available, diversify)
    return Response({"dish": {k: v for k, v in dish.get("dish", {}).items() if k != "vector"} or {"id": dish["id"], "name": dish["name"]},
                     "dish_vector": dish["vector"], "context": ctx, "engine": ENGINE_VERSION,
                     "results": [_enrich(engine, r) for r in results]})


@api_view(["GET"])
def pairing_for_dish(request, slug):
    engine = EngineContext(request)
    dish = engine.find_dish(slug)
    if not dish:
        return Response({"error": "dish not found"}, status=status.HTTP_404_NOT_FOUND)
    ctx = _ctx_from(request.query_params)
    limit = int(request.query_params.get("limit") or 5)
    available = _venue_brand_ids(request.query_params.get("venue"))
    results = recommend_beers(dish, engine.beers, engine.curated_index, ctx, limit, available, True)
    return Response({"dish": {k: v for k, v in dish["dish"].items() if k != "vector"}, "dish_vector": dish["vector"],
                     "results": [_enrich(engine, r) for r in results]})


@api_view(["GET"])
def pairing_for_beer(request, slug):
    engine = EngineContext(request)
    beer = engine.find_beer(slug)
    if not beer:
        return Response({"error": "beer not found"}, status=status.HTTP_404_NOT_FOUND)
    ctx = _ctx_from(request.query_params)
    limit = int(request.query_params.get("limit") or 6)
    results = recommend_dishes(beer, engine.dishes, engine.curated_index, ctx, limit)
    return Response({"beer": {k: v for k, v in beer["brand"].items()}, "beer_vector": beer["vector"],
                     "intensity": beer["intensity"], "confidence": beer["confidence"],
                     "similar": similar_beers(beer, engine.beers, 3),
                     "results": [_enrich(engine, r) for r in results]})


@api_view(["POST"])
def pairing_explain(request):
    data = request.data or {}
    engine = EngineContext(request)
    beer = engine.find_beer(str(data.get("beer_id", "")))
    dish = engine.find_dish(str(data.get("dish_id", "")))
    if not beer or not dish:
        return Response({"error": "beer_id and dish_id required"}, status=status.HTTP_400_BAD_REQUEST)
    ctx = _ctx_from(data.get("context") or {})
    cu = engine.curated_index.get(f"{beer['id']}|{dish['id']}")
    return Response(_enrich(engine, score_pair(beer, dish, ctx, cu)))


@api_view(["POST"])
def dna(request):
    data = request.data or {}
    ratings = data.get("ratings") or []
    engine = EngineContext(request)
    rated = []
    for r in ratings:
        beer = engine.find_beer(str(r.get("beer_id", "")))
        if beer:
            rated.append({"vector": beer["vector"], "rating": r.get("rating")})
    vec = dna_vector(rated)
    if not vec:
        return Response({"vector": None, "archetype": None, "top": []})
    arch = dna_archetype(vec)
    top = sorted(({"beer_id": b["id"], "similarity": round(sum(vec[a] * b["vector"][a] for a in BEER_AXES) /
                    ((sum(v * v for v in vec.values()) ** 0.5) * (sum(v * v for v in b["vector"].values()) ** 0.5) or 1), 2)}
                  for b in engine.beers), key=lambda x: -x["similarity"])[:5]
    return Response({"vector": vec, "archetype": arch, "top": top, "rated": len(rated)})


def _venue_payload(venue: Venue) -> dict:
    return {"id": venue.slug or str(venue.id), "name": venue.name, "city": venue.city, "address": venue.address,
            "venue_type": venue.venue_type, "description": venue.description, "logo": venue.logo,
            "brands": [b.slug or str(b.id) for b in venue.brands.all()],
            "menu": [d.slug or str(d.id) for d in venue.menu_dishes.all()],
            "tables": venue.qrcodes.count()}


@api_view(["GET"])
def venues_list(request):
    return Response([_venue_payload(v) for v in Venue.objects.filter(is_active=True).prefetch_related("brands", "menu_dishes")])


@api_view(["GET"])
def venue_detail(request, slug):
    venue = get_object_or_404(Venue, slug=slug)
    return Response(_venue_payload(venue))


@api_view(["GET"])
def qr_resolve(request, token):
    qr = QRCode.objects.filter(unique_token=token).select_related("venue").first()
    if not qr:
        return Response({"error": "unknown token"}, status=status.HTTP_404_NOT_FOUND)
    QRCode.objects.filter(pk=qr.pk).update(scans_count=F("scans_count") + 1)
    return Response({"token": token, "table": qr.table_number, "scans": qr.scans_count + 1, "venue": _venue_payload(qr.venue)})


@api_view(["POST"])
def qr_generate(request):
    data = request.data or {}
    venue = get_object_or_404(Venue, slug=data.get("venue"))
    tables = int(data.get("tables") or 0)
    prefix = (data.get("prefix") or venue.slug or "T").upper()[:8]
    created = []
    for t in range(1, tables + 1):
        qr, _ = QRCode.objects.update_or_create(unique_token=f"{prefix}-{t:02d}", defaults={"venue": venue, "table_number": t})
        created.append({"token": qr.unique_token, "table": t, "url": f"/qr/{qr.unique_token}"})
    return Response({"venue": venue.slug, "codes": created}, status=status.HTTP_201_CREATED)

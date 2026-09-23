"""API движка подбора v2: каталог напитков всех категорий, честный подбор, вкладки категорий, объяснения.

GET  /api/v2/meta/                          версия движка и калибровки, оси, категории, политика Efes
GET  /api/v2/drinks/                        ?category=beer,cider&q=kozel&efes=1&limit=50&offset=0
GET  /api/v2/drinks/<id>/                   карточка напитка: профиль, откуда числа, источники, лучшие блюда
GET  /api/v2/dishes/                        ?q=&cuisine=kazakh
GET  /api/v2/pairing/dish/<id>/             подбор к блюду: топ + вкладки категорий + лучший из портфеля Efes
POST /api/v2/pairing/recommend/             {dish_id | dish: {...v2}, context, top, categories, venue}
GET  /api/v2/pairing/explain/               ?drink=&dish=&occasion=…  — полный разбор пары по правилам

?locale=kk|en в любом запросе — тексты объяснений на казахском / английском (баллы не меняются).

Контекст (query или context{}): occasion (meal|aperitif|dessert|hot|evening|party|gourmet|non_alcoholic),
bitter_pref, sweet_pref (−1..1), heat_lover (0|1), harsh_tol (sensitive|median|tolerant), categories, venue.

Баллы всегда честные: политика Efes влияет только на порядок в пределах partner_tie_window баллов и на отдельный
блок best_partner (см. engine_v2.partner_order и docs/PAIRING_ENGINE_V2.md).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from django.conf import settings
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import Venue
from .pairing import engine_v2 as E
from .pairing.dataset_v2 import DatasetV2, get_dataset, get_dataset_locale, is_guest_visible

OCCASIONS = ("meal", "aperitif", "dessert", "hot", "evening", "party", "gourmet", "non_alcoholic")
SENSITIVITY = ("sensitive", "median", "tolerant")   # R17.harsh_tol (Hanni: ≈ 25 / 50 / 25 %)
MAX_LIMIT = 200

# что отдаём в списках (карточка напитка — целиком)
DRINK_LIST_FIELDS = ("id", "name", "display_name", "category", "style", "producer", "efes_relation", "abv", "abv_source",
                     "ibu", "vector_confidence", "vector_source", "availability_kz", "price_kzt", "image", "serving",
                     "legacy_brand_id", "description", "flags", "status")
DISH_LIST_FIELDS = ("id", "name", "display_name", "emoji", "cuisine", "category", "is_dessert", "cook_method",
                    "description", "synonyms")


def _ds(request=None) -> DatasetV2:
    """Набор данных; ?locale=kk|en — объяснения движка на языке гостя (баллы те же, см. docs/ENGINE_TEXTS.md)."""
    data_dir = str(getattr(settings, "FLAVOR_DATA_DIR", "")) or None
    locale = (request.query_params.get("locale") if request is not None else None) or "ru"
    return get_dataset_locale(data_dir, locale) if locale != "ru" else get_dataset(data_dir)


def _float(x: Any, lo: float, hi: float) -> Optional[float]:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if v != v:  # NaN
        return None
    return max(lo, min(hi, v))


def _truthy(x: Any) -> bool:
    return str(x).strip().lower() in ("1", "true", "yes", "on")


def _csv(x: Any) -> List[str]:
    if isinstance(x, (list, tuple)):
        return [str(v).strip() for v in x if str(v).strip()]
    if not x:
        return []
    return [v.strip() for v in str(x).split(",") if v.strip()]


def _ctx_from(data) -> Dict[str, Any]:
    """Контекст гостя из query/JSON. Неизвестные значения молча отбрасываются."""
    ctx: Dict[str, Any] = {}
    occ = data.get("occasion")
    if occ in OCCASIONS:
        ctx["occasion"] = occ
    for key in ("bitter_pref", "sweet_pref"):
        v = _float(data.get(key), -1.0, 1.0)
        if v:
            ctx[key] = v
    if _truthy(data.get("heat_lover")):
        ctx["heat_lover"] = True
    if _truthy(data.get("non_alcoholic")):
        ctx["non_alcoholic"] = True
    sens = data.get("harsh_tol") or data.get("sensitivity")
    if sens in SENSITIVITY:
        ctx["harsh_tol"] = sens
    dna = data.get("dna")
    if isinstance(dna, dict):
        vec = {}
        for a in E.DRINK_AXES:
            v = _float(dna.get(a), 0.0, 1.0)
            if v is not None:
                vec[a] = v
        if vec:
            ctx["dna"] = vec
    return ctx


def _venue_drink_ids(ds: DatasetV2, venue_slug: Optional[str]) -> Optional[List[str]]:
    """Что есть в заведении: сорта заведения (v1 Brand) + позиции карты kind=BEER в наличии.
    Ссылки v1 (slug сорта) переводятся в id напитков v2 через legacy_brand_id."""
    if not venue_slug:
        return None
    venue = Venue.objects.filter(slug=venue_slug).first()
    if not venue:
        return None
    refs = {b.slug or str(b.id) for b in venue.brands.all()}
    refs |= set(venue.menu_items.filter(kind="BEER", is_available=True).values_list("ref_slug", flat=True))
    ids = [d["id"] for d in ds.drinks if d["id"] in refs or d.get("legacy_brand_id") in refs]
    return ids


def _drink_brief(raw: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: raw[k] for k in DRINK_LIST_FIELDS if k in raw}
    out["in_pairing"] = is_guest_visible(raw)     # False — черновик или наличие не подтверждено
    return out


def _dish_brief(raw: Dict[str, Any]) -> Dict[str, Any]:
    return {k: raw[k] for k in DISH_LIST_FIELDS if k in raw}


def _with_drink(ds: DatasetV2, r: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not r:
        return r
    out = dict(r)
    raw = ds.drink_raw_by_id.get(r["drink_id"]) or ds.archetype_raw_by_id.get(r["drink_id"])
    if raw:
        out["drink"] = _drink_brief(raw)
    return out


def _dish_from_request(ds: DatasetV2, data) -> Optional[Dict[str, Any]]:
    dish_id = data.get("dish_id")
    if dish_id:
        return ds.dish_by_id.get(str(dish_id))
    spec = data.get("dish")
    if not isinstance(spec, dict):
        return None
    raw_vec = spec.get("vector") if isinstance(spec.get("vector"), dict) else {}
    vec = {}
    for a in E.DISH_AXES:
        v = _float(raw_vec.get(a), 0.0, 1.0)
        vec[a] = v if v is not None else 0.0
    raw = {"id": "custom", "name": str(spec.get("name") or "Ваше блюдо")[:120], "vector": vec,
           "tags": spec.get("tags") if isinstance(spec.get("tags"), (dict, list)) else {},
           "cuisine": _csv(spec.get("cuisine"))[:5], "is_dessert": bool(spec.get("is_dessert")),
           "acid_type": spec.get("acid_type") or "none", "cook_method": spec.get("cook_method") or "",
           "protein_source": spec.get("protein_source") or "none", "sauce": spec.get("sauce") or "none"}
    return E.dish_vector(raw, ds.params)


def _pairing_payload(ds: DatasetV2, dish: Dict[str, Any], data, ctx: Dict[str, Any]) -> Dict[str, Any]:
    top_raw = data.get("top")
    if str(top_raw).strip() == "0":
        top = 0                                   # весь отсортированный список, без диверсификации
    else:
        top = int(_float(top_raw, 1, 50) or ds.params["recommend"]["top_n"])
    categories = _csv(data.get("categories")) or None
    venue_ids = _venue_drink_ids(ds, data.get("venue"))
    pool = ds.guest_drink_profiles or ds.archetype_profiles
    rec = E.recommend(dish, pool, ctx, top, ds.params, ds.classic_index, categories=categories, venue_drink_ids=venue_ids)
    tabs = E.by_category(dish, pool, ctx, ds.params, ds.classic_index, per_category=3, venue_drink_ids=venue_ids)
    raw_dish = ds.dish_raw_by_id.get(dish["id"])
    return {
        "engine": E.ENGINE_VERSION,
        "calibration": (ds.calibration or {}).get("version"),
        "dish": _dish_brief(raw_dish) if raw_dish else {"id": dish["id"], "name": dish.get("name")},
        "context": ctx,
        "venue": data.get("venue") or None,
        "items": [_with_drink(ds, r) for r in rec["items"]],
        "best_partner": _with_drink(ds, rec["best_partner"]),
        "categories": [{**c, "best": _with_drink(ds, c["best"]), "items": [_with_drink(ds, x) for x in c["items"]]}
                       for c in tabs["categories"]],
        "n_candidates": rec["n_candidates"],
        "excluded_non_alcoholic": rec["excluded_non_alcoholic"],
        "policy": rec["policy"],
    }


# ─────────────────────────────────────────────────────────────────────────────
@api_view(["GET"])
def meta(request):
    ds = _ds(request)
    counts: Dict[str, int] = {}
    for d in ds.drinks:
        counts[d["category"]] = counts.get(d["category"], 0) + 1
    P = ds.params
    return Response({
        "engine": E.ENGINE_VERSION,
        "params_version": P.get("version"),
        "calibration": ds.calibration,
        "drink_axes": list(E.DRINK_AXES),
        "dish_axes": list(E.DISH_AXES),
        "categories": [{"id": c, "label": P["labels"]["category"].get(c, c), "n": counts.get(c, 0)}
                       for c in E.CATEGORIES if counts.get(c)],
        "drinks": len(ds.drinks),
        "drinks_efes": sum(1 for d in ds.drinks if E.is_efes_relation(d.get("efes_relation"), P)),
        "dishes": len(ds.dishes),
        "occasions": list(OCCASIONS),
        "policy": {"partner_tie_window": P["recommend"]["partner_tie_window"],
                   "note": E.tpl(P["recommend"]["policy_note"], {"window": E.fmt_num(P["recommend"]["partner_tie_window"])})},
        "missing_files": ds.missing,
    })


@api_view(["GET"])
def drinks_list(request):
    ds = _ds(request)
    q = (request.query_params.get("q") or "").strip().lower().replace("ё", "е")
    cats = set(_csv(request.query_params.get("category")))
    efes_only = _truthy(request.query_params.get("efes"))
    limit = int(_float(request.query_params.get("limit"), 1, MAX_LIMIT) or 50)
    offset = int(_float(request.query_params.get("offset"), 0, 100000) or 0)
    rows = []
    for d in ds.drinks:
        if cats and d["category"] not in cats:
            continue
        if efes_only and not E.is_efes_relation(d.get("efes_relation"), ds.params):
            continue
        if q:
            hay = " ".join([d.get("name", ""), d.get("display_name", "") or "", (d.get("producer") or {}).get("name", ""),
                            (d.get("style") or {}).get("name", "")]).lower().replace("ё", "е")
            if q not in hay:
                continue
        rows.append(d)
    return Response({"count": len(rows), "offset": offset, "limit": limit,
                     "results": [_drink_brief(d) for d in rows[offset:offset + limit]]})


@api_view(["GET"])
def drink_detail(request, drink_id):
    ds = _ds(request)
    raw = ds.drink_raw_by_id.get(drink_id)
    if not raw:
        return Response({"detail": "Напиток не найден"}, status=status.HTTP_404_NOT_FOUND)
    prof = ds.drink_by_id[drink_id]
    ctx = _ctx_from(request.query_params)
    rev = E.reverse(prof, ds.dish_profiles, ctx, int(_float(request.query_params.get("top"), 1, 30) or 8),
                    ds.params, ds.classic_index)
    d = E.derived(prof, None, ds.params)
    return Response({
        "drink": raw,
        "vector": prof["v"],
        "derived": d,
        "archetype": ds.archetype_raw_by_id.get((raw.get("style") or {}).get("archetype")),
        "best_dishes": rev["items"],
        "excluded": rev["excluded"],
    })


@api_view(["GET"])
def dishes_list(request):
    ds = _ds(request)
    q = (request.query_params.get("q") or "").strip().lower().replace("ё", "е")
    cuisine = request.query_params.get("cuisine")
    rows = []
    for d in ds.dishes:
        if cuisine and cuisine not in (d.get("cuisine") or []):
            continue
        if q:
            hay = " ".join([d.get("name", ""), d.get("display_name", "") or ""] + list(d.get("synonyms") or [])).lower().replace("ё", "е")
            if q not in hay:
                continue
        rows.append(_dish_brief(d))
    return Response({"count": len(rows), "results": rows})


@api_view(["GET"])
def pairing_for_dish(request, dish_id):
    ds = _ds(request)
    dish = ds.dish_by_id.get(dish_id)
    if not dish:
        return Response({"detail": "Блюдо не найдено"}, status=status.HTTP_404_NOT_FOUND)
    data = request.query_params
    return Response(_pairing_payload(ds, dish, data, _ctx_from(data)))


@api_view(["POST"])
def pairing_recommend(request):
    ds = _ds(request)
    data = request.data if isinstance(request.data, dict) else None
    if data is None:
        return Response({"detail": "Ожидается JSON-объект"}, status=status.HTTP_400_BAD_REQUEST)
    dish = _dish_from_request(ds, data)
    if not dish:
        return Response({"detail": "Нужно dish_id или dish {vector…}"}, status=status.HTTP_400_BAD_REQUEST)
    ctx_src = data.get("context") if isinstance(data.get("context"), dict) else data
    return Response(_pairing_payload(ds, dish, data, _ctx_from(ctx_src)))


@api_view(["GET"])
def pairing_explain(request):
    ds = _ds(request)
    drink_id = request.query_params.get("drink")
    dish_id = request.query_params.get("dish")
    b = ds.drink_by_id.get(drink_id) or ds.archetype_by_id.get(drink_id)
    d = ds.dish_by_id.get(dish_id)
    if not b or not d:
        return Response({"detail": "Нужны существующие drink и dish"}, status=status.HTTP_404_NOT_FOUND)
    r = E.score_pair(b, d, _ctx_from(request.query_params), ds.params, ds.classic_index, True)
    return Response(_with_drink(ds, r))

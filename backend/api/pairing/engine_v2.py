"""
Flavor Tree Pairing Engine v2
=============================

Один движок для всех категорий напитков (пиво, сидр, вино, игристое, коктейли, крепкое, квас,
лимонады, кумыс/айран/шубат, чай...). Спецификация: docs/research/ENGINE_V2_SPEC.md (§2–§6),
эталон формул: docs/research/engine_v2_prototype.py (v2.1). Все числа — в data/engine_v2_params.json;
здесь только структура формул, выбор текстов и порядок вычислений.

    напиток (14 осей + теги) ─┐
                              ├─► R1…R14, R20 (ядро) + R15…R17 (контекст) ─► 45 + 0.9·S_core + S_ctx ─► вето ─► [3..99]
    блюдо   (16 осей + теги) ─┘                     └─► mechanisms / reasons / warnings / match_type

Чистый Python, только stdlib, детерминированный. Django не нужен.

ПАРИТЕТ С TypeScript (порт должен совпадать до последней цифры)
-------------------------------------------------------------
1. Никаких «питоновских» численных приёмов:
   * ``sum()`` по float в Python ≥ 3.12 — компенсированное суммирование → только ``fsum()`` (наивный цикл слева направо);
     в TS — обычный ``for`` с ``acc += v``. ``math.fsum`` не используется.
   * ``round()`` в Python — банковское и работает по точному двоичному значению → только
     ``r2(x) = floor(x·100 + 0.5)/100`` и ``round_half_up(x) = floor(x + 0.5)``.
     В TS — ``Math.floor(x * 100 + 0.5) / 100`` и ``Math.floor(x + 0.5)`` (НЕ ``Math.round``: для 0.49999999999999994
     ``Math.round`` даёт 0, а ``floor(x + 0.5)`` — 1, как в Python).
   * Форматирование чисел в текстах — только через ``fmt2`` (``r2(x).toFixed(2)``) и ``fmt_num``
     (одна десятичная, ``.0`` отбрасывается). ``f"{x:.2f}"`` по сырому числу запрещено: 0.125 → «0.12» в Python и «0.13» в JS.
2. Порядок операций в формулах повторяет прототип буквально (a + b + c слева направо; ``-12*s*p/0.65*shield`` и т. п.).
   Множитель ``harsh_tol`` умножает каждое штрафное слагаемое отдельно — при tol = 1.0 результат бит-в-бит как в прототипе.
3. Порядок обхода словарей фиксирован и задокументирован:
   * оси — порядок массивов ``params.axes.drink`` / ``params.axes.dish`` (порядок контракта);
   * теги в R12 — ``sorted()`` по ключу (в TS ``Object.keys(t).sort()``; ключи — ASCII, сортировка совпадает);
   * фрукты в R4, choc-теги, приоритеты текстов — порядок JSON-массивов в params;
   * компоненты считаются и суммируются в порядке: R1 R2 R3 R4 R5 R6 R7 R8 R9 R10 R11 R12 R14 R13 R20 R15 R16 R17
     (как в прототипе: R13 смотрит на уже посчитанные правила, R14 — до R13);
   * сортировки: ключ (−score, id) / (−points, индекс в порядке вычисления); строки сравниваются по кодам символов (ASCII id).
4. Очки каждого правила округляются ``r2`` сразу после вычисления (после множителя fit) — до суммирования (как в прототипе).
5. Числа из JSON читаются как есть; никаких промежуточных округлений в W/F (округляются только выходные поля).

Отличия от прототипа (намеренные, см. отчёт движка):
* R16 ограничен clamp(−12, +10) по спецификации (в прототипе meal не ограничен) → бешбармак × old fashioned (meal): 39 → 41.
* Округление r2/floor(x+0.5) вместо round() и наивная сумма вместо sum(): расхождения только на точных «половинках».
* R16 (остальные поводы), R17, R18, V7, harsh_tol в R8/R14 — в прототипе не было; реализованы по спецификации.
"""
from __future__ import annotations

import copy
import json
import math
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

ENGINE_VERSION = "2.2.1"

DRINK_AXES: Tuple[str, ...] = ("sweet", "acid", "bitter", "tannin", "carbonation", "alcohol", "body", "dairy",
                               "salt", "umami", "aroma_intensity", "roast", "smoke", "serve_temp")
DISH_AXES: Tuple[str, ...] = ("salt", "sweet", "sour", "bitter", "umami", "fat", "protein", "heat", "pungent",
                              "weight", "cream", "maillard", "smoke", "fresh", "fish_oil", "green_iron")
CATEGORIES: Tuple[str, ...] = ("beer", "na_beer", "radler", "cider", "wine", "sparkling", "fortified", "cocktail",
                               "spirit", "liqueur", "kvass", "lemonade", "soda", "dairy", "tea", "coffee", "water")
CAP_VETOES: Tuple[str, ...] = ("V1", "V2", "V3", "V4", "V5", "V6")
# критерий «bad» для эталонных пар (scripts/engine_eval_v2.py, calibrate_v2.py): ниже этого балла — «не рекомендуем»
BAD_ABSOLUTE: int = 48

# короткие ключи прототипа → ключи контракта
_SHORT_AXES = {"carb": "carbonation", "aroma": "aroma_intensity", "temp": "serve_temp"}

PARAMS_PATH = Path(__file__).resolve().parents[2] / "data" / "engine" / "engine_v2_params.json"


# ─────────────────────────────────────────────────────────────────────────────
# численные помощники (каждый имеет точный аналог в TS — см. docstring модуля)
# ─────────────────────────────────────────────────────────────────────────────
def clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    """TS: ``x < lo ? lo : x > hi ? hi : x``."""
    return lo if x < lo else hi if x > hi else x


def pos(x: float) -> float:
    """TS: ``x > 0 ? x : 0``."""
    return x if x > 0 else 0.0


def r2(x: float) -> float:
    """Округление до сотых «половина вверх» по двоичному значению. TS: ``Math.floor(x * 100 + 0.5) / 100``."""
    return math.floor(x * 100 + 0.5) / 100


def r1(x: float) -> float:
    """До десятых. TS: ``Math.floor(x * 10 + 0.5) / 10``."""
    return math.floor(x * 10 + 0.5) / 10


def round_half_up(x: float) -> int:
    """Целое «половина вверх». TS: ``Math.floor(x + 0.5)`` (не Math.round)."""
    return int(math.floor(x + 0.5))


def fsum(values: Iterable[float]) -> float:
    """Наивная сумма слева направо (как JS). Встроенный sum() в Python ≥ 3.12 компенсирует ошибку и ломает паритет."""
    acc = 0.0
    for v in values:
        acc += v
    return acc


def fmt2(x: float) -> str:
    """Два знака после точки. TS: ``r2(x).toFixed(2)``."""
    return "%.2f" % r2(x)


def fmt_num(x: Optional[float]) -> str:
    """Одна десятичная, «.0» отбрасывается: 5.0 → «5», 4.4 → «4.4». TS: ``const r = r1(x); Number.isInteger(r) ? String(r) : r.toFixed(1)``."""
    if x is None:
        return ""
    r = r1(float(x))
    if r == math.floor(r):
        return str(int(r))
    return "%.1f" % r


_SLOT = re.compile(r"\{(\w+)\}")


def tpl(template: str, slots: Dict[str, Any]) -> str:
    """Подстановка {slot}; неизвестный слот остаётся как есть. TS: ``t.replace(/\\{(\\w+)\\}/g, (m, k) => k in s ? String(s[k]) : m)``."""
    return _SLOT.sub(lambda m: str(slots[m.group(1)]) if m.group(1) in slots else m.group(0), template)


def cap_first(s: str) -> str:
    """Первая буква заглавная. TS: ``s.charAt(0).toUpperCase() + s.slice(1)``."""
    return s[:1].upper() + s[1:] if s else s


def _argmax(items: Sequence[Tuple[str, float]]) -> Tuple[str, float]:
    """Первый ключ с максимальным значением (строгое >, порядок — как передан)."""
    best_k, best_v = items[0]
    for k, v in items[1:]:
        if v > best_v:
            best_k, best_v = k, v
    return best_k, best_v


def _argmin(items: Sequence[Tuple[str, float]]) -> Tuple[str, float]:
    best_k, best_v = items[0]
    for k, v in items[1:]:
        if v < best_v:
            best_k, best_v = k, v
    return best_k, best_v


# ─────────────────────────────────────────────────────────────────────────────
# параметры
# ─────────────────────────────────────────────────────────────────────────────
_DEFAULT_PARAMS: Optional[Dict[str, Any]] = None


def _set_path(obj: Dict[str, Any], path: str, value: Any) -> None:
    keys = path.split(".")
    cur = obj
    for k in keys[:-1]:
        nxt = cur.get(k)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[k] = nxt
        cur = nxt
    cur[keys[-1]] = value


def get_path(obj: Dict[str, Any], path: str) -> Any:
    cur: Any = obj
    for k in path.split("."):
        cur = cur[k]
    return cur


def _deep_merge(dst: Dict[str, Any], src: Dict[str, Any]) -> None:
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            _deep_merge(dst[k], v)
        else:
            dst[k] = copy.deepcopy(v)


def merge_params(base: Dict[str, Any], override: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Новый словарь параметров = base + override. override — вложенный dict и/или плоские пути
    {"R1.k_loud": 60, "score": {"base": 42}}. base не изменяется."""
    out = copy.deepcopy(base)
    if not override:
        return out
    for k, v in override.items():
        if "." in k:
            _set_path(out, k, copy.deepcopy(v))
        elif isinstance(v, dict) and isinstance(out.get(k), dict):
            _deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def load_params(path: Optional[Path] = None, override: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    with open(path or PARAMS_PATH, encoding="utf-8") as f:
        params = json.load(f)
    return merge_params(params, override) if override else params


def default_params() -> Dict[str, Any]:
    """Параметры по умолчанию (кэш, только для чтения — для правок используйте merge_params)."""
    global _DEFAULT_PARAMS
    if _DEFAULT_PARAMS is None:
        _DEFAULT_PARAMS = load_params()
    return _DEFAULT_PARAMS


# ─────────────────────────────────────────────────────────────────────────────
# нормализация входов
# ─────────────────────────────────────────────────────────────────────────────
def _as_tags(raw: Any) -> Dict[str, float]:
    if not raw:
        return {}
    if isinstance(raw, list):
        return {str(t): 1.0 for t in raw}
    return {str(k): float(v) for k, v in raw.items() if v is not None}


def _as_list(raw: Any) -> List[str]:
    if not raw:
        return []
    if isinstance(raw, str):
        return [raw]
    return [str(x) for x in raw]


def _pick(tags: Dict[str, float], order: Sequence[Sequence[str]], min_w: float) -> Optional[str]:
    """Первый по приоритету тег с весом ≥ min_w → его подпись."""
    for tag, label in order:
        if tags.get(tag, 0.0) >= min_w:
            return label
    return None


def is_efes_relation(relation: Optional[str], params: Optional[Dict[str, Any]] = None) -> bool:
    P = params or default_params()
    return (relation or "none") in P["recommend"]["efes_relations"]


def drink_vector(drink: Dict[str, Any], params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Запись drinks.json / архетип style_priors_v2 (с полем id) / запись прототипа → профиль движка.

    * оси берутся из ``sensory`` (или ``vector``, или с верхнего уровня — формат прототипа), короткие ключи
      carb/aroma/temp переводятся в carbonation/aroma_intensity/serve_temp;
    * ABV движка = ``abv_after_dilution`` (коктейли, §2.1), иначе ``abv``;
    * ``alcohol`` всегда пересчитывается как clamp(ABV/40) (§2.2) — одна правда для burn/W_B и оси;
    * ``serve_temp`` (°C): из sensory, иначе середина serving.temp_min_c/temp_max_c, иначе params.axes.drink_default_serve_temp;
    * ``vector_override`` (правка сомелье) применяется последним и имеет приоритет над всем, включая alcohol.
    """
    if drink.get("_v2") == "drink":
        return drink
    P = params or default_params()
    src = drink.get("sensory") or drink.get("vector") or drink
    sens: Dict[str, Any] = {}
    for k, v in src.items():
        sens[_SHORT_AXES.get(k, k)] = v
    scale = P["derived"]["alcohol_abv_scale"]
    abv = drink.get("abv_after_dilution")
    if abv is None:
        abv = drink.get("abv")
    if abv is None:
        abv = float(sens.get("alcohol") or 0.0) * scale
    abv = float(abv)
    v: Dict[str, float] = {}
    for a in P["axes"]["drink"]:
        if a == "alcohol":
            v[a] = clamp(abv / scale)
        elif a == "serve_temp":
            t = sens.get("serve_temp")
            if t is None:
                serving = drink.get("serving") or {}
                lo, hi = serving.get("temp_min_c"), serving.get("temp_max_c")
                if lo is not None and hi is not None:
                    t = (float(lo) + float(hi)) / 2
                else:
                    t = P["axes"]["drink_default_serve_temp"]
            v[a] = float(t)
        else:
            v[a] = clamp(float(sens.get(a) or 0.0))
    override = drink.get("vector_override") or {}
    for a in P["axes"]["drink"]:
        if override.get(a) is not None:
            v[a] = float(override[a])
    style = drink.get("style") or {}
    category = drink.get("category") or drink.get("cat") or "beer"
    archetype = style.get("archetype") or drink.get("archetype") or drink.get("id")
    family = style.get("family") or drink.get("family") or str(category).upper()
    flags = drink.get("flags") or {}
    ibu = drink.get("ibu")
    name = drink.get("display_name") or drink.get("name") or drink.get("label_ru") or drink.get("id")
    L = P["labels"]
    cat_gen = L["category_gen"].get(category, L["category_gen_default"])
    ibu_s = fmt_num(ibu) if ibu is not None else None
    if category in L["hop_categories"]:
        bitter_phrase = tpl(L["bitter_ibu"], {"ibu": ibu_s}) if ibu_s is not None else L["bitter_hop"]
    else:
        bitter_phrase = tpl(L["bitter_other"], {"cat_gen": cat_gen})
    words = {
        "drink": name,
        "cat_gen": cat_gen,
        "bitter": bitter_phrase,
        "bitter_cap": cap_first(bitter_phrase),
        "ibu": ibu_s if ibu_s is not None else "",
        "ibu_paren": tpl(L["ibu_paren"], {"ibu": ibu_s}) if ibu_s is not None else "",
        "abv": fmt_num(abv),
        "temp": fmt_num(v["serve_temp"]),
    }
    return {
        "_v2": "drink",
        "id": str(drink.get("id")),
        "name": name,
        "category": category,
        "family": family,
        "archetype": archetype,
        "abv": abv,
        "ibu": ibu,
        "v": v,
        "tags": _as_tags(drink.get("aroma_tags") if drink.get("aroma_tags") is not None else drink.get("tags")),
        "origin": _as_list(drink.get("origin_affinity") if drink.get("origin_affinity") is not None else drink.get("origin")),
        "efes_relation": drink.get("efes_relation") or "none",
        "non_alcoholic_flag": bool(flags.get("non_alcoholic")),
        "vector_confidence": drink.get("vector_confidence"),
        "words": words,
    }


def dish_vector(dish: Dict[str, Any], params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Запись dishes_v2.json (или прототипа) → профиль блюда. Недостающие оси = 0 (weight = 0.5)."""
    if dish.get("_v2") == "dish":
        return dish
    P = params or default_params()
    src = dish.get("vector") if isinstance(dish.get("vector"), dict) else dish
    defaults = P["axes"]["dish_defaults"]
    v: Dict[str, float] = {}
    for a in P["axes"]["dish"]:
        val = src.get(a)
        v[a] = clamp(float(val)) if val is not None else float(defaults.get(a, 0.0))
    tags = _as_tags(dish.get("tags"))
    is_dessert = bool(dish.get("is_dessert", dish.get("dessert", False)))
    acid_type = dish.get("acid_type") or ("vinegar" if dish.get("vinegar") else "none")
    cook = dish.get("cook_method") or ""
    sauce = dish.get("sauce") or "none"
    protein_source = dish.get("protein_source") or "none"
    name = dish.get("display_name") or dish.get("name") or dish.get("id")
    L = P["labels"]
    tmin = L["tag_min"]

    # белок: явное поле → иначе по тегам
    pkey: Optional[str] = protein_source if protein_source in L["protein_gen"] else None
    if pkey is None:
        for tag, key in L["protein_tag_order"]:
            if tags.get(tag, 0.0) >= L["protein_tag_min"]:
                pkey = key
                break
    if pkey == "white_fish" and v["fish_oil"] >= L["oily_fish_min"]:
        pkey = "oily_fish"
    protein_src = L["protein_gen"][pkey] if pkey else L["fat_default"]
    # жир
    if sauce in L["fat_sauce"] and v["cream"] >= L["fat_sauce_cream_min"]:
        fat_src = L["fat_sauce"][sauce]
    elif pkey:
        fat_src = L["protein_gen"][pkey]
    else:
        fat_src = _pick(tags, L["fat_tags"], tmin) or L["fat_default"]
    # соль
    salt_labels = dict((tag, label) for tag, label in L["salt_order"])
    salt_src = None
    if cook == "cured":
        salt_src = salt_labels.get("cured")
    if salt_src is None:
        salt_src = _pick(tags, L["salt_order"], tmin)
    if salt_src is None and sauce in L["salt_sauce"]:
        salt_src = L["salt_sauce"][sauce]
    if salt_src is None and protein_source.startswith("cheese"):
        salt_src = salt_labels.get("cheese")
    salt_src = salt_src or L["salt_default"]
    # кислота
    acid_src = L["acid_type"].get(acid_type) or _pick(tags, L["acid_tags"], tmin) or L["acid_default"]
    # острота
    chili_gen = _pick(tags, L["chili_tags"], tmin) or (L["chili_sauce"] if sauce == "chili" else L["chili_default"])
    # корочка / дым / умами
    crust = L["crust_cook"].get(cook) or _pick(tags, L["crust_tags"], tmin) or L["crust_default"]
    smoke_dat = L["smoke_cook"].get(cook) or _pick(tags, L["smoke_tags"], tmin) or L["smoke_default"]
    umami_src = (L["umami_sauce"].get(sauce) or _pick(tags, L["umami_tags"], tmin)
                 or (L["protein_gen"][pkey] if pkey else None) or L["umami_default"])
    words = {
        "dish": name, "fat_src": fat_src, "protein_src": protein_src, "salt_src": salt_src,
        "salt_src_cap": cap_first(salt_src), "acid_src": acid_src, "chili_gen": chili_gen,
        "crust": crust, "crust_cap": cap_first(crust), "smoke_dat": smoke_dat, "umami_src": umami_src,
    }
    return {
        "_v2": "dish",
        "id": str(dish.get("id")),
        "name": name,
        "v": v,
        "tags": tags,
        "cuisine": _as_list(dish.get("cuisine")),
        "is_dessert": is_dessert,
        "vinegar": acid_type == "vinegar",
        "acid_type": acid_type,
        "cook_method": cook or None,
        "protein_source": protein_source,
        "sauce": sauce,
        "words": words,
    }


# ─────────────────────────────────────────────────────────────────────────────
# производные величины (§2.2, §3.1)
# ─────────────────────────────────────────────────────────────────────────────
def burn(abv: float, params: Optional[Dict[str, Any]] = None) -> float:
    """Кусочно-линейное «жжение» спирта (§2.2): 0 до x0, далее отрезки до (x1,y1), (x2,y2), (x3,1)."""
    B = (params or default_params())["derived"]["burn"]
    x0, x1, y1, x2, y2, x3 = B["x0"], B["x1"], B["y1"], B["x2"], B["y2"], B["x3"]
    if abv < x0:
        return 0.0
    if abv <= x1:
        return y1 * (abv - x0) / (x1 - x0)
    if abv <= x2:
        return y1 + (y2 - y1) * (abv - x1) / (x2 - x1)
    if abv <= x3:
        return y2 + (1.0 - y2) * (abv - x2) / (x3 - x2)
    return 1.0


def cold(t: float, params: Optional[Dict[str, Any]] = None) -> float:
    C = (params or default_params())["derived"]["cold"]
    return clamp((C["t_ref"] - t) / C["span"])


def _W_B(v: Dict[str, float], abv: float, P: Dict[str, Any]) -> float:
    p = P["derived"]["W_B"]
    return clamp(p["body"] * v["body"] + p["abv"] * clamp(abv / p["abv_scale"]) + p["sweet"] * v["sweet"])


def _F_B(v: Dict[str, float], abv: float, P: Dict[str, Any]) -> float:
    p = P["derived"]["F_B"]
    return clamp(p["aroma_intensity"] * v["aroma_intensity"] + p["bitter"] * v["bitter"] + p["roast"] * v["roast"]
                 + p["smoke"] * v["smoke"] + p["tannin"] * v["tannin"] + p["acid"] * v["acid"]
                 + p["burn"] * burn(abv, P))


def _W_D(d: Dict[str, Any], P: Dict[str, Any]) -> float:
    p = P["derived"]["W_D"]
    x = d["v"]
    w = clamp(p["weight"] * x["weight"] + p["fat"] * x["fat"] + p["cream"] * x["cream"] + p["protein"] * x["protein"])
    if d["is_dessert"]:
        w = max(w, clamp(p["dessert_sweet"] * x["sweet"] + p["dessert_fat"] * x["fat"] + p["dessert_cream"] * x["cream"]))
    return w


def _F_D(d: Dict[str, Any], P: Dict[str, Any]) -> float:
    p = P["derived"]["F_D"]
    x = d["v"]
    f = clamp(p["heat"] * x["heat"] + p["smoke"] * x["smoke"] + p["salt"] * x["salt"] + p["umami"] * x["umami"]
              + p["maillard"] * x["maillard"] + p["sour"] * x["sour"] + p["sweet"] * x["sweet"]
              + p["pungent"] * x["pungent"] + p["bitter"] * x["bitter"])
    if d["is_dessert"]:
        choc = 0.0
        for t in p["dessert_choc_tags"]:
            choc = max(choc, d["tags"].get(t, 0.0))
        f = max(f, clamp(p["dessert_sweet"] * x["sweet"] + p["dessert_bitter"] * x["bitter"] + p["dessert_choc"] * choc))
    return f


def _apply_r18(v: Dict[str, float], P: Dict[str, Any]) -> Dict[str, float]:
    p = P["R18"]
    warmth = clamp((v["serve_temp"] - p["t_ref"]) / p["t_span"])
    out = dict(v)
    out["sweet"] = clamp(v["sweet"] * (1 + p["k_sweet"] * warmth))
    out["bitter"] = clamp(v["bitter"] * (1 + p["k_bitter"] * warmth))
    return out


def _intensity(b: Dict[str, Any], d: Dict[str, Any], v: Dict[str, float], P: Dict[str, Any]) -> Dict[str, Any]:
    p = P["R1"]
    wb, fb = _W_B(v, b["abv"], P), _F_B(v, b["abv"], P)
    wd, fd = _W_D(d, P), _F_D(d, P)
    boost = (p["light_boost"] * max(v["acid"], p["light_boost_carb"] * v["carbonation"], v["salt"], v["tannin"])
             if wb < wd else 0.0)
    wb_eff = wb + boost
    dW = wb_eff - wd
    dF = fb - fd
    x = d["v"]
    strong = x["protein"] >= p["strong_protein"] and x["salt"] >= p["strong_salt"] and x["fat"] >= p["strong_fat"]
    off = p["fit_offset_strong"] if strong else p["fit_offset"]
    fit = 1 - clamp((dF - off) / p["fit_span"])
    return {"W_B": wb, "F_B": fb, "W_D": wd, "F_D": fd, "boost": boost, "W_B_eff": wb_eff,
            "dW": dW, "dF": dF, "strong_dish": strong, "fit": fit}


def derived(drink: Optional[Dict[str, Any]] = None, dish: Optional[Dict[str, Any]] = None,
            params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """W/F напитка и/или блюда (без округления). Если переданы оба — ещё W_B_eff, dW, dF, fit, strong_dish."""
    P = params or default_params()
    out: Dict[str, Any] = {}
    b = drink_vector(drink, P) if drink is not None else None
    d = dish_vector(dish, P) if dish is not None else None
    if b is not None:
        v = _apply_r18(b["v"], P) if P["R18"]["enabled"] else b["v"]
        out["W_B"], out["F_B"] = _W_B(v, b["abv"], P), _F_B(v, b["abv"], P)
        out["burn"] = burn(b["abv"], P)
    if d is not None:
        out["W_D"], out["F_D"] = _W_D(d, P), _F_D(d, P)
    if b is not None and d is not None:
        v = _apply_r18(b["v"], P) if P["R18"]["enabled"] else b["v"]
        out.update(_intensity(b, d, v, P))
    return out


# ─────────────────────────────────────────────────────────────────────────────
# классические пары (R20)
# ─────────────────────────────────────────────────────────────────────────────
def index_classics(classics: Optional[Iterable[Dict[str, Any]]]) -> Dict[str, Dict[str, Any]]:
    """[{dish, drink (архетип или id напитка), bonus, label, source}] → {"dish|drink": запись}."""
    out: Dict[str, Dict[str, Any]] = {}
    for c in classics or []:
        out[f"{c['dish']}|{c['drink']}"] = c
    return out


def _classic_lookup(cidx: Any, d: Dict[str, Any], b: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not cidx:
        return None
    if isinstance(cidx, list):
        cidx = index_classics(cidx)
    return cidx.get(f"{d['id']}|{b['id']}") or cidx.get(f"{d['id']}|{b['archetype']}")


# ─────────────────────────────────────────────────────────────────────────────
# контекст
# ─────────────────────────────────────────────────────────────────────────────
def harsh_tol(ctx: Dict[str, Any], params: Optional[Dict[str, Any]] = None) -> float:
    """ctx.harsh_tol: число или профиль sensitive / median / tolerant (§6.3)."""
    P = params or default_params()
    h = ctx.get("harsh_tol")
    if h is None:
        return 1.0
    if isinstance(h, str):
        return float(P["R17"]["harsh_tol"].get(h, 1.0))
    return float(h)


def non_alcoholic_limit(ctx: Dict[str, Any], params: Optional[Dict[str, Any]] = None) -> Optional[float]:
    """None — фильтра нет; иначе максимальный ABV (V7). Включается ctx.non_alcoholic или occasion = non_alcoholic."""
    P = params or default_params()
    if ctx.get("non_alcoholic") or ctx.get("occasion") == "non_alcoholic":
        lim = ctx.get("non_alcoholic_max_abv")
        return float(lim) if lim is not None else float(P["vetoes"]["V7"]["max_abv"])
    return None


def cosine(a: Dict[str, float], b: Dict[str, float], axes: Sequence[str]) -> float:
    dot = na = nb = 0.0
    for k in axes:
        x = float(a.get(k, 0.0) or 0.0)
        y = float(b.get(k, 0.0) or 0.0)
        dot += x * y
        na += x * x
        nb += y * y
    if na == 0 or nb == 0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


def dna_vector(rated: Iterable[Dict[str, Any]], params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, float]]:
    """Flavor DNA v2: [{drink: запись|профиль, rating: love|like|meh|dislike}] (или {vector: {...}, rating}) →
    средневзвешенный вектор по осям params.R17.dna.axes, clamp 0..1, r2. None — если оценок нет."""
    P = params or default_params()
    axes = P["R17"]["dna"]["axes"]
    weights = P["R17"]["dna"]["rating_weights"]
    acc = {a: 0.0 for a in axes}
    wsum = 0.0
    for r in rated:
        w = float(weights.get(r.get("rating"), 0))
        if w == 0.0:
            continue
        vec = drink_vector(r["drink"], P)["v"] if r.get("drink") is not None else r.get("vector") or {}
        for a in axes:
            acc[a] += w * float(vec.get(a, 0.0) or 0.0)
        wsum += abs(w)
    if wsum == 0.0:
        return None
    return {a: r2(clamp(acc[a] / wsum)) for a in axes}


def band_for(score: int, capped: bool, params: Optional[Dict[str, Any]] = None,
             confidence: Optional[float] = None) -> Dict[str, str]:
    B = (params or default_params())["bands"]
    if capped and score <= B["avoid_max"]:
        return dict(B["avoid"])
    result = None
    for band in B["list"]:
        if score >= band["min"]:
            result = {"id": band["id"], "label": band["label"]}
            break
    if result is None:
        last = B["list"][-1]
        result = {"id": last["id"], "label": last["label"]}
    # PAIR-9: «Идеальная пара» только при достаточной уверенности профиля напитка.
    # У напитка на среднекатегорийном векторе (vector_confidence низкая) балл 85+ не заслужен
    # реальными измерениями — понижаем метку до «Отличное сочетание», балл не трогаем.
    min_conf = B.get("min_confidence_for_ideal")
    if result["id"] == "ideal" and min_conf is not None and confidence is not None and confidence < min_conf:
        for band in B["list"]:
            if band["id"] == "excellent":
                return {"id": band["id"], "label": band["label"]}
    return result


# ─────────────────────────────────────────────────────────────────────────────
# score_pair
# ─────────────────────────────────────────────────────────────────────────────
def score_pair(drink: Dict[str, Any], dish: Dict[str, Any], ctx: Optional[Dict[str, Any]] = None,
               params: Optional[Dict[str, Any]] = None, classics: Any = None, explain: bool = True) -> Dict[str, Any]:
    """Балл пары напиток × блюдо по §4–§5.

    ctx: occasion (meal|aperitif|dessert|hot|evening|party|gourmet|non_alcoholic), harsh_tol (число | sensitive|median|tolerant),
         bitter_pref ∈ [−1,1], sweet_pref ∈ [−1,1], heat_lover (bool), dna ({ось: 0..1}), non_alcoholic (bool),
         non_alcoholic_max_abv (число), temperature_perception (bool, включает R18).
    classics: список classic_pairs.json или индекс index_classics(); None — без R20.
    explain=False — без текстов (быстрее, для калибровки); баллы идентичны.
    """
    P = params or default_params()
    ctx = ctx or {}
    b = drink_vector(drink, P)
    d = dish_vector(dish, P)
    bv = b["v"]
    if P["R18"]["enabled"] or ctx.get("temperature_perception"):
        bv = _apply_r18(bv, P)
    x = d["v"]
    abv = b["abv"]
    alc = bv["alcohol"]
    tol = harsh_tol(ctx, P)
    heat_lover = 1.0 if ctx.get("heat_lover") else 0.0
    dessert = d["is_dessert"]
    W: Dict[str, str] = {}
    if explain:
        W.update(b["words"])
        W.update(d["words"])

    comps: List[Dict[str, Any]] = []
    vetoes: List[str] = []

    def add(rule: str, pts: float, family: str, key: str, evidence: str, text: str) -> None:
        comps.append({"rule": rule, "family": family, "points": r2(pts), "key": key, "evidence": evidence,
                      "text": text if explain else ""})

    # ── R1 intensity_match + V1/V6 + fit ─────────────────────────────────────
    p = P["R1"]
    it = _intensity(b, d, bv, P)
    wb, fb, wd, fd, dW, dF, fit = it["W_B"], it["F_B"], it["W_D"], it["F_D"], it["dW"], it["dF"], it["fit"]
    strong = it["strong_dish"]
    k_loud = p["k_loud_strong"] if strong else p["k_loud"]
    pts = p["base"] - (k_loud * dF if dF > 0 else p["k_quiet"] * (-dF)) - (p["k_weight"] * abs(dW))
    text = ""
    if explain:
        W.update({"fb": fmt2(fb), "fd": fmt2(fd), "wb": fmt2(wb), "wd": fmt2(wd)})
        T = p["texts"]
        # «громче/тише» с плюсом в баллах — мягкая формулировка: причина с плюсом не должна звучать как предупреждение
        ok = pts >= p["text_ok_min"]
        if dF > p["text_dF"]:
            loud = T["loud_ok"] if ok else T["loud"]
        elif dF < -p["text_dF"]:
            loud = T["quiet_ok"] if ok else T["quiet"]
        else:
            loud = T["match"]
        if it["boost"] >= p["text_boost_min"] and dW >= -p["text_dW"]:
            helper_key, _ = _argmax([("acid", bv["acid"]), ("carbonation", p["light_boost_carb"] * bv["carbonation"]),
                                     ("salt", bv["salt"]), ("tannin", bv["tannin"])])
            weight = tpl(T["w_boost"], dict(W, helper=T["helpers"][helper_key]))
        elif dW < -p["text_dW"]:
            weight = tpl(T["w_light"], W)
        elif dW > p["text_dW"]:
            weight = tpl(T["w_heavy"], W)
        else:
            weight = tpl(T["w_match"], W)
        text = tpl(T["join"], {"loudness": tpl(loud, W), "weight": weight})
    add("R1", clamp(pts, p["min"], p["max"]), "balance", "intensity", p["evidence"], text)
    V = P["vetoes"]
    if (dF >= V["V1"]["dF"] or (dF >= V["V1"]["dF_combo"] and dW >= V["V1"]["dW_combo"])) and not dessert and not strong:
        vetoes.append("V1")
    if dF <= V["V6"]["dF"] or (dF <= V["V6"]["dF_combo"] and dW <= V["V6"]["dW_combo"]):
        vetoes.append("V6")

    def addfit(rule: str, pts: float, family: str, key: str, evidence: str, text: str) -> None:
        add(rule, pts * fit if pts > 0 else pts, family, key, evidence, text)

    # ── R2 cut_richness ─────────────────────────────────────────────────────
    p = P["R2"]
    rich = max(x["fat"], p["richness_cream"] * x["cream"], p["richness_weight"] * x["weight"])
    if rich >= p["min_richness"]:
        t_tan = p["tannin"] * bv["tannin"]
        t_bit = p["bitter"] * bv["bitter"] * (1 - p["bitter_heat_discount"] * x["heat"])
        t_carb = p["carbonation"] * bv["carbonation"] * (1 - p["carbonation_cream_discount"] * x["cream"])
        t_acid = p["acid"] * bv["acid"]
        t_roast = p["roast"] * bv["roast"]
        t_alc = p["alcohol"] * alc
        cp = t_tan + t_bit + t_carb + t_acid + t_roast + t_alc
        key, _ = _argmax([("tannin", t_tan), ("bitter", t_bit), ("carbonation", t_carb), ("acid", t_acid),
                          ("roast", t_roast), ("alcohol", t_alc)])
        text = ""
        if explain:
            T = p["texts"]
            coat = T["coat_cream"] if x["cream"] >= p["coat_cream_min"] else tpl(T["coat_fat"], W)
            text = tpl(T[key], dict(W, coat=coat))
        addfit("R2", clamp(p["scale"] * rich * cp, p["min"], p["max"]), "cut", key,
               p["evidence_tannin"] if key == "tannin" else p["evidence"], text)

    # ── R3 chili_heat + V3 ──────────────────────────────────────────────────
    p = P["R3"]
    if x["heat"] >= p["min_heat"]:
        salt_soft = 1 - p["salt_soft"] * x["salt"]
        rel_sweet = p["relief_sweet"] * clamp(bv["sweet"] / p["relief_sweet_sat"])
        rel_dairy = p["relief_dairy"] * bv["dairy"]
        rel_cold = p["relief_cold"] * cold(bv["serve_temp"], P)
        rel_body = p["relief_body"] * bv["body"]
        relief = rel_sweet + rel_dairy + rel_cold + rel_body
        hop = pos(bv["bitter"] - p["hop_threshold"]) / p["hop_span"]
        a_burn = p["aggr_burn"] * burn(abv, P)
        a_hop = p["aggr_hop_salt"] * hop * salt_soft
        a_hop_abv = p["aggr_hop_abv"] * hop * clamp((abv - p["hop_abv_offset"]) / p["hop_abv_span"])
        a_tan = p["aggr_tannin"] * bv["tannin"]
        a_carb = p["aggr_carb"] * pos(bv["carbonation"] - p["carb_threshold"]) / p["carb_span"]
        aggr = a_burn + a_hop + a_hop_abv + a_tan + a_carb
        pts = x["heat"] * (p["k_relief"] * relief - p["k_aggr"] * aggr * tol * (1 - p["heat_lover_relief"] * heat_lover))
        if pts >= 0:
            key, _ = _argmax([("dairy", rel_dairy), ("sweet", rel_sweet), ("cold", rel_cold), ("body", rel_body)])
        else:
            key, _ = _argmax([("burn", a_burn), ("hop", a_hop), ("hop_abv", a_hop_abv), ("tannin", a_tan),
                              ("carbonation", a_carb)])
        if heat_lover and hop > 0:
            key = "heat_lover"
        text = ""
        if explain:
            T = p["texts"]
            ibu_abv = tpl(T["ibu_abv"] if b["ibu"] is not None else T["noibu_abv"], W)
            text = tpl(T[key], dict(W, ibu_abv=ibu_abv))
        add("R3", clamp(pts, p["min"], p["max"]), "cut" if pts >= 0 else "penalty", key, p["evidence"], text)
        if x["heat"] >= V["V3"]["heat"] and abv >= V["V3"]["abv"] and not heat_lover:
            vetoes.append("V3")

    # ── R4 sweet_match + V2 ─────────────────────────────────────────────────
    p = P["R4"]
    if x["sweet"] >= p["min_sweet"]:
        gap = x["sweet"] - bv["sweet"]
        if gap <= p["tolerance"]:
            pts = p["base"] + p["k_match"] * bv["sweet"] * x["sweet"] if gap <= 0 else p["base"] * (1 - gap / p["tolerance"])
        else:
            pts = -p["k_gap"] * (gap - p["tolerance"])
        base_pts = pts
        contrast = (dessert and b["category"] in p["contrast_categories"] and bv["bitter"] >= p["contrast_bitter"]
                    and abs(dF) < p["contrast_dF"])
        # горячий чай/кофе к десерту: контраст терпкости и сладости, а не правило вина «sweets need sweets»
        hot = (dessert and not contrast and b["category"] in p["hot_contrast_categories"]
               and bv["serve_temp"] >= p["hot_contrast_min_temp"])
        if contrast:
            pts = max(pts, p["contrast_floor"])
        elif hot:
            pts = max(pts, p["hot_contrast_floor"])
            contrast = True
        choc_d = 0.0
        for t in p["choc_tags"]:
            choc_d = max(choc_d, d["tags"].get(t, 0.0))
        choc = min(bv["roast"], choc_d)
        roast_bonus_choc = p["choc"] * choc
        roast_bonus_sweet = p["roast_sweet"] * bv["roast"] * x["sweet"]
        pts += roast_bonus_choc
        pts += roast_bonus_sweet
        fruit = fsum(min(b["tags"].get(t, 0.0), d["tags"].get(t, 0.0)) for t in p["fruit_tags"])
        fruit_pts = p["fruit"] * min(fruit, p["fruit_max"]) * (1 if dessert else p["fruit_nondessert"])
        pts += fruit_pts
        if hot:
            key = "hot_contrast"
        elif contrast:
            key = "contrast"
        elif roast_bonus_choc + roast_bonus_sweet >= p["text_roast_min"] and (base_pts <= 0 or roast_bonus_choc + roast_bonus_sweet > base_pts):
            key = "roast" if roast_bonus_choc > 0 else "roast_sweet"
        elif gap <= 0:
            key = "match"
        elif gap <= p["tolerance"]:
            key = "near"
        else:
            key = "gap"
        text = ""
        if explain:
            T = p["texts"]
            text = tpl(T[key], W) + (T["fruit"] if fruit_pts >= p["text_fruit_min"] else "")
            # PAIR-8 #5: шаблон hot_contrast начинается с «Горячий», а у горячего шоколада
            # имя уже с «Горячий» — схлопываем дубль (напиток «Горячий Горячий шоколад»).
            if key == "hot_contrast":
                text = re.sub(r"\bГорячий\s+Горячий\b", "Горячий", text)
        add("R4", clamp(pts, p["min"], p["max"]), "contrast" if contrast else ("complement" if pts >= 0 else "penalty"),
            key, p["evidence"], text)
        if (dessert and x["sweet"] >= V["V2"]["dish_sweet"] and bv["sweet"] <= V["V2"]["drink_sweet"] and not contrast
                and bv["roast"] < V["V2"]["roast_exempt"]):
            vetoes.append("V2")

    # ── R5 acid_match ───────────────────────────────────────────────────────
    p = P["R5"]
    if x["sour"] >= p["min_sour"]:
        eff_sour = x["sour"] + (p["vinegar_bonus"] if d["vinegar"] else 0)
        eff_acid = max(bv["acid"], p["carb_as_acid"] * bv["carbonation"])
        gap = eff_sour - eff_acid
        pts = -p["k_gap"] * gap * (p["vinegar_mult"] if d["vinegar"] else 1) if gap > 0 else p["k_match"] * min(bv["acid"], x["sour"])
        t_tan = 0.0
        t_sweet = 0.0
        if bv["tannin"] >= p["tannin_threshold"]:
            t_tan = p["k_tannin"] * bv["tannin"] * x["sour"]
            pts -= t_tan
        if not dessert:
            t_sweet = p["k_sweet"] * pos(bv["sweet"] - p["sweet_threshold"]) * x["sour"]
            pts -= t_sweet
        if gap > 0:
            key = "vinegar_tannin" if d["vinegar"] and bv["tannin"] >= p["tannin_threshold"] else "flabby"
        else:
            key = "clean"
        text = ""
        if explain:
            T = p["texts"]
            text = tpl(T[key], W)
            if t_tan >= p["text_clause_min"] and key != "vinegar_tannin":
                text += T["tannin"]
            if t_sweet >= p["text_clause_min"]:
                text += T["sweet"]
        add("R5", clamp(pts, p["min"], p["max"]), "cut" if pts >= 0 else "penalty", key, p["evidence"], text)

    # ── R6 salt_modulation ──────────────────────────────────────────────────
    p = P["R6"]
    if x["salt"] >= p["min_salt"]:
        f_bit = bv["bitter"] * (1 - x["heat"])
        f_tan = p["forgive_tannin"] * bv["tannin"]
        forgive = p["k_forgive"] * x["salt"] * (f_bit + f_tan)
        clean = p["k_clean"] * x["salt"] * max(bv["acid"], bv["carbonation"])
        shield = 1 - p["shield"] * max(x["fat"], x["protein"])
        alco = -p["k_alco"] * x["salt"] * pos(alc - p["alco_threshold"]) / p["alco_span"] * shield
        tann = -p["k_tann"] * x["salt"] * pos(bv["tannin"] - p["tann_threshold"]) / p["tann_span"]
        snack = (p["snack_points"] if (x["salt"] >= p["snack_salt"] and x["weight"] <= p["snack_weight"]
                                        and bv["carbonation"] >= p["snack_carb"] and bv["bitter"] >= p["snack_bitter"]) else 0)
        forgive_c = min(forgive, p["forgive_max"])
        pts = forgive_c + clean + alco + tann + snack
        if pts >= 0:
            key, _ = _argmax([("forgive", forgive_c), ("clean", clean), ("snack", float(snack))])
            if key == "forgive":
                key = "forgive_bitter" if f_bit >= f_tan else "forgive_tannin"
            elif key == "clean":
                key = "clean_acid" if bv["acid"] >= bv["carbonation"] else "clean_carb"
        else:
            key, _ = _argmin([("alco", alco), ("tann", tann)])
        text = tpl(p["texts"][key], W) if explain else ""
        addfit("R6", clamp(pts, p["min"], p["max"]), "complement" if pts >= 0 else "penalty", key,
               p["evidence_forgive"] if key.startswith("forgive") else p["evidence"], text)

    # ── R7 umami ────────────────────────────────────────────────────────────
    p = P["R7"]
    if x["umami"] >= p["min_umami"]:
        match_pts = 0.0
        if x["salt"] < p["salt_gate"] and x["sour"] < p["sour_gate"]:
            pts = -p["k_neg"] * x["umami"] * (p["neg_tannin"] * bv["tannin"] + p["neg_bitter"] * bv["bitter"]
                                             + p["neg_alcohol"] * alc) * tol
        else:
            match_pts = p["k_match"] * min(bv["umami"], x["umami"])
            pts = p["k_pos"] * x["umami"] * (p["pos_bitter"] * bv["bitter"] + p["pos_acid"] * bv["acid"]) + match_pts
        key = "pos" if pts >= 0 else "neg"
        text = ""
        if explain:
            T = p["texts"]
            helper = T["helpers"]["bitter" if p["pos_bitter"] * bv["bitter"] >= p["pos_acid"] * bv["acid"] else "acid"]
            text = tpl(T[key], dict(W, helper=helper)) + (T["match"] if key == "pos" and match_pts >= p["text_match_min"] else "")
        addfit("R7", clamp(pts, p["min"], p["max"]), "complement" if pts >= 0 else "penalty", key, p["evidence"], text)

    # ── R8 tannin_protein + V4 ──────────────────────────────────────────────
    p = P["R8"]
    if bv["tannin"] >= p["min_tannin"]:
        pf = max(x["protein"], x["fat"])
        plus = p["k_plus"] * bv["tannin"] * pf * (1 if x["protein"] >= p["protein_gate"] else p["low_protein_mult"])
        fish = -p["k_fish"] * bv["tannin"] * x["fish_oil"]
        green = -p["k_green"] * bv["tannin"] * x["green_iron"]
        dry = -p["k_dry"] * bv["tannin"] * (1 - pf) if bv["tannin"] >= p["dry_threshold"] else 0
        pts = plus + fish * tol + green * tol + dry * tol
        if pts >= 0:
            key = "plus"
        else:
            key, _ = _argmin([("fish", fish), ("green", green), ("dry", float(dry))])
        text = tpl(p["texts"][key], W) if explain else ""
        addfit("R8", clamp(pts, p["min"], p["max"]), "complement" if pts >= 0 else "penalty", key, p["evidence"], text)
        if bv["tannin"] >= V["V4"]["tannin"] and x["fish_oil"] >= V["V4"]["fish_oil"]:
            vetoes.append("V4")

    # ── R9 delicate_fresh + V5 ──────────────────────────────────────────────
    p = P["R9"]
    if x["fresh"] >= p["min_fresh"]:
        t_carb = p["carbonation"] * bv["carbonation"]
        t_clean = p["clean"] * (1 - bv["aroma_intensity"])
        t_acid = p["acid"] * bv["acid"]
        t_roast = p["roast"] * bv["roast"]
        t_body = p["body"] * pos(bv["body"] - p["body_threshold"]) / p["body_span"]
        t_alc = p["alcohol"] * pos(alc - p["alcohol_threshold"]) / p["alcohol_span"]
        t_bit = p["bitter"] * pos(bv["bitter"] - p["bitter_threshold"]) / p["bitter_span"]
        t_smoke = p["smoke"] * bv["smoke"]
        pts = x["fresh"] * (t_carb + t_clean + t_acid - t_roast - t_body - t_alc - t_bit - t_smoke)
        t_fish = p["k_fish_hop"] * x["fish_oil"] * pos(bv["bitter"] - p["fish_hop_threshold"]) / p["fish_hop_span"]
        pts -= t_fish
        if pts >= 0:
            key, _ = _argmax([("carbonation", t_carb), ("clean", t_clean), ("acid", t_acid)])
        else:
            key, _ = _argmax([("roast", t_roast), ("body", t_body), ("alcohol", t_alc), ("bitter", t_bit),
                              ("smoke", t_smoke), ("fish_hop", t_fish)])
        text = tpl(p["texts"][key], W) if explain else ""
        add("R9", clamp(pts, p["min"], p["max"]), "cut" if pts >= 0 else "penalty", key, p["evidence"], text)
        if x["fresh"] >= V["V5"]["fresh"] and abv >= V["V5"]["abv"]:
            vetoes.append("V5")

    # ── R10 maillard_harmony ────────────────────────────────────────────────
    p = P["R10"]
    # Мост Майяра не применяем к газировке/воде/лимонаду: у колы высокий maillard-профиль
    # по нотам, но карамельно-жареного «моста» с блюдом там нет (PAIR-2).
    if x["maillard"] >= p["min_maillard"] and b["category"] not in p.get("skip_categories", ()):
        bt = b["tags"]
        m_terms = [("caramel", bt.get("caramel", 0.0)),
                   ("roast", bv["roast"] * max(x["smoke"], d["tags"].get("char", 0.0))),
                   ("bread", p["bread"] * bt.get("bread", 0.0)),
                   ("oak_vanilla", bt.get("oak_vanilla", 0.0)),
                   ("toast", p["toast"] * bt.get("toast", 0.0)),
                   ("nutty", p["nutty"] * bt.get("nutty", 0.0))]
        key, m = _argmax(m_terms)
        if m <= 0:
            key = "none"
        text = ""
        if explain:
            T = p["texts"]
            text = tpl(T["none"], W) if key == "none" else tpl(T["main"], dict(W, note=T["notes"][key]))
        addfit("R10", clamp(p["k"] * x["maillard"] * m, p["min"], p["max"]), "complement", key, p["evidence"], text)

    # ── R11 smoke_bridge ────────────────────────────────────────────────────
    p = P["R11"]
    if x["smoke"] >= p["min_smoke"]:
        s_smoke = p["k_smoke"] * min(x["smoke"], bv["smoke"])
        s_roast = p["k_roast"] * x["smoke"] * bv["roast"]
        key = "none" if s_smoke + s_roast <= 0 else "smoke" if s_smoke >= s_roast else "roast"
        text = tpl(p["texts"][key], W) if explain else ""
        addfit("R11", clamp(s_smoke + s_roast, p["min"], p["max"]), "bridge", key, p["evidence"], text)

    # ── R12 aroma_bridge (теги по sorted(), см. docstring) ─────────────────
    p = P["R12"]
    excl = p["exclude_tags"]
    shared_list: List[Tuple[str, float]] = []
    for t in sorted(b["tags"].keys()):
        if t in d["tags"] and t not in excl:
            shared_list.append((t, min(b["tags"][t], d["tags"][t])))
    shared = fsum(w for _, w in shared_list)
    if shared > 0:
        top = sorted(shared_list, key=lambda tw: -tw[1])[: p["text_top"]]
        text = ""
        if explain:
            names = ", ".join(P["labels"]["tags"].get(t, t) for t, _ in top)
            text = tpl(p["texts"]["main"], dict(W, tags=names))
        addfit("R12", clamp(p["k"] * shared, p["min"], p["max"]), "bridge", ",".join(t for t, _ in top), p["evidence"], text)

    # ── R14 same_on_same ────────────────────────────────────────────────────
    p = P["R14"]
    pen_bit = -p["k_bitter"] * bv["bitter"] * x["bitter"] * tol
    pen = pen_bit
    pen_sweet = 0.0
    if (b["category"] in p["sweet_categories"] and bv["sweet"] > p["sweet_threshold"]
            and x["sweet"] > p["sweet_threshold"] and not dessert):
        pen_sweet = -p["sweet_penalty"] * tol
        pen -= p["sweet_penalty"] * tol
    if pen < p["emit_below"]:
        key = "bitter" if pen_bit <= pen_sweet else "sweet"
        text = tpl(p["texts"][key], W) if explain else ""
        add("R14", clamp(pen, p["min"], p["max"]), "penalty", key, p["evidence"], text)

    # ── R13 both_principles (по уже посчитанным правилам) ──────────────────
    p = P["R13"]
    fams = set()
    for c in comps:
        if c["points"] >= p["min_pts"]:
            fams.add(c["family"])
    if ("cut" in fams or "contrast" in fams) and ("complement" in fams or "bridge" in fams):
        addfit("R13", p["points"], "balance", "both", p["evidence"], tpl(p["texts"]["main"], W) if explain else "")

    # ── R20 classic_pairs ───────────────────────────────────────────────────
    p = P["R20"]
    classic = _classic_lookup(classics, d, b)
    if classic is not None:
        bonus = p["bonus"]
        if classic.get("bonus") is not None:
            bonus = min(bonus, float(classic["bonus"]))
        bonus = min(bonus, p["max_bonus"])
        text = ""
        if explain:
            src = classic.get("source") or {}
            title = (src.get("title") if isinstance(src, dict) else str(src)) or classic.get("label") or p["texts"]["fallback_source"]
            text = tpl(p["texts"]["main"], dict(W, source=title))
        add("R20", bonus, "complement", "classic", p["evidence"], text)

    # ── R15 regional ────────────────────────────────────────────────────────
    p = P["R15"]
    shared_cuisine = None
    for c in d["cuisine"]:
        if c in b["origin"]:
            shared_cuisine = c
            break
    # «Международная кухня» — слишком общий признак (кола/газировка совпадают с чем угодно),
    # региональный бонус за него не даём (PAIR-2).
    if shared_cuisine is not None and shared_cuisine not in p.get("skip_cuisines", ()):
        text = ""
        if explain:
            cz = P["labels"]["cuisine"].get(shared_cuisine, P["labels"]["cuisine_default"])
            text = tpl(p["texts"]["main"], dict(W, cuisine=cz))
        add("R15", p["points"], "context", shared_cuisine, p["evidence"], text)

    # ── R16 occasion ────────────────────────────────────────────────────────
    p = P["R16"]
    occ = ctx.get("occasion")
    occ_pts: Optional[float] = None
    if occ == "meal":
        q = p["meal"]
        occ_pts = (q["light_bonus"] * (1 if (abv <= q["light_max_abv"] and bv["carbonation"] >= q["light_min_carb"]) else 0)
                   - (q["strong_penalty"] if (abv >= q["strong_min_abv"] and not dessert) else 0)
                   - q["k_alcohol"] * pos(alc - q["alcohol_threshold"]) / q["alcohol_span"])
    elif occ == "aperitif":
        q = p["aperitif"]
        occ_pts = (q["k_bitter_carb"] * bv["bitter"] * bv["carbonation"] + q["k_acid"] * bv["acid"]
                   - q["k_body"] * pos(bv["body"] - q["body_threshold"]))
    elif occ == "dessert":
        q = p["dessert"]
        occ_pts = (q["sweet_bonus"] * (1 if bv["sweet"] >= q["sweet_min"] else 0)
                   + q["alcohol_bonus"] * (1 if alc >= q["alcohol_min"] else 0))
    elif occ == "hot":
        q = p["hot"]
        occ_pts = q["carbonation"] * bv["carbonation"] + q["acid"] * bv["acid"] - q["alcohol"] * alc
    elif occ == "evening":
        q = p["evening"]
        occ_pts = q["body"] * bv["body"] + q["abv"] * clamp(abv / q["abv_scale"])
    elif occ == "party":
        q = p["party"]
        occ_pts = q["clean"] * (1 - bv["aroma_intensity"]) + q["carbonation"] * bv["carbonation"] - q["alcohol"] * alc
    elif occ == "gourmet":
        q = p["gourmet"]
        occ_pts = q["aroma_intensity"] * bv["aroma_intensity"] + q["tannin"] * bv["tannin"] + q["body"] * bv["body"]
    if occ_pts is not None:
        key = f"{occ}_{'pos' if occ_pts >= 0 else 'neg'}"
        add("R16", clamp(occ_pts, p["min"], p["max"]), "context", key, p["evidence"],
            tpl(p["texts"][key], W) if explain else "")

    # ── R17 personal ────────────────────────────────────────────────────────
    p = P["R17"]
    pref = float(ctx.get("bitter_pref") or 0.0)
    if pref != 0.0:
        q = p["bitter_pref"]
        bp = clamp(q["k"] * pref * (bv["bitter"] - q["center"]), -q["max"], q["max"])
        key = f"bitter_{'like' if pref > 0 else 'avoid'}_{'pos' if bp >= 0 else 'neg'}"
        add("R17_bitter", bp, "context", key, p["evidence"], tpl(p["texts"][key], W) if explain else "")
    spref = float(ctx.get("sweet_pref") or 0.0)
    if spref != 0.0:
        q = p["sweet_pref"]
        sp = clamp(q["k"] * spref * (bv["sweet"] - q["center"]), -q["max"], q["max"])
        key = f"sweet_{'like' if spref > 0 else 'avoid'}_{'pos' if sp >= 0 else 'neg'}"
        add("R17_sweet", sp, "context", key, p["evidence"], tpl(p["texts"][key], W) if explain else "")
    dna = ctx.get("dna")
    if dna:
        q = p["dna"]
        cs = cosine(bv, dna, q["axes"])
        dp = clamp(q["k"] * (cs - q["center"]), -q["max"], q["max"])
        key = "dna_pos" if dp >= 0 else "dna_neg"
        add("R17_dna", dp, "context", key, p["evidence"], tpl(p["texts"][key], W) if explain else "")

    # ── итог ────────────────────────────────────────────────────────────────
    S = P["score"]
    core = fsum(c["points"] for c in comps if c["family"] != "context")
    ctxp = fsum(c["points"] for c in comps if c["family"] == "context")
    raw = S["base"] + S["k"] * core + ctxp
    score = round_half_up(raw)
    capped = False
    for vid in CAP_VETOES:
        if vid in vetoes:
            score = min(score, V[vid]["cap"])
            capped = True
    score = int(clamp(score, S["min"], S["max"]))

    na_limit = non_alcoholic_limit(ctx, P)
    excluded = na_limit is not None and abv > na_limit
    if excluded:
        vetoes.append("V7")
    vetoes = [vid for vid in V["order"] if vid in vetoes]

    # ── механизмы, причины, предупреждения, тип пары ────────────────────────
    M = P["mechanisms"]
    mechanisms = [c for c in comps if abs(c["points"]) >= M["min_abs"]]
    order = {id(c): i for i, c in enumerate(comps)}
    reasons = sorted([c for c in mechanisms if c["points"] > 0], key=lambda c: (-c["points"], order[id(c)]))[: M["reasons_top"]]
    negatives = sorted([c for c in mechanisms if c["points"] < 0], key=lambda c: (c["points"], order[id(c)]))
    veto_items = []
    for vid in vetoes:
        vp = V[vid]
        vtext = ""
        if explain:
            vtext = tpl(vp["text"], dict(W, max_abv=fmt_num(na_limit) if na_limit is not None else ""))
        veto_items.append({"rule": vid, "family": "veto", "points": 0.0, "key": vid, "evidence": vp["evidence"],
                           "cap": vp.get("cap"), "text": vtext})
    warnings = veto_items + negatives

    cands = [c for c in comps if c["family"] in M["families"] and c["rule"] not in M["exclude_rules"] and c["points"] > 0]
    best = None
    for c in cands:
        if best is None or c["points"] > best["points"]:
            best = c
    worst = None
    for c in comps:
        if c["family"] != "context" and c["rule"] not in ("R13", "R20") and c["points"] < 0:
            if worst is None or c["points"] < worst["points"]:
                worst = c
    if capped or (score < M["penalty_below"] and worst is not None
                  and (best is None or -worst["points"] > best["points"])):
        match_type = "penalty"
        secondary = best["family"] if best is not None and best["points"] >= M["secondary_min"] else None
    elif best is not None:
        match_type = best["family"]
        secondary = None
        sec_best = None
        for c in cands:
            if c["family"] != match_type and c["points"] >= M["secondary_min"]:
                if sec_best is None or c["points"] > sec_best["points"]:
                    sec_best = c
        if sec_best is not None:
            secondary = sec_best["family"]
    else:
        match_type = M["fallback_type"]
        secondary = None

    band = band_for(score, capped, P, confidence=b.get("vector_confidence"))
    return {
        "engine": "v2",
        "version": P.get("version", ENGINE_VERSION),
        "drink_id": b["id"],
        "dish_id": d["id"],
        "drink_name": b["name"],
        "dish_name": d["name"],
        "category": b["category"],
        "family": b["family"],
        "archetype": b["archetype"],
        "efes_relation": b["efes_relation"],
        "efes_partner": is_efes_relation(b["efes_relation"], P),
        "abv": b["abv"],
        "score": score,
        "band": band["id"],
        "band_label": band["label"],
        "match_type": match_type,
        "secondary_type": secondary,
        "mechanisms": mechanisms,
        "reasons": reasons,
        "warnings": warnings,
        "vetoes": vetoes,
        "capped": capped,
        "excluded": excluded,
        "classic": classic is not None,
        "W_B": r2(wb), "F_B": r2(fb), "W_D": r2(wd), "F_D": r2(fd),
        "W_B_eff": r2(it["W_B_eff"]), "dW": r2(dW), "dF": r2(dF), "fit": r2(fit),
        "core": r2(core), "ctx_points": r2(ctxp), "raw": r2(raw),
        "components": comps,
    }


# ─────────────────────────────────────────────────────────────────────────────
# выдача: политика Efes, диверсификация, вкладки категорий, обратный подбор
# ─────────────────────────────────────────────────────────────────────────────
def partner_order(results: List[Dict[str, Any]], params: Optional[Dict[str, Any]] = None,
                  window: Optional[float] = None) -> List[Dict[str, Any]]:
    """Политика Efes (V2_CONTRACT.md): баллы не меняются; напиток Efes (efes_partner) ставится выше не-Efes,
    только если уступает ему не более чем на window баллов.

    Жадный алгоритм (детерминированный, легко портируется): остаток отсортирован по (−score, drink_id);
    на каждом шаге top = балл первого в остатке; среди элементов с баллом ≥ top − window берётся первый Efes,
    иначе — первый элемент. Свойства: (1) если i стоит выше j при score_i < score_j, то i — Efes, j — нет и
    score_j − score_i ≤ window; (2) любой Efes, отстающий от не-Efes не более чем на window, стоит выше него."""
    P = params or default_params()
    w = P["recommend"]["partner_tie_window"] if window is None else window
    rem = sorted(results, key=lambda r: (-r["score"], r["drink_id"]))
    out: List[Dict[str, Any]] = []
    while rem:
        top = rem[0]["score"]
        pick = 0
        for i, r in enumerate(rem):
            if r["score"] < top - w:
                break
            if r["efes_partner"]:
                pick = i
                break
        out.append(rem.pop(pick))
    return out


def best_partner(results: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Лучший напиток Efes с честным баллом (ключ −score, drink_id)."""
    best = None
    for r in sorted(results, key=lambda r: (-r["score"], r["drink_id"])):
        if r["efes_partner"]:
            best = r
            break
    return best


def _is_na_option(r: Dict[str, Any], max_abv: float, na_flags: Dict[str, bool]) -> bool:
    return bool(na_flags.get(r["drink_id"])) or r["abv"] <= max_abv


def _diversify(ranked: List[Dict[str, Any]], top_n: int, P: Dict[str, Any], guarantee: bool,
               na_flags: Dict[str, bool]) -> List[Dict[str, Any]]:
    D = P["recommend"]["diversify"]
    cap = D["max_per_group"]
    min_score = D["min_score_guarantee"]
    beer_cats = D["beer_categories"]

    def group(r: Dict[str, Any]) -> str:
        return str(r.get(D["group_by"]) or r.get("archetype") or r.get("category"))

    def is_na(r: Dict[str, Any]) -> bool:
        return _is_na_option(r, D["na_max_abv"], na_flags)

    def is_nonbeer(r: Dict[str, Any]) -> bool:
        return r["category"] not in beer_cats

    # Шаг 1: жадно по ranked, не больше cap на группу. picked — список выбранных (порядок добавления),
    # in_picked — множество drink_id; «остаток» = ranked без in_picked (всегда обходится в порядке ranked).
    picked: List[Dict[str, Any]] = []
    in_picked: set = set()
    counts: Dict[str, int] = {}
    for r in ranked:
        g = group(r)
        if len(picked) < top_n and counts.get(g, 0) < cap:
            picked.append(r)
            in_picked.add(r["drink_id"])
            counts[g] = counts.get(g, 0) + 1

    def force(pred, protect) -> None:
        """Шаг 2: гарантия (pred) — если среди выбранных нет подходящего, берём лучший подходящий из остатка
        с баллом ≥ min_score; при полном списке вытесняем самый нижний выбранный (из той же группы, если
        группа кандидата заполнена), не трогая единственного носителя уже выполненной гарантии (protect)."""
        for r in picked:
            if pred(r):
                return
        cand = None
        for r in ranked:
            if r["drink_id"] not in in_picked and pred(r) and r["score"] >= min_score:
                cand = r
                break
        if cand is None:
            return
        if len(picked) < top_n:
            picked.append(cand)
            in_picked.add(cand["drink_id"])
            return
        g = group(cand)
        full = len([r for r in picked if group(r) == g]) >= cap

        def protected(v: Dict[str, Any]) -> bool:
            for pp in protect:
                if pp(v) and len([y for y in picked if pp(y)]) == 1:
                    return True
            return False

        victim_i = -1
        for i in range(len(picked) - 1, -1, -1):
            v = picked[i]
            if full and group(v) != g:
                continue
            if protected(v):
                continue
            victim_i = i
            break
        if victim_i < 0 and full:
            for i in range(len(picked) - 1, -1, -1):
                if not protected(picked[i]):
                    victim_i = i
                    break
        if victim_i < 0:
            return
        victim = picked.pop(victim_i)
        in_picked.discard(victim["drink_id"])
        picked.append(cand)
        in_picked.add(cand["drink_id"])

    # «самый нижний выбранный» = последний по позиции в ranked → держим picked в порядке ranked перед force
    index = {r["drink_id"]: i for i, r in enumerate(ranked)}
    if guarantee:
        picked.sort(key=lambda r: index[r["drink_id"]])
        force(is_na, [])
        picked.sort(key=lambda r: index[r["drink_id"]])
        force(is_nonbeer, [is_na])
    # Шаг 3: если групповой лимит оставил пустые места — добираем по порядку ranked без лимита.
    for r in ranked:
        if len(picked) >= top_n:
            break
        if r["drink_id"] not in in_picked:
            picked.append(r)
            in_picked.add(r["drink_id"])
    picked.sort(key=lambda r: index[r["drink_id"]])
    return picked


def _scored_pool(dish: Dict[str, Any], drinks: Iterable[Dict[str, Any]], ctx: Dict[str, Any], P: Dict[str, Any],
                 classics: Any, categories: Optional[Iterable[str]], venue_drink_ids: Optional[Iterable[str]],
                 explain: bool) -> Tuple[List[Dict[str, Any]], List[str], Dict[str, bool]]:
    d = dish_vector(dish, P)
    cidx = index_classics(classics) if isinstance(classics, list) else classics
    cat_set = set(categories) if categories else None
    venue_set = set(venue_drink_ids) if venue_drink_ids is not None else None
    pool: List[Dict[str, Any]] = []
    excluded: List[str] = []
    na_flags: Dict[str, bool] = {}
    seen = set()
    for raw in drinks:
        b = drink_vector(raw, P)
        if b["id"] in seen:
            continue
        seen.add(b["id"])
        if cat_set is not None and b["category"] not in cat_set:
            continue
        if venue_set is not None and b["id"] not in venue_set:
            continue
        r = score_pair(b, d, ctx, P, cidx, explain)
        if r["excluded"]:
            excluded.append(b["id"])
            continue
        na_flags[b["id"]] = b["non_alcoholic_flag"]
        pool.append(r)
    return pool, excluded, na_flags


def recommend(dish: Dict[str, Any], drinks: Iterable[Dict[str, Any]], ctx: Optional[Dict[str, Any]] = None,
              top_n: Optional[int] = None, params: Optional[Dict[str, Any]] = None, classics: Any = None,
              categories: Optional[Iterable[str]] = None, venue_drink_ids: Optional[Iterable[str]] = None,
              explain: bool = True) -> Dict[str, Any]:
    """Топ-N напитков к блюду (§5.4 + политика Efes).

    Фильтры: categories (или ctx.categories), venue_drink_ids (или ctx.venue_drink_ids), V7 (ctx non_alcoholic).
    Порядок: partner_order (tie-window); затем диверсификация: ≤ max_per_group на style.family; если категории не
    ограничены — гарантия одной безалкогольной и одной не-пивной позиции с баллом ≥ min_score_guarantee.
    top_n=0 — весь отсортированный пул без диверсификации."""
    P = params or default_params()
    ctx = dict(ctx or {})
    if categories is None:
        categories = ctx.get("categories")
    if venue_drink_ids is None:
        venue_drink_ids = ctx.get("venue_drink_ids")
    n = P["recommend"]["top_n"] if top_n is None else top_n
    pool, excluded, na_flags = _scored_pool(dish, drinks, ctx, P, classics, categories, venue_drink_ids, explain)
    ranked = partner_order(pool, P)
    items = _diversify(ranked, n, P, guarantee=not categories, na_flags=na_flags) if n else ranked
    window = P["recommend"]["partner_tie_window"]
    return {
        "engine": "v2",
        "dish_id": dish_vector(dish, P)["id"],
        "items": items,
        "best_partner": best_partner(pool),
        "n_candidates": len(pool),
        "excluded_non_alcoholic": excluded,
        "policy": {"partner_tie_window": window,
                   "note": tpl(P["recommend"]["policy_note"], {"window": fmt_num(window)})},
    }


def by_category(dish: Dict[str, Any], drinks: Iterable[Dict[str, Any]], ctx: Optional[Dict[str, Any]] = None,
                params: Optional[Dict[str, Any]] = None, classics: Any = None, per_category: int = 1,
                venue_drink_ids: Optional[Iterable[str]] = None, explain: bool = True) -> Dict[str, Any]:
    """Лучшие напитки в каждой категории (вкладки UI). Порядок категорий — CATEGORIES, неизвестные — по алфавиту в конце."""
    P = params or default_params()
    ctx = dict(ctx or {})
    if venue_drink_ids is None:
        venue_drink_ids = ctx.get("venue_drink_ids")
    pool, excluded, _ = _scored_pool(dish, drinks, ctx, P, classics, ctx.get("categories"), venue_drink_ids, explain)
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for r in pool:
        groups.setdefault(r["category"], []).append(r)
    cats = [c for c in CATEGORIES if c in groups] + sorted(c for c in groups if c not in CATEGORIES)
    out = []
    for c in cats:
        ranked = partner_order(groups[c], P)
        out.append({"category": c, "label": P["labels"]["category"].get(c, c), "n": len(ranked),
                    "best": ranked[0], "items": ranked[: max(1, per_category)]})
    return {"engine": "v2", "dish_id": dish_vector(dish, P)["id"], "categories": out,
            "best_partner": best_partner(pool), "excluded_non_alcoholic": excluded}


def reverse(drink: Dict[str, Any], dishes: Iterable[Dict[str, Any]], ctx: Optional[Dict[str, Any]] = None,
            top_n: Optional[int] = None, params: Optional[Dict[str, Any]] = None, classics: Any = None,
            explain: bool = True) -> Dict[str, Any]:
    """Лучшие блюда к напитку: сортировка (−score, dish_id); top_n=0 — все."""
    P = params or default_params()
    ctx = dict(ctx or {})
    b = drink_vector(drink, P)
    cidx = index_classics(classics) if isinstance(classics, list) else classics
    results = [score_pair(b, d, ctx, P, cidx, explain) for d in dishes]
    results.sort(key=lambda r: (-r["score"], r["dish_id"]))
    n = P["recommend"]["reverse_top_n"] if top_n is None else top_n
    excluded = bool(results) and results[0]["excluded"]
    return {"engine": "v2", "drink_id": b["id"], "items": results[:n] if n else results, "excluded": excluded}

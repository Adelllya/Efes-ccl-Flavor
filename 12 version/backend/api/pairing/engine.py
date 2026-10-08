"""
Flavor Tree Pairing Engine v1.0
================================

Идея: и пиво, и блюдо переводятся в числовые «сенсорные векторы» (0..1 по осям),
после чего набор именованных правил гастрономии начисляет/снимает баллы.
Итог = 30 + 0.9·Σ правил, ограничено [3, 99] (см. SCORE_BASE / SCORE_K). Каждое правило объяснимо словами —
это и есть «почему подходит», которое видит гость.

ПИВО → вектор (10 осей):
    bitter, body, malt_sweet, carbonation, hop_aroma, roast, alcohol, caramel, fruit, clean
    Источник: вкусовая пирамида (ноты × интенсивность) поверх «приора» стиля.
    value = prior + (1 - prior) * combined_notes ;  combined = max + 0.35 * (sum - max)
    ABV дополнительно поднимает alcohol и body.

БЛЮДО → вектор (13 осей):
    salt, sweet, sour, bitter, umami, heat, fat, weight, smoke, maillard, fresh, cream, spice
    Источник: data/dishes.json (сгенерировано из классификации + ручная правка).

ПРАВИЛА (points):
    R1  intensity   — интенсивности должны совпадать (Cicerone #1)          [-15 .. +22]
    R2  cut         — жир/тяжесть/сливочность × (горечь + карбонизация)      [0 .. +20]
    R3  heat        — острое любит солод/пузырьки, не любит хмель/алкоголь  [-15 .. +20]
    R4  salt        — соль смягчает горечь и подчёркивает солод              [0 .. +12]
    R5  sweet       — десерт не должен быть слаще пива                        [-18 .. +25]
    R6  sour        — кислое → чистые, игристые, лёгкие                       [-10 .. +14]
    R7  umami       — умами дружит с солодом/телом, деликатное умами — не с хмелем [-6 .. +16]
    R8  fresh       — деликатное/сырое → чистота и лёгкость                   [-12 .. +14]
    R9  roast/smoke — корочка и дым ↔ карамель/обжарка/солод; дым ↔ хмель     [0 .. +18]
    R10 bridge      — общие ароматические теги (мост), 12 × Σ min(w)            [0 .. +18]
    R11 curated     — вердикт сомелье из 51 кураторской пары                  [-16 .. +16]
    R12 context     — повод, предпочтение горечи                              [-8 .. +10]
    R13 dna         — близость к личному профилю Flavor DNA                   [-8 .. +8]
"""
from __future__ import annotations

import math
from typing import Any, Dict, Iterable, List, Optional

BEER_AXES = ["bitter", "body", "malt_sweet", "carbonation", "hop_aroma",
             "roast", "alcohol", "caramel", "fruit", "clean"]
DISH_AXES = ["salt", "sweet", "sour", "bitter", "umami", "heat", "fat",
             "weight", "smoke", "maillard", "fresh", "cream", "spice"]

PAIRING_TYPES = ("COMPLEMENT", "CONTRAST", "CLEANSE", "BRIDGE")

# Калибровка шкалы: Σ правил по матрице 17×50 лежит в [-14, +76], медиана ≈ 38.
# score = 30 + 0.9·Σ → медиана ≈ 65, лучшие пары 88–97, неудачные 20–45.
SCORE_BASE = 30.0
SCORE_K = 0.9

TYPE_LABELS = {
    "COMPLEMENT": "Complement · дополнение",
    "CONTRAST": "Contrast · контраст",
    "CLEANSE": "Cleanse · очищение",
    "BRIDGE": "Bridge · мост",
}

ARCHETYPES = [
    {"id": "hop-explorer", "name": "Хмелевой исследователь", "emoji": "🌿",
     "tagline": "Любишь, когда горечь звучит ярко и долго.",
     "vector": {"bitter": .85, "body": .5, "malt_sweet": .3, "carbonation": .6, "hop_aroma": .9,
                "roast": .1, "alcohol": .45, "caramel": .1, "fruit": .3, "clean": .25}},
    {"id": "malt-classic", "name": "Солодовый классик", "emoji": "🌾",
     "tagline": "Хлеб, зерно, мягкое тело — вкус, которому доверяешь.",
     "vector": {"bitter": .45, "body": .65, "malt_sweet": .75, "carbonation": .5, "hop_aroma": .35,
                "roast": .15, "alcohol": .35, "caramel": .4, "fruit": .1, "clean": .35}},
    {"id": "crisp-minimalist", "name": "Освежающий минималист", "emoji": "❄️",
     "tagline": "Чисто, холодно, легко — пиво как глоток воздуха.",
     "vector": {"bitter": .3, "body": .25, "malt_sweet": .3, "carbonation": .85, "hop_aroma": .3,
                "roast": .0, "alcohol": .25, "caramel": .05, "fruit": .15, "clean": .9}},
    {"id": "bold-philosopher", "name": "Крепкий философ", "emoji": "🔥",
     "tagline": "Плотное тело и тепло — вечер должен быть насыщенным.",
     "vector": {"bitter": .6, "body": .85, "malt_sweet": .55, "carbonation": .4, "hop_aroma": .4,
                "roast": .25, "alcohol": .85, "caramel": .4, "fruit": .15, "clean": .15}},
    {"id": "amber-gourmet", "name": "Янтарный гурман", "emoji": "🍯",
     "tagline": "Карамель, тоффи, корочка — вкус с историей.",
     "vector": {"bitter": .4, "body": .6, "malt_sweet": .65, "carbonation": .5, "hop_aroma": .3,
                "roast": .3, "alcohol": .4, "caramel": .85, "fruit": .15, "clean": .2}},
]


# ─────────────────────────────────────────────────────────────────────────────
# helpers
# ─────────────────────────────────────────────────────────────────────────────
def clamp(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else hi if x > hi else x


def cosine(a: Dict[str, float], b: Dict[str, float], axes: Iterable[str]) -> float:
    dot = na = nb = 0.0
    for k in axes:
        x = a.get(k, 0.0)
        y = b.get(k, 0.0)
        dot += x * y
        na += x * x
        nb += y * y
    if na == 0 or nb == 0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


def _r2(x: float) -> float:
    # floor(x·100 + 0.5) — совпадает с JS Math.round (Python round() — банковское, 72.5 → 72)
    return math.floor(x * 100 + 0.5) / 100


def _round_half_up(x: float) -> int:
    return int(math.floor(x + 0.5))


def _fsum(values: Iterable[float]) -> float:
    """Наивное суммирование слева направо — как в JS. Встроенный sum() в Python ≥ 3.12
    использует компенсированное суммирование и ломает паритет с TypeScript-портом."""
    acc = 0.0
    for v in values:
        acc += v
    return acc


# ─────────────────────────────────────────────────────────────────────────────
# profiles
# ─────────────────────────────────────────────────────────────────────────────
def build_beer_profile(brand: Dict[str, Any], notes_by_id: Dict[str, Dict[str, Any]],
                       priors: Dict[str, Dict[str, float]]) -> Dict[str, Any]:
    """Пирамида + стиль + ABV → сенсорный вектор пива, теги-мосты, уверенность."""
    prior = priors.get(brand.get("style_family") or "LAGER") or priors["LAGER"]
    contribs: Dict[str, List[float]] = {a: [] for a in BEER_AXES}
    tags: Dict[str, float] = {}
    layers = set()
    n_notes = 0
    for p in brand.get("pyramid") or []:
        note = notes_by_id.get(p["note_id"])
        if not note:
            continue
        n_notes += 1
        layers.add(p["layer"])
        w = clamp(p["intensity"] / 10.0, 0.0, 1.0)
        for axis, k in (note.get("axes") or {}).items():
            if axis in contribs:
                contribs[axis].append(w * k)
        for t in note.get("tags") or []:
            tags[t] = max(tags.get(t, 0.0), w)

    vec: Dict[str, float] = {}
    for a in BEER_AXES:
        cs = contribs[a]
        if cs:
            mx = max(cs)
            combined = clamp(mx + 0.35 * (_fsum(cs) - mx), 0.0, 1.0)
        else:
            combined = 0.0
        p0 = prior.get(a, 0.0)
        vec[a] = clamp(p0 + (1.0 - p0) * combined, 0.0, 1.0)

    abv = float(brand.get("abv") or 4.5)
    vec["alcohol"] = max(vec["alcohol"], clamp((abv - 3.5) / 5.0, 0.0, 1.0))
    vec["body"] = clamp(vec["body"] + max(0.0, abv - 5.0) * 0.08, 0.0, 1.0)

    # явный override сомелье (админка) имеет приоритет
    for a, v in (brand.get("vector_override") or {}).items():
        if a in vec:
            vec[a] = clamp(float(v), 0.0, 1.0)

    confidence = min(1.0, n_notes / 5.0) * (len(layers) / 3.0)
    vec = {a: _r2(vec[a]) for a in BEER_AXES}
    return {
        "id": brand["id"],
        "name": brand.get("display_name") or brand["name"],
        "vector": vec,
        "tags": {k: _r2(v) for k, v in tags.items()},
        "intensity": _r2(intensity_beer(vec)),
        "confidence": _r2(confidence),
        "brand": brand,
    }


def build_dish_profile(dish: Dict[str, Any]) -> Dict[str, Any]:
    vec = {a: float((dish.get("vector") or {}).get(a, 0.0)) for a in DISH_AXES}
    raw_tags = dish.get("tags") or []
    tags = {t: 1.0 for t in raw_tags} if isinstance(raw_tags, list) else {k: float(v) for k, v in raw_tags.items()}
    return {
        "id": dish["id"],
        "name": dish.get("display_name") or dish["name"],
        "vector": vec,
        "tags": tags,
        "intensity": _r2(intensity_dish(vec)),
        "dish": dish,
    }


def intensity_dish(d: Dict[str, float]) -> float:
    return clamp(0.30 * d["weight"] + 0.22 * d["fat"] + 0.15 * d["heat"] + 0.10 * d["umami"]
                 + 0.08 * d["smoke"] + 0.05 * d["salt"] + 0.10 * d["sweet"], 0.0, 1.0)


def intensity_beer(b: Dict[str, float]) -> float:
    return clamp(0.30 * b["body"] + 0.25 * b["bitter"] + 0.20 * b["alcohol"] + 0.15 * b["roast"]
                 + 0.10 * b["malt_sweet"], 0.0, 1.0)


# ─────────────────────────────────────────────────────────────────────────────
# rules
# ─────────────────────────────────────────────────────────────────────────────
def _c(rule: str, points: float, family: str, text: str) -> Dict[str, Any]:
    return {"rule": rule, "points": _r2(points), "family": family, "text": text}


def rule_intensity(b: Dict[str, float], d: Dict[str, float]) -> Dict[str, Any]:
    ib, idd = intensity_beer(b), intensity_dish(d)
    diff = abs(ib - idd)
    pts = clamp(22.0 - 60.0 * diff, -15.0, 22.0)
    if diff < 0.12:
        text = "Интенсивность пива и блюда совпадают — никто никого не перекрикивает"
    elif ib > idd:
        text = "Пиво мощнее блюда: рискует заглушить его вкус" if diff > 0.3 else "Пиво чуть плотнее блюда — ведёт в паре"
    else:
        text = "Блюдо мощнее пива: напиток потеряется на его фоне" if diff > 0.3 else "Блюдо чуть ярче пива — пиво играет роль фона"
    return _c("intensity", pts, "COMPLEMENT", text)


def rule_cut(b: Dict[str, float], d: Dict[str, float]) -> Optional[Dict[str, Any]]:
    # жир, тяжесть или сливочность обволакивают язык — горечь и пузырьки это смывают
    richness = max(d["fat"], 0.6 * d["weight"], 0.8 * d["cream"])
    if richness < 0.3:
        return None
    bit = 0.55 * b["bitter"]
    carb = 0.45 * b["carbonation"]
    pts = 20.0 * richness * (bit + carb)
    if bit >= carb:
        return _c("cut", pts, "CONTRAST", "Хмелевая горечь «режет» жирность и обновляет рецепторы")
    return _c("cut", pts, "CLEANSE", "Карбонизация смывает жир с языка — каждый глоток как первый")


def rule_heat(b: Dict[str, float], d: Dict[str, float]) -> Optional[Dict[str, Any]]:
    heat = d["heat"]
    if heat < 0.15:
        return None
    soothe = 14.0 * b["malt_sweet"] + 8.0 * b["carbonation"] + 6.0 * b["clean"]
    amplify = 16.0 * max(0.0, b["bitter"] - 0.4) + 14.0 * max(0.0, b["alcohol"] - 0.45)
    pts = clamp(heat * (soothe - amplify), -15.0, 20.0)
    if pts >= 0:
        return _c("heat", pts, "CLEANSE", "Солодовая мягкость и пузырьки гасят остроту, не споря с ней")
    return _c("heat", pts, "CLEANSE", "Хмель и алкоголь усиливают жжение перца — пара будет «горячее», чем хочется")


def rule_salt(b: Dict[str, float], d: Dict[str, float]) -> Optional[Dict[str, Any]]:
    salt = d["salt"]
    if salt < 0.35:
        return None
    pts = salt * (6.0 * b["carbonation"] + 5.0 * b["malt_sweet"] + 3.0 * b["bitter"])
    if salt >= 0.7 and d["weight"] <= 0.45:
        # классическая «пивная закуска»: курт, брецель, эдамаме — соль + пузырьки = жажда
        pts += 6.0 * b["carbonation"] + 3.0 * b["clean"]
        return _c("salt", pts, "COMPLEMENT", "Солёная закуска — классика к пиву: соль будит жажду, пузырьки её утоляют")
    return _c("salt", pts, "COMPLEMENT", "Соль смягчает горечь и подчёркивает солодовую сладость")


def rule_sweet(b: Dict[str, float], d: Dict[str, float]) -> Optional[Dict[str, Any]]:
    sweet = d["sweet"]
    if sweet < 0.3:
        return None
    pts = sweet * (18.0 * b["malt_sweet"] + 10.0 * b["caramel"] + 6.0 * b["roast"]
                   - 22.0 * max(0.0, b["bitter"] - b["malt_sweet"]))
    pts = clamp(pts, -18.0, 25.0)
    if pts >= 0:
        return _c("sweet", pts, "COMPLEMENT", "Солодовая сладость держит уровень десерта — пиво не кажется горьким")
    return _c("sweet", pts, "COMPLEMENT", "Десерт слаще пива: на его фоне пиво покажется резким и водянистым")


def rule_sour(b: Dict[str, float], d: Dict[str, float]) -> Optional[Dict[str, Any]]:
    sour = d["sour"]
    if sour < 0.3:
        return None
    pts = sour * (10.0 * b["carbonation"] + 6.0 * b["clean"] - 8.0 * b["roast"]
                  - 6.0 * max(0.0, b["body"] - 0.6) - 4.0 * max(0.0, b["malt_sweet"] - 0.6))
    pts = clamp(pts, -10.0, 14.0)
    if pts >= 0:
        return _c("sour", pts, "CLEANSE", "Кислинка блюда и игристая чистота пива освежают друг друга")
    return _c("sour", pts, "CLEANSE", "Плотное сладковатое пиво спорит с кислотой блюда")


def rule_umami(b: Dict[str, float], d: Dict[str, float]) -> Optional[Dict[str, Any]]:
    um = d["umami"]
    if um < 0.3:
        return None
    pts = um * (10.0 * b["malt_sweet"] + 6.0 * b["body"] + 4.0 * b["roast"]
                - 8.0 * max(0.0, b["bitter"] - 0.6) * (1.0 - d["fat"]))
    pts = clamp(pts, -6.0, 16.0)
    if pts >= 0:
        return _c("umami", pts, "COMPLEMENT", "Умами мяса/бульона отзеркаливается солодовым телом пива")
    return _c("umami", pts, "COMPLEMENT", "Сильный хмель на деликатном умами даёт металлический привкус")


def rule_fresh(b: Dict[str, float], d: Dict[str, float]) -> Optional[Dict[str, Any]]:
    fr = d["fresh"]
    if fr < 0.3:
        return None
    pts = fr * (8.0 * b["clean"] + 6.0 * b["carbonation"] + 3.0 * b["hop_aroma"] - 10.0 * b["roast"]
                - 8.0 * max(0.0, b["alcohol"] - 0.5) - 6.0 * max(0.0, b["body"] - 0.55))
    pts = clamp(pts, -12.0, 14.0)
    if pts >= 0:
        return _c("fresh", pts, "CLEANSE", "Лёгкое чистое пиво не перебивает свежесть и деликатность блюда")
    return _c("fresh", pts, "CLEANSE", "Тяжёлое или крепкое пиво давит деликатное блюдо")


def rule_roast(b: Dict[str, float], d: Dict[str, float]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    crust = max(d["maillard"], d["smoke"])
    if crust >= 0.3:
        pts = 12.0 * crust * max(b["caramel"], b["roast"], 0.7 * b["malt_sweet"])
        out.append(_c("roast", pts, "COMPLEMENT", "Корочка и карамелизация блюда перекликаются с солодом и карамелью пива"))
    if d["smoke"] >= 0.3:
        pts = 6.0 * d["smoke"] * b["hop_aroma"]
        out.append(_c("smoke", pts, "BRIDGE", "Смолистый хмель вторит дымку гриля"))
    return out


def rule_bridge(bt: Dict[str, float], dt: Dict[str, float]) -> Optional[Dict[str, Any]]:
    shared = [(t, min(bt[t], dt[t])) for t in bt if t in dt]
    if not shared:
        return None
    total = _fsum(w for _, w in shared)
    pts = clamp(12.0 * total, 0.0, 18.0)
    shared.sort(key=lambda x: -x[1])
    names = ", ".join(TAG_LABELS.get(t, t) for t, _ in shared[:3])
    c = _c("bridge", pts, "BRIDGE", f"Общие ароматы — {names} — строят «мост» между пивом и блюдом")
    c["tags"] = [t for t, _ in shared[:3]]
    return c


def rule_curated(curated: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not curated:
        return None
    pts = (int(curated.get("score", 3)) - 3) * 8.0
    c = _c("curated", pts, curated.get("type", "COMPLEMENT"), curated.get("explanation", "Вердикт сомелье"))
    c["curated_score"] = int(curated.get("score", 3))
    return c


def rule_context(b: Dict[str, float], ctx: Dict[str, Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    occ = ctx.get("occasion")
    if occ == "hot":
        out.append(_c("occasion", 8.0 * b["carbonation"] + 4.0 * b["clean"] - 6.0 * b["alcohol"], "CONTEXT",
                      "Жаркий день: ценим свежесть и лёгкость"))
    elif occ == "evening":
        out.append(_c("occasion", 6.0 * b["body"] + 4.0 * b["alcohol"] + 2.0 * b["caramel"], "CONTEXT",
                      "Вечер: плотное тело и тепло звучат уместнее"))
    elif occ == "party":
        out.append(_c("occasion", 5.0 * b["clean"] + 3.0 * b["carbonation"] - 5.0 * b["alcohol"], "CONTEXT",
                      "Компания: питкое пиво, которое не утомляет"))
    elif occ == "gourmet":
        out.append(_c("occasion", 4.0 * b["hop_aroma"] + 4.0 * b["caramel"] + 2.0 * b["body"], "CONTEXT",
                      "Гастро-вечер: чем сложнее ароматика, тем интереснее"))
    pref = float(ctx.get("bitter_pref") or 0.0)
    if pref != 0.0:
        pts = clamp(16.0 * pref * (b["bitter"] - 0.5), -8.0, 8.0)
        out.append(_c("bitter_pref", pts, "CONTEXT",
                      "Ты любишь горечь — плюс к хмелевым сортам" if pref > 0 else "Ты избегаешь горечи — минус хмелевым сортам"))
    return out


def rule_dna(b: Dict[str, float], dna: Optional[Dict[str, float]]) -> Optional[Dict[str, Any]]:
    if not dna:
        return None
    cos = cosine(b, dna, BEER_AXES)
    pts = clamp(40.0 * (cos - 0.85), -8.0, 8.0)
    return _c("dna", pts, "CONTEXT", "Совпадает с твоим Flavor DNA" if pts >= 0 else "Далеко от твоего Flavor DNA")


TAG_LABELS = {
    "bread": "хлеб", "grain": "зерно", "caramel": "карамель", "toffee": "тоффи", "honey": "мёд", "herbs": "травы",
    "pine": "хвоя", "grass": "трава", "floral": "цветы", "citrus": "цитрус", "lime": "лайм", "lemon": "лимон",
    "apple": "яблоко", "pear": "груша", "banana": "банан", "fruit": "фрукты", "rice": "рис", "coffee": "кофе",
    "toast": "тост", "roast": "обжарка", "chocolate": "шоколад", "cocoa": "какао", "fresh": "свежесть", "fizz": "пузырьки",
    "warmth": "тепло", "smoke": "дым", "corn": "кукуруза", "sweet": "сладость", "cheese": "сыр", "dairy": "молочное",
    "sour": "кислинка", "garlic": "чеснок", "pepper": "перец", "onion": "лук", "cumin": "зира", "cinnamon": "корица",
    "butter": "масло", "cream": "сливки",
}


# ─────────────────────────────────────────────────────────────────────────────
# scoring
# ─────────────────────────────────────────────────────────────────────────────
def verdict_label(score: int) -> str:
    if score >= 85:
        return "Идеальная пара"
    if score >= 72:
        return "Отличное сочетание"
    if score >= 60:
        return "Хорошая пара"
    if score >= 48:
        return "Нейтрально"
    return "Не рекомендуем"


def score_pair(beer: Dict[str, Any], dish: Dict[str, Any],
               context: Optional[Dict[str, Any]] = None,
               curated: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    ctx = context or {}
    b, d = beer["vector"], dish["vector"]
    contribs: List[Dict[str, Any]] = [rule_intensity(b, d)]
    for c in (rule_cut(b, d), rule_heat(b, d), rule_salt(b, d), rule_sweet(b, d),
              rule_sour(b, d), rule_umami(b, d), rule_fresh(b, d)):
        if c:
            contribs.append(c)
    contribs.extend(rule_roast(b, d))
    br = rule_bridge(beer["tags"], dish["tags"])
    if br:
        contribs.append(br)
    cu = rule_curated(curated)
    if cu:
        contribs.append(cu)
    contribs.extend(rule_context(b, ctx))
    dn = rule_dna(b, ctx.get("dna"))
    if dn:
        contribs.append(dn)

    total = _fsum(c["points"] for c in contribs)
    score = int(clamp(_round_half_up(SCORE_BASE + SCORE_K * total), 3, 99))

    # тип пары: вердикт сомелье приоритетен; иначе — семейство самого сильного правила
    # (intensity и контекст не участвуют — они про «громкость» и про гостя, а не про механику пары)
    if curated and curated.get("type") in PAIRING_TYPES:
        match_type = curated["type"]
    else:
        best = None
        for c in contribs:
            if c["rule"] == "intensity" or c["family"] == "CONTEXT" or c["family"] not in PAIRING_TYPES:
                continue
            if c["points"] > 0 and (best is None or c["points"] > best["points"]):
                best = c
        match_type = best["family"] if best else "COMPLEMENT"

    reasons = sorted([c for c in contribs if c["points"] > 0.5], key=lambda c: -c["points"])[:3]
    warnings = sorted([c for c in contribs if c["points"] < -0.5], key=lambda c: c["points"])[:2]
    return {
        "beer_id": beer["id"], "dish_id": dish["id"],
        "score": score, "verdict": verdict_label(score),
        "match_type": match_type, "match_label": TYPE_LABELS[match_type],
        "contributions": contribs,
        "reasons": reasons, "warnings": warnings,
        "sommelier_pick": bool(curated and int(curated.get("score", 0)) >= 4),
        "curated": curated,
        "intensity": {"beer": _r2(intensity_beer(b)), "dish": _r2(intensity_dish(d))},
        "confidence": beer.get("confidence", 1.0),
    }


def _curated_key(brand_id: str, dish_id: str) -> str:
    return f"{brand_id}|{dish_id}"


def index_curated(pairs: Iterable[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    return {_curated_key(p["brand_id"], p["dish_id"]): p for p in pairs}


def recommend_beers(dish: Dict[str, Any], beers: List[Dict[str, Any]],
                    curated_index: Dict[str, Dict[str, Any]], context: Optional[Dict[str, Any]] = None,
                    limit: int = 5, available_ids: Optional[Iterable[str]] = None,
                    diversify: bool = False) -> List[Dict[str, Any]]:
    """Ранжирует сорта под блюдо. diversify=True — в топе не больше двух сортов одного стиля
    (чтобы гость увидел альтернативу, а не три пилснера подряд)."""
    allowed = set(available_ids) if available_ids is not None else None
    results = []
    families: Dict[str, str] = {}
    for beer in beers:
        if allowed is not None and beer["id"] not in allowed:
            continue
        cu = curated_index.get(_curated_key(beer["id"], dish["id"]))
        results.append(score_pair(beer, dish, context, cu))
        families[beer["id"]] = (beer.get("brand") or {}).get("style_family") or "LAGER"
    results.sort(key=lambda r: (-r["score"], r["beer_id"]))
    if not limit:
        return results
    if not diversify:
        return results[:limit]
    picked: List[Dict[str, Any]] = []
    rest: List[Dict[str, Any]] = []
    counts: Dict[str, int] = {}
    for r in results:
        fam = families[r["beer_id"]]
        if len(picked) < limit and counts.get(fam, 0) < 2:
            picked.append(r)
            counts[fam] = counts.get(fam, 0) + 1
        else:
            rest.append(r)
    # если сортов не хватило — добираем по порядку
    for r in rest:
        if len(picked) >= limit:
            break
        picked.append(r)
    picked.sort(key=lambda r: (-r["score"], r["beer_id"]))
    return picked


def recommend_dishes(beer: Dict[str, Any], dishes: List[Dict[str, Any]],
                     curated_index: Dict[str, Dict[str, Any]], context: Optional[Dict[str, Any]] = None,
                     limit: int = 6) -> List[Dict[str, Any]]:
    results = []
    for dish in dishes:
        cu = curated_index.get(_curated_key(beer["id"], dish["id"]))
        results.append(score_pair(beer, dish, context, cu))
    results.sort(key=lambda r: (-r["score"], r["dish_id"]))
    return results[:limit] if limit else results


def similar_beers(beer: Dict[str, Any], beers: List[Dict[str, Any]], limit: int = 3) -> List[Dict[str, Any]]:
    out = []
    for other in beers:
        if other["id"] == beer["id"]:
            continue
        out.append({"beer_id": other["id"], "similarity": _r2(cosine(beer["vector"], other["vector"], BEER_AXES))})
    out.sort(key=lambda x: (-x["similarity"], x["beer_id"]))
    return out[:limit]


# ─────────────────────────────────────────────────────────────────────────────
# Flavor DNA
# ─────────────────────────────────────────────────────────────────────────────
RATING_WEIGHTS = {"love": 2.0, "like": 1.0, "meh": 0.0, "dislike": -1.0}


def dna_vector(rated: List[Dict[str, Any]]) -> Optional[Dict[str, float]]:
    """rated: [{vector: {...}, rating: 'love'|'like'|'meh'|'dislike'}] → взвешенный профиль вкуса."""
    acc = {a: 0.0 for a in BEER_AXES}
    wsum = 0.0
    for r in rated:
        w = RATING_WEIGHTS.get(r.get("rating"), 0.0)
        if w == 0.0:
            continue
        v = r["vector"]
        for a in BEER_AXES:
            acc[a] += w * v.get(a, 0.0)
        wsum += abs(w)
    if wsum == 0.0:
        return None
    # dislike вычитает: нормализуем и отсекаем отрицательные
    vec = {a: clamp(acc[a] / wsum, 0.0, 1.0) for a in BEER_AXES}
    return {a: _r2(v) for a, v in vec.items()}


def dna_archetype(vec: Dict[str, float]) -> Dict[str, Any]:
    best = None
    for arch in ARCHETYPES:
        s = cosine(vec, arch["vector"], BEER_AXES)
        if best is None or s > best[0]:
            best = (s, arch)
    assert best is not None
    return {**best[1], "similarity": _r2(best[0])}

"""ИИ-сомелье Flavor Tree — Django-зеркало frontend/api/_lib/sommelier.ts (тот же контракт и промпты).

POST /api/ai/   {mode: "ask", messages: [{role, content}], venue?: {slug, name, beers, prices, currency}, occasion?, bitter_pref?, dna?}
POST /api/ai/   {mode: "vision", image: {media_type, data(base64)}, messages?, venue?, occasion?}
В обоих режимах необязательное поле locale: "ru" | "kk" | "en" (нет поля или другое значение → "ru"); в ответе — locale.

Пайплайн: Claude извлекает блюдо и контекст (строгий JSON) → движок подбора → Claude объясняет как сомелье.
Указание языка уходит модели вторым system-блоком, ПОСЛЕ кэшируемого, поэтому кэш промпта общий для всех языков.
Ключ: ANTHROPIC_API_KEY в окружении. Без ключа эндпоинт отвечает 503 с понятным текстом.
"""
from __future__ import annotations

import json
from typing import Any

import anthropic
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import Venue
from .pairing.adapters import EngineContext
from .pairing.engine import DISH_AXES, TYPE_LABELS, build_dish_profile, recommend_beers

MODEL = "claude-opus-5"
MAX_IMAGE_B64 = 5 * 1024 * 1024
TASTES = ["SALTY", "SWEET", "SOUR", "BITTER", "UMAMI", "SPICY", "MIXED"]
WEIGHTS = ["LIGHT", "MEDIUM", "HEAVY"]
FATS = ["LOW", "MEDIUM", "HIGH"]
COOKINGS = ["FRIED", "GRILLED", "BAKED", "BOILED", "STEAMED", "RAW", "CURED", "FERMENTED", "OTHER"]

_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


def custom_dish_vector(spec: dict) -> tuple[dict, list[str]]:
    """Та же логика, что default_dish_vector в scripts/build_data.py и customDishVector в TS."""
    v = {a: 0.0 for a in DISH_AXES}
    t = spec["taste"]
    if t == "SALTY": v["salt"] = .8
    elif t == "SWEET": v["sweet"] = .85
    elif t == "SOUR": v["sour"] = .8
    elif t == "BITTER": v["bitter"] = .7
    elif t == "UMAMI": v["umami"] = .8
    elif t == "SPICY": v["heat"] = .75; v["umami"] = .4
    elif t == "MIXED": v["salt"] = .4; v["sweet"] = .4; v["umami"] = .4
    v["weight"] = {"LIGHT": .25, "MEDIUM": .55, "HEAVY": .85}[spec["weight"]]
    v["fat"] = {"LOW": .2, "MEDIUM": .5, "HIGH": .85}[spec["fat"]]
    tags = set(spec.get("tags") or [])
    m = spec["cooking"]
    if m == "FRIED": v["maillard"] = .6; v["fat"] = min(1, v["fat"] + .1); tags.add("fried")
    elif m == "GRILLED": v["smoke"] = .7; v["maillard"] = .7; tags.update(["smoke", "char"])
    elif m == "BAKED": v["maillard"] = .5; tags.add("bread")
    elif m == "BOILED": v["umami"] = min(1, v["umami"] + .1); tags.add("broth")
    elif m == "STEAMED": v["fresh"] = .4
    elif m == "RAW": v["fresh"] = .8
    elif m == "CURED": v["salt"] = min(1, v["salt"] + .3); v["smoke"] = .3; v["umami"] = min(1, v["umami"] + .2); tags.add("cured")
    elif m == "FERMENTED": v["sour"] = min(1, v["sour"] + .3); v["fresh"] = .3; tags.add("sour")
    if t != "SWEET":
        v["salt"] = max(v["salt"], .4)
    heat = spec.get("heat")
    if heat is not None:
        v["heat"] = max(v["heat"], float(heat))
    return v, sorted(tags)


def _catalog(engine: EngineContext) -> tuple[str, str]:
    dish_lines = []
    for d in engine.dishes_raw:
        syn = ", ".join((d.get("synonyms") or [])[:4])
        dish_lines.append(f"{d['id']} — {d.get('display_name') or d.get('name')}{f' ({syn})' if syn else ''} · {d.get('cuisine_label', '')}, {d.get('category', '')}")
    beer_lines = [f"{b['id']} — {b.get('display_name') or b.get('name')} · {b.get('style_label', '')}, {b.get('abv')}%" for b in engine.brands_raw]
    return "\n".join(dish_lines), "\n".join(beer_lines)


def _system_interpret(dish_catalog: str, beer_catalog: str) -> str:
    return f"""Ты — ассистент-сомелье сервиса Flavor Tree (Казахстан, портфель Efes Kazakhstan). Гость в баре описывает блюдо словами или присылает фото. Твоя задача — перевести это в структуру для движка подбора пива. Пиво ты НЕ выбираешь: это делает детерминированный движок.

Правила:
1. Если блюдо совпадает с позицией каталога (по названию, синониму, региональному варианту) — верни её slug в matched_slug. Бешбармак, казы, куырдак, манты, самса, шашлык, плов, лагман — это казахская/центральноазиатская кухня; знай их вкус: жирное мясо, соль, варка или гриль.
2. Если блюда нет в каталоге — matched_slug = null и опиши сенсорный профиль: доминирующий вкус, вес, жирность, способ приготовления, остроту 0..1 (0 — не острое, 0.5 — заметно, 0.8+ — очень), теги ароматов (smoke, char, fried, bread, cheese, herbs, citrus, garlic, tomato, soy, ginger, sesame, cured, sour, sweet, cream, nuts, chocolate, coffee, honey, fish, seafood, mushroom, pepper).
3. Повод: hot — жара/лето/освежиться; evening — вечер/расслабиться/после работы; party — компания/праздник/много людей; gourmet — гастро-ужин/вдумчиво/деликатес. Если не сказано — null.
4. bitter_pref: −1 (не любит горечь) … 0 (не сказано) … +1 (любит горькое, хмелевое).
5. kind = "dish", если понятно, что человек ест (или на фото еда). kind = "clarify", если непонятно, что за блюдо — задай ОДИН короткий вопрос в reply. kind = "chat", если вопрос не про подбор к еде (например, про сорт, температуру подачи, что такое лагер) — ответь кратко в reply как сомелье, опираясь на каталог.
6. На фото может быть несколько блюд — выбери главное (самое большое/центральное). Если на фото не еда — kind="clarify" и попроси сфотографировать блюдо.
7. confidence 0..1 — насколько уверен в распознавании.
8. reply при kind="dish" — одна короткая фраза-подтверждение, что ты понял (например: «Похоже на шашлык из баранины с луком — жирное мясо с гриля»). Без рекомендаций пива.
Пиши по-русски, коротко, без markdown.

КАТАЛОГ БЛЮД (slug — название (синонимы) · кухня, раздел):
{dish_catalog}

КАТАЛОГ ПИВА (для kind="chat"; slug — название · стиль, ABV):
{beer_catalog}"""


SYSTEM_NARRATE = ("Ты — пивной сомелье Flavor Tree. Тебе дают блюдо гостя и 1–3 сорта, которые уже выбрал движок подбора "
                  "(с оценкой 0–100, типом пары и причинами по правилам: интенсивность, очищение жира горечью и карбонизацией, "
                  "острота, соль, сладость, кислота, умами, мосты по ароматам, вердикт сомелье, повод). Объясни гостю выбор живым "
                  "языком: 2–4 предложения, по-русски, без markdown и списков. Первым назови лучший сорт и главную причину «почему "
                  "именно он к этому блюду»; второй–третий — одним штрихом, чем отличаются. Если есть предупреждения — упомяни мягко. "
                  "Если указаны цены заведения — можно назвать цену лучшего. Не выдумывай сорта и факты сверх данных. Не используй "
                  "слова «алгоритм» и «движок» — говори как человек за стойкой.")

# ─────────────────────────────── язык гостя (ru / kk / en) ───────────────────────────────


def resolve_locale(x: Any) -> str:
    """Язык гостя из запроса: "kk" и "en" как есть, всё остальное (и отсутствие поля) → "ru"."""
    return x if isinstance(x, str) and x in ("kk", "en") else "ru"


# Изменчивая часть промпта. Для ru пусто: запрос к модели остаётся ровно таким, каким был до локалей.
LANG_STYLE = {
    "ru": "",
    "kk": "Язык гостя — казахский. Весь текст для гостя пиши на естественном современном казахском языке кириллицей: коротко, тепло, без markdown и без кальки с русского. Названия блюд можно оставлять так, как их написал гость; названия сортов пива не переводи.",
    "en": "Язык гостя — английский. Весь текст для гостя пиши на естественном английском: коротко, тепло, без markdown. Названия блюд можно оставлять так, как их написал гость; названия сортов пива не переводи.",
}


def _lang_interpret(locale: str) -> str:
    return LANG_STYLE[locale] and f'{LANG_STYLE[locale]} Это указание важнее строки «Пиши по-русски» выше. На языке гостя пишется только поле reply — фраза-подтверждение, уточняющий вопрос или ответ при kind="chat". Остальные поля не зависят от языка: matched_slug, значения enum и tags — строго как в правилах и каталоге; dish.name — так, как блюдо назвал гость, а если он его не называл (фото) — на языке гостя.'


def _lang_narrate(locale: str) -> str:
    return LANG_STYLE[locale] and f"{LANG_STYLE[locale]} Это указание важнее слова «по-русски» выше. Ответ — строго один JSON-объект по схеме. reply — твоё объяснение гостю (те же 2–4 предложения) на языке гостя. picks — те же сорта в том же порядке: beer_id копируй без изменений; why, reasons и warnings — перевод соответствующих русских строк на язык гостя, столько же элементов и в том же порядке, без добавлений и пропусков. Выбор сортов, их порядок, оценки и цены заданы — не меняй их."


def _system_blocks(stable: str, volatile: str) -> list[dict]:
    """Кэшируемый блок всегда первый и байт-в-байт одинаков для всех языков; указание языка — вторым блоком, уже за точкой кэша."""
    blocks = [{"type": "text", "text": stable, "cache_control": {"type": "ephemeral"}}]
    if volatile:
        blocks.append({"type": "text", "text": volatile})
    return blocks


# Подпись типа пары — статично, без модели. ru — ровно подпись движка.
MATCH_LABELS = {
    "ru": TYPE_LABELS,
    "kk": {"COMPLEMENT": "Complement · толықтыру", "CONTRAST": "Contrast · контраст", "CLEANSE": "Cleanse · тазарту", "BRIDGE": "Bridge · көпір"},
    "en": {"COMPLEMENT": "Complement", "CONTRAST": "Contrast", "CLEANSE": "Cleanse", "BRIDGE": "Bridge"},
}

# Готовые фразы гостю, которые пишет не модель.
TEXTS = {
    "ru": {"refusal": "С этим запросом я помочь не могу — но с радостью подберу пиво к вашему блюду.",
           "clarify": "Уточните, пожалуйста, что вы едите?",
           "no_picks": "В карте заведения нет сорта, который хорошо подходит к этому блюду."},
    "kk": {"refusal": "Бұл сұраныс бойынша көмектесе алмаймын — бірақ тағамыңызға лайық сыраны қуана таңдап беремін.",
           "clarify": "Не жеп отырғаныңызды нақтылап жіберіңізші.",
           "no_picks": "Мекеме мәзірінде бұл тағамға жақсы үйлесетін сыра сорты жоқ."},
    "en": {"refusal": "I can't help with that request — but I'd be glad to pick a beer for your dish.",
           "clarify": "Could you tell me what you are eating?",
           "no_picks": "There is no beer on this venue's list that pairs well with this dish."},
}

# Объяснение для kk/en приходит строгим JSON: текст гостю + перевод человекочитаемых полей пар.
NARRATE_SCHEMA = {
    "type": "object",
    "properties": {
        "reply": {"type": "string"},
        "picks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "beer_id": {"type": "string"}, "why": {"type": "string"},
                    "reasons": {"type": "array", "items": {"type": "string"}},
                    "warnings": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["beer_id", "why", "reasons", "warnings"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["reply", "picks"],
    "additionalProperties": False,
}

INTERPRET_SCHEMA = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["dish", "clarify", "chat"]},
        "reply": {"type": "string"},
        "dish": {
            "type": "object",
            "properties": {
                "name": {"type": "string"}, "matched_slug": {"type": ["string", "null"]},
                "taste": {"type": "string", "enum": TASTES}, "weight": {"type": "string", "enum": WEIGHTS},
                "fat": {"type": "string", "enum": FATS}, "cooking": {"type": "string", "enum": COOKINGS},
                "heat": {"type": "number"}, "tags": {"type": "array", "items": {"type": "string"}},
                "confidence": {"type": "number"},
            },
            "required": ["name", "matched_slug", "taste", "weight", "fat", "cooking", "heat", "tags", "confidence"],
            "additionalProperties": False,
        },
        "occasion": {"type": ["string", "null"], "enum": ["hot", "evening", "party", "gourmet", None]},
        "bitter_pref": {"type": "number"},
    },
    "required": ["kind", "reply", "dish", "occasion", "bitter_pref"],
    "additionalProperties": False,
}


def _clamp01(x: Any) -> float:
    try:
        return max(0.0, min(1.0, float(x)))
    except (TypeError, ValueError):
        return 0.0


def _venue_ctx(data: dict) -> dict | None:
    """Контекст заведения: из запроса (демо без БД) или из БД по slug (цены и стоп-лист)."""
    v = data.get("venue")
    if not v:
        return None
    if isinstance(v, str):
        v = {"slug": v}
    venue = Venue.objects.filter(slug=v.get("slug")).select_related("account").first()
    if venue and not v.get("beers"):
        items = list(venue.menu_items.filter(kind="BEER", is_available=True))
        v = {**v, "name": venue.name, "beers": [i.ref_slug for i in items],
             "prices": {i.ref_slug: float(i.price) for i in items}, "volumes": {i.ref_slug: i.volume for i in items},
             "currency": venue.currency}
    return v


def _pick(engine: EngineContext, r: dict, venue: dict | None, locale: str = "ru") -> dict:
    beer = engine.beer_by_id.get(r["beer_id"])
    brand = beer["brand"] if beer else {}
    reasons = [c["text"] for c in r["reasons"]]
    why = next((c["text"] for c in r["reasons"] if c["rule"] != "intensity"), reasons[0] if reasons else r["verdict"])
    return {
        "beer_id": r["beer_id"], "name": brand.get("display_name") or brand.get("name") or r["beer_id"],
        "style": brand.get("style_label", ""), "abv": brand.get("abv"), "score": r["score"],
        "match_type": r["match_type"], "match_label": MATCH_LABELS[locale].get(r["match_type"], r["match_label"]), "why": why, "reasons": reasons,
        "warnings": [c["text"] for c in r["warnings"]], "sommelier_pick": r["sommelier_pick"],
        "price": (venue or {}).get("prices", {}).get(r["beer_id"]), "volume": (venue or {}).get("volumes", {}).get(r["beer_id"]),
    }


def _parse_narration(text: str, picks: list[dict]) -> tuple[str, list[dict] | None]:
    """Разбор JSON-объяснения (kk/en) → (reply, тексты пар). Модель переводит только тексты: сорта, порядок, оценки
    и цены остаются от движка. Тексты = None при любом расхождении — другой набор или порядок beer_id, другое число
    причин/предупреждений, пустые строки. Исключений наружу не бросает: запрос из-за перевода не падает."""
    try:
        data = json.loads(text)
    except (TypeError, ValueError):
        return "", None
    if not isinstance(data, dict):
        return "", None

    def is_str(x: Any) -> bool:
        return isinstance(x, str) and bool(x.strip())

    def is_list(x: Any, n: int) -> bool:
        return isinstance(x, list) and len(x) == n and all(is_str(s) for s in x)

    raw = data.get("picks") if isinstance(data.get("picks"), list) else []
    ok = len(raw) == len(picks) and all(
        isinstance(t, dict) and t.get("beer_id") == p["beer_id"] and is_str(t.get("why"))
        and is_list(t.get("reasons"), len(p["reasons"])) and is_list(t.get("warnings"), len(p["warnings"]))
        for t, p in zip(raw, picks))
    texts = [{"why": t["why"].strip(), "reasons": [s.strip() for s in t["reasons"]], "warnings": [s.strip() for s in t["warnings"]]}
             for t in raw] if ok else None
    return (data["reply"].strip() if is_str(data.get("reply")) else ""), texts


def run_sommelier(data: dict, request=None, client: anthropic.Anthropic | None = None) -> dict:
    client = client or _get_client()
    engine = EngineContext(request)
    usage = {"input": 0, "output": 0, "calls": 0}
    locale = resolve_locale(data.get("locale"))
    mode = data.get("mode")
    history = [m for m in (data.get("messages") or []) if str(m.get("content", "")).strip()][-8:]
    last_user = next((m["content"] for m in reversed(history) if m.get("role") == "user"), "")
    venue = _venue_ctx(data)

    # ── фаза 1: понять блюдо ──
    if mode == "vision":
        img = data.get("image") or {}
        if not img.get("data"):
            return {"ok": False, "status": 400, "error": "Нет изображения"}
        if len(img["data"]) > MAX_IMAGE_B64:
            return {"ok": False, "status": 413, "error": "Фото слишком большое"}
        messages = [{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": img.get("media_type", "image/jpeg"), "data": img["data"]}},
            {"type": "text", "text": last_user or "Что это за блюдо? Опиши его сенсорный профиль для подбора пива."},
        ]}]
    else:
        if not last_user:
            return {"ok": False, "status": 400, "error": "Пустой вопрос"}
        messages = [{"role": m["role"], "content": m["content"]} for m in history]
    ctx_note = " ".join(x for x in [
        f"Гость находится в заведении «{venue['name']}»." if venue and venue.get("name") else "",
        f"Повод уже выбран гостем: {data['occasion']}." if data.get("occasion") else "",
    ] if x)
    if ctx_note:
        messages.append({"role": "user", "content": f"(контекст: {ctx_note})"})

    dish_catalog, beer_catalog = _catalog(engine)
    first = client.messages.create(
        model=MODEL, max_tokens=2000,
        system=_system_blocks(_system_interpret(dish_catalog, beer_catalog), _lang_interpret(locale)),
        output_config={"effort": "medium" if mode == "vision" else "low", "format": {"type": "json_schema", "schema": INTERPRET_SCHEMA}},
        messages=messages,
    )
    usage["calls"] += 1; usage["input"] += first.usage.input_tokens; usage["output"] += first.usage.output_tokens
    if first.stop_reason == "refusal":
        return {"ok": True, "kind": "chat", "reply": TEXTS[locale]["refusal"],
                "dish": None, "picks": [], "route": None, "occasion": None, "locale": locale, "usage": usage}
    text = next((b.text for b in first.content if b.type == "text"), "{}")
    intent = json.loads(text)

    if intent.get("kind") != "dish":
        return {"ok": True, "kind": intent.get("kind", "clarify"), "reply": intent.get("reply") or TEXTS[locale]["clarify"],
                "dish": None, "picks": [], "route": None, "occasion": intent.get("occasion"), "locale": locale, "usage": usage}

    # ── фаза 2: движок ──
    d = intent["dish"]
    occasion = data.get("occasion") or intent.get("occasion")
    ctx = {"occasion": occasion, "bitter_pref": float(data.get("bitter_pref") or intent.get("bitter_pref") or 0)}
    if isinstance(data.get("dna"), dict):
        ctx["dna"] = data["dna"]
    matched = engine.find_dish(d["matched_slug"]) if d.get("matched_slug") else None
    spec = {"taste": d["taste"], "weight": d["weight"], "fat": d["fat"], "cooking": d["cooking"],
            "heat": _clamp01(d.get("heat")), "tags": d.get("tags") or []}
    if matched:
        profile = matched
    else:
        vector, tags = custom_dish_vector(spec)
        profile = build_dish_profile({"id": "custom", "name": d["name"], "vector": vector, "tags": tags})
    venue_beers = (venue or {}).get("beers") or None
    results = recommend_beers(profile, engine.beers, engine.curated_index if matched else {}, ctx, 3, venue_beers, True)
    picks = [_pick(engine, r, venue, locale) for r in results]

    dish_out = {"name": matched["dish"].get("display_name") if matched else d["name"], "slug": matched["id"] if matched else None,
                "emoji": matched["dish"].get("emoji", "🍽️") if matched else "🍽️", "spec": spec, "confidence": _clamp01(d.get("confidence"))}
    if matched:
        route = f"/pair/{matched['id']}" + (f"?occasion={occasion}" if occasion else "")
    else:
        from urllib.parse import urlencode
        q = {"name": dish_out["name"], "taste": spec["taste"], "weight": spec["weight"], "fat": spec["fat"], "cooking": spec["cooking"],
             "heat": str(round(spec["heat"] * 100))}
        if occasion:
            q["occasion"] = occasion
        route = "/pair/custom?" + urlencode(q)

    # ── фаза 3: объяснить ──
    reply = intent.get("reply", "")
    if picks:
        translate = locale != "ru"   # kk/en: тем же вызовом получаем и перевод текстов пар
        keys = (("beer_id", "why") if translate else ()) + ("name", "style", "abv", "score", "match_label", "reasons", "warnings", "sommelier_pick", "price", "volume")
        brief = {"guest_said": last_user or "(фото блюда)", "dish": {"name": dish_out["name"], "in_catalog": bool(matched), "spec": spec, "recognized_as": intent.get("reply")},
                 "occasion": occasion, "venue": (venue or {}).get("name"), "currency": (venue or {}).get("currency", "₸"),
                 "picks": [{"rank": i + 1, **{k: p[k] for k in keys}} for i, p in enumerate(picks)]}
        second = client.messages.create(
            model=MODEL, max_tokens=3000 if translate else 700,
            system=_system_blocks(SYSTEM_NARRATE, _lang_narrate(locale)),
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": NARRATE_SCHEMA}} if translate else {"effort": "low"},
            messages=[{"role": "user", "content": json.dumps(brief, ensure_ascii=False)}],
        )
        usage["calls"] += 1; usage["input"] += second.usage.input_tokens; usage["output"] += second.usage.output_tokens
        narrated = "" if second.stop_reason == "refusal" else next((b.text for b in second.content if b.type == "text"), "").strip()
        if not translate:
            if narrated:
                reply = narrated
        else:
            # JSON не разобрался или не сошёлся с парами движка → остаёмся на русских текстах, запрос не роняем
            tr_reply, tr_texts = _parse_narration(narrated, picks)
            if tr_reply:
                reply = tr_reply
            if tr_texts:
                picks = [{**p, **t} for p, t in zip(picks, tr_texts)]
    else:
        reply = f"{reply} {TEXTS[locale]['no_picks']}"

    return {"ok": True, "kind": "picks", "reply": reply, "dish": dish_out, "picks": picks, "route": route, "occasion": occasion, "locale": locale, "usage": usage}


@api_view(["POST"])
def ai_sommelier(request):
    data = request.data or {}
    if data.get("mode") not in ("ask", "vision"):
        return Response({"ok": False, "error": "mode должен быть ask или vision"}, status=status.HTTP_400_BAD_REQUEST)
    try:
        out = run_sommelier(data, request)
    except anthropic.AuthenticationError:
        return Response({"ok": False, "error": "ИИ-сомелье не настроен: нет ключа API"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    except TypeError as e:
        # SDK без ключа падает ещё до запроса: "Could not resolve authentication method"
        if "authentication" not in str(e).lower():
            raise
        return Response({"ok": False, "error": "ИИ-сомелье не настроен: задайте ANTHROPIC_API_KEY"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    except anthropic.RateLimitError:
        return Response({"ok": False, "error": "Слишком много запросов, попробуйте через минуту"}, status=status.HTTP_429_TOO_MANY_REQUESTS)
    except anthropic.BadRequestError as e:
        return Response({"ok": False, "error": f"Запрос отклонён: {e.message}"}, status=status.HTTP_400_BAD_REQUEST)
    except anthropic.APIStatusError as e:
        return Response({"ok": False, "error": f"Ошибка ИИ ({e.status_code})"}, status=status.HTTP_502_BAD_GATEWAY)
    except anthropic.APIConnectionError:
        return Response({"ok": False, "error": "Нет связи с ИИ"}, status=status.HTTP_502_BAD_GATEWAY)
    except (json.JSONDecodeError, KeyError, ValueError):
        return Response({"ok": False, "error": "ИИ вернул неразборчивый ответ, попробуйте ещё раз"}, status=status.HTTP_502_BAD_GATEWAY)
    if not out.get("ok"):
        return Response({"ok": False, "error": out.get("error", "Ошибка")}, status=out.get("status", 400))
    return Response(out)

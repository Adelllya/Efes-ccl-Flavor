"""«Умная» обработка отзывов гостей о парах напиток × блюдо — чистые функции, без Django, сети и ИИ.

Что здесь (подробно — docs/REVIEWS.md):
  REVIEW_CHIPS        словарь меток (12): подписи ru/kk/en, полярность, поправка личного профиля, связь с правилом движка
  star_prior()        балл движка 3..99 → ожидание в звёздах 1..5 (линейно)
  aggregate()         байесовское сжатие к ожиданию движка (m = 5), вес «из заведения» ×1.5, метки, «помогло», расхождение
  prefs_delta()       метки → поправка профиля гостя (applied_prefs); prefs_diff() — только изменение между версиями отзыва
  apply_prefs()       применить поправку (зеркало GuestPrefsService.applyDelta во фронтенде)
  analyze_text()      офлайн-эвристики: язык, ссылки, мат, повторы, личные данные, подсказки меток по словам
  decide_status()     published / pending / spam по тексту, эвристикам и ИИ-разбору
  guest_pairs()       отбор пар (архетип × блюдо) для калибровки — management-команда export_guest_pairs

Всё детерминировано и покрыто api/tests/test_reviews.py.
"""
from __future__ import annotations

import re
import unicodedata
from collections import Counter
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from .pairing.engine_v2 import clamp, r1, r2

# ─────────────────────────────────────────────────────────────────────────────
# Словарь меток
# ─────────────────────────────────────────────────────────────────────────────
# Поля записи:
#   label_ru/kk/en — подпись на кнопке (во фронтенде те же тексты — i18n-ключи review.chip.<id>);
#   hint_ru        — что метка значит (для ИИ-разбора текста и для сомелье);
#   polarity       — +1 «пара сработала», −1 «что-то не так»;
#   prefs          — поправка ЛИЧНОГО профиля гостя (контекст движка R17), применяется только на его устройстве:
#                    bitter_pref / sweet_pref — сдвиг по шкале −1..1; harsh_tol — шаг по шкале
#                    tolerant → median → sensitive (+1 = бережнее); heat_lover — установить значение;
#   engine         — что метка говорит о ПАРЕ (для сомелье и калибровки, на личный профиль не влияет):
#                    rules — правила движка (ENGINE_V2_SPEC.md §4.1), axis/direction — какая ось и куда «промахнулась».
#
# Шаг 0.25 по bitter_pref — четверть шкалы: R17 даёт clamp(14·pref·(B.bitter − 0.5), −7, +7), значит один шаг
# двигает балл не больше чем на 14·0.25·0.5 = 1.75 — один ужин не переворачивает профиль (см. prefs_delta: ±0.5 за отзыв).
REVIEW_CHIPS: Dict[str, Dict[str, Any]] = {
    # Пара удалась целиком — подтверждение итогового балла (R1…R20). Личный профиль не трогаем: «понравилось»
    # ничего не говорит о том, какая именно ось сработала. В калибровку идёт через саму оценку (export_guest_pairs).
    "perfect_match": {
        "label_ru": "Идеальная пара", "label_kk": "Мінсіз жұп", "label_en": "Perfect match",
        "hint_ru": "пара полностью удалась", "polarity": 1, "prefs": {},
        "engine": {"rules": ["score"], "axis": None, "direction": "confirmed"},
    },
    # R2 cut_richness: танин, горечь, CO₂, кислота, спирт режут жир (Peyrot des Gachons 2012 — вяжущесть × жир;
    # BA «Carbonation… cutting power against fats»). Подтверждает, что cut сработал на жирном блюде.
    "great_with_fat": {
        "label_ru": "Снимает жирность", "label_kk": "Майлылықты кетіреді", "label_en": "Cuts the richness",
        "hint_ru": "напиток освежает рот после жирного, снимает ощущение жира", "polarity": 1, "prefs": {},
        "engine": {"rules": ["R2"], "axis": "cut", "direction": "works"},
    },
    # R9 delicate_fresh (+CO₂, +кислота, лёгкое тело) и R16 hot (+8·carbonation +4·acid): «освежает» —
    # карбонизация и кислотность ощущаются как чистота после каждого куска.
    "refreshing": {
        "label_ru": "Освежает", "label_kk": "Сергітеді", "label_en": "Refreshing",
        "hint_ru": "напиток освежает, бодрит, очищает вкус", "polarity": 1, "prefs": {},
        "engine": {"rules": ["R9", "R16"], "axis": "carbonation", "direction": "works"},
    },
    # R3 chili_heat, ветка relief: сахар, молочный белок, холод и тело гасят капсаицин (Nolden 2019; Nasrawi &
    # Pangborn 1990). Уровень доказательности A — метка проверяет, что это видно и на конкретном напитке.
    "cools_heat": {
        "label_ru": "Гасит остроту", "label_kk": "Өткірлікті басады", "label_en": "Tames the heat",
        "hint_ru": "острота блюда с напитком стала мягче", "polarity": 1, "prefs": {},
        "engine": {"rules": ["R3"], "axis": "heat", "direction": "relief_works"},
    },
    # R10 maillard / R11 smoke / R12 aroma_bridge — «мосты». У R12 уровень D (Ahn 2011, Spence 2020: сенсорной
    # проверки нет), поэтому подтверждения гостей — почти единственный сигнал, что мост вообще ощущается.
    "flavors_echo": {
        "label_ru": "Вкусы перекликаются", "label_kk": "Дәмдер үндеседі", "label_en": "Flavours echo",
        "hint_ru": "в напитке и блюде слышны общие ноты: дым, карамель, хлеб, фрукты, пряности", "polarity": 1, "prefs": {},
        "engine": {"rules": ["R10", "R11", "R12"], "axis": "bridge", "direction": "works"},
    },
    # R17 bitter_pref: чувствительность к горечи личная (Hanni, Vinotypes; Lanier 2005 — PROP-тестеры),
    # плюс R14 same_on_same и R7 (умами без соли ужесточает горечь). Гостю — меньше горечи в следующих подборах.
    "too_bitter": {
        "label_ru": "Слишком горько", "label_kk": "Тым ащы", "label_en": "Too bitter",
        "hint_ru": "напиток показался слишком горьким", "polarity": -1, "prefs": {"bitter_pref": -0.25},
        "engine": {"rules": ["R17", "R14", "R7"], "axis": "bitter", "direction": "too_high"},
    },
    # R17 sweet_pref и R4 sweet_match (напиток слаще нужного), R5 (сладкое ✗ кислое), R14 (сладкий коктейль к
    # сладкому блюду — Marrero, Death & Co). Гостю — суше в следующих подборах.
    "too_sweet": {
        "label_ru": "Слишком сладко", "label_kk": "Тым тәтті", "label_en": "Too sweet",
        "hint_ru": "напиток показался слишком сладким или приторным", "polarity": -1, "prefs": {"sweet_pref": -0.25},
        "engine": {"rules": ["R17", "R4", "R14"], "axis": "sweet", "direction": "too_high"},
    },
    # R3, ветка aggr: спирт (TRPV1 — Trevisani 2002), хмелевая горечь × капсаицин (BA «Hop Bitterness emphasizes
    # Spiciness»; панель Sam Adams). Штрафы R3 умножаются на R17 harsh_tol → шаг к sensitive; «любитель острого»
    # (heat_lover снимает 85 % штрафа) тут явно не про этого гостя — выключаем.
    "burns_more": {
        "label_ru": "Жжёт сильнее", "label_kk": "Өткірлікті күшейтеді", "label_en": "Makes it burn more",
        "hint_ru": "с напитком острота блюда стала сильнее, жжёт", "polarity": -1,
        "prefs": {"harsh_tol": 1, "heat_lover": False},
        "engine": {"rules": ["R3", "V3"], "axis": "heat", "direction": "aggravated"},
    },
    # Спирт: burn(ABV) в R3, спирт × умами в R7(−) — оба умножаются на harsh_tol (§6.3: «множитель на все штрафы за
    # горечь/танин/спирт/жжение»); плюс R6 alco (соль + высокий спирт — Goldstein, CMS) и R16 meal (Death & Co:
    # крепкое — «к одному укусу»). Гостю — шаг к sensitive.
    "too_strong_alcohol": {
        "label_ru": "Слишком крепко", "label_kk": "Тым күшті", "label_en": "Too boozy",
        "hint_ru": "спирт слишком ощущается, напиток слишком крепкий к этому блюду", "polarity": -1,
        "prefs": {"harsh_tol": 1},
        "engine": {"rules": ["R6", "R3", "R16"], "axis": "alcohol", "direction": "too_high"},
    },
    # R1 intensity_match, dF > 0 и вето V1: напиток громче блюда (BA «Match strength with strength»; Mosher «Bambi vs
    # Godzilla»). Это про пару, не про гостя: сигнал сомелье, что k_loud/порог V1 для этой пары мягковат.
    "overpowers_dish": {
        "label_ru": "Перебивает блюдо", "label_kk": "Тағамды басып кетеді", "label_en": "Overpowers the dish",
        "hint_ru": "напиток заглушает вкус блюда", "polarity": -1, "prefs": {},
        "engine": {"rules": ["R1", "V1"], "axis": "loudness", "direction": "drink_louder"},
    },
    # R1, dF < 0 и вето V6: блюдо топит напиток (Романовский: лёгкое пиво «потеряется»; CMS-исключение — кислота/CO₂
    # «спасают» лёгкое тело). Тоже сигнал про пару, не про гостя.
    "lost_behind_dish": {
        "label_ru": "Теряется на фоне блюда", "label_kk": "Тағамның жанында білінбейді", "label_en": "Lost behind the dish",
        "hint_ru": "напиток не чувствуется, водянистый, пресный рядом с блюдом", "polarity": -1, "prefs": {},
        "engine": {"rules": ["R1", "V6", "R5"], "axis": "loudness", "direction": "drink_quieter"},
    },
    # Итоговый отказ от пары («помогло / нет» из §7.4 п.5 в самой сильной форме). Личный профиль не трогаем —
    # непонятно, что именно не понравилось; пара уходит в «на доработку» кабинета и в экспорт как «bad» при устойчивой оценке.
    "wouldnt_order_again": {
        "label_ru": "Не взял бы снова", "label_kk": "Қайта алмас едім", "label_en": "Wouldn’t order again",
        "hint_ru": "гость не стал бы заказывать эту пару снова", "polarity": -1, "prefs": {},
        "engine": {"rules": ["score"], "axis": None, "direction": "rejected"},
    },
}
CHIP_IDS: Tuple[str, ...] = tuple(REVIEW_CHIPS)

# ─────────────────────────────────────────────────────────────────────────────
# Личный профиль гостя (контекст движка: views_engine_v2._ctx_from, R17)
# ─────────────────────────────────────────────────────────────────────────────
HARSH_ORDER: Tuple[str, ...] = ("tolerant", "median", "sensitive")   # множитель 0.6 · 1.0 · 1.4 (Hanni; Lanier 2005)
PREFS_DEFAULT: Dict[str, Any] = {"bitter_pref": 0.0, "sweet_pref": 0.0, "heat_lover": False, "harsh_tol": "median"}
PREF_AXES: Tuple[str, ...] = ("bitter_pref", "sweet_pref")
MAX_PREF_STEP = 0.5          # за один отзыв ось сдвигается не больше чем на половину шкалы
MAX_HARSH_STEP = 1           # и не больше чем на одну ступень чувствительности

# Что гость видит после отправки: «Спасибо! Учли: меньше горечи». id — ключ i18n prefs.note.<id> во фронтенде.
PREF_NOTES_RU: Dict[str, str] = {
    "bitter_down": "меньше горечи", "bitter_up": "больше горечи",
    "sweet_down": "меньше сладости", "sweet_up": "больше сладости",
    "harsh_up": "бережнее с крепостью и жжением", "harsh_down": "крепость и жжение — не проблема",
    "heat_off": "без упора на остроту",
}

# Повод и прочий контекст подбора, который сохраняем с отзывом (зеркало views_engine_v2.OCCASIONS / SENSITIVITY;
# совпадение проверяет test_reviews). Flavor DNA не храним — он не нужен для разбора отзыва.
OCCASIONS: Tuple[str, ...] = ("meal", "aperitif", "dessert", "hot", "evening", "party", "gourmet", "non_alcoholic")


def _num(x: Any) -> Optional[float]:
    if isinstance(x, bool) or not isinstance(x, (int, float, str)):
        return None
    try:
        v = float(x)
    except ValueError:
        return None
    return v if v == v and v not in (float("inf"), float("-inf")) else None


def clean_ctx(raw: Any) -> Dict[str, Any]:
    """Контекст подбора, который видел гость: повод и личные настройки. Неизвестное молча отбрасывается."""
    if not isinstance(raw, Mapping):
        return {}
    out: Dict[str, Any] = {}
    if raw.get("occasion") in OCCASIONS:
        out["occasion"] = raw["occasion"]
    for key in PREF_AXES:
        v = _num(raw.get(key))
        if v:
            out[key] = r2(clamp(v, -1.0, 1.0))
    if raw.get("heat_lover") is True or str(raw.get("heat_lover")).lower() in ("1", "true"):
        out["heat_lover"] = True
    if raw.get("harsh_tol") in HARSH_ORDER:
        out["harsh_tol"] = raw["harsh_tol"]
    if raw.get("non_alcoholic") is True:
        out["non_alcoholic"] = True
    return out


def prefs_delta(chips: Iterable[str]) -> Dict[str, Any]:
    """Метки → поправка профиля: сумма по осям, ±MAX_PREF_STEP по bitter/sweet, ±1 ступень по harsh_tol,
    heat_lover = False, если хоть одна метка его выключает. Неизвестные метки и повторы игнорируются."""
    acc: Dict[str, float] = {}
    harsh = 0
    heat: Optional[bool] = None
    for chip in dict.fromkeys(chips):
        spec = REVIEW_CHIPS.get(chip)
        if not spec:
            continue
        for key, val in spec["prefs"].items():
            if key in PREF_AXES:
                acc[key] = acc.get(key, 0.0) + float(val)
            elif key == "harsh_tol":
                harsh += int(val)
            elif key == "heat_lover":
                heat = bool(val) if heat is None else (heat and bool(val))
    out: Dict[str, Any] = {}
    for key in PREF_AXES:
        if acc.get(key):
            out[key] = r2(clamp(acc[key], -MAX_PREF_STEP, MAX_PREF_STEP))
    if harsh:
        out["harsh_tol"] = max(-MAX_HARSH_STEP, min(MAX_HARSH_STEP, harsh))
    if heat is not None:
        out["heat_lover"] = heat
    return out


def prefs_diff(new: Mapping[str, Any], old: Mapping[str, Any]) -> Dict[str, Any]:
    """Поправка «новая версия отзыва минус старая» — чтобы правка отзыва не применялась к профилю дважды.
    heat_lover: выставляем, только если новая версия его задаёт, а старая — нет (вернуть прежнее значение нельзя:
    сервер его не знает, оно живёт на устройстве гостя)."""
    out: Dict[str, Any] = {}
    for key in PREF_AXES:
        d = r2(float(new.get(key, 0.0)) - float(old.get(key, 0.0)))
        if d:
            out[key] = d
    h = int(new.get("harsh_tol", 0)) - int(old.get("harsh_tol", 0))
    if h:
        out["harsh_tol"] = h
    if "heat_lover" in new and old.get("heat_lover") != new["heat_lover"]:
        out["heat_lover"] = new["heat_lover"]
    return out


def pref_notes(delta: Mapping[str, Any], sources: Optional[Mapping[str, str]] = None) -> List[Dict[str, str]]:
    """Человекочитаемый список «что учли». sources: ключ поправки → "chip" | "text" (по умолчанию chip)."""
    sources = sources or {}
    notes: List[Tuple[str, str]] = []
    for key, stem in (("bitter_pref", "bitter"), ("sweet_pref", "sweet")):
        v = delta.get(key)
        if v:
            notes.append((f"{stem}_{'down' if v < 0 else 'up'}", key))
    if delta.get("harsh_tol"):
        notes.append(("harsh_up" if delta["harsh_tol"] > 0 else "harsh_down", "harsh_tol"))
    if delta.get("heat_lover") is False:
        notes.append(("heat_off", "heat_lover"))
    return [{"id": nid, "text": PREF_NOTES_RU[nid], "source": sources.get(key, "chip")} for nid, key in notes]


def applied_prefs(new_chips: Sequence[str], new_aspects: Sequence[str] = (),
                  old_chips: Sequence[str] = (), old_aspects: Sequence[str] = ()) -> Dict[str, Any]:
    """applied_prefs для ответа POST: {delta, notes}. Метки гостя + метки из текста (ИИ), минус то, что уже было
    учтено прошлой версией этого же отзыва. source у заметки — "text", если ось сдвинули только метки из текста."""
    new = prefs_delta(list(new_chips) + list(new_aspects))
    old = prefs_delta(list(old_chips) + list(old_aspects))
    delta = prefs_diff(new, old)
    from_chips, from_text = prefs_delta(new_chips), prefs_delta(new_aspects)
    sources = {key: ("text" if key in from_text and key not in from_chips else "chip") for key in delta}
    return {"delta": delta, "notes": pref_notes(delta, sources)}


def apply_prefs(current: Optional[Mapping[str, Any]], delta: Mapping[str, Any]) -> Dict[str, Any]:
    """Применить поправку к профилю (то же делает GuestPrefsService.applyDelta во фронтенде)."""
    cur = dict(PREFS_DEFAULT)
    for key, val in (current or {}).items():
        if key in cur:
            cur[key] = val
    out = dict(cur)
    for key in PREF_AXES:
        base = _num(cur.get(key)) or 0.0
        out[key] = r2(clamp(base + float(delta.get(key, 0.0)), -1.0, 1.0))
    idx = HARSH_ORDER.index(cur["harsh_tol"]) if cur.get("harsh_tol") in HARSH_ORDER else 1
    idx = max(0, min(len(HARSH_ORDER) - 1, idx + int(delta.get("harsh_tol", 0))))
    out["harsh_tol"] = HARSH_ORDER[idx]
    out["heat_lover"] = bool(delta["heat_lover"]) if "heat_lover" in delta else bool(cur.get("heat_lover"))
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Сводка оценок: байесовское сжатие к ожиданию движка
# ─────────────────────────────────────────────────────────────────────────────
M_PRIOR = 5               # «виртуальных» оценок на стороне ожидания движка
MIN_SHOW = 3              # меньше — среднюю не показываем: «мало оценок: n»
VERIFIED_WEIGHT = 1.5     # отзыв из заведения (была сессия QR) весит в полтора раза больше
NEUTRAL_PRIOR = 3.0       # ожидание, если движок пару не считает (своё блюдо, неизвестный напиток)
DISAGREE_STARS = 1.2      # гости расходятся с движком на ≥ 1.2 звезды…
DISAGREE_MIN_N = 5        # …при ≥ 5 оценках — пару стоит перепробовать сомелье
SCORE_MIN, SCORE_MAX = 3, 99   # итоговый балл движка (ENGINE_V2_SPEC §5.1: clamp 3..99)


def star_prior(engine_score: Optional[float]) -> float:
    """Балл движка → ожидание в звёздах, линейно: 3 → 1.0, 51 → 3.0, 75 → 4.0, 99 → 5.0 (1 + 4·(s − 3)/96).
    Нет балла → NEUTRAL_PRIOR. Шкалы разные по смыслу (балл — совместимость, звёзды — удовольствие гостя), поэтому
    ожидание — только стартовая точка для сжатия и для флага расхождения, а не «правильный ответ»."""
    s = _num(engine_score)
    if s is None:
        return NEUTRAL_PRIOR
    s = clamp(s, SCORE_MIN, SCORE_MAX)
    return 1.0 + 4.0 * (s - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)


def _weight(row: Mapping[str, Any]) -> float:
    return VERIFIED_WEIGHT if row.get("verified") else 1.0


def aggregate(rows: Iterable[Mapping[str, Any]], prior: float = NEUTRAL_PRIOR, m: float = M_PRIOR) -> Dict[str, Any]:
    """Сводка по опубликованным отзывам одной пары (или напитка).

    rows: {rating 1..5, verified, helpful: bool|None, chips: [...]}.
    shown_mean = (Σ w·r + m·prior) / (Σ w + m), w = 1.5 для отзывов из заведения, иначе 1 — байесовское сжатие:
    пока оценок мало, средняя держится около ожидания движка; с ростом числа оценок решают гости.
    Пока n < MIN_SHOW, наружу идут только n и note — средняя по 1–2 оценкам ничего не значит.
    Расхождение: |сырая взвешенная средняя − ожидание| ≥ 1.2 при n ≥ 5 (сырая, а не сжатая: сжатие само тянет к движку).
    """
    n = verified = help_yes = help_n = 0
    wsum = wr = 0.0
    hist = {str(k): 0 for k in range(1, 6)}
    chips: Counter = Counter()
    for row in rows:
        rating = int(row["rating"])
        w = _weight(row)
        n += 1
        wsum += w
        wr += w * rating
        hist[str(rating)] = hist.get(str(rating), 0) + 1
        verified += 1 if row.get("verified") else 0
        if row.get("helpful") is not None:
            help_n += 1
            help_yes += 1 if row.get("helpful") else 0
        for chip in dict.fromkeys(row.get("chips") or []):
            if chip in REVIEW_CHIPS:
                chips[chip] += 1
    enough = n >= MIN_SHOW
    raw = wr / wsum if wsum else None
    shrunk = (wr + m * prior) / (wsum + m) if n else None
    disagreement = None
    if raw is not None and n >= DISAGREE_MIN_N and abs(raw - prior) >= DISAGREE_STARS - 1e-9:
        disagreement = {"direction": "lower" if raw < prior else "higher", "delta": r2(raw - prior)}
    order = {cid: i for i, cid in enumerate(CHIP_IDS)}
    chip_list = [{"id": cid, "n": cnt, "label": REVIEW_CHIPS[cid]["label_ru"], "polarity": REVIEW_CHIPS[cid]["polarity"]}
                 for cid, cnt in sorted(chips.items(), key=lambda kv: (-kv[1], order[kv[0]]))]
    return {
        "n": n,
        "enough": enough,
        "mean": r1(shrunk) if enough and shrunk is not None else None,
        "raw_mean": r2(raw) if enough and raw is not None else None,
        "expected": r2(prior),
        "verified": verified if enough else None,
        "helpful_pct": int(help_yes * 100 / help_n + 0.5) if enough and help_n else None,
        "helpful_n": help_n if enough else None,
        "distribution": hist if enough else None,
        "chips": chip_list if enough else [],
        "disagreement": disagreement,
        "note": "Оценок пока нет" if n == 0 else (f"Мало оценок: {n}" if not enough else None),
    }


def combined_prior(pairs: Iterable[Tuple[int, float]]) -> float:
    """Ожидание для сводки по напитку (все блюда): среднее ожиданий пар, взвешенное числом оценок пары."""
    total = acc = 0.0
    for n, prior in pairs:
        total += n
        acc += n * prior
    return acc / total if total else NEUTRAL_PRIOR


# ─────────────────────────────────────────────────────────────────────────────
# Текст: очистка, личные данные, офлайн-эвристики
# ─────────────────────────────────────────────────────────────────────────────
MAX_TEXT = 1000
MAX_DISH_NAME = 120
MASK = "[скрыто]"

_CTRL = re.compile("[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏  ‪-‮⁦-⁩﻿]")
_EMAIL = re.compile(r"[\w.%+\-]+@[\w\-]+(?:\.[\w\-]+)*\.[a-zA-Zа-яА-Я]{2,}")
_PHONE = re.compile(r"(?<![\w+])\+?\d(?:[\s\-().]{0,2}\d){9,14}(?!\w)")
_LINK = re.compile(
    r"(?:https?://|www\.|t\.me/|wa\.me/|instagram\.com|(?<![\w@])@[a-z0-9_.]{3,}"
    r"|\b[a-z0-9\-]{2,}\.(?:kz|ru|com|net|org|io|me|info|biz|shop|site|online|app|link|ly|gg|su|uz|kg)\b"
    r"|\b[а-яё0-9\-]{2,}\.(?:рф|қаз)\b)", re.I)
_REPEAT = re.compile(r"(.)\1{5,}", re.S)
_WORD = re.compile(r"\w+", re.U)

KK_LETTERS = frozenset("әғқңөұүһі")
KK_WORDS = frozenset({"өте", "оте", "жақсы", "жаксы", "керемет", "дәмді", "дамди", "емес", "жоқ", "жок", "маған",
                      "маган", "ұнады", "унады", "рахмет", "тағам", "тагам", "сыра", "және", "жане", "бірақ", "бирак",
                      "zhaksy", "keremet", "rakhmet", "emes", "unady", "damdi"})

# Короткий список очевидной брани (ru / en / kk). Это не словарь цензора, а стоп-кран от автопубликации:
# сработал — отзыв ждёт модератора, окончательное решение за человеком. Корни с началом слова, без морфологии.
PROFANITY: Dict[str, Tuple[str, ...]] = {
    "ru": (r"ху[йеёяию]\w*", r"пизд\w*", r"(?:за|у|вы|отъ|съ|разъ|по|на|до|при|про|пере)?[её]б(?:а|ан|ал|ат|ло|ну|ыр|уч)\w*",
           r"бля(?:дь?|дск\w*|ть)?(?![а-яё])", r"муда[кч]\w*", r"мудил\w*", r"гандон\w*", r"залуп\w*", r"шлюх\w*",
           r"пид[оа]р\w*", r"сук[аи](?![а-яё])"),
    "en": (r"fuck\w*", r"shit\w*", r"bitch\w*", r"cunt\w*", r"asshole\w*", r"motherf\w*", r"dickhead\w*"),
    "kk": (r"[қк]отақ\w*", r"котак\w*", r"с[іи]г[еі]й[іи]н\w*", r"с[іи]г[іи]п\w*", r"[қк]анш[ыі][қк]\w*"),
}
_PROFANITY = re.compile(r"(?<![\w])(?:" + "|".join(p for pats in PROFANITY.values() for p in pats) + r")", re.I | re.U)

# Подсказки меток по словам (офлайн, без ИИ). Только подсказки: сохраняются для модератора, в профиль гостя не идут.
KEYWORDS: Dict[str, Tuple[str, ...]] = {
    "perfect_match": (r"идеальн\w*", r"в точку", r"шикарн\w*", r"то,? что нужно", r"(?:отличн|прекрасн)\w* (?:пар|сочетан)\w*",
                      r"керемет\w*", r"тамаша\w*", r"мінсіз", r"perfect\w*", r"spot on", r"great (?:match|pair\w*)"),
    "great_with_fat": (r"(?:снима|сбива|режет|убира|срезает)\w* жир\w*", r"жир\w* (?:не чувству|ушёл|ушел|уходит)\w*",
                       r"майды? (?:кетір|кес)\w*", r"cuts? (?:through )?(?:the )?(?:fat|grease|richness)"),
    "refreshing": (r"освеж\w*", r"серг[іи]т\w*", r"refresh\w*"),
    "cools_heat": (r"(?:гасит|туши|сбива|смягча|снима)\w* остр\w*", r"остр\w* (?:ушл|стих|спал|меньше)\w*",
                   r"өткірл\w* бас\w*", r"(?:cool|tame|calm|sooth)\w* (?:the )?(?:heat|spice|burn)"),
    "flavors_echo": (r"переклика\w*", r"гармони\w*", r"үндес\w*", r"echo\w*", r"harmon\w*"),
    "too_bitter": (r"(?:слишком|очень|чересчур|сильно) горьк\w*", r"горчит", r"горечь", r"тым ащы", r"ащылығы\w*",
                   r"too bitter", r"too hoppy"),
    "too_sweet": (r"(?:слишком|очень|чересчур|сильно) сладк\w*", r"притор\w*", r"тым тәтті", r"too sweet", r"sugary", r"cloying"),
    "burns_more": (r"жж[её]т\w*", r"жгуч\w*", r"(?:ещё|еще) остр\w*", r"остр\w* (?:сильнее|больше|усилил)\w*",
                   r"күйдір\w*", r"burn\w*", r"(?:more|even) spic\w*"),
    "too_strong_alcohol": (r"(?:слишком|очень|чересчур) крепк\w*", r"спиртов\w*", r"спирт (?:бь|чувству|ощуща)\w*",
                           r"тым күшті", r"too strong", r"boozy"),
    "overpowers_dish": (r"перебива\w*", r"забива\w*", r"заглуша\w*", r"басып кет\w*", r"overpower\w*", r"overwhelm\w*"),
    "lost_behind_dish": (r"теря[ею]тся", r"водянист\w*", r"пресн\w*", r"білінбей\w*", r"сезілмей\w*", r"watery", r"bland"),
    "wouldnt_order_again": (r"больше не (?:закаж|возьм|буду|куплю)\w*", r"не (?:советую|рекомендую)", r"қайта ал(?:ма|май)\w*",
                            r"never again", r"(?:wouldn'?t|won'?t) (?:order|get|buy)"),
}
_KEYWORDS = {chip: re.compile(r"(?<!\w)(?:" + "|".join(pats) + r")", re.I | re.U) for chip, pats in KEYWORDS.items()}
_NEG_BEFORE = frozenset({"не", "нет", "ни", "без", "not", "no", "isn", "wasn", "никак"})
_NEG_AFTER = frozenset({"емес", "жоқ", "жок"})


def normalize_space(raw: Any) -> str:
    """NFC, без управляющих и bidi-символов, пробелы схлопнуты, не больше одной пустой строки подряд."""
    s = unicodedata.normalize("NFC", str(raw))
    s = _CTRL.sub("", s).replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r"[^\S\n]+", " ", s)
    s = "\n".join(line.strip() for line in s.split("\n"))
    return re.sub(r"\n{3,}", "\n\n", s).strip()


def clean_dish_name(raw: Any) -> str:
    return normalize_space(raw).replace("\n", " ")[:MAX_DISH_NAME].strip() if raw is not None else ""


def dish_key(dish_id: str, dish_name: str = "") -> str:
    """Ключ блюда: id каталога или custom:<название в нижнем регистре, ё → е>."""
    if dish_id != "custom":
        return dish_id
    return "custom:" + clean_dish_name(dish_name).lower().replace("ё", "е")[:MAX_DISH_NAME]


def mask_pii(text: str) -> Tuple[str, bool]:
    """Телефоны (10–15 цифр) и e-mail → «[скрыто]». Личные данные в текст отзыва не попадают даже в базу."""
    masked = _EMAIL.sub(MASK, text)
    masked = _PHONE.sub(MASK, masked)
    return masked, masked != text


def _lower(text: str) -> str:
    return text.lower().replace("ё", "е")


def _is_cyr(c: str) -> bool:
    return "а" <= c <= "я" or c == "ё" or c in KK_LETTERS


def guess_lang(text: str) -> str:
    """ru / kk / en по письменности и частым словам; "" — букв нет (эмодзи, цифры).
    Считаем слова, а не буквы: «Efes Pilsener норм» — русский отзыв с латинским брендом."""
    low = _lower(text)
    words = [w for w in _WORD.findall(low) if any(c.isalpha() for c in w)]
    if not words:
        return ""
    if any(c in KK_LETTERS for c in low) or set(words) & KK_WORDS:
        return "kk"
    cyr = sum(1 for w in words if any(_is_cyr(c) for c in w))
    lat = sum(1 for w in words if any("a" <= c <= "z" for c in w) and not any(_is_cyr(c) for c in w))
    if cyr and cyr >= 0.5 * lat:
        return "ru"
    return "en" if lat else ""


def _negated(tokens: List[Tuple[int, str]], start: int) -> bool:
    idx = next((i for i, (pos, _) in enumerate(tokens) if pos >= start), len(tokens))
    before = {w for _, w in tokens[max(0, idx - 2):idx]}
    after = {w for _, w in tokens[idx + 1:idx + 3]}
    return bool(before & _NEG_BEFORE) or bool(after & _NEG_AFTER)


def suggest_chips(text: str) -> List[str]:
    """Метки, которые подсказывают слова текста (с простым учётом отрицания: «не горько», «ащы емес»)."""
    low = _lower(text)
    tokens = [(m.start(), m.group(0)) for m in _WORD.finditer(low)]
    found = []
    for chip in CHIP_IDS:
        rx = _KEYWORDS.get(chip)
        if rx and any(not _negated(tokens, m.start()) for m in rx.finditer(low)):
            found.append(chip)
    return found


def analyze_text(text: str) -> Dict[str, Any]:
    """Офлайн-эвристики по уже очищенному и замаскированному тексту.

    hold = True — автопубликация запрещена (ссылки/контакты или мат): отзыв ждёт модератора.
    Мягкие флаги (повторы символов, КАПС) — только подсказка модератору и ИИ.
    """
    letters = [c for c in text if c.isalpha()]
    upper = sum(1 for c in letters if c.isupper())
    flags = {
        "links": bool(_LINK.search(text)),
        "profanity": bool(_PROFANITY.search(_lower(text))),
        "repeated": bool(_REPEAT.search(text)),
        "caps": len(letters) >= 20 and upper / len(letters) >= 0.7,
        "pii": MASK in text,
        "no_letters": bool(text) and not letters,
    }
    return {
        "lang": guess_lang(text),
        "flags": flags,
        "suggested_chips": suggest_chips(text),
        "hold": flags["links"] or flags["profanity"],
    }


def sanitize_summary(raw: Any, limit: int = 140) -> str:
    """Пересказ от ИИ: одна строка ≤ limit символов; ссылки, контакты и мат — не пропускаем (пересказ пустой)."""
    if not isinstance(raw, str):
        return ""
    s = normalize_space(raw).replace("\n", " ")
    if not s or _LINK.search(s) or _PROFANITY.search(_lower(s)) or mask_pii(s)[1]:
        return ""
    if len(s) > limit:
        cut = s[:limit - 1]
        s = (cut[:cut.rfind(" ")] if " " in cut[limit // 2:] else cut).rstrip(" ,.;:—-") + "…"
    return s


def decide_status(has_text: bool, heur: Optional[Mapping[str, Any]], ai: Optional[Mapping[str, Any]],
                  ai_attempted: bool) -> str:
    """Статус отзыва:
      без текста                          → published (оценка публикуется сразу);
      ИИ разобрал: spam                   → spam; toxic / offtopic / стоп-эвристика → pending; иначе → published;
      ИИ пробовали, но ошибка / таймаут   → по эвристикам: стоп-флаг → pending, иначе published;
      отказ модели (refusal)              → pending (сам отказ — повод посмотреть глазами);
      ИИ не настроен (или лимит разборов) → pending: текст публикует человек.
    """
    if not has_text:
        return "published"
    hold = bool((heur or {}).get("hold"))
    if ai and ai.get("ok"):
        flags = ai.get("flags") or {}
        if flags.get("spam"):
            return "spam"
        if hold or flags.get("toxic") or flags.get("offtopic"):
            return "pending"
        return "published"
    if ai_attempted:
        if (ai or {}).get("error") == "refusal" or hold:
            return "pending"
        return "published"
    return "pending"


_UA_RULES: Tuple[Tuple[str, str], ...] = (
    (r"bot|crawl|spider|curl|wget|python-requests|httpx|okhttp|postman", "bot"),
)


def ua_family(ua: str) -> str:
    """User-Agent → грубый класс «ос/браузер» (≤ 40 символов). Полную строку не храним."""
    s = (ua or "").lower()
    if not s:
        return ""
    for rx, label in _UA_RULES:
        if re.search(rx, s):
            return label
    os_name = ("ios" if re.search(r"iphone|ipad|ipod", s) else "android" if "android" in s else
               "windows" if "windows" in s else "mac" if "mac os" in s or "macintosh" in s else
               "linux" if "linux" in s else "other")
    browser = ("edge" if "edg/" in s else "opera" if "opr/" in s else "yandex" if "yabrowser" in s else
               "samsung" if "samsungbrowser" in s else "firefox" if "firefox" in s or "fxios" in s else
               "chrome" if "chrome" in s or "crios" in s else "safari" if "safari" in s else "other")
    return f"{os_name}/{browser}"[:40]


# ─────────────────────────────────────────────────────────────────────────────
# Экспорт для калибровки (export_guest_pairs)
# ─────────────────────────────────────────────────────────────────────────────
EXPORT_MIN_REVIEWS = 8
EXPORT_MIN_SESSIONS = 5
EXPORT_GOOD = 4.2
EXPORT_BAD = 2.4


def guest_pairs(rows: Iterable[Mapping[str, Any]], archetype_of: Mapping[str, Optional[str]],
                known_dishes: Optional[Iterable[str]] = None, known_archetypes: Optional[Iterable[str]] = None,
                min_reviews: int = EXPORT_MIN_REVIEWS, min_sessions: int = EXPORT_MIN_SESSIONS,
                good: float = EXPORT_GOOD, bad: float = EXPORT_BAD) -> Dict[str, Any]:
    """Пары (архетип × блюдо) с устойчивой оценкой гостей → записи формата data/test_pairs.json «pairs».

    rows — опубликованные отзывы {drink_id, dish_id, rating, verified, session_hash, ai_flags}.
    Не берём: своё блюдо (custom), отзывы, где ИИ заметил, что гость ел другое блюдо, напитки без архетипа.
    Средняя — по гостям, а не по отзывам: сначала средняя каждой сессии (гость мог оценить несколько напитков одного
    архетипа), потом среднее сессий с весом 1.5 у сессий «из заведения». Порог: ≥ min_reviews отзывов от ≥ min_sessions
    сессий; средняя ≥ good → expect "good", ≤ bad → "bad", между — пропуск (гости не уверены — это не эталон).
    """
    dishes_ok = set(known_dishes) if known_dishes is not None else None
    arch_ok = set(known_archetypes) if known_archetypes is not None else None
    groups: Dict[Tuple[str, str], List[Mapping[str, Any]]] = {}
    skipped = Counter()
    for row in rows:
        dish = row.get("dish_id") or ""
        if dish == "custom":
            skipped["custom_dish"] += 1
            continue
        if (row.get("ai_flags") or {}).get("other_dish"):
            skipped["other_dish"] += 1
            continue
        arch = archetype_of.get(row.get("drink_id") or "")
        if not arch or (arch_ok is not None and arch not in arch_ok) or (dishes_ok is not None and dish not in dishes_ok):
            skipped["unknown_id"] += 1
            continue
        groups.setdefault((arch, dish), []).append(row)

    pairs = []
    for (arch, dish), items in sorted(groups.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        sessions: Dict[str, List[Mapping[str, Any]]] = {}
        for it in items:
            sessions.setdefault(str(it.get("session_hash") or ""), []).append(it)
        if len(items) < min_reviews:
            skipped["few_reviews"] += 1
            continue
        if len(sessions) < min_sessions:
            skipped["few_sessions"] += 1
            continue
        num = den = 0.0
        for its in sessions.values():
            w = VERIFIED_WEIGHT if any(i.get("verified") for i in its) else 1.0
            num += w * sum(int(i["rating"]) for i in its) / len(its)
            den += w
        mean = num / den
        raw = sum(int(i["rating"]) for i in items) / len(items)
        if mean >= good - 1e-9:
            expect = "good"
        elif mean <= bad + 1e-9:
            expect = "bad"
        else:
            skipped["undecided"] += 1
            continue
        drinks = Counter(str(i.get("drink_id")) for i in items)
        verified = sum(1 for i in items if i.get("verified"))
        pairs.append({
            "id": f"G-{dish}-{arch}",
            "dish": dish,
            "drink": arch,
            "expect": expect,
            "why": (f"Гости: средняя {r2(mean)} из 5 по {len(items)} оценкам от {len(sessions)} гостей "
                    f"({verified} из заведения). Слабый сигнал — вес задаёт калибратор."),
            "sources": [{"title": "Отзывы гостей Flavor Tree (опубликованные; manage.py export_guest_pairs)",
                         "url": None, "quote": None}],
            "evidence": "G",
            "split": "train",
            "origin": "guests",
            "heat_lover": False,
            "counts": {"reviews": len(items), "sessions": len(sessions), "verified": verified,
                       "mean": r2(mean), "raw_mean": r2(raw), "drinks": dict(sorted(drinks.items()))},
        })
    return {"pairs": pairs, "groups": len(groups), "skipped": dict(skipped)}

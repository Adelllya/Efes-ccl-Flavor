"""Подкрутка весов движка подбора из админки.

Крутилки (KNOBS) — понятный сомелье набор параметров, каждая ложится на dotted-путь
внутри engine_v2_params.json (merge_params понимает "R1.k_loud" и т.п.). Значения
хранятся в БД (EnginePairingWeights), базовый JSON не меняется. При загрузке датасета
переопределения накладываются поверх базы; результат кэшируется по версии записи.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Tuple

from .pairing import dataset_v2 as DS
from .pairing import engine_v2 as E

# path, label, hint, min, max, step
KNOBS = [
    ("score.base", "Базовая щедрость балла", "Общий сдвиг всех оценок вверх или вниз.", 30, 60, 1),
    ("score.k", "Влияние совместимости", "Насколько сильно ядро совместимости растягивает оценки.", 0.5, 1.3, 0.05),
    ("R1.k_loud", "Важность интенсивности", "Совпадение по «громкости» вкуса блюда и напитка.", 40, 90, 1),
    ("R2.tannin", "Рез жирности танином", "Сила, с которой танин режет жир блюда.", 0.0, 0.6, 0.05),
    ("R3.relief_sweet", "Гашение остроты сладостью", "Насколько сладость напитка гасит остроту блюда.", 0.0, 0.6, 0.05),
    ("R4.k_gap", "Штраф за нехватку сладости", "Штраф, если напиток менее сладок, чем требует блюдо.", 0, 50, 1),
    ("R5.k_gap", "Штраф за нехватку кислотности", "Штраф, если кислотности напитка не хватает под блюдо.", 0, 40, 1),
    ("R6.k_forgive", "Прощение горечи солью", "Насколько соль блюда смягчает горечь напитка.", 0, 16, 1),
    ("R7.k_neg", "Жёсткость умами без соли", "Штраф за жёсткость, когда умами не поддержано солью и кислотой.", 0, 24, 1),
    ("R8.k_plus", "Бонус танин и белок", "Бонус за пару насыщенного танина с белковым блюдом.", 0, 30, 1),
]
KNOB_PATHS = [k[0] for k in KNOBS]
KNOB_RANGE = {k[0]: (k[3], k[4]) for k in KNOBS}

_cache: Dict[Tuple[Any, str, int], Any] = {}


def _get_path(d: Dict[str, Any], dotted: str):
    cur = d
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def base_params(data_dir=None) -> Dict[str, Any]:
    return DS.effective_params(Path(data_dir) if data_dir else None)


def sanitize(overrides: Dict[str, Any]) -> Dict[str, Any]:
    """Оставляем только известные пути и число в допустимом диапазоне."""
    out: Dict[str, Any] = {}
    for path in KNOB_PATHS:
        if path not in (overrides or {}):
            continue
        try:
            v = float(overrides[path])
        except (TypeError, ValueError):
            continue
        lo, hi = KNOB_RANGE[path]
        out[path] = max(lo, min(hi, v))
    return out


def current():
    """(row, sanitized_overrides). Импорт модели внутри — избегаем циклов при загрузке apps."""
    from .models import EnginePairingWeights
    row = EnginePairingWeights.load()
    return row, sanitize(row.overrides or {})


def knobs_state(data_dir=None):
    """Список крутилок с базовым значением и текущим (с учётом override)."""
    base = base_params(data_dir)
    row, ov = current()
    items = []
    for path, label, hint, lo, hi, step in KNOBS:
        b = _get_path(base, path)
        items.append({"path": path, "label": label, "hint": hint, "min": lo, "max": hi,
                      "step": step, "base": b, "value": ov.get(path, b)})
    return {"version": row.version, "updated_by": row.updated_by,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
            "has_overrides": bool(ov), "knobs": items}


def save_overrides(overrides: Dict[str, Any], username: str = "") -> None:
    from .models import EnginePairingWeights
    row = EnginePairingWeights.load()
    row.overrides = sanitize(overrides)
    row.updated_by = (username or "")[:150]
    row.save()
    _cache.clear()


def reset(username: str = "") -> None:
    save_overrides({}, username)


def tuned_dataset(data_dir=None, locale: str = "ru"):
    """Датасет с наложенными весами. Без override — обычный кэш dataset_v2 (быстрый путь)."""
    row, ov = current()
    if not ov:
        return DS.get_dataset_locale(data_dir, locale) if locale != "ru" else DS.get_dataset(data_dir)
    key = (data_dir, locale, row.version)
    if key in _cache:
        return _cache[key]
    ds = DS.load_dataset(data_dir, params_override=ov)
    if locale != "ru" and locale in DS.LOCALES:
        path = Path(data_dir or DS.DATA_DIR) / ("engine_v2_texts_%s.json" % locale)
        if path.exists():
            params = E.merge_params(ds.params, DS._read(path))
            ds = DS.DatasetV2(archetypes=ds.archetypes, dishes=ds.dishes, drinks=ds.drinks,
                              classics=ds.classics, tests=ds.tests, params=params, source=ds.source,
                              missing=ds.missing, proposed_archetypes=ds.proposed_archetypes,
                              proposed_dishes=ds.proposed_dishes, data_dir=ds.data_dir,
                              calibration=ds.calibration)
    _cache.clear()
    _cache[key] = ds
    return ds

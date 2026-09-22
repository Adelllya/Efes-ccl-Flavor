#!/usr/bin/env python3
"""Данные движка v2 для SPA: data/drinks_v2_spa.json и data/engine_v2_spa.json.

engine_v2_spa.json — ровно те параметры, с которыми работает сервер (dataset_v2.effective_params: литературные
значения + слой калибровки), классические пары (R20) и метаданные калибровки. Так подбор в браузере совпадает
с API до балла (паритет формул держит data/golden_v2.json).

Полный data/drinks.json (≈ 1.2 МБ: источники, заметки о расчёте профиля, цены) нужен карточке напитка
и API; для подбора в браузере достаточно полей, которые читает движок, и того, что видно в карточке результата.
Этот файл SPA подгружает отдельным чанком при первом подборе, полный — только на странице напитка.

Запуск из корня: python3 scripts/build_spa_data_v2.py   (после scripts/build_catalog_v2.py)
Проверка актуальности: python3 scripts/build_spa_data_v2.py --check  (код 1, если файл устарел)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "drinks.json"
DST = ROOT / "data" / "drinks_v2_spa.json"
ENGINE_DST = ROOT / "data" / "engine_v2_spa.json"
sys.path.insert(0, str(ROOT / "backend"))

# поля, которые читает движок v2 (engine_v2.drink_vector) — без них подбор в браузере разойдётся с сервером
ENGINE_FIELDS = ("id", "name", "display_name", "label_ru", "category", "style", "family", "archetype", "abv",
                 "abv_after_dilution", "ibu", "sensory", "vector_override", "aroma_tags", "origin_affinity",
                 "efes_relation", "flags", "serving")
# поля для карточки результата и каталога
CARD_FIELDS = ("producer", "abv_source", "ibu_source", "vector_source", "vector_confidence", "occasions",
               "availability_kz", "price_kzt", "image", "visual", "legacy_brand_id", "status")
PRODUCER_KEEP = ("name", "group", "country")
AVAIL_KEEP = ("level",)
PRICE_KEEP = ("retail_min", "retail_max", "horeca", "unit_ml", "is_estimate")
STYLE_KEEP = ("archetype", "name", "family", "bjcp_code")
SERVING_KEEP = ("temp_min_c", "temp_max_c", "glass", "ice", "garnish")


def slim(rec: dict) -> dict:
    out = {}
    for k in ENGINE_FIELDS + CARD_FIELDS:
        if k not in rec or rec[k] in (None, "", [], {}):
            continue
        v = rec[k]
        if k == "producer" and isinstance(v, dict):
            v = {kk: v[kk] for kk in PRODUCER_KEEP if v.get(kk)}
        elif k == "availability_kz" and isinstance(v, dict):
            v = {kk: v[kk] for kk in AVAIL_KEEP if v.get(kk)}
        elif k == "price_kzt" and isinstance(v, dict):
            v = {kk: v[kk] for kk in PRICE_KEEP if v.get(kk) is not None}
        elif k == "style" and isinstance(v, dict):
            v = {kk: v[kk] for kk in STYLE_KEEP if v.get(kk)}
        elif k == "serving" and isinstance(v, dict):
            v = {kk: v[kk] for kk in SERVING_KEEP if v.get(kk) not in (None, "")}
        if v in ({}, []):
            continue
        out[k] = v
    desc = rec.get("description") or ""
    if desc:
        out["description"] = desc if len(desc) <= 220 else desc[:217].rsplit(" ", 1)[0] + "…"
    return out


def build() -> str:
    with open(SRC, encoding="utf-8") as f:
        raw = json.load(f)
    recs = raw if isinstance(raw, list) else raw.get("drinks") or raw.get("items") or []
    payload = {
        "_doc": "Сгенерировано scripts/build_spa_data_v2.py из data/drinks.json — не править руками.",
        "source_sha1": hashlib.sha1(SRC.read_bytes()).hexdigest(),
        "count": len(recs),
        "drinks": [slim(r) for r in recs],
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"


def build_engine() -> str:
    from api.pairing import dataset_v2 as D
    params = D.effective_params()
    cal = D.load_calibration()
    classics_path = ROOT / "data" / "classic_pairs.json"
    if classics_path.exists():
        classics = D._as_records(json.loads(classics_path.read_text(encoding="utf-8")))
        classics_src = "classic_pairs.json"
    else:
        proto = D.prototype_dataset()
        classics = proto.classics if proto else []
        classics_src = "prototype"
    payload = {
        "_doc": "Сгенерировано scripts/build_spa_data_v2.py — не править руками. params = engine_v2_params.json "
                "+ engine_v2_calibration.json (если есть).",
        "params": params,
        "calibration": {k: v for k, v in cal.items() if k != "params"} if cal else None,
        "calibration_params": cal["params"] if cal else {},
        "classics": classics,
        "classics_source": classics_src,
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    text = build()
    engine_text = build_engine()
    if a.check:
        stale = [p for p, t in ((DST, text), (ENGINE_DST, engine_text))
                 if not p.exists() or p.read_text(encoding="utf-8") != t]
        if stale:
            sys.exit("устарели: " + ", ".join(str(p.relative_to(ROOT)) for p in stale)
                     + " — запустите python3 scripts/build_spa_data_v2.py")
        print("drinks_v2_spa.json и engine_v2_spa.json актуальны")
        return
    DST.write_text(text, encoding="utf-8")
    ENGINE_DST.write_text(engine_text, encoding="utf-8")
    eng = json.loads(engine_text)
    print(f"{DST.relative_to(ROOT)}: {json.loads(text)['count']} напитков, {len(text.encode('utf-8')) // 1024} КБ "
          f"(полный каталог {SRC.stat().st_size // 1024} КБ)")
    print(f"{ENGINE_DST.relative_to(ROOT)}: калибровка {(eng['calibration'] or {}).get('version', 'нет — литература')}, "
          f"изменённых параметров {len(eng['calibration_params'])}, классических пар {len(eng['classics'])} ({eng['classics_source']})")


if __name__ == "__main__":
    main()

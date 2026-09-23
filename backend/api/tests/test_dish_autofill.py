"""Паритет api/dish_autofill.py (порт для ИИ-сомелье) с оригиналом autofill() из scripts/build_dishes_v2.py.

Фикстура api/tests/data/dish_autofill_v2.json — 32 описания блюда, покрывающие все вкусы, способы приготовления, белки,
соусы, кислоты, десерт, острые и «крахмальные» теги; векторы в ней посчитал сам scripts/build_dishes_v2.py:

    cd backend && .venv/bin/python api/tests/test_dish_autofill.py --write     # пересобрать фикстуру

Тот же файл сверяет с TS-портом (frontend/src/app/engine/custom-dish-v2.ts) скрипт frontend/scripts/ai-dryrun.mjs.
Запуск теста: .venv/bin/python manage.py test api.tests.test_dish_autofill
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from unittest import skipUnless

try:   # как тест Django — SimpleTestCase без базы; как скрипт генерации фикстуры Django не нужен
    from django.test import SimpleTestCase
except Exception:   # pragma: no cover
    from unittest import TestCase as SimpleTestCase  # type: ignore[assignment]

FIXTURE = Path(__file__).resolve().parent / "data" / "dish_autofill_v2.json"
BUILD_SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "build_dishes_v2.py"

# (taste, weight, fat, cook, protein, sauce, acid, dessert, tags, heat)
CASES = [
    ("SALTY", "LIGHT", "LOW", "raw", "none", "none", "none", False, {}, None),
    ("SWEET", "MEDIUM", "MEDIUM", "baked", "none", "none", "none", True, {"chocolate": .8, "dairy_cream": .5}, None),
    ("SOUR", "LIGHT", "LOW", "fermented", "none", "none", "lactic", False, {"cabbage": .6}, None),
    ("BITTER", "MEDIUM", "LOW", "grilled", "none", "none", "none", False, {"asparagus": .7}, None),
    ("UMAMI", "HEAVY", "HIGH", "boiled", "lamb", "broth", "none", False, {"onion": .5, "bread": .8}, None),
    ("SPICY", "HEAVY", "HIGH", "boiled", "lamb", "broth", "none", False, {"onion": .5, "pepper": .6}, .7),
    ("MIXED", "MEDIUM", "MEDIUM", "fried", "poultry", "none", "none", False, {"garlic": .5}, None),
    ("UMAMI", "MEDIUM", "MEDIUM", "steamed", "shellfish", "none", "citrus", False, {"herbal": .4}, None),
    ("UMAMI", "MEDIUM", "HIGH", "grilled", "oily_fish", "none", "citrus", False, {}, None),
    ("UMAMI", "LIGHT", "LOW", "raw", "white_fish", "soy", "vinegar", False, {"rice": .8, "wasabi": .5}, None),
    ("SALTY", "MEDIUM", "HIGH", "cured", "horse", "none", "none", False, {"cured": .7}, None),
    ("SALTY", "HEAVY", "HIGH", "smoked", "pork", "bbq", "none", False, {}, None),
    ("UMAMI", "HEAVY", "HIGH", "braised", "beef", "tomato", "none", False, {}, None),
    ("MIXED", "HEAVY", "HIGH", "baked", "cheese_hard", "cheese", "none", False, {"bread": .6}, None),
    ("MIXED", "MEDIUM", "MEDIUM", "baked", "cheese_soft", "tomato", "none", False, {"bread": .8, "herbal": .4}, None),
    ("SWEET", "LIGHT", "LOW", "raw", "dairy", "none", "none", True, {"coffee": .6, "dairy_cream": .8}, None),
    ("SWEET", "MEDIUM", "MEDIUM", "fried", "none", "sweet_glaze", "none", True, {"honey": .7}, None),
    ("SPICY", "MEDIUM", "MEDIUM", "fried", "poultry", "chili", "none", False, {"chili": .8}, .8),
    ("SOUR", "LIGHT", "LOW", "raw", "none", "vinaigrette", "none", False, {"cucumber": .6, "herbal": .5}, None),
    ("UMAMI", "MEDIUM", "MEDIUM", "boiled", "egg", "cream", "none", False, {}, None),
    ("UMAMI", "MEDIUM", "LOW", "steamed", "legume", "none", "none", False, {"garlic": .3}, None),
    ("SALTY", "LIGHT", "MEDIUM", "fried", "none", "none", "none", False, {"potato": .8, "salt": .6}, None),
    ("MIXED", "MEDIUM", "MEDIUM", "grilled", "beef", "bbq", "none", False, {"char": .7, "onion": .4}, None),
    ("UMAMI", "HEAVY", "HIGH", "fried", "pork", "none", "lactic", False, {"mustard": .5}, None),
    ("BITTER", "LIGHT", "LOW", "raw", "none", "none", "citrus", False, {"artichoke": .5, "spinach": .6}, None),
    ("SWEET", "HEAVY", "HIGH", "baked", "none", "cream", "none", True, {"nutty": .5, "caramel": .6}, None),
    ("SALTY", "MEDIUM", "HIGH", "cured", "beef", "none", "none", False, {"horseradish": .8}, None),
    ("UMAMI", "MEDIUM", "MEDIUM", "smoked", "white_fish", "none", "none", False, {"smoke": .8}, None),
    ("MIXED", "LIGHT", "LOW", "steamed", "none", "soy", "none", False, {"noodles": .8}, None),
    ("SPICY", "LIGHT", "LOW", "raw", "none", "chili", "lactic", False, {"cucumber": .5, "radish": .5}, .5),
    ("UMAMI", "HEAVY", "HIGH", "grilled", "lamb", "none", "none", False, {}, 0.0),
    ("SOUR", "MEDIUM", "MEDIUM", "boiled", "beef", "broth", "tomato", False, {"tomato": .6}, .2),
]
KEYS = ("taste", "weight", "fat", "cook", "protein", "sauce", "acid", "dessert", "tags", "heat")


def build_fixture() -> dict:
    """Векторы из оригинала: scripts/build_dishes_v2.py → autofill(..., share=1.0)."""
    spec = importlib.util.spec_from_file_location("build_dishes_v2", BUILD_SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    cases = []
    for c in CASES:
        vector, acid = mod.autofill(*c)
        cases.append({"spec": dict(zip(KEYS, c)), "vector": vector, "acid": acid})
    return {"_doc": "Сгенерировано api/tests/test_dish_autofill.py --write из scripts/build_dishes_v2.py autofill() — не править руками.",
            "cases": cases}


class DishAutofillParityTests(SimpleTestCase):
    def test_fixture_covers_every_enum(self):
        from api import dish_autofill as D
        data = json.loads(FIXTURE.read_text(encoding="utf-8"))
        specs = [c["spec"] for c in data["cases"]]
        self.assertGreaterEqual(len(specs), 30)
        self.assertEqual({s["taste"] for s in specs}, set(D.TASTES))
        self.assertEqual({s["cook"] for s in specs}, set(D.COOK_METHODS))
        self.assertEqual({s["sauce"] for s in specs}, set(D.SAUCE_RULES))
        self.assertTrue({"none", "lactic", "citrus", "vinegar", "tomato"} <= {s["acid"] for s in specs})
        self.assertGreaterEqual(len({s["protein"] for s in specs}), 13)

    def test_port_matches_build_script_fixture(self):
        from api import dish_autofill as D
        data = json.loads(FIXTURE.read_text(encoding="utf-8"))
        for i, case in enumerate(data["cases"]):
            with self.subTest(case=i, spec=case["spec"]):
                vector, acid = D.autofill_dish(case["spec"])
                self.assertEqual(vector, case["vector"])
                self.assertEqual(acid, case["acid"])

    @skipUnless(BUILD_SCRIPT.exists(), "нет scripts/build_dishes_v2.py — сверять не с чем")
    def test_fixture_is_fresh(self):
        """Фикстура совпадает с тем, что сейчас даёт scripts/build_dishes_v2.py (иначе — пересобрать --write)."""
        self.assertEqual(json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"], build_fixture()["cases"])

    def test_custom_dish_record_adds_cook_tags_and_engine_fields(self):
        from api import dish_autofill as D
        rec = D.custom_dish_record({"name": "Шашлык из курицы", "taste": "UMAMI", "weight": "MEDIUM", "fat": "MEDIUM",
                                    "cook": "grilled", "protein": "poultry", "tags": {"onion": .4}, "cuisine": ["kazakh"]})
        self.assertEqual(rec["tags"], {"char": .7, "smoke": .6, "onion": .4})
        self.assertEqual((rec["id"], rec["cook_method"], rec["protein_source"], rec["sauce"], rec["is_dessert"]),
                         ("custom", "grilled", "poultry", "none", False))
        self.assertEqual(rec["cuisine"], ["kazakh"])
        self.assertEqual(rec["vector"]["smoke"], .7)


if __name__ == "__main__":   # пересборка фикстуры
    if "--write" not in sys.argv:
        print(__doc__)
        sys.exit(0)
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(json.dumps(build_fixture(), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"written {FIXTURE}")

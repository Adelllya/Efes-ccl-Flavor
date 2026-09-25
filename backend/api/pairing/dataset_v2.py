"""Загрузка данных движка v2 из /data/*.json без Django (тесты, CLI, eval, golden).

Файлы (владельцы — см. V2_CONTRACT.md): drinks.json (массив), style_priors_v2.json ({archetype_id: запись}),
dishes_v2.json (массив), classic_pairs.json (массив), test_pairs.json ({pairs, ordinals}), engine_v2_params.json.
Любого файла, кроме params, может не быть — соответствующий список пуст, имя файла попадает в ``missing``.
Каталог данных — тот же, что у v1 (dataset.DATA_DIR = <repo>/data); Django-настройка FLAVOR_DATA_DIR передаётся
через аргумент data_dir.

``prototype_dataset()`` строит тот же набор из docs/research/engine_v2_prototype.py (57 архетипов, 44 блюда,
68 тест-пар, 12 порядковых ограничений, 11 классических пар) в формате контракта — для разработки, тестов и
сравнения с прототипом, пока файлы других потоков не готовы.
"""
from __future__ import annotations

import importlib.util
import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import engine_v2 as E
from .dataset import DATA_DIR

REPO_ROOT = Path(__file__).resolve().parents[3]
PROTOTYPE_PATH = REPO_ROOT / "docs" / "research" / "engine_v2_prototype.py"

FILES = {
    "drinks": "drinks.json",
    "styles": "style_priors_v2.json",
    "dishes": "dishes_v2.json",
    "classics": "classic_pairs.json",
    "tests": "test_pairs.json",
    "params": "engine_v2_params.json",
    "proposed_dishes": "research/proposed_dishes.json",
    "proposed_archetypes": "research/proposed_archetypes.json",
    "calibration": "engine_v2_calibration.json",
}


def _read(path: Path) -> Any:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


_WRAPPER_KEYS = ("items", "drinks", "dishes", "pairs", "classics", "archetypes", "styles")


def _as_records(obj: Any, unwrap: bool = True) -> List[Dict[str, Any]]:
    """Массив записей, или {id: запись} (ключи с «_» и не-объекты пропускаются, id = ключ),
    или обёртка {"items"|"drinks"|...: <одно из двух>}."""
    if isinstance(obj, list):
        return [x for x in obj if isinstance(x, dict)]
    if not isinstance(obj, dict):
        return []
    if unwrap:
        for k in _WRAPPER_KEYS:
            if isinstance(obj.get(k), (list, dict)):
                return _as_records(obj[k], unwrap=False)
    out = []
    for k, v in obj.items():
        if str(k).startswith("_") or not isinstance(v, dict):
            continue
        rec = dict(v)
        rec.setdefault("id", k)
        out.append(rec)
    return out


def load_calibration(data_dir: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    """Слой калибровки (scripts/calibrate_v2.py) или None. Формат: {"version", "fitted_at", "metrics", "params": {путь: число}}."""
    path = Path(data_dir or DATA_DIR) / FILES["calibration"]
    if not path.exists():
        return None
    obj = _read(path)
    if not isinstance(obj, dict) or not isinstance(obj.get("params"), dict):
        return None
    return obj


def effective_params(data_dir: Optional[Path] = None, params_override: Optional[Dict[str, Any]] = None,
                     use_calibration: bool = True) -> Dict[str, Any]:
    """Параметры, с которыми работает продукт: литературные значения (engine_v2_params.json)
    + слой калибровки (engine_v2_calibration.json, если есть и use_calibration) + ручной override."""
    d = Path(data_dir or DATA_DIR)
    params_path = d / FILES["params"]
    params = E.load_params(params_path if params_path.exists() else None)
    cal = load_calibration(d) if use_calibration else None
    if cal:
        params = E.merge_params(params, cal["params"])
    if params_override:
        params = E.merge_params(params, params_override)
    return params


def is_guest_visible(raw: Dict[str, Any]) -> bool:
    """Попадает ли напиток в подбор для гостя (ENGINE_V2_SPEC §8.3): не черновик (стиль не определён)
    и наличие в Казахстане не помечено как неподтверждённое. В каталоге такие позиции видны с пометкой."""
    return raw.get("status") != "draft" and (raw.get("availability_kz") or {}).get("level") != "not_confirmed"


class DatasetV2:
    """Набор данных v2: сырые записи + подготовленные профили движка + индексы."""

    def __init__(self, archetypes: List[Dict[str, Any]], dishes: List[Dict[str, Any]],
                 drinks: Optional[List[Dict[str, Any]]] = None, classics: Optional[List[Dict[str, Any]]] = None,
                 tests: Optional[Dict[str, Any]] = None, params: Optional[Dict[str, Any]] = None,
                 source: str = "files", missing: Optional[List[str]] = None,
                 proposed_archetypes: Optional[List[Dict[str, Any]]] = None,
                 proposed_dishes: Optional[List[Dict[str, Any]]] = None,
                 data_dir: Optional[Path] = None, calibration: Optional[Dict[str, Any]] = None):
        self.params = params or E.default_params()
        self.calibration = calibration   # метаданные слоя калибровки (версия, метрики) или None
        self.source = source
        self.data_dir = data_dir
        self.missing = list(missing or [])
        self.archetypes = list(archetypes)
        self.dishes = list(dishes)
        self.drinks = list(drinks or [])
        self.classics = list(classics or [])
        self.tests = tests or {"pairs": [], "ordinals": []}
        self.proposed_archetypes = list(proposed_archetypes or [])
        self.proposed_dishes = list(proposed_dishes or [])
        P = self.params
        self.archetype_profiles = [E.drink_vector(x, P) for x in self.archetypes]
        self.drink_profiles = [E.drink_vector(x, P) for x in self.drinks]
        self.dish_profiles = [E.dish_vector(x, P) for x in self.dishes]
        self.archetype_by_id = {p["id"]: p for p in self.archetype_profiles}
        self.drink_by_id = {p["id"]: p for p in self.drink_profiles}
        self.dish_by_id = {p["id"]: p for p in self.dish_profiles}
        self.archetype_raw_by_id = {x["id"]: x for x in self.archetypes}
        self.drink_raw_by_id = {x["id"]: x for x in self.drinks}
        self.dish_raw_by_id = {x["id"]: x for x in self.dishes}
        self.classic_index = E.index_classics(self.classics)
        # пул подбора для гостя: без черновиков и неподтверждённых позиций
        self.guest_drink_profiles = [p for raw, p in zip(self.drinks, self.drink_profiles) if is_guest_visible(raw)]

    # удобные обёртки ---------------------------------------------------------
    def score(self, drink_id: str, dish_id: str, ctx: Optional[Dict[str, Any]] = None, explain: bool = True):
        b = self.drink_by_id.get(drink_id) or self.archetype_by_id[drink_id]
        return E.score_pair(b, self.dish_by_id[dish_id], ctx, self.params, self.classic_index, explain)

    def recommend(self, dish_id: str, ctx: Optional[Dict[str, Any]] = None, top_n: Optional[int] = None,
                  use_archetypes: bool = False, **kw):
        pool = self.archetype_profiles if use_archetypes or not self.drink_profiles else self.drink_profiles
        return E.recommend(self.dish_by_id[dish_id], pool, ctx, top_n, self.params, self.classic_index, **kw)

    def by_category(self, dish_id: str, ctx: Optional[Dict[str, Any]] = None, use_archetypes: bool = False, **kw):
        pool = self.archetype_profiles if use_archetypes or not self.drink_profiles else self.drink_profiles
        return E.by_category(self.dish_by_id[dish_id], pool, ctx, self.params, self.classic_index, **kw)

    def reverse(self, drink_id: str, ctx: Optional[Dict[str, Any]] = None, top_n: Optional[int] = None, **kw):
        b = self.drink_by_id.get(drink_id) or self.archetype_by_id[drink_id]
        return E.reverse(b, self.dish_profiles, ctx, top_n, self.params, self.classic_index, **kw)


def load_dataset(data_dir: Optional[Path] = None, params_override: Optional[Dict[str, Any]] = None,
                 use_calibration: bool = True) -> DatasetV2:
    """Читает файлы из data_dir (по умолчанию <repo>/data). Отсутствующие файлы → пустые списки.
    Параметры — effective_params(): литература + слой калибровки (use_calibration=False — только литература)."""
    d = Path(data_dir or DATA_DIR)
    missing: List[str] = []

    def opt(key: str) -> Any:
        path = d / FILES[key]
        if not path.exists():
            missing.append(FILES[key])
            return None
        return _read(path)

    params = effective_params(d, params_override, use_calibration)
    calibration = load_calibration(d) if use_calibration else None
    tests_raw = opt("tests")
    tests = None
    if isinstance(tests_raw, dict):
        tests = {"pairs": list(tests_raw.get("pairs") or []), "ordinals": list(tests_raw.get("ordinals") or [])}
    elif isinstance(tests_raw, list):
        tests = {"pairs": tests_raw, "ordinals": []}
    return DatasetV2(
        archetypes=_as_records(opt("styles")),
        dishes=_as_records(opt("dishes")),
        drinks=_as_records(opt("drinks")),
        classics=_as_records(opt("classics")),
        tests=tests,
        params=params,
        source="files",
        missing=missing,
        proposed_archetypes=_as_records(opt("proposed_archetypes")),
        proposed_dishes=_as_records(opt("proposed_dishes")),
        data_dir=d,
        calibration={k: v for k, v in calibration.items() if k != "params"} if calibration else None,
    )


@lru_cache(maxsize=4)
def get_dataset(data_dir: Optional[str] = None) -> DatasetV2:
    """Кэшированный набор (на процесс). Для перечитывания — get_dataset.cache_clear()."""
    return load_dataset(Path(data_dir) if data_dir else None)


LOCALES = ("kk", "en")


@lru_cache(maxsize=8)
def get_dataset_locale(data_dir: Optional[str] = None, locale: str = "ru") -> DatasetV2:
    """Набор для языка гостя: те же записи и баллы, слой текстов engine_v2_texts_{kk,en}.json поверх параметров.
    Профили строятся заново — слова («жир баранины», «сыраның») вшиваются в профиль при построении.
    Неизвестный язык или нет файла слоя — русский набор."""
    base = get_dataset(data_dir)
    if locale not in LOCALES:
        return base
    path = Path(data_dir or DATA_DIR) / f"engine_v2_texts_{locale}.json"
    if not path.exists():
        return base
    params = E.merge_params(base.params, _read(path))
    return DatasetV2(archetypes=base.archetypes, dishes=base.dishes, drinks=base.drinks, classics=base.classics,
                     tests=base.tests, params=params, source=base.source, missing=base.missing,
                     proposed_archetypes=base.proposed_archetypes, proposed_dishes=base.proposed_dishes,
                     data_dir=base.data_dir, calibration=base.calibration)


# ─────────────────────────────────────────────────────────────────────────────
# прототип → формат контракта (разработка / тесты / сравнение)
# ─────────────────────────────────────────────────────────────────────────────
PROTOTYPE_LABELS_RU = {
    "light_lager": "Лёгкий лагер", "pale_lager_intl": "Светлый лагер", "czech_pale_premium": "Чешский светлый лагер",
    "german_pils": "Немецкий пилснер", "helles": "Мюнхенский хеллес", "amber_lager": "Янтарный лагер",
    "czech_dark": "Чешский тёмный лагер", "strong_lager": "Крепкий лагер", "rice_lager": "Рисовый лагер",
    "weissbier": "Вайсбир", "witbier": "Витбир", "american_pale_ale": "Американский пейл-эль",
    "american_ipa_45": "IPA", "double_ipa_85": "Двойной IPA", "brown_ale": "Коричневый эль", "porter": "Портер",
    "dry_stout": "Сухой стаут", "milk_stout": "Молочный стаут", "imperial_stout": "Имперский стаут",
    "barleywine": "Ячменное вино", "rauchbier": "Раухбир", "kriek_sour": "Крик", "na_lager": "Безалкогольный лагер",
    "radler": "Радлер", "cider_dry": "Сухой сидр", "cider_semi_dry": "Полусухой сидр",
    "cider_sweet_commercial": "Сладкий сидр", "white_dry": "Сухое белое вино", "riesling_off_dry": "Полусухой рислинг",
    "brut_sparkling": "Брют", "demi_sec_sparkling": "Полусладкое игристое", "red_light": "Лёгкое красное вино",
    "cabernet": "Каберне", "shiraz": "Шираз", "red_semi_sweet": "Полусладкое красное вино", "port": "Портвейн",
    "aperol_spritz": "Апероль шприц", "negroni": "Негрони", "margarita": "Маргарита", "old_fashioned": "Олд фэшн",
    "manhattan": "Манхэттен", "gin_tonic": "Джин-тоник", "white_russian": "Белый русский", "whisky_neat": "Виски",
    "cask_strength_whisky": "Виски cask strength", "peated_whisky": "Торфяной виски", "vodka_neat": "Водка",
    "mezcal": "Мескаль", "kvass_classic": "Квас", "kvass_sour": "Кислый квас", "lemonade_sweet": "Лимонад",
    "soda_water": "Содовая", "ayran": "Айран", "kumys": "Кумыс", "shubat": "Шубат",
    "black_tea_strong": "Крепкий чёрный чай", "green_tea": "Зелёный чай",
}

PROTOTYPE_FAMILIES = {
    "light_lager": "LAGER", "pale_lager_intl": "LAGER", "czech_pale_premium": "LAGER", "german_pils": "LAGER",
    "helles": "LAGER", "rice_lager": "LAGER", "strong_lager": "STRONG_LAGER", "amber_lager": "AMBER_LAGER",
    "czech_dark": "DARK_LAGER", "weissbier": "WHEAT", "witbier": "WHEAT", "american_pale_ale": "IPA",
    "american_ipa_45": "IPA", "double_ipa_85": "IPA", "brown_ale": "BROWN_ALE", "porter": "STOUT",
    "dry_stout": "STOUT", "milk_stout": "STOUT", "imperial_stout": "STOUT", "barleywine": "STRONG_ALE",
    "rauchbier": "SMOKED", "kriek_sour": "SOUR", "na_lager": "NA_BEER", "radler": "RADLER", "cider_dry": "CIDER",
    "cider_semi_dry": "CIDER", "cider_sweet_commercial": "CIDER", "white_dry": "WHITE", "riesling_off_dry": "WHITE",
    "brut_sparkling": "SPARKLING", "demi_sec_sparkling": "SPARKLING", "red_light": "RED", "cabernet": "RED",
    "shiraz": "RED", "red_semi_sweet": "RED", "port": "FORTIFIED", "aperol_spritz": "SPRITZ",
    "negroni": "BITTER_COCKTAIL", "margarita": "SOUR_COCKTAIL", "old_fashioned": "STIRRED", "manhattan": "STIRRED",
    "gin_tonic": "HIGHBALL", "white_russian": "CREAM_COCKTAIL", "whisky_neat": "WHISKY",
    "cask_strength_whisky": "WHISKY", "peated_whisky": "WHISKY", "vodka_neat": "VODKA", "mezcal": "AGAVE",
    "kvass_classic": "KVASS", "kvass_sour": "KVASS", "lemonade_sweet": "LEMONADE", "soda_water": "WATER",
    "ayran": "FERMENTED_DAIRY", "kumys": "FERMENTED_DAIRY", "shubat": "FERMENTED_DAIRY",
    "black_tea_strong": "TEA", "green_tea": "TEA",
}


def load_prototype_module():
    """Импортирует docs/research/engine_v2_prototype.py как модуль (None, если файла нет)."""
    if not PROTOTYPE_PATH.exists():
        return None
    spec = importlib.util.spec_from_file_location("engine_v2_prototype", PROTOTYPE_PATH)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def prototype_archetype_record(k: Dict[str, Any]) -> Dict[str, Any]:
    """K(...) прототипа → запись style_priors_v2 (carb→carbonation, aroma→aroma_intensity, temp→serve_temp,
    alcohol = clamp(abv/40))."""
    return {
        "id": k["id"], "category": k["cat"], "family": PROTOTYPE_FAMILIES.get(k["id"], k["cat"].upper()),
        "abv": k["abv"], "ibu": k["ibu"],
        "sensory": {"sweet": k["sweet"], "acid": k["acid"], "bitter": k["bitter"], "tannin": k["tannin"],
                    "carbonation": k["carb"], "alcohol": E.clamp(k["abv"] / 40), "body": k["body"], "dairy": k["dairy"],
                    "salt": k["salt"], "umami": k["umami"], "aroma_intensity": k["aroma"], "roast": k["roast"],
                    "smoke": k["smoke"], "serve_temp": k["temp"]},
        "aroma_tags": dict(k["tags"]), "origin_affinity": list(k["origin"]),
        "label_ru": PROTOTYPE_LABELS_RU.get(k["id"], k["id"]), "anchor": "engine_v2_prototype.py v2.1",
    }


def prototype_dish_record(dd: Dict[str, Any]) -> Dict[str, Any]:
    rec = {
        "id": dd["id"], "name": dd["name"], "cuisine": list(dd["cuisine"]), "is_dessert": bool(dd["dessert"]),
        "vector": {a: dd[a] for a in E.DISH_AXES},
        "acid_type": "vinegar" if dd["vinegar"] else "none",
        "tags": dict(dd["tags"]), "vector_source": "prototype", "legacy": False,
    }
    if dd["cold"]:
        rec["serve_temp"] = "cold"
    return rec


def prototype_tests(mod) -> Dict[str, Any]:
    pairs = []
    for i, (dish, drink, exp) in enumerate(mod.TESTS, 1):
        # прототип считает old_fashioned в контексте трапезы (evaluate(): ctx = {"occasion": "meal"})
        ctx = {"occasion": "meal"} if drink == "old_fashioned" else {}
        pairs.append({"id": f"T{i:02d}", "dish": dish, "drink": drink, "expect": exp, "split": "train",
                      "origin": "spec_v2", "ctx": ctx, "heat_lover": False})
    ordinals = []
    for i, (dish, a, b, gap, ctx, why) in enumerate(mod.ORDINALS, 1):
        ordinals.append({"id": f"O{i:02d}", "dish": dish, "a": a, "b": b, "min_gap": gap, "ctx": dict(ctx), "why": why})
    return {"pairs": pairs, "ordinals": ordinals}


def prototype_classics(mod) -> List[Dict[str, Any]]:
    return [{"dish": dish, "drink": drink, "bonus": 8, "label": "классика",
             "source": {"title": why, "url": None, "quote": None}}
            for (dish, drink), why in mod.CLASSICS.items()]


def prototype_dataset(params: Optional[Dict[str, Any]] = None) -> Optional[DatasetV2]:
    mod = load_prototype_module()
    if mod is None:
        return None
    return DatasetV2(
        archetypes=[prototype_archetype_record(k) for k in mod.DRINKS],
        dishes=[prototype_dish_record(x) for x in mod.DISHES],
        drinks=[], classics=prototype_classics(mod), tests=prototype_tests(mod), params=params,
        source="prototype",
    )

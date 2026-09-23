#!/usr/bin/env python3
"""Проверка оверлеев текстов движка v2: data/engine_v2_texts_kk.json и data/engine_v2_texts_en.json.

Оверлей — поддерево data/engine_v2_params.json только с текстами и подписями на другом языке (docs/ENGINE_TEXTS.md).
Пользовательский текст — строковый лист params (не _doc), в котором есть кириллица или {слот}.

Что проверяется:
  1. покрытие: у каждого текста/подписи params есть перевод в каждом оверлее;
  2. нет лишних путей: всё, что лежит в оверлее, — тексты params; id, теги и пороги внутри массивов с текстами
     (merge_params заменяет массивы целиком) совпадают с params байт в байт;
  3. у каждого шаблона тот же набор {слотов}, те же ведущие/хвостовые пробелы, нет «висячих» скобок;
  4. в английском оверлее нет ни одной кириллической буквы;
  5. рендер: оверлей накладывается engine_v2.merge_params на effective_params() (как в продукте), профили напитков
     и блюд строятся заново из сырых записей с параметрами локали (в профилях лежат готовые слова), движок считает
     «все блюда × ~40 напитков (каждая категория) × 13 контекстов» и recommend/by_category (в т. ч. меню заведения).
     Баллы, бэнды, вето, ключи правил и порядок выдачи обязаны совпасть с русским прогоном; в текстах — ни «{»,
     ни «None», ни пустых строк, ни предложения со строчной буквы; в en — ни одной кириллической буквы, кроме
     названий напитков/блюд и источника классической пары (это данные, не шаблоны); в kk — ни одного служебного
     русского слова; переведённый текст не совпадает с русским.

Запуск из корня:  python3 scripts/check_engine_texts.py [--drinks 40] [--show N]
  --show N  — напечатать N отрендеренных объяснений на каждом языке рядом с русским (для вычитки).
Код выхода 1 — если найдена хотя бы одна проблема.
"""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Set, Tuple

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from api.pairing import dataset_v2 as D  # noqa: E402
from api.pairing import engine_v2 as E  # noqa: E402

PARAMS_PATH = ROOT / "data" / "engine_v2_params.json"
OVERLAY_PATHS = {"kk": ROOT / "data" / "engine_v2_texts_kk.json", "en": ROOT / "data" / "engine_v2_texts_en.json"}
LANGS = ("kk", "en")
ALL_LANGS = ("ru",) + LANGS

CYR = re.compile(r"[\u0400-\u04FF]")  # кириллица, включая казахские буквы
SLOT = re.compile(r"\{(\w+)\}")
LETTERS = re.compile(r"[^\W\d_]+")
NONE_WORD = re.compile(r"\bNone\b")
SPACE_BEFORE_PUNCT = re.compile(r" [,.;:)]|\( ")
# служебные слова русского, которых нет в казахском («не», «да», «же», «от», «без», «у» — казахские слова, их тут нет)
RU_ONLY_WORDS = frozenset((
    "и", "а", "но", "в", "во", "с", "со", "к", "ко", "на", "для", "до", "по", "из", "за", "при", "под", "над",
    "что", "как", "это", "или", "чем", "уже", "ещё", "очень", "тоже", "только", "чуть", "рядом", "нет", "есть",
    "его", "её", "их", "блюдо", "блюда", "блюду", "напиток", "напитка", "пиво", "пива", "вкус", "вкуса", "пара",
))
# блоки params с текстами страниц (не вывод движка): в рендере не встречаются, проверяются статически
PAGE_TEXTS = ("rules_summary",)
# поля результатов движка, которые содержат текст (всё остальное обязано совпасть с русским прогоном)
TEXT_FIELD = re.compile(r'"(?:text|band_label|label|note)": "(?:[^"\\]|\\.)*"')

JPath = Tuple[Any, ...]


# ─────────────────────────────────────────────────────────────────────────────
# обход JSON
# ─────────────────────────────────────────────────────────────────────────────
def walk(o: Any, path: JPath = ()) -> Iterable[Tuple[JPath, Any]]:
    """Листья (путь, значение); пустой словарь/массив — тоже лист."""
    if isinstance(o, dict) and o:
        for k, v in o.items():
            yield from walk(v, path + (k,))
    elif isinstance(o, list) and o:
        for i, v in enumerate(o):
            yield from walk(v, path + (i,))
    else:
        yield path, o


def get(obj: Any, path: JPath) -> Any:
    cur = obj
    for k in path:
        if isinstance(k, int):
            if not isinstance(cur, list) or k >= len(cur):
                raise KeyError(k)
        elif not isinstance(cur, dict) or k not in cur:
            raise KeyError(k)
        cur = cur[k]
    return cur


def fmt(path: JPath) -> str:
    out = ""
    for k in path:
        out += f"[{k}]" if isinstance(k, int) else (("." if out else "") + str(k))
    return out


def is_doc(path: JPath) -> bool:
    return "_doc" in path


def is_text(v: Any) -> bool:
    return isinstance(v, str) and bool(CYR.search(v) or SLOT.search(v))


def edge_ws(s: str) -> Tuple[str, str]:
    return s[: len(s) - len(s.lstrip())], s[len(s.rstrip()):]


def text_inventory(params: Dict[str, Any]) -> Tuple[Dict[JPath, str], List[JPath]]:
    """Все пользовательские тексты params и массивы, в которых они лежат (такие массивы оверлей несёт целиком)."""
    texts = {p: v for p, v in walk(params) if not is_doc(p) and is_text(v)}
    arrays: List[JPath] = []
    for p in texts:
        for i, k in enumerate(p):
            if isinstance(k, int):
                if p[:i] not in arrays:
                    arrays.append(p[:i])
                break
    return texts, arrays


# ─────────────────────────────────────────────────────────────────────────────
# 1–4: статическая проверка оверлея
# ─────────────────────────────────────────────────────────────────────────────
class Problems:
    def __init__(self) -> None:
        self.items: Dict[str, Dict[str, List[str]]] = defaultdict(lambda: defaultdict(list))

    def add(self, lang: str, kind: str, detail: str) -> None:
        self.items[lang][kind].append(detail)

    def count(self, lang: Optional[str] = None) -> int:
        langs = [lang] if lang else list(self.items)
        return sum(len(v) for g in langs for v in self.items.get(g, {}).values())

    def print(self, limit: int = 6) -> None:
        for lang, kinds in self.items.items():
            for kind, details in kinds.items():
                print(f"  [{lang}] {kind}: {len(details)}")
                for d in details[:limit]:
                    print(f"      {d}")
                if len(details) > limit:
                    print(f"      … ещё {len(details) - limit}")


def static_check(lang: str, params: Dict[str, Any], texts: Dict[JPath, str], arrays: Sequence[JPath],
                 overlay: Dict[str, Any], P: Problems) -> Dict[str, Any]:
    stats: Dict[str, Any] = {"covered": 0, "missing": 0, "extra": 0, "numbers": [], "same_as_ru": []}
    for path, ru in texts.items():
        try:
            tr = get(overlay, path)
        except KeyError:
            stats["missing"] += 1
            P.add(lang, "нет перевода (1)", fmt(path))
            continue
        if not isinstance(tr, str):
            P.add(lang, "не строка", f"{fmt(path)}: {type(tr).__name__}")
            continue
        stats["covered"] += 1
        ru_slots, tr_slots = set(SLOT.findall(ru)), set(SLOT.findall(tr))
        if ru_slots != tr_slots:
            P.add(lang, "другой набор {слотов} (3)", f"{fmt(path)}: ru {sorted(ru_slots)} ≠ {lang} {sorted(tr_slots)}")
        if "{" in SLOT.sub("", tr) or "}" in SLOT.sub("", tr):
            P.add(lang, "висячая скобка (3)", f"{fmt(path)}: {tr!r}")
        if edge_ws(ru) != edge_ws(tr):
            P.add(lang, "другие краевые пробелы (3)", f"{fmt(path)}: ru {ru!r} / {lang} {tr!r}")
        if not tr.strip() or "  " in tr:
            P.add(lang, "пустая строка или двойной пробел", f"{fmt(path)}: {tr!r}")
        if tr == ru:
            stats["same_as_ru"].append(fmt(path))
        if ru[:1].isupper() and tr[:1].islower():
            P.add(lang, "строчная буква там, где в ru заглавная", f"{fmt(path)}: {tr!r}")
        if lang == "kk":
            ru_words = sorted(set(w for w in LETTERS.findall(SLOT.sub(" ", tr).lower()) if w in RU_ONLY_WORDS))
            if ru_words:
                P.add(lang, "русские слова в kk-оверлее", f"{fmt(path)}: {ru_words} — {tr!r}")
    for path, v in walk(overlay):
        if is_doc(path):
            doc_parent = path[: path.index("_doc") + 1]
            try:
                get(params, doc_parent)
            except KeyError:
                stats["extra"] += 1
                P.add(lang, "лишний путь (2)", fmt(path))
            continue
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            stats["numbers"].append(fmt(path))
        if path in texts:
            continue
        arr = next((a for a in arrays if path[: len(a)] == a), None)
        try:
            pv = get(params, path)
        except KeyError:
            pv = KeyError
        if arr is None or pv is KeyError:
            stats["extra"] += 1
            P.add(lang, "лишний путь (2)", f"{fmt(path)} = {v!r}")
        elif pv != v or type(pv) is not type(v):
            P.add(lang, "массив расходится с params (2)", f"{fmt(path)}: {v!r} ≠ params {pv!r}")
    for a in arrays:  # массив заменяется целиком: каждый нетекстовый лист params обязан быть в оверлее
        try:
            oa = get(overlay, a)
        except KeyError:
            continue
        pa = get(params, a)
        if not isinstance(oa, list) or len(oa) != len(pa):
            P.add(lang, "массив расходится с params (2)", f"{fmt(a)}: другая длина или тип")
            continue
        for path, _ in walk(pa, a):
            if path not in texts:
                try:
                    get(overlay, path)
                except KeyError:
                    P.add(lang, "массив расходится с params (2)", f"{fmt(path)}: нет в оверлее")
    if lang == "en":
        for path, v in walk(overlay):
            if isinstance(v, str) and CYR.search(v):
                P.add(lang, "кириллица в en-оверлее (4)", f"{fmt(path)}: {v!r}")
    return stats


# ─────────────────────────────────────────────────────────────────────────────
# 5: рендер
# ─────────────────────────────────────────────────────────────────────────────
def numbers_sig(o: Any) -> str:
    """Результат движка без текстов: баллы, бэнды, вето, ключи и очки правил, порядок выдачи — всё остальное."""
    return TEXT_FIELD.sub('""', json.dumps(o, sort_keys=True, ensure_ascii=False))


def pick_drinks(ds: D.DatasetV2, n: int) -> List[Dict[str, Any]]:
    """Детерминированная выборка ~n напитков из гостевого пула, чтобы в рендер попало как можно больше разных текстов.

    1. Каждый напиток пула один раз считается со всеми блюдами (контекст по умолчанию); его «подпись» — какие
       ключи правил, вето и «хвосты» фраз (R4 фрукт, R5 танины/сладкое, R7 умами) он порождает.
    2. Жадно: следующий — тот, кто добавляет больше всего новых ключей (при равенстве — меньший id).
    3. Каждая категория представлена (лучший по новизне напиток категории).
    4. Остаток — рекордсмены осей и по кругу по категориям."""
    pool = sorted(ds.guest_drink_profiles, key=lambda p: p["id"])
    P0 = ds.params
    tails = [(f"{r}.{k}", P0[r]["texts"][k]) for r, k in (("R4", "fruit"), ("R5", "tannin"), ("R5", "sweet"),
                                                         ("R7", "match"))]
    sig: Dict[str, Set[str]] = {}
    for p in pool:
        keys: Set[str] = set()
        for d in ds.dish_profiles:
            r = E.score_pair(p, d, {}, P0, ds.classic_index, True)
            for c in r["components"]:
                keys.add(f"{c['rule']}.{c['key']}" if c["rule"] != "R12" else "R12")
                keys.update(name for name, tail in tails if tail and tail in c["text"])
            keys.update(r["vetoes"])
        sig[p["id"]] = keys
    chosen: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    covered: Set[str] = set()

    def take(p: Optional[Dict[str, Any]]) -> None:
        if p is not None and p["id"] not in seen and len(chosen) < n:
            seen.add(p["id"])
            chosen.append(p)
            covered.update(sig[p["id"]])

    def best(cands: Iterable[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        top, gain = None, 0
        for p in cands:
            g = len(sig[p["id"]] - covered)
            if p["id"] not in seen and g > gain:
                top, gain = p, g
        return top

    while len(chosen) < n:
        p = best(pool)
        if p is None:
            break
        take(p)
    for cat in E.CATEGORIES:
        if not any(p["category"] == cat for p in chosen):
            in_cat = [p for p in pool if p["category"] == cat and p["id"] not in seen]
            take(best(in_cat) or (in_cat[0] if in_cat else None))
    for ax in E.DRINK_AXES:
        if ax != "serve_temp":
            rest = [p for p in pool if p["id"] not in seen]
            if rest:
                take(min(rest, key=lambda p, a=ax: (-p["v"][a], p["id"])))
    by_cat: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for p in pool:
        by_cat[p["category"]].append(p)
    while len(chosen) < n and any(p["id"] not in seen for p in pool):
        for cat in sorted(by_cat):
            take(next((p for p in by_cat[cat] if p["id"] not in seen), None))
    return chosen


def data_values(b: Dict[str, Any], d: Dict[str, Any], classic: Optional[Dict[str, Any]]) -> List[str]:
    """Строки из данных (не из шаблонов): названия напитка и блюда, источник классической пары."""
    vals = [str(b["name"]), str(d["name"])]
    if classic:
        src = classic.get("source")
        vals.append(str((src.get("title") if isinstance(src, dict) else src) or ""))
        vals.append(str(classic.get("label") or ""))
    return sorted((v for v in vals if v), key=len, reverse=True)


def starts_lowercase(text: str, vals: Sequence[str]) -> bool:
    s = text.lstrip("«“\"'(")
    if any(s.startswith(v) for v in vals):
        return False
    for ch in s:
        if ch.isalpha():
            return ch.islower()
        if ch.isdigit():
            return False
    return False


def check_text(lang: str, text: str, ru_text: str, vals: Sequence[str], where: str, P: Problems,
               allow_same: bool = False) -> None:
    if not text:
        P.add(lang, "пустой текст (5)", where)
        return
    if "{" in text or "}" in text:
        P.add(lang, "незаполненный {слот} (5)", f"{where}: {text}")
    if NONE_WORD.search(text):
        P.add(lang, "None в тексте (5)", f"{where}: {text}")
    if text != text.strip() or "  " in text or SPACE_BEFORE_PUNCT.search(text):
        P.add(lang, "лишние пробелы (5)", f"{where}: {text!r}")
    if starts_lowercase(text, vals):
        P.add(lang, "предложение со строчной буквы (5)", f"{where}: {text}")
    rest = text
    for v in vals:
        rest = rest.replace(v, " ")
    if lang == "en" and CYR.search(rest):
        P.add(lang, "кириллица в en-тексте (5)", f"{where}: {text}")
    if lang == "kk":
        ru_words = sorted(set(w for w in LETTERS.findall(rest.lower()) if w in RU_ONLY_WORDS))
        if ru_words:
            P.add(lang, "русские слова в kk-тексте (5)", f"{where}: {ru_words} — {text}")
    if lang != "ru" and not allow_same and text == ru_text:
        P.add(lang, "текст совпадает с русским (5)", f"{where}: {text}")


def contexts(ds: D.DatasetV2, sample_raw: Sequence[Dict[str, Any]]) -> List[Tuple[str, Dict[str, Any]]]:
    dna = E.dna_vector([{"drink": raw, "rating": r} for raw, r in zip(sample_raw, ("love", "like", "like", "dislike"))],
                       ds.params)
    ctxs: List[Tuple[str, Dict[str, Any]]] = [("default", {})]
    for occ in ("meal", "aperitif", "dessert", "hot", "evening", "party", "gourmet"):
        ctxs.append((occ, {"occasion": occ}))
    ctxs += [("heat_lover", {"heat_lover": True}),
             ("sensitive", {"harsh_tol": "sensitive"}),
             ("non_alcoholic", {"non_alcoholic": True}),
             ("bitter+ sweet- dna", {"bitter_pref": 1, "sweet_pref": -1, "dna": dna}),
             ("bitter- sweet+ tolerant", {"bitter_pref": -1, "sweet_pref": 1, "harsh_tol": "tolerant"})]
    return ctxs


def render(ds: D.DatasetV2, overlays: Dict[str, Dict[str, Any]], n_drinks: int, P: Problems,
           show: int) -> Dict[str, Any]:
    base = ds.params  # effective_params(): литература + слой калибровки — как в продукте
    params = {"ru": base}
    for lang in LANGS:
        params[lang] = E.merge_params(base, overlays[lang])
    cidx = ds.classic_index
    sample = pick_drinks(ds, n_drinks)
    sample_raw = [ds.drink_raw_by_id[p["id"]] for p in sample]
    # профили — заново из сырых записей с параметрами локали: в профилях лежат готовые слова (cat_gen, fat_src…)
    drinks = {lang: [E.drink_vector(raw, params[lang]) for raw in sample_raw] for lang in ALL_LANGS}
    dishes = {lang: [E.dish_vector(raw, params[lang]) for raw in ds.dishes] for lang in ALL_LANGS}
    ctxs = contexts(ds, sample_raw)
    n_results = 0
    n_texts: Counter = Counter()
    unique: Dict[str, Set[str]] = {lang: set() for lang in ALL_LANGS}
    examples: Dict[str, Dict[str, List[Tuple[str, str, str]]]] = {lang: defaultdict(list) for lang in LANGS}
    checked: Set[Tuple[Any, ...]] = set()

    def check(lang: str, text: str, ru_text: str, vals: Sequence[str], where: str, allow_same: bool = False) -> None:
        n_texts[lang] += 1
        unique[lang].add(text)
        key = (lang, text, ru_text, tuple(vals), allow_same)
        if key not in checked:  # тот же текст той же пары в другом контексте проверять незачем
            checked.add(key)
            check_text(lang, text, ru_text, vals, where, P, allow_same)

    for cname, ctx in ctxs:
        for bi in range(len(sample_raw)):
            for di in range(len(ds.dishes)):
                res = {lang: E.score_pair(drinks[lang][bi], dishes[lang][di], ctx, params[lang], cidx, True)
                       for lang in ALL_LANGS}
                n_results += 1
                ru = res["ru"]
                b, d = drinks["ru"][bi], dishes["ru"][di]
                where = f"{cname} · {b['id']} × {d['id']}"
                ru_sig = numbers_sig(ru)
                for lang in LANGS:
                    if numbers_sig(res[lang]) != ru_sig:
                        P.add(lang, "числа отличаются от ru (5)", where)
                vals = data_values(b, d, E._classic_lookup(cidx, d, b))
                ru_items = ru["components"] + [w for w in ru["warnings"] if w["family"] == "veto"]
                for lang in ALL_LANGS:
                    items = res[lang]["components"] + [w for w in res[lang]["warnings"] if w["family"] == "veto"]
                    if len(items) != len(ru_items):
                        continue  # уже отмечено как расхождение чисел
                    for c, rc in zip(items, ru_items):
                        rk = f"{c['rule']}.{c['key']}"
                        check(lang, c["text"], rc["text"], vals, f"{where} · {rk}")
                        if lang != "ru" and show:
                            ex = examples[lang][c["rule"] if c["rule"] == "R12" else rk]
                            if len(ex) < 3 and all(e[1] != c["text"] for e in ex):
                                ex.append((rc["text"], c["text"], where))
                    check(lang, res[lang]["band_label"], ru["band_label"], [], f"{where} · band", allow_same=True)

    # выдача: recommend (политика Efes, диверсификация) и by_category (вкладки), с меню заведения и без
    venue = [p["id"] for p in drinks["ru"][::2]]
    n_lists = 0
    for di in range(0, len(ds.dishes), 2):
        for cname, ctx in (("default", {}), ("non_alcoholic", {"non_alcoholic": True})):
            for vname, venue_ids in (("все", None), ("заведение", venue)):
                out = {lang: (E.recommend(dishes[lang][di], drinks[lang], ctx, None, params[lang], cidx,
                                          venue_drink_ids=venue_ids),
                              E.by_category(dishes[lang][di], drinks[lang], ctx, params[lang], cidx, per_category=3,
                                            venue_drink_ids=venue_ids))
                       for lang in ALL_LANGS}
                n_lists += 1
                where = f"recommend/by_category · {cname} · {vname} · {ds.dishes[di]['id']}"
                ru_sig = numbers_sig(out["ru"])
                ru_rec, ru_cat = out["ru"]
                for lang in ALL_LANGS:
                    if lang != "ru" and numbers_sig(out[lang]) != ru_sig:
                        P.add(lang, "выдача отличается от ru (5)", where)
                    rec, cat = out[lang]
                    check(lang, rec["policy"]["note"], ru_rec["policy"]["note"], [], where)
                    for g, rg in zip(cat["categories"], ru_cat["categories"]):
                        check(lang, g["label"], rg["label"], [], f"{where} · {g['category']}", allow_same=True)
    return {"sample": sample, "contexts": [c for c, _ in ctxs], "n_results": n_results, "n_lists": n_lists,
            "n_texts": n_texts, "unique": unique, "examples": examples}


def exercised(texts: Dict[JPath, str], source: Dict[str, Any], rendered: Set[str]) -> Set[JPath]:
    """Строки, которые реально попали в вывод (оценка): литеральные куски строки (между {слотами}) встречаются
    в одном отрендеренном тексте подряд, как отдельные слова/фразы; регистр не важен (подписи бывают с заглавной
    через *_cap). Общие слова вроде «smoke» могут дать ложное «встретилось» — это отчёт, а не проверка."""
    lowered = [(t, t.lower()) for t in rendered]
    out: Set[JPath] = set()
    for path in texts:
        try:
            s = get(source, path)
        except KeyError:
            continue
        parts = [x for x in (y.strip() for y in SLOT.split(s)[::2]) if x]
        if not parts:
            continue
        pattern = r"[^\n]*?".join(re.escape(x) for x in parts)
        if re.match(r"\w", parts[0]):
            pattern = r"(?<!\w)" + pattern
        if re.search(r"\w$", parts[-1]):
            pattern += r"(?!\w)"
        rx = re.compile(pattern, re.IGNORECASE)
        key = max(parts, key=len).lower()
        if any(key in tl and rx.search(t) for t, tl in lowered):
            out.add(path)
    return out


def print_examples(res: Dict[str, Any], show: int) -> None:
    for lang in LANGS:
        ex = res["examples"][lang]
        keys = sorted(ex)
        random.Random(2026).shuffle(keys)  # детерминированно, но вперемешку по правилам
        picked: List[Tuple[str, Tuple[str, str, str]]] = []
        rnd = 0
        while len(picked) < show and any(len(ex[k]) > rnd for k in keys):
            for k in keys:
                if len(ex[k]) > rnd and len(picked) < show:
                    picked.append((k, ex[k][rnd]))
            rnd += 1
        print(f"\n── {show} объяснений · {lang} ──")
        for i, (k, (ru_t, tr_t, where)) in enumerate(picked, 1):
            print(f"{i:3}. [{k}] {where}\n     ru: {ru_t}\n     {lang}: {tr_t}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--drinks", type=int, default=40, help="сколько напитков в матрице (по умолчанию 40)")
    ap.add_argument("--show", type=int, default=0, help="напечатать N объяснений на каждом языке для вычитки")
    args = ap.parse_args()
    t0 = time.time()
    P = Problems()

    with open(PARAMS_PATH, encoding="utf-8") as f:
        params = json.load(f)
    texts, arrays = text_inventory(params)
    n_tpl = sum(1 for v in texts.values() if SLOT.search(v))
    print(f"params {params.get('version')}: {len(texts)} текстов и подписей ({n_tpl} шаблонов со {{слотами}}, "
          f"{len(texts) - n_tpl} строк без слотов), массивов с текстом: {len(arrays)} ({', '.join(fmt(a) for a in arrays)})")

    overlays: Dict[str, Dict[str, Any]] = {}
    for lang in LANGS:
        try:
            with open(OVERLAY_PATHS[lang], encoding="utf-8") as f:
                overlays[lang] = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            P.add(lang, "файл не читается", f"{OVERLAY_PATHS[lang].relative_to(ROOT)}: {e}")
    for lang, ov in overlays.items():
        st = static_check(lang, params, texts, arrays, ov, P)
        nums = sorted(set(re.sub(r"\[\d+\]", "[]", x) for x in st["numbers"]))
        print(f"{lang}: покрыто {st['covered']}/{len(texts)}, нет перевода {st['missing']}, лишних путей {st['extra']}; "
              f"чисел в оверлее {len(st['numbers'])} ({', '.join(nums) or '—'}; сверены с params); "
              f"строк, совпадающих с ru (заимствования, IBU, шаблон-склейка): {len(st['same_as_ru'])}")

    if len(overlays) == len(LANGS):
        ds = D.get_dataset()
        res = render(ds, overlays, args.drinks, P, args.show)
        cats = Counter(p["category"] for p in res["sample"])
        print(f"рендер: {len(res['sample'])} напитков ({len(cats)} категорий из {len(E.CATEGORIES)}) × "
              f"{len(ds.dishes)} блюд × {len(res['contexts'])} контекстов = {res['n_results']} пар на язык; "
              f"recommend + by_category: {res['n_lists']} выдач на язык")
        print(f"  контексты: {', '.join(res['contexts'])}")
        engine_texts = {p: v for p, v in texts.items() if p[0] not in PAGE_TEXTS}
        seen_ru = exercised(engine_texts, params, res["unique"]["ru"])
        for lang in ALL_LANGS:
            seen = seen_ru if lang == "ru" else exercised(engine_texts, overlays[lang], res["unique"][lang])
            line = (f"  {lang}: текстов проверено {res['n_texts'][lang]}, уникальных {len(res['unique'][lang])}, "
                    f"строк {'params' if lang == 'ru' else 'оверлея'} в выводе ≈{len(seen)}/{len(engine_texts)}")
            if lang != "ru":
                line += f"; пар с другими числами: {len(P.items[lang].get('числа отличаются от ru (5)', []))}"
            print(line)
        not_seen = [fmt(p) for p in engine_texts if p not in seen_ru]
        if not_seen:
            print(f"  не встретились в выборке даже на ru (проверены только статически): {', '.join(not_seen)}")
        print(f"  {', '.join(PAGE_TEXTS)}: тексты страниц, движок их не выводит — проверены статически")
        if args.show:
            print_examples(res, args.show)

    n = P.count()
    print(f"\nпроблем: {n}  ({time.time() - t0:.1f} с)")
    if n:
        P.print()
    return 1 if n else 0


if __name__ == "__main__":
    sys.exit(main())

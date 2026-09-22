#!/usr/bin/env python3
"""Калибровка движка v2 по суждениям сомелье (ENGINE_V2_SPEC.md §7.4).

Что подбирается: только масштабы и пороги из списка ``calibratable`` в data/engine_v2_params.json
(38 чисел, у каждого границы). Знаки, направления и логика правил взяты из литературы и не трогаются.

Что считается ошибкой: те же критерии, по которым scripts/engine_eval_v2.py ставит OK/FAIL
(top3 / good / bad / avoid + порядковые ограничения), только в виде «насколько не дотянули» в баллах
(hinge с запасом), чтобы поиску было куда двигаться. Плюс два тормоза:
  * штраф за удаление от литературных значений (λ · 100 · Σ z², z — сдвиг в долях диапазона);
  * штраф за раздутую шкалу на матрице архетипы × блюда (цель §5.1: медиана 58–62, ≥ 72 не больше 25 %,
    ≤ 47 не меньше 20 %) — иначе проще всего «проходить» тесты, завышая всем баллы.

Как ищется минимум: покоординатный спуск в нормированных координатах — на каждом шаге пробуем сдвинуть
каждый параметр на ±шаг (параллельно, по процессам), берём лучший сдвиг; когда улучшений нет — шаг вдвое меньше.
Детерминированно: одинаковые данные → одинаковый результат.

Честная проверка:
  * пары с split = "holdout" в подборе не участвуют вообще — ни в обучении, ни в выборе λ;
  * λ выбирается кросс-валидацией на обучающих парах (K фолдов, стратификация по ожиданию);
  * в отчёте — литературные значения против калиброванных на train, на CV и на holdout.

Результат: data/engine_v2_calibration.json (слой поверх engine_v2_params.json — только изменённые пути)
и отчёт docs/CALIBRATION_V2.md. Литературные значения в engine_v2_params.json не меняются.

Запуск из корня репозитория:
    python3 scripts/calibrate_v2.py                    # полный прогон: CV по λ, финальная подгонка, отчёт, слой
    python3 scripts/calibrate_v2.py --quick            # быстрая проверка пайплайна (крупный шаг, 2 фолда)
    python3 scripts/calibrate_v2.py --prototype        # данные прототипа (68 пар) — для отладки
    python3 scripts/calibrate_v2.py --dry-run          # ничего не записывать
    python3 scripts/calibrate_v2.py --lambdas 0.05,0.2,1 --folds 4 --workers 12
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from multiprocessing import get_context
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))

from api.pairing import engine_v2 as E  # noqa: E402
import engine_eval_v2 as EV  # noqa: E402

OVERLAY_PATH = ROOT / "data" / "engine_v2_calibration.json"
REPORT_PATH = ROOT / "docs" / "CALIBRATION_V2.md"

# ─────────────────────────────── настройки функции ошибки ───────────────────────────────
MARGIN = 2.0           # запас по порогам бэндов (балл 60 ровно — «на грани», хотим 62)
RANK_MARGIN = 1.0      # запас по рангу для top3
VETO_PENALTY = 10.0    # «good» с вето или «avoid» без вето
ORDINAL_MARGIN = 1.0
DIST_WEIGHT = 3.0      # вес штрафа за раздутую шкалу
ORIGIN_WEIGHT = {"curated_efes": 0.5, "guests": 0.3}   # суждения команды — вдвое меньше литературы, отзывы гостей — слабый сигнал
EVIDENCE_WEIGHT = {"D": 0.5}             # традиция / сайт бренда — половина веса экспертного консенсуса
DIST_TARGET = {"median_lo": 58, "median_hi": 62, "ge72_max": 25.0, "le47_min": 20.0}


# ─────────────────────────────────────────────────────────────────────────────
# задача: данные, векторы, пары
# ─────────────────────────────────────────────────────────────────────────────
class Problem:
    """Всё, что нужно для оценки параметров: векторы (от калибруемых параметров не зависят), пары, λ-пространство."""

    def __init__(self, prototype: bool):
        ds = EV.build_dataset(force_prototype=prototype, params_override=None, use_calibration=False)
        self.sources = dict(getattr(ds, "sources", {}))
        self.base = ds.params
        P = self.base
        prop_a = {x["id"]: x for x in ds.proposed_archetypes}
        prop_d = {x["id"]: x for x in ds.proposed_dishes}
        arch_raw = {x["id"]: x for x in ds.archetypes}
        dish_raw = {x["id"]: x for x in ds.dishes}
        refs = [(p["dish"], p["drink"]) for p in ds.tests.get("pairs", [])]
        for o in ds.tests.get("ordinals", []):
            refs += [(o["dish"], o["a"]), (o["dish"], o["b"])]
        self.notes: List[str] = []
        for dish_id, drink_id in refs:
            if drink_id not in arch_raw and drink_id in prop_a:
                arch_raw[drink_id] = prop_a[drink_id]
                self.notes.append(f"архетип {drink_id} ← research/proposed_archetypes.json")
            if dish_id not in dish_raw and dish_id in prop_d:
                dish_raw[dish_id] = prop_d[dish_id]
                self.notes.append(f"блюдо {dish_id} ← research/proposed_dishes.json")
        self.arch = {k: E.drink_vector(v, P) for k, v in arch_raw.items()}
        self.dishes = {k: E.dish_vector(v, P) for k, v in dish_raw.items()}
        self.arch_ids = sorted(self.arch)
        self.dish_ids = sorted(self.dishes)
        self.classics_list = list(ds.classics)
        self.by_cat: Dict[str, List[str]] = {}
        for k in self.arch_ids:
            self.by_cat.setdefault(self.arch[k]["category"], []).append(k)

        self.pairs: List[Dict[str, Any]] = []
        self.skipped: List[Dict[str, Any]] = []
        for p in ds.tests.get("pairs", []):
            if p["dish"] not in self.dishes or p["drink"] not in self.arch:
                self.skipped.append(p)
                continue
            q = dict(p)
            q["ctx"] = EV.pair_ctx(p)
            q["ctx_key"] = json.dumps(q["ctx"], sort_keys=True, ensure_ascii=False)
            q["split"] = p.get("split", "train")
            q["origin"] = p.get("origin", "?")
            q["category"] = self.arch[p["drink"]]["category"]
            q["weight"] = ORIGIN_WEIGHT.get(q["origin"], 1.0) * EVIDENCE_WEIGHT.get(p.get("evidence") or "", 1.0)
            self.pairs.append(q)
        self.ordinals: List[Dict[str, Any]] = []
        for o in ds.tests.get("ordinals", []):
            if o["dish"] not in self.dishes or o["a"] not in self.arch or o["b"] not in self.arch:
                self.skipped.append(o)
                continue
            q = dict(o)
            q["ctx"] = dict(o.get("ctx") or {})
            q["ctx_key"] = json.dumps(q["ctx"], sort_keys=True, ensure_ascii=False)
            q["min_gap"] = o.get("min_gap", 0)
            self.ordinals.append(q)

        # строки матрицы, которые нужны: вся матрица в пустом контексте + (блюдо, контекст) из тестов
        keys = {(d, "{}") for d in self.dish_ids}
        for q in self.pairs + self.ordinals:
            keys.add((q["dish"], q["ctx_key"]))
        self.row_keys = sorted(keys)

        # пространство параметров
        self.space = []
        for c in P["calibratable"]["params"]:
            lo, hi = float(c["min"]), float(c["max"])
            v0 = float(E.get_path(P, c["path"]))
            if not lo <= v0 <= hi:
                self.notes.append(f"литературное значение {c['path']}={v0} вне границ [{lo}, {hi}] — зажато")
            self.space.append({"path": c["path"], "lo": lo, "hi": hi, "v0": min(hi, max(lo, v0))})
        self.z0 = tuple((s["v0"] - s["lo"]) / (s["hi"] - s["lo"]) for s in self.space)

    # z (0..1 по каждому параметру) → словарь параметров
    def params_for(self, z: Sequence[float]) -> Dict[str, Any]:
        over = {s["path"]: s["lo"] + zi * (s["hi"] - s["lo"]) for s, zi in zip(self.space, z)}
        return E.merge_params(self.base, over)

    def overlay_for(self, z: Sequence[float], tol: float = 1e-9) -> Dict[str, float]:
        """Только изменённые пути (слой поверх литературных значений), округление до 4 знаков."""
        out = {}
        for s, zi, z0 in zip(self.space, z, self.z0):
            if abs(zi - z0) > tol:
                out[s["path"]] = float(f"{s['lo'] + zi * (s['hi'] - s['lo']):.4f}")
        return out


# ─────────────────────────────────────────────────────────────────────────────
# оценка набора параметров
# ─────────────────────────────────────────────────────────────────────────────
def score_rows(pb: Problem, P: Dict[str, Any]) -> Dict[Tuple[str, str], Dict[str, Tuple[int, bool]]]:
    cidx = E.index_classics(pb.classics_list)
    rows: Dict[Tuple[str, str], Dict[str, Tuple[int, bool]]] = {}
    ctx_cache: Dict[str, Dict[str, Any]] = {}
    for dish_id, ck in pb.row_keys:
        ctx = ctx_cache.get(ck)
        if ctx is None:
            ctx = json.loads(ck)
            ctx_cache[ck] = ctx
        d = pb.dishes[dish_id]
        row = {}
        for a in pb.arch_ids:
            r = E.score_pair(pb.arch[a], d, ctx, P, cidx, explain=False)
            row[a] = (r["score"], any(v in E.CAP_VETOES for v in r["vetoes"]))
        rows[(dish_id, ck)] = row
    return rows


def pair_outcome(pb: Problem, q: Dict[str, Any], rows) -> Dict[str, Any]:
    row = rows[(q["dish"], q["ctx_key"])]
    s, vetoed = row[q["drink"]]
    peers = pb.by_cat[q["category"]]
    others = sorted((row[x][0] for x in peers if x != q["drink"]), reverse=True)
    ncat = len(peers)
    third = others[2] if len(others) >= 3 else None
    rank = 1 + sum(1 for x in others if x > s)
    exp = q["expect"]
    if exp == "top3":
        loss = max(0.0, 70 + MARGIN - s) + (max(0.0, third + RANK_MARGIN - s) if third is not None else 0.0)
        ok = s >= 70 and rank <= 3
    elif exp == "good":
        loss = max(0.0, 60 + MARGIN - s) + (VETO_PENALTY if vetoed else 0.0)
        ok = s >= 60 and not vetoed
    elif exp == "bad":
        loss = max(0.0, s - (57 - MARGIN))
        if ncat > 3 and third is not None and s >= E.BAD_ABSOLUTE:
            loss += max(0.0, s - (third - 1))
        ok = s <= 57 and (rank > 3 or ncat <= 3 or s < E.BAD_ABSOLUTE)
    elif exp == "avoid":
        loss = max(0.0, s - (35 - MARGIN)) + (0.0 if vetoed else VETO_PENALTY)
        ok = s <= 35 and vetoed
    else:
        loss, ok = 0.0, True
    return {"score": s, "rank": rank, "n_cat": ncat, "vetoed": vetoed, "loss": loss, "ok": ok}


def ordinal_outcome(q: Dict[str, Any], rows) -> Dict[str, Any]:
    row = rows[(q["dish"], q["ctx_key"])]
    sa, sb = row[q["a"]][0], row[q["b"]][0]
    gap = sa - sb
    return {"score_a": sa, "score_b": sb, "loss": max(0.0, q["min_gap"] + ORDINAL_MARGIN - gap), "ok": gap >= q["min_gap"]}


def distribution(pb: Problem, rows) -> Dict[str, Any]:
    scores = sorted(rows[(d, "{}")][a][0] for d in pb.dish_ids for a in pb.arch_ids)
    st = EV.matrix_stats(scores)
    t = DIST_TARGET
    pen = (max(0.0, st["median"] - t["median_hi"]) + max(0.0, t["median_lo"] - st["median"])
           + 0.5 * max(0.0, st["pct_ge72"] - t["ge72_max"]) + 0.5 * max(0.0, t["le47_min"] - st["pct_le47"]))
    st["penalty"] = pen
    return st


def reg_term(pb: Problem, z: Sequence[float]) -> float:
    return 100.0 * sum((zi - z0) ** 2 for zi, z0 in zip(z, pb.z0))


def full_eval(pb: Problem, z: Sequence[float]) -> Dict[str, Any]:
    P = pb.params_for(z)
    rows = score_rows(pb, P)
    pairs = [dict(q=q, **pair_outcome(pb, q, rows)) for q in pb.pairs]
    ords = [dict(q=q, **ordinal_outcome(q, rows)) for q in pb.ordinals]
    return {"pairs": pairs, "ordinals": ords, "dist": distribution(pb, rows)}


def objective_from(ev: Dict[str, Any], pb: Problem, z: Sequence[float], train_ids: frozenset, lam: float) -> float:
    loss = 0.0
    for r in ev["pairs"]:
        if r["q"]["id"] in train_ids:
            loss += r["q"]["weight"] * r["loss"]
    for r in ev["ordinals"]:
        loss += r["loss"]
    loss += DIST_WEIGHT * ev["dist"]["penalty"]
    loss += lam * reg_term(pb, z)
    return loss


# ─────────────────────────────── параллельная оценка ───────────────────────────────
_PB: Optional[Problem] = None


def _worker_objective(args) -> float:
    z, train_ids, lam = args
    assert _PB is not None
    ev = full_eval(_PB, z)
    return objective_from(ev, _PB, z, train_ids, lam)


def fit(pb: Problem, train_ids: frozenset, lam: float, pool: ProcessPoolExecutor, steps: Sequence[float],
        max_iter: int, log_prefix: str = "") -> Tuple[Tuple[float, ...], float, int]:
    z = tuple(pb.z0)
    cur = _worker_objective((z, train_ids, lam))
    it = 0
    for step in steps:
        while it < max_iter:
            cands = []
            for j in range(len(z)):
                for sgn in (+1.0, -1.0):
                    zj = min(1.0, max(0.0, z[j] + sgn * step))
                    if abs(zj - z[j]) < 1e-12:
                        continue
                    zz = list(z)
                    zz[j] = zj
                    cands.append(tuple(zz))
            losses = list(pool.map(_worker_objective, [(c, train_ids, lam) for c in cands], chunksize=1))
            best_i = min(range(len(cands)), key=lambda i: (losses[i], i))
            if losses[best_i] < cur - 1e-9:
                z, cur = cands[best_i], losses[best_i]
                it += 1
            else:
                break
        print(f"{log_prefix}шаг {step:.4f}: итераций {it}, ошибка {cur:.2f}", flush=True)
    return z, cur, it


# ─────────────────────────────── фолды ───────────────────────────────
def _h(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()


def make_folds(train: List[Dict[str, Any]], k: int) -> List[frozenset]:
    """Стратификация по ожиданию: внутри каждой группы порядок по sha1(id), фолд = позиция mod k."""
    groups: Dict[str, List[str]] = {}
    for q in train:
        groups.setdefault(q["expect"], []).append(q["id"])
    folds: List[set] = [set() for _ in range(k)]
    for exp in sorted(groups):
        for i, pid in enumerate(sorted(groups[exp], key=_h)):
            folds[i % k].add(pid)
    return [frozenset(f) for f in folds]


def rate(rows: List[Dict[str, Any]], ids: Optional[frozenset] = None) -> Tuple[int, int]:
    sel = [r for r in rows if ids is None or r["q"]["id"] in ids]
    return sum(1 for r in sel if r["ok"]), len(sel)


def pct(a: int, b: int) -> str:
    return f"{a}/{b} ({100.0 * a / b:.0f} %)" if b else "—"


# ─────────────────────────────────────────────────────────────────────────────
# отчёт
# ─────────────────────────────────────────────────────────────────────────────
CAT_RU = {"beer": "пиво", "na_beer": "б/а пиво", "radler": "радлер", "cider": "сидр", "wine": "вино",
          "sparkling": "игристое", "fortified": "креплёное", "cocktail": "коктейли", "spirit": "крепкое",
          "liqueur": "ликёры", "kvass": "квас", "lemonade": "лимонады", "soda": "газировка", "dairy": "кисломолочное",
          "tea": "чай", "coffee": "кофе", "water": "вода"}
EXP_RU = {"top3": "в топ-3 категории", "good": "хорошо (≥ 60)", "bad": "плохо (≤ 57)", "avoid": "избегать (вето)"}


def by_key(rows: List[Dict[str, Any]], key, ids: Optional[frozenset] = None) -> Dict[str, Tuple[int, int]]:
    out: Dict[str, List[int]] = {}
    for r in rows:
        if ids is not None and r["q"]["id"] not in ids:
            continue
        k = key(r)
        g = out.setdefault(k, [0, 0])
        g[1] += 1
        g[0] += 1 if r["ok"] else 0
    return {k: (v[0], v[1]) for k, v in sorted(out.items())}


def write_report(pb: Problem, res: Dict[str, Any], path: Path) -> None:
    base, cal = res["base_eval"], res["cal_eval"]
    train_ids, hold_ids = res["train_ids"], res["hold_ids"]
    L: List[str] = []
    a = L.append
    a("# Калибровка движка v2")
    a("")
    a(f"Прогон: {res['fitted_at']} · `python3 scripts/calibrate_v2.py` · движок {E.ENGINE_VERSION}.")
    a("Отчёт генерируется скриптом, руками не правится.")
    a("")
    a("## Что делали")
    a("")
    a("Движок считает оценку пары по правилам из литературы (BA, CMS, WSET, сенсорные исследования). Направление каждого")
    a("правила взято из источников, а величины — «сколько баллов за что» — эксперты численно не дают, это наша")
    a("калибровка (спецификация §1, «Честность про числа»). Этот скрипт подбирает эти величины по суждениям сомелье:")
    a(f"{len(pb.space)} коэффициентов, каждый только внутри заранее заданных границ. Знаки и логика правил не меняются.")
    a("")
    a("- **Данные.** Пары «блюдо — стиль напитка» с ожидаемым результатом (в топ-3 категории / хорошо / плохо / избегать),")
    a("  у каждой — источник. Порядковые ограничения: «к окрошке кислый квас лучше сладкого» и т. п.")
    a("- **Отложенная выборка.** Пары с пометкой holdout в подборе не участвуют вообще. На них — итоговая цифра.")
    a("- **Ошибка.** Те же критерии, что в `engine_eval_v2.py`, но в баллах «насколько не дотянули» (с запасом 2 балла),")
    a("  плюс штраф за удаление от литературных значений и за раздутую шкалу (медиана по матрице должна быть 58–62,")
    a("  «отлично» ≥ 72 — не больше 25 % пар). Суждения команды Efes весят вдвое меньше литературы.")
    a("- **Поиск.** Покоординатный спуск с уменьшением шага, детерминированно. Сила штрафа за удаление от литературы")
    if res["lambda"] is None:
        a(f"  выбирается кросс-валидацией на обучающих парах ({res['folds']} фолда). В этом прогоне ни одна сила штрафа")
        a("  не дала на кросс-валидации больше проходящих пар, чем литературные значения, — поэтому калибровка")
        a("  **ничего не меняет**: слой пустой, движок работает на значениях из литературы.")
    else:
        a(f"  выбрана кросс-валидацией на обучающих парах ({res['folds']} фолда), выбрано λ = {res['lambda']}.")
    a("")
    a("## Результат")
    a("")
    bt, ct = rate(base["pairs"], train_ids), rate(cal["pairs"], train_ids)
    bh, ch = rate(base["pairs"], hold_ids), rate(cal["pairs"], hold_ids)
    bo, co = sum(1 for r in base["ordinals"] if r["ok"]), sum(1 for r in cal["ordinals"] if r["ok"])
    a("| | Литературные значения | После калибровки |")
    a("|---|---|---|")
    a(f"| Обучающие пары | {pct(*bt)} | {pct(*ct)} |")
    cv = res["cv"][res["cv_key"]]
    cv_cal = cv["ok"] if res["lambda"] is not None else cv["base_ok"]
    a(f"| Кросс-валидация (пары, которых подбор не видел в своём фолде) | {pct(cv['base_ok'], cv['n'])} | {pct(cv_cal, cv['n'])} |")
    a(f"| **Отложенные пары (holdout)** | **{pct(*bh)}** | **{pct(*ch)}** |")
    a(f"| Порядковые ограничения | {bo}/{len(base['ordinals'])} | {co}/{len(cal['ordinals'])} |")
    bd, cd = base["dist"], cal["dist"]
    a(f"| Медиана по матрице архетипы × блюда | {bd['median']} | {cd['median']} |")
    a(f"| Пар ≥ 72 («отлично») | {bd['pct_ge72']} % | {cd['pct_ge72']} % |")
    a(f"| Пар ≤ 47 («не рекомендуем») | {bd['pct_le47']} % | {cd['pct_le47']} % |")
    a("")
    if ch[0] < bh[0]:
        a("**Внимание:** на отложенных парах калибровка хуже литературных значений — это признак подгонки. "
          "Слой калибровки записан, но пользоваться им стоит только после разбора.")
        a("")
    a("### Отложенные пары по категориям напитка")
    a("")
    a("| Категория | Литература | Калибровка |")
    a("|---|---|---|")
    bc = by_key(base["pairs"], lambda r: r["q"]["category"], hold_ids)
    cc = by_key(cal["pairs"], lambda r: r["q"]["category"], hold_ids)
    for k in bc:
        a(f"| {CAT_RU.get(k, k)} | {pct(*bc[k])} | {pct(*cc[k])} |")
    a("")
    a("### Отложенные пары по происхождению")
    a("")
    a("Пары спецификации (spec_v2) использовались, когда писались сами правила, поэтому для литературных значений")
    a("они не «слепые». Самая честная проверка — пары из нового исследования (research_v2), которых правила не видели.")
    a("")
    a("| Откуда | Литература | Калибровка |")
    a("|---|---|---|")
    bho = by_key(base["pairs"], lambda r: r["q"]["origin"], hold_ids)
    cho = by_key(cal["pairs"], lambda r: r["q"]["origin"], hold_ids)
    for k in bho:
        a(f"| {k} | {pct(*bho[k])} | {pct(*cho[k])} |")
    a("")
    a("### Все пары по ожиданию")
    a("")
    a("| Ожидание | Литература | Калибровка |")
    a("|---|---|---|")
    be = by_key(base["pairs"], lambda r: r["q"]["expect"])
    ce = by_key(cal["pairs"], lambda r: r["q"]["expect"])
    for k in be:
        a(f"| {EXP_RU.get(k, k)} | {pct(*be[k])} | {pct(*ce[k])} |")
    a("")
    a("### По происхождению пары")
    a("")
    a("| Откуда | Литература | Калибровка |")
    a("|---|---|---|")
    bo_ = by_key(base["pairs"], lambda r: r["q"]["origin"])
    co_ = by_key(cal["pairs"], lambda r: r["q"]["origin"])
    for k in bo_:
        a(f"| {k} | {pct(*bo_[k])} | {pct(*co_[k])} |")
    a("")
    a("## Какие коэффициенты сдвинулись")
    a("")
    moved = []
    for s, z1, z0 in zip(pb.space, res["z"], pb.z0):
        if abs(z1 - z0) > 1e-9:
            v1 = s["lo"] + z1 * (s["hi"] - s["lo"])
            moved.append((abs(z1 - z0), s, v1))
    if not moved:
        a("Ни один — литературные значения оказались лучшими при выбранной силе штрафа.")
    else:
        a("| Параметр | Литература | Калибровка | Границы | Сдвиг, % диапазона |")
        a("|---|---|---|---|---|")
        for dz, s, v1 in sorted(moved, key=lambda t: -t[0]):
            a(f"| `{s['path']}` | {s['v0']:g} | {v1:.3g} | {s['lo']:g}…{s['hi']:g} | {100 * dz:.0f} |")
    a("")
    a("## Что по-прежнему не проходит")
    a("")
    fails = [r for r in cal["pairs"] if not r["ok"]]
    if not fails:
        a("Все пары проходят.")
    else:
        a("| Пара | Ожидание | Балл | Ранг | Выборка | Источник / почему |")
        a("|---|---|---|---|---|---|")
        for r in sorted(fails, key=lambda r: (r["q"]["split"], r["q"]["id"])):
            q = r["q"]
            why = (q.get("why") or "").replace("|", "/")
            if len(why) > 110:
                why = why[:107] + "…"
            a(f"| {q['id']} {q['dish']} × {q['drink']} | {EXP_RU.get(q['expect'], q['expect'])} | {r['score']} | "
              f"{r['rank']}/{r['n_cat']} | {q['split']} | {why} |")
    fo = [r for r in cal["ordinals"] if not r["ok"]]
    if fo:
        a("")
        a("Порядковые ограничения, которые не выполняются:")
        a("")
        for r in fo:
            q = r["q"]
            a(f"- {q['id']} {q['dish']}: {q['a']} {r['score_a']} против {q['b']} {r['score_b']} (нужно ≥ +{q['min_gap']}) — {q.get('why', '')}")
    a("")
    a("## Оговорки")
    a("")
    a("- Пары заданы для **стилей** напитков (архетипов), а не для конкретных бутылок: сомелье пишут «сухой стаут к устрицам»,")
    a("  а не «Guinness к устрицам». Конкретный напиток наследует профиль стиля и уточняется этикеткой (ABV, IBU).")
    a("- Выборка небольшая, а эксперты местами спорят между собой (IPA к острому, DIPA к чизкейку, соль и танины) —")
    a("  такие пары помечены в `data/test_pairs.json`, и 100 % здесь не цель: цель — не проиграть литературе на новых парах.")
    a("- Следующий шаг — дегустация с сомелье Efes по спорным парам и отзывы гостей («помогло / нет») как новые данные.")
    a("")
    a("## Как повторить")
    a("")
    a("```")
    a("python3 scripts/calibrate_v2.py            # пересчитать слой и этот отчёт")
    a("python3 scripts/engine_eval_v2.py          # оценка с текущими параметрами (слой применяется автоматически)")
    a("```")
    a("")
    a(f"Источники данных этого прогона: {', '.join(f'{k} ← {v}' for k, v in sorted(pb.sources.items()))}.")
    if pb.skipped:
        a(f"Пропущено тестов (нет блюда или архетипа в данных): {len(pb.skipped)}.")
    path.write_text("\n".join(L) + "\n", encoding="utf-8")


# ─────────────────────────────────────────────────────────────────────────────
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--prototype", action="store_true", help="данные прототипа (68 пар)")
    ap.add_argument("--lambdas", default="0.03,0.1,0.3,1", help="сетка λ для кросс-валидации")
    ap.add_argument("--folds", type=int, default=4)
    ap.add_argument("--workers", type=int, default=min(12, os.cpu_count() or 4))
    ap.add_argument("--max-iter", type=int, default=400)
    ap.add_argument("--quick", action="store_true", help="крупный шаг и 2 фолда — проверка пайплайна")
    ap.add_argument("--dry-run", action="store_true", help="ничего не записывать")
    args = ap.parse_args()

    global _PB
    t0 = time.time()
    _PB = pb = Problem(prototype=args.prototype)
    steps = [0.2, 0.1] if args.quick else [0.2, 0.1, 0.05, 0.025]
    folds_k = 2 if args.quick else args.folds
    lambdas = [float(x) for x in args.lambdas.split(",")] if not args.quick else [0.3]

    train = [q for q in pb.pairs if q["split"] != "holdout"]
    hold = [q for q in pb.pairs if q["split"] == "holdout"]
    train_ids = frozenset(q["id"] for q in train)
    hold_ids = frozenset(q["id"] for q in hold)
    print(f"пар: {len(pb.pairs)} (train {len(train)}, holdout {len(hold)}), порядковых: {len(pb.ordinals)}, "
          f"пропущено: {len(pb.skipped)}; архетипов {len(pb.arch_ids)}, блюд {len(pb.dish_ids)}, "
          f"строк матрицы {len(pb.row_keys)}; параметров {len(pb.space)}", flush=True)
    for n in pb.notes:
        print("  ·", n)

    base_eval = full_eval(pb, pb.z0)
    print(f"литература: train {rate(base_eval['pairs'], train_ids)}, holdout {rate(base_eval['pairs'], hold_ids)}, "
          f"медиана {base_eval['dist']['median']}", flush=True)

    ctx = get_context("fork")
    cv: Dict[str, Any] = {}
    with ProcessPoolExecutor(max_workers=args.workers, mp_context=ctx) as pool:
        folds = make_folds(train, folds_k)
        best_lam, best_key = None, None
        for lam in lambdas:
            ok = n = base_ok = 0
            per_fold = []
            for fi, fold in enumerate(folds):
                fit_ids = train_ids - fold
                z, _, it = fit(pb, fit_ids, lam, pool, steps, args.max_iter, log_prefix=f"  λ={lam} фолд {fi + 1}/{len(folds)} · ")
                ev = full_eval(pb, z)
                o, t = rate(ev["pairs"], fold)
                bo_, _ = rate(base_eval["pairs"], fold)
                ok += o
                n += t
                base_ok += bo_
                per_fold.append({"fold": fi, "ok": o, "n": t, "iters": it})
            cv[str(lam)] = {"ok": ok, "n": n, "base_ok": base_ok, "folds": per_fold}
            print(f"λ={lam}: CV {ok}/{n} (литература {base_ok}/{n})", flush=True)
            key = (ok, lam)          # при равенстве — больший λ (ближе к литературе)
            if best_key is None or key > best_key:
                best_key, best_lam = key, lam
        # Литературные значения — тоже кандидат (λ = ∞). Если подгонка на CV не лучше, её не применяем:
        # это и есть защита от переобучения на небольшом наборе пар.
        lit_ok = cv[str(lambdas[0])]["base_ok"]
        if best_key is None or best_key[0] <= lit_ok:
            best_lam = None
            print(f"CV: подгонка ({best_key[0] if best_key else '—'}) не лучше литературы ({lit_ok}) — "
                  f"оставляем литературные значения", flush=True)
            z = tuple(pb.z0)
        else:
            print(f"выбрано λ = {best_lam}", flush=True)
            z, loss, it = fit(pb, train_ids, best_lam, pool, steps, args.max_iter, log_prefix="  финал · ")
    cal_eval = full_eval(pb, z)
    print(f"калибровка: train {rate(cal_eval['pairs'], train_ids)}, holdout {rate(cal_eval['pairs'], hold_ids)}, "
          f"порядковые {sum(1 for r in cal_eval['ordinals'] if r['ok'])}/{len(cal_eval['ordinals'])}, "
          f"медиана {cal_eval['dist']['median']}, ≥72 {cal_eval['dist']['pct_ge72']} %, ≤47 {cal_eval['dist']['pct_le47']} %",
          flush=True)

    fitted_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    cv_key = str(best_lam) if best_lam is not None else max(cv, key=lambda k: (cv[k]["ok"], float(k)))
    res = {"cv_key": cv_key, "z": z, "lambda": best_lam, "folds": folds_k, "cv": cv, "base_eval": base_eval, "cal_eval": cal_eval,
           "train_ids": train_ids, "hold_ids": hold_ids, "fitted_at": fitted_at}
    bt, ct = rate(base_eval["pairs"], train_ids), rate(cal_eval["pairs"], train_ids)
    bh, ch = rate(base_eval["pairs"], hold_ids), rate(cal_eval["pairs"], hold_ids)
    overlay = {
        "_doc": "Слой калибровки поверх engine_v2_params.json (только изменённые пути). Собран scripts/calibrate_v2.py, "
                "отчёт — docs/CALIBRATION_V2.md. Удалите файл, чтобы вернуться к литературным значениям.",
        "version": f"cal-{fitted_at[:10]}",
        "engine_version": E.ENGINE_VERSION,
        "params_version": pb.base.get("version"),
        "fitted_at": fitted_at,
        "lambda": best_lam,
        "data": {"pairs_train": len(train), "pairs_holdout": len(hold), "ordinals": len(pb.ordinals),
                 "sources": pb.sources},
        "metrics": {"train": {"literature": list(bt), "calibrated": list(ct)},
                    "holdout": {"literature": list(bh), "calibrated": list(ch)},
                    "cv": {"literature": [cv[cv_key]["base_ok"], cv[cv_key]["n"]],
                           "calibrated": [cv[cv_key]["ok"] if best_lam is not None else cv[cv_key]["base_ok"], cv[cv_key]["n"]]},
                    "ordinals": [sum(1 for r in cal_eval["ordinals"] if r["ok"]), len(cal_eval["ordinals"])],
                    "matrix": {k: cal_eval["dist"][k] for k in ("median", "pct_ge72", "pct_le47", "p10", "p90")}},
        "params": pb.overlay_for(z),
    }
    if args.dry_run or args.prototype:
        print("(dry-run / prototype: файлы не записаны)")
        print(json.dumps(overlay["params"], ensure_ascii=False, indent=1))
    else:
        OVERLAY_PATH.write_text(json.dumps(overlay, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        write_report(pb, res, REPORT_PATH)
        print(f"записано: {OVERLAY_PATH.relative_to(ROOT)}, {REPORT_PATH.relative_to(ROOT)}")
    print(f"время: {time.time() - t0:.0f} с")


if __name__ == "__main__":
    main()

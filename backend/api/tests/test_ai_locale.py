"""Язык гостя в ИИ-сомелье v2 (locale: ru / kk / en) — зеркало проверок frontend/scripts/ai-dryrun.mjs.

Сети и ключа не нужно: клиент Anthropic подменяется заглушкой. Швов два — параметр client у run_sommelier
и api.ai._get_client (его подменяем, когда идём через HTTP-вьюху). Заглушка отвечает по фазе вызова — по схеме
вывода: «понять блюдо» (INTERPRET_SCHEMA), «разобрать напиток» (схема со свойством drink), иначе «объяснение».
Здесь же — зеркало текстов: test_prompts_mirror_typescript сверяет Python с исходником frontend/api/_lib/*.ts.
Запуск: .venv/bin/python manage.py test api.tests.test_ai_locale
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from types import SimpleNamespace
from unittest import mock, skipUnless

from django.conf import settings
from django.test import TestCase
from rest_framework.test import APIClient

from api import ai

DISH = {"name": "Шашлык", "matched_slug": "shashlyk", "taste": "UMAMI", "weight": "HEAVY", "fat": "HIGH", "cook": "grilled",
        "protein": "lamb", "sauce": "none", "acid": "none", "dessert": False, "heat": 0.1, "tags": [{"tag": "smoke", "weight": 0.6}],
        "cuisine": ["kazakh"], "confidence": 0.9}
SHASHLYK = {"kind": "dish", "reply": "Похоже на шашлык", "dish": DISH, "occasion": "hot", "bitter_pref": 0, "heat_lover": False}
VENUE = {"slug": "efes-beer-garden-almaty", "name": "Efes Beer Garden", "beers": ["13-region", "bochkovoe", "efes-pilsener"],
         "prices": {"13-region": 1750}, "currency": "₸"}
ENGINE_OWNED = ("drink_id", "beer_id", "name", "category", "style", "abv", "score", "band", "match_type", "secondary_type",
                "classic", "efes_partner", "price", "volume")
LIB_DIR = Path(settings.BASE_DIR).parent / "frontend" / "api" / "_lib"


def phase_of(params: dict) -> str:
    props = ((params.get("output_config") or {}).get("format") or {}).get("schema", {}).get("properties", {})
    if "dish" in props and "occasion" in props:
        return "interpret"
    return "drink" if "drink" in props else "narrate"


def message(text, stop_reason: str = "end_turn", fallback: bool = False):
    content = [] if text is None else [SimpleNamespace(type="text", text=text)]
    if fallback and text is not None:
        content = [SimpleNamespace(type="text", text="обрывок"), SimpleNamespace(type="fallback"), *content]
    iterations = [SimpleNamespace(type="message"), SimpleNamespace(type="fallback_message")] if fallback else None
    return SimpleNamespace(stop_reason=stop_reason, content=content,
                           usage=SimpleNamespace(input_tokens=100, output_tokens=40, cache_read_input_tokens=70,
                                                 cache_creation_input_tokens=0, iterations=iterations))


class StubClient:
    """Ответ по фазе вызова. interpret / drink — dict (ответ модели) или str; narrate — функция brief → str или str."""

    def __init__(self, interpretation=None, narrate=None, drink=None, stop=None, fallback=None):
        self.calls: list[dict] = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))
        self._src = {"interpret": interpretation, "drink": drink, "narrate": narrate}
        self._stop = stop or {}
        self._fallback = fallback or {}

    def phases(self) -> list[str]:
        return [phase_of(c) for c in self.calls]

    def _create(self, **params):
        self.calls.append(params)
        ph = phase_of(params)
        src = self._src[ph]
        if ph == "narrate":
            brief = json.loads(params["messages"][0]["content"])
            if callable(src):
                text = src(brief)
            elif src is not None:
                text = src
            elif brief["mode"] == "drink":
                text = f"К {brief['drink']['name']} берите {brief['dishes'][0]['name']}."
            else:
                text = f"Берите {brief['picks'][0]['name']} — он справится с жиром и дымом."
        else:
            text = src if isinstance(src, str) else json.dumps(src if src is not None else {}, ensure_ascii=False)
        stop = self._stop.get(ph, "end_turn")
        return message(None if stop == "refusal" else text, stop, self._fallback.get(ph, False))


def translated(tag: str, mutate=lambda d: d):
    """«Перевод» заглушки: те же id в том же порядке, столько же строк, каждая помечена языком."""
    def narrate(brief: dict) -> str:
        return json.dumps(mutate({
            "reply": f"[{tag}] reply",
            "items": [{"id": u["id"], "why": f"[{tag}] {u['why']}", "reasons": [f"[{tag}] {s}" for s in u["reasons"]],
                       "warnings": [f"[{tag}] {s}" for s in u["warnings"]]} for u in brief["translate"]["items"]],
            "notes": [f"[{tag}] {s}" for s in brief["translate"]["notes"]],
        }), ensure_ascii=False)
    return narrate


def ask(client, locale=..., **extra) -> dict:
    data = {"mode": "ask", "messages": [{"role": "user", "content": "что взять к шашлыку в жару?"}], "venue": VENUE, **extra}
    if locale is not ...:
        data["locale"] = locale
    return ai.run_sommelier(data, client=client)


def only(picks: list[dict], keys: tuple) -> list[dict]:
    return [{k: p[k] for k in keys} | {"evidence": [n["evidence"] for n in p["reasons"] + p["warnings"]]} for p in picks]


def human(picks: list[dict]) -> list[list]:
    return [[p["why"], [n["text"] for n in p["reasons"]], [n["text"] for n in p["warnings"]]] for p in picks]


def all_tagged(items: list[dict], tag: str) -> bool:
    return all(s.startswith(f"[{tag}] ") for p in items for s in [p["why"], *[n["text"] for n in p["reasons"]], *[n["text"] for n in p["warnings"]]])


class AiLocaleTests(TestCase):
    def setUp(self):
        # эталон: запрос без locale
        self.ru = StubClient(SHASHLYK)
        self.ru_out = ask(self.ru)
        # страховка «без сети»: настоящий клиент в этих тестах создаваться не должен
        patcher = mock.patch.object(ai, "_get_client", side_effect=AssertionError("реальный клиент Anthropic в тестах не нужен"))
        patcher.start()
        self.addCleanup(patcher.stop)

    # ── ru ──

    def test_absent_locale_is_ru_and_request_is_unchanged(self):
        out, calls = self.ru_out, self.ru.calls
        self.assertEqual((out["locale"], out["kind"], out["engine"]), ("ru", "picks", "v2"))
        self.assertEqual(len(out["picks"]), 3)
        self.assertIn("Берите", out["reply"])
        for c in calls:   # только кэшируемые блоки, никакого языкового хвоста
            self.assertTrue(all(b["cache_control"] == {"type": "ephemeral"} for b in c["system"]))
        self.assertEqual(len(calls[0]["system"]), 2)   # общий блок + правила фазы
        self.assertEqual(calls[0]["output_config"]["format"]["type"], "json_schema")
        self.assertEqual(calls[1]["output_config"], {"effort": "low"})
        self.assertEqual(calls[1]["max_tokens"], 2048)
        self.assertNotIn("translate", json.loads(calls[1]["messages"][0]["content"]))
        for p in out["picks"]:
            self.assertEqual(p["match_label"], ai.MATCH_LABELS["ru"][p["match_type"]])
            self.assertEqual(p["category_label"], ai.CATEGORY_LABELS["ru"][p["category"]])

    def test_unknown_locale_falls_back_to_ru(self):
        for junk in ("ru", "de", "EN", "", 42, None, ["kk"], {"kk": 1}):
            with self.subTest(locale=junk):
                stub = StubClient(SHASHLYK)
                out = ask(stub, junk)
                self.assertEqual(out["locale"], "ru")
                self.assertEqual(stub.calls, self.ru.calls)
                self.assertEqual(out["picks"], self.ru_out["picks"])

    def test_resolve_locale(self):
        self.assertEqual([ai.resolve_locale(x) for x in ("kk", "en", "ru", "kz", None)], ["kk", "en", "ru", "ru", "ru"])

    # ── kk / en ──

    def test_reply_and_pick_texts_in_guest_language(self):
        labels = {"en": (r"^(Cleanse|Complement|Contrast|Aroma bridge|Balance|Risky pair)$", r"^(Perfect pair|Excellent match|Good pair|Neutral|Not recommended|Avoid)$"),
                  "kk": (r"^(Тазартады|Толықтырады|Контраст|Хош иіс көпірі|Тепе-теңдік|Даулы жұп)$", r"^(Мінсіз жұп|Өте жақсы үйлесім|Жақсы жұп|Бейтарап|Ұсынбаймыз|Аулақ болған жөн)$")}
        for locale in ("en", "kk"):
            with self.subTest(locale=locale):
                out = ask(StubClient(SHASHLYK, translated(locale)), locale)
                self.assertEqual((out["locale"], out["kind"], out["reply"]), (locale, "picks", f"[{locale}] reply"))
                self.assertTrue(all_tagged(out["picks"], locale), out["picks"][0])
                # напитки, порядок, оценки, уровни доказательности и цены — только от движка
                self.assertEqual(only(out["picks"], ENGINE_OWNED), only(self.ru_out["picks"], ENGINE_OWNED))
                self.assertEqual(out["route"], self.ru_out["route"])
                for p in out["picks"]:
                    self.assertRegex(p["match_label"], labels[locale][0])
                    self.assertRegex(p["band_label"], labels[locale][1])
                    self.assertEqual(p["category_label"], ai.CATEGORY_LABELS[locale][p["category"]])

    def test_cached_prefix_is_byte_identical_across_locales(self):
        hints = {"en": r"английск", "kk": r"казахск.*кириллиц"}
        for locale in ("en", "kk"):
            with self.subTest(locale=locale):
                stub = StubClient(SHASHLYK, translated(locale))
                ask(stub, locale)
                for i in (0, 1):
                    system = stub.calls[i]["system"]
                    self.assertEqual(system[:-1], self.ru.calls[i]["system"])   # кэшируемые блоки те же, что у ru
                    self.assertEqual(len(system), len(self.ru.calls[i]["system"]) + 1)
                    self.assertNotIn("cache_control", system[-1])               # язык — за точкой кэша
                    self.assertRegex(system[-1]["text"], hints[locale])
                    self.assertIn("без markdown", system[-1]["text"])
                # схема интерпретации и сообщения гостя от языка не зависят
                self.assertEqual(stub.calls[0]["output_config"], self.ru.calls[0]["output_config"])
                self.assertEqual(stub.calls[0]["messages"], self.ru.calls[0]["messages"])
                # объяснение — строгая JSON-схема; в brief есть то, что нужно перевести
                self.assertEqual(stub.calls[1]["output_config"]["format"], {"type": "json_schema", "schema": ai.NARRATE_SCHEMA})
                self.assertEqual(stub.calls[1]["model"], ai.MODEL)
                for u in json.loads(stub.calls[1]["messages"][0]["content"])["translate"]["items"]:
                    self.assertTrue(u["id"] and u["why"])

    def test_broken_json_falls_back_to_russian_texts(self):
        for name, bad in (("оборванный JSON", '{"reply": "Go for'), ("текст вместо JSON", "Take the pilsner."), ("пусто", ""),
                          ("не объект", "[1, 2]"), ("null", "null"), ("NaN", "NaN")):
            with self.subTest(case=name):
                out = ask(StubClient(SHASHLYK, lambda _brief, bad=bad: bad), "en")
                self.assertEqual((out["kind"], out["locale"]), ("picks", "en"))
                self.assertEqual(human(out["picks"]), human(self.ru_out["picks"]))
                self.assertEqual(only(out["picks"], ENGINE_OWNED), only(self.ru_out["picks"], ENGINE_OWNED))
                self.assertEqual(out["reply"], SHASHLYK["reply"])   # фраза из интерпретации, а не обломок JSON

    def test_narration_refusal_keeps_engine_texts(self):
        out = ask(StubClient(SHASHLYK, stop={"narrate": "refusal"}), "kk")
        self.assertEqual(human(out["picks"]), human(self.ru_out["picks"]))
        self.assertEqual(out["reply"], SHASHLYK["reply"])
        cut = ask(StubClient(SHASHLYK, "Берите пилснер, пото", stop={"narrate": "max_tokens"}))
        self.assertEqual(cut["reply"], SHASHLYK["reply"])   # оборванное объяснение не показываем

    def test_model_cannot_change_picks(self):
        def first(change):
            return lambda d: {**d, "items": [change(p) if i == 0 else p for i, p in enumerate(d["items"])]}
        mutations = {
            "другой порядок": lambda d: {**d, "items": d["items"][::-1]},
            "чужой id": first(lambda p: {**p, "id": "guinness"}),
            "пропала причина": first(lambda p: {**p, "reasons": p["reasons"][1:]}),
            "лишняя позиция": lambda d: {**d, "items": d["items"] + d["items"][:1]},
            "нет позиций": lambda d: {**d, "items": []},
            "пустая строка": first(lambda p: {**p, "why": " "}),
            "не строка": first(lambda p: {**p, "reasons": [1] * len(p["reasons"])}),
            "items не список": lambda d: {**d, "items": "x"},
        }
        for name, mutate in mutations.items():
            with self.subTest(case=name):
                out = ask(StubClient(SHASHLYK, translated("kk", mutate)), "kk")
                self.assertEqual(human(out["picks"]), human(self.ru_out["picks"]))
                self.assertEqual(only(out["picks"], ENGINE_OWNED), only(self.ru_out["picks"], ENGINE_OWNED))
                self.assertEqual(out["reply"], "[kk] reply")   # сам ответ гостю при этом годен

    def test_extra_fields_from_model_are_ignored(self):
        forged = lambda d: {**d, "items": [{**p, "score": 100, "price": 1, "name": "Guinness", "evidence": "A"} for p in d["items"]]}
        out = ask(StubClient(SHASHLYK, translated("en", forged)), "en")
        self.assertTrue(all_tagged(out["picks"], "en"))
        self.assertEqual(only(out["picks"], ENGINE_OWNED), only(self.ru_out["picks"], ENGINE_OWNED))

    def test_engine_warning_is_translated_or_kept(self):
        tiramisu = {**SHASHLYK, "reply": "Тирамису", "dish": {**DISH, "name": "Тирамису", "matched_slug": "tiramisu"}, "occasion": None}
        data = {"mode": "ask", "messages": [{"role": "user", "content": "тирамисуға не сәйкес келеді?"}], "venue": VENUE, "locale": "kk"}
        ok = ai.run_sommelier(data, client=StubClient(tiramisu, translated("kk")))
        self.assertTrue(any(p["warnings"] for p in ok["picks"]), "ожидали предупреждение движка у пары к тирамису")
        self.assertTrue(all_tagged(ok["picks"], "kk"))
        drop = lambda d: {**d, "items": [{**p, "warnings": []} for p in d["items"]]}
        lost = ai.run_sommelier(data, client=StubClient(tiramisu, translated("kk", drop)))
        self.assertTrue(any(p["warnings"] for p in lost["picks"]))          # предупреждение не потерялось
        self.assertFalse(any(p["why"].startswith("[kk]") for p in lost["picks"]))

    # ── ветки без пар ──

    def test_clarify_refusal_and_empty_menu(self):
        clarify = {**SHASHLYK, "kind": "clarify", "reply": "Қандай тағам жеп отырсыз?"}
        out = ask(StubClient(clarify), "kk")
        self.assertEqual((out["kind"], out["reply"], out["locale"]), ("clarify", clarify["reply"], "kk"))
        self.assertIn("what you are eating", ask(StubClient({**clarify, "reply": ""}), "en")["reply"])
        self.assertEqual(ask(StubClient({**clarify, "reply": ""}))["reply"], "Уточните, пожалуйста, что вы едите?")

        for locale, word in (("kk", "сусын"), ("en", "drink"), ("ru", "напиток")):
            out = ask(StubClient(SHASHLYK, stop={"interpret": "refusal"}), locale)
            self.assertEqual((out["kind"], out["locale"], out["picks"]), ("chat", locale, []))
            self.assertIn(word, out["reply"])

        stub = StubClient(SHASHLYK)
        out = ask(stub, "en", venue={"slug": "x", "beers": ["no-such-beer"]})
        self.assertEqual((out["kind"], out["picks"], len(stub.calls)), ("picks", [], 1))
        self.assertIn("no drink on this venue", out["reply"])

    # ── HTTP-контракт: шов _get_client ──

    def test_view_echoes_locale(self):
        body = {"mode": "ask", "messages": [{"role": "user", "content": "what goes with shashlik?"}], "venue": VENUE}
        for sent, expected in (("en", "en"), ("kk", "kk"), ("fr", "ru"), (None, "ru")):
            with self.subTest(locale=sent):
                stub = StubClient(SHASHLYK, translated(expected) if expected != "ru" else None)
                with mock.patch.object(ai, "_get_client", return_value=stub):
                    res = APIClient().post("/api/ai/", {**body, **({"locale": sent} if sent else {})}, format="json")
                self.assertEqual(res.status_code, 200, res.content)
                data = res.json()
                self.assertEqual((data["ok"], data["locale"], len(data["picks"])), (True, expected, 3))
                self.assertEqual(all_tagged(data["picks"], expected), expected != "ru")

    # ── зеркало: тексты, словари и схемы в Python и TS совпадают дословно ──

    @skipUnless((LIB_DIR / "prompts.ts").exists(), "нет frontend/ рядом с backend/ — сверять не с чем")
    def test_prompts_mirror_typescript(self):
        ts = "\n".join(p.read_text(encoding="utf-8") for p in sorted(LIB_DIR.glob("*.ts")))
        # язык гостя, готовые фразы, статичные подписи
        for locale in ("kk", "en"):
            style = ai.LANG_STYLE[locale]
            pieces = [style, ai._lang_interpret(locale)[len(style):], ai._lang_drink(locale)[len(style):], ai._lang_narrate(locale)[len(style):],
                      *ai.MATCH_LABELS[locale].values(), *ai.BAND_LABELS[locale].values(), *ai.CATEGORY_LABELS[locale].values()]
            for piece in pieces:
                self.assertIn(piece, ts, f"{locale}: нет в frontend/api/_lib — {piece[:60]}…")
        for locale in ai.LOCALES:
            for text in ai.TEXTS[locale].values():
                self.assertIn(text, ts)
        for piece in (*ai.MATCH_LABELS["ru"].values(), *ai.CATEGORY_LABELS["ru"].values(), ai.IMAGE_PROMPT_DISH, ai.IMAGE_PROMPT_DRINK,
                      ai.PHOTO_DISH, ai.PHOTO_DRINK, ai.SYSTEM_INTERPRET, ai.SYSTEM_NARRATE, *ai.TAG_GLOSS.values(), *ai.SUGAR_LABELS.values()):
            self.assertIn(piece, ts, f"нет в frontend/api/_lib — {piece[:60]}…")
        # шаблоны с подстановками: статичные куски между ${…} в TS = куски между подстановками в Python
        for ts_name, render in (("systemContext", lambda: ai.system_context("\x00", "\x00", "\x00", "\x00", "\x00")),
                                ("systemDrink", lambda: ai.system_drink("\x00", "\x00"))):
            with self.subTest(template=ts_name):
                body = re.search(rf"export const {ts_name} = \([^)]*\): string => `(.*?)`;", ts, re.S).group(1)
                self.assertEqual(re.split(r"\$\{[^}]*\}", body), render().split("\x00"))
        # словари enum — те же значения и порядок
        for name in ("TASTES", "WEIGHTS", "FATS", "COOK_METHODS", "PROTEIN_SOURCES", "SAUCES", "ACID_TYPES", "OCCASIONS", "CUISINES",
                     "AROMA_TAGS", "INGREDIENT_TAGS", "SUGAR_CATEGORIES", "ADJUST_AXES", "HARSH_TOL", "MEDIA_TYPES", "INTERPRET_KINDS", "DRINK_KINDS"):
            with self.subTest(enum=name):
                lit = re.search(rf"export const {name} = (\[.*?\]) as const;", ts).group(1)
                self.assertEqual(json.loads(lit.replace("'", '"')), list(getattr(ai, name)))
        # схема JSON-объяснения: те же поля и обязательность
        block = re.search(r"export const NARRATE_SCHEMA = (\{.*?\}) as const;", ts, re.S).group(1)
        as_json = re.sub(r",(\s*[}\]])", r"\1", re.sub(r"(\w+):", r'"\1":', block.replace("'", '"')))
        self.assertEqual(json.loads(as_json), ai.NARRATE_SCHEMA)

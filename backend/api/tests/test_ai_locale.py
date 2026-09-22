"""Язык гостя в ИИ-сомелье (locale: ru / kk / en) — зеркало проверок frontend/scripts/ai-dryrun.mjs.

Сети и ключа не нужно: клиент Anthropic подменяется заглушкой. Швов два — параметр client у run_sommelier
и api.ai._get_client (его подменяем, когда идём через HTTP-вьюху).
Запуск: .venv/bin/python manage.py test api.tests.test_ai_locale
"""
from __future__ import annotations

import io
import json
import re
from pathlib import Path
from types import SimpleNamespace
from unittest import mock, skipUnless

from django.conf import settings
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from api import ai
from api.pairing.engine import TYPE_LABELS

SHASHLYK = {"kind": "dish", "reply": "Похоже на шашлык",
            "dish": {"name": "Шашлык", "matched_slug": "shashlyk", "taste": "UMAMI", "weight": "HEAVY", "fat": "HIGH",
                     "cooking": "GRILLED", "heat": 0.1, "tags": ["smoke"], "confidence": 0.9},
            "occasion": "hot", "bitter_pref": 0}
VENUE = {"slug": "efes-beer-garden-almaty", "name": "Efes Beer Garden", "beers": ["13-region", "bochkovoe", "efes-pilsener"],
         "prices": {"13-region": 1750}, "currency": "₸"}
ENGINE_OWNED = ("beer_id", "name", "style", "abv", "score", "match_type", "sommelier_pick", "price", "volume")
HUMAN_TEXT = ("why", "reasons", "warnings")
TS_SOURCE = Path(settings.BASE_DIR).parent / "frontend" / "api" / "_lib" / "sommelier.ts"


def _message(text: str, stop_reason: str = "end_turn"):
    return SimpleNamespace(stop_reason=stop_reason, content=[SimpleNamespace(type="text", text=text)] if text is not None else [],
                           usage=SimpleNamespace(input_tokens=100, output_tokens=40))


class StubClient:
    """1-й вызов — структурированный JSON интерпретации, 2-й — текст сомелье (для kk/en — то, что вернёт narrate(brief))."""

    def __init__(self, interpretation: dict, narrate=None):
        self.calls: list[dict] = []
        self.messages = SimpleNamespace(create=self._create)
        self._interpretation, self._narrate = interpretation, narrate

    def _create(self, **params):
        self.calls.append(params)
        if len(self.calls) == 1:
            return _message(json.dumps(self._interpretation, ensure_ascii=False))
        brief = json.loads(params["messages"][0]["content"])
        return _message(self._narrate(brief) if self._narrate else f"Берите {brief['picks'][0]['name']} — он справится с жиром и дымом.")


class RefusingClient:
    def __init__(self):
        self.messages = SimpleNamespace(create=lambda **_: _message(None, stop_reason="refusal"))


def translated(tag: str, mutate=lambda d: d):
    """«Перевод» заглушки: те же beer_id в том же порядке, столько же причин и предупреждений, каждая строка помечена языком."""
    def narrate(brief: dict) -> str:
        return json.dumps(mutate({"reply": f"[{tag}] reply", "picks": [
            {"beer_id": p["beer_id"], "why": f"[{tag}] {p['why']}", "reasons": [f"[{tag}] {s}" for s in p["reasons"]],
             "warnings": [f"[{tag}] {s}" for s in p["warnings"]]} for p in brief["picks"]]}), ensure_ascii=False)
    return narrate


def ask(client, locale=..., **extra) -> dict:
    data = {"mode": "ask", "messages": [{"role": "user", "content": "что взять к шашлыку в жару?"}], "venue": VENUE, **extra}
    if locale is not ...:
        data["locale"] = locale
    return ai.run_sommelier(data, client=client)


def only(picks: list[dict], keys: tuple) -> list[dict]:
    return [{k: p[k] for k in keys} for p in picks]


def all_tagged(out: dict, tag: str) -> bool:
    return all(s.startswith(f"[{tag}] ") for p in out["picks"] for s in [p["why"], *p["reasons"], *p["warnings"]])


class AiLocaleTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("load_flavor_data", stdout=io.StringIO())

    def setUp(self):
        # эталон: запрос без locale — поведение «как до локалей»
        self.ru = StubClient(SHASHLYK)
        self.ru_out = ask(self.ru)
        # страховка «без сети»: настоящий клиент в этих тестах создаваться не должен
        patcher = mock.patch.object(ai, "_get_client", side_effect=AssertionError("реальный клиент Anthropic в тестах не нужен"))
        patcher.start()
        self.addCleanup(patcher.stop)

    # ── ru: всё как было ──

    def test_absent_locale_is_ru_and_request_is_unchanged(self):
        out, calls = self.ru_out, self.ru.calls
        self.assertEqual(out["locale"], "ru")
        self.assertEqual(out["kind"], "picks")
        self.assertEqual(len(out["picks"]), 3)
        self.assertIn("Берите", out["reply"])
        for c in calls:   # один system-блок с кэшем, никакого языкового хвоста
            self.assertEqual(len(c["system"]), 1)
            self.assertEqual(c["system"][0]["cache_control"], {"type": "ephemeral"})
        self.assertEqual(calls[0]["output_config"]["format"]["type"], "json_schema")
        self.assertEqual(calls[1]["output_config"], {"effort": "low"})
        self.assertEqual(calls[1]["max_tokens"], 700)
        for p in json.loads(calls[1]["messages"][0]["content"])["picks"]:
            self.assertNotIn("beer_id", p)
            self.assertNotIn("why", p)
        for p in out["picks"]:
            self.assertEqual(p["match_label"], TYPE_LABELS[p["match_type"]])

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
        labels = {"en": r"^(Complement|Contrast|Cleanse|Bridge)$",
                  "kk": r"^(Complement · толықтыру|Contrast · контраст|Cleanse · тазарту|Bridge · көпір)$"}
        for locale in ("en", "kk"):
            with self.subTest(locale=locale):
                stub = StubClient(SHASHLYK, translated(locale))
                out = ask(stub, locale)
                self.assertEqual((out["locale"], out["kind"], out["reply"]), (locale, "picks", f"[{locale}] reply"))
                self.assertTrue(all_tagged(out, locale), out["picks"][0])
                # сорта, порядок, оценки и цены — только от движка
                self.assertEqual(only(out["picks"], ENGINE_OWNED), only(self.ru_out["picks"], ENGINE_OWNED))
                self.assertEqual(out["route"], self.ru_out["route"])
                for p in out["picks"]:
                    self.assertRegex(p["match_label"], labels[locale])

    def test_cached_prefix_is_byte_identical_across_locales(self):
        hints = {"en": r"английск", "kk": r"казахск.*кириллиц"}
        for locale in ("en", "kk"):
            with self.subTest(locale=locale):
                stub = StubClient(SHASHLYK, translated(locale))
                ask(stub, locale)
                for i in (0, 1):
                    system = stub.calls[i]["system"]
                    self.assertEqual(system[0], self.ru.calls[i]["system"][0])   # кэшируемый блок тот же, что у ru
                    self.assertEqual(len(system), 2)
                    self.assertNotIn("cache_control", system[1])                # язык — за точкой кэша
                    self.assertRegex(system[1]["text"], hints[locale])
                    self.assertIn("без markdown", system[1]["text"])
                # схема интерпретации и сообщения гостя от языка не зависят
                self.assertEqual(stub.calls[0]["output_config"], self.ru.calls[0]["output_config"])
                self.assertEqual(stub.calls[0]["messages"], self.ru.calls[0]["messages"])
                # объяснение — строгая JSON-схема; в brief есть то, что нужно перевести
                self.assertEqual(stub.calls[1]["output_config"]["format"], {"type": "json_schema", "schema": ai.NARRATE_SCHEMA})
                self.assertEqual(stub.calls[1]["model"], ai.MODEL)
                for p in json.loads(stub.calls[1]["messages"][0]["content"])["picks"]:
                    self.assertTrue(p["beer_id"] and p["why"])

    def test_broken_json_falls_back_to_russian_texts(self):
        for name, bad in (("оборванный JSON", '{"reply": "Go for'), ("текст вместо JSON", "Take the pilsner."), ("пусто", ""),
                          ("не объект", "[1, 2]"), ("null", "null")):
            with self.subTest(case=name):
                out = ask(StubClient(SHASHLYK, lambda _brief, bad=bad: bad), "en")
                self.assertEqual((out["kind"], out["locale"]), ("picks", "en"))
                self.assertEqual(only(out["picks"], HUMAN_TEXT), only(self.ru_out["picks"], HUMAN_TEXT))
                self.assertEqual(only(out["picks"], ENGINE_OWNED), only(self.ru_out["picks"], ENGINE_OWNED))
                self.assertEqual(out["reply"], SHASHLYK["reply"])   # фраза из интерпретации, а не обломок JSON

    def test_narration_refusal_keeps_engine_texts(self):
        class Client(StubClient):
            def _create(self, **params):
                return super()._create(**params) if not self.calls else _message(None, stop_reason="refusal")
        out = ask(Client(SHASHLYK), "kk")
        self.assertEqual(only(out["picks"], HUMAN_TEXT), only(self.ru_out["picks"], HUMAN_TEXT))
        self.assertEqual(out["reply"], SHASHLYK["reply"])

    def test_model_cannot_change_picks(self):
        def first(change):
            return lambda d: {**d, "picks": [change(p) if i == 0 else p for i, p in enumerate(d["picks"])]}
        mutations = {
            "другой порядок": lambda d: {**d, "picks": d["picks"][::-1]},
            "чужой beer_id": first(lambda p: {**p, "beer_id": "guinness"}),
            "пропала причина": first(lambda p: {**p, "reasons": p["reasons"][1:]}),
            "лишняя пара": lambda d: {**d, "picks": d["picks"] + d["picks"][:1]},
            "нет пар": lambda d: {**d, "picks": []},
            "пустая строка": first(lambda p: {**p, "why": " "}),
            "не строка": first(lambda p: {**p, "reasons": [1] * len(p["reasons"])}),
            "picks не список": lambda d: {**d, "picks": "x"},
        }
        for name, mutate in mutations.items():
            with self.subTest(case=name):
                out = ask(StubClient(SHASHLYK, translated("kk", mutate)), "kk")
                self.assertEqual(only(out["picks"], HUMAN_TEXT), only(self.ru_out["picks"], HUMAN_TEXT))
                self.assertEqual(only(out["picks"], ENGINE_OWNED), only(self.ru_out["picks"], ENGINE_OWNED))
                self.assertEqual(out["reply"], "[kk] reply")   # сам ответ гостю при этом годен

    def test_extra_fields_from_model_are_ignored(self):
        forged = lambda d: {**d, "picks": [{**p, "score": 100, "price": 1, "name": "Guinness"} for p in d["picks"]]}
        out = ask(StubClient(SHASHLYK, translated("en", forged)), "en")
        self.assertTrue(all_tagged(out, "en"))
        self.assertEqual(only(out["picks"], ENGINE_OWNED), only(self.ru_out["picks"], ENGINE_OWNED))

    def test_engine_warning_is_translated_or_kept(self):
        kumys = {**SHASHLYK, "reply": "Қымыз", "dish": {**SHASHLYK["dish"], "name": "Кумыс", "matched_slug": "kumys"}, "occasion": None}
        data = {"mode": "ask", "messages": [{"role": "user", "content": "қымызға не сәйкес келеді?"}], "locale": "kk"}
        ok = ai.run_sommelier(data, client=StubClient(kumys, translated("kk")))
        self.assertTrue(any(p["warnings"] for p in ok["picks"]), "ожидали предупреждение движка у пары к кумысу")
        self.assertTrue(all_tagged(ok, "kk"))
        drop = lambda d: {**d, "picks": [{**p, "warnings": []} for p in d["picks"]]}
        lost = ai.run_sommelier(data, client=StubClient(kumys, translated("kk", drop)))
        self.assertTrue(any(p["warnings"] for p in lost["picks"]))          # предупреждение не потерялось
        self.assertFalse(any(p["why"].startswith("[kk]") for p in lost["picks"]))

    # ── ветки без пар ──

    def test_clarify_refusal_and_empty_menu(self):
        clarify = {**SHASHLYK, "kind": "clarify", "reply": "Қандай тағам жеп отырсыз?"}
        out = ask(StubClient(clarify), "kk")
        self.assertEqual((out["kind"], out["reply"], out["locale"]), ("clarify", clarify["reply"], "kk"))
        self.assertIn("what you are eating", ask(StubClient({**clarify, "reply": ""}), "en")["reply"])
        self.assertEqual(ask(StubClient({**clarify, "reply": ""}))["reply"], "Уточните, пожалуйста, что вы едите?")

        for locale, word in (("kk", "сыра"), ("en", "beer"), ("ru", "пиво")):
            out = ask(RefusingClient(), locale)
            self.assertEqual((out["kind"], out["locale"], out["picks"]), ("chat", locale, []))
            self.assertIn(word, out["reply"])

        stub = StubClient(SHASHLYK)
        out = ask(stub, "en", venue={"slug": "x", "beers": ["no-such-beer"]})
        self.assertEqual((out["kind"], out["picks"], len(stub.calls)), ("picks", [], 1))
        self.assertIn("no beer on this venue", out["reply"])

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
                self.assertEqual(all_tagged(data, expected), expected != "ru")

    # ── зеркало: тексты в Python и TS совпадают дословно ──

    @skipUnless(TS_SOURCE.exists(), "нет frontend/ рядом с backend/ — сверять не с чем")
    def test_prompts_mirror_typescript(self):
        ts = TS_SOURCE.read_text(encoding="utf-8")
        for locale in ("kk", "en"):
            style = ai.LANG_STYLE[locale]
            pieces = [style, ai._lang_interpret(locale)[len(style):], ai._lang_narrate(locale)[len(style):],
                      *ai.TEXTS[locale].values(), *ai.MATCH_LABELS[locale].values()]
            for piece in pieces:
                self.assertIn(piece, ts, f"{locale}: нет в sommelier.ts — {piece[:60]}…")
        for text in ai.TEXTS["ru"].values():
            self.assertIn(text, ts)
        # схема JSON-объяснения: те же поля и обязательность
        block = re.search(r"const NARRATE_SCHEMA = (\{.*?\}) as const;", ts, re.S).group(1)
        as_json = re.sub(r",(\s*[}\]])", r"\1", re.sub(r"(\w+):", r'"\1":', block.replace("'", '"')))
        self.assertEqual(json.loads(as_json), ai.NARRATE_SCHEMA)

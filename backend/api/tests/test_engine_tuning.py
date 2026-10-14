# -*- coding: utf-8 -*-
"""Тесты подкрутки весов движка из админки."""
from django.test import TestCase

from .. import engine_tuning
from .helpers import make_user, client_for


class EngineTuningTests(TestCase):
    def setUp(self):
        engine_tuning._cache.clear()
        self.mod = make_user("mod", role="moderator")
        self.somm = make_user("somm", role="sommelier")
        self.plain = make_user("joe")

    # --- доступ ---
    def test_anonymous_and_plain_user_denied(self):
        self.assertIn(client_for().get("/api/v2/tuning/").status_code, (401, 403))
        self.assertIn(client_for(self.plain).get("/api/v2/tuning/").status_code, (401, 403))

    def test_sommelier_and_moderator_can_read(self):
        for u in (self.mod, self.somm):
            r = client_for(u).get("/api/v2/tuning/")
            self.assertEqual(r.status_code, 200, u.username)
            self.assertTrue(r.json()["knobs"])

    def test_state_shape(self):
        j = client_for(self.mod).get("/api/v2/tuning/").json()
        self.assertEqual(j["version"], 0)
        self.assertFalse(j["has_overrides"])
        paths = {k["path"] for k in j["knobs"]}
        self.assertIn("score.base", paths)
        for k in j["knobs"]:
            self.assertEqual(k["value"], k["base"])  # без override value == base

    # --- сохранение и влияние на подбор ---
    def _top_score(self, dish="beshbarmak"):
        j = client_for(self.mod).get("/api/v2/pairing/dish/%s/" % dish).json()
        scores = [it["score"] for c in j["categories"] for it in c["items"]]
        return max(scores)

    def test_save_changes_scores_and_reset_restores(self):
        base_top = self._top_score()
        c = client_for(self.mod)
        r = c.post("/api/v2/tuning/save/", {"overrides": {"score.base": 60}}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["has_overrides"])
        self.assertEqual(r.json()["version"], 1)
        raised = self._top_score()
        self.assertGreater(raised, base_top)  # выше базовой щедрости -> балл выше
        c.post("/api/v2/tuning/reset/", {}, format="json")
        self.assertEqual(self._top_score(), base_top)  # сброс возвращает базовое поведение

    def test_sanitize_unknown_and_out_of_range(self):
        c = client_for(self.mod)
        c.post("/api/v2/tuning/save/",
               {"overrides": {"score.base": 999, "evil.path": 1, "R1.k_loud": 55}}, format="json")
        j = c.get("/api/v2/tuning/").json()
        vals = {k["path"]: k["value"] for k in j["knobs"]}
        self.assertEqual(vals["score.base"], 60)      # обрезано до максимума диапазона
        self.assertEqual(vals["R1.k_loud"], 55)       # валидное значение сохранено
        row, ov = engine_tuning.current()
        self.assertNotIn("evil.path", ov)             # неизвестный путь отброшен

    def test_bad_body_rejected(self):
        r = client_for(self.mod).post("/api/v2/tuning/save/", {"overrides": "x"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_plain_user_cannot_save(self):
        r = client_for(self.plain).post("/api/v2/tuning/save/", {"overrides": {}}, format="json")
        self.assertIn(r.status_code, (401, 403))

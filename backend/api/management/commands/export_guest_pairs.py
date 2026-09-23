"""Выгрузка устойчивых оценок гостей в эталонные пары для калибровки движка (ENGINE_V2_SPEC.md §7.4, п. 5).

    python manage.py export_guest_pairs                   # → data/guest_pairs.json
    python manage.py export_guest_pairs --dry-run         # только посчитать и показать
    python manage.py export_guest_pairs --out /tmp/g.json --min-reviews 10 --min-sessions 6

Формат — как «pairs» в data/test_pairs.json (origin "guests", evidence "G", split "train", плюс counts).
Отбор (reviews_logic.guest_pairs): только опубликованные отзывы; пара = (архетип стиля × блюдо каталога), архетип
напитка — style.archetype из data/drinks.json; ≥ 8 отзывов от ≥ 5 разных сессий; средняя по гостям ≥ 4.2 → "good",
≤ 2.4 → "bad", между — пропуск. Своё блюдо (custom) и отзывы, где ИИ заметил другое блюдо, не берутся.

Это СЛАБЫЙ сигнал: гости оценивают удовольствие, а не совместимость по правилам; выборка смещена к тем, кто нажимает
кнопки. Поэтому пары идут только в train и с весом, который задаёт калибратор (scripts/calibrate_v2.py, ORIGIN_WEIGHT
по полю origin) — сами по себе они не должны перевешивать литературу и дегустацию сомелье.
Нет подходящих пар — файл всё равно пишется с пустым списком: никаких выдуманных записей.
"""
from __future__ import annotations

import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db.utils import DatabaseError
from django.utils import timezone

from api import reviews_logic as L
from api.models import PairingReview
from api.pairing.dataset_v2 import get_dataset


class Command(BaseCommand):
    help = "Пары (архетип × блюдо) с устойчивой оценкой гостей → data/guest_pairs.json (слабый сигнал для калибровки)"

    def add_arguments(self, parser):
        parser.add_argument("--out", default=None, help="куда писать (по умолчанию <FLAVOR_DATA_DIR>/guest_pairs.json)")
        parser.add_argument("--min-reviews", type=int, default=L.EXPORT_MIN_REVIEWS)
        parser.add_argument("--min-sessions", type=int, default=L.EXPORT_MIN_SESSIONS)
        parser.add_argument("--good", type=float, default=L.EXPORT_GOOD, help="средняя ≥ … → expect good")
        parser.add_argument("--bad", type=float, default=L.EXPORT_BAD, help="средняя ≤ … → expect bad")
        parser.add_argument("--dry-run", action="store_true", help="ничего не записывать")

    def handle(self, *args, **opts):
        if opts["bad"] >= opts["good"]:
            raise CommandError("--bad должен быть меньше --good")
        data_dir = Path(getattr(settings, "FLAVOR_DATA_DIR", ""))
        ds = get_dataset(str(data_dir) if str(data_dir) else None)
        archetype_of = {d["id"]: (d.get("style") or {}).get("archetype") for d in ds.drinks}
        archetype_of.update({a: a for a in ds.archetype_raw_by_id})      # отзыв мог прийти прямо на архетип
        try:
            rows = list(PairingReview.objects.filter(status="published")
                        .values("drink_id", "dish_id", "rating", "verified", "session_hash", "ai_flags"))
        except DatabaseError as exc:
            raise CommandError(f"Таблицы отзывов нет или она недоступна ({exc}). Выполните: python manage.py migrate")

        result = L.guest_pairs(rows, archetype_of, known_dishes=ds.dish_by_id, known_archetypes=ds.archetype_raw_by_id,
                               min_reviews=opts["min_reviews"], min_sessions=opts["min_sessions"],
                               good=opts["good"], bad=opts["bad"])
        doc = {
            "pairs": result["pairs"],
            "ordinals": [],
            "meta": {
                "generator": "python manage.py export_guest_pairs",
                "generated_at": timezone.now().isoformat(timespec="seconds"),
                "origin": "guests",
                "evidence": "G — реакции гостей в приложении (слабый сигнал; вес задаёт scripts/calibrate_v2.py)",
                "thresholds": {"min_reviews": opts["min_reviews"], "min_sessions": opts["min_sessions"],
                               "good_mean_min": opts["good"], "bad_mean_max": opts["bad"]},
                "published_reviews": len(rows),
                "pair_groups": result["groups"],
                "skipped": result["skipped"],
            },
        }
        good = sum(1 for p in result["pairs"] if p["expect"] == "good")
        summary = (f"Опубликованных отзывов: {len(rows)}; пар в выгрузке: {len(result['pairs'])} "
                   f"(good {good}, bad {len(result['pairs']) - good}); пропущено: {result['skipped'] or 'ничего'}")
        if opts["dry_run"]:
            self.stdout.write(summary + " — dry run, файл не записан")
            return
        out = Path(opts["out"]) if opts["out"] else data_dir / "guest_pairs.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        self.stdout.write(self.style.SUCCESS(f"{summary} → {out}"))

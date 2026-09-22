"""
python manage.py load_flavor_data
Загружает канонические данные Flavor Tree из /data/*.json (идемпотентно, по slug):
ноты (с осями движка), 17 сортов + пирамиды + подача, 50 блюд с векторами,
51 кураторская пара, курсы, команда, заведения HoReCa с QR-столами.
"""
from __future__ import annotations

import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction

from api.models import (
    FlavorNote, Brand, FlavorProfile, ServingRecommendation, Course, TeamMember,
    Dish, FoodPairing, Venue, QRCode,
)


def _load(name: str):
    path = Path(settings.FLAVOR_DATA_DIR) / name
    with open(path, encoding="utf-8") as f:
        return json.load(f)


class Command(BaseCommand):
    help = "Загружает данные Flavor Tree из /data/*.json (идемпотентно)"

    @transaction.atomic
    def handle(self, *args, **options):
        # 1. ноты
        notes = _load("flavor_notes.json")
        note_by_slug = {}
        for n in notes:
            obj, _ = FlavorNote.objects.update_or_create(slug=n["id"], defaults={
                "name": n["name"], "technical_term": n.get("technical_term", ""), "category": n["category"],
                "description": n["description"], "icon": n["icon"], "sort_order": n.get("sort_order", 0),
                "axes": n.get("axes", {}), "tags": n.get("tags", []), "is_off_flavour": bool(n.get("is_off_flavour", False)),
            })
            note_by_slug[n["id"]] = obj
        self.stdout.write(f"  ✓ ноты: {len(note_by_slug)}")

        # 2. сорта
        brands = _load("brands.json")
        media_dir = Path(settings.MEDIA_ROOT) / "brands"
        brand_by_slug = {}
        profiles = 0
        for b in brands:
            brand, _ = Brand.objects.update_or_create(slug=b["id"], defaults={
                "name": b["name"], "display_name": b.get("display_name", ""), "brand_owner": b.get("brand_owner", ""),
                "style": b["style"], "style_family": b.get("style_family", "LAGER"), "abv": b.get("abv"),
                "abv_estimated": b.get("abv_estimated", False), "packaging_type": b["packaging_type"],
                "is_horeca_only": b.get("is_horeca_only", False), "description": b.get("description", ""),
                "origin": b.get("origin", ""), "tagline": b.get("tagline", ""), "accent": b.get("accent") or "",
                "is_active": True,
            })
            media_file = b.get("media_file")
            if media_file and (media_dir / media_file).exists() and not brand.image:
                brand.image.name = f"brands/{media_file}"
                brand.save(update_fields=["image"])
            brand_by_slug[b["id"]] = brand
            s = b.get("serving") or {}
            ServingRecommendation.objects.update_or_create(brand=brand, defaults={
                "serving_temp_min": s.get("temp_min", 5), "serving_temp_max": s.get("temp_max", 8),
                "glass_type": s.get("glass", "Пилснер / Пинта"), "seasonality": s.get("seasonality", "Круглый год"),
            })
            FlavorProfile.objects.filter(brand=brand).delete()
            for p in b.get("pyramid", []):
                note = note_by_slug.get(p["note_id"])
                if not note:
                    continue
                FlavorProfile.objects.create(brand=brand, flavor_note=note, layer=p["layer"],
                                             intensity=p["intensity"], sommelier_note=p.get("sommelier_note", ""),
                                             sommelier_name="Главный сомелье Flavor Tree")
                profiles += 1
        self.stdout.write(f"  ✓ сорта: {len(brand_by_slug)}, нот в пирамидах: {profiles}")

        # 3. блюда
        dishes = _load("dishes.json")
        dish_by_slug = {}
        for d in dishes:
            obj, _ = Dish.objects.update_or_create(slug=d["id"], defaults={
                "name": d["name"], "display_name": d.get("display_name", ""), "emoji": d.get("emoji", ""),
                "cuisine": d["cuisine"], "category": d.get("category", ""), "dominant_taste": d["dominant_taste"],
                "weight": d["weight"], "fat_level": d["fat_level"], "cooking_method": d["cooking_method"],
                "description": d.get("description", ""), "vector": d.get("vector", {}), "tags": d.get("tags", []),
                "synonyms": d.get("synonyms", []),
            })
            dish_by_slug[d["id"]] = obj
        self.stdout.write(f"  ✓ блюда: {len(dish_by_slug)}")

        # 4. кураторские пары
        FoodPairing.objects.all().delete()
        pairs = 0
        for p in _load("pairings_curated.json"):
            brand, dish = brand_by_slug.get(p["brand_id"]), dish_by_slug.get(p["dish_id"])
            if brand and dish:
                FoodPairing.objects.create(brand=brand, dish=dish, compatibility_score=p["score"],
                                           pairing_type=p["type"], explanation=p["explanation"])
                pairs += 1
        self.stdout.write(f"  ✓ кураторские пары: {pairs}")

        # 5. курсы и команда
        for c in _load("courses.json"):
            Course.objects.update_or_create(level=c["level"], defaults={
                "title": c["title"], "description": c["description"], "color": c["color"],
                "required_score": c.get("xp_required", 0)})
        TeamMember.objects.all().delete()
        for t in _load("team.json"):
            TeamMember.objects.create(name=t["name"], role=t["role"], bio=t["bio"], avatar=t.get("avatar", ""))
        self.stdout.write("  ✓ курсы и команда")

        # 6. заведения + QR-столы
        for v in _load("venues.json"):
            venue, _ = Venue.objects.update_or_create(slug=v["id"], defaults={
                "name": v["name"], "address": v.get("address", ""), "venue_type": v.get("venue_type", "BAR"),
                "city": v.get("city", ""), "description": v.get("description", ""), "is_active": True})
            venue.brands.set([brand_by_slug[s] for s in v.get("brands", []) if s in brand_by_slug])
            venue.menu_dishes.set([dish_by_slug[s] for s in v.get("menu", []) if s in dish_by_slug])
            for t in range(1, int(v.get("tables", 0)) + 1):
                QRCode.objects.update_or_create(unique_token=f"{v['token_prefix']}-{t:02d}",
                                                defaults={"venue": venue, "table_number": t})
        self.stdout.write(f"  ✓ заведения: {Venue.objects.count()}, QR-столов: {QRCode.objects.count()}")
        self.stdout.write(self.style.SUCCESS("✅ Данные Flavor Tree загружены"))

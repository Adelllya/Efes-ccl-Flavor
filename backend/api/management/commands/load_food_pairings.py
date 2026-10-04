"""
Management command: python manage.py load_food_pairings
Загружает матрицу фуд-пейрингов (51 пару) из fixtures/food_pairings.csv

Пары из файла создаются или обновляются; пары, которых в файле нет (добавленные
сомелье в панели или подобранные ИИ), остаются. Стереть всё и залить заново: --replace.
"""

import csv
from pathlib import Path
from django.core.management.base import BaseCommand
from django.db import transaction
from api.models import Brand, Dish, FoodPairing


class Command(BaseCommand):
    help = "Загружает 51 пару food pairing из fixtures/food_pairings.csv"

    def add_arguments(self, parser):
        parser.add_argument("--replace", action="store_true",
                            help="Удалить все пары перед загрузкой, включая добавленные в панели")

    @transaction.atomic
    def handle(self, *args, **options):
        csv_path = Path(__file__).resolve().parent.parent.parent / "fixtures" / "food_pairings.csv"
        
        if not csv_path.exists():
            self.stderr.write(f"Файл {csv_path} не найден!")
            return

        if options.get("replace"):
            FoodPairing.objects.all().delete()

        loaded_count = 0
        skipped = []

        with open(csv_path, encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                brand_name = row["brand_name"].strip()
                dish_name = row["dish_name"].strip()
                score = int(row.get("compatibility_score", 4))
                pairing_type = row.get("pairing_type", "COMPLEMENT").strip().upper()
                explanation = row.get("explanation", "").strip()

                brand = Brand.objects.filter(name__iexact=brand_name).first()
                if not brand:
                    brand = Brand.objects.filter(name__icontains=brand_name).first()

                dish = Dish.objects.filter(name__iexact=dish_name).first()
                if not dish:
                    dish = Dish.objects.filter(name__icontains=dish_name).first()

                if not brand or not dish:
                    skipped.append(f"Пропущено: {brand_name} + {dish_name} (brand: {bool(brand)}, dish: {bool(dish)})")
                    continue

                # filter().first(), а не update_or_create: в старых данных одна пара может быть записана дважды.
                pairing = FoodPairing.objects.filter(brand=brand, dish=dish).order_by("id").first()
                if pairing is None:
                    pairing = FoodPairing(brand=brand, dish=dish)
                pairing.compatibility_score = score
                pairing.pairing_type = pairing_type
                pairing.explanation = explanation
                pairing.source = FoodPairing.SOURCE_SOMMELIER
                pairing.save()
                loaded_count += 1

        for msg in skipped:
            self.stdout.write(self.style.WARNING(msg))

        self.stdout.write(self.style.SUCCESS(f"✅ Успешно загружено {loaded_count} пар Food Pairing!"))

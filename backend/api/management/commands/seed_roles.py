"""
python manage.py seed_roles [--reset-passwords]

Группы ролей, демо-пользователи, демо-заведение с меню и два запроса сомелье
для модератора. Команду можно запускать повторно.

Пароль ставится только новой учётке (или всем с --reset-passwords). Публичные пароли
из DEMO_USERS работают только на своей машине; на сервере пароль берётся из
FT_PASSWORD_MODERATOR, FT_PASSWORD_SOMMELIER, FT_PASSWORD_RESTAURANT, FT_PASSWORD_GUEST,
а без переменной вход по паролю закрыт (см. api/demo_accounts.py и rotate_demo_passwords).
"""
from decimal import Decimal

from django.contrib.auth.models import Group, User
from django.core.management.base import BaseCommand

from api import public_content
from api.demo_accounts import apply_password, env_name, initial_password
from api.engine_catalog import engine_drink
from api.models import Brand, ChangeRequest, Dish, MenuDrink, MenuItem, ServingRecommendation, Venue
from api.permissions import GROUP_ROLES, ROLE_MODERATOR, ROLE_RESTAURANT, ROLE_SOMMELIER

DEMO_USERS = [
    # username, пароль, роль, is_staff, имя
    ('moderator', 'moderator12345', ROLE_MODERATOR, True, 'Модератор'),
    ('sommelier', 'sommelier12345', ROLE_SOMMELIER, False, 'Сомелье'),
    ('restaurant', 'restaurant12345', ROLE_RESTAURANT, False, public_content.DEMO_VENUE_NAME),
    ('guest', 'guest12345', None, False, 'Гость'),
]

# Демо без выдуманных адреса и телефона: в меню гостя пустые поля не показываются.
# Slug прежний, на него ссылаются тесты и старые QR.
DEMO_VENUE = {
    'slug': public_content.DEMO_VENUE_SLUG,
    'name': public_content.DEMO_VENUE_NAME,
    'venue_type': 'RESTAURANT',
    'city': 'Алматы',
    'address': '',
    'phone': '',
    'working_hours': '12:00-02:00',
    'description': public_content.DEMO_VENUE_DESCRIPTION,
    'is_published': True,
    'tables_count': 24,
}

# Порядок разделов в меню гостя: минимальный sort_order раздела задаёт его место. Горячее первым.
SECTION_BASE = {'Горячее': 0, 'Гриль': 10, 'Закуски': 20, 'Десерты': 30}

# Карта напитков демо-бара: варианты названия сорта для поиска, цена в тенге, порядок.
# Сорта, которых нет в каталоге, пропускаются.
DEMO_DRINKS = [
    (('Efes Pilsener',), 1200, 0),
    (('Бочковое',), 1300, 1),
    (('Кружка Свежего',), 1500, 2),
    (('Жигулевское', 'Жигулёвское'), 1400, 3),
    (('Velkopopovický Kozel', 'Kozel'), 2200, 4),
    (('Хмельной Лось',), 1900, 5),
]
DRINK_VOLUME = '0,5 л'

# Напитки из базы подбора (412 напитков), которых нет среди сортов каталога: id движка, цена, объём, порядок.
# Без безалкогольных позиций ИИ-сомелье в баре нечего предложить водителю или гостю младше 21 года,
# а тёмный лагер нужен десертам. Напитки, которых нет в базе подбора, пропускаются.
DEMO_ENGINE_DRINKS = [
    ('efes-0-0', 1000, '0,5 л', 6),
    ('kruzhka-svezhego-0-0', 1000, '0,5 л', 7),
    ('velkopopovicky-kozel-cerny', 2200, '0,5 л', 8),
    ('chay-chernyy', 900, 'чайник', 9),
    ('espresso-amerikano', 800, '30 мл', 10),
]

# Варианты названия для поиска, раздел, цена в тенге, порция, порядок внутри раздела, комментарий повара.
# Блюда, которых нет в каталоге, пропускаются.
DEMO_MENU = [
    (('Самса',), 'Закуски', 1500, '2 шт', 0, ''),
    (('Наггетсы',), 'Закуски', 2200, '200 г', 1, ''),
    (('Крылышки', 'крылышки'), 'Закуски', 2900, '300 г', 2, 'Соус на выбор'),
    (('Салат Цезарь', 'Цезарь'), 'Закуски', 2800, '250 г', 3, ''),
    (('Начос',), 'Закуски', 2400, '250 г', 4, ''),
    (('Брускетта',), 'Закуски', 1900, '3 шт', 5, ''),
    (('Бешбармак',), 'Горячее', 4500, '400 г', 0, 'Готовим на бульоне из конины'),
    (('Манты',), 'Горячее', 2600, '5 шт', 1, ''),
    (('Куырдак',), 'Горячее', 3200, '300 г', 2, ''),
    (('Хачапури',), 'Горячее', 2700, '350 г', 3, ''),
    (('Пицца',), 'Горячее', 3900, '30 см', 4, ''),
    (('Бургер',), 'Горячее', 3400, '350 г', 5, ''),
    (('Суши (нигири)', 'Суши'), 'Горячее', 4200, '8 шт', 6, ''),
    (('Шашлык',), 'Гриль', 4800, '300 г', 0, 'Баранина на углях'),
    (('Казы',), 'Гриль', 5200, '200 г', 1, ''),
    (('Рёбрышки BBQ', 'Рёбрышки'), 'Гриль', 5600, '400 г', 2, ''),
    (('Чизкейк',), 'Десерты', 1900, '150 г', 0, ''),
    (('Тирамису',), 'Десерты', 2100, '150 г', 1, ''),
    (('Штрудель',), 'Десерты', 1800, '180 г', 2, ''),
]


def find_by_name(queryset, names):
    for name in names:
        obj = queryset.filter(name__icontains=name).first()
        if obj:
            return obj
    # В базе с C-локалью icontains не учитывает регистр кириллицы, поэтому ищем ещё и в Python.
    lowered = [n.lower() for n in names]
    for obj in queryset.all():
        if any(n in obj.name.lower() for n in lowered):
            return obj
    return None


def find_dish(names):
    return find_by_name(Dish.objects, names)


def find_brand(names):
    return find_by_name(Brand.objects, names)


class Command(BaseCommand):
    help = 'Создаёт группы ролей, демо-пользователей и демо-заведение с меню (идемпотентно)'

    def add_arguments(self, parser):
        parser.add_argument('--reset-passwords', action='store_true',
                            help='Заново задать пароли уже существующим демо-учёткам')

    def handle(self, *args, **options):
        groups = {}
        for name in GROUP_ROLES:
            group, created = Group.objects.get_or_create(name=name)
            groups[name] = group
            self.stdout.write(('Группа создана: ' if created else 'Группа есть: ') + name)

        users = {}
        for username, password, role, is_staff, first_name in DEMO_USERS:
            user, created = User.objects.get_or_create(
                username=username,
                defaults={'email': username + '@flavortree.kz', 'first_name': first_name},
            )
            # Пароль и is_active трогаем только у новой учётки: повторный запуск на сервере
            # не должен вернуть публичный пароль или включить отключённый аккаунт.
            if created or options.get('reset_passwords'):
                new_password = initial_password(username, password)
                apply_password(user, new_password)
                user.is_active = True
                if new_password == password:
                    shown = password
                elif new_password:
                    shown = 'пароль из ' + env_name(username)
                else:
                    shown = 'вход закрыт, задайте ' + env_name(username)
            else:
                shown = 'пароль не менялся'
            user.is_staff = is_staff
            user.save()
            user.groups.remove(*groups.values())
            if role:
                user.groups.add(groups[role])
            users[username] = user
            label = 'создан' if created else 'обновлён'
            self.stdout.write(f'Пользователь {label}: {username} / {shown} ({role or "user"})')

        # Суперпользователь и так модератор, но членство в группе не помешает.
        for admin in User.objects.filter(is_superuser=True):
            admin.groups.add(groups[ROLE_MODERATOR])

        venue, created = Venue.objects.update_or_create(
            slug=DEMO_VENUE['slug'],
            defaults=dict(DEMO_VENUE, owner=users['restaurant']),
        )
        self.stdout.write(('Заведение создано: ' if created else 'Заведение обновлено: ') + venue.name)

        added = updated = skipped = 0
        for names, section, price, portion, sort_order, chef_note in DEMO_MENU:
            dish = find_dish(names)
            if dish is None:
                skipped += 1
                self.stdout.write(f'  пропущено, нет блюда: {names[0]}')
                continue
            _, item_created = MenuItem.objects.update_or_create(
                venue=venue, dish=dish,
                defaults={
                    'price': Decimal(price),
                    'section': section,
                    'portion': portion,
                    'sort_order': SECTION_BASE.get(section, 0) + sort_order,
                    'chef_note': chef_note,
                    'is_available': True,
                },
            )
            if item_created:
                added += 1
            else:
                updated += 1
            self.stdout.write(f'  {section}: {dish.name} - {price} тг')

        self.stdout.write(self.style.SUCCESS(
            f'Меню: добавлено {added}, обновлено {updated}, пропущено {skipped}. '
            f'Всего позиций: {venue.menu_items.count()}'
        ))

        self.seed_drinks(venue)
        self.seed_change_requests(users['sommelier'])

    def seed_drinks(self, venue):
        """Карта напитков демо-бара из сортов каталога."""
        added = updated = skipped = 0
        for names, price, sort_order in DEMO_DRINKS:
            brand = find_brand(names)
            if brand is None:
                skipped += 1
                self.stdout.write(f'  пропущено, нет сорта: {names[0]}')
                continue
            _, created = MenuDrink.objects.update_or_create(
                venue=venue, brand=brand,
                defaults={
                    'price': Decimal(price),
                    'volume': DRINK_VOLUME,
                    'sort_order': sort_order,
                    'is_available': True,
                },
            )
            if created:
                added += 1
            else:
                updated += 1
            self.stdout.write(f'  напиток: {brand.name} - {price} тг, {DRINK_VOLUME}')
        for drink_id, price, volume, sort_order in DEMO_ENGINE_DRINKS:
            raw = engine_drink(drink_id)
            if raw is None:
                skipped += 1
                self.stdout.write(f'  пропущено, нет в базе подбора: {drink_id}')
                continue
            _, created = MenuDrink.objects.update_or_create(
                venue=venue, engine_drink_id=drink_id,
                defaults={
                    'name': raw.get('name') or drink_id,
                    'price': Decimal(price),
                    'volume': volume,
                    'sort_order': sort_order,
                    'is_available': True,
                },
            )
            if created:
                added += 1
            else:
                updated += 1
            self.stdout.write(f'  напиток базы подбора: {raw.get("name")} - {price} тг, {volume}')
        self.stdout.write(self.style.SUCCESS(
            f'Напитки: добавлено {added}, обновлено {updated}, пропущено {skipped}. '
            f'Всего в карте: {venue.menu_drinks.count()}'
        ))

    def seed_change_requests(self, sommelier):
        """Два ожидающих запроса от сомелье, чтобы модератору было что подтверждать."""
        brand = (
            Brand.objects.filter(is_active=True, flavor_profiles__isnull=False)
            .distinct().order_by('name').first()
        )
        if brand is None:
            self.stdout.write('Запросы сомелье пропущены: нет сорта с пирамидой')
            return

        def pending_exists(kind):
            return ChangeRequest.objects.filter(
                author=sommelier, brand=brand, kind=kind, status=ChangeRequest.STATUS_PENDING,
            ).exists()

        profile = brand.flavor_profiles.select_related('flavor_note').order_by('-intensity').first()
        if pending_exists(ChangeRequest.KIND_NOTE_UPSERT):
            self.stdout.write(f'Запрос сомелье уже ждёт: {brand.name}, нота {profile.flavor_note.name}')
        else:
            intensity = profile.intensity + 2 if profile.intensity <= 8 else profile.intensity - 2
            ChangeRequest.objects.create(
                author=sommelier, brand=brand, kind=ChangeRequest.KIND_NOTE_UPSERT,
                payload={
                    'flavor_note_id': str(profile.flavor_note_id),
                    'layer': profile.layer,
                    'intensity': intensity,
                    'sommelier_note': 'В свежей партии нота читается заметно ярче.',
                },
                comment='Продегустировал новую партию: предлагаю поправить интенсивность.',
            )
            self.stdout.write(
                f'Запрос сомелье создан: {brand.name}, нота {profile.flavor_note.name} '
                f'{profile.intensity} -> {intensity}'
            )

        if pending_exists(ChangeRequest.KIND_SERVING):
            self.stdout.write(f'Запрос сомелье уже ждёт: {brand.name}, подача')
        else:
            rec = ServingRecommendation.objects.filter(brand=brand).first()
            if rec is not None:
                payload = {
                    'serving_temp_min': max(0.0, rec.serving_temp_min - 1),
                    'serving_temp_max': max(1.0, rec.serving_temp_max - 1),
                    'glass_type': rec.glass_type,
                    'seasonality': 'Лето',
                }
            else:
                payload = {'serving_temp_min': 4, 'serving_temp_max': 6, 'glass_type': 'Пилснер', 'seasonality': 'Лето'}
            ChangeRequest.objects.create(
                author=sommelier, brand=brand, kind=ChangeRequest.KIND_SERVING,
                payload=payload,
                comment='Летом гости просят холоднее: предлагаю подавать на градус ниже.',
            )
            self.stdout.write(
                f'Запрос сомелье создан: {brand.name}, подача '
                f'{payload["serving_temp_min"]}-{payload["serving_temp_max"]} °C'
            )

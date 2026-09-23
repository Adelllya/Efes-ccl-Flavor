import uuid
from django.db import models


class FlavorNote(models.Model):
    """Вкусовая нота — базовый элемент вкусовой пирамиды (по стандарту FlavorActiV)."""

    CATEGORY_CHOICES = [
        ('TOP', 'Верхние ноты'),
        ('HEART', 'Ноты сердца'),
        ('BASE', 'Базовые ноты'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField('Название', max_length=100)
    technical_term = models.CharField('Техническое название', max_length=100, blank=True, default='')
    wheel_code = models.CharField('Код колеса вкусов', max_length=10, blank=True, default='')
    category = models.CharField('Категория', max_length=10, choices=CATEGORY_CHOICES)
    description = models.TextField('Описание')
    icon = models.CharField('Иконка (emoji)', max_length=10)
    image = models.ImageField(
        'Фото вкуса', upload_to='flavor_notes/', null=True, blank=True, max_length=500,
        help_text='Картинка ингредиента на прозрачном фоне: ромашка, колос, шишка хмеля, сота мёда. '
                  'Показывается вокруг бутылки на странице сорта. Если пусто — берётся emoji.')
    reference_material = models.CharField('Эталонный материал', max_length=200, blank=True, default='')
    is_off_flavour = models.BooleanField('Off-flavour (дефект)', default=False)
    sort_order = models.IntegerField('Порядок сортировки', default=0)
    # ── Flavor Tree v2 ──
    slug = models.SlugField('Slug', max_length=80, unique=True, null=True, blank=True)
    axes = models.JSONField('Сенсорные оси (axis → вес 0..1)', default=dict, blank=True,
                            help_text='Как нота влияет на вектор пива: {"bitter": 0.9}')
    tags = models.JSONField('Ароматические теги (мосты к еде)', default=list, blank=True)
    created_at = models.DateTimeField('Создано', auto_now_add=True)

    class Meta:
        verbose_name = 'Вкусовая нота'
        verbose_name_plural = 'Вкусовые ноты'
        ordering = ['sort_order', 'category', 'name']

    def __str__(self):
        return f'{self.icon} {self.name} ({self.get_category_display()})'


class Brand(models.Model):
    """Бренд пива — основная сущность каталога."""

    PACKAGING_CHOICES = [
        ('BOTTLE', 'Бутылка'),
        ('CAN', 'Банка'),
        ('DRAFT', 'Разливное'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField('Название', max_length=200)
    brand_owner = models.CharField('Владелец бренда', max_length=100, blank=True, default='')
    style = models.CharField('Стиль', max_length=100)
    abv = models.FloatField('Алкоголь %', null=True, blank=True)
    density = models.CharField('Плотность', max_length=100, blank=True, default='')
    fermentation_type = models.CharField('Тип брожения', max_length=100, blank=True, default='')
    packaging_type = models.CharField('Тип упаковки', max_length=10, choices=PACKAGING_CHOICES, default='BOTTLE')
    is_horeca_only = models.BooleanField('Только HoReCa', default=False,
                                         help_text='Доступно только в заведениях HoReCa (обычно = True для разливного)')
    description = models.TextField('Описание', blank=True, default='')
    image = models.ImageField(
        'Изображение / Бутылка', upload_to='brands/', null=True, blank=True, max_length=500,
        help_text='Лёгкий файл для мелких мест: карточки каталога, список альтернатив, значок в подборе.')
    image_hd = models.ImageField(
        'Фото в высоком качестве', upload_to='brands/hd/', null=True, blank=True, max_length=500,
        help_text='Крупная версия для страницы сорта и большой карточки подбора. '
                  'Если пусто — там показывается обычное изображение.')
    accent_color = models.CharField(
        'Цвет страницы', max_length=9, blank=True, default='',
        help_text='HEX вида #F5A623. Задаёт фон страницы сорта и подложку под бутылкой. '
                  'Если пусто — берётся цвет темы сайта.')
    tagline = models.CharField(
        'Слоган', max_length=200, blank=True, default='',
        help_text='Одна строка над названием на странице сорта, например «Классика пильзнера».')
    is_active = models.BooleanField('В наличии', default=True)
    # ── Flavor Tree v2 ──
    slug = models.SlugField('Slug', max_length=80, unique=True, null=True, blank=True)
    display_name = models.CharField('Отображаемое имя', max_length=200, blank=True, default='')
    style_family = models.CharField('Семейство стиля (приор движка)', max_length=30, default='LAGER',
                                    help_text='PILSNER / LAGER / CZECH_LAGER / AMBER_LAGER / STRONG_LAGER / RICE_LAGER …')
    abv_estimated = models.BooleanField('ABV оценочный — уточнить', default=False)
    origin = models.CharField('Происхождение', max_length=200, blank=True, default='')
    accent = models.CharField('Акцентный цвет (hex)', max_length=9, blank=True, default='')
    vector_override = models.JSONField('Ручной сенсорный вектор (override движка)', default=dict, blank=True)
    created_at = models.DateTimeField('Создано', auto_now_add=True)

    class Meta:
        verbose_name = 'Бренд'
        verbose_name_plural = 'Бренды'
        ordering = ['-created_at']

    def save(self, *args, **kwargs):
        if self.packaging_type == 'DRAFT' and not self.is_horeca_only:
            self.is_horeca_only = True
        super().save(*args, **kwargs)

    def __str__(self):
        abv_str = f'{self.abv}%' if self.abv is not None else 'N/A'
        return f'{self.name} ({self.style}, {abv_str}, {self.get_packaging_type_display()})'


class FlavorProfile(models.Model):
    """Связь Brand ↔ FlavorNote с интенсивностью и комментарием сомелье."""

    LAYER_CHOICES = [
        ('TOP', 'Верхние ноты'),
        ('HEART', 'Ноты сердца'),
        ('BASE', 'Базовые ноты'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    brand = models.ForeignKey(Brand, on_delete=models.CASCADE, related_name='flavor_profiles',
                              verbose_name='Бренд')
    flavor_note = models.ForeignKey(FlavorNote, on_delete=models.CASCADE, related_name='flavor_profiles',
                                    verbose_name='Вкусовая нота')
    layer = models.CharField('Слой пирамиды', max_length=10, choices=LAYER_CHOICES)
    intensity = models.IntegerField('Интенсивность (1-10)')
    sommelier_note = models.TextField('Комментарий сомелье', blank=True, default='')
    sommelier_name = models.CharField('Имя сомелье', max_length=150, blank=True, default='')
    updated_at = models.DateTimeField('Обновлено', auto_now=True)

    class Meta:
        verbose_name = 'Вкусовой профиль'
        verbose_name_plural = 'Вкусовые профили'
        unique_together = ['brand', 'flavor_note']
        ordering = ['-intensity']

    def __str__(self):
        return f'{self.brand.name} → {self.flavor_note.name} ({self.layer}, {self.intensity}/10)'


class ServingRecommendation(models.Model):
    """Рекомендации по подаче пива (OneToOne к Brand)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    brand = models.OneToOneField(Brand, on_delete=models.CASCADE, related_name='serving_recommendation',
                                 verbose_name='Бренд')
    serving_temp_min = models.FloatField('Т° мин, °C')
    serving_temp_max = models.FloatField('Т° макс, °C')
    glass_type = models.CharField('Тип бокала', max_length=100)
    seasonality = models.CharField('Сезонность', max_length=100, blank=True, default='')

    class Meta:
        verbose_name = 'Рекомендация по подаче'
        verbose_name_plural = 'Рекомендации по подаче'

    def __str__(self):
        return f'{self.brand.name}: {self.serving_temp_min}–{self.serving_temp_max}°C, {self.glass_type}'


class Course(models.Model):
    """Уровень обучения в Школе Пивных Сомелье."""

    LEVEL_CHOICES = [
        (1, 'Новичок'),
        (2, 'Исследователь'),
        (3, 'Знаток'),
        (4, 'Сомелье'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    level = models.IntegerField('Уровень', choices=LEVEL_CHOICES, unique=True)
    title = models.CharField('Название', max_length=200)
    description = models.TextField('Описание')
    color = models.CharField('Цвет (hex)', max_length=20, default='#F7941D')
    required_score = models.IntegerField('Необходимый балл', default=0)

    class Meta:
        verbose_name = 'Курс'
        verbose_name_plural = 'Курсы'
        ordering = ['level']

    def __str__(self):
        return f'Уровень {self.level}: {self.title}'


class TeamMember(models.Model):
    """Член команды Flavor Tree."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField('Имя', max_length=150)
    role = models.CharField('Роль', max_length=150)
    bio = models.TextField('Биография')
    avatar = models.URLField('Аватар', max_length=500, blank=True, default='')

    class Meta:
        verbose_name = 'Член команды'
        verbose_name_plural = 'Команда'
        ordering = ['name']

    def __str__(self):
        return f'{self.name} — {self.role}'


class Dish(models.Model):
    """Блюдо для food-pairing с классификацией под алгоритм подбора пива."""

    CUISINE_CHOICES = [
        ('KZ', 'Казахская'),
        ('ITALIAN', 'Итальянская'),
        ('JAPANESE', 'Японская'),
        ('AMERICAN', 'Американская'),
        ('MEXICAN', 'Мексиканская'),
        ('GERMAN', 'Немецкая'),
        ('OTHER', 'Другая'),
    ]

    TASTE_CHOICES = [
        ('SALTY', 'Солёное'),
        ('SWEET', 'Сладкое'),
        ('SOUR', 'Кислое'),
        ('BITTER', 'Горькое'),
        ('UMAMI', 'Умами'),
        ('SPICY', 'Острое'),
        ('MIXED', 'Микс'),
    ]

    WEIGHT_CHOICES = [
        ('LIGHT', 'Лёгкое'),
        ('MEDIUM', 'Среднее'),
        ('HEAVY', 'Тяжёлое'),
    ]

    FAT_CHOICES = [
        ('LOW', 'Низкая'),
        ('MEDIUM', 'Средняя'),
        ('HIGH', 'Высокая'),
    ]

    COOKING_METHOD_CHOICES = [
        ('FRIED', 'Жарка'),
        ('GRILLED', 'Гриль'),
        ('BAKED', 'Запекание'),
        ('BOILED', 'Варка'),
        ('STEAMED', 'На пару'),
        ('RAW', 'Сырое'),
        ('CURED', 'Вяленое'),
        ('FERMENTED', 'Ферментация'),
        ('OTHER', 'Без термообработки / Другое'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField('Название', max_length=200)
    cuisine = models.CharField('Кухня', max_length=20, choices=CUISINE_CHOICES)
    category = models.CharField('Категория', max_length=100, blank=True, default='Основное')
    dominant_taste = models.CharField('Доминирующий вкус', max_length=10, choices=TASTE_CHOICES, default='UMAMI')
    weight = models.CharField('Вес блюда', max_length=10, choices=WEIGHT_CHOICES, default='MEDIUM')
    fat_level = models.CharField('Жирность', max_length=10, choices=FAT_CHOICES, default='MEDIUM')
    cooking_method = models.CharField('Способ приготовления', max_length=20, choices=COOKING_METHOD_CHOICES, default='GRILLED')
    description = models.TextField('Описание', blank=True, default='')
    image = models.URLField('Изображение', max_length=500, blank=True, default='')
    # ── Flavor Tree v2 ──
    slug = models.SlugField('Slug', max_length=80, unique=True, null=True, blank=True)
    display_name = models.CharField('Отображаемое имя', max_length=200, blank=True, default='')
    emoji = models.CharField('Эмодзи', max_length=8, blank=True, default='')
    vector = models.JSONField('Сенсорный вектор блюда (0..1)', default=dict, blank=True)
    tags = models.JSONField('Ароматические теги', default=list, blank=True)
    synonyms = models.JSONField('Синонимы для поиска', default=list, blank=True)

    class Meta:
        verbose_name = 'Блюдо'
        verbose_name_plural = 'Блюда'
        ordering = ['cuisine', 'name']

    def __str__(self):
        return f'{self.name} ({self.get_cuisine_display()}, {self.get_dominant_taste_display()})'


class FoodPairing(models.Model):
    """Пара блюдо ↔ пиво с оценкой совместимости."""

    PAIRING_TYPE_CHOICES = [
        ('COMPLEMENT', 'Дополняет (Complement)'),
        ('CONTRAST', 'Контрастирует (Contrast)'),
        ('CLEANSE', 'Очищает (Cleanse)'),
        ('BRIDGE', 'Мостик (Bridge)'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    brand = models.ForeignKey(Brand, on_delete=models.CASCADE, related_name='food_pairings',
                              verbose_name='Бренд')
    dish = models.ForeignKey(Dish, on_delete=models.CASCADE, related_name='food_pairings',
                             verbose_name='Блюдо')
    compatibility_score = models.IntegerField('Совместимость (оценка 1-5 или %)')
    pairing_type = models.CharField('Тип пары', max_length=20, choices=PAIRING_TYPE_CHOICES)
    explanation = models.TextField('Обоснование')

    class Meta:
        verbose_name = 'Food Pairing'
        verbose_name_plural = 'Food Pairings'
        ordering = ['-compatibility_score']

    def __str__(self):
        return f'{self.brand.name} + {self.dish.name} ({self.compatibility_score}%)'


class Venue(models.Model):
    """Заведение (бар, ресторан, паб)."""

    VENUE_TYPE_CHOICES = [
        ('BAR', 'Бар'),
        ('RESTAURANT', 'Ресторан'),
        ('PUB', 'Паб'),
        ('CAFE', 'Кафе'),
        ('OTHER', 'Другое'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField('Название', max_length=200)
    address = models.CharField('Адрес', max_length=300)
    venue_type = models.CharField('Тип заведения', max_length=50, choices=VENUE_TYPE_CHOICES)
    logo = models.URLField('Логотип', max_length=500, blank=True, default='')
    # ── Flavor Tree v2 (HoReCa) ──
    slug = models.SlugField('Slug', max_length=80, unique=True, null=True, blank=True)
    city = models.CharField('Город', max_length=100, blank=True, default='')
    description = models.TextField('Описание', blank=True, default='')
    is_active = models.BooleanField('Активно', default=True)
    brands = models.ManyToManyField(Brand, blank=True, related_name='venues', verbose_name='Сорта в наличии')
    menu_dishes = models.ManyToManyField(Dish, blank=True, related_name='venues', verbose_name='Блюда меню')
    # ── SaaS: брендинг страницы заведения (что видит гость после скана QR) ──
    accent = models.CharField('Акцентный цвет (hex)', max_length=9, blank=True, default='')
    cover_url = models.URLField('Обложка меню', max_length=500, blank=True, default='')
    phone = models.CharField('Телефон', max_length=40, blank=True, default='')
    instagram = models.CharField('Instagram', max_length=120, blank=True, default='')
    wifi_password = models.CharField('Пароль Wi-Fi (показать гостю)', max_length=80, blank=True, default='')
    menu_headline = models.CharField('Заголовок меню', max_length=200, blank=True, default='',
                                     help_text='Например: «Что взять к вашему блюду?»')
    currency = models.CharField('Валюта', max_length=8, default='₸')
    updated_at = models.DateTimeField('Обновлено', auto_now=True, null=True)

    class Meta:
        verbose_name = 'Заведение'
        verbose_name_plural = 'Заведения'
        ordering = ['name']

    def __str__(self):
        return f'{self.name} ({self.get_venue_type_display()})'


class QRCode(models.Model):
    """QR-код привязанный к столику заведения."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    venue = models.ForeignKey(Venue, on_delete=models.CASCADE, related_name='qrcodes',
                              verbose_name='Заведение')
    table_number = models.IntegerField('Номер столика')
    unique_token = models.CharField('Уникальный токен', max_length=64, unique=True)
    scans_count = models.IntegerField('Количество сканирований', default=0)
    label = models.CharField('Метка (Стол 5 / Терраса)', max_length=80, blank=True, default='')
    is_active = models.BooleanField('Активен', default=True)
    last_scan_at = models.DateTimeField('Последний скан', null=True, blank=True)

    class Meta:
        verbose_name = 'QR-код'
        verbose_name_plural = 'QR-коды'
        ordering = ['venue', 'table_number']

    def __str__(self):
        return f'{self.venue.name} — стол {self.table_number}'


class AnonymousSession(models.Model):
    """Анонимная сессия пользователя (без регистрации)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    qr_code = models.ForeignKey(QRCode, on_delete=models.SET_NULL, null=True, blank=True,
                                related_name='sessions', verbose_name='QR-код')
    completed_levels = models.IntegerField('Пройдено уровней', default=0)
    score = models.IntegerField('Баллы', default=0)
    preferences = models.JSONField('Предпочтения', default=dict, blank=True)
    created_at = models.DateTimeField('Создано', auto_now_add=True)

    class Meta:
        verbose_name = 'Анонимная сессия'
        verbose_name_plural = 'Анонимные сессии'
        ordering = ['-created_at']

    def __str__(self):
        return f'Сессия {str(self.id)[:8]} (уровень {self.completed_levels}, {self.score} баллов)'


# ═══════════════════════════════════════════════════════════════════════════
#  Flavor Tree SaaS — платный слой для заведений (HoReCa self-serve)
#  Заведение платит за: своё QR-меню с их ценами, подбор из их карты,
#  стоп-лист в один клик и аналитику сканов. Ниже — всё, что это обслуживает.
# ═══════════════════════════════════════════════════════════════════════════

import secrets
from datetime import timedelta

from django.contrib.auth.hashers import check_password as _check_password, make_password
from django.utils import timezone


def _new_token() -> str:
    return secrets.token_urlsafe(30)


class VenueAccount(models.Model):
    """Аккаунт владельца заведения: вход в кабинет, тариф, срок подписки."""

    PLAN_CHOICES = [
        ('TRIAL', 'Пробный (14 дней)'),
        ('START', 'Старт'),
        ('PRO', 'Про'),
        ('NETWORK', 'Сеть'),
    ]
    # Лимиты тарифов: столы, позиции меню, аналитика в днях, свой брендинг
    PLAN_LIMITS = {
        'TRIAL': {'tables': 5, 'items': 40, 'history_days': 14, 'branding': False, 'price_kzt': 0},
        'START': {'tables': 15, 'items': 80, 'history_days': 60, 'branding': True, 'price_kzt': 14900},
        'PRO': {'tables': 60, 'items': 300, 'history_days': 365, 'branding': True, 'price_kzt': 34900},
        'NETWORK': {'tables': 10000, 'items': 10000, 'history_days': 1095, 'branding': True, 'price_kzt': 89000},
    }

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    venue = models.OneToOneField(Venue, on_delete=models.CASCADE, related_name='account', verbose_name='Заведение')
    email = models.EmailField('E-mail для входа', unique=True)
    password_hash = models.CharField('Пароль (хеш)', max_length=256, blank=True, default='')
    contact_name = models.CharField('Контактное лицо', max_length=150, blank=True, default='')
    phone = models.CharField('Телефон', max_length=40, blank=True, default='')

    plan = models.CharField('Тариф', max_length=10, choices=PLAN_CHOICES, default='TRIAL')
    trial_ends_at = models.DateTimeField('Пробный период до', null=True, blank=True)
    paid_until = models.DateTimeField('Оплачено до', null=True, blank=True)
    is_active = models.BooleanField('Активен', default=True)

    api_token = models.CharField('Токен API', max_length=64, unique=True, default=_new_token)
    created_at = models.DateTimeField('Создан', auto_now_add=True)
    last_login_at = models.DateTimeField('Последний вход', null=True, blank=True)

    class Meta:
        verbose_name = 'Аккаунт заведения'
        verbose_name_plural = 'Аккаунты заведений'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.email} → {self.venue.name} ({self.get_plan_display()})'

    # ── пароль ──
    def set_password(self, raw: str) -> None:
        self.password_hash = make_password(raw)

    def check_password(self, raw: str) -> bool:
        return bool(self.password_hash) and _check_password(raw, self.password_hash)

    def rotate_token(self) -> str:
        self.api_token = _new_token()
        self.save(update_fields=['api_token'])
        return self.api_token

    # ── подписка ──
    def save(self, *args, **kwargs):
        if not self.trial_ends_at and self.plan == 'TRIAL':
            self.trial_ends_at = timezone.now() + timedelta(days=14)
        super().save(*args, **kwargs)

    @property
    def limits(self) -> dict:
        return self.PLAN_LIMITS.get(self.plan, self.PLAN_LIMITS['TRIAL'])

    @property
    def active_until(self):
        return self.paid_until if self.plan != 'TRIAL' else self.trial_ends_at

    @property
    def days_left(self) -> int:
        until = self.active_until
        if not until:
            return 0
        return max(0, (until - timezone.now()).days)

    @property
    def subscription_ok(self) -> bool:
        until = self.active_until
        return bool(self.is_active and until and until > timezone.now())


class VenueMenuItem(models.Model):
    """Позиция карты заведения: ссылка на канонический сорт/блюдо + СВОЯ цена и наличие."""

    KIND_CHOICES = [('BEER', 'Пиво'), ('DISH', 'Блюдо')]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    venue = models.ForeignKey(Venue, on_delete=models.CASCADE, related_name='menu_items', verbose_name='Заведение')
    kind = models.CharField('Тип', max_length=8, choices=KIND_CHOICES)
    ref_slug = models.SlugField('Slug каталога (brand.slug / dish.slug)', max_length=80)

    custom_name = models.CharField('Своё название', max_length=200, blank=True, default='')
    custom_description = models.CharField('Своё описание', max_length=300, blank=True, default='')
    category = models.CharField('Раздел меню', max_length=80, blank=True, default='')
    price = models.DecimalField('Цена, ₸', max_digits=10, decimal_places=2, default=0)
    volume = models.CharField('Объём / выход', max_length=40, blank=True, default='',
                              help_text='0.5 л, 300 г — печатается рядом с ценой')
    is_available = models.BooleanField('В наличии (стоп-лист)', default=True)
    is_featured = models.BooleanField('Хит / рекомендуем', default=False)
    sort_order = models.IntegerField('Порядок', default=0)
    updated_at = models.DateTimeField('Обновлено', auto_now=True)

    class Meta:
        verbose_name = 'Позиция меню заведения'
        verbose_name_plural = 'Позиции меню заведений'
        unique_together = ['venue', 'kind', 'ref_slug']
        ordering = ['kind', 'sort_order', 'ref_slug']

    def __str__(self):
        return f'{self.venue.name} · {self.get_kind_display()} {self.ref_slug} — {self.price} ₸'


class ScanEvent(models.Model):
    """Скан QR на столе. Главная метрика ценности для владельца."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    venue = models.ForeignKey(Venue, on_delete=models.CASCADE, related_name='scan_events', verbose_name='Заведение')
    qrcode = models.ForeignKey(QRCode, on_delete=models.SET_NULL, null=True, blank=True, related_name='events')
    table_number = models.IntegerField('Стол', null=True, blank=True)
    session_key = models.CharField('Сессия гостя', max_length=64, blank=True, default='')
    user_agent = models.CharField('User-Agent', max_length=300, blank=True, default='')
    created_at = models.DateTimeField('Когда', auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = 'Скан QR'
        verbose_name_plural = 'Сканы QR'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.venue.name} · стол {self.table_number} · {self.created_at:%d.%m %H:%M}'


class MenuEvent(models.Model):
    """Что гость делал в меню: смотрел блюдо, получил подбор, нажал «хочу заказать»."""

    KIND_CHOICES = [
        ('DISH_VIEW', 'Открыл блюдо'),
        ('PAIR_VIEW', 'Увидел подбор'),
        ('BEER_VIEW', 'Открыл сорт'),
        ('ORDER_INTENT', 'Нажал «Заказать»'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    venue = models.ForeignKey(Venue, on_delete=models.CASCADE, related_name='menu_events', verbose_name='Заведение')
    kind = models.CharField('Событие', max_length=16, choices=KIND_CHOICES)
    dish_slug = models.SlugField('Блюдо', max_length=80, blank=True, default='')
    beer_slug = models.SlugField('Сорт', max_length=80, blank=True, default='')
    score = models.IntegerField('Оценка подбора', null=True, blank=True)
    price = models.DecimalField('Цена позиции, ₸', max_digits=10, decimal_places=2, default=0)
    table_number = models.IntegerField('Стол', null=True, blank=True)
    session_key = models.CharField('Сессия гостя', max_length=64, blank=True, default='')
    created_at = models.DateTimeField('Когда', auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = 'Событие меню'
        verbose_name_plural = 'События меню'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.venue.name} · {self.get_kind_display()} · {self.dish_slug}→{self.beer_slug}'


class Lead(models.Model):
    """Заявка с лендинга /business — воронка продаж."""

    STATUS_CHOICES = [
        ('NEW', 'Новая'),
        ('CONTACTED', 'Связались'),
        ('DEMO', 'Показали демо'),
        ('TRIAL', 'Запустили пробный'),
        ('WON', 'Оплатил'),
        ('LOST', 'Отказ'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    venue_name = models.CharField('Заведение', max_length=200)
    contact_name = models.CharField('Имя', max_length=150, blank=True, default='')
    phone = models.CharField('Телефон', max_length=40)
    email = models.EmailField('E-mail', blank=True, default='')
    city = models.CharField('Город', max_length=100, blank=True, default='')
    tables = models.IntegerField('Столов', null=True, blank=True)
    plan_interest = models.CharField('Интересующий тариф', max_length=20, blank=True, default='')
    comment = models.TextField('Комментарий', blank=True, default='')
    source = models.CharField('Источник', max_length=80, blank=True, default='landing')
    status = models.CharField('Статус', max_length=12, choices=STATUS_CHOICES, default='NEW')
    created_at = models.DateTimeField('Создана', auto_now_add=True)

    class Meta:
        verbose_name = 'Заявка'
        verbose_name_plural = 'Заявки (воронка)'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.venue_name} · {self.phone} · {self.get_status_display()}'


# ═══════════════════════════════════════════════════════════════════════════
#  Отзывы гостей о парах напиток × блюдо (docs/REVIEWS.md)
#  Одна запись = оценка одной сессии гостя одной паре. Сырых IP, имён, телефонов
#  не храним: IP и id сессии — только солёный HMAC (для лимитов и «одна оценка на пару»),
#  телефоны и e-mail в тексте маскируются до записи. Логика — api/reviews_logic.py.
# ═══════════════════════════════════════════════════════════════════════════

from django.core.validators import MaxValueValidator, MinValueValidator


class PairingReview(models.Model):
    """Отзыв гостя о паре: оценка 1–5, метки, необязательный текст, результат модерации и ИИ-разбора."""

    STATUS_CHOICES = [
        ('published', 'Опубликован'),
        ('pending', 'На проверке'),
        ('hidden', 'Скрыт модератором'),
        ('spam', 'Спам'),
    ]
    LOCALE_CHOICES = [('ru', 'Русский'), ('kk', 'Қазақша'), ('en', 'English')]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # ── что оценивали ──
    drink_id = models.CharField('Напиток (id в data/drinks.json)', max_length=80)
    dish_id = models.CharField('Блюдо (id в data/dishes_v2.json или custom)', max_length=80)
    dish_name = models.CharField('Название своего блюда (для custom)', max_length=120, blank=True, default='')
    dish_key = models.CharField('Ключ блюда: id или custom:<название>', max_length=130, editable=False,
                                help_text='Для «одна оценка на пару» и сводок по своему блюду')
    # ── что сказал гость ──
    rating = models.PositiveSmallIntegerField('Оценка 1–5', validators=[MinValueValidator(1), MaxValueValidator(5)])
    helpful = models.BooleanField('Подбор помог', null=True, blank=True)
    chips = models.JSONField('Метки (id из reviews_logic.REVIEW_CHIPS)', default=list, blank=True)
    text = models.TextField('Текст (≤ 1000, телефоны и e-mail скрыты)', max_length=1000, blank=True, default='')
    locale = models.CharField('Язык интерфейса гостя', max_length=5, choices=LOCALE_CHOICES, default='ru')
    # ── где и в каком контексте ──
    venue = models.ForeignKey(Venue, on_delete=models.SET_NULL, null=True, blank=True,
                              related_name='pairing_reviews', verbose_name='Заведение')
    table_number = models.IntegerField('Стол', null=True, blank=True)
    verified = models.BooleanField('Из заведения (была сессия QR)', default=False,
                                   help_text='В заведении был скан QR той же сессией за последние 12 ч — вес ×1.5 в сводках')
    session_hash = models.CharField('Сессия (HMAC)', max_length=64)
    ip_hash = models.CharField('IP (HMAC)', max_length=64)
    ua_short = models.CharField('Тип устройства', max_length=40, blank=True, default='')
    engine_version = models.CharField('Версия движка', max_length=20, blank=True, default='')
    calibration_version = models.CharField('Версия калибровки', max_length=40, blank=True, default='')
    score_shown = models.SmallIntegerField('Балл движка, который видел гость', null=True, blank=True)
    ctx = models.JSONField('Контекст подбора (повод, предпочтения)', default=dict, blank=True)
    # ── обработка ──
    status = models.CharField('Статус', max_length=10, choices=STATUS_CHOICES, default='published', db_index=True)
    heuristics = models.JSONField('Офлайн-эвристики текста', default=dict, blank=True)
    edit_count = models.PositiveSmallIntegerField('Правок текста с ИИ-разбором', default=0)
    moderated_at = models.DateTimeField('Решение модератора', null=True, blank=True)
    ai_sentiment = models.FloatField('ИИ: тональность −1..1', null=True, blank=True)
    ai_aspects = models.JSONField('ИИ: метки из текста', default=list, blank=True)
    ai_summary_ru = models.CharField('ИИ: пересказ', max_length=160, blank=True, default='')
    ai_flags = models.JSONField('ИИ: флаги (spam, toxic, offtopic, other_dish)', default=dict, blank=True)
    ai_model = models.CharField('ИИ: модель', max_length=60, blank=True, default='')
    ai_analyzed_at = models.DateTimeField('ИИ: когда разобран', null=True, blank=True)
    ai_error = models.CharField('ИИ: ошибка', max_length=200, blank=True, default='')
    created_at = models.DateTimeField('Создан', auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField('Изменён', auto_now=True)

    class Meta:
        verbose_name = 'Отзыв о паре'
        verbose_name_plural = 'Отзывы о парах'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['drink_id', 'dish_id'], name='review_pair_idx'),
            models.Index(fields=['ip_hash', 'updated_at'], name='review_ip_rate_idx'),
        ]
        constraints = [
            models.UniqueConstraint(fields=['session_hash', 'drink_id', 'dish_key'], name='review_one_per_session_pair'),
            models.CheckConstraint(check=models.Q(rating__gte=1) & models.Q(rating__lte=5), name='review_rating_1_5'),
        ]

    def __str__(self):
        dish = self.dish_name or self.dish_id
        return f'{self.drink_id} × {dish}: {self.rating}★ ({self.get_status_display()})'


# ═══════════════════════════════════════════════════════════════════════════
#  Аналитика бренда: что движок показал гостю и что гость сделал (docs/EFES_ANALYTICS.md)
#  Пишет только POST /api/v2/track/ (api/views_tracking.py) и seed_brand_demo (is_demo=True).
#  Категорию, архетип и признак Efes сервер берёт из data/drinks.json, клиенту не верит.
#  Сырых IP, имён, телефонов, e-mail нет: сессия и IP — только HMAC с солью из SECRET_KEY.
#  Наружу (GET /api/brand/overview/) уходят только агрегаты.
# ═══════════════════════════════════════════════════════════════════════════

class PairingImpression(models.Model):
    """Один напиток в показанном гостю списке рекомендаций. Список = все строки с одним list_id."""

    SOURCE_CHOICES = [('pair', 'Подбор на сайте'), ('venue_menu', 'Меню заведения'), ('ai', 'ИИ-сомелье')]

    list_id = models.UUIDField('Список (uuid клиента)')
    source = models.CharField('Где показан', max_length=12, choices=SOURCE_CHOICES)
    venue = models.ForeignKey(Venue, on_delete=models.SET_NULL, null=True, blank=True,
                              related_name='pairing_impressions', verbose_name='Заведение')
    table_number = models.IntegerField('Стол', null=True, blank=True)
    dish_id = models.CharField('Блюдо (id в dishes_v2 или custom)', max_length=80)
    tab = models.CharField('Вкладка (best, beer, na …)', max_length=12, blank=True, default='')
    occasion = models.CharField('Повод', max_length=20, blank=True, default='')
    locale = models.CharField('Язык', max_length=5, default='ru')
    rank = models.PositiveSmallIntegerField('Место в показанном списке')
    honest_rank = models.PositiveSmallIntegerField('Место по баллу: 1 + сколько в списке строго выше')
    drink_id = models.CharField('Напиток (id в drinks.json)', max_length=80)
    category = models.CharField('Категория (из drinks.json)', max_length=20)
    archetype = models.CharField('Архетип стиля (из drinks.json)', max_length=60, blank=True, default='')
    efes = models.BooleanField('Портфель Efes (из drinks.json)', default=False)
    score = models.PositiveSmallIntegerField('Балл движка')
    # Лучший не-Efes во всём пуле кандидатов (до окна и диверсификации): окно может вытеснить равного или более
    # сильного конкурента из короткого показанного списка, и без этого поля такой список сошёл бы за честную победу.
    pool_best_other = models.PositiveSmallIntegerField(
        'Лучший балл не-Efes во всём пуле кандидатов (0 — конкурентов в пуле нет, пусто — клиент не прислал)',
        null=True, blank=True)
    session_hash = models.CharField('Сессия (HMAC)', max_length=64)
    ip_hash = models.CharField('IP (HMAC)', max_length=64)
    engine_version = models.CharField('Версия движка', max_length=20, blank=True, default='')
    calibration_version = models.CharField('Версия калибровки', max_length=40, blank=True, default='')
    is_demo = models.BooleanField('Демо (seed_brand_demo)', default=False)
    created_at = models.DateTimeField('Когда', default=timezone.now, db_index=True)

    class Meta:
        verbose_name = 'Показ напитка в подборе'
        verbose_name_plural = 'Показы напитков в подборе'
        ordering = ['-created_at', 'list_id', 'rank']
        indexes = [
            models.Index(fields=['efes', 'rank'], name='impr_efes_rank_idx'),
            models.Index(fields=['dish_id'], name='impr_dish_idx'),
            models.Index(fields=['venue', 'created_at'], name='impr_venue_time_idx'),
            models.Index(fields=['is_demo', 'created_at'], name='impr_demo_time_idx'),
            models.Index(fields=['session_hash', 'created_at'], name='impr_session_rate_idx'),
            models.Index(fields=['ip_hash', 'created_at'], name='impr_ip_rate_idx'),
        ]
        constraints = [
            models.UniqueConstraint(fields=['list_id', 'drink_id'], name='impr_one_drink_per_list'),
        ]

    def __str__(self):
        return f'{self.dish_id} → #{self.rank} {self.drink_id} ({self.score})'


class PairingAction(models.Model):
    """Действие гостя со списком или карточкой: открыл напиток, раскрыл «почему», «Заказать», отзыв."""

    KIND_CHOICES = [
        ('open_drink', 'Открыл карточку напитка'),
        ('expand_why', 'Раскрыл «почему»'),
        ('order_intent', 'Нажал «Заказать»'),
        ('review', 'Оставил отзыв'),
    ]

    kind = models.CharField('Действие', max_length=16, choices=KIND_CHOICES)
    list_id = models.UUIDField('Список (uuid клиента)', null=True, blank=True)
    drink_id = models.CharField('Напиток (id в drinks.json)', max_length=80)
    dish_id = models.CharField('Блюдо (id в dishes_v2 или custom)', max_length=80, blank=True, default='')
    venue = models.ForeignKey(Venue, on_delete=models.SET_NULL, null=True, blank=True,
                              related_name='pairing_actions', verbose_name='Заведение')
    efes = models.BooleanField('Портфель Efes (из drinks.json)', default=False)
    price = models.DecimalField('Цена позиции, ₸', max_digits=10, decimal_places=2, null=True, blank=True)
    session_hash = models.CharField('Сессия (HMAC)', max_length=64)
    ip_hash = models.CharField('IP (HMAC)', max_length=64)
    is_demo = models.BooleanField('Демо (seed_brand_demo)', default=False)
    created_at = models.DateTimeField('Когда', default=timezone.now, db_index=True)

    class Meta:
        verbose_name = 'Действие гостя с подбором'
        verbose_name_plural = 'Действия гостей с подбором'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['kind', 'created_at'], name='action_kind_time_idx'),
            models.Index(fields=['venue', 'created_at'], name='action_venue_time_idx'),
            models.Index(fields=['is_demo', 'created_at'], name='action_demo_time_idx'),
            models.Index(fields=['session_hash', 'created_at'], name='action_session_rate_idx'),
            models.Index(fields=['ip_hash', 'created_at'], name='action_ip_rate_idx'),
        ]

    def __str__(self):
        return f'{self.get_kind_display()}: {self.drink_id} × {self.dish_id or "—"}'


class TrackingRate(models.Model):
    """Счётчик попыток POST /api/v2/track/ по минутам (api/views_tracking.py). Ключ — HMAC адреса (IPv6 — сети /64)
    или «global». Считаются присланные события, а не записанные: пустые, повторные и ошибочные запросы тоже тратят
    лимит. Строки старше часа удаляются при записи."""

    key = models.CharField('Ключ (HMAC адреса или global)', max_length=64)
    minute = models.DateTimeField('Минута')
    n = models.PositiveIntegerField('Событий', default=0)

    class Meta:
        verbose_name = 'Лимит трекинга (минута)'
        verbose_name_plural = 'Лимиты трекинга (минуты)'
        constraints = [models.UniqueConstraint(fields=['key', 'minute'], name='track_rate_key_minute')]
        indexes = [models.Index(fields=['minute'], name='track_rate_minute_idx')]

    def __str__(self):
        return f'{self.key[:12]} · {self.minute:%H:%M} · {self.n}'


class FoodIcon(models.Model):
    """
    Иллюстрация характеристики блюда: «жареное», «острое», «мясо».

    Нужна двум экранам. В мастере подбора она заменяет emoji на кружке,
    а на карточке пары становится вторым планом рядом с блюдом — тем самым
    «вкусом жареного», который объясняет пару лучше слов.

    Ключ должен совпадать с кодом из Dish: FRIED, SPICY, MEAT и так далее,
    иначе картинка просто не подхватится и останется emoji.
    """

    KIND_CHOICES = [
        ('CATEGORY', 'Категория блюда'),
        ('COOKING', 'Способ приготовления'),
        ('TASTE', 'Вкус'),
        ('WEIGHT', 'Сытность'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField('Тип', max_length=20, choices=KIND_CHOICES)
    key = models.CharField(
        'Код', max_length=30,
        help_text='Категория: MEAT, SALAD, SOUP, ASIAN, SEAFOOD, PIZZA, STREET, SIDES, DESSERT, SNACK. '
                  'Приготовление: FRIED, GRILLED, BAKED, BOILED, STEAMED, RAW, CURED, FERMENTED. '
                  'Вкус: SALTY, SWEET, SOUR, BITTER, UMAMI, SPICY, MIXED. '
                  'Сытность: LIGHT, MEDIUM, HEAVY.')
    label = models.CharField('Подпись', max_length=100, blank=True, default='',
                             help_text='Если пусто — берётся название с фронтенда.')
    image = models.ImageField('Картинка', upload_to='food_icons/', max_length=500,
                              help_text='PNG на прозрачном фоне, примерно 400×400.')
    sort_order = models.IntegerField('Порядок', default=0)

    class Meta:
        verbose_name = 'Иллюстрация блюда'
        verbose_name_plural = 'Иллюстрации блюд'
        ordering = ['kind', 'sort_order', 'key']
        unique_together = [('kind', 'key')]

    def __str__(self):
        return f'{self.get_kind_display()}: {self.key}'


class SiteSettings(models.Model):
    """
    Настройки витрины в одной записи. Всё, что маркетинг может захотеть
    поменять без разработчика: сколько сортов показывать в подборе и
    включён ли декор из колосьев.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    alternatives_count = models.IntegerField(
        'Сколько альтернатив показывать', default=3,
        help_text='Кроме лучшего сорта. 3 — показываем лучший и ещё три.')
    min_score_to_show = models.IntegerField(
        'Минимальная оценка пары', default=1,
        help_text='Пары со звёздами ниже этой в подбор не попадают.')
    show_wheat_decor = models.BooleanField(
        'Колосья по бокам страницы', default=True,
        help_text='Пшеница слева и справа, которая едет при прокрутке.')
    pairing_intro = models.TextField(
        'Подпись над парами', blank=True,
        default='Мы разложили сорт на вкусовые ноты и нашли блюда, которые с ними совпадают.')

    class Meta:
        verbose_name = 'Настройки витрины'
        verbose_name_plural = 'Настройки витрины'

    def __str__(self):
        return 'Настройки витрины'

    def save(self, *args, **kwargs):
        # Настройки одни на весь сайт: второй записи быть не должно.
        if not self.pk and SiteSettings.objects.exists():
            existing = SiteSettings.objects.first()
            self.pk = existing.pk
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        obj = cls.objects.first()
        return obj or cls()

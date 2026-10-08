import uuid
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone

from .slugs import unique_slug


class FlavorNote(models.Model):
    """Вкусовая нота - базовый элемент вкусовой пирамиды."""

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
                  'Показывается вокруг бутылки на странице сорта. Если пусто - берётся emoji.')
    reference_material = models.CharField('Эталонный материал', max_length=200, blank=True, default='')
    is_off_flavour = models.BooleanField('Off-flavour (дефект)', default=False)
    sort_order = models.IntegerField('Порядок сортировки', default=0)
    created_at = models.DateTimeField('Создано', auto_now_add=True)

    class Meta:
        verbose_name = 'Вкусовая нота'
        verbose_name_plural = 'Вкусовые ноты'
        ordering = ['sort_order', 'category', 'name']

    def __str__(self):
        return f'{self.icon} {self.name} ({self.get_category_display()})'


class Brand(models.Model):
    """Бренд пива - основная сущность каталога."""

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
                  'Если пусто - там показывается обычное изображение.')
    accent_color = models.CharField(
        'Цвет страницы', max_length=9, blank=True, default='',
        help_text='HEX вида #F5A623. Задаёт фон страницы сорта и подложку под бутылкой. '
                  'Если пусто - берётся цвет темы сайта.')
    tagline = models.CharField(
        'Слоган', max_length=200, blank=True, default='',
        help_text='Одна строка над названием на странице сорта, например «Классика пильзнера».')
    is_active = models.BooleanField('В наличии', default=True)
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
        return f'{self.brand.name}: {self.serving_temp_min}-{self.serving_temp_max}°C, {self.glass_type}'


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
        return f'{self.name} - {self.role}'


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
    image = models.URLField('Изображение (ссылка)', max_length=500, blank=True, default='')
    photo = models.ImageField(
        'Фото', upload_to='dishes/', null=True, blank=True, max_length=500,
        help_text='Загруженный файл показывается вместо ссылки. PNG, JPG или WebP до 5 МБ.')

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

    SOURCE_SOMMELIER = 'SOMMELIER'
    SOURCE_AI = 'AI'
    SOURCE_CHOICES = [
        (SOURCE_SOMMELIER, 'Сомелье'),
        (SOURCE_AI, 'ИИ-подбор'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    brand = models.ForeignKey(Brand, on_delete=models.CASCADE, related_name='food_pairings',
                              verbose_name='Бренд')
    dish = models.ForeignKey(Dish, on_delete=models.CASCADE, related_name='food_pairings',
                             verbose_name='Блюдо')
    compatibility_score = models.IntegerField('Совместимость (оценка 1-5 или %)')
    pairing_type = models.CharField('Тип пары', max_length=20, choices=PAIRING_TYPE_CHOICES)
    explanation = models.TextField('Обоснование')
    source = models.CharField(
        'Источник', max_length=10, choices=SOURCE_CHOICES, default=SOURCE_SOMMELIER,
        help_text='ИИ-подбор: пару предложил ИИ, сомелье её ещё не подтвердил. '
                  'После правки сомелье или модератором пара становится парой сомелье.')

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
    slug = models.SlugField(
        'Адрес меню (slug)', max_length=120, unique=True, blank=True,
        help_text='Часть ссылки на электронное меню. Если пусто - строится из названия.')
    address = models.CharField('Адрес', max_length=300)
    city = models.CharField('Город', max_length=100, blank=True, default='Алматы')
    venue_type = models.CharField('Тип заведения', max_length=50, choices=VENUE_TYPE_CHOICES)
    description = models.TextField('Описание', blank=True, default='')
    phone = models.CharField('Телефон', max_length=40, blank=True, default='')
    working_hours = models.CharField('Часы работы', max_length=120, blank=True, default='')
    logo = models.URLField('Логотип (ссылка)', max_length=500, blank=True, default='')
    logo_file = models.ImageField(
        'Логотип (файл)', upload_to='venues/', null=True, blank=True, max_length=500,
        help_text='Загруженный файл показывается вместо ссылки.')
    cover = models.URLField('Обложка', max_length=500, blank=True, default='')
    is_published = models.BooleanField('Опубликовано', default=True)
    tables_count = models.PositiveIntegerField(
        'Количество столов', default=20,
        help_text='Гость выбирает стол от 1 до этого числа при заказе.')
    accepts_orders = models.BooleanField(
        'Принимает заказы через приложение', default=True,
        help_text='Если выключено, меню и подбор работают, а заказ гость показывает официанту.')
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='venues', verbose_name='Владелец')
    created_at = models.DateTimeField('Создано', auto_now_add=True)

    class Meta:
        verbose_name = 'Заведение'
        verbose_name_plural = 'Заведения'
        ordering = ['name']
        constraints = [
            # Проверка в API не спасает от двух запросов сразу: правило держит и база.
            models.UniqueConstraint(fields=['owner'], condition=models.Q(owner__isnull=False),
                                    name='one_venue_per_owner'),
        ]

    # Адреса, занятые маршрутами API: /api/venues/mine/ это список своих заведений.
    RESERVED_SLUGS = ('mine',)

    def save(self, *args, **kwargs):
        if not self.slug or self.slug in self.RESERVED_SLUGS:
            self.slug = unique_slug(self.name, self._slug_taken)
        super().save(*args, **kwargs)

    def _slug_taken(self, candidate):
        if candidate in self.RESERVED_SLUGS:
            return True
        qs = Venue.objects.filter(slug=candidate)
        if self.pk:
            qs = qs.exclude(pk=self.pk)
        return qs.exists()

    def clean(self):
        # Одно заведение на владельца: та же проверка, что и в API, но для админки Django.
        if self.owner_id and Venue.objects.filter(owner_id=self.owner_id).exclude(pk=self.pk).exists():
            raise ValidationError({'owner': 'У этого пользователя уже есть заведение'})

    def __str__(self):
        return f'{self.name} ({self.get_venue_type_display()})'


class MenuItem(models.Model):
    """Позиция электронного меню: блюдо из каталога с ценой в конкретном заведении."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    venue = models.ForeignKey(Venue, on_delete=models.CASCADE, related_name='menu_items',
                              verbose_name='Заведение')
    dish = models.ForeignKey(Dish, on_delete=models.CASCADE, related_name='menu_items',
                             verbose_name='Блюдо')
    price = models.DecimalField('Цена, тг', max_digits=10, decimal_places=2)
    section = models.CharField('Раздел меню', max_length=80, default='Основное')
    portion = models.CharField('Порция', max_length=60, blank=True, default='',
                               help_text='Например «350 г» или «2 шт».')
    sort_order = models.IntegerField('Порядок', default=0)
    is_available = models.BooleanField('В наличии', default=True)
    chef_note = models.CharField('Комментарий повара', max_length=200, blank=True, default='')
    created_at = models.DateTimeField('Создано', auto_now_add=True)

    class Meta:
        verbose_name = 'Позиция меню'
        verbose_name_plural = 'Позиции меню'
        unique_together = ('venue', 'dish')
        ordering = ['section', 'sort_order', 'dish__name']

    def __str__(self):
        return f'{self.venue.name}: {self.dish.name} - {self.price}'


class MenuDrink(models.Model):
    """
    Напиток в карте бара с ценой в конкретном заведении: сорт из каталога (brand)
    или любой из 412 напитков движка подбора v2 (engine_drink_id). Для напитка движка
    без сорта название хранится в name.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    venue = models.ForeignKey(Venue, on_delete=models.CASCADE, related_name='menu_drinks',
                              verbose_name='Заведение')
    brand = models.ForeignKey(Brand, on_delete=models.CASCADE, related_name='menu_drinks',
                              null=True, blank=True, verbose_name='Сорт')
    engine_drink_id = models.CharField(
        'Напиток движка подбора', max_length=64, blank=True, default='', db_index=True,
        help_text='id из data/engine/drinks.json, например efes-0-0. Можно не заполнять, если выбран сорт.')
    name = models.CharField('Название', max_length=120, blank=True, default='',
                            help_text='Показывается, когда сорт не выбран.')
    price = models.DecimalField('Цена, тг', max_digits=10, decimal_places=2)
    volume = models.CharField('Объём', max_length=40, blank=True, default='',
                              help_text='Например «0,5 л» или «0,33 л».')
    is_available = models.BooleanField('В наличии', default=True)
    sort_order = models.IntegerField('Порядок', default=0)
    created_at = models.DateTimeField('Создано', auto_now_add=True)

    class Meta:
        verbose_name = 'Напиток в карте'
        verbose_name_plural = 'Напитки в карте'
        unique_together = ('venue', 'brand')
        ordering = ['sort_order', 'brand__name', 'name']
        constraints = [
            models.UniqueConstraint(
                fields=['venue', 'engine_drink_id'], condition=~models.Q(engine_drink_id=''),
                name='menudrink_venue_engine_drink_unique'),
            models.CheckConstraint(
                check=models.Q(brand__isnull=False) | ~models.Q(engine_drink_id=''),
                name='menudrink_brand_or_engine_drink'),
        ]

    @property
    def display_name(self):
        if self.brand_id:
            return self.brand.name
        return self.name or self.engine_drink_id

    def __str__(self):
        return f'{self.venue.name}: {self.display_name} - {self.price}'


class Order(models.Model):
    """Заказ гостя со стола. Гость оформляет его без входа и следит по guest_token."""

    STATUS_NEW = 'NEW'
    STATUS_ACCEPTED = 'ACCEPTED'
    STATUS_COOKING = 'COOKING'
    STATUS_SERVED = 'SERVED'
    STATUS_DONE = 'DONE'
    STATUS_CANCELLED = 'CANCELLED'
    STATUS_CHOICES = [
        (STATUS_NEW, 'Новый'),
        (STATUS_ACCEPTED, 'Принят'),
        (STATUS_COOKING, 'Готовится'),
        (STATUS_SERVED, 'Подан'),
        (STATUS_DONE, 'Закрыт'),
        (STATUS_CANCELLED, 'Отменён'),
    ]
    # Обычный путь заказа; отмена возможна из любого незакрытого статуса.
    NEXT_STATUS = {
        STATUS_NEW: STATUS_ACCEPTED,
        STATUS_ACCEPTED: STATUS_COOKING,
        STATUS_COOKING: STATUS_SERVED,
        STATUS_SERVED: STATUS_DONE,
    }
    FINAL_STATUSES = (STATUS_DONE, STATUS_CANCELLED)

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # PROTECT: заказы пилота нужны для отчёта, удаление заведения не должно стирать их каскадом.
    venue = models.ForeignKey(Venue, on_delete=models.PROTECT, related_name='orders',
                              verbose_name='Заведение')
    number = models.PositiveIntegerField('Номер', help_text='Сквозной номер внутри заведения, с 1.')
    table_number = models.IntegerField('Стол', help_text='0 - без стола (с собой).')
    guest_name = models.CharField('Имя гостя', max_length=80, blank=True, default='')
    comment = models.TextField('Комментарий', blank=True, default='')
    status = models.CharField('Статус', max_length=10, choices=STATUS_CHOICES, default=STATUS_NEW)
    total = models.DecimalField('Сумма, тг', max_digits=10, decimal_places=2, default=0)
    guest_token = models.CharField('Токен гостя', max_length=64, unique=True, editable=False)
    session = models.CharField('Сессия гостя', max_length=36, blank=True, default='',
                               help_text='Анонимный id браузера (ft_sid), связывает заказ с событиями пилота.')
    age_confirmed = models.BooleanField('Гость подтвердил возраст', default=False)
    is_demo = models.BooleanField(
        'Демо-заказ', default=False,
        help_text='Сгенерирован командой seed_demo_orders для показа аналитики. '
                  'В списке заказов не виден, в аналитике помечен как демо.')
    created_at = models.DateTimeField('Создано', auto_now_add=True)
    updated_at = models.DateTimeField('Обновлено', auto_now=True)

    class Meta:
        verbose_name = 'Заказ'
        verbose_name_plural = 'Заказы'
        unique_together = ('venue', 'number')
        ordering = ['-created_at']

    @classmethod
    def can_transition(cls, current, new):
        if new == cls.STATUS_CANCELLED:
            return current not in cls.FINAL_STATUSES
        return cls.NEXT_STATUS.get(current) == new

    def __str__(self):
        return f'{self.venue.name}: заказ №{self.number} ({self.get_status_display()})'


class OrderItem(models.Model):
    """Строка заказа. Название и цена сохраняются на момент заказа."""

    KIND_DISH = 'DISH'
    KIND_DRINK = 'DRINK'
    KIND_CHOICES = [
        (KIND_DISH, 'Блюдо'),
        (KIND_DRINK, 'Напиток'),
    ]

    # Откуда позиция попала в корзину: из меню, из панели «Подобрать напиток» или из чата ИИ-сомелье.
    SOURCE_MENU = 'MENU'
    SOURCE_PAIRING = 'PAIRING'
    SOURCE_AI = 'AI'
    SOURCE_CHOICES = [
        (SOURCE_MENU, 'Меню'),
        (SOURCE_PAIRING, 'Подбор'),
        (SOURCE_AI, 'ИИ-сомелье'),
    ]
    # Имена из версии 11 (там поле называлось via): значения те же, поле одно - source.
    VIA_MENU, VIA_PAIRING, VIA_AI = SOURCE_MENU, SOURCE_PAIRING, SOURCE_AI
    VIA_CHOICES = SOURCE_CHOICES

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name='items',
                              verbose_name='Заказ')
    kind = models.CharField('Тип', max_length=5, choices=KIND_CHOICES)
    menu_item = models.ForeignKey(MenuItem, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='order_items', verbose_name='Позиция меню')
    menu_drink = models.ForeignKey(MenuDrink, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='order_items', verbose_name='Напиток в карте')
    title = models.CharField('Название', max_length=200)
    price = models.DecimalField('Цена, тг', max_digits=10, decimal_places=2)
    qty = models.PositiveIntegerField('Количество', default=1)
    note = models.CharField('Пожелание', max_length=200, blank=True, default='')
    source = models.CharField('Откуда добавлено', max_length=16, choices=SOURCE_CHOICES, default=SOURCE_MENU)
    paired_menu_item = models.ForeignKey(
        MenuItem, on_delete=models.SET_NULL, null=True, blank=True, related_name='+',
        verbose_name='Подобрано к блюду')
    rec_rank = models.SmallIntegerField('Место в подборе', null=True, blank=True,
                                        help_text='1 - лучший вариант, 2 и дальше - альтернативы.')

    class Meta:
        verbose_name = 'Строка заказа'
        verbose_name_plural = 'Строки заказа'
        ordering = ['id']

    def __str__(self):
        return f'{self.title} x{self.qty}'


class ChangeRequest(models.Model):
    """
    Запрос сомелье на изменение данных сорта. Сомелье не правит пирамиду и подачу напрямую:
    он отправляет запрос, а вживую попадает только то, что подтвердил модератор.
    """

    KIND_NOTE_UPSERT = 'NOTE_UPSERT'
    KIND_NOTE_DELETE = 'NOTE_DELETE'
    KIND_SERVING = 'SERVING'
    KIND_CHOICES = [
        (KIND_NOTE_UPSERT, 'Нота пирамиды'),
        (KIND_NOTE_DELETE, 'Удалить ноту'),
        (KIND_SERVING, 'Подача'),
    ]

    STATUS_PENDING = 'PENDING'
    STATUS_APPROVED = 'APPROVED'
    STATUS_REJECTED = 'REJECTED'
    STATUS_CHOICES = [
        (STATUS_PENDING, 'Ожидает'),
        (STATUS_APPROVED, 'Принято'),
        (STATUS_REJECTED, 'Отклонено'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='change_requests', verbose_name='Автор')
    brand = models.ForeignKey(Brand, on_delete=models.CASCADE,
                              related_name='change_requests', verbose_name='Бренд')
    kind = models.CharField('Тип', max_length=20, choices=KIND_CHOICES)
    payload = models.JSONField(
        'Данные', default=dict, blank=True,
        help_text='NOTE_UPSERT: flavor_note_id, layer, intensity, sommelier_note. '
                  'NOTE_DELETE: flavor_note_id. '
                  'SERVING: serving_temp_min, serving_temp_max, glass_type, seasonality.')
    comment = models.TextField('Пояснение автора', blank=True, default='')
    status = models.CharField('Статус', max_length=10, choices=STATUS_CHOICES, default=STATUS_PENDING)
    reviewer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='reviewed_requests', verbose_name='Проверил')
    review_comment = models.TextField('Комментарий модератора', blank=True, default='')
    created_at = models.DateTimeField('Создано', auto_now_add=True)
    reviewed_at = models.DateTimeField('Рассмотрено', null=True, blank=True)

    class Meta:
        verbose_name = 'Запрос на изменение'
        verbose_name_plural = 'Запросы на изменение'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.brand.name}: {self.get_kind_display()} ({self.get_status_display()})'


class QRCode(models.Model):
    """QR-код привязанный к столику заведения."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    venue = models.ForeignKey(Venue, on_delete=models.CASCADE, related_name='qrcodes',
                              verbose_name='Заведение')
    table_number = models.IntegerField('Номер столика')
    unique_token = models.CharField('Уникальный токен', max_length=64, unique=True)
    scans_count = models.IntegerField('Количество сканирований', default=0)

    class Meta:
        verbose_name = 'QR-код'
        verbose_name_plural = 'QR-коды'
        ordering = ['venue', 'table_number']

    def __str__(self):
        return f'{self.venue.name} - стол {self.table_number}'


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


class FoodIcon(models.Model):
    """
    Иллюстрация характеристики блюда: «жареное», «острое», «мясо».

    Нужна двум экранам. В мастере подбора она заменяет emoji на кружке,
    а на карточке пары становится вторым планом рядом с блюдом - тем самым
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
                             help_text='Если пусто - берётся название с фронтенда.')
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
        help_text='Кроме лучшего сорта. 3 - показываем лучший и ещё три.')
    min_score_to_show = models.IntegerField(
        'Минимальная оценка пары', default=1,
        help_text='Пары со звёздами ниже этой в подбор не попадают.')
    show_wheat_decor = models.BooleanField(
        'Колосья по бокам страницы', default=True,
        help_text='Пшеница слева и справа, которая едет при прокрутке.')
    pairing_intro = models.TextField(
        'Подпись над парами', blank=True,
        default='Мы разложили сорт на вкусовые ноты и нашли блюда, которые с ними совпадают.')
    show_team = models.BooleanField(
        'Блок команды в Академии', default=False,
        help_text='Включайте, когда в разделе «Команда» записаны настоящие люди: '
                  'стартовые записи в нём условные.')

    class Meta:
        verbose_name = 'Настройки витрины'
        verbose_name_plural = 'Настройки витрины'

    def __str__(self):
        return 'Настройки витрины'

    def save(self, *args, **kwargs):
        # Настройки одни на весь сайт: второй записи быть не должно.
        # pk заполнен сразу (uuid по умолчанию), поэтому новую запись узнаём по _state.adding.
        if self._state.adding:
            existing = SiteSettings.objects.first()
            if existing is not None:
                self.pk = existing.pk
                self._state.adding = False
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        obj = cls.objects.first()
        return obj or cls()


class EnginePairingWeights(models.Model):
    """Подкрутка весов движка подбора из админки. Одна запись на весь сайт.

    overrides — плоский словарь dotted-путей параметров движка (например
    {"R1.k_loud": 60, "score.base": 48}); накладывается поверх
    data/engine/engine_v2_params.json при загрузке датасета (см. api/engine_tuning.py).
    Базовый JSON не меняется, поэтому «сбросить к базовым» = пустой overrides."""
    overrides = models.JSONField('Переопределения весов', default=dict, blank=True)
    version = models.PositiveIntegerField('Версия', default=0)
    updated_by = models.CharField('Кто менял', max_length=150, blank=True, default='')
    updated_at = models.DateTimeField('Обновлено', auto_now=True)

    class Meta:
        verbose_name = 'Веса движка подбора'
        verbose_name_plural = 'Веса движка подбора'

    def __str__(self):
        return 'Веса движка подбора (v%s)' % self.version

    def save(self, *args, **kwargs):
        # Одна запись на весь сайт; версия растёт при каждом сохранении (ключ кэша датасета).
        if not self.pk and EnginePairingWeights.objects.exists():
            self.pk = EnginePairingWeights.objects.first().pk
        self.version = (self.version or 0) + 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        return cls.objects.first() or cls()


class PilotEvent(models.Model):
    """
    Событие пилота: скан QR, открытие меню и подбора, добавление напитка, заказ, оценка.
    Гость анонимен: session - случайный id браузера (ft_sid), имени и телефона здесь нет.
    Из этих строк считается отчёт пилота (api/pilot_report.py).
    """

    KIND_SCAN = 'SCAN'
    KIND_MENU_OPEN = 'MENU_OPEN'
    KIND_PAIR_OPEN = 'PAIR_OPEN'
    KIND_PAIR_ADD = 'PAIR_ADD'
    KIND_ORDER = 'ORDER'
    KIND_FEEDBACK = 'FEEDBACK'
    KIND_AGE_OK = 'AGE_OK'
    KIND_AI_ASK = 'AI_ASK'
    KIND_AI_ADD = 'AI_ADD'
    KIND_CATALOG_OPEN = 'CATALOG_OPEN'
    KIND_PAIRING_V2 = 'PAIRING_V2'
    KIND_CHOICES = [
        (KIND_SCAN, 'Скан QR'),
        (KIND_MENU_OPEN, 'Открыл меню'),
        (KIND_PAIR_OPEN, 'Открыл подбор'),
        (KIND_PAIR_ADD, 'Добавил напиток из подбора'),
        (KIND_ORDER, 'Заказ'),
        (KIND_FEEDBACK, 'Оценка пары'),
        (KIND_AGE_OK, 'Подтвердил возраст'),
        (KIND_AI_ASK, 'Вопрос ИИ-сомелье'),
        (KIND_AI_ADD, 'Добавил из чата ИИ'),
        (KIND_CATALOG_OPEN, 'Открыл каталог'),
        (KIND_PAIRING_V2, 'Подбор на сайте'),
    ]

    venue = models.ForeignKey(Venue, on_delete=models.SET_NULL, null=True, blank=True,
                              related_name='pilot_events', verbose_name='Заведение')
    session = models.CharField('Сессия гостя', max_length=36, blank=True, default='', db_index=True)
    kind = models.CharField('Событие', max_length=24, choices=KIND_CHOICES)
    table_number = models.PositiveSmallIntegerField('Стол', null=True, blank=True)
    menu_item = models.ForeignKey(MenuItem, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='+', verbose_name='Блюдо меню')
    menu_drink = models.ForeignKey(MenuDrink, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='+', verbose_name='Напиток в карте')
    dish_ref = models.CharField('Блюдо (ссылка)', max_length=64, blank=True, default='',
                                help_text='id позиции меню, блюда движка или название, если позиции меню нет.')
    drink_ref = models.CharField('Напиток (ссылка)', max_length=64, blank=True, default='',
                                 help_text='id напитка в карте, напитка движка или название.')
    rank = models.SmallIntegerField('Место в подборе', null=True, blank=True)
    source = models.CharField('Источник', max_length=16, blank=True, default='')
    meta = models.JSONField('Подробности', default=dict, blank=True)
    created_at = models.DateTimeField('Когда', auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = 'Событие пилота'
        verbose_name_plural = 'События пилота'
        ordering = ['-created_at']
        indexes = [models.Index(fields=['venue', 'kind', 'created_at'], name='pilotevent_venue_kind_time')]

    def __str__(self):
        if not self.created_at:
            return self.get_kind_display()
        return f'{self.get_kind_display()} ({timezone.localtime(self.created_at):%d.%m %H:%M})'


class PairingFeedback(models.Model):
    """Оценка пары гостем после заказа: 1-5 звёзд и необязательный комментарий."""

    venue = models.ForeignKey(Venue, on_delete=models.SET_NULL, null=True, blank=True,
                              related_name='pairing_feedback', verbose_name='Заведение')
    order = models.ForeignKey(Order, on_delete=models.SET_NULL, null=True, blank=True,
                              related_name='pairing_feedback', verbose_name='Заказ')
    session = models.CharField('Сессия гостя', max_length=36, blank=True, default='')
    dish_ref = models.CharField('Блюдо (ссылка)', max_length=64, blank=True, default='')
    drink_ref = models.CharField('Напиток (ссылка)', max_length=64, blank=True, default='')
    rating = models.PositiveSmallIntegerField(
        'Оценка', validators=[MinValueValidator(1), MaxValueValidator(5)])
    comment = models.CharField('Комментарий', max_length=500, blank=True, default='')
    created_at = models.DateTimeField('Когда', auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = 'Оценка пары'
        verbose_name_plural = 'Оценки пар'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.rating}/5: {self.dish_ref} + {self.drink_ref}'


def default_taste():
    return {}


class UserPreferences(models.Model):
    """
    Вкус пользователя: какое пиво ему нравится, любимые сорта и прогресс
    в Школе сомелье. Одна запись на пользователя, создаётся при первом обращении.
    """

    TASTE_KEYS = ('body', 'bitterness', 'freshness', 'sweetness', 'roast', 'strength')

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                                related_name='preferences', verbose_name='Пользователь')
    taste = models.JSONField(
        'Вкусовые предпочтения', default=default_taste, blank=True,
        help_text='Шкалы 0-10: body, bitterness, freshness, sweetness, roast, strength. '
                  'Пустая шкала значит "не важно".')
    cuisines = models.JSONField('Любимые кухни', default=list, blank=True,
                                help_text='Коды кухонь, как у блюд: KZ, ITALIAN, ...')
    favorite_brands = models.ManyToManyField(Brand, blank=True, related_name='fans',
                                             verbose_name='Любимые сорта')
    sommelier_level = models.IntegerField('Пройдено ступеней Школы', default=0)
    updated_at = models.DateTimeField('Обновлено', auto_now=True)

    class Meta:
        verbose_name = 'Предпочтения пользователя'
        verbose_name_plural = 'Предпочтения пользователей'

    def __str__(self):
        return f'Предпочтения {self.user}'

    @classmethod
    def for_user(cls, user):
        obj, _ = cls.objects.get_or_create(user=user)
        return obj


class QuizQuestion(models.Model):
    """
    Вопрос теста Школы сомелье. Привязан к номеру ступени, а не к записи
    курса: seed пересоздаёт курсы, а вопросы, которые правил модератор, должны жить.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    level = models.IntegerField('Ступень', choices=Course.LEVEL_CHOICES)
    text = models.TextField('Вопрос')
    options = models.JSONField('Варианты ответа', default=list,
                               help_text='Список строк, от 2 до 6 вариантов.')
    correct_index = models.IntegerField('Номер верного ответа', default=0,
                                        help_text='Считается с нуля: 0 - первый вариант.')
    explanation = models.TextField('Пояснение', blank=True, default='',
                                   help_text='Показывается после ответа: почему верно именно так.')
    sort_order = models.IntegerField('Порядок', default=0)
    is_active = models.BooleanField('Показывать в тесте', default=True)
    created_at = models.DateTimeField('Создано', auto_now_add=True)

    class Meta:
        verbose_name = 'Вопрос теста'
        verbose_name_plural = 'Вопросы теста'
        ordering = ['level', 'sort_order', 'created_at']

    def __str__(self):
        return f'Ступень {self.level}: {self.text[:60]}'

    def clean(self):
        opts = self.options if isinstance(self.options, list) else []
        if not 2 <= len(opts) <= 6:
            raise ValidationError({'options': 'Нужно от 2 до 6 вариантов ответа'})
        if any(not isinstance(o, str) or not o.strip() for o in opts):
            raise ValidationError({'options': 'Варианты ответа не должны быть пустыми'})
        if not 0 <= self.correct_index < len(opts):
            raise ValidationError({'correct_index': 'Верный ответ должен быть одним из вариантов'})


class QuizAttempt(models.Model):
    """Попытка пройти тест ступени. Гостей без входа не сохраняем."""

    PASS_PERCENT = 70

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                             related_name='quiz_attempts', verbose_name='Пользователь')
    level = models.IntegerField('Ступень', choices=Course.LEVEL_CHOICES)
    correct = models.IntegerField('Верных ответов')
    total = models.IntegerField('Всего вопросов')
    passed = models.BooleanField('Сдано')
    created_at = models.DateTimeField('Когда', auto_now_add=True)

    class Meta:
        verbose_name = 'Попытка теста'
        verbose_name_plural = 'Попытки теста'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.user} - ступень {self.level}: {self.correct}/{self.total}'


class AiUsage(models.Model):
    """
    Счётчик платных обращений к ИИ за день. Общий дневной лимит защищает бюджет:
    лимиты по частоте живут в памяти процесса и на серверлесс-хостинге у каждого экземпляра свои.
    """

    KIND_PANEL = 'panel'
    KIND_GUEST = 'guest'

    day = models.DateField('День')
    kind = models.CharField('Тип', max_length=20)
    count = models.PositiveIntegerField('Обращений', default=0)

    class Meta:
        verbose_name = 'Расход ИИ за день'
        verbose_name_plural = 'Расход ИИ по дням'
        unique_together = ('day', 'kind')
        ordering = ['-day', 'kind']

    def __str__(self):
        return f'{self.day} {self.kind}: {self.count}'


class Lesson(models.Model):
    """
    Урок Академии: короткий материал внутри ступени. Текст хранится блоками (blocks),
    чтобы страница сама решала, как их показать: абзац, список, подсказка, вопрос для самопроверки.
    """

    BLOCK_TYPES = ('text', 'facts', 'steps', 'tip', 'check', 'practice')

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    level = models.IntegerField('Ступень', choices=Course.LEVEL_CHOICES)
    slug = models.SlugField('Адрес', max_length=80, unique=True)
    title = models.CharField('Название', max_length=200)
    summary = models.CharField('Коротко о чём', max_length=300, blank=True, default='')
    minutes = models.PositiveSmallIntegerField('Минут на чтение', default=3)
    blocks = models.JSONField(
        'Содержимое', default=list, blank=True,
        help_text='Список блоков. Типы: text, facts, steps, tip, check, practice.')
    sort_order = models.IntegerField('Порядок', default=0)
    is_active = models.BooleanField('Показывать', default=True)
    created_at = models.DateTimeField('Создано', auto_now_add=True)

    class Meta:
        verbose_name = 'Урок'
        verbose_name_plural = 'Уроки'
        ordering = ['level', 'sort_order', 'created_at']

    def __str__(self):
        return f'Ступень {self.level}: {self.title}'

    def clean(self):
        blocks = self.blocks if isinstance(self.blocks, list) else None
        if blocks is None:
            raise ValidationError({'blocks': 'Ожидается список блоков'})
        for block in blocks:
            if not isinstance(block, dict) or block.get('type') not in self.BLOCK_TYPES:
                raise ValidationError({'blocks': 'У каждого блока должен быть type из: ' + ', '.join(self.BLOCK_TYPES)})


class LessonProgress(models.Model):
    """Урок прочитан пользователем. Один раз на урок."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                             related_name='lesson_progress', verbose_name='Пользователь')
    lesson = models.ForeignKey(Lesson, on_delete=models.CASCADE, related_name='progress',
                               verbose_name='Урок')
    completed_at = models.DateTimeField('Когда', auto_now_add=True)

    class Meta:
        verbose_name = 'Пройденный урок'
        verbose_name_plural = 'Пройденные уроки'
        unique_together = ('user', 'lesson')
        ordering = ['-completed_at']

    def __str__(self):
        return f'{self.user}: {self.lesson.title}'


class Tasting(models.Model):
    """
    Отметка в паспорте вкуса: пользователь попробовал сорт и записал, какие ноты услышал.
    Одна отметка на сорт: баллы даются за новый сорт, а не за количество выпитого.
    """

    MAX_NOTES = 6

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                             related_name='tastings', verbose_name='Пользователь')
    brand = models.ForeignKey(Brand, on_delete=models.CASCADE, related_name='tastings',
                              verbose_name='Сорт')
    venue = models.ForeignKey(Venue, on_delete=models.SET_NULL, null=True, blank=True,
                              related_name='tastings', verbose_name='Где пробовал')
    notes = models.ManyToManyField(FlavorNote, blank=True, related_name='tastings',
                                   verbose_name='Что услышал')
    rating = models.PositiveSmallIntegerField('Оценка 1-5')
    comment = models.CharField('Заметка', max_length=280, blank=True, default='')
    matched = models.PositiveSmallIntegerField(
        'Совпало нот с пирамидой', default=0,
        help_text='Сколько выбранных нот есть в пирамиде сомелье на момент отметки.')
    created_at = models.DateTimeField('Создано', auto_now_add=True)
    updated_at = models.DateTimeField('Обновлено', auto_now=True)

    class Meta:
        verbose_name = 'Отметка в паспорте вкуса'
        verbose_name_plural = 'Паспорт вкуса: отметки'
        unique_together = ('user', 'brand')
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.user}: {self.brand.name} ({self.rating}/5)'


class PairingVote(models.Model):
    """
    Голос гостя за пару из каталога: подошло или нет. Один голос на пару от пользователя,
    а без входа от устройства (случайный идентификатор из браузера).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    pairing = models.ForeignKey(FoodPairing, on_delete=models.CASCADE, related_name='votes',
                                verbose_name='Пара')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, null=True, blank=True,
                             related_name='pairing_votes', verbose_name='Пользователь')
    device = models.CharField('Устройство', max_length=64, blank=True, default='')
    venue = models.ForeignKey(Venue, on_delete=models.SET_NULL, null=True, blank=True,
                              related_name='pairing_votes', verbose_name='Заведение')
    liked = models.BooleanField('Подошло')
    created_at = models.DateTimeField('Когда', auto_now_add=True)
    updated_at = models.DateTimeField('Обновлено', auto_now=True)

    class Meta:
        verbose_name = 'Голос за пару'
        verbose_name_plural = 'Голоса за пары'
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(fields=['pairing', 'user'], condition=models.Q(user__isnull=False),
                                    name='one_vote_per_user'),
            models.UniqueConstraint(fields=['pairing', 'device'],
                                    condition=models.Q(user__isnull=True) & ~models.Q(device=''),
                                    name='one_vote_per_device'),
        ]

    def __str__(self):
        return f'{self.pairing}: {"подошло" if self.liked else "не подошло"}'


class Reward(models.Model):
    """
    Награда за баллы знаний. Алкоголь и скидки на него наградой быть не могут:
    реклама алкоголя через призы в Казахстане запрещена, поэтому типы только такие.
    Без заведения награда общая для платформы (её ведёт модератор).
    """

    KIND_FOOD = 'FOOD'
    KIND_SOFT = 'SOFT'
    KIND_MERCH = 'MERCH'
    KIND_EVENT = 'EVENT'
    KIND_CHOICES = [
        (KIND_FOOD, 'Угощение от кухни'),
        (KIND_SOFT, 'Безалкогольный напиток'),
        (KIND_MERCH, 'Сувенир'),
        (KIND_EVENT, 'Событие'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    venue = models.ForeignKey(Venue, on_delete=models.CASCADE, null=True, blank=True,
                              related_name='rewards', verbose_name='Заведение')
    title = models.CharField('Название', max_length=120)
    description = models.CharField('Описание', max_length=300, blank=True, default='')
    kind = models.CharField('Тип', max_length=10, choices=KIND_CHOICES, default=KIND_FOOD)
    cost = models.PositiveIntegerField('Цена в баллах')
    stock = models.PositiveIntegerField('Осталось штук', null=True, blank=True,
                                        help_text='Пусто - без ограничения.')
    is_active = models.BooleanField('Доступна', default=True)
    created_at = models.DateTimeField('Создано', auto_now_add=True)

    class Meta:
        verbose_name = 'Награда'
        verbose_name_plural = 'Награды'
        ordering = ['cost', 'title']

    def __str__(self):
        return f'{self.title} ({self.cost} баллов)'


class Redemption(models.Model):
    """Обмен баллов на награду: гость получает код и показывает его сотруднику."""

    STATUS_ISSUED = 'ISSUED'
    STATUS_USED = 'USED'
    STATUS_CANCELLED = 'CANCELLED'
    STATUS_CHOICES = [
        (STATUS_ISSUED, 'Код выдан'),
        (STATUS_USED, 'Получена'),
        (STATUS_CANCELLED, 'Отменена'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                             related_name='redemptions', verbose_name='Пользователь')
    reward = models.ForeignKey(Reward, on_delete=models.SET_NULL, null=True, blank=True,
                               related_name='redemptions', verbose_name='Награда')
    venue = models.ForeignKey(Venue, on_delete=models.SET_NULL, null=True, blank=True,
                              related_name='redemptions', verbose_name='Заведение')
    title = models.CharField('Название на момент обмена', max_length=120)
    cost = models.PositiveIntegerField('Списано баллов')
    code = models.CharField('Код', max_length=8, unique=True)
    status = models.CharField('Статус', max_length=10, choices=STATUS_CHOICES, default=STATUS_ISSUED)
    created_at = models.DateTimeField('Создано', auto_now_add=True)
    used_at = models.DateTimeField('Выдана', null=True, blank=True)
    used_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                related_name='redemptions_given', verbose_name='Кто выдал')

    class Meta:
        verbose_name = 'Обмен баллов'
        verbose_name_plural = 'Обмены баллов'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.user}: {self.title} ({self.get_status_display()})'

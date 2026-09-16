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
    image = models.ImageField('Изображение / Бутылка', upload_to='brands/', null=True, blank=True, max_length=500)
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

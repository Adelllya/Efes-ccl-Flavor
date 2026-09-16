"""
Django management command: python manage.py seed
Загружает все демо-данные (идемпотентно — сначала удаляет, потом вставляет).
Данные по стандарту FlavorActiV «Beer Flavour Language».
"""
from django.core.management.base import BaseCommand
from api.models import (
    FlavorNote, Brand, FlavorProfile, ServingRecommendation,
    Course, TeamMember,
)


# ═══════════════════════════════════════════════════════════════════════════════
#  SEED DATA
# ═══════════════════════════════════════════════════════════════════════════════

FLAVOR_NOTE_SEEDS = [
    # ═══════════ TOP NOTES (first impression, 0–3 sec) ═══════════
    {'name': 'Хмелевая свежесть', 'technical_term': 'Kettle Hop / Hop Oil', 'wheel_code': '0170', 'category': 'TOP', 'description': 'Свежий хмелевой аромат, первое впечатление при поднесении бокала', 'icon': '🌿', 'reference_material': 'Свежая хмелевая шишка, хмелевое масло'},
    {'name': 'Цитрус', 'technical_term': 'Isoamyl Acetate', 'wheel_code': '0120', 'category': 'TOP', 'description': 'Яркие цитрусовые ноты — мандарин, грейпфрут, лимонная цедра', 'icon': '🍊', 'reference_material': 'Цедра мандарина, грейпфрутовая кожура'},
    {'name': 'Цветочный букет', 'technical_term': 'Geraniol', 'wheel_code': '0130', 'category': 'TOP', 'description': 'Деликатные цветочные ароматы, характерные для лагеров и пшеничных сортов', 'icon': '🌸', 'reference_material': 'Роза, жасмин, герань'},
    {'name': 'Тропические фрукты', 'technical_term': 'Ethyl Hexanoate', 'wheel_code': '0110', 'category': 'TOP', 'description': 'Арбуз, манго, ананас — яркие фруктовые эстеровые ароматы', 'icon': '🍍', 'reference_material': 'Арбуз, манго, спелый ананас'},
    {'name': 'Яблоко и персик', 'technical_term': 'Isoamyl Acetate', 'wheel_code': '0120', 'category': 'TOP', 'description': 'Спелое зелёное яблоко, персик — классические эстеровые ноты элей', 'icon': '🍑', 'reference_material': 'Спелый персик, зелёное яблоко'},
    {'name': 'Свежескошенная трава', 'technical_term': 'Freshly Cut Grass', 'wheel_code': '0160', 'category': 'TOP', 'description': 'Зелёный травяной аромат, как в только что скошенной траве', 'icon': '🌱', 'reference_material': 'Свежескошенная трава, зелёные листья'},
    {'name': 'Спиртовой аромат', 'technical_term': 'Alcoholic', 'wheel_code': '0010', 'category': 'TOP', 'description': 'Лёгкий спиртовой шлейф в аромате, заметен в крепких сортах', 'icon': '✨', 'reference_material': 'Спирт, ром, бренди'},
    {'name': 'Освежающий финиш', 'technical_term': 'Carbonation', 'wheel_code': '0390', 'category': 'TOP', 'description': 'Живая карбонизация, искристость и свежесть в носу', 'icon': '❄️', 'reference_material': 'Газировка, минеральная вода с пузырьками'},
    {'name': 'Дымный шлейф', 'technical_term': 'Smoky', 'wheel_code': '0300', 'category': 'TOP', 'description': 'Лёгкий дымный аромат от обжаренного солода или хмеля', 'icon': '💨', 'reference_material': 'Сосновый дым, копчёная щепка'},
    {'name': 'Пряная свежесть', 'technical_term': 'Phenolic / Spicy', 'wheel_code': '0210', 'category': 'TOP', 'description': 'Лёгкие фенольные и пряные акценты в аромате', 'icon': '🌶️', 'reference_material': 'Белый перец, гвоздика, имбирь'},
    {'name': 'Свежий хлеб', 'technical_term': 'Bready', 'wheel_code': '0090', 'category': 'TOP', 'description': 'Аромат тёплого свежевыпеченного хлеба', 'icon': '🥖', 'reference_material': 'Свежий батон, ржаной хлеб'},
    {'name': 'Медовые ноты', 'technical_term': 'Honey', 'wheel_code': '0140', 'category': 'TOP', 'description': 'Сладкий цветочный медовый аромат', 'icon': '🍯', 'reference_material': 'Липовый мёд, акациевый мёд'},
    # ═══════════ HEART NOTES (main body, 3–15 sec) ═══════════
    {'name': 'Солодовая плотность', 'technical_term': 'Malty', 'wheel_code': '0080', 'category': 'HEART', 'description': 'Основное солодовое тело пива, сытность и плотность', 'icon': '🌾', 'reference_material': 'Пшеничный солод, ячмень'},
    {'name': 'Карамель', 'technical_term': 'Caramel', 'wheel_code': '0280', 'category': 'HEART', 'description': 'Карамельная сладость от умеренно обжаренного солода', 'icon': '🍬', 'reference_material': 'Карамель, жжёный сахар'},
    {'name': 'Хлебно-зерновые ноты', 'technical_term': 'Grainy / Bread', 'wheel_code': '0090', 'category': 'HEART', 'description': 'Зерновая сытность, ржаной хлеб, овсяные хлопья', 'icon': '🥣', 'reference_material': 'Овсяные хлопья, ржаной хлеб, пшеница'},
    {'name': 'Зерновое послевкусие', 'technical_term': 'Worty', 'wheel_code': '0080', 'category': 'HEART', 'description': 'Нота сусла, сладковатая зерновая основа', 'icon': '🌰', 'reference_material': 'Свежее пиво-сусло, сладкая пшеница'},
    {'name': 'Сладость', 'technical_term': 'Sweet', 'wheel_code': '0370', 'category': 'HEART', 'description': 'Сладковатое ощущение от неферментированных сахаров', 'icon': '🍮', 'reference_material': 'Медовая карамель, варёная кукуруза'},
    {'name': 'Ваниль', 'technical_term': 'Vanilla', 'wheel_code': '0250', 'category': 'HEART', 'description': 'Ванильный аромат от дубовых дубил и дрожжевых метилантратов', 'icon': '🍦', 'reference_material': 'Ванильный стручок, ванильное мороженое'},
    {'name': 'Ореховые ноты', 'technical_term': 'Almond / Nutty', 'wheel_code': '0150', 'category': 'HEART', 'description': 'Миндаль, грецкий орех, фундук — ореховое тело пива', 'icon': '🌰', 'reference_material': 'Миндаль, грецкий орех, фундук'},
    {'name': 'Травянистость', 'technical_term': 'Grassy / Herbal', 'wheel_code': '0160', 'category': 'HEART', 'description': 'Травяные и фито-ноты в теле пива', 'icon': '🌿', 'reference_material': 'Сушёные травы, шалфей, мята'},
    {'name': 'Сырная плотность', 'technical_term': 'Butyric', 'wheel_code': '0290', 'category': 'HEART', 'description': 'Сливочные и сливочнo-сырные ноты, характерные для некоторых элей', 'icon': '🧈', 'reference_material': 'Сливочное масло, выдержанный сыр', 'is_off_flavour': True},
    {'name': 'Горьковатое яблоко', 'technical_term': 'Acetic', 'wheel_code': '0220', 'category': 'HEART', 'description': 'Лёгкая кислинка, как в зелёном яблоке или уксусной настойке', 'icon': '🍏', 'reference_material': 'Зелёное яблоко, яблочный уксус'},
    {'name': 'Молочная сладость', 'technical_term': 'Diacetyl', 'wheel_code': '0260', 'category': 'HEART', 'description': 'Сливочно-масляная нота, характерная для barley wine и стаутов', 'icon': '🥛', 'reference_material': 'Тёплое сливочное масло, сливки', 'is_off_flavour': True},
    {'name': 'Зерновая пряность', 'technical_term': 'Spicy', 'wheel_code': '0210', 'category': 'HEART', 'description': 'Пряные ноты от специй и фенолов — гвоздика, корица', 'icon': '🧂', 'reference_material': 'Гвоздика, корица, имбирь'},
    {'name': 'Косточковые фрукты', 'technical_term': 'Fruity', 'wheel_code': '0100', 'category': 'HEART', 'description': 'Спелые фрукты — слива, абрикос, вишня', 'icon': '🍑', 'reference_material': 'Слива, абрикос, вишня'},
    # ═══════════ BASE NOTES (finish, 15+ sec) ═══════════
    {'name': 'Хмелевая горчинка', 'technical_term': 'Bitter', 'wheel_code': '0350', 'category': 'BASE', 'description': 'Хмелевая горечь — основа послевкусия большинства пив', 'icon': '🌿', 'reference_material': 'Горький хмель, артемизия'},
    {'name': 'Обжарка', 'technical_term': 'Burnt / Roasted', 'wheel_code': '0310', 'category': 'BASE', 'description': 'Обжаренный солод, тост, поджарка — тёмная основа стаутов и портеров', 'icon': '🔥', 'reference_material': 'Обжаренный кофе, тост, жжёный солод'},
    {'name': 'Кофейные ноты', 'technical_term': 'Coffee', 'wheel_code': '0310', 'category': 'BASE', 'description': 'Кофейный финиш — от эспрессо до кофе с молоком', 'icon': '☕', 'reference_material': 'Свежесваренный кофе, эспрессо'},
    {'name': 'Шоколад', 'technical_term': 'Chocolate', 'wheel_code': '0310', 'category': 'BASE', 'description': 'Шоколадный финиш — от молочного до тёмного шоколада', 'icon': '🍫', 'reference_material': 'Тёмный шоколад, какао'},
    {'name': 'Дрожжевые ноты', 'technical_term': 'Yeasty', 'wheel_code': '0270', 'category': 'BASE', 'description': 'Дрожжевой характер — хлеб, банан, гвоздика от дрожжевых метаболических продуктов', 'icon': '🫓', 'reference_material': 'Свежие дрожжи, ржаной хлеб'},
    {'name': 'Земляные ноты', 'technical_term': 'Earthy / Musty', 'wheel_code': '0380', 'category': 'BASE', 'description': 'Земля, мох, луг — землистый финиш', 'icon': '🌍', 'reference_material': 'Влага после дождя, мох, земля'},
    {'name': 'Соломенная основа', 'technical_term': 'Papery / Leathery', 'wheel_code': '0380', 'category': 'BASE', 'description': 'Соломенная, бумажная, кожаная нота в послевкусии', 'icon': '📜', 'reference_material': 'Солома, старая бумага, кожа'},
    {'name': 'Соленый финиш', 'technical_term': 'Salty', 'wheel_code': '0360', 'category': 'BASE', 'description': 'Лёгкая солоноватость в послевкусии', 'icon': '🧂', 'reference_material': 'Солёные крекеры, морская соль'},
    {'name': 'Сульфидный оттенок', 'technical_term': 'Sulphitic', 'wheel_code': '0240', 'category': 'BASE', 'description': 'Сульфидные ноты — от дикого лука до сыра', 'icon': '🧅', 'reference_material': 'Лук, чеснок, мягкий сыр', 'is_off_flavour': True},
    {'name': 'Сероводородный шлейф', 'technical_term': 'H2S', 'wheel_code': '0240', 'category': 'BASE', 'description': 'Тухлые яйца, сера — дефект вкуса', 'icon': '🥚', 'reference_material': 'Тухлое яйцо, сера', 'is_off_flavour': True},
    {'name': 'Меркаптановая нота', 'technical_term': 'Mercaptan', 'wheel_code': '0240', 'category': 'BASE', 'description': 'Сернистые соединения', 'icon': '🐱', 'reference_material': 'Кошачья моча, спелая вишня', 'is_off_flavour': True},
    {'name': 'Световой дефект', 'technical_term': 'Lightstruck', 'wheel_code': '0240', 'category': 'BASE', 'description': 'Дефект от UV-света', 'icon': '🐭', 'reference_material': 'Мокрая мышь, кожаная перчатка', 'is_off_flavour': True},
    {'name': 'Сухое послевкусие', 'technical_term': 'Dry / Astringent', 'wheel_code': '0400', 'category': 'BASE', 'description': 'Сухое, чуть вяжущее послевкусие от танинов и хмеля', 'icon': '🍂', 'reference_material': 'Чёрный чай, незрелое яблоко'},
    {'name': 'Металлический оттенок', 'technical_term': 'Metallic', 'wheel_code': '0340', 'category': 'BASE', 'description': 'Металлическая нота — от железа или контакта с оборудованием', 'icon': '🔩', 'reference_material': 'Металл, ржавчина', 'is_off_flavour': True},
    {'name': 'Мясистая нота', 'technical_term': 'Meaty / Catty', 'wheel_code': '0330', 'category': 'BASE', 'description': 'Мясные, бульонные ноты — от DMS или дефектов брожения', 'icon': '🍖', 'reference_material': 'Куриный бульон, варёное мясо', 'is_off_flavour': True},
    {'name': 'Варёные овощи', 'technical_term': 'Cooked Veg', 'wheel_code': '0320', 'category': 'BASE', 'description': 'Варёный горошек, кукуруза, спаржа — от DMS и хмеля', 'icon': '🥬', 'reference_material': 'Варёный горошек, спаржа, кукуруза', 'is_off_flavour': True},
    {'name': 'Финиш — хмель и солод', 'technical_term': 'Bitter / Malty', 'wheel_code': '0350', 'category': 'BASE', 'description': 'Общий баланс горечи и солода в послевкусии', 'icon': '🎯', 'reference_material': 'Хмель + солод в балансе'},
]

BRAND_SEEDS = [
    {'name': 'Efes Pilsener', 'brand_owner': 'Efes Kazakhstan', 'style': 'Pilsner', 'abv': 4.5, 'density': '11.8% плато', 'fermentation_type': 'Нижнее', 'description': 'Классический пилснер с чешским характером — чистый солод, хмелевая свежесть и яркий финиш.', 'image': 'https://placehold.co/600x800/f59e0b/fff?text=Efes+Pilsener'},
    {'name': 'Efes Lager', 'brand_owner': 'Efes Kazakhstan', 'style': 'Lager', 'abv': 4.8, 'density': '12.0% плато', 'fermentation_type': 'Нижнее', 'description': 'Сбалансированный лагер — солодовая база, лёгкая карамель, хмелевая горчинка.', 'image': 'https://placehold.co/600x800/eab308/fff?text=Efes+Lager'},
    {'name': 'Tarkum', 'brand_owner': 'Efes Kazakhstan', 'style': 'Lager', 'abv': 5.0, 'density': '12.5% плато', 'fermentation_type': 'Нижнее', 'description': 'Традиционный казахстанский лагер — плотное тело, солод, хлеб и лёгкая горечь.', 'image': 'https://placehold.co/600x800/d97706/fff?text=Tarkum'},
    {'name': 'Efes Wheat', 'brand_owner': 'Efes Kazakhstan', 'style': 'Wheat', 'abv': 5.2, 'density': '12.2% плато', 'fermentation_type': 'Верхнее', 'description': 'Пшеничное пиво — банан, гвоздика, дрожжевая плотность, мягкое послевкусие.', 'image': 'https://placehold.co/600x800/fbbf24/fff?text=Efes+Wheat'},
    {'name': 'Efes IPA', 'brand_owner': 'Efes Kazakhstan', 'style': 'IPA', 'abv': 6.5, 'density': '13.0% плато', 'fermentation_type': 'Верхнее', 'description': 'Американский IPA — цитрус, тропики, хмелевая горчинка и солодовая база.', 'image': 'https://placehold.co/600x800/84cc16/fff?text=Efes+IPA'},
    {'name': 'Efes Stout', 'brand_owner': 'Efes Kazakhstan', 'style': 'Stout', 'abv': 5.5, 'density': '13.5% плато', 'fermentation_type': 'Верхнее', 'description': 'Тёмный стаут — кофе, шоколад, обжарка, плотное тело и сухой финиш.', 'image': 'https://placehold.co/600x800/451a03/fff?text=Efes+Stout'},
]

# brandIndex → { TOP: [(noteIndex, intensity)], HEART: [...], BASE: [...] }
PROFILE_SEEDS = [
    {'brand_index': 0, 'TOP': [(0, 8), (7, 7), (2, 5)], 'HEART': [(12, 6), (14, 4), (15, 5)], 'BASE': [(25, 8), (26, 4), (41, 6)]},
    {'brand_index': 1, 'TOP': [(0, 7), (10, 5), (7, 6)], 'HEART': [(12, 7), (13, 5), (16, 5)], 'BASE': [(25, 7), (41, 7), (37, 4)]},
    {'brand_index': 2, 'TOP': [(10, 6), (7, 7), (0, 6)], 'HEART': [(12, 8), (14, 7), (13, 5)], 'BASE': [(25, 6), (41, 6), (37, 5)]},
    {'brand_index': 3, 'TOP': [(4, 8), (9, 6), (11, 5)], 'HEART': [(12, 6), (20, 7), (22, 5)], 'BASE': [(29, 7), (30, 4), (37, 6)]},
    {'brand_index': 4, 'TOP': [(1, 9), (3, 8), (0, 9)], 'HEART': [(12, 5), (21, 4), (24, 4)], 'BASE': [(25, 9), (37, 5), (41, 5)]},
    {'brand_index': 5, 'TOP': [(8, 5), (9, 4), (11, 3)], 'HEART': [(12, 7), (18, 6), (16, 5)], 'BASE': [(26, 8), (27, 8), (28, 7), (37, 6)]},
]

SERVING_REC_SEEDS = [
    {'brand_index': 0, 'serving_temp_min': 4, 'serving_temp_max': 7, 'glass_type': 'Пилснер бокал 0.5л'},
    {'brand_index': 1, 'serving_temp_min': 5, 'serving_temp_max': 8, 'glass_type': 'Лагерный бокал 0.5л'},
    {'brand_index': 2, 'serving_temp_min': 5, 'serving_temp_max': 8, 'glass_type': 'Лагерный бокал 0.5л'},
    {'brand_index': 3, 'serving_temp_min': 4, 'serving_temp_max': 7, 'glass_type': 'Вайцен бокал 0.5л'},
    {'brand_index': 4, 'serving_temp_min': 8, 'serving_temp_max': 12, 'glass_type': 'Шамрок / IPA бокал'},
    {'brand_index': 5, 'serving_temp_min': 10, 'serving_temp_max': 13, 'glass_type': 'Тапира / Пинта'},
]

COURSE_SEEDS = [
    {'level': 1, 'title': 'Новичок', 'description': 'Базовое знакомство с пивом: стили, крепость, плотность, первые ощущения от вкуса', 'color': '#f59e0b'},
    {'level': 2, 'title': 'Исследователь', 'description': 'Глубже в пирамиду: распознавание TOP/HEART/BASE нот, хмель vs солод', 'color': '#84cc16'},
    {'level': 3, 'title': 'Знаток', 'description': 'Food pairing, сезонность, температура подачи, анализ полного профиля', 'color': '#0ea5e9'},
    {'level': 4, 'title': 'Сомелье', 'description': 'Профессиональный уровень: дегустация вслепую, описание по лексикону FlavorActiV, подбор пива для гостей', 'color': '#8b5cf6'},
]

TEAM_MEMBER_SEEDS = [
    {'name': 'Айгерим Нурланова', 'role': 'Основатель / Сомелье', 'bio': 'Пивной сомелье, сертифицированный по WSET. 8 лет в индустрии HoReCa, автор методологии Flavor Tree.', 'avatar': 'https://placehold.co/200x200/f59e0b/fff?text=А'},
    {'name': 'Дамир Сапаров', 'role': 'Технолог / Brewmaster', 'bio': 'Инженер-технолог пивоварения. Разрабатывает рецептуры и контролирует качество пива для программы Flavor Tree.', 'avatar': 'https://placehold.co/200x200/84cc16/fff?text=Д'},
    {'name': 'Елена Коваль', 'role': 'Food Pairing Specialist', 'bio': 'Шеф-повар, специалист по подобию еды и пива. Автор курса «Пивной pairing для ресторанов».', 'avatar': 'https://placehold.co/200x200/0ea5e9/fff?text=Е'},
    {'name': 'Тимур Ахметов', 'role': 'Разработка / Product', 'bio': 'Fullstack-разработчик. Строит платформу Flavor Tree — от API до мобильного приложения.', 'avatar': 'https://placehold.co/200x200/8b5cf6/fff?text=Т'},
]


class Command(BaseCommand):
    help = 'Загрузить демо-данные Flavor Tree (идемпотентно)'

    def handle(self, *args, **options):
        self.stdout.write('Очистка старых данных...')
        TeamMember.objects.all().delete()
        Course.objects.all().delete()
        FlavorProfile.objects.all().delete()
        ServingRecommendation.objects.all().delete()
        Brand.objects.all().delete()
        FlavorNote.objects.all().delete()

        # 1. Flavor Notes
        self.stdout.write('Загрузка вкусовых нот...')
        notes = []
        for i, seed in enumerate(FLAVOR_NOTE_SEEDS):
            notes.append(FlavorNote.objects.create(
                name=seed['name'],
                technical_term=seed.get('technical_term', ''),
                wheel_code=seed.get('wheel_code', ''),
                category=seed['category'],
                description=seed['description'],
                icon=seed['icon'],
                reference_material=seed.get('reference_material', ''),
                is_off_flavour=seed.get('is_off_flavour', False),
                sort_order=i,
            ))

        # 2. Brands
        self.stdout.write('Загрузка брендов...')
        brands = []
        for seed in BRAND_SEEDS:
            brands.append(Brand.objects.create(**seed))

        # 3. Flavor Profiles
        self.stdout.write('Загрузка вкусовых профилей...')
        profile_count = 0
        for ps in PROFILE_SEEDS:
            brand = brands[ps['brand_index']]
            for layer in ['TOP', 'HEART', 'BASE']:
                for note_idx, intensity in ps[layer]:
                    FlavorProfile.objects.create(
                        brand=brand,
                        flavor_note=notes[note_idx],
                        layer=layer,
                        intensity=intensity,
                        sommelier_name='Айгерим Нурланова',
                    )
                    profile_count += 1

        # 4. Serving Recommendations
        self.stdout.write('Загрузка рекомендаций по подаче...')
        for rec in SERVING_REC_SEEDS:
            ServingRecommendation.objects.create(
                brand=brands[rec['brand_index']],
                serving_temp_min=rec['serving_temp_min'],
                serving_temp_max=rec['serving_temp_max'],
                glass_type=rec['glass_type'],
            )

        # 5. Courses
        self.stdout.write('Загрузка курсов...')
        for seed in COURSE_SEEDS:
            Course.objects.create(**seed)

        # 6. Team
        self.stdout.write('Загрузка команды...')
        for seed in TEAM_MEMBER_SEEDS:
            TeamMember.objects.create(**seed)

        self.stdout.write(self.style.SUCCESS(
            f'✅ Seed complete: '
            f'{len(notes)} нот, '
            f'{len(brands)} брендов, '
            f'{profile_count} профилей, '
            f'{len(SERVING_REC_SEEDS)} рекомендаций, '
            f'{len(COURSE_SEEDS)} курсов, '
            f'{len(TEAM_MEMBER_SEEDS)} членов команды'
        ))

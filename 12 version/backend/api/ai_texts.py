"""
Тексты ИИ-сомелье на трёх языках: русский (основной), казахский (базовые фразы) и английский.

Язык гостя определяется по последней реплике. Названия блюд и напитков не переводятся:
в казахских фразах они стоят в кавычках перед словом «тағамына», чтобы не склонять их.
"""
import re
from decimal import ROUND_HALF_UP, Decimal

LANGS = ('ru', 'kk', 'en')

KK_LETTERS_RE = re.compile('[әғқңөұүһі]')
KK_WORDS_RE = re.compile(
    r'\b(қандай|кандай|маған|маган|бар ма|керек|сыра|тағам|ұсын|жарай|жақсы|сусын|рахмет|сәлем|салем|'
    r'алкогольсіз|ішемін|ішсем|жеймін|бересіз)\b')
EN_WORDS_RE = re.compile(
    r"\b(what|which|beer|wine|drink|drinks|with|for|recommend|suggest|hello|hi|hey|thanks|thank|please|goes|go|"
    r"pair|pairs|food|non|alcohol|alcoholic|i|i'm|im|my|is|the|a|and|to|something|good|best|dish|eat)\b")


def detect_lang(text):
    """ru, kk или en по одной реплике. Смешанный или непонятный текст считается русским."""
    t = (text or '').lower()
    if KK_LETTERS_RE.search(t) or KK_WORDS_RE.search(t):
        return 'kk'
    letters = re.findall(r'[a-zа-яё]', t)
    latin = sum(1 for c in letters if 'a' <= c <= 'z')
    cyrillic = len(letters) - latin
    if latin and latin > cyrillic * 2 and EN_WORDS_RE.search(t):
        return 'en'
    return 'ru'


TEXTS = {
    # Приветствие, благодарность, вне темы, непонятный вопрос
    'greet_venue': {
        'ru': 'Здравствуйте! Я сомелье Flavor Tree: подберу блюдо из меню и напиток к нему. '
              'Назовите блюдо или скажите, чего хочется: полегче, поплотнее, без горечи или без алкоголя.',
        'kk': 'Сәлеметсіз бе! Мен Flavor Tree сомельесімін: мәзірден тағам мен оған сай сусын таңдап беремін. '
              'Тағамның атын айтыңыз немесе қандай сусын қалайтыныңызды жазыңыз.',
        'en': "Hello! I'm the Flavor Tree sommelier: I'll pick a dish from the menu and a drink to go with it. "
              'Name a dish or tell me what you feel like: lighter, fuller, not bitter or alcohol-free.',
    },
    'greet_catalog': {
        'ru': 'Здравствуйте! Я сомелье Flavor Tree: подберу напиток к блюду по вкусовому движку. '
              'Назовите блюдо или скажите, чего хочется: полегче, без горечи или без алкоголя.',
        'kk': 'Сәлеметсіз бе! Мен Flavor Tree сомельесімін: тағамға сай сусын таңдап беремін. '
              'Тағамның атын айтыңыз.',
        'en': "Hello! I'm the Flavor Tree sommelier: I'll match a drink to your dish using our flavour engine. "
              'Name a dish or tell me what you feel like.',
    },
    'thanks': {
        'ru': 'Рад помочь. Если захотите подобрать что-то ещё, я рядом.',
        'kk': 'Көмектескеніме қуаныштымын. Тағы бірдеңе таңдау керек болса, жазыңыз.',
        'en': "Happy to help. If you'd like to pick something else, I'm here.",
    },
    'offtopic': {
        'ru': 'Я подбираю еду и напитки, с другими темами не помогу. Назовите блюдо или вкус, '
              'например «что взять к шашлыку» или «хочу что-то лёгкое».',
        'kk': 'Мен тек тағам мен сусын таңдауға көмектесемін. '
              'Тағамның атын айтыңыз, мысалы «шашлыққа не ішуге болады».',
        'en': "I only help with food and drinks. Name a dish or a taste, for example "
              "'what goes with shashlik' or 'something light'.",
    },
    'unclear': {
        'ru': 'Могу подобрать напиток к блюду или блюдо к напитку.',
        'kk': 'Тағамға сусын немесе сусынға тағам таңдап бере аламын.',
        'en': 'I can match a drink to a dish or a dish to a drink.',
    },
    'unclear_options': {
        'ru': 'Например, {options}.',
        'kk': 'Мысалы, {options}.',
        'en': 'For example, {options}.',
    },
    'ask_closer': {
        'ru': 'Что вам ближе: поплотнее или полегче?',
        'kk': 'Сізге қайсысы ұнайды: жеңілірек пе, әлде қоюырақ па?',
        'en': 'Would you like something lighter or fuller?',
    },
    'ask_dish': {
        'ru': 'Скажите, что будете есть, и я подберу точнее.',
        'kk': 'Не жейтініңізді айтыңыз, дәлірек таңдап беремін.',
        'en': "Tell me what you'll eat and I'll narrow it down.",
    },
    'menu_empty': {
        'ru': 'Меню этого заведения пока пустое, предложить нечего.',
        'kk': 'Бұл мекеменің мәзірі әзірге бос.',
        'en': "This venue's menu is empty for now.",
    },

    # Подбор к блюду
    'pair_lead': {
        'ru': 'К блюду «{dish}» советую {drink}: {reason}.',
        'kk': '«{dish}» тағамына {drink} жарасады: {reason}.',
        'en': 'For «{dish}» I suggest {drink}: {reason}.',
    },
    'pair_lead_cart': {
        'ru': 'К блюду «{dish}» из вашего заказа советую {drink}: {reason}.',
        'kk': 'Тапсырысыңыздағы «{dish}» тағамына {drink} жарасады: {reason}.',
        'en': 'For the «{dish}» in your order I suggest {drink}: {reason}.',
    },
    'pair_lead_plain': {
        'ru': 'К блюду «{dish}» советую {drink}.',
        'kk': '«{dish}» тағамына {drink} ұсынамын.',
        'en': 'For «{dish}» I suggest {drink}.',
    },
    'pair_lead_cart_plain': {
        'ru': 'К блюду «{dish}» из вашего заказа советую {drink}.',
        'kk': 'Тапсырысыңыздағы «{dish}» тағамына {drink} ұсынамын.',
        'en': 'For the «{dish}» in your order I suggest {drink}.',
    },
    'pair_second': {
        'ru': 'Второй вариант: {drink}.',
        'kk': 'Екінші нұсқа: {drink}.',
        'en': 'Another option: {drink}.',
    },
    'pair_efes': {
        'ru': 'Из пива портфеля Efes к нему лучше всего подходит {drink}.',
        'kk': 'Efes портфеліндегі сыралардан оған ең жақсысы: {drink}.',
        'en': 'From the Efes beer portfolio the best match is {drink}.',
    },
    'pair_score': {
        'ru': 'Оценка вкусового движка: {score} из 100.',
        'kk': 'Дәм қозғалтқышының бағасы: 100-ден {score}.',
        'en': 'Flavour engine score: {score} out of 100.',
    },
    'pair_none': {
        'ru': 'К блюду «{dish}» подходящего напитка в карте сейчас нет.',
        'kk': '«{dish}» тағамына қазір картада сай сусын жоқ.',
        'en': 'There is no suitable drink for «{dish}» on the list right now.',
    },
    'dish_not_on_menu': {
        'ru': '«{dish}» в меню этого заведения нет.',
        'kk': 'Бұл мекеменің мәзірінде «{dish}» жоқ.',
        'en': "«{dish}» is not on this venue's menu.",
    },
    'dish_similar': {
        'ru': 'Из похожего в меню есть «{dish}».',
        'kk': 'Мәзірде ұқсас тағам бар: «{dish}».',
        'en': 'A similar dish on the menu is «{dish}».',
    },
    'pair_weak': {
        'ru': 'К блюду «{dish}» в карте нет удачной пары по вкусовому движку, поэтому напиток к нему не советую.',
        'kk': '«{dish}» тағамына картада дәм қозғалтқышы бойынша сәтті сусын жоқ.',
        'en': 'The flavour engine finds no good match for «{dish}» on this list, so I will not push a drink with it.',
    },
    'dish_unavailable': {
        'ru': 'Учтите: блюда «{dish}» сегодня нет в наличии.',
        'kk': 'Ескеріңіз: бүгін «{dish}» жоқ.',
        'en': 'Note: «{dish}» is not available today.',
    },
    'filter_relaxed': {
        'ru': 'Точно под ваше пожелание ничего нет, поэтому предлагаю ближайшее.',
        'kk': 'Дәл сіздің қалауыңызға сай сусын жоқ, сондықтан ең жақынын ұсынамын.',
        'en': "Nothing matches that exactly, so here is the closest option.",
    },
    'category_missing': {
        'ru': 'Напитков из категории «{category}» здесь сейчас нет.',
        'kk': 'Қазір «{category}» санатындағы сусын жоқ.',
        'en': 'There is no {category} here right now.',
    },
    'budget_none': {
        'ru': 'В пределах {budget} подходящего напитка в карте нет.',
        'kk': '{budget} шегінде сай сусын жоқ.',
        'en': 'There is no suitable drink within {budget} on the list.',
    },
    'budget_catalog': {
        'ru': 'Цены зависят от заведения, в общем каталоге их нет. Откройте меню своего бара по QR-коду на столе, '
              'и я подберу в пределах {budget}.',
        'kk': 'Баға мекемеге байланысты, жалпы каталогта баға жоқ. Үстелдегі QR-код арқылы бар мәзірін ашыңыз.',
        'en': 'Prices depend on the venue and the general catalogue has none. Open your bar menu via the QR code '
              'on the table and I will stay within {budget}.',
    },
    'cheaper_catalog': {
        'ru': 'Цены зависят от заведения, в общем каталоге их нет. Откройте меню своего бара по QR-коду на столе, '
              'и я подберу подешевле.',
        'kk': 'Баға мекемеге байланысты, жалпы каталогта баға жоқ. Үстелдегі QR-код арқылы бар мәзірін ашыңыз.',
        'en': 'Prices depend on the venue and the general catalogue has none. Open your bar menu via the QR code '
              'on the table and I will find something cheaper.',
    },
    'cheaper_lead': {
        'ru': 'Подешевле: {drinks}.',
        'kk': 'Арзанырақ: {drinks}.',
        'en': 'Cheaper options: {drinks}.',
    },

    # Подбор без блюда: пожелания
    'list_na': {
        'ru': 'Из безалкогольного советую {drinks}.',
        'kk': 'Алкогольсіз сусындардан {drinks} ұсынамын.',
        'en': 'Alcohol-free, I suggest {drinks}.',
    },
    'list_light': {
        'ru': 'Самое лёгкое и освежающее: {drinks}.',
        'kk': 'Ең жеңіл әрі сергітетіні: {drinks}.',
        'en': 'The lightest and most refreshing: {drinks}.',
    },
    'list_nobitter': {
        'ru': 'Без выраженной горечи: {drinks}.',
        'kk': 'Ащылығы аз сусындар: {drinks}.',
        'en': 'Without noticeable bitterness: {drinks}.',
    },
    'list_bitter': {
        'ru': 'С выраженной хмелевой горечью: {drinks}.',
        'kk': 'Ащылығы айқын сусындар: {drinks}.',
        'en': 'With a clear hop bitterness: {drinks}.',
    },
    'list_dark': {
        'ru': 'Из тёмного и плотного: {drinks}.',
        'kk': 'Қою әрі қара сусындардан: {drinks}.',
        'en': 'Dark and full-bodied: {drinks}.',
    },
    'list_strong': {
        'ru': 'Из более крепкого: {drinks}. Такое пиво лучше пить не спеша и с едой.',
        'kk': 'Күштірек сусындардан: {drinks}. Оны асықпай, тамақпен бірге ішкен дұрыс.',
        'en': 'Stronger options: {drinks}. Best sipped slowly and with food.',
    },
    'list_sweet': {
        'ru': 'С мягкой сладостью: {drinks}.',
        'kk': 'Тәттілеу сусындар: {drinks}.',
        'en': 'With a gentle sweetness: {drinks}.',
    },
    'list_budget': {
        'ru': 'В пределах {budget}: {drinks}.',
        'kk': '{budget} шегінде: {drinks}.',
        'en': 'Within {budget}: {drinks}.',
    },
    'list_category': {
        'ru': 'Из категории «{category}»: {drinks}.',
        'kk': '«{category}» санатынан: {drinks}.',
        'en': 'From «{category}»: {drinks}.',
    },
    'list_efes': {
        'ru': 'Из портфеля Efes: {drinks}.',
        'kk': 'Efes портфелінен: {drinks}.',
        'en': 'From the Efes portfolio: {drinks}.',
    },
    'list_none': {
        'ru': 'Под это пожелание в карте сейчас ничего нет.',
        'kk': 'Бұл қалауға сай сусын қазір жоқ.',
        'en': 'Nothing on the list matches that right now.',
    },
    'no_energy': {
        'ru': 'Энергетики я не советую ни к еде, ни отдельно.',
        'kk': 'Энергетиктерді тамаққа да, бөлек те ұсынбаймын.',
        'en': "I don't recommend energy drinks, with food or on their own.",
    },
    'family_missing': {
        'ru': '{family} здесь сейчас нет, поэтому предлагаю ближайшее.',
        'kk': 'Қазір {family} жоқ, сондықтан ең жақынын ұсынамын.',
        'en': 'There is no {family} here right now, so here is the closest option.',
    },
    'no_na_in_bar': {
        'ru': 'Безалкогольных напитков в карте этого бара сейчас нет, попросите у официанта воду или чай.',
        'kk': 'Бұл бардың картасында қазір алкогольсіз сусын жоқ, даяшыдан су немесе шай сұраңыз.',
        'en': "This bar has no alcohol-free drinks on its list right now; ask the waiter for water or tea.",
    },

    # Блюда
    'dishes_dessert': {
        'ru': 'Из десертов советую: {combos}.',
        'kk': 'Десерттерден {combos} ұсынамын.',
        'en': 'For dessert I suggest {combos}.',
    },
    'dishes_meat': {
        'ru': 'Из мясного и гриля советую: {combos}.',
        'kk': 'Ет пен грильден {combos} ұсынамын.',
        'en': 'From meat and grill I suggest {combos}.',
    },
    'dishes_spicy': {
        'ru': 'Из острого советую: {combos}.',
        'kk': 'Ащы тағамдардан {combos} ұсынамын.',
        'en': 'For something spicy I suggest {combos}.',
    },
    'dishes_advise': {
        'ru': 'Из меню советую: {combos}.',
        'kk': 'Мәзірден {combos} алуға кеңес беремін.',
        'en': 'From the menu I would take {combos}.',
    },
    'dishes_advise_catalog': {
        'ru': 'Для начала советую: {combos}.',
        'kk': 'Бастау үшін {combos} ұсынамын.',
        'en': 'To start, I would suggest {combos}.',
    },
    'dishes_none': {
        'ru': 'Таких блюд в меню сейчас нет. Скажите, чего хочется, и я подберу из того, что есть.',
        'kk': 'Мәзірде қазір ондай тағам жоқ.',
        'en': 'There are no such dishes on the menu right now.',
    },
    'reason_popular': {'ru': 'Блюдо с самой удачной парой в карте', 'kk': 'Картадағы ең сәтті жұбы бар тағам',
                       'en': 'The dish with the best match on the list'},
    'reason_best': {'ru': 'Одно из самых удачных блюд по вкусовому движку', 'kk': 'Дәм қозғалтқышы бойынша сәтті тағам',
                    'en': 'One of the best dishes by the flavour engine'},
    'reason_dessert': {'ru': 'Десерт из меню', 'kk': 'Мәзірдегі десерт', 'en': 'Dessert from the menu'},
    'reason_meat': {'ru': 'Мясное блюдо из меню', 'kk': 'Мәзірдегі ет тағамы', 'en': 'Meat dish from the menu'},
    'reason_spicy': {'ru': 'Острое блюдо из меню', 'kk': 'Мәзірдегі ащы тағам', 'en': 'Spicy dish from the menu'},
    'reason_light': {'ru': 'Лёгкий и освежающий', 'kk': 'Жеңіл әрі сергітетін', 'en': 'Light and refreshing'},
    'reason_nobitter': {'ru': 'Мягкий, без выраженной горечи', 'kk': 'Жұмсақ, ащылығы аз', 'en': 'Soft, not bitter'},
    'reason_bitter': {'ru': 'С выраженной хмелевой горечью', 'kk': 'Ащылығы айқын', 'en': 'Clearly hoppy and bitter'},
    'reason_dark': {'ru': 'Тёмный и плотный', 'kk': 'Қою әрі қара', 'en': 'Dark and full-bodied'},
    'reason_strong': {'ru': 'Крепче обычного лагера', 'kk': 'Әдеттегі лагерден күштірек',
                      'en': 'Stronger than a usual lager'},
    'reason_sweet': {'ru': 'С мягкой сладостью', 'kk': 'Тәттілеу', 'en': 'Gently sweet'},
    'reason_zero': {'ru': 'Без алкоголя', 'kk': 'Алкогольсіз', 'en': 'Alcohol-free'},
    'combo': {
        'ru': '{dish}, а к нему {drink}',
        'kk': '{dish}, оған {drink}',
        'en': '{dish} with {drink}',
    },
    'or': {'ru': ' или ', 'kk': ' немесе ', 'en': ' or '},
    'and': {'ru': ' и ', 'kk': ' және ', 'en': ' and '},
    'celebrate': {
        'ru': 'Поздравляю! Для праздничного стола советую: {combos}. Сколько вас за столом? Подберу на компанию.',
        'kk': 'Құттықтаймын! Мерекелік дастарханға {combos} ұсынамын.',
        'en': 'Congratulations! For a celebration I suggest {combos}. How many of you are at the table?',
    },
    'drink_info': {
        'ru': '{drink}: {facts}.',
        'kk': '{drink}: {facts}.',
        'en': '{drink}: {facts}.',
    },
    'drink_best_dishes': {
        'ru': 'Лучше всего к нему: {dishes}.',
        'kk': 'Оған ең жақсы тағамдар: {dishes}.',
        'en': 'It goes best with {dishes}.',
    },
    'drink_compare': {
        'ru': 'Вкус дело личное, поэтому лучше выбирать под блюдо: назовите его, и я скажу, что подойдёт больше.',
        'kk': 'Дәм әркімде әртүрлі, сондықтан тағамға қарай таңдаған дұрыс: тағамды айтыңыз.',
        'en': "Taste is personal, so it's best to choose by dish: name it and I'll tell you which fits better.",
    },
    'drink_not_listed': {
        'ru': '{drink} в карте этого бара нет.',
        'kk': 'Бұл бардың картасында {drink} жоқ.',
        'en': "{drink} is not on this bar's list.",
    },

    # Ответственное потребление и безопасность
    'disclaimer': {
        'ru': 'Алкоголь только для гостей старше 21 года. Пожалуйста, пейте умеренно.',
        'kk': 'Алкоголь 21 жастан асқан қонақтарға ғана беріледі. Мөлшерден асырмаңыз.',
        'en': 'Alcohol is for guests aged 21 and over only. Please drink responsibly.',
    },
    'allergy_note': {
        'ru': 'Точного состава блюд я не знаю, поэтому про аллергию обязательно спросите официанта.',
        'kk': 'Тағам құрамын нақты білмеймін, аллергия туралы даяшыдан міндетті түрде сұраңыз.',
        'en': "I don't know the exact recipes, so please ask the waiter about allergies.",
    },
    'safety_options': {
        'ru': 'Из безалкогольного подойдут: {drinks}.',
        'kk': 'Алкогольсіз нұсқалар: {drinks}.',
        'en': 'Alcohol-free options: {drinks}.',
    },
    'safety_option_one': {
        'ru': 'Из безалкогольного подойдёт {drinks}.',
        'kk': 'Алкогольсіз нұсқа: {drinks}.',
        'en': 'An alcohol-free option: {drinks}.',
    },
    'safety_pair': {
        'ru': 'К блюду «{dish}» из этого подойдёт {drink}: {reason}.',
        'kk': '«{dish}» тағамына {drink} жарасады: {reason}.',
        'en': 'For «{dish}» the best of these is {drink}: {reason}.',
    },
    'safety_water_tea': {
        'ru': 'Попросите у официанта воду или чай.',
        'kk': 'Даяшыдан су немесе шай сұраңыз.',
        'en': 'Ask the waiter for water or tea.',
    },

    # v2.4: справка, цена, сравнение, еда к напитку, исключение категории, компания, популярное
    'glossary_example': {
        'ru': 'Здесь из таких: {drinks}.',
        'kk': 'Мұнда солардың ішінен: {drinks}.',
        'en': 'Examples here: {drinks}.',
    },
    'glossary_unknown': {
        'ru': 'Про «{term}» рассказать не могу, я разбираюсь в напитках и их сочетаниях с едой. '
              'Спросите, например, что такое лагер или что взять к шашлыку.',
        'kk': '«{term}» туралы айта алмаймын, мен сусындар мен тағамға сәйкестігін білемін. '
              'Мысалы, лагер деген не немесе шашлыққа не алу керек деп сұраңыз.',
        'en': "I can't explain «{term}», I know drinks and how they pair with food. "
              'Ask, for example, what a lager is or what goes with shashlyk.',
    },
    'price_dish': {
        'ru': '«{name}»: {facts}.',
        'kk': '«{name}»: {facts}.',
        'en': '«{name}»: {facts}.',
    },
    'price_unknown': {
        'ru': 'Цены на «{name}» у меня нет, уточните у официанта.',
        'kk': '«{name}» бағасы менде жоқ, даяшыдан сұраңыз.',
        'en': "I don't have a price for «{name}», please ask the waiter.",
    },
    'price_catalog': {
        'ru': 'Цены зависят от заведения: откройте меню бара по QR-коду на столе, и я покажу их.',
        'kk': 'Бағалар мекемеге байланысты: үстелдегі QR-код арқылы бар мәзірін ашыңыз, көрсетемін.',
        'en': 'Prices depend on the venue: open the bar menu via the QR code on the table and I will show them.',
    },
    'compare_lighter': {
        'ru': 'Легче {a}: {a_val} против {b_val} у {b}.',
        'kk': '{a} жеңілірек: {a_val}, ал {b}: {b_val}.',
        'en': '{a} is lighter: {a_val} versus {b_val} for {b}.',
    },
    'compare_stronger': {
        'ru': 'Крепче {a}: {a_val} против {b_val} у {b}.',
        'kk': '{a} күштірек: {a_val}, ал {b}: {b_val}.',
        'en': '{a} is stronger: {a_val} versus {b_val} for {b}.',
    },
    'compare_cheaper': {
        'ru': 'Дешевле {a}: {a_val} против {b_val} у {b}.',
        'kk': '{a} арзанырақ: {a_val}, ал {b}: {b_val}.',
        'en': '{a} is cheaper: {a_val} versus {b_val} for {b}.',
    },
    'compare_pricier': {
        'ru': 'Дороже {a}: {a_val} против {b_val} у {b}.',
        'kk': '{a} қымбатырақ: {a_val}, ал {b}: {b_val}.',
        'en': '{a} is pricier: {a_val} versus {b_val} for {b}.',
    },
    'compare_bitter': {
        'ru': 'Горче {a}, у {b} горечь мягче.',
        'kk': '{a} ащырақ, {b} жұмсағырақ.',
        'en': '{a} is more bitter, {b} is softer.',
    },
    'compare_same': {
        'ru': 'По этому они почти одинаковы: {a} и {b}.',
        'kk': 'Бұл жағынан олар шамалас: {a} және {b}.',
        'en': 'They are about the same on that: {a} and {b}.',
    },
    'dishes_for_category': {
        'ru': 'К {category} из меню лучше всего: {combos}.',
        'kk': '{category} үшін мәзірден ең жақсысы: {combos}.',
        'en': 'With {category}, the best from the menu: {combos}.',
    },
    'dishes_for_category_catalog': {
        'ru': 'К {category} лучше всего подходят: {combos}.',
        'kk': '{category} үшін ең жақсысы: {combos}.',
        'en': 'With {category}, the best matches are: {combos}.',
    },
    'list_excluding': {
        'ru': 'Кроме {category} здесь есть: {drinks}.',
        'kk': '{category} басқа мұнда бар: {drinks}.',
        'en': 'Besides {category}, there is: {drinks}.',
    },
    'list_alternatives': {
        'ru': '{category} в карте этого бара нет. Из того, что есть: {drinks}.',
        'kk': 'Бұл бардың картасында {category} жоқ. Бар нәрседен: {drinks}.',
        'en': 'There is no {category} on this bar\'s list. From what there is: {drinks}.',
    },
    'dishes_party': {
        'ru': 'На компанию советую: {combos}.',
        'kk': 'Компанияға ұсынамын: {combos}.',
        'en': 'For the table I suggest: {combos}.',
    },
    'dishes_party_budget': {
        'ru': 'В {budget} на компанию укладывается: {combos}.',
        'kk': '{budget} компанияға жетеді: {combos}.',
        'en': 'Within {budget} for the table: {combos}.',
    },
    'dishes_popular': {
        'ru': 'Самые удачные пары в этом меню: {combos}.',
        'kk': 'Бұл мәзірдегі ең сәтті жұптар: {combos}.',
        'en': 'The strongest pairings on this menu: {combos}.',
    },
    'greet_help': {
        'ru': 'У меня всё хорошо, спасибо. Я подбираю напиток к блюду и блюдо к напитку, могу сравнить два сорта, '
              'сказать цену и крепость или объяснить, что такое лагер или IPA. С чего начнём?',
        'kk': 'Жақсымын, рахмет. Тағамға сусын, сусынға тағам таңдаймын, екі сортты салыстырамын, бағасы мен '
              'күштілігін айтамын. Неден бастаймыз?',
        'en': "I'm fine, thanks. I pair drinks with dishes and dishes with drinks, compare two beers, tell prices "
              'and strength, or explain what a lager or an IPA is. Where shall we start?',
    },
}

# Ответы правил безопасности: первая фраза, когда гость сказал об этом сейчас,
# и короткое напоминание, когда он сказал об этом раньше в этом же чате.
SAFETY_TEXTS = {
    'minor': {
        'ru': ('В Казахстане алкоголь продаётся только с 21 года, поэтому алкоголь я не предлагаю. '
               'Зато подберу вкусное блюдо и безалкогольный напиток к нему.',
               'Помню, что вам нет 21, поэтому предлагаю только безалкогольное.'),
        'kk': ('Қазақстанда алкоголь 21 жастан бастап сатылады, сондықтан алкоголь ұсынбаймын. '
               'Оның орнына дәмді тағам мен алкогольсіз сусын таңдап беремін.',
               'Сізге әлі 21 жас толмағанын ескеріп, тек алкогольсіз сусын ұсынамын.'),
        'en': ('In Kazakhstan alcohol is sold only from age 21, so I will not suggest any. '
               'I can pick a tasty dish and an alcohol-free drink for you instead.',
               "Since you're under 21, I'm only suggesting alcohol-free drinks."),
    },
    'driving': {
        'ru': ('Раз вы за рулём, алкоголь не предлагаю, даже лёгкий. Хорошо, что есть вкусные безалкогольные варианты.',
               'Помню, что вы за рулём, поэтому только безалкогольное.'),
        'kk': ('Көлік жүргізетін болсаңыз, алкоголь ұсынбаймын, тіпті жеңілін де. Алкогольсіз дәмді нұсқалар бар.',
               'Көлік жүргізетініңізді ескеріп, тек алкогольсіз сусын ұсынамын.'),
        'en': ("Since you're driving, I won't suggest any alcohol, not even a light one. "
               'There are good alcohol-free options.',
               "Remembering that you're driving, I'm only suggesting alcohol-free drinks."),
    },
    'pregnancy': {
        'ru': ('Во время беременности и кормления алкоголь лучше не пить, даже безалкогольное пиво бывает до 0,5%. '
               'Предложу воду, сок, лимонад или чай.',
               'Помню о вашем положении, поэтому предлагаю только напитки без алкоголя.'),
        'kk': ('Жүктілік пен емізу кезінде алкоголь ішпеген дұрыс, алкогольсіз сырада да 0,5%-ға дейін болады. '
               'Су, шырын, лимонад немесе шай ұсынамын.',
               'Жағдайыңызды ескеріп, тек алкогольсіз сусын ұсынамын.'),
        'en': ('During pregnancy and breastfeeding it is best to avoid alcohol; even alcohol-free beer can contain '
               'up to 0.5%. I can suggest water, juice, lemonade or tea.',
               "Keeping your situation in mind, I'm only suggesting drinks without alcohol."),
    },
    'medication': {
        'ru': ('Если вы принимаете лекарства, алкоголь не предлагаю: сочетание может быть опасным. '
               'Выберем что-то без алкоголя, а по лекарствам лучше спросить врача.',
               'Помню про лекарства, поэтому только без алкоголя.'),
        'kk': ('Дәрі қабылдап жүрсеңіз, алкоголь ұсынбаймын: бұл қауіпті болуы мүмкін. Алкогольсіз сусын таңдайық.',
               'Дәрі қабылдайтыныңызды ескеріп, тек алкогольсіз сусын ұсынамын.'),
        'en': ("If you're taking medication, I won't suggest alcohol: the combination can be risky. "
               "Let's pick something alcohol-free, and ask your doctor about the medicine.",
               "Remembering the medication, I'm only suggesting alcohol-free drinks."),
    },
    'gluten': {
        'ru': ('В пиве, безалкогольном пиве и квасе есть глютен. Чтобы не рисковать, предлагаю только напитки '
               'без алкоголя и без злаков. Состав блюд обязательно уточните у официанта.',
               'Помню про глютен, поэтому предлагаю только напитки без алкоголя и без злаков.'),
        'kk': ('Сыра, алкогольсіз сыра мен квас құрамында глютен бар. Қауіп төндірмеу үшін тек алкогольсіз '
               'әрі дәнсіз сусын ұсынамын. Тағам құрамын даяшыдан міндетті түрде сұраңыз.',
               'Глютенді ескеріп, тек алкогольсіз әрі дәнсіз сусын ұсынамын.'),
        'en': ('Beer, alcohol-free beer and kvass contain gluten. To be safe, I am only suggesting drinks with no '
               'alcohol and no grain. Please check the dishes with the waiter.',
               "Remembering the gluten, I'm only suggesting drinks with no alcohol and no grain."),
    },
    'emotional': {
        'ru': ('Сочувствую, такие дни бывают. Алкоголь плохой помощник, когда на душе тяжело, '
               'поэтому предложу что-то вкусное без алкоголя.',
               'Сегодня предлагаю только без алкоголя, так будет бережнее.'),
        'kk': ('Түсінемін, ондай күндер болады. Көңіл-күй түскенде алкоголь көмектеспейді, '
               'сондықтан дәмді тағам мен алкогольсіз сусын ұсынамын.',
               'Бүгін тек алкогольсіз сусын ұсынамын.'),
        'en': ("I'm sorry, days like this happen. Alcohol is a poor helper when you feel down, "
               'so let me suggest something tasty and alcohol-free.',
               "Today I'm only suggesting alcohol-free drinks."),
    },
    'child': {
        'ru': ('Для ребёнка подберу напиток без алкоголя и без энергетиков.',
               'Для ребёнка подбираю только напитки без алкоголя.'),
        'kk': ('Балаға алкогольсіз әрі энергетиксіз сусын таңдап беремін.',
               'Балаға тек алкогольсіз сусын ұсынамын.'),
        'en': ("For a child I'll pick a drink with no alcohol and no energy drinks.",
               "For a child I'm only suggesting alcohol-free drinks."),
    },
    'drunk': {
        'ru': ('Кажется, на сегодня алкоголя уже достаточно, больше не предлагаю. '
               'Выпейте воды или чая и перекусите, так будет лучше.',
               'Сегодня алкоголь больше не предлагаю, только воду, чай и безалкогольное.'),
        'kk': ('Бүгінге алкоголь жеткілікті сияқты, енді ұсынбаймын. Су немесе шай ішіп, бірдеңе жеп алыңыз.',
               'Бүгін алкоголь ұсынбаймын, тек су, шай және алкогольсіз сусын.'),
        'en': ("It sounds like that's enough alcohol for today, so I won't suggest more. "
               'Have some water or tea and a bite to eat.',
               "I'm not suggesting more alcohol today, only water, tea and alcohol-free drinks."),
    },
    'unwell': {
        'ru': ('Если вам нехорошо, лучше не пить алкоголь. Позовите официанта, вам принесут воду. '
               'Если станет хуже, не ждите и обратитесь за медицинской помощью.',
               'Помню, что вам нехорошо, поэтому алкоголь не предлагаю.'),
        'kk': ('Өзіңізді жаман сезінсеңіз, алкоголь ішпеген дұрыс. Даяшыны шақырыңыз, сізге су әкеледі. '
               'Жағдайыңыз нашарласа, дәрігерге жүгініңіз.',
               'Өзіңізді жаман сезінетініңізді ескеріп, алкоголь ұсынбаймын.'),
        'en': ("If you're not feeling well, it's better to skip alcohol. Call the waiter for some water. "
               "If it gets worse, don't wait and seek medical help.",
               "Remembering that you're unwell, I'm not suggesting alcohol."),
    },
}

# Короткие имена категорий напитков для текста ответа.
CATEGORY_LABELS = {
    'ru': {
        'beer': 'пиво', 'na_beer': 'безалкогольное пиво', 'radler': 'радлер', 'cider': 'сидр', 'wine': 'вино',
        'sparkling': 'игристое', 'fortified': 'креплёное вино', 'cocktail': 'коктейль', 'spirit': 'крепкий напиток',
        'liqueur': 'ликёр', 'kvass': 'квас', 'lemonade': 'лимонад', 'soda': 'газировка', 'dairy': 'кисломолочный',
        'tea': 'чай', 'coffee': 'кофе', 'water': 'вода',
    },
    'kk': {
        'beer': 'сыра', 'na_beer': 'алкогольсіз сыра', 'radler': 'радлер', 'cider': 'сидр', 'wine': 'шарап',
        'sparkling': 'көпіршікті шарап', 'fortified': 'күшейтілген шарап', 'cocktail': 'коктейль',
        'spirit': 'күшті ішімдік', 'liqueur': 'ликёр', 'kvass': 'квас', 'lemonade': 'лимонад', 'soda': 'газдалған су',
        'dairy': 'сүт сусыны', 'tea': 'шай', 'coffee': 'кофе', 'water': 'су',
    },
    'en': {
        'beer': 'beer', 'na_beer': 'alcohol-free beer', 'radler': 'radler', 'cider': 'cider', 'wine': 'wine',
        'sparkling': 'sparkling wine', 'fortified': 'fortified wine', 'cocktail': 'cocktail', 'spirit': 'spirit',
        'liqueur': 'liqueur', 'kvass': 'kvass', 'lemonade': 'lemonade', 'soda': 'soft drink', 'dairy': 'dairy drink',
        'tea': 'tea', 'coffee': 'coffee', 'water': 'water',
    },
}


# «К пиву», «к вину»: категория в дательном падеже для русского текста.
CATEGORY_DATIVE_RU = {
    'beer': 'пиву', 'na_beer': 'безалкогольному пиву', 'radler': 'радлеру', 'cider': 'сидру', 'wine': 'вину',
    'sparkling': 'игристому', 'fortified': 'креплёному вину', 'cocktail': 'коктейлю', 'spirit': 'крепкому',
    'liqueur': 'ликёру', 'kvass': 'квасу', 'lemonade': 'лимонаду', 'soda': 'газировке', 'dairy': 'кисломолочному',
    'tea': 'чаю', 'coffee': 'кофе', 'water': 'воде',
}


# «Кроме пива», «без вина»: родительный падеж.
CATEGORY_GENITIVE_RU = {
    'beer': 'пива', 'na_beer': 'безалкогольного пива', 'radler': 'радлера', 'cider': 'сидра', 'wine': 'вина',
    'sparkling': 'игристого', 'fortified': 'креплёного вина', 'cocktail': 'коктейлей', 'spirit': 'крепкого',
    'liqueur': 'ликёров', 'kvass': 'кваса', 'lemonade': 'лимонада', 'soda': 'газировки', 'dairy': 'кисломолочного',
    'tea': 'чая', 'coffee': 'кофе', 'water': 'воды',
}


def category_genitive(category, lang):
    if lang == 'ru':
        return CATEGORY_GENITIVE_RU.get(category) or category_label(category, lang)
    return category_label(category, lang)


def category_dative(category, lang):
    if lang == 'ru':
        return CATEGORY_DATIVE_RU.get(category) or category_label(category, lang)
    return category_label(category, lang)


# Справочник стилей и терминов: короткие определения для «что такое лагер», «чем отличается стаут от портера».
# match: как гость называет термин; style: как найти пример в карте (стиль или название), category: или категория.
GLOSSARY = {
    'lager': {
        'match': r'лагер|lager',
        'style': r'lager|лагер|pils|пилс|helles|хеллес|вычепни|výčepní',
        'ru': 'Лагер: пиво низового брожения при низкой температуре, вкус чистый, без фруктовых эфиров, подаётся '
              'холодным. Большинство светлого пива в Казахстане, включая Efes Pilsener, это лагеры.',
        'kk': 'Лагер: төмен температурада ашытылған сыра, дәмі таза, суық беріледі. Қазақстандағы ашық сыраның '
              'көбі, Efes Pilsener де, лагер.',
        'en': 'Lager is beer fermented cool with bottom-fermenting yeast: clean and crisp, served cold. Most pale beer '
              'in Kazakhstan, including Efes Pilsener, is lager.',
    },
    'ale': {
        'match': r'\bэль\b|\bэля\b|\bэли\b|\bэлем\b|\bale\b|\bales\b',
        'style': r'\bale\b|эль|ipa|stout|стаут|porter|портер|weiss|wit|пшенич|gose|гозе|saison',
        'ru': 'Эль: верховое брожение при более тёплой температуре, поэтому больше фруктовых и пряных нот, часто '
              'плотнее лагера. IPA, стаут, портер и пшеничное это эли.',
        'kk': 'Эль: жылырақ температурада жоғарғы ашыту, сондықтан жемісті және дәмдеуіш ноталары көбірек. '
              'IPA, стаут, портер және бидай сырасы эльге жатады.',
        'en': 'Ale is top-fermented at warmer temperatures, so it has more fruity and spicy notes and is often fuller '
              'than lager. IPA, stout, porter and wheat beer are ales.',
    },
    'pilsner': {
        'match': r'пилс|пилз|пильз|pils',
        'style': r'pils|пилс|пилз|пильз',
        'ru': 'Пилснер: светлый лагер родом из чешского Пльзеня, выраженная хмелевая горечь и сухое послевкусие, '
              'крепость около 4-5 %.',
        'kk': 'Пилснер: чех Пльзенінен шыққан ашық лагер, айқын құлмақ ащылығы мен құрғақ дәмі, күштілігі 4-5 %.',
        'en': 'Pilsner is a pale lager from Czech Pilsen: pronounced hop bitterness and a dry finish, about 4-5 % ABV.',
    },
    'ipa': {
        'match': r'\bipa\b|\bипа\b|индийск',
        'style': r'\bipa\b|\bapa\b|pale ale|пейл',
        'ru': 'IPA (India Pale Ale): эль с большой дозой хмеля, заметная горечь и цитрусовые, хвойные или '
              'тропические ароматы, крепость обычно 5-7 %.',
        'kk': 'IPA (India Pale Ale): құлмақ көп қосылған эль, айқын ащылық және цитрус, қылқан немесе тропикалық '
              'хош иіс, күштілігі әдетте 5-7 %.',
        'en': 'IPA (India Pale Ale) is a heavily hopped ale: marked bitterness with citrus, pine or tropical aromas, '
              'usually 5-7 % ABV.',
    },
    'stout': {
        'match': r'стаут|stout',
        'style': r'stout|стаут',
        'ru': 'Стаут: тёмный эль на жжёном солоде, кофе, шоколад, плотное тело. Сухой стаут (как Guinness) горчит, '
              'молочный стаут сладковатый.',
        'kk': 'Стаут: күйдірілген уыттан жасалған қара эль, кофе, шоколад, қою дене. Құрғақ стаут ащы, сүтті стаут '
              'тәттілеу.',
        'en': 'Stout is a dark ale on roasted malt: coffee, chocolate, full body. Dry stout (like Guinness) is bitter, '
              'milk stout is sweetish.',
    },
    'porter': {
        'match': r'портер|porter',
        'style': r'porter|портер',
        'ru': 'Портер: тёмный эль, предок стаута, шоколад и карамель, обычно чуть легче и мягче стаута.',
        'kk': 'Портер: қара эль, стауттың арғы атасы, шоколад пен карамель, әдетте стауттан жеңілірек.',
        'en': 'Porter is a dark ale and the ancestor of stout: chocolate and caramel, usually a bit lighter and '
              'softer than stout.',
    },
    'wheat': {
        'match': r'пшенич|вайцен|витбир|weiss|weizen|wheat|witbier|бидай',
        'style': r'weiss|weizen|\bwit|wheat|пшенич|вайцен|blanche',
        'ru': 'Пшеничное пиво (вайцен, витбир): эль на пшеничном солоде, обычно нефильтрованное, мягкое, с нотами '
              'банана, гвоздики или цитруса и кориандра.',
        'kk': 'Бидай сырасы (вайцен, витбир): бидай уытынан жасалған эль, әдетте сүзілмеген, жұмсақ, банан, қалампыр '
              'немесе цитрус ноталары бар.',
        'en': 'Wheat beer (weizen, witbier) is an ale on wheat malt, usually unfiltered and soft, with banana, clove '
              'or citrus and coriander notes.',
    },
    'dark': {
        'match': r'\bтемн|\bтёмн|\bdark\b|қара сыра',
        'style': r'dark|dunkel|černý|cerny|темн|тёмн|black|schwarz|stout|porter|стаут|портер|bock|бок',
        'ru': 'Тёмное пиво: цвет даёт обжаренный солод, а не крепость, ноты карамели, хлеба и кофе. Тёмный лагер '
              '(как Kozel Dark) мягкий и часто не крепче светлого.',
        'kk': 'Қара сыра: түсін күштілік емес, қуырылған уыт береді, карамель, нан және кофе ноталары. Қара лагер '
              'жұмсақ, көбіне ашықтан күшті емес.',
        'en': 'Dark beer gets its colour from roasted malt, not from strength: caramel, bread and coffee notes. A dark '
              'lager (like Kozel Dark) is soft and often no stronger than a pale one.',
    },
    'zero': {
        'match': r'безалкогол|\b0 0\b|нулев|ноль ноль|\bzero\b|alcohol.?free|non.?alcoholic|алкогольсіз',
        'category': 'na_beer',
        'ru': 'Безалкогольное пиво (0.0): обычное пиво, из которого убрали спирт, или сваренное так, чтобы он почти '
              'не образовался, до 0,5 % алкоголя, вкус ближе всего к светлому лагеру.',
        'kk': 'Алкогольсіз сыра (0.0): спирті алынған немесе спирт түзілмейтіндей қайнатылған сыра, 0,5 %-ға дейін, '
              'дәмі ашық лагерге жақын.',
        'en': 'Alcohol-free beer (0.0) is regular beer with the alcohol removed or brewed so that almost none forms: '
              'up to 0.5 % ABV, closest in taste to a pale lager.',
    },
    'radler': {
        'match': r'радлер|radler',
        'category': 'radler',
        'ru': 'Радлер: пиво пополам с лимонадом или соком, 2-3 % алкоголя, сладковатое и освежающее.',
        'kk': 'Радлер: лимонадпен немесе шырынмен араласқан сыра, 2-3 %, тәттілеу және сергітеді.',
        'en': 'Radler is beer mixed half and half with lemonade or juice: 2-3 % ABV, sweetish and refreshing.',
    },
    'cider': {
        'match': r'сидр|cider',
        'category': 'cider',
        'ru': 'Сидр: сброженный яблочный (реже грушевый) сок, 4-7 %, от сухого до сладкого, с яблочной кислинкой и '
              'пузырьками.',
        'kk': 'Сидр: ашытылған алма (сирек алмұрт) шырыны, 4-7 %, құрғақтан тәттіге дейін, алма қышқылы мен '
              'көпіршігі бар.',
        'en': 'Cider is fermented apple (sometimes pear) juice: 4-7 % ABV, from dry to sweet, with apple tang and '
              'bubbles.',
    },
    'gose': {
        'match': r'гозе|\bgose\b',
        'style': r'gose|гозе',
        'ru': 'Гозе: кисло-солёное пшеничное пиво с кориандром, освежающее, около 4-5 %.',
        'kk': 'Гозе: кориандр қосылған қышқыл-тұзды бидай сырасы, сергітеді, шамамен 4-5 %.',
        'en': 'Gose is a sour and salty wheat beer with coriander: refreshing, about 4-5 % ABV.',
    },
    'kvass': {
        'match': r'\bквас|kvass',
        'category': 'kvass',
        'ru': 'Квас: слабоалкогольный напиток на ржаном хлебе или солоде, до 1,2 %, кисло-сладкий.',
        'kk': 'Квас: қара бидай наны немесе уытынан жасалған әлсіз алкогольді сусын, 1,2 %-ға дейін, қышқыл-тәтті.',
        'en': 'Kvass is a low-alcohol drink made from rye bread or malt: up to 1.2 % ABV, sweet and sour.',
    },
    'kumys': {
        'match': r'кумыс|қымыз|kumys|koumiss',
        'style': r'кумыс|қымыз|kumys',
        'ru': 'Кумыс: сброженное кобылье молоко, кислый, слегка газированный, 1-2 % алкоголя.',
        'kk': 'Қымыз: ашытылған бие сүті, қышқыл, сәл газды, 1-2 % алкоголь.',
        'en': "Kumys is fermented mare's milk: sour, slightly fizzy, 1-2 % ABV.",
    },
    'shubat': {
        'match': r'шубат|shubat',
        'style': r'шубат|shubat',
        'ru': 'Шубат: сброженное верблюжье молоко, плотнее кумыса, солоноватый.',
        'kk': 'Шұбат: ашытылған түйе сүті, қымыздан қоюырақ, тұздылау.',
        'en': "Shubat is fermented camel's milk: thicker than kumys, slightly salty.",
    },
    'ayran': {
        'match': r'айран|ayran',
        'style': r'айран|ayran',
        'ru': 'Айран: кисломолочный напиток с водой и солью, без алкоголя, освежает и гасит остроту.',
        'kk': 'Айран: су мен тұз қосылған ашыған сүт сусыны, алкогольсіз, сергітеді және ащылықты басады.',
        'en': 'Ayran is a salted yoghurt drink diluted with water: no alcohol, refreshing, tames chilli heat.',
    },
    'abv': {
        'match': r'крепост|градус|\babv\b|alcohol content|\bstrength|күштілі',
        'ru': 'Крепость (ABV): доля спирта по объёму. 5 % значит около 25 мл чистого спирта в кружке 0,5 л. Лагеры '
              'обычно 4-5 %, крепкие лагеры 7-9 %.',
        'kk': 'Күштілік (ABV): көлемдегі спирт үлесі. 5 % дегеніміз 0,5 л кружкада шамамен 25 мл таза спирт. '
              'Лагерлер әдетте 4-5 %, күшті лагерлер 7-9 %.',
        'en': 'Strength (ABV) is alcohol by volume: 5 % means about 25 ml of pure alcohol in a 0.5 l glass. Lagers '
              'are usually 4-5 %, strong lagers 7-9 %.',
    },
    'ibu': {
        'match': r'\bibu\b',
        'ru': 'IBU: единицы горечи от хмеля. Светлый лагер 10-20, пилснер 25-40, IPA 40-70.',
        'kk': 'IBU: құлмақ ащылығының бірлігі. Ашық лагер 10-20, пилснер 25-40, IPA 40-70.',
        'en': 'IBU is the hop bitterness scale: pale lager 10-20, pilsner 25-40, IPA 40-70.',
    },
    'tannin': {
        'match': r'танин|tannin',
        'ru': 'Танины: вяжущие вещества из кожицы винограда и дуба, сушат рот, а жир и белок мяса их смягчают.',
        'kk': 'Таниндер: жүзім қабығы мен еменнен шығатын тұтқыр заттар, ауызды кептіреді, ет майы мен ақуызы '
              'жұмсартады.',
        'en': 'Tannins are astringent compounds from grape skins and oak: they dry the mouth, and the fat and protein '
              'of meat soften them.',
    },
    'sommelier': {
        'match': r'сомелье|sommelier',
        'ru': 'Сомелье: специалист по напиткам, который подбирает их к еде. Здесь это я, вкусовой движок Flavor Tree.',
        'kk': 'Сомелье: сусындарды тағамға таңдайтын маман. Мұнда бұл мен, Flavor Tree дәм қозғалтқышы.',
        'en': 'A sommelier is a drinks expert who pairs them with food. Here that is me, the Flavor Tree flavour engine.',
    },
}
# Чем отличается X от Y: одна фраза о разнице для частых пар.
GLOSSARY_DIFF = {
    frozenset({'lager', 'ale'}): {
        'ru': 'Разница в дрожжах и температуре: лагер бродит холодно и получается чистым, эль тепло и получается '
              'ароматнее.',
        'kk': 'Айырмашылығы ашытқы мен температурада: лагер суықта ашып таза шығады, эль жылыда ашып хош иісті '
              'болады.',
        'en': 'The difference is yeast and temperature: lager ferments cold and comes out clean, ale ferments warm and '
              'comes out more aromatic.',
    },
    frozenset({'pilsner', 'lager'}): {
        'ru': 'Пилснер это один из видов лагера, самый хмелевой и сухой.',
        'kk': 'Пилснер лагердің бір түрі, ең құлмақты және құрғағы.',
        'en': 'Pilsner is one kind of lager, the hoppiest and driest.',
    },
    frozenset({'stout', 'porter'}): {
        'ru': 'Стаут обычно плотнее и с более жжёными нотами, портер мягче и слаще, граница условная.',
        'kk': 'Стаут әдетте қоюырақ және күйдірілген ноталары көбірек, портер жұмсағырақ, шекарасы шартты.',
        'en': 'Stout is usually fuller with more roasted notes, porter softer and sweeter; the line is blurry.',
    },
    frozenset({'zero', 'lager'}): {
        'ru': '0.0 это то же пиво, но без спирта: до 0,5 % против 4-5 % у обычного светлого.',
        'kk': '0.0 дегеніміз сол сыра, бірақ спиртсіз: 0,5 %-ға дейін, ал қарапайым ашық сырада 4-5 %.',
        'en': '0.0 is the same beer without the alcohol: up to 0.5 % versus 4-5 % for a regular pale beer.',
    },
    frozenset({'zero', 'pilsner'}): {
        'ru': '0.0 это то же пиво, но без спирта: до 0,5 % против 4-5 % у обычного пилснера.',
        'kk': '0.0 дегеніміз сол сыра, бірақ спиртсіз: 0,5 %-ға дейін, ал қарапайым пилснерде 4-5 %.',
        'en': '0.0 is the same beer without the alcohol: up to 0.5 % versus 4-5 % for a regular pilsner.',
    },
    frozenset({'dark', 'lager'}): {
        'ru': 'Цвет даёт обжарка солода, а не крепость: тёмное может быть таким же лёгким, как светлое.',
        'kk': 'Түсті күштілік емес, уыттың қуырылуы береді: қара сыра ашық сияқты жеңіл болуы мүмкін.',
        'en': 'Colour comes from roasting the malt, not from strength: a dark beer can be as light as a pale one.',
    },
}


# Виды крепкого, которые гость называет словом («водку к шашлыку»): в русском в родительном падеже.
FAMILY_LABELS = {
    'ru': {'VODKA': 'водки', 'WHISKY': 'виски', 'BRANDY': 'коньяка', 'AGAVE': 'текилы', 'GIN': 'джина',
           'RUM': 'рома'},
    'kk': {'VODKA': 'арақ', 'WHISKY': 'виски', 'BRANDY': 'коньяк', 'AGAVE': 'текила', 'GIN': 'джин', 'RUM': 'ром'},
    'en': {'VODKA': 'vodka', 'WHISKY': 'whisky', 'BRANDY': 'brandy', 'AGAVE': 'tequila', 'GIN': 'gin', 'RUM': 'rum'},
}


def t(key, lang, **slots):
    """Фраза на языке гостя; нет перевода - русская."""
    variants = TEXTS[key]
    text = variants.get(lang) or variants['ru']
    return text.format(**slots) if slots else text


def safety_text(kind, lang, fresh=True):
    variants = SAFETY_TEXTS[kind]
    first, reminder = variants.get(lang) or variants['ru']
    return first if fresh else reminder


def category_label(category, lang):
    labels = CATEGORY_LABELS.get(lang) or CATEGORY_LABELS['ru']
    return labels.get(category, category or '')


def family_label(family, lang):
    labels = FAMILY_LABELS.get(lang) or FAMILY_LABELS['ru']
    return labels.get(family, family.lower())


def join_list(items, lang, word='and'):
    """«А, Б и В» на языке гостя."""
    items = [i for i in items if i]
    if len(items) <= 1:
        return ''.join(items)
    return ', '.join(items[:-1]) + t(word, lang) + items[-1]


# Форматирование цен и крепости

def format_price(value):
    """Decimal('4500.00') -> '4 500 ₸'."""
    if value is None:
        return ''
    amount = int(Decimal(str(value)).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
    return '{:,}'.format(amount).replace(',', ' ') + ' ₸'


def format_abv(abv):
    """5.0 -> '5 %', 4.75 -> '4,8 %'."""
    if abv is None:
        return ''
    text = '{:.1f}'.format(float(abv))
    if text.endswith('.0'):
        text = text[:-2]
    return text.replace('.', ',') + ' %'


def joined(*parts):
    return ' · '.join(p for p in parts if p)

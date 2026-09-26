"""
Правила безопасности ИИ-сомелье. Проверка идёт до любого совета, и в режиме Claude, и в локальном.

Если гость пишет, что ему нет 21, он за рулём, беременна или кормит грудью, принимает лекарства,
плохо себя чувствует, уже много выпил или хочет напиться, ему грустно и одиноко, или он не переносит
глютен, чат не предлагает алкоголь совсем: отвечает по-доброму и предлагает безалкогольное из карты
бара или каталога (0.0, лимонад, чай, вода). Флаг держится до конца этого чата: достаточно сказать
один раз. Аллергия не запрещает алкоголь, но добавляет просьбу уточнить состав у официанта.

Энергетики чат не советует никогда, ни к еде, ни отдельно.
"""
import re
from dataclasses import dataclass, field

from .engine_catalog import NON_ALCOHOLIC_CATEGORIES, is_alcoholic

# Порядок важен: при нескольких совпадениях отвечаем на самое срочное.
KINDS = ('unwell', 'drunk', 'minor', 'pregnancy', 'driving', 'medication', 'gluten', 'emotional')

# При этих флагах к блюду можно подобрать безалкогольный напиток. Тому, кому плохо или кто уже
# много выпил, пару к еде не подбираем: только вода и чай.
PAIRING_ALLOWED = frozenset({'minor', 'pregnancy', 'driving', 'medication', 'gluten', 'emotional'})

_NOT = r'(?<!не )(?<!not )'
_IM = r"\b(?:i\s+am|i'm|im)\s+"
_WHISKY = r'(?<!виски )(?<!коньяк )(?<!выдержка )'

PATTERNS = {
    'minor': re.compile(
        r'\bмне\s+(?:всего\s+|только\s+|уже\s+|еще\s+)?(?:1[0-9]|20)\b(?!\s*(?:000|тыс|круж|бокал|стакан|бутыл|'
        r'пив|минут|час|тг|тенге|шт|порц|раз|человек))'
        r'|\bнам\s+(?:всем\s+)?(?:по\s+)?(?:1[0-9]|20)\b(?!\s*(?:000|тыс|круж|бокал|человек))'
        r'|' + _WHISKY + r'\b(?:1[4-9]|20)\s*(?:лет|годиков|год)\b'
        r'(?!\s*(?:выдерж|свадьб|брак|вместе|работ|назад|стаж|знаком))'
        r'|несовершеннолет|школьни|подрост|\bмне\s+(?:еще\s+)?нет\s+(?:18|21|восемнадцат|двадцат)'
        r'|не\s+исполнилось\s+(?:18|21)|\bв\s+\d{1,2}\s+классе\b|\bдля\s+(?:ребенка|детей|сына|дочки|дочери)\b'
        r'|\bдетям\b|\bребенку\b'
        r"|" + _IM + r"(?:1[0-9]|20)\b|\b(?:1[0-9]|20)\s*(?:years?\s+old|yo)\b|underage|under\s+21|\bteen"
        r'|\b(?:1[0-9]|20)\s*жас|жасым\s*(?:1[0-9]|20)\b|кәмелетке\s+толмаған|оқушымын|мектеп\s+оқушы'),
    'driving': re.compile(
        _NOT + r'за\s*рул|' + _NOT + r'\bвожу\b|' + _NOT + r'веду\s+машин|я\s+водител|\bрулить\b'
        r'|(?:я|приехал|приехала|приехали)\s+на\s+(?:машине|авто)|сяду\s+за\s+руль|поеду\s+(?:домой\s+)?на\s+машине'
        r'|мне\s+(?:еще\s+)?(?:ехать|вести|за\s+руль)'
        r"|" + _IM + r"driving\b|\bdriv(?:e|ing)\s+(?:home|later|after|back)|designated\s+driver"
        r'|рульдемін|рульде\s+отырмын|көлік\s+жүргіз|көлікпен\s+келдім|машинамен\s+келдім'),
    'pregnancy': re.compile(
        _NOT + r'беремен|жду\s+ребенка|ждем\s+ребенка|в\s+положении|кормлю\s+грудью|грудное\s+вскармлив|кормящ'
        r'|pregnan|breastfeed|breast\s*feeding|expecting\s+a\s+baby'
        r'|жүктімін|жүкті|аяғым\s+ауыр|бала\s+емізіп'),
    'unwell': re.compile(
        r'тошнит|тошно|мутит|рвот|вырвал|' + _NOT + r'плохо\s+себя\s+чувству|мне\s+плохо|плохо\s+мне'
        r'|мне\s+нехорошо|кружится\s+голова|голова\s+кружится|болит\s+(?:голова|живот|желудок|сердце)'
        r'|болею\b|заболел|у\s+меня\s+температур|температурю|отравил|сердце\s+колет'
        r"|i\s+feel\s+(?:sick|ill|unwell|bad|dizzy)|\bnause|\bdizzy\b|throw(?:ing)?\s+up|\bvomit|" + _IM + r"sick"
        r'|жүрегім\s+айнып|ауырып\s+тұрмын|басым\s+ауырады|басым\s+айналады|ауырып\s+қалдым|өзімді\s+жаман\s+сезін'),
    'drunk': re.compile(
        _NOT + r'\bпьян(?:ый|ая|ые|а|ы|ею|ел)?\b|напилс|напилась|перебрал|выпил[аи]?\s+(?:уже\s+)?'
        r'(?:[3-9]\b|\d{2}|много|три|четыре|пять|шесть|семь|восемь|девять|десять|несколько|литр|полтора)'
        r'|\bнапиться|\bопьянеть|нажраться|упиться|надраться|набухаться|\bв\s+хлам|в\s+стельку'
        r'|(?:быстрее|быстро|побыстрее)\s+(?:опьянеть|напиться|вставило|развезло)'
        r'|чтобы\s+(?:вставило|развезло|унесло|вштырило)'
        r"|" + _IM + r"drunk|\bget(?:ting)?\s+drunk|\bwasted\b|\bhammered\b|already\s+had\s+\d+|had\s+too\s+many"
        r'|мас\s+болдым|мас\s+болғым|мас\s+болу|көп\s+іштім|ішіп\s+алдым'),
    'medication': re.compile(
        r'антибиотик|лекарств|таблетк|\bпрепарат|антидепрессант|успокоительн|снотворн|инсулин|обезболивающ'
        r'|на\s+лечении|курс\s+лечения'
        r'|antibiotic|medication|\bmeds\b|\bpills?\b|prescription'
        r'|дәрі\s+(?:ішіп|қабылда)|дәрі\s+ішемін'),
    'gluten': re.compile(
        r'глютен|целиак|без\s+пшениц|непереносимост\w*\s+(?:злак|пшениц)|gluten|coeliac|celiac'),
    'emotional': re.compile(
        r'грустн|грусть|одинок|одиноч|тоскл|тоска|депресс|стресс|нервнича|плохое\s+настроение'
        r'|расстал|развел|развод|бросил[аи]?\s+(?:меня|парень|девушка|муж|жена)|меня\s+бросил|плакать|плакал'
        r'|обидно|печаль|печальн|\bгоре\b|с\s+горя|залить\s+горе|запить\s+горе|забыться|разбито\s+сердце'
        r'|вс[её]\s+плохо|тяжелый\s+день|тяжелая\s+неделя|паршиво|хреново|уволили|похорон'
        r"|\bsad\b|lonely|depress|stress|heartbroken|broke\s+up|bad\s+day|feel\s+down|upset"
        r'|көңілсіз|жалғызбын|жалғыз\s+қалдым|мұңды|мұңайып|көңіл-күйім\s+жоқ|көңіл\s+күйім\s+жоқ|жабырқау'),
}
ALLERGY_RE = re.compile(r'аллерги|allerg|аллергия')
ENERGY_RE = re.compile(r'энергет|energy\s*drink|red\s*bull|\bburn\b|monster|adrenaline|gorilla', re.I)


def normalize(text):
    text = (text or '').lower().replace('ё', 'е')
    text = re.sub(r"[^\w\s']+", ' ', text)
    return ' '.join(text.split())


def detect(text):
    """Флаги безопасности в одной реплике, самые срочные первыми."""
    t = normalize(text)
    if not t:
        return []
    return [kind for kind in KINDS if PATTERNS[kind].search(t)]


@dataclass
class Safety:
    """Итог проверки чата: главный флаг, сказал ли гость о нём в этой реплике и все флаги чата."""
    kind: str
    fresh: bool
    kinds: list = field(default_factory=list)
    allergy: bool = False

    @property
    def pairing_allowed(self):
        return self.kind in PAIRING_ALLOWED

    def allows(self, drink):
        """Можно ли предложить этот напиток при всех флагах чата."""
        return all(drink_allowed(kind, drink) for kind in self.kinds)


def assess(messages):
    """
    Проверка всей истории гостя (реплики сомелье не смотрим). None, если флагов нет;
    иначе Safety с главным флагом. Аллергия учитывается только в последней реплике.
    """
    user_texts = [m.get('content') or '' for m in messages if m.get('role') == 'user']
    if not user_texts:
        return None
    current = detect(user_texts[-1])
    earlier = []
    for text in user_texts[:-1]:
        for kind in detect(text):
            if kind not in earlier:
                earlier.append(kind)
    kinds = [k for k in KINDS if k in current or k in earlier]
    allergy = bool(ALLERGY_RE.search(normalize(user_texts[-1])))
    if not kinds:
        return Safety(kind='', fresh=False, kinds=[], allergy=True) if allergy else None
    kind = current[0] if current else kinds[0]
    return Safety(kind=kind, fresh=bool(current), kinds=kinds, allergy=allergy)


def is_energy(drink):
    return bool(ENERGY_RE.search('{} {}'.format(drink.get('name') or '', drink.get('v2') or '')))


def drink_is_alcoholic(drink):
    if 'is_alcoholic' in drink and drink['is_alcoholic'] is not None:
        return bool(drink['is_alcoholic'])
    return is_alcoholic(drink.get('abv'), drink.get('category'))


def _zero(drink):
    """Совсем без алкоголя: крепость известна и равна нулю или это вода, чай, кофе, лимонад."""
    abv = drink.get('abv')
    if abv is not None:
        try:
            return float(abv) == 0.0
        except (TypeError, ValueError):
            return False
    return drink.get('category') in NON_ALCOHOLIC_CATEGORIES - {'na_beer', 'kvass', 'dairy'}


SOFT_CATEGORIES = frozenset({'lemonade', 'soda', 'tea', 'coffee', 'water', 'dairy'})
GLUTEN_FREE_CATEGORIES = frozenset({'lemonade', 'soda', 'tea', 'coffee', 'water', 'dairy'})


def drink_allowed(kind, drink):
    """
    Что можно предложить при флаге. Нигде нет алкоголя и энергетиков. Подростку и будущей маме
    не предлагаем и безалкогольное пиво с квасом (в них бывает до 0,5-1,2%), при глютене
    исключаем всё на зерне, кому плохо, только вода и чай.
    """
    if is_energy(drink) or drink_is_alcoholic(drink):
        return False
    category = drink.get('category')
    if kind in ('minor', 'pregnancy', 'drunk'):
        return category in SOFT_CATEGORIES and _zero(drink)
    if kind == 'unwell':
        return category in ('water', 'tea')
    if kind == 'gluten':
        return category in GLUTEN_FREE_CATEGORIES and _zero(drink)
    return _zero(drink)


# Порядок категорий в безалкогольных вариантах: свои 0.0 Efes впереди там, где пиво 0.0 уместно.
OPTION_ORDER = {
    'minor': ('lemonade', 'tea', 'dairy', 'water', 'soda'),
    'pregnancy': ('water', 'lemonade', 'dairy', 'tea'),
    'driving': ('na_beer', 'lemonade', 'tea', 'water', 'soda'),
    'medication': ('na_beer', 'lemonade', 'tea', 'water'),
    'emotional': ('na_beer', 'tea', 'lemonade', 'water'),
    'gluten': ('water', 'tea', 'lemonade', 'dairy', 'coffee', 'soda'),
    'drunk': ('water', 'tea', 'lemonade'),
    'unwell': ('water', 'tea'),
    # «Без алкоголя» по кнопке или словами: 0.0 и всё безалкогольное
    'no_alcohol': ('na_beer', 'lemonade', 'tea', 'dairy', 'water', 'soda'),
}

"""
Правила безопасности ИИ-сомелье. Проверка идёт до любого совета, и в режиме Claude, и в локальном.

Если гость пишет, что ему нет 21, он за рулём, беременна или кормит грудью, принимает лекарства,
плохо себя чувствует, уже много выпил или хочет напиться, ему грустно и одиноко, или он не переносит
глютен, чат не предлагает алкоголь совсем: отвечает по-доброму и предлагает безалкогольное из карты
бара или каталога (0.0, лимонад, чай, вода). Возраст, руль, беременность, лекарства, глютен,
самочувствие и «уже много выпил» чат помнит до конца разговора (флаги STICKY возвращаются клиенту
и приходят обратно, даже когда ранние реплики выпали из истории). Грусть держится, пока реплика
видна в истории. Вопрос «что взять ребёнку» касается только этой реплики. Аллергия не запрещает
алкоголь, но добавляет просьбу уточнить состав у официанта.

Энергетики чат не советует никогда, ни к еде, ни отдельно.
"""
import re
from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo

from .engine_catalog import NON_ALCOHOLIC_CATEGORIES, is_alcoholic

# Порядок важен: при нескольких совпадениях отвечаем на самое срочное.
KINDS = ('unwell', 'drunk', 'minor', 'pregnancy', 'driving', 'medication', 'gluten', 'emotional', 'child')

# При этих флагах к блюду можно подобрать безалкогольный напиток. Тому, кому плохо или кто уже
# много выпил, пару к еде не подбираем: только вода и чай.
PAIRING_ALLOWED = frozenset({'minor', 'pregnancy', 'driving', 'medication', 'gluten', 'emotional', 'child'})
# Флаги на весь чат: чат помнит их, даже когда реплика гостя выпала из последних 12.
STICKY = frozenset({'minor', 'pregnancy', 'driving', 'medication', 'gluten', 'drunk', 'unwell'})
# Флаг только этой реплики: «что взять ребёнку» не значит, что взрослым за столом нельзя.
TURN_ONLY = frozenset({'child'})

_NOT = r'(?<!не )(?<!not )'
_IM = r"\b(?:i\s+am|i'm|im)\s+"
_WHISKY = r'(?<!виски )(?<!коньяк )(?<!выдержка )'
# Возраст до 21 цифрами и словами; «двадцать один» и старше не считаем.
_TWENTY = r'двадцать(?!\s+(?:один|одна|два|две|три|четыре|пять|шесть|семь|восемь|девять))'
_TEEN_WORDS = r'четырнадцать|пятнадцать|шестнадцать|семнадцать|восемнадцать|девятнадцать|' + _TWENTY
_AGE = r'(?:1[0-9]|20|десять|одиннадцать|двенадцать|тринадцать|' + _TEEN_WORDS + r')'
_TEEN = r'(?:1[4-9]|20|' + _TEEN_WORDS + r')'
_EN_AGE = (r'(?:1[0-9]|20|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen'
           r'|twenty(?![\s-]+(?:one|two|three|four|five|six|seven|eight|nine)))')
_KK_AGE = (r'(?:он\s+(?:төрт|бес|алты|жеті|сегіз|тоғыз)'
           r'|жиырма(?!\s+(?:бір|екі|үш|төрт|бес|алты|жеті|сегіз|тоғыз)))')
# После «мне 12» стоит счёт, а не возраст: «мне 12 крылышек», «нам 18 кружек», «мне 15 минут».
_COUNT = (r'(?!\s*(?:000|тыс|круж|бокал|стакан|бутыл|банк|пинт|пив|литр|л\b|мл\b|минут|час|тг|тенге|шт|порц'
          r'|раз\b|раза\b|человек|гост|персон|крыл|кус|палоч|шампур|сет\b|сета\b|ролл|пельмен|мант|хинкал|бургер'
          r'|наггет|стрипс|лепеш|самс|пирож|гренк|гренок|сухар|чипс|орех|кольц|кревет|суш|блюд|позиц|напит|шот'
          r'|рюм|коктейл|тарел|прибор|мест|стул|кальян|процент|градус|грам|гр\b|г\b|кг\b))')

PATTERNS = {
    'minor': re.compile(
        r'\bмне\s+(?:всего\s+|только\s+|уже\s+|еще\s+|почти\s+)?' + _AGE + r'\b' + _COUNT
        + r'|\bнам\s+(?:всем\s+)?(?:по\s+)?' + _AGE + r'\b' + _COUNT
        + r'|' + _WHISKY + r'\b' + _TEEN + r'\s*(?:лет|годиков|год)\b'
        r'(?!\s*(?:выдерж|свадьб|брак|вместе|работ|назад|стаж|знаком))'
        r'|несовершеннолет|школьни|подрост|малолет'
        r'|\bмне\s+(?:еще\s+|пока\s+)?нет\s+(?:еще\s+|пока\s+)?(?:18|21|восемнадцат|двадцат)'
        r'|не\s+исполнилось\s+(?:18|21|восемнадцат|двадцат)'
        r'|\b(?:почти|скоро|только\s+будет|исполнится)\s+(?:18|21|восемнадцать|двадцать\s+один)\b' + _COUNT
        + r'|\bв\s+\d{1,2}\s+классе\b|\bучусь\s+в\s+(?:школе|\w+\s+классе)|\bв\s+школе\s+учусь'
        r'|\bя\s+(?:еще\s+)?в\s+школе\b'
        + r'|' + _IM + _EN_AGE + r'\b(?!\s*(?:min|mins|minutes|hours|km|miles|people|of\s+us))'
        + r'|\b' + _EN_AGE + r'\s*(?:years?\s+old|yo)\b|underage|under\s+21|\bteen|almost\s+(?:18|21)\b'
        r'|not\s+(?:18|21)\s+yet|high\s+school'
        r'|\b(?:1[0-9]|20)\s*жас|жасым\s*(?:1[0-9]|20)\b|' + _KK_AGE + r'\s+жас|жасым\s+' + _KK_AGE
        + r'|кәмелетке\s+толмаған|оқушымын|мектеп\s+оқушы|мектепте\s+оқимын'),
    'driving': re.compile(
        _NOT + r'за\s*рул|за\s+баранк|' + _NOT + r'\bвожу\b(?!\s+(?:друз|дет|ребен|гост|сюда|туда|семь|жен|муж'
        r'|девуш|парн|компан|клиент|коллег|их\b|его\b|ее\b|всех|сестр|брат|маму|папу|родител))'
        r'|' + _NOT + r'веду\s+машин|я\s+водител|\bя\s+(?:\w+\s+){1,2}водитель\b|трезв\w*\s+водител|\bрулить\b'
        r'|(?:я|приехал|приехала|приехали)\s+на\s+(?:машине|авто)|сяду\s+за\s+руль|поеду\s+(?:домой\s+)?на\s+машине'
        r'|мне\s+(?:еще\s+)?(?:домой\s+|обратно\s+|потом\s+|сегодня\s+)?(?:ехать|вести|за\s+руль|рулить)'
        r"|" + _IM + r"driving\b|\bdriv(?:e|ing)\s+(?:home|later|after|back)|designated\s+driver"
        r'|рульдемін|рульде\s+отырмын|көлік\s+жүргіз|көлікпен\s+келдім|машинамен\s+келдім'),
    'pregnancy': re.compile(
        _NOT + r'беремен|жду\s+ребенка|ждем\s+ребенка|в\s+положении|кормлю\s+грудью|грудное\s+вскармлив|кормящ'
        r'|токсикоз|\bна\s+(?:\d{1,2}|первом|втором|третьем|четвертом|пятом|шестом|седьмом|восьмом|девятом)\s+'
        r'(?:месяце|неделе)\b'
        r'|pregnan|breastfeed|breast\s*feeding|expecting\s+a\s+baby'
        r'|жүктімін|жүкті|аяғым\s+ауыр|бала\s+емізіп'),
    'unwell': re.compile(
        r'тошнит|тошно|мутит|рвот|вырвал|' + _NOT + r'плохо\s+себя\s+чувству|мне\s+плохо|плохо\s+мне'
        r'|мне\s+нехорошо|кружится\s+голова|голова\s+кружится|болит\s+(?:голова|живот|желудок|сердце)'
        r'|болею\b(?!\s+за\b)|заболел|у\s+меня\s+температур|температурю|отравил|сердце\s+колет'
        r"|i\s+feel\s+(?:sick|ill|unwell|bad|dizzy)|\bnause|\bdizzy\b|throw(?:ing)?\s+up|\bvomit|" + _IM + r"sick"
        r'|жүрегім\s+айнып|ауырып\s+тұрмын|басым\s+ауырады|басым\s+айналады|ауырып\s+қалдым|өзімді\s+жаман\s+сезін'),
    'drunk': re.compile(
        _NOT + r'\bпьян(?:ый|ая|ые|а|ы|ею|ел)?\b|напилс|напилась|перебрал|выпил[аи]?\s+(?:уже\s+)?'
        r'(?:[3-9]\b|\d{2}|много|три|четыре|пять|шесть|семь|восемь|девять|десять|несколько|литр|полтора)'
        r'|\bнапиться|\bопьянеть|нажрат|ужрат|упиться|надраться|набухаться|накидаться|\bв\s+хлам|в\s+стельку'
        r'|\bв\s+дрова\b|поддат|\bбух(?:ой|ая|ие)\b'
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
        # «Тоскана» и «тосканское» не тоска
        r'грустн|грусть|одинок|одиноч|\bтоск(?!ан)|депресс|стресс|нервнича|плохое\s+настроение'
        r'|расстал|развел|развод|бросил[аи]?\s+(?:меня|парень|девушка|муж|жена)|меня\s+бросил|плакать|плакал'
        r'|обидно|печаль|печальн|\bгоре\b|с\s+горя|залить\s+горе|запить\s+горе|забыться|разбито\s+сердце'
        r'|вс[её]\s+плохо|тяжелый\s+день|тяжелая\s+неделя|паршиво|хреново|уволили|похорон'
        r"|\bsad\b|lonely|depress|stress|heartbroken|broke\s+up|bad\s+day|feel\s+down|upset"
        r'|көңілсіз|жалғызбын|жалғыз\s+қалдым|мұңды|мұңайып|көңіл-күйім\s+жоқ|көңіл\s+күйім\s+жоқ|жабырқау'),
    'child': re.compile(
        r'\bдля\s+(?:ребенка|детей|сына|дочки|дочери|малыша|внука|внучки)\b|\bдетям\b|\bребенку\b|\bмалышу\b'
        r'|детск\w*\s+(?:напит|меню|лимонад|сок)'
        r'|\bfor\s+(?:my\s+|the\s+|a\s+)?(?:kid|kids|child|children|son|daughter)\b|балаға|балаларға'),
}
# «Я 2008 года рождения», «born in 2007», «2008 жылы туғанмын»: возраст считаем по текущему году.
BIRTH_RE = re.compile(
    r'\b((?:19|20)\d\d)\s*(?:г|год|года|году)?\s*(?:рождения|р)\b|\bborn\s+in\s+((?:19|20)\d\d)\b'
    r'|\b((?:19|20)\d\d)\s*(?:жылы\s+)?туған')
ALLERGY_RE = re.compile(r'аллерги|allerg|аллергия')
ENERGY_RE = re.compile(r'энергет|energy\s*drink|red\s*bull|\bburn\b|monster|adrenaline|gorilla', re.I)
TZ = ZoneInfo('Asia/Almaty')


def normalize(text):
    text = (text or '').lower().replace('ё', 'е')
    text = re.sub(r"[^\w\s']+", ' ', text)
    return ' '.join(text.split())


def born_under_21(text):
    """Год рождения в реплике, и гостю по нему точно нет 21."""
    year_now = datetime.now(TZ).year
    for match in BIRTH_RE.finditer(text):
        year = int(next(g for g in match.groups() if g))
        if 0 <= year_now - year <= 20:
            return True
    return False


def detect(text):
    """Флаги безопасности в одной реплике, самые срочные первыми."""
    t = normalize(text)
    if not t:
        return []
    found = [kind for kind in KINDS if PATTERNS[kind].search(t)]
    if 'minor' not in found and born_under_21(t):
        found = [kind for kind in KINDS if kind in found or kind == 'minor']
    return found


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

    @property
    def sticky(self):
        """Флаги, которые чат должен помнить до конца разговора (уходят клиенту в safety_flags)."""
        return [kind for kind in self.kinds if kind in STICKY]

    def allows(self, drink):
        """Можно ли предложить этот напиток при всех флагах чата."""
        return all(drink_allowed(kind, drink) for kind in self.kinds)


def assess(messages, remembered=()):
    """
    Проверка всей истории гостя (реплики сомелье не смотрим) и флагов, которые чат запомнил раньше
    (remembered: только STICKY, остальное игнорируется). None, если флагов нет; иначе Safety
    с главным флагом. Аллергия и «что взять ребёнку» учитываются только в последней реплике.
    """
    user_texts = [m.get('content') or '' for m in messages if m.get('role') == 'user']
    if not user_texts:
        return None
    current = detect(user_texts[-1])
    earlier = set()
    for text in user_texts[:-1]:
        earlier.update(kind for kind in detect(text) if kind not in TURN_ONLY)
    earlier.update(kind for kind in remembered or () if kind in STICKY)
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
    Что можно предложить при флаге. Нигде нет алкоголя и энергетиков. Подростку, ребёнку и будущей
    маме не предлагаем и безалкогольное пиво с квасом (в них бывает до 0,5-1,2%), при глютене
    исключаем всё на зерне, кому плохо, только вода и чай.
    """
    if is_energy(drink) or drink_is_alcoholic(drink):
        return False
    category = drink.get('category')
    if kind in ('minor', 'child', 'pregnancy', 'drunk'):
        return category in SOFT_CATEGORIES and _zero(drink)
    if kind == 'unwell':
        return category in ('water', 'tea')
    if kind == 'gluten':
        return category in GLUTEN_FREE_CATEGORIES and _zero(drink)
    return _zero(drink)


# Порядок категорий в безалкогольных вариантах: свои 0.0 Efes впереди там, где пиво 0.0 уместно.
OPTION_ORDER = {
    'minor': ('lemonade', 'tea', 'dairy', 'water', 'soda'),
    'child': ('lemonade', 'dairy', 'water', 'tea', 'soda'),
    'pregnancy': ('water', 'lemonade', 'dairy', 'tea'),
    'driving': ('na_beer', 'lemonade', 'tea', 'water', 'soda'),
    'medication': ('na_beer', 'lemonade', 'tea', 'water'),
    'emotional': ('tea', 'lemonade', 'na_beer', 'water'),
    'gluten': ('water', 'tea', 'lemonade', 'dairy', 'coffee', 'soda'),
    'drunk': ('water', 'tea', 'lemonade'),
    'unwell': ('water', 'tea'),
    # «Без алкоголя» по кнопке или словами: 0.0 и всё безалкогольное
    'no_alcohol': ('na_beer', 'lemonade', 'tea', 'dairy', 'water', 'soda'),
}

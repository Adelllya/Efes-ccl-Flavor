#!/usr/bin/env python3
"""
Flavor Tree — фото напитков НЕ из портфеля Efes (efes_relation == "none", 368 из 412).

Два источника, по очереди:
  1. NanoBanana API (nanobananaapi.ai, модель Gemini 2.5 Flash Image): студийный рендер по промпту
     из карточки напитка (название, стиль, производитель, бокал). Ключ — переменная окружения
     NANOBANANA_API_KEY (nb_…, сервис nanobananaapi.ai) или GEMINI_API_KEY (ключ Google: AIza…/AQ.…,
     модель gemini-3.1-flash-image напрямую), либо --key. Если ключ не принят или кредиты кончились,
     шаг пропускается.
  2. Открытые фото: Wikimedia Commons + Openverse (только CC0 / Public domain / CC BY / CC BY-SA),
     кандидат берётся только если в названии/описании файла есть отличительное слово из названия
     напитка (иначе Commons отдаёт случайные «beer»).

Результат одинаковый для обоих путей: фон удалён (rembg/u2net), продукт отцентрован на прозрачном
холсте 600×600, WebP ≤ ~60 КБ → frontend/public/img/beers/<id>.webp; поля image + image_credit
записываются в backend/data/engine/drinks.json и data/drinks.json; CREDITS.md перестраивается.

Подкоманды
  run [ids…]     обработать напитки (по умолчанию все не-Efes). Флаги:
                   --only-missing  только напитки без фото (по умолчанию: ИИ перегенерирует все,
                                   а веб-поиск — только тех, у кого фото нет)
                   --no-ai / --no-web  отключить источник
                   --limit N       первые N напитков (для пробы)
                   --dry-run       только показать план и промпты, ничего не качать
                   --workers N     параллельных задач NanoBanana (по умолчанию 4)
  check-key      проверить ключ NanoBanana и остаток кредитов
  credits        только перестроить CREDITS.md из drinks.json
  efes           пересобрать webp флагманов Efes из backend/media/brands (PNG с альфой) — без чёрного фона
  prompt <id>    показать промпт для напитка
  drop <id…>     убрать фото у напитков (файл + поля + CREDITS.md) — для неверных находок
  sheet [id…]    контактный лист результатов последнего запуска (или заданных id) для проверки глазами

Кэш сетевых ответов и скачанных файлов: ~/.cache/flavortree-drink-photos (или $FT_DRINK_PHOTO_CACHE).
Повторный запуск не ходит в сеть за тем, что уже в кэше. Отчёт о запуске: <cache>/last_run.json.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_dish_photos as fdp  # noqa: E402  — Commons/Openverse клиент, лицензии, http-кэш

ROOT = Path(__file__).resolve().parents[1]
DRINKS = ROOT / "backend" / "data" / "engine" / "drinks.json"
DRINKS_SRC = ROOT / "data" / "drinks.json"
OUT_DIR = ROOT / "frontend" / "public" / "img" / "beers"
CREDITS = OUT_DIR / "CREDITS.md"
CACHE = Path(os.environ.get("FT_DRINK_PHOTO_CACHE") or (Path.home() / ".cache" / "flavortree-drink-photos"))
fdp.CACHE = CACHE
fdp.UA = "FlavorTree-drink-photos/1.0 (https://github.com/Adelllya/Efes-ccl-Flavor)"

NB_BASE = "https://api.nanobananaapi.ai"
NB_CALLBACK = "https://flavor-tree.vercel.app/api/nanobanana/callback"  # обязательное поле API; мы опрашиваем задачу сами
NB_POLL_EVERY = 5
NB_TIMEOUT = 300

SIZE = 600
WEBP_QUALITY = 82
MAX_BYTES = 70_000
MIN_SIDE_WEB = 500  # минимальная короткая сторона открытого фото

AI_CREDIT = {
    "author": "ИИ-иллюстрация, Nano Banana (Gemini Flash Image)",
    "license": "сгенерировано, не фото продукта",
    "license_url": "",
    "source": "https://ai.google.dev/gemini-api/docs/image-generation",
}

# ─────────────────────────────────────────────────────────────────────────────
# Промпт
# ─────────────────────────────────────────────────────────────────────────────
GLASS_EN = [
    ("пилснер", "tall pilsner glass"), ("кружка", "beer mug"), ("тюльпан", "tulip beer glass"),
    ("пинта", "pint glass"), ("кубок", "chalice goblet"), ("пшеничн", "tall weizen glass"),
    ("сидр", "cider glass"), ("гленкерн", "Glencairn whisky glass"), ("тумблер", "tumbler"),
    ("красн", "red wine glass"), ("бел", "white wine glass"), ("хайбол", "highball glass"),
    ("флейт", "champagne flute"), ("купе", "coupe glass"), ("рокс", "rocks glass"),
    ("мартини", "martini glass"), ("снифтер", "snifter"), ("шот", "shot glass"), ("чашк", "cup"),
    ("стакан", "glass"), ("бокал", "stemmed glass"),
]
SUBJECT = {
    "beer": "a 500 ml glass bottle of {name} beer standing next to a {glass} filled with the beer, with a foam head",
    "na_beer": "a 500 ml glass bottle of {name} non-alcoholic beer next to a {glass} filled with the beer",
    "radler": "a bottle of {name} radler next to a {glass} filled with the cloudy drink",
    "cider": "a bottle of {name} cider next to a {glass} filled with sparkling cider",
    "wine": "a bottle of {name} wine next to a {glass} with the wine",
    "sparkling": "a bottle of {name} sparkling wine next to a champagne flute with bubbles",
    "fortified": "a bottle of {name} fortified wine next to a small stemmed glass",
    "spirit": "a bottle of {name} next to a {glass} with a measure of the spirit",
    "liqueur": "a bottle of {name} liqueur next to a small glass",
    "cocktail": "the {name} cocktail served in a {glass} with a fitting garnish, no bottle",
    "kvass": "a bottle of {name} kvass next to a glass mug of dark kvass with foam",
    "dairy": "a bottle of {name} next to a glass of the white fermented milk drink",
    "soda": "a bottle of {name} soft drink next to a glass with ice",
    "lemonade": "a bottle of {name} lemonade next to a glass with ice and a lemon slice",
    "water": "a bottle of {name} water next to a glass of water",
    "tea": "a cup of {name} tea on a saucer, steam rising",
    "coffee": "a cup of {name} on a saucer",
}
COLOR = {
    "LAGER": "pale golden, clear", "STRONG_LAGER": "deep golden", "DARK_LAGER": "dark ruby brown",
    "AMBER_LAGER": "amber", "WHEAT": "hazy pale straw", "IPA": "amber gold", "STOUT": "opaque black with a tan head",
    "PORTER": "very dark brown", "NA_BEER": "pale golden", "FRUIT_BEER": "fruity, tinted", "SOUR": "hazy, tinted",
    "BELGIAN": "golden, dense white foam", "GOLDEN_ALE": "golden", "PALE_ALE": "copper gold", "CIDER": "pale gold, sparkling",
    "RED": "deep ruby", "WHITE": "pale straw", "ROSE": "pale pink", "SPARKLING": "pale gold with bubbles",
    "WHISKY": "amber", "VODKA": "crystal clear", "GIN": "crystal clear", "RUM": "golden amber", "BRANDY": "amber",
    "KVASS": "dark amber", "TEA": "amber", "COFFEE": "dark brown with crema",
}


def glass_en(d: dict) -> str:
    g = ((d.get("serving") or {}).get("glass") or "").lower().split("/")[0]
    for key, en in GLASS_EN:
        if key in g:
            return en
    return "glass"


def build_prompt(d: dict) -> str:
    name = d["name"]
    cat = d.get("category") or "beer"
    subject = SUBJECT.get(cat, SUBJECT["beer"]).format(name=name, glass=glass_en(d))
    style = d.get("style") or {}
    producer = d.get("producer") or {}
    bits = []
    if style.get("name"):
        bits.append(f"style: {style['name']}")
    if COLOR.get(style.get("family") or ""):
        bits.append(f"liquid colour {COLOR[style['family']]}")
    if producer.get("name"):
        where = f", {producer['country']}" if producer.get("country") else ""
        bits.append(f"produced by {producer['name']}{where}")
    if (d.get("flags") or {}).get("non_alcoholic"):
        bits.append("non-alcoholic, 0.0% marked on the label")
    return (
        f"Professional studio product photograph of {subject}. "
        f"The label clearly reads \"{name}\". {'; '.join(bits)}. "
        "Isolated on a plain pure white background, centred, soft diffused lighting, gentle shadow, "
        "sharp focus, photorealistic, square composition, no watermark, no text other than the label."
    )


# ─────────────────────────────────────────────────────────────────────────────
# NanoBanana API
# ─────────────────────────────────────────────────────────────────────────────
class NanoBananaError(Exception):
    pass


class NanoBanana:
    def __init__(self, key: str):
        self.key = key

    def _call(self, method: str, path: str, payload: dict | None = None, params: dict | None = None) -> dict:
        url = NB_BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={
            "Authorization": f"Bearer {self.key}", "Content-Type": "application/json", "Accept": "application/json",
            "User-Agent": fdp.UA,  # без User-Agent Cloudflare отвечает 403 (error 1010)
        })
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = resp.read()
        except urllib.error.HTTPError as e:
            body = e.read()
        try:
            out = json.loads(body)
        except ValueError:
            raise NanoBananaError(f"{path}: не JSON: {body[:120]!r}")
        if out.get("code") == 401:
            raise NanoBananaError(f"ключ не принят (401): {out.get('msg')}")
        if out.get("code") == 402:
            raise NanoBananaError(f"кредиты закончились (402): {out.get('msg')}")
        return out

    def credits(self) -> int | None:
        out = self._call("GET", "/api/v1/common/credit")
        if out.get("code") != 200:
            raise NanoBananaError(f"credit: {out.get('code')} {out.get('msg')}")
        data = out.get("data")
        return data if isinstance(data, int) else (data or {}).get("credits") if isinstance(data, dict) else None

    def generate(self, prompt: str) -> str:
        out = self._call("POST", "/api/v1/nanobanana/generate", {
            "prompt": prompt, "type": "TEXTTOIAMGE", "numImages": 1, "image_size": "1:1", "callBackUrl": NB_CALLBACK,
        })
        if out.get("code") != 200 or not (out.get("data") or {}).get("taskId"):
            raise NanoBananaError(f"generate: {out.get('code')} {out.get('msg')}")
        return out["data"]["taskId"]

    def wait(self, task_id: str, timeout: int = NB_TIMEOUT) -> str:
        deadline = time.time() + timeout
        while time.time() < deadline:
            time.sleep(NB_POLL_EVERY)
            out = self._call("GET", "/api/v1/nanobanana/record-info", params={"taskId": task_id})
            data = out.get("data") or {}
            flag = data.get("successFlag")
            if flag == 1:
                resp = data.get("response") or {}
                urls = resp.get("resultUrls") or resp.get("resultImageUrls") or []
                url = resp.get("resultImageUrl") or (urls[0] if urls else None) or resp.get("originImageUrl")
                if not url:
                    raise NanoBananaError(f"задача {task_id} успешна, но без URL: {resp}")
                return url
            if flag in (2, 3):
                raise NanoBananaError(f"задача {task_id} упала: {data.get('errorCode')} {data.get('errorMessage')}")
        raise NanoBananaError(f"задача {task_id}: нет результата за {timeout} с")

    def image(self, prompt: str) -> bytes:
        url = self.wait(self.generate(prompt))
        req = urllib.request.Request(url, headers={"User-Agent": fdp.UA})
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.read()


GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
GEMINI_MODEL = "gemini-3.1-flash-image"  # Nano Banana 2; запасной — gemini-2.5-flash-image


class Gemini:
    """Nano Banana напрямую через Gemini API (ключ Google: AIza… или AQ.…). Ответ — PNG в base64."""

    def __init__(self, key: str, model: str = GEMINI_MODEL):
        self.key, self.model = key, model

    def _call(self, path: str, payload: dict | None = None) -> dict:
        req = urllib.request.Request(GEMINI_BASE + path, data=json.dumps(payload).encode() if payload else None,
                                     method="POST" if payload else "GET",
                                     headers={"x-goog-api-key": self.key, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                out = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            body = e.read()[:400].decode("utf-8", "replace")
            if e.code in (401, 403):
                raise NanoBananaError(f"ключ не принят ({e.code}): {body}")
            if e.code == 429:
                raise RateLimited(body)
            raise NanoBananaError(f"Gemini {e.code}: {body}")
        if "error" in out:
            raise NanoBananaError(f"Gemini: {out['error'].get('message')}")
        return out

    def credits(self) -> str:
        out = self._call(f"/models/{self.model}")
        return f"модель {out.get('name')} доступна"

    def image(self, prompt: str) -> bytes:
        import base64
        cfg = {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": "1:1"}}
        for attempt in range(4):
            try:
                out = self._call(f"/models/{self.model}:generateContent",
                                 {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": cfg})
                break
            except RateLimited:
                time.sleep(20 * (attempt + 1))
        else:
            raise NanoBananaError("Gemini: лимит запросов (429) не отпускает")
        for cand in out.get("candidates") or []:
            for part in (cand.get("content") or {}).get("parts") or []:
                data = (part.get("inlineData") or {}).get("data")
                if data:
                    return base64.b64decode(data)
        reason = (out.get("candidates") or [{}])[0].get("finishReason") or out.get("promptFeedback")
        raise NanoBananaError(f"Gemini: картинки нет в ответе ({reason})")


class RateLimited(Exception):
    pass


def make_provider(key: str, model: str | None = None):
    """nb_… → NanoBanana API; иначе ключ Google → Gemini напрямую."""
    if key.startswith("nb_"):
        return NanoBanana(key)
    return Gemini(key, model or GEMINI_MODEL)


# ─────────────────────────────────────────────────────────────────────────────
# Открытые фото: запросы и фильтр релевантности
# ─────────────────────────────────────────────────────────────────────────────
TRANSLIT = dict(zip(
    "абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
    ["a", "b", "v", "g", "d", "e", "e", "zh", "z", "i", "y", "k", "l", "m", "n", "o", "p", "r", "s", "t", "u", "f",
     "kh", "ts", "ch", "sh", "sch", "", "y", "", "e", "yu", "ya"],
))
GENERIC = {
    "beer", "lager", "ale", "light", "dark", "premium", "original", "classic", "wine", "red", "white", "dry", "brut",
    "vodka", "whisky", "whiskey", "cider", "gold", "extra", "strong", "pivo", "svetloe", "temnoe", "non", "alcoholic",
    "free", "zero", "the", "and", "old", "new", "blonde", "blond", "special", "export", "draft", "draught", "pils",
    "pilsner", "pilsener", "stout", "ipa", "porter", "reserve", "select", "ice", "cold", "pure", "royal", "brewery",
    "пиво", "светлое", "темное", "тёмное", "крепкое", "вода", "сидр", "вино", "квас", "безалкогольное",
}
CAT_WORDS = {
    "beer": "beer", "na_beer": "beer", "radler": "radler", "cider": "cider", "wine": "wine", "sparkling": "sparkling wine",
    "fortified": "wine", "spirit": "bottle", "liqueur": "liqueur", "cocktail": "cocktail", "kvass": "kvass",
    "dairy": "drink", "soda": "soda", "lemonade": "lemonade", "water": "mineral water", "tea": "tea", "coffee": "coffee",
}


def translit(s: str) -> str:
    out = []
    for ch in s:
        low = ch.lower()
        if low in TRANSLIT:
            t = TRANSLIT[low]
            out.append(t.capitalize() if ch.isupper() else t)
        else:
            out.append(ch)
    return "".join(out)


def tokens(d: dict) -> list[str]:
    """Отличительные слова названия (латиница + транслит), без общих слов вроде beer/lager."""
    name = re.sub(r"\(.*?\)", " ", d["name"])
    words = re.findall(r"[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё'’-]{2,}", name)
    out: list[str] = []
    for w in words:
        for form in {w.lower(), translit(w).lower()}:
            if form and form not in GENERIC and form not in out:
                out.append(form)
    return out


def queries(d: dict) -> list[tuple[str, str]]:
    name = re.sub(r"\(.*?\)", " ", d["name"]).strip()
    lat = translit(name)
    cat = CAT_WORDS.get(d.get("category") or "", "")
    producer = ((d.get("producer") or {}).get("name") or "").split("(")[0].strip()
    qs: list[tuple[str, str]] = [("commons", f'"{name}"')]
    if lat != name:
        qs.append(("commons", f'"{lat}"'))
    qs.append(("commons", f"{lat} {cat}".strip()))
    if producer and producer.lower() not in lat.lower():
        qs.append(("commons", f"{translit(producer)} {lat}"))
    qs.append(("openverse", f"{lat} {cat}".strip()))
    return qs


PRODUCT_RE = re.compile(
    r"(?i)bottle|botella|bouteille|flasche|butelk|l[áa]hev|бутыл|банк|\bcan\b|cans\b|glass|glas\b|бокал|кружк|стакан|"
    r"\bpint|\bmug|pour|draught|draft|label|etikett|\bbeer|\bbier|\bpivo|cerveza|bi[èe]re|piwo|\bale\b|lager|stout|"
    r"\bwine|\bvino|\bvin\b|whisk|vodka|\brum\b|\bgin\b|cognac|brandy|liqueur|cocktail|cider|cidre|sidr|kvas|квас|"
    r"\bwater\b|mineral|\bdrink|напит|пиво|вино|водк|коньяк")
BAD_RE = re.compile(
    r"(?i)\bpark|brewery|brauerei|пивовар|building|\bhall|factory|plant\b|museum|street|stra[sß]e|\bshop|store|window|"
    r"escaparate|\bsign\b|logo|truck|lorry|train|tram|\bbus\b|advert|reklam|poster|billboard|stadium|arena|\bteam|"
    r"football|basketball|soccer|cycling|festival|crowd|people|portrait|\bman\b|woman|girl|\bboy\b|\bmap\b|coaster|"
    r"bottle cap|crown cork|\btent|umbrella|neon|booth|\bvan\b|\bcar\b|bicycle|boat|ship|station|tower|monument|"
    r"\bcity|town|village|river|lake|mountain|landscape|aerial|interior|exterior|facade|house|garden|headquarters|"
    r"office|tasting room|\bpub\b|\bbar\b|restaurant|cafe|kitchen|crate|pallet|warehouse|\bline\b|conveyor|"
    r"vending|fridge|refrigerator|shelf|shelves|supermarket|market|\b1[89]\d\d\b|\bwall\b|graffiti|mural|"
    r"keg|barrel|cask|tank|vat|\bbox\b|carton|packag|cardboard|delivery|airport|hotel|\bpool|beach|concert|parade|"
    r"widget|\bball\b|empty|glassware|collection|rack|tray|cup holder|opener|t-shirt|\bhat\b|merch")
BOTTLE_RE = re.compile(r"(?i)bottle|botella|bouteille|flasche|butelk|бутыл|\bcan\b|\bcans\b|банк")


def relevance(c: dict, toks: list[str]) -> int:
    """0 = отклонить. Иначе: число слов бренда в названии/категориях файла (+1, если все слова там)."""
    title = c.get("title", "").lower()
    cats = c.get("categories", "").lower()
    desc = c.get("desc", "").lower()
    head = translit(title + " " + cats)
    if BAD_RE.search(title) or BAD_RE.search(desc) or BAD_RE.search(cats):
        return 0
    hits = sum(1 for t in toks if t in head)
    if hits == 0:
        return 0
    if not PRODUCT_RE.search(title + " " + desc + " " + cats):
        return 0
    return hits + (1 if hits == len(toks) else 0) + (2 if BOTTLE_RE.search(title) else 0)


def acceptable_drink(c: dict) -> tuple[bool, str]:
    if not c.get("license"):
        return False, "лицензия"
    if c.get("mime") and c["mime"] not in ("image/jpeg", "image/png", "image/webp"):
        return False, c["mime"]
    if min(c.get("width") or 0, c.get("height") or 0) < MIN_SIDE_WEB:
        return False, "мало пикселей"
    if fdp.BAD_TITLE.search(c.get("title", "")):
        return False, "не фото"
    if re.search(r"(?i)personality|insignia", c.get("restrictions", "")):
        return False, "ограничения"
    return True, ""


def find_open_photo(d: dict) -> dict | None:
    toks = tokens(d)
    if not toks:
        return None
    seen: set[str] = set()
    best: tuple[tuple[int, int], dict] | None = None
    for src, q in queries(d):
        try:
            res = fdp.commons_search(q, limit=20, thumb=1000) if src == "commons" else fdp.openverse_search(q, limit=15)
        except Exception as e:  # noqa: BLE001
            print(f"    ! {src} «{q}»: {e}", file=sys.stderr)
            continue
        for c in res:
            key = f"{c['source']}:{c['ref']}"
            if key in seen:
                continue
            seen.add(key)
            ok, _why = acceptable_drink(c)
            if not ok:
                continue
            score = relevance(c, toks)
            if score == 0:
                continue
            rank = (score, min(c["width"], c["height"]))
            if best is None or rank > best[0]:
                best = (rank, c)
        if best and best[0][0] > len(toks) + 2:
            break  # нашли файл со всеми отличительными словами в названии — дальше не ищем
    return best[1] if best else None


def download(c: dict) -> bytes:
    url = c.get("thumb") or c["full"]  # превью ~1000 px достаточно для 600×600 и экономит трафик
    return fdp.http_get(url, binary=True)


# ─────────────────────────────────────────────────────────────────────────────
# Обработка картинки: фон долой, центр, 600×600 WebP
# ─────────────────────────────────────────────────────────────────────────────
_rembg_lock = threading.Lock()
_rembg_session = None


def cutout(im: Image.Image) -> Image.Image:
    global _rembg_session
    from rembg import new_session, remove  # импорт здесь: тяжёлый, нужен не для всех подкоманд
    with _rembg_lock:
        if _rembg_session is None:
            _rembg_session = new_session("u2net")
        return remove(im.convert("RGB"), session=_rembg_session)


def to_card(raw: bytes) -> Image.Image:
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(raw)))
    im.thumbnail((1400, 1400))
    rgba = cutout(im)
    bbox = rgba.getbbox()
    if not bbox or (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) < 0.02 * rgba.width * rgba.height:
        raise ValueError("после удаления фона почти ничего не осталось")
    obj = rgba.crop(bbox)
    inner = int(SIZE * 0.92)
    obj.thumbnail((inner, inner), Image.LANCZOS)
    card = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    card.paste(obj, ((SIZE - obj.width) // 2, (SIZE - obj.height) // 2), obj)
    return card


def save_webp(card: Image.Image, path: Path) -> int:
    q = WEBP_QUALITY
    while True:
        buf = io.BytesIO()
        card.save(buf, "WEBP", quality=q, method=6)
        if buf.tell() <= MAX_BYTES or q <= 50:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(buf.getvalue())
            return buf.tell()
        q -= 8


# ─────────────────────────────────────────────────────────────────────────────
# Данные
# ─────────────────────────────────────────────────────────────────────────────
def load_drinks() -> list[dict]:
    return json.loads(DRINKS.read_text(encoding="utf-8"))


def write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")  # indent=1 как в репозитории


def apply_results(results: dict[str, dict]) -> None:
    """results: id → {"image": "img/beers/x.webp", "image_credit": {...}}; пишет в оба drinks.json."""
    for path in (DRINKS, DRINKS_SRC):
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        n = 0
        for d in data:
            r = results.get(d["id"])
            if r:
                d["image"] = r["image"]
                d["image_credit"] = r["image_credit"]
                n += 1
        write_json(path, data)
        print(f"  {path.relative_to(ROOT)}: обновлено {n}")


def credit_for_open(c: dict) -> dict:
    return {
        "author": c.get("author") or "неизвестный автор",
        "license": c["license"],
        "license_url": c.get("license_url") or "",
        "source": c.get("page") or c.get("title") or c["ref"],
    }


def build_credits(drinks: list[dict]) -> str:
    with_img = [d for d in drinks if d.get("image")]
    brand = [d for d in with_img if not d.get("image_credit")]
    ai = [d for d in with_img if (d.get("image_credit") or {}).get("source") == AI_CREDIT["source"]]
    open_ = [d for d in with_img if d.get("image_credit") and d not in ai]
    lines = [
        "# Фото напитков: авторы и лицензии", "",
        f"{len(brand)} фото флагманских сортов Efes сделаны из рендеров бренда (`backend/media/brands/hd`).",
        f"{len(ai)} карточек напитков не из портфеля Efes — ИИ-иллюстрации (NanoBanana API, модель Gemini 2.5 Flash Image),",
        "сгенерированы по описанию из каталога: это условное изображение, не фотография реального продукта,",
        "подпись об этом выводится под картинкой.",
        f"{len(open_)} фото найдены через Wikimedia Commons и Openverse под открытыми лицензиями",
        "(CC0, Public Domain, CC BY, CC BY-SA — разрешают коммерческое использование и изменение).",
        "CC BY и CC BY-SA требуют указывать автора и лицензию: подпись со ссылками выводится под фото",
        "в карточке напитка, данные лежат в поле `image_credit` в `backend/data/engine/drinks.json`.",
        "Все файлы: фон удалён (rembg/U2-Net), продукт отцентрован на прозрачном холсте 600×600, WebP.",
        "Фирменные рендеры Efes (media/brands) не изменялись, у них фон уже прозрачный.",
        "", f"Обновлено: {datetime.now(timezone.utc).strftime('%Y-%m-%d')}. Скрипт: `scripts/gen_drink_photos.py`.", "",
        "| Файл | Напиток | Автор | Лицензия | Источник |", "|---|---|---|---|---|",
    ]
    for d in sorted(open_ + ai, key=lambda x: x["id"]):
        c = d["image_credit"]
        lic = f"[{c['license']}]({c['license_url']})" if c.get("license_url") else c["license"]
        src = c.get("source") or ""
        src_md = f"[страница файла]({src})" if src.startswith("http") else src
        lines.append(f"| {Path(d['image']).name} | {d['name']} | {c.get('author', '')} | {lic} | {src_md} |")
    return "\n".join(lines) + "\n"


# ─────────────────────────────────────────────────────────────────────────────
# Запуск
# ─────────────────────────────────────────────────────────────────────────────
def process_one(d: dict, nb, use_web: bool, only_missing: bool) -> dict:
    """→ {"id", "status": ai|web|kept|none|error, "note", "bytes", "result": {...}|None}"""
    out_path = OUT_DIR / f"{d['id']}.webp"
    has = bool(d.get("image"))
    if nb is not None and not (only_missing and has):
        try:
            raw = nb.image(build_prompt(d))
            n = save_webp(to_card(raw), out_path)
            return {"id": d["id"], "status": "ai", "bytes": n,
                    "result": {"image": f"img/beers/{d['id']}.webp", "image_credit": dict(AI_CREDIT)}}
        except NanoBananaError as e:
            if "не принят" in str(e) or "402" in str(e) or "лимит" in str(e):
                raise  # ключ/кредиты: дальше ИИ бесполезен, сообщаем наверх
            note = f"ИИ: {e}"
        except Exception as e:  # noqa: BLE001
            note = f"ИИ: {e}"
    else:
        note = ""
    if has:
        return {"id": d["id"], "status": "kept", "note": note or "фото уже есть", "result": None}
    if not use_web:
        return {"id": d["id"], "status": "none", "note": note or "веб-поиск выключен", "result": None}
    try:
        c = find_open_photo(d)
        if not c:
            return {"id": d["id"], "status": "none", "note": (note + "; " if note else "") + "в открытых источниках нет", "result": None}
        n = save_webp(to_card(download(c)), out_path)
        return {"id": d["id"], "status": "web", "bytes": n, "note": f"{c['source']}: {c['title']} ({c['license']})",
                "result": {"image": f"img/beers/{d['id']}.webp", "image_credit": credit_for_open(c)}}
    except Exception as e:  # noqa: BLE001
        return {"id": d["id"], "status": "error", "note": (note + "; " if note else "") + f"веб: {e}", "result": None}


def cmd_run(args: argparse.Namespace) -> None:
    drinks = load_drinks()
    todo = [d for d in drinks if (d.get("efes_relation") or "none") == "none"]
    if args.ids:
        want = set(args.ids)
        todo = [d for d in todo if d["id"] in want]
    if args.only_missing:
        todo = [d for d in todo if not d.get("image")]
    if args.limit:
        todo = todo[: args.limit]
    print(f"Напитков к обработке: {len(todo)} (без фото: {sum(1 for d in todo if not d.get('image'))})")

    nb = None
    key = args.key or os.environ.get("NANOBANANA_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not args.no_ai:
        if not key:
            print("NanoBanana: ключ не задан (NANOBANANA_API_KEY) — шаг ИИ пропущен")
        else:
            try:
                prov = make_provider(key, args.model)
                print(f"{type(prov).__name__}: ключ принят, {prov.credits()}")
                nb = prov
            except NanoBananaError as e:
                print(f"NanoBanana: {e} — шаг ИИ пропущен, идём в открытые источники")
            except Exception as e:  # noqa: BLE001
                print(f"NanoBanana: недоступен ({e}) — шаг ИИ пропущен")

    if args.dry_run:
        for d in todo:
            print(f"\n{d['id']} [{'есть фото' if d.get('image') else 'нет фото'}]\n  промпт: {build_prompt(d)}\n  запросы: {queries(d)}\n  токены: {tokens(d)}")
        return

    results: dict[str, dict] = {}
    report: list[dict] = []
    stop_ai = threading.Event()

    def work(d: dict) -> dict:
        nonlocal nb
        try:
            return process_one(d, None if stop_ai.is_set() else nb, not args.no_web, args.only_missing)
        except NanoBananaError as e:
            print(f"  !! NanoBanana остановлен: {e}", file=sys.stderr)
            stop_ai.set()
            return process_one(d, None, not args.no_web, args.only_missing)

    workers = args.workers if nb is not None else 1  # Commons просит не параллелить
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(work, d): d for d in todo}
        for i, fut in enumerate(as_completed(futs), 1):
            r = fut.result()
            report.append(r)
            if r.get("result"):
                results[r["id"]] = r["result"]
            mark = {"ai": "ИИ ", "web": "веб", "kept": "ост", "none": "---", "error": "ERR"}[r["status"]]
            print(f"[{i:3}/{len(todo)}] {mark} {r['id']:40} {r.get('note', '')[:90]}")

    if results:
        apply_results(results)
        drinks = load_drinks()
        CREDITS.write_text(build_credits(drinks), encoding="utf-8")
        print(f"  {CREDITS.relative_to(ROOT)}: перестроен")

    from collections import Counter
    stat = Counter(r["status"] for r in report)
    total_with = sum(1 for d in load_drinks() if d.get("image"))
    print(f"\nИтог за {time.time() - t0:.0f} с: {dict(stat)}; всего напитков с фото: {total_with}/{len(drinks)}")
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / "last_run.json").write_text(json.dumps({
        "when": datetime.now(timezone.utc).isoformat(), "stats": dict(stat),
        "files": sorted(f"frontend/public/img/beers/{i}.webp" for i in results), "report": report,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"отчёт: {CACHE / 'last_run.json'}")


def cmd_check_key(args: argparse.Namespace) -> None:
    key = args.key or os.environ.get("NANOBANANA_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not key:
        raise SystemExit("ключ не задан: --key, NANOBANANA_API_KEY или GEMINI_API_KEY")
    try:
        prov = make_provider(key, args.model)
        print(f"{type(prov).__name__}: ключ принят, {prov.credits()}")
    except NanoBananaError as e:
        raise SystemExit(f"NanoBanana: {e}")


EFES_RENDERS = {  # id напитка → файл рендера бренда (backend/media/brands); все RGBA, фон прозрачный
    "13-region": "hd/13_region_hd.png", "bavaria": "hd/bavaria_hd.png", "belyi-medved": "hd/belyi_medved_hd.png",
    "bochkovoe": "Bochkovoe.png", "bremen-von-lustig": "hd/bremen_hd.png", "efes-pilsener": "hd/efes_pilsener_hd.png",
    "karagandinskoe": "hd/karagandinskoe_hd.png", "khmelnoy-los": "hd/khmelnoy_los_hd.png",
    "kruzhka-svezhego": "hd/kruzhka_svezhego_hd.png", "legenda-777": "hd/legenda_777_hd.png",
    "miller-genuine-draft": "hd/miller_hd.png", "severnoe-siyanie": "hd/severnoe_siyanie_hd.png",
    "slavna-praga": "hd/praga_hd.png", "stary-melnik": "Melnik.png", "velkopopovicky-kozel": "hd/kozel_hd.png",
    "wukong-ju": "hd/wukong_hd.png", "zhigulevskoe": "hd/zhigulevskoe_hd.png",
}


def fit_card(rgba: Image.Image) -> Image.Image:
    """Прозрачный RGBA → обрезка по непрозрачному, центр на холсте 600×600 (как у остальных карточек)."""
    bbox = rgba.getbbox()
    obj = rgba.crop(bbox) if bbox else rgba
    inner = int(SIZE * 0.92)
    obj.thumbnail((inner, inner), Image.LANCZOS)
    card = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    card.paste(obj, ((SIZE - obj.width) // 2, (SIZE - obj.height) // 2), obj)
    return card


def cmd_efes(args: argparse.Namespace) -> None:
    """Рендеры Efes заново из PNG с альфой: прежняя конвертация в WebP теряла прозрачность (чёрный фон)."""
    ids = args.ids or list(EFES_RENDERS)
    for i in ids:
        src = ROOT / "backend" / "media" / "brands" / EFES_RENDERS[i]
        im = Image.open(src).convert("RGBA")
        if im.getchannel("A").getextrema()[0] >= 255:
            print(f"  ! {i}: у {src.name} нет прозрачности, пропуск")
            continue
        out = OUT_DIR / f"{i}.webp"
        n = save_webp(fit_card(im), out)
        print(f"  {i:24} ← {EFES_RENDERS[i]:28} {n // 1024} КБ")


def cmd_credits(_args: argparse.Namespace) -> None:
    CREDITS.write_text(build_credits(load_drinks()), encoding="utf-8")
    print(f"{CREDITS.relative_to(ROOT)}: перестроен")


def cmd_prompt(args: argparse.Namespace) -> None:
    for d in load_drinks():
        if d["id"] in args.ids:
            print(d["id"], "\n ", build_prompt(d), "\n  поиск:", queries(d), "\n  токены:", tokens(d))


def cmd_drop(args: argparse.Namespace) -> None:
    """Убрать фото у напитков: файл, поля image/image_credit в обоих drinks.json, CREDITS.md."""
    want = set(args.ids)
    for path in (DRINKS, DRINKS_SRC):
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        n = 0
        for d in data:
            if d["id"] in want and d.get("image"):
                d["image"] = None
                d.pop("image_credit", None)
                n += 1
        write_json(path, data)
        print(f"  {path.relative_to(ROOT)}: снято {n}")
    for i in want:
        f = OUT_DIR / f"{i}.webp"
        if f.exists():
            f.unlink()
    CREDITS.write_text(build_credits(load_drinks()), encoding="utf-8")


def cmd_sheet(args: argparse.Namespace) -> None:
    """Контактный лист (мелкий JPEG) для проверки глазами: ids или файлы последнего запуска."""
    ids = list(args.ids)
    if not ids:
        last = json.loads((CACHE / "last_run.json").read_text(encoding="utf-8"))
        ids = [Path(f).stem for f in last["files"]]
    cell, cols = 128, 8
    from PIL import ImageDraw
    rows = (len(ids) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * (cell + 14)), (235, 235, 235))
    draw = ImageDraw.Draw(sheet)
    for n, i in enumerate(ids):
        f = OUT_DIR / f"{i}.webp"
        if not f.exists():
            continue
        im = Image.open(f).convert("RGBA")
        im.thumbnail((cell - 4, cell - 4))
        x, y = (n % cols) * cell, (n // cols) * (cell + 14)
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        sheet.paste(Image.alpha_composite(bg, im).convert("RGB"), (x + 2, y + 2))
        draw.text((x + 2, y + cell), f"{n}:{i[:19]}", fill=(0, 0, 0))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out, "JPEG", quality=70)
    print(out, sheet.size, len(ids))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("ids", nargs="*")
    r.add_argument("--key")
    r.add_argument("--model", help=f"модель Gemini (по умолчанию {GEMINI_MODEL})")
    r.add_argument("--only-missing", action="store_true")
    r.add_argument("--no-ai", action="store_true")
    r.add_argument("--no-web", action="store_true")
    r.add_argument("--limit", type=int)
    r.add_argument("--dry-run", action="store_true")
    r.add_argument("--workers", type=int, default=4)
    r.set_defaults(fn=cmd_run)
    k = sub.add_parser("check-key")
    k.add_argument("--key")
    k.add_argument("--model")
    k.set_defaults(fn=cmd_check_key)
    sub.add_parser("credits").set_defaults(fn=cmd_credits)
    ef = sub.add_parser("efes")
    ef.add_argument("ids", nargs="*")
    ef.set_defaults(fn=cmd_efes)
    dr = sub.add_parser("drop")
    dr.add_argument("ids", nargs="+")
    dr.set_defaults(fn=cmd_drop)
    sh = sub.add_parser("sheet")
    sh.add_argument("ids", nargs="*")
    sh.add_argument("--out", default=str(CACHE / "sheet.jpg"))
    sh.set_defaults(fn=cmd_sheet)
    p = sub.add_parser("prompt")
    p.add_argument("ids", nargs="+")
    p.set_defaults(fn=cmd_prompt)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()

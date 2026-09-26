"""
Дневной лимит и учёт расходов ИИ-сомелье в общем кэше Django.

На Vercel кэш лежит в таблице базы (общий для всех инстансов функции), поэтому лимит общий
на весь сервис. Сутки считаются по времени Алматы. FT_AI_DAILY_LIMIT: сколько ответов Claude
можно за сутки (по умолчанию 300, 0 выключает Claude). Когда лимит исчерпан, отвечает
вкусовой движок, а гость видит понятную пометку. Жёсткий предел расходов всё равно стоит
задать в Anthropic Console: этот счётчик страхует, но не заменяет его.
"""
import logging
import os
from datetime import datetime
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.cache import cache

log = logging.getLogger(__name__)

TZ = ZoneInfo('Asia/Almaty')
DEFAULT_DAILY_LIMIT = 300
KEY_TTL = 2 * 24 * 3600
COUNTERS = ('requests', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'cost_microusd')

# Цены за 1 млн токенов в долларах: вход, выход и чтение из кэша (у Opus 5.5 это 0,05 входа, у остальных 0,1).
# Запись в кэш на 5 минут стоит 1,25 входа.
PRICES = {
    'claude-sonnet-5': (2.0, 10.0, 0.2),
    'claude-opus-5-5': (4.0, 20.0, 0.2),
    'claude-opus-5': (5.0, 25.0, 0.5),
    'claude-opus-4-8': (5.0, 25.0, 0.5),
    'claude-sonnet-4-6': (3.0, 15.0, 0.3),
    'claude-haiku-4-5': (1.0, 5.0, 0.1),
}


def daily_limit():
    raw = os.environ.get('FT_AI_DAILY_LIMIT', '').strip() or getattr(settings, 'FT_AI_DAILY_LIMIT', DEFAULT_DAILY_LIMIT)
    try:
        return max(0, int(raw))
    except (TypeError, ValueError):
        return DEFAULT_DAILY_LIMIT


def today():
    return datetime.now(TZ).strftime('%Y%m%d')


def _key(day, name):
    return 'ft_ai:{}:{}'.format(day, name)


def _add(day, name, amount):
    key = _key(day, name)
    cache.add(key, 0, KEY_TTL)
    try:
        return cache.incr(key, amount)
    except ValueError:  # ключ успел истечь между add и incr
        cache.set(key, amount, KEY_TTL)
        return amount


def reserve():
    """
    Занять один ответ Claude из дневного лимита. False, если лимит исчерпан.
    Если кэш недоступен, пропускаем: гость не должен страдать от сбоя счётчика.
    """
    limit = daily_limit()
    if limit <= 0:
        return False
    try:
        return _add(today(), 'requests', 1) <= limit
    except Exception:  # noqa: BLE001
        log.exception('ИИ-сомелье: счётчик лимита недоступен, запрос пропущен без проверки')
        return True


def limit_reached():
    limit = daily_limit()
    if limit <= 0:
        return True
    try:
        return (cache.get(_key(today(), 'requests')) or 0) >= limit
    except Exception:  # noqa: BLE001
        return False


def price_for(model):
    model = model or ''
    for prefix, price in PRICES.items():
        if model.startswith(prefix):
            return price
    return PRICES['claude-opus-5']  # неизвестная модель: считаем по дорогой, чтобы не занизить


def cost_usd(model, usage):
    """Стоимость одного ответа в долларах по токенам из usage."""
    price_in, price_out, price_cache_read = price_for(model)
    usage = usage or {}
    return (
        usage.get('input_tokens', 0) * price_in
        + usage.get('cache_read_tokens', 0) * price_cache_read
        + usage.get('cache_write_tokens', 0) * price_in * 1.25
        + usage.get('output_tokens', 0) * price_out
    ) / 1_000_000


def record(model, usage):
    """Прибавить токены и стоимость ответа к счётчикам дня. Ошибку кэша только пишем в лог."""
    if not usage:
        return
    day = today()
    try:
        for name in ('input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens'):
            if usage.get(name):
                _add(day, name, int(usage[name]))
        _add(day, 'cost_microusd', int(round(cost_usd(model, usage) * 1_000_000)))
    except Exception:  # noqa: BLE001
        log.exception('ИИ-сомелье: не удалось записать расход')


def snapshot():
    """Расход за сегодня для модератора: ответы, токены и оценка в долларах."""
    day = today()
    try:
        values = {name: cache.get(_key(day, name)) or 0 for name in COUNTERS}
    except Exception:  # noqa: BLE001
        values = {name: 0 for name in COUNTERS}
    return {
        'date': '{}-{}-{}'.format(day[:4], day[4:6], day[6:]),
        'limit': daily_limit(),
        'requests': values['requests'],
        'input_tokens': values['input_tokens'],
        'output_tokens': values['output_tokens'],
        'cache_read_tokens': values['cache_read_tokens'],
        'cache_write_tokens': values['cache_write_tokens'],
        'cost_usd': round(values['cost_microusd'] / 1_000_000, 4),
    }

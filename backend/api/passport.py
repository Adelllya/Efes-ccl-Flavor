"""
Паспорт вкуса: баллы знаний, ранг и значки пользователя.

Баллы даются за знания и открытия: уроки, тесты, новые сорта, услышанные ноты, оценки пар.
За покупки и объём баллы не даются, алкоголь наградой быть не может: так программа не
поощряет пить больше и не подпадает под запрет рекламы алкоголя через призы.

Баллы не хранятся отдельной суммой, а считаются из самих событий: счёт нельзя накрутить
повтором и он не расходится с данными.
"""
from django.db.models import Sum

from .models import (
    Brand, FlavorProfile, Lesson, LessonProgress, PairingVote, Redemption, Tasting,
)

POINTS_LESSON = 10
POINTS_LEVEL = 50
POINTS_TASTING = 15
POINTS_NOTES = 5
POINTS_FEEDBACK = 3
# Сколько совпавших нот даёт бонус за слух и за сколько оценок пар даются баллы
NOTES_BONUS_FROM = 2
FEEDBACK_CAP = 20

# Ранг считается по заработанным баллам и не падает, когда баллы потрачены на награду.
RANKS = [
    (0, 'Guest'),
    (40, 'Taster'),
    (150, 'Connoisseur'),
    (350, 'Flavor Expert'),
    (600, 'Flavor Ambassador'),
]


def rank_for(earned):
    """Текущий ранг и сколько баллов осталось до следующего."""
    index = 0
    for i, (threshold, _) in enumerate(RANKS):
        if earned >= threshold:
            index = i
    threshold, title = RANKS[index]
    nxt = RANKS[index + 1] if index + 1 < len(RANKS) else None
    return {
        'index': index,
        'title': title,
        'from': threshold,
        'next_title': nxt[1] if nxt else None,
        'next_at': nxt[0] if nxt else None,
        'to_next': max(nxt[0] - earned, 0) if nxt else 0,
    }


def pyramid_note_ids(brand_id):
    """Ноты пирамиды сорта, с которыми сравнивается услышанное."""
    return set(FlavorProfile.objects.filter(brand_id=brand_id).values_list('flavor_note_id', flat=True))


def passed_levels(user):
    return sorted(set(user.quiz_attempts.filter(passed=True).values_list('level', flat=True)))


def collect(user):
    """Все события пользователя, из которых складываются баллы."""
    tastings = list(
        Tasting.objects.filter(user=user).select_related('brand', 'venue').prefetch_related('notes')
    )
    return {
        'lessons': LessonProgress.objects.filter(user=user, lesson__is_active=True).count(),
        'levels': passed_levels(user),
        'tastings': tastings,
        'sharp': sum(1 for t in tastings if t.matched >= NOTES_BONUS_FROM),
        'feedback': PairingVote.objects.filter(user=user).count(),
    }


def breakdown(data):
    """Строки «за что начислено»: вид события, сколько раз и сколько баллов."""
    feedback_counted = min(data['feedback'], FEEDBACK_CAP)
    return [
        {'kind': 'lessons', 'label': 'Academy lessons', 'count': data['lessons'],
         'each': POINTS_LESSON, 'points': data['lessons'] * POINTS_LESSON},
        {'kind': 'levels', 'label': 'Levels passed', 'count': len(data['levels']),
         'each': POINTS_LEVEL, 'points': len(data['levels']) * POINTS_LEVEL},
        {'kind': 'tastings', 'label': 'New beers in the passport', 'count': len(data['tastings']),
         'each': POINTS_TASTING, 'points': len(data['tastings']) * POINTS_TASTING},
        {'kind': 'notes', 'label': 'Notes detected', 'count': data['sharp'],
         'each': POINTS_NOTES, 'points': data['sharp'] * POINTS_NOTES},
        {'kind': 'feedback', 'label': 'Pairing ratings', 'count': data['feedback'],
         'each': POINTS_FEEDBACK, 'points': feedback_counted * POINTS_FEEDBACK},
    ]


def spent_points(user):
    total = Redemption.objects.filter(user=user).exclude(
        status=Redemption.STATUS_CANCELLED).aggregate(total=Sum('cost'))['total']
    return total or 0


def balance(user):
    """Заработано, потрачено и остаток. Короткая версия для ответов после действий."""
    earned = sum(row['points'] for row in breakdown(collect(user)))
    spent = spent_points(user)
    return {'earned': earned, 'spent': spent, 'balance': max(earned - spent, 0), 'rank': rank_for(earned)}


def badges(data):
    """Значки: каждый считается из тех же событий, отдельно не хранится."""
    tastings = data['tastings']
    brands_total = Brand.objects.filter(is_active=True).count()
    lessons_total = Lesson.objects.filter(is_active=True).count()
    styles = len(set((t.brand.style or '').strip().lower() for t in tastings if (t.brand.style or '').strip()))
    draught = sum(1 for t in tastings if t.brand.packaging_type == 'DRAFT')

    def badge(key, title, description, progress, target):
        target = max(target, 1)
        return {
            'id': key, 'title': title, 'description': description,
            'progress': min(progress, target), 'target': target, 'earned': progress >= target,
        }

    return [
        badge('first-stamp', 'First Stamp', 'Mark your first beer in the passport', len(tastings), 1),
        badge('five-sorts', 'Five Beers', 'Try five different beers', len(tastings), 5),
        badge('full-line', 'Full Lineup', 'Mark every beer in the catalog', len(tastings), brands_total),
        badge('styles', 'Style Collector', 'Try four different styles', styles, 4),
        badge('sharp-nose', 'Sharp Nose', 'Three times, detect at least two notes from the sommelier pyramid', data['sharp'], 3),
        badge('draught', 'Fresh Draught', 'Try a draught beer: it leaves less packaging behind', draught, 1),
        badge('student', 'All Lessons', 'Read all Academy lessons', data['lessons'], lessons_total),
        badge('sommelier', 'Four Levels', 'Pass the tests of all four levels', len(data['levels']), 4),
        badge('critic', 'Pairing Critic', 'Rate five dish and beer pairings', data['feedback'], 5),
    ]

"""
Академия: путь из четырёх ступеней. В каждой ступени уроки и тест.
Читать уроки и проходить тест можно без входа, прогресс и баллы сохраняются у вошедших.
"""
from django.db import IntegrityError, transaction
from django.db.models import Count
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from . import passport
from .academy_content import load_lessons
from .models import Course, Lesson, LessonProgress, QuizAttempt, QuizQuestion, SiteSettings
from .serializers_passport import LessonCardSerializer, LessonSerializer
from .views_school import LEVELS, QUIZ_SIZE


def ensure_lessons():
    """Пустая таблица уроков (новая база, сброс данных) заполняется стартовым набором."""
    if Lesson.objects.exists():
        return
    try:
        with transaction.atomic():
            load_lessons(Lesson)
    except IntegrityError:
        # Два запроса пришли одновременно: уроки уже записал соседний.
        pass


def best_percents(user):
    """Лучший результат теста по каждой ступени."""
    best = {}
    for level, correct, total in user.quiz_attempts.values_list('level', 'correct', 'total'):
        percent = round(correct * 100 / total) if total else 0
        best[level] = max(best.get(level, 0), percent)
    return best


@api_view(['GET'])
@permission_classes([AllowAny])
def academy(request):
    """GET /api/academy/ - весь путь одной выдачей: ступени, уроки, размер теста и прогресс."""
    ensure_lessons()
    user = request.user if request.user.is_authenticated else None
    courses = {c.level: c for c in Course.objects.all()}
    lessons = list(Lesson.objects.filter(is_active=True))
    bank = dict(QuizQuestion.objects.filter(is_active=True).values('level')
                .annotate(n=Count('id')).values_list('level', 'n'))
    done = set()
    passed = []
    best = {}
    if user is not None:
        done = set(LessonProgress.objects.filter(user=user).values_list('lesson_id', flat=True))
        passed = passport.passed_levels(user)
        best = best_percents(user)

    levels = []
    for level, name in Course.LEVEL_CHOICES:
        course = courses.get(level)
        cards = []
        for lesson in lessons:
            if lesson.level != level:
                continue
            card = LessonCardSerializer(lesson).data
            card['done'] = lesson.id in done
            cards.append(card)
        questions = bank.get(level, 0)
        levels.append({
            'level': level,
            'name': name,
            'description': course.description if course else '',
            'color': course.color if course else '',
            'lessons': cards,
            'questions': questions,
            'quiz_size': min(QUIZ_SIZE, questions),
            'passed': level in passed,
            'best_percent': best.get(level),
        })

    lessons_done = sum(1 for lesson in lessons if lesson.id in done)
    progress = {
        'authenticated': user is not None,
        'lessons_done': lessons_done,
        'lessons_total': len(lessons),
        'passed_levels': passed,
        'points': passport.balance(user) if user is not None else None,
    }
    return Response({
        'pass_percent': QuizAttempt.PASS_PERCENT,
        'points': {'lesson': passport.POINTS_LESSON, 'level': passport.POINTS_LEVEL},
        'show_team': SiteSettings.load().show_team,
        'levels': levels,
        'progress': progress,
    })


def _lesson_or_404(slug):
    return Lesson.objects.filter(slug=slug, is_active=True).first()


def _next_lesson(lesson):
    """Следующий урок пути: в этой ступени, а после последнего - первый урок следующей."""
    ordered = list(Lesson.objects.filter(is_active=True).order_by('level', 'sort_order', 'created_at'))
    for index, item in enumerate(ordered):
        if item.pk == lesson.pk and index + 1 < len(ordered):
            return ordered[index + 1]
    return None


@api_view(['GET'])
@permission_classes([AllowAny])
def lesson_detail(request, slug):
    """GET /api/lessons/<slug>/ - урок целиком, отметка «прочитан» и следующий урок."""
    ensure_lessons()
    lesson = _lesson_or_404(slug)
    if lesson is None:
        return Response({'error': 'Урок не найден'}, status=status.HTTP_404_NOT_FOUND)
    data = LessonSerializer(lesson).data
    user = request.user
    data['done'] = bool(user.is_authenticated and LessonProgress.objects.filter(user=user, lesson=lesson).exists())
    nxt = _next_lesson(lesson)
    data['next'] = {'slug': nxt.slug, 'title': nxt.title, 'level': nxt.level} if nxt else None
    return Response(data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def lesson_complete(request, slug):
    """POST /api/lessons/<slug>/complete/ - урок прочитан. Баллы даются один раз."""
    lesson = _lesson_or_404(slug)
    if lesson is None:
        return Response({'error': 'Урок не найден'}, status=status.HTTP_404_NOT_FOUND)
    try:
        with transaction.atomic():
            _, created = LessonProgress.objects.get_or_create(user=request.user, lesson=lesson)
    except IntegrityError:
        created = False
    return Response({
        'done': True,
        'awarded': passport.POINTS_LESSON if created else 0,
        'points': passport.balance(request.user),
    })

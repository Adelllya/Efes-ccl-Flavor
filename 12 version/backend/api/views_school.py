"""
Предпочтения пользователя и тест Школы сомелье.
Тест открыт всем, но результат и ступень сохраняются только у вошедших.
"""
import random

from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from . import passport
from .models import Course, QuizAttempt, QuizQuestion, UserPreferences
from .permissions import IsSommelierOrModerator
from .serializers import (
    QuizPublicQuestionSerializer, QuizQuestionSerializer, UserPreferencesSerializer,
)

LEVELS = dict(Course.LEVEL_CHOICES)
# Сколько вопросов в одном тесте. Вопросов в ступени больше: каждый раз тест собирается заново.
QUIZ_SIZE = 7


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def preferences(request):
    """GET/PATCH /api/auth/preferences/ - вкус, любимые кухни и сорта текущего пользователя."""
    prefs = UserPreferences.for_user(request.user)
    if request.method == 'GET':
        return Response(UserPreferencesSerializer(prefs).data)
    serializer = UserPreferencesSerializer(prefs, data=request.data, partial=True)
    if not serializer.is_valid():
        return Response({'errors': serializer.errors}, status=status.HTTP_400_BAD_REQUEST)
    serializer.save()
    return Response(serializer.data)


def _level_or_404(level):
    if level not in LEVELS:
        return Response({'error': 'Такой ступени нет'}, status=status.HTTP_404_NOT_FOUND)
    return None


def _questions(level):
    return list(QuizQuestion.objects.filter(level=level, is_active=True))


def _completed_level(user):
    """Сколько ступеней подряд, начиная с первой, пользователь сдал."""
    passed = set(user.quiz_attempts.filter(passed=True).values_list('level', flat=True))
    level = 0
    while level + 1 in passed:
        level += 1
    return level


@api_view(['GET'])
@permission_classes([AllowAny])
def quiz(request, level):
    """GET /api/quiz/<level>/ - случайные вопросы ступени (не больше QUIZ_SIZE) без верных ответов."""
    missing = _level_or_404(level)
    if missing:
        return missing
    questions = _questions(level)
    if len(questions) > QUIZ_SIZE:
        questions = random.sample(questions, QUIZ_SIZE)
    return Response({
        'level': level,
        'title': LEVELS[level],
        'pass_percent': QuizAttempt.PASS_PERCENT,
        'questions': QuizPublicQuestionSerializer(questions, many=True).data,
    })


@api_view(['POST'])
@permission_classes([AllowAny])
def quiz_submit(request, level):
    """
    POST /api/quiz/<level>/submit/ {answers: {question_id: index}}
    -> разбор каждого вопроса, итог и (для вошедших) новая ступень.
    """
    missing = _level_or_404(level)
    if missing:
        return missing
    answers = request.data.get('answers') if isinstance(request.data, dict) else None
    if not isinstance(answers, dict):
        return Response({'errors': {'answers': ['Ожидается объект {id вопроса: номер ответа}']}},
                        status=status.HTTP_400_BAD_REQUEST)
    bank = _questions(level)
    if not bank:
        return Response({'error': 'В этой ступени пока нет вопросов'}, status=status.HTTP_400_BAD_REQUEST)
    # Проверяем те вопросы, которые были в тесте гостя. Меньше размера теста прислать нельзя:
    # иначе тест сдавался бы одним лёгким вопросом.
    questions = [q for q in bank if str(q.id) in answers]
    required = min(QUIZ_SIZE, len(bank))
    if len(questions) < required:
        return Response({'errors': {'answers': ['Ответьте на все вопросы теста: их {}'.format(required)]}},
                        status=status.HTTP_400_BAD_REQUEST)

    results = []
    correct = 0
    for q in questions:
        chosen = answers.get(str(q.id))
        if isinstance(chosen, bool) or not isinstance(chosen, int):
            chosen = None
        ok = chosen == q.correct_index
        correct += ok
        results.append({
            'id': str(q.id),
            'chosen': chosen,
            'correct_index': q.correct_index,
            'is_correct': ok,
            'explanation': q.explanation,
        })
    total = len(questions)
    percent = round(correct * 100 / total)
    passed = percent >= QuizAttempt.PASS_PERCENT

    payload = {
        'level': level,
        'correct': correct,
        'total': total,
        'percent': percent,
        'passed': passed,
        'pass_percent': QuizAttempt.PASS_PERCENT,
        'results': results,
        'saved': False,
    }
    user = request.user
    if user.is_authenticated:
        with transaction.atomic():
            QuizAttempt.objects.create(user=user, level=level, correct=correct, total=total, passed=passed)
            prefs = UserPreferences.for_user(user)
            prefs.sommelier_level = _completed_level(user)
            prefs.save(update_fields=['sommelier_level', 'updated_at'])
        payload['saved'] = True
        payload['sommelier_level'] = prefs.sommelier_level
        payload['points'] = passport.balance(user)
    return Response(payload)


class QuizQuestionViewSet(viewsets.ModelViewSet):
    """
    /api/quiz-questions/ - вопросы теста целиком, с верными ответами.
    Только сомелье и модератор: гость видит вопросы через /api/quiz/<level>/.
    """
    queryset = QuizQuestion.objects.all()
    serializer_class = QuizQuestionSerializer
    permission_classes = [IsSommelierOrModerator]
    pagination_class = None

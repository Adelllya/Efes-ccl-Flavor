"""
Мелкая защита запросов до того, как они дойдут до базы.
"""
from django.http import JsonResponse


class RejectNulMiddleware:
    """Нулевой байт в строке запроса база не принимает и отвечает исключением: отдаём 400 сразу."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        query = request.META.get('QUERY_STRING', '')
        if '%00' in query or '\x00' in query:
            return JsonResponse({'detail': 'Недопустимый символ в запросе'}, status=400)
        return self.get_response(request)

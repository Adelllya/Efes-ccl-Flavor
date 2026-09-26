"""
python manage.py rotate_demo_passwords [--users moderator restaurant] [--close]

Меняет пароли демо-учёток из seed_roles и отзывает их токены входа: все устройства,
где под ними входили (в том числе по старому публичному паролю), выходят из системы.

Новый пароль берётся из FT_PASSWORD_<ИМЯ> (FT_PASSWORD_MODERATOR и т.д.), иначе
генерируется и печатается один раз. С --close вход по паролю закрывается совсем.
На прод-базе запускать так: DATABASE_URL="<строка Neon>" python manage.py rotate_demo_passwords
"""
from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from api.demo_accounts import (
    apply_password, demo_users, env_name, env_password, generate_password, revoke_tokens,
)


class Command(BaseCommand):
    help = 'Меняет пароли демо-учёток (moderator, sommelier, restaurant, guest) и отзывает их токены'

    def add_arguments(self, parser):
        parser.add_argument('--users', nargs='+', metavar='USERNAME',
                            help='Только эти учётки (по умолчанию все демо-учётки)')
        parser.add_argument('--close', action='store_true',
                            help='Закрыть вход по паролю вместо нового пароля')

    def handle(self, *args, **options):
        known = list(demo_users())
        wanted = options.get('users') or known
        unknown = sorted(set(wanted) - set(known))
        if unknown:
            raise CommandError('Это не демо-учётки: {}. Демо-учётки: {}'.format(', '.join(unknown), ', '.join(known)))

        users = list(User.objects.filter(username__in=wanted).order_by('username'))
        if not users:
            self.stdout.write('Демо-учёток в базе нет, менять нечего')
            return

        lines = []
        with transaction.atomic():
            for user in users:
                if options.get('close'):
                    password, shown = None, 'вход по паролю закрыт'
                elif env_password(user.username):
                    password, shown = env_password(user.username), 'пароль из ' + env_name(user.username)
                else:
                    password = generate_password()
                    shown = f'новый пароль: {password}'
                apply_password(user, password)
                user.save(update_fields=['password'])
                lines.append(f'  {user.username}: {shown}')
            revoked = revoke_tokens(users)

        self.stdout.write('Пароли демо-учёток изменены (сгенерированный пароль показан только сейчас, сохраните его):')
        for line in lines:
            self.stdout.write(line)
        self.stdout.write(self.style.SUCCESS(f'Отозвано токенов входа: {revoked}'))

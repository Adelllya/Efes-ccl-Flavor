from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.authtoken.models import Token

from api.models import Venue
from .helpers import PASSWORD, make_user, client_for, make_venue, token_for


class RegisterLoginTests(TestCase):
    def test_register_returns_token_and_user_role(self):
        client = client_for()
        resp = client.post('/api/auth/register/', {
            'username': 'newbie', 'email': 'newbie@example.kz',
            'password': 'very-secret-987', 'first_name': 'Айдар', 'consent': True,
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertIn('token', resp.data)
        user = resp.data['user']
        self.assertEqual(user['username'], 'newbie')
        self.assertEqual(user['role'], 'user')
        self.assertEqual(user['role_display'], 'Пользователь')
        self.assertIsNone(user['venue'])
        self.assertFalse(user['is_superuser'])
        self.assertEqual(user['first_name'], 'Айдар')

    def test_register_rejects_duplicate_username_and_weak_password(self):
        make_user('taken')
        client = client_for()
        resp = client.post('/api/auth/register/', {
            'username': 'taken', 'email': 'other@example.kz', 'password': '123',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('username', resp.data['errors'])
        self.assertIn('password', resp.data['errors'])

    def test_register_rejects_username_with_spaces(self):
        resp = client_for().post('/api/auth/register/', {
            'username': 'john doe', 'email': 'john@example.kz', 'password': 'very-secret-987',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('username', resp.data['errors'])

    def test_register_requires_privacy_consent(self):
        payload = {'username': 'noconsent', 'email': 'noconsent@example.kz', 'password': 'very-secret-987'}
        for consent in (None, False, 'false', ''):
            body = dict(payload) if consent is None else {**payload, 'consent': consent}
            resp = client_for().post('/api/auth/register/', body, format='json')
            self.assertEqual(resp.status_code, 400, consent)
            self.assertEqual(resp.data['errors']['consent'], ['Подтвердите согласие на обработку персональных данных'])
        self.assertFalse(User.objects.filter(username='noconsent').exists())

        resp = client_for().post('/api/auth/register/', {**payload, 'consent': True}, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)

    def test_register_reports_consent_together_with_field_errors(self):
        resp = client_for().post('/api/auth/register/', {
            'username': 'john doe', 'email': 'john@example.kz', 'password': 'very-secret-987',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('username', resp.data['errors'])
        self.assertIn('consent', resp.data['errors'])

    def test_login_ignores_stale_token_header(self):
        make_user('somm', role='sommelier')
        client = client_for()
        client.credentials(HTTP_AUTHORIZATION='Token 0000stale0000')
        resp = client.post('/api/auth/login/', {'username': 'somm', 'password': PASSWORD}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        resp = client.post('/api/auth/register/', {
            'username': 'fresh', 'email': 'fresh@example.kz', 'password': 'very-secret-987',
            'consent': True,
        }, format='json')
        self.assertEqual(resp.status_code, 201, resp.content)

    def test_login_with_username_and_with_email(self):
        make_user('somm', role='sommelier', email='somm@example.kz')
        client = client_for()
        resp = client.post('/api/auth/login/', {'username': 'somm', 'password': PASSWORD}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['user']['role'], 'sommelier')
        self.assertEqual(resp.data['user']['role_display'], 'Сомелье')

        resp = client.post('/api/auth/login/', {'username': 'somm@example.kz', 'password': PASSWORD}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['user']['username'], 'somm')

    def test_login_wrong_password(self):
        make_user('somm')
        resp = client_for().post('/api/auth/login/', {'username': 'somm', 'password': 'nope'}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['detail'], 'Неверный логин или пароль')

    def test_superuser_is_moderator(self):
        admin = make_user('admin', superuser=True)
        resp = client_for(admin).get('/api/auth/me/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['role'], 'moderator')
        self.assertEqual(resp.data['role_display'], 'Модератор')
        self.assertTrue(resp.data['is_superuser'])


class ProfileTests(TestCase):
    def setUp(self):
        self.user = make_user('plain')
        self.client_auth = client_for(self.user)

    def test_me_requires_auth(self):
        resp = client_for().get('/api/auth/me/')
        self.assertEqual(resp.status_code, 401)

    def test_me_patch_updates_name_and_email(self):
        resp = self.client_auth.patch('/api/auth/me/', {'first_name': 'Дана', 'email': 'dana@example.kz'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['first_name'], 'Дана')
        self.assertEqual(resp.data['email'], 'dana@example.kz')

    def test_me_shows_owned_venue(self):
        venue = make_venue(owner=self.user)
        resp = self.client_auth.get('/api/auth/me/')
        self.assertEqual(resp.data['venue'], {'id': str(venue.id), 'slug': 'efes-beer-garden', 'name': 'Efes Beer Garden'})

    def test_logout_keeps_other_devices(self):
        # Обычный выход: фронт забывает токен, планшет бара под тем же аккаунтом остаётся в системе.
        resp = self.client_auth.post('/api/auth/logout/')
        self.assertEqual(resp.status_code, 204)
        self.assertTrue(Token.objects.filter(user=self.user).exists())
        self.assertEqual(self.client_auth.get('/api/auth/me/').status_code, 200)

    def test_logout_everywhere_deletes_token(self):
        resp = self.client_auth.post('/api/auth/logout/', {'everywhere': True}, format='json')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(Token.objects.filter(user=self.user).exists())
        self.assertEqual(self.client_auth.get('/api/auth/me/').status_code, 401)

    def test_change_password_issues_new_token(self):
        old_token = Token.objects.get(user=self.user).key
        resp = self.client_auth.post('/api/auth/change-password/', {
            'old_password': PASSWORD, 'new_password': 'another-secret-456',
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertNotEqual(resp.data['token'], old_token)
        login = client_for().post('/api/auth/login/', {'username': 'plain', 'password': 'another-secret-456'}, format='json')
        self.assertEqual(login.status_code, 200)

    def test_change_password_wrong_old(self):
        resp = self.client_auth.post('/api/auth/change-password/', {
            'old_password': 'wrong', 'new_password': 'another-secret-456',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('old_password', resp.data['errors'])


class UsersAdminTests(TestCase):
    def setUp(self):
        self.moderator = make_user('mod', role='moderator')
        self.somm = make_user('somm', role='sommelier')
        self.mod_client = client_for(self.moderator)

    def test_users_list_moderator_only(self):
        resp = self.mod_client.get('/api/auth/users/')
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.data, list)
        self.assertEqual([u['username'] for u in resp.data], ['mod', 'somm'])
        self.assertEqual(client_for(self.somm).get('/api/auth/users/').status_code, 403)
        self.assertEqual(client_for().get('/api/auth/users/').status_code, 401)

    def test_moderator_changes_role(self):
        resp = self.mod_client.patch(f'/api/auth/users/{self.somm.id}/', {'role': 'restaurant_admin'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['role'], 'restaurant_admin')
        self.assertEqual(resp.data['role_display'], 'Администратор заведения')
        self.assertEqual(list(self.somm.groups.values_list('name', flat=True)), ['restaurant_admin'])

        resp = self.mod_client.patch(f'/api/auth/users/{self.somm.id}/', {'role': 'user'}, format='json')
        self.assertEqual(resp.data['role'], 'user')
        self.assertEqual(self.somm.groups.count(), 0)

    def test_unknown_role_rejected(self):
        resp = self.mod_client.patch(f'/api/auth/users/{self.somm.id}/', {'role': 'king'}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_moderator_cannot_demote_self(self):
        resp = self.mod_client.patch(f'/api/auth/users/{self.moderator.id}/', {'role': 'user'}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(self.moderator.groups.filter(name='moderator').count(), 1)

    def test_assign_venue_moves_ownership(self):
        old_owner = make_user('old_owner', role='restaurant_admin')
        venue = make_venue(owner=old_owner)
        resp = self.mod_client.patch(f'/api/auth/users/{self.somm.id}/', {'venue': str(venue.id)}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['venue']['slug'], 'efes-beer-garden')
        venue.refresh_from_db()
        self.assertEqual(venue.owner, self.somm)

        resp = self.mod_client.patch(f'/api/auth/users/{self.somm.id}/', {'venue': None}, format='json')
        self.assertIsNone(resp.data['venue'])
        self.assertIsNone(Venue.objects.get(pk=venue.pk).owner)

    def test_invalid_venue_rolls_back_role_and_active(self):
        token_for(self.somm)
        resp = self.mod_client.patch(f'/api/auth/users/{self.somm.id}/', {
            'role': 'restaurant_admin', 'is_active': False, 'venue': 'not-a-uuid',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.somm.refresh_from_db()
        self.assertTrue(self.somm.is_active)
        self.assertEqual(list(self.somm.groups.values_list('name', flat=True)), ['sommelier'])
        self.assertTrue(Token.objects.filter(user=self.somm).exists())

    def test_reassigning_same_venue_keeps_it(self):
        venue = make_venue(owner=self.somm)
        resp = self.mod_client.patch(f'/api/auth/users/{self.somm.id}/', {'venue': str(venue.id), 'is_active': True}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(Venue.objects.get(pk=venue.pk).owner, self.somm)

    def test_superuser_protected_from_group_moderator(self):
        admin = make_user('admin', superuser=True)
        resp = self.mod_client.patch(f'/api/auth/users/{admin.id}/', {'is_active': False}, format='json')
        self.assertEqual(resp.status_code, 400)
        admin.refresh_from_db()
        self.assertTrue(admin.is_active)
        # Суперпользователь может менять другого суперпользователя, но не его роль.
        boss = make_user('boss', superuser=True)
        boss_client = client_for(boss)
        self.assertEqual(boss_client.patch(f'/api/auth/users/{admin.id}/', {'role': 'user'}, format='json').status_code, 400)
        self.assertEqual(boss_client.patch(f'/api/auth/users/{admin.id}/', {'role': 'moderator'}, format='json').status_code, 200)
        self.assertEqual(boss_client.patch(f'/api/auth/users/{admin.id}/', {'is_active': False}, format='json').status_code, 200)
        self.assertFalse(User.objects.get(pk=admin.pk).is_active)

    def test_deactivate_user(self):
        resp = self.mod_client.patch(f'/api/auth/users/{self.somm.id}/', {'is_active': False}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.somm.refresh_from_db()
        self.assertFalse(self.somm.is_active)
        login = client_for().post('/api/auth/login/', {'username': 'somm', 'password': PASSWORD}, format='json')
        self.assertEqual(login.status_code, 400)

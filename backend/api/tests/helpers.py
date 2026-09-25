"""Общие фабрики для тестов API."""
from django.contrib.auth.models import Group, User
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from api.models import Brand, Dish, FoodPairing, Venue, MenuItem
from api.permissions import GROUP_ROLES

PASSWORD = 'strong-pass-12345'


def make_user(username, role=None, superuser=False, email=None):
    user = User.objects.create_user(
        username=username, password=PASSWORD, email=email or (username + '@example.kz'),
    )
    if superuser:
        user.is_superuser = True
        user.is_staff = True
        user.save()
    if role in GROUP_ROLES:
        group, _ = Group.objects.get_or_create(name=role)
        user.groups.add(group)
    return user


def token_for(user):
    token, _ = Token.objects.get_or_create(user=user)
    return token.key


def client_for(user=None):
    client = APIClient()
    if user is not None:
        client.credentials(HTTP_AUTHORIZATION='Token ' + token_for(user))
    return client


def make_brand(name='Efes Pilsener', **extra):
    fields = {'style': 'Lager', 'abv': 5.0}
    fields.update(extra)
    return Brand.objects.create(name=name, **fields)


def make_dish(name='Бешбармак', **extra):
    fields = {'cuisine': 'KZ', 'category': 'Мясное', 'dominant_taste': 'UMAMI',
              'weight': 'HEAVY', 'fat_level': 'HIGH', 'cooking_method': 'BOILED'}
    fields.update(extra)
    return Dish.objects.create(name=name, **fields)


def make_pairing(brand, dish, score=4, pairing_type='COMPLEMENT', explanation='Подходит'):
    return FoodPairing.objects.create(
        brand=brand, dish=dish, compatibility_score=score,
        pairing_type=pairing_type, explanation=explanation,
    )


def make_venue(name='Efes Beer Garden', owner=None, **extra):
    fields = {'address': 'пр. Достык 100', 'venue_type': 'RESTAURANT'}
    fields.update(extra)
    return Venue.objects.create(name=name, owner=owner, **fields)


def make_menu_item(venue, dish, price='2400.00', section='Горячее', **extra):
    return MenuItem.objects.create(venue=venue, dish=dish, price=price, section=section, **extra)

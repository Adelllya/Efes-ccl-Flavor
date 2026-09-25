from django.test import TestCase

from api.models import Venue
from api.slugs import make_slug, unique_slug
from .helpers import make_venue


class SlugTests(TestCase):
    def test_latin_and_cyrillic(self):
        self.assertEqual(make_venue('Efes Beer Garden').slug, 'efes-beer-garden')
        self.assertEqual(make_venue('Бар 13').slug, 'bar-13')
        self.assertEqual(make_venue('Кафе «Шеңбер»').slug, 'kafe-shenber')

    def test_duplicates_get_suffix(self):
        make_venue('Бар 13')
        self.assertEqual(make_venue('Бар 13').slug, 'bar-13-2')
        self.assertEqual(make_venue('Бар 13').slug, 'bar-13-3')

    def test_slug_kept_on_rename(self):
        venue = make_venue('Efes Beer Garden')
        venue.name = 'Другое имя'
        venue.save()
        self.assertEqual(Venue.objects.get(pk=venue.pk).slug, 'efes-beer-garden')

    def test_empty_name_fallback(self):
        self.assertEqual(make_slug('!!!'), 'venue')
        self.assertEqual(unique_slug('!!!', lambda s: s == 'venue'), 'venue-2')

"""Файлы деплоя в корне репозитория согласованы с backend/.

Сборка на Vercel из git идёт от корня репозитория (vercel.json в корне), а деплой из CLI
делается из папки backend/. Копии requirements.txt и .python-version в корне должны совпадать
с бэкендовыми, иначе на проде окажутся другие версии пакетов.
"""
import json
import re
from pathlib import Path

from django.test import SimpleTestCase

ROOT = Path(__file__).resolve().parents[3]
BACKEND = ROOT / 'backend'


class DeployConfigTests(SimpleTestCase):
    def test_root_requirements_mirror_backend(self):
        self.assertEqual((ROOT / 'requirements.txt').read_text(encoding='utf-8'),
                         (BACKEND / 'requirements.txt').read_text(encoding='utf-8'))

    def test_root_python_version_mirror_backend(self):
        self.assertEqual((ROOT / '.python-version').read_text(encoding='utf-8').strip(),
                         (BACKEND / '.python-version').read_text(encoding='utf-8').strip())

    def test_root_vercel_json_builds_backend_and_frontend(self):
        cfg = json.loads((ROOT / 'vercel.json').read_text(encoding='utf-8'))
        sources = [b['src'] for b in cfg['builds']]
        self.assertEqual(sources, ['backend/index.py', 'frontend/package.json'])
        api_route = cfg['routes'][0]
        self.assertTrue(api_route['src'].startswith('/api'))
        self.assertEqual(api_route['dest'], '/backend/index.py')
        self.assertEqual(cfg['routes'][-1]['dest'], '/frontend/index.html')
        # Крон тот же, что в backend/vercel.json для деплоя из CLI.
        cli_cfg = json.loads((BACKEND / 'vercel.json').read_text(encoding='utf-8'))
        self.assertEqual(cfg['crons'], cli_cfg['crons'])

    def test_root_vercel_json_headers(self):
        """Страница сайта защищена от встраивания, статика кэшируется по правилам."""
        routes = json.loads((ROOT / 'vercel.json').read_text(encoding='utf-8'))['routes']

        def route_for(path):
            # Как Vercel: первый маршрут, чей src целиком совпал с путём; $1 в dest заменяется группой
            for route in routes:
                match = re.fullmatch(route['src'], path)
                if match:
                    dest = route['dest']
                    for i, group in enumerate(match.groups(), 1):
                        dest = dest.replace('$%d' % i, group or '')
                    return {**route, 'dest': dest}
            self.fail('Нет маршрута для ' + path)

        for path in ('/', '/menu/efes-beer-garden', '/index.html'):
            with self.subTest(path=path):
                route = route_for(path)
                headers = route['headers']
                self.assertEqual(route['dest'], '/frontend/index.html')
                self.assertEqual(headers['x-frame-options'], 'DENY')
                self.assertEqual(headers['x-content-type-options'], 'nosniff')
                self.assertEqual(headers['cache-control'], 'public, max-age=0, must-revalidate')
                # Сайт шлёт на API только свой origin: из него бекенд строит ссылку QR без FT_PUBLIC_SITE_URL
                self.assertEqual(headers['referrer-policy'], 'strict-origin-when-cross-origin')
                self.assertIn('camera=()', headers['permissions-policy'])
                # Буфер обмена (меню) и вибрация (панель заказов) сайту нужны
                self.assertNotIn('clipboard', headers['permissions-policy'])
                self.assertNotIn('content-security-policy', headers)

        hashed = route_for('/main-H23RUQHE.js')['headers']
        self.assertIn('immutable', hashed['cache-control'])
        # Файлы из public/ без хэша в имени могут смениться со следующим деплоем: кэш умеренный, не immutable
        for path in ('/img/beers/efes-pilsener.webp', '/decor/logo-sm.webp', '/icons/icon-192.png',
                     '/og.jpg', '/manifest.webmanifest', '/favicon.ico'):
            with self.subTest(path=path):
                route = route_for(path)
                self.assertEqual(route['dest'], '/frontend' + path)
                self.assertRegex(route['headers']['cache-control'], r'^public, max-age=\d+$')
        for path in ('/api/v2/drinks/', '/media/dishes/burger.webp', '/static/admin/css/base.css', '/admin/'):
            with self.subTest(path=path):
                self.assertEqual(route_for(path)['dest'], '/backend/index.py')

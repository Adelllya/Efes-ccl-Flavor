"""Файлы деплоя в корне репозитория согласованы с backend/.

Сборка на Vercel из git идёт от корня репозитория (vercel.json в корне), а деплой из CLI
делается из папки backend/. Копии requirements.txt и .python-version в корне должны совпадать
с бэкендовыми, иначе на проде окажутся другие версии пакетов.
"""
import json
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

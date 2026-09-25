"""Точка входа для Vercel (@vercel/python). Отдаёт WSGI-приложение Django."""
from flavor_tree.wsgi import application

app = application

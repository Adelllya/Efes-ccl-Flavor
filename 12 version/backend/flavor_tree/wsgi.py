"""WSGI config for flavor_tree project."""
import os
from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'flavor_tree.settings')
application = get_wsgi_application()

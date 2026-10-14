import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { CURRENT_LANG } from './app/i18n/lang-storage';

function boot() {
  bootstrapApplication(AppComponent, appConfig)
    .catch((err) => console.error(err));
}

// Русский интерфейс: словарь грузится отдельным чанком и включается до первой отрисовки.
// Если чанк не загрузился, сайт всё равно стартует (по-английски, <html lang="en"> из index.html).
// <html lang="ru"> ставит startRu().
if (CURRENT_LANG === 'ru') {
  import('./app/i18n/ru')
    .then(m => m.startRu())
    .catch(err => console.error(err))
    .finally(boot);
} else {
  boot();
}

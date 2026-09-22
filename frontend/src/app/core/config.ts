/** Адрес Django API. Пусто — SPA работает полностью офлайн на встроенных данных (Vercel-демо).
 *  Задать можно в index.html: <script>window.FT_API_URL='https://api.flavortree.kz/api'</script> */
declare global { interface Window { FT_API_URL?: string; FT_AI_URL?: string; } }
export const API_URL: string = (typeof window !== 'undefined' && window.FT_API_URL) || '';
export const APP_VERSION = '2.0.0';

/** ИИ-сомелье: Vercel Function /api/ai (демо) или Django /api/ai/ (если задан API_URL). Переопределить: window.FT_AI_URL */
export const AI_URL: string = (typeof window !== 'undefined' && window.FT_AI_URL) || (API_URL ? `${API_URL}/ai/` : '/api/ai');

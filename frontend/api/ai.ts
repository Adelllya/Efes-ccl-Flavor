/**
 * Vercel Function: POST /api/ai — ИИ-сомелье v2.
 *   mode "ask"    — вопрос текстом («что взять к мантам, не люблю горькое»)
 *   mode "vision" — фото блюда
 *   mode "drink"  — разбор напитка: название / строка меню текстом или фото этикетки
 * Ключ берётся из переменной окружения ANTHROPIC_API_KEY проекта Vercel.
 * Тело запроса: см. SommelierInput в ./_lib/sommelier.ts, контракт — docs/AI.md.
 * Язык гостя — необязательное поле locale: 'ru' | 'kk' | 'en'; нет поля или другое значение → 'ru'.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { MAX_IMAGE_B64, SommelierInput, describeError, isMode, runSommelier } from './_lib/sommelier';

export const config = { maxDuration: 60 };

/** Есть ли в окружении хоть какой-то способ авторизации SDK (без него запрос падает до обращения к API). */
const hasCredentials = (): boolean => !!(process.env['ANTHROPIC_API_KEY'] || process.env['ANTHROPIC_AUTH_TOKEN']
  || process.env['ANTHROPIC_PROFILE'] || process.env['ANTHROPIC_FEDERATION_RULE_ID']);

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'POST only' }); return; }

  const body = (typeof req.body === 'string' ? safeJson(req.body) : req.body) as Partial<SommelierInput> | null;
  if (!body || typeof body !== 'object' || !isMode(body.mode)) { res.status(400).json({ ok: false, error: 'mode должен быть ask, vision или drink' }); return; }
  const data = (body.image as { data?: unknown } | null | undefined)?.data;
  if (typeof data === 'string' && data.length > MAX_IMAGE_B64) { res.status(413).json({ ok: false, error: 'Фото слишком большое' }); return; }

  try {
    const out = await runSommelier(body as SommelierInput);
    res.status(200).json(out);
  } catch (e) {
    let { status, error } = describeError(e);
    if (status === 500 && !hasCredentials()) { status = 503; error = 'ИИ-сомелье не настроен: задайте ANTHROPIC_API_KEY'; }
    console.error('[ai]', status, e instanceof Error ? e.message : e);
    res.status(status).json({ ok: false, error });
  }
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

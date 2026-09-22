/**
 * Vercel Function: POST /api/ai — ИИ-сомелье (вопрос текстом или фото блюда).
 * Ключ берётся из переменной окружения ANTHROPIC_API_KEY проекта Vercel.
 * Тело запроса: см. SommelierInput в ./_lib/sommelier.ts
 * Язык гостя — необязательное поле locale: 'ru' | 'kk' | 'en'; нет поля или другое значение → 'ru'.
 * Фактически применённый язык возвращается в ответе полем locale.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { SommelierInput, describeError, resolveLocale, runSommelier } from './_lib/sommelier';

export const config = { maxDuration: 60 };

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;   // base64 ~ 3.7 МБ картинки; клиент ужимает до ~1024px

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'POST only' }); return; }

  const body = (typeof req.body === 'string' ? safeJson(req.body) : req.body) as Partial<SommelierInput> | null;
  if (!body || (body.mode !== 'ask' && body.mode !== 'vision')) { res.status(400).json({ ok: false, error: 'mode должен быть ask или vision' }); return; }
  if (body.mode === 'vision' && (body.image?.data?.length ?? 0) > MAX_IMAGE_BYTES) { res.status(413).json({ ok: false, error: 'Фото слишком большое' }); return; }

  try {
    const out = await runSommelier({ ...body, locale: resolveLocale(body.locale) } as SommelierInput);
    res.status(200).json(out);
  } catch (e) {
    const { status, error } = describeError(e);
    console.error('[ai]', status, e instanceof Error ? e.message : e);
    res.status(status).json({ ok: false, error });
  }
}

function safeJson(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

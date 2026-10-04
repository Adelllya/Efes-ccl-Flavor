/**
 * Подготовка фото перед отправкой на сервер.
 *
 * Снимок с телефона весит 3-8 МБ и не проходит ни лимит загрузки (5 МБ), ни лимит
 * тела запроса на серверлесс-хостинге (около 4,5 МБ). Уменьшаем его в браузере:
 * длинная сторона до maxSide, JPEG. Текст меню при этом остаётся читаемым.
 */

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const KEEP_AS_IS_BYTES = 1.5 * 1024 * 1024;

interface Drawable {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

/** Картинка для рисования на холсте; поворот из EXIF учитывается, если браузер это умеет. */
async function decode(file: File): Promise<Drawable> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // старый браузер не знает параметр или формат: пробуем через <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('decode'));
      img.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/**
 * Уменьшенная копия фото. Небольшой файл подходящего типа возвращается как есть.
 * Если браузер не смог прочитать картинку, возвращается исходный файл: сервер сам скажет, что с ним не так.
 */
export async function downscalePhoto(file: File, maxSide = 2048, quality = 0.86): Promise<File> {
  let drawable: Drawable;
  try {
    drawable = await decode(file);
  } catch {
    return file;
  }
  try {
    const longest = Math.max(drawable.width, drawable.height);
    if (!longest) return file;
    if (longest <= maxSide && file.size <= KEEP_AS_IS_BYTES && PHOTO_TYPES.includes(file.type)) return file;

    const scale = Math.min(1, maxSide / longest);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(drawable.width * scale));
    canvas.height = Math.max(1, Math.round(drawable.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    // Прозрачный PNG на белом фоне: в JPEG прозрачности нет, без заливки фон стал бы чёрным.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(drawable.source, 0, 0, canvas.width, canvas.height);
    const blob = await toBlob(canvas, quality);
    if (!blob) return file;
    const name = (file.name.replace(/\.[^.]+$/, '') || 'photo') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
  } finally {
    drawable.close();
  }
}

/** Текст ошибки или null, если файл можно отправлять. Вызывать после downscalePhoto. */
export function photoProblem(file: File): string | null {
  if (!PHOTO_TYPES.includes(file.type)) return 'Подходят только PNG, JPG или WebP';
  if (file.size > PHOTO_MAX_BYTES) return 'Файл больше 5 МБ';
  return null;
}

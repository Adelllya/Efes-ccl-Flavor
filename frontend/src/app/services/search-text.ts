/**
 * Поиск по названиям, набранным как угодно: «эфес» находит Efes, «козел» и «козёл» находят Kozel,
 * «велкопоповицкий» находит Velkopopovický, «будвайзер» находит Budweiser.
 *
 * Название и запрос приводятся к одному ключу: нижний регистр, без диакритики, кириллица (и казахские
 * буквы) транслитом в латиницу, потом несколько правил, которые сглаживают разницу между транслитом
 * и настоящим написанием бренда: c, q и ck как k, w как v, y и j как i, z как s, h не в счёт, ei как ai,
 * oe как u, ou как au, двойные буквы как одна, «0.0» остаётся одним словом. Ключ нужен только для
 * сравнения, на экран он не выводится.
 */

const CYRILLIC: Readonly<Record<string, string>> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  // казахские буквы
  ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i',
};

/** Ключ строки для сравнения при поиске. */
export function searchKey(text: string): string {
  const latin = (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // NFD раскладывает й и ё на букву и знак: знак уже снят, буквы и так дают i и e
    .replace(/[\u0400-\u04ff]/g, ch => CYRILLIC[ch] ?? ch);
  return latin
    .replace(/(\d)[.,](?=\d)/g, '$1_')
    .replace(/ph/g, 'f')
    .replace(/gu(?=[ie])/g, 'g')
    .replace(/ck|c|q/g, 'k')
    .replace(/w/g, 'v')
    .replace(/x/g, 'ks')
    .replace(/[yj]/g, 'i')
    .replace(/z/g, 's')
    .replace(/h/g, '')
    .replace(/ei/g, 'ai')
    .replace(/oe/g, 'u')
    .replace(/ou/g, 'au')
    .replace(/[^a-z0-9_]+/g, ' ')
    .replace(/([a-z])\1+/g, '$1')
    .trim();
}

/**
 * Подходит ли строка под запрос: каждое слово запроса есть в названии (в любом порядке), по ключу
 * searchKey или как есть. Пустой запрос подходит всему.
 */
export function matchesSearch(query: string, ...fields: Array<string | null | undefined>): boolean {
  const plain = (query || '').trim().toLowerCase().replace(/ё/g, 'е');
  if (!plain) return true;
  const hay = fields.filter(Boolean).join(' ');
  const hayPlain = hay.toLowerCase().replace(/ё/g, 'е');
  if (hayPlain.includes(plain)) return true;
  const hayKey = searchKey(hay);
  const words = searchKey(plain).split(' ').filter(Boolean);
  return words.length > 0 && words.every(w => hayKey.includes(w));
}

/**
 * Крепость по-русски: «5 %», «около 4,5 %». null, если крепости нет: поле тогда прячем,
 * а не пишем «N/A». «Около» ставим, когда точного числа в наших источниках нет и в каталоге
 * стоит оценка по стилю (Brand.abv_estimated).
 */
export function abvText(abv: number | null | undefined, estimated = false): string | null {
  if (abv === null || abv === undefined || !Number.isFinite(abv)) return null;
  const value = abv.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
  return `${estimated ? 'около ' : ''}${value} %`;
}

/** Подсказка к крепости-оценке. */
export const ABV_ESTIMATE_HINT = 'Точной крепости в наших источниках нет, указана оценка по стилю';

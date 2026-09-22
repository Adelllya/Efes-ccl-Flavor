/** Мелкие форматтеры для шаблонов. */
export const scoreClass = (s: number): string => (s >= 88 ? 'score-90' : s >= 78 ? 'score-80' : s >= 68 ? 'score-70' : s >= 58 ? 'score-60' : s >= 48 ? 'score-50' : 'score-0');
export const pct = (x: number): number => Math.round(x * 100);
export const abv = (b: { abv: number; abv_estimated: boolean }): string => `${b.abv.toFixed(1)}%${b.abv_estimated ? '*' : ''}`;
export const plural = (n: number, one: string, few: string, many: string): string => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} ${one}`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return `${n} ${few}`;
  return `${n} ${many}`;
};

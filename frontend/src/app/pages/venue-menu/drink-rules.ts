import { MenuDrink } from '../../models/flavor-tree.models';

/**
 * Алкогольный ли напиток карты бара. Признак is_alcoholic считает сервер;
 * без него алкоголем считаем всё, кроме крепости до 0,5%.
 */
export function drinkIsAlcoholic(d: Pick<MenuDrink, 'is_alcoholic' | 'abv'>): boolean {
  if (typeof d.is_alcoholic === 'boolean') return d.is_alcoholic;
  return d.abv === null || d.abv === undefined || d.abv > 0.5;
}

/** Категории, которые можно предложить гостю младше 21: как ai_safety.drink_allowed('minor') на сервере. */
const MINOR_CATEGORIES = new Set(['lemonade', 'soda', 'tea', 'coffee', 'water', 'dairy']);
const ENERGY_RE = /energy|энергет/i;

/**
 * Напиток можно показать и заказать гостю младше 21: без алкоголя, без пива 0.0 и кваса
 * (в них бывает до 0,5-1,2%) и без энергетиков. Сервер с ?age=under21 уже отдаёт только такие,
 * здесь та же проверка на случай старого бэкенда.
 */
export function allowedForMinor(d: MenuDrink): boolean {
  const category = d.category ?? '';
  const zero = d.abv === 0 || ((d.abv === null || d.abv === undefined) && category !== 'dairy');
  return !drinkIsAlcoholic(d) && MINOR_CATEGORIES.has(category) && zero
    && !ENERGY_RE.test(`${d.brand_name} ${d.brand_style}`);
}

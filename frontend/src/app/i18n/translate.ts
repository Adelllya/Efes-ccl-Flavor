/**
 * Перевод строки из кода (заголовок вкладки, сопоставление названий блюд). Словарь лежит в чанке ru.ts:
 * он регистрирует здесь свой переводчик при старте. В EN-режиме строки возвращаются как есть.
 */
let active: ((s: string) => string | null) | null = null;

export function registerTranslator(fn: ((s: string) => string | null) | null): void {
  active = fn;
}

export function trText(s: string): string {
  return (active && s ? active(s) : null) ?? s;
}

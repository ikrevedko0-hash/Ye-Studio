// Разнообразие выдачи. Генераторы честно сортируют находки по известности — и у всех авторов
// на всех копиях программы первыми выходили одни и те же слова, а значит, и одни и те же темы.
//
// Поэтому генератор просит находок с запасом, а отсюда берётся случайная выборка с перевесом
// в пользу лучших: известное слово попадает чаще, но не всегда. Зерно по умолчанию — своё у каждой
// копии программы (из её install-id), так что «Подобрать» у одного автора стабилен, а у разных — разный.
// Кнопка «Перемешать» просто даёт новое зерно.

import { seededRandom } from "../scramble";

/**
 * Во сколько раз больше находок просить у генератора, чтобы было из чего выбирать.
 * Было 3 — и «Перемешать» крутило почти те же слова: у кубраи на весь словарь их ~50.
 */
export const POOL = 5;

/** Зерно из строки (install-id): FNV-1a, этого хватает. */
export function seedFrom(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h || 1;
}

/**
 * Взвешенная выборка без повторов (Efraimidis–Spirakis): ключ u^(1/вес), берём наибольшие.
 * Вес падает с местом в списке, но плавно: десятое слово выходит вперёд не так уж редко.
 * Порядок результата — по ключу, поэтому и первые семь, которые окно отмечает сразу, каждый раз свои.
 */
export function sampleHits<T>(hits: T[], limit: number, seed: number): T[] {
  // xorshift с маленьким зерном (1, 2, 3…) первые числа выдаёт почти нулевыми — и первое слово
  // проигрывало всегда. Поэтому зерно сначала перемешиваем, а первые числа выбрасываем.
  const rnd = seededRandom(seedFrom(`sample:${seed}`));
  for (let i = 0; i < 8; i++) rnd();
  // вес мягче, чем был (1 + i/(limit/2)): иначе дальняя половина запаса почти не выходила
  const span = Math.max(1, limit);
  return hits
    .map((h, i) => ({ h, key: Math.pow(rnd() || 1e-9, 1 + i / span) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, limit)
    .map((x) => x.h);
}

/**
 * «Перемешать» должно показывать новое, а не тасовать уже виденное. Сначала берём находки, которых
 * автор ещё не видел; не хватает — добираем виденными. Всё уже видено — круг заново (recycled).
 */
export function sampleFresh<T>(hits: T[], limit: number, seed: number, seen: (h: T) => boolean): { hits: T[]; fresh: number; recycled: boolean } {
  const fresh = hits.filter((h) => !seen(h));
  if (!fresh.length) return { hits: sampleHits(hits, limit, seed), fresh: 0, recycled: true };
  const first = sampleHits(fresh, limit, seed);
  if (first.length >= limit) return { hits: first, fresh: first.length, recycled: false };
  const old = sampleHits(hits.filter(seen), limit - first.length, seed + 1);
  return { hits: [...first, ...old], fresh: first.length, recycled: false };
}

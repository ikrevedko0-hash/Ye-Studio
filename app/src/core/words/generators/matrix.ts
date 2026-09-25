// Матричные темы: один кусок слова — много разных слов вокруг него.
// Пример автора: «шлю» → шлюпка (в начале), пошлю (в конце), шлюха (в начале), нашлют (в середине).
//
// Ценность темы в том, что кусок один, а слова из разных углов языка. Поэтому выдачу
// раскладываем по положению куска и внутри каждой части сортируем от коротких к длинным:
// короткое слово проще, оно идёт на дешёвый вопрос.

import type { Dictionary } from "../dict";
import { commonArgs, LEN_PARAMS, SET_PARAM, type GeneratorArgs, type PuzzleGenerator, type PuzzleTheme, type WordHit } from "./types";

const POS_TITLE = { start: "в начале", end: "в конце", middle: "в середине" } as const;

/**
 * Русские словообразовательные концовки. Нужны там, где словарь молчит: и «эскапизм»,
 * и «групиз» из субтитров одинаково незнакомы частотному списку и словарю существительных,
 * но первое собрано по правилам языка, а второе — обрывок чужой речи.
 */
const RU_SUFFIX = /(изм|ист|ость|ация|яция|ение|ание|тель|ник|ство|логия|графия|ирование|щина|ушка|онок|ёнок)$/;

/**
 * Окончания, по которым слово опознаётся как форма другого.
 * Список нарочно не полный: лучше оставить лишнее слово, чем выбросить настоящее.
 * Правило «длиннее не больше чем на две буквы» не годилось — оно съедало «шлюпку» (шлюп + ка),
 * а «ка» никаким окончанием не является.
 */
const ENDINGS = [
  // существительные
  "а", "е", "и", "о", "у", "ы", "ь", "ю", "я",
  "ам", "ах", "ев", "ей", "ем", "ов", "ой", "ом", "ою", "ья", "ям", "ях", "ии", "ия", "ие", "ию",
  "ами", "ями", "иям", "иях", "ьев", "ьям",
  // прилагательные и причастия
  "ая", "ое", "ые", "ую", "ий", "ый", "ым", "ых", "их", "им", "ем", "ой",
  "ого", "ому", "ыми", "ими", "его", "ему", "ешь", "ившись",
  // глаголы
  "ть", "ла", "ло", "ли", "ет", "ут", "ют", "ит", "ат", "ят", "ся", "сь",
  "ешь", "ишь", "ете", "ите", "ует", "уют", "тся", "лся", "лась", "лись", "ться",
].sort((x, y) => y.length - x.length); // сначала длинные: «шлюзному» → «шлюзн», а не «шлюзно»

/**
 * Основа слова: отрезаем самое длинное известное окончание.
 * Основу короче трёх букв не оставляем — иначе слова сливались бы целыми семьями.
 *
 * Порог был четыре буквы, и на куске «пиз» выдача начиналась с шести падежей одного слова:
 * пиза, пизе, пизу, пизы, пизой, пизою — у всех основа выходила длиной три, и ни одно
 * не считалось формой другого.
 */
export function stem(word: string): string {
  for (const e of ENDINGS) {
    if (word.length - e.length >= 3 && word.endsWith(e)) return word.slice(0, -e.length);
  }
  return word;
}

/**
 * Убрать падежи и склонения одного слова.
 * Словарь форм на «шлю» выдаёт шлюз, шлюза, шлюзы, шлюзная, шлюзное, шлюзной, шлюпка, шлюпкам —
 * для темы это два слова, занявшие восемь мест. Оставляем самую короткую форму каждой основы.
 * «Шлюп» и «шлюпка» при этом остаются порознь: основы «шлюп» и «шлюпк» разные.
 */
/**
 * Чем слово лучше как ответ в игре. Словарная форма важнее частоты: в субтитрах «шлюпку»
 * встречается чаще «шлюпки», но ответом в паке должна стоять именно «шлюпка».
 * Поэтому первым делом спрашиваем словарь существительных — он состоит из начальных форм.
 */
function betterForm(w: string, isLemma: (x: string) => boolean, fame: (x: string) => number): number {
  return (isLemma(w) ? 2 : 0) + fame(w) - w.length / 1000;
}

export function dropInflections(
  words: string[],
  fame: (w: string) => number = () => 0,
  isLemma: (w: string) => boolean = () => false,
): string[] {
  const best = new Map<string, string>();
  for (const w of words) {
    const key = stem(w);
    const have = best.get(key);
    if (!have || betterForm(w, isLemma, fame) > betterForm(have, isLemma, fame)) best.set(key, w);
  }
  return [...best.values()];
}

/** Раскладка слов по тому, где внутри них сидит кусок. */
export async function matrixWords(dict: Dictionary, fragment: string, args: GeneratorArgs): Promise<WordHit[]> {
  const { set, minLen, maxLen, limit } = commonArgs(args);
  const frag = fragment.trim().toLowerCase();
  if (frag.length < 2) return [];

  const fits = (w: string) => w.length >= Math.max(minLen, frag.length + 1) && w.length <= maxLen && w !== frag;
  const all = await dict.withFragment(frag, set, "any", 20000);

  const groups: Record<"start" | "end" | "middle", string[]> = { start: [], end: [], middle: [] };
  for (const w of all) {
    if (!fits(w)) continue;
    if (w.startsWith(frag)) groups.start.push(w);
    else if (w.endsWith(frag)) groups.end.push(w);
    else groups.middle.push(w);
  }

  // из каждой группы берём поровну: тема живёт разнообразием, а не количеством
  const perGroup = Math.max(1, Math.ceil(limit / 3));
  const fame = await dict.fame();
  const isLemma = await dict.matcher("nouns", [...new Set(all.map((w) => w.length))]);
  // Главный признак — известность слова, и только потом длина. Без этого выдача на «пиз»
  // начиналась с «пизолита» и «аэротропизма», а «эпизод» и «утопизм» тонули в конце списка:
  // в словаре они все равноправны, а в игре — нет.
  // Среди одинаково незнакомых слов вперёд выходит словарное существительное: «эскапизм»
  // и «утопизм» автору пригодятся, а «групиз» из субтитров — нет.
  const weight = (w: string) => fame(w) * 10 + (isLemma(w) ? 1 : 0) + (RU_SUFFIX.test(w) ? 0.5 : 0) - w.length / 1000;
  const rank = (a: string, b: string) => weight(b) - weight(a) || a.localeCompare(b, "ru");
  const out: WordHit[] = [];
  for (const pos of ["start", "end", "middle"] as const) {
    for (const w of dropInflections(groups[pos], fame, isLemma).sort(rank).slice(0, perGroup)) {
      // текст вопроса в матрице пишет автор: вставка ставит только ответ
      out.push({ word: w, why: `«${frag}» ${POS_TITLE[pos]}`, question: "", common: fame(w) > 0, noun: isLemma(w) });
    }
  }
  return out.sort((a, b) => rank(a.word, b.word)).slice(0, limit);
}

/**
 * Подсказать куски, из которых выйдет хорошая матрица.
 * Хороший кусок — тот, что встречается и в начале, и в конце разных слов: тогда тема не однобокая.
 */
export async function suggestFragments(dict: Dictionary, args: GeneratorArgs, length = 3, top = 20): Promise<{ fragment: string; start: number; end: number; middle: number }[]> {
  const { set } = commonArgs(args);
  const words = await dict.words(set);
  const starts = new Map<string, number>();
  const ends = new Map<string, number>();
  const mids = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  for (const w of words) {
    if (w.length < length + 2) continue;
    bump(starts, w.slice(0, length));
    bump(ends, w.slice(-length));
    for (let i = 1; i + length < w.length; i++) bump(mids, w.slice(i, i + length));
  }

  const seen = new Set([...starts.keys()].filter((k) => (ends.get(k) ?? 0) > 0));
  return [...seen]
    .map((fragment) => ({ fragment, start: starts.get(fragment) ?? 0, end: ends.get(fragment) ?? 0, middle: mids.get(fragment) ?? 0 }))
    // ценим равновесие: кусок, у которого начало и конец сопоставимы, даёт интереснее тему
    .sort((a, b) => Math.min(b.start, b.end) - Math.min(a.start, a.end))
    .slice(0, top);
}

export const matrixGenerator: PuzzleGenerator = {
  id: "matrix",
  title: "Матрица по куску слова",
  about: "Один кусок — слова, где он стоит в начале, в конце и в середине. Как «шлю» → шлюпка, пошлю, шлюха.",
  params: [
    { name: "fragment", title: "Кусок слова", kind: "text", placeholder: "шлю", hint: "Две буквы и больше" },
    SET_PARAM,
    ...LEN_PARAMS,
  ],

  async run(dict: Dictionary, args: GeneratorArgs): Promise<PuzzleTheme> {
    const frag = String(args.fragment ?? "").trim().toLowerCase();
    const hits = await matrixWords(dict, frag, args);
    return {
      // название темы в паках автора выглядит как ***пиз***: звёздочки показывают игроку,
      // что кусок может стоять и слева, и справа от него
      title: frag ? `***${frag}***` : "Матрица",
      hits,
      note: frag ? `Во всех ответах есть «${frag}». Вопросы стоит писать так, чтобы кусок не был назван вслух.` : undefined,
    };
  },
};

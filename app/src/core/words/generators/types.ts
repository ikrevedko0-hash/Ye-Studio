// Контракт генераторов головоломок. Новый вид головоломки — новый файл рядом, реестр не трогаем.

import type { Dictionary, WordSet } from "../dict";

/** Одна найденная единица: слово и почему оно подошло. */
export interface WordHit {
  word: string;
  /** Пояснение для автора: «начинается на шлю», «анаграмма слова корсет». */
  why: string;
  /**
   * Текст вопроса при вставке, если он не совпадает с «почему». У анаграммы загадка и есть
   * пояснение, а у инициалов вопрос пишет автор — пустая строка значит «текст не трогать».
   */
  question?: string;
  /** Насколько слово обиходное: есть в списке частых, есть среди существительных. */
  common?: boolean;
  noun?: boolean;
}

/** Готовая заготовка темы: заголовок и подобранные слова по возрастанию цены. */
export interface PuzzleTheme {
  title: string;
  hits: WordHit[];
  /** Подсказка, которую стоит положить в комментарий ведущему. */
  note?: string;
}

export interface GeneratorParam {
  name: string;
  title: string;
  kind: "text" | "number" | "select" | "checkbox";
  /** Для select. */
  options?: { value: string; title: string }[];
  placeholder?: string;
  def?: string | number | boolean;
  hint?: string;
  /** Показывать поле, только когда другое поле имеет одно из этих значений. */
  when?: { param: string; values: string[] };
}

export type GeneratorArgs = Record<string, string | number | boolean | undefined>;

export interface PuzzleGenerator {
  id: string;
  title: string;
  /** Одна фраза о том, что это даёт автору пака. */
  about: string;
  params: GeneratorParam[];
  run(dict: Dictionary, args: GeneratorArgs): Promise<PuzzleTheme>;
}

/** Общие для всех генераторов ограничения: длина слова и словарь. */
export interface CommonArgs {
  set: WordSet;
  minLen: number;
  maxLen: number;
  limit: number;
}

export function commonArgs(a: GeneratorArgs): CommonArgs {
  return {
    set: (a.set as WordSet) ?? "forms",
    minLen: Number(a.minLen) || 3,
    maxLen: Number(a.maxLen) || 14,
    limit: Number(a.limit) || 60,
  };
}

/**
 * Словарь по умолчанию — самый большой. Раньше стояли «частые слова», и на куске «пиз»
 * выдача была почти пустой: в десяти тысячах частых слов нет ни «эскапизма», ни «утопизма».
 * Мусор из большого словаря теперь не мешает — находки сортируются по известности слова.
 */
export const SET_PARAM: GeneratorParam = {
  name: "set",
  title: "Словарь",
  kind: "select",
  def: "forms",
  options: [
    { value: "forms", title: "все слова (1,7 млн) — известные впереди" },
    { value: "nouns", title: "существительные (51 тыс.)" },
    { value: "common", title: "частые слова (10 тыс.) — только самое ходовое" },
  ],
  hint: "Находки идут по убыванию известности слова, поэтому большой словарь не вредит",
};

export const LEN_PARAMS: GeneratorParam[] = [
  { name: "minLen", title: "Длина от", kind: "number", def: 4 },
  { name: "maxLen", title: "до", kind: "number", def: 12 },
  { name: "limit", title: "Сколько показать", kind: "number", def: 60 },
];

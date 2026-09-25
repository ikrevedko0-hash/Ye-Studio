// Словарь выражений для темы «поговорка по-ИИшному»: фразеологизмы, пословицы, крылатые фразы.
//
// Скачан заранее из Викисловаря (scripts/fetch-phrases.ts) и лежит рядом с наборами слов:
// в работе в сеть не ходим. Вид, пометы и темы — категории Викисловаря, сведённые в короткие списки.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const PHRASES_FILE = "phrases-ru.json";

export interface PhraseEntry {
  text: string;
  /** id из PHRASE_KINDS: фраза бывает сразу и фразеологизмом, и поговоркой. */
  kinds: string[];
  /** id из PHRASE_STYLES. */
  styles: string[];
  /** Смысловые темы Викисловаря («Малость», «Угрозы»…). */
  topics: string[];
}

export interface PhraseSet {
  source: string;
  fetchedAt: string;
  /** Темы по убыванию числа фраз. */
  topics: string[];
  phrases: PhraseEntry[];
}

export const PHRASE_KINDS = [
  { id: "idiom", title: "Фразеологизмы", category: "Фразеологизмы/ru" },
  { id: "proverb", title: "Пословицы и поговорки", category: "Пословицы и поговорки/ru" },
  { id: "winged", title: "Крылатые выражения", category: "Крылатые выражения/ru" },
];

/** Пометы: несколько категорий Викисловаря сведены в одну понятную. */
export const PHRASE_STYLES = [
  { id: "joke", title: "шутливое", categories: ["Шутливые выражения/ru"] },
  { id: "ironic", title: "ироничное", categories: ["Ироничные выражения/ru"] },
  { id: "folk", title: "просторечное", categories: ["Просторечные выражения/ru", "Народно-разговорное/ru"] },
  { id: "colloq", title: "разговорное", categories: ["Разговорные выражения/ru"] },
  { id: "rude", title: "грубое", categories: ["Грубые выражения/ru", "Бранные выражения/ru", "Вульгаризмы/ru", "Презрительные выражения/ru", "Сниженные выражения/ru"] },
  { id: "mat", title: "матерное", categories: ["Матерные выражения/ru"] },
  { id: "slang", title: "жаргон", categories: ["Жаргонизмы/ru", "Криминальный жаргон/ru", "Молодёжные выражения/ru", "Интернетовский жаргон/ru", "Школьные выражения/ru", "Военный жаргон/ru"] },
  { id: "exclaim", title: "восклицание", categories: ["Русские междометия", "Междометия/ru"] },
  { id: "euphemism", title: "эвфемизм", categories: ["Эвфемизмы/ru"] },
  { id: "disapprove", title: "неодобрительное", categories: ["Неодобрительные выражения/ru", "Пренебрежительные выражения/ru"] },
  { id: "new", title: "новое", categories: ["Неологизмы/ru", "Слова, датированные 1990-ми годами/ru", "Слова, датированные 2000-ми годами/ru"] },
  { id: "bookish", title: "книжное", categories: ["Книжные выражения/ru"] },
  { id: "old", title: "устаревшее", categories: ["Устаревшие выражения/ru"] },
  { id: "soviet", title: "советское", categories: ["Советизмы/ru"] },
];

let cached: PhraseSet | null = null;

/** Словарь из папки наборов. Нет файла — пустой набор, окно скажет, что словарь не скачан. */
export async function loadPhrases(dir: string | undefined): Promise<PhraseSet> {
  if (cached) return cached;
  const empty: PhraseSet = { source: "", fetchedAt: "", topics: [], phrases: [] };
  if (!dir) return empty;
  try {
    cached = JSON.parse(await readFile(join(dir, PHRASES_FILE), "utf8")) as PhraseSet;
    return cached;
  } catch {
    return empty;
  }
}

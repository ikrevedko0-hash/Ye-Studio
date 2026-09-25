// Набор названий для темы «инициалы»: С.С., Н.Н., Х.Х.
//
// Собирается заранее скриптом `npm run fetch-initials` и лежит в resources/wordsets/initials.json.
// Живой запрос здесь не годится: чтобы найти все «Н.Н.», нужно перебрать сотни тысяч названий,
// а Wikidata отдаёт их только одним большим запросом (QLever, ~20 с). Поэтому в файл кладём
// ровно то, что может понадобиться: названия, где хотя бы два инициала подряд одинаковы
// (по облику буквы), вместе с уже посчитанными инициалами — в работе остаётся сравнить строки.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Что это за вещь. По виду выдача перемешивается, чтобы тема не вышла из одних футболистов. */
export type InitialsKind = "person" | "character" | "music" | "brand" | "place" | "work" | "org" | "concept" | "phrase" | "other";

export const KIND_TITLE: Record<InitialsKind, string> = {
  person: "люди",
  character: "персонажи",
  music: "музыка",
  brand: "бренды и компании",
  place: "места",
  work: "фильмы, книги, игры",
  org: "команды и организации",
  concept: "понятия",
  phrase: "выражения",
  other: "разное",
};

/**
 * Английское название засчитывается только у имён собственных. Helly Hansen в «Н.Н.» —
 * законная находка, а «простуда» в «С.С.» через common cold — нет: русский игрок
 * простуду по-английски не называет.
 */
export const PROPER_KINDS = new Set<InitialsKind>(["person", "character", "music", "brand", "place", "work", "org"]);

/** Одна запись набора — одно написание названия. */
export interface InitialsEntry {
  /** Название, как оно пойдёт в ответ. */
  t: string;
  /** Другое написание той же вещи, для пояснения: «Генрих Гейне» у Heinrich Heine. */
  a?: string;
  /** Инициалы в облике: латинская H уже заменена на Н. */
  i: string;
  /** Известность: число языковых разделов Википедии, у выражений — оценка по частоте слов. */
  f: number;
  k: InitialsKind;
  /** Откуда: wd — Wikidata, wikt — Викисловарь, wiki — заголовок Википедии. */
  s: "wd" | "wikt" | "wiki";
}

export interface InitialsSet {
  fetchedAt: string;
  entries: InitialsEntry[];
}

export const INITIALS_FILE = "initials.json";

let cache: { dir: string; set: InitialsSet } | undefined;

/** Набор читается один раз за запуск: 3–5 МБ JSON, держать в памяти дешевле, чем читать заново. */
export async function loadInitials(dir: string | undefined): Promise<InitialsSet | undefined> {
  if (!dir) return undefined;
  if (cache?.dir === dir) return cache.set;
  try {
    const set = JSON.parse(await readFile(join(dir, INITIALS_FILE), "utf8")) as InitialsSet;
    if (!Array.isArray(set.entries)) return undefined;
    cache = { dir, set };
    return set;
  } catch {
    return undefined;
  }
}

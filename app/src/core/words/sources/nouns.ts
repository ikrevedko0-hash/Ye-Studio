// Существительные из словаря: когда тема не про имена собственные, а про обычные вещи.
// Частые слова идут первыми — в игре нужна узнаваемость, а не редкость.

import type { Dictionary } from "../dict";
import type { ThemeWords, ThemeWordsQuery, WordSource } from "./types";

/** Источнику нужен словарь, поэтому он создаётся с ним, а не берётся готовым. */
export function nounsSource(dict: Dictionary): WordSource {
  return {
    id: "nouns",
    title: "Словарь существительных",
    about: "Обычные вещи из словаря. Сначала те, что входят в список частых слов.",
    presets: [
      { value: "common", title: "только частые слова" },
      { value: "all", title: "все существительные" },
    ],

    async list(q: ThemeWordsQuery): Promise<ThemeWords> {
      const common = new Set(await dict.words("common"));
      const all = await dict.words("nouns");
      const fits = all.filter((w) => w.length >= q.minLen && w.length <= q.maxLen && !w.includes("-"));
      const pool = q.preset === "all" ? fits : fits.filter((w) => common.has(w));
      return {
        title: q.preset === "all" ? "Существительные" : "Частые существительные",
        words: pool.slice(0, q.limit).map((word) => ({ word, fame: common.has(word) ? 1 : 0 })),
      };
    },
  };
}

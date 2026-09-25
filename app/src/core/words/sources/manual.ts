// Список автора: самый надёжный источник темы. Ничего не угадываем — берём то, что написано.

import type { ThemeWords, ThemeWordsQuery, WordSource } from "./types";

export const manual: WordSource = {
  id: "manual",
  title: "Свой список",
  about: "Слова через запятую или с новой строки. Годится для любой темы, которой нет в готовых наборах.",
  needsText: true,

  async list(q: ThemeWordsQuery): Promise<ThemeWords> {
    const words = (q.text ?? "")
      .split(/[,;\n\t]/)
      .map((s) => s.trim())
      .filter((s) => s.length >= q.minLen && s.length <= q.maxLen)
      .slice(0, q.limit)
      .map((word) => ({ word }));
    return { title: "Свой список", words };
  },
};

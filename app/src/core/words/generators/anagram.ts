// Тема-анаграммы: в вопросе перемешанные буквы, в ответе — само слово.
//
//   Тема «Города-анаграммы»:  ксряонсарк → Красноярск,  дговола → Вологда.
//
// Слова берём только односоставные: «Нижний Новгород» перемешивать бессмысленно — по пробелу
// сразу видно, где кончается первое слово.
//
// Головоломка живёт не словарём, а темой: играют не «слова из тех же букв», а «города»,
// «химические элементы», «фильмы». Поэтому слова берутся из источника по теме
// (свой список, Wikidata, словарь существительных), а словарь нужен только для проверки,
// что перемешанное случайно не совпало с настоящим словом — иначе выйдет подсказка.

import type { Dictionary } from "../dict";
import { scramble } from "../scramble";
import { wordSourceById } from "../sources/registry";
import { wikidata } from "../sources/wikidata";
import { commonArgs, type GeneratorArgs, type PuzzleGenerator, type PuzzleTheme, type WordHit } from "./types";

/** Насколько загадка трудная — коротким словом для автора. */
function hardness(chunk: number, fixed: number): string {
  if (chunk <= 1 && fixed === 0) return "трудная";
  if (chunk <= 2 && fixed <= 1) return "средняя";
  return "лёгкая — буквы почти на местах";
}

export const anagramGenerator: PuzzleGenerator = {
  id: "anagram",
  title: "Анаграммы (перемешать буквы)",
  about: "Вопрос — перемешанные буквы, ответ — слово темы. Города, страны, элементы: ксряонсарк → Красноярск.",
  params: [
    {
      name: "source",
      title: "Откуда брать слова",
      kind: "select",
      def: "wikidata",
      options: [
        { value: "wikidata", title: "готовый набор (Wikidata)" },
        { value: "manual", title: "свой список" },
        { value: "nouns", title: "словарь существительных" },
      ],
    },
    {
      name: "preset",
      title: "Набор",
      kind: "select",
      def: "cities-ru",
      options: (wikidata.presets ?? []).map((p) => ({ value: p.value, title: p.title })),
      when: { param: "source", values: ["wikidata"] },
    },
    {
      name: "nounsPreset",
      title: "Отбор",
      kind: "select",
      def: "common",
      options: [
        { value: "common", title: "только частые слова" },
        { value: "all", title: "все существительные" },
      ],
      when: { param: "source", values: ["nouns"] },
    },
    {
      name: "text",
      title: "Свои слова",
      kind: "text",
      placeholder: "Красноярск, Вологда, Мурманск",
      hint: "Через запятую или с новой строки",
      when: { param: "source", values: ["manual"] },
    },
    { name: "minLen", title: "Длина от", kind: "number", def: 5 },
    { name: "maxLen", title: "до", kind: "number", def: 12 },
    { name: "limit", title: "Сколько показать", kind: "number", def: 30 },
    {
      name: "onlyHard",
      title: "Только трудные",
      kind: "checkbox",
      def: true,
      hint: "Отбросить варианты, где уцелел читаемый кусок исходного слова",
    },
  ],

  async run(dict: Dictionary, args: GeneratorArgs): Promise<PuzzleTheme> {
    const { minLen, maxLen, limit } = commonArgs(args);
    const sourceId = String(args.source ?? "wikidata");
    const source = wordSourceById(dict, sourceId);
    if (!source) throw new Error(`неизвестный источник слов ${sourceId}`);

    const preset = sourceId === "nouns" ? String(args.nounsPreset ?? "common") : String(args.preset ?? "");
    // просим с запасом: часть вариантов отсеется как слишком лёгкие
    const picked = await source.list({ limit: limit * 2, minLen, maxLen, preset, text: String(args.text ?? "") });
    if (!picked.words.length) {
      return { title: picked.title, hits: [], note: "Источник ничего не дал. Проверьте список или смягчите длину." };
    }

    // проверка нужна только для длин, которые реально встретились: перестановка не меняет длину слова
    const isWord = await dict.matcher("forms", [...new Set(picked.words.map((w) => w.word.length))]);
    const onlyHard = args.onlyHard !== false;

    const hits: WordHit[] = [];
    for (const w of picked.words) {
      const r = scramble(w.word, { isWord });
      const hard = hardness(r.score.chunk, r.score.fixed);
      if (onlyHard && hard.startsWith("лёгкая")) continue;
      hits.push({
        word: r.word,
        // это и станет текстом вопроса: показываем перемешанные буквы
        why: r.scrambled.toUpperCase(),
        common: hard === "трудная",
      });
      if (hits.length >= limit) break;
    }

    return {
      title: `${picked.title} — анаграммы`,
      hits,
      note: "В вопрос попадут перемешанные буквы, в ответ — само слово. Отметьте те, что нравятся.",
    };
  },
};

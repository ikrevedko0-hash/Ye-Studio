// Тема «кубрая»: в вопросе — загадка-фраза, в ответе — слово, склеенное из замен.
//
//   «Оценка рая» → БАЛЛАДА  (балл + ада)
//
// Только простые замены: синонимы и антонимы из тезауруса, без ИИ. Подробности — в ../kubraya.ts.

import type { Dictionary } from "../dict";
import { explain, makeClues, type KubrayaDeps } from "../kubraya";
import { stem } from "./matrix";
import { loadThesaurus } from "../thesaurus";
import type { GeneratorArgs, PuzzleGenerator, PuzzleTheme, WordHit } from "./types";

const NOTE =
  "Кубрая: каждое слово загадки — синоним или антоним куска ответа, куски склеиваются по порядку. " +
  "Ответ — одно слово. Пометка «форма подобрана» — проверьте падеж глазами.";

/** Сколько раз один кусок может встретиться в выдаче «найти сами». С запасом на перемешивание — не больше двух. */
const PIECE_REPEAT = 2;

function parseList(text: string): string[] {
  return [...new Set(text.split(/[,;\n]/).map((w) => w.trim().toLowerCase()).filter((w) => /^[а-яё]+$/.test(w)))];
}

export const kubrayaGenerator: PuzzleGenerator = {
  id: "kubraya",
  title: "Кубрая (шарада из синонимов)",
  about: "Слово режется на два, каждое заменяется синонимом или антонимом: «Оценка рая» → БАЛЛАДА.",
  params: [
    {
      name: "source",
      title: "Откуда брать ответы",
      kind: "select",
      def: "auto",
      options: [
        { value: "auto", title: "найти в словаре самим" },
        { value: "manual", title: "свои ответы" },
      ],
    },
    {
      name: "text",
      title: "Ответы",
      kind: "text",
      placeholder: "баллада, кормушка, часослов",
      hint: "Через запятую или с новой строки",
      when: { param: "source", values: ["manual"] },
    },
    {
      name: "parts",
      title: "Частей",
      kind: "select",
      def: "2",
      options: [
        { value: "2", title: "две" },
        { value: "3", title: "до трёх" },
      ],
    },
    {
      name: "forms",
      title: "Куски в падежах",
      kind: "checkbox",
      def: true,
      hint: "Разрешить куски вроде «ада» (ад в родительном): замена встанет в тот же падеж — проверьте глазами",
    },
    { name: "minLen", title: "Длина от", kind: "number", def: 6 },
    { name: "maxLen", title: "до", kind: "number", def: 12 },
    { name: "limit", title: "Сколько показать", kind: "number", def: 30 },
  ],

  async run(dict: Dictionary, args: GeneratorArgs): Promise<PuzzleTheme> {
    const thes = await loadThesaurus(dict.dir);
    if (!thes) {
      return { title: "Кубрая", hits: [], note: "Тезауруса нет. Выполните в папке приложения: npm run fetch-thesaurus" };
    }
    const manual = String(args.source ?? "auto") === "manual";
    const limit = Number(args.limit) || 30;
    const minLen = Number(args.minLen) || 6;
    const maxLen = Number(args.maxLen) || 12;
    const fame = await dict.fame();
    const isWord = await dict.matcher("forms");
    const isNoun = await dict.matcher("nouns");
    const yo = (f: (w: string) => boolean) => (w: string) => f(w) || (w.includes("е") && f(w.replace(/е/g, "ё")));
    const deps: KubrayaDeps = { isWord: yo(isWord), isNoun: yo(isNoun), fame, thes };
    const opts = {
      maxParts: Number(args.parts) || 2,
      allowForms: args.forms !== false,
      // при переборе словаря без порога выходят «пар + тер»; свои ответы автор выбрал сам
      minFame: manual ? 0 : 0.75,
      subFame: 0.6,
    };

    let answers: string[];
    if (manual) {
      answers = parseList(String(args.text ?? ""));
      if (!answers.length) return { title: "Кубрая", hits: [], note: "Впишите ответы через запятую." };
    } else {
      const nouns = await dict.words("nouns");
      answers = nouns
        .filter((w) => w.length >= minLen && w.length <= maxLen && /^[а-яё]+$/.test(w))
        .map((w) => ({ w, f: fame(w) }))
        .filter((x) => x.f > 0.5)
        .sort((a, b) => b.f - a.f)
        .map((x) => x.w);
    }

    const hits: WordHit[] = [];
    const missed: string[] = [];
    // «молоко» и «молока» — один ответ: вторая форма в теме не нужна
    const stems = new Set<string>();
    const pieceUse = new Map<string, number>();
    for (const a of answers) {
      if (!manual && stems.has(stem(a))) continue;
      const clues = makeClues(a, deps, { ...opts, perAnswer: 3 });
      if (!clues.length) {
        if (manual) missed.push(a);
        continue;
      }
      // «раз» режется из полусотни слов («разговор», «разряд», «разгром»…), и тема выходила из одних «Один …»
      const fresh = manual ? clues : clues.filter((c) => c.parts.every((p) => (pieceUse.get(p.piece) ?? 0) < PIECE_REPEAT));
      if (!fresh.length) continue;
      stems.add(stem(a));
      const [best, ...rest] = fresh;
      for (const p of best.parts) pieceUse.set(p.piece, (pieceUse.get(p.piece) ?? 0) + 1);
      hits.push({
        word: a[0].toUpperCase() + a.slice(1),
        question: best.clue,
        why: `${best.clue} — ${explain(best)}${rest.length ? `. Ещё: ${rest.map((c) => c.clue).join("; ")}` : ""}`,
        common: !best.parts.some((p) => p.inflected),
        noun: true,
      });
      if (hits.length >= limit) break;
    }

    return {
      title: "Кубрая",
      hits,
      note: missed.length ? `${NOTE} Не нашлось замен для: ${missed.join(", ")}.` : NOTE,
    };
  },
};

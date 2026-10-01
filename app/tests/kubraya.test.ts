// Кубрая на маленьком поддельном тезаурусе: настоящие словари в облаке не скачаны.
// Примеры — из темы dxdy.ru/topic122192, где игру и придумали.

import { describe, expect, it } from "vitest";
import { explain, inflectLike, makeClues, pieceLemmas, sameRoot, splitWord, type KubrayaDeps } from "../src/core/words/kubraya";
import { POOL, sampleFresh, sampleHits, seedFrom } from "../src/core/words/generators/shuffle";
import { MapThesaurus } from "../src/core/words/thesaurus";
import { KUBRAYA_RULES } from "../src/core/words/generators/kubraya";

const thes = MapThesaurus.parse([
  "балл\tоценка,очко\t",
  "ад\tпекло\tрай",
  "час\tмомент\t",
  "корм\tеда,пища\t",
  "кот\tкошак\tпес",
  "лета\t\t",
  "ход\tшаг\t",
  "рост\tподъем\tпадение",
].join("\n"));

const FORMS = new Set(["балл", "ада", "ад", "рай", "рая", "раю", "пекло", "пекла", "оценка", "очко", "еда", "пища", "корм", "час", "момент", "кот", "пес", "кошак", "ход", "шаг", "поход", "по", "рост", "подъем", "падение"]);
const FAME: Record<string, number> = { оценка: 0.95, рая: 0.8, пекла: 0.6, очко: 0.7, балл: 0.8, ада: 0.5, еда: 0.95, пища: 0.7 };

const deps: KubrayaDeps = { isWord: (w) => FORMS.has(w), fame: (w) => FAME[w] ?? 0.3, thes };

describe("разрезка ответа", () => {
  it("режет баллада на балл + ада, если куски в падежах разрешены", () => {
    expect(splitWord("баллада", deps, { allowForms: true })).toContainEqual(["балл", "ада"]);
  });

  it("без падежей «ада» не годится — только начальные формы", () => {
    expect(splitWord("баллада", deps)).toEqual([]);
  });

  it("не берёт кусков, которых нет в тезаурусе: «оголтелость» не режется", () => {
    expect(splitWord("оголтелость", deps, { allowForms: true })).toEqual([]);
  });

  it("не считает целое слово разрезом", () => {
    expect(splitWord("балл", deps)).toEqual([]);
  });
});

describe("формы", () => {
  it("узнаёт «ада» как «ад» в родительном", () => {
    expect(pieceLemmas("ада", thes, true)).toContainEqual({ lemma: "ад", ending: "а" });
  });

  it("ставит замену в тот же падеж: рай под «ад-а» → «рая»", () => {
    expect(inflectLike("рай", { lemma: "ад", ending: "а" }, deps.isWord)).toBe("рая");
  });

  it("не склоняет слово другого склонения: «пекло» под «ад-а» не встанет", () => {
    expect(inflectLike("пекло", { lemma: "ад", ending: "а" }, deps.isWord)).toBeUndefined();
  });
});

describe("правило корня", () => {
  it("«ход» в загадке выдаёт «поход» в ответе", () => {
    expect(sameRoot("ход", "поход")).toBe(true);
  });

  it("разные слова — не родня", () => {
    expect(sameRoot("оценка", "баллада")).toBe(false);
  });
});

describe("загадки", () => {
  it("собирает «Оценка рая» для баллады", () => {
    const clues = makeClues("баллада", deps, { allowForms: true });
    expect(clues.map((c) => c.clue)).toContain("Оценка рая");
    const c = clues.find((x) => x.clue === "Оценка рая")!;
    expect(explain(c)).toBe("БАЛЛ + АДА: оценка → балл (синоним), рая → ада (антоним, форма подобрана)");
  });

  it("лучшая загадка — из известных слов и с антонимом", () => {
    expect(makeClues("баллада", deps, { allowForms: true })[0].clue).toBe("Оценка рая");
  });

  it("без переворотов и служебных слов: «кормушка» без «ушка» в тезаурусе не собирается", () => {
    expect(makeClues("кормушка", deps, { allowForms: true })).toEqual([]);
  });

  it("порог известности отсекает редкие замены", () => {
    expect(makeClues("баллада", deps, { allowForms: true, subFame: 0.9 })).toEqual([]);
  });

  it("со словарём существительных служебные слова не проходят ни куском, ни заменой", () => {
    const t = MapThesaurus.parse(["под\tниз\tнад", "вал\tволна\t", "над\t\tпод"].join("\n"));
    const all = new Set(["под", "вал", "над", "волна", "низ"]);
    const nouns = new Set(["вал", "волна", "низ"]);
    const base: KubrayaDeps = { isWord: (w) => all.has(w), fame: () => 0.5, thes: t };
    expect(makeClues("подвал", base).map((c) => c.clue)).toContain("Над волна");
    expect(makeClues("подвал", { ...base, isNoun: (w) => nouns.has(w) })).toEqual([]);
  });
});

describe("правила для игроков", () => {
  it("влезают в комментарий темы: SIGame показывает только 150 знаков", () => {
    expect(KUBRAYA_RULES.length).toBeLessThanOrEqual(150);
    expect(KUBRAYA_RULES).toContain("БАЛЛАДА");
  });
});

describe("перемешивание выдачи", () => {
  const pool = Array.from({ length: 30 * POOL }, (_, i) => i);

  it("одно зерно — одна и та же выборка", () => {
    expect(sampleHits(pool, 30, 42)).toEqual(sampleHits(pool, 30, 42));
  });

  it("разные зёрна — разные первые семь", () => {
    expect(sampleHits(pool, 30, seedFrom("копия-1")).slice(0, 7)).not.toEqual(sampleHits(pool, 30, seedFrom("копия-2")).slice(0, 7));
  });

  it("лучшие слова попадают чаще худших", () => {
    let top = 0;
    let bottom = 0;
    for (let s = 1; s <= 200; s++) {
      const got = new Set(sampleHits(pool, 30, s));
      if (got.has(0)) top++;
      if (got.has(pool.length - 1)) bottom++;
    }
    expect(top).toBeGreaterThan(bottom * 3);
  });

  it("«Перемешать» сначала показывает то, чего ещё не было", () => {
    const first = new Set(sampleHits(pool, 30, 1));
    const r = sampleFresh(pool, 30, 2, (h) => first.has(h));
    expect(r.hits.filter((h) => first.has(h))).toEqual([]);
    expect(r.fresh).toBe(30);
    expect(r.recycled).toBe(false);
  });

  it("новых не хватает — добирает виденными, и окно узнаёт, сколько новых", () => {
    const small = Array.from({ length: 40 }, (_, i) => i);
    const seen = new Set(small.slice(0, 30));
    const r = sampleFresh(small, 30, 3, (h) => seen.has(h));
    expect(r.fresh).toBe(10);
    expect(r.hits).toHaveLength(30);
    expect(new Set(r.hits).size).toBe(30);
    expect(r.hits.slice(0, 10).every((h) => !seen.has(h))).toBe(true);
  });

  it("всё уже видено — круг заново", () => {
    const r = sampleFresh(pool, 30, 4, () => true);
    expect(r.recycled).toBe(true);
    expect(r.hits).toHaveLength(30);
  });

  it("не теряет и не дублирует находки", () => {
    const got = sampleHits(pool, 30, 7);
    expect(new Set(got).size).toBe(30);
  });
});

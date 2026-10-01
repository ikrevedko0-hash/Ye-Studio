// Ребусы: чтение записи, разгадка и подбор разборов на маленьком поддельном словаре.

import { describe, expect, it } from "vitest";
import { explainRebus, matches, readRebus, readSimple, type Rebus, type SimplePiece } from "../src/core/rebus/model";
import { suggest, type SuggestDeps } from "../src/core/rebus/suggest";

const pic = (word: string, ops: SimplePiece["ops"] = []): SimplePiece => ({ id: word, kind: "picture", word, ops });
const txt = (word: string): SimplePiece => ({ id: word, kind: "letters", word, shown: word.toUpperCase(), ops: [] });

describe("чтение", () => {
  it("КОЛ + ОКО + ,,ЛЕВ = колокол", () => {
    const r: Rebus = { answer: "Колокол", pieces: [pic("кол"), pic("око"), pic("лев", [{ kind: "commas", left: 0, right: 2 }])] };
    expect(readRebus(r)).toBe("колокол");
    expect(matches(r)).toBe(true);
    expect(explainRebus(r)).toBe("КОЛ + ОКО + ЛЕВ без 2 последних букв → Л = КОЛОКОЛ");
  });

  it("запятые слева срезают начало", () => {
    expect(readSimple(pic("улей", [{ kind: "commas", left: 1, right: 0 }]))).toBe("лей");
  });

  it("переворот: КОТ↻ = ток", () => {
    expect(readSimple(pic("кот", [{ kind: "flip" }]))).toBe("ток");
  });

  it("А=О меняет все буквы, а знаки читаются в своём порядке, а не в порядке нажатия", () => {
    expect(readSimple(pic("мост", [{ kind: "swap", from: "о", to: "а" }]))).toBe("маст");
    // запятая добавлена раньше переворота, но срезает уже перевёрнутое слово
    expect(readSimple(pic("кот", [{ kind: "commas", left: 0, right: 1 }, { kind: "flip" }]))).toBe("то");
  });

  it("зачёркнутая буква и номера букв", () => {
    expect(readSimple(pic("полк", [{ kind: "drop", letters: "к" }]))).toBe("пол");
    expect(readSimple(pic("ракета", [{ kind: "pick", idx: [3, 4, 5, 6] }]))).toBe("кета");
  });

  it("ноты и числа читаются названием: ДО-МИ-НО, 7Я", () => {
    const domino: Rebus = { answer: "домино", pieces: [{ id: "1", kind: "note", word: "до", ops: [] }, { id: "2", kind: "note", word: "ми", ops: [] }, txt("но")] };
    expect(matches(domino)).toBe(true);
    const family: Rebus = { answer: "семья", pieces: [{ id: "1", kind: "number", word: "семь", shown: "7", ops: [] }, txt("я")] };
    expect(matches(family)).toBe(true);
  });

  it("предлог расположением: «в О — ДА» и «ДА в О» читаются по-разному", () => {
    const voda: Rebus = { answer: "вода", pieces: [{ id: "r", kind: "relation", prep: "в", a: txt("да"), b: txt("о"), order: "prep-b-a" }] };
    expect(readRebus(voda)).toBe("вода");
    expect(explainRebus(voda)).toBe("(В О ДА) = ВОДА");
    const other: Rebus = { answer: "дави", pieces: [{ id: "r", kind: "relation", prep: "в", a: txt("да"), b: txt("и"), order: "a-prep-b" }] };
    expect(readRebus(other)).toBe("дави");
  });

  it("ё и е не различаются", () => {
    expect(matches({ answer: "Ёлка", pieces: [txt("е"), pic("лка")] })).toBe(true);
  });
});

const NOUNS = ["кол", "око", "лев", "кот", "полк", "пол", "ка", "мост", "лейка", "душ", "колокол", "ток", "сорока", "лес", "оса"];
const FAME: Record<string, number> = { кол: 0.8, око: 0.7, лев: 0.9, кот: 0.95, полк: 0.8, пол: 0.9, мост: 0.9, лейка: 0.7, душ: 0.85, колокол: 0.8, ток: 0.6, сорока: 0.7, лес: 0.95, оса: 0.7 };
const deps: SuggestDeps = { nouns: NOUNS, fame: (w) => FAME[w] ?? 0.1 };

describe("подбор разборов", () => {
  it("находит КОЛ · ОКО · ЛЕС,, и не рисует колокол колоколом", () => {
    const s = suggest("колокол", deps, { techniques: ["commas"] });
    expect(s.length).toBeGreaterThan(0);
    // «лес» известнее «льва» — он и идёт первым
    expect(s.map((x) => x.label)).toContain("кол · око · лес,,");
    for (const x of s) {
      expect(readRebus(x.rebus)).toBe("колокол");
      expect(x.label).not.toContain("колокол");
    }
  });

  it("каждый вариант читается в ответ", () => {
    for (const answer of ["полка", "домино", "семья", "кот", "мастер"]) {
      for (const x of suggest(answer, deps)) expect(readRebus(x.rebus)).toBe(answer);
    }
  });

  it("ноты дешевле букв: ДО-МИ-НО начинается с двух нот", () => {
    const [first] = suggest("домино", deps);
    expect(first.label.startsWith("♪до · ♪ми")).toBe(true);
  });

  it("переворот и замена — только если приём включён", () => {
    expect(suggest("ток", deps, { techniques: ["flip"] }).map((x) => x.label)).toContain("кот↻");
    expect(suggest("маст", deps, { techniques: ["swap"] }).map((x) => x.label)).toContain("мост О=А");
    expect(suggest("маст", deps, { techniques: ["commas"] }).map((x) => x.label)).not.toContain("мост О=А");
  });

  it("предлог: «в О — ДА» для слова вода", () => {
    const labels = suggest("вода", deps, { techniques: ["preps", "letters"] }).map((x) => x.label);
    expect(labels).toContain("в «О» «ДА»");
  });

  it("незнакомые слова картинками не берёт", () => {
    const labels = suggest("пол", { nouns: ["пол"], fame: () => 0.1 }).map((x) => x.label);
    expect(labels.some((l) => l.includes("пол") && !l.includes("«"))).toBe(false);
  });
});

// Проверки «Студии слов», которым не нужен словарь: перемешивание и отсев словоформ.
// То, что требует настоящих словарей, проверяется отдельно: npx tsx scripts/words-test.ts

import { describe, expect, it } from "vitest";
import { dropInflections, stem } from "../src/core/words/generators/matrix";
import { fixedPoints, longestCommonChunk, scramble, score } from "../src/core/words/scramble";

describe("перемешивание букв", () => {
  it("сохраняет состав букв и меняет их местами", () => {
    const r = scramble("Красноярск");
    expect(r.scrambled).toHaveLength("Красноярск".length);
    expect([...r.scrambled].sort().join("")).toBe([..."красноярск"].sort().join(""));
    expect(r.scrambled).not.toBe("красноярск");
  });

  it("не оставляет букв на своих местах", () => {
    for (const w of ["Красноярск", "Вологда", "Мурманск", "телевизор", "Саратов"]) {
      expect(fixedPoints(w.toLowerCase(), scramble(w).scrambled)).toBe(0);
    }
  });

  it("не оставляет читаемых кусков исходного слова", () => {
    for (const w of ["Красноярск", "телевизор", "Екатеринбург"]) {
      expect(longestCommonChunk(w.toLowerCase(), scramble(w).scrambled)).toBeLessThanOrEqual(2);
    }
  });

  it("на одно слово всегда даёт один и тот же вариант", () => {
    expect(scramble("Вологда").scrambled).toBe(scramble("Вологда").scrambled);
  });

  it("не берёт вариант, который оказался настоящим словом", () => {
    // «карета» и «ракета» — анаграммы: если притвориться, что словарь знает только «ракета»,
    // перемешиватель обязан выдать что-то другое
    const r = scramble("карета", { isWord: (w) => w === "ракета" });
    expect(r.scrambled).not.toBe("ракета");
  });

  it("считает загадку с целым куском исходника хуже разбитой", () => {
    const easy = score("красноярск", "красноякрс");
    const hard = score("красноярск", "ксряонсарк");
    expect(hard.total).toBeGreaterThan(easy.total);
  });
});

describe("отсев словоформ в матрицах", () => {
  it("сводит падежи к одной форме", () => {
    expect(dropInflections(["шлюз", "шлюза", "шлюзе", "шлюзу", "шлюзы"])).toEqual(["шлюз"]);
  });

  it("не считает формой другое слово", () => {
    expect(dropInflections(["шлюп", "шлюпка"])).toEqual(["шлюп", "шлюпка"]);
  });

  it("сводит формы прилагательного", () => {
    expect(dropInflections(["шлюзная", "шлюзное", "шлюзной", "шлюзном"])).toHaveLength(1);
  });

  it("не режет основу короче трёх букв", () => {
    expect(stem("оса")).toBe("оса");
  });

  it("сводит падежи короткого слова", () => {
    // при пороге в четыре буквы выдача на кусок «пиз» начиналась с шести падежей одного слова
    expect(dropInflections(["пиза", "пизе", "пизу", "пизы", "пизой", "пизою"])).toHaveLength(1);
  });

  it("из семьи форм оставляет словарную, а не самую частую в речи", () => {
    // в субтитрах «шлюпку» встречается чаще «шлюпки», но ответом в паке должна стоять «шлюпка»
    const lemma = (w: string) => w === "шлюпка";
    const fame = (w: string) => (w === "шлюпку" ? 1 : 0);
    expect(dropInflections(["шлюпку", "шлюпка", "шлюпки"], fame, lemma)).toEqual(["шлюпка"]);
  });
});

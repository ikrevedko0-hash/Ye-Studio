// Разбор инициалов для темы «С.С., Н.Н., Х.Х.»: примеры автора и ловушки, найденные на данных Wikidata.

import { describe, expect, it } from "vitest";
import { hasDoubled, initialsOf, matchInitials, normalizeLetters } from "../src/core/words/initials";

describe("инициалы названий", () => {
  it("сравнивает латиницу с кириллицей по виду буквы", () => {
    expect(initialsOf("Сильвестр Сталлоне")).toBe("СС");
    expect(initialsOf("C. C. Catch")).toBe("ССС");
    expect(initialsOf("Helly Hansen")).toBe("НН");
    expect(initialsOf("Нижний Новгород")).toBe("НН");
    expect(initialsOf("Yellow Yoda")).toBe("УУ");
  });

  it("не сравнивает по звуку: S не превращается в С", () => {
    expect(initialsOf("Sylvester Stallone")).toBe("SS");
    expect(matchInitials("Sylvester Stallone", "СС", "start")).toBeUndefined();
  });

  it("разбирает повтор заглавных и стык слов внутри названия", () => {
    expect(initialsOf("XXXTentacion")).toBe("ХХХТ");
    expect(initialsOf("ZZ Top")).toBe("ZZТ");
    expect(initialsOf("PayPal")).toBe("РР");
    expect(initialsOf("Кока-Кола")).toBe("КК");
    expect(initialsOf("M&M's")).toBe("ММ");
  });

  it("не считает служебные слова и артикль", () => {
    expect(initialsOf("наступать на грабли")).toBe("НГ");
    expect(initialsOf("Леонардо да Винчи")).toBe("ЛВ");
    expect(initialsOf("The Beatles")).toBe("В");
    // с заглавной это инициал, а не союз
    expect(initialsOf("A. A. Milne")).toBe("ААМ");
  });

  it("не принимает римские цифры за повтор букв", () => {
    expect(initialsOf("XX век")).toBe("ХВ");
    expect(hasDoubled("XXI век")).toBe(false);
  });

  it("различает «ровно», «в начале» и «внутри»", () => {
    expect(matchInitials("холостой ход", "ХХ", "exact")).toBe("exact");
    expect(matchInitials("XXXTentacion", "ХХ", "exact")).toBeUndefined();
    expect(matchInitials("XXXTentacion", "ХХ", "start")).toBe("start");
    expect(matchInitials("датчик холостого хода", "ХХ", "start")).toBeUndefined();
    expect(matchInitials("датчик холостого хода", "ХХ", "any")).toBe("any");
  });

  it("понимает буквы от автора в любом виде", () => {
    expect(normalizeLetters("С.С.")).toBe("СС");
    expect(normalizeLetters("h h")).toBe("НН");
    expect(normalizeLetters("Х.Х.Х.")).toBe("ХХХ");
  });
});

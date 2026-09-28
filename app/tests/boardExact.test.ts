// Табло и свойства пака (core/siq/board.ts): точные проверки по выжившим мутантам Stryker.
// Пути отказа (не туда, не то) ничего не должны менять; цены — по шкале; атрибуты — на местах SIQuester.

import { describe, expect, it } from "vitest";
import {
  appendTheme, isSortedByPrice, moveQuestion, moveQuestionTo, moveTheme, packLogo, reorderTheme,
  restoreThemeLadder, setPackAttr, setPackLogo, sortThemeByPrice,
} from "../src/core/siq/board";
import type { Package, Question, Round, Theme } from "../src/core/siq/model";

const q = (price: string, id = price): Question => ({ price, right: [id] });
const theme = (name: string, ...prices: string[]): Theme => ({ name, questions: prices.map((p, i) => q(p, `${name}${i}`)) });
const ids = (t: Theme | undefined) => (t?.questions ?? []).map((x) => x.right[0]);
const prices = (t: Theme | undefined) => (t?.questions ?? []).map((x) => x.price);
const pkg = (...rounds: Round[]): Package => ({ attrs: [["name", "П"]], order: [], rounds });

describe("цены темы", () => {
  it("пустая цена и цена из пробелов — не числа: в конец, по порядку", () => {
    const t: Theme = { name: "Т", questions: [q("300"), q(" ", "пробел"), q("100"), q("", "пусто"), q("abc"), q("200")] };
    expect(sortThemeByPrice(t)).toEqual([2, 5, 0, 1, 3, 4]);
    expect(ids(t)).toEqual(["100", "200", "300", "пробел", "пусто", "abc"]);
  });

  it("равные цены не переставляются, сколько бы их ни было", () => {
    const t = theme("Т", "100", "100", "100", "100", "100");
    expect(sortThemeByPrice(t)).toEqual([0, 1, 2, 3, 4]);
    expect(ids(t)).toEqual(["Т0", "Т1", "Т2", "Т3", "Т4"]);
  });

  it("тема без вопросов", () => {
    const t: Theme = { name: "Т" };
    expect(sortThemeByPrice(t)).toEqual([]);
    expect(t.questions).toEqual([]);
    expect(isSortedByPrice({ name: "Т" })).toBe(true);
  });

  it("isSortedByPrice: по возрастанию и равные — да, убывание где угодно — нет, нечисловые — в конце можно", () => {
    expect(isSortedByPrice(theme("Т", "100"))).toBe(true);
    expect(isSortedByPrice(theme("Т", "100", "100", "200"))).toBe(true);
    expect(isSortedByPrice(theme("Т", "200", "100"))).toBe(false);
    expect(isSortedByPrice(theme("Т", "100", "300", "200"))).toBe(false);
    expect(isSortedByPrice(theme("Т", "100", "x"))).toBe(true);
    expect(isSortedByPrice(theme("Т", "x", "100"))).toBe(false);
  });
});

describe("перенос вопроса", () => {
  const round = (): Round => ({ name: "Р", themes: [theme("A", "100", "200", "300"), theme("B", "100", "200"), { name: "C" }] });

  it("не туда — ничего не меняется, карта мест — тождество", () => {
    for (const [from, to] of [[{ theme: 9, question: 0 }, { theme: 0, question: 0 }], [{ theme: 0, question: 7 }, { theme: 1, question: 0 }], [{ theme: 0, question: 0 }, { theme: 9, question: 0 }], [{ theme: 2, question: 0 }, { theme: 0, question: 0 }]]) {
      const r = round();
      const before = structuredClone(r);
      const rel = moveQuestion(r, from, to);
      expect(r).toEqual(before);
      expect(rel({ theme: 0, question: 2 })).toEqual({ theme: 0, question: 2 });
      expect(rel({ theme: 1, question: 1 })).toEqual({ theme: 1, question: 1 });
    }
  });

  it("на своё же место — вопрос не теряется, ничего не меняется", () => {
    const r = round();
    const rel = moveQuestion(r, { theme: 0, question: 1 }, { theme: 0, question: 1 });
    expect(ids(r.themes![0])).toEqual(["A0", "A1", "A2"]);
    expect(rel({ theme: 0, question: 2 })).toEqual({ theme: 0, question: 2 });
  });

  it("в пустую тему: цена 100; карта мест — сдвиги только там, где надо", () => {
    const r = round();
    const rel = moveQuestion(r, { theme: 0, question: 0 }, { theme: 2, question: 5 });
    expect(ids(r.themes![0])).toEqual(["A1", "A2"]);
    expect(prices(r.themes![0])).toEqual(["100", "200"]);
    expect(ids(r.themes![2])).toEqual(["A0"]);
    expect(prices(r.themes![2])).toEqual(["100"]);
    expect(rel({ theme: 0, question: 0 })).toEqual({ theme: 2, question: 0 });
    expect(rel({ theme: 0, question: 1 })).toEqual({ theme: 0, question: 0 });
    expect(rel({ theme: 0, question: 2 })).toEqual({ theme: 0, question: 1 });
    expect(rel({ theme: 1, question: 1 })).toEqual({ theme: 1, question: 1 });
  });

  it("вставка в середину чужой темы: там сдвиг от места вставки", () => {
    const r = round();
    const rel = moveQuestion(r, { theme: 0, question: 2 }, { theme: 1, question: 1 });
    expect(ids(r.themes![1])).toEqual(["B0", "A2", "B1"]);
    expect(prices(r.themes![1])).toEqual(["100", "200", "300"]);
    expect(rel({ theme: 1, question: 0 })).toEqual({ theme: 1, question: 0 });
    expect(rel({ theme: 1, question: 1 })).toEqual({ theme: 1, question: 2 });
    expect(rel({ theme: 0, question: 1 })).toEqual({ theme: 0, question: 1 });
  });

  it("внутри темы вниз: вопросы между сдвигаются вверх", () => {
    const r = round();
    const rel = moveQuestion(r, { theme: 0, question: 0 }, { theme: 0, question: 2 });
    expect(ids(r.themes![0])).toEqual(["A1", "A2", "A0"]);
    expect(prices(r.themes![0])).toEqual(["100", "200", "300"]);
    expect(rel({ theme: 0, question: 1 })).toEqual({ theme: 0, question: 0 });
    expect(rel({ theme: 0, question: 2 })).toEqual({ theme: 0, question: 1 });
  });
});

describe("шкала цен при переносе и вставке", () => {
  it("следующая цена: шаг по двум последним; одна цена — шагом в неё; нечисловые не мешают", () => {
    const r1: Round = { name: "Р", themes: [theme("A", "300")] };
    expect(appendTheme(pkg(r1), 0, theme("N", "1", "1", "1"))).toBe(-1 + 2);
    expect(prices(r1.themes![1])).toEqual(["300", "600", "900"]);

    const r2: Round = { name: "Р", themes: [theme("A", "0", "100")] };
    appendTheme(pkg(r2), 0, theme("N", "1", "1", "1"));
    expect(prices(r2.themes![1])).toEqual(["0", "100", "200"]);

    const r3: Round = { name: "Р", themes: [theme("A", "100", "x", "250")] };
    appendTheme(pkg(r3), 0, theme("N", "1", "1", "1", "1"));
    expect(prices(r3.themes![1])).toEqual(["100", "x", "250", "400"]);

    const r4: Round = { name: "Р", themes: [theme("A", "x")] };
    appendTheme(pkg(r4), 0, theme("N", "1", "1"));
    expect(prices(r4.themes![1])).toEqual(["x", "100"]);

    const r5: Round = { name: "Р", themes: [theme("A", "200", "200")] };
    appendTheme(pkg(r5), 0, theme("N", "1", "1", "1"));
    expect(prices(r5.themes![1])).toEqual(["200", "200", "300"]);
  });

  it("appendTheme: нет раунда — -1; у первой темы нет вопросов — свои цены; тема без вопросов; раунд без тем", () => {
    const p = pkg({ name: "Р", themes: [{ name: "пусто" }] }, { name: "Р2" });
    expect(appendTheme(p, 5, theme("N", "1"))).toBe(-1);
    expect(appendTheme(p, 0, theme("N", "7", "8"))).toBe(1);
    expect(prices(p.rounds![0].themes![1])).toEqual(["7", "8"]);
    expect(appendTheme(p, 1, { name: "без вопросов" })).toBe(0);
    expect(p.rounds![1].themes!.map((t) => t.name)).toEqual(["без вопросов"]);
  });

  it("moveQuestionTo: отказы — -1 и без изменений", () => {
    const make = () => pkg({ name: "Р", themes: [theme("A", "100", "200"), theme("B", "100"), { name: "C" }] }, { name: "Р2", themes: [theme("D", "500")] });
    const cases: [number, { theme: number; question: number }, number, number][] = [
      [0, { theme: 0, question: 0 }, 0, 0], // та же тема
      [5, { theme: 0, question: 0 }, 1, 0], // нет раунда
      [0, { theme: 9, question: 0 }, 1, 0], // нет темы
      [0, { theme: 0, question: 9 }, 1, 0], // нет вопроса
      [0, { theme: 0, question: 0 }, 1, 9], // нет темы-приёмника
      [0, { theme: 2, question: 0 }, 1, 0], // тема без вопросов
      [9, { theme: 0, question: 0 }, 9, 1], // нет раунда вовсе
    ];
    for (const [fr, from, tr, tt] of cases) {
      const p = make();
      const before = structuredClone(p);
      expect(moveQuestionTo(p, fr, from, tr, tt)).toBe(-1);
      expect(p).toEqual(before);
    }
  });

  it("moveQuestionTo в своём раунде в тему без вопросов — место 0; в чужой — в конец", () => {
    const p = pkg({ name: "Р", themes: [theme("A", "100", "200"), { name: "C" }] }, { name: "Р2", themes: [theme("D", "500")] });
    expect(moveQuestionTo(p, 0, { theme: 0, question: 1 }, 0, 1)).toBe(0);
    expect(ids(p.rounds![0].themes![1])).toEqual(["A1"]);
    expect(moveQuestionTo(p, 0, { theme: 0, question: 0 }, 1, 0)).toBe(1);
    expect(prices(p.rounds![1].themes![0])).toEqual(["500", "1000"]);
    const noQ = pkg({ name: "Р", themes: [theme("A", "100")] }, { name: "Р2", themes: [{ name: "E" }] });
    expect(moveQuestionTo(noQ, 0, { theme: 0, question: 0 }, 1, 0)).toBe(0);
    expect(prices(noQ.rounds![1].themes![0])).toEqual(["100"]);
  });

  it("moveTheme: отказы — -1 и без изменений", () => {
    for (const [fr, ti, tr] of [[0, 0, 0], [0, 9, 1], [9, 0, 1], [0, 0, 9]]) {
      const p = pkg({ name: "Р", themes: [theme("A", "100")] }, { name: "Р2", themes: [theme("D", "500")] });
      const before = structuredClone(p);
      expect(moveTheme(p, fr, ti, tr)).toBe(-1);
      expect(p).toEqual(before);
    }
    const noThemes = pkg({ name: "Р" }, { name: "Р2" });
    expect(moveTheme(noThemes, 0, 0, 1)).toBe(-1);
  });
});

describe("одна цена на тему → лесенка", () => {
  it("образец — другая тема раунда: не сама, не из одного вопроса, не «одна цена»", () => {
    const r: Round = { name: "Р", themes: [theme("T", "100", "300", "200"), theme("один", "50"), theme("ровно", "300", "300"), theme("лесенка", "10", "20", "30")] };
    restoreThemeLadder(r, 0);
    expect(prices(r.themes![0])).toEqual(["10", "20", "30"]);
  });

  it("тема без вопросов и несуществующая — без падения", () => {
    const r: Round = { name: "Р", themes: [{ name: "пусто" }] };
    expect(() => restoreThemeLadder(r, 0)).not.toThrow();
    expect(() => restoreThemeLadder(r, 5)).not.toThrow();
    expect(() => restoreThemeLadder({ name: "Р" }, 0)).not.toThrow();
  });

  it("образец короче темы — продолжаем его шагом", () => {
    const r: Round = { name: "Р", themes: [theme("T", "5", "5", "5", "5"), theme("лесенка", "100", "200")] };
    restoreThemeLadder(r, 0);
    expect(prices(r.themes![0])).toEqual(["100", "200", "300", "400"]);
  });
});

describe("порядок тем", () => {
  it("за край, на то же место, нет раунда — false и без изменений", () => {
    const p = pkg({ name: "Р", themes: [theme("A"), theme("B"), theme("C")] });
    for (const [r, f, t] of [[0, 0, -1], [0, 0, 3], [0, 1, 1], [0, 5, 0], [3, 0, 1]]) {
      expect(reorderTheme(p, r, f, t)).toBe(false);
    }
    expect(p.rounds![0].themes!.map((t) => t.name)).toEqual(["A", "B", "C"]);
    expect(reorderTheme(p, 0, 2, 0)).toBe(true);
    expect(p.rounds![0].themes!.map((t) => t.name)).toEqual(["C", "A", "B"]);
  });
});

describe("атрибуты пака", () => {
  const ORDER = ["name", "version", "id", "restriction", "date", "publisher", "contactUri", "difficulty", "logo", "language", "xmlns"];

  it("любой порядок добавления — итог в порядке SIQuester", () => {
    const p: Package = { attrs: [["name", "П"]], order: [] };
    for (const a of [...ORDER].reverse()) if (a !== "name") setPackAttr(p, a, a + "!");
    expect(p.attrs.map(([k]) => k)).toEqual(ORDER);
    const q2: Package = { attrs: [["name", "П"], ["xmlns", "x"]], order: [] };
    for (const a of ORDER.slice(1, -1)) setPackAttr(q2, a, "v");
    expect(q2.attrs.map(([k]) => k)).toEqual(ORDER);
  });

  it("незнакомый атрибут — перед xmlns, а без xmlns — в конец", () => {
    const p: Package = { attrs: [["name", "П"], ["xmlns", "x"]], order: [] };
    setPackAttr(p, "свой", "1");
    expect(p.attrs).toEqual([["name", "П"], ["свой", "1"], ["xmlns", "x"]]);
    const noNs: Package = { attrs: [["name", "П"], ["logo", "@a"]], order: [] };
    setPackAttr(noNs, "свой", "1");
    expect(noNs.attrs).toEqual([["name", "П"], ["logo", "@a"], ["свой", "1"]]);
  });

  it("атрибут на первом месте меняется и убирается; пустое имя пака — остаётся пустым", () => {
    const p: Package = { attrs: [["version", "5"], ["name", "П"]], order: [] };
    setPackAttr(p, "version", "6");
    expect(p.attrs).toEqual([["version", "6"], ["name", "П"]]);
    setPackAttr(p, "version", "");
    expect(p.attrs).toEqual([["name", "П"]]);
    setPackAttr(p, "name", "");
    expect(p.attrs).toEqual([["name", ""]]);
    setPackAttr(p, "date", "");
    expect(p.attrs).toEqual([["name", ""]]);
  });

  it("логотип: «@имя», без собачки — как есть, пусто — нет; снять — атрибута нет", () => {
    const p: Package = { attrs: [["name", "П"]], order: [] };
    expect(packLogo(p)).toBeUndefined();
    setPackLogo(p, "a.png");
    expect(p.attrs).toEqual([["name", "П"], ["logo", "@a.png"]]);
    expect(packLogo(p)).toBe("a.png");
    p.attrs[1][1] = "b.png";
    expect(packLogo(p)).toBe("b.png");
    p.attrs[1][1] = "";
    expect(packLogo(p)).toBeUndefined();
    setPackLogo(p, undefined);
    expect(p.attrs).toEqual([["name", "П"]]);
  });
});

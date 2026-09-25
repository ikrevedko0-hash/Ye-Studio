import { describe, expect, it } from "vitest";
import { moveQuestion, moveQuestionTo, moveTheme, packLogo, setPackAttr, setPackLogo, sortThemeByPrice } from "../src/core/siq/board";
import { newPackage, newQuestion, newTheme } from "../src/core/siq/helpers";
import type { Round } from "../src/core/siq/model";
import { buildContentXml, parseContentXml } from "../src/core/siq/xml";

const tag = (r: Round, t: number) => r.themes![t].questions!.map((q) => `${q.right[0]}:${q.price}`);

function round(...themes: number[][]): Round {
  return {
    name: "R",
    themes: themes.map((prices, ti) => {
      const t = newTheme(`T${ti}`, prices);
      t.questions!.forEach((q, i) => { q.right = [`${ti}${String.fromCharCode(97 + i)}`]; });
      return t;
    }),
  };
}

describe("порядок по цене", () => {
  it("сортирует и сообщает, откуда пришёл каждый вопрос", () => {
    const r = round([100, 500, 300]);
    const order = sortThemeByPrice(r.themes![0]);
    expect(order).toEqual([0, 2, 1]);
    expect(tag(r, 0)).toEqual(["0a:100", "0c:300", "0b:500"]);
  });

  it("равные цены не переставляет, нечисловые — в конец", () => {
    const r = round([200, 200, 100]);
    r.themes![0].questions!.push({ ...newQuestion(0), price: "", right: ["x"] });
    sortThemeByPrice(r.themes![0]);
    expect(tag(r, 0)).toEqual(["0c:100", "0a:200", "0b:200", "x:"]);
  });
});

describe("перетаскивание", () => {
  it("в своей теме цены остаются за местами", () => {
    const r = round([100, 200, 300, 400]);
    const where = moveQuestion(r, { theme: 0, question: 0 }, { theme: 0, question: 2 });
    expect(tag(r, 0)).toEqual(["0b:100", "0c:200", "0a:300", "0d:400"]);
    expect(where({ theme: 0, question: 0 })).toEqual({ theme: 0, question: 2 });
    expect(where({ theme: 0, question: 1 })).toEqual({ theme: 0, question: 0 });
    expect(where({ theme: 0, question: 3 })).toEqual({ theme: 0, question: 3 });
  });

  it("вверх по цене тоже", () => {
    const r = round([100, 200, 300]);
    moveQuestion(r, { theme: 0, question: 2 }, { theme: 0, question: 0 });
    expect(tag(r, 0)).toEqual(["0c:100", "0a:200", "0b:300"]);
  });

  it("в другую тему: источник теряет старшую цену, приёмник получает следующую", () => {
    const r = round([100, 200, 300], [100, 200, 300]);
    const where = moveQuestion(r, { theme: 0, question: 0 }, { theme: 1, question: 1 });
    expect(tag(r, 0)).toEqual(["0b:100", "0c:200"]);
    expect(tag(r, 1)).toEqual(["1a:100", "0a:200", "1b:300", "1c:400"]);
    expect(where({ theme: 1, question: 2 })).toEqual({ theme: 1, question: 3 });
    expect(where({ theme: 0, question: 2 })).toEqual({ theme: 0, question: 1 });
  });

  it("в финале цены остаются нулевыми", () => {
    const r = round([0], [0]);
    moveQuestion(r, { theme: 0, question: 0 }, { theme: 1, question: 1 });
    expect(tag(r, 1)).toEqual(["1a:0", "0a:0"]);
  });
});

describe("между раундами", () => {
  const pack = () => {
    const pkg = newPackage();
    pkg.rounds = [round([100, 200, 300], [100, 200, 300]), round([200, 400, 600, 800]), { ...round([0]), type: "final" }];
    return pkg;
  };

  it("тема уходит в конец другого раунда и берёт его цены", () => {
    const pkg = pack();
    expect(moveTheme(pkg, 0, 0, 1)).toBe(1);
    expect(pkg.rounds![0].themes!.map((t) => t.name)).toEqual(["T1"]);
    expect(tag(pkg.rounds![1], 1)).toEqual(["0a:200", "0b:400", "0c:600"]);
  });

  it("длинная тема продолжает шкалу раунда тем же шагом", () => {
    const pkg = pack();
    moveTheme(pkg, 1, 0, 0);
    expect(tag(pkg.rounds![0], 2)).toEqual(["0a:100", "0b:200", "0c:300", "0d:400"]);
  });

  it("в финал — с нулевыми ценами; в тот же раунд — ничего", () => {
    const pkg = pack();
    moveTheme(pkg, 0, 0, 2);
    expect(tag(pkg.rounds![2], 1)).toEqual(["0a:0", "0b:0", "0c:0"]);
    expect(moveTheme(pkg, 0, 0, 0)).toBe(-1);
  });

  it("вопрос уходит в конец темы другого раунда", () => {
    const pkg = pack();
    expect(moveQuestionTo(pkg, 0, { theme: 1, question: 0 }, 1, 0)).toBe(4);
    expect(tag(pkg.rounds![0], 1)).toEqual(["1b:100", "1c:200"]);
    expect(tag(pkg.rounds![1], 0)).toEqual(["0a:200", "0b:400", "0c:600", "0d:800", "1a:1000"]);
  });

  it("вопрос в другую тему своего раунда — в конец", () => {
    const pkg = pack();
    expect(moveQuestionTo(pkg, 0, { theme: 0, question: 2 }, 0, 1)).toBe(3);
    expect(tag(pkg.rounds![0], 0)).toEqual(["0a:100", "0b:200"]);
    expect(tag(pkg.rounds![0], 1)).toEqual(["1a:100", "1b:200", "1c:300", "0c:400"]);
  });
});

describe("атрибуты пака", () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?><package name="Уе!пак №5" version="5" id="d09ad31a" date="14.01.2026" language="ru-RU" xmlns="https://github.com/VladimirKhil/SI/blob/master/assets/siq_5.xsd"></package>`;

  it("новые атрибуты встают туда же, куда их ставит SIQuester", () => {
    const pkg = parseContentXml(xml);
    setPackLogo(pkg, "Логотип 3.png");
    setPackAttr(pkg, "difficulty", "3");
    setPackAttr(pkg, "restriction", "30+");
    setPackAttr(pkg, "publisher", "Creosot");
    expect(pkg.attrs.map(([k]) => k)).toEqual(["name", "version", "id", "restriction", "date", "publisher", "difficulty", "logo", "language", "xmlns"]);
    expect(packLogo(pkg)).toBe("Логотип 3.png");
    expect(buildContentXml(pkg)).toContain(`difficulty="3" logo="@Логотип 3.png" language="ru-RU"`);
  });

  it("пустое значение убирает атрибут, и пак снова как был", () => {
    const before = buildContentXml(parseContentXml(xml));
    const pkg = parseContentXml(xml);
    setPackLogo(pkg, "a.png");
    setPackLogo(pkg, undefined);
    expect(buildContentXml(pkg)).toBe(before);
  });

  it("у нового пака логотипа нет", () => {
    expect(packLogo(newPackage())).toBeUndefined();
  });
});

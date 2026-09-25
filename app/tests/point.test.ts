// Ответ точкой на картинке. Фрагменты XML — из «Ночных посиделок №83/84» (собраны SIQuester),
// правило попадания — из SICore AnswerChecker.IsPointAnswerRight.

import { describe, expect, it } from "vitest";
import { formatPoint, getOptions, isPointQuestion, parsePoint, pointAnswer, pointDeviation, pointHit, pointImage, pointProblems, setOptions, setPoint, setPointDeviation, setPointMode } from "../src/core/siq/helpers";
import { buildContentXml, parseContentXml } from "../src/core/siq/xml";

const wrap = (question: string) =>
  `<?xml version="1.0" encoding="utf-8"?><package name="T" version="5" xmlns="https://github.com/VladimirKhil/SI/blob/master/assets/siq_5.xsd">` +
  `<rounds><round name="R"><themes><theme name="Th"><questions>${question}</questions></theme></themes></round></rounds></package>`;

const SHREK = wrap(
  `<question price="800"><info><showmanComments>Шрек по центру у лампы</showmanComments></info><params>` +
    `<param name="question" type="content"><item waitForFinish="False">Найдите Шрека:</item>` +
    `<item type="image" isRef="True" duration="00:00:40">Шрек по центру у лампы.jpg</item></param>` +
    `<param name="answerType">point</param><param name="answerDeviation">0.11</param></params>` +
    `<right><answer>0.38,0.48,1.78</answer></right></question>`,
);

const DIFF = wrap(
  `<question price="600"><params><param name="question" type="content"><item waitForFinish="False">Найдите отличие:</item>` +
    `<item type="image" isRef="True" duration="00:00:03">3 ряд - 3 слева .jpg</item></param>` +
    `<param name="answerType">point</param><param name="answerDeviation">0.14</param><param name="answerDuration">10</param>` +
    `<param name="answer" type="content"><item type="image" isRef="True">3 ряд - 3 слева_ответ.jpg</item></param></params>` +
    `<right><answer>0.62,0.63,0.89</answer><answer>3 ряд - 3 слева </answer></right></question>`,
);

const first = (xml: string) => parseContentXml(xml).rounds![0].themes![0].questions![0];

const TEXT_Q = wrap(
  `<question price="100"><params><param name="question" type="content"><item waitForFinish="False">Найдите кота:</item>` +
    `<item type="image" isRef="True">кот.jpg</item></param></params><right><answer>на шкафу</answer></right></question>`,
);

describe("ответ точкой: чтение", () => {
  it("точка, допуск и картинка из пака", () => {
    const q = first(SHREK);
    expect(isPointQuestion(q)).toBe(true);
    expect(pointAnswer(q)).toEqual({ x: 0.38, y: 0.48, ratio: 1.78 });
    expect(pointDeviation(q)).toBe(0.11);
    expect(pointImage(q)?.value).toBe("Шрек по центру у лампы.jpg");
    expect(pointProblems(q, 960 / 540)).toEqual([]);
  });

  it("старый формат без пропорций — как у SIGame, ratio 1", () => {
    expect(parsePoint("0.5,0.25")).toEqual({ x: 0.5, y: 0.25, ratio: 1 });
    expect(parsePoint("3 ряд")).toBeUndefined();
    expect(parsePoint("1,2,3,4")).toBeUndefined();
  });

  it("числа пишутся как у .NET после Math.Round(v, 2)", () => {
    expect(formatPoint({ x: 0.4, y: 1, ratio: 863 / 971 })).toBe("0.4,1,0.89");
    expect(formatPoint({ x: 0.3749, y: -0.2, ratio: 1.7777 })).toBe("0.37,0,1.78");
  });
});

describe("ответ точкой: сохранение", () => {
  for (const [name, xml] of [["Шрек", SHREK], ["отличие с подсказкой и картинкой ответа", DIFF]] as const) {
    it(`${name}: чтение и запись без правок дают тот же XML`, () => {
      expect(buildContentXml(parseContentXml(xml))).toBe(xml);
    });
    it(`${name}: та же точка и допуск — тот же XML`, () => {
      const pkg = parseContentXml(xml);
      const q = pkg.rounds![0].themes![0].questions![0];
      setPointMode(q, true);
      setPoint(q, pointAnswer(q)!);
      setPointDeviation(q, pointDeviation(q));
      expect(buildContentXml(pkg)).toBe(xml);
    });
  }

  it("новая точка встаёт первым ответом, подсказка ведущему остаётся", () => {
    const q = first(DIFF);
    setPoint(q, { x: 0.1, y: 0.2, ratio: 0.89 });
    expect(q.right).toEqual(["0.1,0.2,0.89", "3 ряд - 3 слева "]);
  });
});

describe("ответ точкой: включение и выключение", () => {
  it("включение сохраняет текстовый ответ подсказкой и ставит допуск", () => {
    const q = first(TEXT_Q);
    setPointMode(q, true);
    expect(q.params!.map((p) => [p.name, p.text])).toEqual([["question", undefined], ["answerType", "point"], ["answerDeviation", "0.1"]]);
    expect(q.right).toEqual(["", "на шкафу"]);
    expect(pointProblems(q)).toEqual(["точка не поставлена: щёлкните по картинке в редакторе"]);
  });

  it("включение снимает варианты ответа и их букву", () => {
    const q = first(TEXT_Q);
    setOptions(q, ["шкаф", "стол"]);
    q.right = ["A"];
    setPointMode(q, true);
    expect(getOptions(q)).toEqual([]);
    expect(q.params!.filter((p) => p.name === "answerType").map((p) => p.text)).toEqual(["point"]);
    expect(q.right).toEqual([""]);
  });

  it("варианты ответа снимают допуск точки", () => {
    const q = first(SHREK);
    setOptions(q, ["а", "б"]);
    expect(q.params!.map((p) => p.name)).toEqual(["question", "answerType", "answerOptions"]);
  });

  it("выключение убирает тип, допуск и точку, но не подсказку", () => {
    const q = first(DIFF);
    setPointMode(q, false);
    expect(q.params!.map((p) => p.name)).toEqual(["question", "answerDuration", "answer"]);
    expect(q.right).toEqual(["3 ряд - 3 слева "]);
    const s = first(SHREK);
    setPointMode(s, false);
    expect(s.right).toEqual([""]);
  });

  it("допуск прижимается к 0,02…0,3", () => {
    const q = first(SHREK);
    setPointDeviation(q, 0.001);
    expect(pointDeviation(q)).toBe(0.02);
    setPointDeviation(q, 0.123);
    expect(pointDeviation(q)).toBe(0.12);
  });
});

describe("ответ точкой: попадание как в SIGame", () => {
  const right = { x: 0.5, y: 0.5, ratio: 2 };
  it("по вертикали допуск в долях высоты", () => {
    expect(pointHit(right, 0.1, { x: 0.5, y: 0.59 })).toBe(true);
    expect(pointHit(right, 0.1, { x: 0.5, y: 0.61 })).toBe(false);
  });
  it("по горизонтали широкая картинка сужает зону в долях ширины", () => {
    // 0,04 ширины при ratio 2 — это 0,08 высоты: внутри; 0,06 ширины — 0,12: мимо
    expect(pointHit(right, 0.1, { x: 0.54, y: 0.5 })).toBe(true);
    expect(pointHit(right, 0.1, { x: 0.56, y: 0.5 })).toBe(false);
  });
  it("допуск меньше 0,02 игра поднимает до 0,02", () => {
    expect(pointHit(right, 0, { x: 0.5, y: 0.515 })).toBe(true);
  });
});

describe("ответ точкой: проблемы", () => {
  it("картинку заменили — пропорции не совпали", () => {
    expect(pointProblems(first(SHREK), 4 / 3)).toEqual(["картинку заменили после разметки — поставьте точку заново"]);
  });
  it("без картинки в конце вопроса", () => {
    const q = first(SHREK);
    q.params![0].children.reverse();
    expect(pointProblems(q)[0]).toMatch(/последним в вопросе/);
  });
});

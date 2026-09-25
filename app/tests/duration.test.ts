// Время показа элементов и время на кнопку — по правилам SICore GameController (TimeSettings по умолчанию).

import { describe, expect, it } from "vitest";
import { answerDuration, formatDuration, itemDefaultTime, itemGameTime, parseDuration, setAnswerDuration, withDuration } from "../src/core/siq/helpers";
import type { Question } from "../src/core/siq/model";
import { applyTimeDefaults, defaultTimedIndex, withTimeDefaults } from "../src/core/siq/helpers";
import { buildContentXml, parseContentXml } from "../src/core/siq/xml";

describe("своё время элемента", () => {
  it("пишется как TimeSpan у SIQuester и читается обратно", () => {
    expect(formatDuration(40)).toBe("00:00:40");
    expect(formatDuration(75)).toBe("00:01:15");
    expect(formatDuration(2.5)).toBe("00:00:02.5");
    expect(parseDuration("00:00:02.5")).toBe(2.5);
    expect(parseDuration("00:00:02.5000000")).toBe(2.5);
  });

  it("пусто или 0 — атрибут убирается", () => {
    const img = { type: "image", isRef: "True", value: "a.jpg", duration: "00:00:40" };
    expect(withDuration(img, undefined)).toEqual({ type: "image", isRef: "True", value: "a.jpg" });
    expect(withDuration(img, 0)).not.toHaveProperty("duration");
    expect(withDuration(img, 10).duration).toBe("00:00:10");
  });

  it("у текста своё время заменяет чтение, пауза — только в ответе", () => {
    const text = { value: "x".repeat(40), duration: "00:00:07" };
    expect(itemGameTime(text, false)).toBe(7);
    expect(itemGameTime(text, true, true)).toBe(9);
    expect(itemDefaultTime(text, false)).toBe(2 + 2);
  });

  it("звук и видео со своим временем — ровно столько, без потолка", () => {
    expect(itemGameTime({ type: "video", isRef: "True", value: "v", duration: "00:03:00" }, true)).toBe(180);
    expect(itemDefaultTime({ type: "audio", isRef: "True", value: "a", duration: "00:00:05" }, true)).toBeUndefined();
  });
});

describe("время на кнопку", () => {
  const q = (): Question => ({ price: "100", params: [{ name: "question", type: "content", children: [] }], right: [""] });
  it("ставится секундами и снимается пустым", () => {
    const x = q();
    setAnswerDuration(x, 10);
    expect(x.params!.map((p) => [p.name, p.text])).toEqual([["question", undefined], ["answerDuration", "10"]]);
    expect(answerDuration(x)).toBe(10);
    setAnswerDuration(x, undefined);
    expect(x.params!.map((p) => p.name)).toEqual(["question"]);
  });
});

describe("время по умолчанию мастерской", () => {
  const pack = (questions: string, final = "") =>
    `<?xml version="1.0" encoding="utf-8"?><package name="T" version="5" xmlns="https://github.com/VladimirKhil/SI/blob/master/assets/siq_5.xsd">` +
    `<rounds><round name="R"><themes><theme name="Th"><questions>${questions}</questions></theme></themes></round>${final}</rounds></package>`;
  const q = (params: string, price = 100) => `<question price="${price}"><params>${params}</params><right><answer>x</answer></right></question>`;

  it("текст + картинка на одном экране: 10 с картинке, 10 с на кнопку", () => {
    const pkg = parseContentXml(pack(q(`<param name="question" type="content"><item waitForFinish="False">Кто это?</item><item type="image" isRef="True">a.jpg</item></param>`)));
    expect(applyTimeDefaults(pkg)).toBe(1);
    expect(buildContentXml(pkg)).toContain(`<item type="image" isRef="True" duration="00:00:10">a.jpg</item></param><param name="answerDuration">10</param>`);
  });

  it("найди на картинке — 40 с", () => {
    const x = parseContentXml(pack(q(`<param name="question" type="content"><item type="image" isRef="True">a.jpg</item></param><param name="answerType">point</param>`))).rounds![0].themes![0].questions![0];
    expect(withTimeDefaults(x).params![0].children[0]).toMatchObject({ item: { duration: "00:00:40" } });
  });

  it("своё время, звук в конце и финал не трогаем; повторно ничего не меняется", () => {
    const own = q(`<param name="question" type="content"><item duration="00:00:03">Текст</item><item type="image" isRef="True">a.jpg</item></param><param name="answerDuration">7</param>`);
    const audio = q(`<param name="question" type="content"><item waitForFinish="False">Угадай</item><item type="audio" isRef="True">a.mp3</item></param>`, 200);
    const final = `<round name="Ф" type="final"><themes><theme name="F"><questions>${q(`<param name="question" type="content"><item>Финал</item></param>`, 0)}</questions></theme></themes></round>`;
    const xml = pack(own + audio, final);
    const pkg = parseContentXml(xml);
    expect(applyTimeDefaults(pkg)).toBe(1); // только кнопка у звукового вопроса
    const out = buildContentXml(pkg);
    expect(out).toContain(`<item type="audio" isRef="True">a.mp3</item></param><param name="answerDuration">10</param>`);
    expect(out).toContain(`<item>Финал</item></param></params>`);
    expect(applyTimeDefaults(parseContentXml(out))).toBe(0);
  });

  it("элемент «одновременно со следующим» последним не бывает — пропуск", () => {
    expect(defaultTimedIndex([{ value: "a" }, { value: "b", placement: "background", type: "audio" }])).toBe(0);
  });
});

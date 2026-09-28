// Варианты ответа против картинки (core/siq/optionsLayout.ts): что SIOnline сжимает и как это чинится.
import { describe, expect, it } from "vitest";
import { checkPack } from "../src/core/siq/check";
import { findOptionsSqueeze, optionsSqueezeVisual, optionsTextToReplic } from "../src/core/siq/optionsLayout";
import { parseContentXml, buildContentXml } from "../src/core/siq/xml";

const NS = "https://github.com/VladimirKhil/SI/blob/master/assets/siq_5.xsd";
const opts = `<param name="answerType">select</param><param name="answerOptions" type="group"><param name="A" type="content"><item>Бельгия</item></param><param name="B" type="content"><item>Германия</item></param></param>`;
const q = (price: number, body: string, extra = opts) => `<question price="${price}"><params><param name="question" type="content">${body}</param>${extra}</params><right><answer>A</answer></right></question>`;
const img = `<item type="image" isRef="True">флаг.png</item>`;
const pack = (...qs: string[]) => parseContentXml(`<?xml version="1.0" encoding="utf-8"?><package name="П" version="5" xmlns="${NS}"><rounds><round name="Р"><themes><theme name="Т"><questions>${qs.join("")}</questions></theme></themes></round></rounds></package>`);

describe("варианты ответа против картинки", () => {
  const p = pack(
    q(100, img + "<item>Флаг какой страны?</item>"),                        // сожмётся
    q(200, `<item waitForFinish="True">Флаг какой страны?</item>` + img),   // текст отдельным экраном — тоже
    q(300, img),                                                              // только картинка — нет
    q(400, img + `<item placement="replic">Флаг какой страны?</item>`),     // уже реплика — нет
    q(500, img + "<item>Флаг?</item>", ""),                                   // без вариантов — нет
    q(600, "<item>Столица Франции?</item>"),                                 // только текст — нет
    q(700, `<item type="video" isRef="True">v.mp4</item><item placement="screen">Кто это?</item>`), // видео + явный screen — да
    q(800, img + "<item>   </item>"),                                          // пустой текст — нет
  );

  it("находит только вопросы с вариантами, где на экране и картинка (видео), и текст", () => {
    expect(findOptionsSqueeze(p)).toEqual([0, 1, 6].map((question) => ({ round: 0, theme: 0, question })));
  });

  it("правка: текст экрана — репликой, картинка и варианты не тронуты; после неё сжимать нечего", () => {
    const fixed = structuredClone(p);
    expect(optionsTextToReplic(fixed)).toBe(3);
    expect(findOptionsSqueeze(fixed)).toEqual([]);
    const items = (qi: number) => fixed.rounds![0].themes![0].questions![qi].params![0].children.map((c) => c.kind === "item" ? [c.item.type ?? "text", c.item.placement ?? ""] : []);
    expect(items(0)).toEqual([["image", ""], ["text", "replic"]]);
    expect(items(6)).toEqual([["video", ""], ["text", "replic"]]);
    expect(items(7)).toEqual([["image", ""], ["text", ""]]);
    expect(fixed.rounds![0].themes![0].questions![0].params![2]).toEqual(p.rounds![0].themes![0].questions![0].params![2]);
    // в файл пишется как в SIQuester — placement="replic"
    expect(buildContentXml(fixed)).toContain(`<item placement="replic">Флаг какой страны?</item>`);
    expect(optionsTextToReplic(fixed)).toBe(0);
  });

  it("в проверке пака — совет с переходом к вопросу (правится само при сохранении)", () => {
    const issues = checkPack(p, []).filter((i) => i.text.startsWith("Вопрос с вариантами"));
    expect(issues.map((i) => i.at)).toEqual([0, 1, 6].map((question) => ({ round: 0, theme: 0, question })));
    expect(issues[0].level).toBe("info");
    expect(optionsSqueezeVisual(p.rounds![0].themes![0].questions![2])).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { renameMediaEverywhere, sizeTips, unusedMedia } from "../src/core/siq/packSize";
import { buildContentXml, parseContentXml } from "../src/core/siq/xml";

const XML =
  `<?xml version="1.0" encoding="utf-8"?><package name="T" version="5" logo="@лого.png" xmlns="https://github.com/VladimirKhil/SI/blob/master/assets/siq_5.xsd">` +
  `<rounds><round name="R"><themes><theme name="Th"><questions><question price="100"><params>` +
  `<param name="question" type="content"><item type="image" isRef="True">a.png</item><item type="video" isRef="True">v.mp4</item></param>` +
  `<param name="answer" type="content"><item type="image" isRef="True">a.png</item></param>` +
  `<param name="answerType">select</param><param name="answerOptions" type="group"><param name="A" type="content"><item type="image" isRef="True">opt.jpg</item></param></param>` +
  `</params><right><answer>A</answer></right></question></questions></theme></themes></round></rounds></package>`;

const media = [
  { folder: "Images", name: "a.png", size: 1 },
  { folder: "Images", name: "opt.jpg", size: 1 },
  { folder: "Images", name: "лого.png", size: 1 },
  { folder: "Images", name: "забыли.jpg", size: 5 * 1048576 },
  { folder: "Video", name: "v.mp4", size: 60 * 1048576 },
  { folder: "Video", name: "a.png", size: 1 }, // то же имя, но в другой папке — не используется
];

describe("объём пака", () => {
  it("неиспользуемые: ни вопрос, ни ответ, ни вариант, ни логотип не ссылаются", () => {
    expect(unusedMedia(parseContentXml(XML), media).map((m) => `${m.folder}/${m.name}`)).toEqual(["Images/забыли.jpg", "Video/a.png"]);
  });

  it("переименование везде: вопрос, ответ и логотип", () => {
    const pkg = parseContentXml(XML);
    expect(renameMediaEverywhere(pkg, "Images", "a.png", "a.jpg")).toBe(2);
    expect(renameMediaEverywhere(pkg, "Images", "лого.png", "лого.jpg")).toBe(1);
    const out = buildContentXml(pkg);
    expect(out).toContain(`logo="@лого.jpg"`);
    expect(out.match(/>a\.jpg</g)?.length).toBe(2);
    expect(out).toContain(">v.mp4<");
  });

  it("советы: неиспользуемые и тяжёлое видео", () => {
    const tips = sizeTips(media, unusedMedia(parseContentXml(XML), media));
    expect(tips[0]).toMatch(/Без дела лежит 2/);
    expect(tips.some((t) => t.startsWith("Видео"))).toBe(true);
  });
});

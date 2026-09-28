import { describe, expect, it } from "vitest";
import { mb, renameMediaEverywhere, sizeTips, unusedMedia } from "../src/core/siq/packSize";
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

// ---------- точные проверки по выжившим мутантам Stryker ----------

const MB = 1048576;
const pack2 = (items: string, logo = "") => parseContentXml(
  `<?xml version="1.0" encoding="utf-8"?><package name="T"${logo ? ` logo="@${logo}"` : ""} xmlns="https://github.com/VladimirKhil/SI/blob/master/assets/siq_5.xsd">` +
  `<rounds><round name="R"><themes><theme name="Th"><questions><question price="1"><params><param name="question" type="content">${items}</param></params><right><answer>o</answer></right></question></questions></theme></themes></round></rounds></package>`);

describe("объём пака: точно", () => {
  it("текст, совпавший с именем файла, файл не «использует»", () => {
    const pkg = pack2(`<item>a.png</item>`);
    expect(unusedMedia(pkg, [{ folder: "Images", name: "a.png", size: 1 }])).toHaveLength(1);
  });

  it("переименование — только в своей папке; логотип — только для Images", () => {
    const pkg = pack2(`<item type="image" isRef="True">x.png</item><item type="audio" isRef="True">x.png</item>`, "x.png");
    expect(renameMediaEverywhere(pkg, "Audio", "x.png", "y.png")).toBe(1);
    const out = buildContentXml(pkg);
    expect(out).toContain(`<item type="image" isRef="True">x.png</item><item type="audio" isRef="True">y.png</item>`);
    expect(out).toContain(`logo="@x.png"`);
  });

  it("советов нет — «пак уже аккуратный»", () => {
    expect(sizeTips([{ folder: "Images", name: "a", size: 700 * 1024 }, { folder: "Audio", name: "b", size: 3 * MB }], [])).toEqual(["Пак уже аккуратный: лишнего нет, тяжёлых файлов мало."]);
    expect(sizeTips([], [])).toEqual(["Пак уже аккуратный: лишнего нет, тяжёлых файлов мало."]);
  });

  it("все советы — текстом целиком и по порогам (ровно порог — ещё не совет)", () => {
    const media = [
      { folder: "Video", name: "v", size: 41 * MB },
      { folder: "Images", name: "i1", size: 700 * 1024 + 1 },
      { folder: "Images", name: "i2", size: 700 * 1024 },
      { folder: "Audio", name: "a1", size: 3 * MB + 1 },
      { folder: "Audio", name: "a2", size: 3 * MB },
      { folder: "Html", name: "h", size: 700 * 1024 + 1 },
      { folder: "Images", name: "u", size: 59 * MB - (700 * 1024 * 2 + 1) - (6 * MB + 1) - (700 * 1024 + 1) },
    ];
    expect(sizeTips(media, [{ folder: "Images", name: "u", size: MB / 2 }, { folder: "Audio", name: "x", size: MB }])).toEqual([
      "Без дела лежит 2 файл(ов) на 1.5 МБ — их можно убрать из пака (копии останутся в source/).",
      "Видео — 41 % пака. 720p вместо 1080p обычно легче втрое, а в вопросе нужен только кусок ролика: обрежьте до нужных секунд.",
      "2 картинок тяжелее 700 КБ. На экране SIGame хватает 1920 px по большей стороне и JPEG 85 %.",
      "1 звуков тяжелее 3 МБ: для вопроса хватает 20–30 секунд в MP3 128 кбит/с.",
    ]);
  });

  it("видео ровно 40 % — ещё не совет", () => {
    expect(sizeTips([{ folder: "Video", name: "v", size: 40 }, { folder: "Images", name: "i", size: 60 }], [])).toEqual(["Пак уже аккуратный: лишнего нет, тяжёлых файлов мало."]);
    expect(sizeTips([{ folder: "Video", name: "v", size: 41 }, { folder: "Images", name: "i", size: 59 }], [])[0]).toMatch(/^Видео — 41 % пака\./);
  });

  it("mb: байты в мегабайты", () => {
    expect(mb(3 * MB)).toBe(3);
  });
});

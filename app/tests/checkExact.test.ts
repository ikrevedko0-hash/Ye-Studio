// Точные проверки «Автопроверки пака» (core/siq/check.ts): полный список бед целиком, пороги — ровно на
// границе и на байт выше. Написаны по выжившим мутантам Stryker: прежние тесты проверяли только «есть
// такая строка», и порча порогов, текстов и порядка проходила незамеченной.

import { describe, expect, it } from "vitest";
import { checkPack, LIMITS, type CheckIssue } from "../src/core/siq/check";
import { parseContentXml } from "../src/core/siq/xml";

const MB = 1048576;
const NS = "https://github.com/VladimirKhil/SI/blob/master/assets/siq_5.xsd";

const item = (v: string) => `<item>${v}</item>`;
const img = (v: string) => `<item type="image" isRef="True">${v}</item>`;
const q = (price: number, body: string, answer: string | null, extra = "", type = "") =>
  `<question price="${price}"${type ? ` type="${type}"` : ""}><params><param name="question" type="content">${body}</param>${extra}</params>` +
  `<right>${answer === null ? "" : `<answer>${answer}</answer>`}</right></question>`;
const theme = (name: string, questions: string | null) =>
  `<theme name="${name}">${questions === null ? "" : `<questions>${questions}</questions>`}</theme>`;
const round = (name: string, themes: string | null) => `<round name="${name}">${themes === null ? "" : `<themes>${themes}</themes>`}</round>`;

function pack(rounds: string, { name = "Пак", logo = "@лого.png", authors = "<authors><author>Я</author></authors>" } = {}) {
  return parseContentXml(
    `<?xml version="1.0" encoding="utf-8"?><package name="${name}"${logo === "" ? "" : ` logo="${logo}"`} version="5" xmlns="${NS}">` +
    (authors ? `<info>${authors}</info>` : "") + `<rounds>${rounds}</rounds></package>`,
  );
}
const logo = { folder: "Images", name: "лого.png", size: 1000 };
const one = (body = item("Вопрос"), answer: string | null = "Ответ") => round("Р", theme("Т", q(100, body, answer)));
const texts = (issues: CheckIssue[]) => issues.map((i) => [i.level, i.text]);

describe("автопроверка: точный список", () => {
  it("всё сразу — в порядке ошибки → внимание → советы, внутри уровня — в порядке проверки", () => {
    const p = pack(
      round("", null) +
      round("Р2", theme("", null) + theme("Т", q(100, item(""), null) + q(200, item("Текст"), null) + q(300, item(""), "Ответ") + q(400, img("нет.png"), "Ответ2"))),
      { name: "", authors: "" },
    );
    expect(checkPack(p, [])).toEqual([
      { level: "error", text: "У пака нет названия" },
      { level: "error", text: "Логотип «лого.png» указан, но файла в паке нет" },
      { level: "error", text: "В раунде «Раунд 1» нет тем", at: { round: 0 } },
      { level: "error", text: "Р2 › тема 1: у темы нет названия", at: { round: 1, theme: 0 } },
      { level: "error", text: "Р2 › тема 1: в теме нет вопросов", at: { round: 1, theme: 0 } },
      { level: "error", text: "Р2 › Т · 100: пустой вопрос", at: { round: 1, theme: 1, question: 0 } },
      { level: "error", text: "Р2 › Т · 200: нет ответа", at: { round: 1, theme: 1, question: 1 } },
      { level: "error", text: "Р2 › Т · 300: нет самого вопроса", at: { round: 1, theme: 1, question: 2 } },
      { level: "error", text: "Вопрос ссылается на файл, которого нет в паке: Images/нет.png" },
      { level: "info", text: "Не указаны авторы пака" },
    ]);
  });

  it("чистый пак — пусто", () => {
    expect(checkPack(pack(one()), [logo])).toEqual([]);
  });

  it("название из пробелов — нет названия; есть — нет беды", () => {
    expect(texts(checkPack(pack(one(), { name: "   " }), [logo]))).toEqual([["error", "У пака нет названия"]]);
  });

  it("логотип: не указан — совет, указан и есть — тихо", () => {
    expect(texts(checkPack(pack(one(), { logo: "" }), []))).toEqual([["info", "Нет логотипа пака — на FirePacks и в игре будет пустая карточка"]]);
    expect(checkPack(pack(one()), [logo])).toEqual([]);
  });

  it("авторы: пусто, пробелы — совет; хоть один настоящий — тихо", () => {
    const tip = [["info", "Не указаны авторы пака"]];
    expect(texts(checkPack(pack(one(), { authors: "" }), [logo]))).toEqual(tip);
    expect(texts(checkPack(pack(one(), { authors: "<authors><author>  </author></authors>" }), [logo]))).toEqual(tip);
    expect(checkPack(pack(one(), { authors: "<authors><author> </author><author>Он</author></authors>" }), [logo])).toEqual([]);
    expect(texts(checkPack(pack(one(), { authors: "<comments>x</comments>" }), [logo]))).toEqual(tip);
  });

  it("название ищется по имени атрибута, а не первым; без атрибута — нет названия", () => {
    const p = parseContentXml(`<?xml version="1.0" encoding="utf-8"?><package id="x" name="Пак" logo="@лого.png" version="5" xmlns="${NS}"><info><authors><author>Я</author></authors></info><rounds>${one()}</rounds></package>`);
    expect(checkPack(p, [logo])).toEqual([]);
    const noName = parseContentXml(`<?xml version="1.0" encoding="utf-8"?><package id="Пак" logo="@лого.png" version="5" xmlns="${NS}"><info><authors><author>Я</author></authors></info><rounds>${one()}</rounds></package>`);
    expect(texts(checkPack(noName, [logo]))).toEqual([["error", "У пака нет названия"]]);
  });

  it("пак без раундов вовсе — без падения и без бед раундов", () => {
    const p = parseContentXml(`<?xml version="1.0" encoding="utf-8"?><package name="Пак" logo="@лого.png" version="5" xmlns="${NS}"><info><authors><author>Я</author></authors></info></package>`);
    expect(checkPack(p, [logo])).toEqual([]);
  });

  it("тема из пробелов — без названия", () => {
    expect(texts(checkPack(pack(round("Р", theme("  ", q(1, item("в"), "о")))), [logo]))).toEqual([["error", "Р ›   : у темы нет названия"]]);
  });

  it("черновик: есть ли вопрос — по любому непустому элементу, пробелы не считаются", () => {
    const partly = pack(round("Р", theme("Т", q(1, item("") + item("текст"), null))));
    expect(texts(checkPack(partly, [logo]))).toEqual([["error", "Р › Т · 1: нет ответа"]]);
    const blank = pack(round("Р", theme("Т", q(1, item("   "), "ответ"))));
    expect(texts(checkPack(blank, [logo]))).toEqual([["error", "Р › Т · 1: нет самого вопроса"]]);
  });

  it("файл по ссылке есть — не жалуемся", () => {
    const p = pack(round("Р", theme("Т", q(1, img("кадр.png"), "о"))));
    expect(checkPack(p, [logo, { folder: "Images", name: "кадр.png", size: 10 }])).toEqual([]);
  });

  it("имена раундов и тем по умолчанию — по номеру", () => {
    const p = pack(round("A", theme("x", q(1, item("в"), "о"))) + round("", theme("", q(5, item(""), null))));
    const at = checkPack(p, [logo]).map((i) => i.text);
    expect(at).toContain("Раунд 2 › тема 1: у темы нет названия");
    expect(at).toContain("Раунд 2 › тема 1 · 5: пустой вопрос");
  });
});

describe("автопроверка: объём", () => {
  const sized = (mb: number, extraBytes = 0) => [logo, { folder: "Video", name: "v.mp4", size: mb * MB + extraBytes - logo.size }];
  const used = (name: string) => `<item type="video" isRef="True">${name}</item>`;
  const p = pack(round("Р", theme("Т", q(100, used("v.mp4"), "О"))));
  const sizeIssues = (m: ReturnType<typeof sized>) => texts(checkPack(p, m)).filter(([, t]) => t.startsWith("Пак весит"));

  it("ровно на порогах — ещё можно, байт сверху — беда", () => {
    expect(sizeIssues(sized(LIMITS.siBrowserMb))).toEqual([]);
    expect(sizeIssues(sized(LIMITS.siBrowserMb, 1))).toEqual([["warn", "Пак весит 100 МБ — SIBrowser и FirePacks принимают до 100 МБ"]]);
    expect(sizeIssues(sized(LIMITS.gameMb))).toEqual([["warn", "Пак весит 150 МБ — SIBrowser и FirePacks принимают до 100 МБ"]]);
    expect(sizeIssues(sized(LIMITS.gameMb, 1))).toEqual([["error", "Пак весит 150 МБ — сервер SIGame берёт около 150 МБ, SIBrowser — 100 МБ"]]);
  });

  it("тяжёлые файлы — по своей папке и своему порогу, ровно порог — не тяжёлый", () => {
    const L = LIMITS;
    const media = [
      logo,
      { folder: "Images", name: "a.png", size: L.heavyImageMb * MB },
      { folder: "Images", name: "b.png", size: L.heavyImageMb * MB + 1 },
      { folder: "Audio", name: "c.mp3", size: L.heavyAudioMb * MB },
      { folder: "Audio", name: "d.mp3", size: L.heavyAudioMb * MB + 1 },
      { folder: "Video", name: "e.mp4", size: L.heavyVideoMb * MB },
      { folder: "Video", name: "f.mp4", size: L.heavyVideoMb * MB + 1 },
      // картинка с весом «тяжёлого звука» в папке звука — не тяжёлая
      { folder: "Audio", name: "g.png", size: L.heavyImageMb * MB + 1 },
    ];
    const refs = media.slice(1).map((m) => `<item type="${m.folder === "Images" ? "image" : m.folder === "Audio" ? "audio" : "video"}" isRef="True">${m.name}</item>`).join("");
    const heavy = texts(checkPack(pack(round("Р", theme("Т", q(100, refs, "О")))), media)).filter(([, t]) => t.startsWith("Тяжёлые"));
    expect(heavy).toEqual([
      ["info", "Тяжёлые файлы в Images (больше 1 МБ): b.png"],
      ["info", "Тяжёлые файлы в Audio (больше 3 МБ): d.mp3"],
      ["info", "Тяжёлые файлы в Video (больше 15 МБ): f.mp4"],
    ]);
  });

  it("тяжёлых больше четырёх — первые четыре и «и ещё»", () => {
    const names = ["1", "2", "3", "4", "5", "6"].map((n) => `${n}.png`);
    const media = [logo, ...names.map((name) => ({ folder: "Images", name, size: 2 * MB }))];
    const refs = names.map(img).join("");
    const heavy = checkPack(pack(round("Р", theme("Т", q(100, refs, "О")))), media).find((i) => i.text.startsWith("Тяжёлые"));
    expect(heavy?.text).toBe("Тяжёлые файлы в Images (больше 1 МБ): 1.png, 2.png, 3.png, 4.png и ещё 2");
    const four = [logo, ...names.slice(0, 4).map((name) => ({ folder: "Images", name, size: 2 * MB }))];
    expect(checkPack(pack(round("Р", theme("Т", q(100, refs, "О")))), four).find((i) => i.text.startsWith("Тяжёлые"))?.text)
      .toBe("Тяжёлые файлы в Images (больше 1 МБ): 1.png, 2.png, 3.png, 4.png");
  });

  it("неиспользуемые файлы: число и сумма", () => {
    const media = [logo, { folder: "Images", name: "x.png", size: MB / 2 }, { folder: "Audio", name: "y.mp3", size: MB }];
    expect(texts(checkPack(pack(one()), media))).toEqual([["info", "Без дела лежит файлов: 2 (1.5 МБ) — убрать можно в «Объёме пака»"]]);
  });
});

describe("автопроверка: спецвопросы и повторы", () => {
  const withSpecials = (n: number, of = 20) =>
    pack(round("Р", theme("Т", Array.from({ length: of }, (_, i) => q(i + 1, item(`в${i}`), `о${i}`, "", i < n ? "secret" : i === n ? "simple" : "")).join(""))));
  const share = (n: number) => texts(checkPack(withSpecials(n), [logo])).filter(([, t]) => t.startsWith("Спецвопросов"));

  it("доля спецвопросов: 5% — тихо, больше — жёлтая, 15% — всё ещё жёлтая, больше — красная", () => {
    expect(share(0)).toEqual([]);
    expect(share(1)).toEqual([]);
    expect(share(2)).toEqual([["info", "Спецвопросов 10% — FirePacks повесит жёлтую плашку (больше 5%)"]]);
    expect(share(3)).toEqual([["info", "Спецвопросов 15% — FirePacks повесит жёлтую плашку (больше 5%)"]]);
    expect(share(4)).toEqual([["warn", "Спецвопросов 20% — FirePacks повесит красную плашку (больше 15%)"]]);
  });

  it("type=\"simple\" — не спецвопрос", () => {
    const p = pack(round("Р", theme("Т", q(1, item("а"), "1", "", "simple") + q(2, item("б"), "2"))));
    expect(checkPack(p, [logo])).toEqual([]);
  });

  it("одинаковые ответы: сравнение без регистра, ё и знаков; место — второй вопрос; счёт — все", () => {
    const p = pack(round("Р", theme("Т", q(1, item("а"), "Ё-моё!") + q(2, item("б"), "е МОЕ") + q(3, item("в"), "(ё) моё") + q(4, item("г"), "другое"))));
    expect(checkPack(p, [logo])).toEqual([{ level: "warn", text: "Один и тот же ответ «е мое» в 3 вопросах", at: { round: 0, theme: 0, question: 1 } }]);
  });

  it("варианты ответа и точка на картинке не считаются повторами", () => {
    const opts = `<param name="answerType">select</param><param name="answerOptions" type="group"><param name="A" type="content"><item>x</item></param></param>`;
    const point = `<param name="answerType">point</param>`;
    const p = pack(round("Р", theme("Т",
      q(1, item("а"), "A", opts) + q(2, item("б"), "A", opts) +
      q(3, img("лого.png"), "0.5,0.5", point) + q(4, img("лого.png"), "0.5,0.5", point))));
    expect(checkPack(p, [logo]).filter((i) => i.text.startsWith("Один и тот же"))).toEqual([]);
  });

  it("пустой правильный ответ не повтор", () => {
    const p = pack(round("Р", theme("Т", q(1, item("а"), "  ") + q(2, item("б"), "!!"))));
    expect(checkPack(p, [logo]).filter((i) => i.text.startsWith("Один и тот же"))).toEqual([]);
  });

  it("ссылка на один и тот же отсутствующий файл — одна строка", () => {
    const p = pack(round("Р", theme("Т", q(1, img("нет.png"), "1") + q(2, img("нет.png"), "2"))));
    expect(texts(checkPack(p, [logo]))).toEqual([["error", "Вопрос ссылается на файл, которого нет в паке: Images/нет.png"]]);
  });
});

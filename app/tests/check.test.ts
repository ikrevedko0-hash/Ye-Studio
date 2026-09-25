import { describe, expect, it } from "vitest";
import { checkPack } from "../src/core/siq/check";
import { parseContentXml } from "../src/core/siq/xml";

const q = (price: number, body: string, answer: string, type = "") =>
  `<question price="${price}"${type ? ` type="${type}"` : ""}><params><param name="question" type="content">${body}</param></params><right><answer>${answer}</answer></right></question>`;

const pack = (questions: string, attrs = 'name="Пак" logo="@лого.png"') =>
  parseContentXml(
    `<?xml version="1.0" encoding="utf-8"?><package ${attrs} version="5" xmlns="https://github.com/VladimirKhil/SI/blob/master/assets/siq_5.xsd">` +
    `<info><authors><author>Я</author></authors></info>` +
    `<rounds><round name="Р1"><themes><theme name="Кино"><questions>${questions}</questions></theme></themes></round></rounds></package>`,
  );

const logo = { folder: "Images", name: "лого.png", size: 1000 };

describe("проверка перед публикацией", () => {
  it("чистый пак — без ошибок", () => {
    const issues = checkPack(pack(q(100, "<item>Вопрос</item>", "Ответ") + q(200, "<item>Ещё</item>", "Другой")), [logo]);
    expect(issues.filter((i) => i.level !== "info")).toEqual([]);
  });

  it("пустой, без ответа, нет файла, одинаковые ответы — с местом", () => {
    const issues = checkPack(pack(
      q(100, "<item></item>", "") +
      q(200, "<item>Текст</item>", "") +
      q(300, '<item type="image" isRef="True">нет.png</item>', "Титаник") +
      q(400, "<item>Про корабль</item>", "ТИТАНИК!"),
    ), [logo]);
    const texts = issues.map((i) => i.text);
    expect(texts.some((t) => t.includes("100: пустой вопрос"))).toBe(true);
    expect(texts.some((t) => t.includes("200: нет ответа"))).toBe(true);
    expect(texts.some((t) => t.includes("Images/нет.png"))).toBe(true);
    const dup = issues.find((i) => i.text.includes("«титаник»"));
    expect(dup?.at).toEqual({ round: 0, theme: 0, question: 3 });
    expect(issues[0].level).toBe("error");
  });

  it("объём и спецвопросы — по порогам", () => {
    const big = { folder: "Video", name: "v.mp4", size: 120 * 1048576 };
    const issues = checkPack(pack(q(100, "<item>В</item>", "О", "secret") + q(200, "<item>В2</item>", "О2")), [logo, big]);
    expect(issues.some((i) => i.level === "warn" && i.text.includes("120 МБ"))).toBe(true);
    expect(issues.some((i) => i.text.includes("Спецвопросов 50%"))).toBe(true);
  });

  it("нет названия и логотипа", () => {
    const issues = checkPack(pack(q(100, "<item>В</item>", "О"), 'name=""'), []);
    expect(issues.some((i) => i.level === "error" && i.text.includes("нет названия"))).toBe(true);
    expect(issues.some((i) => i.text.includes("Нет логотипа"))).toBe(true);
  });
});

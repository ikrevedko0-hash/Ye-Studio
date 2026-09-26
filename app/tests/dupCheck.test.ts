import { describe, expect, it } from "vitest";
import { dupQuestions, toReport, type ServerCheck } from "../src/core/siq/dupCheck";
import { parseContentXml } from "../src/core/siq/xml";

const q = (price: number, body: string, answers: string[]) =>
  `<question price="${price}"><params><param name="question" type="content">${body}</param></params>` +
  `<right>${answers.map((a) => `<answer>${a}</answer>`).join("")}</right></question>`;

const pack = (questions: string) =>
  parseContentXml(
    `<?xml version="1.0" encoding="utf-8"?><package name="Пак" version="5" xmlns="https://github.com/VladimirKhil/SI/blob/master/assets/siq_5.xsd">` +
    `<rounds><round name="Р1"><themes><theme name="Звери"><questions>${questions}</questions></theme></themes></round></rounds></package>`,
  );

describe("повторы на FirePacks", () => {
  it("вопросы для сервера: текст, ответы, файлы вопроса; пустые клетки пропускаются", () => {
    const qs = dupQuestions(pack(
      q(100, "<item>Кто несёт яйца?</item><item type=\"image\" isRef=\"True\">ехидна.jpg</item>", ["Ехидна", " ехидны "]) +
      q(200, "<item></item>", []) +
      q(300, "<item type=\"image\">https://example.com/x.jpg</item>", ["Утконос"]),
    ));
    expect(qs).toHaveLength(2);
    expect(qs[0]).toEqual({
      at: { round: 0, theme: 0, question: 0 }, label: "Звери / 100",
      text: "Кто несёт яйца?", answers: ["Ехидна", "ехидны"], refs: [{ folder: "Images", name: "ехидна.jpg" }],
    });
    expect(qs[1].refs).toEqual([]);                  // внешняя ссылка — не файл пака
    expect(qs[1].at.question).toBe(2);
  });

  it("ответ сервера → отчёт: места, ссылки, похожие паки, красное раньше оранжевого", () => {
    const qs = dupQuestions(pack(q(100, "<item>А</item>", ["Ехидна"]) + q(200, "<item>Б</item>", ["Утконос"])));
    const res: ServerCheck = {
      results: [
        { i: 1, kind: "answer", total: 1, where: [{ pack: 7, tq: 0, price: 300 }] },
        { i: 0, kind: "exact", total: 4, where: [{ pack: 5, tq: 1002, price: 100 }] },
      ],
      packs: { "5": { name: "Ранний", url: "https://firepacks.net/pack/5", date: 1000, authors: "" },
        "7": { name: "Другой", url: "https://firepacks.net/pack/7", date: 2000, authors: "" } },
      themes: { "5:1": ["Раунд 1", "Звери"], "7:0": ["1", "Разное"] },
      summary: [{ pack: 5, exact: 3, media: 0, answer: 0 }, { pack: 7, exact: 0, media: 0, answer: 1 }],
      index: { builtAt: "2026-09-26T10:00:00", packs: 10600, questions: 1300000 },
    };
    const rep = toReport(qs, res, 42);
    expect(rep.hits.map((h) => h.kind)).toEqual(["exact", "answer"]);
    expect(rep.hits[0]).toMatchObject({ label: "Звери / 100", answer: "Ехидна", total: 4, at: { question: 0 } });
    expect(rep.hits[0].where[0]).toEqual({ pack: 5, name: "Ранний", url: "https://firepacks.net/pack/5",
      round: "Раунд 1", theme: "Звери", price: 100, date: 1000 });
    expect(rep.similar).toEqual([{ pack: 5, name: "Ранний", url: "https://firepacks.net/pack/5", count: 3 }]);
    expect(rep).toMatchObject({ checkedAt: 42, checked: 2, base: { packs: 10600 } });
  });
});

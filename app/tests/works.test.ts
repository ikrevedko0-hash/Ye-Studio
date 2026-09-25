import { describe, expect, it } from "vitest";
import { isWork, parseEntity, parseSearch, trimPlot, workContext, workLabel, workYear } from "../src/core/ai/works";

describe("isWork", () => {
  it("пропускает фильмы, мультфильмы, сериалы и книги", () => {
    for (const d of [
      "фильм 2019 года режиссёра Ари Астера",
      "2007 film by Daniel Myrick",
      "мультфильм Юрия Норштейна (1975)",
      "роман русского писателя Михаила Булгакова",
      "американский мини-сериал 1997 года",
      "2001 animated film by Studio Ghibli",
      "children's book by Sergei Kozlov",
    ]) expect(isWork(d), d).toBe(true);
  });

  it("отсеивает явления, людей, персонажей и страницы значений", () => {
    for (const d of [
      "момент прохождения Солнцем точки максимального удаления",
      "commune in Isère, France",
      "страница значений в проекте Викимедиа",
      "персонаж мультфильма «Шрек»",
      "American film director",
      "американский кинорежиссёр",
      "Soviet film studio",
      "кинофестиваль в Каннах",
    ]) expect(isWork(d), d).toBe(false);
  });
});

describe("parseSearch", () => {
  it("оставляет произведения и убирает повторы", () => {
    const hits = parseSearch({
      search: [
        { id: "Q123524", label: "солнцестояние", description: "момент прохождения Солнцем точки максимального удаления" },
        { id: "Q55907451", label: "Солнцестояние", description: "фильм 2019 года режиссёра Ари Астера" },
        { id: "Q55907451", label: "Солнцестояние", description: "фильм 2019 года режиссёра Ари Астера" },
        { id: "Q1", label: "Без описания" },
      ],
    });
    expect(hits).toEqual([{ id: "Q55907451", title: "Солнцестояние", about: "фильм 2019 года режиссёра Ари Астера" }]);
  });
});

describe("карточка произведения", () => {
  const entity = {
    labels: { ru: { value: "Солнцестояние" }, en: { value: "Midsommar" } },
    descriptions: { en: { value: "2019 film directed by Ari Aster" } },
    claims: {
      P1476: [{ mainsnak: { datavalue: { value: { text: "Midsommar", language: "en" } } } }],
      P577: [
        { mainsnak: { datavalue: { value: { time: "+2019-07-03T00:00:00Z" } } } },
        { mainsnak: { datavalue: { value: { time: "+2019-06-24T00:00:00Z" } } } },
      ],
    },
  };

  it("берёт оригинальное название и самый ранний год", () => {
    const d = parseEntity("Q55907451", entity);
    expect(d).toMatchObject({ title: "Солнцестояние", original: "Midsommar", year: 2019, aboutEn: "2019 film directed by Ari Aster" });
    expect(workLabel(d)).toBe("Midsommar (2019)");
    expect(workContext({ ...d, plot: "A couple travels to Sweden." })).toContain("Summary: A couple travels to Sweden.");
  });

  it("у книги без даты выхода берёт дату создания", () => {
    expect(workYear({ claims: { P571: [{ mainsnak: { datavalue: { value: { time: "+1928-00-00T00:00:00Z" } } } }] } })).toBe(1928);
    expect(workYear({})).toBeUndefined();
  });
});

describe("trimPlot", () => {
  it("режет длинный текст по концу предложения", () => {
    const text = "Первое предложение про сюжет. ".repeat(40);
    const t = trimPlot(text, 100);
    expect(t.length).toBeLessThanOrEqual(100);
    expect(t.endsWith(".")).toBe(true);
  });

  it("короткий текст не трогает", () => {
    expect(trimPlot("  Коротко.  ")).toBe("Коротко.");
  });
});

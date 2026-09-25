import { describe, expect, it } from "vitest";
import { decorateThemeName, hasEmoji, themeEmojiPair, themeNameParts } from "../src/core/siq/themeEmoji";

describe("эмодзи в названиях тем", () => {
  it("подбирает по смыслу, пара разная, перед и после", () => {
    const [a, b] = themeEmojiPair("Кино девяностых");
    expect(["🎬", "🍿", "🎥", "🎞️"]).toContain(a);
    expect(["🎬", "🍿", "🎥", "🎞️"]).toContain(b);
    expect(a).not.toBe(b);
    expect(decorateThemeName("Кино девяностых")).toBe(`${a} Кино девяностых ${b}`);
  });

  it("реальные темы Уе!паков", () => {
    expect(["💊", "🩺", "🏥", "🤒", "👴", "👵", "🧓", "🍵"]).toContain(themeEmojiPair("Дед опять перепутал таблетки")[0]);
    expect(["🐾", "🐱", "🐶", "🦊", "🐼"]).toContain(themeEmojiPair("Детеныши")[0]);
    expect(["🖼️", "📸", "🔍", "🟪", "🌈", "🎨", "🟣", "🟡"]).toContain(themeEmojiPair("Название цвета")[0]);
    expect(["⏰", "⌛", "🕰️", "📅"]).toContain(themeEmojiPair("Который час?")[0]);
  });

  it("одно название — всегда одна пара; не узнали — весёлая пара", () => {
    expect(themeEmojiPair("Абырвалг")).toEqual(themeEmojiPair("Абырвалг"));
    expect(hasEmoji(decorateThemeName("Абырвалг"))).toBe(true);
  });

  it("уже с эмодзи и пустые не трогаем", () => {
    expect(decorateThemeName("🎯 РазминОчка")).toBe("🎯 РазминОчка");
    expect(decorateThemeName("  ")).toBe("  ");
  });
});

describe("показ названия темы", () => {
  it("эмодзи отдельно, пробелы рядом с ними неразрывные", () => {
    expect(themeNameParts("🎸 Музыкальные инструменты 🎶")).toEqual([
      { emoji: true, text: "🎸" },
      { emoji: false, text: "\u00A0Музыкальные инструменты\u00A0" },
      { emoji: true, text: "🎶" },
    ]);
  });

  it("склейки и вариационный селектор — одним куском, без эмодзи — как есть", () => {
    expect(themeNameParts("🏛️ История 👨‍👩‍👧").filter((p) => p.emoji).map((p) => p.text)).toEqual(["🏛️", "👨‍👩‍👧"]);
    expect(themeNameParts("Просто тема")).toEqual([{ emoji: false, text: "Просто тема" }]);
  });
});

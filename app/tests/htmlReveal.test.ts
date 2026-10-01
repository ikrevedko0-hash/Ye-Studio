// «Живая пикселизация»: HTML-вопрос самодостаточен и не ходит в сеть.

import { describe, expect, it } from "vitest";
import { buildPixelRevealHtml, liveRevealBlocks, REVEAL_DEFAULTS } from "../src/core/siq/htmlReveal";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("buildPixelRevealHtml", () => {
  it("картинка внутри, ступени и время — из настроек", () => {
    const html = buildPixelRevealHtml({ image: PNG, seconds: 12, blocks: [3, 8.4, 30] });
    expect(html).toContain(JSON.stringify(PNG));
    expect(html).toContain('{"seconds":12,"blocks":[3,8,30]}');
    expect(html.startsWith("<!doctype html>")).toBe(true);
  });

  it("по умолчанию — 20 секунд и 8 ступеней", () => {
    expect(buildPixelRevealHtml({ image: PNG })).toContain(JSON.stringify(REVEAL_DEFAULTS));
  });

  it("ни одной внешней ссылки: работает без сети", () => {
    const html = buildPixelRevealHtml({ image: PNG, title: "Назовите картину" });
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<(link|iframe)\b|src="(?!data:)/);
  });

  it("подпись экранируется, не картинку не принимает", () => {
    expect(buildPixelRevealHtml({ image: PNG, title: "<b>Кто?</b>" })).toContain("&lt;b&gt;Кто?&lt;/b&gt;");
    expect(() => buildPixelRevealHtml({ image: "https://example.com/a.png" })).toThrow();
    expect(() => buildPixelRevealHtml({ image: 'data:image/png;base64,AAA");alert(1);("' })).toThrow();
  });
});

describe("liveRevealBlocks", () => {
  it("от крупного к 64, по возрастанию, без повторов", () => {
    const s = liveRevealBlocks(4);
    expect(s[0]).toBe(4);
    expect(s[s.length - 1]).toBe(64);
    expect(s.every((v, i) => i === 0 || v > s[i - 1])).toBe(true);
  });
  it("крупнее 64 — всё равно растёт", () => {
    const s = liveRevealBlocks(100);
    expect(s[0]).toBe(100);
    expect(s[s.length - 1]).toBeGreaterThan(100);
  });
});

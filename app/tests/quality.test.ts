import { describe, expect, it } from "vitest";
import { packDate, qualityProblems } from "../src/core/siq/quality";

const MB = 1024 * 1024;

describe("контроль качества SIGame", () => {
  it("ловит тяжёлые файлы и чужие форматы", () => {
    const got = qualityProblems([
      { folder: "Images", name: "a.JPG", size: MB },
      { folder: "Images", name: "b.png", size: MB + 1 },
      { folder: "Images", name: "c.bmp", size: 10 },
      { folder: "Audio", name: "d.mp3", size: 5 * MB },
      { folder: "Audio", name: "e.wav", size: 10 },
      { folder: "Video", name: "f.mp4", size: 11 * MB },
      { folder: "Video", name: "g", size: 10 },
      { folder: "Прочее", name: "h.bin", size: 100 * MB },
    ]);
    expect(got.map((p) => `${p.name}: ${p.why}`)).toEqual([
      "b.png: больше 1 МБ", "c.bmp: формат .bmp", "e.wav: формат .wav", "f.mp4: больше 10 МБ", "g: без расширения",
    ]);
  });

  it("дата как у SIQuester", () => {
    expect(packDate(new Date(2026, 8, 30))).toBe("30.09.2026");
    expect(packDate(new Date(2027, 0, 5))).toBe("05.01.2027");
  });
});

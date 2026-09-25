import { describe, expect, it } from "vitest";
import { blockGrid, blocksForPrices, blockSize, pixelate, revealSteps, uniqueColors, type Raster } from "../src/core/media/pixelate";
import { isMediaUsed, replaceQuestionImage } from "../src/core/siq/helpers";
import { buildContentXml, parseContentXml } from "../src/core/siq/xml";

/** Шумная картинка: у каждого пикселя свой цвет. */
function noise(width: number, height: number): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = (i * 37) % 256; data[i * 4 + 1] = (i * 91) % 256; data[i * 4 + 2] = (i * 13) % 256; data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

const px = (r: Raster, x: number, y: number) => [...r.data.slice((y * r.width + x) * 4, (y * r.width + x) * 4 + 4)];

describe("пикселизация", () => {
  it("цветов не больше, чем блоков, при любом разрешении", () => {
    for (const [w, h, blocks] of [[640, 480, 16], [1000, 700, 32], [333, 999, 8], [50, 30, 128]]) {
      const r = noise(w, h);
      pixelate(r, blocks);
      const g = blockGrid(w, h, blocks);
      expect(uniqueColors(r)).toBeLessThanOrEqual(g.cols * g.rows);
    }
  });

  it("число блоков по ширине не зависит от разрешения", () => {
    expect(blockGrid(640, 480, 16).cols).toBe(16);
    expect(blockGrid(1920, 1080, 16).cols).toBe(16);
    expect(blockSize(1000, 16)).toBe(63);
  });

  it("цвет блока — среднее по пикселям, края без полутонов", () => {
    // блок 2×2: чёрный, белый, чёрный, белый → серый 128 во всех четырёх
    const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
    const r = { data, width: 2, height: 2 };
    pixelate(r, 1 /* прижмётся к минимуму 4 → блок 1 пиксель */);
    expect(px(r, 1, 0)).toEqual([255, 255, 255, 255]);
    const big = { data: new Uint8ClampedArray(8 * 8 * 4), width: 8, height: 8 };
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) big.data.set((x + y) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255], (y * 8 + x) * 4);
    pixelate(big, 4); // блок 2×2
    expect(px(big, 0, 0)).toEqual([128, 128, 128, 255]);
    expect(px(big, 7, 7)).toEqual([128, 128, 128, 255]);
  });

  it("прозрачные пиксели не тянут блок к чёрному", () => {
    const data = new Uint8ClampedArray(8 * 8 * 4);
    for (let i = 0; i < 64; i++) data.set(i % 2 ? [200, 100, 50, 255] : [0, 0, 0, 0], i * 4);
    const r = { data, width: 8, height: 8 };
    pixelate(r, 4);
    expect(px(r, 0, 0).slice(0, 3)).toEqual([200, 100, 50]);
  });

  it("выделение: вне прямоугольника ничего не трогаем", () => {
    const r = noise(100, 100);
    const before = px(r, 5, 5);
    pixelate(r, 10, { x0: 40, y0: 40, x1: 80, y1: 70 });
    expect(px(r, 5, 5)).toEqual(before);
    expect(px(r, 40, 40)).toEqual(px(r, 49, 49));
    expect(px(r, 79, 69)).toEqual(px(r, 79, 60));
    expect(px(r, 80, 69)).not.toEqual(px(r, 79, 69));
  });
});

describe("тема по цене", () => {
  it("7 вопросов: 48 → 8 равномерно", () => {
    expect(blocksForPrices([100, 200, 300, 400, 500, 600, 700])).toEqual([48, 41, 35, 28, 21, 15, 8]);
  });
  it("порядок в теме любой, одинаковые цены — одинаковые блоки", () => {
    expect(blocksForPrices([500, 100, 300, 300])).toEqual([8, 48, 28, 28]);
  });
  it("свои края", () => {
    expect(blocksForPrices([100, 200], 64, 16)).toEqual([64, 16]);
  });
});

describe("проявление", () => {
  it("от крупных к мелким, последний — ещё пиксели", () => {
    const s = revealSteps(8, 4);
    expect(s[0]).toBe(8);
    expect(s).toEqual([...s].sort((a, b) => a - b));
    expect(s[s.length - 1]).toBeLessThanOrEqual(96);
    expect(s.length).toBe(4);
  });
  it("без повторов у мелкого старта", () => {
    const s = revealSteps(96, 4);
    expect(new Set(s).size).toBe(s.length);
  });
});

describe("замена картинки обработанной", () => {
  const xml = (answer: string) =>
    `<?xml version="1.0" encoding="utf-8"?><package name="T" version="5" xmlns="https://github.com/VladimirKhil/SI/blob/master/assets/siq_5.xsd">` +
    `<rounds><round name="R"><themes><theme name="Th"><questions><question price="100"><params>` +
    `<param name="question" type="content"><item type="image" isRef="True" waitForFinish="False">кот.jpg</item><item>Кто это?</item></param>${answer}` +
    `</params><right><answer>кот</answer></right></question></questions></theme></themes></round></rounds></package>`;

  it("ответ пуст — оригинал ложится в ответ, флаг «одновременно» у последней замены", () => {
    const pkg = parseContentXml(xml(""));
    const q = pkg.rounds![0].themes![0].questions![0];
    const r = replaceQuestionImage(q, "кот.jpg", [
      { type: "image", isRef: "True", value: "кот 8.png", duration: "00:00:03" },
      { type: "image", isRef: "True", value: "кот 24.png", duration: "00:00:03" },
    ]);
    expect(r).toEqual({ originalInAnswer: true, replaced: true });
    expect(buildContentXml(pkg)).toContain(
      `<item type="image" isRef="True" duration="00:00:03">кот 8.png</item><item type="image" isRef="True" duration="00:00:03" waitForFinish="False">кот 24.png</item><item>Кто это?</item></param>` +
      `<param name="answer" type="content"><item type="image" isRef="True">кот.jpg</item></param>`,
    );
    expect(isMediaUsed(pkg, "Images", "кот.jpg")).toBe(true);
  });

  it("в ответе уже есть медиа — ответ не трогаем", () => {
    const pkg = parseContentXml(xml(`<param name="answer" type="content"><item type="image" isRef="True">ответ.jpg</item></param>`));
    const q = pkg.rounds![0].themes![0].questions![0];
    expect(replaceQuestionImage(q, "кот.jpg", [{ type: "image", isRef: "True", value: "кот 8.png" }]).originalInAnswer).toBe(false);
    expect(isMediaUsed(pkg, "Images", "кот.jpg")).toBe(false);
  });
});

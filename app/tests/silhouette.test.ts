import { describe, expect, it } from "vitest";
import type { Raster } from "../src/core/media/pixelate";
import { borderColor, hasTransparentBorder, silhouette, silhouetteMask, SILHOUETTE_DEFAULTS } from "../src/core/media/silhouette";

/** Холст w×h, залитый цветом, с прямоугольниками поверх. */
function canvas(w: number, h: number, bg: number[], rects: { x: number; y: number; w: number; h: number; c: number[] }[]): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) data.set(bg, p * 4);
  for (const r of rects) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) data.set(r.c, (y * w + x) * 4);
  return { data, width: w, height: h };
}
const at = (r: Raster, x: number, y: number) => [...r.data.slice((y * r.width + x) * 4, (y * r.width + x) * 4 + 3)];

describe("силуэт", () => {
  // «банка»: красный прямоугольник, внутри белая надпись (дырка цвета фона), рядом пылинка
  const can = () => canvas(100, 80, [250, 250, 250, 255], [
    { x: 30, y: 10, w: 40, h: 60, c: [200, 30, 30, 255] },
    { x: 40, y: 30, w: 20, h: 10, c: [255, 255, 255, 255] },
    { x: 5, y: 5, w: 2, h: 2, c: [10, 10, 10, 255] },
  ]);

  it("фон — медиана рамки", () => {
    expect(borderColor(can())).toEqual([250, 250, 250]);
  });

  it("предмет чёрный, фон белый, надпись внутри залита, пылинка убрана", () => {
    const r = can();
    const { share } = silhouette(r);
    expect(at(r, 50, 50)).toEqual([0, 0, 0]);
    expect(at(r, 50, 35)).toEqual([0, 0, 0]); // белая надпись внутри банки
    expect(at(r, 10, 40)).toEqual([255, 255, 255]);
    expect(at(r, 5, 5)).toEqual([255, 255, 255]); // пылинка
    expect(share).toBeCloseTo((40 * 60) / (100 * 80), 5);
  });

  it("без чистки пылинка остаётся", () => {
    const m = silhouetteMask(can(), { tolerance: 40, minPart: 0 });
    expect(m[5 * 100 + 5]).toBe(1);
  });

  it("предмет у самого края кадра не теряется", () => {
    const r = canvas(60, 60, [255, 255, 255, 255], [{ x: 20, y: 20, w: 20, h: 40, c: [30, 60, 200, 255] }]);
    silhouette(r);
    expect(at(r, 30, 59)).toEqual([0, 0, 0]);
    expect(at(r, 5, 59)).toEqual([255, 255, 255]);
  });

  it("допуск: слабый градиент фона уходит в фон при большем допуске", () => {
    const r = canvas(60, 60, [240, 240, 240, 255], [{ x: 0, y: 0, w: 60, h: 20, c: [205, 205, 205, 255] }, { x: 25, y: 30, w: 10, h: 10, c: [0, 0, 0, 255] }]);
    expect(silhouetteMask(r, { tolerance: 10, minPart: 0 })[5 * 60 + 5]).toBe(1);
    expect(silhouetteMask(r, { tolerance: 40, minPart: 0 })[5 * 60 + 5]).toBe(0);
  });

  it("выпуклая форма: выемка, открытая к фону (белая грань коробки), заливается", () => {
    // «П»: две ножки и перекладина, между ножками — фон, связанный с краем
    const u = () => canvas(60, 60, [255, 255, 255, 255], [
      { x: 10, y: 10, w: 40, h: 10, c: [20, 20, 20, 255] },
      { x: 10, y: 20, w: 10, h: 30, c: [20, 20, 20, 255] },
      { x: 40, y: 20, w: 10, h: 30, c: [20, 20, 20, 255] },
    ]);
    expect(silhouetteMask(u(), { tolerance: 40, minPart: 0 })[35 * 60 + 30]).toBe(0);
    const m = silhouetteMask(u(), { tolerance: 40, minPart: 0, convex: true });
    expect(m[35 * 60 + 30]).toBe(1);
    expect(m[5 * 60 + 30]).toBe(0);
    // прямоугольник от выпуклой заливки не меняется ни на пиксель
    const box = canvas(40, 40, [255, 255, 255, 255], [{ x: 7, y: 9, w: 20, h: 15, c: [0, 90, 0, 255] }]);
    const sum = (a: Uint8Array) => a.reduce((s, v) => s + v, 0);
    expect(sum(silhouetteMask(box, { tolerance: 40, minPart: 0, convex: true }))).toBe(20 * 15);
  });

  it("PNG без фона: предмет — непрозрачная часть", () => {
    const r = canvas(40, 40, [0, 0, 0, 0], [{ x: 10, y: 10, w: 20, h: 20, c: [255, 255, 255, 255] }]);
    expect(hasTransparentBorder(r)).toBe(true);
    silhouette(r, { ...SILHOUETTE_DEFAULTS, ink: [0, 0, 0], paper: [255, 255, 255] });
    expect(at(r, 20, 20)).toEqual([0, 0, 0]); // белый предмет стал чёрным
    expect(at(r, 2, 2)).toEqual([255, 255, 255]);
  });
});

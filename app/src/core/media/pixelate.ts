// Пикселизация для тем «Картина по пикселям». Чистые функции над RGBA-массивом: работают и в окне
// (ImageData из canvas), и в тестах под Node.
//
// Размер пикселя задаётся ЧИСЛОМ БЛОКОВ ПО ШИРИНЕ, а не пикселями: тогда картинки разного разрешения
// выглядят одинаково крупно. Блок квадратный, его цвет — среднее по всем пикселям блока (с учётом
// прозрачности), края жёсткие: каждый пиксель блока получает ровно этот цвет.

export interface Raster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Прямоугольник в пикселях: [x0, x1) × [y0, y1). */
export interface PxRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const PIXEL_BLOCKS = { min: 4, max: 128 };

export const PIXEL_PRESETS: { label: string; blocks: number }[] = [
  { label: "Легко", blocks: 64 },
  { label: "Средне", blocks: 32 },
  { label: "Сложно", blocks: 16 },
  { label: "Очень сложно", blocks: 8 },
];

/** Края раскладки темы по цене: самая дешёвая — мелкие пиксели, самая дорогая — крупные. */
export const THEME_BLOCKS = { cheap: 48, dear: 8 };

export const clampBlocks = (n: number) => Math.max(PIXEL_BLOCKS.min, Math.min(PIXEL_BLOCKS.max, Math.round(n) || PIXEL_BLOCKS.min));

/** Сторона квадратного блока в пикселях для заданного числа блоков по ширине. */
export function blockSize(width: number, blocks: number): number {
  return Math.max(1, Math.round(width / clampBlocks(blocks)));
}

/** Сколько блоков выйдет по ширине и высоте (последний ряд может быть неполным). */
export function blockGrid(width: number, height: number, blocks: number): { cols: number; rows: number; size: number } {
  const size = blockSize(width, blocks);
  return { cols: Math.ceil(width / size), rows: Math.ceil(height / size), size };
}

/**
 * Пикселизует растр на месте. region — только этот прямоугольник (спрятать лицо или надпись),
 * сетка тогда начинается от его угла, а размер блока всё равно считается от ширины ВСЕЙ картинки,
 * чтобы выделение выглядело так же крупно, как весь кадр с тем же числом.
 */
export function pixelate(r: Raster, blocks: number, region?: PxRect): void {
  const { data, width, height } = r;
  const size = blockSize(width, blocks);
  const x0 = Math.max(0, Math.floor(region?.x0 ?? 0)), y0 = Math.max(0, Math.floor(region?.y0 ?? 0));
  const x1 = Math.min(width, Math.ceil(region?.x1 ?? width)), y1 = Math.min(height, Math.ceil(region?.y1 ?? height));
  for (let by = y0; by < y1; by += size) {
    const ey = Math.min(by + size, y1);
    for (let bx = x0; bx < x1; bx += size) {
      const ex = Math.min(bx + size, x1);
      // цвет усредняем с весом прозрачности, иначе прозрачные пиксели тянули бы блок к чёрному
      let sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
      for (let y = by; y < ey; y++) {
        let i = (y * width + bx) * 4;
        for (let x = bx; x < ex; x++, i += 4) {
          const a = data[i + 3];
          sr += data[i] * a; sg += data[i + 1] * a; sb += data[i + 2] * a; sa += a; n++;
        }
      }
      const cr = sa ? Math.round(sr / sa) : 0, cg = sa ? Math.round(sg / sa) : 0, cb = sa ? Math.round(sb / sa) : 0;
      const ca = Math.round(sa / n);
      for (let y = by; y < ey; y++) {
        let i = (y * width + bx) * 4;
        for (let x = bx; x < ex; x++, i += 4) { data[i] = cr; data[i + 1] = cg; data[i + 2] = cb; data[i + 3] = ca; }
      }
    }
  }
}

/** Сколько разных цветов (RGBA) в растре — самопроверка: после пикселизации их не больше, чем блоков. */
export function uniqueColors(r: Raster): number {
  const seen = new Set<number>();
  const v = new Uint32Array(r.data.buffer, r.data.byteOffset, r.data.byteLength / 4);
  for (let i = 0; i < v.length; i++) seen.add(v[i]);
  return seen.size;
}

/**
 * Число блоков для каждого вопроса темы по его цене. Цены раскладываются равномерно по рангу
 * (одинаковые цены — одинаковые блоки): самая дешёвая — cheap, самая дорогая — dear.
 */
export function blocksForPrices(prices: number[], cheap: number = THEME_BLOCKS.cheap, dear: number = THEME_BLOCKS.dear): number[] {
  const distinct = [...new Set(prices)].sort((a, b) => a - b);
  const k = distinct.length;
  return prices.map((p) => {
    if (k < 2) return clampBlocks(dear);
    const t = distinct.indexOf(p) / (k - 1);
    return clampBlocks(cheap + (dear - cheap) * t);
  });
}

/**
 * Шаги проявления: от крупных пикселей к мелким. Первый — start, последний — всё ещё пиксели
 * (не больше 96 блоков, чтобы картинка не выдала себя раньше ответа). Шаги идут геометрически:
 * глазу разница 8→16 так же заметна, как 32→64. Повторы выкидываем.
 */
export function revealSteps(start: number, steps: number): number[] {
  const first = clampBlocks(start);
  const n = Math.max(2, Math.min(6, Math.round(steps)));
  const last = Math.max(first, Math.min(96, Math.max(first * 4, 48)));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = clampBlocks(first * Math.pow(last / first, i / (n - 1)));
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

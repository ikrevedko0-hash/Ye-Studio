// Отрисовка картинок и коллажей в canvas. Всё происходит в окне: ffmpeg для картинок не нужен,
// а результат сразу виден на экране ровно таким, каким ляжет в пак.
//
// Порядок правок такой же, как у видео: заглушки по ИСХОДНОМУ кадру → поворот и зеркало →
// обрезка → масштаб → пикселизация. Тогда нарисованное мышью совпадает с тем, что получится.
// Пикселизация идёт последней: число блоков считается по ширине ИТОГОВОЙ картинки, а масштаб
// после неё размыл бы жёсткие края блоков.

import { pixelate } from "../../core/media/pixelate";
import { silhouette, SILHOUETTE_DEFAULTS, type SilhouetteOptions } from "../../core/media/silhouette";

export interface Frac {
  /** доли от 0 до 1 относительно своего кадра */
  x: number;
  y: number;
  w: number;
  h: number;
}

export type CoverStyle = "solid" | "blur" | "pixelate";

export interface CoverShape extends Frac {
  style: CoverStyle;
  round: boolean;
  /** цвет сплошной заливки */
  color?: string;
}

export type OutFormat = "jpeg" | "png" | "webp";

export interface ImagePlan {
  covers: CoverShape[];
  rotate: 0 | 90 | 180 | 270;
  flip: boolean;
  /** обрезка в координатах уже повёрнутого кадра */
  crop?: Frac;
  /** ограничение по большей стороне; 0 — как есть */
  maxSide: number;
  format: OutFormat;
  /** 0..1, для jpeg и webp */
  quality: number;
  /** силуэт: предмет чёрным на белом (раньше пикселей — пикселизовать можно и силуэт) */
  silhouette?: SilhouettePlan;
  /** крупные пиксели: весь кадр или выделение (доли кадра без обрезки, как у заглушек) */
  pixel?: PixelPlan;
}

export type SilhouettePlan = Pick<SilhouetteOptions, "tolerance" | "minPart" | "convex">;

/** Копия холста силуэтом. Фон считается по рамке ЭТОГО холста — поэтому силуэт делаем после обрезки. */
export function silhouetteCanvas(src: HTMLCanvasElement, plan: SilhouettePlan): HTMLCanvasElement {
  const out = make(src.width, src.height);
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const image = ctx.getImageData(0, 0, out.width, out.height);
  silhouette(image, { ...SILHOUETTE_DEFAULTS, ...plan });
  ctx.putImageData(image, 0, 0);
  return out;
}

/** Для экрана: кадр без обрезки, где часть под обрезкой — силуэт, посчитанный ровно по ней (как в итоге). */
export function silhouetteInCrop(work: HTMLCanvasElement, plan: SilhouettePlan, crop?: Frac): HTMLCanvasElement {
  if (!crop) return silhouetteCanvas(work, plan);
  const part = silhouetteCanvas(applyCrop(work, crop), plan);
  const out = make(work.width, work.height);
  const ctx = out.getContext("2d")!;
  ctx.drawImage(work, 0, 0);
  ctx.drawImage(part, Math.round(crop.x * work.width), Math.round(crop.y * work.height));
  return out;
}

export interface PixelPlan {
  /** блоков по ширине итоговой картинки */
  blocks: number;
  region?: Frac;
}

/** Копия холста с пикселизацией всего кадра или прямоугольника (доли этого холста). */
export function pixelateCanvas(src: HTMLCanvasElement, blocks: number, region?: Frac): HTMLCanvasElement {
  const out = make(src.width, src.height);
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const image = ctx.getImageData(0, 0, out.width, out.height);
  pixelate(image, blocks, region && {
    x0: region.x * out.width, y0: region.y * out.height,
    x1: (region.x + region.w) * out.width, y1: (region.y + region.h) * out.height,
  });
  ctx.putImageData(image, 0, 0);
  return out;
}

/** Выделение из долей кадра без обрезки — в доли обрезанного кадра; целиком за обрезкой — пусто. */
export function regionInCrop(region: Frac, crop?: Frac): Frac | undefined {
  if (!crop) return region;
  const x0 = Math.max(0, (region.x - crop.x) / crop.w), y0 = Math.max(0, (region.y - crop.y) / crop.h);
  const x1 = Math.min(1, (region.x + region.w - crop.x) / crop.w), y1 = Math.min(1, (region.y + region.h - crop.y) / crop.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : undefined;
}

/**
 * Картинку пака берём байтами через главный процесс: fetch к siq:// из окна не проходит,
 * а рисовать напрямую с чужого origin нельзя — canvas «пачкается» и toDataURL падает.
 */
export async function loadPackImage(folder: string, name: string): Promise<HTMLImageElement> {
  const { type, data } = await window.api.mediaBytes(folder, name);
  const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type }));
  try {
    return await loadImage(url);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

/** Грузит blob:, data: и обычные адреса. */
export async function loadImage(url: string): Promise<HTMLImageElement> {
  const blobUrl = url.startsWith("blob:") || url.startsWith("data:")
    ? url
    : URL.createObjectURL(await (await fetch(url)).blob());
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("не удалось прочитать картинку"));
      img.src = blobUrl;
    });
  } finally {
    if (blobUrl !== url) setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
  }
}

function make(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function pathFor(ctx: CanvasRenderingContext2D, s: Frac, round: boolean, W: number, H: number) {
  const x = s.x * W, y = s.y * H, w = s.w * W, h = s.h * H;
  ctx.beginPath();
  if (round) ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
  else ctx.rect(x, y, w, h);
}

/** Заглушки поверх исходного кадра: заливка, размытие, крупные пиксели. */
export function applyCovers(src: CanvasImageSource, W: number, H: number, covers: CoverShape[]): HTMLCanvasElement {
  const canvas = make(W, H);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(src, 0, 0, W, H);
  for (const s of covers) {
    const w = Math.abs(s.w) * W, h = Math.abs(s.h) * H;
    if (w < 1 || h < 1) continue;
    if (s.style === "solid") {
      ctx.save();
      ctx.fillStyle = s.color ?? "#000000";
      pathFor(ctx, s, s.round, W, H);
      ctx.fill();
      ctx.restore();
      continue;
    }
    // портим копию всего кадра и показываем её только внутри фигуры
    const damaged = make(W, H);
    const dctx = damaged.getContext("2d")!;
    if (s.style === "blur") {
      dctx.filter = `blur(${Math.max(2, Math.round(Math.min(w, h) / 8))}px)`;
      dctx.drawImage(canvas, 0, 0);
      dctx.filter = "none";
    } else {
      const block = Math.max(3, Math.round(Math.min(w, h) / 10));
      const small = make(Math.max(1, W / block), Math.max(1, H / block));
      const sctx = small.getContext("2d")!;
      sctx.drawImage(canvas, 0, 0, small.width, small.height);
      dctx.imageSmoothingEnabled = false;
      dctx.drawImage(small, 0, 0, W, H);
    }
    ctx.save();
    pathFor(ctx, s, s.round, W, H);
    ctx.clip();
    ctx.drawImage(damaged, 0, 0);
    ctx.restore();
  }
  return canvas;
}

/** Поворот по часовой и зеркало. */
export function applyRotate(src: HTMLCanvasElement, rotate: 0 | 90 | 180 | 270, flip: boolean): HTMLCanvasElement {
  if (!rotate && !flip) return src;
  const swap = rotate === 90 || rotate === 270;
  const out = make(swap ? src.height : src.width, swap ? src.width : src.height);
  const ctx = out.getContext("2d")!;
  ctx.save();
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  ctx.restore();
  return out;
}

export function applyCrop(src: HTMLCanvasElement, crop?: Frac): HTMLCanvasElement {
  if (!crop) return src;
  const x = Math.round(crop.x * src.width), y = Math.round(crop.y * src.height);
  const w = Math.round(crop.w * src.width), h = Math.round(crop.h * src.height);
  if (w < 2 || h < 2) return src;
  const out = make(w, h);
  out.getContext("2d")!.drawImage(src, x, y, w, h, 0, 0, w, h);
  return out;
}

export function applyScale(src: HTMLCanvasElement, maxSide: number): HTMLCanvasElement {
  const longest = Math.max(src.width, src.height);
  if (!maxSide || longest <= maxSide) return src;
  const k = maxSide / longest;
  const out = make(src.width * k, src.height * k);
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

export function toCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const c = make(img.naturalWidth, img.naturalHeight);
  c.getContext("2d")!.drawImage(img, 0, 0);
  return c;
}

/**
 * Поворот идёт ПЕРВЫМ: заглушки и обрезку пользователь рисует по тому кадру, который видит на экране,
 * поэтому их доли считаются от уже повёрнутой картинки.
 */
export function renderWorkFrame(img: HTMLImageElement, rotate: 0 | 90 | 180 | 270, flip: boolean, covers: CoverShape[]): HTMLCanvasElement {
  const turned = applyRotate(toCanvas(img), rotate, flip);
  return covers.length ? applyCovers(turned, turned.width, turned.height, covers) : turned;
}

export function renderImage(img: HTMLImageElement, plan: ImagePlan): HTMLCanvasElement {
  const work = renderWorkFrame(img, plan.rotate, plan.flip, plan.covers);
  const scaled = applyScale(applyCrop(work, plan.crop), plan.maxSide);
  const out = plan.silhouette ? silhouetteCanvas(scaled, plan.silhouette) : scaled;
  if (!plan.pixel) return out;
  if (!plan.pixel.region) return pixelateCanvas(out, plan.pixel.blocks);
  const region = regionInCrop(plan.pixel.region, plan.crop);
  return region ? pixelateCanvas(out, plan.pixel.blocks, region) : out;
}

/** Картинка пака целиком в крупных пикселях (для темы по цене и проявления). */
export function pixelateImage(img: HTMLImageElement, blocks: number): HTMLCanvasElement {
  return pixelateCanvas(toCanvas(img), blocks);
}

export const MIME_BY_FORMAT: Record<OutFormat, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

export function exportCanvas(canvas: HTMLCanvasElement, format: OutFormat, quality: number): string {
  // jpeg не умеет прозрачность: подкладываем белое, иначе прозрачные места станут чёрными
  if (format === "jpeg") {
    const flat = make(canvas.width, canvas.height);
    const ctx = flat.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(canvas, 0, 0);
    canvas = flat;
  }
  return canvas.toDataURL(MIME_BY_FORMAT[format], quality);
}

/** Примерный вес результата в байтах — чтобы показать его до сохранения. */
export function dataUrlBytes(dataUrl: string): number {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Math.round((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
}

// ---------- коллаж ----------

export type Point = [number, number];
/** Ячейка шаблона — выпуклый многоугольник в долях холста. Прямоугольник и диагональ описываются одинаково. */
export type Cell = Point[];

export interface Template {
  id: string;
  count: number;
  cells: Cell[];
}

const rect = (x: number, y: number, w: number, h: number): Cell => [
  [x, y], [x + w, y], [x + w, y + h], [x, y + h],
];

/** Сетка cols×rows без остатка — база для 4, 6, 9 и «много картинок». */
export function grid(cols: number, rows: number): Cell[] {
  const cells: Cell[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push(rect(c / cols, r / rows, 1 / cols, 1 / rows));
  return cells;
}

/** Шаблоны раскладки. Порядок такой же, как в списке на экране. */
export const TEMPLATES: Template[] = [
  { id: "2-h", count: 2, cells: [rect(0, 0, 1, 0.5), rect(0, 0.5, 1, 0.5)] },
  { id: "2-v", count: 2, cells: [rect(0, 0, 0.5, 1), rect(0.5, 0, 0.5, 1)] },
  { id: "2-diag", count: 2, cells: [[[0, 0], [1, 0], [0, 1]], [[1, 0], [1, 1], [0, 1]]] },
  { id: "2-diag2", count: 2, cells: [[[0, 0], [1, 1], [0, 1]], [[0, 0], [1, 0], [1, 1]]] },
  { id: "2-wide", count: 2, cells: [rect(0, 0, 0.65, 1), rect(0.65, 0, 0.35, 1)] },
  { id: "2-tall", count: 2, cells: [rect(0, 0, 1, 0.65), rect(0, 0.65, 1, 0.35)] },

  { id: "3-v", count: 3, cells: [rect(0, 0, 1 / 3, 1), rect(1 / 3, 0, 1 / 3, 1), rect(2 / 3, 0, 1 / 3, 1)] },
  { id: "3-h", count: 3, cells: [rect(0, 0, 1, 1 / 3), rect(0, 1 / 3, 1, 1 / 3), rect(0, 2 / 3, 1, 1 / 3)] },
  { id: "3-left", count: 3, cells: [rect(0, 0, 0.5, 1), rect(0.5, 0, 0.5, 0.5), rect(0.5, 0.5, 0.5, 0.5)] },
  { id: "3-top", count: 3, cells: [rect(0, 0, 1, 0.5), rect(0, 0.5, 0.5, 0.5), rect(0.5, 0.5, 0.5, 0.5)] },
  { id: "3-bottom", count: 3, cells: [rect(0, 0, 0.5, 0.5), rect(0.5, 0, 0.5, 0.5), rect(0, 0.5, 1, 0.5)] },
  { id: "3-slant", count: 3, cells: [
    [[0, 0], [0.45, 0], [0.3, 1], [0, 1]],
    [[0.45, 0], [0.8, 0], [0.65, 1], [0.3, 1]],
    [[0.8, 0], [1, 0], [1, 1], [0.65, 1]],
  ] },

  { id: "4-grid", count: 4, cells: grid(2, 2) },
  { id: "4-v", count: 4, cells: grid(4, 1) },
  { id: "4-h", count: 4, cells: grid(1, 4) },
  { id: "4-left", count: 4, cells: [rect(0, 0, 0.5, 1), rect(0.5, 0, 0.5, 1 / 3), rect(0.5, 1 / 3, 0.5, 1 / 3), rect(0.5, 2 / 3, 0.5, 1 / 3)] },
  { id: "4-top", count: 4, cells: [rect(0, 0, 1, 0.5), rect(0, 0.5, 1 / 3, 0.5), rect(1 / 3, 0.5, 1 / 3, 0.5), rect(2 / 3, 0.5, 1 / 3, 0.5)] },

  { id: "5-top2", count: 5, cells: [rect(0, 0, 0.5, 0.5), rect(0.5, 0, 0.5, 0.5), rect(0, 0.5, 1 / 3, 0.5), rect(1 / 3, 0.5, 1 / 3, 0.5), rect(2 / 3, 0.5, 1 / 3, 0.5)] },
  { id: "5-left", count: 5, cells: [rect(0, 0, 0.6, 1), rect(0.6, 0, 0.4, 0.25), rect(0.6, 0.25, 0.4, 0.25), rect(0.6, 0.5, 0.4, 0.25), rect(0.6, 0.75, 0.4, 0.25)] },
  { id: "5-big", count: 5, cells: [rect(0, 0, 2 / 3, 2 / 3), rect(2 / 3, 0, 1 / 3, 1 / 3), rect(2 / 3, 1 / 3, 1 / 3, 1 / 3), rect(0, 2 / 3, 1 / 3, 1 / 3), rect(1 / 3, 2 / 3, 2 / 3, 1 / 3)] },
  { id: "5-v", count: 5, cells: grid(5, 1) },

  { id: "6-grid", count: 6, cells: grid(3, 2) },
  { id: "6-grid2", count: 6, cells: grid(2, 3) },
  { id: "6-left", count: 6, cells: [rect(0, 0, 0.5, 1), ...grid(1, 5).map((c) => c.map(([x, y]) => [0.5 + x * 0.5, y] as Point))] },
  { id: "6-v", count: 6, cells: grid(6, 1) },
];

/** Для семи и больше картинок шаблон считается сам: квадратная сетка без пустых мест. */
export function autoTemplate(count: number): Template {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const cells: Cell[] = [];
  let left = count;
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(cols, left);
    for (let c = 0; c < inRow; c++) cells.push(rect(c / inRow, r / rows, 1 / inRow, 1 / rows));
    left -= inRow;
  }
  return { id: `auto-${count}`, count, cells };
}

export function templatesFor(count: number): Template[] {
  const ready = TEMPLATES.filter((t) => t.count === count);
  return ready.length ? ready : [autoTemplate(count)];
}

/** Многоугольник, уменьшенный внутрь на d (для зазора между ячейками). Считаем честно по рёбрам. */
export function insetPolygon(cell: Cell, d: number): Cell {
  if (d <= 0 || cell.length < 3) return cell;
  const area = cell.reduce((a, [x1, y1], i) => {
    const [x2, y2] = cell[(i + 1) % cell.length];
    return a + (x1 * y2 - x2 * y1);
  }, 0) / 2;
  const sign = area >= 0 ? 1 : -1; // обход по часовой или против — нормаль внутрь считаем с учётом знака
  const lines: Array<[number, number, number]> = cell.map(([x1, y1], i) => {
    const [x2, y2] = cell[(i + 1) % cell.length];
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (dy / len) * -sign, ny = (-dx / len) * -sign; // внутренняя нормаль
    return [nx, ny, nx * x1 + ny * y1 + d];
  });
  const out: Cell = [];
  for (let i = 0; i < lines.length; i++) {
    const [a1, b1, c1] = lines[(i - 1 + lines.length) % lines.length];
    const [a2, b2, c2] = lines[i];
    const det = a1 * b2 - a2 * b1;
    if (Math.abs(det) < 1e-9) return cell; // рёбра параллельны — оставляем как есть
    out.push([(c1 * b2 - c2 * b1) / det, (a1 * c2 - a2 * c1) / det]);
  }
  return out;
}

export function pointInPolygon(cell: Cell, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = cell.length - 1; i < cell.length; j = i++) {
    const [xi, yi] = cell[i];
    const [xj, yj] = cell[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) inside = !inside;
  }
  return inside;
}

export function polygonBox(cell: Cell): { x: number; y: number; w: number; h: number } {
  const xs = cell.map((p) => p[0]), ys = cell.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export interface CollageSlot {
  /** картинка ячейки; пусто — ячейка заливается фоном */
  img?: HTMLImageElement;
  /** сдвиг картинки внутри ячейки в долях её размера */
  dx: number;
  dy: number;
  /** увеличение поверх «заполнить ячейку» */
  zoom: number;
}

export interface CollagePlan {
  width: number;
  height: number;
  background: string;
  /** зазор между ячейками в пикселях холста */
  gap: number;
  /** поля вокруг всего коллажа */
  padding: number;
  /** скругление углов ячейки */
  radius: number;
  /** обводка ячеек */
  stroke: boolean;
  strokeColor: string;
  strokeWidth: number;
}

function roundedClip(ctx: CanvasRenderingContext2D, cell: Cell, radius: number) {
  ctx.beginPath();
  if (radius <= 0) {
    cell.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  } else {
    // скругление по каждому углу: отходим по обоим рёбрам и соединяем дугой
    for (let i = 0; i < cell.length; i++) {
      const prev = cell[(i - 1 + cell.length) % cell.length];
      const cur = cell[i];
      const next = cell[(i + 1) % cell.length];
      const v1 = [prev[0] - cur[0], prev[1] - cur[1]];
      const v2 = [next[0] - cur[0], next[1] - cur[1]];
      const l1 = Math.hypot(v1[0], v1[1]) || 1;
      const l2 = Math.hypot(v2[0], v2[1]) || 1;
      const r = Math.min(radius, l1 / 2, l2 / 2);
      const p1: Point = [cur[0] + (v1[0] / l1) * r, cur[1] + (v1[1] / l1) * r];
      const p2: Point = [cur[0] + (v2[0] / l2) * r, cur[1] + (v2[1] / l2) * r];
      if (i === 0) ctx.moveTo(p1[0], p1[1]);
      else ctx.lineTo(p1[0], p1[1]);
      ctx.quadraticCurveTo(cur[0], cur[1], p2[0], p2[1]);
    }
  }
  ctx.closePath();
}

/** Рисует коллаж целиком. Ячейки считаются в пикселях холста с учётом полей и зазоров. */
export function renderCollage(cells: Cell[], slots: CollageSlot[], plan: CollagePlan): HTMLCanvasElement {
  const canvas = make(plan.width, plan.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = plan.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const innerW = Math.max(1, plan.width - plan.padding * 2);
  const innerH = Math.max(1, plan.height - plan.padding * 2);
  // зазор задан в пикселях: переводим в доли по каждой оси, иначе на неквадратном холсте он «поедет»
  const gapX = plan.gap / 2 / innerW;
  const gapY = plan.gap / 2 / innerH;

  cells.forEach((cell, i) => {
    const slot = slots[i];
    const shrunk = insetPolygon(cell, Math.max(gapX, gapY));
    const px: Cell = shrunk.map(([x, y]) => [plan.padding + x * innerW, plan.padding + y * innerH]);
    const box = polygonBox(px);
    if (box.w < 1 || box.h < 1) return;

    ctx.save();
    roundedClip(ctx, px, plan.radius);
    ctx.clip();
    if (slot?.img) {
      const img = slot.img;
      // «заполнить ячейку»: короткая сторона впритык, лишнее уходит за края
      const k = Math.max(box.w / img.naturalWidth, box.h / img.naturalHeight) * (slot.zoom || 1);
      const w = img.naturalWidth * k, h = img.naturalHeight * k;
      const x = box.x + (box.w - w) / 2 + slot.dx * box.w;
      const y = box.y + (box.h - h) / 2 + slot.dy * box.h;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, x, y, w, h);
    } else {
      ctx.fillStyle = "rgba(0,0,0,.08)";
      ctx.fillRect(box.x, box.y, box.w, box.h);
    }
    ctx.restore();

    if (plan.stroke && plan.strokeWidth > 0) {
      ctx.save();
      roundedClip(ctx, px, plan.radius);
      ctx.strokeStyle = plan.strokeColor;
      ctx.lineWidth = plan.strokeWidth;
      ctx.stroke();
      ctx.restore();
    }
  });
  return canvas;
}

// Силуэт: предмет (банка «Принглс», бутылка колы) — сплошной чёрный на белом фоне.
//
// Без нейросети, двумя способами:
//  • у картинки есть прозрачность (PNG «без фона») — предмет это непрозрачная часть;
//  • иначе фон — всё, что связано с краями кадра и близко по цвету к фону у краёв (медиана цветов
//    рамки), с допуском tolerance. Предмет — всё остальное: надписи и блики внутри банки с краем не
//    связаны и заливаются сами, силуэт выходит сплошным.
// Потом убираем мелкий мусор — пятна меньше minPart от самой большой части.

import type { Raster } from "./pixelate";

export interface SilhouetteOptions {
  /** допуск по цвету фона, 0..255 (евклидово по RGB, делённое на √3) */
  tolerance: number;
  /** доля от самой большой части: всё мельче — мусор; 0 — оставить всё */
  minPart: number;
  /**
   * Залить каждую часть до выпуклой формы. Белая грань коробки на белом фоне сливается с фоном,
   * и в силуэте выходит выемка — у коробок, банок, бутылок настоящая форма выпуклая, её и берём.
   */
  convex?: boolean;
  /** цвет силуэта и фона */
  ink: [number, number, number];
  paper: [number, number, number];
}

export const SILHOUETTE_DEFAULTS: SilhouetteOptions = { tolerance: 40, minPart: 0.02, ink: [0, 0, 0], paper: [255, 255, 255] };

/** Есть ли у картинки настоящая прозрачность у краёв (PNG без фона). */
export function hasTransparentBorder(r: Raster): boolean {
  const { data, width, height } = r;
  let clear = 0, total = 0;
  const look = (x: number, y: number) => { total++; if (data[(y * width + x) * 4 + 3] < 128) clear++; };
  for (let x = 0; x < width; x++) { look(x, 0); look(x, height - 1); }
  for (let y = 1; y < height - 1; y++) { look(0, y); look(width - 1, y); }
  return total > 0 && clear / total > 0.3;
}

/** Медиана цветов рамки — цвет фона. */
export function borderColor(r: Raster): [number, number, number] {
  const { data, width, height } = r;
  const ch: number[][] = [[], [], []];
  const take = (x: number, y: number) => { const i = (y * width + x) * 4; ch[0].push(data[i]); ch[1].push(data[i + 1]); ch[2].push(data[i + 2]); };
  for (let x = 0; x < width; x++) { take(x, 0); take(x, height - 1); }
  for (let y = 1; y < height - 1; y++) { take(0, y); take(width - 1, y); }
  return ch.map((c) => c.sort((a, b) => a - b)[c.length >> 1]) as [number, number, number];
}

/** Маска предмета: 1 — предмет, 0 — фон. */
export function silhouetteMask(r: Raster, opt: Pick<SilhouetteOptions, "tolerance" | "minPart" | "convex"> = SILHOUETTE_DEFAULTS): Uint8Array {
  const { data, width: W, height: H } = r;
  const n = W * H;
  const mask = new Uint8Array(n);
  if (hasTransparentBorder(r)) {
    for (let p = 0; p < n; p++) mask[p] = data[p * 4 + 3] >= 128 ? 1 : 0;
  } else {
    const [br, bg, bb] = borderColor(r);
    const lim = (Math.max(0, opt.tolerance) * Math.sqrt(3)) ** 2;
    const isBg = (p: number) => {
      const i = p * 4;
      const dr = data[i] - br, dg = data[i + 1] - bg, db = data[i + 2] - bb;
      return dr * dr + dg * dg + db * db <= lim;
    };
    // заливка фона от рамки: seen — фон, куда дошли; предмет — то, куда заливка не дошла
    const seen = new Uint8Array(n);
    const queue = new Int32Array(n);
    let head = 0, tail = 0;
    const push = (p: number) => { if (!seen[p] && isBg(p)) { seen[p] = 1; queue[tail++] = p; } };
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
    for (let y = 1; y < H - 1; y++) { push(y * W); push(y * W + W - 1); }
    while (head < tail) {
      const p = queue[head++];
      const x = p % W;
      if (x > 0) push(p - 1);
      if (x < W - 1) push(p + 1);
      if (p >= W) push(p - W);
      if (p < n - W) push(p + W);
    }
    for (let p = 0; p < n; p++) mask[p] = seen[p] ? 0 : 1;
  }
  if (opt.minPart > 0 || opt.convex) {
    const parts = labelParts(mask, W, H);
    if (opt.minPart > 0) dropSmallParts(mask, parts, opt.minPart);
    if (opt.convex) fillConvex(mask, parts, W, H);
  }
  return mask;
}

interface Parts {
  label: Int32Array;
  /** размер части по номеру; [0] — фон */
  sizes: number[];
}

/** Связные части предмета (4-соседство). */
function labelParts(mask: Uint8Array, W: number, H: number): Parts {
  const n = W * H;
  const label = new Int32Array(n);
  const sizes: number[] = [0];
  const queue = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (!mask[s] || label[s]) continue;
    const id = sizes.length;
    let head = 0, tail = 0, size = 0;
    label[s] = id; queue[tail++] = s;
    const visit = (q: number) => { if (mask[q] && !label[q]) { label[q] = id; queue[tail++] = q; } };
    while (head < tail) {
      const p = queue[head++];
      size++;
      const x = p % W;
      if (x > 0) visit(p - 1);
      if (x < W - 1) visit(p + 1);
      if (p >= W) visit(p - W);
      if (p < n - W) visit(p + W);
    }
    sizes.push(size);
  }
  return { label, sizes };
}

/** Убирает части предмета мельче minPart от самой большой (пылинки, шум JPEG у края). */
function dropSmallParts(mask: Uint8Array, { label, sizes }: Parts, minPart: number) {
  const biggest = Math.max(0, ...sizes);
  const keep = sizes.map((s) => s >= biggest * minPart);
  for (let p = 0; p < mask.length; p++) if (mask[p] && !keep[label[p]]) { mask[p] = 0; label[p] = 0; }
}

/**
 * Каждую оставшуюся часть — до выпуклой оболочки. Точки оболочки берём только крайние в каждой
 * строке (левый и правый пиксель части) — оболочка от них та же, а точек в сотни раз меньше.
 */
function fillConvex(mask: Uint8Array, { label, sizes }: Parts, W: number, H: number) {
  const pts: [number, number][][] = sizes.map(() => []);
  const left = new Int32Array(sizes.length), right = new Int32Array(sizes.length);
  for (let y = 0; y < H; y++) {
    left.fill(-1);
    for (let x = 0, p = y * W; x < W; x++, p++) {
      const id = label[p];
      if (!id || !mask[p]) continue;
      if (left[id] < 0) left[id] = x;
      right[id] = x;
    }
    for (let id = 1; id < sizes.length; id++) if (left[id] >= 0) {
      // пиксель — квадрат: берём его края, иначе оболочка «съедает» полпикселя по контуру
      pts[id].push([left[id], y], [right[id] + 1, y], [left[id], y + 1], [right[id] + 1, y + 1]);
    }
  }
  for (const list of pts) {
    if (list.length < 3) continue;
    const hull = convexHull(list);
    for (let y = 0; y < H; y++) {
      const cy = y + 0.5;
      let x0 = Infinity, x1 = -Infinity;
      for (let i = 0; i < hull.length; i++) {
        const [ax, ay] = hull[i], [bx, by] = hull[(i + 1) % hull.length];
        if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) {
          const x = ax + ((cy - ay) / (by - ay)) * (bx - ax);
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
        }
      }
      if (x0 > x1) continue;
      for (let x = Math.max(0, Math.ceil(x0 - 0.5)); x <= Math.min(W - 1, Math.floor(x1 - 0.5)); x++) mask[y * W + x] = 1;
    }
  }
}

/** Выпуклая оболочка (монотонная цепь Эндрю), по часовой в экранных координатах. */
function convexHull(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Рисует силуэт на месте: предмет — ink, фон — paper, всё непрозрачное. */
export function silhouette(r: Raster, opt: SilhouetteOptions = SILHOUETTE_DEFAULTS): { share: number } {
  const mask = silhouetteMask(r, opt);
  const { data } = r;
  let ink = 0;
  for (let p = 0; p < mask.length; p++) {
    const c = mask[p] ? opt.ink : opt.paper;
    ink += mask[p];
    const i = p * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return { share: mask.length ? ink / mask.length : 0 };
}

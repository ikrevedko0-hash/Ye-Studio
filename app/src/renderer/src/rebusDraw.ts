// Ребус на холсте: каждый кусок рисуется своим холстиком одной высоты, потом они встают в ряд.
// Над картинкой — полоса знаков (А=О, цифры, зачёркнутые буквы), запятые — у верхних углов:
// слева перевёрнутые, справа обычные, как принято в ребусах.

import { silhouetteMask, SILHOUETTE_DEFAULTS } from "../../core/media/silhouette";
import type { Prep, Rebus, RebusOp, RebusPiece, SimplePiece } from "../../core/rebus/model";

export interface DrawStyle {
  /** Высота картинки куска, без полосы знаков. */
  height: number;
  gap: number;
  pad: number;
  ink: string;
  /** null — прозрачный фон. */
  paper: string | null;
}

export const DEFAULT_STYLE: DrawStyle = { height: 280, gap: 36, pad: 32, ink: "#161616", paper: "#ffffff" };

/** Картинка куска, уже загруженная (и, если надо, с вырезанным фоном). Нет — рисуем заглушку. */
export type PictureOf = (p: SimplePiece) => HTMLCanvasElement | undefined;

const FONT = '"Onest Variable", "Golos Text Variable", "Segoe UI", sans-serif';

function make(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function font(size: number, weight = 700): string {
  return `${weight} ${Math.round(size)}px ${FONT}`;
}

/** Вырезать фон: всё, что связано с цветом рамки, становится прозрачным. */
export function cutout(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = make(src.width, src.height);
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const image = ctx.getImageData(0, 0, out.width, out.height);
  const mask = silhouetteMask(image, SILHOUETTE_DEFAULTS);
  for (let p = 0; p < mask.length; p++) if (!mask[p]) image.data[p * 4 + 3] = 0;
  ctx.putImageData(image, 0, 0);
  return out;
}

/** Картинку — в рамку w×h без искажения. */
function fit(src: HTMLCanvasElement, maxW: number, maxH: number): { w: number; h: number } {
  const k = Math.min(maxW / src.width, maxH / src.height);
  return { w: src.width * k, h: src.height * k };
}

/** Текст знаков над картинкой: «А=О», «1 3 4», зачёркнутые буквы — отдельно, их надо перечеркнуть. */
function marksOf(ops: RebusOp[]): { text: string; strike?: boolean }[] {
  const out: { text: string; strike?: boolean }[] = [];
  for (const op of ops) {
    if (op.kind === "swap" && op.from) out.push({ text: `${op.from.toUpperCase()}=${op.to.toUpperCase()}` });
    if (op.kind === "pick" && op.idx.length) out.push({ text: op.idx.join(" ") });
    if (op.kind === "drop") for (const ch of op.letters.toUpperCase()) out.push({ text: ch, strike: true });
  }
  return out;
}

function commasOf(ops: RebusOp[]): { left: number; right: number } {
  let left = 0, right = 0;
  for (const op of ops) if (op.kind === "commas") { left += op.left; right += op.right; }
  return { left, right };
}

/** Тело куска без запятых и знаков: картинка, буквы, число или нота. */
function body(p: SimplePiece, pic: PictureOf, H: number, ink: string): HTMLCanvasElement {
  const flip = p.ops.some((op) => op.kind === "flip");
  if (p.kind === "picture") {
    const img = pic(p);
    if (!img) {
      // заглушка: видно, что картинки ещё нет, и что здесь должно быть
      const c = make(H, H);
      const ctx = c.getContext("2d")!;
      ctx.strokeStyle = "#9a9a9a";
      ctx.setLineDash([10, 8]);
      ctx.lineWidth = 3;
      ctx.strokeRect(4, 4, H - 8, H - 8);
      // в готовую картинку заглушка не попадает (экспорт без картинок запрещён) — это подсказка окна
      ctx.fillStyle = "#8a8a8a";
      ctx.font = font(H * 0.14, 700);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.word || "картинка", H / 2, H * 0.42, H - 20);
      ctx.font = font(H * 0.065, 500);
      ctx.fillText("щёлкните, чтобы", H / 2, H * 0.58, H - 20);
      ctx.fillText("найти картинку", H / 2, H * 0.66, H - 20);
      return c;
    }
    const { w, h } = fit(img, H * 1.35, H);
    const c = make(w, H);
    const ctx = c.getContext("2d")!;
    ctx.translate(w / 2, H / 2);
    if (flip) ctx.rotate(Math.PI);
    if (p.image?.mirror) ctx.scale(-1, 1);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    return c;
  }
  if (p.kind === "note") return staff(p.word, H, ink);
  const text = (p.kind === "letters" ? p.shown ?? p.word : p.shown ?? p.word).toUpperCase();
  return textBlock(text, H, ink, flip);
}

function textBlock(text: string, H: number, ink: string, flip = false): HTMLCanvasElement {
  const size = H * 0.78;
  const probe = make(1, 1).getContext("2d")!;
  probe.font = font(size);
  const w = Math.max(H * 0.3, probe.measureText(text).width + H * 0.08);
  const c = make(w, H);
  const ctx = c.getContext("2d")!;
  ctx.translate(w / 2, H / 2);
  if (flip) ctx.rotate(Math.PI);
  ctx.font = font(size);
  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, H * 0.04);
  return c;
}

/** Ступень ноты от нижней линии скрипичного ключа (ми первой октавы = 0), шаг — полпромежутка. */
const NOTE_STEP: Record<string, number> = { до: -2, ре: -1, ми: 0, фа: 1, соль: 2, ля: 3, си: 4 };

/** Нотный стан с одной нотой. Скрипичный ключ рисуется знаком шрифта — в Windows он есть в Segoe UI Symbol. */
function staff(note: string, H: number, ink: string): HTMLCanvasElement {
  const w = H * 1.1;
  const c = make(w, H);
  const ctx = c.getContext("2d")!;
  const gapY = H * 0.11;
  const bottom = H * 0.5 + gapY * 2;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = Math.max(2, H * 0.012);
  for (let i = 0; i < 5; i++) {
    const y = bottom - i * gapY;
    ctx.beginPath(); ctx.moveTo(H * 0.04, y); ctx.lineTo(w - H * 0.04, y); ctx.stroke();
  }
  ctx.font = `${Math.round(gapY * 6.2)}px "Segoe UI Symbol", "Noto Music", serif`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("\u{1D11E}", H * 0.06, bottom + gapY * 1.1);
  const step = NOTE_STEP[note] ?? 0;
  const x = w * 0.66;
  const y = bottom - (step * gapY) / 2;
  if (step <= -2) {
    // «до» — на добавочной линии под станом
    ctx.beginPath(); ctx.moveTo(x - gapY * 1.1, bottom + gapY); ctx.lineTo(x + gapY * 1.1, bottom + gapY); ctx.stroke();
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.35);
  ctx.beginPath();
  ctx.ellipse(0, 0, gapY * 0.68, gapY * 0.48, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // штиль вверх
  ctx.beginPath(); ctx.moveTo(x + gapY * 0.62, y - gapY * 0.1); ctx.lineTo(x + gapY * 0.62, y - gapY * 3.4); ctx.stroke();
  return c;
}

/** Простой кусок целиком: полоса знаков сверху, тело, запятые по бокам. Высота — band + H. */
function simpleCanvas(p: SimplePiece, pic: PictureOf, H: number, ink: string, withBand = true): HTMLCanvasElement {
  const core = body(p, pic, H, ink);
  const band = withBand ? H * 0.3 : 0;
  const { left, right } = commasOf(p.ops);
  const cSize = H * 0.5;
  const probe = make(1, 1).getContext("2d")!;
  probe.font = font(cSize, 800);
  const cw = probe.measureText(",").width * 0.9;
  const lw = left ? left * cw + H * 0.04 : 0;
  const rw = right ? right * cw + H * 0.04 : 0;

  const marks = marksOf(p.ops);
  const mSize = band * 0.78;
  probe.font = font(mSize);
  const markW = marks.reduce((s, m) => s + probe.measureText(m.text).width, 0) + Math.max(0, marks.length - 1) * mSize * 0.5;

  const w = Math.max(lw + core.width + rw, markW + H * 0.1);
  const c = make(w, band + H);
  const ctx = c.getContext("2d")!;
  const x0 = (w - (lw + core.width + rw)) / 2;
  ctx.drawImage(core, x0 + lw, band);

  ctx.fillStyle = ink;
  ctx.font = font(cSize, 800);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const cy = band + cSize * 0.55;
  for (let i = 0; i < right; i++) ctx.fillText(",", x0 + lw + core.width + H * 0.03 + i * cw, cy);
  for (let i = 0; i < left; i++) {
    // перевёрнутая запятая: та же запятая, повёрнутая на пол-оборота вокруг своей середины
    const cx = x0 + i * cw + cw / 2;
    ctx.save();
    ctx.translate(cx, cy - cSize * 0.28);
    ctx.rotate(Math.PI);
    ctx.fillText(",", -cw / 2, cSize * 0.28);
    ctx.restore();
  }

  if (marks.length && band) {
    ctx.font = font(mSize);
    ctx.textBaseline = "middle";
    let x = (w - markW) / 2;
    const y = band * 0.5;
    for (const m of marks) {
      const mw = probe.measureText(m.text).width;
      ctx.fillText(m.text, x, y);
      if (m.strike) {
        ctx.lineWidth = Math.max(3, mSize * 0.09);
        ctx.strokeStyle = "#d02020";
        ctx.beginPath(); ctx.moveTo(x - mSize * 0.08, y + mSize * 0.3); ctx.lineTo(x + mw + mSize * 0.08, y - mSize * 0.3); ctx.stroke();
      }
      x += mw + mSize * 0.5;
    }
  }
  return c;
}

/** Две части предлога, расставленные по смыслу. Высота — band + H, как у простого куска. */
function relationCanvas(prep: Prep, a: SimplePiece, b: SimplePiece, pic: PictureOf, H: number, ink: string): HTMLCanvasElement {
  const band = H * 0.3;
  const part = (p: SimplePiece, h: number) => simpleCanvas(p, pic, h, ink, false);
  const put = (draw: (ctx: CanvasRenderingContext2D) => void, w: number) => {
    const c = make(w, band + H);
    const ctx = c.getContext("2d")!;
    ctx.translate(0, band);
    draw(ctx);
    return c;
  };

  switch (prep) {
    case "в": {
      const outer = part(b, H);
      // внутри буквы место — только её «дырка»: примерно треть ширины, иначе внутреннее налезет на обвод
      const room = outer.width * (b.kind === "picture" ? 0.55 : 0.34);
      let h = H * (b.kind === "picture" ? 0.4 : 0.26);
      let inner = part(a, h);
      if (inner.width > room) { h *= room / inner.width; inner = part(a, h); }
      return put((ctx) => {
        ctx.drawImage(outer, 0, 0);
        ctx.drawImage(inner, (outer.width - inner.width) / 2, (H - inner.height) / 2 - H * 0.02);
      }, outer.width);
    }
    case "на":
    case "по": {
      const lower = part(b, H * 0.52);
      const upper = part(a, H * 0.46);
      const w = Math.max(lower.width, upper.width);
      // «по» — верхний кусок сдвинут к краю, будто идёт по нижнему
      const ux = prep === "по" ? Math.max(0, (w - lower.width) / 2) : (w - upper.width) / 2;
      return put((ctx) => {
        ctx.drawImage(lower, (w - lower.width) / 2, H - lower.height);
        ctx.drawImage(upper, ux, H - lower.height - upper.height + H * 0.02);
      }, w);
    }
    case "под":
    case "над": {
      // «a под b» — b сверху; «a над b» — a сверху, с зазором
      const top = prep === "под" ? part(b, H * 0.46) : part(a, H * 0.42);
      const low = prep === "под" ? part(a, H * 0.46) : part(b, H * 0.42);
      const w = Math.max(top.width, low.width);
      return put((ctx) => {
        ctx.drawImage(top, (w - top.width) / 2, 0);
        ctx.drawImage(low, (w - low.width) / 2, H - low.height);
      }, w);
    }
    case "за": {
      const back = part(a, H * 0.72);
      const front = part(b, H * 0.72);
      const w = Math.max(back.width + front.width * 0.45, front.width + H * 0.2);
      return put((ctx) => {
        ctx.drawImage(back, w - back.width, 0);
        ctx.drawImage(front, 0, H - front.height);
      }, w);
    }
    case "у": {
      const big = part(b, H * 0.85);
      const small = part(a, H * 0.34);
      return put((ctx) => {
        ctx.drawImage(big, 0, H - big.height);
        ctx.drawImage(small, big.width + H * 0.02, H - small.height);
      }, big.width + small.width + H * 0.02);
    }
    case "к": {
      const from = part(a, H * 0.55);
      const to = part(b, H * 0.55);
      const arrow = H * 0.42;
      return put((ctx) => {
        const y = H / 2;
        ctx.drawImage(from, 0, y - from.height / 2);
        ctx.drawImage(to, from.width + arrow, y - to.height / 2);
        ctx.strokeStyle = ink;
        ctx.fillStyle = ink;
        ctx.lineWidth = Math.max(3, H * 0.02);
        const x1 = from.width + H * 0.05, x2 = from.width + arrow - H * 0.05;
        ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2 - H * 0.04, y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x2, y); ctx.lineTo(x2 - H * 0.08, y - H * 0.05); ctx.lineTo(x2 - H * 0.08, y + H * 0.05); ctx.closePath(); ctx.fill();
      }, from.width + arrow + to.width);
    }
    case "из":
      return fromSmall(a, b, pic, H, ink, band);
  }
}

/**
 * «a из b»: большая a выложена маленькими b. Форму a берём маской: a рисуется крупно на холсте,
 * и маленькие b ставятся в узлы сетки, попавшие в закрашенное.
 */
function fromSmall(a: SimplePiece, b: SimplePiece, pic: PictureOf, H: number, ink: string, band: number): HTMLCanvasElement {
  const shape = simpleCanvas(a, pic, H, ink, false);
  const mctx = shape.getContext("2d", { willReadFrequently: true })!;
  const data = mctx.getImageData(0, 0, shape.width, shape.height).data;
  const tile = simpleCanvas(b, pic, H * 0.1, ink, false);
  const c = make(shape.width, band + H);
  const ctx = c.getContext("2d")!;
  const stepX = Math.max(4, tile.width * 1.05), stepY = Math.max(4, tile.height * 1.05);
  for (let y = stepY / 2; y < shape.height; y += stepY) {
    for (let x = stepX / 2; x < shape.width; x += stepX) {
      const i = (Math.floor(y) * shape.width + Math.floor(x)) * 4 + 3;
      if (data[i] > 100) ctx.drawImage(tile, x - tile.width / 2, band + y - tile.height / 2);
    }
  }
  return c;
}

function pieceCanvas(p: RebusPiece, pic: PictureOf, s: DrawStyle): HTMLCanvasElement {
  if (p.kind === "relation") return relationCanvas(p.prep, p.a, p.b, pic, s.height, s.ink);
  return simpleCanvas(p, pic, s.height, s.ink);
}

/** Где на холсте стоит кусок: окно по этим рамкам понимает, по какому куску щёлкнули. */
export interface PieceBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Весь ребус одной картинкой. Пустой — пустой лист нужного размера, чтобы окно не прыгало. */
export function drawRebus(r: Rebus, pic: PictureOf, s: DrawStyle = DEFAULT_STYLE): HTMLCanvasElement {
  return layoutRebus(r, pic, s).canvas;
}

export function layoutRebus(r: Rebus, pic: PictureOf, s: DrawStyle = DEFAULT_STYLE): { canvas: HTMLCanvasElement; boxes: PieceBox[] } {
  const parts = r.pieces.map((p) => pieceCanvas(p, pic, s));
  const H = s.height * 1.3;
  const w = s.pad * 2 + parts.reduce((sum, c) => sum + c.width, 0) + Math.max(0, parts.length - 1) * s.gap;
  const c = make(Math.max(w, s.height * 2), H + s.pad * 2);
  const ctx = c.getContext("2d")!;
  if (s.paper) {
    ctx.fillStyle = s.paper;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  const boxes: PieceBox[] = [];
  let x = (c.width - (w - s.pad * 2)) / 2;
  parts.forEach((part, i) => {
    const y = s.pad + (H - part.height) / 2;
    ctx.drawImage(part, x, y);
    boxes.push({ id: r.pieces[i].id, x, y, w: part.width, h: part.height });
    x += part.width + s.gap;
  });
  return { canvas: c, boxes };
}

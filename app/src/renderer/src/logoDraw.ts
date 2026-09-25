// Смешная цифра поверх логотипа пака — как «7» из радужных треугольников и огненная «8» на перчатке
// в логотипах Уе!паков 7 и 8. Всё рисуется canvas: шрифт жирный системный, стиль — заливка, обводка, свечение.

export interface NumberStyle {
  id: string;
  label: string;
}

export const NUMBER_STYLES: NumberStyle[] = [
  { id: "mosaic", label: "Радуга-мозаика" },
  { id: "fire", label: "Огонь" },
  { id: "neon", label: "Неон" },
  { id: "gold", label: "Золото" },
  { id: "chrome", label: "Хром" },
  { id: "comic", label: "Комикс" },
  { id: "ice", label: "Лёд" },
  { id: "candy", label: "Карамель" },
];

export interface NumberPlan {
  text: string;
  style: string;
  /** центр цифры в долях картинки */
  x: number;
  y: number;
  /** высота цифры в долях высоты картинки */
  size: number;
  /** поворот, градусы */
  angle: number;
  /** чтобы мозаика и огонь не менялись при каждом движении мышью */
  seed: number;
}

const FONT = `"Arial Black", Impact, "Segoe UI Black", sans-serif`;

/** Детерминированный «случайный» ряд: одна и та же картинка при одном и том же seed. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

/** Путь текста как маска: рисуем стиль в отдельный холст и вырезаем по буквам. */
function textMask(w: number, h: number, text: string, px: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  g.font = `900 ${px}px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#000";
  g.fillText(text, w / 2, h / 2);
  return c;
}

/** Рисует только цифру (без фона) в холст w×h с центром посередине. */
function drawNumber(w: number, h: number, text: string, px: number, style: string, seed: number): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const g = out.getContext("2d")!;
  g.font = `900 ${px}px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const cx = w / 2, cy = h / 2;
  const m = g.measureText(text);
  const tw = m.width, top = cy - px * 0.5, bottom = cy + px * 0.5;
  const lin = (stops: [number, string][], x0 = cx, y0 = top, x1 = cx, y1 = bottom) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    for (const [o, col] of stops) gr.addColorStop(o, col);
    return gr;
  };
  const stroke = (color: string, width: number) => { g.lineJoin = "round"; g.strokeStyle = color; g.lineWidth = width; g.strokeText(text, cx, cy); };
  const rand = rng(seed);

  switch (style) {
    case "mosaic": {
      // радужные треугольники, вырезанные по буквам, + тонкая светлая обводка
      const tiles = document.createElement("canvas");
      tiles.width = w; tiles.height = h;
      const t = tiles.getContext("2d")!;
      const step = Math.max(6, px / 7);
      for (let y = top - step; y < bottom + step; y += step) {
        for (let x = cx - tw / 2 - step; x < cx + tw / 2 + step; x += step) {
          for (const tri of [[[0, 0], [1, 0], [0, 1]], [[1, 0], [1, 1], [0, 1]]]) {
            const hue = ((x - (cx - tw / 2)) / tw) * 300 + (y - top) / px * 60 + rand() * 40;
            t.fillStyle = `hsl(${hue % 360} ${80 + rand() * 20}% ${45 + rand() * 20}%)`;
            t.beginPath();
            tri.forEach(([a, b], i) => (i ? t.lineTo(x + a * step, y + b * step) : t.moveTo(x + a * step, y + b * step)));
            t.closePath();
            t.fill();
          }
        }
      }
      t.globalCompositeOperation = "destination-in";
      t.drawImage(textMask(w, h, text, px), 0, 0);
      g.shadowColor = "rgba(0,0,0,.35)"; g.shadowBlur = px * 0.06; g.shadowOffsetY = px * 0.03;
      g.drawImage(tiles, 0, 0);
      g.shadowColor = "transparent";
      stroke("rgba(255,255,255,.55)", Math.max(1, px * 0.012));
      break;
    }
    case "fire": {
      // языки пламени: размытые капли над буквами, потом буква градиентом с горячим свечением
      g.save();
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < 70; i++) {
        const x = cx - tw / 2 + rand() * tw, y = top + rand() * px;
        const r = px * (0.04 + rand() * 0.08);
        const flame = g.createRadialGradient(x, y - r, 0, x, y - r, r * 2.2);
        flame.addColorStop(0, "rgba(255,230,120,.9)");
        flame.addColorStop(0.5, "rgba(255,120,20,.55)");
        flame.addColorStop(1, "rgba(200,30,0,0)");
        g.fillStyle = flame;
        g.beginPath();
        g.ellipse(x, y - r * 1.2, r, r * 2.4, (rand() - 0.5) * 0.6, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
      g.shadowColor = "rgba(255,120,0,.95)"; g.shadowBlur = px * 0.18;
      g.fillStyle = lin([[0, "#fff6b0"], [0.35, "#ffc02e"], [0.7, "#ff5a00"], [1, "#a01200"]]);
      g.fillText(text, cx, cy);
      g.shadowBlur = 0;
      stroke("rgba(120,20,0,.8)", Math.max(1, px * 0.02));
      break;
    }
    case "neon": {
      const col = `hsl(${Math.round(rand() * 360)} 100% 60%)`;
      g.shadowColor = col;
      for (const blur of [0.35, 0.18, 0.08]) { g.shadowBlur = px * blur; stroke(col, px * 0.05); }
      g.shadowBlur = px * 0.04;
      stroke("#ffffff", px * 0.018);
      break;
    }
    case "gold":
    case "chrome": {
      const stops: [number, string][] = style === "gold"
        ? [[0, "#fff7c2"], [0.28, "#f5c542"], [0.5, "#9a6a00"], [0.62, "#ffe27a"], [1, "#7a4d00"]]
        : [[0, "#ffffff"], [0.3, "#c9d2dc"], [0.5, "#5c6670"], [0.55, "#e9eef3"], [1, "#6b7580"]];
      g.shadowColor = "rgba(0,0,0,.55)"; g.shadowBlur = px * 0.08; g.shadowOffsetY = px * 0.04;
      stroke(style === "gold" ? "#4a2e00" : "#262c33", px * 0.07);
      g.shadowColor = "transparent";
      g.fillStyle = lin(stops);
      g.fillText(text, cx, cy);
      stroke("rgba(255,255,255,.6)", Math.max(1, px * 0.01));
      break;
    }
    case "comic": {
      // поп-арт: жирная чёрная обводка и сдвинутая тень
      g.fillStyle = "#111";
      g.fillText(text, cx + px * 0.06, cy + px * 0.06);
      stroke("#111", px * 0.09);
      g.fillStyle = lin([[0, "#fff35a"], [1, "#ffb400"]]);
      g.fillText(text, cx, cy);
      break;
    }
    case "ice": {
      g.shadowColor = "rgba(150,230,255,.9)"; g.shadowBlur = px * 0.15;
      g.fillStyle = lin([[0, "#ffffff"], [0.45, "#aeeaff"], [1, "#2b8fd6"]]);
      g.fillText(text, cx, cy);
      g.shadowBlur = 0;
      stroke("rgba(255,255,255,.85)", Math.max(1, px * 0.015));
      break;
    }
    default: {
      // карамель: розово-белые косые полосы
      const stripes = document.createElement("canvas");
      stripes.width = w; stripes.height = h;
      const s = stripes.getContext("2d")!;
      s.fillStyle = "#fff";
      s.fillRect(0, 0, w, h);
      s.strokeStyle = "#ff3d7f";
      s.lineWidth = px * 0.09;
      for (let x = -h; x < w + h; x += px * 0.22) { s.beginPath(); s.moveTo(x, 0); s.lineTo(x + h, h); s.stroke(); }
      s.globalCompositeOperation = "destination-in";
      s.drawImage(textMask(w, h, text, px), 0, 0);
      g.shadowColor = "rgba(0,0,0,.35)"; g.shadowBlur = px * 0.06; g.shadowOffsetY = px * 0.03;
      stroke("#b0003a", px * 0.06);
      g.shadowColor = "transparent";
      g.drawImage(stripes, 0, 0);
      break;
    }
  }
  return out;
}

/** Логотип с цифрой: base — исходная картинка, результат того же размера. */
export function renderLogoNumber(base: CanvasImageSource & { width: number; height: number }, W: number, H: number, plan: NumberPlan): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const g = out.getContext("2d")!;
  g.drawImage(base, 0, 0, W, H);
  const text = plan.text.trim();
  if (!text) return out;
  const px = Math.max(8, plan.size * H);
  // холст под цифру с запасом на свечение и пламя
  const side = Math.ceil(px * (1.6 + text.length * 0.9));
  const num = drawNumber(side, side, text, px, plan.style, plan.seed);
  g.save();
  g.translate(plan.x * W, plan.y * H);
  g.rotate((plan.angle * Math.PI) / 180);
  g.drawImage(num, -side / 2, -side / 2);
  g.restore();
  return out;
}

/** Номер из названия пака: «Уе!пак №9» → «9», «Ночные посиделки №85» → «85». */
export function numberFromName(name: string): string {
  return /№\s*(\d+)/.exec(name)?.[1] ?? /(\d+)\s*$/.exec(name.trim())?.[1] ?? "";
}

// Коллаж из нескольких картинок: выбор количества, шаблон раскладки, фон, поля, зазор, обводка.
// Рисуется в canvas прямо в окне, поэтому предпросмотр — это и есть будущий файл пака.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  dataUrlBytes, exportCanvas, loadPackImage, pointInPolygon, polygonBox, renderCollage, templatesFor,
  type Cell, type CollagePlan, type CollageSlot, type OutFormat, type Template,
} from "./imageCanvas";
import type { MediaInfo } from "../../shared/api";

interface Props {
  media: MediaInfo[];
  addMedia(paths?: string[]): Promise<MediaInfo[]>;
  onClose(): void;
  onDone(created: MediaInfo): void;
}

const COUNTS = [2, 3, 4, 5, 6, 7];
const mb = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(2)} МБ` : `${Math.round(b / 1024)} КБ`);

/** Маленькая схема шаблона для списка выбора. */
function TemplateIcon({ tpl }: { tpl: Template }) {
  return (
    <svg viewBox="0 0 100 100" className="tpl-icon">
      {tpl.cells.map((cell, i) => (
        <polygon key={i} points={cell.map(([x, y]) => `${x * 100},${y * 100}`).join(" ")} />
      ))}
    </svg>
  );
}

export function CollageEditor({ media, addMedia, onClose, onDone }: Props) {
  const images = useMemo(() => media.filter((m) => m.folder === "Images"), [media]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [count, setCount] = useState(2);
  const [tplIndex, setTplIndex] = useState(0);
  const [picked, setPicked] = useState<Array<MediaInfo | null>>([null, null]);
  const [loaded, setLoaded] = useState<Record<string, HTMLImageElement>>({});
  const [activeSlot, setActiveSlot] = useState(0);
  const [slotView, setSlotView] = useState<CollageSlot[]>([]);

  const [width, setWidth] = useState("1200");
  const [height, setHeight] = useState("800");
  const [background, setBackground] = useState("#ffffff");
  const [gap, setGap] = useState("10");
  const [padding, setPadding] = useState("20");
  const [radius, setRadius] = useState("0");
  const [stroke, setStroke] = useState(false);
  const [strokeColor, setStrokeColor] = useState("#000000");
  const [format, setFormat] = useState<OutFormat>("jpeg");
  const [quality, setQuality] = useState(0.88);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [estimate, setEstimate] = useState(0);

  const templates = useMemo(() => templatesFor(count), [count]);
  const template = templates[Math.min(tplIndex, templates.length - 1)];
  const cells: Cell[] = template.cells;

  // меняется количество — подгоняем длину списков, не теряя уже выбранное
  useEffect(() => {
    setTplIndex(0);
    setPicked((p) => Array.from({ length: count }, (_, i) => p[i] ?? null));
    setSlotView((s) => Array.from({ length: count }, (_, i) => s[i] ?? { dx: 0, dy: 0, zoom: 1 }));
    setActiveSlot((a) => Math.min(a, count - 1));
  }, [count]);

  // подгружаем выбранные картинки (каждую один раз)
  useEffect(() => {
    let alive = true;
    void (async () => {
      for (const m of picked) {
        if (!m || loaded[m.name]) continue;
        try {
          const img = await loadPackImage(m.folder, m.name);
          if (!alive) return;
          setLoaded((l) => ({ ...l, [m.name]: img }));
        } catch (e) {
          if (alive) setError((e as Error).message);
        }
      }
    })();
    return () => { alive = false; };
  }, [picked, loaded]);

  const plan: CollagePlan = {
    width: Math.max(100, Number(width) || 1200),
    height: Math.max(100, Number(height) || 800),
    background,
    gap: Math.max(0, Number(gap) || 0),
    padding: Math.max(0, Number(padding) || 0),
    radius: Math.max(0, Number(radius) || 0),
    stroke,
    strokeColor,
    strokeWidth: 2,
  };

  const slots: CollageSlot[] = picked.map((m, i) => ({
    img: m ? loaded[m.name] : undefined,
    dx: slotView[i]?.dx ?? 0,
    dy: slotView[i]?.dy ?? 0,
    zoom: slotView[i]?.zoom ?? 1,
  }));

  const canvas = useMemo(() => renderCollage(cells, slots, plan), [cells, JSON.stringify(picked.map((p) => p?.name ?? null)), loaded, JSON.stringify(slotView), JSON.stringify(plan)]);

  useEffect(() => {
    const host = canvasRef.current;
    if (!host) return;
    host.width = canvas.width;
    host.height = canvas.height;
    host.getContext("2d")!.drawImage(canvas, 0, 0);
  }, [canvas]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setEstimate(dataUrlBytes(exportCanvas(canvas, format, quality)));
      } catch (e) {
        setError((e as Error).message);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [canvas, format, quality]);

  /** Точка на превью → номер ячейки. Считаем по холсту, поэтому поля и зазоры учитываются сами собой. */
  const cellAt = (e: React.PointerEvent | React.WheelEvent): number => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * plan.width;
    const py = ((e.clientY - r.top) / r.height) * plan.height;
    const u = (px - plan.padding) / Math.max(1, plan.width - plan.padding * 2);
    const v = (py - plan.padding) / Math.max(1, plan.height - plan.padding * 2);
    return cells.findIndex((c) => pointInPolygon(c, u, v));
  };

  /** Тянем картинку внутри ячейки мышью — так быстрее, чем ползунками. */
  const onPreviewPointerDown = (e: React.PointerEvent) => {
    const i = cellAt(e);
    if (i < 0) return;
    setActiveSlot(i);
    if (!picked[i]) return;
    const box = polygonBox(cells[i]);
    const boxW = Math.max(1, box.w * (plan.width - plan.padding * 2));
    const boxH = Math.max(1, box.h * (plan.height - plan.padding * 2));
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const scale = plan.width / rect.width;
    const startX = e.clientX, startY = e.clientY;
    const from = { dx: slotView[i]?.dx ?? 0, dy: slotView[i]?.dy ?? 0 };
    const move = (ev: PointerEvent) => {
      patchSlot(i, {
        dx: Math.max(-1, Math.min(1, from.dx + ((ev.clientX - startX) * scale) / boxW)),
        dy: Math.max(-1, Math.min(1, from.dy + ((ev.clientY - startY) * scale) / boxH)),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onPreviewWheel = (e: React.WheelEvent) => {
    const i = cellAt(e);
    if (i < 0 || !picked[i]) return;
    const cur = slotView[i]?.zoom ?? 1;
    patchSlot(i, { zoom: Math.max(1, Math.min(3, cur - Math.sign(e.deltaY) * 0.08)) });
  };

  const patchSlot = (i: number, patch: Partial<CollageSlot>) =>
    setSlotView((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const pickFromPack = (m: MediaInfo) => {
    setPicked((p) => p.map((x, i) => (i === activeSlot ? m : x)));
    setActiveSlot((a) => Math.min(a + 1, count - 1));
  };

  const addFromDisk = async () => {
    const added = await addMedia();
    const imgs = added.filter((m) => m.folder === "Images");
    if (!imgs.length) return;
    // заполняем подряд, начиная с выбранной ячейки
    setPicked((p) => {
      const next = [...p];
      let k = 0;
      for (let i = activeSlot; i < next.length && k < imgs.length; i++) next[i] = imgs[k++];
      return next;
    });
  };

  const apply = async () => {
    setBusy(true);
    setError("");
    try {
      const dataUrl = exportCanvas(canvas, format, quality);
      const created = await window.api.saveImage(dataUrl, `коллаж ${count}`);
      window.dispatchEvent(new CustomEvent("media-created", { detail: created }));
      onDone(created);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const filled = picked.filter(Boolean).length;

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="media-editor collage">
        <header>
          <b>Коллаж</b>
          <span className="muted">{plan.width}×{plan.height}{estimate ? `, ${mb(estimate)}` : ""} · картинок {filled} из {count}</span>
          <span className="spacer" />
          <button onClick={onClose} disabled={busy}>Закрыть</button>
        </header>

        <div className="editor-body">
          <div className="stage">
            <div className="collage-counts">
              {COUNTS.map((n) => (
                <button key={n} className={n === count ? "primary" : ""} onClick={() => setCount(n)}>{n === 7 ? "7+" : n}</button>
              ))}
              {count >= 7 && (
                <label className="inline">много<input type="number" min="7" max="30" value={count} onChange={(e) => setCount(Math.max(7, Math.min(30, Number(e.target.value) || 7)))} /></label>
              )}
            </div>

            <div className="tpl-list">
              {templates.map((t, i) => (
                <button key={t.id} className={`tpl${i === Math.min(tplIndex, templates.length - 1) ? " sel" : ""}`} onClick={() => setTplIndex(i)} title={t.id}>
                  <TemplateIcon tpl={t} />
                </button>
              ))}
            </div>

            <div className="collage-preview">
              <canvas ref={canvasRef} onPointerDown={onPreviewPointerDown} onWheel={onPreviewWheel} title="тяните картинку внутри ячейки, колесо — увеличение" />
            </div>
          </div>

          <aside className="tools">
            <h4>Картинки</h4>
            <div className="slot-row">
              {picked.map((m, i) => (
                <button key={i} className={`slot${i === activeSlot ? " sel" : ""}${m ? " filled" : ""}`} onClick={() => setActiveSlot(i)} title={m?.name ?? "пусто"}>
                  {m ? <img src={m.url} alt="" /> : <span>{i + 1}</span>}
                </button>
              ))}
            </div>
            <div className="tool-row">
              <button onClick={addFromDisk}>Добавить с диска…</button>
              {picked[activeSlot] && <button onClick={() => setPicked((p) => p.map((x, i) => (i === activeSlot ? null : x)))}>Убрать</button>}
            </div>
            <div className="pack-images">
              {images.length === 0 && <p className="hint">В паке пока нет картинок — добавьте с диска.</p>}
              {images.map((m) => (
                <button key={m.name} className="thumb" onClick={() => pickFromPack(m)} title={m.name}>
                  <img src={m.url} alt="" />
                </button>
              ))}
            </div>

            {picked[activeSlot] && (
              <>
                <h4>Ячейка {activeSlot + 1}</h4>
                <label>Увеличение {Math.round((slotView[activeSlot]?.zoom ?? 1) * 100)}%
                  <input type="range" min="100" max="300" value={Math.round((slotView[activeSlot]?.zoom ?? 1) * 100)}
                         onChange={(e) => patchSlot(activeSlot, { zoom: Number(e.target.value) / 100 })} />
                </label>
                <div className="tool-row">
                  <label>Сдвиг ↔<input type="range" min="-50" max="50" value={Math.round((slotView[activeSlot]?.dx ?? 0) * 100)}
                                       onChange={(e) => patchSlot(activeSlot, { dx: Number(e.target.value) / 100 })} /></label>
                  <label>Сдвиг ↕<input type="range" min="-50" max="50" value={Math.round((slotView[activeSlot]?.dy ?? 0) * 100)}
                                       onChange={(e) => patchSlot(activeSlot, { dy: Number(e.target.value) / 100 })} /></label>
                </div>
              </>
            )}

            <h4>Холст</h4>
            <div className="tool-row">
              <label>Ширина<input type="number" min="100" step="50" value={width} onChange={(e) => setWidth(e.target.value)} /></label>
              <label>Высота<input type="number" min="100" step="50" value={height} onChange={(e) => setHeight(e.target.value)} /></label>
            </div>
            <div className="tool-row">
              <button onClick={() => { setWidth("1200"); setHeight("800"); }}>3:2</button>
              <button onClick={() => { setWidth("1200"); setHeight("675"); }}>16:9</button>
              <button onClick={() => { setWidth("1000"); setHeight("1000"); }}>1:1</button>
            </div>
            <div className="tool-row">
              <label>Фон<input type="color" value={background} onChange={(e) => setBackground(e.target.value)} /></label>
              <label>Отступ<input type="number" min="0" max="200" value={gap} onChange={(e) => setGap(e.target.value)} /></label>
              <label>Рамка<input type="number" min="0" max="200" value={padding} onChange={(e) => setPadding(e.target.value)} /></label>
            </div>
            <div className="tool-row">
              <label>Скругление<input type="number" min="0" max="200" value={radius} onChange={(e) => setRadius(e.target.value)} /></label>
              <label className="check inline"><input type="checkbox" checked={stroke} onChange={(e) => setStroke(e.target.checked)} /> обводка</label>
              {stroke && <input type="color" value={strokeColor} onChange={(e) => setStrokeColor(e.target.value)} />}
            </div>

            <h4>Формат</h4>
            <div className="tool-row">
              <select value={format} onChange={(e) => setFormat(e.target.value as OutFormat)}>
                <option value="jpeg">JPEG</option>
                <option value="png">PNG</option>
                <option value="webp">WebP</option>
              </select>
              {format !== "png" && <label>Качество {Math.round(quality * 100)}%
                <input type="range" min="30" max="100" value={Math.round(quality * 100)} onChange={(e) => setQuality(Number(e.target.value) / 100)} /></label>}
            </div>

            <div className="apply-box">
              <button className="primary" onClick={apply} disabled={busy || !filled}>{busy ? "Сохраняю…" : "Собрать коллаж"}</button>
            </div>
            {error && <p className="err">{error}</p>}
            <p className="hint">Коллаж добавится в пак новой картинкой и сразу встанет в вопрос. Исходные картинки остаются.</p>
          </aside>
        </div>
      </div>
    </div>
  );
}

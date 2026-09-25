// Окно «Номер на логотип»: смешная цифра поверх логотипа. Тащите цифру мышью, крутите, меняйте стиль;
// «Поставить» кладёт новую картинку в пак и делает её логотипом (исходник остаётся в паке).

import { useEffect, useMemo, useRef, useState } from "react";
import type { MediaInfo } from "../../shared/api";
import { fractionIn, useFitBox } from "./fitBox";
import { exportCanvas, loadPackImage } from "./imageCanvas";
import { NUMBER_STYLES, numberFromName, renderLogoNumber, type NumberPlan } from "./logoDraw";

/** Превью считаем в уменьшенной копии: мозаика и пламя на полном логотипе 3000 px тормозили бы мышь. */
const PREVIEW = 900;

export function LogoNumber({ media, packName, onClose, onDone }: {
  media: MediaInfo;
  packName: string;
  onClose(): void;
  onDone(created: MediaInfo): void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<NumberPlan>({ text: numberFromName(packName) || "9", style: "mosaic", x: 0.5, y: 0.5, size: 0.14, angle: 0, seed: 7 });
  const patch = (p: Partial<NumberPlan>) => setPlan((s) => ({ ...s, ...p }));

  useEffect(() => {
    loadPackImage(media.folder, media.name).then(setImg).catch((e) => setError((e as Error).message));
  }, [media]);

  const small = useMemo(() => {
    if (!img) return null;
    const k = Math.min(1, PREVIEW / Math.max(img.naturalWidth, img.naturalHeight));
    return { w: Math.round(img.naturalWidth * k), h: Math.round(img.naturalHeight * k) };
  }, [img]);
  const preview = useMemo(() => (img && small ? renderLogoNumber(img, small.w, small.h, plan) : null), [img, small, plan]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !preview) return;
    c.width = preview.width; c.height = preview.height;
    c.getContext("2d")!.drawImage(preview, 0, 0);
  }, [preview]);

  const frameRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const fit = useFitBox(frameRef, small?.w, small?.h);
  const [dragging, setDragging] = useState(false);
  const moveTo = (e: React.PointerEvent) => patch(fractionIn(boxRef.current!, e));

  const apply = async () => {
    if (!img) return;
    setBusy(true);
    setError("");
    try {
      const out = renderLogoNumber(img, img.naturalWidth, img.naturalHeight, plan);
      const base = media.name.replace(/\.[^.]+$/, "");
      const created = await window.api.saveImage(exportCanvas(out, "png", 1), `${base} (номер ${plan.text.trim()})`);
      window.dispatchEvent(new CustomEvent("media-created", { detail: created }));
      onDone(created);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="media-editor logo-number">
        <header>
          <b>Номер на логотип</b>
          <span className="muted">тащите цифру мышью</span>
          <span className="spacer" />
          <button onClick={onClose} disabled={busy}>Закрыть</button>
        </header>
        <div className="editor-body">
          <div className="stage">
            <div className="frame image-frame" ref={frameRef} style={{ cursor: dragging ? "grabbing" : "grab" }}
              onPointerDown={(e) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* синтетика */ } setDragging(true); moveTo(e); }}
              onPointerMove={(e) => { if (dragging) moveTo(e); }}
              onPointerUp={() => setDragging(false)}>
              <div className="fit-box" ref={boxRef} style={fit}>
                <canvas ref={canvasRef} />
              </div>
            </div>
          </div>
          <aside className="tools">
            <h4>Цифра</h4>
            <input className="logo-num-text" value={plan.text} maxLength={4} onChange={(e) => patch({ text: e.target.value })} placeholder="9" />
            <h4>Стиль</h4>
            <div className="logo-styles">
              {NUMBER_STYLES.map((s) => (
                <button key={s.id} className={plan.style === s.id ? "primary" : ""} onClick={() => patch({ style: s.id })}>{s.label}</button>
              ))}
            </div>
            <button onClick={() => patch({ seed: Math.floor(Math.random() * 1e9) })} title="Другие треугольники, языки пламени, цвет неона">🎲 Перемешать</button>
            <label>Размер
              <input type="range" min={3} max={60} value={Math.round(plan.size * 100)} onChange={(e) => patch({ size: Number(e.target.value) / 100 })} />
            </label>
            <label>Поворот {plan.angle}°
              <input type="range" min={-45} max={45} value={plan.angle} onChange={(e) => patch({ angle: Number(e.target.value) })} />
            </label>
            <div className="apply-box">
              <button className="primary" onClick={apply} disabled={busy || !img || !plan.text.trim()}>{busy ? "Сохраняю…" : "Поставить логотипом"}</button>
            </div>
            {error && <p className="err">{error}</p>}
            <p className="hint">Исходный логотип остаётся в паке — к нему всегда можно вернуться в «Свойствах пака».</p>
          </aside>
        </div>
      </div>
    </div>
  );
}

// Редактор картинок: обрезка, заглушки (заливка, размытие, пиксели), крупные пиксели на весь кадр
// или выделение («Картина по пикселям»), проявление, поворот, размер и формат.
// Всё считается в canvas прямо в окне — ffmpeg не нужен, а превью показывает ровно то, что ляжет в пак.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  dataUrlBytes, exportCanvas, loadPackImage, pixelateCanvas, renderImage, renderWorkFrame, silhouetteInCrop,
  type CoverShape, type CoverStyle, type Frac, type OutFormat, type PixelPlan, type SilhouettePlan,
} from "./imageCanvas";
import { blockGrid, clampBlocks, PIXEL_BLOCKS, PIXEL_PRESETS, revealSteps } from "../../core/media/pixelate";
import type { MediaInfo } from "../../shared/api";
import { fractionIn, useFitBox } from "./fitBox";

type Tool = "move" | "crop" | "cover" | "pixel";

interface Shape extends CoverShape {
  id: number;
}

interface Props {
  media: MediaInfo;
  onClose(): void;
  onDone(created: MediaInfo): void;
  /** картинка из вопроса: можно пикселизовать всю тему по цене */
  onThemeByPrice?(): void;
  /** картинка из вопроса: проявление — несколько картинок подряд вместо одной */
  onReveal?(created: MediaInfo[], pauseSec: number): void;
}

const RATIOS: Array<{ label: string; value: number | null }> = [
  { label: "свободно", value: null },
  { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "16:9", value: 16 / 9 },
  { label: "3:4", value: 3 / 4 },
  { label: "9:16", value: 9 / 16 },
];

const mb = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(2)} МБ` : `${Math.round(bytes / 1024)} КБ`);

export function ImageEditor({ media, onClose, onDone, onThemeByPrice, onReveal }: Props) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [tool, setTool] = useState<Tool>("move");
  const [coverStyle, setCoverStyle] = useState<CoverStyle>("solid");
  const [coverColor, setCoverColor] = useState("#000000");
  const [roundShape, setRoundShape] = useState(false);
  const [covers, setCovers] = useState<Shape[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [crop, setCrop] = useState<Frac | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const [rotate, setRotate] = useState<0 | 90 | 180 | 270>(0);
  const [flip, setFlip] = useState(false);
  const [maxSide, setMaxSide] = useState("");
  const [format, setFormat] = useState<OutFormat>("jpeg");
  const [quality, setQuality] = useState(0.88);
  const [estimate, setEstimate] = useState<{ bytes: number; w: number; h: number } | null>(null);

  // крупные пиксели: число блоков по ширине итоговой картинки; область — доли кадра без обрезки
  const [pixelOn, setPixelOn] = useState(false);
  const [blocks, setBlocks] = useState(32);
  const [blocksDraft, setBlocksDraft] = useState("32");
  const [pixRegion, setPixRegion] = useState<Frac | null>(null);
  const [revealCount, setRevealCount] = useState(4);
  const [revealPause, setRevealPause] = useState(3);
  const pickBlocks = (n: number) => { const b = clampBlocks(n); setBlocks(b); setBlocksDraft(String(b)); };
  const pixel: PixelPlan | undefined = pixelOn ? { blocks, region: pixRegion ?? undefined } : undefined;

  // силуэт: предмет чёрным на белом; допуск — насколько цвет может отличаться от фона у краёв
  const [silOn, setSilOn] = useState(false);
  const [silTol, setSilTol] = useState(40);
  const [silClean, setSilClean] = useState(true);
  const [silConvex, setSilConvex] = useState(true);
  const sil: SilhouettePlan | undefined = useMemo(
    () => (silOn ? { tolerance: silTol, minPart: silClean ? 0.02 : 0, convex: silConvex } : undefined),
    [silOn, silTol, silClean, silConvex],
  );

  useEffect(() => {
    let alive = true;
    loadPackImage(media.folder, media.name).then((i) => alive && setImg(i)).catch((e) => alive && setError((e as Error).message));
    return () => { alive = false; };
  }, [media]);

  /** Кадр без обрезки: его видно на экране, по нему же считаются доли фигур. */
  const work = useMemo(() => (img ? renderWorkFrame(img, rotate, flip, covers) : null), [img, rotate, flip, covers]);

  // на экране кадр без обрезки: блоков на нём больше ровно во столько, во сколько обрезка уже кадра,
  // тогда величина пикселя совпадает с итогом. Пересчёт на каждое движение ползунка — без «Применить».
  const silShown = useMemo(() => (work && sil ? silhouetteInCrop(work, sil, crop ?? undefined) : work), [work, sil, crop]);
  const shown = useMemo(() => {
    if (!silShown || !pixelOn) return silShown;
    return pixelateCanvas(silShown, blocks / (crop?.w ?? 1), pixRegion ?? undefined);
  }, [silShown, pixelOn, blocks, crop, pixRegion]);

  useEffect(() => {
    const host = canvasRef.current;
    if (!host || !shown) return;
    host.width = shown.width;
    host.height = shown.height;
    host.getContext("2d")!.drawImage(shown, 0, 0);
  }, [shown]);

  // вес и размер результата пересчитываем с задержкой: при перетаскивании мыши это дорого
  useEffect(() => {
    if (!img) return;
    const t = setTimeout(() => {
      try {
        const out = renderImage(img, {
          covers, rotate, flip, crop: crop ?? undefined,
          maxSide: Number(maxSide) || 0, format, quality, pixel, silhouette: sil,
        });
        setEstimate({ bytes: dataUrlBytes(exportCanvas(out, format, quality)), w: out.width, h: out.height });
      } catch (e) {
        setError((e as Error).message);
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, covers, rotate, flip, crop, maxSide, format, quality, pixelOn, blocks, pixRegion, sil]);

  const boxRef = useRef<HTMLDivElement | null>(null);
  const fit = useFitBox(frameRef, work?.width, work?.height);
  const pointerFraction = (e: React.PointerEvent) => fractionIn(boxRef.current!, e);

  const onPointerDown = (e: React.PointerEvent) => {
    if (tool === "move" || busy) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* синтетические события без захвата — рисуем и так */ }
    const p = pointerFraction(e);
    setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draft || !work) return;
    const p = pointerFraction(e);
    let w = p.x - draft.x;
    let h = p.y - draft.y;
    // соотношение сторон считаем в пикселях кадра, иначе на неквадратной картинке рамка врёт
    if (tool === "crop" && ratio) {
      const pxW = Math.abs(w) * work.width;
      const pxH = pxW / ratio;
      h = Math.sign(h || 1) * (pxH / work.height);
    }
    setDraft({ ...draft, w, h });
  };

  const onPointerUp = () => {
    if (!draft) return;
    const norm = {
      x: Math.max(0, Math.min(draft.x, draft.x + draft.w)),
      y: Math.max(0, Math.min(draft.y, draft.y + draft.h)),
      w: Math.min(1, Math.abs(draft.w)),
      h: Math.min(1, Math.abs(draft.h)),
    };
    setDraft(null);
    if (norm.w < 0.02 || norm.h < 0.02) return;
    if (tool === "crop") setCrop(norm);
    else if (tool === "pixel") setPixRegion(norm);
    else {
      const shape: Shape = { ...norm, id: Date.now(), style: coverStyle, round: roundShape, color: coverColor };
      setCovers((c) => [...c, shape]);
      setSelectedId(shape.id);
    }
    setTool("move");
  };

  const selected = covers.find((s) => s.id === selectedId) ?? null;
  const patchSelected = (patch: Partial<Shape>) => setCovers((c) => c.map((s) => (s.id === selectedId ? { ...s, ...patch } : s)));

  const apply = useCallback(async () => {
    if (!img) return;
    setBusy(true);
    setError("");
    try {
      const out = renderImage(img, {
        covers, rotate, flip, crop: crop ?? undefined,
        maxSide: Number(maxSide) || 0, format, quality, pixel, silhouette: sil,
      });
      const dataUrl = exportCanvas(out, format, quality);
      const base = media.name.replace(/\.[^.]+$/, "");
      const created = await window.api.saveImage(dataUrl, `${base} (${[sil && "силуэт", pixel && `пиксели ${pixel.blocks}`].filter(Boolean).join(", ") || "правка"})`);
      window.dispatchEvent(new CustomEvent("media-created", { detail: created }));
      onDone(created);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, covers, rotate, flip, crop, maxSide, format, quality, media, onDone, pixelOn, blocks, pixRegion, sil]);

  /** Проявление: от крупных пикселей к мелким, последняя — всё ещё не оригинал. */
  const reveal = async () => {
    if (!img || !onReveal) return;
    setBusy(true);
    setError("");
    try {
      const steps = revealSteps(blocks, revealCount);
      const base = media.name.replace(/\.[^.]+$/, "");
      const created: MediaInfo[] = [];
      for (const [k, b] of steps.entries()) {
        const out = renderImage(img, {
          covers, rotate, flip, crop: crop ?? undefined,
          maxSide: Number(maxSide) || 0, format, quality, silhouette: sil, pixel: { blocks: b, region: pixRegion ?? undefined },
        });
        const m = await window.api.saveImage(exportCanvas(out, format, quality), `${base} (проявление ${k + 1} из ${steps.length}, ${b})`);
        window.dispatchEvent(new CustomEvent("media-created", { detail: m }));
        created.push(m);
      }
      onReveal(created, revealPause);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape" && !busy) onClose();
      else if (e.key === "Delete" && selectedId != null) setCovers((c) => c.filter((s) => s.id !== selectedId));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose, selectedId]);

  const pcs = (v: number) => `${v * 100}%`;
  const cropStyle = crop
    ? { clipPath: `inset(${crop.y * 100}% ${100 - (crop.x + crop.w) * 100}% ${100 - (crop.y + crop.h) * 100}% ${crop.x * 100}%)` }
    : undefined;

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="media-editor">
        <header>
          <b>{media.name}</b>
          {img && <span className="muted">
            {img.naturalWidth}×{img.naturalHeight}, {mb(media.size)}
            {estimate && ` → ${estimate.w}×${estimate.h}, ${mb(estimate.bytes)}`}
          </span>}
          <span className="spacer" />
          <button onClick={onClose} disabled={busy}>Закрыть</button>
        </header>

        <div className="editor-body">
          <div className="stage">
            <div className="frame image-frame" ref={frameRef}
                 onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
                 style={{ cursor: tool === "move" ? "default" : "crosshair" }}>
              <div className="fit-box" ref={boxRef} style={fit}>
                <canvas ref={canvasRef} style={cropStyle} />
                {pixelOn && pixRegion && <div className="shape pixel-region" style={{ left: pcs(pixRegion.x), top: pcs(pixRegion.y), width: pcs(pixRegion.w), height: pcs(pixRegion.h) }} />}
                {crop && <div className="shape crop-frame" style={{ left: pcs(crop.x), top: pcs(crop.y), width: pcs(crop.w), height: pcs(crop.h) }} />}
                {covers.map((s) => (
                  <div key={s.id}
                       className={`shape cover outline${s.round ? " round" : ""}${s.id === selectedId ? " sel" : ""}`}
                       style={{ left: pcs(s.x), top: pcs(s.y), width: pcs(s.w), height: pcs(s.h) }}
                       onPointerDown={(e) => { if (tool === "move") { e.stopPropagation(); setSelectedId(s.id); } }} />
                ))}
                {draft && <div className={`shape draft${tool === "crop" ? " crop-frame" : tool === "pixel" ? " pixel-region" : ""}`}
                               style={{ left: pcs(Math.min(draft.x, draft.x + draft.w)), top: pcs(Math.min(draft.y, draft.y + draft.h)), width: pcs(Math.abs(draft.w)), height: pcs(Math.abs(draft.h)) }} />}
              </div>
            </div>
          </div>

          <aside className="tools">
            <h4>Кадр</h4>
            <div className="tool-row">
              <button className={tool === "crop" ? "primary" : ""} onClick={() => setTool(tool === "crop" ? "move" : "crop")}>Обрезать</button>
              <select value={String(ratio ?? "")} onChange={(e) => setRatio(e.target.value ? Number(e.target.value) : null)}>
                {RATIOS.map((r) => <option key={r.label} value={r.value ?? ""}>{r.label}</option>)}
              </select>
              {crop && <button onClick={() => setCrop(null)}>Сбросить</button>}
            </div>
            <div className="tool-row">
              <button onClick={() => setRotate(((rotate + 90) % 360) as 0 | 90 | 180 | 270)}>Повернуть ⟳</button>
              <button className={flip ? "primary" : ""} onClick={() => setFlip(!flip)}>Зеркало</button>
              {rotate !== 0 && <span className="muted">{rotate}°</span>}
            </div>

            <h4>Заглушка поверх картинки</h4>
            <p className="hint">Закрывает ответ, подпись или логотип. Нарисуйте прямоугольник прямо на картинке.</p>
            <div className="tool-row">
              <button className={tool === "cover" ? "primary" : ""} onClick={() => setTool(tool === "cover" ? "move" : "cover")}>Нарисовать</button>
              <select value={coverStyle} onChange={(e) => setCoverStyle(e.target.value as CoverStyle)}>
                <option value="solid">заливка</option>
                <option value="blur">размытие</option>
                <option value="pixelate">пиксели</option>
              </select>
              {coverStyle === "solid" && <input type="color" value={coverColor} onChange={(e) => setCoverColor(e.target.value)} title="цвет заливки" />}
              <label className="check inline"><input type="checkbox" checked={roundShape} onChange={(e) => setRoundShape(e.target.checked)} /> круг</label>
            </div>
            {selected && (
              <div className="shape-props">
                <div className="tool-row">
                  <span className="muted">выбрана заглушка</span>
                  {selected.style === "solid" && (
                    <input type="color" value={selected.color ?? "#000000"} onChange={(e) => patchSelected({ color: e.target.value })} />
                  )}
                  <button onClick={() => { setCovers((c) => c.filter((s) => s.id !== selected.id)); setSelectedId(null); }}>Удалить</button>
                </div>
              </div>
            )}

            <h4>Силуэт</h4>
            <label className="check inline" title="Предмет (банка, бутылка) — сплошной чёрный на белом. Лучше всего на однотонном фоне или PNG без фона">
              <input type="checkbox" checked={silOn} onChange={(e) => {
                setSilOn(e.target.checked);
                if (e.target.checked && format === "jpeg") setFormat("png");
              }} />
              Чёрный силуэт на белом
            </label>
            {silOn && (
              <div className="pixel-box">
                <label title="Насколько цвет может отличаться от фона у краёв кадра, чтобы считаться фоном. Фон не ушёл целиком — больше; съело край предмета — меньше">
                  Чувствительность к фону: {silTol}
                  <input type="range" min={5} max={120} value={silTol} onChange={(e) => setSilTol(Number(e.target.value))} />
                </label>
                <label className="check inline"><input type="checkbox" checked={silClean} onChange={(e) => setSilClean(e.target.checked)} /> убрать мелкий мусор</label>
                <label className="check inline" title="Коробки, банки, бутылки: белая грань на белом фоне не выгрызет выемку. Снимите для фигур с вырезами (человек, животное) и когда предметы на снимке касаются друг друга — иначе сольются в один многоугольник">
                  <input type="checkbox" checked={silConvex} onChange={(e) => setSilConvex(e.target.checked)} /> выпуклая форма
                </label>
                <p className="hint">Фон — всё, что связано с краем кадра и похоже на него цветом. Надписи внутри предмета заливаются сами. Предмет на пёстром фоне — сначала обрежьте поплотнее.</p>
              </div>
            )}

            <h4>Крупные пиксели</h4>
            <label className="check inline">
              <input type="checkbox" checked={pixelOn} onChange={(e) => {
                setPixelOn(e.target.checked);
                // жёсткие края блоков JPEG размывает ореолом, а PNG хранит такие картинки компактно
                if (e.target.checked && !pixRegion && format === "jpeg") setFormat("png");
              }} />
              «Картина по пикселям»
            </label>
            {pixelOn && (
              <div className="pixel-box">
                <label title="Сколько блоков по ширине картинки: чем меньше, тем крупнее пиксель и сложнее угадать">
                  Размер пикселя: {blocks} блоков по ширине
                  <div className="tool-row">
                    <input type="range" min={PIXEL_BLOCKS.min} max={PIXEL_BLOCKS.max} value={blocks} onChange={(e) => pickBlocks(Number(e.target.value))} />
                    <input className="blocks-num" value={blocksDraft} inputMode="numeric"
                      onChange={(e) => { setBlocksDraft(e.target.value); const n = Number(e.target.value); if (n >= PIXEL_BLOCKS.min && n <= PIXEL_BLOCKS.max) setBlocks(Math.round(n)); }}
                      onBlur={() => pickBlocks(Number(blocksDraft) || blocks)} />
                  </div>
                </label>
                <div className="tool-row presets">
                  {PIXEL_PRESETS.map((p) => (
                    <button key={p.blocks} className={blocks === p.blocks ? "primary" : ""} onClick={() => pickBlocks(p.blocks)} title={`${p.blocks} блоков по ширине`}>{p.label}</button>
                  ))}
                </div>
                {work && (() => {
                  const g = blockGrid(Math.round(work.width * (crop?.w ?? 1)), Math.round(work.height * (crop?.h ?? 1)), blocks);
                  return <p className="hint">Сетка {g.cols}×{g.rows}, блок {g.size} px.</p>;
                })()}
                <div className="tool-row">
                  <button className={tool === "pixel" ? "primary" : ""} onClick={() => setTool(tool === "pixel" ? "move" : "pixel")} title="Нарисуйте прямоугольник: пиксели только в нём (спрятать лицо или надпись)">Выделить область</button>
                  {pixRegion && <button onClick={() => setPixRegion(null)}>Весь кадр</button>}
                </div>
                {onThemeByPrice && (
                  <button className="wide" onClick={onThemeByPrice} title="Каждая картинка темы — по своей цене: дешёвые мелкими пикселями, дорогие крупными">
                    Для всей темы по цене…
                  </button>
                )}
                {onReveal && (
                  <div className="reveal-box">
                    <div className="tool-row">
                      <button onClick={reveal} disabled={busy || !img} title="Вместо картинки в вопрос встанет несколько: от крупных пикселей к мелким, по очереди">Сделать проявление</button>
                      <select value={revealCount} onChange={(e) => setRevealCount(Number(e.target.value))} title="Сколько картинок">
                        {[3, 4, 5].map((n) => <option key={n} value={n}>{n} шага</option>)}
                      </select>
                      <label className="inline-num" title="Сколько секунд стоит каждая картинка">
                        по<input type="number" min={1} max={30} value={revealPause} onChange={(e) => setRevealPause(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} />с
                      </label>
                    </div>
                    <p className="hint">Блоки: {revealSteps(blocks, revealCount).join(" → ")}. Оригинал — в ответ.</p>
                  </div>
                )}
              </div>
            )}

            <h4>Размер и формат</h4>
            <div className="tool-row">
              <label>Больш. сторона<input type="number" min="100" step="100" value={maxSide} placeholder="как есть" onChange={(e) => setMaxSide(e.target.value)} /></label>
              <select value={format} onChange={(e) => setFormat(e.target.value as OutFormat)}>
                <option value="jpeg">JPEG</option>
                <option value="png">PNG</option>
                <option value="webp">WebP</option>
              </select>
            </div>
            {format !== "png" && (
              <label>Качество {Math.round(quality * 100)}%
                <input type="range" min="30" max="100" value={Math.round(quality * 100)} onChange={(e) => setQuality(Number(e.target.value) / 100)} />
              </label>
            )}

            <div className="apply-box">
              <button className="primary" onClick={apply} disabled={busy || !img}>{busy ? "Сохраняю…" : "Применить"}</button>
            </div>
            {error && <p className="err">{error}</p>}
            <p className="hint">Исходный файл остаётся в паке, результат добавляется рядом новым файлом.</p>
          </aside>
        </div>
      </div>
    </div>
  );
}

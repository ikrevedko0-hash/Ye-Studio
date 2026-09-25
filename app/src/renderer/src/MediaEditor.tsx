// Редактор медиа: обрезка по времени, кадрирование, заглушки поверх кадра, поворот, звук, размер.
// Всё, что видно в превью, считается долями исходного кадра, поэтому результат ffmpeg совпадает с картинкой на экране.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditPlan, MediaInfo, MediaInfoProbe } from "../../shared/api";
import { fractionIn, useFitBox } from "./fitBox";

type Tool = "move" | "crop" | "cover";
type CoverStyle = "solid" | "blur" | "pixelate";

interface Shape {
  id: number;
  x: number; y: number; w: number; h: number; // доли исходного кадра
  style: CoverStyle;
  round: boolean;
  /** показывать заглушку весь клип или с from по to (секунды от начала обрезанного куска) */
  from?: number;
  to?: number;
}

interface Props {
  media: MediaInfo;
  /** «видео» или «звук» — для звука прячем всё, что про кадр */
  onClose(): void;
  onDone(created: MediaInfo): void;
}

const fmt = (t: number) => {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const ss = s.toFixed(2).padStart(5, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

const parseTime = (v: string): number | null => {
  const parts = v.trim().split(":").map((x) => Number(x.replace(",", ".")));
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
};

export function MediaEditor({ media, onClose, onDone }: Props) {
  const isAudio = media.folder === "Audio";
  const videoRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  const [info, setInfo] = useState<MediaInfoProbe | null>(null);
  const [videoSize, setVideoSize] = useState<{ w: number; h: number } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const fit = useFitBox(frameRef, videoSize?.w, videoSize?.h);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loopSel, setLoopSel] = useState(true);

  const [tool, setTool] = useState<Tool>("move");
  const [coverStyle, setCoverStyle] = useState<CoverStyle>("solid");
  const [roundShape, setRoundShape] = useState(false);
  const [crop, setCrop] = useState<Shape | null>(null);
  const [covers, setCovers] = useState<Shape[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Shape | null>(null);

  const [rotate, setRotate] = useState<0 | 90 | 180 | 270>(0);
  const [flip, setFlip] = useState(false);
  const [audioMode, setAudioMode] = useState<"keep" | "mute" | "only">(isAudio ? "only" : "keep");
  const [height, setHeight] = useState<"" | "720" | "480" | "360">("");
  const [quality, setQuality] = useState<"high" | "normal" | "light">("normal");
  const [targetMb, setTargetMb] = useState("");
  const [normalize, setNormalize] = useState(false);
  const [fade, setFade] = useState(isAudio);

  /** длительность из плеера — приходит раньше, чем ответ ffprobe */
  const [playerDuration, setPlayerDuration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const p = await window.api.probeMedia(media.folder, media.name);
        if (!alive) return;
        setInfo(p);
        setEnd((prev) => (prev > 0 ? prev : p.durationSec));
        if (p.hasAudio) window.api.waveform(media.folder, media.name, 800).then((w) => alive && setPeaks(w)).catch(() => {});
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return () => { alive = false; };
  }, [media]);

  useEffect(() => window.api.onEditProgress((p) => setProgress(p.ratio)), []);

  // проигрывание внутри выделенного куска
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onTime = () => {
      setNow(el.currentTime);
      if (loopSel && el.currentTime >= end - 0.02) {
        el.currentTime = start;
        if (!playing) el.pause();
      }
    };
    el.addEventListener("timeupdate", onTime);
    return () => el.removeEventListener("timeupdate", onTime);
  }, [start, end, loopSel, playing]);

  const seek = useCallback((t: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(t, info?.durationSec ?? t));
    setNow(el.currentTime);
  }, [info]);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      if (el.currentTime < start || el.currentTime > end) el.currentTime = start;
      void el.play();
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  }, [start, end]);

  // горячие клавиши: пробел — играть, [ и ] — границы, стрелки — по кадрам
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      const step = e.shiftKey ? 1 : 1 / (info?.fps ?? 25);
      if (e.code === "Space") { e.preventDefault(); togglePlay(); }
      else if (e.key === "[") setStart(Math.min(now, end - 0.05));
      else if (e.key === "]") setEnd(Math.max(now, start + 0.05));
      else if (e.key === "ArrowLeft") { e.preventDefault(); seek(now - step); }
      else if (e.key === "ArrowRight") { e.preventDefault(); seek(now + step); }
      else if (e.key === "Escape" && !busy) onClose();
      else if (e.key === "Delete" && selectedId != null) setCovers((c) => c.filter((s) => s.id !== selectedId));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [now, start, end, info, togglePlay, seek, selectedId, busy, onClose]);

  /** Плеер знает длительность раньше ffprobe; заодно показываем первый кадр, чтобы окно не было чёрным. */
  const onMeta = () => {
    const el = videoRef.current;
    if (!el || !isFinite(el.duration)) return;
    if (el instanceof HTMLVideoElement && el.videoWidth) setVideoSize({ w: el.videoWidth, h: el.videoHeight });
    setPlayerDuration(el.duration);
    setEnd((prev) => (prev > 0 ? prev : el.duration));
    if (!isAudio && el.currentTime === 0) el.currentTime = 0.04;
  };

  // рисование фигур мышью по кадру
  // доли — от коробки ровно по кадру, а не от рамки (см. fitBox.ts)
  const pointerFraction = (e: React.PointerEvent) => fractionIn(boxRef.current ?? frameRef.current!, e);

  const onPointerDown = (e: React.PointerEvent) => {
    if (tool === "move" || busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointerFraction(e);
    setDraft({ id: Date.now(), x: p.x, y: p.y, w: 0, h: 0, style: coverStyle, round: roundShape });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draft) return;
    const p = pointerFraction(e);
    setDraft({ ...draft, w: p.x - draft.x, h: p.y - draft.y });
  };

  const onPointerUp = () => {
    if (!draft) return;
    const norm: Shape = {
      ...draft,
      x: Math.max(0, Math.min(draft.x, draft.x + draft.w)),
      y: Math.max(0, Math.min(draft.y, draft.y + draft.h)),
      w: Math.min(1, Math.abs(draft.w)),
      h: Math.min(1, Math.abs(draft.h)),
    };
    setDraft(null);
    if (norm.w < 0.02 || norm.h < 0.02) return;
    if (tool === "crop") setCrop(norm);
    else { setCovers((c) => [...c, norm]); setSelectedId(norm.id); }
    setTool("move");
  };

  const selected = covers.find((s) => s.id === selectedId) ?? null;
  const patchSelected = (patch: Partial<Shape>) =>
    setCovers((c) => c.map((s) => (s.id === selectedId ? { ...s, ...patch } : s)));

  const duration = Math.max(0, end - start);
  const longWarning = duration > 30;

  /** Сплошные фигуры рисуем в PNG размером с исходный кадр — ffmpeg положит его поверх видео. */
  const makeOverlayPng = (): string | undefined => {
    const solids = covers.filter((s) => s.style === "solid");
    if (!solids.length || !info?.width || !info?.height) return undefined;
    const canvas = document.createElement("canvas");
    canvas.width = info.width;
    canvas.height = info.height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000";
    for (const s of solids) {
      const x = s.x * canvas.width, y = s.y * canvas.height, w = s.w * canvas.width, h = s.h * canvas.height;
      ctx.beginPath();
      if (s.round) ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      else ctx.rect(x, y, w, h);
      ctx.fill();
    }
    return canvas.toDataURL("image/png");
  };

  const apply = async () => {
    setBusy(true);
    setError("");
    setProgress(0);
    try {
      const filters = covers.filter((s) => s.style !== "solid");
      const solids = covers.filter((s) => s.style === "solid");
      const plan: EditPlan = {
        start, end,
        crop: crop ? { x: crop.x, y: crop.y, w: crop.w, h: crop.h } : undefined,
        covers: filters.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h, style: s.style as "blur" | "pixelate", from: s.from, to: s.to })),
        audio: audioMode,
        height: height ? (Number(height) as 720 | 480 | 360) : undefined,
        quality,
        rotate: rotate || undefined,
        flip: flip || undefined,
        targetMb: targetMb ? Number(targetMb) : undefined,
        normalize: normalize || undefined,
        fadeIn: fade || undefined,
        fadeOut: fade || undefined,
        overlayFrom: solids.length ? solids[0].from : undefined,
        overlayTo: solids.length ? solids[0].to : undefined,
      };
      const created = await window.api.editMedia({ folder: media.folder, name: media.name, plan, overlayPngBase64: makeOverlayPng() });
      window.dispatchEvent(new CustomEvent("media-created", { detail: created }));
      onDone(created);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const grabFrame = async () => {
    setBusy(true);
    try {
      const created = await window.api.grabFrame(media.folder, media.name, now);
      if (created) { window.dispatchEvent(new CustomEvent("media-created", { detail: created })); onDone(created); }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const total = info?.durationSec || playerDuration || 1;
  const pc = (t: number) => `${(t / total) * 100}%`;

  const cropStyle = crop
    ? { clipPath: `inset(${crop.y * 100}% ${100 - (crop.x + crop.w) * 100}% ${100 - (crop.y + crop.h) * 100}% ${crop.x * 100}%)` }
    : undefined;

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="media-editor">
        <header>
          <b>{media.name}</b>
          {info && <span className="muted">
            {info.width ? `${info.width}×${info.height}, ` : ""}{info.videoCodec ?? info.audioCodec}, {fmt(info.durationSec)}, {(info.sizeBytes / 1048576).toFixed(1)} МБ
          </span>}
          <span className="spacer" />
          <button onClick={onClose} disabled={busy}>Закрыть</button>
        </header>

        <div className="editor-body">
          <div className="stage">
            <div className="frame" ref={frameRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
                 style={{ cursor: tool === "move" ? "default" : "crosshair" }}>
              {isAudio ? (
                <div className="audio-stage">
                  <audio ref={videoRef as React.RefObject<HTMLAudioElement>} src={media.url} preload="auto" onLoadedMetadata={onMeta} />
                  <div className="audio-icon">♪</div>
                </div>
              ) : (
                <div className="fit-box" ref={boxRef} style={fit}>
                  <video ref={videoRef as React.RefObject<HTMLVideoElement>} src={media.url} preload="auto" style={cropStyle}
                         onLoadedMetadata={onMeta} onClick={() => tool === "move" && togglePlay()} />
                  {covers.map((s) => (
                    <div key={s.id}
                         className={`shape cover ${s.style}${s.round ? " round" : ""}${s.id === selectedId ? " sel" : ""}`}
                         style={{ left: pcs(s.x), top: pcs(s.y), width: pcs(s.w), height: pcs(s.h) }}
                         onPointerDown={(e) => { if (tool === "move") { e.stopPropagation(); setSelectedId(s.id); } }}>
                      {s.from !== undefined && <span className="shape-time">{fmt(s.from)}–{s.to !== undefined ? fmt(s.to) : "конец"}</span>}
                    </div>
                  ))}
                  {crop && <div className="shape crop-frame" style={{ left: pcs(crop.x), top: pcs(crop.y), width: pcs(crop.w), height: pcs(crop.h) }} />}
                  {draft && <div className={`shape draft${tool === "crop" ? " crop-frame" : ""}`}
                                 style={{ left: pcs(Math.min(draft.x, draft.x + draft.w)), top: pcs(Math.min(draft.y, draft.y + draft.h)), width: pcs(Math.abs(draft.w)), height: pcs(Math.abs(draft.h)) }} />}
                </div>
              )}
            </div>

            <div className="transport">
              <button className="play" onClick={togglePlay}>{playing ? "❚❚" : "▶"}</button>
              <span className="time-now">{fmt(now)}</span>
              <label className="check inline"><input type="checkbox" checked={loopSel} onChange={(e) => setLoopSel(e.target.checked)} /> играть только выбранное</label>
              <span className="spacer" />
              <span className={`result ${longWarning ? "warn" : ""}`} title={longWarning ? "FirePacks помечает пак жёлтой плашкой, если медиа длиннее 30 секунд" : ""}>
                на выходе {fmt(duration)}{longWarning ? " — длиннее 30 с" : ""}
              </span>
            </div>

            <div className="timeline" onPointerDown={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              seek(((e.clientX - r.left) / r.width) * total);
            }}>
              <div className="peaks">
                {peaks.map((p, i) => <i key={i} style={{ height: `${Math.max(2, p * 100)}%` }} />)}
              </div>
              <div className="dim" style={{ left: 0, width: pc(start) }} />
              <div className="dim" style={{ left: pc(end), right: 0 }} />
              <div className="handle" style={{ left: pc(start) }} onPointerDown={(e) => dragHandle(e, total, setStart, () => end - 0.05, "max")} />
              <div className="handle end" style={{ left: pc(end) }} onPointerDown={(e) => dragHandle(e, total, setEnd, () => start + 0.05, "min")} />
              <div className="playhead" style={{ left: pc(now) }} />
            </div>

            <div className="trim-row">
              <label>Начало<input value={fmt(start)} onChange={(e) => { const t = parseTime(e.target.value); if (t !== null) setStart(t); }} /></label>
              <button onClick={() => setStart(Math.min(now, end - 0.05))} title="Клавиша [">Начало здесь</button>
              <button onClick={() => setEnd(Math.max(now, start + 0.05))} title="Клавиша ]">Конец здесь</button>
              <label>Конец<input value={fmt(end)} onChange={(e) => { const t = parseTime(e.target.value); if (t !== null) setEnd(t); }} /></label>
              <button onClick={() => { setStart(0); setEnd(info?.durationSec ?? 0); }}>Весь файл</button>
            </div>
          </div>

          <aside className="tools">
            {!isAudio && (
              <>
                <h4>Кадр</h4>
                <div className="tool-row">
                  <button className={tool === "crop" ? "primary" : ""} onClick={() => setTool(tool === "crop" ? "move" : "crop")}>Обрезать кадр</button>
                  {crop && <button onClick={() => setCrop(null)}>Сбросить</button>}
                </div>
                <div className="tool-row">
                  <button onClick={() => setRotate(((rotate + 90) % 360) as 0 | 90 | 180 | 270)}>Повернуть ⟳</button>
                  <button className={flip ? "primary" : ""} onClick={() => setFlip(!flip)}>Зеркало</button>
                  {rotate !== 0 && <span className="muted">{rotate}°</span>}
                </div>

                <h4>Заглушка поверх кадра</h4>
                <p className="hint">Закрывает ответ, подпись или логотип. Нарисуйте прямоугольник прямо на кадре.</p>
                <div className="tool-row">
                  <button className={tool === "cover" ? "primary" : ""} onClick={() => setTool(tool === "cover" ? "move" : "cover")}>Нарисовать</button>
                  <select value={coverStyle} onChange={(e) => setCoverStyle(e.target.value as CoverStyle)}>
                    <option value="solid">чёрная заливка</option>
                    <option value="blur">размытие</option>
                    <option value="pixelate">пиксели</option>
                  </select>
                  <label className="check inline"><input type="checkbox" checked={roundShape} onChange={(e) => setRoundShape(e.target.checked)} /> круг</label>
                </div>
                {selected && (
                  <div className="shape-props">
                    <div className="tool-row">
                      <span className="muted">выбрана заглушка</span>
                      <button onClick={() => { setCovers((c) => c.filter((s) => s.id !== selected.id)); setSelectedId(null); }}>Удалить</button>
                    </div>
                    <label className="check inline">
                      <input type="checkbox" checked={selected.from !== undefined}
                             onChange={(e) => patchSelected(e.target.checked ? { from: 0, to: duration } : { from: undefined, to: undefined })} />
                      показывать не весь клип
                    </label>
                    {selected.from !== undefined && (
                      <div className="tool-row">
                        <label>с<input type="number" step="0.5" value={selected.from} onChange={(e) => patchSelected({ from: Number(e.target.value) })} /></label>
                        <label>по<input type="number" step="0.5" value={selected.to ?? duration} onChange={(e) => patchSelected({ to: Number(e.target.value) })} /></label>
                        <button onClick={() => patchSelected({ from: Math.max(0, now - start) })} title="взять текущее время">с плейхеда</button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            <h4>Звук</h4>
            <select value={audioMode} onChange={(e) => setAudioMode(e.target.value as typeof audioMode)}>
              {!isAudio && <option value="keep">оставить как есть</option>}
              {!isAudio && <option value="mute">убрать звук</option>}
              <option value="only">только звук (mp3)</option>
            </select>
            <label className="check inline"><input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} /> выровнять громкость</label>
            <label className="check inline"><input type="checkbox" checked={fade} onChange={(e) => setFade(e.target.checked)} /> плавное начало и конец</label>

            {audioMode !== "only" && (
              <>
                <h4>Размер и качество</h4>
                <div className="tool-row">
                  <select value={height} onChange={(e) => setHeight(e.target.value as typeof height)}>
                    <option value="">как есть</option>
                    <option value="720">до 720p</option>
                    <option value="480">до 480p</option>
                    <option value="360">до 360p</option>
                  </select>
                  <select value={quality} onChange={(e) => setQuality(e.target.value as typeof quality)} disabled={!!targetMb}>
                    <option value="high">качество</option>
                    <option value="normal">баланс</option>
                    <option value="light">полегче</option>
                  </select>
                </div>
                <label>Уложить в мегабайты (необязательно)
                  <input type="number" min="1" step="1" value={targetMb} placeholder="например 8" onChange={(e) => setTargetMb(e.target.value)} />
                </label>
              </>
            )}

            <div className="apply-box">
              {!isAudio && <button onClick={grabFrame} disabled={busy}>Стоп-кадр в пак</button>}
              <button className="primary" onClick={apply} disabled={busy || duration < 0.05}>
                {busy ? `Обработка… ${Math.round(progress * 100)}%` : "Применить"}
              </button>
              {busy && <button onClick={() => window.api.cancelEdit()}>Отмена</button>}
            </div>
            {busy && <div className="progress"><i style={{ width: `${progress * 100}%` }} /></div>}
            {error && <p className="err">{error}</p>}
            <p className="hint">
              Исходный файл остаётся в паке, результат добавляется рядом новым файлом.
              Пробел — играть, <b>[</b> и <b>]</b> — границы, стрелки — по кадрам.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}

const pcs = (v: number) => `${v * 100}%`;

/** Перетаскивание границы обрезки по таймлайну. */
function dragHandle(e: React.PointerEvent, total: number, set: (v: number) => void, limit: () => number, kind: "min" | "max") {
  e.stopPropagation();
  const track = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
  const move = (ev: PointerEvent) => {
    const t = Math.max(0, Math.min(total, ((ev.clientX - track.left) / track.width) * total));
    set(kind === "max" ? Math.min(t, limit()) : Math.max(t, limit()));
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

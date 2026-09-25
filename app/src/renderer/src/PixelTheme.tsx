// «Картина по пикселям» на всю тему: каждая картинка вопроса — по своей цене.
// Дешёвый вопрос — мелкие пиксели (легко), дорогой — крупные (сложно), промежуточные равномерно.
// Перед обработкой — список «вопрос → число блоков» с превью, любую строку можно поправить.

import { useEffect, useMemo, useState } from "react";
import { blocksForPrices, clampBlocks, PIXEL_BLOCKS, THEME_BLOCKS } from "../../core/media/pixelate";
import { isRef, itemKind, questionItems, questionText } from "../../core/siq/helpers";
import type { ContentItem } from "../../core/siq/model";
import type { MediaInfo, PackDTO } from "../../shared/api";
import type { Mutate } from "./App";
import { exportCanvas, loadPackImage, pixelateCanvas, pixelateImage } from "./imageCanvas";
import { replaceImages, type ReplaceJob } from "./pixelWork";

interface Row {
  question: number;
  price: number;
  text: string;
  images: ContentItem[];
}

const THUMB = 180;

export function PixelTheme({ pack, round, theme, mutate, onClose }: {
  pack: PackDTO;
  round: number;
  theme: number;
  mutate: Mutate;
  onClose(): void;
}) {
  const t = pack.pkg.rounds?.[round]?.themes?.[theme];
  const rows: Row[] = useMemo(() => (t?.questions ?? []).flatMap((q, i) => {
    const images = questionItems(q).filter((it) => itemKind(it) === "image" && isRef(it)
      && pack.media.some((m) => m.folder === "Images" && m.name === it.value));
    return images.length ? [{ question: i, price: Number(q.price) || 0, text: questionText(q), images }] : [];
    // тема не меняется, пока окно открыто
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const [cheap, setCheap] = useState<number>(THEME_BLOCKS.cheap);
  const [dear, setDear] = useState<number>(THEME_BLOCKS.dear);
  const [own, setOwn] = useState<Record<number, number>>({});
  const auto = blocksForPrices(rows.map((r) => r.price), cheap, dear);
  const blocksOf = (i: number) => own[rows[i].question] ?? auto[i];

  // превью: уменьшенная копия с тем же числом блоков по ширине выглядит так же крупно, как итог
  const [thumbs, setThumbs] = useState<Record<number, HTMLCanvasElement>>({});
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const r of rows) {
        const img = await loadPackImage("Images", r.images[0].value).catch(() => null);
        if (!img || !alive) continue;
        const k = Math.min(1, THUMB / img.naturalWidth);
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * k));
        c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        setThumbs((s) => ({ ...s, [r.question]: c }));
      }
    })();
    return () => { alive = false; };
  }, [rows]);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const apply = async () => {
    setBusy(true);
    setError("");
    try {
      const jobs: ReplaceJob[] = [];
      let n = 0;
      const total = rows.reduce((s, r) => s + r.images.length, 0);
      for (const [i, r] of rows.entries()) {
        const blocks = blocksOf(i);
        for (const it of r.images) {
          setProgress(`${++n} из ${total}: ${it.value}`);
          const img = await loadPackImage("Images", it.value);
          const base = it.value.replace(/\.[^.]+$/, "");
          // PNG: жёсткие края блоков без ореолов JPEG, и сплошные блоки жмутся хорошо
          const created: MediaInfo = await window.api.saveImage(exportCanvas(pixelateImage(img, blocks), "png", 1), `${base} (пиксели ${blocks})`);
          window.dispatchEvent(new CustomEvent("media-created", { detail: created }));
          jobs.push({ round, theme, question: r.question, name: it.value, items: [{ ...it, value: created.name }] });
        }
      }
      setProgress("Раскладываю по вопросам…");
      const res = await replaceImages(pack, mutate, jobs, "оригинал до пикселизации");
      setDone(`Готово: ${jobs.length} картинок. Оригиналы: в ответах — ${res.toAnswer.length}, в source/ — ${res.toSource.length}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="pixel-theme">
        <header>
          <b>Картина по пикселям: «{t?.name ?? ""}»</b>
          <span className="muted">дешёвые — мелкие пиксели, дорогие — крупные</span>
          <span className="spacer" />
          <button className="icon" onClick={onClose} disabled={busy} title="Закрыть">×</button>
        </header>
        <div className="tool-row pt-edges">
          <label title="Блоков по ширине у самого дешёвого вопроса">
            Самый дешёвый
            <input type="number" min={PIXEL_BLOCKS.min} max={PIXEL_BLOCKS.max} value={cheap} disabled={busy || !!done}
              onChange={(e) => { setCheap(clampBlocks(Number(e.target.value))); setOwn({}); }} />
          </label>
          <span>→</span>
          <label title="Блоков по ширине у самого дорогого вопроса">
            Самый дорогой
            <input type="number" min={PIXEL_BLOCKS.min} max={PIXEL_BLOCKS.max} value={dear} disabled={busy || !!done}
              onChange={(e) => { setDear(clampBlocks(Number(e.target.value))); setOwn({}); }} />
          </label>
          <span className="muted">блоков по ширине</span>
        </div>
        {!rows.length && <p className="hint">В теме нет вопросов с картинками из пака.</p>}
        <div className="pt-rows">
          {rows.map((r, i) => (
            <div className="pt-row" key={r.question} data-price={r.price} data-blocks={blocksOf(i)}>
              <b className="pt-price">{r.price}</b>
              <Thumb src={thumbs[r.question]} blocks={blocksOf(i)} />
              <div className="pt-info">
                <div className="pt-text" title={r.text}>{r.text || r.images[0].value}</div>
                {r.images.length > 1 && <div className="muted">картинок: {r.images.length}</div>}
              </div>
              <label className="pt-blocks" title="Блоков по ширине — можно поправить">
                <input type="number" min={PIXEL_BLOCKS.min} max={PIXEL_BLOCKS.max} value={blocksOf(i)} disabled={busy || !!done}
                  onChange={(e) => setOwn((o) => ({ ...o, [r.question]: clampBlocks(Number(e.target.value)) }))} />
                блоков
              </label>
            </div>
          ))}
        </div>
        <footer>
          {progress && <span className="muted">{progress}</span>}
          {done && <span className="pt-done">{done}</span>}
          {error && <span className="err">{error}</span>}
          <span className="spacer" />
          {done
            ? <button className="primary" onClick={onClose}>Закрыть</button>
            : <button className="primary" onClick={apply} disabled={busy || !rows.length}>{busy ? "Обрабатываю…" : "Пикселизовать тему"}</button>}
        </footer>
        <p className="hint">Оригинал встаёт в ответ вопроса, если там ещё нет медиа; иначе сохраняется в source/ рядом с паком.</p>
      </div>
    </div>
  );
}

function Thumb({ src, blocks }: { src?: HTMLCanvasElement; blocks: number }) {
  const url = useMemo(() => (src ? pixelateCanvas(src, blocks).toDataURL("image/png") : ""), [src, blocks]);
  return url ? <img className="pt-thumb" src={url} alt="" /> : <div className="pt-thumb empty">…</div>;
}

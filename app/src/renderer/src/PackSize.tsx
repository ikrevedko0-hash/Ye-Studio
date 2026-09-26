// «📦 Объём пака»: сколько весит пак против цели 100 МБ, что лежит без дела, какие картинки ужать,
// какие видео и звуки сжать. Ничего не пропадает насовсем: убранное из пака остаётся копией в source/.

import { useMemo, useState } from "react";
import { mb, PACK_TARGET_MB, renameMediaEverywhere, sizeTips, unusedMedia } from "../../core/siq/packSize";
import type { MediaInfo, PackDTO } from "../../shared/api";
import type { Mutate } from "./App";
import { applyScale, dataUrlBytes, exportCanvas, loadPackImage, toCanvas } from "./imageCanvas";
import { MediaEditor } from "./MediaEditor";
import { Icon } from "./Icon";

/** Картинки легче этого не трогаем: выигрыш копеечный. */
const IMAGE_MIN_BYTES = 300 * 1024;
const IMAGE_MAX_SIDE = 1920;
const IMAGE_QUALITY = 0.85;

const fmt = (bytes: number) => (bytes >= 1048576 ? `${mb(bytes).toFixed(1)} МБ` : `${Math.round(bytes / 1024)} КБ`);

/** Есть ли в картинке прозрачность — тогда остаётся PNG, JPEG залил бы её белым. */
function hasAlpha(c: HTMLCanvasElement): boolean {
  const d = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4 * 7) if (d[i] < 250) return true;
  return false;
}

export function PackSize({ pack, mutate, onClose }: { pack: PackDTO; mutate: Mutate; onClose(): void }) {
  const total = pack.media.reduce((s, m) => s + m.size, 0);
  const unused = useMemo(() => unusedMedia(pack.pkg, pack.media), [pack]);
  const used = pack.media.filter((m) => !unused.includes(m));
  const bigImages = used.filter((m) => m.folder === "Images" && m.size > IMAGE_MIN_BYTES).sort((a, b) => b.size - a.size);
  const heavyAv = used.filter((m) => m.folder !== "Images").sort((a, b) => b.size - a.size).slice(0, 10);
  const tips = sizeTips(pack.media, unused);

  const [busy, setBusy] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [compressing, setCompressing] = useState<MediaInfo | null>(null);
  const say = (s: string) => setLog((l) => [...l, s]);

  /** Старый файл — копией в source/ и из пака вон (окно узнаёт через media-removed). */
  const retire = async (m: MediaInfo, note: string) => {
    await window.api.libraryKeep(m.folder, m.name, note);
    await window.api.removeMedia(m.folder, m.name);
    window.dispatchEvent(new CustomEvent("media-removed", { detail: { folder: m.folder, name: m.name } }));
  };

  /** Новый файл встаёт на место старого во всех вопросах и в логотипе. */
  const swap = async (old: MediaInfo, created: MediaInfo, note: string) => {
    window.dispatchEvent(new CustomEvent("media-created", { detail: created }));
    mutate((p) => { renameMediaEverywhere(p, old.folder, old.name, created.name); });
    await retire(old, note);
  };

  const dropUnused = async () => {
    const list = [...unused];
    let freed = 0;
    for (const [i, m] of list.entries()) {
      setBusy(`Убираю ${i + 1} из ${list.length}: ${m.name}`);
      try { await retire(m, "убран из пака: ни один вопрос не ссылался"); freed += m.size; }
      catch (e) { say(`✘ ${m.name}: ${(e as Error).message}`); }
    }
    say(`✔ Убрано неиспользуемых: ${list.length}, освободилось ${fmt(freed)}. Копии — в source/.`);
    setBusy("");
  };

  const shrinkImages = async () => {
    const list = [...bigImages];
    let before = 0, after = 0, done = 0;
    for (const [i, m] of list.entries()) {
      setBusy(`Ужимаю картинки: ${i + 1} из ${list.length} — ${m.name}`);
      try {
        const img = await loadPackImage(m.folder, m.name);
        const c = applyScale(toCanvas(img), IMAGE_MAX_SIDE);
        const format = hasAlpha(c) ? "png" : "jpeg";
        const url = exportCanvas(c, format, IMAGE_QUALITY);
        const bytes = dataUrlBytes(url);
        // выигрыш меньше 10 % не стоит лишнего файла и перестановки ссылок
        if (bytes > m.size * 0.9) continue;
        const created = await window.api.saveImage(url, m.name.replace(/\.[^.]+$/, ""));
        await swap(m, created, "до ужатия картинки");
        before += m.size; after += created.size; done++;
      } catch (e) {
        say(`✘ ${m.name}: ${(e as Error).message}`);
      }
    }
    say(done ? `✔ Ужато картинок: ${done}, было ${fmt(before)} → стало ${fmt(after)}. Оригиналы — в source/.` : "Картинки уже лёгкие — ужимать нечего.");
    setBusy("");
  };

  const pct = Math.min(100, (mb(total) / PACK_TARGET_MB) * 100);
  const over = mb(total) > PACK_TARGET_MB;

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="pack-size">
        <header>
          <b><Icon name="box" />Объём пака</b>
          <span className={over ? "ps-over" : "muted"}>{fmt(total)} из {PACK_TARGET_MB} МБ</span>
          <span className="spacer" />
          <button className="icon" onClick={onClose} disabled={!!busy} title="Закрыть">×</button>
        </header>
        <div className="ps-bar"><div className={over ? "over" : ""} style={{ width: `${pct}%` }} /></div>
        <ul className="ps-tips">{tips.map((t) => <li key={t}>{t}</li>)}</ul>

        <section>
          <h4>Лежит без дела — {unused.length} ({fmt(unused.reduce((s, m) => s + m.size, 0))})</h4>
          {unused.length > 0 && (
            <>
              <div className="ps-list">{unused.slice(0, 50).map((m) => <div key={`${m.folder}/${m.name}`}><span>{m.folder}/{m.name}</span><b>{fmt(m.size)}</b></div>)}</div>
              <button className="primary" disabled={!!busy} onClick={dropUnused}>Убрать из пака (копии — в source/)</button>
            </>
          )}
        </section>

        <section>
          <h4>Картинки тяжелее {fmt(IMAGE_MIN_BYTES)} — {bigImages.length} ({fmt(bigImages.reduce((s, m) => s + m.size, 0))})</h4>
          {bigImages.length > 0 && (
            <>
              <div className="ps-list">{bigImages.slice(0, 50).map((m) => <div key={m.name}><span>{m.name}</span><b>{fmt(m.size)}</b></div>)}</div>
              <button className="primary" disabled={!!busy} onClick={shrinkImages}
                title={`До ${IMAGE_MAX_SIDE} px по большей стороне, JPEG ${IMAGE_QUALITY * 100} % (с прозрачностью — PNG). Меняем, только если стало легче на 10 % и больше`}>
                Ужать все: {IMAGE_MAX_SIDE} px, JPEG {IMAGE_QUALITY * 100} %
              </button>
            </>
          )}
        </section>

        <section>
          <h4>Самые тяжёлые видео и звуки</h4>
          <div className="ps-list">
            {heavyAv.map((m) => (
              <div key={`${m.folder}/${m.name}`}>
                <span><Icon name={m.folder === "Video" ? "video" : "audio"} size={14} /> {m.name}</span>
                <b>{fmt(m.size)}</b>
                <button className="small" disabled={!!busy} onClick={() => setCompressing(m)} title="Обрезать до нужного куска или сжать до заданного размера">Сжать…</button>
              </div>
            ))}
          </div>
        </section>

        <footer>
          {busy && <span className="muted">{busy}</span>}
          <div className="ps-log">{log.map((l, i) => <div key={i}>{l}</div>)}</div>
          <span className="spacer" />
          <button onClick={onClose} disabled={!!busy}>Закрыть</button>
        </footer>
      </div>
      {compressing && (
        <MediaEditor media={compressing} onClose={() => setCompressing(null)} onDone={async (created) => {
          const old = compressing;
          setCompressing(null);
          await swap(old, created, "до сжатия");
          say(`✔ ${old.name}: ${fmt(old.size)} → ${fmt(created.size)}`);
        }} />
      )}
    </div>
  );
}

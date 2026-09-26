// Библиотека мастерской: всё, что уже скачано для этого пака, — без похода в проводник.
//
// Зачем отдельное окно. Оригиналы лежат в source/ рядом с паком: скачанное из медиацентра,
// исходники до обрезки, файлы, добавленные руками. Раньше добраться до них можно было только
// через проводник Windows, а значит — угадывая, какой файл к какому вопросу.
//
// Здесь у каждого файла видно происхождение (откуда скачан и когда) и то, лежит ли он уже в паке.
// Предпросмотр идёт по siq://lib/<имя> — главный процесс отдаёт файл потоком прямо с диска,
// поэтому получасовое видео не приходится держать в памяти ради превью.

import { useCallback, useEffect, useState } from "react";
import type { MediaInfo, SourceMeta } from "../../shared/api";
import { Icon } from "./Icon";

interface Props {
  onClose(): void;
  /** Файл лёг в пак. Если задан target — его ещё и вставляют в вопрос. */
  onAdded(media: MediaInfo): void;
  /** Куда предлагать вставить: подпись на главной кнопке. */
  target?: "question" | "answer";
}

const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);

const KIND = (name: string): "image" | "audio" | "video" | "other" => {
  const e = name.toLowerCase().split(".").pop() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(e)) return "image";
  if (["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(e)) return "audio";
  if (["mp4", "webm", "mkv", "mov", "avi"].includes(e)) return "video";
  return "other";
};

const ICON = { image: "image", audio: "audio", video: "video", other: "doc" } as const;

/** Дата в человеческом виде: «сегодня, 14:05» понятнее полной ISO-строки. */
function when(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `сегодня, ${time}` : `${d.toLocaleDateString("ru-RU")}, ${time}`;
}

const libUrl = (file: string) => `siq://lib/${encodeURIComponent(file)}`;

export function MediaLibrary({ onClose, onAdded, target }: Props) {
  const [dir, setDir] = useState("");
  const [items, setItems] = useState<SourceMeta[]>([]);
  const [sel, setSel] = useState<SourceMeta | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");

  const reload = useCallback(async () => {
    const r = await window.api.mediaSources();
    setDir(r.dir);
    setItems(r.items);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const toPack = async (m: SourceMeta, insert: boolean) => {
    setBusy(true);
    setNote("");
    try {
      const added = await window.api.libraryToPack([m.file]);
      if (!added.length) {
        setNote("Этот файл приложение не считает медиа — проверьте расширение.");
        return;
      }
      window.dispatchEvent(new CustomEvent("media-created", { detail: added[0] }));
      if (insert) onAdded(added[0]);
      setNote(`«${added[0].name}» в паке`);
      await reload();
    } catch (e) {
      setNote(`Не получилось: ${String((e as Error).message)}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m: SourceMeta) => {
    if (!confirm(`Убрать «${m.file}» из библиотеки? Файл уйдёт в корзину, из пака он не пропадёт.`)) return;
    await window.api.libraryRemove(m.file);
    if (sel?.file === m.file) setSel(null);
    await reload();
  };

  const shown = filter.trim()
    ? items.filter((m) => `${m.file} ${m.title ?? ""} ${m.author ?? ""}`.toLowerCase().includes(filter.trim().toLowerCase()))
    : items;

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="media-editor media-center">
        <header>
          <b>Библиотека мастерской</b>
          <span className="muted">оригиналы этого пака: {items.length} шт.</span>
          <span className="spacer" />
          <button onClick={() => void window.api.libraryReveal()} title={dir}>Открыть папку</button>
          <button onClick={onClose}>Закрыть</button>
        </header>

        <div className="mc-search">
          <input
            className="mc-query"
            value={filter}
            placeholder="Отобрать по имени, названию или автору"
            onChange={(e) => setFilter(e.target.value)}
          />
          <button onClick={() => void reload()}>Обновить</button>
        </div>

        {!items.length && (
          <div className="mc-note">
            Пока пусто. Сюда попадает всё, что скачано через «Поиск в интернете»: оригиналы остаются на диске,
            а в пак уходит копия. Папка — {dir || "появится вместе с первым файлом"}.
          </div>
        )}

        <div className="mc-grid lib-grid">
          {shown.map((m) => {
            const kind = KIND(m.file);
            return (
              <div key={m.file} className={`mc-card lib-${kind}${sel?.file === m.file ? " sel" : ""}`} onClick={() => setSel(m)}>
                <div className="mc-thumb">
                  {kind === "image"
                    ? <img src={libUrl(m.file)} alt="" width={160} height={90} loading="lazy" />
                    : <span className="mc-noimg"><Icon name={ICON[kind]} size={34} /></span>}
                </div>
                <div className="mc-title" title={m.file}>{m.title || m.file}</div>
                <div className="mc-meta">
                  {mb(m.sizeBytes)}
                  {m.providerId ? ` · ${m.providerId}` : ""}
                  {when(m.fetchedAt) ? ` · ${when(m.fetchedAt)}` : ""}
                </div>
                {m.packFile && <div className="lib-inpack" title={`${m.packFolder}/${m.packFile}`}>уже в паке</div>}
                <div className="mc-actions">
                  <button className="primary" disabled={busy} onClick={(e) => { e.stopPropagation(); void toPack(m, !!target); }}>
                    {target ? "В вопрос" : "В пак"}
                  </button>
                  <button className="small" onClick={(e) => { e.stopPropagation(); void window.api.libraryReveal(m.file); }}>Показать</button>
                  <button className="small" onClick={(e) => { e.stopPropagation(); void remove(m); }} title="Убрать оригинал в корзину">×</button>
                </div>
              </div>
            );
          })}
        </div>

        {note && <div className="mc-note">{note}</div>}

        {sel && (
          <div className="mc-preview">
            {KIND(sel.file) === "image" && <img src={libUrl(sel.file)} alt={sel.file} />}
            {KIND(sel.file) === "video" && <video className="mc-player" src={libUrl(sel.file)} controls preload="metadata" />}
            {KIND(sel.file) === "audio" && <audio src={libUrl(sel.file)} controls preload="none" />}
            <div className="mc-preview-side">
              <b>{sel.title || sel.file}</b>
              <span className="muted">{sel.file}</span>
              {sel.author && <span className="muted">{sel.author}</span>}
              {sel.license && <span className="mc-lic">Лицензия: {sel.license}</span>}
              {sel.prompt && <span className="muted lib-prompt" title="Сцена, по которой нарисовано">Сцена: {sel.prompt}</span>}
              <span className="muted">{mb(sel.sizeBytes)}{when(sel.fetchedAt) ? ` · скачано ${when(sel.fetchedAt)}` : ""}</span>
              {sel.pageUrl && (
                <button className="link" onClick={() => void window.api.openPath(sel.pageUrl!)}>Открыть источник</button>
              )}
              {sel.packFile
                ? <span className="lib-inpack">в паке как {sel.packFolder}/{sel.packFile}</span>
                : <span className="muted">в пак ещё не добавлен</span>}
              <button className="primary" disabled={busy} onClick={() => void toPack(sel, !!target)}>
                {target ? "Вставить в вопрос" : "Добавить в пак"}
              </button>
              <button onClick={() => setSel(null)}>Свернуть</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

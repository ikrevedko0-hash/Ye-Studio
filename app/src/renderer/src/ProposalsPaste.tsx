import { useEffect, useMemo, useRef, useState } from "react";
import { SPECIAL_TYPES } from "../../core/siq/helpers";
import type { Package } from "../../core/siq/model";
import { parseProposals, planInsert, type PlanRow, type RowMedia } from "../../core/siq/proposals";
import type { MediaInfo, MediaResult } from "../../shared/api";
import { Icon } from "./Icon";

// «Вставить из AI»: блок json из чата → план «куда встанет» → вставка в открытый пак.
// Картинки ищем в Яндекс.Картинках по запросу, который написал Claude: первая находка выбрана,
// кликом — другая, «без картинки» — не брать. Скачивает готовый media:fetch.

const PER_QUERY = 6;
type Side = "question" | "answer";
const slot = (key: string, side: Side) => `${key}:${side}`;
const plain = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

/** Сколько ждём одну картинку при вставке: зависший сайт не должен держать всю вставку. */
const FETCH_TIMEOUT_S = 15;

/**
 * Скачать картинку в пак, но не дольше FETCH_TIMEOUT_S. Не успела — отменяем загрузку и отдаём null
 * (вопрос получит пометку «найти»). Если она всё же доедет в пак после отмены — убираем её оттуда,
 * иначе в паке останется файл, на который никто не ссылается.
 */
async function fetchWithTimeout(r: MediaResult) {
  const job = window.api.mediaFetch(r, true);
  let timer = 0;
  const late = new Promise<null>((resolve) => { timer = window.setTimeout(() => resolve(null), FETCH_TIMEOUT_S * 1000); });
  const done = await Promise.race([job, late]).finally(() => window.clearTimeout(timer));
  if (done) return done;
  await window.api.mediaFetchCancel();
  job.then((d) => { if (d.media) void window.api.removeMedia(d.media.folder, d.media.name); }, () => {});
  return null;
}

export function ProposalsPaste({ pkg, onClose, onInsert }: {
  pkg: Package;
  onClose(): void;
  /** Строки к вставке и скачанные для них картинки. Файлы уже в паке. */
  onInsert(rows: PlanRow[], media: Record<string, RowMedia>, files: MediaInfo[]): void;
}) {
  const [text, setText] = useState("");
  const [off, setOff] = useState<Set<string>>(new Set());
  const [found, setFound] = useState<Record<string, MediaResult[] | "ищу" | string>>({});
  const [pick, setPick] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  // буфер читаем сразу: чаще всего автор только что нажал «Копировать» в чате
  // (самопроверка --proposals подкладывает текст сама, чтобы не трогать буфер автора)
  useEffect(() => {
    const fromTest = (window as unknown as { __proposalsText?: string }).__proposalsText;
    if (fromTest) { setText(fromTest); return; }
    void window.api.clipboardText().then((t) => setText((cur) => cur || t)).catch(() => {});
  }, []);

  const parsed = useMemo(() => (text.trim() ? parseProposals(text) : null), [text]);
  const rows = useMemo(() => (parsed?.ok ? planInsert(pkg, parsed.themes) : []), [parsed, pkg]);

  // по умолчанию не берём дубли и строки с ошибкой
  useEffect(() => { setOff(new Set(rows.filter((r) => r.duplicate || r.error).map((r) => r.key))); setPick({}); }, [rows]);

  // поиск в Яндексе по очереди: главный процесс держит один поиск, новый отменяет прежний
  const searchRun = useRef(0);
  useEffect(() => {
    const run = ++searchRun.current;
    const wanted = rows.flatMap((r) => [
      ...(r.q.image ? [{ key: slot(r.key, "question"), text: r.q.image }] : []),
      ...(r.q.answerImage ? [{ key: slot(r.key, "answer"), text: r.q.answerImage }] : []),
    ]);
    setFound(Object.fromEntries(wanted.map((w) => [w.key, "ищу"])));
    void (async () => {
      const cache = new Map<string, MediaResult[] | string>();
      for (const w of wanted) {
        if (searchRun.current !== run) return;
        let res = cache.get(w.text);
        if (!res) {
          try {
            const hit = await window.api.mediaSearch({ text: w.text, type: "image", perPage: PER_QUERY }, ["yandex"]);
            res = hit.results.length ? hit.results.slice(0, PER_QUERY) : hit.errors[0]?.message ?? "ничего не нашлось";
          } catch (e) {
            res = plain(e);
          }
          cache.set(w.text, res);
        }
        if (searchRun.current !== run) return;
        setFound((f) => ({ ...f, [w.key]: res! }));
      }
    })();
    return () => { searchRun.current++; void window.api.mediaSearchCancel(); };
  }, [rows]);

  const chosen = rows.filter((r) => !off.has(r.key) && !r.error);
  const toggle = (key: string) => setOff((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const insert = async () => {
    setError("");
    const media: Record<string, RowMedia> = {};
    const files: MediaInfo[] = [];
    let failed = 0, slow = 0;
    try {
      for (const [i, r] of chosen.entries()) {
        for (const side of ["question", "answer"] as Side[]) {
          const k = slot(r.key, side);
          const list = found[k];
          const idx = pick[k] ?? 0;
          if (!Array.isArray(list) || idx < 0 || !list[idx]) continue;
          setBusy(`Качаю картинки: ${i + 1} из ${chosen.length}…`);
          try {
            const done = await fetchWithTimeout(list[idx]);
            if (!done) slow++;
            else if (done.media) {
              files.push(done.media);
              (media[r.key] ??= {})[side] = done.media.name;
            }
          } catch {
            failed++;
          }
        }
      }
      onInsert(chosen, media, files);
      if (failed || slow) {
        const why = [failed && `не скачалось: ${failed}`, slow && `не успело за ${FETCH_TIMEOUT_S} с и пропущено: ${slow}`].filter(Boolean).join(", ");
        window.alert(`Картинки — ${why}. У таких вопросов в тексте пометка «🖼 найти: …».`);
      }
      onClose();
    } catch (e) {
      setError(plain(e));
    } finally {
      setBusy("");
    }
  };

  const thumbs = (r: PlanRow, side: Side, query: string) => {
    const k = slot(r.key, side);
    const list = found[k];
    const idx = pick[k] ?? 0;
    return (
      <div className="prp-thumbs">
        <span className="muted" title="Запрос в Яндекс.Картинки"><Icon name="image" size={13} />{side === "question" ? "" : " ответ"}: {query}</span>
        {list === "ищу" && <span className="muted">ищу…</span>}
        {typeof list === "string" && list !== "ищу" && <span className="prp-warn">{list} — вставлю пометку «найти»</span>}
        {Array.isArray(list) && (
          <div className="prp-row">
            {list.map((m, i) => (
              <img
                key={m.id} src={m.thumbUrl} title={m.title} className={i === idx ? "on" : ""}
                // миниатюра не открылась — прячем, чтобы не висела пустая рамка
                onError={(e) => { e.currentTarget.style.display = "none"; }}
                onClick={() => setPick((p) => ({ ...p, [k]: i }))}
              />
            ))}
            <button className={`small${idx < 0 ? " on" : ""}`} onClick={() => setPick((p) => ({ ...p, [k]: -1 }))}>без картинки</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="proposals-paste">
        <header>
          <b><Icon name="paste" />Вопросы от AI</b>
          <span className="spacer" />
          <button className="small" disabled={!!busy} onClick={() => void window.api.clipboardText().then(setText)}>Взять из буфера ещё раз</button>
          <button className="icon" onClick={onClose} disabled={!!busy} title="Закрыть">×</button>
        </header>

        {!rows.length && (
          <textarea
            className="prp-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Скопируйте блок json из чата кнопкой «Копировать» и вставьте сюда (Ctrl+V)"
          />
        )}
        {parsed && !parsed.ok && <div className="tt-error">{parsed.error}</div>}
        {parsed?.ok && parsed.warnings.map((w) => <div key={w} className="prp-warn">{w}</div>)}

        {rows.length > 0 && (
          <div className="prp-list">
            {rows.map((r, i) => {
              const head = i === 0 || rows[i - 1].themeName !== r.themeName || rows[i - 1].round !== r.round;
              return (
                <div key={r.key}>
                  {head && (
                    <div className="prp-theme">
                      {r.roundName} · <b>{r.themeName}</b> {r.themeExists ? "" : <span className="chip">новая тема</span>}
                    </div>
                  )}
                  <div className={`prp-q${off.has(r.key) || r.error ? " off" : ""}`}>
                    <label className="check">
                      <input type="checkbox" disabled={!!r.error} checked={!off.has(r.key) && !r.error} onChange={() => toggle(r.key)} />
                      <b className="prp-price">{r.price}</b>
                      {r.price !== r.q.price && <span className="prp-warn" title="На этой цене уже стоит готовый вопрос">было {r.q.price}</span>}
                      {r.q.type !== "simple" && <span className="chip">{SPECIAL_TYPES[r.q.type] ?? r.q.type}</span>}
                      <span className="prp-text">{r.q.text || <i className="muted">без текста</i>}</span>
                      <span className="prp-answer">→ {r.q.answer}</span>
                    </label>
                    {r.error && <div className="prp-warn">{r.error}</div>}
                    {r.duplicate && <div className="prp-warn">такой ответ в теме уже есть — не беру, если не отметите</div>}
                    {!off.has(r.key) && !r.error && (
                      <>
                        {r.q.options.length > 0 && <div className="muted">варианты: {r.q.options.join(" · ")}</div>}
                        {r.q.image && thumbs(r, "question", r.q.image)}
                        {r.q.answerImage && thumbs(r, "answer", r.q.answerImage)}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {error && <div className="tt-error">{error}</div>}
        <footer>
          <span className="muted">{busy || "Готовые вопросы пака не трогаю. Пак станет несохранённым — сохраните сами."}</span>
          <span className="spacer" />
          {rows.length > 0 && <button disabled={!!busy} onClick={() => setText("")}>Другой блок</button>}
          <button onClick={onClose} disabled={!!busy}>Отмена</button>
          <button className="primary" disabled={!!busy || !chosen.length} onClick={() => void insert()}>
            {busy ? "Вставляю…" : `Вставить ${chosen.length}`}
          </button>
        </footer>
      </div>
    </div>
  );
}

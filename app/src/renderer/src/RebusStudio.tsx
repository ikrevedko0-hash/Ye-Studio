// Вкладка «Ребусы» в студии: ответ → варианты разбора → картинки и знаки → одна PNG в вопрос.
//
// Ребус хранится записью (core/rebus/model.ts), а не картинкой: окно в любой момент знает, во что
// он читается, и не даст вставить в вопрос ребус, который не сходится с ответом. Картинку для
// каждого куска берут тем же аппаратом, что и в «Картинках»: поиск, ИИ, свой файл.

import { useEffect, useRef, useState } from "react";
import type { MediaInfo, MediaResult } from "../../shared/api";
import {
  NOTES, NUMBER_WORDS, PREP_HINT, PREPS, explainRebus, fold, matches, pieceId, readPiece, readRebus,
  type OpKind, type Prep, type Rebus, type RebusOp, type RebusPiece, type RelationPiece, type SimplePiece,
} from "../../core/rebus/model";
import { TECHNIQUES, label, type Suggestion, type Technique } from "../../core/rebus/suggest";
import { applyScale, exportCanvas, loadImage, loadPackImage, toCanvas } from "./imageCanvas";
import { cutout, drawRebus, DEFAULT_STYLE, type DrawStyle } from "./rebusDraw";
import { Icon } from "./Icon";

interface Props {
  onInsert?(img: MediaInfo, answer: string): void;
  insertTarget?: string;
  onAdded(img: MediaInfo): void;
  onOpenAi?(): void;
}

const TECH_KEY = "rebusStudio.techniques";
const DRAFT_KEY = "rebusStudio.draft";

function loadTech(): Technique[] {
  try {
    const v = JSON.parse(localStorage.getItem(TECH_KEY) ?? "null") as unknown;
    return Array.isArray(v) ? (v as Technique[]) : TECHNIQUES.map((t) => t.id);
  } catch {
    return TECHNIQUES.map((t) => t.id);
  }
}

/** Последний ребус переживает закрытие окна: собирать его долго, терять обидно. */
function loadDraft(): Rebus {
  try {
    const v = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null") as Rebus | null;
    if (v && typeof v.answer === "string" && Array.isArray(v.pieces)) return v;
  } catch { /* черновика нет — начнём с чистого */ }
  return { answer: "", pieces: [] };
}

function cleanError(e: unknown): string {
  return String((e as Error).message).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "");
}

/** Стиль картинки для куска ребуса: один предмет на белом — так фон вырезается начисто. */
const AI_STYLE = "simple clean illustration of a single object, centered, isolated on a plain pure white background, no text, no letters, no frame";

/** Картинки больше этого держать незачем: на холсте кусок высотой ~300 px. */
const MAX_SIDE = 900;

const KIND_TITLE: Record<SimplePiece["kind"], string> = { picture: "Картинка", letters: "Буквы", number: "Число", note: "Нота" };

function blank(kind: SimplePiece["kind"]): SimplePiece {
  if (kind === "note") return { id: pieceId(), kind, word: "до", ops: [] };
  if (kind === "number") return { id: pieceId(), kind, word: "сто", shown: "100", ops: [] };
  if (kind === "letters") return { id: pieceId(), kind, word: "", shown: "", ops: [] };
  return { id: pieceId(), kind, word: "", ops: [] };
}

function imageKey(p: SimplePiece): string | undefined {
  if (!p.image) return undefined;
  return p.image.name ? `n:${p.image.name}` : p.image.url ? `u:${p.image.url.slice(0, 64)}:${p.image.url.length}` : undefined;
}

/** Все простые куски, включая части предлогов. */
function simples(pieces: RebusPiece[]): SimplePiece[] {
  return pieces.flatMap((p) => (p.kind === "relation" ? [p.a, p.b] : [p]));
}

function getOp<K extends OpKind>(p: SimplePiece, kind: K): Extract<RebusOp, { kind: K }> | undefined {
  return p.ops.find((o) => o.kind === kind) as Extract<RebusOp, { kind: K }> | undefined;
}

function setOp(p: SimplePiece, kind: OpKind, op: RebusOp | null): SimplePiece {
  const rest = p.ops.filter((o) => o.kind !== kind);
  return { ...p, ops: op ? [...rest, op] : rest };
}

export function RebusStudio({ onInsert, insertTarget, onAdded, onOpenAi }: Props) {
  const [rebus, setRebus] = useState<Rebus>(loadDraft);
  const [tech, setTech] = useState<Technique[]>(loadTech);
  const [found, setFound] = useState<Suggestion[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  /** У предлога правим одну из частей: a — «что», b — «где». */
  const [part, setPart] = useState<"a" | "b">("a");
  const [busy, setBusy] = useState<"" | "suggest" | "search" | "fetch" | "ai" | "save">("");
  const [note, setNote] = useState("");
  const [pics, setPics] = useState<Map<string, HTMLCanvasElement>>(new Map());
  const [fontsReady, setFontsReady] = useState(false);
  const [style, setStyle] = useState<DrawStyle>(DEFAULT_STYLE);
  const view = useRef<HTMLCanvasElement>(null);
  const cutCache = useRef(new Map<string, HTMLCanvasElement>());

  useEffect(() => { void document.fonts.ready.then(() => setFontsReady(true)); }, []);
  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(rebus)); } catch { /* большие картинки не влезли — не беда */ }
  }, [rebus]);

  // картинки кусков: грузим то, чего ещё нет в памяти
  useEffect(() => {
    let alive = true;
    for (const p of simples(rebus.pieces)) {
      const key = imageKey(p);
      if (!key || pics.has(key) || !p.image) continue;
      const img = p.image;
      const load = img.name ? loadPackImage("Images", img.name) : loadImage(img.url!);
      void load
        .then((el) => { if (alive) setPics((m) => new Map(m).set(key, applyScale(toCanvas(el), MAX_SIDE))); })
        .catch(() => { if (alive) setNote(`Не открылась картинка у «${p.word}».`); });
    }
    return () => { alive = false; };
  }, [rebus.pieces, pics]);

  const picOf = (p: SimplePiece): HTMLCanvasElement | undefined => {
    const key = imageKey(p);
    const base = key ? pics.get(key) : undefined;
    if (!base || !p.image?.cutout) return base;
    let cut = cutCache.current.get(key!);
    if (!cut) { cut = cutout(base); cutCache.current.set(key!, cut); }
    return cut;
  };

  // холст ребуса перерисовывается на каждое изменение — он маленький, это быстро
  useEffect(() => {
    const c = view.current;
    if (!c) return;
    const art = drawRebus(rebus, picOf, style);
    c.width = art.width;
    c.height = art.height;
    c.getContext("2d")!.drawImage(art, 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rebus, pics, fontsReady, style]);

  const reads = readRebus(rebus);
  const ok = matches(rebus);
  const explain = rebus.pieces.length ? explainRebus(rebus) : "";
  const missing = simples(rebus.pieces).filter((p) => p.kind === "picture" && !p.image);

  const selected = rebus.pieces.find((p) => p.id === sel) ?? null;
  const editing: SimplePiece | null = selected ? (selected.kind === "relation" ? selected[part] : selected) : null;

  const patchPieces = (fn: (pieces: RebusPiece[]) => RebusPiece[]) => setRebus((r) => ({ ...r, pieces: fn(r.pieces) }));
  const replace = (id: string, next: RebusPiece) => patchPieces((ps) => ps.map((p) => (p.id === id ? next : p)));
  /** Правка простого куска: сам кусок или часть выбранного предлога. */
  const editSimple = (next: SimplePiece) => {
    if (!selected) return;
    if (selected.kind === "relation") replace(selected.id, { ...selected, [part]: next });
    else replace(selected.id, next);
  };

  const add = (p: RebusPiece) => {
    patchPieces((ps) => {
      const i = ps.findIndex((x) => x.id === sel);
      return i < 0 ? [...ps, p] : [...ps.slice(0, i + 1), p, ...ps.slice(i + 1)];
    });
    setSel(p.id);
    setPart("a");
  };
  const move = (id: string, d: -1 | 1) =>
    patchPieces((ps) => {
      const i = ps.findIndex((p) => p.id === id);
      const j = i + d;
      if (i < 0 || j < 0 || j >= ps.length) return ps;
      const out = [...ps];
      [out[i], out[j]] = [out[j], out[i]];
      return out;
    });
  const remove = (id: string) => { patchPieces((ps) => ps.filter((p) => p.id !== id)); if (sel === id) setSel(null); };

  const toggleTech = (t: Technique) => {
    const next = tech.includes(t) ? tech.filter((x) => x !== t) : [...tech, t];
    setTech(next);
    try { localStorage.setItem(TECH_KEY, JSON.stringify(next)); } catch { /* не запомнится — не беда */ }
  };

  const runSuggest = async () => {
    if (!fold(rebus.answer)) { setNote("Сначала напишите ответ."); return; }
    setBusy("suggest");
    setNote("");
    try {
      const list = await window.api.rebusSuggest(rebus.answer, { techniques: tech, limit: 16 });
      setFound(list);
      if (!list.length) setNote("Разбора не нашлось — включите больше приёмов или соберите ребус вручную.");
    } catch (e) {
      setNote(`Подбор не удался: ${cleanError(e)}`);
    } finally {
      setBusy("");
    }
  };

  /** Вариант разбора → ребус. Картинки уже выбранных слов не теряем. */
  const take = (s: Suggestion) => {
    const had = new Map(simples(rebus.pieces).filter((p) => p.image).map((p) => [fold(p.word), p.image!]));
    const keep = (p: SimplePiece): SimplePiece => (p.kind === "picture" && had.has(fold(p.word)) ? { ...p, image: had.get(fold(p.word)) } : p);
    const pieces = s.rebus.pieces.map((p) => (p.kind === "relation" ? { ...p, a: keep(p.a), b: keep(p.b) } : keep(p)));
    setRebus({ answer: rebus.answer, pieces });
    const first = pieces[0];
    setSel(first?.id ?? null);
    setPart("a");
  };

  const render = (): string | null => {
    if (!rebus.pieces.length) { setNote("Ребус пуст."); return null; }
    if (missing.length) { setNote(`Нет картинки: ${missing.map((p) => `«${p.word || "?"}»`).join(", ")} — заглушка выдаст ответ.`); return null; }
    return exportCanvas(drawRebus(rebus, picOf, style), "png", 1);
  };

  const save = async (toQuestion: boolean) => {
    const dataUrl = render();
    if (!dataUrl) return;
    setBusy("save");
    try {
      const created = await window.api.saveImage(dataUrl, `ребус ${rebus.answer.trim()}`);
      if (toQuestion && onInsert) {
        onInsert(created, rebus.answer.trim());
        setNote(`Ребус «${rebus.answer.trim()}» в вопросе. Разгадка для ведущего — кнопкой «Разгадка».`);
      } else {
        onAdded(created);
        setNote(`Ребус лежит в паке: ${created.name}.`);
      }
    } catch (e) {
      setNote(`Не сохранилось: ${cleanError(e)}`);
    } finally {
      setBusy("");
    }
  };

  const copyExplain = async () => {
    if (!explain) return;
    await window.api.clipboardWrite(explain);
    setNote("Разгадка скопирована — вставьте её в комментарий к вопросу.");
  };

  return (
    <div className="ws-body rb-body">
      <div className="ws-side">
        <label className="rb-answer">
          <span className="muted">Ответ</span>
          <input
            value={rebus.answer}
            placeholder="например: колокол"
            onChange={(e) => setRebus((r) => ({ ...r, answer: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter" && !busy) void runSuggest(); }}
            autoFocus
          />
        </label>
        <button className="primary" onClick={() => void runSuggest()} disabled={!!busy}>
          <Icon name="puzzle" />{busy === "suggest" ? "Подбираю…" : "Подобрать разбор"}
        </button>
        <div className="ig-styles">
          <span className="ig-styles-head">Приёмы</span>
          {TECHNIQUES.map((t) => (
            <label key={t.id} className={`ig-style${tech.includes(t.id) ? " sel" : ""}`}>
              <input type="checkbox" checked={tech.includes(t.id)} onChange={() => toggleTech(t.id)} />
              {t.title}
            </label>
          ))}
        </div>
        <div className="rb-found">
          {found.map((s) => (
            <button key={s.label} className="ws-gen" onClick={() => take(s)} title="Взять этот разбор — картинки потом подберёте к каждому куску">
              <b>{s.label}</b>
              <span className="muted">
                картинок: {s.pictures}{s.commas ? ` · запятых: ${s.commas}` : ""}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="ws-main rb-main">
        <div className="rb-stage">
          <canvas ref={view} aria-label={`Ребус: ${rebus.answer}`} />
          {!rebus.pieces.length && <span className="muted rb-empty">Подберите разбор слева или добавьте куски кнопками ниже</span>}
        </div>
        <div className="rb-reads">
          <span>
            Читается: <b>{reads ? reads.toUpperCase() : "—"}</b>
            {rebus.pieces.length > 0 && (ok
              ? <span className="rb-ok"> ✓ сходится с ответом</span>
              : <span className="rb-bad"> ✗ ответ — {fold(rebus.answer).toUpperCase() || "не задан"}</span>)}
          </span>
          {explain && <span className="muted rb-explain">{explain}</span>}
        </div>

        <div className="rb-strip">
          {rebus.pieces.map((p, i) => (
            <span key={p.id} className={`rb-chip${p.id === sel ? " sel" : ""}`}>
              <button className="rb-chip-main" onClick={() => { setSel(p.id); setPart("a"); }} title={`Читается: ${readPiece(p).toUpperCase()}`}>
                {label(p) || "…"}
              </button>
              <button className="small" onClick={() => move(p.id, -1)} disabled={i === 0} aria-label="Левее">←</button>
              <button className="small" onClick={() => move(p.id, 1)} disabled={i === rebus.pieces.length - 1} aria-label="Правее">→</button>
              <button className="small" onClick={() => remove(p.id)} aria-label="Убрать кусок">×</button>
            </span>
          ))}
          <span className="rb-add">
            <button className="small" onClick={() => add(blank("picture"))}><Icon name="plus" size={12} />картинка</button>
            <button className="small" onClick={() => add(blank("letters"))}><Icon name="plus" size={12} />буквы</button>
            <button className="small" onClick={() => add(blank("number"))}><Icon name="plus" size={12} />число</button>
            <button className="small" onClick={() => add(blank("note"))}><Icon name="plus" size={12} />нота</button>
            <button
              className="small"
              onClick={() => add({ id: pieceId(), kind: "relation", prep: "в", a: blank("letters"), b: blank("letters"), order: "prep-b-a" })}
            >
              <Icon name="plus" size={12} />предлог
            </button>
          </span>
        </div>

        <div className="rb-look">
          <label>Высота <input type="range" min={160} max={420} step={10} value={style.height} onChange={(e) => setStyle({ ...style, height: Number(e.target.value) })} /></label>
          <label>Отступ <input type="range" min={0} max={90} step={2} value={style.gap} onChange={(e) => setStyle({ ...style, gap: Number(e.target.value) })} /></label>
          <label className="ig-style">
            <input type="checkbox" checked={style.paper === null} onChange={(e) => setStyle({ ...style, paper: e.target.checked ? null : "#ffffff" })} />
            прозрачный фон
          </label>
        </div>

        {note && <div className="mc-note">{note}</div>}

        <div className="ig-actions">
          <span className="spacer" />
          <button onClick={() => void copyExplain()} disabled={!explain}>Разгадка</button>
          <button onClick={() => void save(false)} disabled={!!busy || !rebus.pieces.length} title="Положить PNG ребуса в Images пака">В пак</button>
          {onInsert && (
            <button
              className="primary"
              onClick={() => void save(true)}
              disabled={!!busy || !ok}
              title={ok ? `Ребус в вопрос, ответ — «${rebus.answer.trim()}»${insertTarget ? `: ${insertTarget}` : ""}` : "Ребус не читается в ответ — вставлять рано"}
            >
              В вопрос{insertTarget ? ` (${insertTarget})` : ""}
            </button>
          )}
        </div>
      </div>

      <div className="rb-props">
        {!selected && <span className="muted">Выберите кусок в ряду под ребусом — здесь его слово, запятые, знаки и картинка.</span>}
        {selected?.kind === "relation" && (
          <RelationEditor rel={selected} part={part} onPart={setPart} onChange={(r) => replace(selected.id, r)} />
        )}
        {editing && (
          <SimpleEditor
            key={editing.id}
            piece={editing}
            onChange={editSimple}
            busy={busy}
            setBusy={setBusy}
            setNote={setNote}
            onOpenAi={onOpenAi}
            nested={selected?.kind === "relation"}
          />
        )}
      </div>
    </div>
  );
}

function RelationEditor({ rel, part, onPart, onChange }: { rel: RelationPiece; part: "a" | "b"; onPart(p: "a" | "b"): void; onChange(r: RelationPiece): void }) {
  return (
    <div className="rb-group">
      <div className="rb-row">
        <span className="muted">Предлог</span>
        <select value={rel.prep} onChange={(e) => onChange({ ...rel, prep: e.target.value as Prep })}>
          {PREPS.map((p) => <option key={p} value={p}>{p.toUpperCase()} — {PREP_HINT[p]}</option>)}
        </select>
      </div>
      <div className="rb-row">
        <span className="muted">Читать</span>
        <select value={rel.order} onChange={(e) => onChange({ ...rel, order: e.target.value as RelationPiece["order"] })}>
          <option value="prep-b-a">{rel.prep} {readPiece(rel.b) || "b"} {readPiece(rel.a) || "a"}</option>
          <option value="a-prep-b">{readPiece(rel.a) || "a"} {rel.prep} {readPiece(rel.b) || "b"}</option>
        </select>
      </div>
      <div className="ws-tabs">
        <button className={part === "a" ? "sel" : ""} onClick={() => onPart("a")}>a: что</button>
        <button className={part === "b" ? "sel" : ""} onClick={() => onPart("b")}>b: где</button>
      </div>
    </div>
  );
}

interface SimpleProps {
  piece: SimplePiece;
  onChange(p: SimplePiece): void;
  busy: string;
  setBusy(b: "" | "search" | "fetch" | "ai"): void;
  setNote(n: string): void;
  onOpenAi?(): void;
  nested?: boolean;
}

function SimpleEditor({ piece: p, onChange, busy, setBusy, setNote, onOpenAi, nested }: SimpleProps) {
  const commas = getOp(p, "commas") ?? { kind: "commas" as const, left: 0, right: 0 };
  const swap = getOp(p, "swap");
  const drop = getOp(p, "drop");
  const pick = getOp(p, "pick");
  const flip = !!getOp(p, "flip");
  const setCommas = (left: number, right: number) =>
    onChange(setOp(p, "commas", left || right ? { kind: "commas", left: Math.max(0, left), right: Math.max(0, right) } : null));

  return (
    <div className="rb-group">
      <div className="rb-row">
        <span className="muted">Кусок</span>
        <select value={p.kind} onChange={(e) => onChange({ ...blank(e.target.value as SimplePiece["kind"]), id: p.id })}>
          {(Object.keys(KIND_TITLE) as SimplePiece["kind"][]).map((k) => <option key={k} value={k}>{KIND_TITLE[k]}</option>)}
        </select>
      </div>

      {p.kind === "picture" && (
        <div className="rb-row">
          <span className="muted">Слово</span>
          <input value={p.word} placeholder="что нарисовано: кот" onChange={(e) => onChange({ ...p, word: e.target.value })} />
        </div>
      )}
      {p.kind === "letters" && (
        <div className="rb-row">
          <span className="muted">Буквы</span>
          <input value={p.shown ?? p.word} placeholder="Л" onChange={(e) => onChange({ ...p, shown: e.target.value, word: e.target.value })} />
        </div>
      )}
      {p.kind === "number" && (
        <>
          <div className="rb-row">
            <span className="muted">Число</span>
            <input
              value={p.shown ?? ""}
              placeholder="40"
              onChange={(e) => {
                const shown = e.target.value.replace(/\D/g, "");
                onChange({ ...p, shown, word: NUMBER_WORDS[shown] ?? p.word });
              }}
            />
          </div>
          <div className="rb-row">
            <span className="muted">Вслух</span>
            <input value={p.word} placeholder="сорок" onChange={(e) => onChange({ ...p, word: e.target.value })} />
          </div>
        </>
      )}
      {p.kind === "note" && (
        <div className="rb-row">
          <span className="muted">Нота</span>
          <select value={p.word} onChange={(e) => onChange({ ...p, word: e.target.value })}>
            {NOTES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      )}

      {p.kind !== "note" && !nested && (
        <>
          <div className="rb-row">
            <span className="muted">Запятые</span>
            <span className="rb-step">
              слева
              <button className="small" onClick={() => setCommas(commas.left - 1, commas.right)} aria-label="Меньше запятых слева">−</button>
              <b>{commas.left}</b>
              <button className="small" onClick={() => setCommas(commas.left + 1, commas.right)} aria-label="Больше запятых слева">+</button>
            </span>
            <span className="rb-step">
              справа
              <button className="small" onClick={() => setCommas(commas.left, commas.right - 1)} aria-label="Меньше запятых справа">−</button>
              <b>{commas.right}</b>
              <button className="small" onClick={() => setCommas(commas.left, commas.right + 1)} aria-label="Больше запятых справа">+</button>
            </span>
          </div>
          <label className="ig-style rb-check">
            <input type="checkbox" checked={flip} onChange={(e) => onChange(setOp(p, "flip", e.target.checked ? { kind: "flip" } : null))} />
            перевернуть — читать наоборот
          </label>
          <div className="rb-row">
            <span className="muted">Замена</span>
            <input
              className="rb-letter"
              value={swap?.from ?? ""}
              maxLength={2}
              placeholder="А"
              onChange={(e) => onChange(setOp(p, "swap", e.target.value || swap?.to ? { kind: "swap", from: e.target.value, to: swap?.to ?? "" } : null))}
            />
            =
            <input
              className="rb-letter"
              value={swap?.to ?? ""}
              maxLength={2}
              placeholder="О"
              onChange={(e) => onChange(setOp(p, "swap", e.target.value || swap?.from ? { kind: "swap", from: swap?.from ?? "", to: e.target.value } : null))}
            />
          </div>
          <div className="rb-row">
            <span className="muted">Зачеркнуть</span>
            <input value={drop?.letters ?? ""} placeholder="буквы: К" onChange={(e) => onChange(setOp(p, "drop", e.target.value ? { kind: "drop", letters: e.target.value } : null))} />
          </div>
          <div className="rb-row">
            <span className="muted">Номера букв</span>
            <input
              value={pick?.idx.join(" ") ?? ""}
              placeholder="1 3 4"
              onChange={(e) => {
                const idx = e.target.value.split(/[\s,]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
                onChange(setOp(p, "pick", idx.length ? { kind: "pick", idx } : null));
              }}
            />
          </div>
        </>
      )}

      {p.kind === "picture" && (
        <PicturePicker piece={p} onChange={onChange} busy={busy} setBusy={setBusy} setNote={setNote} onOpenAi={onOpenAi} />
      )}
    </div>
  );
}

function PicturePicker({ piece: p, onChange, busy, setBusy, setNote, onOpenAi }: Omit<SimpleProps, "nested">) {
  const [src, setSrc] = useState<"search" | "ai" | "file">("search");
  const [query, setQuery] = useState(p.word);
  const [results, setResults] = useState<MediaResult[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setQuery(p.word), [p.word]);

  const setImage = (url: string) => onChange({ ...p, image: { ...p.image, url, name: undefined } });

  const search = async () => {
    if (!query.trim()) return;
    setBusy("search");
    setNote("");
    try {
      const hit = await window.api.mediaSearch({ text: query.trim(), type: "image", perPage: 24 });
      setResults(hit.results);
      if (!hit.results.length) setNote(hit.errors.length ? "Источники не ответили." : "Ничего не нашлось — попробуйте другое слово.");
    } catch (e) {
      setNote(`Поиск не удался: ${cleanError(e)}`);
    } finally {
      setBusy("");
    }
  };

  /**
   * Найденное качаем через главный процесс (так источник и лицензия остаются в source/), читаем байты
   * и сразу убираем из пака: в пак ляжет только готовый ребус, а не десяток заготовок к нему.
   */
  const pickResult = async (r: MediaResult) => {
    setBusy("fetch");
    setNote("Качаю картинку…");
    try {
      const done = await window.api.mediaFetch(r, true);
      if (!done.media) throw new Error("источник не отдал файл");
      const img = await loadPackImage(done.media.folder, done.media.name);
      await window.api.removeMedia(done.media.folder, done.media.name);
      setImage(exportCanvas(applyScale(toCanvas(img), MAX_SIDE), "png", 1));
      setNote("");
    } catch (e) {
      setNote(`Не скачалось: ${cleanError(e)}`);
    } finally {
      setBusy("");
    }
  };

  const drawAi = async () => {
    const word = p.word.trim();
    if (!word) { setNote("Сначала напишите слово."); return; }
    setBusy("ai");
    setNote("Придумываю и рисую…");
    try {
      const scene = await window.api.imagePrompt(word, "literal", 0.3);
      const r = await window.api.imageGenerate(scene.text, 768, 768, false, "", AI_STYLE);
      if ("needPaid" in r) { setNote(`Бесплатные модели не нарисовали: ${r.skipped.join(" · ")}`); return; }
      onChange({ ...p, image: { ...p.image, url: r.dataUrl, name: undefined, cutout: true } });
      setNote(`Нарисовала ${r.model.replace(/^[^:]+:/, "")} за ${(r.ms / 1000).toFixed(1)} с. Фон вырезан — снимите галочку, если съел лишнее.`);
    } catch (e) {
      setNote(`Не нарисовалось: ${cleanError(e)}`);
    } finally {
      setBusy("");
    }
  };

  const fromFile = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setImage(String(reader.result));
    reader.readAsDataURL(f);
  };

  return (
    <div className="rb-pic">
      <div className="ws-tabs">
        <button className={src === "search" ? "sel" : ""} onClick={() => setSrc("search")}><Icon name="globe" />Поиск</button>
        <button className={src === "ai" ? "sel" : ""} onClick={() => setSrc("ai")}><Icon name="palette" />ИИ</button>
        <button className={src === "file" ? "sel" : ""} onClick={() => setSrc("file")}><Icon name="folder" />Файл</button>
      </div>

      {src === "search" && (
        <>
          <div className="rb-row">
            <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} />
            <button onClick={() => void search()} disabled={!!busy}>{busy === "search" ? "Ищу…" : "Найти"}</button>
          </div>
          <div className="rb-thumbs">
            {results.map((r) => (
              <button key={`${r.providerId}:${r.id}`} onClick={() => void pickResult(r)} disabled={!!busy} title={`${r.title}${r.license ? ` · ${r.license}` : ""}`}>
                <img src={r.thumbUrl ?? r.previewUrl} alt={r.title} loading="lazy" onError={(e) => { e.currentTarget.parentElement!.hidden = true; }} />
              </button>
            ))}
          </div>
        </>
      )}
      {src === "ai" && (
        <div className="rb-row">
          <button className="primary" onClick={() => void drawAi()} disabled={!!busy}>{busy === "ai" ? "Рисую…" : `Нарисовать «${p.word || "…"}»`}</button>
          {onOpenAi && <button className="small" onClick={onOpenAi}><Icon name="gear" />Модели</button>}
        </div>
      )}
      {src === "file" && (
        <div className="rb-row">
          <button onClick={() => fileRef.current?.click()}>Выбрать файл…</button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => fromFile(e.target.files?.[0])} />
        </div>
      )}

      {p.image && (
        <div className="rb-row">
          <label className="ig-style">
            <input type="checkbox" checked={!!p.image.cutout} onChange={(e) => onChange({ ...p, image: { ...p.image, cutout: e.target.checked } })} />
            вырезать фон
          </label>
          <label className="ig-style">
            <input type="checkbox" checked={!!p.image.mirror} onChange={(e) => onChange({ ...p, image: { ...p.image, mirror: e.target.checked } })} />
            зеркально
          </label>
          <button className="small" onClick={() => onChange({ ...p, image: undefined })}>убрать</button>
        </div>
      )}
    </div>
  );
}


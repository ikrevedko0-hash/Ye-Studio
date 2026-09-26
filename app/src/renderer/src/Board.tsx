import { useEffect, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { decorateThemeName, hasEmoji, themeNameParts } from "../../core/siq/themeEmoji";
import { isPointQuestion, itemKind, newQuestion, pointProblems, newTheme, questionItems, questionText, slotStatus, SPECIAL_SHORT, SPECIAL_TYPES } from "../../core/siq/helpers";
import type { Slot } from "../../core/siq/board";
import type { Question, Round } from "../../core/siq/model";
import type { MediaInfo } from "../../shared/api";
import type { Mutate, Selection } from "./App";
import { Icon } from "./Icon";

interface Props {
  round: Round;
  roundIndex: number;
  media: MediaInfo[];
  selection: Selection | null;
  onSelect(s: Selection): void;
  mutate: Mutate;
  /** перенести тему в другой пак (копией или вырезанием) */
  onTransfer?(themeIndex: number): void;
  /** перетащили клетку: вопрос встаёт на место to */
  onMove?(from: Slot, to: Slot): void;
  /** имена view-transition на время перестановки («тема-место» → имя) */
  vtNames?: Map<string, string> | null;
  /** названия всех раундов пака — для переноса темы */
  rounds?: string[];
  onThemeToRound?(themeIndex: number, toRound: number): void;
}

/** Тему тащат на вкладку раунда; данные — «раунд:тема». Читает RoundTabs. */
export const THEME_DRAG_TYPE = "application/x-siq-theme";

/** Своё перетаскивание отличаем от файлов, которые тащат в окно из проводника. */
const DRAG_TYPE = "application/x-siq-question";

interface DragProps {
  draggable: boolean;
  dragging: boolean;
  over: boolean;
  onDragStart(e: React.DragEvent): void;
  onDragEnd(): void;
  onDragOver(e: React.DragEvent): void;
  onDrop(e: React.DragEvent): void;
}

const KIND_ICON: Record<string, string> = { image: "▣", audio: "♪", video: "▶" };

function Cell({ q, selected, onClick, vt, i, drag }: { q: Question; selected: boolean; onClick(): void; vt: string; i: number; drag: DragProps }) {
  const status = slotStatus(q);
  const kinds = [...new Set(questionItems(q).map(itemKind).filter((k) => k !== "text"))];
  const text = questionText(q);
  const point = isPointQuestion(q);
  const right = point ? q.right.slice(1) : q.right;
  const tip = [
    q.type ? SPECIAL_TYPES[q.type] ?? q.type : "",
    text,
    point ? ["Ответ точкой на картинке", ...pointProblems(q).map((p) => `⚠ ${p}`)].join("\n") : "",
    right.filter(Boolean).length ? `Ответ: ${right.filter(Boolean).join(" / ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <button
      className={`cell ${status}${selected ? " selected" : ""}${drag.dragging ? " dragging" : ""}${drag.over ? " drop-target" : ""}`}
      onClick={onClick}
      title={tip}
      style={{ viewTransitionName: vt, "--i": i } as CSSProperties}
      draggable={drag.draggable}
      onDragStart={drag.onDragStart}
      onDragEnd={drag.onDragEnd}
      onDragOver={drag.onDragOver}
      onDrop={drag.onDrop}
    >
      <span className="price">{q.price}</span>
      {q.type && <span className="badge">{SPECIAL_SHORT[q.type] ?? q.type}</span>}
      <span className="kinds">{[...kinds.map((k) => KIND_ICON[k] ?? ""), point ? "⌖" : ""].filter(Boolean).join(" ")}</span>
    </button>
  );
}

/**
 * Как разложить табло в доступную ширину. Редактор вопроса справа тянут мышью, и табло
 * должно ужиматься, а не уезжать под прокрутку:
 *   rows  — классика: название темы слева, клетки в строку;
 *   stack — клеткам тесно: название уходит полосой над своими клетками, клетки берут всю ширину;
 *   wrap  — совсем узко: клетки переносятся на следующие строки.
 */
type Layout = "rows" | "stack" | "wrap";

const GAP = 6;
const ADD_COL = 32;
/** Меньше этой ширины цена в клетке уже не читается. */
const ROW_MIN_CELL = 60;
const STACK_MIN_CELL = 46;
const WRAP_CELL = 56;

function measure(width: number, n: number): { layout: Layout; cell: number; themeCol: number; cols: number } {
  const themeCol = Math.round(Math.min(260, Math.max(130, width * 0.24)));
  const rowCell = (width - themeCol - ADD_COL - GAP * (n + 1)) / n;
  if (rowCell >= ROW_MIN_CELL) return { layout: "rows", cell: rowCell, themeCol, cols: n };
  const stackCell = (width - ADD_COL - GAP * n) / n;
  if (stackCell >= STACK_MIN_CELL) return { layout: "stack", cell: stackCell, themeCol, cols: n };
  // Ряды ровные: семь клеток при шести влезающих ложатся 4 + 3, а не 6 + 1 с сиротой «700».
  const fit = Math.max(1, Math.floor((width + GAP) / (WRAP_CELL + GAP)));
  const cols = Math.ceil(n / Math.ceil(n / fit));
  return { layout: "wrap", cell: Math.min(90, (width - GAP * (cols - 1)) / cols), themeCol, cols };
}

/** Раскладку меняем через View Transitions: клетки плавно переезжают на новые места, а не прыгают. */
type WithTransition = Document & { startViewTransition?: (cb: () => void) => unknown };

export function Board({ round, roundIndex, selection, onSelect, mutate, onTransfer, onMove, vtNames, rounds, onThemeToRound }: Props) {
  const themes = round.themes ?? [];
  const isFinal = round.type === "final";
  const maxQ = Math.max(1, ...themes.map((t) => t.questions?.length ?? 0));

  const wrapRef = useRef<HTMLElement>(null);
  const [layout, setLayout] = useState<Layout>("rows");
  const [size, setSize] = useState({ cell: 90, themeCol: 220, cols: maxQ });
  const layoutRef = useRef<Layout | null>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => {
      const pad = parseFloat(getComputedStyle(el).paddingLeft) * 2 || 0;
      const m = measure(el.clientWidth - pad, maxQ);
      setSize({ cell: m.cell, themeCol: m.themeCol, cols: m.cols });
      if (m.layout === layoutRef.current) return;
      const first = layoutRef.current === null;
      layoutRef.current = m.layout;
      const doc = document as WithTransition;
      // первая раскладка — без анимации; дальше перегруппировка анимируется
      if (first || !doc.startViewTransition) setLayout(m.layout);
      else doc.startViewTransition(() => flushSync(() => setLayout(m.layout)));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxQ]);

  const columns =
    layout === "rows" ? `${size.themeCol}px repeat(${maxQ}, minmax(0, 1fr)) ${ADD_COL}px`
    : layout === "stack" ? `repeat(${maxQ}, minmax(0, 1fr)) ${ADD_COL}px`
    : `repeat(${size.cols}, minmax(0, 1fr))`;
  const boardStyle = { "--cell-w": `${Math.round(size.cell)}px` } as CSSProperties;

  // window.prompt в Electron не работает — переименовываем прямо в клетке
  const [editing, setEditing] = useState<{ ti: number; value: string } | null>(null);
  const done = useRef(false);
  useEffect(() => setEditing(null), [roundIndex]);

  const startEdit = (ti: number, name: string) => { done.current = false; setEditing({ ti, value: name ?? "" }); };

  // фиксируем и по Enter, и по потере фокуса; done защищает от второго вызова
  const commit = () => {
    if (!editing || done.current) return;
    done.current = true;
    const { ti } = editing;
    // название темы — с большой буквы (остальные буквы не трогаем: «iPhone» или «ДНК» автор пишет сам)
    // и цветные эмодзи по смыслу перед и после, если автор своих не поставил
    const value = decorateThemeName(editing.value.replace(/^(\s*)(\p{Ll})/u, (_, sp: string, ch: string) => sp + ch.toUpperCase()));
    setEditing(null);
    if (themes[ti] && value !== themes[ti].name) mutate((p) => { p.rounds![roundIndex].themes![ti].name = value; });
  };

  const cancel = () => { done.current = true; setEditing(null); };

  // названия тем бывают длинными — поле растёт по содержимому
  const fit = (el: HTMLTextAreaElement) => { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; };

  // перетаскивание клеток: откуда тащим и над каким местом сейчас
  const [dragFrom, setDragFrom] = useState<Slot | null>(null);
  const [dragOver, setDragOver] = useState<Slot | null>(null);
  useEffect(() => { setDragFrom(null); setDragOver(null); }, [roundIndex]);

  const dropProps = (to: Slot) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragFrom || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragOver?.theme !== to.theme || dragOver.question !== to.question) setDragOver(to);
    },
    onDrop: (e: React.DragEvent) => {
      if (!dragFrom || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      const from = dragFrom;
      setDragFrom(null);
      setDragOver(null);
      onMove?.(from, to);
    },
  });

  const dragProps = (ti: number, qi: number): DragProps => ({
    draggable: !!onMove && editing === null,
    dragging: dragFrom?.theme === ti && dragFrom.question === qi,
    over: dragOver?.theme === ti && dragOver.question === qi && !(dragFrom?.theme === ti && dragFrom.question === qi),
    onDragStart: (e) => {
      e.dataTransfer.setData(DRAG_TYPE, `${ti}:${qi}`);
      e.dataTransfer.effectAllowed = "move";
      setDragFrom({ theme: ti, question: qi });
    },
    onDragEnd: () => { setDragFrom(null); setDragOver(null); },
    ...dropProps({ theme: ti, question: qi }),
  });

  const addTheme = () =>
    mutate((p) => {
      const r = p.rounds![roundIndex];
      const prices = isFinal ? [0] : (r.themes?.[0]?.questions ?? []).map((q) => Number(q.price) || 0);
      (r.themes ??= []).push(newTheme(`Тема ${(r.themes?.length ?? 0) + 1}`, prices.length ? prices : [100, 200, 300, 400, 500]));
    });

  const removeTheme = (ti: number) => {
    if (window.confirm(`Удалить тему «${themes[ti].name}» со всеми вопросами?`)) mutate((p) => { p.rounds![roundIndex].themes!.splice(ti, 1); });
  };

  const addQuestion = (ti: number) =>
    mutate((p) => {
      const qs = (p.rounds![roundIndex].themes![ti].questions ??= []);
      const last = Number(qs[qs.length - 1]?.price ?? 0);
      const step = qs.length > 1 ? last - Number(qs[qs.length - 2].price) : 100;
      qs.push(newQuestion(isFinal ? 0 : last + (step || 100)));
    });

  return (
    <section className="board-wrap" ref={wrapRef}>
      <div className={`board layout-${layout}`} style={boardStyle}>
        {themes.map((t, ti) => (
          // у каждой строки своя сетка с одинаковым шаблоном — колонки совпадают, а в узких
          // раскладках название темы может занять всю строку над клетками
          <div className="board-row" key={ti} style={{ gridTemplateColumns: columns }}>
            <div className="theme-name" style={{ viewTransitionName: `bt-${ti}` }}>
              {/* за название тянуть нельзя — щелчок по нему открывает переименование; тянут за ручку */}
              {onThemeToRound && editing?.ti !== ti && (
                <span
                  className="theme-grip"
                  draggable
                  title="Тяните на вкладку раунда, чтобы перенести тему туда"
                  onDragStart={(e) => { e.dataTransfer.setData(THEME_DRAG_TYPE, `${roundIndex}:${ti}`); e.dataTransfer.effectAllowed = "move"; }}
                >⠿</span>
              )}
              {editing?.ti === ti ? (
                <textarea
                  className="theme-input"
                  rows={1}
                  ref={(el) => { if (el) { fit(el); if (document.activeElement !== el) { el.focus(); el.select(); } } }}
                  value={editing.value}
                  onChange={(e) => { setEditing({ ti, value: e.target.value }); fit(e.currentTarget); }}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commit(); }
                    else if (e.key === "Escape") { e.preventDefault(); cancel(); }
                  }}
                />
              ) : (
                <span
                  className="theme-title"
                  tabIndex={0}
                  title="Щелчок — переименовать"
                  onClick={() => startEdit(ti, t.name)}
                  onFocus={() => startEdit(ti, t.name)}
                >
                  {t.name
                    ? themeNameParts(t.name).map((p, k) => p.emoji ? <span key={k} className="emo">{p.text}</span> : p.text)
                    : <i>без названия</i>}
                </span>
              )}
              {/* кнопки плавают поверх названия и не отнимают у него ширину */}
              <span className="theme-tools">
              {onThemeToRound && rounds && rounds.length > 1 && (
                // выпадающий список вместо меню: закрытый показывает только стрелку
                <select
                  className="icon-select"
                  value=""
                  title="Перенести тему в другой раунд этого пака"
                  onChange={(e) => { if (e.target.value !== "") onThemeToRound(ti, Number(e.target.value)); }}
                >
                  <option value="" disabled hidden>↪</option>
                  {rounds.map((name, ri) => ri !== roundIndex && <option key={ri} value={ri}>в раунд «{name}»</option>)}
                </select>
              )}
              {onTransfer && <button className="icon" onClick={() => onTransfer(ti)} title="Копировать или вырезать тему в другой пак (новый или существующий)">⇄</button>}
              <button className="icon" onClick={() => removeTheme(ti)} title="Удалить тему">×</button>
              </span>
            </div>
            {Array.from({ length: maxQ }, (_, qi) => {
              const q = t.questions?.[qi];
              return q ? (
                <Cell
                  key={qi}
                  vt={vtNames?.get(`${ti}-${qi}`) ?? `bq-${ti}-${qi}`}
                  drag={dragProps(ti, qi)}
                  i={qi}
                  q={q}
                  selected={selection?.round === roundIndex && selection.theme === ti && selection.question === qi}
                  onClick={() => onSelect({ round: roundIndex, theme: ti, question: qi })}
                />
              ) : (
                // пустое место в конце темы — бросить сюда значит «в конец темы»
                <div
                  key={qi}
                  className={`cell none${dragOver?.theme === ti && dragOver.question === (t.questions?.length ?? 0) ? " drop-target" : ""}`}
                  {...dropProps({ theme: ti, question: t.questions?.length ?? 0 })}
                />
              );
            })}
            <button className="icon add-q" onClick={() => addQuestion(ti)} title="Добавить вопрос в тему" {...dropProps({ theme: ti, question: t.questions?.length ?? 0 })}>+</button>
          </div>
        ))}
      </div>
      <div className="board-actions">
        <button className="add-theme" onClick={addTheme}>+ Тема</button>
        {themes.some((t) => t.name.trim() && !hasEmoji(t.name)) && (
          <button className="add-theme" title="Каждой теме раунда без эмодзи — пара по смыслу названия: перед и после"
            onClick={() => mutate((p) => { for (const t of p.rounds![roundIndex].themes ?? []) t.name = decorateThemeName(t.name); })}>
            <Icon name="helper" />Эмодзи всем темам
          </button>
        )}
      </div>
      <p className="legend">
        Клетки можно перетаскивать — вопрос берёт цену нового места.{"  "}
        Полоска снизу: <span className="nowrap"><span className="dot draft" /> черновик</span> <span className="nowrap"><span className="dot empty" /> пусто</span> <span>у готовых полоски нет.</span>
        {"  "}▣ картинка ♪ звук ▶ видео
      </p>
    </section>
  );
}

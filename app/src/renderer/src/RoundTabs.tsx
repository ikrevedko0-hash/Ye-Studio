import { useRef, useState } from "react";
import { newRound } from "../../core/siq/helpers";
import type { Round } from "../../core/siq/model";
import type { Mutate } from "./App";
import { THEME_DRAG_TYPE } from "./Board";

interface Props {
  rounds: Round[];
  current: number;
  mutate: Mutate;
  onPick(i: number): void;
  /** раунды переставили: map — куда уехал раунд со старым номером */
  onMoved(map: (i: number) => number): void;
  onRemoved(i: number): void;
  /** на вкладку бросили тему с табло */
  onThemeDrop?(fromRound: number, themeIndex: number, toRound: number): void;
}

const DRAG_TYPE = "application/x-siq-round";

/** Новый обычный раунд: столько же тем, сколько в предыдущем обычном, цены — ступенью выше. */
function makeRound(rounds: Round[]): Round {
  const regular = rounds.filter((r) => r.type !== "final");
  const n = regular.length + 1;
  const prev = regular[regular.length - 1];
  const themes = prev?.themes?.length || 6;
  const count = prev?.themes?.[0]?.questions?.length || 5;
  return newRound(`Раунд ${n}`, themes, Array.from({ length: count }, (_, i) => (i + 1) * 100 * n));
}

export function RoundTabs({ rounds, current, mutate, onPick, onMoved, onRemoved, onThemeDrop }: Props) {
  // window.prompt в Electron не работает — переименовываем прямо во вкладке
  const [editing, setEditing] = useState<{ i: number; value: string } | null>(null);
  const done = useRef(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [themeOver, setThemeOver] = useState<number | null>(null);

  const startEdit = (i: number) => { done.current = false; setEditing({ i, value: rounds[i].name ?? "" }); };

  const commit = () => {
    if (!editing || done.current) return;
    done.current = true;
    const { i, value } = editing;
    setEditing(null);
    if (rounds[i] && value !== rounds[i].name) mutate((p) => { p.rounds![i].name = value; });
  };

  const add = () => {
    // обычный раунд встаёт перед финалом, если финал в конце
    const at = rounds.length && rounds[rounds.length - 1].type === "final" ? rounds.length - 1 : rounds.length;
    const r = makeRound(rounds);
    mutate((p) => { (p.rounds ??= []).splice(at, 0, r); });
    onPick(at);
  };

  const remove = (i: number) => {
    const qs = (rounds[i].themes ?? []).reduce((n, t) => n + (t.questions?.length ?? 0), 0);
    if (!window.confirm(`Удалить раунд «${rounds[i].name || `Раунд ${i + 1}`}» (тем ${rounds[i].themes?.length ?? 0}, вопросов ${qs})?`)) return;
    mutate((p) => { p.rounds!.splice(i, 1); });
    onRemoved(i);
  };

  const move = (from: number, to: number) => {
    if (from === to) return;
    mutate((p) => {
      const [r] = p.rounds!.splice(from, 1);
      p.rounds!.splice(to, 0, r);
    });
    onMoved((i) => {
      if (i === from) return to;
      if (from < to && i > from && i <= to) return i - 1;
      if (from > to && i >= to && i < from) return i + 1;
      return i;
    });
  };

  return (
    <nav className="round-tabs">
      {rounds.map((r, i) => (
        <div
          key={i}
          className={`round-tab${over === i && dragFrom !== i ? " drop-target" : ""}${themeOver === i ? " theme-drop" : ""}`}
          onDragOver={(e) => {
            // тема с табло: бросить на вкладку другого раунда
            if (e.dataTransfer.types.includes(THEME_DRAG_TYPE)) {
              if (i === current) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (themeOver !== i) setThemeOver(i);
              return;
            }
            if (dragFrom === null || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
            e.preventDefault();
            if (over !== i) setOver(i);
          }}
          onDragLeave={() => setThemeOver(null)}
          onDrop={(e) => {
            if (e.dataTransfer.types.includes(THEME_DRAG_TYPE)) {
              e.preventDefault();
              setThemeOver(null);
              const [from, ti] = e.dataTransfer.getData(THEME_DRAG_TYPE).split(":").map(Number);
              if (Number.isInteger(from) && Number.isInteger(ti)) onThemeDrop?.(from, ti, i);
              return;
            }
            if (dragFrom === null || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
            e.preventDefault();
            move(dragFrom, i);
            setDragFrom(null);
            setOver(null);
          }}
        >
          {editing?.i === i ? (
            <input
              className="round-input"
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              value={editing.value}
              placeholder={`Раунд ${i + 1}`}
              onChange={(e) => setEditing({ i, value: e.target.value })}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commit(); }
                else if (e.key === "Escape") { e.preventDefault(); done.current = true; setEditing(null); }
              }}
            />
          ) : (
            <button
              className={i === current ? "active" : ""}
              draggable
              title="Двойной щелчок — переименовать. Тяните — переставить раунд"
              onClick={() => onPick(i)}
              onDoubleClick={() => startEdit(i)}
              onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, String(i)); e.dataTransfer.effectAllowed = "move"; setDragFrom(i); }}
              onDragEnd={() => { setDragFrom(null); setOver(null); }}
            >
              {r.name || `Раунд ${i + 1}`}{r.type === "final" ? " ★" : ""}
            </button>
          )}
          {/* место под ✎ и × есть у каждой вкладки, у неактивных — пустое: щелчок по вкладке не сдвигает соседей и «+ Раунд» */}
          {editing?.i !== i && (
            <span className={`round-tools${i === current ? "" : " idle"}`}>
              <button className="icon" tabIndex={i === current ? 0 : -1} onClick={() => startEdit(i)} title="Переименовать раунд">✎</button>
              <button className="icon" tabIndex={i === current ? 0 : -1} onClick={() => remove(i)} title="Удалить раунд">×</button>
            </span>
          )}
        </div>
      ))}
      <button className="add-round" onClick={add} title="Добавить обычный раунд (встанет перед финалом)">+ Раунд</button>
    </nav>
  );
}

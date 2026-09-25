import { useState } from "react";
import { themeMediaRefs } from "../../core/siq/helpers";
import type { Theme } from "../../core/siq/model";
import type { TargetPack, ThemeTransferResult } from "../../shared/api";

// Перенос темы в другой пак: копия или вырезание, в новый пак или в существующий.
// Файлы темы (картинки, звук, видео) едут вместе с ней — это делает главный процесс.

export function ThemeTransfer({ theme, final, onClose, onDone }: {
  theme: Theme;
  /** тема из финального раунда: новый пак получит финал, а не обычный раунд */
  final: boolean;
  onClose(): void;
  /** cut — тему надо убрать из открытого пака */
  onDone(result: ThemeTransferResult, cut: boolean): void;
}) {
  const [cut, setCut] = useState(false);
  const [mode, setMode] = useState<"new" | "file">("new");
  const [packName, setPackName] = useState(theme.name);
  const [target, setTarget] = useState<TargetPack | null>(null);
  const [round, setRound] = useState(0);
  const [roundName, setRoundName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const files = themeMediaRefs(theme).length;
  const questions = theme.questions?.length ?? 0;

  const pick = async () => {
    setError("");
    try {
      const t = await window.api.pickTargetPack();
      if (!t) return;
      setTarget(t);
      setMode("file");
      // по умолчанию — раунд того же вида: финал к финалу, обычный к первому обычному
      const same = t.rounds.findIndex((r) => r.final === final);
      setRound(same >= 0 ? same : -1);
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    }
  };

  const go = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await window.api.transferTheme(theme, mode === "new"
        ? { mode: "new", packName: packName.trim() || theme.name, final }
        : { mode: "file", path: target!.path, round, roundName });
      if (r) onDone(r, cut);
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="theme-transfer">
        <header>
          <b>Тема «{theme.name}» в другой пак</b>
          <span className="spacer" />
          <button className="icon" onClick={onClose} disabled={busy} title="Закрыть">×</button>
        </header>
        <p className="muted">{questions} вопр. · файлов: {files} — поедут вместе с темой</p>

        <div className="tt-group">
          <label className="check"><input type="radio" checked={!cut} onChange={() => setCut(false)} /> Копировать — тема останется и здесь</label>
          <label className="check"><input type="radio" checked={cut} onChange={() => setCut(true)} /> Вырезать — убрать из этого пака после переноса</label>
        </div>

        <div className="tt-group">
          <label className="check"><input type="radio" checked={mode === "new"} onChange={() => setMode("new")} /> В новый пак</label>
          {mode === "new" && (
            <label className="tt-sub">
              Название пака
              <input value={packName} onChange={(e) => setPackName(e.target.value)} />
              <span className="muted">Файл выберете при переносе. В паке будет один {final ? "финальный " : ""}раунд с этой темой.</span>
            </label>
          )}
          <label className="check"><input type="radio" checked={mode === "file"} disabled={!target} onChange={() => setMode("file")} /> В существующий пак</label>
          <div className="tt-sub">
            <div className="row-inline">
              <button className="small" onClick={() => void pick()} disabled={busy}>Выбрать пак…</button>
              {target && <span title={target.path}><b>{target.name}</b></span>}
            </div>
            {mode === "file" && target && (
              <>
                <label>
                  В раунд
                  <select value={round} onChange={(e) => setRound(Number(e.target.value))}>
                    {target.rounds.map((r, i) => <option key={i} value={i}>{r.name}{r.final ? " (финал)" : ""} — тем: {r.themes}</option>)}
                    <option value={-1}>+ новый раунд</option>
                  </select>
                </label>
                {round === -1 && (
                  <label>
                    Название раунда
                    <input value={roundName} placeholder={`Раунд ${target.rounds.length + 1}`} onChange={(e) => setRoundName(e.target.value)} />
                  </label>
                )}
                {round >= 0 && target.rounds[round] && target.rounds[round].final !== final && (
                  <span className="tt-warn">{final ? "Тема из финала идёт в обычный раунд: цены у вопросов 0 — поправьте их там." : "Обычная тема идёт в финал: в финале у вопросов цена 0."}</span>
                )}
              </>
            )}
          </div>
        </div>

        {error && <div className="tt-error">{error}</div>}
        <footer>
          <span className="muted">Открытый сейчас пак {cut ? "станет несохранённым — сохраните его после вырезания" : "не меняется"}.</span>
          <span className="spacer" />
          <button onClick={onClose} disabled={busy}>Отмена</button>
          <button className="primary" onClick={() => void go()} disabled={busy || (mode === "file" && !target)}>
            {busy ? "Переношу…" : cut ? "Вырезать и перенести" : "Скопировать"}
          </button>
        </footer>
      </div>
    </div>
  );
}

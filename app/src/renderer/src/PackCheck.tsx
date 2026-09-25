// «Проверить пак»: всё, на чём пак споткнётся в игре или на FirePacks, одним списком (core/siq/check.ts).
// Щелчок по строке с местом — переход к вопросу, окно закрывается.

import { useMemo } from "react";
import { checkPack, type CheckIssue } from "../../core/siq/check";
import type { PackDTO } from "../../shared/api";

const MARK: Record<CheckIssue["level"], string> = { error: "Ошибка", warn: "Внимание", info: "Совет" };

export function PackCheck({ pack, onGo, onPackSize, onSigame, onClose }: {
  pack: PackDTO;
  onGo(at: NonNullable<CheckIssue["at"]>): void;
  onPackSize(): void;
  onSigame(): void;
  onClose(): void;
}) {
  const issues = useMemo(() => checkPack(pack.pkg, pack.media), [pack]);
  const errors = issues.filter((i) => i.level === "error").length;
  const warns = issues.filter((i) => i.level === "warn").length;

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pack-check">
        <header>
          <b>Проверка пака</b>
          <span className={errors ? "pc-bad" : "pc-ok"}>
            {errors ? `ошибок: ${errors}` : "ошибок нет"}{warns ? ` · внимание: ${warns}` : ""}
          </span>
          <span className="spacer" />
          <button className="icon" onClick={onClose} title="Закрыть">×</button>
        </header>
        {issues.length === 0 && <p className="pc-empty">Всё чисто — можно играть и выкладывать.</p>}
        <ul className="pc-list">
          {issues.map((i, k) => (
            <li key={k} className={`pc-${i.level}`}>
              <span className="pc-mark">{MARK[i.level]}</span>
              {i.at ? (
                <button className="link inline pc-text" onClick={() => onGo(i.at!)} title="Перейти">{i.text} ›</button>
              ) : (
                <span className="pc-text">{i.text}</span>
              )}
            </li>
          ))}
        </ul>
        <footer>
          <button onClick={onPackSize}>Объём пака…</button>
          <span className="spacer" />
          <button className="primary" onClick={onSigame} title="Сохранить, запустить SIGame и положить путь к паку в буфер обмена">
            Открыть в SIGame
          </button>
        </footer>
      </div>
    </div>
  );
}

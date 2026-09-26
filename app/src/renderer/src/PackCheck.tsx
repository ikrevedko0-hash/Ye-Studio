// «Проверить пак»: всё, на чём пак споткнётся в игре или на FirePacks, одним списком (core/siq/check.ts).
// Щелчок по строке с местом — переход к вопросу, окно закрывается.
// «Повторы на FirePacks» — по кнопке: вопросы уходят на сервер автора (server/packindex), ответ — где такое уже было.

import { useMemo, useState } from "react";
import { checkPack, type CheckIssue } from "../../core/siq/check";
import type { DupHit, DupReport } from "../../core/siq/dupCheck";
import type { PackDTO } from "../../shared/api";

const MARK: Record<CheckIssue["level"], string> = { error: "Ошибка", warn: "Внимание", info: "Совет" };

const DUP_MARK: Record<DupHit["kind"], [string, string]> = {
  exact: ["Дословно", "pc-error"],
  media: ["Тот же файл", "pc-error"],
  answer: ["Тот же ответ", "pc-warn"],
};

const day = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" }) : "");
const baseDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) : "?");

/** Результат живёт в App: окно закрывается при переходе к вопросу, а сверка с сервером не должна пропадать. */
export interface DupState { report?: DupReport; exclude: number[]; error?: string; busy?: boolean }

export function PackCheck({ pack, dups, setDups, onGo, onPackSize, onSigame, onClose }: {
  pack: PackDTO;
  dups: DupState;
  setDups(d: DupState): void;
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
        <DupSection pack={pack} dups={dups} setDups={setDups} onGo={onGo} />
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

function DupSection({ pack, dups, setDups, onGo }: {
  pack: PackDTO;
  dups: DupState;
  setDups(d: DupState): void;
  onGo(at: NonNullable<CheckIssue["at"]>): void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const run = async (exclude = dups.exclude) => {
    setDups({ ...dups, exclude, busy: true, error: undefined });
    const r = await window.api.dupCheck(pack.pkg, exclude).catch(() => ({ ok: false as const, message: "Проверка не запустилась" }));
    setDups(r.ok ? { report: r.report, exclude } : { report: dups.report, exclude, error: r.message });
    setOpen(null);
  };
  const rep = dups.report;
  const red = rep?.hits.filter((h) => h.kind !== "answer").length ?? 0;
  const orange = (rep?.hits.length ?? 0) - red;

  return (
    <section className="pc-dups">
      <header>
        <b>Повторы на FirePacks</b>
        {rep && !dups.busy && (
          <span className={red ? "pc-bad" : orange ? "pc-warn-text" : "pc-ok"}>
            {rep.hits.length ? `совпадений: ${rep.hits.length}` : "совпадений нет"}
          </span>
        )}
        <span className="spacer" />
        {rep && <span className="pc-note">база от {baseDate(rep.base.builtAt)}: {rep.base.packs.toLocaleString("ru-RU")} паков</span>}
        <button onClick={() => void run()} disabled={dups.busy}
          title="Отправить вопросы пака на сервер Ye!Studio и сверить со всеми паками FirePacks. Текст там не сохраняется.">
          {dups.busy ? "Сверяю…" : rep ? "Проверить ещё раз" : "Найти повторы"}
        </button>
      </header>
      {dups.error && <p className="pc-dup-error">{dups.error}</p>}
      {!rep && !dups.error && !dups.busy && (
        <p className="pc-empty">Сверит вопросы, ответы и файлы со всеми паками FirePacks и покажет, где такое уже было.</p>
      )}
      {rep && rep.similar.map((s) => (
        <p key={s.pack} className="pc-similar">
          С паком <a href={s.url} target="_blank" rel="noreferrer">«{s.name}»</a> совпадает вопросов: {s.count}.{" "}
          <button className="link inline" onClick={() => void run([...dups.exclude, s.pack])}
            title="Если это ваш же пак, выложенный раньше, — не считать его совпадения">Это мой пак — не считать</button>
        </p>
      ))}
      {rep && rep.hits.length > 0 && (
        <ul className="pc-list pc-dup-list">
          {rep.hits.map((h, k) => {
            const [mark, cls] = DUP_MARK[h.kind];
            const first = h.where[0];
            return (
              <li key={k} className={cls}>
                <span className="pc-mark">{mark}</span>
                <div className="pc-dup-body">
                  <button className="link inline pc-text" onClick={() => onGo(h.at)} title="Перейти к вопросу">
                    {h.label}{h.answer ? `: ${h.answer}` : ""} ›
                  </button>
                  {first && (
                    <span className="pc-dup-where">
                      было в <a href={first.url} target="_blank" rel="noreferrer">«{first.name}»</a>
                      {first.theme ? ` / ${first.theme}` : ""}{first.price !== null ? ` / ${first.price}` : ""}
                      {first.date ? `, ${day(first.date)}` : ""}
                      {h.total > 1 && (
                        <button className="link inline" onClick={() => setOpen(open === k ? null : k)}>
                          {open === k ? " скрыть" : ` и ещё ${h.total - 1}`}
                        </button>
                      )}
                    </span>
                  )}
                  {open === k && (
                    <ul className="pc-dup-more">
                      {h.where.slice(1).map((w, i) => (
                        <li key={i}>
                          <a href={w.url} target="_blank" rel="noreferrer">«{w.name}»</a>
                          {w.theme ? ` / ${w.theme}` : ""}{w.price !== null ? ` / ${w.price}` : ""}{w.date ? `, ${day(w.date)}` : ""}
                        </li>
                      ))}
                      {h.total > h.where.length && <li className="pc-note">и ещё {h.total - h.where.length} — показаны самые ранние</li>}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {dups.exclude.length > 0 && rep && (
        <p className="pc-note">
          Не считаются паков: {dups.exclude.length}. <button className="link inline" onClick={() => void run([])}>Вернуть</button>
        </p>
      )}
    </section>
  );
}

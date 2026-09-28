// «Прогон в SIGame»: пак играется настоящим движком SIGame и показывается настоящим столом SIOnline
// на экранах телефона и компьютера (core/sigame, main/sigameRun.ts). Здесь — прогресс и отчёт:
// беды пака целиком, потом по вопросам — беды и снимки экранов. Щелчок по вопросу — переход к нему.
// Результат живёт в App (как проверка повторов): окно закрывается при переходе, а отчёт остаётся.

import { useEffect, useMemo, useState } from "react";
import type { SigameProgress } from "../../core/sigame/run";
import { PROFILES, type QuestionReport, type SigameIssue, type SigameReport } from "../../core/sigame/report";
import type { CheckIssue } from "../../core/siq/check";
import type { PackDTO } from "../../shared/api";

export interface SigameState {
  busy?: boolean;
  progress?: SigameProgress;
  result?: { run: string; report: SigameReport; at: number };
  error?: string;
}

const MARK: Record<SigameIssue["level"], string> = { error: "Ошибка", warn: "Внимание", info: "Совет" };
const PROFILE_TITLE = Object.fromEntries(PROFILES.map((p) => [p.id, p.title])) as Record<string, string>;
const SOURCE: Record<SigameIssue["source"], string> = {
  engine: "сказал движок SIGame",
  table: "видно на столе SIOnline",
  rules: "по правилам: iPhone в прогоне не проверить",
};

function where(pack: PackDTO, at: NonNullable<CheckIssue["at"]>): string {
  const r = pack.pkg.rounds?.[at.round];
  const t = at.theme !== undefined ? r?.themes?.[at.theme] : undefined;
  const q = at.question !== undefined ? t?.questions?.[at.question] : undefined;
  return [r?.name || `Раунд ${at.round + 1}`, t && (t.name || `тема ${at.theme! + 1}`)].filter(Boolean).join(" › ") + (q ? ` · ${q.price}` : "");
}

export function SigameRun({ pack, state, onStart, onCancel, onGo, onComponents, onClose }: {
  pack: PackDTO;
  state: SigameState;
  onStart(): void;
  onCancel(): void;
  onGo(at: NonNullable<CheckIssue["at"]>): void;
  onComponents(): void;
  onClose(): void;
}) {
  const [ready, setReady] = useState<boolean | null>(null);
  const [onlyBad, setOnlyBad] = useState(true);
  const [zoom, setZoom] = useState<string | null>(null);
  useEffect(() => { void window.api.sigameRunReady().then(setReady); }, []);

  const report = state.result?.report;
  const run = state.result?.run;
  const packIssues = useMemo(() => report?.issues.filter((i) => i.at?.question === undefined) ?? [], [report]);
  const questions = useMemo(() => (report?.questions ?? []).filter((q) => !onlyBad || q.issues.length), [report, onlyBad]);
  const errors = report?.issues.filter((i) => i.level === "error").length ?? 0;
  const warns = report?.issues.filter((i) => i.level === "warn").length ?? 0;
  const shotUrl = (file: string) => `siq://sigame/${encodeURIComponent(run!)}/${encodeURIComponent(file)}`;

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !zoom) onClose(); }}>
      <div className="pack-check sigame-run">
        <header>
          <b>Прогон в SIGame</b>
          {report && (
            <span className={errors ? "pc-bad" : "pc-ok"}>
              {errors ? `ошибок: ${errors}` : "ошибок нет"}{warns ? ` · внимание: ${warns}` : ""}
            </span>
          )}
          <span className="spacer" />
          <button className="icon" onClick={onClose} title="Закрыть">×</button>
        </header>

        <p className="pc-note">
          Пак играется настоящим движком SIGame — каждый вопрос, со спецвопросами и финалом, — а игроки видят его
          настоящим столом SIOnline (браузер и телефон) на экранах: {PROFILES.map((p) => `«${p.title}»`).join(", ")}.
          Телефон — ещё и на медленной мобильной сети.
        </p>

        {ready === false && !report && (
          <p className="pc-dup-error">
            Не установлен компонент «Прогон в SIGame» (движок SIGame и стол SIOnline).{" "}
            <button className="link inline" onClick={onComponents}>Открыть «Компоненты»</button>
          </p>
        )}
        {state.error && <p className="pc-dup-error">Прогон не удался: {state.error}</p>}

        {state.busy && (
          <div className="sr-progress">
            <span>{state.progress?.text ?? "Запускаю SIGame…"}</span>
            {!!state.progress?.total && <progress max={state.progress.total} value={state.progress.done} />}
          </div>
        )}

        {report && !state.busy && (
          <>
            <p className="sr-summary">
              {report.opened ? "SIGame открыла пак" : <b className="pc-bad">SIGame видит пак не так, как он записан</b>}
              {report.file && <> · в файле: раундов {report.file.rounds}, тем {report.file.themes}, вопросов {report.file.questions}</>}
              {report.sigame && !report.opened && <> · SIGame видит: {report.sigame.rounds}, {report.sigame.themes}, {report.sigame.questions}</>}
              {report.opened && <> · сыграно вопросов: {report.played} из {report.expected} за {report.seconds} с</>}
            </p>
            {packIssues.length > 0 && <IssueList pack={pack} issues={packIssues} onGo={onGo} />}
            <label className="sr-filter">
              <input type="checkbox" checked={onlyBad} onChange={(e) => setOnlyBad(e.target.checked)} /> только вопросы с бедами
            </label>
            <div className="sr-questions">
              {questions.length === 0 && <p className="pc-empty">{report.questions.length ? "У вопросов бед нет — так их и увидят игроки." : "Вопросы не игрались."}</p>}
              {questions.map((q) => (
                <QuestionBlock key={`${q.at.round}/${q.at.theme}/${q.at.question}`} pack={pack} q={q} shotUrl={shotUrl} onGo={onGo} onZoom={setZoom} />
              ))}
            </div>
          </>
        )}

        <footer>
          {state.result && <span className="pc-note">Прогон от {new Date(state.result.at).toLocaleTimeString("ru-RU")}; правили пак после — прогоните заново</span>}
          <span className="spacer" />
          {state.busy
            ? <button onClick={onCancel}>Остановить</button>
            : <button className="primary" onClick={onStart} disabled={ready === false} title="Сохранить пак и прогнать его через SIGame">
                {report ? "Прогнать заново" : "Прогнать"}
              </button>}
        </footer>
      </div>
      {zoom && (
        <div className="sr-zoom" onMouseDown={() => setZoom(null)}>
          <img src={zoom} alt="" />
        </div>
      )}
    </div>
  );
}

function IssueList({ pack, issues, onGo }: { pack: PackDTO; issues: SigameIssue[]; onGo(at: NonNullable<CheckIssue["at"]>): void }) {
  return (
    <ul className="pc-list">
      {issues.map((i, k) => (
        <li key={k} className={`pc-${i.level}`} title={SOURCE[i.source]}>
          <span className="pc-mark">{MARK[i.level]}</span>
          {i.at && i.at.question === undefined
            ? <button className="link inline pc-text" onClick={() => onGo(i.at!)}>{where(pack, i.at)}: {i.text} ›</button>
            : <span className="pc-text">{i.text}{i.source === "rules" ? " (по правилам)" : ""}</span>}
        </li>
      ))}
    </ul>
  );
}

function QuestionBlock({ pack, q, shotUrl, onGo, onZoom }: {
  pack: PackDTO;
  q: QuestionReport;
  shotUrl(file: string): string;
  onGo(at: NonNullable<CheckIssue["at"]>): void;
  onZoom(url: string): void;
}) {
  const shots = q.shots.filter((s) => s.file);
  return (
    <section className="sr-question">
      <button className="link inline sr-where" onClick={() => onGo(q.at)} title="Перейти к вопросу">{where(pack, q.at)} ›</button>
      {q.issues.length > 0 && <IssueList pack={pack} issues={q.issues} onGo={onGo} />}
      {shots.length > 0 && (
        <div className="sr-shots">
          {shots.map((s, k) => (
            <figure key={k} onClick={() => onZoom(shotUrl(s.file!))} title="Увеличить">
              <img src={shotUrl(s.file!)} alt="" loading="lazy" />
              <figcaption>{PROFILE_TITLE[s.profile]} · {s.part === "answer" ? "ответ" : "вопрос"}{s.n > 1 ? ` ${s.n}` : ""}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}

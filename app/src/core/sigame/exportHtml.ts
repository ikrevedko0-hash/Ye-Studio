// «Сохранить отчёт» в окне «Прогон в SIGame»: один HTML-файл, который открывается в любом браузере
// и отправляется одним вложением. Внутри — итог, беды пака и вопросов, уменьшенные снимки только вопросов
// с бедами (картинки — data: URI) и полный отчёт JSON для разбора (script#report). Чистая функция.

import { PROFILES, type QuestionReport, type SigameIssue, type SigameReport } from "./report";

export interface ExportInput {
  report: SigameReport;
  /** Название пака. */
  title: string;
  /** Когда был прогон (ISO). */
  at: string;
  /** Подпись места вопроса: ключ «раунд/тема/вопрос» → «Раунд 1 › Тема · 300». */
  labels: Record<string, string>;
  /** Имя файла снимка → data:image/jpeg;base64,… (только те, что попадают в отчёт). */
  images: Record<string, string>;
}

export const questionKey = (at: { round: number; theme?: number; question?: number }) => `${at.round}/${at.theme}/${at.question}`;

const PROFILE_TITLE = Object.fromEntries(PROFILES.map((p) => [p.id, p.title])) as Record<string, string>;
const LEVEL = { error: "Ошибка", warn: "Внимание", info: "Совет" } as const;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Какие снимки вопроса класть в файл: экраны, где видны его беды; беды без экрана — все снимки. */
export function shotsToExport(q: QuestionReport): QuestionReport["shots"] {
  const profiles = new Set(q.issues.flatMap((i) => i.profiles));
  return q.shots.filter((s) => s.file && (profiles.size === 0 || profiles.has(s.profile)));
}

function issueList(issues: SigameIssue[]): string {
  return `<ul>${issues.map((i) => `<li class="${i.level}"><b>${LEVEL[i.level]}:</b> ${escapeHtml(i.text)}${i.source === "rules" ? " <i>(по правилам)</i>" : ""}</li>`).join("")}</ul>`;
}

export function exportHtml(o: ExportInput): string {
  const r = o.report;
  const errors = r.issues.filter((i) => i.level === "error").length;
  const warns = r.issues.filter((i) => i.level === "warn").length;
  const packIssues = r.issues.filter((i) => i.at?.question === undefined);
  const bad = r.questions.filter((q) => q.issues.length);
  const date = new Date(o.at).toLocaleString("ru-RU");
  const where = (at: SigameIssue["at"]) => (at ? o.labels[questionKey(at)] ?? `Раунд ${at.round + 1}` : "Весь пак");

  const questions = bad.map((q) => {
    const shots = shotsToExport(q).filter((s) => o.images[s.file!]);
    return `<section><h3>${escapeHtml(where(q.at))}</h3>${issueList(q.issues)}${shots.length ? `<div class="shots">${shots.map((s) =>
      `<figure><img src="${o.images[s.file!]}" alt=""><figcaption>${escapeHtml(PROFILE_TITLE[s.profile] ?? s.profile)} · ${s.part === "question" ? "вопрос" : "ответ"}${s.n > 1 ? ` ${s.n}` : ""}</figcaption></figure>`).join("")}</div>` : ""}</section>`;
  }).join("");

  // «</script» внутри JSON закрыл бы тег раньше времени
  const json = JSON.stringify(r).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Прогон в SIGame — ${escapeHtml(o.title)}</title>
<style>
:root{--bg:#fafaf7;--fg:#222;--mut:#777;--line:#e2e0da;--err:#c0392b;--warn:#b7791f}
@media(prefers-color-scheme:dark){:root{--bg:#16161a;--fg:#e8e6e1;--mut:#8a8a90;--line:#33333a;--err:#ff7a66;--warn:#f0b54a}}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;max-width:1100px;margin:0 auto;padding:16px}
h1{margin:.2em 0}.m{color:var(--mut)}section{border-top:1px solid var(--line);padding:8px 0 16px}
ul{padding-left:1.2em}li.error b{color:var(--err)}li.warn b{color:var(--warn)}
.shots{display:flex;flex-wrap:wrap;gap:10px}figure{margin:0;max-width:260px}figure img{max-width:260px;max-height:420px;display:block;border:1px solid var(--line);border-radius:6px}
figcaption{color:var(--mut);font-size:13px}
</style></head><body>
<h1>Прогон в SIGame — ${escapeHtml(o.title)}</h1>
<p class="m">${escapeHtml(date)} · ${r.opened ? "SIGame открыла пак" : "SIGame видит пак не так, как он записан"}${r.file ? ` · в файле: раундов ${r.file.rounds}, тем ${r.file.themes}, вопросов ${r.file.questions}` : ""} · сыграно ${r.played} из ${r.expected}</p>
<p><b>${errors ? `Ошибок: ${errors}` : "Ошибок нет"}</b>${warns ? ` · внимание: ${warns}` : ""} · вопросов с бедами: ${bad.length} из ${r.questions.length}</p>
${packIssues.length ? `<section><h2>Весь пак</h2>${issueList(packIssues.map((i) => ({ ...i, text: i.at ? `${where(i.at)}: ${i.text}` : i.text })))}</section>` : ""}
${bad.length ? `<h2>Вопросы с бедами</h2>${questions}` : "<p>У вопросов бед нет — так их и увидят игроки.</p>"}
<script type="application/json" id="report">${json}</script>
</body></html>
`;
}

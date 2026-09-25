// Афиша пака: одна картинка со всеми темами по раундам (окно «📣 Публикация»).
// Чистая функция — без DOM и Electron, HTML рендерит main (poster.ts там же, но в src/main).

import { getAttr, type Package, type Round } from "./model";

/** Экранирование текста в HTML: &, <, >, ", '. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Заголовок раунда для афиши: финал — просто «Финал», иначе имя раунда или «Раунд N». */
function roundTitle(r: Round, i: number): string {
  if (r.type === "final") return "Финал";
  return r.name?.trim() || `Раунд ${i + 1}`;
}

/**
 * HTML афиши: шапка с названием пака, по раундам — сетка карточек с названиями тем.
 * Темы без названия и раунды без тем пропускаются. Никаких цен, вопросов и комментариев.
 */
export function buildPosterHtml(pkg: Package): string {
  const name = esc(getAttr(pkg, "name")?.trim() || "Без названия");
  const authors = (pkg.info?.authors ?? []).map((a) => a.trim()).filter(Boolean);
  const rounds = pkg.rounds ?? [];

  const roundData = rounds
    .map((r, i) => ({ title: roundTitle(r, i), final: r.type === "final", themes: (r.themes ?? []).map((t) => t.name.trim()).filter((n) => n !== "") }))
    .filter((r) => r.themes.length > 0);

  const themeCount = roundData.reduce((n, r) => n + r.themes.length, 0);
  const dense = themeCount > 40;
  const cardFont = dense ? 22 : 26;

  const authorsLine = authors.length ? `<div class="authors">${esc(authors.join(", "))}</div>` : "";
  const statsLine = `<div class="stats">${roundData.length} раунд${plural(roundData.length)} · ${themeCount} тем${pluralTheme(themeCount)}</div>`;

  const roundsHtml = roundData
    .map((r, i) => {
      // у каждого раунда своя пара неоновых цветов, финал — всегда бирюза → фиолетовый
      const [a, b] = r.final ? FINAL_ACCENT : ACCENTS[i % ACCENTS.length];
      const num = r.final ? "★" : String(i + 1);
      return `
    <section class="round${r.final ? " final" : ""}" style="--a:${a};--b:${b}">
      <h2><span class="num">${num}</span><span class="title">${esc(r.title)}</span><span class="line"></span></h2>
      <div class="grid" style="grid-template-columns:${gridColumns(r.themes.length, dense)}">
        ${r.themes.map((t) => `<div class="card"><span>${esc(t)}</span></div>`).join("\n        ")}
      </div>
    </section>`;
    })
    .join("\n");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 1600px; overflow: hidden; } /* без полос прокрутки на снимке */
  body {
    font-family: "Segoe UI Variable Display", "Segoe UI Variable", "Segoe UI", system-ui, "Segoe UI Emoji", sans-serif;
    background-color: #080b16;
    background-image:
      radial-gradient(900px 420px at 12% -8%, rgba(59,130,246,.30), transparent 65%),
      radial-gradient(800px 520px at 108% 30%, rgba(139,92,246,.20), transparent 65%),
      radial-gradient(900px 500px at 50% 115%, rgba(168,85,247,.22), transparent 65%),
      linear-gradient(rgba(120,140,255,.035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(120,140,255,.035) 1px, transparent 1px);
    background-size: auto, auto, auto, 48px 48px, 48px 48px;
    color: #e9ebf7;
    padding: 56px 64px 44px;
  }
  .brand { font-size: 28px; font-weight: 800; letter-spacing: -.5px; color: #d5d9ea; }
  .ye, .grad {
    background: linear-gradient(90deg, #3b82f6, #8b5cf6 55%, #a855f7);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .pack-name { font-size: 68px; font-weight: 800; line-height: 1.08; letter-spacing: -1px; margin-top: 18px;
    text-shadow: 0 0 40px rgba(99,102,241,.35); }
  .meta { display: flex; gap: 22px; align-items: baseline; margin-top: 14px; }
  .authors { font-size: 22px; color: #b7bddc; }
  .stats { font-size: 20px; color: #8a92bc; }
  .bar { height: 3px; width: 220px; margin-top: 26px; border-radius: 3px;
    background: linear-gradient(90deg, #22d3ee, #3b82f6, #a855f7); box-shadow: 0 0 18px rgba(99,102,241,.7); }
  .round { margin-top: 42px; }
  .round h2 { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; font-size: 28px; font-weight: 700; }
  .round .num { display: inline-flex; align-items: center; justify-content: center; min-width: 40px; height: 40px;
    padding: 0 10px; border-radius: 12px; font-size: 20px; font-weight: 800; color: #fff;
    background: linear-gradient(135deg, var(--a), var(--b)); box-shadow: 0 0 18px color-mix(in srgb, var(--a) 55%, transparent); }
  .round .title { color: #eef0fb; }
  .round.final .title { color: #67e8f9; }
  .round .line { flex: 1; height: 1px; background: linear-gradient(90deg, color-mix(in srgb, var(--b) 70%, transparent), transparent); }
  .grid { display: grid; gap: 16px; }
  .card {
    display: flex; align-items: center; justify-content: center; text-align: center;
    min-height: ${dense ? 92 : 112}px; padding: 18px 22px;
    border: 1.5px solid transparent; border-radius: 16px;
    background:
      linear-gradient(180deg, rgba(28,34,62,.96), rgba(16,20,40,.96)) padding-box,
      linear-gradient(135deg, var(--a), color-mix(in srgb, var(--b) 40%, transparent) 60%, var(--b)) border-box;
    box-shadow: 0 0 26px color-mix(in srgb, var(--a) 22%, transparent), inset 0 1px 0 rgba(255,255,255,.06);
    font-size: ${cardFont}px; font-weight: 650; line-height: 1.25; overflow-wrap: anywhere;
  }
  .final .card { box-shadow: 0 0 34px color-mix(in srgb, var(--a) 34%, transparent), inset 0 1px 0 rgba(255,255,255,.08); }
  footer { margin-top: 48px; display: flex; justify-content: center; align-items: center; gap: 10px;
    font-size: 16px; color: #6f76a0; }
  footer b { font-weight: 800; color: #aab0d0; }
</style>
</head>
<body>
  <div class="brand"><span class="ye">Ye!</span>Studio</div>
  <div class="pack-name">${name}</div>
  <div class="meta">${authorsLine}${statsLine}</div>
  <div class="bar"></div>
  ${roundsHtml}
  <footer>Сделано в <b><span class="ye">Ye!</span>Studio</b></footer>
</body>
</html>`;
}

/** Пары неоновых цветов для раундов (как в теме «Ye!»). */
const ACCENTS: [string, string][] = [
  ["#3b82f6", "#8b5cf6"],
  ["#8b5cf6", "#d946ef"],
  ["#06b6d4", "#3b82f6"],
  ["#6366f1", "#a855f7"],
];
const FINAL_ACCENT: [string, string] = ["#22d3ee", "#a855f7"];

/** Колонки сетки: 1–2 темы — карточки обычной ширины, а не полоса во всю афишу. */
function gridColumns(n: number, dense: boolean): string {
  return n <= 2 ? `repeat(${n}, 480px)` : `repeat(${columns(n, dense)}, 1fr)`;
}

/** Колонок в раунде: без «сироты» в последнем ряду для типичных 4–8 тем. */
function columns(n: number, dense: boolean): number {
  const max = dense ? 6 : 5;
  if (n <= max) return n;
  if (n === 6) return 3;
  if (n <= 8) return 4;
  if (n === 9) return 3;
  return max;
}

function plural(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "а";
  return "ов";
}

function pluralTheme(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "а";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "ы";
  return "";
}

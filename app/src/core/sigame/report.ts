// Отчёт «Прогона в SIGame»: из того, что сказал движок SIGame (стенд) и что намерили на столе SIOnline
// (tools/sionline-table/driver.js), — список бед по вопросам. Чистые функции: пороги и формулировки
// проверяются тестами (tests/sigameReport.test.ts).

import type { CheckIssue } from "../siq/check";
import type { FetchedMedia, LostPart, MissingRef, PackShape, RoundEvent } from "./protocol";
import type { Screen } from "./screens";

export type ProfileId = "phone" | "phoneLand" | "pc";

export interface Profile {
  id: ProfileId;
  title: string;
  width: number;
  height: number;
  scale: number;
  mobile: boolean;
  /** Эмуляция сети: задержка, мс, и скорость приёма, байт/с. Нет — без ограничений. */
  network?: { latencyMs: number; downBytesPerSec: number };
}

export const PROFILES: Profile[] = [
  { id: "phone", title: "Телефон", width: 390, height: 844, scale: 3, mobile: true, network: { latencyMs: 100, downBytesPerSec: 500_000 } },
  { id: "phoneLand", title: "Телефон лёжа", width: 844, height: 390, scale: 3, mobile: true },
  { id: "pc", title: "Компьютер", width: 1920, height: 1080, scale: 1, mobile: false },
];

export const SIGAME_LIMITS = {
  /** Картинка растянута больше чем во столько раз — мыло или «квадраты». */
  stretch: 2.5,
  /** На телефоне картинка меньше этого по короткой стороне, css-пикселей. */
  phoneMinSide: 140,
  /** …или занимает меньше такой доли экрана. */
  phoneMinShare: 0.06,
  /** Загрузка на мобильной сети (профиль phone) дольше — игроки ждут. */
  slowLoadMs: 5000,
  /** Больше стольких мегапикселей iPhone может отказаться показывать картинку. */
  iosMaxMegapixels: 16.7,
  /** Шрифт вариантов мельче — читать тяжело. */
  minOptionFont: 11,
};

export interface Box { x: number; y: number; w: number; h: number }

/** Что вернул window.__ye.measure() на столе SIOnline. */
export interface TableMeasure {
  viewport: { w: number; h: number };
  table: Box | null;
  content: Box | null;
  optionsArea: Box | null;
  images: { src: string; complete: boolean; natural: { w: number; h: number }; rect: Box; inOption: boolean; timing: { ms: number; bytes: number } | null }[];
  videos: { src: string; readyState: number; error: number; natural: { w: number; h: number }; rect: Box; timing: { ms: number; bytes: number } | null }[];
  options: { text: string; rect: Box; font: number }[];
  texts: { text: string; rect: Box; font: number; overflow: boolean }[];
  errors: { kind: string; message: string; url: string | null }[];
}

export interface Shot {
  round: number;
  screen: Screen;
  profile: ProfileId;
  /** Снимок экрана, путь к файлу. */
  file?: string;
  measure: TableMeasure;
  settle: { waitedMs: number; stillLoading: number };
}

export type At = NonNullable<CheckIssue["at"]>;

export interface SigameIssue extends CheckIssue {
  /** На каких экранах видно; пусто — не зависит от экрана (сказал сам движок). */
  profiles: ProfileId[];
  /** Видели на столе SIOnline / сказал движок SIGame / по правилам (iPhone в Chromium не проверить). */
  source: "table" | "engine" | "rules";
}

/** Беда одного снимка до слияния: rule + subject — что и с чем; score — насколько плохо (для выбора худшего). */
export interface RawIssue {
  rule: string;
  subject: string;
  level: SigameIssue["level"];
  text: string;
  score: number;
  source: SigameIssue["source"];
}

export interface QuestionReport {
  at: At;
  type?: string | null;
  shots: { profile: ProfileId; part: Screen["part"]; n: number; file?: string }[];
  issues: SigameIssue[];
}

export interface SigameReport {
  opened: boolean;
  openError?: string;
  file?: PackShape;
  sigame?: PackShape;
  played: number;
  expected: number;
  seconds: number;
  /** Беды без вопроса (пак целиком) и все беды вопросов — одним списком, ошибки сначала. */
  issues: SigameIssue[];
  questions: QuestionReport[];
}

export interface ReportInput {
  open?: { ok: boolean; error?: string; file: PackShape; sigame?: PackShape; lost?: LostPart[] };
  missing: MissingRef[];
  rounds: RoundEvent[];
  shots: Shot[];
  done?: { played: number; expected: number; seconds: number };
}

const PROFILE_TITLE = Object.fromEntries(PROFILES.map((p) => [p.id, p.title])) as Record<ProfileId, string>;
const fileName = (url: string) => decodeURIComponent(url.split("/").pop() ?? url);
const ORDER = { error: 0, warn: 1, info: 2 } as const;

function lostText(l: LostPart): string {
  switch (l.kind) {
    case "round": return `SIGame не видит раунд «${l.name}»`;
    case "theme": return l.seenAs ? `SIGame видит тему «${l.seenAs}» на месте «${l.name}»` : `SIGame не видит тему «${l.name}»`;
    case "questions": return `SIGame видит в теме «${l.name}» вопросов: ${l.seen} из ${l.file}`;
  }
}

/** Беды одного снимка стола. names — хэш-имя файла у SIGame → имя в паке. */
export function shotIssues(s: Shot, profile: Profile, names: Record<string, string> = {}): RawIssue[] {
  const out: RawIssue[] = [];
  const m = s.measure;
  const L = SIGAME_LIMITS;
  const nameOf = (url: string | null) => { if (!url) return ""; const f = fileName(url); return names[f] ?? f; };
  const add = (rule: string, subject: string, level: RawIssue["level"], text: string, score = 1, source: RawIssue["source"] = "table") =>
    out.push({ rule, subject, level, text, score, source });
  const screenArea = m.viewport.w * m.viewport.h;

  for (const e of m.errors) {
    const what = e.kind === "video" ? "Видео" : e.kind === "audio" ? "Звук" : e.kind === "img" ? "Картинка" : e.kind === "fetch" ? "Файл" : null;
    if (what) add("load", nameOf(e.url) || e.message, "error", `${what} не загрузилось у игрока: ${e.url ? nameOf(e.url) + " — " : ""}${e.message}`);
  }
  if (s.settle.stillLoading > 0) add("pending", "", "error", `Медиа так и не догрузилось за ${Math.round(s.settle.waitedMs / 1000)} с`);

  for (const img of m.images) {
    const name = nameOf(img.src);
    if (img.complete && img.natural.w === 0) { add("broken", name, "error", `Картинка ${name} не показалась (битый файл или формат, который браузер не открывает)`); continue; }
    if (!img.natural.w) continue;
    const k = Math.min(img.rect.w / img.natural.w, img.rect.h / img.natural.h);
    if (k >= L.stretch) add("stretch", name, "warn", `Картинка ${name} (${img.natural.w}×${img.natural.h}) растянута до ${img.rect.w}×${img.rect.h} — в ${k.toFixed(1)} раза, будет мыльной`, k);
    const mp = (img.natural.w * img.natural.h) / 1e6;
    if (profile.mobile && mp > L.iosMaxMegapixels) add("megapixels", name, "warn", `Картинка ${name} — ${mp.toFixed(0)} Мп: iPhone может её не показать (больше ${L.iosMaxMegapixels} Мп)`, mp, "rules");
    // Мелко, но во всю отведённую столом область — это раскладка SIOnline (телефон лёжа), паком не лечится.
    // Беда — когда место под картинку съело что-то из пака: варианты ответа, текст рядом.
    const fills = m.content ? Math.max(img.rect.w / Math.max(1, m.content.w), img.rect.h / Math.max(1, m.content.h)) >= 0.9 : false;
    if (profile.mobile && !img.inOption && !fills) {
      const side = Math.min(img.rect.w, img.rect.h);
      const share = (img.rect.w * img.rect.h) / screenArea;
      if (side < L.phoneMinSide || share < L.phoneMinShare)
        add("small", name, "warn", `Картинка ${name} на телефоне всего ${img.rect.w}×${img.rect.h} (${Math.round(share * 100)}% экрана)`, 1 / Math.max(share, 0.001));
    }
    if (profile.network && img.timing && img.timing.ms > L.slowLoadMs)
      add("slow", name, "warn", `Картинка ${name} грузится на мобильной сети ${(img.timing.ms / 1000).toFixed(1)} с`, img.timing.ms);
  }

  for (const v of m.videos) {
    const name = nameOf(v.src);
    if (v.error === 4) add("codec", name, "error", `Видео ${name} браузер не играет (кодек или формат)`);
    else if (v.error) add("video", name, "error", `Видео ${name}: ошибка воспроизведения ${v.error}`);
    if (profile.network && v.timing && v.timing.ms > L.slowLoadMs * 2)
      add("slow", name, "warn", `Видео ${name} грузится на мобильной сети ${(v.timing.ms / 1000).toFixed(1)} с`, v.timing.ms);
  }

  if (m.options.length) {
    const main = m.images.filter((i) => !i.inOption).sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h)[0];
    if (main && m.optionsArea && m.optionsArea.h > 0) {
      const ratio = (m.optionsArea.w * m.optionsArea.h) / Math.max(1, main.rect.w * main.rect.h);
      if (ratio > 1.5) add("options", "", "warn", `Кнопки ответов занимают в ${ratio.toFixed(1)} раза больше места, чем картинка (${main.rect.w}×${main.rect.h})`, ratio);
    }
    const tiny = m.options.filter((o) => o.font > 0 && o.font < L.minOptionFont);
    if (tiny.length) add("optionFont", "", "warn", `Варианты ответа мелким шрифтом (${tiny[0].font}px)`, 1 / tiny[0].font);
  }
  if (m.texts.some((t) => t.overflow)) add("overflow", "", "warn", "Текст вопроса не помещается на экран");
  return out;
}

function mediaIssue(f: FetchedMedia, names: Record<string, string> = {}): Omit<SigameIssue, "at"> | null {
  if (f.status === 200) return null;
  const file = names[fileName(f.url)] ?? fileName(f.url);
  const why = f.status ? `ответ ${f.status}` : (f.error ?? "нет ответа");
  return { level: "error", text: `Раздача SIGame не отдаёт ${f.kind === "image" ? "картинку" : f.kind === "video" ? "видео" : f.kind === "audio" ? "звук" : "файл"} ${file}: ${why}`, profiles: [], source: "engine" };
}

/** Одинаковые беды вопроса с разных экранов — одной строкой: текст худшего случая и список экранов. */
export function mergeShotIssues(at: At, list: { issue: RawIssue; profile: ProfileId }[]): SigameIssue[] {
  const groups = new Map<string, { best: RawIssue; profiles: ProfileId[] }>();
  for (const { issue, profile } of list) {
    const key = `${issue.rule}|${issue.subject}`;
    const g = groups.get(key);
    if (!g) groups.set(key, { best: issue, profiles: [profile] });
    else {
      if (issue.score > g.best.score) g.best = issue;
      if (!g.profiles.includes(profile)) g.profiles.push(profile);
    }
  }
  return [...groups.values()].map(({ best, profiles }) => ({
    level: best.level,
    text: `${best.text} — ${profiles.length > 1 ? "экраны" : "экран"}: ${profiles.map((p) => `«${PROFILE_TITLE[p]}»`).join(", ")}`,
    at, profiles, source: best.source,
  }));
}

export function buildReport(input: ReportInput, profiles: Profile[] = PROFILES): SigameReport {
  const issues: SigameIssue[] = [];
  const questions = new Map<string, QuestionReport>();
  const key = (a: At) => `${a.round}/${a.theme}/${a.question}`;
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  if (input.open && !input.open.ok) {
    if (input.open.error) issues.push({ level: "error", text: `SIGame не открывает пак: ${input.open.error}`, profiles: [], source: "engine" });
    for (const l of input.open.lost ?? []) {
      issues.push({ level: "error", text: lostText(l), at: { round: l.round, theme: "theme" in l ? l.theme : undefined }, profiles: [], source: "engine" });
    }
  }
  for (const r of input.missing) {
    issues.push({ level: "error", text: `SIGame не находит файл ${r.name} — вместо него игроки увидят «Файл не найден в пакете»`, at: { round: r.round, theme: r.theme, question: r.question }, profiles: [], source: "engine" });
  }

  for (const r of input.rounds) {
    if (r.timedOut) issues.push({ level: "error", text: `Раунд «${r.name}»: игра застряла и не дошла до конца`, at: { round: r.round }, profiles: [], source: "engine" });
    for (const e of r.errors) issues.push({ level: "warn", text: `Раунд «${r.name}»: ${e}`, at: { round: r.round }, profiles: [], source: "engine" });
    r.questions.forEach((q, qi) => {
      const at: At = { round: r.round, theme: q.theme, question: q.question };
      const qr: QuestionReport = { at, type: q.type, shots: [], issues: [] };
      questions.set(key(at), qr);
      if (q.end < 0) qr.issues.push({ level: "error", text: "Игра не доиграла этот вопрос до конца", at, profiles: [], source: "engine" });
      for (const f of r.media.filter((m) => m.question === qi)) {
        const i = mediaIssue(f, r.names);
        if (i) qr.issues.push({ ...i, at });
      }
    });
  }

  const raw = new Map<string, { issue: RawIssue; profile: ProfileId }[]>();
  for (const s of input.shots) {
    const r = input.rounds.find((x) => x.round === s.round);
    const q = r?.questions[s.screen.question];
    if (!r || !q) continue;
    const at: At = { round: s.round, theme: q.theme, question: q.question };
    const qr = questions.get(key(at))!;
    qr.shots.push({ profile: s.profile, part: s.screen.part, n: s.screen.n, file: s.file });
    const p = profileById.get(s.profile);
    if (!p) continue;
    const list = raw.get(key(at)) ?? [];
    for (const issue of shotIssues(s, p, r.names)) list.push({ issue, profile: p.id });
    raw.set(key(at), list);
  }

  const qs = [...questions.values()].sort((a, b) => a.at.round - b.at.round || a.at.theme! - b.at.theme! || a.at.question! - b.at.question!);
  for (const q of qs) q.issues.push(...mergeShotIssues(q.at, raw.get(key(q.at)) ?? []));
  const all = [...issues, ...qs.flatMap((q) => q.issues)].sort((a, b) => ORDER[a.level] - ORDER[b.level]);

  const played = input.done?.played ?? qs.filter((q) => !q.issues.some((i) => i.text.startsWith("Игра не доиграла"))).length;
  return {
    opened: input.open?.ok ?? false,
    openError: input.open?.error,
    file: input.open?.file,
    sigame: input.open?.sigame,
    played,
    // сколько вопросов в самом файле, а не сколько их увидела SIGame
    expected: input.open?.file.questions ?? input.done?.expected ?? 0,
    seconds: input.done?.seconds ?? 0,
    issues: all,
    questions: qs,
  };
}

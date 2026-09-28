// «Прогон в SIGame» целиком: стенд sigame-runner играет пак настоящим движком SIGame, записанные сообщения
// показываются настоящим столом SIOnline на экранах разных размеров, всё сводится в отчёт.
// Браузер — снаружи (TableBrowser): в Ye!Studio это скрытые окна Electron (main/sigameRun.ts),
// в npm run sigame-e2e — Chromium через playwright-core.

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { engineProgress, parseRunnerLine, type RecordedMessage, type RoundEvent, type RunnerEvent } from "./protocol";
import { buildReport, PROFILES, type Profile, type ReportInput, type Shot, type SigameReport, type TableMeasure } from "./report";
import { roundScreens } from "./screens";

export interface TablePage {
  feed(messages: { text: string; sender?: string; isSystem?: boolean }[]): Promise<void>;
  settle(maxMs: number, quietMs: number): Promise<{ waitedMs: number; stillLoading: number }>;
  measure(): Promise<TableMeasure>;
  screenshot(path: string): Promise<void>;
  close(): Promise<void>;
}

export interface TableBrowser {
  /** Открыть стол (tools/sionline-table/index.html из собранного компонента) под профиль экрана. */
  open(profile: Profile): Promise<TablePage>;
}

export interface SigameProgress {
  stage: "engine" | "table" | "done";
  done: number;
  total: number;
  text: string;
}

export interface SigameRunOptions {
  pack: string;
  runner: string;
  browser: TableBrowser;
  outDir: string;
  profiles?: Profile[];
  onProgress?: (p: SigameProgress) => void;
  signal?: AbortSignal;
  /** Сколько ждать загрузки медиа на экране, мс. Долгая загрузка всё равно попадает в отчёт — по её времени. */
  mediaWaitMs?: number;
  /** Сколько окон на экран (профиль) снимают раунды одновременно. */
  windows?: number;
}

/** Предел ожидания медиа на одном снимке по умолчанию, мс. */
export const MEDIA_WAIT_MS = 8000;
/** Окон на профиль по умолчанию: раунды снимаются параллельно — экраны телефона не ждут друг друга. */
export const WINDOWS_PER_PROFILE = 2;

const toFeed = (list: RecordedMessage[]) => list.map(([, text, sender, isSystem]) => ({ text, sender, isSystem }));

export async function runSigame(o: SigameRunOptions): Promise<SigameReport> {
  const profiles = o.profiles ?? PROFILES;
  const progress = o.onProgress ?? (() => {});
  await mkdir(o.outDir, { recursive: true });

  // ---------- 1. движок ----------
  const child = spawn(o.runner, [o.pack], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const kill = () => { try { child.stdin.end(); } catch { /* уже закрыт */ } setTimeout(() => child.kill(), 3000).unref(); };
  o.signal?.addEventListener("abort", kill, { once: true });
  let stderr = "";
  child.stderr.on("data", (d: Buffer) => { stderr = (stderr + d.toString("utf8")).slice(-4000); });

  const input: ReportInput = { missing: [], rounds: [], shots: [] };
  // ---------- 2. стол SIOnline — параллельно с игрой: каждый сыгранный раунд сразу снимается ----------
  const queues = new Map(profiles.map((p) => [p.id, [] as { r: RoundEvent; screens: ReturnType<typeof roundScreens> }[]]));
  let waiters: (() => void)[] = [];
  const wake = () => { const w = waiters; waiters = []; for (const f of w) f(); };
  let engineDone = false;
  /** Движок сорвался — окна дальше не снимают. */
  let failed = false;
  let engineText = { done: 0, total: 0, text: "SIGame открывает пак и играет его" };
  let shotsDone = 0, shotsTotal = 0;
  const emit = () => {
    if (!engineDone) progress({ stage: "engine", ...engineText, text: engineText.text + (shotsTotal ? ` · снято экранов ${shotsDone} из ${shotsTotal}` : "") });
    else progress({ stage: "table", done: shotsDone, total: shotsTotal, text: `Экраны: ${shotsDone} из ${shotsTotal}` });
  };
  const tick = () => { shotsDone++; emit(); };
  const windows = profiles.flatMap((profile) => Array.from({ length: Math.max(1, o.windows ?? WINDOWS_PER_PROFILE) }, async () => {
    const queue = queues.get(profile.id)!;
    while (!o.signal?.aborted && !failed) {
      const next = queue.shift();
      if (next) input.shots.push(...await renderRound(o, profile, next.r, next.screens, tick));
      else if (engineDone) return;
      else await new Promise<void>((res) => waiters.push(res));
    }
  }));
  /** Ход раундов для окна (события progress стенда; старый стенд их не шлёт — тогда только «сыгран раунд»). */
  const playing = new Map<number, { name: string; question: number; ended: number; total: number; done?: boolean }>();
  const finished = new Promise<void>((resolve, reject) => {
    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      const e = parseRunnerLine(line);
      if (!e) return;
      onEvent(e);
      if (e.type === "done") resolve();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      // открытие не удалось — стенд выходит сам (код 2), это не сбой прогона
      if (input.open && !input.open.ok) resolve();
      else reject(new Error(`стенд SIGame завершился (код ${code}) раньше времени${stderr ? ": " + stderr.trim().split("\n").pop() : ""}`));
    });
  });
  function onEvent(e: RunnerEvent) {
    switch (e.type) {
      case "open": input.open = e; break;
      case "refs": input.missing = e.missing; break;
      case "progress":
        playing.set(e.round, { ...playing.get(e.round), name: e.name, question: e.question, ended: e.ended, total: e.total });
        engineText = engineProgress(playing);
        emit();
        break;
      case "round": {
        input.rounds.push(e);
        const was = playing.get(e.round);
        playing.set(e.round, { name: e.name, question: e.played, ended: e.played, total: was?.total ?? e.questions.length, done: true });
        const p = engineProgress(playing);
        engineText = was ? p : { ...p, text: `Сыгран раунд «${e.name}»: вопросов ${e.played}` };
        // раунд сыгран — сразу на стол, не дожидаясь остальных
        const screens = roundScreens(e.messages, e.questions);
        if (screens.length) {
          shotsTotal += screens.length * profiles.length;
          for (const q of queues.values()) q.push({ r: e, screens });
          wake();
        }
        emit();
        break;
      }
      case "done": input.done = e; break;
    }
  }

  try {
    try {
      await finished;
    } catch (e) {
      failed = true;
      throw e;
    } finally {
      // игра кончилась (или сорвалась): окна доснимают очередь и закрываются
      engineDone = true;
      wake();
    }
    emit();
    await Promise.all(windows);
    if (o.signal?.aborted) throw new Error("прогон отменён");
  } finally {
    engineDone = true;
    wake();
    await Promise.allSettled(windows);
    kill();
  }
  input.rounds.sort((a, b) => a.round - b.round);

  const report = buildReport(input, profiles);
  progress({ stage: "done", done: 1, total: 1, text: "Готово" });
  return report;
}

async function renderRound(o: SigameRunOptions, profile: Profile, r: RoundEvent, screens: ReturnType<typeof roundScreens>, tick: () => void): Promise<Shot[]> {
  const page = await o.browser.open(profile);
  const shots: Shot[] = [];
  try {
    let fed = 0;
    for (const screen of screens) {
      if (o.signal?.aborted) break;
      await page.feed(toFeed(r.messages.slice(fed, screen.at + 1)));
      fed = screen.at + 1;
      const settle = await page.settle(o.mediaWaitMs ?? MEDIA_WAIT_MS, 600);
      const measure = await page.measure();
      const q = r.questions[screen.question];
      const file = join(o.outDir, `r${r.round}-t${q.theme}-q${q.question}-${screen.part}${screen.n}-${profile.id}.jpg`);
      await page.screenshot(file);
      shots.push({ round: r.round, screen, profile: profile.id, file, measure, settle });
      tick();
    }
  } finally {
    await page.close();
  }
  return shots;
}

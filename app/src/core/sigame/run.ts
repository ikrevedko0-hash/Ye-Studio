// «Прогон в SIGame» целиком: стенд sigame-runner играет пак настоящим движком SIGame, записанные сообщения
// показываются настоящим столом SIOnline на экранах разных размеров, всё сводится в отчёт.
// Браузер — снаружи (TableBrowser): в Ye!Studio это скрытые окна Electron (main/sigameRun.ts),
// в npm run sigame-e2e — Chromium через playwright-core.

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { parseRunnerLine, type RecordedMessage, type RoundEvent, type RunnerEvent } from "./protocol";
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
  /** Сколько экранов снимать одновременно (по профилям). */
  onProgress?: (p: SigameProgress) => void;
  signal?: AbortSignal;
  /** Сколько ждать загрузки медиа на экране, мс. */
  mediaWaitMs?: number;
}

const toFeed = (list: RecordedMessage[]) => list.map(([, text, sender, isSystem]) => ({ text, sender, isSystem }));

export async function runSigame(o: SigameRunOptions): Promise<SigameReport> {
  const profiles = o.profiles ?? PROFILES;
  const progress = o.onProgress ?? (() => {});
  await mkdir(o.outDir, { recursive: true });

  // ---------- 1. движок ----------
  progress({ stage: "engine", done: 0, total: 0, text: "SIGame открывает пак и играет его" });
  const child = spawn(o.runner, [o.pack], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const kill = () => { try { child.stdin.end(); } catch { /* уже закрыт */ } setTimeout(() => child.kill(), 3000).unref(); };
  o.signal?.addEventListener("abort", kill, { once: true });
  let stderr = "";
  child.stderr.on("data", (d: Buffer) => { stderr = (stderr + d.toString("utf8")).slice(-4000); });

  const input: ReportInput = { missing: [], rounds: [], shots: [] };
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
      case "round":
        input.rounds.push(e);
        progress({ stage: "engine", done: input.rounds.length, total: 0, text: `Сыгран раунд «${e.name}»: вопросов ${e.played}` });
        break;
      case "done": input.done = e; break;
    }
  }

  try {
    await finished;
    if (o.signal?.aborted) throw new Error("прогон отменён");

    // ---------- 2. стол SIOnline ----------
    const rounds = input.rounds.sort((a, b) => a.round - b.round);
    const perRound = rounds.map((r) => ({ r, screens: roundScreens(r.messages, r.questions) }));
    const total = perRound.reduce((s, x) => s + x.screens.length, 0) * profiles.length;
    let done = 0;
    await Promise.all(profiles.map(async (profile) => {
      for (const { r, screens } of perRound) {
        if (o.signal?.aborted) return;
        const shots = await renderRound(o, profile, r, screens, () => {
          done++;
          progress({ stage: "table", done, total, text: `Экраны: ${done} из ${total}` });
        });
        input.shots.push(...shots);
      }
    }));
    if (o.signal?.aborted) throw new Error("прогон отменён");
  } finally {
    kill();
  }

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
      const settle = await page.settle(o.mediaWaitMs ?? 12000, 450);
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

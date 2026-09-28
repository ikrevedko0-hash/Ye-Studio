// «Прогнать в SIGame» внутри Ye!Studio: стол SIOnline открывается в скрытых окнах Electron,
// экран телефона/ПК, сеть и снимки — через протокол отладки Chromium (CDP), как у playwright в
// npm run sigame-e2e. Сам прогон — core/sigame/run.ts; здесь только окна и где что лежит.

import { app, BrowserWindow, dialog, nativeImage, shell } from "electron";
import { existsSync } from "node:fs";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, normalize, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { devSigameDir, sigameLayout, type SigameLayout } from "../core/sigame/paths";
import { exportHtml, shotsToExport } from "../core/sigame/exportHtml";
import type { Profile } from "../core/sigame/report";
import { runSigame, type SigameProgress, type TableBrowser, type TablePage } from "../core/sigame/run";
import type { SigameReport } from "../core/sigame/report";
import { componentsDir } from "./components";

export const SIGAME_DIR = "sigame";
/** Сколько последних прогонов со снимками держать на диске. */
const KEEP_RUNS = 5;

/** Компонент «Прогон в SIGame»: сначала поставленный в «Компонентах», при разработке — сборка из .sigame-src. */
export function sigameInstalled(): SigameLayout | null {
  const candidates = [join(componentsDir(), SIGAME_DIR)];
  if (!app.isPackaged) candidates.push(devSigameDir(app.getAppPath()));
  for (const dir of candidates) {
    const l = sigameLayout(dir, process.platform);
    if (existsSync(l.runner) && existsSync(l.table)) return l;
  }
  return null;
}

export const runsDir = () => join(app.getPath("userData"), "sigame-runs");

/** Файл снимка по адресу siq://sigame/<прогон>/<файл> — только из папки прогонов. */
export function runFile(run: string, name: string): string | null {
  const root = runsDir();
  const p = normalize(join(root, run, name));
  return p.startsWith(root + sep) ? p : null;
}

function electronTable(tableHtml: string): TableBrowser {
  return {
    async open(profile: Profile): Promise<TablePage> {
      const win = new BrowserWindow({
        show: false,
        width: profile.width,
        height: profile.height,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
          // раздача медиа SIGame не шлёт CORS-заголовков, а стол открыт с file:// — как в WebView2 у SImulator
          webSecurity: false,
          autoplayPolicy: "no-user-gesture-required",
          // своя сессия в памяти: фильтр запросов ниже не должен задевать само приложение
          partition: "sigame-run",
        },
      });
      const wc = win.webContents;
      // стол SIOnline ходит только к раздаче SIGame на 127.0.0.1 и к своим файлам; остальное — мимо
      wc.session.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, (d, cb) => {
        const u = new URL(d.url);
        cb({ cancel: !(u.hostname === "127.0.0.1" || u.hostname === "localhost") });
      });
      await win.loadURL(pathToFileURL(tableHtml).href);
      // отладчик — после первой загрузки: подключённый к пустому webContents, он роняет Electron
      wc.debugger.attach("1.3");
      const cdp = (method: string, params?: object) => wc.debugger.sendCommand(method, params);
      await cdp("Emulation.setDeviceMetricsOverride", { width: profile.width, height: profile.height, deviceScaleFactor: profile.scale, mobile: profile.mobile });
      if (profile.mobile) await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      const started = Date.now();
      while (!(await wc.executeJavaScript("!!(window.__ye && window.__ye.ready)"))) {
        if (Date.now() - started > 30000) throw new Error("стол SIOnline не запустился за 30 с");
        await new Promise((r) => setTimeout(r, 100));
      }
      const js = <T>(code: string) => wc.executeJavaScript(code) as Promise<T>;
      return {
        feed: async (m) => { await js(`window.__ye.feed(${JSON.stringify(m)})`); },
        settle: (a, b) => js(`window.__ye.settle(${Number(a)}, ${Number(b)})`),
        measure: () => js("window.__ye.measure()"),
        screenshot: async (path) => {
          // скрытое окно само не перерисовывается: без этого снимок — прошлый кадр (табло вместо вопроса)
          wc.invalidate();
          // кадры могут и не идти (окно сочтено скрытым) — тогда не ждём их вечно
          await js("new Promise((r) => { const t = setTimeout(r, 500); requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(t); r(); })); })");
          const r = (await withTimeout(cdp("Page.captureScreenshot", { format: "jpeg", quality: 70, fromSurface: true }), 20000)) as { data: string } | null;
          // запасной путь: capturePage сам делает страницу видимой на время снимка
          const data = r ? Buffer.from(r.data, "base64") : (await withTimeout(wc.capturePage(), 20000))?.toJPEG(70);
          if (!data?.length) throw new Error("стол SIOnline не отдал снимок экрана за 20 с");
          await writeFile(path, data);
        },
        close: async () => { try { wc.debugger.detach(); } catch { /* уже */ } win.destroy(); },
      };
    },
  };
}

/** Результат обещания или null, если оно не успело. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

let current: AbortController | null = null;

/** Один прогон за раз. Снимки — в userData/sigame-runs/<время>/, старые прогоны чистятся. */
export async function runSigameInApp(pack: string, onProgress: (p: SigameProgress) => void): Promise<{ run: string; report: SigameReport }> {
  const layout = sigameInstalled();
  if (!layout) throw new Error("«Прогон в SIGame» не установлен: «Настройки» → «Компоненты» → «Прогон в SIGame»");
  if (current) throw new Error("прогон уже идёт");
  current = new AbortController();
  const run = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(runsDir(), run);
  try {
    const report = await runSigame({ pack, runner: layout.runner, browser: electronTable(layout.table), outDir, onProgress, signal: current.signal });
    await writeFile(join(outDir, "report.json"), JSON.stringify(report, null, 2));
    // окну — только имена снимков: оно берёт их по адресу siq://sigame/<прогон>/<имя>
    for (const q of report.questions) for (const s of q.shots) if (s.file) s.file = basename(s.file);
    return { run, report };
  } finally {
    current = null;
    void pruneRuns();
  }
}

export function cancelSigameRun(): void {
  current?.abort();
}

async function pruneRuns() {
  try {
    const all = (await readdir(runsDir())).sort();
    for (const old of all.slice(0, Math.max(0, all.length - KEEP_RUNS))) await rm(join(runsDir(), old), { recursive: true, force: true });
  } catch { /* папки ещё нет */ }
}

/**
 * «Сохранить отчёт»: один HTML со снимками вопросов с бедами (уменьшены до 360 px — файл в несколько мегабайт,
 * а не папка на 80). Возвращает путь или null, если сохранение отменили.
 */
export async function exportSigameRun(win: BrowserWindow | null, run: string, title: string, labels: Record<string, string>): Promise<string | null> {
  const file = runFile(run, "report.json");
  if (!file || !existsSync(file)) throw new Error("этого прогона уже нет на диске — прогоните пак заново");
  const report = JSON.parse(await readFile(file, "utf8")) as SigameReport;
  for (const q of report.questions) for (const s of q.shots) if (s.file) s.file = basename(s.file);
  const images: Record<string, string> = {};
  for (const q of report.questions.filter((x) => x.issues.length)) {
    for (const s of shotsToExport(q)) {
      const path = runFile(run, s.file!);
      if (!path || !existsSync(path)) continue;
      const img = nativeImage.createFromPath(path);
      if (img.isEmpty()) continue;
      images[s.file!] = `data:image/jpeg;base64,${img.resize({ width: 360, quality: "good" }).toJPEG(72).toString("base64")}`;
    }
  }
  const at = (await stat(file)).mtime.toISOString();
  const safe = title.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "пак";
  const opts = { title: "Сохранить отчёт прогона", defaultPath: join(app.getPath("documents"), `Прогон SIGame — ${safe}.html`), filters: [{ name: "Отчёт (HTML)", extensions: ["html"] }] };
  const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (r.canceled || !r.filePath) return null;
  await writeFile(r.filePath, exportHtml({ report, title, at, labels, images }), "utf8");
  shell.showItemInFolder(r.filePath);
  return r.filePath;
}

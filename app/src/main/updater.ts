// ---------- обновления ----------
// Два вида обновлений из GitHub Releases (HTTPS):
//  • КОД (обычный случай): code.json + code-<версия>.asar.gz, ~1,5 МБ. Проверяем подпись ключом автора и sha512,
//    кладём в %LOCALAPPDATA%\Ye!Studio\code\<версия>\ и перезапускаемся — загрузчик (bootstrap/) возьмёт новую
//    версию. Ни установщика, ни переустановки.
//  • ОБОЛОЧКА (редко: новый Electron, словари, компоненты — номер yesShell вырос): прежний путь electron-updater,
//    установщик с .blockmap и beta.yml / latest.yml.
// Версия с «-» (пре-релиз) берёт и пре-релизы; обычная — только обычные релизы.
//
// Никакой тихой установки: однажды тихое обновление закрыло открытую мастерскую автора
// с несохранённой работой. Поэтому скачивание и установка идут только по явной кнопке в UpdateBanner,
// а install ещё и спрашивает про несохранённые правки — тем же диалогом, что и обычное закрытие окна.

import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { app, ipcMain, type BrowserWindow } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";
import { cmpVersion, sha512, verifyMeta, type CodeMeta } from "../../bootstrap/pick.js";
import PUBLIC_KEY from "../../bootstrap/public-key.js";
import { codeCandidates, decide, type CodeCandidate, type GhRelease } from "../core/update/codeRelease";
import { SELF_TEST } from "./quietWindow";
import { appVersion, boot, shellNumber } from "./version";
import type { UpdateStatus } from "../shared/api";

// обычный fs видит .asar как папку — файлы кода пишем «сырым» fs
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ofs = require("original-fs") as typeof import("node:fs");

const REPO = "ikrevedko0-hash/Ye-Studio";
/** YES_UPDATE_API — адрес списка релизов для проверки на поддельном сервере; подпись проверяется всё равно. */
const RELEASES_URL = process.env.YES_UPDATE_API || `https://api.github.com/repos/${REPO}/releases?per_page=30`;

let win: BrowserWindow | null = null;
let status: UpdateStatus = { state: "idle" };
/** Спросить про несохранённые правки перед перезапуском — тот же askSaveBeforeClose из index.ts. */
let confirmInstall: (() => Promise<boolean>) | null = null;
/** Найденное обновление кода (null — обновление оболочки или ничего). */
let codePlan: { cand: CodeCandidate; meta: CodeMeta } | null = null;
let busy = false;

/** В самопроверках и в разработке обновляться не из чего и незачем (YES_UPDATE_API — проверка обновления). */
const active = (!SELF_TEST && app.isPackaged) || !!process.env.YES_UPDATE_API;
const allowPrerelease = () => appVersion().includes("-");

function notesOf(n: UpdateInfo["releaseNotes"]): string | undefined {
  if (typeof n === "string") return n;
  if (Array.isArray(n)) return n.map((x) => x.note).filter((x): x is string => !!x).join("\n\n");
  return undefined;
}

function send(next: UpdateStatus): void {
  status = next;
  if (win && !win.isDestroyed()) win.webContents.send("update:state", status);
}

const mb = (bytes: number) => Math.round((bytes / 1048576) * 10) / 10;

async function getJson<T>(url: string): Promise<T> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 20_000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Ye-Studio-updater", Accept: "application/vnd.github+json" }, signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${new URL(url).hostname}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

// ---------- папка кода ----------

function codeRoot(): string {
  return boot()?.codeRoot ?? join(process.env.LOCALAPPDATA || app.getPath("appData"), "Ye!Studio", "code");
}

/** Версии, которые загрузчик отложил (дважды не дожили до окна), — их снова не предлагаем. */
function badVersions(): string[] {
  try {
    const b = JSON.parse(ofs.readFileSync(join(codeRoot(), "boot.json"), "utf8")) as { bad?: string[] };
    return Array.isArray(b.bad) ? b.bad : [];
  } catch {
    return [];
  }
}

/** Убрать старые скачанные версии: остаются текущая, всё новее её и одна предыдущая (на откат). */
export function cleanupCode(): void {
  const current = appVersion();
  let names: string[] = [];
  try { names = ofs.readdirSync(codeRoot()); } catch { return; }
  const older = names
    .filter((n) => /^\d+\.\d+\.\d+/.test(n) && n !== current)
    .filter((n) => { try { return ofs.statSync(join(codeRoot(), n)).isDirectory(); } catch { return false; } })
    .filter((n) => cmpVersion(n, current) < 0)
    .sort((a, b) => cmpVersion(b, a));
  for (const n of older.slice(1)) {
    try { ofs.rmSync(join(codeRoot(), n), { recursive: true, force: true }); } catch { /* занято — в другой раз */ }
  }
  for (const n of names.filter((x) => x.startsWith(".dl-"))) {
    try { ofs.rmSync(join(codeRoot(), n), { recursive: true, force: true }); } catch { /* ничего */ }
  }
}

// ---------- проверка ----------

async function checkForUpdates(): Promise<void> {
  if (!active || busy || status.state === "downloading" || status.state === "ready") return;
  busy = true;
  send({ state: "checking" });
  try {
    codePlan = null;
    const rels = await getJson<GhRelease[]>(RELEASES_URL);
    const cands = codeCandidates(rels, appVersion(), allowPrerelease(), badVersions());
    let installer = false;
    for (const cand of cands) {
      const meta = await getJson<CodeMeta>(cand.metaUrl).catch(() => null);
      if (!meta || meta.version !== cand.version || !verifyMeta(meta, PUBLIC_KEY)) continue;   // чужое или битое — мимо
      const d = decide(meta.shell, shellNumber());
      if (d === "installer") { installer = true; break; }
      if (d === "code") { codePlan = { cand, meta }; break; }
    }
    if (codePlan) {
      send({ state: "available", kind: "code", version: codePlan.meta.version, notes: codePlan.meta.notes, sizeMb: mb(codePlan.cand.gzSize) });
    } else if (installer) {
      await autoUpdater.checkForUpdates();   // события electron-updater сами пришлют available / idle
    } else {
      send({ state: "idle" });
    }
  } catch (e) {
    // сеть недоступна — статус error, без всплывающих окон
    send({ state: "error", error: (e as Error).message });
  } finally {
    busy = false;
  }
}

// ---------- скачивание кода ----------

async function downloadCode(): Promise<void> {
  if (!codePlan) return;
  const { cand, meta } = codePlan;
  send({ state: "downloading", kind: "code", version: meta.version, percent: 0 });
  const res = await fetch(cand.gzUrl, { headers: { "User-Agent": "Ye-Studio-updater" } });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || cand.gzSize;
  const chunks: Uint8Array[] = [];
  let got = 0, shown = -1;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (got > 64 * 1048576) throw new Error("архив кода подозрительно большой");
    const p = total ? Math.min(99, Math.floor((got / total) * 100)) : 0;
    if (p !== shown) { shown = p; send({ state: "downloading", kind: "code", version: meta.version, percent: p }); }
  }
  const data = gunzipSync(Buffer.concat(chunks));
  if (data.length !== meta.size || sha512(data) !== meta.sha512) throw new Error("скачанный код не совпал с подписью — не ставлю");

  const root = codeRoot();
  const tmp = join(root, `.dl-${randomBytes(4).toString("hex")}`);
  const dest = join(root, meta.version);
  ofs.mkdirSync(tmp, { recursive: true });
  ofs.writeFileSync(join(tmp, "code.asar"), data);
  ofs.writeFileSync(join(tmp, "code.json"), JSON.stringify(meta, null, 2));
  ofs.rmSync(dest, { recursive: true, force: true });
  ofs.renameSync(tmp, dest);
  send({ state: "ready", kind: "code", version: meta.version, notes: meta.notes });
}

async function download(): Promise<void> {
  if (!active) return;
  try {
    if (codePlan) await downloadCode();
    else await autoUpdater.downloadUpdate();
  } catch (e) {
    send({ state: "error", error: (e as Error).message });
  }
}

async function install(): Promise<void> {
  if (!active || status.state !== "ready") return;
  const ok = confirmInstall ? await confirmInstall() : true;
  if (!ok) return; // отмена — ничего не делаем, окно остаётся как было
  if (status.kind === "code") {
    app.relaunch();   // загрузчик при запуске возьмёт скачанную версию
    app.quit();
  } else {
    autoUpdater.quitAndInstall(false, true); // не тихо: с окном установщика, перезапуск сам
  }
}

if (active) {
  autoUpdater.allowPrerelease = allowPrerelease();
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("update-available", (info: UpdateInfo) => send({ state: "available", kind: "installer", version: info.version, notes: notesOf(info.releaseNotes) }));
  autoUpdater.on("update-not-available", () => send({ state: "idle" }));
  autoUpdater.on("download-progress", (p) => send({ state: "downloading", kind: "installer", version: status.version, percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (info: UpdateInfo) => send({ state: "ready", kind: "installer", version: info.version, notes: notesOf(info.releaseNotes) }));
  autoUpdater.on("error", (err: Error) => send({ state: "error", error: err.message }));
}

// IPC-обработчики регистрируем всегда (даже в самопроверках и dev), иначе окно падает на
// первом же вызове window.api.appVersion()/updateStatus(); проверка сети идёт только когда active.
ipcMain.handle("update:check", () => checkForUpdates());
ipcMain.handle("update:download", () => download());
ipcMain.handle("update:install", () => install());
ipcMain.handle("update:status", () => status);
ipcMain.handle("app:version", () => appVersion());

/**
 * Включить автообновление для окна win. onConfirmInstall — тот же вопрос «сохранить перед
 * закрытием», что и askSaveBeforeClose: true — можно ставить обновление, false — отмена.
 */
export function initUpdater(w: BrowserWindow, onConfirmInstall: () => Promise<boolean>): void {
  win = w;
  confirmInstall = onConfirmInstall;
  if (!active) return;
  // проверка через 15 с после старта (не мешать самой загрузке окна) и раз в 6 часов
  setTimeout(() => void checkForUpdates(), process.env.YES_UPDATE_API ? 1000 : 15_000);
  setInterval(() => void checkForUpdates(), 6 * 60 * 60_000);
}

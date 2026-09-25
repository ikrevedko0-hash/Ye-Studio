// ---------- обновления ----------
// Автообновление с собственного сервера автора (generic-провайдер electron-updater).
//
// Никакой тихой установки: однажды тихое обновление закрыло открытую Мастерскую автора
// с несохранённой работой (см. AGENTS.md, раздел «Установщик (NSIS)»). Поэтому скачивание
// и установка идут только по явной кнопке в UpdateBanner, а install ещё и спрашивает
// про несохранённые правки — тем же диалогом, что и обычное закрытие окна.
//
// Адрес обновлений — обычный HTTP без подписи (бета на 1–2 пользователей, сервер ещё поднимается).
// electron-updater всё равно сверяет sha512 каждого файла из latest.yml — подмена по дороге не пройдёт
// незаметно, но перехват самого канала (MITM) этим не закрыт.

import { app, ipcMain, type BrowserWindow } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";
import { SELF_TEST } from "./quietWindow";
import type { UpdateStatus } from "../shared/api";

let win: BrowserWindow | null = null;
let status: UpdateStatus = { state: "idle" };
/** Спросить про несохранённые правки перед перезапуском — тот же askSaveBeforeClose из index.ts. */
let confirmInstall: (() => Promise<boolean>) | null = null;

/** В самопроверках и в разработке нет ни latest.yml, ни смысла стучаться на сервер обновлений. */
const active = !SELF_TEST && app.isPackaged;

function notesOf(n: UpdateInfo["releaseNotes"]): string | undefined {
  if (typeof n === "string") return n;
  if (Array.isArray(n)) return n.map((x) => x.note).filter((x): x is string => !!x).join("\n\n");
  return undefined;
}

function send(next: UpdateStatus): void {
  status = next;
  if (win && !win.isDestroyed()) win.webContents.send("update:state", status);
}

async function checkForUpdates(): Promise<void> {
  if (!active) return;
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    // сеть недоступна или сервер ещё не поднят — статус error, без всплывающих окон
    send({ state: "error", error: (e as Error).message });
  }
}

async function install(): Promise<void> {
  if (!active || status.state !== "ready") return;
  const ok = confirmInstall ? await confirmInstall() : true;
  if (!ok) return; // отмена — ничего не делаем, окно остаётся как было
  autoUpdater.quitAndInstall(false, true); // не тихо: с окном установщика, перезапуск сам
}

if (active) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("checking-for-update", () => send({ state: "checking" }));
  autoUpdater.on("update-available", (info: UpdateInfo) => send({ state: "available", version: info.version, notes: notesOf(info.releaseNotes) }));
  autoUpdater.on("update-not-available", () => send({ state: "idle" }));
  autoUpdater.on("download-progress", (p) => send({ state: "downloading", version: status.version, percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (info: UpdateInfo) => send({ state: "ready", version: info.version, notes: notesOf(info.releaseNotes) }));
  autoUpdater.on("error", (err: Error) => send({ state: "error", error: err.message }));
}

// IPC-обработчики регистрируем всегда (даже в самопроверках и dev), иначе окно падает на
// первом же вызове window.api.appVersion()/updateStatus(); проверка сети идёт только когда active.
ipcMain.handle("update:check", () => checkForUpdates());
ipcMain.handle("update:download", () => (active ? autoUpdater.downloadUpdate().then(() => undefined).catch((e: Error) => send({ state: "error", error: e.message })) : undefined));
ipcMain.handle("update:install", () => install());
ipcMain.handle("update:status", () => status);
ipcMain.handle("app:version", () => app.getVersion());

/**
 * Включить автообновление для окна win. onConfirmInstall — тот же вопрос «сохранить перед
 * закрытием», что и askSaveBeforeClose: true — можно ставить обновление, false — отмена.
 */
export function initUpdater(w: BrowserWindow, onConfirmInstall: () => Promise<boolean>): void {
  win = w;
  confirmInstall = onConfirmInstall;
  if (!active) return;
  // проверка через 15 с после старта (не мешать самой загрузке окна) и раз в 6 часов
  setTimeout(() => void checkForUpdates(), 15_000);
  setInterval(() => void checkForUpdates(), 6 * 60 * 60_000);
}

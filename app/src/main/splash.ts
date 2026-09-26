// Анимированный сплэш-скрин: показывается до тяжёлой инициализации основного окна.
//
// Минимальное время показа 1200мс (чтобы fade/blик не мигнули и не пропали мгновенно),
// максимальное — не ограничено, но если основное окно так и не показалось за 20с,
// сплэш всё равно закрывается (не висеть вечно из-за зависшей загрузки).

import { join } from "node:path";
import { appVersion } from "./version";
import { app, BrowserWindow } from "electron";

const MIN_SHOW_MS = 1200;
const MAX_SHOW_MS = 20_000;
const FADE_MS = 300;

let splashWin: BrowserWindow | null = null;
let shownAt = 0;

/** resources приложения: тот же способ, что и в main/index.ts (resourcesDir). */
function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), "resources");
}

/** Показать сплэш как можно раньше. Не вызывать в самопроверках и тихих режимах. */
export function showSplash(): BrowserWindow {
  const win = new BrowserWindow({
    width: 840,
    height: 473,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: false,
    skipTaskbar: true,
    center: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, devTools: !app.isPackaged },
  });
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    if (splashWin === win) splashWin = null;
  });

  void win.loadFile(join(resourcesDir(), "splash", "splash.html"), { query: { v: appVersion() } });

  splashWin = win;
  shownAt = Date.now();
  // предохранитель: основное окно зависло — сплэш всё равно не висит бесконечно
  setTimeout(() => {
    if (splashWin === win && !win.isDestroyed()) win.destroy();
  }, MAX_SHOW_MS);

  return win;
}

/** Сменить строку статуса внизу сплэша (например, «Проверяю компоненты…»). */
export function setSplashStatus(text: string): void {
  if (!splashWin || splashWin.isDestroyed()) return;
  void splashWin.webContents.executeJavaScript(`window.setStatus(${JSON.stringify(text)})`).catch(() => undefined);
}

/** Показать основное окно и плавно закрыть сплэш (с учётом минимального времени показа). */
export function closeSplash(main: BrowserWindow): void {
  const win = splashWin;
  if (!win || win.isDestroyed()) {
    if (!main.isDestroyed()) main.show();
    return;
  }
  const wait = Math.max(0, MIN_SHOW_MS - (Date.now() - shownAt));
  setTimeout(() => {
    if (!main.isDestroyed()) main.show();
    if (win.isDestroyed()) return;
    void win.webContents.executeJavaScript("document.body.classList.add('fade-out')").catch(() => undefined);
    setTimeout(() => {
      if (!win.isDestroyed()) win.destroy();
    }, FADE_MS);
  }, wait);
}

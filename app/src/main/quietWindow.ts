// Самопроверки — позади рабочих окон автора, без перехвата фокуса.
//
// Автор работает, пока идут проверки, и каждое всплывающее окно Мастерской отнимало фокус
// посреди набора текста. Теперь окно самопроверки показывается неактивным (showInactive)
// и сразу уходит в самый низ стопки окон через Windows (SetWindowPos с HWND_BOTTOM).
//
// Чтобы окно за другими окнами не «засыпало»: Chromium на Windows считает перекрытое окно
// скрытым и перестаёт его рисовать — тогда снимок пустой, а таймеры страницы тормозят.
// Поэтому в режиме самопроверки выключаем расчёт перекрытия и фоновое торможение.

import { spawn } from "node:child_process";
import { app, type BrowserWindow } from "electron";

const TEST_FLAGS = /^--(selftest|shot|save-copy|new-with-media|rename-theme|ai-settings|imagegen-test|image-test|collage-test|media-center|word-studio|split|yt-diagnose|library-test|yt-login-test|proposals|system-probe|first-run|board-test|point-test|pixelate-test|pixelate-theme|silhouette-test|logo-test|pack-size|assistant-setup|poster)=/;

/** Запущено ли приложение самопроверкой (любой из её флагов). */
export const SELF_TEST = process.argv.some((a) => TEST_FLAGS.test(a));

/** Вызывать до app.whenReady: переключатели Chromium читаются только при старте. */
export function prepareQuietSelfTest(): void {
  if (SELF_TEST) app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
}

/** Показать окно самопроверки неактивным и отправить его под все остальные окна. */
export function showQuietly(win: BrowserWindow): void {
  win.showInactive();
  if (process.platform !== "win32") return;
  const hwnd = win.getNativeWindowHandle();
  const h = hwnd.length >= 8 ? hwnd.readBigUInt64LE(0).toString() : String(hwnd.readUInt32LE(0));
  const ps = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class Z { [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f); }
"@
[void][Z]::SetWindowPos([IntPtr]${h}, [IntPtr]1, 0, 0, 0, 0, 0x13)`;
  // 0x13 = SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE; [IntPtr]1 = HWND_BOTTOM
  spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, stdio: "ignore" });
}

// «Смотреть рядом»: ролик открывается в обычном Chrome автора на левой половине экрана,
// Мастерская встаёт на правую. Смотришь видео — и тут же вписываешь тайминги в поля отрезка.
//
// Почему не встроенный плеер. Плеер YouTube внутри окна приложения с адреса VPN через раз
// отвечает «подтвердите, что вы не бот» даже с полным входом: он проверяет ещё и сам браузер.
// А в настоящем Chrome автора YouTube работает и вход уже есть. Выгруженные куки загрузчика
// это не трогает: у обычного Chrome своя сессия, не та, что закрыта в инкогнито.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { screen, shell, type BrowserWindow } from "electron";

export function findChrome(): string | null {
  const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA];
  for (const r of roots) {
    if (!r) continue;
    const p = join(r, "Google", "Chrome", "Application", "chrome.exe");
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Поставить только что открытое окно Chrome на левую половину.
 * Своё окно Electron двигает сам, а чужое — только через Windows: ждём, пока окно Chrome
 * станет активным (новое окно всегда выходит на передний план), разворачиваем из «на весь
 * экран» и ставим по координатам. Координаты — в настоящих пикселях экрана, не в DIP.
 */
function placeChromeLeft(x: number, y: number, w: number, height: number): Promise<boolean> {
  const ps = `
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class W {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool r);
}
"@
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 150
  $h = [W]::GetForegroundWindow(); $procId = 0; [void][W]::GetWindowThreadProcessId($h, [ref]$procId)
  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($p -and $p.ProcessName -eq 'chrome') { [void][W]::ShowWindow($h, 9); [void][W]::MoveWindow($h, ${x}, ${y}, ${w}, ${height}, $true); 'ok'; exit }
}
'нет'`;
  return new Promise((done) => {
    const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true });
    let out = "";
    p.stdout.on("data", (c: Buffer) => { out += c.toString(); });
    p.on("error", () => done(false));
    p.on("close", () => done(out.includes("ok")));
  });
}

export async function watchSideBySide(win: BrowserWindow, url: string): Promise<{ chrome: boolean; placed: boolean }> {
  const display = screen.getDisplayMatching(win.getBounds());
  const wa = display.workArea;
  const half = Math.floor(wa.width / 2);

  // Мастерская — на правую половину. Минимальную ширину окна снижаем: половина экрана
  // ноутбука меньше обычных 1100 точек, и без этого окно не встало бы на место.
  if (win.isMaximized()) win.unmaximize();
  win.setMinimumSize(Math.min(760, wa.width - half), 600);
  win.setBounds({ x: wa.x + half, y: wa.y, width: wa.width - half, height: wa.height });

  const chrome = findChrome();
  if (!chrome || !/^https?:\/\//i.test(url)) {
    await shell.openExternal(url);
    return { chrome: false, placed: false };
  }
  spawn(chrome, ["--new-window", url], { detached: true, stdio: "ignore" }).unref();
  const k = display.scaleFactor;
  const placed = await placeChromeLeft(Math.round(wa.x * k), Math.round(wa.y * k), Math.round(half * k), Math.round(wa.height * k));
  win.focus(); // окно приложения — сразу под рукой для таймингов
  return { chrome: true, placed };
}

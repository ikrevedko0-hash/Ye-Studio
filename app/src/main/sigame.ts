// «Открыть в SIGame». Сама игра путь к паку при запуске не принимает (App.xaml.cs в VladimirKhil/SI: любой
// аргумент — служебная команда и выход), поэтому запускаем SIGame, а путь к паку кладём в буфер обмена —
// в окне «Добавить пакет» его остаётся вставить через Ctrl+V.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Где искать SIGame.exe: отдельная установка (%LOCALAPPDATA%\SIGame) и библиотеки Steam. */
export function findSigame(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates: string[] = [];
  if (env.LOCALAPPDATA) candidates.push(join(env.LOCALAPPDATA, "SIGame", "SIGame.exe"));
  const steamRoots = [env["ProgramFiles(x86)"], env.ProgramFiles].filter(Boolean).map((p) => join(p!, "Steam"));
  const libraries = new Set(steamRoots);
  for (const root of steamRoots) {
    try {
      const vdf = readFileSync(join(root, "steamapps", "libraryfolders.vdf"), "utf8");
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libraries.add(m[1].replace(/\\\\/g, "\\"));
    } catch { /* нет Steam */ }
  }
  for (const lib of libraries) candidates.push(join(lib, "steamapps", "common", "SIGame", "SIGame.exe"));
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** Запустить SIGame отдельно от нас (закрытие мастерской игру не закрывает). */
export function launchSigame(exe: string): void {
  spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
}

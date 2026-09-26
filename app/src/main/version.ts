// Версия КОДА программы. С загрузчиком (bootstrap/) код обновляется отдельно от exe: app.getVersion()
// отдаёт версию оболочки (exe, Electron, словари), а версию кода загрузчик кладёт в global.__yes.

import { app } from "electron";

interface BootInfo {
  codeVersion: string | null;
  shell: number;
  shellVersion: string;
  source: "builtin" | "downloaded" | "dev";
  codeRoot: string;
  ok(): void;
}

export function boot(): BootInfo | undefined {
  return (globalThis as { __yes?: BootInfo }).__yes;
}

/** Версия кода — её показываем, отправляем в статистику и сравниваем с обновлениями. */
export function appVersion(): string {
  return boot()?.codeVersion || app.getVersion();
}

/** Номер оболочки: код с другим номером без установщика не встанет. */
export function shellNumber(): number {
  return boot()?.shell ?? 0;
}

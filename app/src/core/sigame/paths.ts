// Где лежит собранный «Прогон в SIGame»: одна папка — и в компоненте (components/sigame), и при разработке
// (app/.sigame-src/build/sigame, npm run sigame-build).
//   runner/sigame-runner(.exe) — стенд с движком SIGame
//   table/index.html           — стол SIOnline с драйвером

import { join } from "node:path";

export interface SigameLayout {
  dir: string;
  runner: string;
  table: string;
}

export function sigameLayout(dir: string, platform: NodeJS.Platform): SigameLayout {
  return {
    dir,
    runner: join(dir, "runner", platform === "win32" ? "sigame-runner.exe" : "sigame-runner"),
    table: join(dir, "table", "index.html"),
  };
}

/** Сборка для разработки: app/.sigame-src/build/sigame. */
export const devSigameDir = (appRoot: string) => join(appRoot, ".sigame-src", "build", "sigame");

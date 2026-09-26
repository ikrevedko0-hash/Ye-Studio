// Упаковать код программы (out/) в dist-code/code.asar — то, что уходит в обновление кода (scripts/release.ts)
// и в локальную сборку (scripts/code-local.ts). Встроенный в exe код лежит прямо в app.asar (bootstrap/index.js).

import { createPackage } from "@electron/asar";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string; yesShell: number };
const outDir = join(root, "out");
const distDir = join(root, "dist-code");
const stage = join(distDir, "stage");

if (!existsSync(join(outDir, "main", "index.js"))) throw new Error("нет out/main/index.js — сначала electron-vite build");
if (!Number.isInteger(pkg.yesShell)) throw new Error("в package.json нет целого yesShell");

rmSync(distDir, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(outDir, join(stage, "out"), { recursive: true });
const asar = join(distDir, "code.asar");
void createPackage(stage, asar).then(() => {
  rmSync(stage, { recursive: true, force: true });
  const data = readFileSync(asar);
  console.log(`code.asar ${pkg.version} (оболочка ${pkg.yesShell}): ${(data.length / 1048576).toFixed(1)} МБ`);
});

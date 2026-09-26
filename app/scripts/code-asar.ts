// Упаковать код программы (out/) в dist-code/code.asar и записать его отпечаток в bootstrap/builtin.json.
// Запускается между `electron-vite build` и electron-builder (скрипты pack, setup, dist:update, release):
// electron-builder кладёт code.asar в resources/, а builtin.json — внутрь app.asar рядом с загрузчиком,
// который при каждом запуске сверяет встроенный код с этим отпечатком (bootstrap/index.js).

import { createPackage } from "@electron/asar";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  const info = { version: pkg.version, shell: pkg.yesShell, sha512: createHash("sha512").update(data).digest("base64") };
  writeFileSync(join(root, "bootstrap", "builtin.json"), JSON.stringify(info, null, 2) + "\n");
  console.log(`code.asar ${pkg.version} (оболочка ${pkg.yesShell}): ${(data.length / 1048576).toFixed(1)} МБ`);
});

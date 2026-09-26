// Снимки «до/после» для предложений по оформлению: одна сборка, CSS-предложение подмешивается флагом --css.
// Каждое предложение — отдельный файл в <папка предложений>/NN-имя.css, all.css — все вместе.
//
//   npx electron-vite build --outDir .design-out   (+ package.json с другим name и junction resources, см. AGENTS.md)
//   npx tsx scripts/design-shots.ts <пак.siq> <папка предложений> <папка снимков> [темы через запятую]
//
// Получается: before-<тема>.png, <предложение>-ye.png для каждого NN-*.css, all-<тема>.png для каждой темы.

import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const [pack, proposals, outDir, themesArg] = process.argv.slice(2);
if (!pack || !proposals || !outDir) throw new Error("usage: design-shots.ts <пак> <папка предложений> <папка снимков> [темы]");
const themes = (themesArg ?? "ye,dark,studio").split(",");
const app = resolve(__dirname, "..", ".design-out");
if (!existsSync(join(app, "package.json"))) throw new Error(`нет сборки ${app}`);
mkdirSync(outDir, { recursive: true });

const electron = require("electron") as unknown as string;
function shot(file: string, theme: string, css?: string): void {
  const args = [app, `--selftest=${resolve(pack)}`, `--theme=${theme}`, `--shot=${resolve(outDir, file)}`];
  if (css) args.push(`--css=${resolve(css)}`);
  const r = spawnSync(electron, args, { stdio: "inherit", timeout: 90_000 });
  console.log(`${r.status === 0 ? "ok " : "ERR"} ${file}`);
}

for (const t of themes) shot(`before-${t}.png`, t);
for (const f of readdirSync(proposals).filter((f) => /^\d\d-.*\.css$/.test(f)).sort())
  shot(`${f.replace(/\.css$/, "")}-ye.png`, "ye", join(proposals, f));
for (const t of themes) shot(`all-${t}.png`, t, join(proposals, "all.css"));

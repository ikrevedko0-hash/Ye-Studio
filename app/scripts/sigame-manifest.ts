// Вписать «Прогон в SIGame» в resources/components.json по собранным архивам (npm run sigame-build -- --zip-dir …):
// размер и SHA-256 каждого архива, адрес — ассет релиза GitHub с тегом --tag.
// npm run sigame-manifest -- --tag sigame-7.13.12-c94254f --dir папка-с-архивами [--repo владелец/репозиторий]

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseManifest } from "../src/core/components/manifest";

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const tag = opt("--tag");
const dir = resolve(opt("--dir") ?? ".");
// не Ye-Studio: его релизы — обновления самого приложения (см. .github/workflows/sigame-runner.yml)
const repo = opt("--repo") ?? "ikrevedko0-hash/ye-studio-components";
if (!tag) throw new Error("нужен --tag (тег релиза с архивами)");

const app = resolve(__dirname, "..");
const versions = JSON.parse(readFileSync(join(app, "tools", "sigame-runner", "versions.json"), "utf8"));
const manifestPath = join(app, "resources", "components.json");
const m = JSON.parse(readFileSync(manifestPath, "utf8").replace(/^﻿/, ""));

const files: [string, string, string, string][] = [
  ["sigame-runner", "sigame-runner-win-x64.zip", `Движок SIGame ${versions.SI.version} (стенд прогона)`, "sigame/runner"],
  ["sigame-table", "sigame-table.zip", "Стол SIOnline (экран игрока)", "sigame/table"],
];
for (const [id, name, title, unzipTo] of files) {
  const data = readFileSync(join(dir, name));
  m.files[id] = {
    title, url: `https://github.com/${repo}/releases/download/${tag}/${name}`,
    size: data.length, sha256: createHash("sha256").update(data).digest("hex"), unzipTo,
  };
}
m.tools = { ...m.tools, sigame: { version: `${versions.SI.version} / ${versions.SIOnline.commit.slice(0, 7)}`, files: files.map(([id]) => id) } };
const text = JSON.stringify(m, null, 2) + "\n";
parseManifest(text);
writeFileSync(manifestPath, text);
console.log(`components.json: sigame ${m.tools.sigame.version}`);

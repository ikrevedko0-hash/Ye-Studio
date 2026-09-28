// Вписать компонент «Прогон в SIGame» в src/core/sigame/component.ts по собранным архивам
// (npm run sigame-build -- --zip-dir …): размер и SHA-256 каждого архива, адрес — ассет релиза GitHub с тегом --tag.
// npm run sigame-manifest -- --tag sigame-7.13.12-c94254f --dir папка-с-архивами [--repo владелец/репозиторий]
// Обычно это делает сам workflow sigame-runner после выпуска архивов.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { mergeManifest, parseManifest, type Manifest } from "../src/core/components/manifest";

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const tag = opt("--tag");
const dir = resolve(opt("--dir") ?? ".");
const repo = opt("--repo") ?? "ikrevedko0-hash/Ye-Studio";
if (!tag) throw new Error("нужен --tag (тег релиза с архивами)");
// релизы vX.Y.Z — обновления самого приложения; архивы компонента — только под своим тегом
if (!tag.startsWith("sigame-")) throw new Error("тег архивов должен начинаться с sigame-");

const app = resolve(__dirname, "..");
const versions = JSON.parse(readFileSync(join(app, "tools", "sigame-runner", "versions.json"), "utf8"));

const list: [string, string, string, string][] = [
  ["sigame-runner", "sigame-runner-win-x64.zip", `Движок SIGame ${versions.SI.version} (стенд прогона)`, "sigame/runner"],
  ["sigame-table", "sigame-table.zip", "Стол SIOnline (экран игрока)", "sigame/table"],
];
const part: Pick<Manifest, "files" | "tools"> = { files: {}, tools: {} };
for (const [id, name, title, unzipTo] of list) {
  const data = readFileSync(join(dir, name));
  part.files[id] = {
    title, url: `https://github.com/${repo}/releases/download/${tag}/${name}`,
    size: data.length, sha256: createHash("sha256").update(data).digest("hex"), unzipTo,
  };
}
part.tools!.sigame = { version: `${versions.SI.version} / ${versions.SIOnline.commit.slice(0, 7)} / r${versions.runner ?? 1}`, files: list.map(([id]) => id) };

// проверка тем же разбором, что и в приложении: вместе с манифестом оболочки
const base = parseManifest(readFileSync(join(app, "resources", "components.json"), "utf8"));
parseManifest(JSON.stringify(mergeManifest(base, part)));

const file = join(app, "src", "core", "sigame", "component.ts");
const src = readFileSync(file, "utf8");
const head = src.slice(0, src.indexOf("export const SIGAME_COMPONENT"));
writeFileSync(file, `${head}export const SIGAME_COMPONENT: Pick<Manifest, "files" | "tools"> | null = ${JSON.stringify(part, null, 2)};\n`);
console.log(`component.ts: sigame ${part.tools!.sigame.version}, ${list.map(([id]) => `${id} ${(part.files[id].size / 1048576).toFixed(1)} МБ`).join(", ")}`);

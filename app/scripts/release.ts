// Выпуск Ye!Studio на GitHub Releases:  npm run release -- [--notes "что нового"] [--dry-run]
//
// К каждому релизу прикладывается:
//   code.json + code-<версия>.asar.gz — лёгкое обновление кода (~1,5 МБ), подписанное ключом автора;
//   установщик + .blockmap + beta.yml / latest.yml — для первой установки и для обновления ОБОЛОЧКИ
//     (electron-updater ищет установщик только в последнем релизе, поэтому он есть в каждом).
// Установки с той же оболочкой (yesShell) берут только код; установщик качают те, у кого оболочка старее.
//
// Оболочка = всё, что код не может поменять сам: Electron, загрузчик (bootstrap/), resources/, pot-provider,
// настройки сборки. Её отпечаток (shellHash) пишется в code.json. Если он изменился, а yesShell в package.json
// тот же — выпуск останавливается: иначе новый код ушёл бы на старые оболочки, где ему нечего открыть.
//
// --dry-run: всё собрать и подписать в dist-release/, ничего не выкладывать.

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { cmpVersion, sha512, signMeta, verifyMeta, type CodeMeta } from "../bootstrap/pick.js";
import PUBLIC_KEY from "../bootstrap/public-key.js";

const REPO = "ikrevedko0-hash/Ye-Studio";
const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const notes = args.includes("--notes") ? args[args.indexOf("--notes") + 1] ?? "" : "";
const keyFile = join(homedir(), ".yestudio", "code-signing-key.pem");
const out = join(root, "dist-release");

const sh = (cmd: string, quiet = false) => execSync(cmd, { cwd: root, stdio: quiet ? "pipe" : "inherit", encoding: "utf8" }) as unknown as string;
const fail = (msg: string): never => { console.error(`\n✖ ${msg}`); process.exit(1); };

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string; yesShell: number; build: unknown };
const version = pkg.version;
const tag = `v${version}`;

// ---------- проверки до сборки ----------

if (!existsSync(keyFile)) fail(`Нет ключа подписи ${keyFile}. Без него обновление кода не выпустить (см. bootstrap/public-key.js).`);
const privateKey = readFileSync(keyFile);
if (!dry) {
  try { sh(`gh release view ${tag} --repo ${REPO}`, true); fail(`Релиз ${tag} уже есть — поднимите version в package.json.`); } catch { /* нет — хорошо */ }
}

// ---------- отпечаток оболочки ----------

function hashTree(h: ReturnType<typeof createHash>, dir: string): void {
  if (!existsSync(dir)) return;
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else h.update(`${relative(root, p).replace(/\\/g, "/")}\0${st.size}\0`).update(readFileSync(p));
    }
  };
  walk(dir);
}

function shellHash(): string {
  const h = createHash("sha256");
  const electron = JSON.parse(readFileSync(join(root, "node_modules", "electron", "package.json"), "utf8")).version;
  h.update(`electron ${electron}\0shell ${pkg.yesShell}\0`).update(JSON.stringify(pkg.build));
  for (const f of ["index.js", "pick.js", "public-key.js"]) h.update(readFileSync(join(root, "bootstrap", f)));
  hashTree(h, join(root, "resources"));
  hashTree(h, join(root, "tools", "pot-provider", "build"));
  h.update(readFileSync(join(root, "tools", "pot-provider", "package-lock.json")));
  return h.digest("hex");
}

// ---------- прошлый релиз ----------

interface Rel { tagName: string; isDraft: boolean }
function previousMeta(): (CodeMeta & { shellHash?: string }) | null {
  const rels = JSON.parse(sh(`gh release list --repo ${REPO} --limit 30 --json tagName,isDraft`, true)) as Rel[];
  const tags = rels.filter((r) => !r.isDraft && r.tagName !== tag).map((r) => r.tagName).sort((a, b) => cmpVersion(b, a));
  for (const t of tags) {
    const dir = join(out, "prev");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    try {
      sh(`gh release download ${t} --repo ${REPO} --pattern code.json --dir "${dir}"`, true);
      const meta = JSON.parse(readFileSync(join(dir, "code.json"), "utf8"));
      if (verifyMeta(meta, PUBLIC_KEY)) return meta;
    } catch { /* старый релиз без code.json */ }
  }
  return null;
}

// ---------- сборка ----------

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
console.log(`== Ye!Studio ${version}, оболочка ${pkg.yesShell} ==`);
sh("npx electron-vite build");
sh("npx tsx scripts/code-asar.ts");

const hash = shellHash();
const prev = dry ? null : previousMeta();
if (prev) {
  if (cmpVersion(version, prev.version) <= 0) fail(`Версия ${version} не новее прошлой (${prev.version}).`);
  if (pkg.yesShell < prev.shell) fail(`yesShell ${pkg.yesShell} меньше прошлого (${prev.shell}).`);
  if (pkg.yesShell === prev.shell && prev.shellHash && prev.shellHash !== hash)
    fail(`Оболочка изменилась (Electron, bootstrap/, resources/, pot-provider или настройки сборки), а yesShell тот же (${pkg.yesShell}).\n` +
      `  Поднимите "yesShell" в package.json: старые установки получат установщик, а не код, которому нечего открыть.`);
  console.log(pkg.yesShell > prev.shell ? `Оболочка новая (${prev.shell} → ${pkg.yesShell}): все обновятся установщиком.`
    : `Оболочка та же — установки ${prev.version}+ обновятся кодом.`);
} else {
  console.log(dry ? "Пробный выпуск: прошлый релиз не смотрю." : "Прошлого релиза с code.json нет — это первый выпуск с лёгкими обновлениями.");
}

const asar = readFileSync(join(root, "dist-code", "code.asar"));
const gzName = `code-${version}.asar.gz`;
const gz = gzipSync(asar, { level: 9 });
writeFileSync(join(out, gzName), gz);
const meta: CodeMeta & { shellHash: string; date: string } = {
  version, shell: pkg.yesShell, size: asar.length, sha512: sha512(asar), gz: gzName, gzSize: gz.length,
  notes: notes || undefined, date: new Date().toISOString(), shellHash: hash,
};
meta.sig = signMeta(meta, privateKey);
if (!verifyMeta(meta, PUBLIC_KEY)) fail("Подпись не сходится с bootstrap/public-key.js — ключ не тот.");
writeFileSync(join(out, "code.json"), JSON.stringify(meta, null, 2) + "\n");
console.log(`Код: ${(asar.length / 1048576).toFixed(1)} МБ, в архиве ${(gz.length / 1048576).toFixed(1)} МБ, подписан.`);

// установщик — в каждом релизе (см. шапку). Старые yml из прошлых сборок убрать: иначе в релиз уедет
// beta.yml прошлой версии (так было в v0.2.0 — пришлось перезаливать).
const setup = join(root, "dist-setup");
for (const f of ["beta.yml", "latest.yml"]) rmSync(join(setup, f), { force: true });
sh("npx electron-builder --win nsis --config.directories.output=dist-setup --publish never");
const exe = `Ye-Studio-Setup-${version}.exe`;
if (!existsSync(join(setup, exe))) fail(`Не собрался ${exe}`);
for (const f of [exe, `${exe}.blockmap`]) copyFileSync(join(setup, f), join(out, f));
const yml = ["beta.yml", "latest.yml"].map((f) => join(setup, f)).find(existsSync) ?? fail("electron-builder не написал beta.yml / latest.yml");
if (!readFileSync(yml, "utf8").startsWith(`version: ${version}\n`)) fail(`${yml} не для версии ${version}`);
copyFileSync(yml, join(out, "beta.yml"));
copyFileSync(yml, join(out, "latest.yml"));

const files = [exe, `${exe}.blockmap`, gzName, "beta.yml", "latest.yml", "code.json"];
console.log(`\nГотово в ${out}:\n  ${files.join("\n  ")}`);
if (dry) process.exit(0);

// ---------- выкладка: черновик → файлы → публикация (клиенты не видят недокачанный релиз) ----------

const pre = version.includes("-") ? "--prerelease" : "";
const notesFile = join(out, "notes.md");
writeFileSync(notesFile, notes || `Ye!Studio ${version}`);
sh(`gh release create ${tag} --repo ${REPO} --draft ${pre} --title "Ye!Studio ${version}" --notes-file "${notesFile}"`);
sh(`gh release upload ${tag} --repo ${REPO} ${files.map((f) => `"${join(out, f)}"`).join(" ")}`);
sh(`gh release edit ${tag} --repo ${REPO} --draft=false`);
console.log(`\n✔ Выпущено: https://github.com/${REPO}/releases/tag/${tag}`);

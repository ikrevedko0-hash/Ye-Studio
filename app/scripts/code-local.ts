// Обновить код в локальном exe без пересборки exe:  npm run code
//
// Собирает out/ → code.asar, подписывает ключом автора и кладёт в %LOCALAPPDATA%\Ye!Studio\code\ как
// «скачанное обновление» с версией <версия>.dev.<время>. Загрузчик (bootstrap/) при следующем запуске
// Ye!Studio возьмёт его: версия новее встроенной, но старее следующего настоящего релиза — тот её сменит.
// Занимает секунды вместо минут `npm run pack`. Пересобирать exe (`npm run pack`) нужно, только когда
// меняется оболочка: Electron, bootstrap/, resources/, pot-provider, настройки сборки (yesShell).

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { sha512, signMeta } from "../bootstrap/pick.js";

const root = resolve(import.meta.dirname, "..");
const t0 = Date.now();
const keyFile = join(homedir(), ".yestudio", "code-signing-key.pem");
if (!existsSync(keyFile)) throw new Error(`нет ключа подписи ${keyFile}`);

execSync("npx electron-vite build", { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
execSync("npx tsx scripts/code-asar.ts", { cwd: root, stdio: "inherit" });

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string; yesShell: number };
// <версия>.dev.<время> — новее встроенной; для релизной версии (без «-») — следующий патч с -dev,
// иначе 0.3.0-dev.* оказалась бы старее встроенной 0.3.0
const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const version = pkg.version.includes("-")
  ? `${pkg.version}.dev.${stamp}`
  : `${pkg.version.replace(/(\d+)$/, (p) => String(+p + 1))}-dev.${stamp}`;

const asar = readFileSync(join(root, "dist-code", "code.asar"));
const meta: Parameters<typeof signMeta>[0] & { notes: string } = {
  version, shell: pkg.yesShell, size: asar.length, sha512: sha512(asar), notes: "локальная сборка",
};
meta.sig = signMeta(meta, readFileSync(keyFile));

const codeRoot = join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Ye!Studio", "code");
const tmp = join(codeRoot, `.dl-local-${stamp}`);
mkdirSync(tmp, { recursive: true });
writeFileSync(join(tmp, "code.asar"), asar);
writeFileSync(join(tmp, "code.json"), JSON.stringify(meta, null, 2));
rmSync(join(codeRoot, version), { recursive: true, force: true });
renameSync(tmp, join(codeRoot, version));

console.log(`\n✔ Код ${version} готов за ${Math.round((Date.now() - t0) / 1000)} с. Перезапустите Ye!Studio — подхватит его.`);
console.log(`  (оболочка ${pkg.yesShell}: если у exe другая — нужен npm run pack)`);

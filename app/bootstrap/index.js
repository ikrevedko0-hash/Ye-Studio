"use strict";
// ---------- загрузчик Ye!Studio ----------
// resources/app.asar — этот загрузчик и встроенный код (out/); весь app.asar защищает проверка целостности
// Electron. Скачанные обновления кода — code.asar в %LOCALAPPDATA%\Ye!Studio\code\<версия>\ (вне resources/:
// там Electron требует, чтобы каждый .asar был в его списке целостности). Берётся самая новая версия, которая:
//   — подписана ключом автора (bootstrap/public-key.js) и совпадает с подписью байт в байт (sha512);
//   — сделана для этой оболочки (номер yesShell: Electron, словари, компоненты — то, что меняет только установщик);
//   — не падала дважды подряд до открытия окна (программа отмечает успешный старт через global.__yes.ok()).
// Если ни одна скачанная не годится — встроенный код из этого же app.asar.
//
// Разработка (`npx electron .`, самопроверки): код берётся прямо из out/. YES_BOOT_TEST=1 включает
// «боевой» выбор и в разработке: YES_BOOT_BUILTIN — «встроенный» code.asar (вместо app.asar), YES_CODE_DIR — папка обновлений.

const { app } = require("electron");
const path = require("path");
const fs = require("original-fs"); // обычный fs видит .asar как папку, а нам нужны байты архива
const { order, sha512, verifyMeta, MAX_ATTEMPTS } = require("./pick");
const PUBLIC_KEY = require("./public-key");
const pkg = require("../package.json");

const builtin = { version: pkg.version, shell: pkg.yesShell };
const SHELL = builtin.shell;
const bootTest = process.env.YES_BOOT_TEST === "1";

function expose(extra) {
  global.__yes = { shell: SHELL, shellVersion: app.getVersion(), codeRoot, ok() {}, ...extra };
}

const codeRoot = process.env.YES_CODE_DIR || path.join(process.env.LOCALAPPDATA || app.getPath("appData"), "Ye!Studio", "code");

if (!app.isPackaged && !bootTest) {
  expose({ codeVersion: pkg.version, source: "dev" });
  require(path.join(__dirname, "..", "out", "main", "index.js"));
  return;
}

// ---------- состояние запусков: сколько раз версия не дожила до окна ----------

const bootFile = path.join(codeRoot, "boot.json");
function readBoot() {
  try {
    const b = JSON.parse(fs.readFileSync(bootFile, "utf8"));
    return { attempts: b.attempts || {}, bad: Array.isArray(b.bad) ? b.bad : [] };
  } catch {
    return { attempts: {}, bad: [] };
  }
}
function writeBoot(b) {
  try {
    fs.mkdirSync(codeRoot, { recursive: true });
    fs.writeFileSync(bootFile + ".tmp", JSON.stringify(b));
    fs.renameSync(bootFile + ".tmp", bootFile);
  } catch { /* нет доступа — живём без страховки, но запускаемся */ }
}

// ---------- кандидаты ----------

function downloaded() {
  let names = [];
  try { names = fs.readdirSync(codeRoot); } catch { return []; }
  const out = [];
  for (const name of names) {
    const dir = path.join(codeRoot, name);
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, "code.json"), "utf8"));
      if (meta.version !== name) continue;
      out.push({ version: meta.version, shell: meta.shell, source: "downloaded", signed: verifyMeta(meta, PUBLIC_KEY), meta,
        asar: path.join(dir, "code.asar") });
    } catch { /* недокачанная или чужая папка */ }
  }
  return out;
}

/** Скачанный код байт в байт тот, что подписан. Встроенный проверяет сам Electron (целостность app.asar). */
function intact(c) {
  if (c.source === "builtin") return true;
  try {
    const data = fs.readFileSync(c.asar);
    return data.length === c.meta.size && sha512(data) === c.meta.sha512;
  } catch {
    return false;
  }
}

// встроенный код — корень app.asar (bootstrap/ и out/ рядом)
const builtinAsar = bootTest ? process.env.YES_BOOT_BUILTIN : path.join(__dirname, "..");
const boot = readBoot();
const list = order([{ version: builtin.version, shell: SHELL, source: "builtin", asar: builtinAsar }, ...downloaded()], SHELL, boot.bad);

let chosen = null;
for (const c of list) {
  if (!intact(c)) continue;
  if (c.source === "downloaded") {
    const n = (boot.attempts[c.version] || 0) + 1;
    if (n > MAX_ATTEMPTS) {                   // дважды не дожила до окна — откладываем, берём следующую
      boot.bad.push(c.version);
      delete boot.attempts[c.version];
      writeBoot(boot);
      continue;
    }
    boot.attempts[c.version] = n;
    writeBoot(boot);
  }
  chosen = c;
  break;
}

expose({
  codeVersion: chosen.version,
  source: chosen.source,
  /** Окно открылось — эта версия рабочая: сбрасываем счётчик неудачных запусков. */
  ok() {
    if (chosen.source !== "downloaded") return;
    const b = readBoot();
    delete b.attempts[chosen.version];
    writeBoot(b);
  },
});

try {
  require(path.join(chosen.asar, "out", "main", "index.js"));
} catch (err) {
  if (chosen.source === "downloaded") {
    // упала сразу при загрузке — откладываем и перезапускаемся на предыдущей
    const b = readBoot();
    b.bad.push(chosen.version);
    delete b.attempts[chosen.version];
    writeBoot(b);
    app.relaunch();
    app.exit(0);
    return;
  }
  throw err;
}

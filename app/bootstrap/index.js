"use strict";
// ---------- загрузчик Ye!Studio ----------
// resources/app.asar — только этот маленький загрузчик (его защищает проверка целостности Electron).
// Сам код программы — в code.asar: встроенный в resources/ и скачанные обновления в
// %LOCALAPPDATA%\Ye!Studio\code\<версия>\. Загрузчик берёт самую новую версию, которая:
//   — подписана ключом автора (bootstrap/public-key.js) и совпадает с подписью байт в байт (sha512);
//   — сделана для этой оболочки (номер yesShell: Electron, словари, компоненты — то, что меняет только установщик);
//   — не падала дважды подряд до открытия окна (программа отмечает успешный старт через global.__yes.ok()).
// Встроенный code.asar сверяется с sha512, записанным при сборке в builtin.json (он внутри app.asar).
//
// Разработка (`npx electron .`, самопроверки): код берётся прямо из out/. YES_BOOT_TEST=1 включает
// «боевой» выбор и в разработке: YES_BOOT_BUILTIN — путь к встроенному code.asar, YES_CODE_DIR — папка обновлений.

const { app, dialog } = require("electron");
const path = require("path");
const fs = require("original-fs"); // обычный fs видит .asar как папку, а нам нужны байты архива
const { order, sha512, verifyMeta, MAX_ATTEMPTS } = require("./pick");
const PUBLIC_KEY = require("./public-key");
const pkg = require("../package.json");

let builtin;
try {
  builtin = require("./builtin.json"); // { version, shell, sha512 } — пишет scripts/code-asar.ts при сборке
} catch {
  builtin = { version: pkg.version, shell: pkg.yesShell, sha512: null };
}
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

function intact(c) {
  try {
    const data = fs.readFileSync(c.asar);
    const want = c.source === "builtin" ? builtin.sha512 : c.meta.sha512;
    if (c.source === "downloaded" && data.length !== c.meta.size) return false;
    return !want || sha512(data) === want;
  } catch {
    return false;
  }
}

const builtinAsar = bootTest ? process.env.YES_BOOT_BUILTIN : path.join(process.resourcesPath, "code.asar");
const boot = readBoot();
const list = order([{ version: builtin.version, shell: SHELL, source: "builtin", asar: builtinAsar }, ...downloaded()], SHELL, boot.bad);

let chosen = null;
for (const c of list) {
  if (!intact(c)) {
    if (c.source === "builtin") {
      dialog.showErrorBox("Ye!Studio", "Файлы программы повреждены (code.asar не совпадает со сборкой). Переустановите Ye!Studio.");
      app.exit(1);
      return;
    }
    continue;
  }
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

// Собрать «Прогон в SIGame» в одну папку (см. src/core/sigame/paths.ts):
//   runner/ — стенд tools/sigame-runner с движком SIGame (dotnet publish, самодостаточный)
//   table/  — комната SIOnline (tools/sionline-table/YeRoom.tsx) + страница-драйвер
// Исходники берутся из app/.sigame-src (npm run sigame-src), коммиты — tools/sigame-runner/versions.json.
//
// npm run sigame-build [-- --rid win-x64] [--out папка] [--zip файл.zip]

import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const app = resolve(__dirname, "..");
const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const rid = opt("--rid") ?? (process.platform === "win32" ? "win-x64" : process.platform === "darwin" ? "osx-x64" : "linux-x64");
const out = resolve(opt("--out") ?? join(app, ".sigame-src", "build", "sigame"));
const zip = opt("--zip");
const src = join(app, ".sigame-src");
const si = join(src, "SI");
const sio = join(src, "SIOnline");
const win = process.platform === "win32";

function run(cmd: string, a: string[], cwd: string) {
  console.log(`> ${cmd} ${a.join(" ")}`);
  execFileSync(cmd, a, { cwd, stdio: "inherit", shell: win });
}

for (const d of [si, sio]) if (!existsSync(d)) throw new Error(`нет ${d} — сначала npm run sigame-src`);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// ---------- стенд ----------
run("dotnet", ["publish", join(app, "tools", "sigame-runner", "sigame-runner.csproj"), "-c", "Release", "-r", rid, "--self-contained", "true",
  "-p:PublishSingleFile=true", "-p:IncludeNativeLibrariesForSelfExtract=true", "-p:DebugType=none", `-p:SIRoot=${si}`, "-o", join(out, "runner")], app);
copyFileSync(join(si, "LICENSE"), join(out, "runner", "LICENSE-SIGame.txt"));

// ---------- стол ----------
// Библиотечная сборка SIOnline на закреплённом коммите падает при старте: LibraryCore.tsx берёт
// reduxThunk.withExtraArgument из default-экспорта, которого в redux-thunk 3 нет. Меняем одну строку импорта
// на время сборки и возвращаем файл как был.
const core = join(sio, "src", "LibraryCore.tsx");
const coreOrig = readFileSync(core, "utf8");
const entry = join(sio, "src", "YeRoom.tsx");
try {
  writeFileSync(core, coreOrig
    .replace("import reduxThunk from 'redux-thunk';", "import { withExtraArgument } from 'redux-thunk';")
    .replace("reduxThunk.withExtraArgument(dataContext)", "withExtraArgument(dataContext)"));
  copyFileSync(join(app, "tools", "sionline-table", "YeRoom.tsx"), entry);
  if (!existsSync(join(sio, "node_modules"))) run("npm", ["ci", "--no-audit", "--no-fund", "--ignore-scripts"], sio);
  run("npx", ["webpack", "--mode", "production", "--env", "type=library-table", "--entry-reset", "--entry", "./src/YeRoom.tsx", "--output-path", join(out, "table")], sio);
} finally {
  writeFileSync(core, coreOrig);
  rmSync(entry, { force: true });
}
for (const f of ["driver.js", "start.js", "config.js"]) copyFileSync(join(app, "tools", "sionline-table", f), join(out, "table", f));
writeFileSync(join(out, "table", "index.html"), readFileSync(join(app, "tools", "sionline-table", "index.html"), "utf8").replace(/sionline\//g, ""));
copyFileSync(join(sio, "LICENSE"), join(out, "table", "LICENSE-SIOnline.txt"));
cpSync(join(app, "tools", "sigame-runner", "versions.json"), join(out, "versions.json"));

console.log(`\nГотово: ${out}`);

if (zip) {
  const z = resolve(zip);
  rmSync(z, { force: true });
  if (win) run("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${out}\\*' -DestinationPath '${z}'`], app);
  else run("zip", ["-qr", z, "."], out);
  console.log(`Архив: ${z}`);
}

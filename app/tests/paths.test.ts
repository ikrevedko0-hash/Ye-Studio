import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findFfmpeg, FfmpegMissingError, ffmpegSearchPlaces, type FfmpegSearch } from "../src/core/media/ffmpeg";
import { defaultComponentsDir, forgetComponent, inComponents, readComponents, saveComponent } from "../src/main/components";
import { resolveLaunch } from "../src/core/ai/localServer";

/** Выдуманный диск: набор файлов, папки выводятся из путей. */
function fakeDisk(files: string[]): Pick<FfmpegSearch, "exists" | "listDir"> {
  const norm = (p: string) => p.replace(/[\\/]+$/, "").toLowerCase();
  const set = new Set(files.map(norm));
  return {
    exists: (p) => set.has(norm(p)),
    listDir: (dir) => {
      const prefix = norm(dir) + "\\";
      const names = new Set<string>();
      for (const f of files) if (norm(f).startsWith(prefix)) names.add(f.slice(prefix.length).split("\\")[0]);
      return [...names];
    },
  };
}

const LAD = "C:\\Users\\author\\AppData\\Local";
const PKG = `${LAD}\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe`;
const wingetBin = (ver: string) => `${PKG}\\ffmpeg-${ver}-full_build\\bin`;
const pair = (dir: string) => [`${dir}\\ffmpeg.exe`, `${dir}\\ffprobe.exe`];
const RES = "C:\\Program Files\\Мастерская паков\\resources";

const win = (files: string[], extra: Partial<FfmpegSearch> = {}): FfmpegSearch => ({
  platform: "win32",
  localAppData: LAD,
  resourcesDir: RES,
  pathEnv: "C:\\Windows\\system32;C:\\tools\\ffmpeg\\bin",
  ...fakeDisk(files),
  ...extra,
});

describe("findFfmpeg", () => {
  it("находит winget 9.0.1 — как у автора сейчас", () => {
    const t = findFfmpeg(win(pair(wingetBin("9.0.1"))));
    expect(t).toEqual({ ffmpeg: `${wingetBin("9.0.1")}\\ffmpeg.exe`, ffprobe: `${wingetBin("9.0.1")}\\ffprobe.exe`, dir: wingetBin("9.0.1"), source: "winget" });
  });
  it("берёт любую версию winget, при нескольких — самую новую", () => {
    const t = findFfmpeg(win([...pair(wingetBin("9.0.1")), ...pair(wingetBin("10.1")), ...pair(wingetBin("8.2.3"))]));
    expect(t?.dir).toBe(wingetBin("10.1"));
  });
  it("понимает пакет Gyan.FFmpeg.Essentials", () => {
    const dir = `${LAD}\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.0-essentials_build\\bin`;
    expect(findFfmpeg(win(pair(dir)))?.source).toBe("winget");
  });
  it("пропускает сборку winget без ffprobe", () => {
    const t = findFfmpeg(win([`${wingetBin("10.0")}\\ffmpeg.exe`, ...pair(wingetBin("9.0.1"))]));
    expect(t?.dir).toBe(wingetBin("9.0.1"));
  });
  it("resources/bin из установщика важнее winget", () => {
    const t = findFfmpeg(win([...pair(`${RES}\\bin`), ...pair(wingetBin("9.0.1"))]));
    expect(t?.source).toBe("bundled");
    expect(t?.ffprobe).toBe(`${RES}\\bin\\ffprobe.exe`);
  });
  it("компонент из окна «Компоненты» важнее winget и PATH, но уступает resources/bin", () => {
    const COMP = `${LAD}\\Мастерская паков\\components\\ffmpeg`;
    const t = findFfmpeg(win([...pair(COMP), ...pair(wingetBin("9.0.1")), ...pair("C:\\tools\\ffmpeg\\bin")], { componentDir: COMP }));
    expect(t?.source).toBe("component");
    expect(t?.dir).toBe(COMP);
    expect(findFfmpeg(win([...pair(COMP), ...pair(`${RES}\\bin`)], { componentDir: COMP }))?.source).toBe("bundled");
  });
  it("настройка важнее всего — и путь к файлу, и путь к папке сборки", () => {
    const own = "D:\\ffmpeg-7\\bin";
    const files = [...pair(own), ...pair(`${RES}\\bin`), ...pair(wingetBin("9.0.1"))];
    expect(findFfmpeg(win(files, { setting: `${own}\\ffmpeg.exe` }))?.source).toBe("setting");
    expect(findFfmpeg(win(files, { setting: "D:\\ffmpeg-7" }))?.dir).toBe(own);
    expect(findFfmpeg(win(files, { setting: `"${own}"` }))?.dir).toBe(own);
  });
  it("неверная настройка не мешает найти остальное", () => {
    expect(findFfmpeg(win(pair(wingetBin("9.0.1")), { setting: "D:\\нет-такого" }))?.source).toBe("winget");
  });
  it("последним ищет в PATH", () => {
    const t = findFfmpeg(win(pair("C:\\tools\\ffmpeg\\bin")));
    expect(t?.source).toBe("path");
    expect(t?.ffmpeg).toBe("C:\\tools\\ffmpeg\\bin\\ffmpeg.exe");
  });
  it("ничего нет — null", () => {
    expect(findFfmpeg(win([]))).toBeNull();
    expect(findFfmpeg(win([], { localAppData: undefined, pathEnv: undefined, resourcesDir: undefined }))).toBeNull();
  });
  it("на Linux ищет без .exe и через «:»", () => {
    const set = new Set(["/usr/bin/ffmpeg", "/usr/bin/ffprobe"]);
    const t = findFfmpeg({ platform: "linux", pathEnv: "/usr/local/bin:/usr/bin", exists: (p) => set.has(p), listDir: () => [] });
    expect(t).toEqual({ ffmpeg: "/usr/bin/ffmpeg", ffprobe: "/usr/bin/ffprobe", dir: "/usr/bin", source: "path" });
  });
});

describe("ошибка «ffmpeg не найден»", () => {
  it("говорит, где искали и что делать", () => {
    const e = new FfmpegMissingError(ffmpegSearchPlaces({ platform: "win32", resourcesDir: RES, setting: "D:\\x" }));
    expect(e.message).toMatch(/^ffmpeg не найден/);
    expect(e.message).toContain("winget install Gyan.FFmpeg");
    expect(e.message).toContain(`${RES}\\bin`);
    expect(e.message).toContain("D:\\x");
    expect(e.message).not.toMatch(/ENOENT/);
  });
});

describe("папка компонентов", () => {
  it("по умолчанию — %LOCALAPPDATA%\\Мастерская паков\\components", () => {
    expect(defaultComponentsDir({ LOCALAPPDATA: LAD }, "win32", "C:\\Users\\author")).toBe(`${LAD}\\Мастерская паков\\components`);
    expect(defaultComponentsDir({}, "win32", "C:\\Users\\author")).toBe(`${LAD}\\Мастерская паков\\components`);
  });
  it("абсолютные пути (и Windows-пути на Linux) не трогает, относительные кладёт внутрь", () => {
    expect(inComponents("C:\\нейро-свояк\\local-image", "/base")).toBe("C:\\нейро-свояк\\local-image");
    expect(inComponents("/opt/x", "/base")).toBe("/opt/x");
    expect(inComponents("model/sd-server", "/base")).toBe(join("/base", "model/sd-server"));
  });

  let dir: string | undefined;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });

  it("читает и пишет components.json", async () => {
    dir = mkdtempSync(join(tmpdir(), "components-"));
    expect(await readComponents(dir)).toEqual({ version: 1, components: {} });
    await saveComponent({ id: "yt-dlp", version: "2026.09.01", path: "yt-dlp", installedAt: "2026-09-24T00:00:00Z" }, dir);
    await saveComponent({ id: "model", path: "model", profile: "light" }, dir);
    const data = await readComponents(dir);
    expect(data.components["yt-dlp"].version).toBe("2026.09.01");
    expect(data.components.model.installedAt).toBeTruthy();
    expect(JSON.parse(readFileSync(join(dir, "components.json"), "utf8")).components.model.profile).toBe("light");
    await forgetComponent("model", dir);
    expect(Object.keys((await readComponents(dir)).components)).toEqual(["yt-dlp"]);
  });
  it("испорченный components.json — пустой список, без падения", async () => {
    dir = mkdtempSync(join(tmpdir(), "components-"));
    writeFileSync(join(dir, "components.json"), "{ не json");
    expect(await readComponents(dir)).toEqual({ version: 1, components: {} });
  });
});

describe("resolveLaunch (providers.json → sdcpp)", () => {
  const abs = { exe: "C:\\нейро-свояк\\local-image\\sd-server.exe", args: ["-m", "model.gguf"], cwd: "C:\\нейро-свояк\\local-image" };
  it("абсолютные пути автора остаются как были", () => {
    expect(resolveLaunch(abs, "/comp", () => false)).toEqual(abs);
  });
  it("без папки компонентов ничего не меняет", () => {
    const rel = { exe: "model/sd-server.exe", cwd: "model" };
    expect(resolveLaunch(rel, undefined)).toBe(rel);
  });
  it("относительные exe и cwd — внутри папки компонентов", () => {
    const r = resolveLaunch({ exe: "model/sd-server.exe", args: ["--port", "7861"], cwd: "model" }, "/comp", () => false);
    expect(r).toEqual({ exe: join("/comp", "model/sd-server.exe"), args: ["--port", "7861"], cwd: join("/comp", "model") });
  });
  it("голое имя: из папки компонентов, из cwd или из PATH", () => {
    expect(resolveLaunch({ exe: "sd-server.exe" }, "/comp", (p) => p === join("/comp", "sd-server.exe")).exe).toBe(join("/comp", "sd-server.exe"));
    expect(resolveLaunch({ exe: "sd-server.exe", cwd: "model" }, "/comp", (p) => p === join("/comp", "model", "sd-server.exe")).exe).toBe(join("/comp", "model", "sd-server.exe"));
    expect(resolveLaunch({ exe: "sd-server.exe" }, "/comp", () => false).exe).toBe("sd-server.exe");
  });
});

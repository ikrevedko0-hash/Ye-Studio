import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectProfile, launchFor, parseManifest, planProfile, planTool, totalBytes, type Manifest } from "../src/core/components/manifest";
import { ytdlpCommand } from "../src/core/media/providers/youtube";
import { downloadResumable } from "../src/main/modelInstall";

const manifest: Manifest = parseManifest(readFileSync(join(__dirname, "..", "resources", "components.json"), "utf8"));
const GB = 1073741824;

describe("манифест компонентов", () => {
  it("все три профиля на месте, размеры правдоподобны", () => {
    expect(totalBytes(planProfile(manifest, "best")) / GB).toBeCloseTo(12.4, 0);
    expect(totalBytes(planProfile(manifest, "light")) / GB).toBeGreaterThan(6);
    expect(totalBytes(planProfile(manifest, "light")) / GB).toBeLessThan(7);
    expect(totalBytes(planProfile(manifest, "vulkan")) / GB).toBeLessThan(totalBytes(planProfile(manifest, "light")) / GB);
  });

  it("архивы качаются в downloads/, модели — по своим путям", () => {
    const files = planProfile(manifest, "best");
    expect(files.find((f) => f.id === "sd-cuda12")?.dest).toBe("downloads/sd-master-70c1dbc-bin-win-cuda12-x64.zip");
    expect(files.find((f) => f.id === "klein-9b")?.dest).toBe("models/diffusion_models/flux-2-klein-9b-Q5_K_M.gguf");
  });

  it("аргументы sd-server ссылаются ровно на файлы профиля", () => {
    for (const id of ["best", "light", "vulkan"] as const) {
      const paths = planProfile(manifest, id).filter((f) => f.path).map((f) => f.path);
      const l = launchFor(manifest, id);
      for (const p of paths) expect(l.args).toContain(p);
      expect(l.exe).toBe("model/bin/sd-server.exe");
      expect(l.cwd).toBe("model");
    }
  });

  it("битый манифест не проходит", () => {
    expect(() => parseManifest('{"files":{},"profiles":{"best":{"files":["нет"],"args":[]}}}')).toThrow(/нет/);
    expect(() => parseManifest('{"files":{"a":{"title":"a","url":"http://x","size":1,"sha256":"00","path":"a"}},"profiles":{}}')).toThrow(/https/);
  });
});

describe("узнать уже скачанную папку", () => {
  // раскладка local-image у автора: bin\sd-server.exe, bin\ggml-cuda.dll, models\…
  const DIR = "C:\\Users\\author\\нейро-свояк\\local-image";
  const layout = (profile: "best" | "light" | "vulkan", extra: Record<string, number> = {}) => {
    const files: Record<string, number> = { [`${DIR}\\bin\\sd-server.exe`]: 1126912, ...extra };
    for (const f of planProfile(manifest, profile)) if (f.path) files[win32.join(DIR, ...f.path.split("/"))] = f.size;
    return (p: string) => (p in files ? { size: files[p] } : null);
  };

  it("папка автора с 9B и CUDA — «Лучшее»", () => {
    expect(detectProfile(manifest, DIR, layout("best", { [`${DIR}\\bin\\ggml-cuda.dll`]: 329776640 }), win32.join)).toBe("best");
  });

  it("4B с CUDA — «Лёгкое», 4B без CUDA — Vulkan", () => {
    expect(detectProfile(manifest, DIR, layout("light", { [`${DIR}\\bin\\ggml-cuda.dll`]: 1 }), win32.join)).toBe("light");
    expect(detectProfile(manifest, DIR, layout("vulkan"), win32.join)).toBe("vulkan");
  });

  it("недокачанная модель (размер не тот) или нет sd-server — не узнаётся", () => {
    const stat = layout("best", { [`${DIR}\\bin\\ggml-cuda.dll`]: 1 });
    const broken = (p: string) => (p.endsWith("flux-2-klein-9b-Q5_K_M.gguf") ? { size: 123 } : stat(p));
    expect(detectProfile(manifest, DIR, broken, win32.join)).toBeNull();
    expect(detectProfile(manifest, DIR, (p) => (p.endsWith("sd-server.exe") ? null : stat(p)), win32.join)).toBeNull();
  });
});

describe("загрузка с докачкой", () => {
  const body = Buffer.alloc(300_000, 0);
  for (let i = 0; i < body.length; i++) body[i] = (i * 7) % 251;
  const sha = createHash("sha256").update(body).digest("hex");
  const ranges: (string | undefined)[] = [];
  let server: Server;
  let base = "";
  let dir = "";

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "dl-"));
    server = createServer((req, res) => {
      ranges.push(req.headers.range);
      const m = /^bytes=(\d+)-$/.exec(req.headers.range ?? "");
      if (req.url === "/norange" || !m) {
        res.writeHead(200, { "content-length": body.length });
        return res.end(body);
      }
      const from = Number(m[1]);
      res.writeHead(206, { "content-length": body.length - from, "content-range": `bytes ${from}-${body.length - 1}/${body.length}` });
      res.end(body.subarray(from));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  afterAll(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

  it("докачивает с места обрыва и сверяет сумму", async () => {
    const dest = join(dir, "a.bin");
    writeFileSync(`${dest}.part`, body.subarray(0, 100_000));
    ranges.length = 0;
    await downloadResumable({ url: `${base}/file`, size: body.length, sha256: sha }, dest);
    expect(ranges).toEqual(["bytes=100000-"]);
    expect(readFileSync(dest).equals(body)).toBe(true);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  it("сервер без Range — качает заново, не склеивая мусор", async () => {
    const dest = join(dir, "b.bin");
    writeFileSync(`${dest}.part`, Buffer.alloc(50_000, 1));
    await downloadResumable({ url: `${base}/norange`, size: body.length, sha256: sha }, dest);
    expect(readFileSync(dest).equals(body)).toBe(true);
  });

  it("уже скачанный файл не качается второй раз", async () => {
    const dest = join(dir, "c.bin");
    writeFileSync(dest, body);
    ranges.length = 0;
    await downloadResumable({ url: `${base}/file`, size: body.length, sha256: sha }, dest);
    expect(ranges).toEqual([]);
  });

  it("сумма не сошлась — ошибка, битый файл удалён", async () => {
    const dest = join(dir, "d.bin");
    await expect(downloadResumable({ url: `${base}/file`, size: body.length, sha256: "0".repeat(64) }, dest)).rejects.toThrow(/сумма не сошлась/);
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });
});

describe("чем запускать yt-dlp", () => {
  it("компонент — exe с плагинами и кодировкой, Python не нужен", () => {
    const c = ytdlpCommand({ ytdlpExe: "C:\\c\\yt-dlp\\yt-dlp.exe", ytdlpPluginDir: "C:\\c\\yt-dlp\\plugins", python: "python" });
    expect(c.bin).toBe("C:\\c\\yt-dlp\\yt-dlp.exe");
    expect(c.argv).toEqual(["--encoding", "utf-8", "--plugin-dirs", "C:\\c\\yt-dlp\\plugins"]);
  });

  it("компонента нет — как раньше, python -m yt_dlp", () => {
    expect(ytdlpCommand({})).toEqual({ bin: "python", argv: ["-m", "yt_dlp"] });
    expect(ytdlpCommand({ python: "C:\\Py\\python.exe" }).bin).toBe("C:\\Py\\python.exe");
  });

  it("в манифесте yt-dlp — exe и zip плагина в папке компонентов", () => {
    expect(planTool(manifest, "yt-dlp").map((f) => f.dest)).toEqual(["yt-dlp/yt-dlp.exe", "yt-dlp/plugins/bgutil-ytdlp-pot-provider.zip"]);
  });
});

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectProfile, launchFor, parseManifest, planProfile, planTool, totalBytes, type Manifest } from "../src/core/components/manifest";
import { ytdlpCommand } from "../src/core/media/providers/youtube";
import { downloadResumable, TOOL_MAIN, unzipTree } from "../src/main/modelInstall";
import { treeTarget } from "../src/core/components/unzipPath";
import { PIPER_VOICES } from "../src/core/components/voices";
import { ttsPaths } from "../src/main/voiceComponents";
import { deflateRawSync } from "node:zlib";

/** Маленький zip в памяти (deflate) — для теста распаковки. */
function crc32(b: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < b.length; i++) {
    let c = (crc ^ b[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function makeZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nm = Buffer.from(name), raw = Buffer.from(text), data = deflateRawSync(raw), crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nm, data); central.push(ch, nm);
    offset += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

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

  it("ИИ-увеличение — модель Real-ESRGAN и Vulkan-сборка sd.cpp в папке upscaler, меньше 100 МБ", () => {
    const files = planTool(manifest, "upscaler");
    expect(files.map((f) => f.path ?? f.unzipTo)).toEqual(["upscaler/RealESRGAN_x4plus.pth", "upscaler"]);
    expect(totalBytes(files)).toBeLessThan(100 * 1024 * 1024);
    // тот же архив, что у профиля Vulkan: сумма одна
    expect(manifest.files["sd-vulkan-upscaler"].sha256).toBe(manifest.files["sd-vulkan"].sha256);
  });
});

describe("компонент «Прогон в SIGame» из кода", () => {
  it("mergeManifest: добавляет файлы и программы, одноимённые берёт из кода; null — манифест как был", async () => {
    const { mergeManifest } = await import("../src/core/components/manifest");
    const base = { version: 1, files: { a: { title: "A", url: "https://x/a", size: 1, sha256: "0".repeat(64), path: "a" } }, profiles: {}, tools: { t: { version: "1", files: ["a"] } } } as Manifest;
    expect(mergeManifest(base, null)).toBe(base);
    const b = { title: "B", url: "https://x/b.zip", size: 2, sha256: "1".repeat(64), unzipTo: "b" };
    const m = mergeManifest(base, { files: { b }, tools: { t: { version: "2", files: ["a", "b"] } } });
    expect(m.files).toEqual({ a: base.files.a, b });
    expect(m.tools).toEqual({ t: { version: "2", files: ["a", "b"] } });
    expect(base.tools).toEqual({ t: { version: "1", files: ["a"] } });
  });

  it("выпущенный компонент разбирается вместе с манифестом оболочки и лежит в релизе sigame-…, а не в релизе приложения", async () => {
    const { mergeManifest } = await import("../src/core/components/manifest");
    const { SIGAME_COMPONENT } = await import("../src/core/sigame/component");
    if (!SIGAME_COMPONENT) return;
    const base = parseManifest(readFileSync(join(__dirname, "..", "resources", "components.json"), "utf8"));
    const m = parseManifest(JSON.stringify(mergeManifest(base, SIGAME_COMPONENT)));
    const files = planTool(m, "sigame");
    expect(files.map((f) => f.unzipTo)).toEqual(["sigame/runner", "sigame/table"]);
    for (const f of files) expect(f.url).toMatch(/^https:\/\/github\.com\/ikrevedko0-hash\/Ye-Studio\/releases\/download\/sigame-[^/]+\/[^/]+\.zip$/);
  });
});

describe("Перевод и голос в манифесте", () => {
  it("llama: CUDA-сборка и cudart в одну папку, Vulkan — отдельно; размеры и версии", () => {
    const files = planTool(manifest, "llama");
    expect(files.map((f) => f.unzipTo)).toEqual(["llama", "llama"]);
    expect(totalBytes(files)).toBe(264528976 + 391443627);
    expect(planTool(manifest, "llama-vulkan").map((f) => f.unzipTo)).toEqual(["llama-vulkan"]);
    expect(manifest.tools?.llama.version).toBe("b11269");
  });

  it("модели: голос — два gguf в tts-model/, перевод — Qwen3 4B в llm-model/", () => {
    expect(planTool(manifest, "tts-model").map((f) => f.dest)).toEqual([
      "tts-model/Qwen3-TTS-12Hz-1.7B-Base-Q4_K_M.gguf",
      "tts-model/mmproj-Qwen3-TTS-12Hz-1.7B-Base-Q8_0.gguf",
    ]);
    expect(planTool(manifest, "llm-model").map((f) => f.dest)).toEqual(["llm-model/Qwen3-4B-Q4_K_M.gguf"]);
  });

  it("Piper распаковывается с деревом и срезом piper/; семь голосов по два файла", () => {
    const [zip] = planTool(manifest, "piper");
    expect(zip.keepTree).toBe(true);
    expect(zip.stripPrefix).toBe("piper/");
    expect(PIPER_VOICES).toHaveLength(7);
    for (const v of PIPER_VOICES) {
      const files = planTool(manifest, v.id);
      expect(files).toHaveLength(2);
      expect(files[0].dest).toBe(`${v.id}/${v.onnx}`);
      expect(files[1].dest).toBe(`${v.id}/${v.onnx}.json`);
    }
  });

  it("TOOL_MAIN знает главный файл каждой новой программы", () => {
    for (const id of ["llama", "llama-vulkan", "tts-model", "llm-model", "piper", ...PIPER_VOICES.map((v) => v.id)]) {
      expect(TOOL_MAIN[id]).toBeTruthy();
      expect(manifest.tools?.[id]).toBeTruthy();
    }
  });

  it("keepTree/stripPrefix проверяются при разборе манифеста", () => {
    const one = (extra: string) => `{"files":{"a":{"title":"a","url":"https://x/a.zip","size":1,"sha256":"${"0".repeat(64)}","unzipTo":"a"${extra}}},"profiles":{}}`;
    expect(() => parseManifest(one(',"keepTree":true,"stripPrefix":"piper/"'))).not.toThrow();
    expect(() => parseManifest(one(',"stripPrefix":"piper/"'))).toThrow(/keepTree/);
    expect(() => parseManifest(one(',"keepTree":true,"stripPrefix":"../"'))).toThrow(/stripPrefix/);
    expect(() => parseManifest(one(',"keepTree":"да"'))).toThrow(/keepTree/);
  });
});

describe("распаковка с сохранением дерева", () => {
  it("treeTarget срезает префикс и не пускает опасные пути", () => {
    expect(treeTarget("piper/piper.exe", "piper/")).toEqual(["piper.exe"]);
    expect(treeTarget("piper/espeak-ng-data/ru_dict", "piper/")).toEqual(["espeak-ng-data", "ru_dict"]);
    expect(treeTarget("a/b.txt")).toEqual(["a", "b.txt"]);
    expect(treeTarget("piper/", "piper/")).toBeNull();
    expect(treeTarget("other/x.dll", "piper/")).toBeNull();
    expect(treeTarget("piper/../evil.dll", "piper/")).toBeNull();
    expect(treeTarget("/etc/passwd")).toBeNull();
    expect(treeTarget("C:/x.dll")).toBeNull();
    expect(treeTarget("piper\\x.dll", "piper/")).toBeNull();
  });

  it("unzipTree кладёт файлы по дереву без префикса", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zt-"));
    try {
      const zip = join(dir, "t.zip");
      writeFileSync(zip, makeZip({ "piper/piper.exe": "EXE", "piper/espeak-ng-data/voices/ru": "RU", "outside.txt": "O" }));
      const to = join(dir, "out");
      const n = await unzipTree(zip, to, "piper/");
      expect(n).toBe(2);
      expect(readFileSync(join(to, "piper.exe"), "utf8")).toBe("EXE");
      expect(readFileSync(join(to, "espeak-ng-data", "voices", "ru"), "utf8")).toBe("RU");
      // архив с ".." yauzl отвергает сам, treeTarget — вторая линия защиты
      writeFileSync(join(dir, "bad.zip"), makeZip({ "piper/../evil.txt": "X" }));
      await expect(unzipTree(join(dir, "bad.zip"), to, "piper/")).rejects.toThrow();
      expect(existsSync(join(dir, "evil.txt"))).toBe(false);
      expect(existsSync(join(to, "outside.txt"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ttsPaths", () => {
  const C = "C:\\c";
  const has = (...paths: string[]) => (p: string) => paths.includes(p);
  it("ничего не стоит — пусто", () => {
    expect(ttsPaths(C, [], () => false)).toEqual({ piperVoices: [] });
  });
  it("CUDA-llama, голос, Piper и голос; модель перевода из картинок раньше компонента", () => {
    const p = ttsPaths(C, [], has(
      join(C, "llama", "llama-server.exe"), join(C, "llama", "llama-tts.exe"),
      join(C, "tts-model", "Qwen3-TTS-12Hz-1.7B-Base-Q4_K_M.gguf"), join(C, "tts-model", "mmproj-Qwen3-TTS-12Hz-1.7B-Base-Q8_0.gguf"),
      join(C, "piper", "piper.exe"), join(C, "piper-ru-irina", "ru_RU-irina-medium.onnx"),
      join(C, "llm-model", "Qwen3-4B-Q4_K_M.gguf"), join(C, "model", "models", "text_encoders", "Qwen3-8B-Q4_K_M.gguf"),
    ));
    expect(p.llamaServer).toBe(join(C, "llama", "llama-server.exe"));
    expect(p.llamaTts).toBeTruthy();
    expect(p.ttsModel && p.ttsMmproj).toBeTruthy();
    expect(p.piper).toBeTruthy();
    expect(p.piperVoices.map((v) => [v.id, v.lang])).toEqual([["piper-ru-irina", "ru"]]);
    expect(p.llmModel).toBe(join(C, "model", "models", "text_encoders", "Qwen3-8B-Q4_K_M.gguf"));
    expect(p.llmSource).toBe("images");
    expect(p.llmModelComponent).toBe(join(C, "llm-model", "Qwen3-4B-Q4_K_M.gguf"));
  });
  it("только Vulkan и своя папка картинок", () => {
    const own = "D:\\local-image";
    const p = ttsPaths(C, [own], has(join(C, "llama-vulkan", "llama-server.exe"), join(own, "models", "text_encoders", "Qwen3-4B-Q4_K_M.gguf")));
    expect(p.llamaServer).toBe(join(C, "llama-vulkan", "llama-server.exe"));
    expect(p.llamaTts).toBeUndefined();
    expect(p.llmSource).toBe("images");
  });
  it("без Qwen3 картинок берётся компонент", () => {
    const p = ttsPaths(C, [], has(join(C, "llm-model", "Qwen3-4B-Q4_K_M.gguf")));
    expect(p.llmSource).toBe("component");
  });
});

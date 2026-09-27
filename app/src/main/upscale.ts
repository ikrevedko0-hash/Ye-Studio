// ИИ-увеличение картинки (Real-ESRGAN x4plus через sd-cli). Решения — core/media/upscale.ts,
// здесь — поиск файлов и запуск. Ставится в «Компонентах» → «ИИ-увеличение».

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { ffmpegTools } from "../core/media/ffmpeg";
import { pickCli, upscaledSize, type UpscaleFactor } from "../core/media/upscale";
import { componentPath, componentsDir } from "./components";

export const UPSCALER_DIR = "upscaler";
const MODEL = "RealESRGAN_x4plus.pth";

function run(exe: string, args: string[], timeoutMs: number, cwd?: string): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(exe, args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: `${stdout ?? ""}${stderr ?? ""}` }));
  });
}

/** Стоит ли апскейлер: модель и хоть один sd-cli на месте. */
export async function upscalerReady(): Promise<boolean> {
  const dir = join(componentsDir(), UPSCALER_DIR);
  if (!existsSync(join(dir, MODEL))) return false;
  const model = await componentPath("model");
  return !!pickCli({ modelBin: model ? join(model, "bin") : undefined, upscalerDir: dir, exists: existsSync, join });
}

/**
 * Увеличить картинку в 2 или 4 раза (модель всегда ×4, потом ужатие) и не больше 1920 по длинной стороне. Возвращает путь к JPEG во временной папке.
 * w, h — исходный размер (окно его знает, ffprobe ради этого не зовём).
 */
export async function upscaleImage(input: string, w: number, h: number, factor: UpscaleFactor = 4): Promise<string> {
  const dir = join(componentsDir(), UPSCALER_DIR);
  const modelFile = join(dir, MODEL);
  if (!existsSync(modelFile)) throw new Error("ИИ-увеличение не установлено: «Настройки» → «Компоненты» → «ИИ-увеличение» → «Установить»");
  const model = await componentPath("model");
  const cli = pickCli({ modelBin: model ? join(model, "bin") : undefined, upscalerDir: dir, exists: existsSync, join });
  if (!cli) throw new Error("не найден sd-cli.exe — переустановите «ИИ-увеличение» в «Компонентах»");

  // sd-cli открывает файлы узкими (ANSI) путями: «Рабочий стол», «история ирана.jpg» и русское имя
  // пользователя во временной папке он не открывает. Поэтому всё, что он читает и пишет, лежит под
  // латинскими именами в work/ папки апскейлера, а сам он запускается оттуда с относительными путями
  // (так же обходим это у sd-server — см. AGENTS.md). ffmpeg и Node юникод понимают.
  const ff = ffmpegTools();
  const stamp = Date.now();
  const work = join(dir, "work");
  await mkdir(work, { recursive: true });
  const tmp: string[] = [];
  try {
    // sd-cli читает PNG и JPEG; WebP, GIF и прочее сначала переводим в PNG
    const ext = extname(input).toLowerCase();
    const readable = [".png", ".jpg", ".jpeg"].includes(ext);
    const srcName = `in-${stamp}${readable ? ext : ".png"}`;
    tmp.push(join(work, srcName));
    if (readable) await copyFile(input, join(work, srcName));
    else {
      if (!ff) throw new Error("для этого формата картинки нужен ffmpeg — поставьте его в «Компонентах»");
      const c = await run(ff.ffmpeg, ["-y", "-loglevel", "error", "-i", input, "-frames:v", "1", join(work, srcName)], 60_000);
      if (!c.ok) throw new Error("не удалось прочитать картинку: " + c.out.slice(-200));
    }
    const bigName = `out-${stamp}.png`;
    const big = join(work, bigName);
    tmp.push(big);
    const r = await run(cli.exe, ["-M", "upscale", "--upscale-model", MODEL, "-i", `work/${srcName}`, "-o", `work/${bigName}`], 10 * 60_000, dir);
    if (!r.ok || !existsSync(big)) {
      const why = r.out.split("\n").filter((l) => l.includes("ERROR")).slice(-2).join(" ").replace(/\[ERROR\s*\]\s*\S+\s*-\s*/g, "");
      throw new Error("увеличение не удалось: " + (why || "sd-cli завершился с ошибкой"));
    }

    const size = upscaledSize(w, h, factor);
    // без ffmpeg отдаём PNG как есть; с ним — JPEG нужного размера, пак не распухает
    const out = join(tmpdir(), `siq-up-${stamp}.${ff ? "jpg" : "png"}`);
    if (!ff) { await copyFile(big, out); return out; }
    const s = await run(ff.ffmpeg, ["-y", "-loglevel", "error", "-i", big, "-vf", `scale=${size.w}:${size.h}:flags=lanczos`, "-q:v", "2", out], 60_000);
    if (!s.ok) throw new Error("не удалось сохранить результат: " + s.out.slice(-200));
    return out;
  } finally {
    await Promise.all(tmp.map((p) => rm(p, { force: true })));
  }
}

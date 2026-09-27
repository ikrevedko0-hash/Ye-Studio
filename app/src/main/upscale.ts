// ИИ-увеличение картинки (Real-ESRGAN x4plus через sd-cli). Решения — core/media/upscale.ts,
// здесь — поиск файлов и запуск. Ставится в «Компонентах» → «ИИ-увеличение».

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { ffmpegTools } from "../core/media/ffmpeg";
import { pickCli, upscaledSize, type UpscaleFactor } from "../core/media/upscale";
import { componentPath, componentsDir } from "./components";

export const UPSCALER_DIR = "upscaler";
const MODEL = "RealESRGAN_x4plus.pth";

function run(exe: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(exe, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
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

  const ff = ffmpegTools();
  const stamp = Date.now();
  const tmp: string[] = [];
  try {
    // sd-cli читает PNG и JPEG; WebP, GIF и прочее сначала переводим в PNG
    let src = input;
    if (![".png", ".jpg", ".jpeg"].includes(extname(input).toLowerCase())) {
      if (!ff) throw new Error("для этого формата картинки нужен ffmpeg — поставьте его в «Компонентах»");
      src = join(tmpdir(), `siq-up-src-${stamp}.png`);
      tmp.push(src);
      const c = await run(ff.ffmpeg, ["-y", "-loglevel", "error", "-i", input, "-frames:v", "1", src], 60_000);
      if (!c.ok) throw new Error("не удалось прочитать картинку: " + c.out.slice(-200));
    }
    const big = join(tmpdir(), `siq-up-${stamp}.png`);
    tmp.push(big);
    const r = await run(cli.exe, ["-M", "upscale", "--upscale-model", modelFile, "-i", src, "-o", big], 10 * 60_000);
    if (!r.ok || !existsSync(big)) throw new Error("увеличение не удалось: " + (r.out.trim().split("\n").slice(-3).join(" ") || "sd-cli завершился с ошибкой"));

    // без ffmpeg отдаём как есть (PNG ×4); с ним — JPEG нужного размера, пак не распухает
    if (!ff) { tmp.splice(tmp.indexOf(big), 1); return big; }
    const size = upscaledSize(w, h, factor);
    const out = join(tmpdir(), `siq-up-${stamp}.jpg`);
    const s = await run(ff.ffmpeg, ["-y", "-loglevel", "error", "-i", big, "-vf", `scale=${size.w}:${size.h}:flags=lanczos`, "-q:v", "2", out], 60_000);
    if (!s.ok) throw new Error("не удалось сохранить результат: " + s.out.slice(-200));
    return out;
  } finally {
    await Promise.all(tmp.map((p) => rm(p, { force: true })));
  }
}

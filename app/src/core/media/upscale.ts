// ИИ-увеличение картинки: Real-ESRGAN x4plus через sd-cli из stable-diffusion.cpp (-M upscale).
// Модель не выдумывает новое, как перерисовка FLUX, — только дорисовывает резкость, поэтому картинку
// в вопросе по-прежнему узнают. Здесь — чистые решения (какой sd-cli, какой итоговый размер);
// запуск — main/upscale.ts.

/** Модель всегда увеличивает в 4 раза; ×2 — это ×4 и аккуратное ужатие вдвое (отдельная x2-модель не нужна). */
export const MODEL_FACTOR = 4;
export type UpscaleFactor = 2 | 4;
/** Итог больше этого по длинной стороне не нужен ни SIGame, ни паку: ужимаем обратно. */
export const UPSCALE_MAX_SIDE = 1920;
/** С такой длинной стороны увеличивать уже незачем. */
export const UPSCALE_MIN_GAIN_SIDE = 1600;

export interface CliChoice { exe: string; gpu: "cuda" | "vulkan" }

/**
 * Какой sd-cli запускать. CUDA-сборка из локальной модели картинок быстрее, но есть не у всех;
 * Vulkan-сборка ставится вместе с апскейлером и работает на любой видеокарте.
 */
export function pickCli(opts: { modelBin?: string; upscalerDir: string; exists(p: string): boolean; join(...p: string[]): string }): CliChoice | null {
  const { modelBin, upscalerDir, exists, join } = opts;
  if (modelBin && exists(join(modelBin, "sd-cli.exe")) && exists(join(modelBin, "ggml-cuda.dll"))) {
    return { exe: join(modelBin, "sd-cli.exe"), gpu: "cuda" };
  }
  if (exists(join(upscalerDir, "sd-cli.exe"))) return { exe: join(upscalerDir, "sd-cli.exe"), gpu: "vulkan" };
  return null;
}

/** Итоговый размер: ×factor, но не больше UPSCALE_MAX_SIDE; чётные стороны — их любит JPEG-кодер. */
export function upscaledSize(w: number, h: number, factor: UpscaleFactor = 4): { w: number; h: number } {
  const bw = w * factor, bh = h * factor;
  const k = Math.min(1, UPSCALE_MAX_SIDE / Math.max(bw, bh));
  const even = (n: number) => Math.max(2, Math.round((n * k) / 2) * 2);
  return { w: even(bw), h: even(bh) };
}

/** Стоит ли увеличивать: у большой картинки выигрыша нет, только лишние мегабайты. */
export function worthUpscaling(w: number, h: number): boolean {
  return Math.max(w, h) < UPSCALE_MIN_GAIN_SIDE;
}

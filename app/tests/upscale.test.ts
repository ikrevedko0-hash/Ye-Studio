import { win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { pickCli, upscaledSize, worthUpscaling } from "../src/core/media/upscale";

const join = win32.join;
const has = (...files: string[]) => (p: string) => files.includes(p);

describe("pickCli", () => {
  const up = "C:\\comp\\upscaler";
  const bin = "C:\\model\\bin";

  it("CUDA-сборка локальной модели — первая: она быстрее", () => {
    const exists = has(join(bin, "sd-cli.exe"), join(bin, "ggml-cuda.dll"), join(up, "sd-cli.exe"));
    expect(pickCli({ modelBin: bin, upscalerDir: up, exists, join })).toEqual({ exe: join(bin, "sd-cli.exe"), gpu: "cuda" });
  });

  it("модель на Vulkan или без sd-cli — своя Vulkan-сборка апскейлера", () => {
    const exists = has(join(bin, "sd-cli.exe"), join(up, "sd-cli.exe"));
    expect(pickCli({ modelBin: bin, upscalerDir: up, exists, join })?.exe).toBe(join(up, "sd-cli.exe"));
    expect(pickCli({ upscalerDir: up, exists, join })?.gpu).toBe("vulkan");
  });

  it("ничего не стоит — null", () => {
    expect(pickCli({ modelBin: bin, upscalerDir: up, exists: () => false, join })).toBeNull();
  });
});

describe("upscaledSize", () => {
  it("маленькая — ровно ×4", () => {
    expect(upscaledSize(256, 144)).toEqual({ w: 1024, h: 576 });
  });
  it("×2 — модель даёт ×4, итог ужимается вдвое", () => {
    expect(upscaledSize(256, 144, 2)).toEqual({ w: 512, h: 288 });
    expect(upscaledSize(1200, 675, 2)).toEqual({ w: 1920, h: 1080 });
  });
  it("×4 больше 1920 — ужимается до 1920 по длинной стороне, стороны чётные", () => {
    expect(upscaledSize(800, 451)).toEqual({ w: 1920, h: 1082 });
    expect(upscaledSize(300, 1000)).toEqual({ w: 576, h: 1920 });
  });
});

describe("worthUpscaling", () => {
  it("большую картинку не увеличиваем", () => {
    expect(worthUpscaling(640, 480)).toBe(true);
    expect(worthUpscaling(1920, 1080)).toBe(false);
  });
});

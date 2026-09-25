import { describe, expect, it } from "vitest";
import { chooseProfile, mergeGpus, parseNvidiaSmi, parseRegistryAdapters, versionAtLeast, type Gpu, type SystemFacts } from "../src/core/system/probe";

// Живой вывод с машины автора (RTX 4060, 2026-09-25)
const SMI_AUTHOR = "NVIDIA GeForce RTX 4060, 8188, 610.47\r\n";
const REG_AUTHOR = '{"DriverDesc":"NVIDIA GeForce RTX 4060","HardwareInformation.qwMemorySize":8585740288,"HardwareInformation.MemorySize":4293918720,"ProviderName":"NVIDIA"}';

const GB = 1024;
const facts = (gpus: Gpu[], ramMB = 32 * GB, freeDiskMB = 200 * GB): SystemFacts => ({ platform: "win32", ramMB, freeDiskMB, gpus });
const rtx = (vramMB: number, driver = "610.47"): Gpu => ({ name: "NVIDIA GeForce RTX", vendor: "nvidia", vramMB, driver });

describe("разбор видеокарт", () => {
  it("nvidia-smi: имя, память, драйвер", () => {
    expect(parseNvidiaSmi(SMI_AUTHOR)).toEqual([{ name: "NVIDIA GeForce RTX 4060", vendor: "nvidia", vramMB: 8188, driver: "610.47" }]);
  });

  it("nvidia-smi: две карты и мусорные строки", () => {
    const gpus = parseNvidiaSmi("NVIDIA A, 24576, 580.1\n\nкакая-то строка\nNVIDIA B, 6144, 580.1\n");
    expect(gpus.map((g) => g.vramMB)).toEqual([24576, 6144]);
  });

  it("реестр: берёт 64-битный размер, а не упёршийся в 4 ГБ", () => {
    expect(parseRegistryAdapters(REG_AUTHOR)).toEqual([{ name: "NVIDIA GeForce RTX 4060", vendor: "nvidia", vramMB: 8188 }]);
  });

  it("реестр: массив записей, REG_BINARY, виртуальные адаптеры отброшены", () => {
    const json = JSON.stringify([
      { DriverDesc: "AMD Radeon RX 7600", ProviderName: "Advanced Micro Devices, Inc.", "HardwareInformation.qwMemorySize": 8589934592 },
      { DriverDesc: "Intel(R) UHD Graphics 770", ProviderName: "Intel Corporation", "HardwareInformation.MemorySize": [0, 0, 0, 32] },
      { DriverDesc: "Microsoft Basic Display Adapter", ProviderName: "Microsoft" },
      { DriverDesc: "Parsec Virtual Display Adapter" },
    ]);
    expect(parseRegistryAdapters(json)).toEqual([
      { name: "AMD Radeon RX 7600", vendor: "amd", vramMB: 8192 },
      { name: "Intel(R) UHD Graphics 770", vendor: "intel", vramMB: 512 },
    ]);
  });

  it("реестр: пустой или битый вывод — пустой список", () => {
    expect(parseRegistryAdapters("")).toEqual([]);
    expect(parseRegistryAdapters("не json")).toEqual([]);
  });

  it("слияние: карта из обоих источников не двоится, драйвер остаётся от nvidia-smi", () => {
    const merged = mergeGpus(parseNvidiaSmi(SMI_AUTHOR), [
      ...parseRegistryAdapters(REG_AUTHOR),
      { name: "Intel(R) UHD Graphics", vendor: "intel", vramMB: 128 },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ vendor: "nvidia", driver: "610.47" });
  });

  it("сравнение версий драйвера", () => {
    expect(versionAtLeast("610.47", "527.41")).toBe(true);
    expect(versionAtLeast("527.41", "527.41")).toBe(true);
    expect(versionAtLeast("516.94", "527.41")).toBe(false);
    expect(versionAtLeast(undefined, "527.41")).toBe(false);
  });
});

describe("выбор профиля", () => {
  it("машина автора (RTX 4060 8 ГБ, 32 ГБ ОЗУ) — «Лучшее»", () => {
    const gpus = mergeGpus(parseNvidiaSmi(SMI_AUTHOR), parseRegistryAdapters(REG_AUTHOR));
    const c = chooseProfile(facts(gpus));
    expect(c.recommended).toBe("best");
    expect(c.gpu?.name).toBe("NVIDIA GeForce RTX 4060");
  });

  it("8 ГБ видео, но 16 ГБ ОЗУ по номиналу (15,8 ГиБ) — всё ещё «Лучшее»", () => {
    expect(chooseProfile(facts([rtx(8188)], 16236)).recommended).toBe("best");
  });

  it("6 ГБ видео — «Лёгкое», и видно, почему не «Лучшее»", () => {
    const c = chooseProfile(facts([rtx(6144)]));
    expect(c.recommended).toBe("light");
    expect(c.checks[0].why.join(" ")).toMatch(/видеопамяти 6,0 ГБ/);
  });

  it("8 ГБ видео, но 12 ГБ ОЗУ — «Лёгкое»", () => {
    expect(chooseProfile(facts([rtx(8188)], 12 * GB)).recommended).toBe("light");
  });

  it("старый драйвер NVIDIA — без CUDA-профилей, с подсказкой обновить", () => {
    const c = chooseProfile(facts([rtx(12288, "516.94")]));
    expect(c.recommended).toBe("cloud");
    expect(c.checks[0].why.join(" ")).toMatch(/516\.94 старый/);
  });

  it("AMD 8 ГБ — «Не NVIDIA» (Vulkan)", () => {
    const c = chooseProfile(facts([{ name: "AMD Radeon RX 7600", vendor: "amd", vramMB: 8192 }]));
    expect(c.recommended).toBe("vulkan");
    expect(c.gpu?.vendor).toBe("amd");
  });

  it("только встроенная графика или ничего — «Без локальной»", () => {
    expect(chooseProfile(facts([{ name: "Intel UHD", vendor: "intel", vramMB: 128 }])).recommended).toBe("cloud");
    expect(chooseProfile(facts([])).recommended).toBe("cloud");
  });

  it("мало места на диске — «Лучшее» не подходит, «Лёгкое» ещё влезает", () => {
    const c = chooseProfile(facts([rtx(8188)], 32 * GB, 12 * GB));
    expect(c.recommended).toBe("light");
    expect(c.checks[0].why.join(" ")).toMatch(/мало места/);
  });

  it("облачный профиль подходит всегда", () => {
    const c = chooseProfile({ platform: "linux", ramMB: 1024, gpus: [] });
    expect(c.checks.find((x) => x.profile.id === "cloud")?.ok).toBe(true);
    expect(c.recommended).toBe("cloud");
  });
});

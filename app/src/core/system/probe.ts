// Проверка системы: хватит ли машины на локальную модель картинок и какую из них ставить.
//
// Здесь только чистые функции — разбор вывода nvidia-smi и реестра Windows и выбор профиля.
// Запуск внешних программ живёт в main/system.ts, поэтому всё решающее проверяется тестами без Windows.
//
// Откуда берём видеокарту:
//  - nvidia-smi (ставится с любым драйвером NVIDIA) — точная память и версия драйвера;
//  - реестр, класс видеоадаптеров, поле HardwareInformation.qwMemorySize — настоящая память любой карты.
//    WMI (Win32_VideoController.AdapterRAM) не годится: поле 32-битное и упирается в 4 ГБ
//    (у RTX 4060 на 8 ГБ он честно пишет 4 293 918 720).

export type GpuVendor = "nvidia" | "amd" | "intel" | "other";

export interface Gpu {
  name: string;
  vendor: GpuVendor;
  /** Видеопамять, МиБ; 0 — неизвестно. */
  vramMB: number;
  /** Версия драйвера NVIDIA вида «610.47» (только из nvidia-smi). */
  driver?: string;
}

export interface SystemFacts {
  platform: NodeJS.Platform;
  /** Оперативная память, МиБ. */
  ramMB: number;
  /** Свободно на диске папки компонентов, МиБ; undefined — не удалось узнать. */
  freeDiskMB?: number;
  gpus: Gpu[];
}

export type ProfileId = "best" | "light" | "vulkan" | "cloud";

export interface ModelProfile {
  id: ProfileId;
  title: string;
  /** Что ставится — одной строкой для окна. */
  what: string;
  /** Сколько качать и держать на диске, ГБ (примерно). */
  diskGB: number;
}

/** Профили локальной модели. Точные файлы и суммы — в манифесте компонентов (фаза 4). */
export const MODEL_PROFILES: Record<ProfileId, ModelProfile> = {
  best: { id: "best", title: "Лучшее", what: "FLUX.2 klein 9B + Qwen3-8B, видеокарта NVIDIA (CUDA 12)", diskGB: 13.5 },
  light: { id: "light", title: "Лёгкое", what: "FLUX.2 klein 4B + Qwen3-4B, видеокарта NVIDIA (CUDA 12)", diskGB: 7 },
  vulkan: { id: "vulkan", title: "Не NVIDIA", what: "FLUX.2 klein 4B + Qwen3-4B через Vulkan (AMD, Intel)", diskGB: 6 },
  cloud: { id: "cloud", title: "Без локальной", what: "ничего не ставится: картинки рисует облако (бесплатный ключ Cloudflare)", diskGB: 0 },
};

/**
 * Пороги. Карта «на 8 ГБ» показывает меньше номинала (RTX 4060 — 8188 МиБ: часть держит драйвер),
 * «16 ГБ» ОЗУ — около 15,8 ГиБ, поэтому пороги чуть ниже круглых чисел.
 */
export const LIMITS = {
  bestVramMB: 7900,
  bestRamMB: 15000,
  lightVramMB: 5800,
  lightRamMB: 11000,
  vulkanVramMB: 5800,
  vulkanRamMB: 11000,
  /** Меньше этого сборки sd.cpp с CUDA 12 не запускаются: CUDA 12.0 на Windows требует драйвер 527.41. */
  cudaDriver: "527.41",
  /** Запас на диске сверх размера модели, ГБ: распаковка архивов и временные файлы. */
  diskSpareGB: 2,
};

export function vendorOf(name: string, company = ""): GpuVendor {
  const s = `${company} ${name}`.toLowerCase();
  if (/nvidia|geforce|quadro|rtx|gtx|tesla/.test(s)) return "nvidia";
  if (/\bamd\b|radeon|advanced micro devices|\bati\b/.test(s)) return "amd";
  if (/intel|\barc\b|iris|uhd graphics/.test(s)) return "intel";
  return "other";
}

/** «NVIDIA GeForce RTX 4060, 8188, 610.47» — по строке на карту (--format=csv,noheader,nounits). */
export function parseNvidiaSmi(out: string): Gpu[] {
  const gpus: Gpu[] = [];
  for (const line of out.split(/\r?\n/)) {
    const parts = line.split(",").map((p) => p.trim());
    if (parts.length < 3 || !parts[0]) continue;
    const vram = Number.parseInt(parts[1], 10);
    gpus.push({ name: parts[0], vendor: "nvidia", vramMB: Number.isFinite(vram) ? vram : 0, driver: parts[2] || undefined });
  }
  return gpus;
}

/** Число из реестра: PowerShell отдаёт QWORD числом, а у части драйверов это REG_BINARY — массив байт. */
function registryBytes(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  if (Array.isArray(v) && v.every((b) => typeof b === "number")) {
    return v.reduceRight((acc: number, b: number) => acc * 256 + b, 0); // little-endian
  }
  return 0;
}

/**
 * Разбор `Get-ItemProperty '…\Class\{4d36e968-…}\0*' | ConvertTo-Json`: одна запись — объект, несколько — массив.
 * Берём qwMemorySize, а 32-битный MemorySize — только когда другого нет.
 */
export function parseRegistryAdapters(json: string): Gpu[] {
  let data: unknown;
  try {
    data = JSON.parse(json.trim() || "[]");
  } catch {
    return [];
  }
  const rows = (Array.isArray(data) ? data : [data]) as Record<string, unknown>[];
  const gpus: Gpu[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const name = String(r.DriverDesc ?? "").trim();
    if (!name || /basic display|basic render|remote display|virtual|parsec|meta virtual/i.test(name)) continue;
    const bytes = registryBytes(r["HardwareInformation.qwMemorySize"]) || registryBytes(r["HardwareInformation.MemorySize"]);
    gpus.push({ name, vendor: vendorOf(name, String(r.ProviderName ?? "")), vramMB: Math.round(bytes / 1048576) });
  }
  return gpus;
}

/**
 * Свести карты из двух источников: у NVIDIA верим nvidia-smi (там драйвер), остальные — из реестра.
 * Одна и та же карта в обоих списках не дублируется.
 */
export function mergeGpus(fromSmi: Gpu[], fromRegistry: Gpu[]): Gpu[] {
  const out = [...fromSmi];
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  for (const g of fromRegistry) {
    const twin = out.find((o) => norm(o.name) === norm(g.name));
    if (twin) {
      if (!twin.vramMB) twin.vramMB = g.vramMB;
      continue;
    }
    out.push(g);
  }
  return out.sort((a, b) => b.vramMB - a.vramMB);
}

/** «610.47» ≥ «527.41»? */
export function versionAtLeast(v: string | undefined, min: string): boolean {
  if (!v) return false;
  const a = v.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const b = min.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d > 0;
  }
  return true;
}

export interface ProfileCheck {
  profile: ModelProfile;
  /** Подходит ли машина. */
  ok: boolean;
  /** Почему нет — по-человечески; пусто, если подходит. */
  why: string[];
}

export interface ProfileChoice {
  recommended: ProfileId;
  /** Карта, на которую рассчитана рекомендация. */
  gpu?: Gpu;
  checks: ProfileCheck[];
}

const gb = (mb: number) => `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1).replace(".", ",")} ГБ`;

/** Какой профиль подходит этой машине. Проверяются все, рекомендуется первый подходящий по порядку best → light → vulkan → cloud. */
export function chooseProfile(f: SystemFacts): ProfileChoice {
  const nvidia = f.gpus.filter((g) => g.vendor === "nvidia").sort((a, b) => b.vramMB - a.vramMB)[0];
  const other = f.gpus.filter((g) => g.vendor === "amd" || g.vendor === "intel").sort((a, b) => b.vramMB - a.vramMB)[0];

  const common = (p: ModelProfile): string[] => {
    const why: string[] = [];
    if (f.platform !== "win32") why.push("сборки sd.cpp в установщике — только для Windows");
    const need = (p.diskGB + LIMITS.diskSpareGB) * 1024;
    if (f.freeDiskMB !== undefined && f.freeDiskMB < need) why.push(`мало места на диске: свободно ${gb(f.freeDiskMB)}, нужно около ${gb(need)}`);
    return why;
  };

  const cuda = (p: ModelProfile, vram: number, ram: number): ProfileCheck => {
    const why = common(p);
    if (!nvidia) why.push("нет видеокарты NVIDIA");
    else {
      if (nvidia.vramMB < vram) why.push(`видеопамяти ${gb(nvidia.vramMB)}, нужно от ${gb(vram)}`);
      if (!versionAtLeast(nvidia.driver, LIMITS.cudaDriver)) {
        why.push(nvidia.driver ? `драйвер NVIDIA ${nvidia.driver} старый, нужен ${LIMITS.cudaDriver} или новее` : "не удалось узнать версию драйвера NVIDIA (нет nvidia-smi)");
      }
    }
    if (f.ramMB < ram) why.push(`оперативной памяти ${gb(f.ramMB)}, нужно от ${gb(ram)}`);
    return { profile: p, ok: why.length === 0, why };
  };

  const vulkan = (): ProfileCheck => {
    const p = MODEL_PROFILES.vulkan;
    const why = common(p);
    if (!other) why.push("нет видеокарты AMD или Intel");
    else if (other.vramMB < LIMITS.vulkanVramMB) why.push(`видеопамяти ${gb(other.vramMB)}, нужно от ${gb(LIMITS.vulkanVramMB)}`);
    if (f.ramMB < LIMITS.vulkanRamMB) why.push(`оперативной памяти ${gb(f.ramMB)}, нужно от ${gb(LIMITS.vulkanRamMB)}`);
    return { profile: p, ok: why.length === 0, why };
  };

  const checks: ProfileCheck[] = [
    cuda(MODEL_PROFILES.best, LIMITS.bestVramMB, LIMITS.bestRamMB),
    cuda(MODEL_PROFILES.light, LIMITS.lightVramMB, LIMITS.lightRamMB),
    vulkan(),
    { profile: MODEL_PROFILES.cloud, ok: true, why: [] },
  ];
  const first = checks.find((c) => c.ok)!;
  const gpu = first.profile.id === "vulkan" ? other : first.profile.id === "cloud" ? undefined : nvidia;
  return { recommended: first.profile.id, gpu, checks };
}

/** Итог проверки системы — то, что видит окно «Компоненты». */
export interface SystemReport {
  os: string;
  cpu: string;
  ramMB: number;
  componentsDir: string;
  freeDiskMB?: number;
  gpus: Gpu[];
  tools: {
    ffmpeg: string | null;
    ytdlp: boolean;
    node: string | null;
    chrome: string | null;
    vpn: string | null;
  };
  profile: ProfileChoice;
  /** Сколько заняла проверка, мс. */
  tookMs: number;
}


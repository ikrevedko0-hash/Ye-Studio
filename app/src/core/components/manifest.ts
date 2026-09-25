// Манифест компонентов (resources/components.json): какие файлы качать для каждого профиля
// локальной модели, куда их класть и как потом запускать sd-server.
//
// Всё здесь — чистые функции: диск они видят только через переданный stat, поэтому проверяются
// тестами без сети и без Windows. Скачивание и распаковка — main/modelInstall.ts.

import type { ProfileId } from "../system/probe";

export interface ManifestFile {
  title: string;
  url: string;
  /** Размер, байт — по нему же решаем «уже скачано» и заранее проверяем место. */
  size: number;
  sha256: string;
  /** Файл модели: путь внутри папки модели. */
  path?: string;
  /** Архив: распаковать в эту папку (внутри папки модели, у программ — внутри папки компонентов) и удалить. */
  unzipTo?: string;
  /** Из архива взять только эти файлы (по имени, без папок); не задано — всё. */
  extract?: string[];
}

export interface ProfileSpec {
  files: string[];
  /** Аргументы sd-server; пути в них — от папки модели (cwd). */
  args: string[];
}

/** Программа-компонент (yt-dlp): файлы кладутся по своим path прямо в папку компонентов. */
export interface ToolSpec {
  version: string;
  files: string[];
}

export interface Manifest {
  version: number;
  files: Record<string, ManifestFile>;
  profiles: Partial<Record<ProfileId, ProfileSpec>>;
  tools?: Record<string, ToolSpec>;
}

/** Папка модели внутри папки компонентов. */
export const MODEL_DIR = "model";
/** Куда качаются архивы до распаковки (внутри папки модели). */
export const DOWNLOAD_DIR = "downloads";

export function parseManifest(raw: string): Manifest {
  const m = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw) as Manifest;
  if (!m || typeof m !== "object" || !m.files || !m.profiles) throw new Error("манифест компонентов испорчен");
  for (const [id, p] of Object.entries(m.profiles)) {
    for (const f of p?.files ?? []) if (!m.files[f]) throw new Error(`в профиле ${id} файл «${f}», которого нет в списке файлов`);
  }
  for (const [id, t] of Object.entries(m.tools ?? {})) {
    for (const f of t.files) {
      if (!m.files[f]) throw new Error(`в программе ${id} файл «${f}», которого нет в списке файлов`);
      if (!m.files[f].path && !m.files[f].unzipTo) throw new Error(`в программе ${id} файл «${f}» без path и unzipTo`);
    }
  }
  for (const [id, f] of Object.entries(m.files)) {
    if (!/^https:\/\//.test(f.url)) throw new Error(`файл ${id}: адрес не https`);
    if (!/^[0-9a-f]{64}$/.test(f.sha256)) throw new Error(`файл ${id}: нет суммы SHA256`);
    if (!(f.size > 0)) throw new Error(`файл ${id}: нет размера`);
    if (!f.path === !f.unzipTo) throw new Error(`файл ${id}: нужен либо path, либо unzipTo`);
  }
  return m;
}

export interface PlannedFile extends ManifestFile {
  id: string;
  /** Куда качать, от папки модели: сам файл модели или архив в downloads/. */
  dest: string;
}

/** Файлы профиля с местами назначения. */
export function planProfile(m: Manifest, profile: ProfileId): PlannedFile[] {
  const spec = m.profiles[profile];
  if (!spec) throw new Error(`профиль «${profile}» ничего не ставит`);
  return spec.files.map((id) => {
    const f = m.files[id];
    const dest = f.path ?? `${DOWNLOAD_DIR}/${f.url.slice(f.url.lastIndexOf("/") + 1)}`;
    return { ...f, id, dest };
  });
}

/** Файлы программы (yt-dlp); dest — от папки компонентов. */
export function planTool(m: Manifest, tool: string): PlannedFile[] {
  const spec = m.tools?.[tool];
  if (!spec) throw new Error(`программы «${tool}» нет в манифесте`);
  return spec.files.map((id) => {
    const f = m.files[id];
    return { ...f, id, dest: f.path ?? `${DOWNLOAD_DIR}/${f.url.slice(f.url.lastIndexOf("/") + 1)}` };
  });
}

export function totalBytes(files: { size: number }[]): number {
  return files.reduce((s, f) => s + f.size, 0);
}

/** Как запускать sd-server профиля. Пути относительные — к папке компонентов (см. resolveLaunch). */
export function launchFor(m: Manifest, profile: ProfileId): { exe: string; cwd: string; args: string[] } {
  const spec = m.profiles[profile];
  if (!spec) throw new Error(`профиль «${profile}» ничего не ставит`);
  return { exe: `${MODEL_DIR}/bin/sd-server.exe`, cwd: MODEL_DIR, args: [...spec.args] };
}

/** Что можно узнать о файле, не читая его. */
export type StatFn = (path: string) => { size: number } | null;

/**
 * Узнать уже скачанную модель в чужой папке (кнопка «Указать уже скачанную папку»).
 * Раскладка та же, что ставит приложение и что у автора в local-image: bin/sd-server.exe
 * и models/… с файлами точного размера. Суммы не считаем — 13 ГБ читались бы минуту;
 * совпадение имени и размера до байта для этих файлов достаточно.
 * Возвращает первый профиль (по порядку в манифесте), у которого все файлы моделей на месте.
 */
export function detectProfile(m: Manifest, dir: string, stat: StatFn, join: (...p: string[]) => string): ProfileId | null {
  if (!stat(join(dir, "bin", "sd-server.exe"))) return null;
  for (const [id, spec] of Object.entries(m.profiles) as [ProfileId, ProfileSpec][]) {
    const models = spec.files.map((f) => m.files[f]).filter((f) => f.path);
    const complete = models.every((f) => stat(join(dir, ...f.path!.split("/")))?.size === f.size);
    // Vulkan и CUDA ставят разные sd-server; по одним моделям их не различить — CUDA узнаём по её библиотеке
    const needsCuda = spec.files.includes("cudart12");
    const hasCuda = !!stat(join(dir, "bin", "ggml-cuda.dll"));
    if (complete && needsCuda === hasCuda) return id;
  }
  return null;
}

/** Ход установки — для полосы в окне «Компоненты». */
export interface InstallProgress {
  phase: "download" | "verify" | "unzip" | "register" | "done" | "error" | "cancelled";
  /** Какой файл сейчас (название из манифеста). */
  file?: string;
  fileIndex?: number;
  fileCount?: number;
  /** Сколько байт профиля уже на диске и сколько всего. */
  done: number;
  total: number;
  /** Скорость, байт/с (сглаженная). */
  speed?: number;
  message?: string;
}

/** Что показывает окно «Компоненты». */
export interface ComponentsState {
  componentsDir: string;
  profiles: { id: ProfileId; bytes: number }[];
  /** Стоящая модель: профиль и где лежит; own — в папке автора, а не в папке компонентов. */
  model: { profile?: string; path: string; own: boolean; installedAt?: string } | null;
  /** Идёт установка — последний шаг. */
  installing: InstallProgress | null;
  /** Программы-компоненты (yt-dlp, ffmpeg): стоит ли, какой версии, сколько качать. */
  tools: Record<string, ToolState>;
}

export interface ToolState {
  component: boolean;
  version?: string;
  manifestVersion?: string;
  bytes: number;
}

// Папка компонентов: то, что приложение докачивает само (локальная модель картинок, yt-dlp, ffmpeg).
//
// Лежит в %LOCALAPPDATA%\Мастерская паков\components, а не в Roaming рядом с настройками: там гигабайты
// моделей, и в перемещаемый профиль им нельзя. Путь можно сменить настройкой (диск с местом).
// Что стоит, какой версии и где — в components.json внутри этой папки.
//
// Модуль без Electron: папку и настройку ему сообщают снаружи, поэтому его можно звать из тестов и скриптов.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, win32 } from "node:path";

export const APP_FOLDER = "Мастерская паков";

/** Одна установленная штука: sd.cpp с моделями, yt-dlp, ffmpeg… */
export interface ComponentRecord {
  /** «model», «yt-dlp», «ffmpeg». */
  id: string;
  version?: string;
  /** Где лежит; относительный путь — внутри папки компонентов. */
  path: string;
  /** Профиль модели («best», «light»…), если есть. */
  profile?: string;
  /** ISO-дата установки. */
  installedAt?: string;
  /** ISO-дата последней проверки обновлений (yt-dlp обновляется сам раз в неделю). */
  checkedAt?: string;
}

export interface ComponentsFile {
  version: 1;
  components: Record<string, ComponentRecord>;
}

/** Папка компонентов по умолчанию для этой ОС. */
export function defaultComponentsDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = homedir()): string {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || win32.join(home, "AppData", "Local");
    return win32.join(local, APP_FOLDER, "components");
  }
  // Linux (облако, тесты): по XDG
  return join(env.XDG_DATA_HOME || join(home, ".local", "share"), APP_FOLDER, "components");
}

let override: string | undefined;

/** Настройка «componentsDir» из ui-settings.json; пусто — папка по умолчанию. */
export function setComponentsDirOverride(dir: string | undefined): void {
  override = dir?.trim() || undefined;
}

export function componentsDir(): string {
  return override ?? defaultComponentsDir();
}

/** Абсолютный путь — и Windows-путь «C:\…» тоже, даже когда тесты идут на Linux. */
export function isAbsolutePath(p: string): boolean {
  return isAbsolute(p) || win32.isAbsolute(p);
}

/** Путь из настроек: абсолютный оставляем как есть, относительный считаем от папки компонентов. */
export function inComponents(p: string, base = componentsDir()): string {
  return isAbsolutePath(p) ? p : join(base, p);
}

const FILE = "components.json";

/** Что установлено. Нет файла или он испорчен — пустой список: значит, ничего не ставили. */
export async function readComponents(dir = componentsDir()): Promise<ComponentsFile> {
  try {
    const raw = await readFile(join(dir, FILE), "utf8");
    const data = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw) as Partial<ComponentsFile>;
    return { version: 1, components: data.components && typeof data.components === "object" ? data.components : {} };
  } catch {
    return { version: 1, components: {} };
  }
}

/** Записать через временный файл: оборванная запись не должна оставить половину JSON. */
export async function writeComponents(data: ComponentsFile, dir = componentsDir()): Promise<void> {
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `${FILE}.tmp`);
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await rename(tmp, join(dir, FILE));
}

/** Отметить установку (или обновление) одного компонента. */
export async function saveComponent(rec: ComponentRecord, dir = componentsDir()): Promise<ComponentsFile> {
  const data = await readComponents(dir);
  data.components[rec.id] = { ...rec, installedAt: rec.installedAt ?? new Date().toISOString() };
  await writeComponents(data, dir);
  return data;
}

/** Забыть компонент (файлы удаляет вызывающий). */
export async function forgetComponent(id: string, dir = componentsDir()): Promise<ComponentsFile> {
  const data = await readComponents(dir);
  delete data.components[id];
  await writeComponents(data, dir);
  return data;
}

/** Полный путь установленного компонента, если его папка на месте. */
export async function componentPath(id: string, dir = componentsDir()): Promise<string | null> {
  const rec = (await readComponents(dir)).components[id];
  if (!rec) return null;
  const full = inComponents(rec.path, dir);
  return existsSync(full) ? full : null;
}

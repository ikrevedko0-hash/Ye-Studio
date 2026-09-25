// Папка оригиналов рядом с паком.
//
// Зачем: в .siq попадает обработанная версия — обрезанная, сжатая, приведённая к H.264. Оригинал нужен,
// когда обработку захочется переделать иначе, и нужен ответ на вопрос «откуда это взято». Поэтому
// скачанное всегда сохраняется дважды: оригинал в source/, обработанное — в пак.
//
// Раскладка:  <папка пака>/source/<имя пака>/файл.ext
//             <папка пака>/source/<имя пака>/index.json   ← метаданные всех оригиналов

import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { SourceMeta } from "./providers/types";

export const INDEX_FILE = "index.json";

/** Имя пака без расширения — под ним заводится подпапка в source/. */
function packStem(packPath: string): string {
  return basename(packPath).replace(/\.siq$/i, "") || "пак";
}

/**
 * Куда складывать оригиналы.
 * Пак ещё не сохранён — складываем в запасную папку (настройки приложения), чтобы работа не стояла;
 * при первом сохранении пака папку можно перенести через relocate().
 */
export function sourceDir(packPath: string | undefined, fallbackBase: string): string {
  if (!packPath) return join(fallbackBase, "source", "_несохранённый пак");
  return join(dirname(packPath), "source", packStem(packPath));
}

export async function readIndex(dir: string): Promise<SourceMeta[]> {
  try {
    const raw = await readFile(join(dir, INDEX_FILE), "utf8");
    const data: unknown = JSON.parse(raw);
    return Array.isArray(data) ? (data as SourceMeta[]) : [];
  } catch {
    return []; // папки ещё нет — это норма, а не ошибка
  }
}

async function writeIndex(dir: string, list: SourceMeta[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, INDEX_FILE), JSON.stringify(list, null, 2), "utf8");
}

/** Добавляет запись об оригинале. Повтор по имени файла перезаписывается: файл-то один. */
export async function addRecord(dir: string, meta: SourceMeta): Promise<SourceMeta[]> {
  const list = await readIndex(dir);
  const i = list.findIndex((m) => m.file === meta.file);
  if (i >= 0) list[i] = meta;
  else list.push(meta);
  await writeIndex(dir, list);
  return list;
}

/** Убирает запись об оригинале: файла больше нет, и в списке ему делать нечего. */
export async function removeRecord(dir: string, file: string): Promise<void> {
  const list = await readIndex(dir);
  const rest = list.filter((m) => m.file !== file);
  if (rest.length !== list.length) await writeIndex(dir, rest);
}

/** Отмечает, под каким именем обработанная версия легла в пак. */
export async function linkToPack(dir: string, file: string, packFolder: string, packFile: string): Promise<void> {
  const list = await readIndex(dir);
  const rec = list.find((m) => m.file === file);
  if (!rec) return;
  rec.packFolder = packFolder;
  rec.packFile = packFile;
  await writeIndex(dir, list);
}

/**
 * Уже качали ровно этот файл? Тогда второй раз не лезем в сеть.
 * Есть прямая ссылка на файл — сверяем только по ней: на одной странице бывает много картинок
 * (статья РБК про мем — десяток кадров), и по адресу страницы на любую из них возвращалась первая
 * скачанная. По странице сверяем, только когда прямой ссылки нет (ролик YouTube — страница и есть файл).
 */
export async function findByUrl(dir: string, pageUrl?: string, downloadUrl?: string): Promise<SourceMeta | undefined> {
  if (!pageUrl && !downloadUrl) return undefined;
  const list = await readIndex(dir);
  if (downloadUrl) return list.find((m) => m.downloadUrl === downloadUrl);
  return list.find((m) => m.pageUrl === pageUrl && !m.downloadUrl);
}

/** Перенос папки оригиналов, когда пак впервые сохранён или переименован. */
export async function relocate(from: string, to: string): Promise<boolean> {
  if (from === to) return false;
  const list = await readIndex(from);
  if (!list.length) return false;
  await mkdir(dirname(to), { recursive: true });
  try {
    await rename(from, to);
    return true;
  } catch {
    return false; // разные диски или папка занята — оставляем как есть, ничего не теряем
  }
}

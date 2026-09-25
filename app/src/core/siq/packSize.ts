// Объём пака: что лежит без дела и что можно ужать, чтобы уложиться в 100 МБ.

import { packLogo, setPackLogo } from "./board";
import { allItems, isRef, itemKind } from "./helpers";
import { MEDIA_FOLDERS, type Package } from "./model";

export const PACK_TARGET_MB = 100;

export interface SizedMedia {
  folder: string;
  name: string;
  size: number;
}

/** Файлы, которые лежат в паке, но ни один вопрос, ответ, вариант и логотип на них не ссылается. */
export function unusedMedia<T extends SizedMedia>(pkg: Package, media: T[]): T[] {
  const used = new Set<string>();
  for (const { item } of allItems(pkg)) if (isRef(item)) used.add(`${MEDIA_FOLDERS[itemKind(item)]}/${item.value}`);
  const logo = packLogo(pkg);
  if (logo) used.add(`Images/${logo}`);
  return media.filter((m) => !used.has(`${m.folder}/${m.name}`));
}

/** Переводит все ссылки на файл (вопросы, ответы, варианты, логотип) на новое имя. Возвращает число замен. */
export function renameMediaEverywhere(pkg: Package, folder: string, from: string, to: string): number {
  let n = 0;
  for (const { item } of allItems(pkg)) {
    if (isRef(item) && item.value === from && MEDIA_FOLDERS[itemKind(item)] === folder) {
      item.value = to;
      n++;
    }
  }
  if (folder === "Images" && packLogo(pkg) === from) { setPackLogo(pkg, to); n++; }
  return n;
}

export const mb = (bytes: number) => bytes / 1048576;

/** Советы по объёму: коротко, по делу, в порядке пользы. */
export function sizeTips(media: SizedMedia[], unused: SizedMedia[]): string[] {
  const sum = (list: SizedMedia[]) => list.reduce((s, m) => s + m.size, 0);
  const total = sum(media);
  const tips: string[] = [];
  const by = (folder: string) => media.filter((m) => m.folder === folder);
  if (unused.length) tips.push(`Без дела лежит ${unused.length} файл(ов) на ${mb(sum(unused)).toFixed(1)} МБ — их можно убрать из пака (копии останутся в source/).`);
  const video = sum(by("Video"));
  if (video > total * 0.4) tips.push(`Видео — ${Math.round((video / Math.max(1, total)) * 100)} % пака. 720p вместо 1080p обычно легче втрое, а в вопросе нужен только кусок ролика: обрежьте до нужных секунд.`);
  const bigImages = by("Images").filter((m) => m.size > 700 * 1024);
  if (bigImages.length) tips.push(`${bigImages.length} картинок тяжелее 700 КБ. На экране SIGame хватает 1920 px по большей стороне и JPEG 85 %.`);
  const audio = by("Audio").filter((m) => m.size > 3 * 1048576);
  if (audio.length) tips.push(`${audio.length} звуков тяжелее 3 МБ: для вопроса хватает 20–30 секунд в MP3 128 кбит/с.`);
  if (!tips.length) tips.push("Пак уже аккуратный: лишнего нет, тяжёлых файлов мало.");
  return tips;
}

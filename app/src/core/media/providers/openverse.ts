// Openverse (фонд Викимедиа): картинки и звук под свободными лицензиями, без ключа.
// Проверено живым запросом: api.openverse.org/v1/images/?q=…&page_size=… отвечает без авторизации.
//
// Важная мелочь, на которой уже спотыкались: без ключа page_size больше 20 запрещён — сервис
// отвечает 401 «page_size may not exceed 20 for anonymous requests». Поэтому просим не больше 20.

import { downloadTo, getJson, safeFileName } from "./http";
import type { FetchProgress, MediaProvider, MediaResult, ProviderCtx, SearchQuery } from "./types";

interface OvItem {
  id: string;
  title?: string;
  creator?: string;
  license?: string;
  license_version?: string;
  foreign_landing_url?: string;
  url: string;
  thumbnail?: string;
  filetype?: string;
  filesize?: number;
  width?: number;
  height?: number;
  duration?: number;
}

/** Предел размера страницы для запросов без ключа. */
const ANON_MAX_PAGE_SIZE = 20;

/** «by» → «CC BY 4.0», но «cc0» уже содержит CC — второй раз не приписываем. */
const license = (i: OvItem) => {
  if (!i.license) return undefined;
  const code = i.license.toUpperCase();
  const ver = i.license_version ? ` ${i.license_version}` : "";
  return code.startsWith("CC") || code === "PDM" ? `${code}${ver}` : `CC ${code}${ver}`;
};

function toResult(i: OvItem, type: "image" | "audio"): MediaResult {
  return {
    providerId: "openverse",
    id: i.id,
    type,
    title: i.title?.trim() || i.id,
    author: i.creator,
    license: license(i),
    pageUrl: i.foreign_landing_url,
    thumbUrl: i.thumbnail ?? (type === "image" ? i.url : undefined),
    previewUrl: i.url,
    downloadUrl: i.url,
    width: i.width,
    height: i.height,
    // Openverse отдаёт длительность звука в миллисекундах
    durationSec: i.duration ? Math.round(i.duration / 1000) : undefined,
    sizeBytes: i.filesize || undefined,
    ext: i.filetype ? `.${i.filetype}` : undefined,
  };
}

export const openverse: MediaProvider = {
  id: "openverse",
  title: "Openverse",
  types: ["image", "audio"],
  note: "свободные лицензии, без ключа",
  available: () => true,

  async search(q: SearchQuery, ctx: ProviderCtx): Promise<MediaResult[]> {
    if (q.type === "video") return [];
    const kind = q.type === "audio" ? "audio" : "images";
    const perPage = Math.min(q.perPage ?? 20, ANON_MAX_PAGE_SIZE);
    const url = `https://api.openverse.org/v1/${kind}/?q=${encodeURIComponent(q.text)}&page=${q.page ?? 1}&page_size=${perPage}`;
    const data = await getJson<{ results?: OvItem[] }>(url, ctx.signal);
    return (data.results ?? []).map((i) => toResult(i, q.type as "image" | "audio"));
  },

  download(r: MediaResult, destDir: string, ctx: ProviderCtx, onProgress?: (p: FetchProgress) => void): Promise<string> {
    if (!r.downloadUrl) throw new Error("у результата нет ссылки на файл");
    return downloadTo(r.downloadUrl, destDir, safeFileName(r.title, r.id), onProgress, ctx.signal);
  },
};

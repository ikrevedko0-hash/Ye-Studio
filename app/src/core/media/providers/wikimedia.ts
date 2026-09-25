// Викисклад: картинки, звук и видео, без ключа. Единственный источник, где надёжно ищутся предметы и гербы.
// Проверено живым запросом: нужен generator=search с gsrnamespace=6 и свой User-Agent.

import { downloadTo, getJson, safeFileName } from "./http";
import type { FetchProgress, MediaProvider, MediaResult, ProviderCtx, SearchQuery } from "./types";

interface CommonsPage {
  pageid: number;
  title: string;
  imageinfo?: {
    url: string;
    descriptionurl?: string;
    thumburl?: string;
    mime?: string;
    size?: number;
    width?: number;
    height?: number;
    duration?: number;
    extmetadata?: Record<string, { value?: string }>;
  }[];
}

/** В extmetadata автор приходит куском html вроде <a href=…>Имя</a>. */
const plain = (v?: string) => v?.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() || undefined;

/** Отбор по типу: у Викисклада всё в одном пространстве имён, фильтруем запросом filetype. */
const FILETYPE: Record<string, string> = { image: "bitmap", audio: "audio", video: "video" };

export const wikimedia: MediaProvider = {
  id: "wikimedia",
  title: "Викисклад",
  types: ["image", "audio", "video"],
  note: "свободные файлы, без ключа",
  available: () => true,

  async search(q: SearchQuery, ctx: ProviderCtx): Promise<MediaResult[]> {
    const search = `filetype:${FILETYPE[q.type]} ${q.text}`;
    const url =
      "https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2" +
      `&generator=search&gsrsearch=${encodeURIComponent(search)}&gsrnamespace=6&gsrlimit=${q.perPage ?? 30}` +
      `&gsroffset=${((q.page ?? 1) - 1) * (q.perPage ?? 30)}` +
      "&prop=imageinfo&iiprop=url%7Csize%7Cmime%7Cextmetadata&iiurlwidth=360";
    const data = await getJson<{ query?: { pages?: CommonsPage[] } }>(url, ctx.signal);
    const pages = data.query?.pages ?? [];
    return pages.flatMap((p): MediaResult[] => {
      const info = p.imageinfo?.[0];
      if (!info) return [];
      const meta = info.extmetadata ?? {};
      const name = p.title.replace(/^File:/, "");
      return [{
        providerId: "wikimedia",
        id: String(p.pageid),
        type: q.type,
        title: name.replace(/\.[^.]+$/, ""),
        author: plain(meta.Artist?.value),
        license: plain(meta.LicenseShortName?.value),
        pageUrl: info.descriptionurl,
        thumbUrl: info.thumburl,
        previewUrl: q.type === "image" ? info.thumburl ?? info.url : info.url,
        downloadUrl: info.url,
        width: info.width,
        height: info.height,
        durationSec: info.duration ? Math.round(info.duration) : undefined,
        sizeBytes: info.size,
      }];
    });
  },

  download(r: MediaResult, destDir: string, ctx: ProviderCtx, onProgress?: (p: FetchProgress) => void): Promise<string> {
    if (!r.downloadUrl) throw new Error("у результата нет ссылки на файл");
    return downloadTo(r.downloadUrl, destDir, safeFileName(r.title, r.id), onProgress, ctx.signal);
  },
};

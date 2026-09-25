// Rutube: поиск роликов без ключа и без обхода блокировок.
//
// Зачем он здесь. YouTube из России часто не открывается вовсе: yt-dlp не резолвит домен и
// минуту с лишним молча повторяет попытки, после чего поиск возвращается пустым. Автору при этом
// кажется, что «видео ищется только по Викискладу». Rutube отвечает обычным JSON за доли секунды
// и находит ровно то же самое: по запросу «крастер» — ролики Дани Крастера.
//
// Скачивание остаётся за yt-dlp: он знает, как собрать поток Rutube в один файл. Поэтому здесь
// только поиск, а download зовёт тот же yt-dlp по ссылке на страницу ролика.

import { getJson } from "./http";
import type { FetchProgress, MediaProvider, MediaResult, ProviderCtx, SearchQuery } from "./types";
import { youtube } from "./youtube";

interface RutubeItem {
  id: string;
  title?: string;
  description?: string;
  author?: { name?: string };
  thumbnail_url?: string;
  duration?: number;
  video_url?: string;
  embed_url?: string;
  is_adult?: boolean;
  is_livestream?: boolean;
  hits?: number;
}

export const rutube: MediaProvider = {
  id: "rutube",
  title: "Rutube",
  types: ["video", "audio"],
  note: "поиск по словам без ключа; работает там, где YouTube закрыт",
  available: () => true,
  // отвечает за доли секунды: если молчит дольше десяти, значит лежит
  searchTimeoutMs: 10_000,

  async search(q: SearchQuery, ctx: ProviderCtx): Promise<MediaResult[]> {
    const perPage = q.perPage ?? 20;
    const url =
      "https://rutube.ru/api/search/video/?query=" + encodeURIComponent(q.text) +
      `&page=${q.page ?? 1}&limit=${perPage}`;
    const data = await getJson<{ results?: RutubeItem[] }>(url, ctx.signal);
    return (data.results ?? []).flatMap((v): MediaResult[] => {
      if (!v.id || v.is_livestream) return []; // прямой эфир в пак не положишь
      return [{
        providerId: "rutube",
        id: v.id,
        type: q.type === "audio" ? "audio" : "video",
        title: v.title?.trim() || v.id,
        author: v.author?.name,
        pageUrl: v.video_url ?? `https://rutube.ru/video/${v.id}/`,
        thumbUrl: v.thumbnail_url,
        durationSec: v.duration ? Math.round(v.duration) : undefined,
      }];
    });
  },

  /** Качает тот же yt-dlp: у него есть извлекатель Rutube, свой писать незачем. */
  download(r: MediaResult, destDir: string, ctx: ProviderCtx, onProgress?: (p: FetchProgress) => void): Promise<string> {
    return youtube.download(r, destDir, ctx, onProgress);
  },
};

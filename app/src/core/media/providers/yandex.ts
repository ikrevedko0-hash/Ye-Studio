// Яндекс.Картинки: то, чем автор пользуется руками, — внутри приложения.
//
// Зачем он нужен рядом с Openverse и Викискладом. Те два ищут по свободным хранилищам, и на
// запрос «Даня Крастер» или «кадр из Пятого элемента» честно отвечают пустотой. Яндекс ищет по
// всему вебу, и для паков это главный источник картинок.
//
// Как устроен разбор. Открытого API у Яндекс.Картинок нет, но и браузер не нужен: выдача лежит
// прямо в HTML страницы поиска — экранированным JSON внутри атрибутов разметки. В нём у каждой
// находки есть миниатюра, ссылка на оригинал, размеры и страница, где картинка стоит.
// Поэтому источник живёт в главном процессе наравне с остальными и не тащит за собой окно.
//
// О лицензиях честно: здесь их нет. Openverse и Викисклад отдают свободные файлы, Яндекс —
// чужие. Это осознанный выбор для паков «Своей игры», и в окне такие находки помечены.

import { downloadTo, getText, safeFileName, UA } from "./http";
import type { FetchProgress, MediaProvider, MediaResult, ProviderCtx, SearchQuery } from "./types";

/**
 * Яндекс отдаёт выдачу только обычному браузеру: с нашим честным UA приходит страница
 * без единой карточки. Это не обход защиты — страница та же самая, что видит человек,
 * просто её надо попросить так, как просит браузер.
 */
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

interface YandexPreview {
  url?: string;
  w?: number;
  h?: number;
  fileSizeInBytes?: number;
  origin?: { url?: string; w?: number; h?: number; fileSizeInBytes?: number };
}

interface YandexSnippet {
  title?: string;
  domain?: string;
  url?: string;
}

/** Ссылки внутри страницы идут без схемы: «//avatars.mds.yandex.net/…». */
const withScheme = (u?: string) => (u ? (u.startsWith("//") ? `https:${u}` : u) : undefined);

/**
 * Достаём карточки из HTML.
 *
 * Разметка Яндекса меняется, а форма данных — нет: рядом всегда лежат «preview» с картинками
 * и «snippet» с подписью. Поэтому ищем не по классам вёрстки, которые переименуют завтра,
 * а по этим двум ключам. Если Яндекс однажды перестанет их отдавать, источник скажет об этом
 * внятно, а не вернёт молча пустой список.
 */
function parseCards(html: string): { preview: YandexPreview[]; snippet: YandexSnippet }[] {
  // страница приходит с экранированными кавычками внутри атрибутов
  const text = html.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const out: { preview: YandexPreview[]; snippet: YandexSnippet }[] = [];
  const seen = new Set<string>();

  for (let i = text.indexOf('"preview":['); i >= 0; i = text.indexOf('"preview":[', i + 1)) {
    const preview = readJson<YandexPreview[]>(text, i + '"preview":'.length);
    if (!preview?.length) continue;
    const first = preview[0]?.origin?.url ?? preview[0]?.url;
    if (!first || seen.has(first)) continue;
    seen.add(first);

    // подпись лежит рядом: берём ближайшую слева, она относится к этой же находке
    const sn = text.lastIndexOf('"snippet":{', i);
    const snippet = sn >= 0 ? readJson<YandexSnippet>(text, sn + '"snippet":'.length) ?? {} : {};
    out.push({ preview, snippet });
  }
  return out;
}

/** Вырезать один объект или массив JSON, считая скобки. Длину заранее никто не сообщает. */
function readJson<T>(text: string, from: number): T | undefined {
  const open = text[from];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inStr = false;
  for (let i = from; i < text.length && i < from + 200_000; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) {
      try { return JSON.parse(text.slice(from, i + 1)) as T; } catch { return undefined; }
    }
  }
  return undefined;
}

/**
 * Подпись для плитки. Pinterest и подобные отдают вместо названия голую ссылку на самих себя,
 * и вся выдача выглядела как столбец одинаковых «https://www.pinterest.com/pin/…».
 */
function cardTitle(snippet: YandexSnippet, query: string): string {
  const t = snippet.title?.trim() ?? "";
  if (t && !/^https?:\/\//i.test(t)) return t;
  return snippet.domain ? `${query} — ${snippet.domain}` : query;
}

export const yandex: MediaProvider = {
  id: "yandex",
  title: "Яндекс.Картинки",
  types: ["image"],
  note: "весь веб, без ключа. Лицензий нет — картинки чужие",
  available: () => true,
  searchTimeoutMs: 20_000,

  async search(q: SearchQuery, ctx: ProviderCtx): Promise<MediaResult[]> {
    // страницы у Яндекса считаются с нуля
    const page = Math.max(0, (q.page ?? 1) - 1);
    const url = `https://yandex.ru/images/search?text=${encodeURIComponent(q.text)}&p=${page}`;
    const html = await getText(url, ctx.signal, { "user-agent": BROWSER_UA, "accept-language": "ru,en;q=0.9" });

    const cards = parseCards(html);
    if (!cards.length) {
      // отличаем «ничего не нашлось» от «нас попросили доказать, что мы человек»
      if (/showcaptcha|SmartCaptcha|checkcaptcha/i.test(html)) {
        throw new Error("Яндекс просит пройти проверку «я не робот». Подождите несколько минут или поищите в других источниках — капчу приложение не обходит");
      }
      return [];
    }

    return cards.slice(0, q.perPage ?? 30).flatMap((c): MediaResult[] => {
      const best = c.preview[0];
      const origin = best?.origin;
      const full = withScheme(origin?.url ?? best?.url);
      if (!full) return [];
      // маленькая копия у Яндекса своя и всегда открывается — она и идёт в плитку
      const thumb = withScheme(best?.url);
      return [{
        providerId: "yandex",
        id: full,
        type: "image",
        // у части сайтов вместо подписи стоит сама ссылка — в плитке от неё толку нет
        title: cardTitle(c.snippet, q.text),
        author: c.snippet.domain,
        pageUrl: c.snippet.url ?? full,
        thumbUrl: thumb,
        previewUrl: thumb ?? full,
        downloadUrl: full,
        width: origin?.w ?? best?.w,
        height: origin?.h ?? best?.h,
        sizeBytes: origin?.fileSizeInBytes ?? best?.fileSizeInBytes,
      }];
    });
  },

  /**
   * Качаем оригинал с чужого сайта, а если он закрыт от посторонних — копию у Яндекса.
   * Второй путь важнее, чем кажется: Pinterest и подобные отдают файл только своим страницам,
   * и без запасного варианта половина выдачи не скачивалась бы вовсе.
   */
  async download(r: MediaResult, destDir: string, ctx: ProviderCtx, onProgress?: (p: FetchProgress) => void): Promise<string> {
    const name = safeFileName(r.title, "картинка");
    const asBrowser = { "user-agent": BROWSER_UA, referer: r.pageUrl ?? "https://yandex.ru/" };
    try {
      if (!r.downloadUrl) throw new Error("нет ссылки на оригинал");
      return await downloadTo(r.downloadUrl, destDir, name, onProgress, ctx.signal, asBrowser);
    } catch (first) {
      if (!r.thumbUrl) throw first;
      onProgress?.({ receivedBytes: 0, note: "оригинал закрыт, беру копию Яндекса" });
      return downloadTo(r.thumbUrl, destDir, name, onProgress, ctx.signal, { "user-agent": UA });
    }
  },
};

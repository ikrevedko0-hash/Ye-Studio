// Сеть для источников медиа. Только главный процесс: из окна такие запросы не пройдут по origin.
//
// Почему node:https, а не fetch. В Electron с 28-й версии глобальный fetch главного процесса — это
// сетевой стек Chromium: он подмешивает свои заголовки и работает через сессию окна. node:https
// ведёт себя одинаково и в приложении, и в проверках из консоли (npx tsx scripts/providers-test.ts),
// поэтому проверка и рабочий код ходят в сеть по одной дороге.
//
// Отсюда же правило: при отказе показываем тело ответа. Сервисы объясняют причину внятно —
// «page_size may not exceed 20 for anonymous requests» нашлось именно так, за один запуск.

import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { dirname, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { FetchProgress } from "./types";

/**
 * Свой User-Agent обязателен: Wikimedia и Groq без него отвечают отказом.
 * Только ASCII: заголовки HTTP — это ByteString, и кириллица в них роняет весь запрос.
 */
export const UA = "siq-workshop/0.1 (SIGame pack workshop)";

/** Человеческое объяснение вместо голого кода ответа: в окне это увидит автор пака. */
export function httpReason(status: number, host: string): string {
  if (status === 429) return `${host} просит подождать: слишком часто качаем. Через минуту получится.`;
  if (status === 401 || status === 403) return `${host} закрыл доступ к файлу (${status}). Возьмите другой вариант или другой источник.`;
  if (status === 404) return `файла уже нет на ${host} (404)`;
  if (status >= 500) return `${host} сейчас не отвечает (${status}), попробуйте позже`;
  return `${host} ответил ${status}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Один запрос через node:https с ручной обработкой переадресаций.
 * Сжатие не просим (identity): распаковывать поток ради нескольких килобайт JSON смысла нет,
 * а файлы и так приходят уже сжатыми.
 */
export function once(url: string, headers: Record<string, string>, signal?: AbortSignal, hops = 0): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (hops > 5) return reject(new Error("слишком много переадресаций"));
    const u = new URL(url);
    const req = (u.protocol === "http:" ? httpRequest : httpsRequest)(
      u,
      { headers: { "user-agent": UA, "accept-encoding": "identity", ...headers } },
      (res) => {
        const code = res.statusCode ?? 0;
        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume(); // тело переадресации не нужно, но поток закрыть надо
          once(new URL(res.headers.location, url).toString(), headers, signal, hops + 1).then(resolve, reject);
          return;
        }
        resolve(res);
      },
    );
    req.on("error", reject);
    signal?.addEventListener("abort", () => req.destroy(new Error("отменено")), { once: true });
    req.end();
  });
}

/**
 * Запрос с повтором на «подождите» и «сервер прилёг».
 * Бесплатные источники отвечают 429 обыденно — один повтор спасает больше половины случаев.
 */
async function withRetry(url: string, headers: Record<string, string>, signal?: AbortSignal, tries = 3): Promise<IncomingMessage> {
  let last: IncomingMessage | undefined;
  for (let i = 0; i < tries; i++) {
    const res = await once(url, headers, signal);
    const code = res.statusCode ?? 0;
    if (code < 400 || (code !== 429 && code < 500)) return res;
    res.resume();
    last = res;
    if (i === tries - 1) break;
    const after = Number(res.headers["retry-after"]);
    await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 10) * 1000 : 800 * 2 ** i);
  }
  return last!;
}

function readAll(res: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = "";
    res.setEncoding("utf8");
    res.on("data", (c: string) => { out += c; });
    res.on("end", () => resolve(out));
    res.on("error", reject);
  });
}

export async function getJson<T = unknown>(url: string, signal?: AbortSignal, headers: Record<string, string> = {}): Promise<T> {
  const res = await withRetry(url, { accept: "application/json", ...headers }, signal);
  const code = res.statusCode ?? 0;
  if (code >= 400) {
    // сам сервис обычно объясняет отказ лучше, чем код ответа: показываем его слова
    const body = await readAll(res).catch(() => "");
    const detail = body.trim().slice(0, 200).replace(/\s+/g, " ");
    throw new Error(`${httpReason(code, new URL(url).host)}${detail ? ` — ${detail}` : ""}`);
  }
  return JSON.parse(await readAll(res)) as T;
}

/**
 * Страница как текст. Нужна источникам без открытого API: там выдача лежит прямо в HTML,
 * и разбирать её приходится на месте.
 */
export async function getText(url: string, signal?: AbortSignal, headers: Record<string, string> = {}): Promise<string> {
  const res = await withRetry(url, { accept: "text/html,application/xhtml+xml", ...headers }, signal);
  const code = res.statusCode ?? 0;
  if (code >= 400) {
    const body = await readAll(res).catch(() => "");
    const detail = body.trim().slice(0, 200).replace(/\s+/g, " ");
    throw new Error(`${httpReason(code, new URL(url).host)}${detail ? ` — ${detail}` : ""}`);
  }
  return readAll(res);
}

/** Имя, которое не поругает ни Windows, ни zip пака. */
export function safeFileName(name: string, fallback = "файл"): string {
  const clean = name
    .replace(/[\\/:*?"<>|\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
  return clean || fallback;
}

/** Расширение из ссылки или из типа ответа. */
export function guessExt(url: string, contentType?: string | null): string {
  const fromUrl = extname(new URL(url, "https://x/").pathname).toLowerCase();
  if (/^\.[a-z0-9]{2,5}$/.test(fromUrl)) return fromUrl;
  const t = (contentType ?? "").split(";")[0].trim();
  const map: Record<string, string> = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "image/svg+xml": ".svg",
    "audio/mpeg": ".mp3", "audio/ogg": ".ogg", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/mp4": ".m4a", "audio/flac": ".flac",
    "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
  };
  return map[t] ?? ".bin";
}

/**
 * Качает ссылку в файл. Возвращает итоговый путь: расширение может уточниться по ответу сервера.
 * Недокачанный файл удаляем — иначе в source/ останется мусор, который потом примут за оригинал.
 */
export async function downloadTo(
  url: string,
  destDir: string,
  baseName: string,
  onProgress?: (p: FetchProgress) => void,
  signal?: AbortSignal,
  headers: Record<string, string> = {},
): Promise<string> {
  const res = await withRetry(url, headers, signal);
  const code = res.statusCode ?? 0;
  if (code >= 400) {
    const body = await readAll(res).catch(() => "");
    const detail = body.trim().slice(0, 200).replace(/\s+/g, " ");
    throw new Error(`${httpReason(code, new URL(url).host)}${detail && !/^</.test(detail) ? ` — ${detail}` : ""}`);
  }
  const ext = guessExt(url, res.headers["content-type"]);
  const total = Number(res.headers["content-length"]) || undefined;
  const out = join(destDir, safeFileName(baseName) + ext);
  await mkdir(dirname(out), { recursive: true });

  let received = 0;
  res.on("data", (c: Buffer) => {
    received += c.length;
    onProgress?.({ receivedBytes: received, totalBytes: total, ratio: total ? received / total : undefined });
  });
  try {
    await pipeline(res, createWriteStream(out));
  } catch (e) {
    await rm(out, { force: true });
    throw e;
  }
  return out;
}

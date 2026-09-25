// Генерация картинки по очереди моделей: первая ответившая — победитель.
//
// Cloudflare Workers AI принимает разные модели по-разному: FLUX.2 (klein) хочет multipart/form-data,
// остальные — JSON; flux-1-schnell вообще не принимает размеры. Ответ бывает и JSON с base64,
// и сразу байтами картинки — разбираем оба. Pollinations — OpenAI-совместимый /images/generations.

import { AiHttpError, coolDown, DEFAULT_IMAGE_CHAIN, errorText, isCooling, isLocal, providerKind, shouldCool, splitRef, timeoutMs, withTimeout, type AiConfig, type AiProvider } from "./config";
import { ensureLocalServer, localServerUsed } from "./localServer";
import { exhaustedUntil, markExhausted, noteHeaders, noteUse } from "./usage";

export interface ImageRequest {
  prompt: string;
  width?: number;
  height?: number;
}

export interface ImageOptions {
  /** Разрешить платные модели (paid у провайдера). Без этого они пропускаются. */
  allowPaid?: boolean;
}

/**
 * Бесплатные модели не справились, а платные в очереди есть: окно спросит автора,
 * тратить ли деньги. Отличаем от обычной ошибки по коду.
 */
export class NeedPaidError extends Error {
  code = "NEED_PAID";
  constructor(public paid: string[], public skipped: string[]) {
    super(`бесплатные модели не нарисовали: ${skipped.join(" · ")}. Можно платной: ${paid.join(", ")}`);
  }
}

export interface ImageResult {
  data: Buffer;
  mime: "image/png" | "image/jpeg" | "image/webp";
  /** Какая модель ответила: показываем автору. */
  model: string;
  ms: number;
  /** Модели, которые не справились до победителя, с причиной. */
  skipped: string[];
}

/** Короткие имена из старых конфигов («cloudflare:flux-1-schnell») → полный id модели. */
const CF_SHORT: Record<string, string> = {
  "flux-1-schnell": "@cf/black-forest-labs/flux-1-schnell",
  "flux-2-klein-4b": "@cf/black-forest-labs/flux-2-klein-4b",
  "flux-2-klein-9b": "@cf/black-forest-labs/flux-2-klein-9b",
  "lucid-origin": "@cf/leonardo/lucid-origin",
  "phoenix-1.0": "@cf/leonardo/phoenix-1.0",
};

function sniff(buf: Buffer): ImageResult["mime"] {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  return "image/webp";
}

async function cloudflare(cfg: AiConfig, id0: string, p: AiProvider, model: string, req: ImageRequest, signal: AbortSignal): Promise<Buffer> {
  if (!p.key || !p.account) throw new Error(`у ${id0} нет ключа или номера аккаунта`);
  const id = CF_SHORT[model] ?? model;
  const url = `https://api.cloudflare.com/client/v4/accounts/${p.account}/ai/run/${id}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${p.key}` };
  if (cfg.userAgent) headers["User-Agent"] = cfg.userAgent;

  const params: Record<string, string | number> = { prompt: req.prompt };
  // schnell отвечает 400 на любой размер, он умеет только квадрат
  if (!id.includes("flux-1-schnell")) {
    params.width = req.width ?? 1024;
    params.height = req.height ?? 768;
  } else {
    params.steps = 8;
  }

  let body: BodyInit;
  if (id.includes("flux-2")) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(params)) fd.append(k, String(v));
    body = fd;
  } else {
    body = JSON.stringify(params);
    headers["Content-Type"] = "application/json";
  }

  const r = await fetch(url, { method: "POST", headers, body, signal });
  noteHeaders(id0, r.headers);
  if (!r.ok) {
    const text = await errorText(r);
    // «you have used up your daily free allocation of 10,000 neurons» — до полуночи UTC не ждать
    if (/daily free allocation|4006/i.test(text)) markExhausted(id0);
    throw new AiHttpError(r.status, `HTTP ${r.status}: ${text}`);
  }
  if ((r.headers.get("content-type") ?? "").startsWith("image/")) return Buffer.from(await r.arrayBuffer());
  const j = (await r.json()) as { result?: { image?: string } };
  const b64 = j?.result?.image;
  if (!b64) throw new Error("в ответе нет картинки");
  return Buffer.from(b64, "base64");
}

/**
 * sd-server по умолчанию берёт seed 42: тот же промпт — та же картинка до пикселя, и «Ещё вариант»
 * ничего не менял (2026-09-24). Своих полей для seed в OpenAI-запросе у него нет — только тег в промпте.
 */
function withSeed(prompt: string): string {
  return `${prompt}<sd_cpp_extra_args>${JSON.stringify({ seed: Math.floor(Math.random() * 2 ** 31) })}</sd_cpp_extra_args>`;
}

async function openaiLike(cfg: AiConfig, provider: string, p: AiProvider, model: string, req: ImageRequest, signal: AbortSignal): Promise<Buffer> {
  if (!p.base) throw new Error(`у ${provider} не задан адрес`);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (p.key) headers.Authorization = `Bearer ${p.key}`;
  if (cfg.userAgent) headers["User-Agent"] = cfg.userAgent;
  const landscape = (req.width ?? 1024) > (req.height ?? 768);
  // gpt-image знает только свои размеры, а локальный sd-server рисует ровно заказанный —
  // растягивать 1536×1024 до 4:3 и тратить на лишние пиксели время незачем
  const local = isLocal(p);
  const size = local ? `${req.width ?? 1024}x${req.height ?? 768}` : landscape ? "1536x1024" : "1024x1024";
  const r = await fetch(`${p.base.replace(/\/$/, "")}/images/generations`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, prompt: local ? withSeed(req.prompt) : req.prompt, n: 1, size, ...(local ? { response_format: "b64_json", output_format: "png" } : {}) }),
    signal,
  });
  noteHeaders(provider, r.headers);
  if (!r.ok) throw new AiHttpError(r.status, `HTTP ${r.status}: ${await errorText(r)}`);
  const j = (await r.json()) as { data?: { b64_json?: string; url?: string }[] };
  const d = j?.data?.[0];
  if (d?.b64_json) return Buffer.from(d.b64_json, "base64");
  if (d?.url) {
    const img = await fetch(d.url, { signal });
    if (!img.ok) throw new Error(`картинка не скачалась: HTTP ${img.status}`);
    return Buffer.from(await img.arrayBuffer());
  }
  throw new Error("в ответе нет картинки");
}

/**
 * Идём по очереди imageChain. Ошибка 429/5xx ставит модель на паузу (cooldownMinutes),
 * любая другая — просто переход к следующей. Отмена от окна прерывает всё сразу.
 */
export async function generateImage(cfg: AiConfig, req: ImageRequest, signal?: AbortSignal, opts: ImageOptions = {}): Promise<ImageResult> {
  const chain = cfg.imageChain?.length ? cfg.imageChain : DEFAULT_IMAGE_CHAIN;
  const skipped: string[] = [];
  const paidLeft: string[] = [];
  for (const ref of chain) {
    const [provider, model] = splitRef(ref);
    const p = cfg.providers[provider];
    if (!p || p.disabled) {
      skipped.push(`${ref}: ${p ? "сервис выключен" : "нет такого сервиса"}`);
      continue;
    }
    if (p.paid && !opts.allowPaid) {
      paidLeft.push(ref);
      continue;
    }
    const until = exhaustedUntil(provider);
    if (until) {
      skipped.push(`${ref}: дневной лимит исчерпан до ${new Date(until).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}`);
      continue;
    }
    if (isCooling(ref)) {
      skipped.push(`${ref}: на паузе после сбоя`);
      continue;
    }
    const cf = providerKind(p) === "cloudflare";
    try {
      // запуск сервера (загрузка моделей) не входит в таймаут самой картинки
      await ensureLocalServer(provider, p, signal);
    } catch (e) {
      if (signal?.aborted) throw new Error("отменено");
      skipped.push(`${ref}: ${(e as Error).message}`);
      continue;
    }
    const t0 = Date.now();
    // Cloudflare укладывается в секунды. gpt-image-2 в Pollinations рисует минутами: 150 с однажды
    // не хватило («aborted due to timeout», 2026-09-24), а оборванный запрос, возможно, всё равно оплачен
    const one = withTimeout(signal, p.timeoutSec ? timeoutMs(p, 0) : cf ? 60_000 : 300_000);
    try {
      const data = cf
        ? await cloudflare(cfg, provider, p, model, req, one)
        : await openaiLike(cfg, provider, p, model, req, one);
      if (p.launch) localServerUsed(provider);
      if (data.length < 1000) throw new Error("ответ слишком мал для картинки");
      noteUse(ref, "image");
      return { data, mime: sniff(data), model: ref, ms: Date.now() - t0, skipped };
    } catch (e) {
      if (signal?.aborted) throw new Error("отменено");
      if (shouldCool(cfg, e)) coolDown(cfg, ref);
      skipped.push(`${ref}: ${(e as Error).message}`);
    }
  }
  if (paidLeft.length) throw new NeedPaidError(paidLeft, skipped);
  throw new Error(`ни одна модель не нарисовала. ${skipped.join(" · ")}`);
}

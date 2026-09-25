// Учёт расхода ИИ: сколько картинок и запросов ушло сегодня на каждую модель, и что сами сервисы
// сообщают о лимитах в заголовках последнего ответа (Groq, OpenRouter и другие OpenAI-совместимые
// шлют x-ratelimit-*). Свой счётчик нужен, потому что многие сервисы остаток не отдают вовсе.
//
// Всё лежит в одном файле и переживает перезапуск: иначе после каждого запуска Groq «не сообщал бы»
// остаток до первого запроса, а исчерпанный Cloudflare выглядел бы полным.
// Дни считаем по UTC: бесплатный лимит Cloudflare обнуляется в 00:00 UTC, в Москве это 03:00.

import { readFileSync, writeFileSync } from "node:fs";

export interface DayUse {
  images: number;
  texts: number;
}

interface UsageFile {
  /** { "2026-09-24": { "cloudflare:@cf/…": { images: 3, texts: 0 } } } */
  days: Record<string, Record<string, DayUse>>;
  /** Заголовки о лимитах из последнего ответа сервиса. */
  headers: Record<string, { at: number; values: Record<string, string> }>;
  /** Сервис сказал «дневной лимит исчерпан» — до какого момента (мс) его не спрашивать. */
  exhausted: Record<string, number>;
}

let file: string | undefined;
let data: UsageFile = { days: {}, headers: {}, exhausted: {} };

export function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Куда писать учёт. Без вызова учёт живёт только в памяти (так в скриптах проверки). */
export function setUsageFile(path: string): void {
  file = path;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<UsageFile>;
    data = { days: raw.days ?? {}, headers: raw.headers ?? {}, exhausted: raw.exhausted ?? {} };
  } catch {
    data = { days: {}, headers: {}, exhausted: {} };
  }
}

function persist(): void {
  if (!file) return;
  try { writeFileSync(file, JSON.stringify(data, null, 1)); } catch { /* учёт — не повод падать */ }
}

export function noteUse(ref: string, kind: "image" | "text"): void {
  const day = (data.days[utcDay()] ??= {});
  const u = (day[ref] ??= { images: 0, texts: 0 });
  if (kind === "image") u.images++;
  else u.texts++;
  // храним неделю: больше для подсказки о лимитах не нужно
  const keep = new Set(Object.keys(data.days).sort().slice(-7));
  for (const k of Object.keys(data.days)) if (!keep.has(k)) delete data.days[k];
  persist();
}

export function usageToday(): Record<string, DayUse> {
  return data.days[utcDay()] ?? {};
}

/** Запомнить заголовки о лимитах из ответа сервиса (любого, в том числе с ошибкой 429). */
export function noteHeaders(provider: string, h: Headers): void {
  const values: Record<string, string> = {};
  h.forEach((v, k) => {
    if (/^(x-)?ratelimit|^retry-after$/i.test(k)) values[k.toLowerCase()] = v;
  });
  if (!Object.keys(values).length) return;
  data.headers[provider] = { at: Date.now(), values };
  persist();
}

export function lastHeaders(provider: string): { at: number; values: Record<string, string> } | undefined {
  return data.headers[provider];
}

export function nextUtcMidnight(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/**
 * Сервис сказал «дневной бесплатный лимит исчерпан» (Cloudflare: код 4006). Дальше спрашивать
 * его бессмысленно до сброса в 00:00 UTC — пропускаем все его модели, а автору показываем время сброса.
 */
export function markExhausted(provider: string): void {
  data.exhausted[provider] = nextUtcMidnight();
  persist();
}

/** Когда обнулится лимит, если он сейчас исчерпан; иначе undefined. */
export function exhaustedUntil(provider: string): number | undefined {
  const t = data.exhausted[provider];
  return t && t > Date.now() ? t : undefined;
}

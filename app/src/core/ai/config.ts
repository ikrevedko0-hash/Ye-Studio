// Настройки ИИ-сервисов: ключи, очереди моделей. Файл providers.json лежит вне проекта и вне git.
//
// Ищем в двух местах: рядом с настройками приложения (у собранного exe это «%APPDATA%\Мастерская паков»)
// и в «%APPDATA%\siq-workshop», где файл завёлся исторически. Так одна копия ключей служит
// и разработке, и собранному приложению, а переносить её руками не нужно.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Как с сервисом разговаривать. «openai» — любой OpenAI-совместимый (Google, Groq, Z.ai, OpenRouter,
 * Pollinations, LM Studio…). «cloudflare» — Workers AI: текст через тот же OpenAI-вход,
 * а картинки через /ai/run с номером аккаунта.
 */
export type AiProviderKind = "openai" | "cloudflare";

export interface AiProvider {
  title?: string;
  kind?: AiProviderKind;
  /** OpenAI-совместимый адрес: к нему дописываются /chat/completions и /images/generations. */
  base: string;
  key?: string;
  /** Только у Cloudflare: картинки идут не через OpenAI-совместимый вход, а через /ai/run. */
  account?: string;
  /** Текстовые модели. */
  models?: string[];
  /** Модели картинок. */
  imageModels?: string[];
  extraBody?: Record<string, unknown>;
  /** Сколько ждать ответа, с. Не задано — 45 с облаку, 120 с локальному серверу. */
  timeoutSec?: number;
  /** Заметка автора: лимиты, капризы. */
  note?: string;
  /** Выключенный провайдер пропускается в очередях, но настройки его сохраняются. */
  disabled?: boolean;
  /** Платный: в очереди картинок используется только по явному согласию автора. */
  paid?: boolean;
  /** Локальный сервер, который приложение само запускает, когда он не отвечает (см. localServer.ts). */
  launch?: { exe: string; args?: string[]; cwd?: string };
}

/** Тип провайдера: задан явно — берём его, иначе узнаём Cloudflare по номеру аккаунта. */
export function providerKind(p: AiProvider): AiProviderKind {
  return p.kind ?? (p.account ? "cloudflare" : "openai");
}

/** Сервер на этом же компьютере (LM Studio, sd-server). */
export function isLocal(p: AiProvider): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost)/.test(p.base);
}

/** Локальный сервер (LM Studio, Cherry Studio) медленнее облака — ждём его дольше. */
export function timeoutMs(p: AiProvider, cloudDefault: number): number {
  if (p.timeoutSec) return p.timeoutSec * 1000;
  return isLocal(p) ? 120_000 : cloudDefault;
}

export interface AiConfig {
  userAgent?: string;
  retryOnStatus?: number[];
  cooldownMinutes?: number;
  providers: Record<string, AiProvider>;
  /** Очередь текстовых моделей: «провайдер:модель». */
  chain?: string[];
  /** Очередь моделей картинок: «провайдер:модель». */
  imageChain?: string[];
}

/** Очередь картинок по умолчанию — итог сравнения 2026-09-23 (см. AGENTS.md). */
export const DEFAULT_IMAGE_CHAIN = [
  "cloudflare:@cf/black-forest-labs/flux-2-klein-9b",
  "cloudflare:@cf/leonardo/lucid-origin",
  "pollinations:openai/gpt-image-2",
];

export function configCandidates(baseDir: string): string[] {
  const list = [join(baseDir, "providers.json")];
  if (process.env.APPDATA) list.push(join(process.env.APPDATA, "siq-workshop", "providers.json"));
  return list;
}

/** Первый найденный providers.json. Нет ни одного — понятная ошибка с путями, где искали. */
export async function loadAiConfig(baseDir: string): Promise<{ cfg: AiConfig; path: string }> {
  const found = await findAiConfig(baseDir);
  if (!found) throw new Error("ИИ не настроен: откройте «⚙ ИИ» в шапке и добавьте хотя бы один сервис с ключом");
  return found;
}

/** То же, но без ошибки: окну настроек пустота — нормальное начальное состояние. */
export async function findAiConfig(baseDir: string): Promise<{ cfg: AiConfig; path: string } | null> {
  for (const path of configCandidates(baseDir)) {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      continue;
    }
    const cfg = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw) as AiConfig;
    cfg.providers ??= {};
    return { cfg, path };
  }
  return null;
}

/** «cloudflare:@cf/…» → ["cloudflare", "@cf/…"]. Двоеточие в имени модели не мешает. */
export function splitRef(ref: string): [string, string] {
  const i = ref.indexOf(":");
  return i < 0 ? [ref, ""] : [ref.slice(0, i), ref.slice(i + 1)];
}

/**
 * Модели, упавшие с 429/5xx, на время выбывают из очереди — иначе каждый запрос сначала
 * ждал бы отказа от перегруженного сервиса. Живёт в памяти процесса, на диск не пишется.
 */
const cooling = new Map<string, number>();

export function isCooling(ref: string): boolean {
  const until = cooling.get(ref);
  return until !== undefined && until > Date.now();
}

export function coolDown(cfg: AiConfig, ref: string): void {
  cooling.set(ref, Date.now() + (cfg.cooldownMinutes ?? 10) * 60_000);
}

/** Ошибка сервиса с кодом ответа: по коду решаем, ставить ли модель на паузу. */
export class AiHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function shouldCool(cfg: AiConfig, e: unknown): boolean {
  if (!(e instanceof AiHttpError)) return false;
  return (cfg.retryOnStatus ?? [429, 500, 502, 503]).includes(e.status);
}

/** Слить сигнал отмены от окна с таймаутом одного запроса. */
export function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const t = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, t]) : t;
}

export async function errorText(r: Response): Promise<string> {
  const text = await r.text().catch(() => "");
  try {
    const j = JSON.parse(text);
    const e = j?.errors?.[0]?.message ?? j?.error?.message ?? j?.error ?? j?.message;
    if (e) return String(e).slice(0, 300);
  } catch { /* не JSON */ }
  return text.slice(0, 300) || r.statusText;
}

// Сколько осталось: по каждому сервису — лучшее, что он сам готов сообщить.
//
// Проверено 2026-09-24:
// - Cloudflare: GraphQL aiInferenceAdaptiveGroups → sum.totalNeurons за сутки UTC. Нужно право токена
//   «Account Analytics: Read», без него — «not authorized» (authz). Тогда считаем по своему учёту.
// - Pollinations: GET /account/balance. Ключу нужно право account:usage или свой бюджет, иначе 403.
// - OpenRouter: GET /api/v1/key → data.limit_remaining, free_model_daily_requests.
// - Groq и прочие OpenAI-совместимые: заголовки x-ratelimit-* последнего ответа (у Groq requests — за сутки).
// - Google AI Studio остаток не отдаёт никак: только свой учёт.

import { errorText, isLocal, providerKind, splitRef, type AiConfig, type AiProvider } from "./config";
import { exhaustedUntil, lastHeaders, markExhausted, usageToday, utcDay } from "./usage";

export interface QuotaInfo {
  provider: string;
  /** Главная строка: «осталось ~5 400 из 10 000 нейронов». */
  text: string;
  level: "ok" | "low" | "out" | "unknown";
  /** Откуда цифра: «по данным Cloudflare», «по своему учёту». */
  source: string;
  /** Что сделать, чтобы цифра стала точнее. */
  hint?: string;
}

/**
 * Бесплатный дневной лимит Workers AI и цена одной картинки 1024×768 в нейронах — по фактическому
 * расходу из GraphQL за 2026-09-23 (прайс обещал klein-9b ≈ 1364, на деле 9545 / 8 ≈ 1193).
 */
const CF_DAILY_NEURONS = 10_000;
const CF_IMAGE_NEURONS: Record<string, number> = {
  "flux-2-klein-9b": 1193,
  "flux-2-klein-4b": 104,
  "lucid-origin": 2448,
  "phoenix-1.0": 2340,
  "flux-1-schnell": 109,
};

const fmt = (n: number) => Math.round(n).toLocaleString("ru");
const hhmm = (t: number) => new Date(t).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });

function authHeaders(cfg: AiConfig, p: AiProvider): Record<string, string> {
  const h: Record<string, string> = {};
  if (p.key) h.Authorization = `Bearer ${p.key}`;
  if (cfg.userAgent) h["User-Agent"] = cfg.userAgent;
  return h;
}

/** Сколько сегодня ушло через этот сервис по своему учёту. */
function ownUse(id: string): { images: number; texts: number; neurons: number } {
  let images = 0, texts = 0, neurons = 0;
  for (const [ref, u] of Object.entries(usageToday())) {
    const [prov, model] = splitRef(ref);
    if (prov !== id) continue;
    images += u.images;
    texts += u.texts;
    const short = model.split("/").pop() ?? model;
    neurons += u.images * (CF_IMAGE_NEURONS[short] ?? 1500);
  }
  return { images, texts, neurons };
}

async function cloudflare(cfg: AiConfig, id: string, p: AiProvider, signal: AbortSignal): Promise<QuotaInfo> {
  const until = exhaustedUntil(id);
  if (until) {
    return { provider: id, level: "out", source: "ответ Cloudflare", text: `бесплатный лимит на сегодня исчерпан, обнулится в ${hhmm(until)}` };
  }
  const day = utcDay();
  const query = `query($a: string!, $s: Time!, $e: Time!) { viewer { accounts(filter: { accountTag: $a }) {
    aiInferenceAdaptiveGroups(limit: 100, filter: { datetime_geq: $s, datetime_lt: $e }) { sum { totalNeurons } } } } }`;
  try {
    const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { ...authHeaders(cfg, p), "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { a: p.account, s: `${day}T00:00:00Z`, e: `${day}T23:59:59Z` } }),
      signal,
    });
    const j = (await r.json()) as {
      data?: { viewer?: { accounts?: { aiInferenceAdaptiveGroups?: { sum?: { totalNeurons?: number } }[] }[] } };
      errors?: { message?: string; extensions?: { code?: string } }[];
    };
    const groups = j.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups;
    if (groups) {
      const used = groups.reduce((s, g) => s + (g.sum?.totalNeurons ?? 0), 0);
      const left = Math.max(0, CF_DAILY_NEURONS - used);
      return {
        provider: id,
        level: left < CF_IMAGE_NEURONS["flux-2-klein-9b"] ? "out" : left < 2 * CF_IMAGE_NEURONS["flux-2-klein-9b"] ? "low" : "ok",
        source: "по данным Cloudflare (с задержкой в минуты)",
        text: `осталось ~${fmt(left)} из ${fmt(CF_DAILY_NEURONS)} нейронов ≈ ${Math.floor(left / CF_IMAGE_NEURONS["flux-2-klein-9b"])} картинок klein-9b`,
      };
    }
    const authz = j.errors?.some((e) => e.extensions?.code === "authz" || /not authorized/i.test(e.message ?? ""));
    // Свой учёт не видит расход других программ и тестов. Самый дешёвый способ узнать, не исчерпан ли
    // лимит, — один токен от самой маленькой модели (доли нейрона): исчерпан — ответ 4006.
    if (await cfExhausted(cfg, p, signal)) {
      markExhausted(id);
      return cloudflare(cfg, id, p, signal);
    }
    const own = ownUse(id);
    const left = Math.max(0, CF_DAILY_NEURONS - own.neurons);
    return {
      provider: id,
      level: left < 2 * CF_IMAGE_NEURONS["flux-2-klein-9b"] ? "low" : "unknown",
      source: "оценка по учёту этого приложения",
      text: `сегодня нарисовано ${own.images} → осталось примерно ${fmt(left)} из ${fmt(CF_DAILY_NEURONS)} нейронов (картинка klein-9b ≈ ${CF_IMAGE_NEURONS["flux-2-klein-9b"]})`,
      hint: authz
        ? "Для точной цифры добавьте токену право «Account Analytics: Read» (dash.cloudflare.com → My Profile → API Tokens)."
        : j.errors?.[0]?.message,
    };
  } catch (e) {
    return { provider: id, level: "unknown", source: "", text: `не узнать: ${(e as Error).message}` };
  }
}

async function cfExhausted(cfg: AiConfig, p: AiProvider, signal: AbortSignal): Promise<boolean> {
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${p.account}/ai/run/@cf/meta/llama-3.2-1b-instruct`, {
      method: "POST",
      headers: { ...authHeaders(cfg, p), "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "1", max_tokens: 1 }),
      signal,
    });
    if (r.ok) return false;
    return /daily free allocation|4006/i.test(await errorText(r));
  } catch {
    return false;
  }
}

async function pollinations(cfg: AiConfig, id: string, p: AiProvider, signal: AbortSignal): Promise<QuotaInfo> {
  const origin = new URL(p.base).origin;
  const r = await fetch(`${origin}/account/balance`, { headers: authHeaders(cfg, p), signal });
  if (!r.ok) {
    const own = ownUse(id);
    return {
      provider: id, level: "unknown", source: "оценка по учёту этого приложения",
      text: `баланс не отдан (HTTP ${r.status}); сегодня потрачено картинок: ${own.images}`,
      hint: r.status === 403 ? "Дайте ключу право account:usage или задайте ему бюджет на enter.pollinations.ai." : await errorText(r),
    };
  }
  const j = (await r.json()) as { balance?: number; accountBalance?: { paid?: number; tier?: number } };
  const bal = j.accountBalance?.paid ?? j.balance ?? 0;
  return {
    provider: id, level: bal < 0.04 ? "out" : bal < 0.2 ? "low" : "ok", source: "по данным Pollinations",
    text: `баланс ${bal.toFixed(3)} pollen ≈ ${Math.floor(bal / 0.04)} картинок gpt-image-2`,
  };
}

async function openrouter(cfg: AiConfig, id: string, p: AiProvider, signal: AbortSignal): Promise<QuotaInfo> {
  const r = await fetch("https://openrouter.ai/api/v1/key", { headers: authHeaders(cfg, p), signal });
  if (!r.ok) return { provider: id, level: "unknown", source: "", text: `не узнать: HTTP ${r.status}` };
  const d = ((await r.json()) as { data?: { limit_remaining?: number | null; usage_daily?: number; free_model_daily_requests?: { remaining?: number; limit?: number } } }).data ?? {};
  const parts: string[] = [];
  if (d.limit_remaining != null) parts.push(`осталось $${d.limit_remaining.toFixed(2)}`);
  if (d.free_model_daily_requests?.remaining != null) parts.push(`бесплатных запросов сегодня: ${d.free_model_daily_requests.remaining} из ${d.free_model_daily_requests.limit}`);
  if (d.usage_daily != null) parts.push(`потрачено сегодня $${d.usage_daily.toFixed(2)}`);
  return { provider: id, level: "ok", source: "по данным OpenRouter", text: parts.join(" · ") || "лимит у ключа не задан" };
}

/** Остальные: что сервис сказал в заголовках последнего ответа, плюс свой учёт. */
function fromHeaders(id: string): QuotaInfo {
  const own = ownUse(id);
  const mine = `сегодня: ${own.texts} запросов${own.images ? `, ${own.images} картинок` : ""}`;
  const h = lastHeaders(id)?.values;
  const left = h?.["x-ratelimit-remaining-requests"];
  const limit = h?.["x-ratelimit-limit-requests"];
  if (left != null) {
    const n = Number(left), of = Number(limit);
    return {
      provider: id,
      level: n === 0 ? "out" : of && n / of < 0.1 ? "low" : "ok",
      source: `по заголовкам последнего ответа (${new Date(lastHeaders(id)!.at).toLocaleTimeString("ru")})`,
      text: `осталось запросов: ${fmt(n)}${limit ? ` из ${fmt(of)}` : ""} · ${mine}`,
    };
  }
  return {
    provider: id, level: "unknown", source: "свой учёт",
    text: `остаток не известен · ${mine}`,
    hint: "Если сервис сообщает остаток (Groq, OpenRouter), он появится после первого запроса или «Проверить связь».",
  };
}

export async function quotaFor(cfg: AiConfig, id: string): Promise<QuotaInfo> {
  const p = cfg.providers[id];
  if (!p) return { provider: id, level: "unknown", source: "", text: "нет такого сервиса" };
  if (isLocal(p)) {
    // свой компьютер: лимита нет, есть только собственный учёт
    const own = ownUse(id);
    return { provider: id, level: "ok", source: "свой учёт", text: `без лимита · сегодня: ${own.images} картинок${own.texts ? `, ${own.texts} запросов` : ""}` };
  }
  if (!p.key) return { provider: id, level: "unknown", source: "", text: "ключ не задан" };
  const signal = AbortSignal.timeout(15_000);
  try {
    if (providerKind(p) === "cloudflare") return await cloudflare(cfg, id, p, signal);
    const host = new URL(p.base).hostname;
    if (host.endsWith("pollinations.ai")) return await pollinations(cfg, id, p, signal);
    if (host.endsWith("openrouter.ai")) return await openrouter(cfg, id, p, signal);
  } catch (e) {
    return { provider: id, level: "unknown", source: "", text: `не узнать: ${(e as Error).message}` };
  }
  return fromHeaders(id);
}

export async function allQuotas(cfg: AiConfig): Promise<QuotaInfo[]> {
  const ids = Object.keys(cfg.providers).filter((id) => !cfg.providers[id].disabled);
  return Promise.all(ids.map((id) => quotaFor(cfg, id)));
}

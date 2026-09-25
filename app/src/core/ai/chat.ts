// Текстовый запрос по очереди моделей (chain в providers.json). Все сервисы OpenAI-совместимые,
// различия — в мелочах, собранных в AGENTS.md: Groq без User-Agent отвечает 403, gemma без
// reasoning_effort=low тратит весь лимит на рассуждения, рассуждающим нужен большой max_tokens.

import { AiHttpError, coolDown, errorText, isCooling, shouldCool, splitRef, timeoutMs, withTimeout, type AiConfig } from "./config";
import { noteHeaders, noteUse } from "./usage";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  text: string;
  model: string;
  skipped: string[];
}

/** Рассуждающие модели иногда выводят размышления прямо в ответ — отрезаем их. */
function clean(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/** Температура по умолчанию: для деловых задач (сцена, подбор слов) — умеренная. */
const DEFAULT_TEMPERATURE = 0.8;

export async function chat(cfg: AiConfig, messages: ChatMessage[], signal?: AbortSignal, opts: { temperature?: number } = {}): Promise<ChatResult> {
  const chain = cfg.chain ?? [];
  if (!chain.length) throw new Error("в providers.json пустая очередь chain");
  const skipped: string[] = [];
  for (const ref of chain) {
    if (isCooling(ref)) {
      skipped.push(`${ref}: на паузе после сбоя`);
      continue;
    }
    const [provider, model] = splitRef(ref);
    const p = cfg.providers[provider];
    if (!p?.base || p.disabled) {
      skipped.push(`${ref}: ${!p ? "нет такого сервиса" : p.disabled ? "сервис выключен" : "не задан адрес"}`);
      continue;
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (p.key) headers.Authorization = `Bearer ${p.key}`;
    if (cfg.userAgent) headers["User-Agent"] = cfg.userAgent;
    let temperature = opts.temperature ?? DEFAULT_TEMPERATURE;
    // Z.ai принимает температуру только до 1 — выше отвечает 400, и сервис зря выбывает из очереди
    if (/z\.ai/.test(p.base)) temperature = Math.min(temperature, 1);
    const body: Record<string, unknown> = { model, messages, temperature, max_tokens: 4000, ...p.extraBody };
    if (model.includes("gemma")) body.reasoning_effort = "low";
    try {
      const r = await fetch(`${p.base.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        // локальная LM Studio медленная (~8 ток/с), облачные отвечают за секунды
        signal: withTimeout(signal, timeoutMs(p, 45_000)),
      });
      noteHeaders(provider, r.headers);
      if (!r.ok) throw new AiHttpError(r.status, `HTTP ${r.status}: ${await errorText(r)}`);
      const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
      const text = clean(j?.choices?.[0]?.message?.content ?? "");
      if (!text) throw new Error("пустой ответ");
      noteUse(ref, "text");
      return { text, model: ref, skipped };
    } catch (e) {
      if (signal?.aborted) throw new Error("отменено");
      if (shouldCool(cfg, e)) coolDown(cfg, ref);
      skipped.push(`${ref}: ${(e as Error).message}`);
    }
  }
  throw new Error(`ни одна текстовая модель не ответила. ${skipped.join(" · ")}`);
}

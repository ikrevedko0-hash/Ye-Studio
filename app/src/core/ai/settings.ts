// Настройки ИИ для окна: чтение без ключей, сохранение с сохранением всего, чего окно не знает.
//
// Ключ в окно не отдаём: только признак «есть» и последние четыре знака. Окно присылает ключ, лишь
// когда автор вписал новый (строка), или просит стереть (null); undefined — оставить как был.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { findAiConfig, providerKind, timeoutMs, type AiConfig, type AiProvider, type AiProviderKind } from "./config";
import { noteHeaders } from "./usage";

export interface ProviderEdit {
  id: string;
  title: string;
  kind: AiProviderKind;
  base: string;
  account?: string;
  models: string[];
  imageModels: string[];
  /** extraBody как текст JSON: окно его не разбирает, только показывает и правит. */
  extraBody: string;
  timeoutSec?: number;
  note?: string;
  disabled?: boolean;
  paid?: boolean;
  hasKey: boolean;
  /** «…a1b2» */
  keyHint: string;
  /** Только при сохранении: новый ключ (строка), стереть (null), не трогать (undefined). */
  key?: string | null;
}

export interface AiSettings {
  /** Файл, откуда прочитано (и куда запишется). null — файла ещё нет, создастся в папке приложения. */
  path: string | null;
  providers: ProviderEdit[];
  chain: string[];
  imageChain: string[];
  userAgent: string;
  cooldownMinutes: number;
}

/** Готовые заготовки известных сервисов: автору остаётся вписать ключ. */
export interface ProviderTemplate {
  id: string;
  title: string;
  kind: AiProviderKind;
  base: string;
  models: string[];
  imageModels: string[];
  paid?: boolean;
  extraBody?: Record<string, unknown>;
  note: string;
  /** Где взять ключ. */
  keyUrl?: string;
}

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  { id: "google", title: "Google AI Studio", kind: "openai", base: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: ["gemini-3-flash-preview", "gemini-flash-latest"], imageModels: [], note: "лучший русский; лимит маленький, часто 503", keyUrl: "https://aistudio.google.com/apikey" },
  { id: "groq", title: "Groq", kind: "openai", base: "https://api.groq.com/openai/v1",
    models: ["openai/gpt-oss-120b", "openai/gpt-oss-20b"], imageModels: [], note: "самый быстрый, ~1000 запросов в сутки", keyUrl: "https://console.groq.com/keys" },
  { id: "cloudflare", title: "Cloudflare Workers AI", kind: "cloudflare", base: "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT>/ai/v1",
    models: ["@cf/google/gemma-4-26b-a4b-it"], imageModels: ["@cf/black-forest-labs/flux-2-klein-9b", "@cf/leonardo/lucid-origin"],
    note: "10 000 нейронов в сутки бесплатно ≈ 8 картинок klein-9b; сброс в 00:00 UTC", keyUrl: "https://dash.cloudflare.com/profile/api-tokens" },
  { id: "zai", title: "Z.ai", kind: "openai", base: "https://api.z.ai/api/paas/v4",
    models: ["glm-4.7-flash"], imageModels: [], extraBody: { thinking: { type: "disabled" } }, note: "бесплатно; часто 429", keyUrl: "https://z.ai/manage-apikey/apikey-list" },
  { id: "openrouter", title: "OpenRouter", kind: "openai", base: "https://openrouter.ai/api/v1",
    models: [], imageModels: [], note: "бесплатные модели с суффиксом :free, 50 запросов в сутки", keyUrl: "https://openrouter.ai/keys" },
  { id: "pollinations", title: "Pollinations", kind: "openai", base: "https://gen.pollinations.ai/v1",
    models: [], imageModels: ["openai/gpt-image-2"], paid: true, note: "платно за pollen; gpt-image-2 ≈ 0,04 pollen", keyUrl: "https://enter.pollinations.ai" },
  { id: "lmstudio", title: "LM Studio (локально)", kind: "openai", base: "http://127.0.0.1:1234/v1",
    models: [], imageModels: [], note: "бесплатно, без лимитов, медленно" },
  { id: "sdcpp", title: "Своя видеокарта (sd-server)", kind: "openai", base: "http://127.0.0.1:7861/v1",
    models: [], imageModels: ["sd-cpp-local"], note: "бесплатно, без лимитов, ~15 с на картинку; автозапуск — поле launch в providers.json" },
  { id: "custom", title: "Свой OpenAI-совместимый", kind: "openai", base: "https://",
    models: [], imageModels: [], note: "" },
];

function hint(key?: string): string {
  return key ? `…${key.slice(-4)}` : "";
}

export async function readSettings(baseDir: string): Promise<AiSettings> {
  const found = await findAiConfig(baseDir);
  const cfg: AiConfig = found?.cfg ?? { providers: {} };
  return {
    path: found?.path ?? null,
    providers: Object.entries(cfg.providers).map(([id, p]) => ({
      id,
      title: p.title ?? id,
      kind: providerKind(p),
      base: p.base ?? "",
      account: p.account,
      models: p.models ?? [],
      imageModels: p.imageModels ?? [],
      extraBody: p.extraBody ? JSON.stringify(p.extraBody) : "",
      timeoutSec: p.timeoutSec,
      note: p.note,
      disabled: p.disabled,
      paid: p.paid,
      hasKey: !!p.key,
      keyHint: hint(p.key),
    })),
    chain: cfg.chain ?? [],
    imageChain: cfg.imageChain ?? [],
    userAgent: cfg.userAgent ?? "siq-workshop/0.1 (+personal quiz pack tool)",
    cooldownMinutes: cfg.cooldownMinutes ?? 10,
  };
}

/** Проверить правку до записи: ошибки понятные, по-русски, с названием сервиса. */
function validate(s: AiSettings): void {
  const ids = new Set<string>();
  for (const p of s.providers) {
    if (!/^[a-z0-9_-]+$/i.test(p.id)) throw new Error(`имя сервиса «${p.id}»: только латиница, цифры, - и _`);
    if (ids.has(p.id)) throw new Error(`сервис «${p.id}» встречается дважды`);
    ids.add(p.id);
    if (!/^https?:\/\//.test(p.base)) throw new Error(`«${p.title}»: адрес должен начинаться с http:// или https://`);
    if (p.kind === "cloudflare" && !p.account?.trim()) throw new Error(`«${p.title}»: для Cloudflare нужен номер аккаунта (Account ID)`);
    if (p.extraBody.trim()) {
      try { JSON.parse(p.extraBody); } catch { throw new Error(`«${p.title}»: дополнительные поля — не JSON`); }
    }
  }
}

/**
 * Записать правку. Поля файла, которых окно не касается (комментарии, retryOnStatus, будущие
 * настройки), переносятся как были — у каждого сервиса и у файла в целом.
 */
export async function writeSettings(baseDir: string, s: AiSettings): Promise<AiSettings> {
  validate(s);
  const found = await findAiConfig(baseDir);
  const old: AiConfig = found?.cfg ?? { providers: {} };
  const path = found?.path ?? join(baseDir, "providers.json");

  const providers: Record<string, AiProvider> = {};
  for (const e of s.providers) {
    const prev = old.providers[e.id] ?? ({} as AiProvider);
    const p: AiProvider = { ...prev, title: e.title, kind: e.kind, base: e.base.trim() };
    if (e.key === null) delete p.key;
    else if (typeof e.key === "string" && e.key.trim()) p.key = e.key.trim();
    // Cloudflare: номер аккаунта нужен и для картинок, и в адресе текстового входа
    if (e.kind === "cloudflare") {
      p.account = e.account!.trim();
      p.base = p.base.replace("<ACCOUNT>", p.account);
    } else delete p.account;
    p.models = e.models.map((m) => m.trim()).filter(Boolean);
    p.imageModels = e.imageModels.map((m) => m.trim()).filter(Boolean);
    if (e.extraBody.trim()) p.extraBody = JSON.parse(e.extraBody);
    else delete p.extraBody;
    for (const k of ["timeoutSec", "note", "disabled", "paid"] as const) {
      const v = e[k];
      if (v === undefined || v === "" || v === false || v === 0) delete p[k];
      else (p as unknown as Record<string, unknown>)[k] = v;
    }
    providers[e.id] = p;
  }
  // из очередей убираем то, что ссылается на удалённые сервисы
  const alive = (ref: string) => providers[ref.slice(0, ref.indexOf(":"))] !== undefined;
  const cfg: AiConfig = {
    ...old,
    userAgent: s.userAgent.trim() || undefined,
    cooldownMinutes: s.cooldownMinutes || 10,
    providers,
    chain: s.chain.filter(alive),
    imageChain: s.imageChain.filter(alive),
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(cfg, null, 2));
  return readSettings(baseDir);
}

/**
 * Проверка связи: есть текстовая модель — крошечный запрос к ней (заодно приходят заголовки
 * с лимитами), нет — список моделей. Картинку не рисуем: это тратит лимит.
 */
export async function testProvider(baseDir: string, id: string): Promise<string> {
  const found = await findAiConfig(baseDir);
  const p = found?.cfg.providers[id];
  if (!p) throw new Error("сначала сохраните настройки");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (p.key) headers.Authorization = `Bearer ${p.key}`;
  if (found.cfg.userAgent) headers["User-Agent"] = found.cfg.userAgent;
  const signal = AbortSignal.timeout(timeoutMs(p, 30_000));
  const t0 = Date.now();
  const sec = () => ((Date.now() - t0) / 1000).toFixed(1);

  if (p.models?.length) {
    const model = p.models[0];
    const body: Record<string, unknown> = { model, messages: [{ role: "user", content: "Ответь одним словом: да" }], max_tokens: 400, ...p.extraBody };
    if (model.includes("gemma")) body.reasoning_effort = "low";
    const r = await fetch(`${p.base.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), signal });
    noteHeaders(id, r.headers);
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 300)}`);
    const answer = (JSON.parse(text) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content?.trim();
    return `${model} ответила за ${sec()} с: «${(answer || "пусто").slice(0, 40)}»`;
  }
  const url = providerKind(p) === "cloudflare"
    ? `https://api.cloudflare.com/client/v4/accounts/${p.account}/ai/models/search?per_page=1`
    : `${p.base.replace(/\/$/, "")}/models`;
  const r = await fetch(url, { headers, signal });
  noteHeaders(id, r.headers);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return `связь есть, ключ принят (${sec()} с)`;
}

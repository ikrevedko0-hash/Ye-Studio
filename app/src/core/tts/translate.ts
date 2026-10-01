// Перевод фразы для вопроса: собираем сообщения для модели и разбираем её ответ на варианты.
// Модель на 4-8 млрд параметров переводит средне, поэтому просим сразу три варианта — автор выберет и поправит.

import type { ChatMessage } from "../ai/chat";
import { isLocal, type AiConfig } from "../ai/config";
import { targetById } from "./languages";

export type TranslateStage = { kind: "cloud" | "local"; chain: string[] } | { kind: "own" };

/**
 * В каком порядке пробовать переводчиков. Замер на латыни (30.09): Gemini 3 Flash ≈ эталон, Groq — неплохо,
 * своя Qwen3-4B/8B — плохо и минуту грузится. Поэтому облако (если разрешено) — первым, в порядке общей
 * очереди providers.json; потом локальные сервисы (LM Studio и т. п.); своя модель — последней.
 * skipId — наш sd-server картинок, он текст не переводит.
 */
export function translateStages(cfg: AiConfig | null, allowCloud: boolean, hasOwn: boolean, skipId: string): TranslateStage[] {
  const stages: TranslateStage[] = [];
  if (cfg) {
    const usable = (id: string) => { const p = cfg.providers[id]; return !!p && !p.disabled && id !== skipId; };
    if (allowCloud) {
      const cloud = (cfg.chain ?? []).filter((ref) => { const id = ref.slice(0, ref.indexOf(":")); return usable(id) && !isLocal(cfg.providers[id]); });
      if (cloud.length) stages.push({ kind: "cloud", chain: cloud });
    }
    const local: string[] = [];
    for (const [id, p] of Object.entries(cfg.providers)) {
      if (!usable(id) || !isLocal(p)) continue;
      for (const m of p.models ?? []) local.push(`${id}:${m}`);
    }
    if (local.length) stages.push({ kind: "local", chain: local });
  }
  if (hasOwn) stages.push({ kind: "own" });
  return stages;
}

export const VARIANTS = 3;

/** Замер 30.09: модели путают cunnus/mentula и падежи — подсказываем классическую лексику (Катулл, Марциал). */
const LATIN_HINT =
  " Use classical Latin with correct case endings and word order. For obscene words use the classical vocabulary: " +
  "хуй = mentula, пизда = cunnus, жопа = culus, ебать = futuere, срать = cacare, блядь = meretrix/scortum.";

const OUTPUT_RULES =`Give exactly ${VARIANTS} different variants, each on its own line. No numbering, no bullets, no quotes, no explanations, nothing else.`;

/** custom — инструкция автора по-русски («язык Йоды», «канцелярит», «гопник»). */
export function buildTranslateMessages(text: string, target: string, custom = ""): ChatMessage[] {
  const t = targetById(target);
  let system: string;
  if (t.id === "custom") {
    system =
      `You are a writer for a party quiz. Rewrite the user's Russian phrase in this style: "${custom.trim() || "as is"}". ` +
      `Keep the meaning, keep rudeness and profanity if there is any, keep it short. The result stays in Russian unless the style says otherwise. ${OUTPUT_RULES} /no_think`;
  } else if (t.id === "none") {
    system = `You are an editor for a party quiz. Repeat the user's phrase as is. ${OUTPUT_RULES} /no_think`;
  } else {
    system =
      `You are a translator for a party quiz for adults. Translate the user's Russian phrase into ${t.promptName}. ` +
      `Keep the meaning literal, keep rudeness and profanity (do not soften them), keep it short.` +
      (t.id === "la" ? LATIN_HINT : "") +
      ` ${OUTPUT_RULES} /no_think`;
  }
  return [
    { role: "system", content: system },
    { role: "user", content: text.trim() },
  ];
}

/** Нумерация, маркеры и подписи «Variant 1:» в начале строки. */
const LEAD = /^\s*(?:(?:variant|option|вариант)\s*\d*\s*[:.)\-–—]\s*|\d{1,2}\s*[.)]\s+|[-*•–—]\s+)/i;
/** Кавычки вокруг всей строки. */
const QUOTES: [string, string][] = [["«", "»"], ['"', '"'], ["“", "”"], ["„", "“"], ["'", "'"]];

function unquote(s: string): string {
  for (const [a, b] of QUOTES) {
    if (s.length >= 2 && s.startsWith(a) && s.endsWith(b) && !s.slice(1, -1).includes(a)) return s.slice(1, -1).trim();
  }
  return s;
}

/** Кириллица, похожая на латиницу: модели (Groq, 30.09) пишут «ebriа» с русской «а». */
const LOOKALIKE: Record<string, string> = {
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", і: "i", к: "k", м: "m", т: "t", в: "b", н: "h",
  А: "A", Е: "E", О: "O", Р: "P", С: "C", У: "Y", Х: "X", І: "I", К: "K", М: "M", Т: "T", В: "B", Н: "H",
};

/** В словах, где латиница смешана с кириллицей, кириллицу-двойника меняем на латиницу; чисто русские слова не трогаем. */
export function fixMixedScript(s: string): string {
  return s.replace(/\p{L}+/gu, (w) => (/[a-z]/i.test(w) && /[Ѐ-ӿ]/.test(w) ? w.replace(/[Ѐ-ӿ]/g, (ch) => LOOKALIKE[ch] ?? ch) : w));
}

/** Долготы и кратки латыни (culō, sentīo) — прочь: на экране вопроса и для итальянского голоса они лишние. */
export function stripLatinMarks(s: string): string {
  return s.normalize("NFD").replace(/[\u0304\u0306]/g, "").normalize("NFC");
}

/** Ответ модели → до трёх различных строк. Скобки и тире внутри строки не трогаем: это может быть сам перевод. */
export function parseVariants(raw: string, target = ""): string[] {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<\/?think>/gi, "");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    let s = line.trim();
    if (!s) continue;
    s = s.replace(LEAD, "").trim();
    s = fixMixedScript(unquote(s));
    if (target === "la") s = stripLatinMarks(s);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= VARIANTS) break;
  }
  return out;
}

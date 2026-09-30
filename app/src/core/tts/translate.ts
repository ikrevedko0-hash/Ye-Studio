// Перевод фразы для вопроса: собираем сообщения для модели и разбираем её ответ на варианты.
// Модель на 4-8 млрд параметров переводит средне, поэтому просим сразу три варианта — автор выберет и поправит.

import type { ChatMessage } from "../ai/chat";
import { targetById } from "./languages";

export const VARIANTS = 3;

const OUTPUT_RULES = `Give exactly ${VARIANTS} different variants, each on its own line. No numbering, no bullets, no quotes, no explanations, nothing else.`;

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
      `You are a translator for a party quiz. Translate the user's Russian phrase into ${t.promptName}. ` +
      `Keep the meaning literal, keep rudeness and profanity, keep it short. ${OUTPUT_RULES} /no_think`;
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

/** Ответ модели → до трёх различных строк. Скобки и тире внутри строки не трогаем: это может быть сам перевод. */
export function parseVariants(raw: string): string[] {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<\/?think>/gi, "");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    let s = line.trim();
    if (!s) continue;
    s = s.replace(LEAD, "").trim();
    s = unquote(s);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= VARIANTS) break;
  }
  return out;
}

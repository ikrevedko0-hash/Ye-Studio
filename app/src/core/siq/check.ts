// «Проверить перед публикацией»: всё, на что пак споткнётся в SIGame или на FirePacks / SIBrowser, одним списком.
// Пороги: SIBrowser принимает до 100 МБ, сервер игры — около 150 МБ (сообщения игроков в обсуждениях SIGame
// в Steam); спецвопросов > 5% — жёлтая плашка FirePacks, > 15% — красная.

import { packLogo } from "./board";
import { allItems, isAnswerOptions, isPointQuestion, isRef, itemKind, questionItems, slotStatus } from "./helpers";
import { MEDIA_FOLDERS, type Package } from "./model";
import { unusedMedia, type SizedMedia } from "./packSize";

export type CheckLevel = "error" | "warn" | "info";

export interface CheckIssue {
  level: CheckLevel;
  text: string;
  /** Где исправлять: вопрос (или тема/раунд без question). */
  at?: { round: number; theme?: number; question?: number };
}

const MB = 1048576;
export const LIMITS = { siBrowserMb: 100, gameMb: 150, heavyImageMb: 1, heavyAudioMb: 3, heavyVideoMb: 15 };

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function checkPack(pkg: Package, media: SizedMedia[]): CheckIssue[] {
  const out: CheckIssue[] = [];
  const name = pkg.attrs.find(([k]) => k === "name")?.[1]?.trim();
  if (!name) out.push({ level: "error", text: "У пака нет названия" });

  // ---------- объём ----------
  const total = media.reduce((s, m) => s + m.size, 0) / MB;
  if (total > LIMITS.gameMb) out.push({ level: "error", text: `Пак весит ${total.toFixed(0)} МБ — сервер SIGame берёт около ${LIMITS.gameMb} МБ, SIBrowser — ${LIMITS.siBrowserMb} МБ` });
  else if (total > LIMITS.siBrowserMb) out.push({ level: "warn", text: `Пак весит ${total.toFixed(0)} МБ — SIBrowser и FirePacks принимают до ${LIMITS.siBrowserMb} МБ` });

  // ---------- файлы ----------
  const have = new Set(media.map((m) => `${m.folder}/${m.name}`));
  const logo = packLogo(pkg);
  if (!logo) out.push({ level: "info", text: "Нет логотипа пака — на FirePacks и в игре будет пустая карточка" });
  else if (!have.has(`Images/${logo}`)) out.push({ level: "error", text: `Логотип «${logo}» указан, но файла в паке нет` });
  if (!pkg.info?.authors?.some((a) => a.trim())) out.push({ level: "info", text: "Не указаны авторы пака" });

  const unused = unusedMedia(pkg, media);
  if (unused.length) {
    const mb = unused.reduce((s, m) => s + m.size, 0) / MB;
    out.push({ level: "info", text: `Без дела лежит файлов: ${unused.length} (${mb.toFixed(1)} МБ) — убрать можно в «Объёме пака»` });
  }
  const heavy: [string, number][] = [["Images", LIMITS.heavyImageMb], ["Audio", LIMITS.heavyAudioMb], ["Video", LIMITS.heavyVideoMb]];
  for (const [folder, limit] of heavy) {
    const big = media.filter((m) => m.folder === folder && m.size > limit * MB);
    if (big.length) out.push({ level: "info", text: `Тяжёлые файлы в ${folder} (больше ${limit} МБ): ${big.slice(0, 4).map((m) => m.name).join(", ")}${big.length > 4 ? ` и ещё ${big.length - 4}` : ""}` });
  }

  // ---------- вопросы ----------
  let questions = 0, specials = 0;
  const answers = new Map<string, { round: number; theme: number; question: number }[]>();
  (pkg.rounds ?? []).forEach((r, ri) => {
    const rn = r.name || `Раунд ${ri + 1}`;
    if (!r.themes?.length) out.push({ level: "error", text: `В раунде «${rn}» нет тем`, at: { round: ri } });
    (r.themes ?? []).forEach((t, ti) => {
      const where = `${rn} › ${t.name || `тема ${ti + 1}`}`;
      if (!t.name?.trim()) out.push({ level: "error", text: `${where}: у темы нет названия`, at: { round: ri, theme: ti } });
      if (!t.questions?.length) out.push({ level: "error", text: `${where}: в теме нет вопросов`, at: { round: ri, theme: ti } });
      (t.questions ?? []).forEach((q, qi) => {
        questions++;
        if (q.type && q.type !== "simple") specials++;
        const at = { round: ri, theme: ti, question: qi };
        const label = `${where} · ${q.price}`;
        const st = slotStatus(q);
        const hasContent = questionItems(q).some((i) => i.value.trim() !== "");
        if (st === "empty") out.push({ level: "error", text: `${label}: пустой вопрос`, at });
        else if (st === "draft") out.push({ level: "error", text: `${label}: ${hasContent ? "нет ответа" : "нет самого вопроса"}`, at });
        // ответы-буквы (варианты) и точки на картинке повторяются законно
        if (!isAnswerOptions(q) && !isPointQuestion(q)) {
          const a = norm(q.right[0] ?? "");
          if (a) answers.set(a, [...(answers.get(a) ?? []), at]);
        }
      });
    });
  });

  // ---------- ссылки на файлы ----------
  const missing = new Set<string>();
  for (const { item } of allItems(pkg)) {
    if (!isRef(item) || !item.value) continue;
    const key = `${MEDIA_FOLDERS[itemKind(item)]}/${item.value}`;
    if (!have.has(key)) missing.add(key);
  }
  for (const m of missing) out.push({ level: "error", text: `Вопрос ссылается на файл, которого нет в паке: ${m}` });

  for (const [a, where] of answers) {
    if (where.length > 1) out.push({ level: "warn", text: `Один и тот же ответ «${a}» в ${where.length} вопросах`, at: where[1] });
  }

  const share = questions ? Math.round((specials / questions) * 100) : 0;
  if (share > 15) out.push({ level: "warn", text: `Спецвопросов ${share}% — FirePacks повесит красную плашку (больше 15%)` });
  else if (share > 5) out.push({ level: "info", text: `Спецвопросов ${share}% — FirePacks повесит жёлтую плашку (больше 5%)` });

  const order: Record<CheckLevel, number> = { error: 0, warn: 1, info: 2 };
  return out.sort((x, y) => order[x.level] - order[y.level]);
}

// Текст поста ВКонтакте для окна «📣 Публикация». Чистая функция — без DOM и Electron,
// чтобы её можно было проверить тестами и не тянуть в неё окно.

import { packStats } from "./helpers";
import { getAttr, type Package, type Round } from "./model";

export interface VkPostOptions {
  /** Сколько символов комментария к паку включать (по умолчанию 500). */
  commentLimit?: number;
}

/** Финал подписываем словом «Финал» — своё имя раунда (обычно «ФИНАЛ» капсом) в посте не нужно. */
function roundTitle(r: Round, i: number): string {
  if (r.type === "final") return "Финал";
  return r.name?.trim() || `Раунд ${i + 1}`;
}

/** Тег пака → хэштег ВК: пробелы в «_», всё, кроме букв/цифр/«_», убирается. */
function tagToHashtag(tag: string): string {
  return tag.trim().replace(/\s+/g, "_").replace(/[^\p{L}\p{N}_]/gu, "");
}

/**
 * Готовый текст поста ВК (обычный текст — ВК не понимает markdown). Пустые/служебные темы
 * (без названия) пропускаются, вопросы не выводятся — пост не должен палить содержимое пака.
 */
export function buildVkPost(pkg: Package, opts: VkPostOptions = {}): string {
  const commentLimit = opts.commentLimit ?? 500;
  const name = getAttr(pkg, "name")?.trim() || "Без названия";
  const authors = (pkg.info?.authors ?? []).map((a) => a.trim()).filter(Boolean);
  const stats = packStats(pkg);

  const header = [`📦 ${name}`];
  if (authors.length) header.push(`✍️ Автор(ы): ${authors.join(", ")}`);
  header.push(`🎯 Раундов: ${stats.rounds} · тем: ${stats.themes} · вопросов: ${stats.questions}`);

  const roundBlocks = (pkg.rounds ?? []).map((r, i) => {
    const themes = (r.themes ?? []).map((t) => t.name.trim()).filter((n) => n !== "");
    return [`${roundTitle(r, i)}:`, ...themes.map((t) => `• ${t}`)].join("\n");
  });

  const comment = pkg.info?.comments?.trim();
  const commentBlock = comment ? comment.slice(0, commentLimit) : undefined;

  const tags = (pkg.tags ?? []).map(tagToHashtag).filter(Boolean);
  const hashtags = ["#свояк", "#sigame", "#своя_игра", ...tags.map((t) => `#${t}`)].join(" ");
  const tagsBlock = [hashtags, "Сделано в Ye!Studio"].join("\n");

  const blocks = [header.join("\n"), ...roundBlocks, commentBlock, tagsBlock].filter((b): b is string => !!b);
  return blocks.join("\n\n");
}

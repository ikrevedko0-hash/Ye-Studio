// Текст поста ВКонтакте для окна «📣 Публикация». Чистая функция — без DOM и Electron,
// чтобы её можно было проверить тестами и не тянуть в неё окно.

import { getAttr, type Package } from "./model";

/** Номер из названия «Уе!пак №N» — тот же разбор, что у страницы отзывов (server/reviews/autopublish.py). */
const YE_PACK_NO = /^\s*Уе!\s*пак\s*№\s*(\d{1,3})\b/i;

/** Страница отзывов пака: у «Уе!пак №N» — своя (уепак.рф/N), у остальных — общая. */
export function reviewsUrl(name: string): string {
  const n = YE_PACK_NO.exec(name)?.[1];
  return n ? `уепак.рф/${Number(n)}` : "уепак.рф";
}

/** Тег пака → хэштег ВК: пробелы в «_», всё, кроме букв/цифр/«_», убирается. */
function tagToHashtag(tag: string): string {
  return tag.trim().replace(/\s+/g, "_").replace(/[^\p{L}\p{N}_]/gu, "");
}

/**
 * Готовый текст поста ВК (обычный текст — ВК не понимает markdown). Коротко и по-человечески:
 * название, авторы, приглашение и просьба об отзыве. Темы автор решил не перечислять —
 * длинный список отпугивал, а темы и так видны на афише.
 */
export function buildVkPost(pkg: Package): string {
  const name = getAttr(pkg, "name")?.trim() || "Без названия";
  const authors = (pkg.info?.authors ?? []).map((a) => a.trim()).filter(Boolean);

  const header = [`📦 ${name}`];
  if (authors.length) header.push(`✍️ Автор(ы): ${authors.join(", ")}`);

  const invite = [
    "Приятной игры! 🎉",
    "Пак протестирован на живых людях. Играть лучше с фальстартами и ведущим-человеком.",
  ].join("\n");

  const reviews = [
    `💬 Сыграли? Загляните на ${reviewsUrl(name)} и расскажите, как вам пак.`,
    "Читаем каждый отзыв — по ним делаем следующие паки ❤️",
  ].join("\n");

  const tags = (pkg.tags ?? []).map(tagToHashtag).filter(Boolean);
  const hashtags = ["#свояк", "#sigame", "#своя_игра", ...tags.map((t) => `#${t}`)].join(" ");
  const tagsBlock = [hashtags, "Сделано в Ye!Studio"].join("\n");

  return [header.join("\n"), invite, reviews, tagsBlock].join("\n\n");
}

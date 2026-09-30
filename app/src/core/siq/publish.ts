// Текст поста ВКонтакте для окна «📣 Публикация». Чистая функция — без DOM и Electron,
// чтобы её можно было проверить тестами и не тянуть в неё окно.

import { packStats } from "./helpers";
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

// ---------- описание пака (FirePacks, тема ВК SIGame, Steam Workshop) ----------

export interface PackCardOptions {
  /** Предупредить о чёрном/взрослом юморе — топ-паки честно отсеивают «не свою» публику. */
  humorWarning?: boolean;
  /** Ссылка на пак в Steam Workshop, если автор его туда выложил. */
  steamUrl?: string;
}

/**
 * Секунд на вопрос с чтением, медиа и спорами. Замер по топу FirePacks: 150–152 вопроса
 * у «Солянок» GoldensFire авторы сами оценивают в ~1,5 ч.
 */
const SECONDS_PER_QUESTION = 36;

/** difficulty пака (SIQuester пишет 1–10) → метка, как в описаниях топ-паков. */
export function difficultyLabel(difficulty: number | undefined): string | undefined {
  if (!difficulty || !Number.isFinite(difficulty)) return undefined;
  if (difficulty <= 3) return "🟢 Легко";
  if (difficulty <= 6) return "🟡 Нормально";
  return "🔴 Сложно";
}

/** 134 вопроса → «~1,5 ч»: полчаса — шаг, меньше получаса не пишем. */
export function playTimeLabel(questions: number): string {
  const halves = Math.max(1, Math.round((questions * SECONDS_PER_QUESTION) / 1800));
  return `~${String(halves / 2).replace(".", ",")} ч`;
}

/**
 * Описание пака для каталога: у топ-паков оно в одном узнаваемом шаблоне — пара строк о паке,
 * [сложность] [время] [число вопросов], как играть, ссылки. Комментарий к паку — первой строкой.
 */
export function buildPackCard(pkg: Package, opts: PackCardOptions = {}): string {
  const stats = packStats(pkg);
  const questions = stats.questions - stats.empty;
  const about = pkg.info?.comments?.trim();

  const intro: string[] = [];
  if (about) intro.push(about);
  if (opts.humorWarning) intro.push("⚠️ В паке есть чёрный и взрослый юмор — кому такое не заходит, лучше выбрать другой пак.");

  const facts: string[] = [];
  const level = difficultyLabel(Number(getAttr(pkg, "difficulty")));
  if (level) facts.push(`[Уровень сложности: ${level}]`);
  facts.push(`[Время прохождения: ${playTimeLabel(questions)}]`);
  facts.push(`[Число вопросов: ${questions}]`);
  const age = getAttr(pkg, "restriction")?.trim();
  if (age) facts.push(`[Возраст: ${age}]`);

  const how = "Играть лучше с фальстартами и ведущим-человеком. Если плохо грузит медиа — играйте через браузер.";

  const name = getAttr(pkg, "name")?.trim() || "";
  const links = [`💬 Отзывы и оценки: ${reviewsUrl(name)}`];
  if (opts.steamUrl?.trim()) links.push(`Steam: ${opts.steamUrl.trim()}`);

  return [intro.join("\n"), facts.join("\n"), how, links.join("\n")].filter(Boolean).join("\n\n");
}

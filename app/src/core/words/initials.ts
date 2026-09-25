// Инициалы названий: «Сильвестр Сталлоне» → С.С., «C. C. Catch» → С.С., «XXXTentacion» → Х.Х.Х.Т.
//
// Приём из паков автора: тема «Н.Н.», а в ответах и Нижний Новгород, и Helly Hansen.
// Латинская H и русская Н для игрока — одна буква, поэтому буквы сравниваются по виду,
// а не по коду символа. По звуку не сравниваем нарочно: Sylvester Stallone на «С.С.» не тянет,
// его туда приводит русское написание.

/** Латинские буквы, неотличимые от русских. Всё, чего здесь нет, остаётся самим собой. */
const TWINS: Record<string, string> = {
  A: "А", B: "В", C: "С", E: "Е", H: "Н", K: "К", M: "М", O: "О", P: "Р", T: "Т", X: "Х", Y: "У",
  Ё: "Е",
};

/** Латинский двойник русской буквы, если он есть: «Н» → «H». Для подписи в списке букв. */
export function latinTwin(ru: string): string | undefined {
  return Object.keys(TWINS).find((k) => /[A-Z]/.test(k) && TWINS[k] === ru);
}

/** Буква в «облике»: заглавная, латинский двойник заменён русским. */
export function shape(ch: string): string {
  const up = ch.toUpperCase();
  return TWINS[up] ?? up;
}

/**
 * Служебные слова не дают инициала: «наступать на грабли» — это Н.Г., а не Н.Н.Г.,
 * иначе любая фраза с предлогом «на» попадала бы в «Н.Н.».
 */
const FUNCTION_WORDS = new Set([
  // русские предлоги, союзы, частицы
  "в", "во", "на", "с", "со", "и", "а", "но", "к", "ко", "о", "об", "обо", "от", "по", "до", "из", "за", "у",
  "для", "при", "без", "над", "под", "про", "через", "или", "не", "ни", "же", "ли", "бы", "то",
  // частицы в именах: «Леонардо да Винчи», «Людвиг ван Бетховен»
  "да", "де", "ди", "дю", "дель", "ван", "фон", "дер", "ла", "ле", "эль", "аль", "бен", "ибн",
  // английские и прочие
  "the", "of", "and", "a", "an", "&", "de", "da", "di", "del", "du", "la", "le", "van", "von", "der", "den",
  "y", "e", "et", "und", "zu", "el", "al", "in", "on", "at", "for", "to", "or",
]);

/**
 * Разбить название на значимые слова. Разрезаем по пробелам, дефисам, точкам и косым чертам
 * («Кока-Кола» → К.К., «C.C.Catch» → C.C.C), а внутри слова — по стыку строчной и заглавной
 * («PayPal» → P.P.). Повтор одной заглавной в начале («XXXTentacion», «ZZ Top») — это отдельные
 * буквы-слова: автор числит XXXTentacion в «Х.Х.».
 */
export function nameWords(name: string): string[] {
  const clean = name
    .replace(/\s*\([^)]*\)\s*/g, " ") // уточнение Википедии: «Меркурий (планета)»
    .replace(/[«»"“”„'’`!?]/g, "")
    .trim();
  const out: string[] = [];
  for (const raw of clean.split(/[\s\-‐–—./\\,:;+&]+/)) {
    if (!raw) continue;
    // повтор одной заглавной в начале: XXXTentacion → X X X Tentacion, «ZZ» → Z Z.
    // Если за повтором идёт строчная («LLama»), последняя заглавная начинает слово сама.
    // Римская цифра сама по себе — одно слово: иначе «XX век» попадал бы в «Х.Х.».
    const rep = /^([A-ZА-ЯЁ])\1+/.exec(raw);
    let rest = raw;
    if (rep && !/^[IVXLCDM]+$/.test(raw)) {
      const next = raw[rep[0].length];
      const n = next === undefined || /[A-ZА-ЯЁ]/.test(next) ? rep[0].length : rep[0].length - 1;
      for (let i = 0; i < n; i++) out.push(raw[i]);
      rest = raw.slice(n);
    }
    // стык строчной и заглавной: PayPal, CocaCola, ВКонтакте не режем (там две заглавные подряд)
    for (const part of rest.split(/(?<=[a-zа-яё])(?=[A-ZА-ЯЁ])/)) if (part) out.push(part);
  }
  return out.filter((w, i) => /[\p{L}]/u.test(w) && !isFunctionWord(w, i));
}

/**
 * Служебное слово пишется со строчной: «Леонардо да Винчи», «наступать на грабли».
 * С заглавной это чаще инициал или часть имени — «A. A. Milne», «Van Halen», — и его не трогаем.
 * Исключение — артикль в начале: «The Beatles» — это Б., а не Т.Б.
 */
function isFunctionWord(w: string, i: number): boolean {
  if (w === w.toLowerCase()) return FUNCTION_WORDS.has(w);
  return i === 0 && /^(The|Der|Die|Das|Le|La|Les|El|Los|Las)$/.test(w);
}

/** Инициалы в облике: «Нижний Новгород» → «НН», «Helly Hansen» → «НН». */
export function initialsOf(name: string): string {
  return nameWords(name)
    .map((w) => shape([...w].find((c) => /\p{L}/u.test(c)) ?? ""))
    .join("");
}

/** Буквы от автора в любом виде — «С.С.», «cc», «Н Н» — в облике: «СС». */
export function normalizeLetters(input: string): string {
  return [...input].filter((c) => /\p{L}/u.test(c)).map(shape).join("");
}

export type InitialsWhere = "exact" | "start" | "any";

export const WHERE_TITLE: Record<InitialsWhere, string> = {
  exact: "ровно",
  start: "в начале",
  any: "внутри",
};

/**
 * Подходит ли название под буквы. Возвращает, где именно они стоят, чтобы лучшие совпадения
 * (всё название ровно из этих букв) шли первыми, а «датчик холостого хода» — после.
 */
export function matchInitials(name: string, letters: string, where: InitialsWhere): InitialsWhere | undefined {
  return matchLetters(initialsOf(name), letters, where);
}

/** То же по готовым инициалам: в наборе они посчитаны заранее, пересчитывать 30 тысяч названий незачем. */
export function matchLetters(ini: string, letters: string, where: InitialsWhere): InitialsWhere | undefined {
  if (ini.length < 2 || !letters) return undefined;
  if (ini === letters) return "exact";
  if (where === "exact") return undefined;
  if (ini.startsWith(letters)) return "start";
  if (where === "start") return undefined;
  return ini.includes(letters) ? "any" : undefined;
}

/** Совпала ли буква только благодаря латинскому двойнику — такие находки самые игровые. */
export function viaTwin(name: string): boolean {
  return nameWords(name).some((w) => /^[A-Za-z]/.test(w) && TWINS[w[0].toUpperCase()] !== undefined);
}

/**
 * Есть ли в названии два одинаковых инициала подряд, похожих на русскую букву, — только такие
 * записи храним в наборе. «Newport News» (N.N.) и «Duran Duran» (D.D.) ни к одной русской букве
 * не приводятся, а место занимали: без них набор меньше на треть.
 */
export function hasDoubled(name: string): boolean {
  const ini = initialsOf(name);
  for (let i = 1; i < ini.length; i++) if (ini[i] === ini[i - 1] && /[А-ЯЁ]/.test(ini[i])) return true;
  return false;
}

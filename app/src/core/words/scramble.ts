// Перемешивание букв: из «Красноярск» получить «ксряонсарк».
//
// Это не поиск анаграмм в словаре. Задача обратная: испортить слово так, чтобы его было
// трудно узнать, но возможно разгадать. Плохая перестановка выдаёт слово сразу:
//   «Красноярск» → «Красноякрс» — целый кусок исходника читается, и всё понятно;
//   «Красноярск» → «Красноярск» — буквы вернулись на свои места.
//
// Поэтому перестановка не случайная, а отобранная: пробуем много вариантов и берём худший
// для отгадывающего. Признаки, по которым считаем сложность, — в score().

/** Простой генератор случайных чисел с зерном: одно и то же слово даёт один и тот же результат. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function seedOf(text: string): number {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const VOWELS = new Set([..."аеёиоуыэюя"]);

/** Длина самого длинного общего куска — главный признак «слишком легко». */
export function longestCommonChunk(a: string, b: string): number {
  let best = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
      if (k > best) best = k;
    }
  }
  return best;
}

/** Сколько букв осталось на своём месте. Ноль — то, что нужно. */
export function fixedPoints(a: string, b: string): number {
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] === b[i]) n++;
  return n;
}

/** Самая длинная череда согласных: «кстрмн» читать невозможно, такое сразу видно как набор букв. */
function worstConsonantRun(w: string): number {
  let run = 0;
  let best = 0;
  for (const ch of w) {
    run = VOWELS.has(ch) ? 0 : run + 1;
    if (run > best) best = run;
  }
  return best;
}

export interface ScrambleScore {
  /** Чем больше, тем труднее отгадать. Отрицательное — вариант негодный. */
  total: number;
  chunk: number;
  fixed: number;
  consonants: number;
}

/**
 * Насколько вариант хорош как загадка.
 * Целые куски исходника и буквы на своих местах — главные подсказки, за них штраф.
 * Длинные череды согласных не подсказывают ответ, но делают строку нечитаемой,
 * поэтому за них штраф поменьше: «ксряонсарк» произносится, «кксрняоарс» — уже нет.
 */
export function score(original: string, variant: string): ScrambleScore {
  const chunk = longestCommonChunk(original, variant);
  const fixed = fixedPoints(original, variant);
  const consonants = worstConsonantRun(variant);
  const total = -chunk * 10 - fixed * 8 - Math.max(0, consonants - 2) * 3;
  return { total, chunk, fixed, consonants };
}

export interface ScrambleResult {
  word: string;
  scrambled: string;
  score: ScrambleScore;
  /** Перестановка случайно оказалась настоящим словом — такое в тему не берём. */
  isRealWord: boolean;
}

export interface ScrambleOptions {
  /** Проверка «а это не настоящее ли слово». Без неё вместо загадки выйдет подсказка. */
  isWord?: (w: string) => boolean;
  /** Сколько вариантов перебрать. Больше — чуть лучше и заметно дольше. */
  tries?: number;
}

/**
 * Перемешать буквы одного слова.
 * Регистр ответа сохраняем как есть, а загадку отдаём строчными: «Красноярск» → «ксряонсарк».
 */
export function scramble(word: string, opts: ScrambleOptions = {}): ScrambleResult {
  const clean = word.trim();
  const letters = [...clean.toLowerCase()];
  const rnd = seededRandom(seedOf(clean));
  const tries = opts.tries ?? 300;

  let best: ScrambleResult | undefined;
  for (let t = 0; t < tries; t++) {
    const shuffled = [...letters];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const variant = shuffled.join("");
    if (variant === clean.toLowerCase()) continue;
    const isRealWord = opts.isWord?.(variant) ?? false;
    const s = score(clean.toLowerCase(), variant);
    const candidate: ScrambleResult = { word: clean, scrambled: variant, score: s, isRealWord };
    // настоящее слово вместо загадки не годится ни при каком счёте
    if (isRealWord) continue;
    if (!best || s.total > best.score.total) best = candidate;
    if (s.chunk <= 1 && s.fixed === 0 && s.consonants <= 2) break; // лучше уже не будет
  }

  return best ?? { word: clean, scrambled: [...letters].reverse().join(""), score: score(clean.toLowerCase(), [...letters].reverse().join("")), isRealWord: false };
}

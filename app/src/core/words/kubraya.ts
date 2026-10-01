// Кубрая — шарада наоборот (dxdy.ru/topic122192). Ответ режется на два слова, каждое заменяется
// синонимом или антонимом, и получается загадка-фраза:
//
//   «Оценка рая» = БАЛЛ + АДА      (оценка → балл, рай → ад)
//   «Один лес»   = РАЗ + БОР
//
// Здесь только простые кубраи — так решил автор. Ни переворотов (ДЕЛ↔ЛЕД), ни служебных слов
// («Один в один» = КОЛ-О-КОЛ), ни ассоциаций и имён: замены берутся только из тезауруса, без ИИ.
// Поэтому загадку всегда можно объяснить игроку словарём, а не «автор так видит».
//
// Ядро не знает, откуда словари: проверку «это слово», известность и тезаурус передаёт генератор.

import { stem } from "./generators/matrix";

/** Синонимы и антонимы слова в начальной форме. */
export interface Thesaurus {
  has(word: string): boolean;
  syn(word: string): string[];
  ant(word: string): string[];
}

export interface KubrayaDeps {
  /** Есть ли такая словоформа в языке. */
  isWord(word: string): boolean;
  /** Известность слова: 0 — незнакомое, 1 — самое частое. */
  fame(word: string): number;
  thes: Thesaurus;
  /**
   * Существительное ли это (в начальной форме). Задано — и куски, и замены берутся только из
   * существительных: иначе тезаурус подсовывает предлоги и частицы («на → под», «говорят → мол»),
   * а служебных слов в простой кубрае быть не должно.
   */
  isNoun?(word: string): boolean;
}

export interface KubrayaOptions {
  /** Сколько частей допускать: 2 или 3. */
  maxParts?: number;
  /** Разрешать части в косвенной форме (АДА → «рая»): загадок больше, но форму стоит проверить глазами. */
  allowForms?: boolean;
  /** Сколько загадок давать на один ответ. */
  perAnswer?: number;
  /**
   * Порог известности кусков ответа (0…1). При переборе всего словаря без него выходят «пар + тер»;
   * для своих ответов автора порог не нужен — их куски он выбрал сам.
   */
  minFame?: number;
  /** Порог известности замен: «кашаса» вместо «рома» загадку не украсит. */
  subFame?: number;
}

/** Меньше трёх букв — это уже не слово, а слог: «ка», «ло» в загадке не объяснить. */
export const MIN_PART = 3;

/** Как часть ответа связана со словом тезауруса. ending пустой — часть и есть начальная форма. */
export interface PieceLemma {
  lemma: string;
  ending: string;
}

export interface CluePart {
  /** Кусок ответа: «ада». */
  piece: string;
  /** Слово загадки: «рая». */
  word: string;
  kind: "syn" | "ant";
  /** Форму подобрали окончанием — её стоит проверить. */
  inflected: boolean;
}

export interface KubrayaClue {
  answer: string;
  clue: string;
  parts: CluePart[];
  score: number;
}

const norm = (w: string) => w.toLowerCase().replace(/ё/g, "е").trim();

/**
 * Окончания косвенных форм и их пары после мягкой основы: «ад-а» ↔ «ра-я», «лес-у» ↔ «кра-ю».
 * Нулевого окончания (родительный «дел») здесь нет нарочно: по нему не отличить падеж от начальной формы.
 */
const ENDING_CLASS: Record<string, string> = {
  а: "а", я: "а",
  у: "у", ю: "у",
  ы: "ы", и: "ы",
  е: "е",
  ом: "ом", ем: "ом",
  ой: "ой", ей: "ой",
  ов: "ов", ев: "ов",
  ам: "ам", ям: "ам",
  ах: "ах", ях: "ах",
  ами: "ами", ями: "ами",
};
const ENDINGS = Object.keys(ENDING_CLASS).sort((a, b) => b.length - a.length);

/** Чем кончается начальная форма: от этого зависит склонение («рай» и «ад» склоняются одинаково, «рай» и «вода» — нет). */
function declension(lemma: string): string {
  const last = lemma.at(-1) ?? "";
  if ("ая".includes(last)) return "а";
  if ("оеё".includes(last)) return "о";
  if (last === "ь") return "ь";
  return "согл";
}

/** Основа, к которой прибавляется окончание: «рай» → «ра», «вода» → «вод», «ад» → «ад». */
function stemOf(lemma: string): string {
  return /[аяоеёьй]$/.test(lemma) ? lemma.slice(0, -1) : lemma;
}

/**
 * Каким словом тезауруса может быть кусок ответа. «бор» — само слово, «ада» — «ад» в родительном,
 * «лета» — «лето» в родительном. Без allowForms — только начальная форма.
 */
export function pieceLemmas(piece: string, thes: Thesaurus, allowForms: boolean, isNoun?: (w: string) => boolean): PieceLemma[] {
  const out: PieceLemma[] = [];
  const ok = (w: string) => thes.has(w) && (!isNoun || isNoun(w));
  if (ok(piece)) out.push({ lemma: piece, ending: "" });
  if (!allowForms) return out;
  for (const e of ENDINGS) {
    if (!piece.endsWith(e) || piece.length - e.length < 2) continue;
    const base = piece.slice(0, -e.length);
    for (const tail of ["", "а", "я", "о", "е", "ь", "й"]) {
      const lemma = base + tail;
      if (lemma !== piece && ok(lemma) && !out.some((x) => x.lemma === lemma)) out.push({ lemma, ending: e });
    }
  }
  return out;
}

/**
 * Поставить замену в ту же форму, что кусок ответа: «рай» под «ад-а» → «рая».
 * Склонение обязано совпасть, а готовая форма — найтись в словаре: иначе выйдет «райа».
 */
export function inflectLike(sub: string, like: PieceLemma, isWord: (w: string) => boolean): string | undefined {
  if (!like.ending) return sub;
  if (declension(sub) !== declension(like.lemma)) return undefined;
  const cls = ENDING_CLASS[like.ending];
  const base = stemOf(sub);
  for (const e of ENDINGS) {
    if (ENDING_CLASS[e] !== cls) continue;
    const form = base + e;
    if (isWord(form)) return form;
  }
  return undefined;
}

/**
 * Общий корень: слово загадки не должно подсказывать ответ. «ход» в загадке и «поход» в ответе —
 * брак, автор темы такое не засчитывал. Сравниваем основы и общее начало от четырёх букв.
 */
export function sameRoot(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (x === y) return true;
  const sx = stem(x);
  const sy = stem(y);
  if (sx.length >= 3 && y.includes(sx)) return true;
  if (sy.length >= 3 && x.includes(sy)) return true;
  let p = 0;
  while (p < x.length && x[p] === y[p]) p++;
  return p >= 4;
}

/** Разрезы ответа на части, каждая из которых — слово тезауруса (или его форма). */
export function splitWord(answer: string, deps: KubrayaDeps, opts: KubrayaOptions = {}): string[][] {
  const w = norm(answer);
  const maxParts = Math.min(3, Math.max(2, opts.maxParts ?? 2));
  const allowForms = !!opts.allowForms;
  const minFame = opts.minFame ?? 0;
  const usable = (p: string) =>
    p.length >= MIN_PART && (!minFame || deps.fame(p) >= minFame) && pieceLemmas(p, deps.thes, allowForms, deps.isNoun).length > 0 && (deps.thes.has(p) || deps.isWord(p));
  const out: string[][] = [];
  const walk = (from: number, acc: string[]) => {
    if (from === w.length) {
      if (acc.length >= 2) out.push([...acc]);
      return;
    }
    if (acc.length >= maxParts) return;
    for (let to = from + MIN_PART; to <= w.length; to++) {
      if (acc.length === 0 && to === w.length) break; // целое слово — не кубрая
      const p = w.slice(from, to);
      if (usable(p)) walk(to, [...acc, p]);
    }
  };
  walk(0, []);
  return out;
}

interface Option {
  word: string;
  kind: "syn" | "ant";
  inflected: boolean;
  score: number;
}

/** Замены для одного куска: только одиночные слова тезауруса, не родня ответу. */
function optionsFor(piece: string, answer: string, parts: string[], deps: KubrayaDeps, allowForms: boolean, subFame: number): Option[] {
  const out: Option[] = [];
  const seen = new Set<string>();
  for (const pl of pieceLemmas(piece, deps.thes, allowForms, deps.isNoun)) {
    const cands: [string, "syn" | "ant"][] = [
      ...deps.thes.syn(pl.lemma).map((s): [string, "syn"] => [s, "syn"]),
      ...deps.thes.ant(pl.lemma).map((s): [string, "ant"] => [s, "ant"]),
    ];
    for (const [raw, kind] of cands) {
      const sub = norm(raw);
      if (!/^[а-я]+$/.test(sub) || sub.length < 2) continue;
      if (deps.isNoun && !deps.isNoun(sub)) continue;
      if (sameRoot(sub, answer) || parts.some((p) => sameRoot(sub, p))) continue;
      const word = inflectLike(sub, pl, deps.isWord);
      if (!word || seen.has(word)) continue;
      if (subFame && deps.fame(word) < subFame) continue;
      seen.add(word);
      const inflected = !!pl.ending;
      // антоним понятнее синонима: «рай → ад» отгадывают, а оттенки синонимов спорны
      out.push({ word, kind, inflected, score: deps.fame(word) + (kind === "ant" ? 0.15 : 0) - (inflected ? 0.2 : 0) });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 4);
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Загадки на один ответ, лучшие впереди. */
export function makeClues(answer: string, deps: KubrayaDeps, opts: KubrayaOptions = {}): KubrayaClue[] {
  const a = norm(answer);
  const allowForms = !!opts.allowForms;
  const perAnswer = opts.perAnswer ?? 3;
  const found: KubrayaClue[] = [];
  for (const parts of splitWord(a, deps, opts)) {
    const opt = parts.map((p) => optionsFor(p, a, parts, deps, allowForms, opts.subFame ?? 0));
    if (opt.some((o) => !o.length)) continue;
    // известные куски — понятная загадка: «балл + ада» лучше «бал + лада»
    const splitScore = parts.reduce((s, p) => s + deps.fame(p), 0) / parts.length - 0.3 * (parts.length - 2);
    const combo = (i: number, acc: Option[]) => {
      if (i === parts.length) {
        const words = acc.map((o) => o.word);
        if (new Set(words).size !== words.length) return;
        found.push({
          answer: a,
          clue: cap(words.join(" ")),
          parts: acc.map((o, k) => ({ piece: parts[k], word: o.word, kind: o.kind, inflected: o.inflected })),
          score: splitScore + acc.reduce((s, o) => s + o.score, 0) / acc.length,
        });
        return;
      }
      for (const o of opt[i].slice(0, 3)) combo(i + 1, [...acc, o]);
    };
    combo(0, []);
  }
  const best = found.sort((x, y) => y.score - x.score);
  const out: KubrayaClue[] = [];
  const usedWords = new Set<string>();
  for (const c of best) {
    // разнообразие: вторая загадка не должна отличаться от первой одним словом из той же пары
    const key = c.parts.map((p) => p.word).join("|");
    if (usedWords.has(key)) continue;
    usedWords.add(key);
    out.push(c);
    if (out.length >= perAnswer) break;
  }
  return out;
}

/** Разбор для автора: «БАЛЛ + АДА: оценка → балл (синоним), рая → ада (антоним, форма подобрана)». */
export function explain(c: KubrayaClue): string {
  const head = c.parts.map((p) => p.piece.toUpperCase()).join(" + ");
  const tail = c.parts
    .map((p) => `${p.word} → ${p.piece} (${p.kind === "ant" ? "антоним" : "синоним"}${p.inflected ? ", форма подобрана" : ""})`)
    .join(", ");
  return `${head}: ${tail}`;
}

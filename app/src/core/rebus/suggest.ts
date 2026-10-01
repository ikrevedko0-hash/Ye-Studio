// Подбор разборов: ответ режется на куски, и для каждого ищется, чем его нарисовать.
// Это подсказка, а не готовый ребус: хорошая картинка и красивый приём — за автором.
//
// Чем можно закрыть кусок (каждое — отдельный «приём», автор включает нужные):
//   картинка как есть          КОЛ                       — существительное целиком
//   картинка с запятыми        ,,ЛЕВ → Л                 — слово начинается/кончается на кусок
//   перевёрнутая картинка      ТОК ← КОТ                 — кусок задом наперёд есть слово
//   замена буквы               МАСТ ← МОСТ, О=А          — слово отличается одной буквой
//   зачёркнутая буква          ПОЛ ← ПОЛК без К          — слово длиннее на одну букву
//   нота, число                ДО, МИ · СОРОК, СТО
//   предлог расположением      ВОДА = «в О — ДА»          — «ДА» нарисовано внутри «О»
//   буквы текстом              Л                         — запасной ход, если иначе никак
//
// Поиск — динамика по позициям ответа: для каждого хвоста храним несколько лучших разборов,
// у каждого цена. Дешевле — меньше кусков, меньше запятых, известнее слова.

import { NOTES, NUMBER_WORDS, PREPS, fold, pieceId, readPiece, type Prep, type Rebus, type RebusOp, type RebusPiece, type SimplePiece } from "./model";

export type Technique = "commas" | "flip" | "swap" | "drop" | "notes" | "numbers" | "preps" | "letters";

export const TECHNIQUES: { id: Technique; title: string }[] = [
  { id: "commas", title: "запятые" },
  { id: "preps", title: "предлоги" },
  { id: "notes", title: "ноты" },
  { id: "numbers", title: "числа" },
  { id: "swap", title: "замена букв" },
  { id: "drop", title: "зачёркивание" },
  { id: "flip", title: "переворот" },
  { id: "letters", title: "буквы текстом" },
];

export interface SuggestDeps {
  /** Существительные в начальной форме — кандидаты в картинки. */
  nouns: string[];
  /** Известность слова: 0 — незнакомое, 1 — самое частое. */
  fame(word: string): number;
}

export interface SuggestOptions {
  techniques?: Technique[];
  /** Порог известности картинки: «пизолит» никто не нарисует и не узнает. */
  minFame?: number;
  /** Больше трёх запятых у одной картинки — уже не ребус, а ребус ради ребуса. */
  maxCommas?: number;
  limit?: number;
}

export interface Suggestion {
  rebus: Rebus;
  cost: number;
  commas: number;
  pictures: number;
  label: string;
}

const ALPHABET = "абвгдежзийклмнопрстуфхцчшщъыьэюя";

/**
 * В списке существительных хватает слов, которые нарисовать нельзя: местоимения и частицы
 * пришли туда омонимами («моя», «за» — «голос за»), а частота у них огромная. Картинками их не берём.
 */
const UNDRAWABLE = new Set(("я ты он она оно мы вы они мой моя мое мои твой твоя твое твои свой своя свое свои наш наша наше " +
  "ваш ваша ваше сей тот та то те этот эта это эти весь вся все всё сам сама само кто что где там тут так как " +
  "вот нет не ни же ли бы да но за на под над из ах ох эх ой ай мол сие оба обе себя").split(" "));

/** Двухбуквенные слова, которые всё же рисуются. Остальные («ро», «ре», «ка») — буквы, а не картинки. */
const SHORT_PICTURES = new Set(["еж", "уж", "ус", "як", "яд", "юг", "ум", "щи", "ил", "ас", "гу", "яр"]);
/** Сколько лучших разборов хранить на каждый хвост ответа. */
const KEEP = 14;
/** Сколько вариантов одного куска пускать дальше: иначе выдача забьётся одним и тем же. */
const PER_SEGMENT = 3;

interface Cand {
  piece: RebusPiece;
  cost: number;
}

interface Index {
  /** Свёрнутое слово → как оно записано в словаре (с «ё»). */
  word: Map<string, string>;
  fame: Map<string, number>;
  /** Известные слова, самые частые первыми: по ним ищется «начинается на кусок». */
  famous: string[];
}

function buildIndex(deps: SuggestDeps, minFame: number): Index {
  const word = new Map<string, string>();
  const fame = new Map<string, number>();
  for (const raw of deps.nouns) {
    const f = deps.fame(raw);
    if (f < minFame) continue;
    const k = fold(raw);
    if (!k || UNDRAWABLE.has(k) || (k.length < 3 && !SHORT_PICTURES.has(k))) continue;
    if ((fame.get(k) ?? -1) >= f) continue;
    word.set(k, raw);
    fame.set(k, f);
  }
  const famous = [...fame.keys()].sort((a, b) => fame.get(b)! - fame.get(a)!);
  return { word, fame, famous };
}

function picture(word: string, ops: RebusOp[] = []): SimplePiece {
  return { id: pieceId(), kind: "picture", word, ops };
}

/** Чем меньше слово на слуху, тем дороже: «око» хуже «глаза», хоть и короче. */
const fameCost = (f: number) => (1 - f) * 1.5;

export function suggest(answer: string, deps: SuggestDeps, opts: SuggestOptions = {}): Suggestion[] {
  const target = fold(answer);
  if (!target) return [];
  const on = new Set<Technique>(opts.techniques ?? TECHNIQUES.map((t) => t.id));
  const maxCommas = opts.maxCommas ?? 3;
  const idx = buildIndex(deps, opts.minFame ?? 0.55);
  const n = target.length;

  /** Слово-носитель не должно выдавать ответ: КОЛОКОЛ не рисуют колоколом без запятой. */
  const fair = (w: string) => !w.includes(target) && !(target.includes(w) && w.length >= n * 0.7);

  const segCache = new Map<string, Cand[]>();

  /** Простые способы закрыть кусок seg. whole — кусок и есть весь ответ: тогда «картинка как есть» не годится. */
  function simple(seg: string, whole: boolean): Cand[] {
    const key = `${seg}:${whole ? 1 : 0}`;
    const have = segCache.get(key);
    if (have) return have;
    const out: Cand[] = [];
    const L = seg.length;

    if (on.has("notes") && (NOTES as readonly string[]).includes(seg)) {
      out.push({ piece: { id: pieceId(), kind: "note", word: seg, ops: [] }, cost: 0.4 });
    }
    if (on.has("numbers")) {
      for (const [digits, said] of Object.entries(NUMBER_WORDS)) {
        if (said === seg) out.push({ piece: { id: pieceId(), kind: "number", word: said, shown: digits, ops: [] }, cost: 0.5 });
      }
    }
    if (!whole && L >= 2 && idx.fame.has(seg) && fair(seg)) {
      out.push({ piece: picture(idx.word.get(seg)!), cost: 1 + fameCost(idx.fame.get(seg)!) });
    }
    if (on.has("commas")) {
      const left: Cand[] = [];
      const right: Cand[] = [];
      for (const w of idx.famous) {
        const extra = w.length - L;
        if (extra < 1 || extra > maxCommas || !fair(w)) continue;
        const f = idx.fame.get(w)!;
        if (right.length < 2 && w.startsWith(seg)) {
          right.push({ piece: picture(idx.word.get(w)!, [{ kind: "commas", left: 0, right: extra }]), cost: 1 + 0.6 * extra + fameCost(f) });
        } else if (left.length < 2 && w.endsWith(seg)) {
          left.push({ piece: picture(idx.word.get(w)!, [{ kind: "commas", left: extra, right: 0 }]), cost: 1 + 0.6 * extra + fameCost(f) });
        }
        if (left.length >= 2 && right.length >= 2) break;
      }
      out.push(...right, ...left);
    }
    if (on.has("flip") && L >= 3) {
      const back = [...seg].reverse().join("");
      if (back !== seg && idx.fame.has(back) && fair(back)) {
        out.push({ piece: picture(idx.word.get(back)!, [{ kind: "flip" }]), cost: 1.9 + fameCost(idx.fame.get(back)!) });
      }
    }
    if (on.has("swap") && L >= 3) {
      for (let i = 0; i < L; i++) {
        for (const ch of ALPHABET) {
          if (ch === seg[i]) continue;
          const w = seg.slice(0, i) + ch + seg.slice(i + 1);
          if (!idx.fame.has(w) || !fair(w)) continue;
          // А=О меняет все буквы А в слове: годится, только если в слове она одна
          if (w.split(ch).length !== 2) continue;
          out.push({ piece: picture(idx.word.get(w)!, [{ kind: "swap", from: ch, to: seg[i] }]), cost: 2 + fameCost(idx.fame.get(w)!) });
        }
      }
    }
    if (on.has("drop") && L >= 2) {
      for (let i = 0; i <= L; i++) {
        for (const ch of ALPHABET) {
          const w = seg.slice(0, i) + ch + seg.slice(i);
          if (!idx.fame.has(w) || !fair(w)) continue;
          // зачёркивается первая встреченная буква — проверяем, что выйдет именно кусок
          if (w.indexOf(ch) !== i) continue;
          out.push({ piece: picture(idx.word.get(w)!, [{ kind: "drop", letters: ch }]), cost: 2 + fameCost(idx.fame.get(w)!) });
        }
      }
    }
    if ((on.has("letters") && L <= 2) || L === 1) {
      out.push({ piece: { id: pieceId(), kind: "letters", word: seg, shown: seg.toUpperCase(), ops: [] }, cost: L === 1 && !on.has("letters") ? 3.5 : 2.2 + 0.4 * L });
    }

    const best = dedupe(out).sort((a, b) => a.cost - b.cost).slice(0, PER_SEGMENT);
    segCache.set(key, best);
    return best;
  }

  /** Лучший простой кусок для части предлога: внутри предлога запятые читаются плохо — их там не берём. */
  function plain(seg: string): Cand | undefined {
    // не из simple(): там остаются три лучших куска, и буквы «О» вытесняются запятыми у «осы»
    if (idx.fame.has(seg) && fair(seg)) return { piece: picture(idx.word.get(seg)!), cost: 1 + fameCost(idx.fame.get(seg)!) };
    const ready = simple(seg, false).find((c) => c.piece.kind !== "relation" && !c.piece.ops.length);
    if (ready) return ready;
    // буквами — только то, что читается вслух: «О», «ДА», но не «ЛК»
    if (seg.length === 1 || (seg.length === 2 && /[аеиоуыэюя]/.test(seg))) {
      return { piece: { id: pieceId(), kind: "letters", word: seg, shown: seg.toUpperCase(), ops: [] }, cost: 1 };
    }
    return undefined;
  }

  /** Куски, начинающиеся в позиции i: [конец, кандидат]. */
  function startingAt(i: number): [number, Cand][] {
    const out: [number, Cand][] = [];
    for (let e = i + 1; e <= n; e++) {
      for (const c of simple(target.slice(i, e), i === 0 && e === n)) out.push([e, c]);
    }
    if (on.has("preps")) {
      for (const prep of PREPS) {
        // «в О — ДА»: предлог, потом «где» (b), потом «что» (a)
        if (target.startsWith(prep, i)) {
          const from = i + prep.length;
          for (let j = from + 1; j < n && j - from <= 6; j++) {
            const b = plain(target.slice(from, j));
            if (!b) continue;
            for (let e = j + 1; e <= n && e - j <= 6; e++) {
              const a = plain(target.slice(j, e));
              if (a) out.push([e, relation(prep, a, b, "prep-b-a")]);
            }
          }
        }
        // «ДА в О»: «что», предлог, «где»
        for (let j = i + 1; j < n && j - i <= 6; j++) {
          if (!target.startsWith(prep, j)) continue;
          const a = plain(target.slice(i, j));
          if (!a) continue;
          const from = j + prep.length;
          for (let e = from + 1; e <= n && e - from <= 6; e++) {
            const b = plain(target.slice(from, e));
            if (b) out.push([e, relation(prep, a, b, "a-prep-b")]);
          }
        }
      }
    }
    return out;
  }

  // best[i] — лучшие разборы хвоста target[i..]
  const best: { pieces: Cand[]; cost: number }[][] = Array.from({ length: n + 1 }, () => []);
  best[n] = [{ pieces: [], cost: 0 }];
  for (let i = n - 1; i >= 0; i--) {
    const here: { pieces: Cand[]; cost: number }[] = [];
    for (const [e, c] of startingAt(i)) {
      for (const tail of best[e]) here.push({ pieces: [c, ...tail.pieces], cost: c.cost + tail.cost });
    }
    here.sort((a, b) => a.cost - b.cost);
    const seen = new Set<string>();
    for (const h of here) {
      const key = h.pieces.map((c) => label(c.piece)).join(" · ");
      if (seen.has(key)) continue;
      seen.add(key);
      best[i].push(h);
      // для всего ответа запас больше: из него ещё выбирать разнообразные
      if (best[i].length >= (i === 0 ? KEEP * 3 : KEEP)) break;
    }
  }

  // Не больше двух вариантов с одинаковым первым куском: иначе выдача — «кол · …» десять раз подряд
  const byFirst = new Map<string, number>();
  return best[0]
    .filter((s) => s.pieces.map((c) => readPiece(c.piece)).join("") === target)
    .filter((s) => {
      const k = label(s.pieces[0].piece);
      byFirst.set(k, (byFirst.get(k) ?? 0) + 1);
      return byFirst.get(k)! <= 2;
    })
    .slice(0, opts.limit ?? 12)
    .map((s) => {
      const pieces = s.pieces.map((c) => c.piece);
      return {
        rebus: { answer, pieces },
        cost: Math.round(s.cost * 100) / 100,
        commas: pieces.reduce((sum, p) => sum + commasOf(p), 0),
        pictures: pieces.reduce((sum, p) => sum + picturesOf(p), 0),
        label: pieces.map(label).join(" · "),
      };
    });
}

const WEAK_PREPS = new Set<Prep>(["к", "у", "по"]);

function relation(prep: Prep, a: Cand, b: Cand, order: "a-prep-b" | "prep-b-a"): Cand {
  // буквы внутри предлога — классика («ДА в О»), а не запасной ход: им своя, низкая цена
  const part = (c: Cand) => (c.piece.kind === "letters" ? 1 : c.cost);
  return {
    piece: { id: pieceId(), kind: "relation", prep, a: a.piece as SimplePiece, b: b.piece as SimplePiece, order },
    // «к» (стрелка) и «у» (рядом) на картинке угадываются хуже, чем «в», «на», «под»
    cost: part(a) + part(b) + (WEAK_PREPS.has(prep) ? 0.8 : 0.3),
  };
}

function dedupe(list: Cand[]): Cand[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const k = label(c.piece);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function commasOf(p: RebusPiece): number {
  if (p.kind === "relation") return commasOf(p.a) + commasOf(p.b);
  return p.ops.reduce((s, op) => s + (op.kind === "commas" ? op.left + op.right : 0), 0);
}

function picturesOf(p: RebusPiece): number {
  if (p.kind === "relation") return picturesOf(p.a) + picturesOf(p.b);
  return p.kind === "picture" ? 1 : 0;
}

/** Короткая запись куска для списка вариантов: «,,лев», «кот↻», «мост О=А», «♪ми». */
export function label(p: RebusPiece): string {
  if (p.kind === "relation") {
    return p.order === "a-prep-b" ? `${label(p.a)} ${p.prep} ${label(p.b)}` : `${p.prep} ${label(p.b)} ${label(p.a)}`;
  }
  let s = p.kind === "note" ? `♪${p.word}` : p.kind === "number" ? p.shown ?? p.word : p.kind === "letters" ? `«${(p.shown ?? p.word).toUpperCase()}»` : p.word;
  for (const op of p.ops) {
    if (op.kind === "commas") s = ",".repeat(op.left) + s + ",".repeat(op.right);
    if (op.kind === "flip") s += "↻";
    if (op.kind === "swap") s += ` ${op.from.toUpperCase()}=${op.to.toUpperCase()}`;
    if (op.kind === "drop") s += ` −${op.letters.toUpperCase()}`;
    if (op.kind === "pick") s += ` ${op.idx.join("")}`;
  }
  return s;
}

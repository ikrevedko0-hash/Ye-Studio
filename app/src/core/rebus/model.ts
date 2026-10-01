// Ребус как запись: ряд кусков, у каждого — что нарисовано, как это называется и что с названием
// сделать (запятые, переворот, А=О, цифры…). Картинку рисует окно, а здесь только чтение:
// по записи программа сама скажет, во что ребус читается, и напишет разгадку для ведущего.
// Так автор сразу видит, что ребус сходится с ответом, а не узнаёт об ошибке от игроков.

/** Операции над названием куска. Выполняются в порядке PIPELINE, а не в порядке добавления. */
export type RebusOp =
  /** Запятые: слева — убрать столько первых букв, справа — последних. */
  | { kind: "commas"; left: number; right: number }
  /** Перевёрнутая картинка: название читается задом наперёд. */
  | { kind: "flip" }
  /** «А=О»: все буквы from заменить на to. */
  | { kind: "swap"; from: string; to: string }
  /** Зачёркнутые буквы: каждая убирается один раз, первая встреченная. */
  | { kind: "drop"; letters: string }
  /** Цифры над картинкой: взять буквы с этими номерами (с единицы) в этом порядке. */
  | { kind: "pick"; idx: number[] };

export type OpKind = RebusOp["kind"];

/**
 * Порядок, в котором читаются знаки. Он один на весь ребус, иначе разгадка зависела бы от того,
 * в какой очерёдности автор нажимал кнопки: сначала слово переворачивают, потом меняют буквы,
 * зачёркивают, берут по номерам и лишь в конце срезают запятыми.
 */
export const PIPELINE: OpKind[] = ["flip", "swap", "drop", "pick", "commas"];

/** Предлоги, которые показываются расположением двух кусков. */
export type Prep = "в" | "на" | "под" | "над" | "за" | "из" | "у" | "к" | "по";

export const PREPS: Prep[] = ["в", "на", "под", "над", "за", "из", "у", "к", "по"];

/** Как предлог виден на холсте: a — «что», b — «где». */
export const PREP_HINT: Record<Prep, string> = {
  в: "a внутри b",
  на: "a стоит на b",
  под: "a под b",
  над: "a над b, с зазором",
  за: "a за b, наполовину скрыт",
  из: "a выложен из маленьких b",
  у: "a рядом с b, маленький",
  к: "стрелка от a к b",
  по: "a идёт по b",
};

export const NOTES = ["до", "ре", "ми", "фа", "соль", "ля", "си"] as const;
export type Note = (typeof NOTES)[number];

export interface RebusImage {
  /** Файл пака (папка Images) — так картинка переживает сохранение ребуса. */
  name?: string;
  /** Ещё не положенная в пак картинка: data: или http(s) адрес. */
  url?: string;
  /** Отразить по горизонтали — просто для красоты, на чтение не влияет. */
  mirror?: boolean;
  /** Вырезать фон (силуэт по цвету краёв). */
  cutout?: boolean;
}

export interface SimplePiece {
  id: string;
  /**
   * picture — картинка, letters — буквы текстом, number — цифры, note — нота на нотном стане.
   * Во всех случаях word — то, как кусок называется вслух («кот», «сорок», «ми», «л»).
   */
  kind: "picture" | "letters" | "number" | "note";
  word: string;
  /** Что нарисовано для letters и number: «Л», «40». У картинки и ноты не нужно. */
  shown?: string;
  image?: RebusImage;
  ops: RebusOp[];
}

export interface RelationPiece {
  id: string;
  kind: "relation";
  prep: Prep;
  a: SimplePiece;
  b: SimplePiece;
  /** «a в b» (ДА в О) или «в b a» (в О ДА) — оба прочтения в ребусах законны, выбирает автор. */
  order: "a-prep-b" | "prep-b-a";
}

export type RebusPiece = SimplePiece | RelationPiece;

export interface Rebus {
  answer: string;
  pieces: RebusPiece[];
}

/** «ё» в ребусе не отличается от «е»: КОЛЁСА и КОЛЕСА читаются одинаково. */
export function fold(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е").replace(/[^а-яa-z0-9]/g, "");
}

function sortedOps(ops: RebusOp[]): RebusOp[] {
  return [...ops].sort((x, y) => PIPELINE.indexOf(x.kind) - PIPELINE.indexOf(y.kind));
}

export function applyOp(word: string, op: RebusOp): string {
  switch (op.kind) {
    case "flip":
      return [...word].reverse().join("");
    case "swap": {
      const from = fold(op.from);
      if (!from) return word;
      return word.split(from).join(fold(op.to));
    }
    case "drop": {
      let out = word;
      for (const ch of fold(op.letters)) {
        const i = out.indexOf(ch);
        if (i >= 0) out = out.slice(0, i) + out.slice(i + 1);
      }
      return out;
    }
    case "pick":
      return op.idx.map((i) => word[i - 1] ?? "").join("");
    case "commas":
      return word.slice(Math.max(0, op.left), Math.max(0, word.length - Math.max(0, op.right)));
  }
}

/** Как читается простой кусок. */
export function readSimple(p: SimplePiece): string {
  let w = fold(p.word);
  for (const op of sortedOps(p.ops)) w = applyOp(w, op);
  return w;
}

export function readPiece(p: RebusPiece): string {
  if (p.kind !== "relation") return readSimple(p);
  const a = readSimple(p.a);
  const b = readSimple(p.b);
  return p.order === "a-prep-b" ? a + p.prep + b : p.prep + b + a;
}

/** Во что ребус читается целиком — без пробелов, строчными, «ё» как «е». */
export function readRebus(r: Rebus): string {
  return r.pieces.map(readPiece).join("");
}

/** Сходится ли ребус с ответом. */
export function matches(r: Rebus): boolean {
  return !!fold(r.answer) && readRebus(r) === fold(r.answer);
}

const UP = (s: string) => s.toUpperCase();

/** После «без» всё в родительном: «без первой буквы», «без 2 последних букв». */
function letters(n: number, side: "first" | "last"): string {
  if (n === 1) return side === "first" ? "первой буквы" : "последней буквы";
  return `${n} ${side === "first" ? "первых" : "последних"} букв`;
}

/** Что сделано с названием, словами: «наоборот, без 2 последних букв». */
export function describeOps(ops: RebusOp[]): string[] {
  const out: string[] = [];
  for (const op of sortedOps(ops)) {
    switch (op.kind) {
      case "flip":
        out.push("наоборот");
        break;
      case "swap":
        if (op.from) out.push(`${UP(op.from)}=${UP(op.to)}`);
        break;
      case "drop":
        if (op.letters) out.push(`без ${[...UP(op.letters)].join(", ")}`);
        break;
      case "pick":
        if (op.idx.length) out.push(`буквы ${op.idx.join(", ")}`);
        break;
      case "commas": {
        const parts: string[] = [];
        if (op.left > 0) parts.push(letters(op.left, "first"));
        if (op.right > 0) parts.push(letters(op.right, "last"));
        if (parts.length) out.push(`без ${parts.join(" и ")}`);
        break;
      }
    }
  }
  return out;
}

function explainSimple(p: SimplePiece): string {
  const name = UP(p.word.trim());
  const steps = describeOps(p.ops);
  if (!steps.length) return name;
  return `${name} ${steps.join(", ")} → ${UP(readSimple(p))}`;
}

/** Разгадка для ведущего: «КОЛ + ОКО + ЛЕВ без 2 последних букв → Л = КОЛОКОЛ». */
export function explainRebus(r: Rebus): string {
  const parts = r.pieces.map((p) => {
    if (p.kind !== "relation") return explainSimple(p);
    const a = explainSimple(p.a);
    const b = explainSimple(p.b);
    return p.order === "a-prep-b" ? `(${a} ${UP(p.prep)} ${b})` : `(${UP(p.prep)} ${b} ${a})`;
  });
  return `${parts.join(" + ")} = ${UP(readRebus(r))}`;
}

/** Самые частые числа вслух. Остальное автор впишет сам: «1» бывает и «раз», и «один». */
export const NUMBER_WORDS: Record<string, string> = {
  "0": "ноль", "1": "один", "2": "два", "3": "три", "4": "четыре", "5": "пять", "6": "шесть", "7": "семь",
  "8": "восемь", "9": "девять", "10": "десять", "11": "одиннадцать", "12": "двенадцать", "20": "двадцать",
  "30": "тридцать", "40": "сорок", "50": "пятьдесят", "90": "девяносто", "100": "сто", "200": "двести",
  "300": "триста", "1000": "тысяча",
};

let seq = 0;
export function pieceId(): string {
  seq += 1;
  return `p${Date.now().toString(36)}${seq}`;
}

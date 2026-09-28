// Что присылает стенд sigame-runner (tools/sigame-runner/Program.cs): по строке JSON на событие.
// Здесь только типы и разбор — без процессов и диска, чтобы проверялось тестами.

/** Сообщение, которое движок SIGame разослал зрителю: [мс от начала, текст, отправитель, системное]. */
export type RecordedMessage = [number, string, string?, boolean?];

export interface PackShape {
  rounds: number;
  themes: number;
  questions: number;
}

/** Чего SIGame не увидела по сравнению с content.xml. */
export type LostPart =
  | { kind: "round"; round: number; name: string }
  | { kind: "theme"; round: number; theme: number; name: string; seenAs?: string | null }
  | { kind: "questions"; round: number; theme: number; name: string; file: number; seen: number };

export interface MissingRef {
  round: number;
  theme: number;
  question: number;
  kind: string;
  name: string;
}

export interface QuestionMark {
  theme: number;
  question: number;
  /** Индексы в messages раунда: первое и последнее сообщение вопроса (-1 — игра до конца не дошла). */
  start: number;
  end: number;
  type?: string | null;
}

export interface FetchedMedia {
  /** Номер вопроса в questions раунда (-1 — вне вопроса). */
  question: number;
  kind: string;
  uri: string;
  url: string;
  status: number;
  bytes?: number;
  contentType?: string | null;
  ms: number;
  error?: string;
}

export type RunnerEvent =
  | { type: "start"; pack: string; engine?: string; packages?: string }
  | { type: "open"; ok: boolean; error?: string; file: PackShape; sigame?: PackShape; lost?: LostPart[] }
  | { type: "refs"; missing: MissingRef[] }
  | {
      type: "round"; round: number; name: string; final: boolean; played: number; timedOut: boolean;
      messages: RecordedMessage[]; questions: QuestionMark[]; media: FetchedMedia[]; errors: string[];
      /** Имя файла, под которым SIGame его распаковала (хэш) → имя в паке. */
      names?: Record<string, string>;
    }
  | { type: "done"; played: number; expected: number; seconds: number };

export type RoundEvent = Extract<RunnerEvent, { type: "round" }>;

const TYPES = new Set(["start", "open", "refs", "round", "done"]);

/** Строка stdout стенда → событие; посторонние строки (логи .NET) — null. */
export function parseRunnerLine(line: string): RunnerEvent | null {
  const s = line.trim();
  // Stryker disable next-line ConditionalExpression,StringLiteral: быстрый отсев; не-объекты отсекает и проверка ниже
  if (!s.startsWith("{")) return null;
  try {
    const e = JSON.parse(s) as RunnerEvent;
    // Stryker disable next-line ConditionalExpression,LogicalOperator: строка начинается с «{» — JSON.parse даёт объект или бросает
    return e && typeof e === "object" && TYPES.has(e.type) ? e : null;
  } catch {
    return null;
  }
}

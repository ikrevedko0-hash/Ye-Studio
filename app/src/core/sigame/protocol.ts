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
  | { type: "done"; played: number; expected: number; seconds: number }
  /** Ход раунда во время игры: начато вопросов question, закончено ended, всего в раунде total. */
  | { type: "progress"; round: number; name: string; question: number; ended: number; total: number };

export type RoundEvent = Extract<RunnerEvent, { type: "round" }>;
export type ProgressEvent = Extract<RunnerEvent, { type: "progress" }>;

/** Строка хода игры для окна: сколько вопросов сыграно из скольких, по всем раундам сразу (они идут параллельно). */
export function engineProgress(rounds: Map<number, { name: string; question: number; ended: number; total: number; done?: boolean }>): { done: number; total: number; text: string } {
  const list = [...rounds.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r);
  const done = list.reduce((s, r) => s + (r.done ? r.total : Math.min(r.ended, r.total)), 0);
  const total = list.reduce((s, r) => s + r.total, 0);
  const playing = list.filter((r) => !r.done).map((r) => `«${r.name}» ${Math.min(r.question, r.total)} из ${r.total}`);
  return { done, total, text: `SIGame играет пак: сыграно вопросов ${done} из ${total}${playing.length ? ` · сейчас ${playing.join(", ")}` : ""}` };
}

const TYPES = new Set(["start", "open", "refs", "round", "done", "progress"]);

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

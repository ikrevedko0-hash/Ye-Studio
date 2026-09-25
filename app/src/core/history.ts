// История правок для Ctrl+Z / Ctrl+Y: снимки состояния (пак неизменяемый — каждая правка даёт новый объект,
// поэтому снимок — просто ссылка). Правки чаще, чем раз в mergeMs (набор текста, перетаскивание), —
// один шаг: иначе отмена откатывала бы по букве.

export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private lastAt = -Infinity;

  constructor(private readonly limit = 100, private readonly mergeMs = 800) {}

  /** Состояние prev сменилось новым (в момент now). */
  record(prev: T, now: number): void {
    if (now - this.lastAt >= this.mergeMs || !this.past.length) {
      this.past.push(prev);
      if (this.past.length > this.limit) this.past.shift();
    }
    this.lastAt = now;
    this.future = [];
  }

  /** Шаг назад: вернуть прежнее состояние (current уходит в «вперёд»), или undefined, если некуда. */
  undo(current: T): T | undefined {
    const prev = this.past.pop();
    if (prev === undefined) return undefined;
    this.future.push(current);
    this.lastAt = -Infinity;
    return prev;
  }

  redo(current: T): T | undefined {
    const next = this.future.pop();
    if (next === undefined) return undefined;
    this.past.push(current);
    this.lastAt = -Infinity;
    return next;
  }

  reset(): void {
    this.past = [];
    this.future = [];
    this.lastAt = -Infinity;
  }

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
}

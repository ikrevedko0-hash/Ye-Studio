import { describe, expect, it } from "vitest";
import { History } from "../src/core/history";

describe("история правок", () => {
  it("отмена и повтор по шагам", () => {
    const h = new History<string>();
    h.record("a", 0);
    h.record("b", 1000);
    expect(h.undo("c")).toBe("b");
    expect(h.undo("b")).toBe("a");
    expect(h.undo("a")).toBeUndefined();
    expect(h.redo("a")).toBe("b");
    expect(h.redo("b")).toBe("c");
    expect(h.canRedo).toBe(false);
  });

  it("частые правки — один шаг, новая правка стирает «вперёд»", () => {
    const h = new History<string>();
    h.record("", 0);
    h.record("к", 100);
    h.record("ки", 200);
    expect(h.undo("кин")).toBe("");
    h.record("", 5000);
    expect(h.canRedo).toBe(false);
  });

  it("после отмены следующая правка — отдельный шаг, даже сразу", () => {
    const h = new History<string>();
    h.record("a", 0);
    h.record("b", 1000);
    expect(h.undo("c")).toBe("b");
    h.record("b", 1001);
    expect(h.undo("x")).toBe("b");
    expect(h.undo("b")).toBe("a");
  });

  it("не больше limit шагов", () => {
    const h = new History<number>(3);
    for (let i = 0; i < 10; i++) h.record(i, i * 1000);
    expect([h.undo(10), h.undo(9), h.undo(8), h.undo(7)]).toEqual([9, 8, 7, undefined]);
  });
});

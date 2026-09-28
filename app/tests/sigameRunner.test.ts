// Стенд sigame-runner на паках-фикстурах: то, что говорит настоящий движок SIGame.
// Нужен собранный стенд (npm run sigame-src && npm run sigame-build, или SIGAME_DIR);
// без него тесты пропускаются — в CI их гоняет workflow sigame-runner.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { devSigameDir, sigameLayout } from "../src/core/sigame/paths";
import { parseRunnerLine, type RoundEvent, type RunnerEvent } from "../src/core/sigame/protocol";

const layout = sigameLayout(process.env.SIGAME_DIR ?? devSigameDir(join(__dirname, "..")), process.platform);
const built = existsSync(layout.runner);
const fixture = (name: string) => join(__dirname, "fixtures", "e2e", name);

function run(name: string): RunnerEvent[] {
  const out = execFileSync(layout.runner, [fixture(name), "--exit"], { encoding: "utf8", timeout: 120_000 });
  return out.split("\n").map(parseRunnerLine).filter((e): e is RunnerEvent => !!e);
}
const pick = <T extends RunnerEvent["type"]>(events: RunnerEvent[], type: T) => events.filter((e) => e.type === type) as Extract<RunnerEvent, { type: T }>[];

describe.skipIf(!built)(`стенд SIGame на фикстурах${built ? "" : " (стенд не собран — npm run sigame-build)"}`, { timeout: 120_000 }, () => {
  it("пустой <info />: SIGame теряет темы — ошибка открытия, игры нет", () => {
    const ev = run("empty-info.siq");
    const open = pick(ev, "open")[0];
    expect(open.ok).toBe(false);
    expect(open.file).toEqual({ rounds: 1, themes: 3, questions: 3 });
    expect(open.sigame).toEqual({ rounds: 1, themes: 1, questions: 0 });
    expect(open.lost?.map((l) => l.kind)).toEqual(["questions", "theme", "theme"]);
    expect(pick(ev, "round")).toEqual([]);
  });

  it("чистый пак: каждый вопрос сыгран, файлы отданы", () => {
    const ev = run("good.siq");
    expect(pick(ev, "open")[0].ok).toBe(true);
    expect(pick(ev, "refs")[0].missing).toEqual([]);
    const [round] = pick(ev, "round") as RoundEvent[];
    expect(round.timedOut).toBe(false);
    expect(round.questions.map((q) => [q.theme, q.question])).toEqual([[0, 0], [0, 1], [0, 2], [1, 0], [1, 1]]);
    expect(round.questions.every((q) => q.end > q.start)).toBe(true);
    expect(round.media.map((m) => m.status)).toEqual([200]);
    expect(Object.values(round.names ?? {})).toEqual(["кадр.png"]);
    expect(pick(ev, "done")[0]).toMatchObject({ played: 5, expected: 5 });
  });

  it("варианты ответа: SIGame шлёт раскладку ANSWER_OPTIONS с картинкой", () => {
    const [round] = pick(run("tiny-image-options.siq"), "round");
    expect(round.messages.some(([, t]) => t.startsWith("LAYOUT\nANSWER_OPTIONS\nimage\ntext\ntext\ntext\ntext"))).toBe(true);
  });

  it("имя в другом регистре и отсутствующий файл — SIGame их не находит", () => {
    const ev = run("bad-names.siq");
    expect(pick(ev, "refs")[0].missing.map((m) => m.name)).toEqual(["photo.png", "нет такого.png"]);
    const [round] = pick(ev, "round");
    expect(round.messages.filter(([, t]) => t.includes("не найден в пакете")).length).toBeGreaterThanOrEqual(2);
    // «#» в имени SIGame переживает: файлы распакованы под хэшами
    expect(round.media.every((m) => m.status === 200)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { parseRunnerLine, type RecordedMessage, type RoundEvent } from "../src/core/sigame/protocol";
import { buildReport, mergeShotIssues, PROFILES, shotIssues, SIGAME_LIMITS, type Shot, type TableMeasure } from "../src/core/sigame/report";
import { MAX_SCREENS_PER_PART, questionScreens, roundScreens } from "../src/core/sigame/screens";
import { sigameLayout } from "../src/core/sigame/paths";

const phone = PROFILES.find((p) => p.id === "phone")!;
const pc = PROFILES.find((p) => p.id === "pc")!;

const msgs = (...texts: string[]): RecordedMessage[] => texts.map((t, i) => [i * 10, t.replace(/\|/g, "\n")]);

function measure(over: Partial<TableMeasure> = {}): TableMeasure {
  return {
    viewport: { w: 390, h: 844 }, table: { x: 0, y: 190, w: 390, h: 557 },
    content: { x: 14, y: 249, w: 362, h: 346 }, optionsArea: null,
    images: [], videos: [], options: [], texts: [], errors: [], ...over,
  };
}
const img = (natural: [number, number], rect: [number, number], extra: Partial<TableMeasure["images"][0]> = {}) => ({
  src: "http://127.0.0.1:1/package/Images/ABC.png", complete: true, natural: { w: natural[0], h: natural[1] },
  rect: { x: 0, y: 0, w: rect[0], h: rect[1] }, inOption: false, timing: null, ...extra,
});
const shot = (m: TableMeasure, profile = phone.id, stillLoading = 0): Shot => ({
  round: 0, screen: { question: 0, at: 3, part: "question", n: 1 }, profile, measure: m, settle: { waitedMs: 700, stillLoading },
});

describe("вывод стенда sigame-runner", () => {
  it("строки JSON разбираются, посторонние — нет", () => {
    expect(parseRunnerLine('{"type":"done","played":5,"expected":5,"seconds":16}')).toEqual({ type: "done", played: 5, expected: 5, seconds: 16 });
    expect(parseRunnerLine('  {"type":"refs","missing":[]}  ')).toEqual({ type: "refs", missing: [] });
    expect(parseRunnerLine("info: Microsoft.Hosting.Lifetime[14]")).toBeNull();
    expect(parseRunnerLine('{"type":"чужой"}')).toBeNull();
    expect(parseRunnerLine("{битый")).toBeNull();
    expect(parseRunnerLine("")).toBeNull();
  });

  it("раскладка папки: .exe только на Windows", () => {
    expect(sigameLayout("/c", "win32").runner).toMatch(/runner[\\/]sigame-runner\.exe$/);
    expect(sigameLayout("/c", "linux").runner).toMatch(/runner[\\/]sigame-runner$/);
    expect(sigameLayout("/c", "linux").table).toMatch(/table[\\/]index\.html$/);
  });
});

describe("экраны для снимков", () => {
  it("конец каждой серии CONTENT — экран вопроса; RIGHTANSWER текстом — экран ответа", () => {
    const m = msgs("CHOICE|0|0", "QTYPE|simple", "CONTENT|screen|0|text|Вопрос", "CONTENT2|screen|0||text||Вопрос",
      "TRY", "CONTENT|screen|0|image|http://x/a.png", "ENDTRY|A", "RIGHTANSWER|text|Ответ", "QUESTION_END");
    const s = questionScreens(m, { theme: 0, question: 0, start: 0, end: 8 }, 3);
    expect(s).toEqual([
      { question: 3, at: 3, part: "question", n: 1 },
      { question: 3, at: 5, part: "question", n: 2 },
      { question: 3, at: 7, part: "answer", n: 1 },
    ]);
  });

  it("ответ медиа: снимок на конце серии после RIGHT_ANSWER_START, а не на самом маркере", () => {
    const m = msgs("CHOICE|0|0", "CONTENT|screen|0|text|В", "RIGHT_ANSWER_START", "CONTENT|screen|0|image|http://x/b.png", "QUESTION_END");
    expect(questionScreens(m, { theme: 0, question: 0, start: 0, end: 4 }, 0).map((s) => [s.at, s.part])).toEqual([[1, "question"], [3, "answer"]]);
    const m2 = msgs("CHOICE|0|0", "RIGHTANSWER|text|О", "CONTENT|screen|0|image|http://x/b.png");
    expect(questionScreens(m2, { theme: 0, question: 0, start: 0, end: 2 }, 0).map((s) => [s.at, s.part])).toEqual([[2, "answer"]]);
  });

  it("не доигранный вопрос — до конца записи; не начатый — пусто", () => {
    const m = msgs("CHOICE|0|0", "CONTENT|screen|0|text|В");
    expect(questionScreens(m, { theme: 0, question: 0, start: 0, end: -1 }, 0)).toHaveLength(1);
    expect(questionScreens(m, { theme: 0, question: 0, start: -1, end: -1 }, 0)).toEqual([]);
  });

  it(`не больше ${MAX_SCREENS_PER_PART} экранов на часть, последний сохраняется`, () => {
    const parts = Array.from({ length: 9 }, (_, i) => [`CONTENT|screen|0|text|${i}`, "TIMER|1"]).flat();
    const m = msgs("CHOICE|0|0", ...parts);
    const s = questionScreens(m, { theme: 0, question: 0, start: 0, end: m.length - 1 }, 0);
    expect(s).toHaveLength(MAX_SCREENS_PER_PART);
    expect(s[s.length - 1].at).toBe(m.length - 2);
    expect(s[0].at).toBe(1);
  });

  it("roundScreens нумерует вопросы по порядку", () => {
    const m = msgs("CHOICE|0|0", "CONTENT|screen|0|text|A", "QUESTION_END", "CHOICE|0|1", "CONTENT|screen|0|text|B", "QUESTION_END");
    const s = roundScreens(m, [{ theme: 0, question: 0, start: 0, end: 2 }, { theme: 0, question: 1, start: 3, end: 5 }]);
    expect(s.map((x) => [x.question, x.at])).toEqual([[0, 1], [1, 4]]);
  });
});

describe("правила по снимку стола", () => {
  it("чистый экран — без бед", () => {
    expect(shotIssues(shot(measure({ images: [img([800, 600], [362, 272])] })), phone)).toEqual([]);
  });

  it("растяжение: ровно на пороге — уже беда, чуть меньше — нет", () => {
    const k = SIGAME_LIMITS.stretch;
    const at = shotIssues(shot(measure({ images: [img([100, 100], [100 * k, 100 * k])] })), pc);
    expect(at.map((i) => i.rule)).toEqual(["stretch"]);
    expect(at[0].text).toContain(`в ${k.toFixed(1)} раза`);
    expect(at[0].score).toBeCloseTo(k);
    expect(shotIssues(shot(measure({ images: [img([100, 100], [100 * k - 1, 100 * k - 1])] })), pc)).toEqual([]);
  });

  it("растяжение считается по меньшей стороне", () => {
    const r = shotIssues(shot(measure({ images: [img([100, 100], [400, 200])] })), pc);
    expect(r).toEqual([]);
  });

  it("мелкая картинка на телефоне — только если не заполняет свою область", () => {
    // заполняет область содержимого по высоте — это раскладка SIOnline, не пак
    const fill = measure({ content: { x: 0, y: 0, w: 362, h: 100 }, images: [img([800, 600], [133, 100])] });
    expect(shotIssues(shot(fill), phone).filter((i) => i.rule === "small")).toEqual([]);
    const small = measure({ images: [img([800, 600], [120, 90])] });
    const r = shotIssues(shot(small), phone).filter((i) => i.rule === "small");
    expect(r).toHaveLength(1);
    expect(r[0].text).toContain("120×90");
    // на компьютере правило не действует
    expect(shotIssues(shot(small, pc.id), pc).filter((i) => i.rule === "small")).toEqual([]);
    // картинки-варианты не считаются
    expect(shotIssues(shot(measure({ images: [img([800, 600], [120, 90], { inOption: true })] })), phone).filter((i) => i.rule === "small")).toEqual([]);
  });

  it("порог доли экрана и короткой стороны", () => {
    const area = 390 * 844;
    const side = SIGAME_LIMITS.phoneMinSide;
    // сторона ровно на пороге и доля больше порога — не беда
    const h = Math.ceil((SIGAME_LIMITS.phoneMinShare * area) / 300) + 1;
    expect(shotIssues(shot(measure({ images: [img([800, 800], [300, Math.max(side, h)])] })), phone).filter((i) => i.rule === "small")).toEqual([]);
    expect(shotIssues(shot(measure({ images: [img([800, 800], [300, side - 1])] })), phone).filter((i) => i.rule === "small")).toHaveLength(1);
  });

  it("битая картинка и ошибки загрузки — ошибки", () => {
    const r = shotIssues(shot(measure({
      images: [img([0, 0], [10, 10])],
      errors: [{ kind: "video", message: "MediaError 4", url: "http://h/package/Video/X.mp4" }, { kind: "script", message: "шум", url: null }],
    })), phone, { "X.mp4": "клип.mp4" });
    expect(r.map((i) => [i.rule, i.level])).toEqual([["load", "error"], ["broken", "error"]]);
    expect(r[0].text).toContain("клип.mp4");
    expect(r[0].text).toMatch(/^Видео/);
  });

  it("медиа не догрузилось", () => {
    const r = shotIssues(shot(measure(), phone.id, 2), phone);
    expect(r.map((i) => i.rule)).toEqual(["pending"]);
  });

  it("кодек видео, медленная сеть — только на профиле с сетью", () => {
    const video = { src: "http://h/package/Video/V.mp4", readyState: 0, error: 4, natural: { w: 0, h: 0 }, rect: { x: 0, y: 0, w: 300, h: 200 }, timing: { ms: SIGAME_LIMITS.slowLoadMs * 2 + 1, bytes: 1 } };
    expect(shotIssues(shot(measure({ videos: [video] })), phone).map((i) => i.rule)).toEqual(["codec", "slow"]);
    expect(shotIssues(shot(measure({ videos: [video] }), pc.id), pc).map((i) => i.rule)).toEqual(["codec"]);
    const slowImg = img([800, 600], [362, 272], { timing: { ms: SIGAME_LIMITS.slowLoadMs + 1, bytes: 1 } });
    expect(shotIssues(shot(measure({ images: [slowImg] })), phone).map((i) => i.rule)).toEqual(["slow"]);
    const okImg = img([800, 600], [362, 272], { timing: { ms: SIGAME_LIMITS.slowLoadMs, bytes: 1 } });
    expect(shotIssues(shot(measure({ images: [okImg] })), phone)).toEqual([]);
  });

  it("мегапиксели iPhone — по правилам, только на телефоне", () => {
    const big = img([5000, 4000], [362, 290]);
    const r = shotIssues(shot(measure({ images: [big] })), phone);
    expect(r.map((i) => [i.rule, i.source])).toEqual([["megapixels", "rules"]]);
    expect(shotIssues(shot(measure({ images: [big] }), pc.id), pc)).toEqual([]);
  });

  it("кнопки ответов против картинки и мелкий шрифт", () => {
    const m = measure({
      images: [img([800, 600], [100, 75])],
      content: { x: 0, y: 0, w: 100, h: 75 },
      optionsArea: { x: 0, y: 0, w: 362, h: 300 },
      options: [{ text: "A", rect: { x: 0, y: 0, w: 100, h: 50 }, font: SIGAME_LIMITS.minOptionFont - 1 }],
    });
    expect(shotIssues(shot(m, pc.id), pc).map((i) => i.rule)).toEqual(["options", "optionFont"]);
    const ok = measure({
      images: [img([800, 600], [362, 272])],
      optionsArea: { x: 0, y: 0, w: 362, h: 100 },
      options: [{ text: "A", rect: { x: 0, y: 0, w: 100, h: 50 }, font: SIGAME_LIMITS.minOptionFont }],
    });
    expect(shotIssues(shot(ok, pc.id), pc)).toEqual([]);
  });

  it("текст не помещается", () => {
    const r = shotIssues(shot(measure({ texts: [{ text: "длинный", rect: { x: 0, y: 0, w: 1, h: 1 }, font: 12, overflow: true }] })), phone);
    expect(r.map((i) => i.rule)).toEqual(["overflow"]);
  });

  it("слияние: одна беда с разных экранов — одна строка с худшим случаем", () => {
    const at = { round: 0, theme: 1, question: 2 };
    const base = { rule: "stretch", subject: "a.png", level: "warn" as const, source: "table" as const };
    const r = mergeShotIssues(at, [
      { issue: { ...base, text: "в 3 раза", score: 3 }, profile: "phone" },
      { issue: { ...base, text: "в 9 раз", score: 9 }, profile: "pc" },
      { issue: { ...base, text: "в 3 раза", score: 3 }, profile: "phone" },
      { issue: { ...base, subject: "b.png", text: "другая", score: 1 }, profile: "pc" },
    ]);
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ level: "warn", text: "в 9 раз — экраны: «Телефон», «Компьютер»", at, profiles: ["phone", "pc"], source: "table" });
    expect(r[1].text).toBe("другая — экран: «Компьютер»");
  });
});

describe("отчёт целиком", () => {
  const round = (over: Partial<RoundEvent> = {}): RoundEvent => ({
    type: "round", round: 0, name: "Раунд 1", final: false, played: 1, timedOut: false,
    messages: msgs("CHOICE|0|0", "CONTENT|screen|0|image|http://h/package/Images/H.png", "QUESTION_END"),
    questions: [{ theme: 0, question: 0, start: 0, end: 2, type: "simple" }],
    media: [], errors: [], names: { "H.png": "флаг.png" }, ...over,
  });

  it("пак, который SIGame видит не целиком (пустой <info />)", () => {
    const r = buildReport({
      open: { ok: false, file: { rounds: 1, themes: 3, questions: 3 }, sigame: { rounds: 1, themes: 1, questions: 0 },
        lost: [{ kind: "questions", round: 0, theme: 0, name: "Первая", file: 1, seen: 0 }, { kind: "theme", round: 0, theme: 1, name: "Вторая", seenAs: null }, { kind: "theme", round: 0, theme: 2, name: "Третья", seenAs: "Первая" }] },
      missing: [], rounds: [], shots: [],
    });
    expect(r.opened).toBe(false);
    expect(r.expected).toBe(3);
    expect(r.issues.map((i) => i.text)).toEqual([
      "SIGame видит в теме «Первая» вопросов: 0 из 1",
      "SIGame не видит тему «Вторая»",
      "SIGame видит тему «Первая» на месте «Третья»",
    ]);
    expect(r.issues.every((i) => i.level === "error" && i.source === "engine")).toBe(true);
    expect(r.issues[1].at).toEqual({ round: 0, theme: 1 });
  });

  it("не открылся вовсе и потерянный раунд", () => {
    const r = buildReport({ open: { ok: false, error: "XmlException: x", file: { rounds: 2, themes: 0, questions: 0 }, lost: [{ kind: "round", round: 1, name: "Финал" }] }, missing: [], rounds: [], shots: [] });
    expect(r.issues.map((i) => i.text)).toEqual(["SIGame не открывает пак: XmlException: x", "SIGame не видит раунд «Финал»"]);
    expect(r.openError).toBe("XmlException: x");
  });

  it("файлы: не найден, не отдан раздачей; застрявшая игра; недоигранный вопрос", () => {
    const r = buildReport({
      open: { ok: true, file: { rounds: 1, themes: 1, questions: 2 }, sigame: { rounds: 1, themes: 1, questions: 2 } },
      missing: [{ round: 0, theme: 0, question: 1, kind: "image", name: "photo.png" }],
      rounds: [round({
        timedOut: true, errors: ["движок: сбой"],
        questions: [{ theme: 0, question: 0, start: 0, end: 2 }, { theme: 0, question: 1, start: 3, end: -1 }],
        media: [{ question: 0, kind: "image", uri: "u", url: "http://h/package/Images/H.png", status: 404, ms: 1 }, { question: 0, kind: "image", uri: "u", url: "http://h/ok.png", status: 200, ms: 1 }],
      })],
      shots: [], done: { played: 1, expected: 2, seconds: 3 },
    });
    const texts = r.issues.map((i) => i.text);
    expect(texts).toContain("SIGame не находит файл photo.png — вместо него игроки увидят «Файл не найден в пакете»");
    expect(texts).toContain("Раздача SIGame не отдаёт картинку флаг.png: ответ 404");
    expect(texts).toContain("Раунд «Раунд 1»: игра застряла и не дошла до конца");
    expect(texts).toContain("Игра не доиграла этот вопрос до конца");
    expect(r.issues.find((i) => i.text.includes("сбой"))?.level).toBe("warn");
    expect(r.issues[r.issues.length - 1].level).toBe("warn");
    expect(r.played).toBe(1);
    expect(r.seconds).toBe(3);
    expect(r.questions.map((q) => q.at)).toEqual([{ round: 0, theme: 0, question: 0 }, { round: 0, theme: 0, question: 1 }]);
  });

  it("снимки ложатся в свой вопрос, беды сливаются, имена файлов — из пака", () => {
    const m = measure({ images: [img([10, 10], [346, 346], { src: "http://h/package/Images/H.png" })] });
    const r = buildReport({
      open: { ok: true, file: { rounds: 1, themes: 1, questions: 1 } },
      missing: [], rounds: [round()],
      shots: [{ ...shot(m, "pc"), file: "b.jpg" }, { ...shot(m), screen: { question: 0, at: 2, part: "answer", n: 1 }, file: "c.jpg" }, { ...shot(m), file: "a.jpg" }],
    });
    expect(r.questions[0].shots).toEqual([
      { profile: "phone", part: "question", n: 1, file: "a.jpg" },
      { profile: "phone", part: "answer", n: 1, file: "c.jpg" },
      { profile: "pc", part: "question", n: 1, file: "b.jpg" },
    ]);
    expect(r.questions[0].issues).toHaveLength(1);
    expect(r.questions[0].issues[0].text).toMatch(/^Картинка флаг\.png \(10×10\) растянута до 346×346 — в 34\.6 раза.*экраны: «Телефон», «Компьютер»$/);
    expect(r.issues).toEqual(r.questions[0].issues);
    expect(r.played).toBe(1);
  });

  it("снимок без вопроса и неизвестный профиль — пропускаются", () => {
    const r = buildReport({
      open: { ok: true, file: { rounds: 1, themes: 1, questions: 1 } }, missing: [], rounds: [round()],
      shots: [{ ...shot(measure()), screen: { question: 5, at: 0, part: "question", n: 1 } }, { ...shot(measure({ images: [img([0, 0], [1, 1])] })), profile: "pc" }],
    }, [phone]);
    expect(r.questions[0].shots).toHaveLength(1);
    expect(r.issues).toEqual([]);
  });
});

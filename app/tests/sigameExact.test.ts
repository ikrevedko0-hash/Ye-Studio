// Точные ожидания для «Прогона в SIGame»: формулировки, которые читает автор пака, границы порогов, порядок.
// Дополняет sigame.test.ts — там сценарии, здесь то, что ловит мутационное тестирование (npm run mutate).

import { describe, expect, it } from "vitest";
import { engineProgress, parseRunnerLine, type RecordedMessage, type RoundEvent } from "../src/core/sigame/protocol";
import { buildReport, IOS_BAD_VIDEO, mergeShotIssues, PROFILES, shotIssues, type Shot, type TableMeasure } from "../src/core/sigame/report";
import { MAX_SCREENS_PER_PART, questionScreens } from "../src/core/sigame/screens";

const phone = PROFILES[0];
const pc = PROFILES[2];
const msgs = (...texts: string[]): RecordedMessage[] => texts.map((t, i) => [i * 10, t.replace(/\|/g, "\n")]);

function measure(over: Partial<TableMeasure> = {}): TableMeasure {
  return {
    viewport: { w: 390, h: 844 }, table: { x: 0, y: 190, w: 390, h: 557 },
    content: { x: 14, y: 249, w: 362, h: 346 }, optionsArea: null,
    images: [], videos: [], options: [], texts: [], errors: [], ...over,
  };
}
type Img = TableMeasure["images"][0];
const img = (natural: [number, number], rect: [number, number], extra: Partial<Img> = {}): Img => ({
  src: "http://127.0.0.1:1/package/Images/ABC.png", complete: true, natural: { w: natural[0], h: natural[1] },
  rect: { x: 0, y: 0, w: rect[0], h: rect[1] }, inOption: false, timing: null, ...extra,
});
const video = (extra: Partial<TableMeasure["videos"][0]> = {}): TableMeasure["videos"][0] => ({
  src: "http://h/package/Video/V.mp4", readyState: 4, error: 0, natural: { w: 640, h: 360 }, rect: { x: 0, y: 0, w: 362, h: 204 }, timing: null, ...extra,
});
const shot = (m: TableMeasure, profile = phone.id, settle = { waitedMs: 700, stillLoading: 0 }): Shot => ({
  round: 0, screen: { question: 0, at: 3, part: "question", n: 1 }, profile, measure: m, settle,
});
const issue = (rule: string, subject: string, level: "error" | "warn", text: string, score = 1, source: "table" | "rules" = "table") => ({ rule, subject, level, text, score, source });

describe("профили и списки", () => {
  it("экраны прогона — как у игроков", () => {
    expect(PROFILES).toEqual([
      { id: "phone", title: "Телефон", width: 390, height: 844, scale: 3, mobile: true, network: { latencyMs: 100, downBytesPerSec: 500_000 } },
      { id: "phoneLand", title: "Телефон лёжа", width: 844, height: 390, scale: 3, mobile: true },
      { id: "pc", title: "Компьютер", width: 1920, height: 1080, scale: 1, mobile: false },
    ]);
    expect([...IOS_BAD_VIDEO]).toEqual(["webm", "mkv", "avi", "flv", "wmv", "ogv"]);
  });

  it("все типы событий стенда принимаются", () => {
    for (const type of ["start", "open", "refs", "round", "done", "progress"]) expect(parseRunnerLine(`{"type":"${type}"}`)).toEqual({ type });
    expect(parseRunnerLine('{"type":""}')).toBeNull();
  });
});

describe("экраны: границы", () => {
  it("CONTENT и RIGHTANSWER — только в начале сообщения", () => {
    const m = msgs("CHOICE|0|0", "CONTENT|screen|0|text|В", "X_CONTENT|y", "X_RIGHTANSWER|text|О", "CONTENT|screen|0|text|Ещё", "QUESTION_END");
    expect(questionScreens(m, { theme: 0, question: 0, start: 0, end: 5 }, 0)).toEqual([{ question: 0, at: 1, part: "question", n: 1 }, { question: 0, at: 4, part: "question", n: 2 }]);
    // сообщение без аргументов — тоже экран; с продолжением имени — нет
    expect(questionScreens(msgs("LAYOUT", "LAYOUTX"), { theme: 0, question: 0, start: 0, end: 1 }, 0).map((x) => x.at)).toEqual([0]);
  });

  it("RIGHT_ANSWER_START без медиа следом — не экран (ждём CONTENT)", () => {
    const m = msgs("CHOICE|0|0", "CONTENT|screen|0|text|В", "RIGHT_ANSWER_START", "QUESTION_END");
    expect(questionScreens(m, { theme: 0, question: 0, start: 0, end: 3 }, 0).map((s) => s.part)).toEqual(["question"]);
  });

  it("вопрос кончается на CONTENT, а следом CONTENT следующего — экран на конце вопроса", () => {
    const m = msgs("CONTENT|screen|0|text|A", "CONTENT|screen|0|text|B");
    expect(questionScreens(m, { theme: 0, question: 0, start: 0, end: 0 }, 0)).toEqual([{ question: 0, at: 0, part: "question", n: 1 }]);
  });

  it("предел экранов считается для каждой части отдельно", () => {
    const parts = Array.from({ length: MAX_SCREENS_PER_PART + 2 }, (_, i) => [`CONTENT|screen|0|text|${i}`, "TIMER|1"]).flat();
    const m = msgs("CHOICE|0|0", ...parts, "RIGHTANSWER|text|О", "QUESTION_END");
    const s = questionScreens(m, { theme: 0, question: 0, start: 0, end: m.length - 1 }, 0);
    expect(s.map((x) => [x.part, x.n])).toEqual([["question", 1], ["question", 2], ["question", 3], ["question", 6], ["answer", 1]]);
  });
});

describe("правила снимка: точные тексты", () => {
  it("ошибки загрузки по видам; без адреса — по сообщению; посторонние — нет", () => {
    const r = shotIssues(shot(measure({
      errors: [
        { kind: "img", message: "net::ERR", url: null },
        { kind: "audio", message: "MediaError 2", url: "http://h/package/Audio/A%20B.mp3" },
        { kind: "fetch", message: "404", url: "http://h/package/Images/H.png" },
        { kind: "video", message: "MediaError 4", url: "http://h/package/Video/V.mp4" },
        { kind: "script", message: "шум", url: "http://h/x.js" },
      ],
    }), pc.id), pc, { "H.png": "флаг.png" });
    expect(r).toEqual([
      issue("load", "net::ERR", "error", "Картинка не загрузилось у игрока: net::ERR"),
      issue("load", "A B.mp3", "error", "Звук не загрузилось у игрока: A B.mp3 — MediaError 2"),
      issue("load", "флаг.png", "error", "Файл не загрузилось у игрока: флаг.png — 404"),
      issue("load", "V.mp4", "error", "Видео не загрузилось у игрока: V.mp4 — MediaError 4"),
    ]);
  });

  it("не догрузилось — сколько ждали, в секундах", () => {
    expect(shotIssues(shot(measure(), pc.id, { waitedMs: 12400, stillLoading: 1 }), pc)).toEqual([issue("pending", "", "error", "Медиа так и не догрузилось за 12 с")]);
  });

  it("битая картинка; ещё не загруженная — не беда", () => {
    expect(shotIssues(shot(measure({ images: [img([0, 0], [362, 272])] }), pc.id), pc)).toEqual([
      issue("broken", "ABC.png", "error", "Картинка ABC.png не показалась (битый файл или формат, который браузер не открывает)"),
    ]);
    expect(shotIssues(shot(measure({ images: [img([0, 0], [362, 272], { complete: false })] }), pc.id), pc)).toEqual([]);
  });

  it("растяжение — по меньшему из коэффициентов", () => {
    expect(shotIssues(shot(measure({ images: [img([100, 50], [300, 200])] }), pc.id), pc)).toEqual([
      issue("stretch", "ABC.png", "warn", "Картинка ABC.png (100×50) растянута до 300×200 — в 3.0 раза, будет мыльной", 3),
    ]);
  });

  it("мегапиксели: ровно 16.7 — можно, больше — нет", () => {
    expect(shotIssues(shot(measure({ images: [img([5000, 3340], [362, 242])] })), phone)).toEqual([]);
    expect(shotIssues(shot(measure({ images: [img([5000, 3341], [362, 242])] })), phone)).toEqual([
      issue("megapixels", "ABC.png", "warn", "Картинка ABC.png — 17 Мп: iPhone может её не показать (больше 16.7 Мп)", 16.705, "rules"),
    ]);
  });

  it("мелкая на телефоне: текст, доля экрана и вес", () => {
    const share = (200 * 100) / (390 * 844);
    expect(shotIssues(shot(measure({ content: null, images: [img([800, 400], [200, 100])] })), phone)).toEqual([
      issue("small", "ABC.png", "warn", "Картинка ABC.png на телефоне всего 200×100 (6% экрана)", 1 / share),
    ]);
    // короткая сторона меньше порога, хотя доля большая
    expect(shotIssues(shot(measure({ content: null, images: [img([130, 400], [130, 400])] })), phone).map((i) => i.text)).toEqual([
      "Картинка ABC.png на телефоне всего 130×400 (16% экрана)",
    ]);
    // совсем крошечная — вес ограничен сверху
    expect(shotIssues(shot(measure({ content: null, images: [img([10, 10], [10, 10])] })), phone)[0]).toEqual(
      issue("small", "ABC.png", "warn", "Картинка ABC.png на телефоне всего 10×10 (0% экрана)", 1000),
    );
  });

  it("мелкая: порог доли экрана и «заполняет область» — на самой границе не беда", () => {
    const vp = { viewport: { w: 1000, h: 1000 }, content: null };
    expect(shotIssues(shot(measure({ ...vp, images: [img([200, 300], [200, 300])] })), phone)).toEqual([]);
    expect(shotIssues(shot(measure({ ...vp, images: [img([150, 300], [150, 300])] })), phone).map((i) => i.rule)).toEqual(["small"]);
    const fill = measure({ content: { x: 0, y: 0, w: 100, h: 1000 }, images: [img([90, 90], [90, 90])] });
    expect(shotIssues(shot(fill), phone)).toEqual([]);
    const notFill = measure({ content: { x: 0, y: 0, w: 100, h: 1000 }, images: [img([89, 89], [89, 89])] });
    expect(shotIssues(shot(notFill), phone).map((i) => i.rule)).toEqual(["small"]);
  });

  it("медленная картинка", () => {
    expect(shotIssues(shot(measure({ images: [img([800, 600], [362, 272], { timing: { ms: 6500, bytes: 1 } })] })), phone)).toEqual([
      issue("slow", "ABC.png", "warn", "Картинка ABC.png грузится на мобильной сети 6.5 с", 6500),
    ]);
  });

  it("видео: кодек, прочие ошибки, медленная загрузка с порогом вдвое больше", () => {
    expect(shotIssues(shot(measure({ videos: [video({ error: 4 })] })), phone)).toEqual([issue("codec", "V.mp4", "error", "Видео V.mp4 браузер не играет (кодек или формат)")]);
    expect(shotIssues(shot(measure({ videos: [video({ error: 3 })] })), phone)).toEqual([issue("video", "V.mp4", "error", "Видео V.mp4: ошибка воспроизведения 3")]);
    expect(shotIssues(shot(measure({ videos: [video({ timing: { ms: 6000, bytes: 1 } })] })), phone)).toEqual([]);
    expect(shotIssues(shot(measure({ videos: [video({ timing: { ms: 10000, bytes: 1 } })] })), phone)).toEqual([]);
    expect(shotIssues(shot(measure({ videos: [video({ timing: { ms: 10001, bytes: 1 } })] })), phone)).toEqual([
      issue("slow", "V.mp4", "warn", "Видео V.mp4 грузится на мобильной сети 10.0 с", 10001),
    ]);
    expect(shotIssues(shot(measure({ videos: [video({ timing: { ms: 60000, bytes: 1 } })] }), pc.id), pc)).toEqual([]);
  });

  it("кнопки против картинки: берётся самая крупная картинка вне вариантов", () => {
    const images = [img([50, 50], [50, 50]), img([30, 30], [30, 30]), img([100, 100], [100, 100]), img([400, 400], [400, 400], { inOption: true })];
    const options = [{ text: "A", rect: { x: 0, y: 0, w: 100, h: 50 }, font: 14 }];
    expect(shotIssues(shot(measure({ images, options, optionsArea: { x: 0, y: 0, w: 300, h: 100 } }), pc.id), pc)).toEqual([
      issue("options", "", "warn", "Кнопки ответов занимают в 3.0 раза больше места, чем картинка (100×100)", 3),
    ]);
    // ровно в полтора раза — ещё можно
    expect(shotIssues(shot(measure({ images: [img([100, 100], [100, 100])], options, optionsArea: { x: 0, y: 0, w: 150, h: 100 } }), pc.id), pc)).toEqual([]);
    // без картинки, без области кнопок, без самих кнопок — не с чем сравнивать
    expect(shotIssues(shot(measure({ options, optionsArea: { x: 0, y: 0, w: 300, h: 100 } }), pc.id), pc)).toEqual([]);
    expect(shotIssues(shot(measure({ images: [img([100, 100], [100, 100])], options }), pc.id), pc)).toEqual([]);
    expect(shotIssues(shot(measure({ images: [img([100, 100], [100, 100])], optionsArea: { x: 0, y: 0, w: 300, h: 100 } }), pc.id), pc)).toEqual([]);
  });

  it("мелкий шрифт вариантов — по первому мелкому; 0 (не измерен) не считается", () => {
    const o = (font: number) => ({ text: "A", rect: { x: 0, y: 0, w: 10, h: 10 }, font });
    expect(shotIssues(shot(measure({ options: [o(0), o(12), o(9), o(10)] }), pc.id), pc)).toEqual([
      issue("optionFont", "", "warn", "Варианты ответа мелким шрифтом (9px)", 1 / 9),
    ]);
    expect(shotIssues(shot(measure({ options: [o(0)] }), pc.id), pc)).toEqual([]);
  });

  it("текст не помещается", () => {
    const t = (overflow: boolean) => ({ text: "т", rect: { x: 0, y: 0, w: 1, h: 1 }, font: 12, overflow });
    expect(shotIssues(shot(measure({ texts: [t(false), t(true)] }), pc.id), pc)).toEqual([issue("overflow", "", "warn", "Текст вопроса не помещается на экран")]);
    expect(shotIssues(shot(measure({ texts: [t(false)] }), pc.id), pc)).toEqual([]);
  });

  it("слияние: при равной тяжести остаётся первый текст", () => {
    const base = { rule: "r", subject: "s", level: "warn" as const, score: 2, source: "table" as const };
    const r = mergeShotIssues({ round: 0 }, [{ issue: { ...base, text: "первый" }, profile: "pc" }, { issue: { ...base, text: "второй" }, profile: "phoneLand" }]);
    expect(r.map((i) => [i.text, i.profiles])).toEqual([["первый — экраны: «Телефон лёжа», «Компьютер»", ["phoneLand", "pc"]]]);
  });
});

describe("отчёт: точные записи", () => {
  const round = (over: Partial<RoundEvent> = {}): RoundEvent => ({
    type: "round", round: 0, name: "Раунд 1", final: false, played: 1, timedOut: false,
    messages: msgs("CHOICE|0|0", "CONTENT|screen|0|text|В", "QUESTION_END"),
    questions: [{ theme: 0, question: 0, start: 0, end: 2, type: "simple" }],
    media: [], errors: [], ...over,
  });
  const shape = { rounds: 1, themes: 1, questions: 1 };

  it("без события open: пак не открыт, вопросов по done или 0", () => {
    const a = buildReport({ missing: [], rounds: [], shots: [] });
    expect(a).toEqual({ opened: false, openError: undefined, file: undefined, sigame: undefined, played: 0, expected: 0, seconds: 0, issues: [], questions: [] });
    expect(buildReport({ missing: [], rounds: [], shots: [], done: { played: 2, expected: 7, seconds: 1 } }).expected).toBe(7);
    const b = buildReport({ open: { ok: true, file: { rounds: 1, themes: 1, questions: 4 }, sigame: shape }, missing: [], rounds: [], shots: [], done: { played: 2, expected: 7, seconds: 1 } });
    expect([b.opened, b.expected, b.file, b.sigame]).toEqual([true, 4, { rounds: 1, themes: 1, questions: 4 }, shape]);
  });

  it("не открылся без списка потерь — только ошибка", () => {
    const r = buildReport({ open: { ok: false, error: "сбой", file: shape }, missing: [], rounds: [], shots: [] });
    expect(r.issues.map((i) => i.text)).toEqual(["SIGame не открывает пак: сбой"]);
  });

  it("открылся — потери и ошибка не выводятся", () => {
    const r = buildReport({ open: { ok: true, error: "x", file: shape, lost: [{ kind: "round", round: 0, name: "Р" }] }, missing: [], rounds: [], shots: [] });
    expect(r.issues).toEqual([]);
  });

  it("беды движка — целиком, с местом и источником", () => {
    const r = buildReport({
      open: { ok: false, error: "сбой", file: shape, lost: [{ kind: "round", round: 1, name: "Финал" }, { kind: "questions", round: 0, theme: 2, name: "Т", file: 3, seen: 1 }] },
      missing: [{ round: 0, theme: 1, question: 2, kind: "image", name: "p.png" }],
      rounds: [round({ timedOut: true, errors: ["e1"], questions: [{ theme: 0, question: 0, start: 0, end: 0 }, { theme: 0, question: 1, start: 1, end: -1 }] })],
      shots: [],
    });
    const eng = { profiles: [], source: "engine" };
    expect(r.issues).toEqual([
      { level: "error", text: "SIGame не открывает пак: сбой", ...eng },
      { level: "error", text: "SIGame не видит раунд «Финал»", at: { round: 1, theme: undefined }, ...eng },
      { level: "error", text: "SIGame видит в теме «Т» вопросов: 1 из 3", at: { round: 0, theme: 2 }, ...eng },
      { level: "error", text: "SIGame не находит файл p.png — вместо него игроки увидят «Файл не найден в пакете»", at: { round: 0, theme: 1, question: 2 }, ...eng },
      { level: "error", text: "Раунд «Раунд 1»: игра застряла и не дошла до конца", at: { round: 0 }, ...eng },
      { level: "error", text: "Игра не доиграла этот вопрос до конца", at: { round: 0, theme: 0, question: 1 }, ...eng },
      { level: "warn", text: "Раунд «Раунд 1»: e1", at: { round: 0 }, ...eng },
    ]);
    // без done — сыгранные считаются по вопросам, дошедшим до конца
    expect(r.played).toBe(1);
    expect(r.questions.map((q) => q.type)).toEqual([undefined, undefined]);
  });

  it("раздача медиа: вид, причина, привязка к своему вопросу", () => {
    const f = (question: number, kind: string, status: number, error?: string) => ({ question, kind, uri: "u", url: `http://h/package/X/${kind}.bin`, status, ms: 1, error });
    const r = buildReport({
      open: { ok: true, file: shape }, missing: [], shots: [],
      rounds: [round({
        questions: [{ theme: 0, question: 0, start: 0, end: 2 }, { theme: 0, question: 1, start: 3, end: 5 }],
        media: [f(0, "video", 0, "ECONNREFUSED"), f(0, "audio", 0), f(0, "image", 200), f(1, "other", 500), f(1, "image", 404)],
        names: { "image.bin": "картинка.png" },
      })],
    });
    expect(r.questions.map((q) => q.issues.map((i) => i.text))).toEqual([
      ["Раздача SIGame не отдаёт видео video.bin: ECONNREFUSED", "Раздача SIGame не отдаёт звук audio.bin: нет ответа"],
      ["Раздача SIGame не отдаёт файл other.bin: ответ 500", "Раздача SIGame не отдаёт картинку картинка.png: ответ 404"],
    ]);
    expect(r.questions[1].issues[0]).toEqual({ level: "error", text: "Раздача SIGame не отдаёт файл other.bin: ответ 500", at: { round: 0, theme: 0, question: 1 }, profiles: [], source: "engine" });
  });

  it("вопросы по порядку раунд → тема → вопрос; снимки в свой раунд; порядок снимков", () => {
    const qs = (...q: [number, number][]) => q.map(([theme, question], i) => ({ theme, question, start: i, end: i }));
    const r1 = round({ round: 1, name: "Раунд 2", questions: qs([0, 0]) });
    const r0 = round({ questions: qs([1, 0], [0, 1], [0, 0]) });
    const s = (round: number, question: number, profile: Shot["profile"], part: "question" | "answer", n: number): Shot =>
      ({ round, screen: { question, at: 0, part, n }, profile, measure: measure(), settle: { waitedMs: 0, stillLoading: 0 }, file: `${round}${question}${profile}${part}${n}` });
    const r = buildReport({
      open: { ok: true, file: shape }, missing: [], rounds: [r1, r0],
      shots: [s(1, 0, "pc", "question", 1), s(0, 0, "pc", "answer", 1), s(0, 0, "pc", "question", 2), s(0, 0, "phone", "question", 1), s(0, 0, "pc", "question", 1), s(0, 0, "phoneLand", "question", 1), s(7, 0, "pc", "question", 1)],
    }, [phone, pc]);
    expect(r.questions.map((q) => [q.at.round, q.at.theme, q.at.question])).toEqual([[0, 0, 0], [0, 0, 1], [0, 1, 0], [1, 0, 0]]);
    expect(r.questions[2].shots.map((x) => x.file)).toEqual(["00phonequestion1", "00pcquestion1", "00pcquestion2", "00pcanswer1", "00phoneLandquestion1"]);
    expect(r.questions[3].shots.map((x) => x.file)).toEqual(["10pcquestion1"]);
    expect(r.questions[0].shots).toEqual([]);
  });

  it("снимки одного экрана: вопрос раньше ответа, внутри — по номеру, при любом порядке готовности", () => {
    const orders = [["a2", "q2", "a1", "q1", "q3"], ["q3", "a1", "q1", "a2", "q2"], ["q1", "q2", "q3", "a1", "a2"], ["a1", "a2", "q3", "q2", "q1"]];
    for (const o of orders) {
      const shots = o.map((k): Shot => ({ round: 0, screen: { question: 0, at: 0, part: k[0] === "q" ? "question" : "answer", n: Number(k[1]) }, profile: "phone", measure: measure(), settle: { waitedMs: 0, stillLoading: 0 }, file: k }));
      const r = buildReport({ open: { ok: true, file: shape }, missing: [], rounds: [round()], shots });
      expect(r.questions[0].shots.map((x) => x.file)).toEqual(["q1", "q2", "q3", "a1", "a2"]);
    }
  });
});

describe("ход игры в окне", () => {
  it("раунды идут параллельно: общий счёт сыгранных и что играется сейчас, по порядку раундов", () => {
    const m = new Map([
      [2, { name: "Финал", question: 3, ended: 3, total: 3, done: true }],
      [1, { name: "Второй", question: 5, ended: 4, total: 30 }],
      [0, { name: "Первый", question: 17, ended: 16, total: 30 }],
    ]);
    expect(engineProgress(m)).toEqual({ done: 23, total: 63, text: "SIGame играет пак: сыграно вопросов 23 из 63 · сейчас «Первый» 17 из 30, «Второй» 5 из 30" });
  });

  it("всё сыграно — без «сейчас»; лишние вопросы сверх числа в раунде не считаются", () => {
    expect(engineProgress(new Map([[0, { name: "Р", question: 12, ended: 12, total: 10 }]]))).toEqual({ done: 10, total: 10, text: "SIGame играет пак: сыграно вопросов 10 из 10 · сейчас «Р» 10 из 10" });
    expect(engineProgress(new Map([[0, { name: "Р", question: 4, ended: 2, total: 10, done: true }]]))).toEqual({ done: 10, total: 10, text: "SIGame играет пак: сыграно вопросов 10 из 10" });
    expect(engineProgress(new Map())).toEqual({ done: 0, total: 0, text: "SIGame играет пак: сыграно вопросов 0 из 0" });
  });
});

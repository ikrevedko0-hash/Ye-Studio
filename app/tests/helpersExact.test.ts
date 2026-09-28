// Операции над моделью пака (core/siq/helpers.ts): точные проверки по выжившим мутантам Stryker.
// Каждый блок — одна функция: обычный случай, границы, пути отказа.

import { describe, expect, it } from "vitest";
import {
  allItems, answerDuration, appendMedia, applyTimeDefaults, clearAllComments, contentGroups, countComments,
  defaultTimedIndex, findParam, formatDuration, getOptions, isMediaUsed, isRef, isWithNext, itemDefaultTime,
  itemGameTime, itemKind, MEDIA_EXT, mediaKindByName, newPackage, newQuestion, newRound, newTheme, OPTION_LETTERS,
  packStats, paramItems, parseDuration, parsePoint, pointDeviation, pointHit, pointImage, pointProblems,
  questionText, renameThemeMedia, replaceQuestionImage, secretPrice, setAnswerDuration, setOptions, setParamText,
  setPoint, setPointDeviation, setPointMode, setQuestionType, setSecretPrice, setWithNext, slotStatus,
  SPECIAL_SHORT, SPECIAL_TYPES, themeMediaRefs, withDuration, withTimeDefaults,
} from "../src/core/siq/helpers";
import type { ContentItem, Package, Param, Question, Theme } from "../src/core/siq/model";

const text = (value: string, extra: Partial<ContentItem> = {}): ContentItem => ({ value, ...extra });
const image = (value: string, extra: Partial<ContentItem> = {}): ContentItem => ({ type: "image", isRef: "True", value, ...extra });
const content = (name: string, items: ContentItem[]): Param => ({ name, type: "content", children: items.map((item) => ({ kind: "item", item })) });
const question = (items: ContentItem[], right: string[] = ["о"], more: Param[] = []): Question => ({ price: "100", params: [content("question", items), ...more], right });
const pkgOf = (...questions: Question[]): Package => ({ attrs: [], order: [], rounds: [{ name: "Р", themes: [{ name: "Т", questions }] }] });

describe("справочники", () => {
  it("названия спецвопросов", () => {
    expect(SPECIAL_TYPES).toEqual({ secret: "Кот в мешке", secretPublicPrice: "Кот (цена известна)", secretNoQuestion: "Кот без вопроса", stake: "Аукцион", stakeAll: "Ставка для всех", noRisk: "Без риска", forAll: "Вопрос для всех" });
    expect(SPECIAL_SHORT).toEqual({ secret: "КОТ", secretPublicPrice: "КОТ", secretNoQuestion: "КОТ", stake: "СТАВКА", stakeAll: "СТАВКА", noRisk: "БЕЗ РИСКА", forAll: "ДЛЯ ВСЕХ" });
    expect(OPTION_LETTERS).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);
  });

  it("расширения медиа", () => {
    expect(MEDIA_EXT).toEqual({
      jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image", bmp: "image",
      mp3: "audio", wav: "audio", ogg: "audio", m4a: "audio", aac: "audio", flac: "audio",
      mp4: "video", webm: "video", mkv: "video", mov: "video", avi: "video",
    });
    expect(mediaKindByName("A.JPG")).toBe("image");
    expect(mediaKindByName("x.tar.MP3")).toBe("audio");
    expect(mediaKindByName("без расширения")).toBeUndefined();
    expect(mediaKindByName("x.txt")).toBeUndefined();
    expect(mediaKindByName("")).toBeUndefined();
  });
});

describe("элементы", () => {
  it("findParam и paramItems: без params, вложенные параметры и numberSet — не элементы", () => {
    expect(findParam({ price: "1", right: [] }, "question")).toBeUndefined();
    const p: Param = { name: "g", children: [{ kind: "item", item: text("a") }, { kind: "param", param: content("x", [text("b")]) }, { kind: "numberSet", numberSet: {} }, { kind: "item", item: text("c") }] };
    expect(paramItems(p).map((i) => i.value)).toEqual(["a", "c"]);
    expect(paramItems(undefined)).toEqual([]);
  });

  it("itemKind, isRef, isWithNext", () => {
    expect([undefined, "IMAGE", "Audio", "video", "html", "voice", "Voice", "что-то", ""].map((type) => itemKind({ type, value: "" })))
      .toEqual(["text", "image", "audio", "video", "html", "audio", "audio", "text", "text"]);
    expect([undefined, "True", "true", "False", ""].map((isRef_) => isRef({ isRef: isRef_, value: "" }))).toEqual([false, true, true, false, false]);
    expect([undefined, "False", "false", "True", ""].map((w) => isWithNext({ waitForFinish: w, value: "" }))).toEqual([false, true, true, false, false]);
  });

  it("setWithNext: включить, выключить, чужие не трогать", () => {
    const items = [text("a"), text("b", { waitForFinish: "False" })];
    const on = setWithNext(items, 0, true);
    expect(on[0]).toEqual({ value: "a", waitForFinish: "False" });
    expect(on[1]).toBe(items[1]);
    const off = setWithNext(items, 1, false);
    expect(off[1]).toStrictEqual({ value: "b" });
    expect(off[0]).toBe(items[0]);
  });

  it("contentGroups: «вместе со следующим» склеивает; у последнего — группа всё равно закрывается", () => {
    const w = { waitForFinish: "False" };
    expect(contentGroups([text("a", w), text("b"), text("c")])).toEqual([[0, 1], [2]]);
    expect(contentGroups([text("a"), text("b", w)])).toEqual([[0], [1]]);
    expect(contentGroups([text("a", w), text("b", w)])).toEqual([[0, 1]]);
    expect(contentGroups([])).toEqual([]);
  });

  it("appendMedia: подпись последним — медиа перед ней и одним экраном; фон — отдельно перед", () => {
    const img = image("a.png");
    const bg = { type: "audio", isRef: "True", value: "m.mp3", placement: "background" };
    const items = [text("вопрос")];
    expect(appendMedia(items, [])).toBe(items);
    expect(appendMedia(items, [img, bg])).toEqual([bg, { ...img, waitForFinish: "False" }, text("вопрос")]);
    // без подписи — просто в конец
    for (const before of [[], [text("   ")], [text("x", { placement: "replic" })], [image("b.png")], [text("x", { placement: "background" })]]) {
      expect(appendMedia(before, [img, bg])).toEqual([...before, img, bg]);
    }
    expect(appendMedia([text("x", { placement: "screen" })], [img])).toEqual([{ ...img, waitForFinish: "False" }, text("x", { placement: "screen" })]);
  });
});

describe("время", () => {
  it("parseDuration", () => {
    expect(["00:00:10", "1:30", "10", "01:00:00", "00:00:02.5"].map(parseDuration)).toEqual([10, 90, 10, 3600, 2.5]);
    expect([undefined, "", "00:00:00", "0", "x", "0:0:abc", "-5"].map(parseDuration)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it("itemGameTime: текст — чтение + пауза, своё время, ответ, медиа, «вместе со следующим»", () => {
    const t40 = text("x".repeat(40));
    expect(itemGameTime(t40, true)).toBe(2);
    expect(itemGameTime(t40, false)).toBe(4);
    expect(itemGameTime(t40, true, true)).toBe(4);
    expect(itemGameTime({ ...t40, duration: "00:00:07" }, false)).toBe(7);
    expect(itemGameTime({ ...t40, duration: "00:00:07" }, true, true)).toBe(9);
    expect(itemGameTime(image("a"), true)).toBe(5);
    expect(itemGameTime(image("a", { duration: "00:00:03" }), true)).toBe(3);
    expect(itemGameTime({ type: "audio", value: "a" }, true)).toBeUndefined();
    expect(itemGameTime({ type: "video", value: "a", duration: "00:00:04" }, true)).toBe(4);
    expect(itemGameTime({ type: "html", value: "a" }, true)).toBe(5);
    expect(itemGameTime(text("x", { waitForFinish: "False", duration: "00:00:09" }), true)).toBe(0.1);
  });

  it("itemDefaultTime — без своего времени; в вопросе по умолчанию", () => {
    const t = text("x".repeat(20), { duration: "00:00:30" });
    expect(itemDefaultTime(t, true)).toBe(1);
    expect(itemDefaultTime(t, true, true)).toBe(3);
    expect(t.duration).toBe("00:00:30");
  });

  it("formatDuration", () => {
    expect([40, 2.5, 75, 3661, 0, 10.04, 59.96, 0.3].map(formatDuration)).toEqual(["00:00:40", "00:00:02.5", "00:01:15", "01:01:01", "00:00:00", "00:00:10", "00:00:59", "00:00:00.3"]);
  });

  it("withDuration: только конечное положительное", () => {
    const it0 = text("a", { duration: "00:00:01" });
    expect(withDuration(it0, 5)).toEqual({ value: "a", duration: "00:00:05" });
    for (const bad of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(withDuration(it0, bad)).toStrictEqual({ value: "a" });
  });

  it("defaultTimedIndex", () => {
    expect(defaultTimedIndex([text("a"), image("b")])).toBe(1);
    expect(defaultTimedIndex([image("b"), text("a")])).toBe(1);
    expect(defaultTimedIndex([text("a"), text("  "), text("фон", { placement: "background" }), text("р", { placement: "replic" })])).toBe(0);
    expect(defaultTimedIndex([text("a", { duration: "00:00:05" }), image("b")])).toBe(-1);
    expect(defaultTimedIndex([text("a"), { type: "audio", value: "m" }])).toBe(-1);
    expect(defaultTimedIndex([text("a", { waitForFinish: "False" })])).toBe(-1);
    expect(defaultTimedIndex([text("")])).toBe(-1);
    expect(defaultTimedIndex([])).toBe(-1);
  });

  it("withTimeDefaults: 10 с последнему, 40 с точке, кнопка 10; исходный не меняется", () => {
    const q = question([text("a"), image("b")]);
    const d = withTimeDefaults(q);
    expect(paramItems(findParam(d, "question")).map((i) => i.duration)).toEqual([undefined, "00:00:10"]);
    expect(answerDuration(d)).toBe(10);
    expect(q.params).toHaveLength(1);
    const point = question([image("b")], ["0.5,0.5"], [{ name: "answerType", text: "point", children: [] }]);
    expect(paramItems(findParam(withTimeDefaults(point), "question"))[0].duration).toBe("00:00:40");
    const own = question([text("a")], ["о"], [{ name: "answerDuration", text: "3", children: [] }]);
    expect(answerDuration(withTimeDefaults(own))).toBe(3);
  });

  it("applyTimeDefaults: финал и пустые — мимо; считает только поменянные; без раундов/тем/вопросов — 0", () => {
    const done = withTimeDefaults(question([text("готово")]));
    const p: Package = {
      attrs: [], order: [],
      rounds: [
        { name: "Р", themes: [{ name: "Т", questions: [question([text("a")]), question([text("")], [""]), done] }, { name: "без вопросов" }] },
        { name: "Ф", type: "final", themes: [{ name: "Т", questions: [question([text("f")])] }] },
        { name: "без тем" },
      ],
    };
    expect(applyTimeDefaults(p)).toBe(1);
    expect(answerDuration(p.rounds![1].themes![0].questions![0])).toBeUndefined();
    expect(p.rounds![0].themes![0].questions![1].params).toHaveLength(1);
    expect(p.rounds![0].themes![1].questions).toEqual([]);
    expect(applyTimeDefaults({ attrs: [], order: [] })).toBe(0);
  });

  it("answerDuration и setAnswerDuration", () => {
    const q = question([text("a")]);
    expect(answerDuration(q)).toBeUndefined();
    for (const v of ["0", "-5", "abc", ""]) { setParamText(q, "answerDuration", v); expect(answerDuration(q)).toBeUndefined(); }
    setAnswerDuration(q, 7.6);
    expect(findParam(q, "answerDuration")?.text).toBe("8");
    expect(answerDuration(q)).toBe(8);
    for (const bad of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      setAnswerDuration(q, 7);
      setAnswerDuration(q, bad);
      expect(findParam(q, "answerDuration")).toBeUndefined();
    }
    const bare: Question = { price: "1", right: [] };
    setAnswerDuration(bare, undefined);
    expect(bare.params).toEqual([]);
  });
});

describe("комментарии", () => {
  const p = (): Package => ({
    attrs: [], order: [], info: { comments: "пак", showmanComments: "  " },
    rounds: [
      { name: "Р", info: { showmanComments: "ведущему" }, themes: [
        { name: "Т", info: { comments: "   " }, questions: [{ price: "1", right: [], info: { comments: "к вопросу", showmanComments: "в" } }, { price: "2", right: [] }] },
        { name: "Т2" },
      ] },
      { name: "Р2" },
    ],
  });

  it("считаются только непустые, ведущему — по опции", () => {
    expect(countComments(p())).toBe(4);
    expect(countComments(p(), { showman: false })).toBe(2);
    expect(countComments({ attrs: [], order: [] })).toBe(0);
  });

  it("clearAllComments: убирает всё, ведущему — по опции; возвращает число непустых", () => {
    const a = p();
    expect(clearAllComments(a)).toBe(4);
    expect(countComments(a)).toBe(0);
    expect(a.info).toEqual({});
    const b = p();
    expect(clearAllComments(b, { showman: false })).toBe(2);
    expect(b.rounds![0].info).toEqual({ showmanComments: "ведущему" });
    expect(b.rounds![0].themes![0].questions![0].info).toEqual({ showmanComments: "в" });
  });
});

describe("вопрос", () => {
  it("questionText: только текст, через пробел, без краёв", () => {
    expect(questionText(question([text(" раз"), image("a.png"), text("два "), { type: "audio", value: "m" }]))).toBe("раз два");
    expect(questionText({ price: "1", right: [] })).toBe("");
  });

  it("slotStatus: обычный и точка", () => {
    expect(slotStatus(question([text("в")], ["  "]))).toBe("draft");
    expect(slotStatus(question([text(" ")], [" "]))).toBe("empty");
    expect(slotStatus(question([text("в")], ["о"]))).toBe("ready");
    const pt = (items: ContentItem[], right: string[]) => question(items, right, [{ name: "answerType", text: "point", children: [] }]);
    expect(slotStatus(pt([image("a.png")], ["0.5,0.5"]))).toBe("ready");
    expect(slotStatus(pt([text("найди")], ["0.5,0.5"]))).toBe("draft");
    expect(slotStatus(pt([image("a.png")], ["где-то"]))).toBe("draft");
    expect(slotStatus(pt([text("")], ["ответ"]))).toBe("empty");
  });

  it("allItems и isMediaUsed: вложенные параметры; пустые уровни", () => {
    const q = question([image("a.png")], ["A"], [{ name: "answerOptions", type: "group", children: [{ kind: "param", param: content("A", [image("opt.png")]) }] }]);
    const p = pkgOf(q);
    p.rounds!.push({ name: "пусто" }, { name: "Р3", themes: [{ name: "без вопросов" }, { name: "Т", questions: [{ price: "1", right: [] }] }] });
    expect(allItems(p).map((x) => x.item.value)).toEqual(["a.png", "opt.png"]);
    expect(allItems({ attrs: [], order: [] })).toEqual([]);
    expect(isMediaUsed(p, "Images", "opt.png")).toBe(true);
    expect(isMediaUsed(p, "Audio", "opt.png")).toBe(false);
    const notRef = pkgOf(question([text("opt.png")]));
    expect(isMediaUsed(notRef, "Images", "opt.png")).toBe(false);
  });

  it("themeMediaRefs и renameThemeMedia: только ссылки, без повторов, по папке", () => {
    const t: Theme = { name: "Т", questions: [
      question([image("a.png"), image("a.png"), text("b.png"), image("", {}), { type: "text", isRef: "True", value: "t.txt" }, { type: "audio", isRef: "True", value: "a.png" }],
        ["о"], [{ name: "answerOptions", type: "group", children: [{ kind: "param", param: content("A", [image("o.png")]) }] }]),
      { price: "2", right: [] },
    ] };
    expect(themeMediaRefs(t)).toEqual([{ folder: "Images", name: "a.png" }, { folder: "Audio", name: "a.png" }, { folder: "Images", name: "o.png" }]);
    renameThemeMedia(t, new Map([["Images/a.png", "b.png"], ["Images/o.png", "p.png"]]));
    expect(paramItems(findParam(t.questions![0], "question")).map((i) => i.value)).toEqual(["b.png", "b.png", "b.png", "", "t.txt", "a.png"]);
    expect(getOptions(t.questions![0])).toEqual([{ letter: "A", text: "p.png" }]);
    const same = structuredClone(t);
    renameThemeMedia(t, new Map());
    expect(t).toEqual(same);
    expect(themeMediaRefs({ name: "пусто" })).toEqual([]);
  });

  it("packStats: всё посчитано, главный тип — видео > звук > картинка > текст", () => {
    const withAudio = question([image("a"), { type: "audio", isRef: "True", value: "m" }]);
    const p: Package = { attrs: [], order: [], rounds: [
      { name: "Р", themes: [{ name: "Т", questions: [
        question([text("t")]), question([text("t"), image("i")]), withAudio,
        { ...question([{ type: "video", value: "v" }, image("i")]), type: "secret" },
        { ...question([text("")], [""]), type: "simple" },
        question([text(" "), image("")], ["о"]),
      ] }, { name: "без вопросов" }] },
      { name: "без тем" },
    ] };
    expect(packStats(p)).toEqual({ rounds: 2, themes: 2, questions: 6, ready: 4, draft: 1, empty: 1, specials: 1, byKind: { text: 1, image: 1, audio: 1, video: 1 } });
    expect(packStats({ attrs: [], order: [] }).questions).toBe(0);
  });
});

describe("спецвопросы и варианты", () => {
  it("setQuestionType: кот — три параметра один раз; обратно — убираются; пустой тип — нет типа", () => {
    const q: Question = { price: "1", right: [] };
    setQuestionType(q, "secret");
    expect(q.type).toBe("secret");
    expect(q.params).toEqual([
      { name: "selectionMode", text: "exceptCurrent", children: [] },
      { name: "price", type: "numberSet", children: [{ kind: "numberSet", numberSet: { minimum: "0", maximum: "0", step: "0" } }] },
      { name: "theme", text: "", children: [] },
    ]);
    setQuestionType(q, "secretPublicPrice");
    expect(q.params).toHaveLength(3);
    q.params!.push({ name: "question", type: "content", children: [] });
    setQuestionType(q, "stake");
    expect(q.params!.map((p) => p.name)).toEqual(["question"]);
    setQuestionType(q, "");
    expect(q.type).toBeUndefined();
    const unnamed: Question = { price: "1", right: [], params: [{ children: [] }] };
    setQuestionType(unnamed, undefined);
    expect(unnamed.params).toHaveLength(1);
  });

  it("setParamText, secretPrice, setSecretPrice", () => {
    const q: Question = { price: "1", right: [] };
    setParamText(q, "theme", "а");
    setParamText(q, "theme", "б");
    expect(q.params).toEqual([{ name: "theme", text: "б", children: [] }]);
    expect(secretPrice(q)).toEqual({ minimum: "0", maximum: "0" });
    setSecretPrice(q, "5", "6");
    expect(findParam(q, "price")).toBeUndefined();
    q.params!.push({ name: "price", type: "numberSet", children: [{ kind: "item", item: text("x") }, { kind: "numberSet", numberSet: { step: "1" } }] });
    expect(secretPrice(q)).toEqual({ minimum: "0", maximum: "0" });
    setSecretPrice(q, "100", "500");
    expect(findParam(q, "price")!.children).toEqual([{ kind: "numberSet", numberSet: { minimum: "100", maximum: "500", step: "0" } }]);
    expect(secretPrice(q)).toEqual({ minimum: "100", maximum: "500" });
  });

  it("getOptions и setOptions", () => {
    const q = question([text("в")], ["A"], [{ name: "answerDeviation", text: "0.1", children: [] }]);
    expect(getOptions(q)).toEqual([]);
    setOptions(q, ["да", "нет"]);
    expect(q.params!.map((p) => p.name)).toEqual(["question", "answerType", "answerOptions"]);
    expect(getOptions(q)).toEqual([{ letter: "A", text: "да" }, { letter: "B", text: "нет" }]);
    findParam(q, "answerOptions")!.children.push({ kind: "item", item: text("не вариант") }, { kind: "param", param: { children: [{ kind: "item", item: text("x") }, { kind: "item", item: text("y") }] } });
    expect(getOptions(q)[2]).toEqual({ letter: "", text: "x y" });
    q.params!.push({ name: "answerDeviation", text: "0.1", children: [] });
    setOptions(q, []);
    expect(q.params!.map((p) => p.name)).toEqual(["question", "answerDeviation"]);
    const bare: Question = { price: "1", right: [] };
    setOptions(bare, []);
    expect(bare.params).toEqual([]);
  });
});

describe("ответ точкой", () => {
  const pt = (right: string[] = ["0.5,0.5,1"], items: ContentItem[] = [image("a.png")], dev?: string) =>
    question(items, right, [{ name: "answerType", text: "point", children: [] }, ...(dev === undefined ? [] : [{ name: "answerDeviation", text: dev, children: [] }])]);

  it("parsePoint", () => {
    expect(parsePoint("0.38,0.48,1.78")).toEqual({ x: 0.38, y: 0.48, ratio: 1.78 });
    expect(parsePoint(" 0.1 , 0.2 ")).toEqual({ x: 0.1, y: 0.2, ratio: 1 });
    expect(parsePoint("0.1,0.2,0")).toEqual({ x: 0.1, y: 0.2, ratio: 1 });
    expect(parsePoint("0.1,0.2,-2")).toEqual({ x: 0.1, y: 0.2, ratio: 1 });
    for (const bad of [undefined, "", "1", "1,2,3,4", "1,,2", "a,b", "1,2,x", ",1"]) expect(parsePoint(bad)).toBeUndefined();
  });

  it("pointDeviation, pointImage", () => {
    expect([undefined, "0", "-1", "abc", "0.15"].map((d) => pointDeviation(pt(undefined, undefined, d)))).toEqual([0, 0, 0, 0, 0.15]);
    expect(pointImage(pt(undefined, [text("найди"), image("a.png"), text("  ")]))?.value).toBe("a.png");
    expect(pointImage(pt(undefined, [image("a.png"), text("подпись")]))).toBeUndefined();
    expect(pointImage(pt(undefined, []))).toBeUndefined();
  });

  it("pointHit: по x — с поправкой на соотношение сторон; граница — включительно; допуск не меньше 0,02", () => {
    // двоичные дроби — без погрешности: граница ровно на допуске
    const r = { x: 0.5, y: 0.5, ratio: 2 };
    expect(pointHit(r, 0.125, { x: 0.5625, y: 0.5 })).toBe(true);
    expect(pointHit(r, 0.125, { x: 0.5703125, y: 0.5 })).toBe(false);
    expect(pointHit(r, 0.125, { x: 0.5, y: 0.625 })).toBe(true);
    expect(pointHit(r, 0.125, { x: 0.5, y: 0.6328125 })).toBe(false);
    expect(pointHit({ x: 0.5, y: 0.5, ratio: 1 }, 0, { x: 0.5, y: 0.51 })).toBe(true);
    expect(pointHit({ x: 0.5, y: 0.5, ratio: 1 }, 0, { x: 0.5, y: 0.53 })).toBe(false);
    expect(pointHit({ x: 0.2, y: 0.5, ratio: 1 }, 0.1, { x: 0.3, y: 0.5 })).toBe(true);
  });

  it("setPointMode: включить — варианты прочь, допуск по умолчанию, ответы подсказками без букв", () => {
    const q = question([image("a.png")], ["A", "  ", "Эйфелева башня"], [{ name: "answerType", text: "select", children: [] }, { name: "answerOptions", type: "group", children: [] }]);
    setPointMode(q, true);
    expect(q.params!.map((p) => [p.name, p.text])).toEqual([["question", undefined], ["answerType", "point"], ["answerDeviation", "0.1"]]);
    expect(q.right).toEqual(["", "Эйфелева башня"]);
    const had = pt(["0.2,0.3,1", "подсказка"], undefined, "0.2");
    setPointMode(had, true);
    expect(had.right).toEqual(["0.2,0.3,1", "подсказка"]);
    expect(pointDeviation(had)).toBe(0.2);
    const bare: Question = { price: "1", right: [] };
    setPointMode(bare, true);
    expect(bare.right).toEqual([""]);
  });

  it("setPointMode: выключить — тип и допуск прочь, точка из ответов прочь", () => {
    const q = pt(["0.2,0.3,1", "подсказка"], undefined, "0.2");
    setPointMode(q, false);
    expect(q.params!.map((p) => p.name)).toEqual(["question"]);
    expect(q.right).toEqual(["подсказка"]);
    const empty = pt([""]);
    setPointMode(empty, false);
    expect(empty.right).toEqual([""]);
    const txt = pt(["Париж", "0.1,0.1"]);
    setPointMode(txt, false);
    expect(txt.right).toEqual(["Париж", "0.1,0.1"]);
    const bare: Question = { price: "1", right: [] };
    setPointMode(bare, false);
    expect(bare.params).toEqual([]);
  });

  it("setPoint и setPointDeviation", () => {
    const q = pt([]);
    setPoint(q, { x: 1.3, y: -0.2, ratio: 1.777 });
    expect(q.right).toEqual(["1,0,1.78"]);
    q.right = ["старое", "подсказка"];
    setPoint(q, { x: 0.123, y: 0.456, ratio: 1 });
    expect(q.right).toEqual(["0.12,0.46,1", "подсказка"]);
    for (const [d, want] of [[0.001, "0.02"], [0.5, "0.3"], [0.126, "0.13"]] as const) {
      setPointDeviation(q, d);
      expect(findParam(q, "answerDeviation")?.text).toBe(want);
    }
  });

  it("pointProblems: каждая беда своим текстом, пороги", () => {
    expect(pointProblems(question([text("x")]))).toEqual([]);
    expect(pointProblems(pt(["0.5,0.5,1"], [image("a.png")], "0.1"))).toEqual([]);
    expect(pointProblems(pt(["0.5,0.5,1"], [text("x")], "0.1"))).toEqual(["последним в вопросе должна стоять картинка — по ней щёлкают игроки"]);
    expect(pointProblems(pt([""], undefined, "0.1"))).toEqual(["точка не поставлена: щёлкните по картинке в редакторе"]);
    for (const bad of ["-0.1,0.5", "1.1,0.5", "0.5,-0.1", "0.5,1.1"]) expect(pointProblems(pt([bad], undefined, "0.1"))).toEqual(["точка за краем картинки"]);
    for (const ok of ["0,0", "1,1"]) expect(pointProblems(pt([ok], undefined, "0.1"))).toEqual([]);
    expect(pointProblems(pt(["0.5,0.5,1.5"], undefined, "0.1"), 1.53)).toEqual(["картинку заменили после разметки — поставьте точку заново"]);
    expect(pointProblems(pt(["0.5,0.5,1.5"], undefined, "0.1"), 1.51)).toEqual([]);
    expect(pointProblems(pt(["0.5,0.5,1.5"], undefined, "0.1"), 1.49)).toEqual([]);
    expect(pointProblems(pt(["0.5,0.5,1.5"], undefined, "0.1"), 1.47)).toEqual(["картинку заменили после разметки — поставьте точку заново"]);
    expect(pointProblems(pt(["0.5,0.5,1.5"], undefined, "0.1"), 0)).toEqual([]);
    expect(pointProblems(pt(["0.5,0.5"], undefined, "0.049"))).toEqual(["допуск меньше 0,05 — попасть почти невозможно"]);
    expect(pointProblems(pt(["0.5,0.5"], undefined, "0.05"))).toEqual([]);
    expect(pointProblems(pt(["0.5,0.5"], undefined, "0.3"))).toEqual([]);
    expect(pointProblems(pt(["0.5,0.5"], undefined, "0.31"))).toEqual(["допуск больше 0,3 — засчитает почти любой щелчок"]);
  });
});

describe("замена картинки обработанной", () => {
  const rep = [image("p1.png"), image("p2.png", { waitForFinish: "False" })];

  it("замена; «вместе со следующим» — у последнего из замены; оригинал — в новый ответ", () => {
    const q = question([text("в"), image("a.png", { waitForFinish: "False" }), image("b.png")]);
    expect(replaceQuestionImage(q, "a.png", rep)).toEqual({ originalInAnswer: true, replaced: true });
    expect(paramItems(findParam(q, "question"))).toEqual([text("в"), { type: "image", isRef: "True", value: "p1.png" }, { type: "image", isRef: "True", value: "p2.png", waitForFinish: "False" }, image("b.png")]);
    expect(findParam(q, "answer")).toEqual({ name: "answer", type: "content", children: [{ kind: "item", item: { type: "image", isRef: "True", value: "a.png" } }] });
  });

  it("без «вместе» у исходного — у замены его нет вовсе", () => {
    const q = question([image("a.png")]);
    replaceQuestionImage(q, "a.png", rep);
    expect(paramItems(findParam(q, "question"))).toStrictEqual([{ type: "image", isRef: "True", value: "p1.png" }, { type: "image", isRef: "True", value: "p2.png" }]);
  });

  it("в ответе уже есть медиа — оригинал не кладём; пустой текст ответа — кладём, вложенные параметры ответа остаются", () => {
    const q = question([image("a.png")], ["о"], [content("answer", [image("ans.png")])]);
    expect(replaceQuestionImage(q, "a.png", rep)).toEqual({ originalInAnswer: false, replaced: true });
    const q2 = question([image("a.png")], ["о"], [{ name: "answer", type: "content", children: [{ kind: "item", item: text("  ") }, { kind: "param", param: { name: "x", children: [] } }] }]);
    expect(replaceQuestionImage(q2, "a.png", rep).originalInAnswer).toBe(true);
    expect(findParam(q2, "answer")!.children).toEqual([{ kind: "param", param: { name: "x", children: [] } }, { kind: "item", item: { type: "image", isRef: "True", value: "a.png" } }]);
  });

  it("нечего менять: нет вопроса, нет такой картинки, одноимённый звук", () => {
    expect(replaceQuestionImage({ price: "1", right: [] }, "a.png", rep)).toEqual({ originalInAnswer: false, replaced: false });
    const q = question([{ type: "audio", isRef: "True", value: "a.png" }, image("b.png")]);
    const before = structuredClone(q);
    expect(replaceQuestionImage(q, "a.png", rep)).toEqual({ originalInAnswer: false, replaced: false });
    expect(q).toEqual(before);
  });
});

describe("создание", () => {
  it("вопрос, тема, раунд, финал", () => {
    expect(newQuestion(300)).toEqual({ price: "300", params: [{ name: "question", type: "content", children: [{ kind: "item", item: { value: "" } }] }], right: [""] });
    expect(newTheme("Т", [1, 2]).questions!.map((q) => q.price)).toEqual(["1", "2"]);
    const r = newRound("Р", 2, [100, 200]);
    expect([r.name, r.type, r.themes!.map((t) => t.name), r.themes![1].questions!.map((q) => q.price)]).toEqual(["Р", undefined, ["Тема 1", "Тема 2"], ["100", "200"]]);
    const f = newRound("Ф", 3, [100, 200], true);
    expect([f.type, f.themes!.map((t) => t.questions!.map((q) => q.price))]).toEqual(["final", [["0"], ["0"], ["0"]]]);
  });

  it("пак: атрибуты, дата сегодня, раунды как в Уе!паках", () => {
    const p = newPackage();
    const d = new Date();
    const today = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
    expect(p.attrs.map(([k]) => k)).toEqual(["name", "version", "id", "date", "language", "xmlns"]);
    expect(Object.fromEntries(p.attrs)).toMatchObject({ name: "Новый пак", version: "5", date: today, language: "ru-RU", xmlns: "https://github.com/VladimirKhil/SI/blob/master/assets/siq_5.xsd" });
    expect(p.attrs[2][1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(p.order).toEqual(["tags", "info", "rounds"]);
    expect([p.tags, p.info]).toEqual([[], { authors: [""] }]);
    expect(p.rounds!.map((r) => [r.name, r.type, r.themes!.length, r.themes![0].questions!.map((q) => q.price).join(",")])).toEqual([
      ["Раунд 1", undefined, 6, "100,200,300,400,500"],
      ["Раунд 2", undefined, 6, "200,400,600,800,1000"],
      ["Раунд 3", undefined, 6, "300,600,900,1200,1500"],
      ["ФИНАЛ", "final", 7, "0"],
    ]);
    expect(newPackage("Мой").attrs[0]).toEqual(["name", "Мой"]);
  });
});

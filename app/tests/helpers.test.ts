// Фрагменты XML взяты из реальных паков, собранных SIQuester («Уе!пак №2», «Уе!пак №8»).
// Проверяем, что наши правки дают ровно ту же разметку, что пишет SIQuester.

import { describe, expect, it } from "vitest";
import { appendMedia, clearAllComments, contentGroups, getOptions, newPackage, newQuestion, packStats, questionItems, setOptions, setQuestionType, setWithNext, itemGameTime, slotStatus, themeMediaRefs, renameThemeMedia } from "../src/core/siq/helpers";
import { buildContentXml, parseContentXml } from "../src/core/siq/xml";

const wrap = (question: string) =>
  `<?xml version="1.0" encoding="utf-8"?><package name="T" version="5" xmlns="https://github.com/VladimirKhil/SI/blob/master/assets/siq_5.xsd">` +
  `<rounds><round name="R"><themes><theme name="Th"><questions>${question}</questions></theme></themes></round></rounds></package>`;

const firstQuestion = (xml: string) => parseContentXml(xml).rounds![0].themes![0].questions![0];

describe("варианты ответа", () => {
  const original = wrap(
    `<question price="400" type="forAll"><params><param name="question" type="content"><item>Плавают или тонут?</item></param>` +
      `<param name="answerType">select</param><param name="answerOptions" type="group">` +
      `<param name="A" type="content"><item>Плавают</item></param><param name="B" type="content"><item>Тонут</item></param></param>` +
      `</params><right><answer>A</answer></right></question>`,
  );

  it("читаются из пака", () => {
    expect(getOptions(firstQuestion(original))).toEqual([{ letter: "A", text: "Плавают" }, { letter: "B", text: "Тонут" }]);
  });

  it("пересоздание даёт тот же XML, что у SIQuester", () => {
    const pkg = parseContentXml(original);
    const q = pkg.rounds![0].themes![0].questions![0];
    setOptions(q, getOptions(q).map((o) => o.text));
    expect(buildContentXml(pkg)).toBe(original);
  });

  it("снятие вариантов убирает оба параметра", () => {
    const q = firstQuestion(original);
    setOptions(q, []);
    expect(q.params!.map((p) => p.name)).toEqual(["question"]);
  });
});

describe("кот в мешке", () => {
  it("добавляет параметры в том виде, в каком их пишет SIQuester", () => {
    const pkg = parseContentXml(wrap(`<question price="200"><params><param name="question" type="content"><item>Q</item></param></params><right><answer>A</answer></right></question>`));
    const q = pkg.rounds![0].themes![0].questions![0];
    setQuestionType(q, "secret");
    expect(buildContentXml(pkg)).toContain(
      `<question price="200" type="secret"><params><param name="question" type="content"><item>Q</item></param>` +
        `<param name="selectionMode">exceptCurrent</param><param name="price" type="numberSet"><numberSet minimum="0" maximum="0" step="0" /></param><param name="theme"></param></params>`,
    );
  });

  it("смена на обычный убирает параметры кота", () => {
    const q = newQuestion(100);
    setQuestionType(q, "secret");
    setQuestionType(q, "");
    expect(q.type).toBeUndefined();
    expect(q.params!.map((p) => p.name)).toEqual(["question"]);
  });
});

describe("новый пак", () => {
  it("3 раунда × 6 тем × 5 вопросов + финал из 7 тем, всё пустое", () => {
    const pkg = newPackage("Тест");
    const s = packStats(pkg);
    expect(s).toMatchObject({ rounds: 4, themes: 25, questions: 97, empty: 97, ready: 0 });
    expect(parseContentXml(buildContentXml(pkg))).toEqual(pkg);
  });

  it("статус слота: вопрос без ответа — черновик, с ответом — готово", () => {
    const q = newQuestion(100);
    q.params![0].children = [{ kind: "item", item: { value: "Текст" } }];
    expect(slotStatus(q)).toBe("draft");
    q.right = ["Ответ"];
    expect(slotStatus(q)).toBe("ready");
  });
});

describe("очистка комментариев", () => {
  const packWithComments = () => {
    const pkg = newPackage("Тест");
    pkg.info = { comments: "комментарий к паку" };
    const round = pkg.rounds![0];
    round.info = { comments: "комментарий к раунду", showmanComments: "для ведущего" };
    const theme = round.themes![0];
    theme.info = { comments: "" }; // пустой — не должен считаться удалённым
    const question = theme.questions![0];
    question.info = { comments: "комментарий к вопросу", showmanComments: "тоже для ведущего" };
    return pkg;
  };

  it("убирает comments и showmanComments на всех уровнях, считает только непустые", () => {
    const pkg = packWithComments();
    const removed = clearAllComments(pkg);
    // непустых: пак.comments, раунд.comments, раунд.showman, вопрос.comments, вопрос.showman — тема пустая, не считается
    expect(removed).toBe(5);
    expect(pkg.info?.comments).toBeUndefined();
    expect(pkg.rounds![0].info?.comments).toBeUndefined();
    expect(pkg.rounds![0].info?.showmanComments).toBeUndefined();
    expect(pkg.rounds![0].themes![0].info?.comments).toBeUndefined();
    expect(pkg.rounds![0].themes![0].questions![0].info?.comments).toBeUndefined();
    expect(pkg.rounds![0].themes![0].questions![0].info?.showmanComments).toBeUndefined();
  });

  it("с опцией showman: false трогает только comments, showmanComments остаются", () => {
    const pkg = packWithComments();
    const removed = clearAllComments(pkg, { showman: false });
    expect(removed).toBe(3); // пак.comments + раунд.comments + вопрос.comments (тема пустая, не считается)
    expect(pkg.rounds![0].info?.showmanComments).toBe("для ведущего");
    expect(pkg.rounds![0].themes![0].questions![0].info?.showmanComments).toBe("тоже для ведущего");
  });

  it("на пустом паке (без комментариев) возвращает 0 и не трогает info", () => {
    const pkg = newPackage("Тест");
    expect(clearAllComments(pkg)).toBe(0);
  });
});

describe("показ вместе («одновременно»)", () => {
  // так SIQuester пишет «картинка, под ней текст» на одном экране (встречается в «Уе!паках»)
  const original = wrap(
    `<question price="100"><params><param name="question" type="content"><item type="image" isRef="True" waitForFinish="False">tea.jpg</item>` +
      `<item>Что это за чай?</item></param></params><right><answer>Пуэр</answer></right></question>`,
  );
  const items = (xml: string) => questionItems(firstQuestion(xml));

  it("группы: картинка и текст — один экран", () => {
    expect(contentGroups(items(original))).toEqual([[0, 1]]);
    expect(contentGroups(setWithNext(items(original), 0, false))).toEqual([[0], [1]]);
  });

  it("картинка к готовому тексту встаёт над ним и даёт тот же XML, что у SIQuester", () => {
    const pkg = parseContentXml(original);
    const param = pkg.rounds![0].themes![0].questions![0].params![0];
    const joined = appendMedia([{ value: "Что это за чай?" }], [{ type: "image", isRef: "True", value: "tea.jpg" }]);
    param.children = joined.map((item) => ({ kind: "item" as const, item }));
    expect(buildContentXml(pkg)).toBe(original);
  });

  it("выключение убирает атрибут целиком", () => {
    expect(setWithNext(items(original), 0, false)[0]).toEqual({ type: "image", isRef: "True", value: "tea.jpg" });
  });

  it("время экрана по правилам SIGame", () => {
    const [img, text] = items(original);
    expect(itemGameTime(img, false)).toBe(0.1); // не ждём — сразу текст
    expect(itemGameTime(text, true)).toBeCloseTo(15 / 20); // 15 знаков при 20 знаках/с, последний — без паузы
    expect(itemGameTime({ type: "image", isRef: "True", value: "x", duration: "00:00:10" }, true)).toBe(10);
    expect(itemGameTime({ type: "video", isRef: "True", value: "x" }, true)).toBeUndefined();
  });
});

describe("перенос темы: файлы темы", () => {
  const xml = wrap(
    `<question price="100"><params><param name="question" type="content"><item type="image" isRef="True" waitForFinish="False">a.jpg</item><item>Что это?</item></param>` +
      `<param name="answer" type="content"><item type="audio" isRef="True">b.mp3</item></param></params><right><answer>X</answer></right></question>` +
      `<question price="200"><params><param name="question" type="content"><item type="image" isRef="True">a.jpg</item></param>` +
      `<param name="answerType">select</param><param name="answerOptions" type="group"><param name="A" type="content"><item type="image" isRef="True">c.png</item></param></param></params><right><answer>A</answer></right></question>`,
  );
  const theme = () => parseContentXml(xml).rounds![0].themes![0];

  it("собирает все файлы, включая ответ и варианты, без повторов", () => {
    expect(themeMediaRefs(theme())).toEqual([
      { folder: "Images", name: "a.jpg" }, { folder: "Audio", name: "b.mp3" }, { folder: "Images", name: "c.png" },
    ]);
  });

  it("переименование меняет все ссылки на файл", () => {
    const t = theme();
    renameThemeMedia(t, new Map([["Images/a.jpg", "a (2).jpg"]]));
    expect(themeMediaRefs(t).map((r) => r.name)).toEqual(["a (2).jpg", "b.mp3", "c.png"]);
  });
});

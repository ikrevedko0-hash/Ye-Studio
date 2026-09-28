// content.xml (core/siq/xml.ts): разбор и сборка SIQ v5 «как у SIQuester». Каждая конструкция формата —
// точный разбор и побайтный обратный путь: ошибка тут — битый пак у игроков (как пустой <info />).

import { describe, expect, it } from "vitest";
import { buildContentXml, parseContentXml } from "../src/core/siq/xml";
import type { Package } from "../src/core/siq/model";

const NS = "https://github.com/VladimirKhil/SI/blob/master/assets/siq_5.xsd";
const HEAD = `<?xml version="1.0" encoding="utf-8"?>`;
const wrap = (body: string, attrs = `name="П" version="5"`) => `${HEAD}<package ${attrs} xmlns="${NS}">${body}</package>`;
const same = (xml: string) => expect(buildContentXml(parseContentXml(xml))).toBe(xml);

describe("content.xml: обратный путь байт в байт", () => {
  it("всё, что бывает в паке", () => {
    same(wrap(
      `<tags><tag>кино</tag><tag>музыка</tag></tags>` +
      `<info><authors><author>А &amp; Б</author></authors><sources><source>http://x/?a=1&amp;b=2</source></sources>` +
      `<comments>строка 1\r\nстрока 2</comments><showmanComments>для ведущего</showmanComments><extension>ext</extension></info>` +
      `<rounds><round name="Р &quot;1&quot;"><info><comments>к раунду</comments></info><themes>` +
      `<theme name="Т &lt;1&gt;"><info><authors><author>тема</author></authors></info><questions>` +
      `<question price="100"><info><sources><source>s</source></sources></info><params>` +
      `<param name="question" type="content"><item>текст &lt;b&gt; &amp;</item><item type="image" isRef="True" placement="background" duration="00:00:05" waitForFinish="False">a b.png</item></param>` +
      `<param name="answerType">select</param>` +
      `<param name="answerOptions" type="group"><param name="A" type="content"><item>да</item></param><param name="B" type="content"><item></item></param></param>` +
      `<param name="price" type="numberSet"><numberSet minimum="100" maximum="500" step="100" /></param>` +
      `<param name="empty"></param>` +
      `</params><right><answer>A</answer></right><wrong><answer>B</answer><answer /></wrong></question>` +
      `<question price="200" type="secret"><params><param name="question" type="content"><item>в</item></param>` +
      `<param name="theme">тема кота</param><param name="price" type="numberSet"><numberSet>300</numberSet></param></params>` +
      `<right><answer>о</answer></right></question>` +
      `</questions></theme></themes></round>` +
      `<round name="Финал" type="final"><themes><theme name="Ф"><questions><question price="0"><right><answer>x</answer></right></question></questions></theme></themes></round>` +
      `</rounds>`,
      `id="1" name="Пак &amp; ко" version="5" restriction="12+" date="01.01.2026" publisher="p" difficulty="5" logo="@лого.png" language="ru-RU"`,
    ));
  });

  it("устаревшие <global>, <type>, <scenario> и <files> не теряются", () => {
    same(wrap(
      `<files><file name="Images/a.png" hash="abc" /></files><global><authors><author>g</author></authors></global>` +
      `<rounds><round name="Р"><themes><theme name="Т"><questions><question price="1"><type name="cat"><param name="theme">x</param></type>` +
      `<scenario><atom>старое</atom></scenario><right><answer>о</answer></right></question></questions></theme></themes></round></rounds>`,
    ));
  });

  it("порядок элементов <package> — как в файле", () => {
    same(wrap(`<rounds><round name="Р" /></rounds><info><authors><author>я</author></authors></info><tags><tag>т</tag></tags>`));
  });

  it("пустые элементы: <round />, <themes />, <questions />, пустые списки", () => {
    same(wrap(`<tags /><info><authors /><sources /><comments /></info><rounds><round name="Р"><themes><theme name="Т"><questions /></theme></themes></round><round name="Р2" /></rounds>`));
  });
});

describe("content.xml: разбор", () => {
  it("отформатированный (переносы, отступы, комментарии) — то же, что сжатый", () => {
    const compact = wrap(`<info><authors><author>я</author></authors></info><rounds><round name="Р"><themes><theme name="Т"><questions><question price="1"><params><param name="question" type="content"><item>в</item></param></params><right><answer>о</answer></right></question></questions></theme></themes></round></rounds>`);
    const pretty = wrap(`
  <!-- комментарий -->
  <info>
    <authors>
      <author>я</author>
    </authors>
  </info>
  <rounds>
    <round name="Р">
      <themes>
        <theme name="Т">
          <questions>
            <question price="1">
              <params>
                <param name="question" type="content"><!-- к вопросу --><item>в</item></param>
              </params>
              <right>
                <answer>о</answer>
              </right>
            </question>
          </questions>
        </theme>
      </themes>
    </round>
  </rounds>
`);
    expect(parseContentXml(pretty)).toEqual(parseContentXml(compact));
  });

  it("незнакомые элементы: в <params> и <param> — пропуск, в <theme>/<round> — не вопросы и не темы", () => {
    const pkg = parseContentXml(wrap(`<rounds><round name="Р"><чужое /><themes><theme name="Т"><чужое /></theme><theme name="Т2"><questions><question price="1"><params>` +
      `<чужое /><param name="g"><чужое /><param name="A">y</param></param></params></question></questions></theme></themes></round><round name="Р2"><чужое /></round></rounds>`));
    const r = pkg.rounds!;
    expect(r[0].themes!.map((t) => t.name)).toEqual(["Т", "Т2"]);
    expect(r[0].themes![0].questions).toBeUndefined();
    expect(r[1].themes).toBeUndefined();
    const ps = r[0].themes![1].questions![0].params!;
    expect(ps).toHaveLength(1);
    // группа без текста и без type — текста нет вовсе (а не пустая строка)
    expect(ps[0]).toStrictEqual({ name: "g", type: undefined, children: [{ kind: "param", param: { name: "A", type: undefined, text: "y", children: [] } }] });
  });

  it("параметр только из пробелов — текст сохраняется; numberSet без значения — поля value нет", () => {
    const pkg = parseContentXml(wrap(`<rounds><round name="Р"><themes><theme name="Т"><questions><question price="1"><params>` +
      `<param name="a">  </param><param name="p" type="numberSet"><numberSet minimum="1" /></param></params></question></questions></theme></themes></round></rounds>`));
    const ps = pkg.rounds![0].themes![0].questions![0].params!;
    expect(ps[0].text).toBe("  ");
    const ns = ps[1].children[0];
    expect(ns.kind === "numberSet" && "value" in ns.numberSet).toBe(false);
  });

  it("info у вопроса и файлы без атрибутов", () => {
    const pkg = parseContentXml(wrap(`<files><file /></files><rounds><round name="Р"><themes><theme name="Т"><questions><question price="1"><info><comments>к</comments></info><right><answer>о</answer></right></question></questions></theme></themes></round></rounds>`));
    expect(pkg.rounds![0].themes![0].questions![0].info).toEqual({ comments: "к" });
    expect(pkg.rounds![0].themes![0].questions![0].legacyXml).toBeUndefined();
    expect(pkg.files).toEqual([{ name: "", hash: "" }]);
  });

  it("символ BOM внутри текста — не трогаем, только в начале файла", () => {
    const pkg = parseContentXml("\uFEFF" + wrap(`<tags><tag>а\uFEFFб</tag></tags>`));
    expect(pkg.tags).toEqual(["а\uFEFFб"]);
  });

  it("неизвестная сущность — повреждён; атрибут без кавычек (предупреждение) — читается", () => {
    expect(() => parseContentXml(wrap(`<tags><tag>&nbsp;</tag></tags>`))).toThrow("content.xml повреждён: entity not found:&nbsp;");
    expect(parseContentXml(`${HEAD}<package name=П></package>`).attrs).toEqual([["name", "П"]]);
  });

  it("устаревший элемент в паке без пространства имён — как есть", () => {
    same(`${HEAD}<package name="П"><global><x>1</x></global></package>`);
    same(wrap(`<global xmlns="${NS}"><x>1</x></global>`));
  });

  it("вопрос целиком — поля как в файле", () => {
    const pkg = parseContentXml(wrap(
      `<rounds><round name="Р" type="final"><themes><theme name="Т"><questions><question price="7" type="stake">` +
      `<params><param name="question" type="content"><item type="audio" isRef="True" waitForFinish="False">z.mp3</item></param>` +
      `<param name="price" type="numberSet"><numberSet minimum="1" maximum="2" step="0">5</numberSet></param>` +
      `<param name="g" type="group"><param name="A">вложенный</param></param></params>` +
      `<right><answer>о1</answer><answer>о2</answer></right></question></questions></theme></themes></round></rounds>`,
    ));
    expect(pkg.attrs).toEqual([["name", "П"], ["version", "5"], ["xmlns", NS]]);
    expect(pkg.order).toEqual(["rounds"]);
    const r = pkg.rounds![0];
    expect([r.name, r.type]).toEqual(["Р", "final"]);
    const q = r.themes![0].questions![0];
    expect(q).toEqual({
      price: "7", type: "stake", right: ["о1", "о2"],
      params: [
        { name: "question", type: "content", children: [{ kind: "item", item: { type: "audio", isRef: "True", placement: undefined, duration: undefined, waitForFinish: "False", value: "z.mp3" } }] },
        { name: "price", type: "numberSet", children: [{ kind: "numberSet", numberSet: { minimum: "1", maximum: "2", step: "0", value: "5" } }] },
        { name: "g", type: "group", children: [{ kind: "param", param: { name: "A", type: undefined, text: "вложенный", children: [] } }] },
      ],
    });
  });

  it("без цены — 0; без имени темы/раунда — пусто; без <right> — пустой список", () => {
    const pkg = parseContentXml(wrap(`<rounds><round><themes><theme><questions><question /></questions></theme></themes></round></rounds>`));
    const r = pkg.rounds![0];
    expect(r.name).toBe("");
    expect(r.themes![0].name).toBe("");
    expect(r.themes![0].questions![0]).toEqual({ price: "0", type: undefined, right: [] });
  });

  it("простой параметр: текст, пустая пара тегов, пробелы между вложенными не текст", () => {
    const pkg = parseContentXml(wrap(`<rounds><round name="Р"><themes><theme name="Т"><questions><question price="1"><params>` +
      `<param name="a">  x  </param><param name="b"></param><param name="c" type="group">\n  <param name="A">y</param>\n</param><param name="d" type="content" />` +
      `</params></question></questions></theme></themes></round></rounds>`));
    const ps = pkg.rounds![0].themes![0].questions![0].params!;
    expect(ps[0]).toEqual({ name: "a", type: undefined, text: "  x  ", children: [] });
    expect(ps[1]).toEqual({ name: "b", type: undefined, text: "", children: [] });
    expect(ps[2].text).toBeUndefined();
    expect(ps[2].children).toHaveLength(1);
    expect(ps[3]).toEqual({ name: "d", type: "content", children: [] });
  });

  it("CDATA и текст вместе с вложенным — текст сохраняется", () => {
    const pkg = parseContentXml(wrap(`<rounds><round name="Р"><themes><theme name="Т"><questions><question price="1"><params>` +
      `<param name="t"><![CDATA[<b>]]></param><param name="m">до<param name="A">x</param></param></params></question></questions></theme></themes></round></rounds>`));
    const ps = pkg.rounds![0].themes![0].questions![0].params!;
    expect(ps[0].text).toBe("<b>");
    expect(ps[1].text).toBe("до");
    expect(ps[1].children).toHaveLength(1);
  });

  it("info целиком и незнакомые элементы info пропускаются", () => {
    const pkg = parseContentXml(wrap(`<info><authors><author>a</author><author>b</author></authors><sources><source>s</source></sources><comments>c</comments><showmanComments>sc</showmanComments><extension>e</extension><чужое>x</чужое></info>`));
    expect(pkg.info).toEqual({ authors: ["a", "b"], sources: ["s"], comments: "c", showmanComments: "sc", extension: "e" });
    expect(pkg.order).toEqual(["info"]);
  });

  it("BOM в начале не мешает", () => {
    expect(parseContentXml("﻿" + wrap("")).attrs[0]).toEqual(["name", "П"]);
  });

  it("битый XML и чужой корень — понятные ошибки", () => {
    expect(() => parseContentXml(`${HEAD}<package><rounds></package>`)).toThrow(/^content\.xml повреждён: /);
    expect(() => parseContentXml(`${HEAD}<pack name="x" />`)).toThrow("content.xml: нет корневого <package>");
  });
});

describe("content.xml: сборка", () => {
  const base = (): Package => ({ attrs: [["name", "П"]], order: [], rounds: [{ name: "Р", themes: [{ name: "Т", questions: [{ price: "1", right: ["о"] }] }] }] });

  it("заголовок, порядок по умолчанию, пустые списки", () => {
    const pkg = base();
    pkg.tags = [];
    pkg.info = { authors: ["я"] };
    expect(buildContentXml(pkg)).toBe(`${HEAD}<package name="П"><tags /><info><authors><author>я</author></authors></info><rounds><round name="Р"><themes><theme name="Т"><questions><question price="1"><right><answer>о</answer></right></question></questions></theme></themes></round></rounds></package>`);
  });

  it("пустой <info /> не пишется нигде (SIGame теряет после него темы)", () => {
    const pkg = base();
    pkg.info = {};
    pkg.rounds![0].info = {};
    pkg.rounds![0].themes![0].info = {};
    pkg.rounds![0].themes![0].questions![0].info = {};
    const xml = buildContentXml(pkg);
    expect(xml).not.toContain("<info");
    expect(xml).toBe(`${HEAD}<package name="П"><rounds><round name="Р"><themes><theme name="Т"><questions><question price="1"><right><answer>о</answer></right></question></questions></theme></themes></round></rounds></package>`);
  });

  it("но пустые списки внутри info — пишутся (так пишет SIQuester)", () => {
    const pkg = base();
    pkg.info = { authors: [], comments: "" };
    expect(buildContentXml(pkg)).toContain(`<package name="П"><info><authors /><comments /></info>`);
  });

  it("экранирование: & < > в тексте; ещё и \" в атрибутах; переводы строк — \\r\\n", () => {
    const pkg = base();
    pkg.attrs = [["name", `a&b<c>"d"`]];
    pkg.rounds![0].themes![0].questions![0].right = ["x & <y>\n\"z\""];
    const xml = buildContentXml(pkg);
    expect(xml).toContain(`<package name="a&amp;b&lt;c&gt;&quot;d&quot;">`);
    expect(xml).toContain(`<answer>x &amp; &lt;y&gt;\r\n"z"</answer>`);
    expect(parseContentXml(xml).rounds![0].themes![0].questions![0].right).toEqual(["x & <y>\n\"z\""]);
  });

  it("атрибуты undefined не пишутся, пустые строки — пишутся", () => {
    const pkg = base();
    pkg.rounds![0].type = undefined;
    pkg.rounds![0].themes![0].questions![0].type = "";
    expect(buildContentXml(pkg)).toContain(`<round name="Р"><themes>`);
    expect(buildContentXml(pkg)).toContain(`<question price="1" type="">`);
  });

  it("элемент item всегда парой тегов, даже пустой; numberSet без значения — самозакрытый", () => {
    const pkg = base();
    pkg.rounds![0].themes![0].questions![0].params = [
      { name: "question", type: "content", children: [{ kind: "item", item: { value: "" } }] },
      { name: "price", type: "numberSet", children: [{ kind: "numberSet", numberSet: { minimum: "1" } }] },
      { name: "x", children: [] },
    ];
    expect(buildContentXml(pkg)).toContain(`<params><param name="question" type="content"><item></item></param><param name="price" type="numberSet"><numberSet minimum="1" /></param><param name="x" /></params>`);
  });

  it("устаревший <global> и порядок из order, неизвестные имена в order — пропуск", () => {
    const pkg = base();
    pkg.globalXml = "<global />";
    pkg.order = ["global", "что-то", "rounds"];
    pkg.files = [{ name: "Images/a.png", hash: "h" }];
    expect(buildContentXml(pkg)).toBe(`${HEAD}<package name="П"><global /><rounds><round name="Р"><themes><theme name="Т"><questions><question price="1"><right><answer>о</answer></right></question></questions></theme></themes></round></rounds><files><file name="Images/a.png" hash="h" /></files></package>`);
  });

  it("несколько тем, раундов и файлов — подряд, без разделителей; тема без вопросов — самозакрытая", () => {
    const pkg: Package = {
      attrs: [["name", "П"]], order: ["files", "rounds"],
      files: [{ name: "a", hash: "1" }, { name: "b", hash: "2" }],
      rounds: [{ name: "Р", themes: [{ name: "Т1" }, { name: "Т2", questions: [] }] }, { name: "Р2" }],
    };
    expect(buildContentXml(pkg)).toBe(`${HEAD}<package name="П"><files><file name="a" hash="1" /><file name="b" hash="2" /></files><rounds><round name="Р"><themes><theme name="Т1" /><theme name="Т2"><questions /></theme></themes></round><round name="Р2" /></rounds></package>`);
  });

  it("<global> пишется и без записи в order", () => {
    const pkg = base();
    pkg.globalXml = "<global><x /></global>";
    expect(buildContentXml(pkg)).toContain(`<package name="П"><global><x /></global><rounds>`);
  });

  it("wrong пишется после right, пустые question без params", () => {
    const pkg = base();
    pkg.rounds![0].themes![0].questions![0].wrong = ["н"];
    expect(buildContentXml(pkg)).toContain(`<question price="1"><right><answer>о</answer></right><wrong><answer>н</answer></wrong></question>`);
  });
});

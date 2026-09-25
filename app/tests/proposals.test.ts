// «📋 Из Claude»: разбор блока json, план вставки и сама вставка — без окна и сети.

import { describe, expect, it } from "vitest";
import { getOptions, newPackage, questionItems, slotStatus } from "../src/core/siq/helpers";
import { applyInsert, parseProposals, planInsert } from "../src/core/siq/proposals";
import { buildContentXml, parseContentXml } from "../src/core/siq/xml";

const q = (price: number, answer: string, extra: Record<string, unknown> = {}) => ({ price, type: "simple", text: `Вопрос за ${price}`, answer, ...extra });

/** Пак-шаблон: в 1-м раунде тема «Кино» с готовым вопросом за 200. */
function pack() {
  const pkg = newPackage("Тест");
  const t = pkg.rounds![0].themes![0];
  t.name = "Кино";
  const q200 = t.questions![1];
  q200.params![0].children = [{ kind: "item", item: { value: "Готовый" } }];
  q200.right = ["Титаник"];
  return pkg;
}

function run(json: unknown) {
  const pkg = pack();
  const parsed = parseProposals("Вот вопросы:\n```json\n" + JSON.stringify(json) + "\n```\nГотово.");
  if (!parsed.ok) throw new Error(parsed.error);
  const rows = planInsert(pkg, parsed.themes);
  return { pkg, rows, parsed };
}

describe("разбор", () => {
  it("достаёт json из ограждения и текста вокруг", () => {
    const r = parseProposals("```json\n{\"v\":1,\"themes\":[{\"round\":1,\"name\":\"А\",\"questions\":[{\"price\":100,\"answer\":\"Б\"}]}]}\n```");
    expect(r.ok && r.themes[0].questions[0]).toMatchObject({ price: 100, answer: "Б", type: "simple", accept: [], options: [] });
  });

  it("битый json — ошибка, а не падение", () => {
    const r = parseProposals("{\"themes\": [ {\"round\": 1, ");
    expect(r.ok).toBe(false);
    expect(parseProposals("просто текст").ok).toBe(false);
  });

  it("неизвестный тип становится обычным, с предупреждением", () => {
    const r = parseProposals(JSON.stringify({ themes: [{ round: 1, name: "А", questions: [q(100, "Б", { type: "blitz" })] }] }));
    expect(r.ok && r.themes[0].questions[0].type).toBe("simple");
    expect(r.ok && r.warnings.length).toBe(1);
  });

  it("понимает старый формат media.search", () => {
    const r = parseProposals(JSON.stringify({ themes: [{ round: 1, name: "А", questions: [q(100, "Б", { media: { kind: "image", search: "Dubrovnik" } })] }] }));
    expect(r.ok && r.themes[0].questions[0].image).toBe("Dubrovnik");
  });
});

describe("план и вставка", () => {
  it("вопрос в существующую тему встаёт в пустую клетку своей цены", () => {
    const { pkg, rows } = run({ themes: [{ round: 1, name: "кино ", questions: [q(300, "Аватар")] }] });
    expect(rows[0]).toMatchObject({ themeExists: true, themeName: "Кино", price: 300, intoEmptySlot: true, duplicate: false });
    applyInsert(pkg, rows);
    const t = pkg.rounds![0].themes![0];
    expect(t.questions!.length).toBe(5);
    expect(t.questions![2].right).toEqual(["Аватар"]);
  });

  it("занятая цена: готовый вопрос не трогаем, берём ближайшую свободную", () => {
    const { pkg, rows } = run({ themes: [{ round: 1, name: "Кино", questions: [q(200, "Аватар")] }] });
    expect(rows[0].price).toBe(100);
    applyInsert(pkg, rows);
    const t = pkg.rounds![0].themes![0];
    expect(t.questions![1].right).toEqual(["Титаник"]);
    expect(questionItems(t.questions![1])[0].value).toBe("Готовый");
    expect(t.questions![0].right).toEqual(["Аватар"]);
  });

  it("свободных клеток нет — новая клетка в конце темы", () => {
    const qs = [100, 200, 300, 400, 500, 300].map((p, i) => q(p, `О${i}`));
    const { pkg, rows } = run({ themes: [{ round: 1, name: "Новая", questions: qs }] });
    expect(rows.map((r) => r.price)).toEqual([100, 200, 300, 400, 500, 600]);
    applyInsert(pkg, rows);
    const t = pkg.rounds![0].themes!.at(-1)!;
    expect(t.questions!.map((x) => x.price)).toEqual(["100", "200", "300", "400", "500", "600"]);
  });

  it("новая тема встаёт в нужный раунд с сеткой цен раунда", () => {
    const { pkg, rows } = run({ themes: [{ round: 3, name: "Место под маской", comment: "Кого сыграло место?", questions: [q(900, "Королевская Гавань")] }] });
    expect(rows[0]).toMatchObject({ themeExists: false, roundName: "Раунд 3", price: 900 });
    applyInsert(pkg, rows);
    const t = pkg.rounds![2].themes!.at(-1)!;
    expect(t.name).toBe("Место под маской");
    expect(t.info?.comments).toBe("Кого сыграло место?");
    expect(t.questions!.map((x) => x.price)).toEqual(["300", "600", "900", "1200", "1500"]);
    expect(t.questions!.map(slotStatus)).toEqual(["empty", "empty", "ready", "empty", "empty"]);
  });

  it("повторная вставка того же не дублирует: ответ уже в теме", () => {
    const json = { themes: [{ round: 1, name: "Кино", questions: [q(300, "Аватар")] }] };
    const first = run(json);
    applyInsert(first.pkg, first.rows);
    const parsed = parseProposals(JSON.stringify(json));
    const again = planInsert(first.pkg, parsed.ok ? parsed.themes : []);
    expect(again[0].duplicate).toBe(true);
  });

  it("нет раунда — строка с ошибкой, вставка её пропускает", () => {
    const { pkg, rows } = run({ themes: [{ round: 9, name: "А", questions: [q(100, "Б")] }] });
    expect(rows[0].error).toMatch(/нет раунда 9/);
    expect(applyInsert(pkg, rows)).toBe(0);
  });

  it("картинки: скачанная — в вопрос и ответ, не найденная — пометкой в текст", () => {
    const { pkg, rows } = run({ themes: [{ round: 1, name: "Кино", questions: [
      q(300, "Королевская Гавань", { image: "Дубровник", answerImage: "Королевская Гавань кадр" }),
      q(400, "Аватар", { image: "Пандора" }),
    ] }] });
    applyInsert(pkg, rows, { [rows[0].key]: { question: "dubrovnik.jpg", answer: "kl.jpg" } });
    const [q300, q400] = pkg.rounds![0].themes![0].questions!.slice(2, 4);
    expect(questionItems(q300).map((i) => [i.type, i.value])).toEqual([["image", "dubrovnik.jpg"], [undefined, "Вопрос за 300"]]);
    expect(q300.params!.find((p) => p.name === "answer")?.children[0]).toMatchObject({ item: { type: "image", value: "kl.jpg" } });
    expect(questionItems(q400)[0].value).toBe("Вопрос за 400 [🖼 найти: Пандора]");
  });

  it("все типы и варианты ответа переживают запись и чтение", () => {
    const types = ["simple", "secret", "secretPublicPrice", "stake", "stakeAll", "forAll", "noRisk"];
    const qs = types.map((type, i) => q(100 * (i + 1), `О${i}`, { type }));
    qs.push(q(800, "Тонут", { options: ["Плавают", "Тонут"], accept: ["тонет"] }));
    const { pkg, rows } = run({ themes: [{ round: 1, name: "Типы", questions: qs }] });
    applyInsert(pkg, rows);
    const back = parseContentXml(buildContentXml(pkg));
    const t = back.rounds![0].themes!.at(-1)!;
    expect(t.questions!.map((x) => x.type ?? "simple")).toEqual([...types, "simple"]);
    const opt = t.questions![7];
    expect(getOptions(opt).map((o) => o.text)).toEqual(["Плавают", "Тонут"]);
    expect(opt.right).toEqual(["B", "тонет"]);
  });
});

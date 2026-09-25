import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deletePreset, presetInfos, putPreset, setPresetsDir } from "../src/core/ai/imagePresets";
import {
  assembleSystem, BUILTIN_PRESETS, blankPreset, fillTemplate, normalizePreset, sameContent, templateToModel, toTemplate,
} from "../src/core/ai/presetText";

const kids = BUILTIN_PRESETS.find((p) => p.id === "kids")!;

describe("assembleSystem", () => {
  it("собирает ядро, примеры, словарь уточнений и общие правила", () => {
    const text = assembleSystem(kids);
    expect(text.startsWith(kids.system)).toBe(true);
    expect(text).toContain("«Титаник» → a man and a woman");
    expect(text).toContain("«бензопила» = a motorized chainsaw");
    expect(text).toContain("never just 'saw'");
    expect(text).toContain("Reply with ONLY the image prompt");
  });

  it("пустые строки примеров и словаря пропускает, без стиля — не запрещает стиль", () => {
    const text = assembleSystem({ ...blankPreset("x"), mode: "model", system: "Core.", styleMode: "none", examples: [{ phrase: "", scene: "" }], glossary: [{ word: "а", en: "" }] });
    expect(text).not.toContain("Examples:");
    expect(text).not.toContain("name them exactly");
    expect(text).not.toContain("the style is added separately");
  });
});

describe("шаблоны", () => {
  it("подставляет фразу вместо {фраза} и {phrase}", () => {
    expect(fillTemplate("a fat {фраза} on a throne, {PHRASE} again", "кот")).toBe("a fat кот on a throne, кот again");
  });

  it("промпт автора превращает в шаблон", () => {
    expect(toTemplate("a fat кот on a throne", "кот")).toBe("a fat {фраза} on a throne");
    expect(toTemplate("a cat", "")).toBe("a cat");
  });

  it("шаблон становится инструкцией с образцом", () => {
    const m = templateToModel({ ...blankPreset("x"), example: "кот", template: "a fat {фраза} on a throne" });
    expect(m.mode).toBe("model");
    expect(m.system).not.toContain("Sample scene");
    expect(m.examples).toEqual([{ phrase: "кот", scene: "a fat кот on a throne" }]);
    expect(templateToModel({ ...blankPreset("y"), template: "a fat {фраза}" }).system).toContain("Sample scene: a fat <the phrase>");
  });
});

describe("normalizePreset", () => {
  it("достраивает недостающее и отбрасывает мусор", () => {
    const p = normalizePreset({ id: "my-1", title: "  ", mode: "чужой", styles: ["epic", 5], examples: [{ phrase: "а", scene: 1, extra: true }] })!;
    expect(p.title).toBe("Мой пресет");
    expect(p.mode).toBe("template");
    expect(p.styles).toEqual(["epic"]);
    expect(p.examples).toEqual([{ phrase: "а", scene: "" }]);
    expect(p.noText).toBe(true);
    expect(normalizePreset({ title: "без id" })).toBeNull();
  });

  it("встроенный из файла сравнивается со своим исходным по сути", () => {
    expect(sameContent(normalizePreset({ ...kids }, kids)!, kids)).toBe(true);
    expect(sameContent(normalizePreset({ ...kids, temperature: 0.5 }, kids)!, kids)).toBe(false);
  });
});

describe("хранилище пресетов", () => {
  let dir = "";
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "presets-")); setPresetsDir(dir); });
  afterEach(() => { setPresetsDir(""); rmSync(dir, { recursive: true, force: true }); });

  it("без файла — только встроенные", () => {
    expect(presetInfos().map((p) => p.id)).toEqual(["literal", "kids", "free"]);
  });

  it("свой пресет добавляется в конец, правится на месте и удаляется", () => {
    putPreset({ ...blankPreset("my-a"), title: "Кот", template: "a fat {фраза}" });
    putPreset({ ...blankPreset("my-b"), title: "Пёс" });
    putPreset({ ...blankPreset("my-a"), title: "Кот 2", template: "a fat {фраза}" });
    expect(presetInfos().map((p) => p.title).slice(3)).toEqual(["Кот 2", "Пёс"]);
    expect(deletePreset("my-a").map((p) => p.id)).toEqual(["literal", "kids", "free", "my-b"]);
  });

  it("правка встроенного хранится поверх исходного и снимается «Вернуть исходный»", () => {
    const list = putPreset({ ...kids, temperature: 0.4 });
    expect(list.find((p) => p.id === "kids")).toMatchObject({ temperature: 0.4, edited: true, builtin: true });
    expect(deletePreset("kids").find((p) => p.id === "kids")).toEqual(kids);
  });

  it("сохранение встроенного без изменений правку не заводит", () => {
    putPreset({ ...kids });
    expect(JSON.parse(readFileSync(join(dir, "image-presets.json"), "utf8")).builtins).toEqual({});
  });

  it("правку инструкции из старого image-prompts.json подхватывает", () => {
    writeFileSync(join(dir, "image-prompts.json"), JSON.stringify({ literal: "Старая инструкция." }));
    expect(presetInfos()[0]).toMatchObject({ system: "Старая инструкция.", edited: true });
  });

  it("id встроенного в списке своих не даёт подменить встроенный", () => {
    writeFileSync(join(dir, "image-presets.json"), JSON.stringify({ own: [{ ...blankPreset("kids"), title: "Подмена" }], builtins: {} }));
    expect(presetInfos().filter((p) => p.id === "kids")).toEqual([kids]);
  });
});

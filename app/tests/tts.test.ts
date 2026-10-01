import { describe, expect, it } from "vitest";
import { TARGETS, piperVoiceForLang, targetById } from "../src/core/tts/languages";
import { buildTranslateMessages, fixMixedScript, parseVariants, translateStages } from "../src/core/tts/translate";
import type { AiConfig } from "../src/core/ai/config";
import { applyRight, applyToItems, planPlacement } from "../src/core/tts/placement";

describe("цели перевода", () => {
  it("латынь читаем итальянским голосом, свой вариант — русским", () => {
    expect(targetById("la").ttsLang).toBe("it");
    expect(targetById("la").piperVoice).toBe("piper-it-paola");
    expect(targetById("custom").ttsLang).toBe("ru");
    expect(targetById("нет такой").id).toBe("none");
    expect(TARGETS.map((t) => t.id)).toContain("ja");
    expect(piperVoiceForLang("ru")).toBe("piper-ru-irina");
    expect(piperVoiceForLang("ja")).toBeUndefined();
  });
});

describe("запрос перевода", () => {
  it("латынь: промпт на английском, /no_think и три варианта", () => {
    const m = buildTranslateMessages("  Латынь — не хуй собачий ", "la");
    expect(m[0].role).toBe("system");
    expect(m[0].content).toContain("into Latin");
    expect(m[0].content).toContain("/no_think");
    expect(m[0].content).toContain("exactly 3");
    expect(m[1]).toEqual({ role: "user", content: "Латынь — не хуй собачий" });
  });
  it("свой вариант подставляет инструкцию", () => {
    expect(buildTranslateMessages("привет", "custom", "язык Йоды")[0].content).toContain("язык Йоды");
  });
});

describe("разбор вариантов", () => {
  it("срезает думание, нумерацию, кавычки и пустые строки", () => {
    const raw = "<think>hmm\nмного\n</think>\n\n1. «Latina non est»\n2) \"Latina est\"\n- 'Lingua Latina'\n\n4. Пятый";
    expect(parseVariants(raw)).toEqual(["Latina non est", "Latina est", "Lingua Latina"]);
  });
  it("убирает дубли без учёта регистра и подписи вариантов", () => {
    expect(parseVariants("Variant 1: Ave\nVariant 2: ave\nВариант 3 - Salve")).toEqual(["Ave", "Salve"]);
  });
  it("скобки и тире внутри перевода не трогает", () => {
    expect(parseVariants("Nihil (nada) — nihil")).toEqual(["Nihil (nada) — nihil"]);
  });
  it("пустой ответ — пустой список", () => {
    expect(parseVariants("<think>только мысли</think>")).toEqual([]);
  });
});

describe("раскладка по вопросу и ответу", () => {
  const data = { translated: "Latina non est", original: "Латынь — не хуй", audioName: "voice.mp3" };
  it("звук и текст в вопросе, оригинал в ответ", () => {
    const p = planPlacement({ soundInQuestion: true, textOnScreen: true, originalToAnswer: true, soundInAnswer: false }, data);
    expect(p.question).toEqual([{ value: "Latina non est" }, { type: "audio", isRef: "True", value: "voice.mp3" }]);
    expect(p.answer).toEqual([]);
    expect(p.right).toBe("Латынь — не хуй");
  });
  it("без файла звука элементов озвучки нет", () => {
    const p = planPlacement({ soundInQuestion: true, textOnScreen: false, originalToAnswer: false, soundInAnswer: true }, { ...data, audioName: undefined });
    expect(p).toEqual({ question: [], answer: [], right: undefined });
  });
  it("звук встаёт перед текстом на один экран с ним", () => {
    const p = planPlacement({ soundInQuestion: true, textOnScreen: true, originalToAnswer: false, soundInAnswer: true }, data);
    const items = applyToItems([], p.question);
    expect(items.map((i) => i.type ?? "text")).toEqual(["audio", "text"]);
    expect(items[0].waitForFinish).toBe("False");
    expect(applyToItems([{ value: "Что это?" }], p.answer).map((i) => i.type ?? "text")).toEqual(["audio", "text"]);
  });
  it("правильный ответ: заготовку заменяет, повтор не добавляет", () => {
    expect(applyRight([""], "Привет")).toEqual(["Привет"]);
    expect(applyRight(["привет"], "Привет")).toEqual(["привет"]);
    expect(applyRight(["Здравствуй"], "Привет")).toEqual(["Здравствуй", "Привет"]);
    expect(applyRight(["x"], undefined)).toEqual(["x"]);
  });
});

describe("порядок переводчиков", () => {
  const cfg: AiConfig = {
    providers: {
      google: { kind: "openai", base: "https://generativelanguage.googleapis.com/v1beta/openai", models: ["gemini-3-flash-preview"] },
      groq: { kind: "openai", base: "https://api.groq.com/openai/v1", models: ["openai/gpt-oss-120b"] },
      off: { kind: "openai", base: "https://example.com/v1", models: ["x"], disabled: true },
      lmstudio: { kind: "openai", base: "http://127.0.0.1:1234/v1", models: ["qwen3-30b"] },
      sdcpp: { kind: "openai", base: "http://127.0.0.1:7861/v1", models: ["sd"] },
    },
    chain: ["groq:openai/gpt-oss-120b", "google:gemini-3-flash-preview", "off:x", "lmstudio:qwen3-30b"],
  };
  it("облако первым (в порядке общей очереди), потом локальные сервисы, своя модель — последней", () => {
    expect(translateStages(cfg, true, true, "sdcpp")).toEqual([
      { kind: "cloud", chain: ["groq:openai/gpt-oss-120b", "google:gemini-3-flash-preview"] },
      { kind: "local", chain: ["lmstudio:qwen3-30b"] },
      { kind: "own" },
    ]);
  });
  it("без разрешения облака — только локально", () => {
    expect(translateStages(cfg, false, false, "sdcpp")).toEqual([{ kind: "local", chain: ["lmstudio:qwen3-30b"] }]);
    expect(translateStages(null, true, true, "sdcpp")).toEqual([{ kind: "own" }]);
  });
  it("латынь: подсказка с классической бранью", () => {
    expect(buildTranslateMessages("хуй", "la")[0].content).toContain("mentula");
    expect(buildTranslateMessages("хуй", "en")[0].content).not.toContain("mentula");
  });
});

describe("чистка вариантов", () => {
  it("русская «а» в латинском слове — латинская; русские слова целы", () => {
    expect(fixMixedScript("Mulier ebri\u0430 non est")).toBe("Mulier ebria non est");
    expect(fixMixedScript("пьяная баба")).toBe("пьяная баба");
  });
  it("латынь без долгот, другие языки — как есть", () => {
    expect(parseVariants("culō meō sentīo\nsentio", "la")).toEqual(["culo meo sentio", "sentio"]);
    expect(parseVariants("Ça va", "fr")).toEqual(["Ça va"]);
  });
});

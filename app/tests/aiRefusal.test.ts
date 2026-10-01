// Отказ модели — повод идти к следующей в очереди, а не текст сцены.
// И выбор модели картинки: очередь плюс свои модели вне очереди, с пометкой «без цензуры».

import { describe, expect, it } from "vitest";
import { clean, isRefusal } from "../src/core/ai/chat";
import type { AiConfig } from "../src/core/ai/config";
import { imageModelInfos } from "../src/core/ai/image";

describe("отказ модели", () => {
  it("узнаёт английские отказы", () => {
    expect(isRefusal("I'm sorry, but I can't help with that.")).toBe(true);
    expect(isRefusal("I’m sorry, but I can’t help with that.".replace(/’/g, "'"))).toBe(true);
    expect(isRefusal("I can't assist with that request.")).toBe(true);
    expect(isRefusal("Sorry, I cannot create that content.")).toBe(true);
  });

  it("узнаёт отказ с типографским апострофом, как на снимке автора", () => {
    expect(isRefusal("I’m sorry, but I can’t help with that.")).toBe(true);
  });

  it("узнаёт русские отказы", () => {
    expect(isRefusal("Извините, но я не могу помочь с этим запросом.")).toBe(true);
    expect(isRefusal("К сожалению, не могу выполнить эту просьбу.")).toBe(true);
  });

  it("не путает сцену с отказом", () => {
    expect(isRefusal("A man says sorry to his cat in a cozy kitchen, warm light.")).toBe(false);
    expect(isRefusal("Old photo: a sorry-looking dog sits by the door, I can't stop smiling at it.")).toBe(false);
  });

  it("длинный ответ отказом не считает, даже если начинается похоже", () => {
    expect(isRefusal(`I'm sorry, but I can't believe how ${"big ".repeat(100)}this cake is — a giant cake on a table.`)).toBe(false);
  });
});

describe("чистка рассуждений", () => {
  it("отрезает рассуждение без открывающего тега — так отвечает llama-server с --jinja", () => {
    expect(clean("Okay, let me think about this.\nThe idiom means…\n</think>\n\nA cat in boots.")).toBe("A cat in boots.");
  });

  it("убирает и полный блок <think>", () => {
    expect(clean("<think>хм</think>Кот в сапогах")).toBe("Кот в сапогах");
  });

  it("обычный ответ не трогает", () => {
    expect(clean("  A cat in boots.  ")).toBe("A cat in boots.");
  });
});

describe("модели картинок для выбора", () => {
  const cfg: AiConfig = {
    providers: {
      sdcpp: { title: "Своя видеокарта", base: "http://127.0.0.1:7861/v1", imageModels: ["sd-cpp-local"], launch: { exe: "sd-server.exe" } },
      pony: { title: "Pony V6", base: "http://127.0.0.1:7871/v1", imageModels: ["sd-cpp-local"], launch: { exe: "sd-server.exe" }, uncensored: true },
      cloudflare: { title: "Cloudflare", base: "x", imageModels: ["@cf/black-forest-labs/flux-2-klein-9b"] },
      off: { title: "Выключен", base: "x", imageModels: ["m"], disabled: true },
    },
    imageChain: ["sdcpp:sd-cpp-local", "cloudflare:@cf/black-forest-labs/flux-2-klein-9b"],
  };

  it("сначала очередь, потом модели вне очереди; выключенные не показывает", () => {
    expect(imageModelInfos(cfg).map((m) => m.ref)).toEqual(["sdcpp:sd-cpp-local", "cloudflare:@cf/black-forest-labs/flux-2-klein-9b", "pony:sd-cpp-local"]);
  });

  it("свои модели подписаны названием сервиса и помечены без цензуры", () => {
    const pony = imageModelInfos(cfg).find((m) => m.ref === "pony:sd-cpp-local")!;
    expect(pony).toMatchObject({ title: "Pony V6", uncensored: true, local: true });
    expect(imageModelInfos(cfg)[1].title).toBe("Cloudflare: flux-2-klein-9b");
  });
});

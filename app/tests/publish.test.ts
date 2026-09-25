import { describe, expect, it } from "vitest";
import { buildVkPost } from "../src/core/siq/publish";
import { newQuestion } from "../src/core/siq/helpers";
import type { Package } from "../src/core/siq/model";

/** Маленький выдуманный пак: 2 обычных раунда + финал, одна пустая (служебная) тема. */
function samplePack(): Package {
  return {
    attrs: [["name", "Уе!пак — проверка"], ["version", "5"], ["id", "x"], ["xmlns", "y"]],
    order: ["tags", "info", "rounds"],
    tags: ["наука", "кино 90-х"],
    info: { authors: ["Иванов", "Петров"], comments: "Пак для теста поста ВК." },
    rounds: [
      {
        name: "Раунд 1",
        themes: [
          { name: "Химия", questions: [newQuestion(100)] },
          { name: "  ", questions: [newQuestion(200)] }, // служебная — пропускается
        ],
      },
      {
        name: "Раунд 2",
        themes: [{ name: "Физика", questions: [newQuestion(300)] }],
      },
      { name: "ФИНАЛ", type: "final", themes: [{ name: "Всякое", questions: [newQuestion(0)] }] },
    ],
  };
}

describe("buildVkPost", () => {
  it("собирает пост: название, авторы, статистика, раунды, комментарий, хэштеги", () => {
    const text = buildVkPost(samplePack());
    expect(text).toBe(
      "📦 Уе!пак — проверка\n" +
        "✍️ Автор(ы): Иванов, Петров\n" +
        "🎯 Раундов: 3 · тем: 4 · вопросов: 4\n\n" +
        "Раунд 1:\n• Химия\n\n" +
        "Раунд 2:\n• Физика\n\n" +
        "Финал:\n• Всякое\n\n" +
        "Пак для теста поста ВК.\n\n" +
        "#свояк #sigame #своя_игра #наука #кино_90х\n" +
        "Сделано в Ye!Studio",
    );
  });

  it("без авторов строка «Автор(ы)» не появляется", () => {
    const pkg = samplePack();
    pkg.info = { comments: pkg.info!.comments };
    const text = buildVkPost(pkg);
    expect(text).not.toContain("Автор(ы)");
    expect(text.split("\n")[0]).toBe("📦 Уе!пак — проверка");
  });

  it("без комментария и тегов — только хэштеги свояка", () => {
    const pkg = samplePack();
    pkg.info = { authors: ["Иванов"] };
    pkg.tags = [];
    const text = buildVkPost(pkg);
    expect(text).not.toContain("Пак для теста");
    expect(text).toContain("#свояк #sigame #своя_игра\nСделано в Ye!Studio");
  });

  it("комментарий обрезается по commentLimit", () => {
    const pkg = samplePack();
    pkg.info!.comments = "а".repeat(600);
    const text = buildVkPost(pkg, { commentLimit: 10 });
    expect(text).toContain("а".repeat(10) + "\n\n#свояк");
  });
});

import { describe, expect, it } from "vitest";
import { buildVkPost, reviewsUrl } from "../src/core/siq/publish";
import { newQuestion } from "../src/core/siq/helpers";
import type { Package } from "../src/core/siq/model";

/** Маленький выдуманный пак: 2 обычных раунда + финал. */
function samplePack(name = "Уе!пак №11"): Package {
  return {
    attrs: [["name", name], ["version", "5"], ["id", "x"], ["xmlns", "y"]],
    order: ["tags", "info", "rounds"],
    tags: ["наука", "кино 90-х"],
    info: { authors: ["Иванов", "Петров"], comments: "Пак для теста поста ВК." },
    rounds: [
      { name: "Раунд 1", themes: [{ name: "Химия", questions: [newQuestion(100)] }] },
      { name: "Раунд 2", themes: [{ name: "Физика", questions: [newQuestion(300)] }] },
      { name: "ФИНАЛ", type: "final", themes: [{ name: "Всякое", questions: [newQuestion(0)] }] },
    ],
  };
}

describe("buildVkPost", () => {
  it("собирает пост: название, авторы, приглашение, отзывы, хэштеги", () => {
    expect(buildVkPost(samplePack())).toBe(
      "📦 Уе!пак №11\n" +
        "✍️ Автор(ы): Иванов, Петров\n\n" +
        "Приятной игры! 🎉\n" +
        "Пак протестирован на живых людях. Играть лучше с фальстартами и ведущим-человеком.\n\n" +
        "💬 Сыграли? Загляните на уепак.рф/11 и расскажите, как вам пак.\n" +
        "Читаем каждый отзыв — по ним делаем следующие паки ❤️\n\n" +
        "#свояк #sigame #своя_игра #наука #кино_90х\n" +
        "Сделано в Ye!Studio",
    );
  });

  it("темы и комментарий к паку в пост не попадают", () => {
    const text = buildVkPost(samplePack());
    expect(text).not.toContain("Химия");
    expect(text).not.toContain("Финал");
    expect(text).not.toContain("Пак для теста");
  });

  it("без авторов строка «Автор(ы)» не появляется", () => {
    const pkg = samplePack();
    pkg.info = {};
    expect(buildVkPost(pkg)).not.toContain("Автор(ы)");
  });

  it("без тегов — только хэштеги свояка", () => {
    const pkg = samplePack();
    pkg.tags = [];
    expect(buildVkPost(pkg)).toContain("#свояк #sigame #своя_игра\nСделано в Ye!Studio");
  });
});

describe("reviewsUrl", () => {
  it("«Уе!пак №N» — своя страница, остальные — общая", () => {
    expect(reviewsUrl("Уе!пак №7 — осень")).toBe("уепак.рф/7");
    expect(reviewsUrl("Уе! пак № 011")).toBe("уепак.рф/11");
    expect(reviewsUrl("Новый пак")).toBe("уепак.рф");
  });
});

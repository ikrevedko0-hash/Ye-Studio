import { describe, expect, it } from "vitest";
import { buildPosterHtml } from "../src/core/siq/poster";
import { newQuestion } from "../src/core/siq/helpers";
import type { Package } from "../src/core/siq/model";

/** Маленький выдуманный пак: 2 обычных раунда + финал, одна пустая (служебная) тема. */
function samplePack(): Package {
  return {
    attrs: [["name", "Уе!пак — проверка"], ["version", "5"], ["id", "x"], ["xmlns", "y"]],
    order: ["tags", "info", "rounds"],
    tags: ["наука"],
    info: { authors: ["Иванов", "Петров"], comments: "Служебный комментарий, не для афиши." },
    rounds: [
      {
        name: "Раунд 1",
        themes: [
          { name: "<script>alert(1)</script>", questions: [newQuestion(100)] },
          { name: "  ", questions: [newQuestion(200)] }, // служебная — пропускается
        ],
      },
      {
        name: "Раунд 2",
        themes: [{ name: "Физика", questions: [{ ...newQuestion(300), right: ["секретный ответ"] }] }],
      },
      { name: "ФИНАЛ", type: "final", themes: [{ name: "Всякое", questions: [newQuestion(0)] }] },
      { name: "Пустой раунд", themes: [{ name: "  ", questions: [newQuestion(0)] }] },
    ],
  };
}

describe("buildPosterHtml", () => {
  it("экранирует названия тем — <script> не попадает как тег", () => {
    const html = buildPosterHtml(samplePack());
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("финал подписан «Финал»", () => {
    const html = buildPosterHtml(samplePack());
    expect(html).toMatch(/<section class="round final"[^>]*>\s*<h2>.*<span class="title">Финал<\/span>/);
    expect(html).not.toContain("ФИНАЛ");
  });

  it("нет цен, текста вопросов и служебных комментариев", () => {
    const html = buildPosterHtml(samplePack());
    expect(html).not.toContain("секретный ответ");
    expect(html).not.toContain("Служебный комментарий");
    expect(html).not.toMatch(/>\s*100\s*</); // цена вопроса не выводится отдельным элементом
  });

  it("пустые темы и раунды без тем пропущены", () => {
    const html = buildPosterHtml(samplePack());
    // в первом раунде из двух тем только одна непустая
    expect((html.match(/class="card"/g) ?? []).length).toBe(3);
    expect(html).not.toContain("Пустой раунд");
  });

  it("название пака и авторы присутствуют", () => {
    const html = buildPosterHtml(samplePack());
    expect(html).toContain("Уе!пак — проверка");
    expect(html).toContain("Иванов, Петров");
  });

  it("без названия — «Без названия»", () => {
    const pkg = samplePack();
    pkg.attrs = pkg.attrs.filter(([k]) => k !== "name");
    const html = buildPosterHtml(pkg);
    expect(html).toContain("Без названия");
  });
});

import { describe, expect, it } from "vitest";
import { buildPackCard, buildVkPost, difficultyLabel, playTimeLabel, reviewsUrl } from "../src/core/siq/publish";
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

// ---------- точные проверки по выжившим мутантам Stryker ----------

describe("пост ВК: точно", () => {
  it("номер пака — только в начале названия (пробелы перед — можно), «№» и пробелы вокруг — любые", () => {
    expect(reviewsUrl("  Уе!пак №3")).toBe("уепак.рф/3");
    expect(reviewsUrl("Уе!  пак  №   12")).toBe("уепак.рф/12");
    expect(reviewsUrl("Лучший Уе!пак №5")).toBe("уепак.рф");
    expect(reviewsUrl("xУе!пак №5")).toBe("уепак.рф");
    expect(reviewsUrl("уе!ПАК №9")).toBe("уепак.рф/9");
    expect(reviewsUrl("Уе!пак №1234")).toBe("уепак.рф");
  });

  it("название и авторы — без пробелов по краям; пустые авторы выпадают; без названия — «Без названия»", () => {
    const pkg = samplePack("  Уе!пак №2  ");
    pkg.info = { authors: ["  Иванов ", "   ", "Петров"] };
    const post = buildVkPost(pkg);
    expect(post.startsWith("📦 Уе!пак №2\n✍️ Автор(ы): Иванов, Петров\n\n")).toBe(true);
    const noName = samplePack("");
    noName.attrs = noName.attrs.filter(([k]) => k !== "name");
    delete noName.info;
    expect(buildVkPost(noName).startsWith("📦 Без названия\n\nПриятной игры!")).toBe(true);
    expect(buildVkPost(samplePack("   ")).startsWith("📦 Без названия\n")).toBe(true);
  });

  it("теги: пробелы по краям срезаются, внутри — «_» (несколько подряд — один), знаки выкидываются, пустые — выпадают", () => {
    const pkg = samplePack();
    pkg.tags = ["  кино   90-х  ", "!!!", "рок-н-ролл"];
    expect(buildVkPost(pkg).endsWith("#свояк #sigame #своя_игра #кино_90х #рокнролл\nСделано в Ye!Studio")).toBe(true);
  });

  it("нет tags вовсе — тоже только хэштеги свояка", () => {
    const pkg = samplePack();
    delete pkg.tags;
    expect(buildVkPost(pkg).endsWith("#свояк #sigame #своя_игра\nСделано в Ye!Studio")).toBe(true);
  });
});

describe("buildPackCard", () => {
  /** Готовый вопрос: текст и ответ, иначе клетка считается пустой. */
  const ready = (price: number) => ({ ...newQuestion(price), params: [{ name: "question", type: "content", children: [{ kind: "item" as const, item: { value: "?" } }] }], right: ["!"] });

  it("шаблон топа: о паке, [сложность] [время] [число вопросов], как играть, ссылки", () => {
    const pkg = samplePack();
    pkg.attrs.push(["difficulty", "3"], ["restriction", "18+"]);
    pkg.rounds![0].themes![0].questions = [ready(100), ready(200), newQuestion(300)];
    expect(buildPackCard(pkg, { steamUrl: " https://steamcommunity.com/sharedfiles/filedetails/?id=1 " })).toBe(
      "Пак для теста поста ВК.\n\n" +
        "[Уровень сложности: 🟢 Легко]\n[Время прохождения: ~0,5 ч]\n[Число вопросов: 2]\n[Возраст: 18+]\n\n" +
        "Играть лучше с фальстартами и ведущим-человеком. Если плохо грузит медиа — играйте через браузер.\n\n" +
        "💬 Отзывы и оценки: уепак.рф/11\nSteam: https://steamcommunity.com/sharedfiles/filedetails/?id=1",
    );
  });

  it("предупреждение о юморе — по галочке; без сложности и Steam строк нет", () => {
    const pkg = samplePack();
    pkg.info = {};
    const text = buildPackCard(pkg, { humorWarning: true });
    expect(text.startsWith("⚠️ В паке есть чёрный")).toBe(true);
    expect(text).not.toContain("Уровень сложности");
    expect(text).not.toContain("Steam");
  });

  it("сложность и время — как в описаниях топ-паков", () => {
    expect([1, 3, 4, 6, 7, 10].map(difficultyLabel)).toEqual(["🟢 Легко", "🟢 Легко", "🟡 Нормально", "🟡 Нормально", "🔴 Сложно", "🔴 Сложно"]);
    expect(difficultyLabel(NaN)).toBeUndefined();
    expect(playTimeLabel(152)).toBe("~1,5 ч");
    expect(playTimeLabel(175)).toBe("~2 ч");
    expect(playTimeLabel(10)).toBe("~0,5 ч");
  });
});

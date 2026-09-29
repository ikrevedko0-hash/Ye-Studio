import { describe, expect, it } from "vitest";
import { headline } from "../src/renderer/src/UpdateBanner";

describe("headline заметок к обновлению", () => {
  it("пропускает заголовок «Что нового:» и маркер списка", () => {
    expect(headline("Что нового:\n- Проверка повторов снова работает.\n- Второе")).toBe("Проверка повторов снова работает.");
  });
  it("пустые заметки — пустая строка", () => {
    expect(headline(undefined)).toBe("");
    expect(headline("Что нового:")).toBe("");
  });
});

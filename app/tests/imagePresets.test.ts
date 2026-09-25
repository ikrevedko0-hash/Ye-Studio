import { describe, expect, it } from "vitest";
import { splitWork } from "../src/core/ai/imagePresets";

describe("splitWork", () => {
  it("отделяет строку WORK от сцены", () => {
    const r = splitWork("WORK: Midsommar (2019, Ari Aster)\nA crying girl in a huge flower dress.");
    expect(r).toEqual({ work: "Midsommar (2019, Ari Aster)", scene: "A crying girl in a huge flower dress." });
  });

  it("терпит markdown-обёртку и пустые строки", () => {
    const r = splitWork("**WORK: Titanic (1997, James Cameron)**\n\nTwo people on a ship's bow.");
    expect(r.work).toBe("Titanic (1997, James Cameron)");
    expect(r.scene).toBe("Two people on a ship's bow.");
  });

  it("без строки WORK — сцена целиком", () => {
    expect(splitWork("  A gigantic louse over a city.  ")).toEqual({ scene: "A gigantic louse over a city." });
  });
});

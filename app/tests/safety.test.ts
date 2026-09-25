import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { backupBeforeOverwrite, clearDraft, readDraft, writeDraft } from "../src/main/safety";
import { newPackage } from "../src/core/siq/helpers";
import { openSiq } from "../src/core/siq/zip";

const tmp = () => mkdtemp(join(tmpdir(), "ye-safety-"));

describe("резервные копии", () => {
  it("прежний файл уезжает в копии, храним последние keep", async () => {
    const dir = await tmp();
    const target = join(dir, "Мой пак.siq");
    const root = join(dir, "копии");
    for (let i = 0; i < 4; i++) {
      await writeFile(target, `версия ${i}`);
      const dest = await backupBeforeOverwrite(target, root, 2);
      expect(existsSync(target)).toBe(false);
      expect(await readFile(dest!, "utf8")).toBe(`версия ${i}`);
      await new Promise((r) => setTimeout(r, 1100)); // имя копии — с точностью до секунды
    }
    const kept = await readdir(join(root, "Мой пак"));
    expect(kept.length).toBe(2);
  }, 10000);

  it("нет файла — нечего копировать", async () => {
    const dir = await tmp();
    expect(await backupBeforeOverwrite(join(dir, "нет.siq"), join(dir, "к"))).toBeNull();
  });
});

describe("черновик", () => {
  it("пишется открываемым паком, читается и стирается", async () => {
    const dir = await tmp();
    const pkg = newPackage("Черновой");
    const meta = await writeDraft(dir, pkg, [], "C:/паки/Черновой.siq");
    const info = await readDraft(dir);
    expect(info).toMatchObject({ name: "Черновой", origPath: "C:/паки/Черновой.siq", file: meta.file });
    const opened = await openSiq(meta.file);
    expect(opened.pkg.attrs.find(([k]) => k === "name")?.[1]).toBe("Черновой");
    opened.reader.close();
    await writeDraft(dir, pkg, []);
    expect((await readdir(dir)).filter((f) => f.startsWith("draft-")).length).toBe(1);
    await clearDraft(dir);
    expect(await readDraft(dir)).toBeNull();
  });
});

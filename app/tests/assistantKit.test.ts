import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { userInfo } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import yauzl from "yauzl";
import { CHATGPT_DIR, findClaudeSkill, setupAssistant, SKILL_NAME, SKILL_ZIP } from "../src/main/assistantKit";

const KIT = join(__dirname, "..", "resources", "assistant-kit");
const temps: string[] = [];
const temp = async () => { const d = await mkdtemp(join(tmpdir(), "assistant-kit-")); temps.push(d); return d; };
afterEach(async () => { for (const d of temps.splice(0)) await rm(d, { recursive: true, force: true }); });

function zipEntries(file: string): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      const out = new Map<string, string>();
      zip.on("entry", (e: yauzl.Entry) => zip.openReadStream(e, (er, s) => {
        if (er || !s) return reject(er);
        const parts: Buffer[] = [];
        s.on("data", (c: Buffer) => parts.push(c));
        s.on("end", () => { out.set(e.fileName, Buffer.concat(parts).toString("utf8")); zip.readEntry(); });
      }));
      zip.on("end", () => resolve(out));
      zip.readEntry();
    });
  });
}

describe("набор помощника", () => {
  it("в наборе нет путей автора, шаблоны ждут данные", async () => {
    const skill = await readFile(join(KIT, "skill", "SKILL.md"), "utf8");
    expect(skill).toContain("{{WORKDIR}}");
    // ни путей с машины автора, ни его имени пользователя
    expect(skill).not.toMatch(/Рабочий стол|OneDrive|[A-Z]:\\Users\\/);
    expect(skill).not.toContain(userInfo().username);
    for (const t of ["шаблон разметки тем.html", "шаблон разметки вопросов.html"]) {
      expect(await readFile(join(KIT, "workdir", "инструменты", t), "utf8")).toContain("/*DATA*/null");
    }
  });

  it("Claude: рабочая папка, навык в ~/.claude и архив для загрузки", async () => {
    const home = await temp();
    const work = join(await temp(), "Подсказки");
    const r = await setupAssistant(KIT, "claude", work, home);
    expect(r.added).toContain("Как отдавать вопросы в Мастерскую.md");
    expect(r.added).toContain("инструменты/собрать разметку.py");
    expect(await readdir(work)).toContain("входящие");

    const skill = await readFile(join(home, ".claude", "skills", SKILL_NAME, "SKILL.md"), "utf8");
    expect(skill).toContain(work);
    expect(skill).not.toContain("{{WORKDIR}}");
    expect(await findClaudeSkill(home)).toBe(r.skillPath);

    const zip = await zipEntries(join(work, SKILL_ZIP));
    expect([...zip.keys()]).toEqual([`${SKILL_NAME}/SKILL.md`]);
    expect(zip.get(`${SKILL_NAME}/SKILL.md`)).toBe(skill);
  });

  it("повторная установка не перезаписывает гайд, который автор уже дописал", async () => {
    const home = await temp();
    const work = await temp();
    await setupAssistant(KIT, "claude", work, home);
    await writeFile(join(work, "Гайд по вкусу.md"), "мой гайд", "utf8");
    const again = await setupAssistant(KIT, "chatgpt", work, home);
    expect(again.added).toEqual([]);
    expect(await readFile(join(work, "Гайд по вкусу.md"), "utf8")).toBe("мой гайд");
  });

  it("ChatGPT: папка с файлами проекта и инструкции", async () => {
    const work = await temp();
    const r = await setupAssistant(KIT, "chatgpt", work, await temp());
    const files = await readdir(join(work, CHATGPT_DIR));
    expect(files).toEqual(expect.arrayContaining([
      "Инструкции проекта.txt", "Гайд по вкусу.md", "Как отдавать вопросы в Мастерскую.md",
      "шаблон разметки тем.html", "шаблон разметки вопросов.html", "пример пачки тем.json", "пример пачки вопросов.json",
    ]));
    expect(r.instructions).toContain("Вставить из AI");
    expect(r.skillPath).toBeUndefined();
  });
});

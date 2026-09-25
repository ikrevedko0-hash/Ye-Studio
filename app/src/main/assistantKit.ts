// Набор помощника: связка «чат с Claude или ChatGPT → страница-разметчик → «Вставить из AI» в Ye!Studio».
//
// В resources/assistant-kit лежат: workdir/ — рабочая папка автора (памятка формата, гайд по вкусу, шаблоны
// разметки и скрипты), skill/SKILL.md — навык для Claude с {{WORKDIR}} вместо пути, chatgpt.md — инструкции
// проекта ChatGPT. Установка раскладывает это по местам на новой машине. Файлы, которые уже есть в рабочей
// папке, не трогаем: гайд по вкусу автор дописывает сам, и переустановка не должна его стереть.

import { createWriteStream, existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import yazl from "yazl";
import type { AssistantKind, AssistantSetupResult } from "../shared/api";

export const SKILL_NAME = "sigame-pack-labeler";
/** Что загружать в «Проект» ChatGPT: у него нет доступа к диску, файлы живут в самом проекте. */
const CHATGPT_FILES = [
  "Гайд по вкусу.md",
  "Как отдавать вопросы в Мастерскую.md",
  "инструменты/шаблон разметки тем.html",
  "инструменты/шаблон разметки вопросов.html",
  "инструменты/пример пачки тем.json",
  "инструменты/пример пачки вопросов.json",
];
export const CHATGPT_DIR = "Для ChatGPT";
export const SKILL_ZIP = `Навык для Claude — ${SKILL_NAME}.zip`;

/**
 * Навык уже стоит на этой машине? Claude Code читает ~/.claude/skills, а Claude Desktop держит
 * загруженные навыки у себя в %APPDATA%\Claude\…\skills-plugin\<id>\<id>\skills. Нашёлся — мастер
 * не навязываем: это машина, где всё уже настроено.
 */
export async function findClaudeSkill(home = homedir()): Promise<string | null> {
  const own = join(home, ".claude", "skills", SKILL_NAME, "SKILL.md");
  if (existsSync(own)) return own;
  const root = process.env.APPDATA ? join(process.env.APPDATA, "Claude", "local-agent-mode-sessions", "skills-plugin") : "";
  if (!root || !existsSync(root)) return null;
  for (const a of await readdir(root).catch(() => [] as string[])) {
    for (const b of await readdir(join(root, a)).catch(() => [] as string[])) {
      const p = join(root, a, b, "skills", SKILL_NAME, "SKILL.md");
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/** Скопировать дерево, не перезаписывая существующее. Возвращает то, что легло впервые (пути от dst). */
async function copyMissing(src: string, dst: string, rel = ""): Promise<string[]> {
  await mkdir(dst, { recursive: true });
  const added: string[] = [];
  for (const e of await readdir(src, { withFileTypes: true })) {
    const from = join(src, e.name);
    const to = join(dst, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) added.push(...(await copyMissing(from, to, r)));
    else if (e.name !== ".keep" && !existsSync(to)) {
      await copyFile(from, to);
      added.push(r);
    }
  }
  return added;
}

function zipOne(zipPath: string, entry: string, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    zip.addBuffer(data, entry);
    zip.end();
    const out = createWriteStream(zipPath);
    out.on("close", () => resolve());
    out.on("error", reject);
    zip.outputStream.pipe(out);
  });
}

export async function setupAssistant(kitDir: string, kind: AssistantKind, workdir: string, home = homedir()): Promise<AssistantSetupResult> {
  const added = await copyMissing(join(kitDir, "workdir"), workdir);
  const result: AssistantSetupResult = { kind, workdir, added };

  if (kind === "claude") {
    const skill = (await readFile(join(kitDir, "skill", "SKILL.md"), "utf8")).replaceAll("{{WORKDIR}}", workdir);
    // Claude Code (и вкладка Code в Claude Desktop) подхватывает навык отсюда сам
    const dir = join(home, ".claude", "skills", SKILL_NAME);
    await mkdir(dir, { recursive: true });
    result.skillPath = join(dir, "SKILL.md");
    await writeFile(result.skillPath, skill, "utf8");
    // чат Claude Desktop и claude.ai берут навык только загрузкой архива: папка навыка внутри zip
    result.skillZip = join(workdir, SKILL_ZIP);
    await zipOne(result.skillZip, `${SKILL_NAME}/SKILL.md`, Buffer.from(skill, "utf8"));
  } else {
    const dir = join(workdir, CHATGPT_DIR);
    await mkdir(dir, { recursive: true });
    // копии рядом, одной папкой: их перетаскивают в проект ChatGPT все разом
    for (const f of CHATGPT_FILES) await copyFile(join(workdir, ...f.split("/")), join(dir, f.split("/").pop()!));
    result.instructions = (await readFile(join(kitDir, "chatgpt.md"), "utf8")).trim();
    await writeFile(join(dir, "Инструкции проекта.txt"), result.instructions, "utf8");
    result.chatgptDir = dir;
  }
  return result;
}

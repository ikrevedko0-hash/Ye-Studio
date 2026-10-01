// Окно «Ключи и модели»: запуск своего сервера, «без цензуры» и начало промпта
// переживают чтение и сохранение, а ключ и незнакомые окну поля остаются как были.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSettings, writeSettings } from "../src/core/ai/settings";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ai-settings-"));
  // настоящий %APPDATA%\siq-workshop\providers.json тест не трогает ни при каком исходе
  vi.stubEnv("APPDATA", dir);
  await writeFile(join(dir, "providers.json"), JSON.stringify({
    providers: {
      own: {
        title: "Своя модель", base: "http://127.0.0.1:7871/v1", imageModels: ["sd-cpp-local"], key: "секрет-1234",
        future: "поле, которого окно не знает",
        launch: { exe: "C:\\engines\\sd-server.exe", cwd: "C:\\models", args: ["-m", "checkpoints/a.safetensors", "--listen-port", "7871"] },
      },
    },
    chain: [], imageChain: [],
  }));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

const saved = async () => JSON.parse(await readFile(join(dir, "providers.json"), "utf8")).providers.own;

describe("запуск своего сервера в окне настроек", () => {
  it("окно видит программу, папку и аргументы", async () => {
    const own = (await readSettings(dir)).providers[0];
    expect(own).toMatchObject({ launchExe: "C:\\engines\\sd-server.exe", launchCwd: "C:\\models", launchArgs: ["-m", "checkpoints/a.safetensors", "--listen-port", "7871"] });
  });

  it("сохраняет «без цензуры», начало промпта и правку аргументов, не теряя ключ и чужие поля", async () => {
    const s = await readSettings(dir);
    s.providers[0] = { ...s.providers[0], uncensored: true, promptPrefix: "score_9, ", launchArgs: ["-m", "checkpoints/b.safetensors", "  ", "--listen-port", "7871"] };
    await writeSettings(dir, s);
    const p = await saved();
    expect(p.uncensored).toBe(true);
    expect(p.promptPrefix).toBe("score_9, ");
    expect(p.launch).toEqual({ exe: "C:\\engines\\sd-server.exe", cwd: "C:\\models", args: ["-m", "checkpoints/b.safetensors", "--listen-port", "7871"] });
    expect(p.key).toBe("секрет-1234");
    expect(p.future).toBe("поле, которого окно не знает");
  });

  it("пустая программа убирает запуск, снятая галочка — пометку", async () => {
    const s = await readSettings(dir);
    s.providers[0] = { ...s.providers[0], launchExe: "  ", uncensored: false, promptPrefix: "" };
    await writeSettings(dir, s);
    const p = await saved();
    expect(p.launch).toBeUndefined();
    expect(p.uncensored).toBeUndefined();
    expect(p.promptPrefix).toBeUndefined();
  });
});

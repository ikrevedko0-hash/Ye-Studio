// Пресеты картинок на диске и фраза → сцена. Сами пресеты и сборка инструкции — в presetText.ts
// (без файлов: его читает и окно). Новый встроенный пресет — новая запись в BUILTIN_PRESETS.
//
// Свои пресеты автора и правки встроенных лежат в image-presets.json в папке приложения. Встроенный
// не удаляется: правка хранится поверх исходного, «Вернуть исходный» её убирает. Старый image-prompts.json
// (только правки инструкций, до своих пресетов) читаем, пока в новом файле правки того же пресета нет.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chat, type ChatResult } from "./chat";
import type { AiConfig } from "./config";
import { assembleSystem, BUILTIN_PRESETS, fillTemplate, NO_TEXT, normalizePreset, sameContent, type ImagePreset } from "./presetText";
import { workContext, workLabel, type WorkDetails } from "./works";

export type { ImagePreset } from "./presetText";

interface PresetFile {
  /** Свои пресеты автора — в порядке колонки. */
  own: ImagePreset[];
  /** Правки встроенных: id → пресет целиком. */
  builtins: Record<string, ImagePreset>;
}

let dir = "";

export function setPresetsDir(path: string): void {
  dir = path;
}

const presetsPath = () => join(dir, "image-presets.json");

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Файл пресетов. Нет его или он битый — пусто: встроенные остаются как в коде. */
function load(): PresetFile {
  if (!dir) return { own: [], builtins: {} };
  const raw = (readJson(presetsPath()) ?? {}) as Partial<Record<keyof PresetFile, unknown>>;
  const own = Array.isArray(raw.own)
    ? raw.own.map((p) => normalizePreset(p)).filter((p): p is ImagePreset => !!p && !BUILTIN_PRESETS.some((b) => b.id === p.id))
    : [];
  const builtins: Record<string, ImagePreset> = {};
  const legacy = (readJson(join(dir, "image-prompts.json")) ?? {}) as Record<string, unknown>;
  for (const b of BUILTIN_PRESETS) {
    const saved = (raw.builtins as Record<string, unknown> | undefined)?.[b.id];
    const p = saved ? normalizePreset({ ...(saved as object), id: b.id }, b) : null;
    if (p) builtins[b.id] = p;
    else if (typeof legacy[b.id] === "string" && (legacy[b.id] as string).trim()) builtins[b.id] = { ...b, system: (legacy[b.id] as string).trim() };
  }
  return { own, builtins };
}

function store(f: PresetFile): void {
  if (!dir) throw new Error("не задана папка для пресетов");
  writeFileSync(presetsPath(), JSON.stringify(f, null, 1));
}

export function presetInfos(): ImagePreset[] {
  const f = load();
  const builtins = BUILTIN_PRESETS.map((b) => {
    const p = f.builtins[b.id];
    return p && !sameContent(p, b) ? { ...p, builtin: true, edited: true } : b;
  });
  return [...builtins, ...f.own];
}

/** Сохранить пресет: встроенный — правкой поверх исходного, свой — новым или на месте прежнего. */
export function putPreset(raw: ImagePreset): ImagePreset[] {
  const base = BUILTIN_PRESETS.find((b) => b.id === raw.id);
  const p = normalizePreset(raw, base);
  if (!p) throw new Error("пресет без id");
  const f = load();
  if (base) {
    if (sameContent(p, base)) delete f.builtins[base.id];
    else f.builtins[base.id] = { ...p, builtin: undefined };
  } else {
    const i = f.own.findIndex((x) => x.id === p.id);
    if (i >= 0) f.own[i] = p;
    else f.own.push(p);
  }
  store(f);
  return presetInfos();
}

/** Удалить свой пресет; у встроенного — убрать правку («Вернуть исходный»). */
export function deletePreset(id: string): ImagePreset[] {
  const f = load();
  if (BUILTIN_PRESETS.some((b) => b.id === id)) delete f.builtins[id];
  else f.own = f.own.filter((p) => p.id !== id);
  store(f);
  return presetInfos();
}

export interface ScenePrompt extends ChatResult {
  /** Какое произведение узнала модель (строка WORK: у «фильма по детскому рисунку»). */
  work?: string;
}

/** Отделить строку «WORK: …» от сцены. Нет её — сцена целиком. */
export function splitWork(raw: string): { work?: string; scene: string } {
  const m = /^[\s*_`]*WORK:\s*(.+?)[\s*_`]*$/im.exec(raw);
  if (!m) return { scene: raw.trim() };
  const scene = (raw.slice(0, m.index) + raw.slice(m.index + m[0].length)).trim();
  return { work: m[1].trim(), scene };
}

/** Запрет подписей текстовая модель помнит, но в промпт почти не пишет, а flux без него ставит подпись. */
function withNoText(p: ImagePreset, text: string): string {
  return !p.noText || !text || /no text/i.test(text) ? text : `${text} ${NO_TEXT}`;
}

/**
 * Фраза → промпт для рисования. Шаблон — подстановка без модели (пустой шаблон — фраза как есть).
 * known — произведение, выбранное из списка Wikidata: модели остаётся только сцена.
 */
export async function phraseToPrompt(
  cfg: AiConfig, phrase: string, presetId: string, signal?: AbortSignal, temperature?: number, known?: WorkDetails,
): Promise<ScenePrompt> {
  const all = presetInfos();
  const preset = all.find((p) => p.id === presetId) ?? all[0];
  if (preset.mode === "template") {
    const text = preset.template.trim() ? fillTemplate(preset.template, phrase) : phrase.trim();
    return { text: withNoText(preset, text), model: "", skipped: [] };
  }
  const r = await chat(cfg, [
    { role: "system", content: assembleSystem(preset) },
    { role: "user", content: known ? `${phrase.trim()}\n\n${workContext(known)}` : phrase.trim() },
  ], signal, { temperature: temperature ?? preset.temperature });
  const { work, scene } = splitWork(r.text);
  const text = scene.replace(/^["«']+|["»']+$/g, "").trim();
  return { ...r, work: known ? workLabel(known) : work, text: withNoText(preset, text) };
}

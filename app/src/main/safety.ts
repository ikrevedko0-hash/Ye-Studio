// Страховка от потери пака:
//  - резервные копии: перед перезаписью .siq прежний файл переезжает в папку копий, храним последние KEEP;
//  - черновик: раз в несколько минут окно присылает несохранённый пак, он пишется в autosave/.
//    После сбоя (свет, падение) при запуске предлагается восстановить. Удачное сохранение
//    и «Не сохранять» при закрытии черновик стирают.

import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { Package } from "../core/siq/model";
import { writeSiq, type EntryToWrite } from "../core/siq/zip";

const KEEP = 5;

const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};

/** Убрать файл target с дороги, сохранив его копией в root/<имя пака>/. Нет файла — ничего не делаем. */
export async function backupBeforeOverwrite(target: string, root: string, keep = KEEP): Promise<string | null> {
  if (!existsSync(target)) return null;
  const dir = join(root, basename(target, ".siq").replace(/[\\/:*?"<>|]/g, "_"));
  await mkdir(dir, { recursive: true });
  const dest = join(dir, `${stamp()}.siq`);
  try {
    await rename(target, dest);
  } catch {
    // другой диск (или файл занят на чтение) — копируем и удаляем
    await copyFile(target, dest);
    await rm(target, { force: true });
  }
  const old = (await readdir(dir)).filter((f) => f.endsWith(".siq")).sort();
  for (const f of old.slice(0, Math.max(0, old.length - keep))) await rm(join(dir, f), { force: true }).catch(() => {});
  return dest;
}

export interface DraftMeta {
  /** файл черновика в папке autosave */
  file: string;
  /** куда пак сохранялся (нет — новый, ещё не сохранённый пак) */
  origPath?: string;
  name: string;
  time: number;
}

const metaPath = (dir: string) => join(dir, "draft.json");

export async function writeDraft(dir: string, pkg: Package, entries: EntryToWrite[], origPath?: string): Promise<DraftMeta> {
  await mkdir(dir, { recursive: true });
  const file = join(dir, `draft-${Date.now()}.siq`);
  await writeSiq(file, pkg, entries);
  const meta: DraftMeta = { file, origPath, name: pkg.attrs.find(([k]) => k === "name")?.[1] || "Новый пак", time: Date.now() };
  await writeFile(metaPath(dir), JSON.stringify(meta), "utf8");
  // прежние черновики: восстановленный может быть открыт на чтение — тогда останется до следующего раза
  for (const f of await readdir(dir)) {
    if (f.startsWith("draft-") && join(dir, f) !== file) await rm(join(dir, f), { force: true }).catch(() => {});
  }
  return meta;
}

export async function readDraft(dir: string): Promise<DraftMeta | null> {
  try {
    const meta = JSON.parse(await readFile(metaPath(dir), "utf8")) as DraftMeta;
    return existsSync(meta.file) ? meta : null;
  } catch {
    return null;
  }
}

export async function clearDraft(dir: string): Promise<void> {
  if (!existsSync(dir)) return;
  await rm(metaPath(dir), { force: true }).catch(() => {});
  for (const f of await readdir(dir)) {
    if (f.startsWith("draft-")) await rm(join(dir, f), { force: true }).catch(() => {});
  }
}

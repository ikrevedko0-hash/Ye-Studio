// Установка локальной модели картинок одной кнопкой: скачать файлы профиля из манифеста
// (с докачкой и проверкой SHA256), распаковать sd.cpp, прописать сервер в providers.json.
//
// Докачка: файл качается в «<имя>.part». Оборвалось — при следующем нажатии запрос идёт с Range
// с того места, где остановились; сервер не умеет Range — качаем заново. Сумма считается по
// готовому файлу целиком, и только после совпадения .part становится настоящим файлом.
// Уже лежащий файл точного размера повторно не качается (сумму всё равно проверяем).

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, statSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import yauzl from "yauzl";
import { findAiConfig, type AiConfig } from "../core/ai/config";
import { once, httpReason } from "../core/media/providers/http";
import { detectProfile, launchFor, MODEL_DIR, parseManifest, planProfile, planTool, totalBytes, type Manifest, type PlannedFile } from "../core/components/manifest";
import type { ProfileId } from "../core/system/probe";
import type { InstallProgress } from "../core/components/manifest";

export type { InstallProgress };
import { readComponents, saveComponent, forgetComponent } from "./components";


export const SD_PROVIDER_ID = "sdcpp";
const SD_REF = `${SD_PROVIDER_ID}:sd-cpp-local`;

const sizeOf = (p: string): number | null => {
  try { return statSync(p).size; } catch { return null; }
};

async function sha256(path: string, signal?: AbortSignal): Promise<string> {
  const h = createHash("sha256");
  await pipeline(createReadStream(path, { highWaterMark: 4 << 20 }), async function* (src) {
    for await (const chunk of src) {
      if (signal?.aborted) throw new Error("отменено");
      h.update(chunk as Buffer);
    }
  });
  return h.digest("hex");
}

/**
 * Скачать один файл с докачкой. onBytes получает, сколько байт этого файла уже на диске.
 */
export async function downloadResumable(
  f: { url: string; size: number; sha256: string },
  dest: string,
  opts: { signal?: AbortSignal; onBytes?(n: number): void; onVerify?(): void } = {},
): Promise<void> {
  await mkdir(dirname(dest), { recursive: true });
  const verify = async (path: string) => {
    opts.onVerify?.();
    const got = await sha256(path, opts.signal);
    if (got !== f.sha256) throw new Error(`файл повреждён при загрузке (сумма не сошлась) — нажмите «Установить» ещё раз`);
  };

  if (sizeOf(dest) === f.size) {
    await verify(dest).catch(async (e) => { await rm(dest, { force: true }); throw e; });
    opts.onBytes?.(f.size);
    return;
  }

  const part = `${dest}.part`;
  let have = sizeOf(part) ?? 0;
  if (have > f.size) { await rm(part, { force: true }); have = 0; }
  if (have < f.size) {
    const host = new URL(f.url).host;
    const res = await once(f.url, have ? { range: `bytes=${have}-` } : {}, opts.signal);
    const code = res.statusCode ?? 0;
    if (code === 416) {
      // сервер считает, что всё уже есть; проверим суммой ниже
      res.resume();
    } else if (code !== 200 && code !== 206) {
      res.resume();
      throw new Error(httpReason(code, host));
    } else {
      if (code === 200 && have) have = 0; // Range не понят — с начала
      opts.onBytes?.(have);
      let n = have;
      const count = new Transform({
        transform(chunk: Buffer, _enc, cb) { n += chunk.length; opts.onBytes?.(n); cb(null, chunk); },
      });
      try {
        await pipeline(res, count, createWriteStream(part, { flags: have ? "a" : "w" }), { signal: opts.signal });
      } catch (e) {
        if (opts.signal?.aborted) throw new Error("отменено");
        throw new Error(`загрузка с ${host} оборвалась (${(e as Error).message}) — нажмите «Установить» ещё раз, докачается с места обрыва`);
      }
    }
  }
  const got = sizeOf(part);
  if (got !== f.size) throw new Error(`скачалось ${got ?? 0} байт из ${f.size} — нажмите «Установить» ещё раз`);
  await verify(part).catch(async (e) => { await rm(part, { force: true }); throw e; });
  await rename(part, dest);
}

/** Распаковать архив в папку «плоско»: сборки sd.cpp и CUDA лежат в архивах без вложенных папок, а exe ищет dll рядом с собой. */
function unzipFlat(zipPath: string, toDir: string, only?: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error("архив не открылся"));
      let count = 0;
      zip.on("error", reject);
      zip.on("end", () => resolve(count));
      zip.on("entry", (e: yauzl.Entry) => {
        if (/\/$/.test(e.fileName)) return zip.readEntry();
        const name = e.fileName.slice(e.fileName.lastIndexOf("/") + 1);
        if (!name || name.includes("..")) return zip.readEntry();
        if (only && !only.some((o) => o.toLowerCase() === name.toLowerCase())) return zip.readEntry();
        zip.openReadStream(e, (err2, stream) => {
          if (err2 || !stream) return reject(err2 ?? new Error("файл в архиве не читается"));
          pipeline(stream, createWriteStream(join(toDir, name)))
            .then(() => { count++; zip.readEntry(); })
            .catch(reject);
        });
      });
      zip.readEntry();
    });
  });
}

/**
 * Прописать локальный сервер в providers.json и поставить его первым в очередь картинок.
 * Остальное в файле (ключи, очереди текста, заметки) не трогаем; перед записью — копия .bak.
 */
export async function registerLocalServer(baseDir: string, launch: { exe: string; cwd: string; args: string[] }): Promise<string> {
  const found = await findAiConfig(baseDir);
  const cfg: AiConfig = found?.cfg ?? { providers: {} };
  const path = found?.path ?? join(baseDir, "providers.json");
  if (found) await copyFile(path, `${path}.bak`).catch(() => undefined);
  const prev = cfg.providers[SD_PROVIDER_ID] ?? { base: "" };
  cfg.providers[SD_PROVIDER_ID] = {
    ...prev,
    title: prev.title ?? "Своя видеокарта (sd.cpp)",
    base: "http://127.0.0.1:7861/v1",
    imageModels: ["sd-cpp-local"],
    launch,
  };
  delete cfg.providers[SD_PROVIDER_ID].disabled;
  cfg.imageChain = [SD_REF, ...(cfg.imageChain ?? []).filter((r) => r !== SD_REF)];
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(cfg, null, 2));
  return path;
}

export async function loadManifest(resourcesDir: string): Promise<Manifest> {
  return parseManifest(await readFile(join(resourcesDir, "components.json"), "utf8"));
}

/**
 * Поставить профиль. Шаги: место на диске → файлы по очереди (уже скачанные пропускаются) →
 * распаковка архивов → запись в providers.json и components.json.
 */
export async function installProfile(opts: {
  manifest: Manifest;
  profile: ProfileId;
  componentsDir: string;
  baseDir: string;
  freeDiskMB?: number;
  signal?: AbortSignal;
  onProgress(p: InstallProgress): void;
}): Promise<void> {
  const { manifest, profile, componentsDir, signal, onProgress } = opts;
  const files = planProfile(manifest, profile);
  const modelDir = join(componentsDir, MODEL_DIR);
  const total = totalBytes(files);
  const onDisk = (f: PlannedFile) => {
    // уже распакованный архив считаем скачанным: второй раз его не тянем
    if (f.unzipTo && existsSync(join(modelDir, f.unzipTo, ".done-" + f.id))) return f.size;
    return sizeOf(join(modelDir, f.dest)) ?? sizeOf(join(modelDir, `${f.dest}.part`)) ?? 0;
  };
  const need = total - files.reduce((s, f) => s + Math.min(onDisk(f), f.size), 0);
  if (opts.freeDiskMB !== undefined && need / 1048576 + 1024 > opts.freeDiskMB) {
    throw new Error(`мало места: нужно ещё ${(need / 1073741824).toFixed(1)} ГБ, свободно ${(opts.freeDiskMB / 1024).toFixed(1)} ГБ`);
  }

  let before = 0; // байты файлов, которые уже прошли
  let lastT = Date.now(), lastB = 0, speed = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const base = { file: f.title, fileIndex: i + 1, fileCount: files.length, total };
    const marker = f.unzipTo ? join(modelDir, f.unzipTo, ".done-" + f.id) : "";
    if (marker && existsSync(marker)) { before += f.size; continue; }

    const dest = join(modelDir, f.dest);
    await downloadResumable(f, dest, {
      signal,
      onBytes: (n) => {
        const now = Date.now(), done = before + n;
        if (now - lastT >= 500) { speed = speed ? speed * 0.6 + ((done - lastB) / ((now - lastT) / 1000)) * 0.4 : (done - lastB) / ((now - lastT) / 1000); lastT = now; lastB = done; }
        onProgress({ phase: "download", ...base, done, speed });
      },
      onVerify: () => onProgress({ phase: "verify", ...base, done: before + f.size, message: "проверяю сумму" }),
    });
    before += f.size;
    lastB = before;

    if (f.unzipTo) {
      onProgress({ phase: "unzip", ...base, done: before });
      const to = join(modelDir, f.unzipTo);
      await mkdir(to, { recursive: true });
      await unzipFlat(dest, to, f.extract);
      await writeFile(marker, new Date().toISOString());
      await rm(dest, { force: true }); // архив больше не нужен — сотни мегабайт
    }
  }
  if (!existsSync(join(modelDir, "bin", "sd-server.exe"))) throw new Error("в архиве sd.cpp не нашлось sd-server.exe");

  onProgress({ phase: "register", done: total, total });
  await registerLocalServer(opts.baseDir, launchFor(manifest, profile));
  await saveComponent({ id: "model", profile, path: MODEL_DIR, version: "sd.cpp master-905" }, componentsDir);
  onProgress({ phase: "done", done: total, total });
}

/**
 * «Указать уже скачанную папку»: узнать профиль по файлам и прописать сервер с абсолютными путями.
 * Ничего не копирует — модель остаётся, где лежала.
 */
export async function adoptFolder(manifest: Manifest, dir: string, baseDir: string, componentsDir: string): Promise<ProfileId> {
  const profile = detectProfile(manifest, dir, (p) => { const s = sizeOf(p); return s === null ? null : { size: s }; }, join);
  if (!profile) throw new Error("в этой папке нет полной модели: нужны bin\\sd-server.exe и файлы models\\… точного размера (как в «local-image»)");
  const l = launchFor(manifest, profile);
  await registerLocalServer(baseDir, { exe: join(dir, "bin", "sd-server.exe"), cwd: dir, args: l.args });
  await saveComponent({ id: "model", profile, path: dir, version: "своя папка" }, componentsDir);
  return profile;
}

/** Убрать сервер из очереди картинок и забыть, как его запускать; сам провайдер с заметками остаётся. */
async function unregisterLocalServer(baseDir: string): Promise<void> {
  const found = await findAiConfig(baseDir);
  if (!found) return;
  const p = found.cfg.providers[SD_PROVIDER_ID];
  if (p) delete p.launch;
  found.cfg.imageChain = (found.cfg.imageChain ?? []).filter((r) => r !== SD_REF);
  await copyFile(found.path, `${found.path}.bak`).catch(() => undefined);
  await writeFile(found.path, JSON.stringify(found.cfg, null, 2));
}

/** Удалить скачанную приложением модель. Чужую папку («своя папка») не трогаем — только забываем. */
export async function removeModel(componentsDir: string, baseDir: string): Promise<void> {
  await unregisterLocalServer(baseDir);
  const rec = (await readComponents(componentsDir)).components.model;
  if (rec && rec.path === MODEL_DIR) await rm(join(componentsDir, MODEL_DIR), { recursive: true, force: true });
  await forgetComponent("model", componentsDir);
}

/** Папка yt-dlp внутри компонентов: yt-dlp.exe и plugins/ с zip-ом bgutil. */
export const YTDLP_DIR = "yt-dlp";

/** Главный файл программы-компонента: по нему решаем «стоит». Папка программы — её id. */
export const TOOL_MAIN: Record<string, string> = { "yt-dlp": "yt-dlp.exe", ffmpeg: "ffmpeg.exe" };

export function toolInstalled(componentsDir: string, tool: string): boolean {
  return existsSync(join(componentsDir, tool, TOOL_MAIN[tool] ?? ""));
}

/** Поставить программу из манифеста (yt-dlp — exe и плагин, ffmpeg — два файла из архива). */
export async function installTool(opts: { manifest: Manifest; tool: string; componentsDir: string; signal?: AbortSignal; onProgress(p: InstallProgress): void }): Promise<void> {
  const { manifest, tool, componentsDir } = opts;
  const files = planTool(manifest, tool);
  const total = totalBytes(files);
  let before = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const base = { file: f.title, fileIndex: i + 1, fileCount: files.length, total };
    const dest = join(componentsDir, f.dest);
    await downloadResumable(f, dest, {
      signal: opts.signal,
      onBytes: (n) => opts.onProgress({ phase: "download", ...base, done: before + n }),
      onVerify: () => opts.onProgress({ phase: "verify", ...base, done: before + f.size }),
    });
    before += f.size;
    if (f.unzipTo) {
      opts.onProgress({ phase: "unzip", ...base, done: before });
      const to = join(componentsDir, f.unzipTo);
      await mkdir(to, { recursive: true });
      await unzipFlat(dest, to, f.extract);
      await rm(dest, { force: true });
    }
  }
  if (!toolInstalled(componentsDir, tool)) throw new Error(`после установки нет ${TOOL_MAIN[tool]} — архив не того вида`);
  await saveComponent({ id: tool, path: tool, version: manifest.tools?.[tool]?.version }, componentsDir);
  opts.onProgress({ phase: "done", done: total, total });
}

/** Запустить программу и вернуть её вывод (stdout + stderr); ошибка выхода — не исключение. */
function runOut(exe: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    execFile(exe, args, { timeout: timeoutMs, windowsHide: true }, (_err, stdout, stderr) => resolve(`${stdout ?? ""}${stderr ?? ""}`.trim()));
  });
}

/**
 * yt-dlp обновляет сам себя: `-U` берёт последний стабильный релиз с GitHub и сверяет его с подписанным
 * списком сумм (SHA2-256SUMS.sig). YouTube ломает старые версии часто, поэтому обновлять его надо чаще,
 * чем выходит Ye!Studio, — версия в манифесте для него только стартовая.
 */
export async function selfUpdateYtdlp(componentsDir: string): Promise<{ from?: string; to?: string; changed: boolean; log: string }> {
  const exe = join(componentsDir, YTDLP_DIR, TOOL_MAIN["yt-dlp"]);
  if (!existsSync(exe)) throw new Error("yt-dlp не установлен как компонент");
  const version = async () => (await runOut(exe, ["--version"], 30_000)).split(/\s+/)[0] || undefined;
  const from = await version();
  const log = await runOut(exe, ["-U"], 180_000);
  const to = await version();
  const rec = (await readComponents(componentsDir)).components["yt-dlp"];
  await saveComponent({ ...rec, id: "yt-dlp", path: rec?.path ?? YTDLP_DIR, version: to ?? rec?.version, checkedAt: new Date().toISOString() }, componentsDir);
  return { from, to, changed: !!to && to !== from, log };
}

/** Пора ли тихо проверить обновление yt-dlp: стоит как компонент и не проверялся неделю. */
export async function ytdlpCheckDue(componentsDir: string, now = Date.now()): Promise<boolean> {
  if (!toolInstalled(componentsDir, "yt-dlp")) return false;
  const at = (await readComponents(componentsDir)).components["yt-dlp"]?.checkedAt;
  return !at || now - Date.parse(at) > 7 * 24 * 3600_000;
}

export async function removeTool(componentsDir: string, tool: string): Promise<void> {
  if (!TOOL_MAIN[tool]) throw new Error(`неизвестная программа «${tool}»`);
  await rm(join(componentsDir, tool), { recursive: true, force: true });
  await forgetComponent(tool, componentsDir);
}

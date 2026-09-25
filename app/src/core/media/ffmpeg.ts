// Обработка медиа через ffmpeg. Только главный процесс.
//
// Главное правило: что бы ни скачал пользователь (AV1, HEVC, VP9, 10 бит, mkv, webm, avi, opus, 5.1),
// на выходе всегда H.264 High/yuv420p + AAC 48 кГц стерео в mp4 — ровно то, что уже лежит в паках,
// которые тысячи раз отыграли в SIGame. Звук отдельным файлом — mp3, как в паках.

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { posix, win32 } from "node:path";

// ---------- где искать ffmpeg ----------

/** Откуда взялся ffmpeg: от этого зависит, нужно ли подсказывать путь к нему yt-dlp. */
export type FfmpegSource = "setting" | "bundled" | "component" | "winget" | "path";

export interface FfmpegTools {
  ffmpeg: string;
  ffprobe: string;
  /** Папка, где лежат оба. */
  dir: string;
  source: FfmpegSource;
}

/** Всё, что нужно знать о машине для поиска. Функция разбора чистая: диск она видит только через exists/listDir. */
export interface FfmpegSearch {
  /** Настройка «ffmpeg» из media-providers.json: путь к ffmpeg.exe или к папке с ним. */
  setting?: string;
  /** resources приложения: в сборке — рядом с exe, там может лежать bin/ffmpeg.exe из установщика. */
  resourcesDir?: string;
  /** Папка компонента ffmpeg (окно «Компоненты»): там ffmpeg.exe и ffprobe.exe. */
  componentDir?: string;
  /** %LOCALAPPDATA% — под ним winget держит пакеты. */
  localAppData?: string;
  /** Переменная PATH. */
  pathEnv?: string;
  platform: NodeJS.Platform;
  exists(p: string): boolean;
  /** Имена внутри папки; нет папки — пустой список. */
  listDir(p: string): string[];
}

/** «ffmpeg-9.0.1-full_build» → [9, 0, 1]; для сравнения версий winget-папок. */
function versionOf(name: string): number[] {
  const m = /^ffmpeg-(\d+(?:\.\d+)*)/i.exec(name);
  return m ? m[1].split(".").map(Number) : [];
}

function newerFirst(a: string, b: string): number {
  const va = versionOf(a), vb = versionOf(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const d = (vb[i] ?? -1) - (va[i] ?? -1);
    if (d) return d;
  }
  // одна версия в разных сборках: full_build полнее essentials
  return /full/i.test(b) ? 1 : /full/i.test(a) ? -1 : a.localeCompare(b);
}

/**
 * Найти ffmpeg и ffprobe. Порядок: настройка → resources/bin → компонент (окно «Компоненты») → любая версия
 * ffmpeg-* из пакета winget Gyan.FFmpeg (раньше путь был зашит на 9.0.1 и ломался после обновления) → PATH.
 * Оба файла должны лежать в одной папке: версии ffmpeg и ffprobe от разных сборок не смешиваем.
 */
export function findFfmpeg(s: FfmpegSearch): FfmpegTools | null {
  const win = s.platform === "win32";
  const P = win ? win32 : posix;
  const exe = (name: string) => (win ? `${name}.exe` : name);
  const inDir = (dir: string, source: FfmpegSource): FfmpegTools | null => {
    const ffmpeg = P.join(dir, exe("ffmpeg"));
    const ffprobe = P.join(dir, exe("ffprobe"));
    return s.exists(ffmpeg) && s.exists(ffprobe) ? { ffmpeg, ffprobe, dir, source } : null;
  };

  const setting = s.setting?.trim().replace(/^"(.*)"$/, "$1");
  if (setting) {
    // указан сам файл — берём его папку; указана папка сборки — заглядываем и в её bin
    const dir = /ffmpeg(\.exe)?$/i.test(P.basename(setting)) ? P.dirname(setting) : setting;
    const hit = inDir(dir, "setting") ?? inDir(P.join(dir, "bin"), "setting");
    if (hit) return hit;
  }

  if (s.resourcesDir) {
    const hit = inDir(P.join(s.resourcesDir, "bin"), "bundled");
    if (hit) return hit;
  }

  if (s.componentDir) {
    const hit = inDir(s.componentDir, "component");
    if (hit) return hit;
  }

  if (win && s.localAppData) {
    const packages = P.join(s.localAppData, "Microsoft", "WinGet", "Packages");
    // Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe, Gyan.FFmpeg.Essentials_…
    for (const pkg of s.listDir(packages).filter((n) => /^Gyan\.FFmpeg/i.test(n)).sort()) {
      const builds = s.listDir(P.join(packages, pkg)).filter((n) => /^ffmpeg-/i.test(n)).sort(newerFirst);
      for (const b of builds) {
        const hit = inDir(P.join(packages, pkg, b, "bin"), "winget");
        if (hit) return hit;
      }
    }
  }

  for (const dir of (s.pathEnv ?? "").split(win ? ";" : ":")) {
    const d = dir.trim().replace(/^"(.*)"$/, "$1");
    if (!d) continue;
    const hit = inDir(d, "path");
    if (hit) return hit;
  }
  return null;
}

/** Где искали — для текста ошибки. */
export function ffmpegSearchPlaces(s: Pick<FfmpegSearch, "setting" | "resourcesDir" | "componentDir" | "platform">): string[] {
  const places: string[] = [];
  if (s.setting) places.push(`настройка «ffmpeg» (${s.setting})`);
  if (s.resourcesDir) places.push((s.platform === "win32" ? win32 : posix).join(s.resourcesDir, "bin"));
  if (s.componentDir) places.push(s.componentDir);
  if (s.platform === "win32") places.push("пакет winget Gyan.FFmpeg");
  places.push("PATH");
  return places;
}

export class FfmpegMissingError extends Error {
  constructor(places: string[]) {
    super(
      `ffmpeg не найден (искали: ${places.join("; ")}). ` +
        "Установите его в окне «🧩 Компоненты» (кнопка в шапке), командой «winget install Gyan.FFmpeg» или впишите путь к ffmpeg.exe в поле «ffmpeg» файла media-providers.json",
    );
    this.name = "FfmpegMissingError";
  }
}

let searchOpts: { setting?: string; resourcesDir?: string; componentDir?: string } = {};
let found: FfmpegTools | null = null;

/** Главный процесс сообщает настройку и папку resources; найденное заново ищется при следующем запросе. */
export function configureFfmpeg(opts: { setting?: string; resourcesDir?: string; componentDir?: string }): void {
  searchOpts = opts;
  found = null;
}

function realSearch(): FfmpegSearch {
  return {
    ...searchOpts,
    localAppData: process.env.LOCALAPPDATA,
    pathEnv: process.env.PATH ?? process.env.Path,
    platform: process.platform,
    exists: existsSync,
    listDir: (p) => { try { return readdirSync(p); } catch { return []; } },
  };
}

/**
 * Найденный ffmpeg или null. Удачу запоминаем, неудачу — нет: поставил человек ffmpeg,
 * не закрывая окно, — следующая попытка его увидит.
 */
export function ffmpegTools(): FfmpegTools | null {
  if (found && existsSync(found.ffmpeg)) return found;
  found = findFfmpeg(realSearch());
  return found;
}

function tool(name: "ffmpeg" | "ffprobe"): string {
  const t = ffmpegTools();
  if (!t) throw new FfmpegMissingError(ffmpegSearchPlaces({ ...searchOpts, platform: process.platform }));
  return t[name];
}

export function ffmpegAvailable(): boolean {
  return ffmpegTools() !== null;
}

/**
 * Аргументы для yt-dlp: если ffmpeg не в PATH, yt-dlp сам его не увидит, и склейка
 * видео со звуком или вырезание отрезка упадут. Из PATH он найдёт и без подсказки.
 */
export function ffmpegLocationArgs(): string[] {
  const t = ffmpegTools();
  return t && t.source !== "path" ? ["--ffmpeg-location", t.dir] : [];
}

/** ENOENT от spawn — это «программы нет на диске»: говорим по-человечески. */
function missing(e: NodeJS.ErrnoException): Error {
  return e.code === "ENOENT" ? new FfmpegMissingError(ffmpegSearchPlaces({ ...searchOpts, platform: process.platform })) : e;
}

function run(bin: string, args: string[], onLine?: (line: string) => void, signal?: AbortSignal): Promise<{ code: number; err: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    let err = "";
    let rest = "";
    const feed = (chunk: Buffer) => {
      rest += chunk.toString();
      const lines = rest.split(/\r?\n/);
      rest = lines.pop() ?? "";
      for (const l of lines) onLine?.(l);
    };
    p.stdout.on("data", onLine ? feed : () => {});
    p.stderr.on("data", (c: Buffer) => { err += c.toString(); if (err.length > 20000) err = err.slice(-20000); });
    p.on("error", (e) => reject(missing(e)));
    p.on("close", (code) => resolve({ code: code ?? -1, err }));
    signal?.addEventListener("abort", () => p.kill("SIGKILL"), { once: true });
  });
}

export interface MediaInfoProbe {
  durationSec: number;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  fps?: number;
  sizeBytes: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

export async function probe(path: string): Promise<MediaInfoProbe> {
  let out = "";
  const { code, err } = await run(tool("ffprobe"), ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", path], (l) => { out += l; });
  if (code !== 0) throw new Error("ffprobe не смог прочитать файл: " + err.slice(-300));
  const d = JSON.parse(out);
  const v = (d.streams ?? []).find((s: any) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
  const a = (d.streams ?? []).find((s: any) => s.codec_type === "audio");
  const [num, den] = String(v?.avg_frame_rate ?? "0/1").split("/").map(Number);
  return {
    durationSec: Number(d.format?.duration ?? v?.duration ?? a?.duration ?? 0),
    width: v?.width,
    height: v?.height,
    videoCodec: v?.codec_name,
    audioCodec: a?.codec_name,
    fps: den ? num / den : undefined,
    sizeBytes: Number(d.format?.size ?? 0),
    hasAudio: !!a,
    hasVideo: !!v,
  };
}

/** Пик громкости по времени для рисования волны в редакторе. */
export async function waveform(path: string, points = 900): Promise<number[]> {
  const info = await probe(path);
  const rate = Math.max(200, Math.ceil(points / Math.max(info.durationSec, 0.1)));
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const p = spawn(tool("ffmpeg"), ["-v", "quiet", "-i", path, "-map", "0:a:0?", "-ac", "1", "-ar", String(rate), "-f", "s16le", "-"], { windowsHide: true });
    p.stdout.on("data", (c: Buffer) => chunks.push(c));
    p.on("error", (e) => reject(missing(e)));
    p.on("close", () => resolve());
  });
  const buf = Buffer.concat(chunks);
  const total = Math.floor(buf.length / 2);
  if (!total) return [];
  const step = Math.max(1, Math.floor(total / points));
  const peaks: number[] = [];
  for (let i = 0; i < total; i += step) {
    let peak = 0;
    for (let j = i; j < Math.min(i + step, total); j++) peak = Math.max(peak, Math.abs(buf.readInt16LE(j * 2)));
    peaks.push(peak / 32768);
  }
  return peaks;
}

export interface Rect {
  /** доли от 0 до 1 относительно исходного кадра */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Cover extends Rect {
  /** blur — размыть, pixelate — крупные пиксели. Сплошные фигуры приходят картинкой-накладкой. */
  style: "blur" | "pixelate";
  /** показывать заглушку только с этой секунды клипа (отсчёт от начала обрезанного куска) */
  from?: number;
  /** ...и до этой */
  to?: number;
}

export interface MediaPlan {
  input: string;
  output: string;
  /** секунды */
  start: number;
  end: number;
  crop?: Rect;
  covers?: Cover[];
  /** PNG во всю ширину кадра с готовыми фигурами (полупрозрачный), путь к файлу */
  overlayPng?: string;
  audio: "keep" | "mute" | "only";
  /** высота кадра на выходе; undefined — как есть */
  height?: 720 | 480 | 360;
  quality: "high" | "normal" | "light";
  /** auto — сам решит; copy — быстрая резка без перекодирования; encode — всегда перекодировать */
  mode?: "auto" | "copy" | "encode";
  /** ускорение: 1 — без изменений */
  speed?: number;
  fadeIn?: boolean;
  fadeOut?: boolean;
  /** выровнять громкость (для звука) */
  normalize?: boolean;
  /** поворот кадра по часовой стрелке */
  rotate?: 0 | 90 | 180 | 270;
  /** отразить по горизонтали (зеркало) */
  flip?: boolean;
  /** уложить в столько мегабайт (вместо настройки качества) */
  targetMb?: number;
  /** накладка-картинка показывается только в этом промежутке клипа */
  overlayFrom?: number;
  overlayTo?: number;
}

const CRF: Record<MediaPlan["quality"], string> = { high: "18", normal: "23", light: "28" };

/**
 * Собирает граф фильтров.
 * Порядок: заглушки (размытие/пиксели) → готовая картинка-накладка → обрезка кадра → скорость → масштаб.
 * Заглушки и накладка считаются по ИСХОДНОМУ кадру, поэтому накладку не надо подгонять по размеру.
 */
/** Фильтр действует только в заданном промежутке клипа. Запятую внутри enable экранируем. */
function enableExpr(from?: number, to?: number): string {
  if (from === undefined && to === undefined) return "";
  const a = (from ?? 0).toFixed(3);
  const b = (to ?? 1e6).toFixed(3);
  return `:enable='between(t\\,${a}\\,${b})'`;
}

function videoFilter(plan: MediaPlan, hasOverlay: boolean, srcW: number, srcH: number): string {
  const steps: string[] = [];
  let label = "0:v";

  // размытие и пиксели: вырезаем участок, портим его и кладём обратно на то же место.
  // Размеры считаем в пикселях: pixelize и boxblur формул не принимают.
  (plan.covers ?? []).forEach((c, i) => {
    const w = Math.max(8, Math.round(srcW * c.w));
    const h = Math.max(8, Math.round(srcH * c.h));
    const x = Math.round(srcW * c.x);
    const y = Math.round(srcH * c.y);
    const block = Math.max(4, Math.round(Math.min(w, h) / 10));
    const damage = c.style === "blur"
      ? `boxblur=luma_radius=${Math.max(2, Math.round(Math.min(w, h) / 8))}:luma_power=3:chroma_radius=${Math.max(1, Math.round(Math.min(w, h) / 16))}:chroma_power=3`
      : `pixelize=w=${block}:h=${block}`;
    steps.push(`[${label}]split[c${i}a][c${i}b]`);
    steps.push(`[c${i}b]crop=${w}:${h}:${x}:${y},${damage}[c${i}d]`);
    steps.push(`[c${i}a][c${i}d]overlay=x=${x}:y=${y}${enableExpr(c.from, c.to)}[cov${i}]`);
    label = `cov${i}`;
  });

  if (hasOverlay) {
    steps.push(`[${label}][1:v]overlay=0:0${enableExpr(plan.overlayFrom, plan.overlayTo)}[ovr]`);
    label = "ovr";
  }

  const tail: string[] = [];
  if (plan.rotate === 90) tail.push("transpose=1");
  else if (plan.rotate === 180) tail.push("transpose=1,transpose=1");
  else if (plan.rotate === 270) tail.push("transpose=2");
  if (plan.flip) tail.push("hflip");
  if (plan.crop) {
    const { x, y, w, h } = plan.crop;
    tail.push(`crop=${Math.max(2, Math.round(srcW * w))}:${Math.max(2, Math.round(srcH * h))}:${Math.round(srcW * x)}:${Math.round(srcH * y)}`);
  }
  if (plan.speed && plan.speed !== 1) tail.push(`setpts=${(1 / plan.speed).toFixed(6)}*PTS`);
  // высота считается числом: формулы в filter_complex требуют экранирования запятых и легко ломаются
  const croppedH = plan.crop ? Math.round(srcH * plan.crop.h) : srcH;
  if (plan.height && croppedH > plan.height) tail.push(`scale=-2:${plan.height}`);
  tail.push("scale=trunc(iw/2)*2:trunc(ih/2)*2", "format=yuv420p");
  steps.push(`[${label}]${tail.join(",")}[vout]`);
  return steps.join(";");
}

function audioFilter(plan: MediaPlan, duration: number): string | null {
  const parts: string[] = [];
  if (plan.speed && plan.speed !== 1) parts.push(`atempo=${Math.min(2, Math.max(0.5, plan.speed)).toFixed(3)}`);
  if (plan.normalize) parts.push("loudnorm=I=-16:TP=-1.5:LRA=11");
  if (plan.fadeIn) parts.push("afade=t=in:st=0:d=0.4");
  if (plan.fadeOut) parts.push(`afade=t=out:st=${Math.max(0, duration - 0.5).toFixed(3)}:d=0.5`);
  return parts.length ? parts.join(",") : null;
}

export interface ProgressInfo {
  /** 0..1 */
  ratio: number;
  secondsDone: number;
}

/** Можно ли просто вырезать кусок без перекодирования: формат уже подходящий и правок кадра нет. */
export function canStreamCopy(plan: MediaPlan, src: MediaInfoProbe): boolean {
  return (
    plan.audio === "keep" && !plan.crop && !plan.covers?.length && !plan.overlayPng && !plan.height &&
    !plan.rotate && !plan.flip && !plan.targetMb && (!plan.speed || plan.speed === 1) &&
    !plan.fadeIn && !plan.fadeOut && !plan.normalize &&
    src.videoCodec === "h264" && (src.audioCodec === "aac" || !src.hasAudio) &&
    plan.input.toLowerCase().endsWith(".mp4") && plan.output.toLowerCase().endsWith(".mp4")
  );
}

/** Готовит файл для пака. Возвращает путь к результату. */
export async function transcode(plan: MediaPlan, onProgress?: (p: ProgressInfo) => void, signal?: AbortSignal): Promise<string> {
  const duration = Math.max(0.05, plan.end - plan.start) / (plan.speed && plan.speed !== 1 ? plan.speed : 1);
  const onlyAudio = plan.audio === "only";
  const src = onlyAudio ? null : await probe(plan.input);

  // Быстрый режим: режем по ключевым кадрам, потоки копируем. Секунда вместо минуты, качество не страдает.
  if (!onlyAudio && src && plan.mode !== "encode" && canStreamCopy(plan, src)) {
    const copyArgs = ["-y", "-hide_banner", "-nostats", "-loglevel", "error", "-progress", "pipe:1",
      "-ss", plan.start.toFixed(3), "-to", plan.end.toFixed(3), "-i", plan.input,
      "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", "-sn", "-dn", plan.output];
    const r = await run(tool("ffmpeg"), copyArgs, (line) => {
      const m = /^out_time_ms=(\d+)/.exec(line);
      if (m && onProgress) onProgress({ ratio: Math.min(1, Number(m[1]) / 1e6 / duration), secondsDone: Number(m[1]) / 1e6 });
    }, signal);
    if (r.code === 0) return plan.output;
    // не получилось — молча перекодируем обычным путём
  }
  const args = ["-y", "-hide_banner", "-nostats", "-loglevel", "error", "-progress", "pipe:1"];
  args.push("-ss", plan.start.toFixed(3), "-to", plan.end.toFixed(3), "-i", plan.input);
  if (!onlyAudio && plan.overlayPng) args.push("-i", plan.overlayPng);

  if (onlyAudio) {
    const af = audioFilter(plan, duration);
    args.push("-vn", "-map", "0:a:0");
    if (af) args.push("-af", af);
    args.push("-c:a", "libmp3lame", "-b:a", "192k", "-ar", "44100", "-ac", "2");
  } else {
    args.push("-filter_complex", videoFilter(plan, !!plan.overlayPng, src?.width ?? 1280, src?.height ?? 720), "-map", "[vout]");
    if (plan.audio === "mute") args.push("-an");
    else {
      args.push("-map", "0:a:0?");
      const af = audioFilter(plan, duration);
      if (af) args.push("-af", af);
      args.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2");
    }
    if (plan.targetMb) {
      const audioKbps = plan.audio === "mute" ? 0 : 192;
      const videoKbps = Math.max(120, Math.floor((plan.targetMb * 8192) / duration) - audioKbps);
      args.push("-c:v", "libx264", "-preset", "medium", "-b:v", `${videoKbps}k`, "-maxrate", `${Math.round(videoKbps * 1.5)}k`, "-bufsize", `${videoKbps * 2}k`);
    } else {
      args.push("-c:v", "libx264", "-preset", "medium", "-crf", CRF[plan.quality]);
    }
    args.push("-profile:v", "high", "-pix_fmt", "yuv420p", "-movflags", "+faststart");
  }
  args.push("-sn", "-dn", "-map_metadata", "-1", plan.output);

  const { code, err } = await run(
    tool("ffmpeg"),
    args,
    (line) => {
      const m = /^out_time_ms=(\d+)/.exec(line);
      if (m && onProgress) {
        const sec = Number(m[1]) / 1e6;
        onProgress({ ratio: Math.min(1, sec / duration), secondsDone: sec });
      }
    },
    signal,
  );
  if (code !== 0) throw new Error("ffmpeg: " + (err.split("\n").filter(Boolean).slice(-3).join(" ") || `код ${code}`));
  return plan.output;
}

/** Стоп-кадр в PNG. */
export async function frameAt(input: string, timeSec: number, output: string): Promise<string> {
  const { code, err } = await run(tool("ffmpeg"), ["-y", "-hide_banner", "-loglevel", "error", "-ss", timeSec.toFixed(3), "-i", input, "-frames:v", "1", output]);
  if (code !== 0) throw new Error("ffmpeg (стоп-кадр): " + err.slice(-200));
  return output;
}

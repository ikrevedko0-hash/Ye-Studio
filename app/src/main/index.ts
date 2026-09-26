// Главный процесс: окно, работа с файлами паков, медиа для предпросмотра.

import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { app, BrowserWindow, clipboard, dialog, ipcMain, protocol, shell } from "electron";
import { configureFfmpeg, ffmpegAvailable, frameAt, probe, transcode, waveform } from "../core/media/ffmpeg";
import { addRecord, findByUrl, linkToPack, readIndex, relocate, removeRecord, sourceDir } from "../core/media/library";
import { providerById, providerInfos, providersFor } from "../core/media/providers/registry";
import { currentRoute, diagnoseYoutube, forgetYtdlp } from "../core/media/providers/youtube";
import { checkCookiesTxt, isYoutubeDomain } from "../core/media/cookies";
import { pacScript } from "../core/media/net/routing";
import { startRendererServer, type RendererServer } from "./rendererServer";
import { watchSideBySide } from "./sideBySide";
import { loginSession, logout, openLoginWindow, probeLoginPage, refreshLoginCookies } from "./youtubeLogin";
import { prepareQuietSelfTest, SELF_TEST, showQuietly } from "./quietWindow";
import { backupBeforeOverwrite, clearDraft, readDraft, writeDraft } from "./safety";
import { findSigame, launchSigame } from "./sigame";
import { initUpdater } from "./updater"; // ---------- обновления ----------
import { closeSplash, showSplash } from "./splash";
// ---------- связь с сервером автора: выключение по ID, отчёты об ошибках, обратная связь ----------
import { captureFeedbackShot, initRemote, packDupCheck, queueError, sendFeedback } from "./remote";
import { crc32 } from "node:zlib";
import { dupQuestions, toReport } from "../core/siq/dupCheck";
import type { FeedbackRequest } from "../shared/api";
import type { DownloadWish, FetchProgress, MediaResult, ProviderConfig, SearchQuery, SourceMeta } from "../core/media/providers/types";
import { Dictionary } from "../core/words/dict";
import { generatorById, generatorInfos } from "../core/words/generators/registry";
import { setWordSourceDirs, wordSourceDirs } from "../core/words/sources/registry";
import { loadPhrases, PHRASE_KINDS, PHRASE_STYLES } from "../core/words/phrases";
import type { GeneratorArgs } from "../core/words/generators/types";
import { findAiConfig, loadAiConfig } from "../core/ai/config";
import { generateImage, NeedPaidError } from "../core/ai/image";
import { IMAGE_STYLES, styleText } from "../core/ai/imageStyles";
import { deletePreset, phraseToPrompt, presetInfos, putPreset, setPresetsDir, type ImagePreset } from "../core/ai/imagePresets";
import { searchWorks, workDetails, type WorkDetails, type WorkHit } from "../core/ai/works";
import { setLaunchBase, stopLocalServers } from "../core/ai/localServer";
import { componentsDir, setComponentsDirOverride } from "./components";
import { probeSystem } from "./system";
import { CHATGPT_DIR, findClaudeSkill, setupAssistant } from "./assistantKit";
import { adoptFolder, installProfile, installTool, loadManifest, removeModel, removeTool, selfUpdateYtdlp, toolInstalled, ytdlpCheckDue, YTDLP_DIR } from "./modelInstall";
import { readComponents, saveComponent } from "./components";
import { detectProfile, MODEL_DIR, planProfile, planTool, totalBytes, type ComponentsState, type InstallProgress } from "../core/components/manifest";
import type { ProfileId } from "../core/system/probe";
import { allQuotas, quotaFor } from "../core/ai/quota";
import { PROVIDER_TEMPLATES, readSettings, testProvider, writeSettings, type AiSettings } from "../core/ai/settings";
import { setUsageFile } from "../core/ai/usage";
import { mediaKindByName, newPackage, renameThemeMedia, themeMediaRefs } from "../core/siq/helpers";
import { MEDIA_FOLDERS, type Package, type Theme } from "../core/siq/model";
import { buildPosterHtml } from "../core/siq/poster";
import { renderPoster } from "./poster";
import { escapeName, openSiq, unescapeName, writeSiq, ZipReader, type EntrySource, type EntryToWrite } from "../core/siq/zip";
import type { AssistantKind, AssistantStatus, CookiesStatus,FetchResult, MediaEditRequest, MediaInfo, PackDTO, ProgressInfo, SearchChunk, SearchHit, SearchStart, TargetPack, ThemeTransfer, ThemeTransferResult } from "../shared/api";

// Приложение переименовано в «Ye!Studio» (productName), но данные автора (настройки, ключи, паки)
// остаются в старой папке userData — иначе Electron после переименования завёл бы вторую, пустую.
// Вызывать до app.whenReady() и до первого app.getPath("userData").
app.setPath("userData", join(app.getPath("appData"), "Мастерская паков"));

interface MediaEntry {
  folder: string;
  /** Имя файла без экранирования, как в content.xml */
  name: string;
  size: number;
  source: EntrySource;
}

interface Doc {
  path?: string;
  reader?: ZipReader;
  media: Map<string, MediaEntry>;
  /** Прочие файлы в корне архива (quality.marker и т.п.) — переносим как есть */
  extras: string[];
}

let doc: Doc = { media: new Map(), extras: [] };
/** Путь последней снятой афиши — «Опубликовать в ВК» заодно показывает её в папке. */
let lastPosterPath: string | undefined;
let win: BrowserWindow | null = null;
/** Идущая сейчас обработка медиа — чтобы её можно было отменить. */
let currentJob: AbortController | null = null;
/** Идущий сейчас поиск или скачивание из медиацентра. */
let searchJob: AbortController | null = null;
/** Номер поиска: по нему окно отличает свежие ответы от ответов прошлого запроса. */
let searchSeq = 0;
let fetchJob: AbortController | null = null;
/** Локальный сервер, с которого грузится само окно. Живёт ровно столько же, сколько приложение. */
let rendererServer: RendererServer | null = null;

/**
 * Куда класть настройки и запасную папку оригиналов.
 * В portable-сборке electron-builder кладёт путь к самому exe в PORTABLE_EXECUTABLE_DIR — тогда
 * приложение ничего не оставляет в профиле пользователя и целиком живёт на флешке.
 */
function baseDir(): string {
  return process.env.PORTABLE_EXECUTABLE_DIR || app.getPath("userData");
}

let providerCfg: ProviderConfig | undefined;

/** Идущая установка модели: одна за раз. */
let installAbort: AbortController | null = null;
let installLast: InstallProgress | null = null;

async function componentsState(): Promise<ComponentsState> {
  const manifest = await loadManifest(resourcesDir());
  const comps = await readComponents(componentsDir());
  let rec = comps.components.model;
  if (!rec) {
    // модель, поставленная до окна «Компоненты» (у автора — local-image): сервер уже прописан в providers.json
    const found = await findAiConfig(baseDir()).catch(() => null);
    const cwd = found?.cfg.providers.sdcpp?.launch?.cwd;
    const stat = (p: string) => { try { return { size: statSync(p).size }; } catch { return null; } };
    const profile = cwd && isAbsolute(cwd) ? detectProfile(manifest, cwd, stat, join) : null;
    if (profile && cwd) rec = await saveComponent({ id: "model", profile, path: cwd, version: "своя папка" }, componentsDir()).then((d) => d.components.model);
  }
  return {
    componentsDir: componentsDir(),
    profiles: (["best", "light", "vulkan"] as ProfileId[]).filter((id) => manifest.profiles[id]).map((id) => ({ id, bytes: totalBytes(planProfile(manifest, id)) })),
    model: rec ? { profile: rec.profile, path: rec.path, own: rec.path !== MODEL_DIR, installedAt: rec.installedAt } : null,
    installing: installAbort ? installLast : null,
    tools: Object.fromEntries(
      Object.entries(manifest.tools ?? {}).map(([id, t]) => {
        const on = toolInstalled(componentsDir(), id);
        return [id, { component: on, version: on ? comps.components[id]?.version : undefined, manifestVersion: t.version, bytes: totalBytes(planTool(manifest, id)) }];
      }),
    ),
  };
}

/** Программы поменялись: заново найти ffmpeg и yt-dlp при следующем обращении. */
function toolsChanged(): void {
  providerCfg = undefined;
  forgetYtdlp();
  void loadProviderConfig();
}

/** Поставить профиль модели. */
function runModelInstall(profile: ProfileId, onProgress: (p: InstallProgress) => void): Promise<ComponentsState> {
  return runInstall(async (signal, send) => {
    const report = await probeSystem({ componentsDir: componentsDir(), providerCfg: await loadProviderConfig() });
    await installProfile({ manifest: await loadManifest(resourcesDir()), profile, componentsDir: componentsDir(), baseDir: baseDir(), freeDiskMB: report.freeDiskMB, signal, onProgress: send });
  }, onProgress);
}

/** Одна установка за раз; прогресс — в onProgress. Ошибка и отмена приходят и последним шагом, и исключением. */
async function runInstall(job: (signal: AbortSignal, send: (p: InstallProgress) => void) => Promise<void>, onProgress: (p: InstallProgress) => void): Promise<ComponentsState> {
  if (installAbort) throw new Error("установка уже идёт");
  installAbort = new AbortController();
  const signal = installAbort.signal;
  const send = (p: InstallProgress) => { installLast = p; onProgress(p); };
  try {
    await job(signal, send);
  } catch (e) {
    const cancelled = signal.aborted;
    send({ phase: cancelled ? "cancelled" : "error", done: installLast?.done ?? 0, total: installLast?.total ?? 0, message: cancelled ? "отменено — скачанное сохранится, продолжить можно тем же профилем" : (e as Error).message });
    throw cancelled ? new Error("отменено") : e;
  } finally {
    installAbort = null;
  }
  return componentsState();
}

/** resources приложения: в сборке — рядом с exe, в разработке — в папке проекта. */
function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), "resources");
}

/**
 * Словари «Студии слов». В собранном приложении они лежат в resources рядом с exe
 * (electron-builder кладёт их туда через extraResources), в разработке — в папке проекта.
 */
let dictionary: Dictionary | undefined;

function dict(): Dictionary {
  if (!dictionary) {
    const resources = resourcesDir();
    dictionary = new Dictionary(join(resources, "dict"));
    // наборы слов: сначала скачанные заранее (npm run fetch-wordsets), потом кэш живых запросов
    setWordSourceDirs({ bundled: join(resources, "wordsets"), cache: join(baseDir(), "wordsets-cache") });
  }
  return dictionary;
}

/** Ключи источников: отдельный файл рядом с providers.json, в проект он не попадает. */
async function loadProviderConfig(): Promise<ProviderConfig> {
  if (providerCfg) return providerCfg;
  try {
    const raw = await readFile(join(baseDir(), "media-providers.json"), "utf8");
    providerCfg = JSON.parse(raw) as ProviderConfig;
  } catch {
    providerCfg = {}; // файла нет — работают источники без ключей
  }
  // Провайдер PO-токенов лежит внутри приложения, и путь к нему автор знать не обязан.
  // Прописан вручную — уважаем: значит человек собрал свой.
  if (!providerCfg.potProviderDir) providerCfg.potProviderDir = potProviderDir();
  // yt-dlp из «Компонентов»: свой путь в настройках главнее; нет ни того, ни другого — python -m yt_dlp
  const ytdlpExe = join(componentsDir(), YTDLP_DIR, "yt-dlp.exe");
  if (!providerCfg.ytdlpExe && existsSync(ytdlpExe)) {
    providerCfg.ytdlpExe = ytdlpExe;
    providerCfg.ytdlpPluginDir = join(componentsDir(), YTDLP_DIR, "plugins");
  }
  // без Node JS-задачки YouTube решает само приложение (ELECTRON_RUN_AS_NODE)
  providerCfg.electronNode ??= process.execPath;
  configureFfmpeg({ setting: providerCfg.ffmpeg, resourcesDir: resourcesDir(), componentDir: join(componentsDir(), "ffmpeg") });
  return providerCfg;
}

/** Поменять пару полей в media-providers.json, не трогая остальное, что автор там написал. */
async function patchProviderFile(patch: Partial<ProviderConfig>): Promise<void> {
  const file = join(baseDir(), "media-providers.json");
  let cur: ProviderConfig = {};
  try { cur = JSON.parse(await readFile(file, "utf8")) as ProviderConfig; } catch { /* файла ещё нет */ }
  await writeFile(file, JSON.stringify({ ...cur, ...patch }, null, 2), "utf8");
  providerCfg = undefined; // следующий запрос перечитает файл
}

/**
 * Вход YouTube в окне приложения НЕ держим, а оставшийся от прошлых версий — стираем.
 *
 * Однажды куки из файла передавали окну, чтобы встроенный плеер не просил «подтвердите, что вы
 * не бот». Стабильно плеер от этого не заработал (YouTube проверяет ещё и сам браузер), а вред
 * вышел прямой: окно — живой браузер, Google обновлял в нём сессию, и выгруженный автором файл
 * протухал за часы. От того же спасает закрытое окно инкогнито при выгрузке.
 */
async function forgetYoutubeLoginInWindow(): Promise<void> {
  if (!win) return;
  const jar = win.webContents.session.cookies;
  for (const old of (await jar.get({})).filter((c) => c.domain && isYoutubeDomain(c.domain))) {
    await jar.remove(`https://${old.domain!.replace(/^\./, "")}${old.path ?? "/"}`, old.name).catch(() => undefined);
  }
}

/**
 * Окну — тот же маршрут, что и загрузчику.
 *
 * С включённым Happ соединение с www.youtube.com напрямую через его туннель повисает, а через
 * его HTTP-вход идёт сразу. Загрузчик ходит через вход давно, а встроенный плеер открывался
 * напрямую и показывал чёрный прямоугольник.
 *
 * Через вход — только YouTube и Google (правило PAC из `routing.ts`). Сначала через него пустили
 * всю сеть окна, и плеер Rutube, который не пускает заграничные адреса, стал отвечать
 * «Access to resource was blocked». Свой прокси из настроек — для всего, кроме своего сервера окна.
 */
let windowProxy: string | undefined;
async function syncWindowRoute(): Promise<void> {
  if (!win) return;
  const r = await currentRoute(await loadProviderConfig());
  const key = r.kind === "vpn" || r.kind === "own" ? `${r.kind}:${r.proxy}` : "";
  if (key === windowProxy) return;
  windowProxy = key;
  // Окну входа — тот же маршрут: куки, выданные одному IP, а использованные с другого,
  // YouTube встречает подозрительно.
  for (const s of [win.webContents.session, loginSession()]) {
    if (r.kind === "vpn" && r.proxy) {
      const pac = Buffer.from(pacScript(r.proxy)).toString("base64");
      await s.setProxy({ mode: "pac_script", pacScript: `data:application/x-ns-proxy-autoconfig;base64,${pac}` });
    } else if (r.kind === "own" && r.proxy) {
      await s.setProxy({ proxyRules: r.proxy, proxyBypassRules: "<local>;127.0.0.1;localhost" });
    } else {
      await s.setProxy({ mode: "system" });
    }
  }
}

/** Куда приложение пишет куки — тот же файл, что и при ручном подключении. */
const cookiesPath = () => join(baseDir(), "youtube-cookies.txt");

/**
 * Освежить куки из окна входа, если файл ведёт приложение. Зовётся при запуске и раз в час:
 * YouTube меняет часть кук, и без этого файл протухает так же, как выгрузка из открытой вкладки.
 */
async function refreshAutoCookies(): Promise<CookiesStatus> {
  const cfg = await loadProviderConfig();
  if (!cfg.cookiesAuto) return cookiesStatus();
  await syncWindowRoute();
  const check = await refreshLoginCookies(cookiesPath());
  console.log("куки YouTube освежены:", JSON.stringify(check));
  return { ...(await cookiesStatus()), message: check.ok ? "Куки освежены" : `Вход пропал — войдите снова (${check.reason})` };
}

async function cookiesStatus(): Promise<CookiesStatus> {
  const cfg = await loadProviderConfig();
  if (!cfg.cookiesFile) return { ok: false, message: "Куки не подключены" };
  try {
    const st = await stat(cfg.cookiesFile);
    const check = checkCookiesTxt(await readFile(cfg.cookiesFile, "utf8"));
    return { ok: check.ok, file: cfg.cookiesFile, updated: st.mtimeMs, message: check.reason, auto: !!cfg.cookiesAuto };
  } catch {
    return { ok: false, file: cfg.cookiesFile, message: "Файл куков пропал с диска — подключите новый" };
  }
}

/** Где лежит собранный bgutil: в сборке — рядом с exe, в разработке — в папке проекта. */
function potProviderDir(): string {
  const resources = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), "tools");
  return join(resources, "pot-provider");
}

/** Папка оригиналов текущего пака. */
function currentSourceDir(): string {
  return sourceDir(doc.path, baseDir());
}

/** Имя файла или папки без запрещённых в Windows символов. */
function sanitizeWinName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, "_").replace(/[.\s]+$/g, "").trim() || "пак";
}

/** Папка для скринов темы и текста поста: рядом с файлом пака (source-рядом-с-паком, как у library.ts),
 * а для ещё не сохранённого пака — в Документах, чтобы «Снять скрины» работало сразу. */
function publishDir(packPath: string | undefined, packName: string): string {
  if (packPath) return join(dirname(packPath), `${basename(packPath).replace(/\.siq$/i, "") || "пак"} — публикация`);
  return join(app.getPath("documents"), "Ye!Studio публикации", sanitizeWinName(packName));
}

// ---------- мелкие настройки окна ----------
//
// Windows сам подставляет в диалог «последнюю папку» только в пределах одного запуска.
// После перезапуска приложение снова предлагало «Документы», хотя паки всегда лежат в одной
// и той же папке: открыть следующий пак — значит каждый раз идти через полдиска.

interface UiSettings {
  /** Где автор в последний раз брал или сохранял пак. */
  lastPackDir?: string;
  /** Где в последний раз брал файлы для «+ Медиа». */
  lastMediaDir?: string;
  /**
   * Ширина правой колонки и потолок качества видео жили в localStorage окна.
   * Окно теперь грузится по http с локального сервера, а это другой origin — старое
   * хранилище для него чужое и пустое. Поэтому настройки переехали сюда, на диск:
   * файл переживает и смену адреса, и переустановку приложения.
   */
  editorWidth?: number;
  ytMaxHeight?: number;
  /**
   * Своя папка компонентов (модели, yt-dlp) — например, на диске, где есть место.
   * Пусто — %LOCALAPPDATA%\Мастерская паков\components (см. components.ts).
   */
  componentsDir?: string;
  /** Тема оформления: dark | studio | paper | pastel | minimal. */
  theme?: string;
  /** Мастер первого запуска уже показан (ставил ffmpeg и yt-dlp). */
  firstRunDone?: boolean;
  /** Мастер чат-помощника пройден или отложен — при запуске больше не предлагаем. */
  assistantDone?: boolean;
  /** Рабочая папка помощника: памятка, гайд по вкусу, шаблоны разметки. */
  assistantDir?: string;
  /** Отправлять ли отчёты об ошибках автору (только текст ошибки и версия) — по умолчанию да. */
  reportErrors?: boolean;
}

let uiSettings: UiSettings | undefined;

function settingsFile(): string {
  return join(baseDir(), "ui-settings.json");
}

async function loadSettings(): Promise<UiSettings> {
  if (uiSettings) return uiSettings;
  try {
    uiSettings = JSON.parse(await readFile(settingsFile(), "utf8")) as UiSettings;
  } catch {
    uiSettings = {};
  }
  return uiSettings;
}

/**
 * Пишем молча и не дожидаясь: настройки — дело десятое, и упавшая запись не должна
 * мешать открыть пак. Папка запоминается только если она ещё существует.
 */
function rememberDir(which: "lastPackDir" | "lastMediaDir", filePath: string | undefined): void {
  if (!filePath) return;
  const dir = dirname(filePath);
  if (!existsSync(dir)) return;
  uiSettings = { ...(uiSettings ?? {}), [which]: dir };
  void writeFile(settingsFile(), JSON.stringify(uiSettings, null, 2), "utf8").catch(() => {});
}

/** Куда открыть диалог: последняя папка, если она на месте. */
async function startDir(which: "lastPackDir" | "lastMediaDir"): Promise<string | undefined> {
  const dir = (await loadSettings())[which];
  return dir && existsSync(dir) ? dir : undefined;
}

/** Запомнить настройку окна. Пишем молча: из-за настроек ничего падать не должно. */
function rememberSetting<K extends keyof UiSettings>(key: K, value: UiSettings[K]): void {
  uiSettings = { ...(uiSettings ?? {}), [key]: value };
  void writeFile(settingsFile(), JSON.stringify(uiSettings, null, 2), "utf8").catch(() => {});
}


const MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".flac": "audio/flac",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mkv": "video/x-matroska", ".mov": "video/quicktime", ".avi": "video/x-msvideo",
};

const key = (folder: string, name: string) => `${folder}/${name}`;

function mediaInfo(m: MediaEntry): MediaInfo {
  return { folder: m.folder, name: m.name, size: m.size, url: `siq://media/${encodeURIComponent(m.folder)}/${encodeURIComponent(m.name)}` };
}

function dto(pkg: Package): PackDTO {
  return { path: doc.path, pkg, media: [...doc.media.values()].map(mediaInfo) };
}

function closeDoc() {
  doc.reader?.close();
  doc = { media: new Map(), extras: [] };
}

/** Отпечаток файла «crc32:размер» — как в оглавлении zip; по нему база повторов находит тот же файл в чужом паке. */
const fingerprints = new WeakMap<EntrySource, string>();
async function mediaFingerprint(folder: string, name: string): Promise<string> {
  const m = doc.media.get(key(folder, name));
  if (!m || !m.size) return "";
  const cached = fingerprints.get(m.source);
  if (cached) return cached;
  const data = await loadEntry(m.source).catch(() => null);
  if (!data?.length) return "";
  const fp = `${(crc32(data) >>> 0).toString(16).padStart(8, "0")}:${data.length}`;
  fingerprints.set(m.source, fp);
  return fp;
}

async function loadEntry(src: EntrySource): Promise<Buffer> {
  if (src.kind === "buffer") return src.data;
  if (src.kind === "file") return (await import("node:fs/promises")).readFile(src.path);
  return src.reader.read(src.name);
}

async function openPack(path: string): Promise<PackDTO> {
  const opened = await openSiq(path);
  closeDoc();
  doc.path = path;
  doc.reader = opened.reader;
  for (const e of opened.reader.entries) {
    if (e.name === "content.xml") continue;
    const slash = e.name.indexOf("/");
    if (slash < 0) {
      doc.extras.push(e.name);
      continue;
    }
    const folder = e.name.slice(0, slash);
    const name = unescapeName(e.name.slice(slash + 1));
    doc.media.set(key(folder, name), { folder, name, size: e.size, source: { kind: "zip", reader: opened.reader, name: e.name } });
  }
  app.addRecentDocument(path);
  return dto(opened.pkg);
}

/** Уникальное имя в папке: «файл.jpg» → «файл (2).jpg» при совпадении. */
function uniqueName(folder: string, name: string): string {
  if (!doc.media.has(key(folder, name))) return name;
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 2; ; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!doc.media.has(key(folder, candidate))) return candidate;
  }
}

/** Есть ли в окне несохранённые правки — окно сообщает само (IPC pack:dirty). */
let packDirty = false;
/** Автор уже ответил на «сохранить?» — второй раз не спрашиваем. */
let closeConfirmed = false;

async function askSaveBeforeClose() {
  if (!win) return;
  const name = doc.path ? basename(doc.path) : "новый пак";
  const { response } = await dialog.showMessageBox(win, {
    type: "question",
    title: "Ye!Studio",
    message: `Сохранить изменения в «${name}»?`,
    detail: "Если не сохранить, правки пропадут.",
    buttons: ["Сохранить", "Не сохранять", "Отмена"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (response === 2) return;
  if (response === 0) {
    try {
      // пак берём из окна: там самое свежее состояние
      const pkg = await win.webContents.executeJavaScript("JSON.parse(JSON.stringify(window.__pack))");
      if (!pkg || !(await savePack(pkg, false))) return; // отменил выбор файла — остаёмся
    } catch (err) {
      await dialog.showMessageBox(win, { type: "error", message: "Не удалось сохранить пак", detail: (err as Error).message });
      return;
    }
  }
  // «Не сохранять» — автор сам отказался от правок, черновик для восстановления не нужен
  if (response === 1 && !SELF_TEST) await clearDraft(DRAFT_DIR());
  closeConfirmed = true;
  win.close();
}

// ---------- обновления ----------

/**
 * Перед установкой обновления — тот же вопрос, что при закрытии окна (askSaveBeforeClose),
 * но без закрытия win: обновление само перезапустит приложение через quitAndInstall.
 * true — можно ставить, false — отмена (ничего не делаем).
 */
async function confirmBeforeUpdate(): Promise<boolean> {
  if (!packDirty || !win) return true;
  const name = doc.path ? basename(doc.path) : "новый пак";
  const { response } = await dialog.showMessageBox(win, {
    type: "question",
    title: "Ye!Studio",
    message: `Пак «${name}» не сохранён. Обновить сейчас?`,
    detail: "«Сохранить и обновить» сохранит пак перед перезапуском; несохранённого без сохранения не будет — можно продолжить работу и обновиться позже.",
    buttons: ["Сохранить и обновить", "Обновить без сохранения", "Отмена"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (response === 2) return false;
  if (response === 0) {
    try {
      const pkg = await win.webContents.executeJavaScript("JSON.parse(JSON.stringify(window.__pack))");
      if (!pkg || !(await savePack(pkg, false))) return false; // отменил выбор файла — обновление не ставим
    } catch (err) {
      await dialog.showMessageBox(win, { type: "error", message: "Не удалось сохранить пак — обновление отменено", detail: (err as Error).message });
      return false;
    }
  }
  return true;
}

async function savePack(pkg: Package, saveAs: boolean, forcedTarget?: string): Promise<PackDTO | null> {
  let target = forcedTarget ?? doc.path;
  if (!forcedTarget && (saveAs || !target)) {
    const packName = pkg.attrs.find(([k]) => k === "name")?.[1] || "Новый пак";
    const fileName = `${packName.replace(/[\\/:*?"<>|]/g, "_")}.siq`;
    // Имя без папки Windows кладёт в «Документы». Подставляем ту же папку, где автор
    // работал в прошлый раз: паки всегда лежат вместе.
    const dir = await startDir("lastPackDir");
    const r = await dialog.showSaveDialog(win!, {
      title: "Сохранить пак",
      defaultPath: dir ? join(dir, fileName) : fileName,
      filters: [{ name: "Пак SIGame", extensions: ["siq"] }],
    });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath;
  }
  if (!target) return null;
  rememberDir("lastPackDir", target);

  const media = [...doc.media.values()];
  // <files> обновляем, только если он уже был в паке (SIGame без него обходится)
  if (pkg.files) {
    const hashes = new Map<string, string>();
    for (const m of media) hashes.set(key(m.folder, m.name), createHash("sha256").update(await loadEntry(m.source)).digest("hex").toUpperCase());
    const kept = pkg.files.filter((f) => hashes.has(f.name)).map((f) => ({ name: f.name, hash: hashes.get(f.name)! }));
    const listed = new Set(kept.map((f) => f.name));
    for (const [name, hash] of hashes) if (!listed.has(name)) kept.push({ name, hash });
    pkg.files = kept;
  }

  const tmp = `${target}.tmp-${Date.now()}`;
  await writeSiq(tmp, pkg, docEntries());
  if (doc.reader && doc.path?.toLowerCase() === target.toLowerCase()) doc.reader.close();
  // прежний файл не удаляем, а убираем в резервные копии (последние 5 на пак)
  await backupBeforeOverwrite(target, BACKUP_DIR());
  await rename(tmp, target);
  // оригиналы из медиацентра переезжают вслед за паком: source/ должна лежать рядом с ним
  await relocate(sourceDir(doc.path, baseDir()), sourceDir(target, baseDir()));
  // дальше работаем с сохранённым файлом, чтобы медиа читались из него
  const saved = await openPack(target);
  if (!SELF_TEST) await clearDraft(DRAFT_DIR());
  return saved;
}

/** Все файлы открытого пака для записи архива: медиа и прочие записи корня. */
function docEntries(): EntryToWrite[] {
  return [
    ...[...doc.media.values()].map((m) => ({ name: `${m.folder}/${escapeName(m.name)}`, source: m.source })),
    ...(doc.reader ? doc.extras.map((name) => ({ name, source: { kind: "zip" as const, reader: doc.reader!, name } })) : []),
  ];
}

// ---------- страховка: резервные копии и черновик (safety.ts) ----------
// самопроверка делит userData с живой мастерской автора — её копии кладём во временную папку
const BACKUP_DIR = () => (SELF_TEST ? join(tmpdir(), "ye-selftest-backups") : join(app.getPath("userData"), "Резервные копии"));
const DRAFT_DIR = () => join(app.getPath("userData"), "autosave");

async function addMediaFiles(paths: string[]): Promise<MediaInfo[]> {
  const added: MediaInfo[] = [];
  for (const p of paths) {
    const kind = mediaKindByName(p);
    if (!kind) continue;
    const folder = MEDIA_FOLDERS[kind];
    const name = uniqueName(folder, basename(p));
    const m: MediaEntry = { folder, name, size: (await stat(p)).size, source: { kind: "file", path: p } };
    doc.media.set(key(folder, name), m);
    added.push(mediaInfo(m));
  }
  return added;
}

const samePath = (a?: string, b?: string) => !!a && !!b && resolvePath(a).toLowerCase() === resolvePath(b).toLowerCase();

async function pickTargetPack(path?: string): Promise<TargetPack | null> {
  if (!path) {
    const r = await dialog.showOpenDialog(win!, {
      title: "В какой пак перенести тему",
      defaultPath: await startDir("lastPackDir"),
      filters: [{ name: "Пак SIGame", extensions: ["siq"] }],
      properties: ["openFile"],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    path = r.filePaths[0];
  }
  if (samePath(path, doc.path)) throw new Error("это тот пак, что открыт сейчас — выберите другой");
  const opened = await openSiq(path);
  opened.reader.close();
  return {
    path,
    name: opened.pkg.attrs.find(([k]) => k === "name")?.[1] || basename(path, ".siq"),
    rounds: (opened.pkg.rounds ?? []).map((r) => ({ name: r.name, final: r.type === "final", themes: r.themes?.length ?? 0 })),
  };
}

/**
 * Дописывает тему в другой пак вместе с её файлами. Открытый пак не трогаем: вырезание
 * (удаление темы отсюда) делает окно после успеха. Целевой пак переписываем через
 * временный файл, как при сохранении, — прежние записи архива идут в него без распаковки.
 */
async function transferTheme(theme: Theme, to: ThemeTransfer): Promise<ThemeTransferResult | null> {
  let target: string;
  let pkg: Package;
  let reader: ZipReader | undefined;
  if (to.mode === "new") {
    const dir = await startDir("lastPackDir");
    const fileName = `${(to.packName || "Новый пак").replace(/[\\/:*?"<>|]/g, "_")}.siq`;
    if (to.path) target = to.path;
    else {
      const r = await dialog.showSaveDialog(win!, {
        title: "Новый пак для темы",
        defaultPath: dir ? join(dir, fileName) : fileName,
        filters: [{ name: "Пак SIGame", extensions: ["siq"] }],
      });
      if (r.canceled || !r.filePath) return null;
      target = r.filePath;
    }
    if (samePath(target, doc.path)) throw new Error("это тот пак, что открыт сейчас — выберите другое имя");
    pkg = newPackage(to.packName || "Новый пак");
    pkg.rounds = [to.final ? { name: "ФИНАЛ", type: "final", themes: [] } : { name: "Раунд 1", themes: [] }];
  } else {
    target = to.path;
    if (samePath(target, doc.path)) throw new Error("это тот пак, что открыт сейчас — выберите другой");
    const opened = await openSiq(target);
    pkg = opened.pkg;
    reader = opened.reader;
  }

  try {
    // что уже лежит в целевом архиве: «папка/имя» → запись
    const existing = new Map<string, string>();
    for (const e of reader?.entries ?? []) {
      const slash = e.name.indexOf("/");
      if (e.name !== "content.xml" && slash > 0) existing.set(key(e.name.slice(0, slash), unescapeName(e.name.slice(slash + 1))), e.name);
    }
    const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex").toUpperCase();
    const added: EntryToWrite[] = [];
    const addedHashes: { name: string; hash: string }[] = [];
    const renames = new Map<string, string>();
    const result: ThemeTransferResult = { path: target, copied: 0, reused: 0, renamed: [], missing: [] };

    for (const ref of themeMediaRefs(theme)) {
      const src = doc.media.get(key(ref.folder, ref.name));
      if (!src) { result.missing.push(`${ref.folder}/${ref.name}`); continue; }
      let name = ref.name;
      const clash = existing.get(key(ref.folder, name));
      if (clash) {
        // тот же файл (например, общая заставка) — не дублируем
        const [mine, theirs] = await Promise.all([loadEntry(src.source), reader!.read(clash)]);
        if (mine.equals(theirs)) { result.reused++; continue; }
        const ext = extname(name);
        const stem = name.slice(0, name.length - ext.length);
        for (let i = 2; existing.has(key(ref.folder, name)); i++) name = `${stem} (${i})${ext}`;
        renames.set(key(ref.folder, ref.name), name);
        result.renamed.push(`${ref.name} → ${name}`);
      }
      const entryName = `${ref.folder}/${escapeName(name)}`;
      existing.set(key(ref.folder, name), entryName);
      added.push({ name: entryName, source: src.source });
      if (pkg.files) addedHashes.push({ name: key(ref.folder, name), hash: hash(await loadEntry(src.source)) });
      result.copied++;
    }

    const copy = structuredClone(theme);
    renameThemeMedia(copy, renames);
    pkg.rounds ??= [];
    if (to.mode === "new") pkg.rounds[0].themes!.push(copy);
    else if (to.round >= 0 && pkg.rounds[to.round]) (pkg.rounds[to.round].themes ??= []).push(copy);
    else pkg.rounds.push({ name: to.roundName?.trim() || `Раунд ${pkg.rounds.length + 1}`, themes: [copy] });
    // <files> ведём, только если он уже был (как при сохранении)
    if (pkg.files) pkg.files.push(...addedHashes);

    const entries: EntryToWrite[] = [
      ...(reader?.entries ?? []).filter((e) => e.name !== "content.xml").map((e) => ({ name: e.name, source: { kind: "zip" as const, reader: reader!, name: e.name } })),
      ...added,
    ];
    const tmp = `${target}.tmp-${Date.now()}`;
    try {
      await writeSiq(tmp, pkg, entries);
      reader?.close();
      reader = undefined;
      await rm(target, { force: true });
      await rename(tmp, target);
    } catch (e) {
      await rm(tmp, { force: true }).catch(() => {});
      const busy = /EBUSY|EPERM/.test((e as Error).message);
      throw new Error(busy ? "целевой пак занят другой программой (открыт в SIQuester?) — закройте его там и повторите" : (e as Error).message);
    }
    rememberDir("lastPackDir", target);
    return result;
  } finally {
    reader?.close();
  }
}

function registerIpc() {
  ipcMain.handle("theme:pickPack", (_e, path?: string) => pickTargetPack(path));
  ipcMain.handle("theme:transfer", (_e, theme: Theme, to: ThemeTransfer) => transferTheme(theme, to));

  ipcMain.handle("pack:new", () => {
    closeDoc();
    return dto(newPackage());
  });

  ipcMain.handle("pack:open", async (_e, path?: string) => {
    if (!path) {
      const r = await dialog.showOpenDialog(win!, {
        title: "Открыть пак",
        defaultPath: await startDir("lastPackDir"),
        filters: [{ name: "Пак SIGame", extensions: ["siq"] }],
        properties: ["openFile"],
      });
      if (r.canceled || !r.filePaths[0]) return null;
      path = r.filePaths[0];
    }
    rememberDir("lastPackDir", path);
    return openPack(path);
  });

  ipcMain.handle("pack:save", (_e, pkg: Package, saveAs: boolean) => savePack(pkg, saveAs));
  // черновик несохранённого пака: окно присылает раз в несколько минут; в самопроверке не пишем (общая userData с автором)
  ipcMain.handle("draft:write", async (_e, pkg: Package) => { if (!SELF_TEST) await writeDraft(DRAFT_DIR(), pkg, docEntries(), doc.path); });
  ipcMain.handle("draft:info", async () => (SELF_TEST ? null : readDraft(DRAFT_DIR())));
  ipcMain.handle("draft:discard", () => clearDraft(DRAFT_DIR()));
  ipcMain.handle("draft:restore", async () => {
    const meta = await readDraft(DRAFT_DIR());
    if (!meta) return null;
    const d = await openPack(meta.file);
    // сохранять — туда, где пак был, а не в папку черновиков
    doc.path = meta.origPath;
    return { ...d, path: meta.origPath };
  });
  // «Открыть в SIGame»: окно сначала сохраняет пак, сюда приходит путь к файлу
  ipcMain.handle("sigame:open", (_e, packPath: string) => {
    const exe = findSigame();
    clipboard.writeText(packPath);
    if (!exe) return { ok: false as const };
    launchSigame(exe);
    return { ok: true as const };
  });
  ipcMain.handle("backups:open", async () => { await mkdir(BACKUP_DIR(), { recursive: true }); return shell.openPath(BACKUP_DIR()); });

  ipcMain.handle("media:add", async (_e, paths?: string[]) => {
    if (!paths?.length) {
      const r = await dialog.showOpenDialog(win!, {
        title: "Добавить медиа",
        defaultPath: await startDir("lastMediaDir"),
        filters: [{ name: "Картинки, звук, видео", extensions: Object.keys(MIME).map((e) => e.slice(1)) }],
        properties: ["openFile", "multiSelections"],
      });
      if (r.canceled) return [];
      paths = r.filePaths;
      rememberDir("lastMediaDir", paths[0]);
    }
    return addMediaFiles(paths);
  });

  ipcMain.handle("media:remove", (_e, folder: string, name: string) => doc.media.delete(key(folder, name)));

  /** Байты файла из пака: fetch к siq:// из окна не проходит, а canvas нужен «чистый» источник. */
  ipcMain.handle("media:bytes", async (_e, folder: string, name: string) => {
    const m = doc.media.get(key(folder, name));
    if (!m) throw new Error(`нет файла ${folder}/${name}`);
    const data = await loadEntry(m.source);
    return { type: MIME[extname(name).toLowerCase()] ?? "application/octet-stream", data: new Uint8Array(data) };
  });

  /** Готовая картинка из редактора картинок или коллажа: кладём в Images новым файлом. */
  ipcMain.handle("image:save", async (_e, dataUrl: string, suggestedName: string) => {
    const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/s.exec(dataUrl);
    if (!m) throw new Error("не картинка");
    const ext = m[1] === "jpeg" ? ".jpg" : `.${m[1]}`;
    const base = suggestedName.replace(/\.[^.]+$/, "").replace(/[\/:*?"<>|]/g, "_").slice(0, 80) || "картинка";
    const name = uniqueName("Images", base + ext);
    const out = join(tmpdir(), `siq-img-${Date.now()}${ext}`);
    await writeFile(out, Buffer.from(m[2], "base64"));
    const entry: MediaEntry = { folder: "Images", name, size: (await stat(out)).size, source: { kind: "file", path: out } };
    doc.media.set(key("Images", name), entry);
    return mediaInfo(entry);
  });

  ipcMain.handle("shell:reveal", (_e, path: string) => shell.showItemInFolder(path));
  // «📋 Из Claude»: блок json из чата. Через главный процесс — окну с песочницей буфер не дают.
  ipcMain.handle("clipboard:text", () => clipboard.readText());
  ipcMain.handle("clipboard:write", (_e, text: string) => { clipboard.writeText(text); });
  ipcMain.on("pack:dirty", (_e, dirty: boolean) => { packDirty = !!dirty; });
  ipcMain.handle("shell:open", (_e, path: string) => shell.openPath(path));

  // ---------- окно «📣 Публикация»: текст для ВК и скрины табло ----------

  ipcMain.handle("publish:folder", (_e, packPath: string | undefined, packName: string) => publishDir(packPath, packName));

  /** Афиша со всеми темами пака: HTML собирает buildPosterHtml, рисует скрытое окно в poster.ts. */
  ipcMain.handle("publish:poster", async (_e, pkg: Package, packPath: string | undefined, packName: string) => {
    const dir = publishDir(packPath, packName);
    await mkdir(dir, { recursive: true });
    const out = join(dir, `${sanitizeWinName(packName)} — афиша.png`);
    await renderPoster(buildPosterHtml(pkg), out);
    lastPosterPath = out;
    return out;
  });

  // Адрес жёстко зашит: окно не принимает URL от рендерера, чтобы «Опубликовать в ВК» нельзя было
  // подменить чужим адресом. Если афиша уже снята — заодно показываем её в папке.
  ipcMain.handle("publish:openVk", () => {
    if (lastPosterPath && existsSync(lastPosterPath)) shell.showItemInFolder(lastPosterPath);
    return shell.openExternal("https://vk.com/feed");
  });

  // ---------- медиацентр: поиск и загрузка из внешних источников ----------

  ipcMain.handle("media:providers", async () => providerInfos(await loadProviderConfig()));

  /**
   * Проверка YouTube по шагам. Отдельная кнопка, а не молчаливая догадка: отказ резолвера,
   * закрытый доступ и требование входа выглядят в выдаче одинаково, а лечатся по-разному.
   */
  ipcMain.handle("media:diagnose", async () => {
    providerCfg = undefined; // перечитать файл: кнопку жмут после правки настроек
    return diagnoseYoutube(await loadProviderConfig());
  });

  ipcMain.handle("media:route", async () => {
    await syncWindowRoute(); // окно спрашивает маршрут при открытии медиацентра и после загрузок
    const r = await currentRoute(await loadProviderConfig());
    return { kind: r.kind, label: r.label };
  });

  ipcMain.handle("media:cookies", async () => cookiesStatus());

  // «Смотреть рядом»: ролик в Chrome слева, Мастерская справа — см. sideBySide.ts.
  ipcMain.handle("shell:watchSideBySide", async (_e, url: string) => {
    const res = await watchSideBySide(win!, url);
    console.log("смотреть рядом:", url, JSON.stringify(res), JSON.stringify(win!.getBounds()));
    return res;
  });

  /**
   * Подключить свежие куки YouTube. Файл копируется в папку настроек приложения: из «Загрузок»
   * его потом удаляют, а на OneDrive ему не место — это полный доступ к аккаунту.
   */
  ipcMain.handle("media:cookiesImport", async (): Promise<CookiesStatus | null> => {
    const pick = await dialog.showOpenDialog(win!, {
      title: "Файл cookies.txt, выгруженный из браузера",
      defaultPath: app.getPath("downloads"),
      filters: [{ name: "cookies.txt", extensions: ["txt"] }],
      properties: ["openFile"],
    });
    if (pick.canceled || !pick.filePaths[0]) return null;
    const src = pick.filePaths[0];
    const check = checkCookiesTxt(await readFile(src, "utf8"));
    if (!check.ok) throw new Error(`файл не подошёл — ${check.reason}. Прежние куки не тронуты.`);
    const dest = cookiesPath();
    await writeFile(dest, await readFile(src));
    // свой файл автора фон не переписывает
    await patchProviderFile({ cookiesFile: dest, cookiesAuto: false });
    return { ...(await cookiesStatus()), message: `Куки подключены. Исходный файл больше не нужен — его можно удалить: ${src}` };
  });

  /** Войти в YouTube в окне приложения — см. youtubeLogin.ts. */
  ipcMain.handle("media:cookiesLogin", async (): Promise<CookiesStatus> => {
    await syncWindowRoute();
    const check = await openLoginWindow(win ?? undefined, cookiesPath());
    if (!check.ok) {
      return { ...(await cookiesStatus()), message: `Вход не завершён — ${check.reason}. Прежние куки не тронуты.` };
    }
    await patchProviderFile({ cookiesFile: cookiesPath(), cookiesAuto: true });
    return { ...(await cookiesStatus()), message: "Вход есть, куки выгружены. Дальше приложение освежает их само." };
  });
  ipcMain.handle("media:cookiesRefresh", async () => refreshAutoCookies());
  ipcMain.handle("media:cookiesLogout", async (): Promise<CookiesStatus> => {
    await logout();
    await patchProviderFile({ cookiesAuto: false });
    await rm(cookiesPath(), { force: true });
    return { ...(await cookiesStatus()), message: "Вышли: вход и файл куков стёрты" };
  });

  /** Общий срок ответа источника, если он не назначил свой. */
  const SEARCH_TIMEOUT_MS = 20_000;

  /** Ждём ответ ограниченное время и говорим человеческими словами, кто именно молчал. */
  const withDeadline = <T,>(work: Promise<T>, ms: number, who: string, stop?: AbortController): Promise<T> => {
    let timer: NodeJS.Timeout;
    return Promise.race([
      work.finally(() => clearTimeout(timer)),
      new Promise<T>((_ok, fail) => {
        timer = setTimeout(() => {
          stop?.abort();
          fail(new Error(`${who} не ответил за ${Math.round(ms / 1000)} с — источник недоступен или сильно замедлен`));
        }, ms);
      }),
    ]);
  };

  /**
   * Ищет сразу по нескольким источникам и отдаёт всё вперемешку, помечая, кто что нашёл.
   * Источник, который упал или не ответил, не рушит выдачу: его ошибка возвращается отдельно.
   *
   * Каждый ответ уходит в окно сразу, отдельным событием. Раньше здесь стоял Promise.all,
   * и выдача ждала самого медленного: при недоступном YouTube yt-dlp молчал полторы минуты,
   * и всё это время в окне висело «Ищу…», хотя Викисклад ответил на первой секунде.
   * Свой срок ожидания у каждого источника — вторая половина той же защиты.
   */
  ipcMain.handle("media:search", async (e, q: SearchQuery, only?: string[]) => {
    searchJob?.abort();
    searchJob = new AbortController();
    const signal = searchJob.signal;
    const jobId = ++searchSeq;
    const cfg = await loadProviderConfig();
    const list = (await providersFor(q.type, cfg)).filter((p) => !only?.length || only.includes(p.id));
    const send = (channel: string, payload: unknown) => { if (!signal.aborted && !e.sender.isDestroyed()) e.sender.send(channel, payload); };
    send("media:searchStart", { jobId, providers: list.map((p) => ({ id: p.id, title: p.title })) } satisfies SearchStart);

    const errors: { providerId: string; message: string }[] = [];
    const chunks = await Promise.all(list.map(async (p) => {
      const started = Date.now();
      // свой выключатель на каждый источник: по истечении срока гасим только его, а не весь поиск.
      // Без этого брошенный yt-dlp продолжал бы стучаться в закрытый сайт ещё полминуты.
      const own = new AbortController();
      const stop = () => own.abort();
      signal.addEventListener("abort", stop, { once: true });
      try {
        const results = await withDeadline(p.search(q, { cfg, signal: own.signal }), p.searchTimeoutMs ?? SEARCH_TIMEOUT_MS, p.title, own);
        send("media:searchChunk", { jobId, providerId: p.id, results, tookMs: Date.now() - started } satisfies SearchChunk);
        return results;
      } catch (err) {
        const message = (err as Error).message;
        if (!signal.aborted) errors.push({ providerId: p.id, message });
        send("media:searchChunk", { jobId, providerId: p.id, results: [], error: message, tookMs: Date.now() - started } satisfies SearchChunk);
        return [];
      } finally {
        signal.removeEventListener("abort", stop);
      }
    }));
    // раскладываем по кругу, чтобы первый источник не занял весь экран
    const out: MediaResult[] = [];
    for (let i = 0; chunks.some((c) => i < c.length); i++) for (const c of chunks) if (c[i]) out.push(c[i]);
    return { results: out, errors } satisfies SearchHit;
  });

  ipcMain.handle("media:searchCancel", () => {
    searchJob?.abort();
    searchJob = null;
  });

  /**
   * Скачивает найденное: оригинал ложится в source/ рядом с паком, копия — в сам пак.
   * Уже скачанное второй раз из сети не тянем — берём оригинал с диска.
   */
  ipcMain.handle("media:fetch", async (e, r: MediaResult, toPack = true, want?: DownloadWish): Promise<FetchResult> => {
    const provider = providerById(r.providerId);
    if (!provider) throw new Error(`неизвестный источник ${r.providerId}`);
    const cfg = await loadProviderConfig();
    const dir = currentSourceDir();
    await mkdir(dir, { recursive: true });

    const onProgress = (p: FetchProgress) => e.sender.send("media:fetchProgress", p);
    let file: string;
    // Уже скачанное второй раз из сети не тянем — но только если просят то же самое.
    // За отрезком идём заново: в библиотеке лежит ролик целиком или другой кусок, и отдать
    // его вместо запрошенных пяти секунд значит молча подсунуть не то.
    const known = want?.clip ? undefined : await findByUrl(dir, r.pageUrl, r.downloadUrl);
    if (known && existsSync(join(dir, known.file))) {
      file = join(dir, known.file);
      onProgress({ receivedBytes: known.sizeBytes, totalBytes: known.sizeBytes, ratio: 1, note: "оригинал уже скачан" });
    } else {
      const job = new AbortController();
      fetchJob = job;
      try {
        file = await provider.download(r, dir, { cfg, signal: job.signal, want }, onProgress);
      } finally {
        // отменённая загрузка доходит сюда позже, когда уже идёт следующая: чужую не трогаем
        if (fetchJob === job) fetchJob = null;
      }
    }

    const meta: SourceMeta = {
      providerId: r.providerId,
      title: r.title,
      author: r.author,
      license: r.license,
      pageUrl: r.pageUrl,
      downloadUrl: r.downloadUrl,
      fetchedAt: new Date().toISOString(),
      file: basename(file),
      sizeBytes: (await stat(file)).size,
    };
    await addRecord(dir, meta);

    let media: MediaInfo | undefined;
    if (toPack) {
      [media] = await addMediaFiles([file]);
      if (media) {
        await linkToPack(dir, meta.file, media.folder, media.name);
        meta.packFolder = media.folder;
        meta.packFile = media.name;
      }
    }
    return { meta, media, sourcePath: file, sourceDir: dir };
  });

  ipcMain.handle("media:fetchCancel", () => {
    fetchJob?.abort();
    fetchJob = null;
  });

  // Настройки окна лежат на диске, а не в хранилище страницы: адрес окна теперь http,
  // и прежнее хранилище для него чужое. Чтение синхронное — окну они нужны в первом же кадре,
  // иначе ширина колонки прыгала бы на глазах.
  ipcMain.on("ui:all", (e) => {
    e.returnValue = {
      editorWidth: uiSettings?.editorWidth, ytMaxHeight: uiSettings?.ytMaxHeight, theme: uiSettings?.theme,
      reportErrors: uiSettings?.reportErrors ?? true,
    };
  });
  ipcMain.handle("ui:set", (_e, key: "editorWidth" | "ytMaxHeight" | "theme" | "reportErrors", value: number | string | boolean) => {
    rememberSetting(key, value as never);
  });

  // Мастер первого запуска: после установщика (install-options.json рядом с exe — галочки со страницы
  // «Компоненты») или на машине без ffmpeg. Показывается один раз; потом всё — в окне «🧩».
  ipcMain.handle("firstRun:get", async () => {
    // самопроверки мастер не видят — кроме той, что проверяет сам мастер
    if (uiSettings?.firstRunDone || (SELF_TEST && !process.argv.includes("--first-run=1"))) return null;
    let opts: { ytdlp?: boolean; model?: boolean } | null = null;
    try {
      const raw = await readFile(join(dirname(process.execPath), "install-options.json"), "utf8");
      opts = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
    } catch { /* не из установщика */ }
    await loadProviderConfig();
    if (!opts && ffmpegAvailable()) return null;
    return { ytdlp: opts?.ytdlp ?? true, model: opts?.model ?? false };
  });
  ipcMain.handle("firstRun:done", () => rememberSetting("firstRunDone", true));

  // Чат-помощник (Claude / ChatGPT): набор из resources/assistant-kit раскладывается по местам.
  // Предлагается при первом запуске на машине, где навыка Claude ещё нет; потом — кнопка 🤝 в шапке.
  const assistantDefaultDir = () => join(app.getPath("documents"), "Мастерская паков", "Подсказки");
  ipcMain.handle("assistant:status", async (): Promise<AssistantStatus> => {
    await loadSettings();
    const claudeSkill = await findClaudeSkill();
    const forced = process.argv.includes("--assistant-setup=1");
    return {
      ask: forced || (!SELF_TEST && !uiSettings?.assistantDone && !claudeSkill),
      workdir: uiSettings?.assistantDir ?? assistantDefaultDir(),
      claudeSkill,
    };
  });
  ipcMain.handle("assistant:pickDir", async (e, current: string) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = { title: "Рабочая папка помощника", defaultPath: current, properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[] };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle("assistant:setup", async (_e, kind: AssistantKind, workdir: string) => {
    const r = await setupAssistant(join(resourcesDir(), "assistant-kit"), kind, workdir);
    rememberSetting("assistantDir", workdir);
    rememberSetting("assistantDone", true);
    if (r.instructions) clipboard.writeText(r.instructions);
    return r;
  });
  ipcMain.handle("assistant:done", () => rememberSetting("assistantDone", true));
  ipcMain.handle("assistant:open", async (_e, target: "folder" | "chatgpt-dir" | "claude-skills" | "chatgpt") => {
    const dir = uiSettings?.assistantDir ?? assistantDefaultDir();
    if (target === "folder") await shell.openPath(dir);
    else if (target === "chatgpt-dir") await shell.openPath(join(dir, CHATGPT_DIR));
    else if (target === "claude-skills") await shell.openExternal("https://claude.ai/settings/capabilities");
    else await shell.openExternal("https://chatgpt.com/");
  });

  ipcMain.handle("media:sources", async () => ({ dir: currentSourceDir(), items: await readIndex(currentSourceDir()) }));

  /**
   * Положить в пак то, что уже скачано. Второй раз из сети не тянем: библиотека и заведена
   * ради этого — оригинал остаётся на диске, в пак уходит копия.
   */
  ipcMain.handle("library:toPack", async (_e, files: string[]) => {
    const dir = currentSourceDir();
    const added = await addMediaFiles(files.map((f) => join(dir, basename(f))));
    // в индексе отмечаем, куда именно лёг файл: потом видно, что уже в паке, а что нет
    for (let i = 0; i < added.length; i++) {
      await linkToPack(dir, basename(files[i]), added[i].folder, added[i].name).catch(() => {});
    }
    return added;
  });

  /**
   * Оригинал из пака — в source/ рядом с паком (как у медиацентра): его заменила обработанная версия,
   * а ответ вопроса уже занят. Возвращает имя файла в библиотеке.
   */
  ipcMain.handle("library:keep", async (_e, folder: string, name: string, note: string) => {
    const entry = doc.media.get(key(folder, name));
    if (!entry) throw new Error(`в паке нет файла «${name}»`);
    const dir = currentSourceDir();
    await mkdir(dir, { recursive: true });
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
    let file = name;
    for (let i = 2; existsSync(join(dir, file)); i++) file = `${stem} (${i})${ext}`;
    const data = await loadEntry(entry.source);
    await writeFile(join(dir, file), data);
    await addRecord(dir, { providerId: "pack", title: note, file, fetchedAt: new Date().toISOString(), sizeBytes: data.length, packFolder: folder, packFile: name });
    return file;
  });

  /** Открыть саму папку библиотеки или показать в ней файл — без похода в проводник руками. */
  ipcMain.handle("library:reveal", async (_e, file?: string) => {
    const dir = currentSourceDir();
    await mkdir(dir, { recursive: true });
    if (file) {
      const full = join(dir, basename(file));
      if (existsSync(full)) {
        shell.showItemInFolder(full);
        return dir;
      }
    }
    await shell.openPath(dir);
    return dir;
  });

  /**
   * Убрать оригинал из библиотеки. Файл уходит в корзину, а не стирается совсем:
   * библиотека — это исходники, и восстановить их из сети выйдет не всегда.
   */
  ipcMain.handle("library:remove", async (_e, file: string) => {
    const dir = currentSourceDir();
    const full = join(dir, basename(file));
    if (!existsSync(full)) return false;
    await shell.trashItem(full);
    await removeRecord(dir, basename(file));
    return true;
  });

  // ---------- студия слов ----------

  ipcMain.handle("words:generators", () => generatorInfos());
  ipcMain.handle("words:stats", () => dict().stats());

  ipcMain.handle("words:run", async (_e, id: string, args: GeneratorArgs) => {
    const g = generatorById(id);
    if (!g) throw new Error(`неизвестный генератор ${id}`);
    return g.run(dict(), args);
  });

  // ---------- студия слов: генерация картинок ----------
  // Ключи — в providers.json (см. core/ai/config.ts). Картинку окно кладёт в пак само,
  // через тот же image:save, что и редактор картинок: второй путь записи в пак не нужен.

  let imagegenAbort: AbortController | undefined;
  setPresetsDir(baseDir());
  ipcMain.handle("imagegen:presets", () => presetInfos());
  ipcMain.handle("phrases:get", async () => ({
    // dict() задаёт папки наборов: без него словарь фраз «не скачан», пока не открыта вкладка «Слова»
    set: await loadPhrases((dict(), wordSourceDirs().bundled)),
    kinds: PHRASE_KINDS.map(({ id, title }) => ({ id, title })),
    styles: PHRASE_STYLES.map(({ id, title }) => ({ id, title })),
  }));
  ipcMain.handle("imagegen:putPreset", (_e, p: ImagePreset) => putPreset(p));
  ipcMain.handle("imagegen:deletePreset", (_e, id: string) => deletePreset(id));
  // sd-server держит ~11 ГБ памяти — уходит вместе с приложением
  app.on("will-quit", stopLocalServers);
  ipcMain.handle("imagegen:prompt", async (_e, phrase: string, preset: string, temperature?: number, work?: WorkHit) => {
    imagegenAbort = new AbortController();
    const { cfg } = await loadAiConfig(baseDir());
    // Википедия не ответила — не беда: модель угадает фильм сама, как до списка
    let known: WorkDetails | undefined;
    if (work) known = await workDetails(work.id, work, imagegenAbort.signal).catch(() => undefined);
    return phraseToPrompt(cfg, phrase, preset, imagegenAbort.signal, temperature, known);
  });
  // подсказки к названию фильма: каждый новый запрос отменяет прежний, иначе старый ответ может прийти последним
  let worksAbort: AbortController | undefined;
  ipcMain.handle("works:search", (_e, query: string) => {
    worksAbort?.abort();
    worksAbort = new AbortController();
    return searchWorks(query, worksAbort.signal);
  });
  ipcMain.handle("imagegen:styles", () => IMAGE_STYLES.map(({ id, title, about }) => ({ id, title, about })));
  ipcMain.handle("imagegen:run", async (_e, prompt: string, width: number, height: number, allowPaid = false, style?: string, ownStyle?: string) => {
    imagegenAbort = new AbortController();
    const { cfg } = await loadAiConfig(baseDir());
    // стиль — хвостом к сцене: сцена в окне остаётся чистой, а смена стиля не требует новой сцены
    // ownStyle — свой текст стиля пресета (детский рисунок и пресеты автора) вместо галочки
    const full = [prompt.trim(), ownStyle?.trim() || styleText(style)].filter(Boolean).join(" ");
    try {
      const r = await generateImage(cfg, { prompt: full, width, height }, imagegenAbort.signal, { allowPaid });
      return { dataUrl: `data:${r.mime};base64,${r.data.toString("base64")}`, model: r.model, ms: r.ms, skipped: r.skipped };
    } catch (e) {
      // из главного процесса в окно доходит только текст ошибки — «нужна платная» отдаём ответом
      if (e instanceof NeedPaidError) return { needPaid: e.paid, skipped: e.skipped };
      throw e;
    }
  });
  ipcMain.handle("imagegen:cancel", () => imagegenAbort?.abort());

  /**
   * Картинка от ИИ — как скачанный файл: оригинал в библиотеку (source/) с записью, чем и по какой сцене
   * нарисован, копия — в пак. Раньше она шла прямо в пак через image:save и в библиотеке не появлялась
   * (2026-09-24): ни пересмотреть, ни взять в другой вопрос, ни узнать сцену.
   */
  ipcMain.handle("imagegen:keep", async (_e, dataUrl: string, phrase: string, info: { model: string; style?: string; prompt: string }) => {
    const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/s.exec(dataUrl);
    if (!m) throw new Error("не картинка");
    const ext = m[1] === "jpeg" ? ".jpg" : `.${m[1]}`;
    const dir = currentSourceDir();
    await mkdir(dir, { recursive: true });
    const base = phrase.replace(/[\/:*?"<>|]/g, "_").trim().slice(0, 80) || "картинка ИИ";
    let file = base + ext;
    for (let i = 2; existsSync(join(dir, file)); i++) file = `${base} (${i})${ext}`;
    const full = join(dir, file);
    await writeFile(full, Buffer.from(m[2], "base64"));
    const meta: SourceMeta = {
      providerId: "ИИ",
      title: phrase || file,
      author: [info.style, info.model].filter(Boolean).join(" · "),
      license: "нарисовано ИИ",
      fetchedAt: new Date().toISOString(),
      file,
      sizeBytes: (await stat(full)).size,
      prompt: info.prompt,
    };
    await addRecord(dir, meta);
    const [media] = await addMediaFiles([full]);
    if (!media) throw new Error("картинка не легла в пак");
    await linkToPack(dir, file, media.folder, media.name);
    return media;
  });

  // ---------- настройки ИИ ----------
  setUsageFile(join(baseDir(), "ai-usage.json"));
  ipcMain.handle("ai:settings", () => readSettings(baseDir()));
  ipcMain.handle("ai:settingsSave", (_e, s: AiSettings) => writeSettings(baseDir(), s));
  ipcMain.handle("ai:test", (_e, id: string) => testProvider(baseDir(), id));
  ipcMain.handle("ai:templates", () => PROVIDER_TEMPLATES);
  /** Остатки: по всем сервисам или только по тем, что стоят в очереди картинок. */
  ipcMain.handle("ai:quota", async (_e, only?: "images") => {
    const found = await findAiConfig(baseDir());
    if (!found) return [];
    const { cfg } = found;
    if (only !== "images") return allQuotas(cfg);
    const ids = [...new Set((cfg.imageChain ?? []).map((r) => r.slice(0, r.indexOf(":"))))].filter((id) => cfg.providers[id] && !cfg.providers[id].disabled);
    return Promise.all(ids.map((id) => quotaFor(cfg, id)));
  });

  // ---------- редактор медиа ----------

  ipcMain.handle("ffmpeg:available", () => ffmpegAvailable());
  ipcMain.handle("system:probe", async () => probeSystem({ componentsDir: componentsDir(), providerCfg: await loadProviderConfig() }));

  // ---------- компоненты: локальная модель картинок одной кнопкой ----------
  ipcMain.handle("components:state", () => componentsState());
  ipcMain.handle("components:install", (e, profile: ProfileId) => runModelInstall(profile, (p) => e.sender.send("components:progress", p)));
  ipcMain.handle("components:cancel", () => { installAbort?.abort(); });
  ipcMain.handle("components:installTool", (e, tool: string) => runInstall(async (signal, send) => {
    await installTool({ manifest: await loadManifest(resourcesDir()), tool, componentsDir: componentsDir(), signal, onProgress: send });
    toolsChanged();
  }, (p) => e.sender.send("components:progress", p)));
  // «Обновить»: yt-dlp — своим -U (подписанный релиз), остальное — заново из манифеста, если там версия новее
  ipcMain.handle("components:updateTool", async (e, tool: string) => {
    if (installAbort) throw new Error("идёт установка — сначала дождитесь её");
    if (tool === "yt-dlp") {
      const r = await selfUpdateYtdlp(componentsDir());
      toolsChanged();
      return r.changed ? `yt-dlp обновлён: ${r.from ?? "?"} → ${r.to}` : `yt-dlp уже свежий (${r.to ?? r.from ?? "?"})`;
    }
    await runInstall(async (signal, send) => {
      await installTool({ manifest: await loadManifest(resourcesDir()), tool, componentsDir: componentsDir(), signal, onProgress: send });
      toolsChanged();
    }, (p) => e.sender.send("components:progress", p));
    return `${tool} обновлён`;
  });
  ipcMain.handle("components:removeTool", async (_e, tool: string) => {
    if (installAbort) throw new Error("идёт установка — сначала отмените её");
    await removeTool(componentsDir(), tool);
    toolsChanged();
    return componentsState();
  });
  ipcMain.handle("components:adopt", async () => {
    const r = await dialog.showOpenDialog(win!, { title: "Папка с уже скачанной моделью (как local-image: bin и models)", properties: ["openDirectory"] });
    if (r.canceled || !r.filePaths[0]) return null;
    await adoptFolder(await loadManifest(resourcesDir()), r.filePaths[0], baseDir(), componentsDir());
    return componentsState();
  });
  ipcMain.handle("components:remove", async () => {
    if (installAbort) throw new Error("идёт установка — сначала отмените её");
    await removeModel(componentsDir(), baseDir());
    return componentsState();
  });

  ipcMain.handle("media:probe", async (_e, folder: string, name: string) => probe(await materialize(folder, name)));

  ipcMain.handle("media:waveform", async (_e, folder: string, name: string, points: number) =>
    waveform(await materialize(folder, name), points));

  ipcMain.handle("media:frame", async (_e, folder: string, name: string, timeSec: number) => {
    const src = await materialize(folder, name);
    const out = join(tmpdir(), `siq-frame-${Date.now()}.png`);
    await frameAt(src, timeSec, out);
    const [added] = await addMediaFiles([out]);
    return added ?? null;
  });

  ipcMain.handle("media:cancel", () => {
    currentJob?.abort();
    currentJob = null;
  });

  /**
   * Применяет план обработки и кладёт результат в пак новым файлом.
   * Исходник остаётся в паке: если что-то не понравится, вопрос можно вернуть на него.
   */
  ipcMain.handle("media:edit", (e, req: MediaEditRequest) => editMedia(req, (p) => e.sender.send("media:progress", p)));

  // ---------- связь с сервером автора: отчёты об ошибках, обратная связь ----------

  // Ошибка из рендерера (window.onerror / unhandledrejection) — главный процесс сам обрежет и почистит.
  ipcMain.handle("errors:report", (_e, err: { kind: string; message: string; stack?: string }) =>
    queueError("renderer", err?.kind, err?.message, err?.stack));
  // Снимок окна — сразу по нажатию 💬, до открытия модалки отзыва (она сама снимок не перекрывает).
  ipcMain.handle("feedback:capture", async () => { if (win) await captureFeedbackShot(win); });
  ipcMain.handle("feedback:send", (_e, req: FeedbackRequest) => sendFeedback(req));
  ipcMain.handle("dup:check", async (_e, pkg: Package, exclude: number[] = []) => {
    const qs = dupQuestions(pkg);
    if (!qs.length) return { ok: false, message: "В паке пока нет вопросов" };
    const payload = [];
    for (const q of qs) {
      const media = await Promise.all(q.refs.map((r) => mediaFingerprint(r.folder, r.name)));
      payload.push({ text: q.text, answers: q.answers, media: media.filter(Boolean) });
    }
    const res = await packDupCheck(payload, exclude.filter((x) => Number.isInteger(x)));
    return res.ok ? { ok: true, report: toReport(qs, res.data) } : res;
  });
}

/**
 * Применяет план обработки и кладёт результат в пак новым файлом.
 * Исходник остаётся в паке: если что-то не понравится, вопрос можно вернуть на него.
 */
async function editMedia(req: MediaEditRequest, onProgress?: (p: ProgressInfo) => void): Promise<MediaInfo> {
  const input = await materialize(req.folder, req.name);
  const onlyAudio = req.plan.audio === "only";
  const ext = onlyAudio ? ".mp3" : ".mp4";
  const folder = onlyAudio ? "Audio" : "Video";
  const base = req.name.replace(/\.[^.]+$/, "");
  const outName = uniqueName(folder, `${base} (обрезано)${ext}`);
  const out = join(tmpdir(), `siq-edit-${Date.now()}${ext}`);

  let overlayPng: string | undefined;
  if (req.overlayPngBase64) {
    overlayPng = join(tmpdir(), `siq-overlay-${Date.now()}.png`);
    await writeFile(overlayPng, Buffer.from(req.overlayPngBase64.replace(/^data:image\/png;base64,/, ""), "base64"));
  }

  currentJob = new AbortController();
  try {
    await transcode({ ...req.plan, input, output: out, overlayPng }, onProgress, currentJob.signal);
  } finally {
    currentJob = null;
    if (overlayPng) await rm(overlayPng, { force: true });
  }

  const m: MediaEntry = { folder, name: outName, size: (await stat(out)).size, source: { kind: "file", path: out } };
  doc.media.set(key(folder, outName), m);
  return mediaInfo(m);
}

/** Файл из пака лежит внутри архива — для ffmpeg выкладываем его во временную папку. */
async function materialize(folder: string, name: string): Promise<string> {
  const m = doc.media.get(key(folder, name));
  if (!m) throw new Error(`нет файла ${folder}/${name}`);
  if (m.source.kind === "file") return m.source.path;
  const tmp = join(tmpdir(), `siq-src-${Date.now()}-${name.replace(/[^\w.-]/g, "_")}`);
  await writeFile(tmp, await loadEntry(m.source));
  return tmp;
}

/**
 * Файл из библиотеки (source/) для предпросмотра в окне.
 * Читаем потоком, а не целиком: в библиотеке лежат оригиналы роликов, и класть
 * полугигабайтное видео в память ради превью — верный способ уронить окно.
 */
async function libraryResponse(name: string, rangeHeader: string | null): Promise<Response> {
  const full = join(currentSourceDir(), basename(name));
  if (!existsSync(full)) return new Response("not found", { status: 404 });
  const { createReadStream } = await import("node:fs");
  const size = (await stat(full)).size;
  const type = MIME[extname(full).toLowerCase()] ?? "application/octet-stream";
  const range = rangeHeader?.match(/bytes=(\d*)-(\d*)/);
  const start = range?.[1] ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  const stream = createReadStream(full, { start, end }) as unknown as AsyncIterable<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of stream) controller.enqueue(chunk);
        controller.close();
      } catch {
        controller.close();
      }
    },
  });
  const headers: Record<string, string> = {
    "content-type": type,
    "accept-ranges": "bytes",
    "content-length": String(end - start + 1),
  };
  if (range) headers["content-range"] = `bytes ${start}-${end}/${size}`;
  return new Response(body, { status: range ? 206 : 200, headers });
}

/** siq://media/<папка>/<имя> — медиа из открытого пака или с диска, с поддержкой Range для перемотки. */
function registerMediaProtocol() {
  protocol.handle("siq", async (req) => {
    const url = new URL(req.url);
    // siq://lib/<имя> — оригинал из библиотеки мастерской, он лежит на диске, а не в паке
    if (url.host === "lib") return libraryResponse(decodeURIComponent(url.pathname.slice(1)), req.headers.get("range"));
    const [, folderEnc, nameEnc] = url.pathname.split("/");
    const m = doc.media.get(key(decodeURIComponent(folderEnc ?? ""), decodeURIComponent(nameEnc ?? "")));
    if (!m) return new Response("not found", { status: 404 });
    const data = await loadEntry(m.source);
    const type = MIME[extname(m.name).toLowerCase()] ?? "application/octet-stream";
    const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
      return new Response(new Uint8Array(data.subarray(start, end + 1)), {
        status: 206,
        headers: { "content-type": type, "content-range": `bytes ${start}-${end}/${data.length}`, "accept-ranges": "bytes", "content-length": String(end - start + 1) },
      });
    }
    return new Response(new Uint8Array(data), { headers: { "content-type": type, "accept-ranges": "bytes", "content-length": String(data.length), "access-control-allow-origin": "*" } });
  });
}

protocol.registerSchemesAsPrivileged([{ scheme: "siq", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

/**
 * Самопроверка без участия человека:
 *   --shot=<png> [--selftest=<пак>]  открыть пак, снять окно, выйти;
 *   --poster=<png> --selftest=<пак>  отрисовать афишу со всеми темами пака в файл и выйти (без окна);
 *   --save-copy=<siq>                 после открытия сохранить копию (проверка записи);
 *   --new-with-media=<файл> --save-copy=<siq>  новый пак + медиа + текст → сохранить;
 *   --rename-theme=<имя>              переименовать первую тему через интерфейс (проверка правки названий);
 *   --edit-theme=1                    открыть поле правки названия темы и оставить открытым (для снимка);
 *   --image-test=<solid|blur|pixelate> открыть редактор картинки, нарисовать заглушку и обрезку, применить, проверить файл;
 *   --collage-test=<N> [--tpl=<i>]    собрать коллаж из N картинок пака (шаблон по номеру) и проверить, что он лёг в пак;
 *   --media-center=<запрос> [--media-type=image|audio|video] [--media-get=1]
 *   --yt-diagnose=1                  нажать «проверить YouTube» и напечатать шаги проверки;
 *   --media-only=<название источника>  искать только в нём (иначе первым ответит кто быстрее);
 *   --media-quality=<высота>          выбрать потолок качества видео перед загрузкой;
 *   --media-clip=<с>-<по>             скачать только отрезок ролика (29:55-30:05);
 *   --player-check=1                 прочитать текст внутри встроенного плеера (пустил ли YouTube);
 *   --cookies-panel=1                после загрузки открыть панель «куки YouTube» (для снимка);
 *   --theme-transfer=<папка> [--theme-into=<siq>] [--theme-transfer-shot=<png>]  перенести 1-ю тему в новый пак и в копию другого;
 *   --proposals=<json> [--proposals-shot=<png>] --save-copy=<siq>  «📋 Из Claude»: вставить все строки плана (картинки — первые
 *                                     из Яндекса), сохранить копию; печатает план и что вставилось;
 *   --first-run=1 [--shot=<png>]      мастер первого запуска: ждёт, пока он сам поставит ffmpeg и yt-dlp (до 10 мин);
 *   --assistant-setup=1 [--shot=<png>] мастер «🤝 Помощник» (Claude / ChatGPT): открыть без пака и снять, ничего не ставить;
 *   --components-panel=1            с --selftest: открыть «🧩 Компоненты», напечатать машину и профили (снимок — --shot);
 *   --system-probe=1                 проверка системы без пака: видеокарта, память, диск, программы, профиль модели;
 *   --game-preview=1 [--game-preview-shot=<png>]  нажать «▶ Как в игре» во 2-м вопросе, пройти экраны, снять кадры;
 *   --point-test=<папка>             ответ точкой: первый point-вопрос пака — круг, щелчок, допуск, «Как в игре» мимо и в точку;
 *   --pixelate-test=<блоков> [--pixelate-shot=<png>]  «Картина по пикселям» на первой картинке вопроса: размеры, цветов не больше блоков, применить;
 *   --pixelate-theme=<тема> [--pixelate-shot=<png>]   вся тема по цене: таблица «цена → блоков», оригиналы в ответах;
 *   --silhouette-test=<чувствит.> [--silhouette-shot=<png>]  силуэт первой картинки вопроса: только чёрное и белое, применить;
 *   --logo-test=<папка>              «Номер на логотип»: кадр каждого стиля, цифра на манжету, поставить логотипом;
 *   --pack-size=1 [--save-copy=<siq>]  «📦 Объём пака»: убрать неиспользуемое, ужать картинки, печатает до/после;
 *   --library-test=1                 открыть библиотеку мастерской, проверить предпросмотр и «в пак»;
 *                                     открыть медиацентр, найти по-настоящему, при --media-get=1 скачать первое в пак;
 *   --word-studio=<кусок> [--word-create=1]
 *                                     открыть студию слов, подобрать матрицу, при --word-create=1 создать тему;
 *                                     --word-gen=Инициалы --word-args=letter=Х,count=3 — другой генератор и его списки;
 *   --ai-settings=1 [--ai-select=<сервис>] [--ai-tab=queues]
 *                                     открыть настройки ИИ из шапки, дождаться остатков (для снимка);
 *   --imagegen-test=<фраза> [--imagegen-preset=<название>] [--imagegen-again=1]
 *                                     фраза «словарь» — взять случайную шутливую из словаря; again — проверить «Ещё вариант»;
 *                                     вкладка «Картинки»: нарисовать по-настоящему и вставить во второй вопрос;
 *   --works-test=<png> [--works-query=<начало названия>]
 *                                     «Фильм по детскому рисунку»: подсказки Wikidata к названию — снимок списка,
 *                                     выбрать первый стрелкой и Enter, без рисования;
 *                                     --works-preset=<стиль> — только снимок строки с полем в другом стиле;
 *   --preset-test=<png>              свои пресеты картинок: сохранить «Свой промпт» пресетом, подставить фразу,
 *                                     сделать инструкцией, удалить; снимки <png>-1…4. Пресеты пишутся в baseDir —
 *                                     запускать с PORTABLE_EXECUTABLE_DIR на временную папку;
 *   --hold=1                          вместе с проверками выше: только открыть и наполнить, не нажимать применение (для снимка).
 */
async function selfTest(win: BrowserWindow, arg: (n: string) => string | undefined) {
  await new Promise<void>((r) => win.webContents.once("did-finish-load", () => r()));
  // мастер первого запуска: дождаться, пока он сам поставит ffmpeg и yt-dlp, напечатать итог
  if (arg("first-run")) {
    const seen = await win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const t0 = Date.now();
      for (let i = 0; i < 100 && !document.querySelector(".components-panel"); i++) await wait(100);
      const box = () => document.querySelector(".components-panel");
      if (!box()) return { ok: false, why: "мастер не открылся" };
      let text = "";
      for (let i = 0; i < 1200; i++) {
        text = box()?.innerText ?? "";
        if (/Программы на месте/.test(text) || box()?.querySelector("section > div.bad")) break;
        await wait(500);
      }
      return {
        ok: /Программы на месте/.test(text),
        seconds: Math.round((Date.now() - t0) / 1000),
        tools: [...document.querySelectorAll(".cmp-tool-list .cmp-installed")].map((e) => e.innerText.replace(/\\s+/g, " ")),
        message: box()?.querySelector("section > div.ok, section > div.bad")?.textContent,
      };
    })()`);
    console.log("САМОПРОВЕРКА мастера первого запуска:", JSON.stringify(seen, null, 1));
    const firstShot = arg("shot");
    if (firstShot) await writeFile(firstShot, (await win.webContents.capturePage()).toPNG());
    app.quit();
    return;
  }
  // мастер помощника: только открыть и снять — «Claude»/«ChatGPT» не жмём, установка пишет в настоящий ~/.claude
  // и в настройки автора (раскладку проверяет tests/assistantKit.test.ts)
  if (arg("assistant-setup")) {
    const seen = await win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 100 && !document.querySelector(".assistant-panel code")?.textContent?.includes("\\\\"); i++) await wait(100);
      const box = document.querySelector(".assistant-panel");
      if (!box) return { ok: false, why: "мастер помощника не открылся" };
      return { ok: true, cards: [...box.querySelectorAll(".assistant-card b")].map((e) => e.textContent), text: box.innerText.replace(/\\s+/g, " ").slice(0, 600) };
    })()`);
    console.log("САМОПРОВЕРКА мастера помощника:", JSON.stringify(seen, null, 1));
    const aShot = arg("shot");
    if (aShot) {
      await win.webContents.executeJavaScript("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
      await win.webContents.capturePage();
      await writeFile(aShot, (await win.webContents.capturePage()).toPNG());
    }
    app.quit();
    return;
  }
  const pack = arg("selftest"), shot = arg("shot"), copy = arg("save-copy"), media = arg("new-with-media");
  // проверки, которые щёлкают по интерфейсу: копию пака после них сохраняем в самом конце
  const uiTest = !!(arg("rename-theme") || arg("ai-settings") || arg("imagegen-test") || arg("works-test") || arg("preset-test") || arg("image-test") || arg("collage-test") || arg("media-center") || arg("word-studio") || arg("split") || arg("yt-diagnose") || arg("library-test") || arg("game-preview") || arg("theme-transfer") || arg("dict-layout") || arg("proposals") || arg("board-test") || arg("point-test") || arg("pixelate-test") || arg("pixelate-theme") || arg("silhouette-test") || arg("logo-test") || arg("pack-size"));
  let data: PackDTO | null = null;
  if (media) {
    closeDoc();
    const pkg = newPackage("Самопроверка");
    const [m] = await addMediaFiles([media]);
    const q = pkg.rounds![0].themes![0].questions![0];
    q.params![0].children = [
      { kind: "item", item: { value: "Какой фильм нарисовал ребёнок?" } },
      { kind: "item", item: { type: "image", isRef: "True", value: m.name } },
    ];
    q.right = ["Титаник"];
    pkg.rounds![0].themes![0].name = "Детские рисунки";
    data = copy ? await savePack(pkg, false, copy) : dto(pkg);
  } else if (pack) {
    data = await openPack(pack);
    if (arg("edit-media")) {
      const src = data.media.find((m) => m.folder === "Video");
      if (src) {
        const created = await editMedia({
          folder: src.folder, name: src.name,
          plan: {
            start: 1, end: 5, audio: "keep", quality: "normal", height: 480,
            crop: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
            covers: [{ x: 0.55, y: 0.6, w: 0.35, h: 0.25, style: "blur", from: 1, to: 3 }],
          },
        });
        console.log("САМОПРОВЕРКА: обработано ->", created.folder + "/" + created.name, created.size, "байт");
        // подставляем новый файл в первый вопрос, чтобы он попал в сохранённый пак
        const q = data.pkg.rounds?.[0]?.themes?.[0]?.questions?.[0];
        const param = q?.params?.find((x) => x.name === "question");
        if (param) param.children = [{ kind: "item", item: { type: "video", isRef: "True", value: created.name } }];
        data = { ...data, media: [...data.media, created] };
      }
    }
    if (copy && !uiTest) data = await savePack(data.pkg, false, copy);
  }
  // --poster=<png>: только отрисовать афишу и выйти — окно редактора пак не грузим и не показываем.
  if (data && arg("poster")) {
    const posterPath = arg("poster")!;
    await renderPoster(buildPosterHtml(data.pkg), posterPath);
    console.log("САМОПРОВЕРКА афиши: файл ->", posterPath);
    app.quit();
    return;
  }
  if (data && arg("image-test")) {
    const pick = data.media.find((m) => m.folder === "Images");
    if (pick) data = { ...data, openEditorMedia: pick };
  }
  if (data && arg("collage-test")) data = { ...data, openCollage: true };
  if (data && arg("open-editor")) {
    const wanted = arg("open-editor");
    const pick = data.media.find((m) => m.folder === "Video" && (wanted === "1" || m.name.includes(wanted!)))
      ?? data.media.find((m) => m.folder === "Video");
    if (pick) data = { ...data, openEditorMedia: pick };
  }
  if (data) win.webContents.send("selftest:load", data);
  const hold = arg("hold") ? "true" : "false";
  const waitForNewMedia = async (before: number, seconds = 40) => {
    for (let i = 0; i < seconds * 4; i++) {
      if (doc.media.size > before) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  };

  if (data && arg("image-test")) {
    const before = doc.media.size;
    // значение флага задаёт стиль заглушки: solid, blur или pixelate
    const coverStyle = ["solid", "blur", "pixelate"].includes(arg("image-test")!) ? arg("image-test")! : "blur";
    const opened = await win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      let canvas = null;
      for (let i = 0; i < 60 && !canvas; i++) { await wait(100); canvas = document.querySelector(".image-frame canvas"); }
      if (!canvas || !canvas.width) return { ok: false, why: "редактор картинки не открылся" };
      // рисуем заглушку и обрезку мышью, как это делает человек, — по ВИДИМОЙ картинке:
      // рамка редактора больше картинки, и доли от рамки уводили заглушку к центру
      const frame = document.querySelector(".image-frame");
      const box = canvas.getBoundingClientRect();
      const drag = async (sel, x1, y1, x2, y2) => {
        const tool = [...document.querySelectorAll(".tools button")].find((b) => b.textContent.trim() === sel);
        if (!tool) return false;
        tool.click();
        await wait(120);
        const at = (fx, fy) => ({ clientX: box.left + box.width * fx, clientY: box.top + box.height * fy, bubbles: true, pointerId: 1, isPrimary: true, button: 0 });
        frame.dispatchEvent(new PointerEvent("pointerdown", at(x1, y1)));
        await wait(40);
        frame.dispatchEvent(new PointerEvent("pointermove", at(x2, y2)));
        await wait(40);
        frame.dispatchEvent(new PointerEvent("pointerup", at(x2, y2)));
        await wait(150);
        return true;
      };
      const style = [...document.querySelectorAll(".tools select")].find((sel) => [...sel.options].some((o) => o.value === "blur"));
      if (style) { style.value = ${JSON.stringify(coverStyle)}; style.dispatchEvent(new Event("change", { bubbles: true })); await wait(100); }
      const drewCover = await drag("Нарисовать", 0.1, 0.1, 0.45, 0.4);
      await wait(300);
      // сплошная заливка обязана закрыть углы размеченного прямоугольника, а не меньший кусок у центра
      let поМесту = null;
      if (${JSON.stringify(coverStyle)} === "solid") {
        const ctx = canvas.getContext("2d");
        const px = (fx, fy) => [...ctx.getImageData(Math.floor(canvas.width * fx), Math.floor(canvas.height * fy), 1, 1).data.slice(0, 3)];
        const inside = [[0.11, 0.11], [0.44, 0.11], [0.11, 0.39], [0.44, 0.39]].map(([x, y]) => px(x, y));
        поМесту = inside.every((c) => c.every((v) => v < 8));
        if (!поМесту) return { ok: false, why: "заглушка легла не туда, куда нарисована", углы: inside };
      }
      const drewCrop = await drag("Обрезать", 0.05, 0.05, 0.85, 0.8);
      await wait(600);
      const btn = [...document.querySelectorAll(".apply-box button")].find((b) => b.textContent.includes("Применить"));
      if (!btn) return { ok: false, why: "нет кнопки Применить" };
      const covers = document.querySelectorAll(".shape.cover").length;
      const crops = document.querySelectorAll(".shape.crop-frame").length;
      if (!${hold}) btn.click();
      return { ok: true, size: canvas.width + "x" + canvas.height, стильЗаглушки: style ? style.value : "?", заглушкаПоМесту: поМесту, заглушек: covers, рамокОбрезки: crops, рисование: drewCover && drewCrop, открыто: ${hold} };
    })()`);
    const landed = opened.ok && hold === "false" ? await waitForNewMedia(before) : false;
    console.log("САМОПРОВЕРКА картинки:", JSON.stringify({ ...opened, вПакеПоявился: landed }));
    if (!opened.ok || (hold === "false" && !landed)) process.exitCode = 1;
  }

  if (data && arg("collage-test")) {
    const want = Math.max(2, Number(arg("collage-test")) || 2);
    const before = doc.media.size;
    const built = await win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      let thumbs = [];
      for (let i = 0; i < 60 && thumbs.length === 0; i++) { await wait(100); thumbs = [...document.querySelectorAll(".pack-images .thumb")]; }
      if (!thumbs.length) return { ok: false, why: "коллаж не открылся или в паке нет картинок" };
      const tplWanted = ${Number(arg("tpl") ?? 0) || 0};
      const counts = [...document.querySelectorAll(".collage-counts button")];
      const target = counts.find((b) => b.textContent.trim() === "${want}");
      if (target) { target.click(); await wait(200); }
      const tpls = [...document.querySelectorAll(".tpl-list .tpl")];
      if (tplWanted && tpls[tplWanted]) { tpls[tplWanted].click(); await wait(200); }
      for (let i = 0; i < ${want} && i < thumbs.length; i++) { thumbs[i].click(); await wait(120); }
      await wait(1200);
      const canvas = document.querySelector(".collage-preview canvas");
      const btn = [...document.querySelectorAll(".apply-box button")].find((b) => b.textContent.includes("Собрать"));
      if (!btn || btn.disabled) return { ok: false, why: "кнопка сборки недоступна" };
      if (!${hold}) btn.click();
      return { ok: true, size: canvas ? canvas.width + "x" + canvas.height : "?", ячеек: document.querySelectorAll(".slot").length, шаблон: tplWanted, открыто: ${hold} };
    })()`);
    const landed = built.ok && hold === "false" ? await waitForNewMedia(before) : false;
    console.log("САМОПРОВЕРКА коллажа:", JSON.stringify({ ...built, вПакеПоявился: landed }));
    if (!built.ok || (hold === "false" && !landed)) process.exitCode = 1;
  }

  const rename = arg("rename-theme");
  if (data && rename) {
    await new Promise((r) => setTimeout(r, 1200));
    const result = await win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const title = document.querySelector(".theme-name .theme-title");
      if (!title) return { ok: false, why: "нет .theme-title" };
      const was = title.textContent;
      title.click();
      let input = null;
      for (let i = 0; i < 40 && !input; i++) { await wait(50); input = document.querySelector(".theme-name .theme-input"); }
      if (!input) return { ok: false, why: "щелчок не открыл поле ввода" };
      const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(input, ${JSON.stringify(rename)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(60);
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      let now = null;
      for (let i = 0; i < 40 && !now; i++) { await wait(50); now = document.querySelector(".theme-name .theme-title"); }
      // на табло пробелы рядом с эмодзи — неразрывные (только для показа), сравниваем без этой разницы
      const shown = now && now.textContent.replace(/ /g, " ");
      return { ok: shown === ${JSON.stringify(rename)}, was, now: shown };
    })()`);
    await new Promise((r) => setTimeout(r, 2000));
    const after = await win.webContents.executeJavaScript(
      `({ board: document.querySelector(".theme-name .theme-title")?.textContent, state: window.__pack?.rounds?.[0]?.themes?.[0]?.name })`,
    );
    console.log("САМОПРОВЕРКА переименования темы:", JSON.stringify(result), "через 2 с:", JSON.stringify(after));
    if (!result?.ok) process.exitCode = 1;
  }
  // Крупные пиксели: открыть редактор первой картинки вопроса, включить «Картина по пикселям», задать число
  // блоков, сверить размеры и число цветов (не больше блоков), применить. --pixelate-theme — вся тема по цене.
  const pixN = arg("pixelate-test"), pixTheme = arg("pixelate-theme"), silTol = arg("silhouette-test");
  if (data && (pixN || pixTheme || silTol)) {
    const js = <T,>(code: string): Promise<T> => win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const until = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 50) { const v = f(); if (v) return v; await wait(50); } return null; };
      const byText = (sel, text) => [...document.querySelectorAll(sel)].find((b) => b.textContent.includes(text));
      const type = async (input, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await wait(60);
      };
      const canvasInfo = () => {
        const c = document.querySelector(".media-editor .fit-box canvas");
        const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        const v = new Uint32Array(d.buffer);
        return { w: c.width, h: c.height, colors: new Set(v).size };
      };
      // первый вопрос с картинкой из пака (в теме themeName, если задана): выбрать клетку, открыть редактор картинки
      const openImage = async (themeName, box = "Картина по пикселям") => {
        await until(() => window.__pack && document.querySelector(".board-row .cell:not(.none)"), 20000);
        const rounds = window.__pack.rounds ?? [];
        for (let r = 0; r < rounds.length; r++) for (let t = 0; t < (rounds[r].themes ?? []).length; t++) {
          const th = rounds[r].themes[t];
          if (themeName && !th.name.toLowerCase().includes(themeName.toLowerCase())) continue;
          const qs = th.questions ?? [];
          for (let q = 0; q < qs.length; q++) {
            const items = (qs[q].params ?? []).find((p) => p.name === "question")?.children.filter((c) => c.kind === "item").map((c) => c.item) ?? [];
            if (!items.some((it) => (it.type ?? "") === "image")) continue;
            document.querySelectorAll(".round-tabs .round-tab")[r].querySelector("button").click();
            await wait(400);
            document.querySelectorAll(".board-row")[t].querySelectorAll(".cell:not(.none)")[q].click();
            await wait(300);
            const edit = await until(() => [...document.querySelectorAll(".editor .content-list")][0]
              ?.querySelectorAll(".content-item") && [...[...document.querySelectorAll(".editor .content-list")][0].querySelectorAll(".content-item")]
                .find((el) => el.querySelector(".kind-image"))?.querySelector(".content-item-head button.small"));
            if (!edit) return { ошибка: "нет кнопки «Изменить…» у картинки" };
            edit.click();
            const c = await until(() => { const x = document.querySelector(".media-editor .fit-box canvas"); return x && x.width > 1 ? x : null; }, 15000);
            if (!c) return { ошибка: "редактор картинки не открылся" };
            await wait(300);
            byText(".media-editor label.check", box).querySelector("input").click();
            await wait(400);
            return { r, t, q, тема: th.name };
          }
        }
        return { ошибка: themeName ? "нет темы «" + themeName + "» с картинками" : "в паке нет вопросов с картинкой" };
      };
      ${code}
    })()`);
    const snap = async (file: string | undefined) => {
      if (!file) return;
      // два кадра с перерисовкой: canvas внутри модального окна иногда не успевает в первый
      win.webContents.invalidate();
      await new Promise((r) => setTimeout(r, 400));
      win.webContents.invalidate();
      await new Promise((r) => setTimeout(r, 200));
      await writeFile(file, (await win.webContents.capturePage()).toPNG());
    };
    if (pixN) {
      const res = await js<Record<string, unknown>>(`
        const opened = await openImage("");
        if (opened.ошибка) return opened;
        const n = ${Number(pixN) || 16};
        const num = document.querySelector(".media-editor .blocks-num");
        num.focus();
        await type(num, String(n));
        num.blur();
        await wait(700);
        const after = canvasInfo();
        const size = Math.max(1, Math.round(after.w / n));
        const blocks = Math.ceil(after.w / size) * Math.ceil(after.h / size);
        return { ...opened, блоков: n, сетка: Math.ceil(after.w / size) + "×" + Math.ceil(after.h / size), блоковВсего: blocks,
          после: after, цветовНеБольшеБлоков: after.colors <= blocks,
          подсказка: document.querySelector(".media-editor .pixel-box .hint")?.textContent };
      `);
      console.log("САМОПРОВЕРКА пикселей, окно:", JSON.stringify(res));
      await snap(arg("pixelate-shot"));
      // до пикселизации — тот же кадр без галочки: размеры и число цветов для сравнения
      const before = await js<Record<string, unknown>>(`
        const box = byText(".media-editor label.check", "Картина по пикселям").querySelector("input");
        box.click(); await wait(500);
        const b = canvasInfo();
        box.click(); await wait(500);
        return b;
      `);
      console.log("САМОПРОВЕРКА пикселей, до:", JSON.stringify(before));
      const applied = await js<Record<string, unknown>>(`
        byText(".media-editor .apply-box button", "Применить").click();
        await until(() => !document.querySelector(".media-editor"), 30000);
        await wait(400);
        const names = [...document.querySelectorAll(".editor .content-list")][0].querySelectorAll(".file-name");
        return { вВопросе: [...names].map((n) => n.textContent) };
      `);
      console.log("САМОПРОВЕРКА пикселей, применено:", JSON.stringify(applied));
      const ok = !("ошибка" in res) && res.цветовНеБольшеБлоков === true
        && (applied.вВопросе as string[] | undefined)?.some((n) => n.includes(`(пиксели ${Number(pixN) || 16})`)) === true;
      console.log("САМОПРОВЕРКА пикселей, ИТОГ:", ok);
      if (!ok) process.exitCode = 1;
    }
    if (silTol) {
      const res = await js<Record<string, unknown>>(`
        const opened = await openImage("", "Чёрный силуэт");
        if (opened.ошибка) return opened;
        const range = byText(".media-editor .pixel-box label", "Чувствительность").querySelector("input");
        await type(range, ${JSON.stringify(String(Number(silTol) || 40))});
        await wait(900);
        const c = document.querySelector(".media-editor .fit-box canvas");
        const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        let black = 0, white = 0, other = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0) black++;
          else if (d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 255) white++;
          else other++;
        }
        const n = d.length / 4;
        return { ...opened, размер: c.width + "×" + c.height, чёрного: +(black / n).toFixed(3), белого: +(white / n).toFixed(3), прочих: other };
      `);
      console.log("САМОПРОВЕРКА силуэта, окно:", JSON.stringify(res));
      await snap(arg("silhouette-shot"));
      const applied = await js<Record<string, unknown>>(`
        byText(".media-editor .apply-box button", "Применить").click();
        await until(() => !document.querySelector(".media-editor"), 30000);
        await wait(400);
        return { вВопросе: [...[...document.querySelectorAll(".editor .content-list")][0].querySelectorAll(".file-name")].map((n) => n.textContent) };
      `);
      console.log("САМОПРОВЕРКА силуэта, применено:", JSON.stringify(applied));
      const ok = !("ошибка" in res) && res.прочих === 0 && Number(res.чёрного) > 0.01 && Number(res.белого) > 0.01
        && (applied.вВопросе as string[] | undefined)?.some((n) => n.includes("(силуэт)")) === true;
      console.log("САМОПРОВЕРКА силуэта, ИТОГ:", ok);
      if (!ok) process.exitCode = 1;
    }
    if (pixTheme) {
      const res = await js<Record<string, unknown>>(`
        const opened = await openImage(${JSON.stringify(pixTheme)});
        if (opened.ошибка) return opened;
        byText(".media-editor .pixel-box button", "Для всей темы").click();
        const rows = await until(() => document.querySelectorAll(".pixel-theme .pt-row").length && [...document.querySelectorAll(".pixel-theme .pt-row")]);
        if (!rows) return { ошибка: "окно темы не открылось" };
        await until(() => document.querySelectorAll(".pixel-theme img.pt-thumb").length === rows.length, 15000);
        await wait(300);
        const table = rows.map((r) => r.dataset.price + " → " + r.dataset.blocks);
        return { ...opened, таблица: table };
      `);
      console.log("САМОПРОВЕРКА темы по цене, план:", JSON.stringify(res));
      await snap(arg("pixelate-shot")?.replace(/\.png$/i, "-тема.png"));
      if ("ошибка" in res) process.exitCode = 1;
      else {
        const done = await js<Record<string, unknown>>(`
          byText(".pixel-theme footer button", "Пикселизовать").click();
          const text = await until(() => document.querySelector(".pixel-theme .pt-done")?.textContent || document.querySelector(".pixel-theme .err")?.textContent, 180000);
          await wait(500);
          const th = window.__pack.rounds[${Number(res.r)}].themes[${Number(res.t)}];
          const out = (th.questions ?? []).map((q) => {
            const items = (p) => ((q.params ?? []).find((x) => x.name === p)?.children ?? []).filter((c) => c.kind === "item").map((c) => c.item.value);
            return q.price + ": " + items("question").filter((v) => /\\.(png|jpe?g|webp|gif)$/i.test(v)).join(", ") + " | ответ: " + items("answer").join(", ");
          });
          byText(".pixel-theme footer button", "Закрыть")?.click();
          return { итог: text, вопросы: out };
        `);
        console.log("САМОПРОВЕРКА темы по цене, итог:", JSON.stringify(done, null, 1));
        const ok = String(done.итог).startsWith("Готово") && (done.вопросы as string[]).every((l) => !/\.(png|jpe?g|webp)/i.test(l.split("|")[0]) || l.includes("(пиксели "));
        console.log("САМОПРОВЕРКА темы по цене, ИТОГ:", ok);
        if (!ok) process.exitCode = 1;
      }
    }
  }
  // Объём пака: открыть «📦 N МБ», убрать неиспользуемое, ужать картинки; печатает до/после (копию — через --save-copy).
  if (data && arg("pack-size")) {
    const res = await win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const until = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 50) { const v = f(); if (v) return v; await wait(50); } return null; };
      const byText = (sel, text) => [...document.querySelectorAll(sel)].find((b) => b.textContent.includes(text));
      const chip = await until(() => byText(".chip-btn", "МБ"), 20000);
      if (!chip) return { ошибка: "нет кнопки объёма в шапке" };
      const before = chip.textContent;
      chip.click();
      await until(() => document.querySelector(".pack-size"));
      const heads = () => [...document.querySelectorAll(".pack-size h4")].map((h) => h.textContent);
      const tips = [...document.querySelectorAll(".pack-size .ps-tips li")].map((l) => l.textContent);
      const headsBefore = heads();
      for (const label of ["Убрать из пака", "Ужать все"]) {
        const b = byText(".pack-size button", label);
        if (!b) continue;
        b.click();
        await wait(300);
        await until(() => !document.querySelector(".pack-size footer .muted"), 600000);
      }
      await wait(500);
      return { до: before, после: byText(".chip-btn", "МБ").textContent, разделыДо: headsBefore, разделыПосле: heads(), советы: tips,
        журнал: [...document.querySelectorAll(".pack-size .ps-log div")].map((d) => d.textContent) };
    })()`);
    console.log("САМОПРОВЕРКА объёма пака:", JSON.stringify(res, null, 1));
    const ok = !res.ошибка && (res.журнал as string[]).every((l) => !l.startsWith("✘"));
    console.log("САМОПРОВЕРКА объёма пака, ИТОГ:", ok);
    if (!ok) process.exitCode = 1;
  }
  // Номер на логотип: «🖼 Логотип и свойства» → «Номер на логотип», кадр каждого стиля, цифру — на манжету
  // перчатки (0.59, 0.6), поставить логотипом. Снимки — в папку --logo-test.
  const logoDir = arg("logo-test");
  if (data && logoDir) {
    await mkdir(logoDir, { recursive: true });
    const js = <T,>(code: string): Promise<T> => win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const until = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 50) { const v = f(); if (v) return v; await wait(50); } return null; };
      const byText = (sel, text) => [...document.querySelectorAll(sel)].find((b) => b.textContent.includes(text));
      ${code}
    })()`);
    const shot = async (name: string) => {
      win.webContents.invalidate();
      await new Promise((r) => setTimeout(r, 300));
      win.webContents.invalidate();
      await new Promise((r) => setTimeout(r, 200));
      await writeFile(join(logoDir, name), (await win.webContents.capturePage()).toPNG());
    };
    const opened = await js<Record<string, unknown>>(`
      await until(() => window.__pack && document.querySelector(".pack-props-btn"), 20000);
      const before = (window.__pack.attrs ?? []).find((a) => a[0] === "logo")?.[1];
      document.querySelector(".pack-props-btn").click();
      const btn = await until(() => byText(".pack-props button", "Номер на логотип"));
      if (!btn) return { ошибка: "нет кнопки «Номер на логотип» (у пака нет логотипа?)", before };
      btn.click();
      const c = await until(() => { const x = document.querySelector(".logo-number .fit-box canvas"); return x && x.width > 1 ? x : null; }, 15000);
      if (!c) return { ошибка: "окно номера не открылось" };
      const frame = document.querySelector(".logo-number .frame");
      const box = document.querySelector(".logo-number .fit-box").getBoundingClientRect();
      const at = { clientX: box.left + 0.59 * box.width, clientY: box.top + 0.6 * box.height, bubbles: true, pointerId: 1 };
      frame.dispatchEvent(new PointerEvent("pointerdown", at));
      frame.dispatchEvent(new PointerEvent("pointerup", at));
      await wait(300);
      return { before, цифра: document.querySelector(".logo-number .logo-num-text").value,
        стили: [...document.querySelectorAll(".logo-number .logo-styles button")].map((b) => b.textContent) };
    `);
    console.log("САМОПРОВЕРКА логотипа, окно:", JSON.stringify(opened));
    if ("ошибка" in opened) process.exitCode = 1;
    else {
      const styles = opened.стили as string[];
      for (const [i, s] of styles.entries()) {
        await js(`[...document.querySelectorAll(".logo-number .logo-styles button")][${i}].click(); await wait(400);`);
        await shot(`${i + 1}-${s}.png`);
      }
      const after = await js<Record<string, unknown>>(`
        byText(".logo-number .apply-box button", "Поставить").click();
        await until(() => !document.querySelector(".logo-number"), 30000);
        await wait(300);
        return { logo: (window.__pack.attrs ?? []).find((a) => a[0] === "logo")?.[1] };
      `);
      console.log("САМОПРОВЕРКА логотипа, после:", JSON.stringify(after));
      const ok = String(after.logo ?? "").includes("(номер ") && after.logo !== opened.before;
      console.log("САМОПРОВЕРКА логотипа, ИТОГ:", ok);
      if (!ok) process.exitCode = 1;
    }
  }
  // Ответ точкой: открыть первый point-вопрос пака, сверить круг с допуском, поставить точку щелчком,
  // сдвинуть допуск, сыграть «Как в игре» мимо и в точку. Снимки — в папку --point-test.
  const pointDir = arg("point-test");
  if (data && pointDir) {
    await mkdir(pointDir, { recursive: true });
    const shotTo = async (name: string) => {
      win.webContents.invalidate();
      await new Promise((r) => setTimeout(r, 400));
      await writeFile(join(pointDir, name), (await win.webContents.capturePage()).toPNG());
    };
    const js = <T,>(code: string): Promise<T> => win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const until = async (f, ms = 5000) => { for (let t = 0; t < ms; t += 50) { const v = f(); if (v) return v; await wait(50); } return null; };
      const clickAt = (el, fx, fy) => {
        const b = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: b.left + fx * b.width, clientY: b.top + fy * b.height }));
      };
      ${code}
    })()`);
    const found = await js<{ r: number; t: number; q: number; right: string; dev: string } | { ошибка: string }>(`
      await until(() => window.__pack && document.querySelector(".board-row .cell:not(.none)"), 20000);
      const rounds = window.__pack?.rounds ?? [];
      for (let r = 0; r < rounds.length; r++) for (let t = 0; t < (rounds[r].themes ?? []).length; t++) {
        const qs = rounds[r].themes[t].questions ?? [];
        for (let q = 0; q < qs.length; q++) {
          if (!qs[q].params?.some((p) => p.name === "answerType" && p.text === "point")) continue;
          document.querySelectorAll(".round-tabs .round-tab")[r].querySelector("button").click();
          await wait(400);
          document.querySelectorAll(".board-row")[t].querySelectorAll(".cell:not(.none)")[q].click();
          const dev = qs[q].params.find((p) => p.name === "answerDeviation")?.text ?? "";
          return { r, t, q, right: qs[q].right[0], dev };
        }
      }
      return { ошибка: "в паке нет вопросов с ответом точкой" };
    `);
    console.log("САМОПРОВЕРКА точки, вопрос:", JSON.stringify(found));
    if ("ошибка" in found) process.exitCode = 1;
    else {
      const path = `window.__pack.rounds[${found.r}].themes[${found.t}].questions[${found.q}]`;
      await new Promise((r) => setTimeout(r, 800));
      await shotTo("0-вопрос.png");
      // круг: центр — в точке ответа, радиус — допуск × высота картинки (так меряет SIGame)
      const zone = await js<Record<string, unknown>>(`
        const img = await until(() => { const i = document.querySelector(".point-edit .fit-box img"); return i && i.complete && i.naturalWidth ? i : null; });
        if (!img) return { ошибка: "нет картинки в разметке точки" };
        document.querySelector(".point-edit").scrollIntoView({ block: "center" });
        await wait(300);
        const box = img.parentElement.getBoundingClientRect();
        const z = document.querySelector(".point-edit .point-zone")?.getBoundingClientRect();
        const [x, y] = ${path}.right[0].split(",").map(Number);
        const dev = Number(${JSON.stringify(found.dev)});
        const cx = z ? z.left + z.width / 2 : NaN, cy = z ? z.top + z.height / 2 : NaN;
        const ok = !!z && Math.abs(cx - (box.left + x * box.width)) < 2 && Math.abs(cy - (box.top + y * box.height)) < 2
          && Math.abs(z.width - 2 * dev * box.height) < 2 && Math.abs(box.width / box.height - img.naturalWidth / img.naturalHeight) < 0.02;
        return { коробка: [Math.round(box.width), Math.round(box.height)], файл: [img.naturalWidth, img.naturalHeight], кругОк: ok,
          предупреждения: [...document.querySelectorAll(".point-edit .point-note")].map((n) => n.textContent) };
      `);
      console.log("САМОПРОВЕРКА точки, круг в редакторе:", JSON.stringify(zone));
      await shotTo("1-редактор.png");
      const moved = await js<Record<string, unknown>>(`
        const box = document.querySelector(".point-edit .fit-box");
        const img = box.querySelector("img");
        clickAt(box, 0.25, 0.75);
        await wait(300);
        const right = ${path}.right[0];
        const slider = document.querySelector(".point-edit input[type=range]");
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(slider, "0.2");
        slider.dispatchEvent(new Event("input", { bubbles: true }));
        await wait(300);
        const dev = ${path}.params.find((p) => p.name === "answerDeviation")?.text;
        const ratio = String(Math.round(img.naturalWidth / img.naturalHeight * 100) / 100);
        return { ответ: right, допуск: dev, точкаОк: right === "0.25,0.75," + ratio, допускОк: dev === "0.2" };
      `);
      console.log("САМОПРОВЕРКА точки, щелчок и допуск:", JSON.stringify(moved));
      await shotTo("2-новая-точка.png");
      // «Как в игре»: щелчок по картинке — ответ игрока; сначала мимо, потом в точку
      const play = async (fx: number, fy: number, name: string) => {
        const res = await js<Record<string, unknown>>(`
          [...document.querySelectorAll(".question-head button")].find((b) => b.textContent.includes("Как в игре")).click();
          const box = await until(() => document.querySelector(".gp-point .fit-box img")?.naturalWidth && document.querySelector(".gp-point .fit-box"), 15000);
          if (!box) return { ошибка: "в «Как в игре» нет картинки для щелчка" };
          await wait(300);
          clickAt(box, ${fx}, ${fy});
          const verdict = await until(() => document.querySelector(".gp-verdict")?.textContent);
          await wait(300);
          return { вердикт: verdict, круг: !!document.querySelector(".gp-point .point-zone"), экран: document.querySelector(".game-preview footer span")?.textContent };
        `);
        await shotTo(name);
        await js(`document.querySelector(".game-preview header button[title^='Закрыть']").click(); await wait(200);`);
        return res;
      };
      const miss = await play(0.9, 0.1, "3-мимо.png");
      const hit = await play(0.27, 0.73, "4-попал.png");
      console.log("САМОПРОВЕРКА точки, игра:", JSON.stringify({ мимо: miss, попал: hit }));
      const ok = zone.кругОк === true && moved.точкаОк === true && moved.допускОк === true
        && String(miss.вердикт).includes("Мимо") && String(hit.вердикт).includes("Попал") && hit.круг === true;
      console.log("САМОПРОВЕРКА точки, ИТОГ:", ok);
      if (!ok) process.exitCode = 1;
    }
  }
  // Табло через интерфейс: перетащить клетку, сменить цену (клетка должна переехать, выбор — за ней),
  // переименовать раунд, добавить и переставить раунды, поставить логотип. Снимки — в папку --board-test.
  const boardDir = arg("board-test");
  if (data && boardDir) {
    await mkdir(boardDir, { recursive: true });
    const shotTo = async (name: string) => {
      win.webContents.invalidate();
      await new Promise((r) => setTimeout(r, 400));
      win.webContents.invalidate();
      await new Promise((r) => setTimeout(r, 200));
      await writeFile(join(boardDir, name), (await win.webContents.capturePage()).toPNG());
    };
    const report = await win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const out = {};
      for (let i = 0; i < 200 && !(window.__pack && document.querySelector(".board-row .cell:not(.none)")); i++) await wait(100);
      if (!window.__pack) return { ошибка: "пак не загрузился в окно за 20 с", экран: document.body.innerText.slice(0, 200) };
      const theme =() => window.__pack.rounds[0].themes[0].questions.map((q) => q.price + ":" + (q.right[0] || "").slice(0, 12));
      const cells = () => [...document.querySelectorAll(".board-row")][0].querySelectorAll(".cell:not(.none)");
      const drag = async (src, dst) => {
        const dt = new DataTransfer();
        src.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
        await wait(80);
        dst.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
        await wait(80);
        dst.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
        src.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
        await wait(500);
      };
      const type = async (input, value) => {
        const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await wait(60);
      };

      // 1. перетаскивание: первая клетка темы на третье место
      out.доПеретаскивания = theme();
      await drag(cells()[0], cells()[2]);
      out.послеПеретаскивания = theme();
      out.ценыНаТабло = [...cells()].map((c) => c.querySelector(".price").textContent);

      // 2. цена в редакторе: первой клетке любая цена 999 — клетка уезжает в конец, выбор за ней
      cells()[0].click();
      await wait(200);
      const price = document.querySelector(".editor input[type=number]");
      const answerBefore = window.__pack.rounds[0].themes[0].questions[0].right[0];
      await type(price, "999");
      out.доКоммита = theme();
      price.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      await wait(600);
      out.послеЦены = theme();
      const qs = window.__pack.rounds[0].themes[0].questions;
      const sel = document.querySelector(".board-row .cell.selected");
      const selIndex = [...cells()].indexOf(sel);
      out.выбранаКлетка = selIndex;
      out.ценаВРедакторе = document.querySelector(".editor input[type=number]").value;
      out.ценаОк = qs[qs.length - 1].price === "999" && qs[qs.length - 1].right[0] === answerBefore && selIndex === qs.length - 1;

      // 3. раунды: переименовать двойным щелчком, добавить, переставить перетаскиванием
      const tab = () => document.querySelector(".round-tabs .round-tab button.active");
      tab().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      await wait(150);
      const rin = document.querySelector(".round-tabs .round-input");
      out.полеРаунда = !!rin;
      if (rin) {
        await type(rin, "🎢 Разминка");
        rin.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        await wait(200);
      }
      out.имяРаунда = window.__pack.rounds[0].name;
      const before = window.__pack.rounds.map((r) => r.name);
      document.querySelector(".round-tabs .add-round").click();
      await wait(300);
      out.раундыПослеДобавления = window.__pack.rounds.map((r) => r.name + (r.type === "final" ? "★" : ""));
      out.ценыНовогоРаунда = window.__pack.rounds[before.length - (window.__pack.rounds.at(-1).type === "final" ? 1 : 0)]?.themes?.[0]?.questions?.map((q) => q.price);
      const tabs = () => [...document.querySelectorAll(".round-tabs .round-tab")];
      const d1 = new DataTransfer();
      tabs()[1].querySelector("button").dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: d1 }));
      await wait(80);
      tabs()[0].dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: d1 }));
      await wait(80);
      tabs()[0].dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: d1 }));
      await wait(300);
      out.раундыПослеПерестановки = window.__pack.rounds.map((r) => r.name);
      out.активнаВкладка = tab()?.textContent;

      // 4. тема в другой раунд: ручкой ⠿ на вкладку, затем списком ↪
      const rn = () => window.__pack.rounds.map((r) => (r.themes || []).map((t) => t.name));
      // берём настоящие раунды пака (после перестановки это вкладки 0 и 1), а не только что добавленный пустой
      tabs()[0].querySelector("button").click();
      await wait(300);
      const cur = 0, target = 1;
      const counts = () => rn().map((t) => t.length);
      const before4 = counts();
      const themeName = rn()[cur][0];
      const d2 = new DataTransfer();
      document.querySelector(".theme-name .theme-grip").dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: d2 }));
      await wait(80);
      tabs()[target].dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: d2 }));
      await wait(80);
      tabs()[target].dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: d2 }));
      await wait(300);
      out.темаРучкой = { тема: themeName, вПриёмнике: rn()[target].at(-1), темДо: before4.slice(0, 2).join("/"), темПосле: counts().slice(0, 2).join("/"),
        цены: window.__pack.rounds[target].themes.at(-1).questions.map((q) => q.price).join(",") };
      const sel2 = document.querySelector(".theme-name .icon-select");
      const second = rn()[cur][0];
      if (sel2) { sel2.value = String(target); sel2.dispatchEvent(new Event("change", { bubbles: true })); await wait(300); }
      out.темаСписком = { тема: second, вПриёмнике: rn()[target].at(-1) };

      // 5. вопрос в тему другого раунда через редактор
      cells()[0].click();
      await wait(200);
      const qAnswer = (() => { const r = window.__pack.rounds[cur]; return r.themes[0].questions[0].right[0]; })();
      const mv = [...document.querySelectorAll(".editor select")].find((s) => [...s.options].some((o) => o.value === target + ":0"));
      if (mv) { mv.value = target + ":0"; mv.dispatchEvent(new Event("change", { bubbles: true })); await wait(300); }
      const dq = window.__pack.rounds[target].themes[0].questions;
      out.вопросВДругойРаунд = { ответ: qAnswer, последнийВПриёмнике: dq.at(-1).right[0], цена: dq.at(-1).price, выборСброшен: !document.querySelector(".board-row .cell.selected") };
      return out;
    })()`);

    // 4. свойства пака: окно, логотип из картинок пака
    const props = await win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      document.querySelector(".pack-logo-btn").click();
      await wait(300);
      const box = document.querySelector(".pack-props");
      const thumb = box?.querySelector(".pp-thumbs button");
      thumb?.click();
      await wait(300);
      const diff = box?.querySelectorAll("select")[0];
      if (diff) { diff.value = "4"; diff.dispatchEvent(new Event("change", { bubbles: true })); }
      await wait(200);
      return { окно: !!box, картинок: box?.querySelectorAll(".pp-thumbs button").length ?? 0, attrs: window.__pack.attrs.map(([k, v]) => k + "=" + v.slice(0, 40)) };
    })()`);
    await shotTo("props.png");
    await win.webContents.executeJavaScript(`document.querySelector(".pack-props footer button")?.click()`);
    await new Promise((r) => setTimeout(r, 300));
    await shotTo("board.png");
    console.log("САМОПРОВЕРКА табло:", JSON.stringify({ ...report, свойства: props }, null, 1));
    const moved = report?.послеПеретаскивания;
    const was = report?.доПеретаскивания;
    const dragOk = moved && was && moved[2].split(":")[1] === was[0].split(":")[1] && moved.map((x: string) => x.split(":")[0]).join() === was.map((x: string) => x.split(":")[0]).join();
    const logoOk = (props?.attrs ?? []).some((a: string) => a.startsWith("logo=@"));
    const t4 = report?.темаРучкой;
    const [a0, a1] = String(t4?.темДо ?? "").split("/").map(Number);
    const themeOk = t4?.вПриёмнике === t4?.тема && t4?.темПосле === `${a0 - 1}/${a1 + 1}` && report?.темаСписком?.вПриёмнике === report?.темаСписком?.тема;
    const q5 = report?.вопросВДругойРаунд;
    const qOk = !!q5?.ответ && q5.последнийВПриёмнике === q5.ответ;
    const itog = { перетаскивание: !!dragOk, цена: !!report?.ценаОк, раунд: report?.имяРаунда === "🎢 Разминка", логотип: logoOk, темаВРаунд: themeOk, вопросВРаунд: qOk };
    console.log("ИТОГ:", JSON.stringify(itog));
    if (Object.values(itog).some((v) => !v)) process.exitCode = 1;
  }

  // Медиацентр: открыть, поискать по-настоящему, при --media-get=1 скачать первый результат в пак.
  const mcQuery = arg("media-center");
  if (data && mcQuery) {
    const take = arg("media-get") === "1";
    const type = arg("media-type") ?? "image";
    const result = await win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const byText = (sel, text) => [...document.querySelectorAll(sel)].find((b) => b.textContent.includes(text));
      let open = null;
      for (let i = 0; i < 60 && !open; i++) { await wait(100); open = byText(".file-actions button", "Поиск в интернете"); }
      if (!open) return { ok: false, why: "нет кнопки «Поиск в интернете» в шапке" };
      open.click();
      let q = null;
      for (let i = 0; i < 40 && !q; i++) { await wait(50); q = document.querySelector(".mc-query"); }
      if (!q) return { ok: false, why: "окно медиацентра не открылось" };

      const typeBtn = byText(".mc-types button", ${JSON.stringify({ image: "Картинки", audio: "Звук", video: "Видео" })}[${JSON.stringify(type)}]);
      if (typeBtn) { typeBtn.click(); await wait(100); }

      // Ограничить поиск одним источником: иначе «первая карточка» достаётся тому,
      // кто ответил быстрее, и проверка конкретного сайта превращается в лотерею.
      const onlyTitle = ${JSON.stringify(arg("media-only") ?? "")};
      if (onlyTitle) {
        // список источников приезжает из главного процесса, и в первый миг чипов ещё нет
        let chip = null;
        for (let i = 0; i < 50 && !chip; i++) { await wait(100); chip = byText(".mc-providers .chip-btn", onlyTitle); }
        if (!chip) return { ok: false, why: "нет источника «" + onlyTitle + "» среди доступных" };
        chip.click();
        await wait(150);
      }

      // Потолок качества: задаём его тем же способом, каким это делает человек, —
      // выбором в списке. Значение живёт в localStorage, и старая запись из прошлых
      // прогонов однажды уже подменила 720p на «как есть».
      const wantQ = ${JSON.stringify(arg("media-quality") ?? "")};
      if (wantQ) {
        const sel = document.querySelector(".mc-quality");
        if (!sel) return { ok: false, why: "нет выбора качества (он только для видео)" };
        const sSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        sSetter.call(sel, wantQ);
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        await wait(100);
      }

      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(q, ${JSON.stringify(mcQuery)});
      q.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(80);
      const find = [...document.querySelectorAll(".mc-search button")].find((b) => /Найти|Ищу/.test(b.textContent));
      if (!find) return { ok: false, why: "нет кнопки «Найти»" };
      find.click();

      let cards = [];
      for (let i = 0; i < 200 && !cards.length; i++) { await wait(100); cards = [...document.querySelectorAll(".mc-card")]; }
      const providers = [...document.querySelectorAll(".mc-providers .chip-btn")].map((b) => b.textContent);
      const errs = document.querySelector(".mc-errors")?.textContent ?? "";
      if (!cards.length) return { ok: false, why: "поиск ничего не показал: " + (document.querySelector(".mc-note")?.textContent ?? errs), providers };

      const first = { title: cards[0].querySelector(".mc-title")?.textContent, meta: cards[0].querySelector(".mc-meta")?.textContent };
      // Ширина поля запроса: соседи в строке поиска умеют выжать его до нуля, и тогда
      // искать не во что — при этом ни одна проверка «работает ли поиск» этого не заметит.
      const qw = Math.round(q.getBoundingClientRect().width);
      // Миниатюры: без них плитки — чёрные прямоугольники, и выбирать не по чему.
      // Ждём загрузки честно, потом считаем, сколько картинок реально пришло.
      await wait(3000);
      const imgs = [...document.querySelectorAll(".mc-thumb img")];
      const thumbs = {
        всего: imgs.length,
        загрузилось: imgs.filter((i) => i.naturalWidth > 0).length,
        пример: imgs[0]?.currentSrc || imgs[0]?.src || "",
        размер: imgs[0] ? imgs[0].getBoundingClientRect().height : 0,
      };
      // предпросмотр: щелчок по карточке должен раскрыть нижнюю панель
      cards[0].click();
      await wait(400);
      const preview = !!document.querySelector(".mc-preview");
      const player = !!document.querySelector(".mc-player");
      // «Смотреть рядом»: щелчок по обложке YouTube (итог печатает главный процесс)
      if (${JSON.stringify(arg("watch-near") ?? "")}) {
        document.querySelector(".mc-poster")?.click();
        await wait(8000);
      }

      // Отрезок ролика: заполняем обе границы так же, как это делает человек.
      const wantClip = ${JSON.stringify(arg("media-clip") ?? "")};
      let отрезок = "";
      if (wantClip) {
        const [a, b] = wantClip.split("-");
        const times = [...document.querySelectorAll(".mc-time")];
        if (times.length < 2) return { ok: false, why: "нет полей отрезка (они только у YouTube и Rutube)" };
        const iSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        iSetter.call(times[0], a);
        times[0].dispatchEvent(new Event("input", { bubbles: true }));
        iSetter.call(times[1], b);
        times[1].dispatchEvent(new Event("input", { bubbles: true }));
        await wait(200);
        отрезок = document.querySelector(".mc-clip .muted, .mc-clip .warn")?.textContent ?? "";
        // кнопка должна сама переименоваться — по ней видно, что окно поняло отрезок
        const btn = [...document.querySelectorAll(".mc-preview-side button")].find((b) => /кусок/.test(b.textContent));
        if (!btn) return { ok: false, why: "окно не приняло отрезок: " + отрезок };
      }

      // Порт окна слышен всей машине, поэтому без ключа в пути сервер обязан молчать.
      // Проверяем прямо отсюда: запрос к своему origin политика страницы разрешает.
      let безКлюча = "?";
      try {
        безКлюча = String((await fetch(location.origin + "/")).status);
      } catch (e) {
        безКлюча = "запрос не прошёл: " + e;
      }

      // панель куков — для снимка: открыть той же кнопкой, что нажмёт автор
      let куки = "", маршрут = document.querySelector(".mc-route")?.textContent ?? "";
      if (${JSON.stringify(arg("cookies-panel") ?? "")}) {
        [...document.querySelectorAll(".mc-providers button")].find((b) => b.textContent.includes("куки YouTube"))?.click();
        await wait(500);
        куки = document.querySelector(".mc-cookies .mc-diag-head")?.textContent ?? "панели нет";
      }
      if (!${JSON.stringify(take)}) return { ok: qw >= 200 && безКлюча === "404", куки, маршрут, адресОкна: location.origin, безКлюча, отрезок, поле: qw, count: cards.length, providers, first, preview, player, errs, thumbs };

      // При отрезке жмём кнопку в панели предпросмотра: в карточке её нет, а тайминги
      // живут именно в панели.
      const add = wantClip
        ? [...document.querySelectorAll(".mc-preview-side button")].find((b) => /Скачать/.test(b.textContent))
        : cards[0].querySelector(".mc-actions button.primary");
      if (!add) return { ok: false, why: "у карточки нет кнопки загрузки" };
      add.click();
      let note = "";
      for (let i = 0; i < 600 && !/Успешно скачано|Не скачалось/.test(note); i++) { await wait(100); note = document.querySelector(".mc-note")?.textContent ?? ""; }
      return { ok: /Успешно скачано/.test(note) && qw >= 200, поле: qw, отрезок, маршрут, куки, count: cards.length, providers, first, preview, player, note, errs };
    })()`);
    console.log("САМОПРОВЕРКА медиацентра:", JSON.stringify(result, null, 1));
    // Что показывает встроенный плеер. Страница в чужой iframe заглянуть не может, а главный
    // процесс может: так видно, пустил ли YouTube плеер или просит «подтвердите, что вы не бот».
    if (arg("player-check")) {
      const PLAYER_FRAME = /youtube(-nocookie)?\.com\/embed|rutube\.ru\/play\/embed/;
      let text = "плеер не найден";
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const f = win.webContents.mainFrame.framesInSubtree.find((x) => PLAYER_FRAME.test(x.url));
        if (!f) continue;
        text = String(await f.executeJavaScript(`(() => { const v = document.querySelector("video"); const e = document.querySelector(".ytp-error"); return [location.host, document.title, "html " + document.documentElement.outerHTML.length, v ? "видео есть" : "видео нет", e ? "ошибка: " + e.innerText : "", document.body.innerText].join(" | "); })()`).catch((e: Error) => "не прочитать: " + e.message)).replace(/\s+/g, " ").trim();
        if (text && i >= 8) break;
      }
      // нажать Play и дать поиграть: проверка «не бот» у YouTube срабатывает именно на старте
      const pf = win.webContents.mainFrame.framesInSubtree.find((x) => PLAYER_FRAME.test(x.url));
      if (pf) {
        // Запуск через API самого плеера: у YouTube это #movie_player (без звука — иначе браузер
        // не даст стартовать без жеста), у Rutube — просто <video>. Щелчок мышью из самопроверки
        // до плеера не доходит (окно не в фокусе), а click() по кнопке срабатывает через раз.
        await pf.executeJavaScript(`(() => { const p = document.querySelector("#movie_player"); if (p && p.playVideo) { p.mute(); p.playVideo(); return; } const v = document.querySelector("video"); if (v) { v.muted = true; void v.play(); } })()`).catch(() => undefined);
        await new Promise((r) => setTimeout(r, 7000));
        const played = await pf.executeJavaScript(`(() => { const v = document.querySelector("video"); const e = document.querySelector(".ytp-error"); return (v ? "секунда " + v.currentTime.toFixed(1) + (v.paused ? ", на паузе" : ", играет") : "видео нет") + (e ? " | ошибка: " + e.innerText.replace(/\s+/g, " ") : ""); })()`).catch((e: Error) => "не прочитать: " + e.message);
        console.log("САМОПРОВЕРКА: воспроизведение:", played);
        if (/ошибка|видео нет|секунда 0\.0/.test(String(played))) process.exitCode = 1;
      }
      console.log("САМОПРОВЕРКА: фреймы:", win.webContents.mainFrame.framesInSubtree.map((x) => x.url.slice(0, 120)).join(" ; "));
      console.log("САМОПРОВЕРКА: плеер показывает:", text.slice(0, 300));
      if (/не бот|not a bot|Войдите|Sign in/i.test(text)) process.exitCode = 1;
    }
    if (!result?.ok) process.exitCode = 1;
    // дальше пак мог пополниться — забираем медиа из главного процесса
    if (take) console.log("САМОПРОВЕРКА: медиа в паке после загрузки:", [...doc.media.values()].map((m) => `${m.folder}/${m.name}`).join(", "));
  }

  // Проверка дороги до YouTube прямо в окне: та самая кнопка, которую нажмёт автор.
  // Проверять её отдельно от окна мало: ядро может работать, а панель не показаться.
  if (data && arg("yt-diagnose")) {
    const result = await win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const byText = (sel, text) => [...document.querySelectorAll(sel)].find((b) => b.textContent.includes(text));
      let open = null;
      for (let i = 0; i < 60 && !open; i++) { await wait(100); open = byText(".file-actions button", "Поиск в интернете"); }
      if (!open) return { ok: false, why: "нет кнопки «Поиск в интернете» в шапке" };
      open.click();
      let btn = null;
      for (let i = 0; i < 60 && !btn; i++) { await wait(100); btn = byText(".mc-providers button", "проверить YouTube"); }
      if (!btn) return { ok: false, why: "нет кнопки проверки" };
      btn.click();
      let box = null;
      for (let i = 0; i < 900 && !box; i++) { await wait(100); box = document.querySelector(".mc-diag"); }
      if (!box) return { ok: false, why: "панель проверки не появилась" };
      const steps = [...box.querySelectorAll("div.ok, div.bad")].map((d) => d.textContent.trim());
      const verdict = box.querySelector("b")?.textContent ?? "";
      const advice = box.querySelector(".mc-diag-advice")?.textContent ?? "";
      return { ok: steps.length > 0 && !!verdict, verdict, advice, steps };
    })()`);
    console.log("САМОПРОВЕРКА проверки YouTube:", JSON.stringify(result, null, 1));
    if (!result?.ok) process.exitCode = 1;
  }

  // Библиотека мастерской: список оригиналов, предпросмотр и «в пак» без похода в проводник.
  // Заодно проверяем память о папках: пак открываем через тот же IPC, что и кнопка «Открыть».
  if (arg("library-test")) {
    const packPath = arg("selftest") ?? "";
    const result = await win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const byText = (sel, text) => [...document.querySelectorAll(sel)].find((b) => b.textContent.includes(text));
      // открытие через мост: именно этот путь запоминает папку для следующего раза
      await window.api.openPack(${JSON.stringify(packPath)});
      let open = null;
      for (let i = 0; i < 60 && !open; i++) { await wait(100); open = byText(".file-actions button", "Библиотека"); }
      if (!open) return { ok: false, why: "нет кнопки «Библиотека» в шапке" };
      open.click();
      let grid = null;
      for (let i = 0; i < 60 && !grid; i++) { await wait(100); grid = document.querySelector(".lib-grid"); }
      if (!grid) return { ok: false, why: "окно библиотеки не открылось" };
      await wait(700);
      const cards = [...document.querySelectorAll(".lib-grid .mc-card")];
      const titles = cards.slice(0, 5).map((c) => c.querySelector(".mc-title")?.textContent);
      if (!cards.length) return { ok: true, empty: true, note: document.querySelector(".mc-note")?.textContent ?? "" };

      // Предпросмотр проверяем на видео, если оно есть: у картинки отдать нечего доказывать,
      // а вот ролик идёт потоком с диска, и именно там ломается чаще всего.
      const card = document.querySelector(".lib-grid .mc-card.lib-video") ?? cards[0];
      card.click();
      await wait(600);
      const box = document.querySelector(".mc-preview");
      const player = document.querySelector(".mc-preview video, .mc-preview img, .mc-preview audio");
      // видео обязано отдаться потоком с диска: без этого в панели будет пустой чёрный прямоугольник
      const playable = player && player.tagName === "VIDEO"
        ? await new Promise((done) => {
            if (player.readyState >= 1) return done(true);
            player.addEventListener("loadedmetadata", () => done(true), { once: true });
            player.addEventListener("error", () => done(false), { once: true });
            setTimeout(() => done(player.readyState >= 1), 8000);
          })
        : !!player;

      const add = card.querySelector(".mc-actions button.primary");
      add.click();
      let note = "";
      for (let i = 0; i < 100 && !note; i++) { await wait(100); note = document.querySelector(".mc-note")?.textContent ?? ""; }
      return { ok: !!box && playable && /в паке/.test(note), count: cards.length, titles, проверяли: card.querySelector(".mc-title")?.textContent, preview: !!box, playable, note };
    })()`);
    console.log("САМОПРОВЕРКА библиотеки:", JSON.stringify(result, null, 1));
    if (!result?.ok) process.exitCode = 1;
    // память о папке: её пишет главный процесс, окно о ней ничего не знает
    const settings = await readFile(join(baseDir(), "ui-settings.json"), "utf8").catch(() => "");
    console.log("САМОПРОВЕРКА памяти о папках:", settings.replace(/\s+/g, " ").trim() || "файла нет");
    if (!/lastPackDir/.test(settings)) process.exitCode = 1;
  }

  // Сдвигаемая граница между табло и редактором вопроса.
  if (data && arg("split")) {
    const want = Number(arg("split"));
    const result = await win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      let sp = null;
      for (let i = 0; i < 60 && !sp; i++) { await wait(100); sp = document.querySelector(".splitter"); }
      if (!sp) return { ok: false, why: "нет разделителя" };
      const col = document.querySelector(".editor-col");
      const before = col.getBoundingClientRect().width;
      const x = window.innerWidth - ${JSON.stringify(arg("split"))};
      sp.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: sp.getBoundingClientRect().left }));
      await wait(50);
      window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x }));
      await wait(100);
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      await wait(200);
      const after = col.getBoundingClientRect().width;
      // табло обязано отдать место, а не уехать под редактор
      const board = document.querySelector(".board-wrap").getBoundingClientRect().width;
      return { ok: Math.abs(after - ${JSON.stringify(want)}) < 3 && board > 100, before, after, board };
    })()`);
    // Сохранение проверяем по файлу, а не по окну: ширина теперь лежит на диске, а `window.api.ui` —
    // снимок, сделанный при запуске окна, и о свежей записи он ничего не знает.
    await new Promise((r) => setTimeout(r, 400));
    uiSettings = undefined;
    const saved = (await loadSettings()).editorWidth;
    console.log("САМОПРОВЕРКА границы:", JSON.stringify({ ...result, сохранено: saved }));
    if (!result?.ok || saved !== result.after) process.exitCode = 1;
  }

  // Словарь во вкладке «Картинки»: поле картинки не должно сжиматься, у списка — своя прокрутка.
  if (data && arg("dict-layout")) {
    const r = await win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const byText = (sel, text) => [...document.querySelectorAll(sel)].find((b) => b.textContent.includes(text));
      let open = null;
      for (let i = 0; i < 60 && !open; i++) { await wait(100); open = byText(".file-actions button", "Студия"); }
      open?.click();
      let tab = null;
      for (let i = 0; i < 40 && !tab; i++) { await wait(50); tab = byText(".ws-tabs button", "Картинки"); }
      tab?.click();
      await wait(300);
      byText(".ws-side .ws-gen", "Поговорка")?.click();
      await wait(200);
      const size = (el) => el ? Math.round(el.getBoundingClientRect().width) + "×" + Math.round(el.getBoundingClientRect().height) : null;
      const before = size(document.querySelector(".ig-stage"));
      const toggle = byText(".ws-params button", "Словарь");
      if (!toggle) return { ok: false, why: "нет кнопки «Словарь» (выбран не тот вид?)", presets: [...document.querySelectorAll(".ws-side .ws-gen b")].map((b) => b.textContent) };
      toggle.click();
      let list = null;
      for (let i = 0; i < 50 && !document.querySelector(".pp-item"); i++) await wait(100);
      list = document.querySelector(".prp-list");
      const main = document.querySelector(".ig-main");
      return {
        ok: !!list, до: before, после: size(document.querySelector(".ig-stage")), словарь: size(document.querySelector(".pp")),
        списокПрокручивается: list ? list.scrollHeight > list.clientHeight : null,
        колонкаПрокручивается: main.scrollHeight > main.clientHeight,
      };
    })()`);
    console.log("САМОПРОВЕРКА словаря в «Картинках»:", JSON.stringify(r));
    win.webContents.invalidate();
    await new Promise((res) => setTimeout(res, 400));
    await writeFile(arg("dict-layout")!, (await win.webContents.capturePage()).toPNG());
    if (!r?.ok) process.exitCode = 1;
  }

  // Перенос темы: окно по кнопке ⇄ (для снимка), затем настоящий перенос первой темы в новый пак
  // и дважды в копию пака --theme-into (второй раз — все файлы совпадут по имени и содержимому).
  const ttDir = arg("theme-transfer");
  if (data && ttDir) {
    const ui = await win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      let btn = null;
      for (let i = 0; i < 60 && !btn; i++) { await wait(100); btn = document.querySelector(".theme-name button[title^='Копировать или вырезать']"); }
      if (!btn) return { ok: false, why: "нет кнопки ⇄ у темы" };
      btn.click();
      await wait(300);
      const box = document.querySelector(".theme-transfer");
      return { ok: !!box, text: box?.querySelector("p")?.textContent };
    })()`);
    console.log("САМОПРОВЕРКА переноса темы, окно:", JSON.stringify(ui));
    if (arg("theme-transfer-shot")) {
      win.webContents.invalidate();
      await new Promise((r) => setTimeout(r, 400));
      await writeFile(arg("theme-transfer-shot")!, (await win.webContents.capturePage()).toPNG());
    }
    await win.webContents.executeJavaScript(`document.querySelector(".theme-transfer header button")?.click()`);
    const theme = data.pkg.rounds![0].themes![0];
    await mkdir(ttDir, { recursive: true });
    const report: Record<string, unknown> = { тема: theme.name, файловВТеме: themeMediaRefs(theme).length };
    const fresh = join(ttDir, "новый пак.siq");
    await rm(fresh, { force: true });
    report.новый = await transferTheme(theme, { mode: "new", packName: "Перенос", final: false, path: fresh });
    const into = arg("theme-into");
    if (into) {
      const copy = join(ttDir, "целевой.siq");
      await writeFile(copy, await readFile(into));
      const before = await pickTargetPack(copy);
      report.раз = await transferTheme(theme, { mode: "file", path: copy, round: 0 });
      report.два = await transferTheme(theme, { mode: "file", path: copy, round: -1, roundName: "Перенесённое" });
      const after = await pickTargetPack(copy);
      report.раундыДо = before?.rounds.map((r) => `${r.name}:${r.themes}`).join(", ");
      report.раундыПосле = after?.rounds.map((r) => `${r.name}:${r.themes}`).join(", ");
    }
    // новый пак читаем заново: тема на месте, каждая ссылка находит свой файл
    const check = await openSiq(fresh);
    const names = new Set(check.reader.entries.map((e) => e.name));
    const t = check.pkg.rounds?.[0]?.themes?.[0];
    const lost = t ? themeMediaRefs(t).filter((m) => !names.has(`${m.folder}/${escapeName(m.name)}`)) : [];
    check.reader.close();
    report.проверкаНового = { тема: t?.name, вопросов: t?.questions?.length, битыхСсылок: lost.length };
    console.log("САМОПРОВЕРКА переноса темы:", JSON.stringify(report, null, 1));
    if (!ui?.ok || !t || lost.length) process.exitCode = 1;
  }

  // «Как в игре»: нажать кнопку в редакторе, пройти все экраны и снять кадры по дороге.
  if (data && arg("game-preview")) {
    const js = (code: string) => win.webContents.executeJavaScript(code);
    const snap = async (name: string) => {
      const base = arg("game-preview-shot");
      if (!base) return;
      win.webContents.invalidate();
      await new Promise((r) => setTimeout(r, 300));
      const image = await win.webContents.capturePage();
      await writeFile(base.replace(/\.png$/i, "") + `-${name}.png`, image.toPNG());
    };
    const editor = await js(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      let btn = null;
      for (let i = 0; i < 60 && !btn; i++) { await wait(100); btn = [...document.querySelectorAll(".question-head button")].find((b) => b.textContent.includes("Как в игре")); }
      if (!btn) return { ok: false, why: "нет кнопки «Как в игре»" };
      const links = [...document.querySelectorAll(".editor .link-toggle")].map((b) => b.textContent);
      const groups = document.querySelectorAll(".editor .content-group").length;
      btn.click();
      await wait(300);
      return { ok: !!document.querySelector(".game-preview"), links, groups };
    })()`);
    console.log("САМОПРОВЕРКА «как в игре», редактор:", JSON.stringify(editor));
    if (!editor?.ok) process.exitCode = 1;
    else {
      // ход показа: какой шаг и когда начался (секунды от нажатия)
      const t0 = Date.now();
      const timeline: string[] = [];
      let last = "", shots = 0;
      while (Date.now() - t0 < 150_000) {
        const label: string = await js(`document.querySelector(".game-preview footer span")?.textContent ?? ""`);
        if (label !== last) {
          timeline.push(`${((Date.now() - t0) / 1000).toFixed(1)} с — ${label}`);
          last = label;
          await new Promise((r) => setTimeout(r, 250));
          await snap(String(++shots));
          if (label === "Конец") break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      const end: string = await js(`document.querySelector(".gp-end")?.textContent ?? ""`);
      console.log("САМОПРОВЕРКА «как в игре», ход:\n  " + timeline.join("\n  ") + "\n  итог: " + end);
      if (last !== "Конец") process.exitCode = 1;
    }
  }

  // Студия слов: открыть, подобрать по-настоящему, при --word-create=1 создать тему в паке.
  const wsFrag = arg("word-studio");
  if (data && wsFrag) {
    const create = arg("word-create") === "1";
    const result = await win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const byText = (sel, text) => [...document.querySelectorAll(sel)].find((b) => b.textContent.includes(text));
      let open = null;
      for (let i = 0; i < 60 && !open; i++) { await wait(100); open = byText(".file-actions button", "Студия"); }
      if (!open) return { ok: false, why: "нет кнопки «Студия» в шапке" };
      open.click();
      let params = null;
      for (let i = 0; i < 40 && !params; i++) { await wait(50); params = document.querySelector(".ws-params"); }
      if (!params) return { ok: false, why: "окно студии слов не открылось" };
      let field = document.querySelector(".ws-params input[type=text]");
      // списки генератора по имени поля: --word-args=letter=Х,count=3 (у инициалов текстового поля нет)
      const wordArgs = ${JSON.stringify(arg("word-args") ?? "")};

      // другой генератор, если попросили: выбираем его в списке слева
      const want = ${JSON.stringify(arg("word-gen") ?? "")};
      if (want) {
        const btn = byText(".ws-side .ws-gen", want);
        if (!btn) return { ok: false, why: "нет генератора «" + want + "»" };
        btn.click();
        await wait(300);
        // поле для своего списка может быть скрыто: у анаграмм оно появляется при источнике «свой список»
        field = document.querySelector(".ws-params input[type=text]");
        if (!field) {
          const setSel = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
          for (const sel of document.querySelectorAll(".ws-params select")) {
            if (![...sel.options].some((o) => o.value === "manual")) continue;
            setSel.call(sel, "manual");
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            await wait(300);
            break;
          }
          field = document.querySelector(".ws-params input[type=text]");
        }
        if (!field && !wordArgs) return { ok: false, why: "у генератора «" + want + "» нет текстового поля" };
      }
      if (wordArgs) {
        const setSel = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        for (const pair of wordArgs.split(",")) {
          const [name, value] = pair.split("=");
          const s = document.querySelector('.ws-params select[name="' + name + '"]');
          if (!s || ![...s.options].some((o) => o.value === value)) return { ok: false, why: "нет списка «" + name + "» со значением «" + value + "»" };
          setSel.call(s, value);
          s.dispatchEvent(new Event("change", { bubbles: true }));
          await wait(120);
        }
        field = null;
      }
      // готовый набор Wikidata вместо своего списка: --word-preset=elements
      const preset = ${JSON.stringify(arg("word-preset") ?? "")};
      if (preset) {
        const setSel = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        for (const s of document.querySelectorAll(".ws-params select")) {
          if ([...s.options].some((o) => o.value === "wikidata")) { setSel.call(s, "wikidata"); s.dispatchEvent(new Event("change", { bubbles: true })); await wait(250); }
        }
        for (const s of document.querySelectorAll(".ws-params select")) {
          if ([...s.options].some((o) => o.value === preset)) { setSel.call(s, preset); s.dispatchEvent(new Event("change", { bubbles: true })); await wait(150); break; }
        }
        field = null; // у готового набора своего списка слов нет
      }
      let dicts = "";
      for (let i = 0; i < 40; i++) { dicts = document.querySelector(".word-studio header .muted")?.textContent ?? ""; if (!/не загружены/.test(dicts)) break; await wait(100); }

      if (field) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(field, ${JSON.stringify(wsFrag)});
        field.dispatchEvent(new Event("input", { bubbles: true }));
        await wait(80);
      }
      // словарь со всеми формами: именно в нём живут «пошлю» и «шлюпка»
      const sel = want ? null : document.querySelector(".ws-params select");
      if (sel) {
        const setSel = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
        setSel.call(sel, "forms");
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        await wait(80);
      }
      const t0 = performance.now();
      byText(".ws-params button", "Подобрать")?.click();

      let hits = [];
      for (let i = 0; i < 300 && !hits.length; i++) { await wait(100); hits = [...document.querySelectorAll(".ws-hit b")]; }
      const подборСек = Math.round(performance.now() - t0) / 1000;
      const words = hits.map((b) => b.textContent);
      if (!words.length) return { ok: false, why: document.querySelector(".mc-note")?.textContent ?? "пусто", dicts };
      // Вставка находок в вопросы. Жмём три раза подряд: каждое слово обязано лечь
      // в СВОЙ вопрос. Раньше все три складывались в один — ради этого проверка и заведена.
      if (${JSON.stringify(arg("word-insert") == "1")}) {
        const howMany = ${Number(arg("word-insert-times")) || 3};
        // У инициалов и матрицы (генератор по умолчанию) текст вопроса пишет автор: вставка ставит
        // только ответ, и проверять надо, что прежний текст вопроса остался как был.
        // Загадку в текст кладут только анаграммы.
        const answerOnly = !/Анаграм/.test(want);
        const textsOf = (q) => (q?.params ?? []).flatMap((x) => (x.children ?? []).map((c) => c.item?.value));
        const before = (window.__pack?.rounds?.[0]?.themes?.[0]?.questions ?? []).map((q) => JSON.stringify(textsOf(q)));
        const put = [];
        for (let n = 0; n < howMany; n++) {
          const row = document.querySelectorAll(".ws-hit")[n];
          const ins = row?.querySelector(".ws-insert");
          if (!ins) return { ok: false, why: "нет кнопки «→ в вопрос» (не выбран вопрос на табло?)", dicts, count: words.length };
          put.push({ word: row.querySelector("b")?.textContent, puzzle: row.querySelector(".ws-puzzle, .muted")?.textContent });
          ins.click();
          await wait(400);
        }
        const questions = window.__pack?.rounds?.[0]?.themes?.[0]?.questions ?? [];
        // первая вставка идёт в выбранный вопрос (второй в теме), дальше по одному вперёд
        const landed = put.map((p, n) => {
          const q = questions[1 + n];
          const texts = textsOf(q);
          const текстНаМесте = answerOnly ? JSON.stringify(texts) === before[1 + n] : texts.includes(p.puzzle);
          return { ждали: p.word, ответ: q?.right?.[0], текстНаМесте, всегоТекстов: texts.filter(Boolean).length };
        });
        return {
          ok: landed.every((l) => l.ответ === l.ждали && l.текстНаМесте && (answerOnly || l.всегоТекстов === 1)),
          dicts, count: words.length, вставки: landed,
        };
      }

      if (!${JSON.stringify(create)}) return { ok: true, dicts, подборСек, count: words.length, words: words.slice(0, 12) };

      byText(".mc-foot button", "Создать тему")?.click();
      await wait(600);
      const themes = window.__pack?.rounds?.[0]?.themes ?? [];
      const last = themes[themes.length - 1];
      const made = last?.questions?.length ?? 0;
      const prices = themes[0]?.questions?.length ?? 0;
      // тема встаёт по числу цен раунда, а не по числу найденных слов
      const answers = (last?.questions ?? []).map((q) => q.right?.[0]);
      return {
        ok: !!last && made > 0 && made === Math.min(words.length, prices) && answers.every((a) => words.includes(a)),
        dicts, count: words.length, words: words.slice(0, 12),
        theme: last && {
          name: last.name, questions: made, pricesInRound: prices, answers: answers.slice(0, 8),
          // текст первого вопроса: у анаграмм здесь должны стоять перемешанные буквы
          firstQuestion: last.questions?.[0]?.params?.[0]?.children?.[0]?.item?.value,
        },
      };
    })()`);
    console.log("САМОПРОВЕРКА студии слов:", JSON.stringify(result, null, 1));
    if (!result?.ok) process.exitCode = 1;
  }

  // Свои пресеты картинок: «Свой промпт» → пресет-шаблон → подстановка фразы → инструкция → удаление.
  // Пресеты пишутся в baseDir(): запускать с PORTABLE_EXECUTABLE_DIR на временную папку, чтобы не трогать настоящие.
  const presetShot = arg("preset-test");
  if (data && presetShot) {
    const shot = async (name: string) => writeFile(presetShot.replace(/\.png$/i, `-${name}.png`), (await win.webContents.capturePage()).toPNG());
    const js = (code: string) => win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const byText = (sel, text) => [...document.querySelectorAll(sel)].find((b) => b.textContent.includes(text));
      const type = (el, v) => {
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      ${code}
    })()`);
    const steps: Record<string, unknown> = {};
    const fail = (why: string) => { steps.why = why; return false; };
    const ok = await (async () => {
      const opened = await js(`
        let btn = null;
        for (let i = 0; i < 60 && !btn; i++) { await wait(100); btn = document.querySelector(".tb-studio") ?? byText(".file-actions button", "Студия"); }
        if (!btn) return "нет кнопки «Студия»";
        btn.click();
        let tab = null;
        for (let i = 0; i < 40 && !tab; i++) { await wait(50); tab = byText(".ws-tabs button", "Картинки"); }
        if (!tab) return "нет вкладки «Картинки»";
        tab.click();
        await wait(300);
        byText(".ws-side .ws-gen", "Свой промпт")?.click();
        await wait(150);
        type(document.querySelector(".ig-phrase input"), "кот");
        await wait(50);
        type(document.querySelector(".ig-prompt textarea"), "a fat кот sitting on a golden throne made of fish");
        await wait(100);
        const save = byText(".ig-preset-tools button", "Сохранить как пресет");
        if (!save) return "нет «Сохранить как пресет»";
        save.click();
        await wait(200);
        return document.querySelector(".pe textarea")?.value ?? "редактор не открылся";
      `);
      steps.шаблон = opened;
      if (opened !== "a fat {фраза} sitting on a golden throne made of fish") return fail(`шаблон: ${opened}`);
      await shot("1-шаблон");
      steps.сохранён = await js(`
        type(document.querySelector(".pe input"), "Тест-пресет");
        await wait(50);
        byText(".pe-bar button", "Сохранить")?.click();
        await wait(400);
        const own = document.querySelector(".ws-gen.own.sel");
        if (!own) return "в колонке нет выбранного своего пресета";
        type(document.querySelector(".ig-phrase input"), "пёс");
        await wait(50);
        byText(".ig-prompt button", "Другая сцена")?.click();
        for (let i = 0; i < 30 && !document.querySelector(".ig-prompt textarea").value; i++) await wait(100);
        return own.textContent + " → " + document.querySelector(".ig-prompt textarea").value;
      `);
      if (!/Тест-пресет.*a fat пёс sitting on a golden throne made of fish No text/.test(String(steps.сохранён))) return fail("подстановка фразы");
      await shot("2-пресет");
      steps.инструкция = await js(`
        byText(".ig-preset-tools button", "Настроить")?.click();
        await wait(200);
        byText(".pe button", "Сделать инструкцией")?.click();
        await wait(150);
        const d = document.querySelector(".pe-final");
        if (d) d.open = true;
        await wait(100);
        return document.querySelector(".pe-final pre")?.textContent ?? "нет итоговой инструкции";
      `);
      if (!String(steps.инструкция).includes("«кот» → a fat кот sitting")) return fail("инструкция из шаблона");
      await shot("3-инструкция");
      steps.удалён = await js(`
        byText(".pe-bar button", "Отмена")?.click();
        await wait(150);
        byText(".ig-preset-tools button", "Настроить")?.click();
        await wait(200);
        byText(".pe-bar button", "Удалить пресет")?.click();
        await wait(100);
        byText(".pe-bar button", "Да, удалить")?.click();
        await wait(400);
        return !document.querySelector(".ws-gen.own");
      `);
      if (steps.удалён !== true) return fail("пресет не удалился");
      steps.встроенный = await js(`
        byText(".ws-side .ws-gen", "детскому")?.click();
        await wait(150);
        byText(".ig-preset-tools button", "Настроить")?.click();
        await wait(200);
        return document.querySelectorAll(".pe-pair").length;
      `);
      await shot("4-встроенный");
      return true;
    })();
    console.log("САМОПРОВЕРКА своих пресетов:", JSON.stringify({ ok, ...steps }, null, 1));
    if (!ok) process.exitCode = 1;
  }

  // Подсказки фильмов (Wikidata): набрать начало названия, снять список, выбрать первый с клавиатуры.
  if (data && arg("works-test")) {
    const open = await win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const byText = (sel, text) => [...document.querySelectorAll(sel)].find((b) => b.textContent.includes(text));
      let btn = null;
      for (let i = 0; i < 60 && !btn; i++) { await wait(100); btn = document.querySelector(".tb-studio") ?? byText(".file-actions button", "Студия"); }
      if (!btn) return { ok: false, why: "нет кнопки «Студия» в шапке" };
      btn.click();
      let tab = null;
      for (let i = 0; i < 40 && !tab; i++) { await wait(50); tab = byText(".ws-tabs button", "Картинки"); }
      if (!tab) return { ok: false, why: "нет вкладки «Картинки»" };
      tab.click();
      await wait(300);
      const other = ${JSON.stringify(arg("works-preset") ?? "")};
      byText(".ws-side .ws-gen", other || "детскому")?.click();
      await wait(150);
      const field = document.querySelector(".ig-phrase input");
      if (!field) return { ok: false, why: "нет поля фразы" };
      // другой стиль — только снимок строки с полем (подсказок там нет)
      if (other) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, ${JSON.stringify(arg("works-query") ?? "")});
        field.dispatchEvent(new Event("input", { bubbles: true }));
        await wait(300);
        const r = (el) => el && el.getBoundingClientRect();
        const [a, b] = [r(field), r(byText(".ws-params button", "Словарь"))];
        return { ok: true, only: true, поле: a && [a.top, a.bottom], словарь: b && [b.top, b.bottom] };
      }
      field.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, ${JSON.stringify(arg("works-query") ?? "Солнцестоя")});
      field.dispatchEvent(new Event("input", { bubbles: true }));
      let items = [];
      // первый запрос к Wikidata на холодную бывает небыстрым
      const t0 = performance.now();
      for (let i = 0; i < 250 && !items.length; i++) { await wait(100); items = [...document.querySelectorAll(".ig-works li")]; }
      if (!items.length) {
        const direct = await window.api.worksSearch(field.value).then((r) => r.length + " шт.", (e) => String(e.message));
        return { ok: false, why: "подсказки не появились", фраза: field.value, стиль: document.querySelector(".ws-side .ws-gen.sel")?.textContent, напрямую: direct, фокус: document.activeElement === field };
      }
      return { ok: true, подсказки: items.map((li) => li.textContent), сек: Math.round(performance.now() - t0) / 1000 };
    })()`);
    if (open?.ok) await writeFile(arg("works-test")!, (await win.webContents.capturePage()).toPNG());
    const picked = !open?.ok || open.only ? open : await win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const field = document.querySelector(".ig-phrase input");
      const key = (k) => field.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
      key("ArrowDown"); await wait(80); key("Enter"); await wait(300);
      return {
        ok: !document.querySelector(".ig-works") && !!document.querySelector(".ig-chosen"),
        подсказки: ${JSON.stringify(open?.подсказки ?? [])},
        сек: ${JSON.stringify(open?.сек ?? null)},
        фраза: field.value,
        выбрано: document.querySelector(".ig-chosen")?.textContent,
      };
    })()`);
    if (picked?.ok) await writeFile(arg("works-test")!.replace(/\.png$/i, "-выбран.png"), (await win.webContents.capturePage()).toPNG());
    console.log("САМОПРОВЕРКА подсказок фильмов:", JSON.stringify(picked, null, 1));
    if (!picked?.ok) process.exitCode = 1;
  }

  // Генерация картинок: студия слов → «Картинки» → фраза → нарисовать по-настоящему → в вопрос.
  // Выбран второй вопрос первой темы (так ставит onSelfTestLoad): картинка и ответ должны лечь туда.
  const igPhrase = arg("imagegen-test");
  if (data && igPhrase) {
    const result = await win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const byText = (sel, text) => [...document.querySelectorAll(sel)].find((b) => b.textContent.includes(text));
      let open = null;
      for (let i = 0; i < 60 && !open; i++) { await wait(100); open = byText(".file-actions button", "Студия"); }
      if (!open) return { ok: false, why: "нет кнопки «Студия» в шапке" };
      open.click();
      let tab = null;
      for (let i = 0; i < 40 && !tab; i++) { await wait(50); tab = byText(".ws-tabs button", "Картинки"); }
      if (!tab) return { ok: false, why: "нет вкладки «Картинки»" };
      tab.click();
      await wait(300);
      const preset = ${JSON.stringify(arg("imagegen-preset") ?? "")};
      if (preset) { byText(".ws-side .ws-gen", preset)?.click(); await wait(150); }
      const field = document.querySelector(".ig-phrase input");
      if (!field) return { ok: false, why: "нет поля фразы" };
      let dictInfo = null;
      if (${JSON.stringify(igPhrase)} === "словарь") {
        // фраза из словаря: открыть его, включить помету «шутливое» и взять случайную
        byText(".ws-params button", "Словарь")?.click();
        let items = [];
        for (let i = 0; i < 50 && !items.length; i++) { await wait(100); items = document.querySelectorAll(".pp-item"); }
        if (!items.length) return { ok: false, why: document.querySelector(".pp")?.textContent ?? "словарь не открылся" };
        const total = document.querySelector(".pp-styles > .muted")?.textContent;
        byText(".pp-chip", "шутливое")?.click();
        await wait(150);
        byText(".pp-filters button", "Случайная")?.click();
        await wait(150);
        dictInfo = { всего: total, шутливых: document.querySelector(".pp-styles > .muted")?.textContent, фраза: field.value };
        if (!field.value) return { ok: false, why: "«Случайная» не поставила фразу", dictInfo };
      } else {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, ${JSON.stringify(igPhrase)});
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await wait(80);
      const t0 = performance.now();
      byText(".ws-params button", "Нарисовать")?.click();
      let img = null;
      for (let i = 0; i < 1800 && !img; i++) {
        await wait(100);
        img = document.querySelector(".ig-stage img");
        if (!img && /не получилось|не нарисовалось/i.test(document.querySelector(".mc-note")?.textContent ?? "")) break;
        if (!img && document.querySelector(".ig-paid")) break;
      }
      const prompt = document.querySelector(".ig-prompt textarea")?.value;
      const quota = [...document.querySelectorAll(".ig-quota > div")].map((d) => d.textContent);
      const paid = document.querySelector(".ig-paid")?.textContent;
      // бесплатные исчерпаны и окно предложило платную — это правильное поведение, а не сбой
      if (!img && paid) return { ok: true, платнаяПредложена: paid, note: document.querySelector(".mc-note")?.textContent, quota, prompt };
      if (!img) return { ok: false, why: document.querySelector(".mc-note")?.textContent ?? "картинки нет", prompt };
      const сек = Math.round(performance.now() - t0) / 1000;
      const model = document.querySelector(".ig-actions .muted")?.textContent;
      if (${JSON.stringify(arg("imagegen-again") === "1")}) {
        // «Ещё вариант» обязан дать другую картинку: у sd-server без seed выходила та же до пикселя
        const first = img.src;
        byText(".ig-actions button", "Ещё вариант")?.click();
        let second = first;
        for (let i = 0; i < 1800 && second === first; i++) { await wait(100); second = document.querySelector(".ig-stage img")?.src ?? first; }
        if (second === first) return { ok: false, why: "«Ещё вариант» вернул ту же картинку", prompt };
      }
      if (${JSON.stringify(arg("hold") === "1")}) return { ok: true, сек, model, prompt, dictInfo };
      const ins = byText(".ig-actions button", "В вопрос");
      if (!ins) return { ok: false, why: "нет кнопки «В вопрос» (не выбран вопрос?)", prompt };
      ins.click();
      await wait(800);
      const q = window.__pack?.rounds?.[0]?.themes?.[0]?.questions?.[1];
      const items = (q?.params ?? []).flatMap((x) => (x.children ?? []).map((c) => c.item)).filter(Boolean);
      const pic = items.find((it) => it.type === "image" && it.isRef === "True" && it.value.startsWith(${JSON.stringify(igPhrase)}));
      return { ok: !!pic && q?.right?.[0] === ${JSON.stringify(igPhrase)}, сек, model, prompt, картинка: pic?.value, ответ: q?.right?.[0] };
    })()`);
    console.log("САМОПРОВЕРКА генерации картинок:", JSON.stringify(result, null, 1));
    if (!result?.ok) process.exitCode = 1;
  }

  // Настройки ИИ: открыть из шапки, дождаться остатков, при --ai-select выбрать сервис, при --ai-tab=queues — очереди.
  if (data && arg("ai-settings")) {
    const result = await win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const byText = (sel, text) => [...document.querySelectorAll(sel)].find((b) => b.textContent.includes(text));
      let open = null;
      for (let i = 0; i < 60 && !open; i++) { await wait(100); open = byText(".file-actions button", "ИИ"); }
      if (!open) return { ok: false, why: "нет кнопки «⚙ ИИ» в шапке" };
      open.click();
      let refresh = null;
      for (let i = 0; i < 300; i++) { await wait(100); refresh = byText(".ai-settings header button", "Остатки"); if (refresh && !refresh.disabled) break; }
      const want = ${JSON.stringify(arg("ai-select") ?? "")};
      if (want) { byText(".ai-settings .ws-gen", want)?.click(); await wait(300); }
      if (${JSON.stringify(arg("ai-tab") ?? "")} === "queues") { byText(".ai-settings .ws-tabs button", "Очереди")?.click(); await wait(300); }
      const services = [...document.querySelectorAll(".ai-settings .ws-gen")].map((b) => b.textContent);
      // ключей в окне быть не должно: только «…xxxx»
      const leaked = [...document.querySelectorAll(".ai-settings input")].some((i) => i.value.length > 20 && /^[A-Za-z0-9_-]{20,}$/.test(i.value) && i.type === "password");
      return { ok: services.length > 0 && !leaked, services, quota: document.querySelector(".ai-quota")?.textContent, leaked };
    })()`);
    console.log("САМОПРОВЕРКА настроек ИИ:", JSON.stringify(result, null, 1));
    if (!result?.ok) process.exitCode = 1;
  }

  if (data && arg("edit-theme")) {
    await new Promise((r) => setTimeout(r, 1200));
    await win.webContents.executeJavaScript(`document.querySelector(".theme-name .theme-title")?.click()`);
  }
  // «📋 Из Claude»: окно по кнопке с текстом из файла (буфер автора не трогаем), ждём поиск
  // в Яндексе, снимок, «Вставить» — и печатаем, что встало в пак.
  const propFile = arg("proposals");
  if (data && propFile) {
    const json = await readFile(propFile, "utf8");
    const js = <T,>(code: string): Promise<T> => win.webContents.executeJavaScript(code);
    const ui = await js<{ ok: boolean; rows?: string[]; why?: string }>(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      window.__proposalsText = ${JSON.stringify(json)};
      let btn = null;
      for (let i = 0; i < 60 && !btn; i++) { await wait(100); btn = [...document.querySelectorAll(".topbar button")].find((b) => b.textContent.includes("Вставить из AI")); }
      if (!btn) return { ok: false, why: "нет кнопки «Вставить из AI»" };
      btn.click();
      for (let i = 0; i < 600; i++) {
        await wait(100);
        const box = document.querySelector(".proposals-paste");
        if (box && box.querySelector(".prp-list") && !box.textContent.includes("ищу…")) break;
      }
      const box = document.querySelector(".proposals-paste");
      if (!box) return { ok: false, why: "окно не открылось" };
      const err = box.querySelector(".tt-error")?.textContent;
      const rows = [...box.querySelectorAll(".prp-q")].map((q) => q.textContent.replace(/\\s+/g, " ").trim());
      // список не должен уезжать вбок: строки идут столбиком во всю ширину окна
      const list = box.querySelector(".prp-list");
      const wide = list ? list.scrollWidth > list.clientWidth + 2 : false;
      return { ok: !err && !wide, rows, why: err || (wide ? "список шире окна" : undefined) };
    })()`);
    console.log("САМОПРОВЕРКА «Из Claude», план:", JSON.stringify(ui, null, 1));
    if (arg("proposals-shot")) {
      win.webContents.invalidate();
      await new Promise((r) => setTimeout(r, 1500));
      await writeFile(arg("proposals-shot")!, (await win.webContents.capturePage()).toPNG());
    }
    const done = await js<{ ok: boolean; status?: string }>(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const go = document.querySelector(".proposals-paste footer button.primary");
      if (!go || go.disabled) { document.querySelector(".proposals-paste header button.icon")?.click(); return { ok: false, status: "нечего вставлять" }; }
      window.alert = (m) => console.log("alert:", m);
      go.click();
      for (let i = 0; i < 1200 && document.querySelector(".proposals-paste"); i++) await wait(100);
      await wait(300);
      return { ok: !document.querySelector(".proposals-paste"), status: document.querySelector(".topbar .status")?.textContent };
    })()`);
    console.log("САМОПРОВЕРКА «Из Claude», вставка:", JSON.stringify(done));
    if (!ui?.ok || !done?.ok) process.exitCode = 1;
  }

  if (copy && uiTest && data) {
    // состояние из окна: после правок в интерфейсе оно свежее нашей копии. Не вышло — сохраняем своё.
    let pkg = data.pkg;
    try { pkg = (await win.webContents.executeJavaScript("JSON.parse(JSON.stringify(window.__pack))")) ?? pkg; }
    catch (e) { console.error("САМОПРОВЕРКА: пак из окна не забрался,", (e as Error).message); }
    data = await savePack(pkg, false, copy);
  }

  // --editor-width=N: протянуть границу между табло и редактором мышью, как это сделал бы автор,
  // и напечатать, какую раскладку выбрало табло и не вылезло ли оно за край.
  // --theme=<id>: показать окно в другой теме только на время самопроверки (в настройки не пишется)
  const themeArg = arg("theme");
  if (shot && themeArg) {
    await win.webContents.executeJavaScript(`(() => {
      const t = ${JSON.stringify(themeArg)};
      if (t === "dark") delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = t;
      // и в переключателе — иначе на снимке тема одна, а в списке сохранённая у автора
      const sel = document.querySelector(".theme-switch select");
      if (sel) sel.value = t;
    })()`);
  }
  // --css=<файл>: подмешать предложение по оформлению (design/proposal.css) только на время снимка — «до/после»
  // снимаются одной сборкой, styles.css не трогаем, пока автор не одобрит
  const cssArg = arg("css");
  if (shot && cssArg) await win.webContents.insertCSS(await readFile(cssArg, "utf8"));
  // --win-width=N: снимок при другой ширине окна (шапка в узком окне); minWidth на время снимаем
  const ww = Number(arg("win-width"));
  if (shot && ww) {
    win.setMinimumSize(Math.min(ww, 1100), 700);
    win.setSize(ww, win.getSize()[1]);
    await new Promise((r) => setTimeout(r, 400));
  }
  // --menus=1: открыть меню «Файл» и показать кнопки последней темы (первую закрывает меню) — проверить, что всплывающее не просвечивает
  if (shot && arg("menus")) {
    await win.webContents.executeJavaScript(`(async () => {
      document.querySelector(".tb-menu > button")?.click();
      const t = [...document.querySelectorAll(".theme-name .theme-tools")].pop();
      if (t) { t.style.opacity = "1"; t.style.pointerEvents = "auto"; t.querySelectorAll("select").forEach((s) => { s.style.opacity = "1"; }); }
      await new Promise((r) => setTimeout(r, 300));
    })()`);
  }
  // --undo-test=1 (вместе с --rename-theme): Ctrl+Z возвращает прежнее название темы, Ctrl+Y — новое
  if (arg("undo-test")) {
    const r = await win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const name = () => window.__pack?.rounds?.[0]?.themes?.[0]?.name;
      document.activeElement?.blur();
      await wait(900);
      const before = name();
      const key = (k) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, ctrlKey: true, bubbles: true }));
      key("z"); await wait(200);
      const undone = name();
      key("y"); await wait(200);
      return { before, undone, redone: name() };
    })()`);
    console.log("САМОПРОВЕРКА отмены:", JSON.stringify(r));
    if (r.undone === r.before || r.redone !== r.before) process.exitCode = 1;
  }
  // --pack-check=1: открыть «Проверку пака» кнопкой в шапке и напечатать найденное
  if (shot && arg("pack-check")) {
    const r = await win.webContents.executeJavaScript(`(async () => {
      [...document.querySelectorAll(".topbar button")].find((b) => b.title.startsWith("Проверить пак"))?.click();
      await new Promise((r) => setTimeout(r, 400));
      // --dup-check=1: ещё нажать «Найти повторы» и дождаться ответа сервера (до 40 с)
      if (${JSON.stringify(Boolean(arg("dup-check")))}) {
        [...document.querySelectorAll(".pc-dups button")].find((b) => b.textContent === "Найти повторы")?.click();
        await new Promise((r) => setTimeout(r, 200));
        for (let i = 0; i < 80 && document.querySelector(".pc-dups button[disabled]"); i++) await new Promise((r) => setTimeout(r, 500));
        await new Promise((r) => setTimeout(r, 300));
      }
      return [...document.querySelectorAll(".pc-list li, .pc-dups p")].map((li) => li.textContent);
    })()`);
    console.log("САМОПРОВЕРКА проверки пака:", JSON.stringify(r));
  }
  const ew = Number(arg("editor-width"));
  if (shot && ew) {
    const r = await win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const sp = document.querySelector(".splitter");
      if (!sp) return { ok: false, why: "нет границы" };
      sp.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: sp.getBoundingClientRect().x }));
      await wait(50);
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: window.innerWidth - ${ew} }));
      await wait(50);
      window.dispatchEvent(new MouseEvent("mouseup", {}));
      await wait(600);
      const wrap = document.querySelector(".board-wrap");
      const board = document.querySelector(".board");
      return {
        раскладка: board?.className, редактор: document.querySelector(".editor-col")?.getBoundingClientRect().width,
        табло: wrap?.clientWidth, прокруткаВбок: wrap ? wrap.scrollWidth > wrap.clientWidth + 1 : null,
        клетка: getComputedStyle(board).getPropertyValue("--cell-w"),
      };
    })()`);
    console.log("САМОПРОВЕРКА ширины редактора:", JSON.stringify(r));
  }

  // «🧩 Компоненты»: открыть кнопкой, дождаться проверки системы, напечатать, что видно (снимок — через --shot)
  if (data && arg("components-panel")) {
    const seen = await win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const btn = [...document.querySelectorAll(".topbar button")].find((b) => (b.title || "").startsWith("Компоненты"));
      if (!btn) return { ok: false, why: "нет кнопки «Компоненты»" };
      btn.click();
      for (let i = 0; i < 150 && !document.querySelector(".components-panel .cmp-grid"); i++) await wait(100);
      await wait(300);
      const box = document.querySelector(".components-panel");
      if (!box) return { ok: false, why: "окно не открылось" };
      const wide = box.scrollWidth > box.clientWidth + 2;
      return {
        ok: !!box.querySelector(".cmp-grid") && !wide,
        machine: box.querySelector(".cmp-grid")?.innerText.replace(/\\s+/g, " "),
        profiles: [...box.querySelectorAll(".cmp-profile")].map((p) => p.innerText.replace(/\\s+/g, " ")),
        installed: box.querySelector(".cmp-installed")?.innerText.replace(/\\s+/g, " "),
        button: box.querySelector(".cmp-actions button")?.textContent,
        why: wide ? "окно шире экрана" : undefined,
      };
    })()`);
    console.log("САМОПРОВЕРКА «Компоненты»:", JSON.stringify(seen, null, 1));
  }

  if (shot) {
    // Миниатюры грузятся из сети уже после того, как разметка готова. Двух с половиной секунд
    // хватает на разметку, но не на три десятка картинок — для них есть --shot-delay.
    await new Promise((r) => setTimeout(r, Number(arg("shot-delay")) || 2500));
    // Первый кадр бывает устаревшим: просим перерисовать и снимаем ещё раз.
    // Снимок иногда падает с UnknownVizError — окно ещё не отдало композитору кадр,
    // поэтому пробуем несколько раз, а не сдаёмся с первой попытки.
    let saved = false;
    for (let attempt = 1; attempt <= 5 && !saved; attempt++) {
      try {
        win.webContents.invalidate();
        await new Promise((r) => setTimeout(r, 400));
        const image = await win.webContents.capturePage();
        if (image.isEmpty()) throw new Error("пустой кадр");
        await writeFile(shot, image.toPNG());
        saved = true;
      } catch (e) {
        console.error(`САМОПРОВЕРКА: снимок не вышел с попытки ${attempt}: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    if (!saved) console.error("САМОПРОВЕРКА: снимок окна сделать не удалось");
  }
  app.quit();
}

prepareQuietSelfTest();

app.whenReady().then(async () => {
  // сплэш — как можно раньше, до тяжёлой инициализации; в самопроверках и тихих режимах не показываем
  const splash = SELF_TEST ? null : showSplash();
  // настройки читаем до окна: окно спрашивает их синхронно, в первом же кадре
  await loadSettings();
  setComponentsDirOverride(uiSettings?.componentsDir);
  setLaunchBase(componentsDir);
  // настройка «ffmpeg» живёт в media-providers.json: прочитать до первого обращения окна к медиа
  await loadProviderConfig();
  registerIpc();
  registerMediaProtocol();
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: "Ye!Studio",
    backgroundColor: "#0b1020",
    autoHideMenuBar: true,
    // самопроверка: окно не выскакивает и не отнимает фокус (см. quietWindow.ts);
    // в обычном режиме окно ждёт готовности и показывается вместе с закрытием сплэша
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      backgroundThrottling: !SELF_TEST,
    },
  });
  if (SELF_TEST) showQuietly(win);
  else if (splash) win.once("ready-to-show", () => closeSplash(win!));
  else win.once("ready-to-show", () => win!.show());
  // Закрытие с несохранёнными правками: спросить, как в Word. Без этого пак молча терялся.
  win.on("close", (e) => {
    if (!packDirty || closeConfirmed || SELF_TEST) return;
    e.preventDefault();
    void askSaveBeforeClose();
  });
  // ---------- обновления ----------
  initUpdater(win, confirmBeforeUpdate);
  // ---------- связь с сервером автора ----------
  // Выключение и отчёты об ошибках стартуют после показа окна и не трогают самопроверки.
  if (!SELF_TEST) win.once("show", () => initRemote(win!));
  // yt-dlp стареет быстрее приложения (YouTube ломает старые версии): раз в неделю тихо обновляем его сами.
  // Через минуту после старта, чтобы не мешать запуску; ошибки (нет сети) молча ждут следующего раза.
  if (!SELF_TEST) setTimeout(() => {
    void (async () => {
      if (installAbort || !(await ytdlpCheckDue(componentsDir()))) return;
      if ((await selfUpdateYtdlp(componentsDir())).changed) toolsChanged();
    })().catch(() => {});
  }, 60_000);
  // Ссылки, которые страница пытается открыть новым окном (кнопка «Войти» во встроенном плеере
  // YouTube, «Смотреть на YouTube»), уходят в настоящий браузер. Раньше открывалось голое окно
  // Electron, и Google отказывал во входе: из встроенных браузеров он не пускает намеренно.
  // На вход вдобавок показываем инструкцию про куки — войти нужно не в окне, а загрузчику.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/accounts\.google\.com|ServiceLogin|youtube\.com\/(signin|login)/i.test(url)) win?.webContents.send("yt:login");
    else if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  // Окно грузится по http с локального сервера, а не из файла: страница на file:// не имеет
  // origin, и встроенный плеер YouTube приходит к сайту без «откуда я» — отсюда «видео
  // недоступно» с кодом 150/152/153. В разработке окно и так отдаёт Vite по http.
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void startRendererServer(join(__dirname, "../renderer"))
      .then((srv) => {
        rendererServer = srv;
        return win!.loadURL(srv.url);
      })
      .catch((e: Error) => {
        // сервер не поднялся — лучше открыть окно из файла, чем не открыть вовсе
        console.error("локальный сервер окна не поднялся:", e.message);
        return win!.loadFile(join(__dirname, "../renderer/index.html"));
      });
  }

  // Встроенный плеер YouTube и откуда берётся «ошибка 153».
  //
  // Собранное приложение открывает окно как file://, поэтому встроенный плеер приходит к YouTube
  // без Referer и с Origin: null. Часть роликов на это отвечает отказом с кодом 150/153 —
  // тем же, каким отвечает на показ у запретившего владельца, и отличить одно от другого в окне
  // нельзя. Referer мы подставляем честный — адрес самой страницы ролика на YouTube;
  // запрет владельца этим не обходится, он остаётся в силе.
  void forgetYoutubeLoginInWindow();
  void syncWindowRoute();
  // куки из окна входа освежаем при запуске и раз в час; самопроверки аккаунт автора не трогают
  if (!SELF_TEST) {
    setTimeout(() => void refreshAutoCookies().catch(() => undefined), 15_000);
    setInterval(() => void refreshAutoCookies().catch(() => undefined), 60 * 60_000);
  }
  win.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ["https://*.youtube.com/*", "https://*.youtube-nocookie.com/*", "https://*.ytimg.com/*"] },
    (details, done) => {
      const headers = { ...details.requestHeaders };
      if (!headers.Referer) headers.Referer = "https://www.youtube.com/";
      done({ requestHeaders: headers });
    },
  );

  const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  if (arg("system-probe")) {
    // проверка системы без окна: печатает, что нашлось, и какой профиль модели подходит
    void loadProviderConfig()
      .then((providerCfg) => probeSystem({ componentsDir: componentsDir(), providerCfg }))
      .then((r) => console.log("САМОПРОВЕРКА системы:", JSON.stringify(r, null, 1)))
      .catch((e) => { console.error("САМОПРОВЕРКА системы упала:", e); process.exitCode = 1; })
      .finally(() => app.quit());
  }
  if (arg("yt-login-test")) {
    void syncWindowRoute()
      .then(() => probeLoginPage(arg("yt-login-shot")))
      .then((r) => console.log("САМОПРОВЕРКА окна входа:", JSON.stringify(r, null, 1)))
      .catch((e) => { console.error("САМОПРОВЕРКА окна входа упала:", e); process.exitCode = 1; })
      .finally(() => app.quit());
  }
  if (arg("first-run") || arg("assistant-setup") || arg("shot") || arg("save-copy") || arg("rename-theme") || arg("ai-settings") || arg("imagegen-test") || arg("works-test") || arg("preset-test") || arg("image-test") || arg("collage-test") || arg("media-center") || arg("word-studio") || arg("split") || arg("yt-diagnose") || arg("library-test") || arg("game-preview") || arg("theme-transfer") || arg("dict-layout") || arg("proposals") || arg("board-test") || arg("point-test") || arg("pixelate-test") || arg("pixelate-theme") || arg("silhouette-test") || arg("logo-test") || arg("pack-size") || arg("poster")) void selfTest(win, arg).catch((e) => {
    // иначе окно висит молча и самопроверку приходится убивать руками
    console.error("САМОПРОВЕРКА УПАЛА:", e);
    process.exitCode = 1;
    app.quit();
  });
});

app.on("window-all-closed", () => app.quit());
// порт не должен пережить окно ни на секунду
app.on("will-quit", () => {
  rendererServer?.close();
  rendererServer = null;
});

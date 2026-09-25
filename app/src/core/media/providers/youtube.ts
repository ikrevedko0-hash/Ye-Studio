// Видео через yt-dlp. Ключ не нужен, но нужна сама программа.
//
// yt-dlp — это набор «извлекателей» примерно на 1800 сайтов, поэтому здесь не только YouTube:
// вставленная ссылка на Instagram, TikTok, ВК или Rutube идёт тем же путём. Поиск по словам
// работает только у YouTube (ytsearch), у остальных поиска нет — только прямая ссылка.
// В этом окружении yt-dlp поставлен через pip и не лежит в PATH — зовём его как «python -m yt_dlp» (см. AGENTS.md).
//
// Скачанное потом всё равно проходит через ffmpeg: на выходе паков живёт только H.264 + AAC в mp4.

import { spawn } from "node:child_process";
import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve4 } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { join } from "node:path";
import { clearDohCache, resolveDoh } from "../net/doh";
import { sharedDohProxy } from "../net/dohProxy";
import { findLocalProxy, forgetLocalProxy } from "../net/localProxy";
import { targetWantsVpn } from "../net/routing";
import { ffmpegLocationArgs } from "../ffmpeg";
import { safeFileName } from "./http";
import type { FetchProgress, MediaProvider, MediaResult, ProviderCtx, SearchQuery } from "./types";

import type { ProviderConfig } from "./types";

/**
 * Куки нужны для закрытых страниц: Instagram почти всё отдаёт только вошедшему, а YouTube
 * с подозрительных адресов требует «подтвердите, что вы не бот».
 * Ставим их только если пользователь сам включил это в настройках.
 *
 * Файл куков отдаём yt-dlp только КОПИЕЙ. yt-dlp после каждого запуска записывает куки обратно
 * в тот же файл, и YouTube по дороге выкидывает из него главные куки входа (SID, SAPISID,
 * LOGIN_INFO): выгрузка, живая утром, к вечеру превращалась в гостевую, и загрузки начинали
 * через раз падать с «не бот». Копия на каждый запуск — и выгрузка автора остаётся как была.
 */
async function cookieArgs(cfg: ProviderConfig): Promise<string[]> {
  if (cfg.cookiesFile) {
    const dir = join(tmpdir(), "pack-workshop-cookies");
    await mkdir(dir, { recursive: true });
    await sweepOldCopies(dir);
    const copy = join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    try {
      await copyFile(cfg.cookiesFile, copy);
      return ["--cookies", copy];
    } catch {
      return []; // файл пропал — пусть идёт без куков, отказ «не бот» подскажет, что делать
    }
  }
  if (cfg.cookiesFromBrowser) return ["--cookies-from-browser", cfg.cookiesFromBrowser];
  return [];
}

/** Копии старше получаса никому не нужны: самая долгая загрузка идёт минуты. */
async function sweepOldCopies(dir: string): Promise<void> {
  try {
    for (const n of await readdir(dir)) {
      const f = join(dir, n);
      if (Date.now() - (await stat(f)).mtimeMs > 30 * 60_000) await rm(f, { force: true });
    }
  } catch { /* уборка — не повод срывать загрузку */ }
}

/**
 * Время для имени файла: 1805 секунд → «30-05».
 * Двоеточие в именах файлов Windows не допускает, поэтому дефис.
 */
function stamp(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}-${two(m)}-${two(ss)}` : `${two(m)}-${two(ss)}`;
}

/** Имя, по которому проверяем здоровье системного резолвера: именно оно и ломается. */
const PROBE_HOST = "www.youtube.com";

/**
 * Отвечает ли системный DNS про YouTube. Спрашиваем один раз за запуск: ответ не меняется
 * посреди сессии, а каждый лишний запрос — это секунды ожидания на сломанном резолвере.
 */
let systemDnsOk: Promise<boolean> | undefined;

function checkSystemDns(): Promise<boolean> {
  if (!systemDnsOk) systemDnsOk = resolve4(PROBE_HOST).then((a) => a.length > 0, () => false);
  return systemDnsOk;
}

/** Забыть решение про DNS — нужно проверкам и кнопке «проверить ещё раз». */
export function forgetNetworkProbes(): void {
  systemDnsOk = undefined;
  jsRuntimeFound = undefined;
  forgetLocalProxy();
}

/** Какой дорогой сейчас ходит yt-dlp — это же показывается автору в медиацентре. */
export interface Route {
  kind: "own" | "vpn" | "doh" | "direct";
  /** Что писать в окне: «через Happ / v2rayN (127.0.0.1:10809)». */
  label: string;
  proxy?: string;
}

/**
 * Выбор дороги наружу, по порядку:
 * 1. свой прокси из настроек — автор знает лучше;
 * 2. включённый VPN-клиент с локальным HTTP-входом — через него YouTube видит сессию целиком,
 *    с DNS и маршрутами самого клиента (выключили VPN — через 20 с приложение это заметит);
 * 3. встроенный резолвер (DoH), если системный DNS про YouTube молчит;
 * 4. напрямую.
 */
export async function currentRoute(cfg: ProviderConfig): Promise<Route> {
  if (cfg.proxy) return { kind: "own", label: `через свой прокси ${cfg.proxy}`, proxy: cfg.proxy };
  const mode = cfg.dns ?? "auto";
  if (cfg.localVpn !== false && mode !== "system") {
    const vpn = await findLocalProxy();
    if (vpn) return { kind: "vpn", label: `через VPN: ${vpn.app} (127.0.0.1:${vpn.port})`, proxy: vpn.url };
  }
  if (mode === "system" || (mode === "auto" && (await checkSystemDns()))) return { kind: "direct", label: "напрямую" };
  try {
    return { kind: "doh", label: "через встроенный резолвер (VPN не найден)", proxy: (await sharedDohProxy()).url };
  } catch {
    return { kind: "direct", label: "напрямую (встроенный резолвер не поднялся)" };
  }
}

/**
 * Найденный VPN-вход и встроенный резолвер — только для YouTube. Этим же путём идут Rutube
 * и вставленные ссылки на другие сайты, а Rutube заграничный адрес VPN не пускает.
 * Свой прокси из настроек — для всех: его автор задал сам.
 */
async function proxyArgs(cfg: ProviderConfig, args: string[]): Promise<string[]> {
  const r = await currentRoute(cfg);
  if (!r.proxy || (r.kind !== "own" && !targetWantsVpn(args))) return [];
  return ["--proxy", r.proxy];
}

/**
 * JavaScript-рантайм для yt-dlp. Часть ссылок YouTube закрывает задачей на JS, и без рантайма
 * в выдаче просто нет половины форматов — при этом ошибки не будет, только предупреждение.
 * Ищем node в PATH: у машины, где собирают это приложение, он есть заведомо.
 */
let jsRuntimeFound: Promise<string | null> | undefined;

function findNode(): Promise<string | null> {
  if (!jsRuntimeFound) {
    jsRuntimeFound = new Promise((done) => {
      // без shell: node — настоящий exe, а не .cmd, и оболочка тут только добавляет
      // предупреждение о неэкранированных аргументах
      const p = spawn("node", ["--version"], { windowsHide: true });
      p.on("error", () => done(null));
      p.on("close", (code) => done(code === 0 ? "node" : null));
    });
  }
  return jsRuntimeFound;
}

async function jsRuntimeArgs(cfg: ProviderConfig): Promise<string[]> {
  if (cfg.jsRuntime === "нет" || cfg.jsRuntime === "no") return [];
  if (cfg.jsRuntime) return ["--js-runtimes", cfg.jsRuntime];
  const node = await findNode();
  if (node) return ["--js-runtimes", node];
  // Node нет — годится само приложение: Electron с ELECTRON_RUN_AS_NODE=1 (он в окружении run) — это Node.
  // yt-dlp принимает его за node-24 и решает JS-задачки YouTube; проверено 2026-09-25.
  return cfg.electronNode ? ["--js-runtimes", `node:${cfg.electronNode}`] : [];
}

const exists = (p: string) => stat(p).then(() => true, () => false);

/**
 * PO-токен — пропуск, который YouTube с некоторых адресов требует вместо входа в аккаунт
 * («Sign in to confirm you're not a bot»). Выдаёт его сторонний провайдер bgutil, собранный
 * в tools/pot-provider; плагин к yt-dlp ставится отдельно (pip install bgutil-ytdlp-pot-provider).
 * Нет папки или нет плагина — просто идём без токена, как раньше.
 */
async function potArgs(cfg: ProviderConfig): Promise<string[]> {
  const dir = cfg.potProviderDir;
  if (!dir) return [];
  // Провайдеру нужен настоящий Node: под Electron его разбор аргументов (commander) ломается
  // («too many arguments»), а проверка висит 15 с. Без токена YouTube обычно всё равно отдаёт форматы.
  if (!(await findNode())) return [];
  if (!(await exists(join(dir, "build", "generate_once.js")))) return [];
  return ["--extractor-args", `youtubepot-bgutilscript:server_home=${dir}`];
}

/**
 * Чем запускать yt-dlp. Стоит компонент (yt-dlp.exe из окна «Компоненты») — им: Python не нужен,
 * плагин PO-токенов лежит zip-ом в папке плагинов. Иначе — как раньше, `python -m yt_dlp`.
 * У exe кодировку вывода задаём флагом: переменные PYTHON* замороженный Python слушает не всегда,
 * а путь с кириллицей в выводе обязан прийти целым.
 */
export function ytdlpCommand(cfg: Pick<ProviderConfig, "python" | "ytdlpExe" | "ytdlpPluginDir">): { bin: string; argv: string[] } {
  if (cfg.ytdlpExe) return { bin: cfg.ytdlpExe, argv: ["--encoding", "utf-8", ...(cfg.ytdlpPluginDir ? ["--plugin-dirs", cfg.ytdlpPluginDir] : [])] };
  return { bin: cfg.python || "python", argv: ["-m", "yt_dlp"] };
}

async function ytArgs(cfg: ProviderConfig, args: string[]): Promise<{ bin: string; argv: string[] }> {
  const cmd = ytdlpCommand(cfg);
  const [proxy, js, pot, cookies] = await Promise.all([proxyArgs(cfg, args), jsRuntimeArgs(cfg), potArgs(cfg), cookieArgs(cfg)]);
  const xff = cfg.xff ? ["--xff", cfg.xff] : [];
  const geo = cfg.geoVerificationProxy ? ["--geo-verification-proxy", cfg.geoVerificationProxy] : [];
  return { bin: cmd.bin, argv: [...cmd.argv, ...proxy, ...xff, ...geo, ...js, ...pot, ...cookies, ...ffmpegLocationArgs(), ...args] };
}

/**
 * Быстро сдаваться при закрытом сайте.
 * По умолчанию yt-dlp повторяет попытку десять раз: когда YouTube недоступен (а из России
 * это обычное дело), поиск молчал полторы минуты, и всё это время окно писало «Ищу…».
 * Один заход с коротким сроком ожидания превращает это в понятный отказ за несколько секунд.
 */
const FAIL_FAST = ["--socket-timeout", "8", "--retries", "1", "--extractor-retries", "1", "--no-playlist"];

/** Домен не резолвится или соединение не встаёт — для автора это «сайт закрыт», а не «ошибка yt-dlp». */
function humanReason(err: string, what: string): string {
  if (/getaddrinfo|Failed to resolve|Name or service not known|Temporary failure in name resolution/i.test(err)) {
    return `${what} не открывается с этого компьютера (домен не разрешается). Помогут VPN или строка proxy в media-providers.json; для видео есть Rutube — он работает без обхода`;
  }
  if (/timed out|timeout|Connection reset|Connection refused|Network is unreachable/i.test(err)) {
    return `${what} не отвечает. Помогут VPN или строка proxy в media-providers.json; для видео есть Rutube`;
  }
  // Instagram без входа отдаёт только открытые посты; остальное он отвечает пустотой.
  if (/\[Instagram\]/.test(err) && /empty media response|login required|rate-limit|not available/i.test(err)) {
    return `${what}: Instagram не отдал этот пост без входа — закрытый профиль или ограничение Instagram. Открытые посты и рилсы качаются по ссылке`;
  }
  // Только сама проверка «не бот». Раньше сюда попадала любая строка со словом cookies —
  // и отказ по совсем другой причине выглядел как «требует входа».
  if (/Sign in to confirm|not a bot/i.test(err)) {
    return `${what}: YouTube просит подтвердить, что вы не бот — нужны свежие куки (кнопка «куки YouTube»)`;
  }
  // Без решателя JS-задачки YouTube отдаёт только картинки, и yt-dlp не находит ни одного формата.
  if (/Requested format is not available|Only images are available/i.test(err)) {
    return `${what}: YouTube не отдал видео — у yt-dlp нет решателя JS-задачки (обновите yt-dlp в «🧩 Компонентах» или pip install yt-dlp-ejs)`;
  }
  return `${what}: ${err.slice(-300)}`;
}

function run(bin: string, argv: string[], onLine?: (l: string) => void, signal?: AbortSignal): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    // PYTHONIOENCODING обязателен: без него Python печатает пути в кодировке консоли Windows,
    // Node читает поток как UTF-8, и путь с кириллицей («…\Рабочий стол\нейро-свояк\…»)
    // приходит искажённым. Файл лежит на диске, а приложение его «не находит».
    // ELECTRON_RUN_AS_NODE: если JS-рантаймом служит само приложение (нет Node), yt-dlp запустит его как Node
    const p = spawn(bin, argv, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", ELECTRON_RUN_AS_NODE: "1" } });
    let out = "";
    let err = "";
    let rest = "";
    p.stdout.on("data", (c: Buffer) => {
      const s = c.toString();
      out += s;
      if (!onLine) return;
      rest += s;
      const lines = rest.split(/\r?\n|\r/);
      rest = lines.pop() ?? "";
      for (const l of lines) onLine(l);
    });
    p.stderr.on("data", (c: Buffer) => { err += c.toString(); if (err.length > 20000) err = err.slice(-20000); });
    p.on("error", reject);
    p.on("close", (code) => resolve({ code: code ?? -1, out, err }));
    signal?.addEventListener("abort", () => p.kill("SIGKILL"), { once: true });
  });
}

/**
 * Найти только что скачанный файл по имени, которое мы сами задали шаблоном.
 * Берём самый свежий подходящий: при сведении дорожек рядом остаются куски `.f137.mp4`,
 * и настоящий файл — тот, что записан последним.
 */
async function findDownloaded(dir: string, base: string): Promise<string> {
  try {
    const names = await readdir(dir);
    const mine = names.filter((n) => n.startsWith(base) && !/\.(part|ytdl)$/.test(n));
    let best = "";
    let bestTime = 0;
    for (const n of mine) {
      const full = join(dir, n);
      const st = await stat(full);
      if (st.isFile() && st.mtimeMs > bestTime) { best = full; bestTime = st.mtimeMs; }
    }
    return best;
  } catch {
    return "";
  }
}

let cached: boolean | undefined;

/** Забыть, есть ли yt-dlp: после установки или удаления компонента проверка идёт заново. */
export function forgetYtdlp(): void {
  cached = undefined;
}

interface YtEntry {
  id: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  url?: string;
  webpage_url?: string;
  description?: string;
  thumbnails?: { url: string; width?: number }[];
  thumbnail?: string;
}

/** Из списка миниатюр берём самую мелкую пригодную: плитка всё равно небольшая. */
function thumb(e: YtEntry): string | undefined {
  if (e.thumbnail) return e.thumbnail;
  const list = (e.thumbnails ?? []).filter((t) => t.url);
  if (!list.length) return undefined;
  const sorted = [...list].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((t) => (t.width ?? 0) >= 240) ?? sorted[sorted.length - 1]).url;
}

/** Пост, рилс или IGTV в Instagram. */
export const isInstagramLink = (t: string) => /^https?:\/\/(www\.)?instagram\.com\/(p|reels?|tv)\//i.test(t.trim());

/**
 * Сведения о ролике по ссылке или по поиску ytsearch — общее для YouTube и Instagram.
 * `who` — как называть сайт в сообщениях об отказе.
 */
export async function ytLookup(target: string, q: SearchQuery, ctx: ProviderCtx, providerId: string, who: string): Promise<MediaResult[]> {
  const { bin, argv } = await ytArgs(ctx.cfg, [...FAIL_FAST, "--dump-json", "--flat-playlist", "--no-warnings", "--ignore-errors", target]);
  const r = await run(bin, argv, undefined, ctx.signal);
  if (r.code !== 0 && !r.out.trim()) throw new Error(humanReason(r.err, who));
  return r.out
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith("{"))
    .flatMap((l): MediaResult[] => {
      let e: YtEntry;
      try { e = JSON.parse(l) as YtEntry; } catch { return []; }
      if (!e.id) return [];
      // у полного разбора (ссылка на Instagram) в `url` лежит ссылка на сам файл, а не на страницу
      const page = e.webpage_url ?? (e.url && /^https?:/.test(e.url) && !/\.(mp4|m3u8)|cdninstagram|fbcdn/.test(e.url) ? e.url : `https://www.youtube.com/watch?v=${e.id}`);
      return [{
        providerId,
        id: e.id,
        type: q.type === "audio" ? "audio" : "video",
        title: e.title?.trim() || e.description?.trim().slice(0, 80) || e.id,
        author: e.uploader ?? e.channel,
        pageUrl: page,
        thumbUrl: thumb(e),
        durationSec: e.duration ? Math.round(e.duration) : undefined,
      }];
    });
}

export const youtube: MediaProvider = {
  id: "youtube",
  title: "YouTube и ссылки",
  types: ["video", "audio"],
  note: "yt-dlp: поиск по YouTube, по ссылке — Instagram, TikTok, ВК и другие",
  // рабочий поиск через ytsearch идёт три-пять секунд; всё, что дольше, — признак закрытого доступа
  searchTimeoutMs: 15_000,

  async available(cfg): Promise<boolean> {
    if (cached !== undefined) return cached;
    const { bin, argv } = await ytArgs({ python: cfg.python, ytdlpExe: cfg.ytdlpExe, ytdlpPluginDir: cfg.ytdlpPluginDir, dns: cfg.dns, proxy: cfg.proxy }, ["--version"]);
    try {
      const r = await run(bin, argv);
      cached = r.code === 0;
    } catch {
      cached = false;
    }
    return cached;
  },

  async search(q: SearchQuery, ctx: ProviderCtx): Promise<MediaResult[]> {
    const text = q.text.trim();
    // Ссылки на Instagram — у своего источника, иначе одна находка приходила бы дважды.
    if (isInstagramLink(text)) return [];
    // Прямую ссылку ищем как есть, всё остальное — поиском.
    const target = /^https?:\/\//i.test(text) ? text : `ytsearch${q.perPage ?? 20}:${q.text}`;
    return ytLookup(target, q, ctx, "youtube", "YouTube");
  },

  async download(r: MediaResult, destDir: string, ctx: ProviderCtx, onProgress?: (p: FetchProgress) => void): Promise<string> {
    const clip = ctx.want?.clip;
    // Метка отрезка в имени: из одного ролика в пак часто идут два разных куска, и без неё
    // второй перезаписал бы первый.
    const mark = clip ? ` [${stamp(clip.from)}-${stamp(clip.to)}]` : "";
    const base = safeFileName(r.title, r.id) + mark;
    const tmpl = join(destDir, `${base}.%(ext)s`);
    const audioOnly = r.type === "audio";
    // Ограничение по высоте кадра. Вопросительный знак в `height<=?N` означает «желательно»:
    // если подходящего формата нет вовсе, yt-dlp возьмёт что есть, а не упадёт с «нет форматов».
    const h = ctx.want?.maxHeight;
    const video = h
      ? `bestvideo[height<=?${h}]+bestaudio/best[height<=?${h}]/bestvideo*+bestaudio/best`
      : "bestvideo*+bestaudio/best";
    const args = audioOnly
      ? ["-f", "bestaudio/best", "-x", "--audio-format", "mp3", "--audio-quality", "192K"]
      : ["-f", video, "--merge-output-format", "mp4"];

    /**
     * Отрезок вместо всего ролика.
     *
     * `--download-sections "*начало-конец"` заставляет yt-dlp тянуть только нужную часть —
     * из получасового ролика приезжают запрошенные секунды, а не весь файл.
     * `--force-keyframes-at-cuts` обязателен: без него границы прыгают до ближайшего опорного
     * кадра, и начало отрезка может уехать на несколько секунд назад или рассыпаться в кашу.
     * Платить за это приходится перекодированием, но на пяти секундах это доли секунды.
     */
    const section = clip
      ? ["--download-sections", `*${clip.from.toFixed(2)}-${clip.to.toFixed(2)}`, "--force-keyframes-at-cuts"]
      : [];

    const { bin, argv } = await ytArgs(ctx.cfg, [
      ...args, ...section, "--no-playlist", "--newline", "--no-warnings",
      "-o", tmpl, "--print", "after_move:filepath",
      r.pageUrl ?? r.id,
    ]);

    let path = "";
    const res = await run(bin, argv, (line) => {
      const m = /\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+)(KiB|MiB|GiB)/.exec(line);
      if (m) {
        const mult = m[3] === "GiB" ? 2 ** 30 : m[3] === "MiB" ? 2 ** 20 : 2 ** 10;
        const total = Number(m[2]) * mult;
        const ratio = Number(m[1]) / 100;
        onProgress?.({ ratio, receivedBytes: Math.round(total * ratio), totalBytes: Math.round(total) });
        return;
      }
      // «--print after_move:filepath» печатает путь отдельной строкой в тот же поток.
      // На Windows путь приходит с ОБРАТНЫМИ слэшами: «C:\Users\…\ролик.mp4». Класс [\/]
      // обратный слэш не покрывает, и путь не опознавался — yt-dlp честно скачивал файл,
      // а приложение сообщало «не вернул путь» и выбрасывало результат. Из-за этого через
      // yt-dlp не скачался ни один ролик ни с YouTube, ни с Rutube.
      if (/^[A-Za-z]:[\\/]|^\//.test(line.trim())) path = line.trim();
      else if (/^\[(ExtractAudio|Merger|VideoConvertor)\]/.test(line)) onProgress?.({ receivedBytes: 0, note: "сведение дорожек…" });
    }, ctx.signal);

    // Печатаемому пути доверяем только после проверки: он проходит через кодировку консоли,
    // и на пути с кириллицей может прийти испорченным. Своя папка и своё имя — надёжнее.
    if (!path || !(await exists(path))) path = await findDownloaded(destDir, base);
    if (!path) throw new Error(humanReason(res.err || `yt-dlp завершился с кодом ${res.code}, файла в папке нет`, "Загрузка не удалась"));
    return path;
  },
};

// ---------- проверка YouTube по шагам ----------
//
// Смысл этой проверки — не «работает / не работает», а «где именно рвётся». Отказ на четырёх
// разных шагах выглядит для автора одинаково («ничего не нашлось»), а лечится по-разному:
// сломанный резолвер — встроенным DoH, закрытый доступ — прокси, требование входа — куками.

export interface DiagStep {
  name: string;
  ok: boolean;
  detail: string;
  ms: number;
}

export interface Diagnosis {
  steps: DiagStep[];
  /** Короткий вывод для строки состояния. */
  verdict: string;
  /** Что делать дальше — человеческими словами. */
  advice: string;
}

async function timed(name: string, work: () => Promise<string>): Promise<DiagStep> {
  const t0 = Date.now();
  try {
    return { name, ok: true, detail: await work(), ms: Date.now() - t0 };
  } catch (e) {
    return { name, ok: false, detail: (e as Error).message, ms: Date.now() - t0 };
  }
}

/** Достучаться до сайта по конкретному адресу, минуя резолвер целиком. */
function headByIp(ip: string, host: string, timeoutMs = 10_000): Promise<number> {
  return new Promise((ok, fail) => {
    const req = httpsRequest(
      { host: ip, servername: host, port: 443, path: "/", method: "HEAD", headers: { host }, timeout: timeoutMs },
      (res) => {
        res.resume();
        ok(res.statusCode ?? 0);
      },
    );
    req.on("timeout", () => req.destroy(new Error("соединение не встало за 10 с")));
    req.on("error", fail);
    req.end();
  });
}

/**
 * Проверить всю дорогу до YouTube и назвать место разрыва.
 * Кэш проб сбрасывается: кнопку жмут именно тогда, когда что-то поменяли (включили VPN).
 */
export async function diagnoseYoutube(cfg: ProviderConfig): Promise<Diagnosis> {
  forgetNetworkProbes();
  clearDohCache();
  const steps: DiagStep[] = [];

  steps.push(await timed("yt-dlp установлен", async () => {
    const { bin, argv } = await ytArgs({ python: cfg.python, dns: "system" }, ["--version"]);
    const r = await run(bin, argv);
    if (r.code !== 0) throw new Error(r.err.slice(-200) || `код ${r.code}`);
    return `версия ${r.out.trim()}`;
  }));

  const sys = await timed("системный DNS знает www.youtube.com", async () => {
    const a = await resolve4(PROBE_HOST);
    return `адрес ${a[0]}`;
  });
  steps.push(sys);

  let ip = "";
  const doh = await timed("свой резолвер (DoH) знает www.youtube.com", async () => {
    const a = await resolveDoh(PROBE_HOST);
    ip = a[0];
    return `адрес ${a[0]}${a.length > 1 ? ` и ещё ${a.length - 1}` : ""}`;
  });
  steps.push(doh);

  const reach = await timed("соединение с YouTube по адресу", async () => {
    if (!ip) throw new Error("адрес неизвестен — предыдущий шаг не прошёл");
    return `сайт ответил ${await headByIp(ip, PROBE_HOST)}`;
  });
  steps.push(reach);

  steps.push(await timed("JavaScript-рантайм для yt-dlp", async () => {
    const args = await jsRuntimeArgs(cfg);
    if (!args.length) throw new Error("node не найден: YouTube отдаст не все форматы (ошибки не будет, просто меньше качества)");
    return args[1];
  }));

  steps.push(await timed("провайдер PO-токенов", async () => {
    const args = await potArgs(cfg);
    if (!args.length) throw new Error("не собран: без него YouTube иногда просит «подтвердите, что вы не робот»");
    return "готов";
  }));

  let route: Route | undefined;
  steps.push(await timed("маршрут до YouTube", async () => {
    route = await currentRoute(cfg);
    return route.label;
  }));

  const search = await timed("поиск по словам тем же путём, что в приложении", async () => {
    const { bin, argv } = await ytArgs(cfg, [...FAIL_FAST, "--dump-json", "--flat-playlist", "--no-warnings", `ytsearch2:музыка`]);
    const r = await run(bin, argv);
    const found = r.out.split(/\r?\n/).filter((l) => l.trim().startsWith("{")).length;
    if (!found) throw new Error(humanReason(r.err, "YouTube"));
    return `нашлось роликов: ${found}`;
  });
  steps.push(search);

  // Вывод строим от места разрыва, а не от общего числа галочек.
  let verdict: string;
  let advice: string;
  if (search.ok) {
    verdict = "YouTube работает";
    advice = route?.kind === "vpn"
      ? "Приложение само нашло включённый VPN и ходит через него. Выключите VPN — через 20 секунд оно перейдёт на другой маршрут."
      : sys.ok
        ? "Всё идёт напрямую, обход не нужен."
        : "Системный DNS про YouTube молчит, поэтому имена берутся через встроенный резолвер — он и вытянул поиск.";
  } else if (!steps[0].ok) {
    verdict = "нет самого yt-dlp";
    advice = "Поставьте его в окне «🧩 Компоненты» (кнопка в шапке) — Python не нужен. Или командой: python -m pip install -U yt-dlp";
  } else if (!doh.ok && !sys.ok) {
    verdict = "интернета нет вовсе";
    advice = "Ни системный DNS, ни свой резолвер не отвечают — проверьте сеть, потом нажмите ещё раз.";
  } else if (!reach.ok) {
    verdict = "до YouTube не достучаться";
    advice = "Адрес известен, но соединение не встаёт: доступ закрыт по адресам. Поможет только VPN или строка proxy в media-providers.json. Для видео остаётся Rutube — он работает без обхода.";
  } else if (/Sign in to confirm|not a bot/i.test(search.detail)) {
    verdict = "YouTube требует подтверждения";
    advice = "Нужны свежие куки YouTube: нажмите «куки YouTube» рядом с этой кнопкой — там инструкция и выбор файла.";
  } else {
    verdict = "соединение есть, а поиск не идёт";
    advice = `Причина на стороне yt-dlp: ${search.detail}`;
  }
  return { steps, verdict, advice };
}

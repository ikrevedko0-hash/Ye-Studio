// ---------- связь с сервером автора: статистика запусков, отчёты об ошибках, обратная связь ----------
//
// Протокол — server/yestudio_server.py, адрес — shared/server.ts. Выключения по команде нет: сервер только считает
// запуски (ID установки + версия), принимает ошибки и отзывы.
// Всё молчит при отсутствии сети, кроме явной отправки отзыва (там автор ждёт ответа).
// Приватность: путь домашней папки и имя пользователя Windows вычищаются из текста ошибок
// до того, как они лягут в очередь на диске — не только перед отправкой.

import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { homedir, release, userInfo } from "node:os";
import { join } from "node:path";
import { app, dialog, type BrowserWindow, type NativeImage } from "electron";
import { CLIENT_KEY, SERVER_URL } from "../shared/server";
import type { FeedbackRequest } from "../shared/api";
import type { ServerCheck } from "../core/siq/dupCheck";

const TIMEOUT_MS = 8000;
const MSG_MAX = 1000;
const STACK_MAX = 4000;
const QUEUE_MAX = 200;
const COALESCE_MS = 60_000;
const PING_EVERY_MS = 15 * 60_000;
const ERRORS_EVERY_MS = 10 * 60_000;

function dir(): string {
  return app.getPath("userData");
}
const idFile = () => join(dir(), "install-id");
const queueFile = () => join(dir(), "errors-queue.json");

export interface ErrorEntry {
  ts: number;
  where: "main" | "renderer";
  kind: string;
  message: string;
  stack?: string;
  count?: number;
}

let cachedId: string | null = null;

/** UUID установки — создаётся один раз, живёт в userData (переживает переустановку в ту же папку). */
export async function installId(): Promise<string> {
  if (cachedId) return cachedId;
  try {
    cachedId = (await readFile(idFile(), "utf8")).trim();
    if (cachedId) return cachedId;
  } catch { /* файла ещё нет */ }
  cachedId = randomUUID();
  await writeFile(idFile(), cachedId, "utf8").catch(() => {});
  return cachedId;
}

function osString(): string {
  return `${process.platform} ${release()}`;
}

const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Заменяет путь домашней папки на ~ и имя пользователя Windows на <user> — в обе стороны слэшей, без учёта регистра. */
function scrub(text: string): string {
  let out = text;
  const home = homedir();
  if (home) {
    // сравниваем по частям пути: тогда «C:\Users\имя» ловит и обратные, и прямые слэши разом
    const parts = home.split(/[\\/]/).filter(Boolean).map(reEscape);
    if (parts.length) out = out.replace(new RegExp(parts.join("[\\\\/]"), "gi"), "~");
  }
  const user = userInfo().username;
  if (user && user.length > 1) out = out.replace(new RegExp(reEscape(user), "gi"), "<user>");
  return out;
}

async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await work(ac.signal);
  } finally {
    clearTimeout(t);
  }
}

function headers(): Record<string, string> {
  return { "Content-Type": "application/json", "X-YeStudio-Key": CLIENT_KEY };
}

// ---------- статистика запусков ----------

/** «Я запущен»: ID установки и версия — сервер отмечает, когда установку видели последний раз. Нет сети — молчим. */
export async function ping(): Promise<void> {
  const id = await installId();
  const v = app.getVersion();
  await withTimeout((signal) =>
    fetch(`${SERVER_URL}/api/ping?id=${encodeURIComponent(id)}&v=${encodeURIComponent(v)}`, { headers: headers(), signal }))
    .catch(() => {});
}

// ---------- отчёты об ошибках ----------

let errQueue: ErrorEntry[] | null = null;

async function loadQueue(): Promise<ErrorEntry[]> {
  if (errQueue) return errQueue;
  try {
    errQueue = JSON.parse(await readFile(queueFile(), "utf8")) as ErrorEntry[];
  } catch {
    errQueue = [];
  }
  return errQueue;
}

async function saveQueue(): Promise<void> {
  await writeFile(queueFile(), JSON.stringify(errQueue ?? []), "utf8").catch(() => {});
}

async function reportingEnabled(): Promise<boolean> {
  try {
    const raw = JSON.parse(await readFile(join(dir(), "ui-settings.json"), "utf8")) as { reportErrors?: boolean };
    return raw.reportErrors !== false; // по умолчанию включено
  } catch {
    return true;
  }
}

/** Кладёт ошибку в очередь (с обрезкой длин и чисткой приватных путей); склеивает повтор за минуту. */
export async function queueError(where: "main" | "renderer", kind: string, message: string, stack?: string): Promise<void> {
  if (!(await reportingEnabled())) return;
  const q = await loadQueue();
  const entry: ErrorEntry = {
    ts: Date.now(),
    where,
    kind: String(kind || "Error").slice(0, 100),
    message: scrub(String(message ?? "")).slice(0, MSG_MAX),
    stack: stack ? scrub(String(stack)).slice(0, STACK_MAX) : undefined,
  };
  const last = q[q.length - 1];
  if (last && last.message === entry.message && last.stack === entry.stack && entry.ts - last.ts < COALESCE_MS) {
    last.count = (last.count ?? 1) + 1;
    last.ts = entry.ts;
  } else {
    q.push(entry);
    if (q.length > QUEUE_MAX) q.splice(0, q.length - QUEUE_MAX);
  }
  await saveQueue();
}

/** Отправляет всю очередь и очищает её при успехе. Тихо — сеть недоступна не считается ошибкой. */
export async function sendErrors(): Promise<void> {
  if (!(await reportingEnabled())) return;
  const q = await loadQueue();
  if (!q.length) return;
  try {
    const id = await installId();
    const body = JSON.stringify({ id, v: app.getVersion(), os: osString(), items: q });
    const res = await withTimeout((signal) => fetch(`${SERVER_URL}/api/errors`, { method: "POST", headers: headers(), body, signal }));
    if (!res.ok) return;
    errQueue = [];
    await saveQueue();
  } catch { /* нет сети — попробуем в следующий раз */ }
}

/** Последние N записей очереди — текстом, для «приложить журнал ошибок» в окне отзыва. */
export async function errorsTail(n = 50): Promise<string> {
  const q = await loadQueue();
  return q.slice(-n).map((e) => {
    const cnt = e.count ? ` ×${e.count}` : "";
    return `[${new Date(e.ts).toLocaleString("ru-RU")}] ${e.where}/${e.kind}${cnt}: ${e.message}${e.stack ? "\n" + e.stack : ""}`;
  }).join("\n\n");
}

// ---------- перехват ошибок main-процесса и окна ----------

/** Вызывать один раз при старте (после регистрации IPC, не в самопроверках). */
export function installMainErrorHandlers(): void {
  process.on("uncaughtException", (err) => {
    void queueError("main", err?.name || "Error", err?.message || String(err), err?.stack);
    // Свой слушатель отключает стандартное окно Electron об ошибке — показываем его сами,
    // чтобы для пользователя всё осталось как раньше (окно с текстом, программа продолжает работу).
    console.error("необработанная ошибка:", err);
    dialog.showErrorBox("Ошибка в Ye!Studio", err?.stack || String(err));
  });
  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    void queueError("main", err.name || "UnhandledRejection", err.message, err.stack);
    console.error("необработанный reject:", err);
  });
  app.on("render-process-gone", (_e, _wc, details) => {
    void queueError("renderer", "render-process-gone", `окно упало: ${details.reason} (код ${details.exitCode})`);
  });
  app.on("child-process-gone", (_e, details) => {
    void queueError("main", "child-process-gone", `дочерний процесс (${details.type}) упал: ${details.reason}`);
  });
}

// ---------- обратная связь ----------

/** Снимок окна на момент нажатия 💬 — держим в памяти до отправки/закрытия формы. */
let feedbackShot: NativeImage | null = null;

export async function captureFeedbackShot(win: BrowserWindow): Promise<void> {
  try {
    feedbackShot = await win.webContents.capturePage();
  } catch {
    feedbackShot = null;
  }
}

export function clearFeedbackShot(): void {
  feedbackShot = null;
}

/** Ужимает снимок под лимит тела запроса: до 1280 px, PNG → JPEG 80%, если PNG больше 2 МБ. */
function packShot(): { data: string; type: "png" | "jpeg" } | undefined {
  if (!feedbackShot) return undefined;
  const size = feedbackShot.getSize();
  const resized = size.width > 1280 ? feedbackShot.resize({ width: 1280 }) : feedbackShot;
  const png = resized.toPNG();
  if (png.length <= 2 * 1024 * 1024) return { data: png.toString("base64"), type: "png" };
  return { data: resized.toJPEG(80).toString("base64"), type: "jpeg" };
}

/** Отправляет отзыв. Текст не теряется при неудаче — окно само решает, что показать и повторить. */
export async function sendFeedback(req: FeedbackRequest): Promise<{ ok: boolean; message: string }> {
  const shot = req.includeScreenshot ? packShot() : undefined;
  const log = req.includeLog ? await errorsTail(50) : undefined;
  const id = await installId();
  const body = JSON.stringify({
    id, v: app.getVersion(), os: osString(),
    text: req.text.slice(0, 4000),
    contact: req.contact?.slice(0, 300) || undefined,
    screenshot: shot?.data,
    screenshotType: shot?.type,
    log: log?.slice(0, 20000),
  });
  try {
    const res = await withTimeout((signal) => fetch(`${SERVER_URL}/api/feedback`, { method: "POST", headers: headers(), body, signal }));
    if (!res.ok) throw new Error(String(res.status));
    return { ok: true, message: "Спасибо! Отправлено" };
  } catch {
    return { ok: false, message: "Не получилось отправить: нет связи с сервером" };
  }
}

// ---------- повторы на FirePacks ----------

export type ServerDupResult = { ok: true; data: ServerCheck } | { ok: false; message: string };

/** Сверить вопросы с базой повторов на сервере (server/packindex). Сервер текст не сохраняет и не пишет в лог. */
export async function packDupCheck(
  questions: { text: string; answers: string[]; media: string[] }[],
  exclude: number[],
): Promise<ServerDupResult> {
  try {
    const body = JSON.stringify({ questions, exclude });
    const res = await withTimeout((signal) => fetch(`${SERVER_URL}/api/pack-check`, { method: "POST", headers: headers(), body, signal }), 30_000);
    if (res.status === 503) return { ok: false, message: "База повторов на сервере ещё не готова — попробуйте позже" };
    if (res.status === 429) return { ok: false, message: "Слишком много проверок подряд — попробуйте через час" };
    if (res.status === 413) return { ok: false, message: "Пак слишком большой для проверки (больше 3000 вопросов)" };
    if (!res.ok) return { ok: false, message: `Сервер проверки ответил ошибкой ${res.status}` };
    return { ok: true, data: (await res.json()) as ServerCheck };
  } catch {
    return { ok: false, message: "Нет связи с сервером проверки" };
  }
}

// ---------- запуск ----------

/** Вызывать после показа окна, не в самопроверках: первая проверка сразу, дальше — по расписанию. */
export function initRemote(win: BrowserWindow): void {
  installMainErrorHandlers();
  // от беты с выключением по команде остался control.json — больше не нужен
  void rm(join(dir(), "control.json"), { force: true }).catch(() => {});
  void ping();
  void sendErrors();
  setInterval(() => { if (!win.isDestroyed()) void ping(); }, PING_EVERY_MS);
  setInterval(() => void sendErrors(), ERRORS_EVERY_MS);
}

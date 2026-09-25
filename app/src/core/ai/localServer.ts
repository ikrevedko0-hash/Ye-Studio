// Локальный сервер картинок (sd-server из stable-diffusion.cpp) поднимаем по требованию.
//
// Модели занимают ~11 ГБ оперативной памяти, держать их всё время незачем: сервер стартует при первой
// картинке, гаснет после получаса без запросов и вместе с приложением. Как запускать — поле `launch`
// провайдера в providers.json. Сервер, запущенный руками, мы не трогаем: он отвечает — им и пользуемся.
//
// Пути в `launch` бывают абсолютными (как у автора: …\нейро-свояк\local-image\…) и относительными —
// тогда они внутри папки компонентов (%LOCALAPPDATA%\Мастерская паков\components), куда модель
// ставит само приложение. Так providers.json переносится на другую машину без правки путей.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { isAbsolute, join, win32 } from "node:path";
import type { AiProvider } from "./config";

const IDLE_MS = 30 * 60_000;
/** Загрузка моделей с диска — около 10 с, с холодного диска дольше. */
const START_MS = 180_000;

interface Running { child: ChildProcess; idle?: NodeJS.Timeout }
const running = new Map<string, Running>();

type Launch = NonNullable<AiProvider["launch"]>;

/** Откуда считать относительные пути `launch`; главный процесс даёт папку компонентов. */
let launchBase: () => string | undefined = () => undefined;

export function setLaunchBase(fn: () => string | undefined): void {
  launchBase = fn;
}

const absolute = (p: string) => isAbsolute(p) || win32.isAbsolute(p);

/**
 * Разрешить пути `launch` относительно папки компонентов. Абсолютные не трогаем.
 * Голое имя («sd-server.exe») берём из папки компонентов или из cwd, если оно там есть,
 * иначе оставляем как есть — пусть его найдёт PATH, как было раньше.
 */
export function resolveLaunch(launch: Launch, base: string | undefined, exists: (p: string) => boolean = existsSync): Launch {
  if (!base) return launch;
  const cwd = launch.cwd && !absolute(launch.cwd) ? join(base, launch.cwd) : launch.cwd;
  let exe = launch.exe;
  if (!absolute(exe)) {
    if (/[\\/]/.test(exe)) exe = join(base, exe);
    else if (exists(join(base, exe))) exe = join(base, exe);
    else if (cwd && exists(join(cwd, exe))) exe = join(cwd, exe);
  }
  return { ...launch, exe, cwd };
}

async function alive(p: AiProvider, signal?: AbortSignal): Promise<boolean> {
  try {
    const r = await fetch(`${p.base.replace(/\/$/, "")}/models`, { signal: AbortSignal.any([AbortSignal.timeout(2000), ...(signal ? [signal] : [])]) });
    return r.ok;
  } catch {
    return false;
  }
}

function touch(id: string): void {
  const r = running.get(id);
  if (!r) return;
  if (r.idle) clearTimeout(r.idle);
  r.idle = setTimeout(() => stopLocalServer(id), IDLE_MS);
}

/** У провайдера есть `launch` и он не отвечает — запустить и дождаться. Без `launch` ничего не делаем. */
export async function ensureLocalServer(id: string, p: AiProvider, signal?: AbortSignal): Promise<void> {
  if (!p.launch) return;
  if (await alive(p, signal)) { touch(id); return; }
  const launch = resolveLaunch(p.launch, launchBase());
  if (!running.has(id)) {
    const cwd = launch.cwd;
    // вывод сервера — в файл рядом с моделями: когда что-то не так, смотреть туда
    const log = cwd ? openSync(join(cwd, "server.log"), "w") : "ignore";
    const child = spawn(launch.exe, launch.args ?? [], { cwd, windowsHide: true, stdio: ["ignore", log, log] });
    child.on("exit", () => {
      const r = running.get(id);
      if (r?.child === child) { if (r.idle) clearTimeout(r.idle); running.delete(id); }
    });
    child.on("error", () => running.delete(id));
    running.set(id, { child });
  }
  const until = Date.now() + START_MS;
  while (Date.now() < until) {
    if (signal?.aborted) throw new Error("отменено");
    if (!running.has(id)) throw new Error(`локальный сервер не запустился — см. server.log${launch.cwd ? ` в ${launch.cwd}` : ""}`);
    if (await alive(p, signal)) { touch(id); return; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("локальный сервер не ответил за 3 минуты");
}

/** Запрос закончился — отсчёт простоя заново. */
export function localServerUsed(id: string): void {
  touch(id);
}

export function stopLocalServer(id: string): void {
  const r = running.get(id);
  if (!r) return;
  if (r.idle) clearTimeout(r.idle);
  running.delete(id);
  r.child.kill();
}

export function stopLocalServers(): void {
  for (const id of [...running.keys()]) stopLocalServer(id);
}

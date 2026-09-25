// Проверка системы: собрать факты о машине (видеокарта, память, диск, установленные программы)
// и выбрать профиль локальной модели. Разбор и выбор — чистые функции в core/system/probe.ts;
// здесь только запуск nvidia-smi и PowerShell и опрос того, что уже умеет находить приложение.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { statfs } from "node:fs/promises";
import { cpus, release, totalmem } from "node:os";
import { dirname } from "node:path";
import { ffmpegTools } from "../core/media/ffmpeg";
import { findLocalProxy } from "../core/media/net/localProxy";
import { youtube } from "../core/media/providers/youtube";
import type { ProviderConfig } from "../core/media/providers/types";
import { chooseProfile, mergeGpus, parseNvidiaSmi, parseRegistryAdapters, type Gpu, type SystemReport } from "../core/system/probe";
import { findChrome } from "./sideBySide";

export type { SystemReport };

/** Запустить программу и вернуть stdout; не запустилась, упала или не уложилась в срок — null. */
function output(bin: string, args: string[], timeoutMs = 8000): Promise<string | null> {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const finish = (v: string | null) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    let p: ReturnType<typeof spawn>;
    try {
      p = spawn(bin, args, { windowsHide: true });
    } catch {
      return resolve(null);
    }
    const timer = setTimeout(() => { p.kill(); finish(null); }, timeoutMs);
    p.stdout?.on("data", (c: Buffer) => { out += c.toString("utf8"); });
    p.on("error", () => finish(null));
    p.on("close", (code) => finish(code === 0 ? out : null));
  });
}

const REG_CLASS = String.raw`HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\0*`;

async function registryGpus(): Promise<Gpu[]> {
  if (process.platform !== "win32") return [];
  const script =
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8;" +
    `Get-ItemProperty '${REG_CLASS}' -ErrorAction SilentlyContinue | ` +
    "Select-Object DriverDesc,ProviderName,'HardwareInformation.qwMemorySize','HardwareInformation.MemorySize' | ConvertTo-Json -Compress";
  const out = await output("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  return out ? parseRegistryAdapters(out) : [];
}

async function nvidiaGpus(): Promise<Gpu[]> {
  const out = await output("nvidia-smi", ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"]);
  return out ? parseNvidiaSmi(out) : [];
}

/** Свободное место на диске папки; самой папки ещё может не быть — берём ближайшую существующую выше. */
async function freeMB(dir: string): Promise<number | undefined> {
  let d = dir;
  while (!existsSync(d)) {
    const up = dirname(d);
    if (up === d) return undefined;
    d = up;
  }
  try {
    const s = await statfs(d);
    return Math.round((s.bavail * s.bsize) / 1048576);
  } catch {
    return undefined;
  }
}

export async function probeSystem(opts: { componentsDir: string; providerCfg: ProviderConfig }): Promise<SystemReport> {
  const t0 = Date.now();
  const [smi, reg, freeDiskMB, ytdlp, node, vpn] = await Promise.all([
    nvidiaGpus(),
    registryGpus(),
    freeMB(opts.componentsDir),
    Promise.resolve(youtube.available(opts.providerCfg)).catch(() => false),
    output("node", ["--version"], 4000),
    findLocalProxy().catch(() => null),
  ]);
  const gpus = mergeGpus(smi, reg);
  const ramMB = Math.round(totalmem() / 1048576);
  const profile = chooseProfile({ platform: process.platform, ramMB, freeDiskMB, gpus });
  return {
    os: `${process.platform} ${release()}`,
    cpu: cpus()[0]?.model.trim() ?? "?",
    ramMB,
    componentsDir: opts.componentsDir,
    freeDiskMB,
    gpus,
    tools: {
      ffmpeg: ffmpegTools()?.dir ?? null,
      ytdlp,
      node: node?.trim() || null,
      chrome: findChrome(),
      vpn: vpn ? `${vpn.app}, порт ${vpn.port}` : null,
    },
    profile,
    tookMs: Date.now() - t0,
  };
}

// «Перевод + озвучка»: перевод фразы своей моделью (llama-server) и озвучка (Qwen3-TTS на видеокарте или Piper на процессоре).
// Всё локально; облако — только если автор разрешил галочкой. Что где лежит — voiceComponents.ts.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, win32 } from "node:path";
import { chat, type ChatResult } from "../core/ai/chat";
import { findAiConfig, type AiConfig, type AiProvider } from "../core/ai/config";
import { ensureLocalServer, stopLocalServer } from "../core/ai/localServer";
import { piperVoiceForLang } from "../core/tts/languages";
import type { SpeakRequest, TranslateResult, VoiceState } from "../core/tts/types";
import { buildTranslateMessages, parseVariants, translateStages } from "../core/tts/translate";
import { componentPath, componentsDir } from "./components";
import { SD_PROVIDER_ID } from "./modelInstall";
import { ttsPaths, type TtsPaths } from "./voiceComponents";

const LLM_ID = "local-llm";
const LLM_PORT = 7862;
const SPEAK_TIMEOUT_MS = 180_000;

/** Папки моделей картинок, где может лежать Qwen3: компонент «model» и «своя папка» провайдера sd. */
async function imageModelDirs(baseDir: string): Promise<string[]> {
  const dirs: string[] = [];
  const own = await componentPath("model").catch(() => null);
  if (own) dirs.push(own);
  const found = await findAiConfig(baseDir).catch(() => null);
  const cwd = found?.cfg.providers[SD_PROVIDER_ID]?.launch?.cwd;
  if (cwd) dirs.push(isAbsolute(cwd) || win32.isAbsolute(cwd) ? cwd : join(componentsDir(), cwd));
  return dirs;
}

async function paths(baseDir: string): Promise<TtsPaths> {
  return ttsPaths(componentsDir(), await imageModelDirs(baseDir));
}

export async function voiceState(baseDir: string): Promise<VoiceState> {
  const p = await paths(baseDir);
  const found = await findAiConfig(baseDir).catch(() => null);
  const stages = translateStages(found?.cfg ?? null, true, false, SD_PROVIDER_ID);
  return {
    gpu: !!(p.llamaTts && p.ttsModel && p.ttsMmproj),
    piper: !!p.piper && p.piperVoices.length > 0,
    voices: p.piperVoices.map((v) => ({ id: v.id, lang: v.lang, title: v.name })),
    translator: {
      own: !!(p.llamaServer && p.llmModel),
      model: p.llmModel ? basename(p.llmModel).replace(/-Q\d.*$/i, "") : undefined,
      local: stages.some((s) => s.kind === "local"),
      cloud: stages.flatMap((s) => (s.kind === "cloud" ? s.chain.map((ref) => ref.slice(ref.indexOf(":") + 1)) : [])),
    },
  };
}

/** Гасим простаивающий sd-server картинок: иначе модель перевода или голоса не влезет в 8 ГБ видеопамяти. */
function freeVram(): void {
  stopLocalServer(SD_PROVIDER_ID);
}

export async function translate(baseDir: string, text: string, target: string, custom: string, opts: { allowCloud?: boolean }, signal?: AbortSignal): Promise<TranslateResult> {
  const clean = text.trim();
  if (!clean) throw new Error("Нет текста для перевода");
  if (target === "none") return { variants: [clean], via: "без перевода" };
  const messages = buildTranslateMessages(clean, target, custom);
  const p = await paths(baseDir);
  const found = await findAiConfig(baseDir).catch(() => null);
  const attempts: string[] = [];

  const finish = (r: ChatResult, via: string): TranslateResult => {
    const variants = parseVariants(r.text, target);
    if (!variants.length) throw new Error("модель вернула пустой ответ");
    return { variants, via };
  };

  for (const stage of translateStages(found?.cfg ?? null, !!opts.allowCloud, !!(p.llamaServer && p.llmModel), SD_PROVIDER_ID)) {
    try {
      if (stage.kind === "own") {
        // своя модель на своей видеокарте — запасной путь: переводит хуже облака и долго грузится
        const provider: AiProvider = {
          kind: "openai",
          base: `http://127.0.0.1:${LLM_PORT}/v1`,
          models: [LLM_ID],
          extraBody: { chat_template_kwargs: { enable_thinking: false } },
          launch: {
            exe: p.llamaServer!,
            args: ["-m", p.llmModel!, "--port", String(LLM_PORT), "-ngl", "99", "-c", "4096", "--alias", LLM_ID],
            cwd: p.llamaDir,
          },
        };
        freeVram();
        await ensureLocalServer(LLM_ID, provider, signal);
        const cfg: AiConfig = { providers: { [LLM_ID]: provider }, chain: [`${LLM_ID}:${LLM_ID}`] };
        const r = await chat(cfg, messages, signal, { temperature: 0.7 });
        return finish(r, `${basename(p.llmModel!).replace(/-Q\d.*$/i, "")}, своя видеокарта`);
      }
      const cfg = found!.cfg;
      if (stage.kind === "local") {
        for (const ref of stage.chain) {
          const id = ref.slice(0, ref.indexOf(":"));
          await ensureLocalServer(id, cfg.providers[id], signal);
        }
      }
      const r = await chat({ ...cfg, chain: stage.chain }, messages, signal, { temperature: 0.7 });
      return finish(r, `${stage.kind === "cloud" ? "облако" : "локальный сервис"}: ${r.model}`);
    } catch (e) {
      if (signal?.aborted) throw new Error("отменено");
      attempts.push(`${stage.kind === "own" ? "своя модель" : stage.kind === "cloud" ? "облако" : "локальный сервис"}: ${(e as Error).message}`);
    }
  }

  const hint = attempts.length
    ? attempts.join(" · ")
    : opts.allowCloud
      ? "нет ни настроенных сервисов ИИ, ни своей модели"
      : "нет локальной модели перевода. Разрешите облачные ИИ или поставьте переводчик в «Компонентах»";
  throw new Error(`Не удалось перевести: ${hint}`);
}

// ---------- озвучка ----------

interface RunResult { code: number | null; err: string }

/** Запуск программы с ограничением по времени и отменой; stdin — необязательный текст в UTF-8. */
function runProc(exe: string, args: string[], o: { cwd?: string; stdin?: string; signal?: AbortSignal; timeoutMs: number }): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (o.signal?.aborted) return reject(new Error("отменено"));
    const child = spawn(exe, args, { cwd: o.cwd, windowsHide: true, stdio: [o.stdin !== undefined ? "pipe" : "ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr?.on("data", (d: Buffer) => { err = (err + d.toString("utf8")).slice(-2000); });
    const kill = () => child.kill();
    const timer = setTimeout(() => { kill(); reject(new Error("Озвучка не уложилась во время — попробуйте фразу короче")); }, o.timeoutMs);
    const onAbort = () => { kill(); clearTimeout(timer); reject(new Error("отменено")); };
    o.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`Не удалось запустить ${basename(exe)}: ${e.message}`)); });
    child.on("close", (code) => { clearTimeout(timer); o.signal?.removeEventListener("abort", onAbort); resolve({ code, err }); });
    if (o.stdin !== undefined) {
      child.stdin?.on("error", () => { /* программа закрылась раньше — разберёмся по коду */ });
      child.stdin?.end(o.stdin, "utf8");
    }
  });
}

let counter = 0;

/** Озвучить фразу; результат — wav во временной папке (пока автор не оставит — в пак не попадает). */
export async function speak(baseDir: string, req: SpeakRequest, signal?: AbortSignal): Promise<string> {
  const text = req.text.trim();
  if (!text) throw new Error("Нет текста для озвучки");
  const p = await paths(baseDir);
  const outDir = join(tmpdir(), "ye-voice");
  await mkdir(outDir, { recursive: true });
  const out = join(outDir, `voice-${Date.now()}-${counter++}.wav`);

  if (req.engine === "gpu") {
    if (!p.llamaTts || !p.ttsModel || !p.ttsMmproj) throw new Error("Голос на видеокарте не установлен — поставьте в «Компонентах»");
    freeVram();
    // -n обязателен: модель иногда не останавливается сама
    const args = ["-m", p.ttsModel, "-mm", p.ttsMmproj, "-p", text, "--tts-lang", req.lang || "ru", "-o", out, "-n", "500"];
    if (req.speakerWav) args.push("--tts-speaker-file", req.speakerWav);
    const r = await runProc(p.llamaTts, args, { cwd: dirname(p.llamaTts), signal, timeoutMs: SPEAK_TIMEOUT_MS });
    if (r.code !== 0 || !existsSync(out)) throw new Error(`Голос на видеокарте не справился: ${r.err.trim().split("\n").pop() || `код ${r.code}`}`);
    return out;
  }

  if (!p.piper) throw new Error("Голос на процессоре не установлен — поставьте Piper в «Компонентах»");
  const voice = p.piperVoices.find((v) => v.id === req.piperVoice)
    ?? p.piperVoices.find((v) => v.id === piperVoiceForLang(req.lang))
    ?? p.piperVoices.find((v) => v.lang === req.lang);
  if (!voice) throw new Error(`Нет голоса Piper для языка «${targetLangTitle(req.lang)}» — поставьте нужный в «Компонентах»`);
  const speed = req.speed && req.speed > 0 ? req.speed : 1;
  const args = ["-m", voice.onnx, "-f", out, "--length_scale", String(Math.round((1 / speed) * 100) / 100)];
  const r = await runProc(p.piper, args, { cwd: dirname(p.piper), stdin: text, signal, timeoutMs: SPEAK_TIMEOUT_MS });
  if (r.code !== 0 || !existsSync(out)) throw new Error(`Piper не справился: ${r.err.trim().split("\n").pop() || `код ${r.code}`}`);
  return out;
}

function targetLangTitle(lang: string): string {
  return { ru: "русский", en: "английский", de: "немецкий", it: "итальянский", es: "испанский", fr: "французский", ja: "японский" }[lang] ?? lang;
}

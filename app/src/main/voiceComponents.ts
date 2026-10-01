// Где лежат компоненты «Перевод и голос»: сервер llama, модель голоса, Piper, голоса, модель перевода.
// Ничего не запускает и не качает — только смотрит на диск (exists можно подменить в тесте).

import { existsSync } from "node:fs";
import { join } from "node:path";
import { PIPER_VOICES, TTS_MMPROJ_FILE, VOICE_TOOL_MAIN } from "../core/components/voices";

export interface TtsPaths {
  /** llama-server.exe: CUDA-сборка, иначе Vulkan. */
  llamaServer?: string;
  /** llama-tts.exe — есть только в CUDA-сборке (папка llama). */
  llamaTts?: string;
  /** Папка, из которой запускать llama-server (рядом dll). */
  llamaDir?: string;
  ttsModel?: string;
  ttsMmproj?: string;
  piper?: string;
  /** Поставленные голоса Piper (только те, чей .onnx на диске). */
  piperVoices: { id: string; lang: string; name: string; onnx: string }[];
  /** Модель перевода: Qwen3 из картинок (8B раньше 4B), иначе компонент llm-model. */
  llmModel?: string;
  /** Откуда взята llmModel. */
  llmSource?: "images" | "component";
  /** Модель, поставленная как компонент llm-model (если стоит, независимо от llmModel). */
  llmModelComponent?: string;
}

/**
 * Найти пути голосового раздела.
 * @param imageModelDirs папки моделей картинок, где может лежать Qwen3 (`<папка>/models/text_encoders`):
 *   у профиля из приложения это `<components>/model` (добавляется само), у «своей папки» —
 *   cwd провайдера sd; вызывающий передаёт её здесь.
 */
export function ttsPaths(componentsDir: string, imageModelDirs: string[] = [], exists: (p: string) => boolean = existsSync): TtsPaths {
  const at = (tool: string) => join(componentsDir, tool, VOICE_TOOL_MAIN[tool]);
  const out: TtsPaths = { piperVoices: [] };

  const cuda = at("llama"), vk = at("llama-vulkan");
  if (exists(cuda)) { out.llamaServer = cuda; out.llamaDir = join(componentsDir, "llama"); }
  else if (exists(vk)) { out.llamaServer = vk; out.llamaDir = join(componentsDir, "llama-vulkan"); }
  const tts = join(componentsDir, "llama", "llama-tts.exe");
  if (exists(tts)) out.llamaTts = tts;

  const model = at("tts-model"), mm = join(componentsDir, "tts-model", TTS_MMPROJ_FILE);
  if (exists(model) && exists(mm)) { out.ttsModel = model; out.ttsMmproj = mm; }

  const piper = at("piper");
  if (exists(piper)) out.piper = piper;
  for (const v of PIPER_VOICES) {
    const onnx = at(v.id);
    if (exists(onnx)) out.piperVoices.push({ id: v.id, lang: v.lang, name: v.title, onnx });
  }

  const comp = at("llm-model");
  if (exists(comp)) out.llmModelComponent = comp;
  const dirs = [join(componentsDir, "model"), ...imageModelDirs];
  for (const d of dirs) {
    for (const n of ["Qwen3-8B-Q4_K_M.gguf", "Qwen3-4B-Q4_K_M.gguf"]) {
      const p = join(d, "models", "text_encoders", n);
      if (!out.llmModel && exists(p)) { out.llmModel = p; out.llmSource = "images"; }
    }
  }
  if (!out.llmModel && out.llmModelComponent) { out.llmModel = out.llmModelComponent; out.llmSource = "component"; }
  return out;
}

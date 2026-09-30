// Голоса Piper из манифеста: id компонента, язык, подпись и имя .onnx. Чистые данные —
// их читают и main (поиск файлов), и окно «Компоненты» (список галочек).

export interface PiperVoiceInfo {
  /** id программы-компонента в манифесте (и имя папки в components). */
  id: string;
  /** Код языка, как его понимает озвучка: ru, it, es, de, fr, en. */
  lang: string;
  /** Подпись для окна. */
  title: string;
  /** Имя модели внутри папки компонента. */
  onnx: string;
}

export const PIPER_VOICES: PiperVoiceInfo[] = [
  { id: "piper-ru-irina", lang: "ru", title: "Русский, Ирина", onnx: "ru_RU-irina-medium.onnx" },
  { id: "piper-ru-dmitri", lang: "ru", title: "Русский, Дмитрий", onnx: "ru_RU-dmitri-medium.onnx" },
  { id: "piper-it-paola", lang: "it", title: "Итальянский, Паола (для латыни)", onnx: "it_IT-paola-medium.onnx" },
  { id: "piper-es-davefx", lang: "es", title: "Испанский, Дэйв", onnx: "es_ES-davefx-medium.onnx" },
  { id: "piper-de-thorsten", lang: "de", title: "Немецкий, Торстен", onnx: "de_DE-thorsten-medium.onnx" },
  { id: "piper-fr-siwis", lang: "fr", title: "Французский, Сивис", onnx: "fr_FR-siwis-medium.onnx" },
  { id: "piper-en-lessac", lang: "en", title: "Английский, Лессак", onnx: "en_US-lessac-medium.onnx" },
];

/** Главные файлы программ голосового раздела — от папки программы. */
export const VOICE_TOOL_MAIN: Record<string, string> = {
  llama: "llama-server.exe",
  "llama-vulkan": "llama-server.exe",
  "tts-model": "Qwen3-TTS-12Hz-1.7B-Base-Q4_K_M.gguf",
  "llm-model": "Qwen3-4B-Q4_K_M.gguf",
  piper: "piper.exe",
  ...Object.fromEntries(PIPER_VOICES.map((v) => [v.id, v.onnx])),
};

export const TTS_MMPROJ_FILE = "mmproj-Qwen3-TTS-12Hz-1.7B-Base-Q8_0.gguf";

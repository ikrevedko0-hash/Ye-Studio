// Цели перевода и озвучки для «Перевод + озвучка». Чистые данные, без Electron.

export type TargetId = "none" | "la" | "en" | "de" | "it" | "es" | "fr" | "ja" | "custom";

export interface TargetLang {
  id: TargetId;
  /** Подпись в окне. */
  title: string;
  /** Как назвать язык модели в промпте (английский). Пусто — перевода нет. */
  promptName: string;
  /** Язык озвучки Qwen3-TTS (`--tts-lang`): у латыни своего нет — читаем как итальянский. */
  ttsLang: string;
  /** Папка голоса Piper (tool `piper-<язык>-<имя>`), с которого начинаем; undefined — голоса Piper нет. */
  piperVoice?: string;
}

export const TARGETS: TargetLang[] = [
  { id: "none", title: "Без перевода", promptName: "", ttsLang: "ru", piperVoice: "piper-ru-irina" },
  { id: "la", title: "Латынь", promptName: "Latin", ttsLang: "it", piperVoice: "piper-it-paola" },
  { id: "en", title: "Английский", promptName: "English", ttsLang: "en", piperVoice: "piper-en-lessac" },
  { id: "de", title: "Немецкий", promptName: "German", ttsLang: "de", piperVoice: "piper-de-thorsten" },
  { id: "it", title: "Итальянский", promptName: "Italian", ttsLang: "it", piperVoice: "piper-it-paola" },
  { id: "es", title: "Испанский", promptName: "Spanish", ttsLang: "es", piperVoice: "piper-es-davefx" },
  { id: "fr", title: "Французский", promptName: "French", ttsLang: "fr", piperVoice: "piper-fr-siwis" },
  { id: "ja", title: "Японский", promptName: "Japanese", ttsLang: "ja" },
  // «Свой вариант»: инструкция по-русски («язык Йоды», «канцелярит», «гопник»); текст остаётся русским
  { id: "custom", title: "Свой вариант", promptName: "", ttsLang: "ru", piperVoice: "piper-ru-irina" },
];

export function targetById(id: string): TargetLang {
  return TARGETS.find((t) => t.id === id) ?? TARGETS[0];
}

/** Языки озвучки, которые понимает Qwen3-TTS (для ручного выбора языка). */
export const TTS_LANGS: { id: string; title: string }[] = [
  { id: "ru", title: "Русский" }, { id: "en", title: "Английский" }, { id: "de", title: "Немецкий" },
  { id: "it", title: "Итальянский" }, { id: "es", title: "Испанский" }, { id: "fr", title: "Французский" },
  { id: "ja", title: "Японский" }, { id: "ko", title: "Корейский" }, { id: "zh", title: "Китайский" }, { id: "pt", title: "Португальский" },
];

/** Голос Piper по языку озвучки; для языков без голоса — undefined. */
export function piperVoiceForLang(lang: string): string | undefined {
  if (lang === "ru") return "piper-ru-irina";
  return TARGETS.find((t) => t.ttsLang === lang && t.piperVoice && t.id !== "la" && t.id !== "custom" && t.id !== "none")?.piperVoice;
}

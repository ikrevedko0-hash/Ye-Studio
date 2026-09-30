// Типы обмена окна с главным процессом для «Перевод + озвучка».

export type Engine = "gpu" | "piper";

export interface SpeakRequest {
  text: string;
  engine: Engine;
  /** Язык озвучки Qwen3-TTS (ru, en, de, it, es, fr, ja, …); у Piper выбирает голос, если piperVoice не задан. */
  lang: string;
  /** id голоса Piper, например «piper-it-paola». */
  piperVoice?: string;
  /** 1 — обычная скорость; у Piper это 1/length_scale. */
  speed?: number;
  /** Образец голоса для Qwen3-TTS (wav) — клонирование. */
  speakerWav?: string;
}

export interface VoiceState {
  /** Есть llama-tts, модель голоса и mmproj. */
  gpu: boolean;
  /** Есть piper.exe и хотя бы один голос. */
  piper: boolean;
  voices: { id: string; lang: string; title: string }[];
  translator: {
    /** Есть свой llama-server и модель. */
    own: boolean;
    /** Имя модели, например «Qwen3-8B». */
    model?: string;
    /** В providers.json есть локальные текстовые сервисы. */
    local: boolean;
  };
}

export interface TranslateResult {
  /** До трёх вариантов; для «Без перевода» — исходный текст одним вариантом. */
  variants: string[];
  /** Чем переведено — для подписи в окне. */
  via: string;
}

export interface VoiceSpeakResult {
  /** wav во временной папке — этот путь отдавать в voiceKeep. */
  path: string;
  /** Байты для предпросмотра: new Blob([data], { type: mime }) → URL.createObjectURL. */
  mime: string;
  data: Uint8Array;
}

export interface VoiceKeepInfo {
  /** Озвученный текст (по нему называется файл). */
  text: string;
  /** Русский оригинал — в запись библиотеки. */
  original?: string;
  engine: Engine;
  lang: string;
}

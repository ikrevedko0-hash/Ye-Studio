// Стили генерации для тем на картинках. Новый стиль — новая запись в списке, окно подхватит само.
// Инструкцию (системный промпт) автор видит и правит в окне; правки лежат в image-prompts.json
// в папке приложения, исходный текст остаётся здесь и возвращается кнопкой «Вернуть исходную».
//
// Модели картинок понимают русские идиомы плохо и склонны рисовать смысл, а не слова.
// Поэтому сначала текстовая модель превращает фразу в буквальное описание сцены по-английски,
// и уже его автор видит, правит и отдаёт в рисование.

import { readFileSync, writeFileSync } from "node:fs";
import { chat, type ChatResult } from "./chat";
import type { AiConfig } from "./config";

export interface ImagePreset {
  id: string;
  title: string;
  about: string;
  /** Пример фразы для подсказки в поле ввода. */
  example: string;
  /** Нет инструкции — фраза уходит в рисование как есть (автор пишет промпт сам). */
  system?: string;
  /** К сцене дописывается стиль, выбранный галочками в окне (imageStyles.ts). У «детского рисунка» стиль свой. */
  styled?: boolean;
  /** Инструкция из кода — к ней возвращает «Вернуть исходную». */
  defaultSystem?: string;
  /** Автор правил инструкцию в окне. */
  edited?: boolean;
}

const RULES =
  "Reply with ONLY the image prompt in English: 2-4 sentences, no preamble, no quotes, no lists. " +
  "The picture must contain NO text, letters, captions or signs, because players must guess the phrase. " +
  "Never write the original phrase itself in the prompt.";

const NO_TEXT = "No text, no letters, no words, no signature anywhere in the image.";

export const IMAGE_PRESETS: ImagePreset[] = [
  {
    id: "literal",
    title: "Поговорка по-ИИшному",
    about: "Фразеологизм или выражение, нарисованное дословно",
    example: "ядрёна вошь",
    styled: true,
    system:
      // Без жёстких запретов модель уходила в аллегории: на «без труда не выловишь и рыбку из пруда»
      // выдала «пустую оболочку рабочего, олицетворяющую отсутствие труда» — такое не нарисовать и не угадать.
      "You turn Russian idioms, sayings and set phrases into prompts for an image model. " +
      "Method: take the key nouns and verbs of the phrase in their most LITERAL, physical, everyday sense and build ONE simple scene " +
      "where those objects and actions are shown directly, as absurd reality. Ignore the figurative meaning completely. " +
      "Describe only concrete visible things: objects, creatures, people, their poses, actions, sizes, materials, place. " +
      "FORBIDDEN: symbols, metaphors, allegories, personification of ideas, emotions as abstractions, words like " +
      "'representing', 'symbolizing', 'embodying', 'absence of', 'concept of'; hollow shells, ghosts or silhouettes standing for ideas. " +
      "Examples: «ядрёна вошь» → a gigantic louse towering over a city, a nuclear mushroom cloud exploding right behind it. " +
      "«вешать лапшу на уши» → a man calmly hanging long wet noodles over another man's ears with his fingers. " +
      "«когда рак на горе свистнет» → a red crayfish standing on a snowy mountain peak, whistling with two claws in its mouth. " +
      "The 1-3 key objects must be large, centered and instantly recognizable; the background must not distract from them. " +
      "Make the scene vivid: exaggerate sizes, give creatures and people expressive poses and faces. " +
      // Стиль выбирает автор галочками в окне, и приложение дописывает его само (imageStyles.ts):
      // так смена стиля не требует новой сцены. Свой стиль модели только спорил бы с выбранным.
      "Do NOT mention any art style, medium, rendering, lighting or camera — the style is added separately. " +
      RULES,
  },
  {
    id: "kids",
    title: "Фильм по детскому рисунку",
    about: "Узнаваемая сцена фильма, мультфильма или книги, нарисованная ребёнком",
    example: "Титаник",
    system:
      "You turn a Russian or international film, cartoon or book title into a prompt for an image model. " +
      "Pick the single most iconic, instantly recognizable scene or character of that work and describe it as " +
      "a drawing by a 6-year-old child: wax crayons and felt-tip pens on white paper, wobbly lines, naive proportions, " +
      "bright uneven colouring, scribbled sun in the corner. Describe concrete visual details that make it guessable. " +
      RULES,
  },
  {
    id: "free",
    title: "Свой промпт",
    about: "Описание сцены пишете сами (лучше по-английски), текстовая модель не нужна",
    example: "a cat wearing a crown sitting on a throne made of fish",
    styled: true,
  },
];

let promptsFile = "";

export function setPromptsFile(path: string): void {
  promptsFile = path;
}

/** Правки автора: id стиля → инструкция. Файла нет или он битый — правок нет. */
function edits(): Record<string, string> {
  if (!promptsFile) return {};
  try {
    return JSON.parse(readFileSync(promptsFile, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

export function presetInfos(): ImagePreset[] {
  const own = edits();
  return IMAGE_PRESETS.map((p) => {
    if (!p.system) return p;
    const text = own[p.id]?.trim();
    return { ...p, defaultSystem: p.system, system: text || p.system, edited: !!text && text !== p.system };
  });
}

/** Сохранить инструкцию стиля. Пустая или совпала с исходной — правка удаляется. */
export function savePresetPrompt(id: string, text: string | null): ImagePreset[] {
  const base = IMAGE_PRESETS.find((p) => p.id === id);
  if (!base?.system) throw new Error("у этого стиля нет инструкции");
  if (!promptsFile) throw new Error("не задан файл для инструкций");
  const own = edits();
  const t = text?.trim();
  if (t && t !== base.system) own[id] = t;
  else delete own[id];
  writeFileSync(promptsFile, JSON.stringify(own, null, 1));
  return presetInfos();
}

/** Фраза → промпт для рисования. У «своего промпта» возвращаем фразу как есть. */
export async function phraseToPrompt(cfg: AiConfig, phrase: string, presetId: string, signal?: AbortSignal, temperature?: number): Promise<ChatResult> {
  const all = presetInfos();
  const preset = all.find((p) => p.id === presetId) ?? all[0];
  if (!preset.system) return { text: phrase.trim(), model: "", skipped: [] };
  const r = await chat(cfg, [
    { role: "system", content: preset.system },
    { role: "user", content: phrase.trim() },
  ], signal, { temperature });
  // Запрет на надписи текстовая модель помнит, но в промпт почти никогда не пишет, а без него
  // модель рисования охотно ставит подпись («Jack» у воды на «Титанике») — и та выдаёт ответ.
  const text = r.text.replace(/^["«']+|["»']+$/g, "").trim();
  return { ...r, text: /no text/i.test(text) ? text : `${text} ${NO_TEXT}` };
}

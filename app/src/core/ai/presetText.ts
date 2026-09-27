// Пресеты картинок: встроенные и свои — одна структура. Модуль без файлов и сети: его читают и главный
// процесс (сцена для рисования), и окно (редактор пресета показывает итоговую инструкцию целиком).
//
// Модели картинок понимают русские идиомы плохо и склонны рисовать смысл, а не слова. Поэтому в режиме
// «модель» текстовая модель сначала превращает фразу в буквальную английскую сцену, а уже её автор видит,
// правит и отдаёт в рисование. В режиме «шаблон» модель не нужна: фраза подставляется в текст автора.

/** model — сцену пишет текстовая модель по инструкции; template — текст автора с {фраза}. */
export type PresetMode = "model" | "template";
/** picks — галочки стилей (imageStyles.ts), own — свой английский текст стиля, none — без стиля. */
export type PresetStyleMode = "picks" | "own" | "none";
/** Подсказки при наборе фразы: фильмы и книги (Wikidata) или словарь поговорок (Викисловарь). */
export type PresetSuggest = "none" | "works" | "phrases";

export interface PresetExample { phrase: string; scene: string }
export interface PresetWord { word: string; en: string }

export interface ImagePreset {
  id: string;
  title: string;
  about: string;
  /** Пример фразы — подсказка в поле ввода. */
  example: string;
  mode: PresetMode;
  /** Ядро инструкции (режим model): примеры, словарь уточнений и общие правила дописываются сами. */
  system: string;
  examples: PresetExample[];
  /** Слова, которые модель переводит неточно: «бензопила» → «saw», и flux рисует ножовку. */
  glossary: PresetWord[];
  /** Режим template: текст сцены, {фраза} заменяется на фразу. Пусто — сцену автор пишет каждый раз сам. */
  template: string;
  styleMode: PresetStyleMode;
  /** Начальные галочки стилей. Пусто — последние отмеченные в окне. */
  styles: string[];
  styleText: string;
  /** Начальный размер (id из списка окна) и «Фантазия». Не заданы — последние выбранные. */
  size?: string;
  temperature?: number;
  suggest: PresetSuggest;
  /** Дописывать к сцене запрет подписей. */
  noText: boolean;
  /** Встроенный: не удаляется, правки хранятся поверх исходного. */
  builtin?: boolean;
  /** Встроенный изменён автором — есть «Вернуть исходный». */
  edited?: boolean;
}

export const NO_TEXT = "No text, no letters, no words, no signature anywhere in the image.";

/** Общие правила любой инструкции: автор их видит в «итоговой инструкции», но не правит. */
const RULES =
  "Reply with ONLY the image prompt in English: 2-4 sentences, no preamble, no quotes, no lists. " +
  "The picture must contain NO text, letters, captions or signs, because players must guess the phrase. " +
  "Never write the original phrase itself in the prompt.";

// На «Техасскую резню бензопилой» модель раз за разом писала «saw», и flux рисовал ножовку:
// модель рисования понимает каждое слово буквально, поэтому предмет нужен точным словом с приметой.
const PRECISION =
  "Name every object with its precise, unambiguous English noun and add a visible distinguishing detail, " +
  "because the image model takes every word literally: 'a motorized chainsaw with an engine and a long toothed chain', " +
  "never just 'saw'; 'a wooden baseball bat', never just 'bat'. Avoid short ambiguous nouns (saw, bat, crane, bow, glasses, " +
  "mouse, pipe, trunk, club) unless you add what exactly is meant.";

/** Стиль дописывает приложение: свой стиль модели только спорил бы с выбранным. */
const NO_STYLE = "Do NOT mention any art style, medium, rendering, lighting or camera — the style is added separately.";

/** Ловушки перевода, известные по опыту: общие для встроенных пресетов, автор дополняет своими. */
const COMMON_GLOSSARY: PresetWord[] = [
  { word: "бензопила", en: "a motorized chainsaw with an engine and a long toothed chain" },
  { word: "пила", en: "a hand saw" },
  { word: "бита", en: "a wooden baseball bat" },
  { word: "летучая мышь", en: "a bat, the flying animal with leathery wings" },
  { word: "подъёмный кран", en: "a tall construction tower crane" },
  { word: "кран (водопроводный)", en: "a water tap" },
  { word: "ружьё", en: "a long hunting rifle" },
];

/** Значения по умолчанию: из них собирается и новый пресет, и недостающие поля старых файлов. */
export function blankPreset(id: string): ImagePreset {
  return {
    id, title: "Мой пресет", about: "", example: "", mode: "template", system: "", examples: [], glossary: [],
    template: "", styleMode: "picks", styles: [], styleText: "", suggest: "none", noText: true,
  };
}

export const BUILTIN_PRESETS: ImagePreset[] = [
  {
    ...blankPreset("literal"),
    title: "Поговорка по-ИИшному",
    about: "Фразеологизм или выражение, нарисованное дословно",
    example: "ядрёна вошь",
    mode: "model",
    suggest: "phrases",
    // Без жёстких запретов модель уходила в аллегории: на «без труда не выловишь и рыбку из пруда»
    // выдала «пустую оболочку рабочего, олицетворяющую отсутствие труда» — такое не нарисовать и не угадать.
    system:
      "You turn Russian idioms, sayings and set phrases into prompts for an image model. " +
      "Method: take the key nouns and verbs of the phrase in their most LITERAL, physical, everyday sense and build ONE simple scene " +
      "where those objects and actions are shown directly, as absurd reality. Ignore the figurative meaning completely. " +
      "Describe only concrete visible things: objects, creatures, people, their poses, actions, sizes, materials, place. " +
      "FORBIDDEN: symbols, metaphors, allegories, personification of ideas, emotions as abstractions, words like " +
      "'representing', 'symbolizing', 'embodying', 'absence of', 'concept of'; hollow shells, ghosts or silhouettes standing for ideas. " +
      "The 1-3 key objects must be large, centered and instantly recognizable; the background must not distract from them. " +
      "Make the scene vivid: exaggerate sizes, give creatures and people expressive poses and faces.",
    examples: [
      { phrase: "ядрёна вошь", scene: "a gigantic louse towering over a city, a nuclear mushroom cloud exploding right behind it" },
      { phrase: "вешать лапшу на уши", scene: "a man calmly hanging long wet noodles over another man's ears with his fingers" },
      { phrase: "когда рак на горе свистнет", scene: "a red crayfish standing on a snowy mountain peak, whistling with two claws in its mouth" },
    ],
    glossary: COMMON_GLOSSARY,
    builtin: true,
  },
  {
    ...blankPreset("kids"),
    title: "Фильм по детскому рисунку",
    about: "Узнаваемая сцена фильма, мультфильма или книги, нарисованная ребёнком",
    example: "Титаник",
    mode: "model",
    suggest: "works",
    // На «Солнцестояние» модель нарисовала солнце над лугом: название совпало с обычным словом, а про
    // Midsommar (2019) она не вспомнила. Поэтому сперва — назвать произведение (строка WORK: уходит
    // в окно подписью «узнала: …», автор сразу видит промах), и только потом сцена именно из него.
    system:
      "The user gives you the title of a REAL film, cartoon, TV series or book, usually as it was released in Russia. " +
      "It is ALWAYS a title, even when it looks like an ordinary word: never illustrate the dictionary meaning of the word. " +
      "Step 1: identify the exact work. Russian release titles are often loose translations of the original " +
      "(«Солнцестояние» is Midsommar, 2019, Ari Aster; «Сияние» is The Shining, 1980, Stanley Kubrick). " +
      "If several works share the title, pick the most famous film. A hint in parentheses from the user " +
      "(a year, an original title, a director) overrides your guess. " +
      "Step 2: pick what is unique to THIS work and instantly recognizable from its poster or most famous scene: " +
      "the main character's look and costume, a signature object, creature or place. Avoid generic genre imagery " +
      "that fits many films. " +
      // «Простая сцена» не помогала: модель описывала позы, мимику и одежду, и рисунок выходил как из художки
      "Step 3: describe the scene the way an 8-9-year-old child would plan the drawing, not the way the film shows it: " +
      "flat side view, no perspective, no shadows, no facial expressions beyond a dot-eyed smile or frown. " +
      "People are stiff stick-like figures standing in a row facing the viewer, arms straight out; the key object is huge " +
      "and out of scale. Add ONE odd obsessive detail the child is fixated on, drawn carefully and repeated many times " +
      "(every porthole of the ship, every tooth of the chain, every petal), while everything else stays crude. " +
      "1-3 figures and one signature object, nothing else in the background except a sky strip and a sun in the corner. " +
      "Output format: the FIRST line is exactly `WORK: <original title> (<year>, <director or author>)`, " +
      "then a new line with the image prompt. The WORK line is the only allowed exception to the rules below " +
      "(the app removes it before drawing).",
    examples: [
      { phrase: "Солнцестояние", scene: "a stick-figure girl in a triangle dress with a giant flower crown, tears drawn as blue drops, five identical stick figures in white triangles standing in a row next to a tall pole with ribbons, every flower of the crown drawn separately with exactly five petals" },
      { phrase: "Титаник", scene: "a huge flat side view of a ship with four striped funnels and dozens of identical round portholes in perfect rows, two tiny stick figures with arms straight out on the pointy front, a white triangle iceberg ahead" },
      { phrase: "Ёжик в тумане", scene: "a round hedgehog with dozens of identical straight spikes carrying a little bundle on a stick, grey scribbled fog around him, a white horse head sticking out of the fog" },
      { phrase: "Техасская резня бензопилой", scene: "a big stick-figure man with a square mask face and an apron holding a motorized chainsaw bigger than himself, every tooth of the chain drawn one by one, a square house with a triangle roof behind him" },
    ],
    glossary: COMMON_GLOSSARY,
    // детский рисунок — свой стиль: приложение дописывает его к сцене, как галочки у других пресетов
    styleMode: "own",
    styleText:
      "Style: a clumsy amateur drawing by an 8-year-old third-grader on a page torn from a squared school notebook: " +
      "blue ballpoint pen outlines and a few colored pencils, pressure uneven, colouring scribbled in one direction and going over the lines, " +
      "eraser smudges and a crossed-out attempt, stick-figure people with circle heads and dot eyes, no perspective, no shading, " +
      "wrong proportions, rigid symmetry, one small detail repeated obsessively. Not a stylized illustration, not skilled, not cute: " +
      "it must look genuinely made by a child who cannot draw well. Photo of the real notebook page.",
    builtin: true,
  },
  {
    ...blankPreset("free"),
    title: "Свой промпт",
    about: "Описание сцены пишете сами (лучше по-английски), текстовая модель не нужна",
    example: "a cat wearing a crown sitting on a throne made of fish",
    builtin: true,
  },
];

/** Итоговая инструкция текстовой модели: ядро автора + примеры + словарь уточнений + общие правила. */
export function assembleSystem(p: ImagePreset): string {
  const parts = [p.system.trim()];
  const ex = p.examples.filter((e) => e.phrase.trim() && e.scene.trim());
  if (ex.length) parts.push(`Examples: ${ex.map((e) => `«${e.phrase.trim()}» → ${e.scene.trim()}.`).join(" ")}`);
  const words = p.glossary.filter((w) => w.word.trim() && w.en.trim());
  if (words.length) {
    parts.push(`When the phrase or the scene involves these things, name them exactly like this: ${words.map((w) => `«${w.word.trim()}» = ${w.en.trim()}`).join("; ")}.`);
  }
  parts.push(PRECISION);
  if (p.styleMode !== "none") parts.push(NO_STYLE);
  parts.push(RULES);
  return parts.filter(Boolean).join("\n\n");
}

/** Шаблон: {фраза} (и {phrase}) → фраза. Без подстановки — текст как есть. */
export function fillTemplate(template: string, phrase: string): string {
  return template.replace(/\{(фраза|phrase)\}/gi, phrase.trim()).trim();
}

/** Промпт автора → шаблон: фраза в тексте становится {фраза}. */
export function toTemplate(prompt: string, phrase: string): string {
  const p = phrase.trim();
  if (!p) return prompt.trim();
  return prompt.trim().split(p).join("{фраза}");
}

/** Шаблон → пресет-инструкция: текст автора становится образцом сцены для модели. */
export function templateToModel(p: ImagePreset): ImagePreset {
  const sample = p.template.trim();
  const base =
    "You turn the user's phrase into a prompt for an image model. Build a scene in the same spirit, composition and level of detail " +
    "as the examples, but about the user's phrase.";
  // есть пример фразы — образец идёт примером «фраза → сцена», иначе — прямо в инструкцию
  if (p.example.trim() && sample) {
    return { ...p, mode: "model", system: base, examples: [{ phrase: p.example.trim(), scene: fillTemplate(sample, p.example) }, ...p.examples] };
  }
  return { ...p, mode: "model", system: sample ? `${base}\nSample scene: ${fillTemplate(sample, "<the phrase>")}` : base };
}

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);

/** Пресет из файла: чужие поля отбрасываем, недостающие — по умолчанию. Битый — null. */
export function normalizePreset(raw: unknown, base?: ImagePreset): ImagePreset | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, base?.id ?? "");
  if (!id) return null;
  const d = base ?? blankPreset(id);
  const list = <T>(v: unknown, keys: (keyof T)[], fallback: T[]): T[] =>
    Array.isArray(v)
      ? v.filter((x) => x && typeof x === "object").map((x) => Object.fromEntries(keys.map((k) => [k, str((x as Record<string, unknown>)[k as string])])) as T)
      : fallback;
  const pick = <T extends string>(v: unknown, allowed: T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
  const num = (v: unknown, fallback?: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  return {
    id,
    title: str(r.title, d.title).trim() || d.title,
    about: str(r.about, d.about),
    example: str(r.example, d.example),
    mode: pick(r.mode, ["model", "template"], d.mode),
    system: str(r.system, d.system),
    examples: list<PresetExample>(r.examples, ["phrase", "scene"], d.examples),
    glossary: list<PresetWord>(r.glossary, ["word", "en"], d.glossary),
    template: str(r.template, d.template),
    styleMode: pick(r.styleMode, ["picks", "own", "none"], d.styleMode),
    styles: Array.isArray(r.styles) ? r.styles.filter((x): x is string => typeof x === "string") : d.styles,
    styleText: str(r.styleText, d.styleText),
    size: typeof r.size === "string" ? r.size : d.size,
    temperature: num(r.temperature, d.temperature),
    suggest: pick(r.suggest, ["none", "works", "phrases"], d.suggest),
    noText: typeof r.noText === "boolean" ? r.noText : d.noText,
    builtin: d.builtin,
  };
}

/** Поля, которыми пресеты различаются по сути, — для сравнения «изменён ли встроенный». */
const CONTENT_KEYS: (keyof ImagePreset)[] = [
  "title", "about", "example", "mode", "system", "examples", "glossary", "template",
  "styleMode", "styles", "styleText", "size", "temperature", "suggest", "noText",
];

export function sameContent(a: ImagePreset, b: ImagePreset): boolean {
  // по списку полей, а не JSON.stringify целиком: порядок ключей у встроенных и прочитанных из файла разный
  return CONTENT_KEYS.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
}

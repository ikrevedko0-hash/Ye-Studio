// Источники тематических списков слов.
//
// Зачем они. Обычный словарь знает нарицательные слова и не знает Красноярск, «Матрицу» и таллий.
// А тема в паке — это почти всегда категория: города, страны, фильмы, химические элементы.
// Поэтому слова для головоломки берутся не из словаря, а из источника по теме.
//
// Источник — такой же подключаемый кусок, как источник медиа: новый файл рядом, реестр не трогаем.

export interface ThemeWordsQuery {
  /** Сколько слов вернуть. */
  limit: number;
  /** Ограничение длины: слишком короткие не загадать, слишком длинные не разгадать. */
  minLen: number;
  maxLen: number;
  /** Набор или тема — что именно значит, решает сам источник. */
  preset?: string;
  /** Свободный текст: список автора или название категории. */
  text?: string;
}

export interface ThemeWord {
  word: string;
  /** Чем известнее, тем выше: по этому полю выдача сортируется. */
  fame?: number;
  /** Пояснение для автора: откуда слово. */
  note?: string;
}

export interface ThemeWords {
  title: string;
  words: ThemeWord[];
}

export interface SourcePreset {
  value: string;
  title: string;
}

export interface WordSource {
  id: string;
  title: string;
  about: string;
  /** Готовые наборы, если они есть. */
  presets?: SourcePreset[];
  /** Нужен ли источнику текст от автора. */
  needsText?: boolean;
  list(q: ThemeWordsQuery, signal?: AbortSignal): Promise<ThemeWords>;
}

// Куда положить результат «Перевод + озвучка»: что в вопрос, что в ответ. Чистые функции над моделью пака —
// окно применяет их теми же средствами, что и обычное добавление медиа (appendMedia, setItems).

import { appendMedia } from "../siq/helpers";
import type { ContentItem } from "../siq/model";

export interface PlacementOptions {
  /** Озвучка играет в вопросе. */
  soundInQuestion: boolean;
  /** Переведённый текст виден на экране в вопросе. */
  textOnScreen: boolean;
  /** Оригинал (русская фраза) — правильный ответ. */
  originalToAnswer: boolean;
  /** Озвучка ещё и в блоке «Медиа в ответе». */
  soundInAnswer: boolean;
}

export interface PlacementData {
  /** Переведённый (выбранный и, возможно, поправленный) текст. */
  translated: string;
  /** Русский оригинал. */
  original: string;
  /** Имя аудиофайла в паке (MediaInfo.name); пусто — озвучки нет. */
  audioName?: string;
}

export interface Placement {
  /** Дописать в параметр question: сначала текст, затем звук. */
  question: ContentItem[];
  /** Дописать в параметр answer. */
  answer: ContentItem[];
  /** Правильный ответ (в q.right); undefined — не трогать. */
  right?: string;
}

const audioItem = (name: string): ContentItem => ({ type: "audio", isRef: "True", value: name });

export function planPlacement(o: PlacementOptions, d: PlacementData): Placement {
  const question: ContentItem[] = [];
  const answer: ContentItem[] = [];
  if (o.textOnScreen && d.translated.trim()) question.push({ value: d.translated.trim() });
  if (o.soundInQuestion && d.audioName) question.push(audioItem(d.audioName));
  if (o.soundInAnswer && d.audioName) answer.push(audioItem(d.audioName));
  return { question, answer, right: o.originalToAnswer && d.original.trim() ? d.original.trim() : undefined };
}

/**
 * Применить план к списку элементов параметра (question или answer). Текст встаёт в конец,
 * звук — через appendMedia: он выходит перед текстом на один экран с ним (играет, пока текст на экране).
 */
export function applyToItems(items: ContentItem[], added: ContentItem[]): ContentItem[] {
  const text = added.filter((it) => (it.type ?? "text") === "text");
  const media = added.filter((it) => (it.type ?? "text") !== "text");
  return appendMedia([...items, ...text], media);
}

/** Правильные ответы: пустую заготовку заменяем, повтор не добавляем. */
export function applyRight(right: string[], answer: string | undefined): string[] {
  if (!answer) return right;
  const filled = right.filter((a) => a.trim() !== "");
  if (filled.some((a) => a.trim().toLowerCase() === answer.toLowerCase())) return right;
  return [...filled, answer];
}

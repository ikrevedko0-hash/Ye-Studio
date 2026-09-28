// Вопросы с вариантами ответа: сколько места SIOnline (экран игроков в браузере и на телефоне) отдаст картинке.
//
// Движок SIGame сообщает столу весь экранный контент вопроса (QuestionEngine → LAYOUT ANSWER_OPTIONS
// «image|text.18»), а SIOnline (messageProcessor.ts) делит высоту между ним и кнопками по весам:
//   кнопки — число их рядов (4 варианта — 2 ряда);
//   содержимое — если на экране есть хоть какой-то текст, max(1, длина/80), иначе 5.
// Картинка с короткой подписью весит 1 против 2 у кнопок — треть высоты, какого бы размера она ни была;
// без текста — 5 против 2. Текст, помеченный репликой ведущего (placement="replic"), в расчёт не входит:
// его показывает строка ведущего над столом. Проверено прогоном в настоящем SIGame + SIOnline.

import type { ContentItem, Package, Param, Question } from "./model";

const VISUAL = new Set(["image", "video", "html"]);

const isSelect = (q: Question) => (q.params ?? []).some((p) => p.name === "answerType" && (p.text ?? "").trim() === "select");

/** Контент вопроса, который видят на экране (параметр question). */
function questionItems(q: Question): ContentItem[] {
  const p = (q.params ?? []).find((x) => x.name === "question");
  return (p?.children ?? []).flatMap((c) => (c.kind === "item" ? [c.item] : []));
}

const onScreen = (it: ContentItem) => !it.placement || it.placement === "screen";
const isText = (it: ContentItem) => !it.type || it.type === "text";

/** Кнопки вариантов съедят картинку: вопрос с вариантами, на экране — картинка (видео) и текст. */
export function optionsSqueezeVisual(q: Question): boolean {
  if (!isSelect(q)) return false;
  const screen = questionItems(q).filter(onScreen);
  return screen.some((it) => VISUAL.has(it.type ?? "")) && screen.some((it) => isText(it) && it.value.trim() !== "");
}

export interface OptionsSpot { round: number; theme: number; question: number }

export function findOptionsSqueeze(pkg: Package): OptionsSpot[] {
  const out: OptionsSpot[] = [];
  (pkg.rounds ?? []).forEach((r, round) => r.themes?.forEach((t, theme) => t.questions?.forEach((q, question) => {
    if (optionsSqueezeVisual(q)) out.push({ round, theme, question });
  })));
  return out;
}

/** Текст экрана таких вопросов — репликой ведущего. Меняет пак на месте, возвращает, сколько вопросов поправлено. */
export function optionsTextToReplic(pkg: Package): number {
  let n = 0;
  for (const r of pkg.rounds ?? []) for (const t of r.themes ?? []) for (const q of t.questions ?? []) {
    if (!optionsSqueezeVisual(q)) continue;
    const p = (q.params ?? []).find((x: Param) => x.name === "question")!;
    for (const c of p.children) if (c.kind === "item" && onScreen(c.item) && isText(c.item) && c.item.value.trim() !== "") c.item.placement = "replic";
    n++;
  }
  return n;
}

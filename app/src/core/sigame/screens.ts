// Когда снимать экран: движок SIGame выводит вопрос сериями сообщений CONTENT… (экран), потом ответ.
// Снимок делаем в конце каждой серии — там, где игрок видит экран целиком, — и на показе правильного ответа.

import type { QuestionMark, RecordedMessage } from "./protocol";

export interface Screen {
  /** Номер вопроса в questions раунда. */
  question: number;
  /** До этого сообщения включительно столу уже всё отдано. */
  at: number;
  part: "question" | "answer";
  /** Порядковый номер экрана внутри части, с 1. */
  n: number;
}

const CONTENT = /^(CONTENT|CONTENT2|CONTENT_APPEND|CONTENT_SHAPE|CONTENT_STATE|LAYOUT|ATOM_HINT)(\n|$)/;
const ANSWER_START = /^(RIGHT_ANSWER_START|RIGHTANSWER)(\n|$)/;
/** Больше экранов на вопрос не снимаем: у поочерёдного текста их могут быть десятки. */
export const MAX_SCREENS_PER_PART = 4;

const text = (m: RecordedMessage | undefined) => (m ? m[1] : "");

export function questionScreens(messages: RecordedMessage[], q: QuestionMark, index: number): Screen[] {
  if (q.start < 0) return [];
  const end = q.end >= 0 ? q.end : messages.length - 1;
  const out: Screen[] = [];
  let part: Screen["part"] = "question";
  const count = { question: 0, answer: 0 };
  const push = (at: number) => {
    count[part]++;
    const s: Screen = { question: index, at, part, n: count[part] };
    const same = out.filter((o) => o.part === part);
    // лишние экраны части: оставляем первые и последний — последний заменяет предыдущий «последний»
    if (same.length >= MAX_SCREENS_PER_PART) out.splice(out.indexOf(same[same.length - 1]), 1);
    out.push(s);
  };
  for (let i = q.start; i <= end; i++) {
    const t = text(messages[i]);
    if (ANSWER_START.test(t)) {
      part = "answer";
      // ответ текстом (RIGHTANSWER) без медиа следом — это и есть экран ответа
      if (t.startsWith("RIGHTANSWER") && !CONTENT.test(text(messages[i + 1]))) push(i);
      continue;
    }
    if (CONTENT.test(t) && (i === end || !CONTENT.test(text(messages[i + 1])))) push(i);
  }
  return out;
}

export function roundScreens(messages: RecordedMessage[], questions: QuestionMark[]): Screen[] {
  return questions.flatMap((q, i) => questionScreens(messages, q, i));
}

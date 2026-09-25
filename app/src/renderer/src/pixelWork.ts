// Замена картинок вопросов обработанными (крупные пиксели, проявление) с бережным оригиналом:
// оригинал ложится в ответ, если ответ пустой; иначе — в source/ рядом с паком, а из пака уходит,
// когда на него больше никто не ссылается (чтобы пак не таскал лишний вес).

import { isMediaUsed, replaceQuestionImage } from "../../core/siq/helpers";
import type { ContentItem, Package } from "../../core/siq/model";
import type { PackDTO } from "../../shared/api";
import type { Mutate } from "./App";

export interface ReplaceJob {
  round: number;
  theme: number;
  question: number;
  /** картинка в Images, которую меняем */
  name: string;
  items: ContentItem[];
}

export interface ReplaceResult {
  /** оригиналы, легшие в ответ */
  toAnswer: string[];
  /** оригиналы, сбережённые в source/ (имя в паке → имя в библиотеке) */
  toSource: { name: string; file: string }[];
}

function apply(pkg: Package, jobs: ReplaceJob[]) {
  return jobs.map((j) => {
    const q = pkg.rounds?.[j.round]?.themes?.[j.theme]?.questions?.[j.question];
    return q ? replaceQuestionImage(q, j.name, j.items) : { originalInAnswer: false, replaced: false };
  });
}

export async function replaceImages(pack: PackDTO, mutate: Mutate, jobs: ReplaceJob[], note: string): Promise<ReplaceResult> {
  // mutate отрабатывает внутри setState, и его результат наружу не достать: считаем итог на копии заранее
  const probe = structuredClone(pack.pkg);
  const results = apply(probe, jobs);
  const toAnswer = jobs.filter((_, i) => results[i].originalInAnswer).map((j) => j.name);
  const keep = [...new Set(jobs.filter((_, i) => results[i].replaced && !results[i].originalInAnswer).map((j) => j.name))]
    .filter((name) => !toAnswer.includes(name));
  const toSource: ReplaceResult["toSource"] = [];
  for (const name of keep) toSource.push({ name, file: await window.api.libraryKeep("Images", name, note) });
  mutate((pkg) => { apply(pkg, jobs); });
  for (const { name } of toSource) {
    if (isMediaUsed(probe, "Images", name)) continue;
    await window.api.removeMedia("Images", name);
    window.dispatchEvent(new CustomEvent("media-removed", { detail: { folder: "Images", name } }));
  }
  return { toAnswer, toSource };
}

// Реестр источников тематических слов.

import type { Dictionary } from "../dict";
import { manual } from "./manual";
import { nounsSource } from "./nouns";
import type { SourcePreset, WordSource } from "./types";
import { wikidataSource, type WikidataDirs } from "./wikidata";

const EXTRA: WordSource[] = [];

export function registerWordSource(s: WordSource): void {
  const i = EXTRA.findIndex((x) => x.id === s.id);
  if (i >= 0) EXTRA[i] = s;
  else EXTRA.push(s);
}

/** Где лежат заранее скачанные наборы и куда складывать кэш. Задаёт главный процесс. */
let dirs: WikidataDirs = {};

export function setWordSourceDirs(d: WikidataDirs): void {
  dirs = d;
}

export function wordSourceDirs(): WikidataDirs {
  return dirs;
}

export function allWordSources(dict: Dictionary): WordSource[] {
  return [manual, wikidataSource(dirs), nounsSource(dict), ...EXTRA];
}

export function wordSourceById(dict: Dictionary, id: string): WordSource | undefined {
  return allWordSources(dict).find((s) => s.id === id);
}

export interface WordSourceInfo {
  id: string;
  title: string;
  about: string;
  presets?: SourcePreset[];
  needsText?: boolean;
}

export function wordSourceInfos(dict: Dictionary): WordSourceInfo[] {
  return allWordSources(dict).map((s) => ({ id: s.id, title: s.title, about: s.about, presets: s.presets, needsText: s.needsText }));
}

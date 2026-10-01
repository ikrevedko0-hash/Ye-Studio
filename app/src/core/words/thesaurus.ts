// Тезаурус для кубраи: синонимы и антонимы из русского Викисловаря (CC BY-SA 4.0, через kaikki.org).
// Файл ru-thes.tsv собирает `npm run fetch-thesaurus`: «слово\tсинонимы через запятую\tантонимы».
//
// Связи делаем взаимными при загрузке: в Викисловаре у «ада» антоним «рай» записан, а у «рая»
// про «ад» могли и забыть — для загадки направление не важно.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Thesaurus } from "./kubraya";

export const THES_FILE = "ru-thes.tsv";

export class MapThesaurus implements Thesaurus {
  private syns = new Map<string, Set<string>>();
  private ants = new Map<string, Set<string>>();

  private static link(map: Map<string, Set<string>>, a: string, b: string) {
    if (a === b) return;
    let s = map.get(a);
    if (!s) map.set(a, (s = new Set()));
    s.add(b);
  }

  add(word: string, syn: string[], ant: string[]): void {
    for (const s of syn) { MapThesaurus.link(this.syns, word, s); MapThesaurus.link(this.syns, s, word); }
    for (const a of ant) { MapThesaurus.link(this.ants, word, a); MapThesaurus.link(this.ants, a, word); }
  }

  has(word: string): boolean {
    return this.syns.has(word) || this.ants.has(word);
  }

  syn(word: string): string[] {
    return [...(this.syns.get(word) ?? [])];
  }

  ant(word: string): string[] {
    return [...(this.ants.get(word) ?? [])];
  }

  get size(): number {
    return new Set([...this.syns.keys(), ...this.ants.keys()]).size;
  }

  /** Разбор ru-thes.tsv. Кривые строки пропускаем молча: файл собран скриптом, а не руками. */
  static parse(text: string): MapThesaurus {
    const t = new MapThesaurus();
    for (const line of text.split(/\r?\n/)) {
      const [word, syn = "", ant = ""] = line.split("\t");
      if (!word) continue;
      t.add(word, syn ? syn.split(",") : [], ant ? ant.split(",") : []);
    }
    return t;
  }
}

const cache = new Map<string, Promise<MapThesaurus | null>>();

/** Тезаурус из папки словарей; null — не скачан. */
export function loadThesaurus(dir: string): Promise<MapThesaurus | null> {
  let p = cache.get(dir);
  if (!p) {
    p = readFile(join(dir, THES_FILE), "utf8").then(MapThesaurus.parse, () => null);
    cache.set(dir, p);
  }
  return p;
}

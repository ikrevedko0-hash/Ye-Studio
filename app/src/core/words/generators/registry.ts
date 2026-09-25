// Реестр генераторов головоломок. Единственное место, где они перечислены.

import { anagramGenerator } from "./anagram";
import { initialsGenerator } from "./initials";
import { matrixGenerator } from "./matrix";
import type { PuzzleGenerator } from "./types";

const ALL: PuzzleGenerator[] = [matrixGenerator, anagramGenerator, initialsGenerator];

export function registerGenerator(g: PuzzleGenerator): void {
  const i = ALL.findIndex((x) => x.id === g.id);
  if (i >= 0) ALL[i] = g;
  else ALL.push(g);
}

export function allGenerators(): PuzzleGenerator[] {
  return [...ALL];
}

export function generatorById(id: string): PuzzleGenerator | undefined {
  return ALL.find((g) => g.id === id);
}

/** Описание генераторов для окна: без функций, только то, что можно передать через IPC. */
export interface GeneratorInfo {
  id: string;
  title: string;
  about: string;
  params: PuzzleGenerator["params"];
}

export function generatorInfos(): GeneratorInfo[] {
  return ALL.map((g) => ({ id: g.id, title: g.title, about: g.about, params: g.params }));
}

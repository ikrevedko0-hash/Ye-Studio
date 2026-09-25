// Словари для «Студии слов». Ядро без Electron: путь к папке передаёт главный процесс.
//
// Три набора, каждый под свою задачу:
//   forms  — все словоформы (≈1,5 млн). Только здесь есть «пошлю», без которого не собрать матрицу.
//   nouns  — существительные (≈51 тыс.). Ответ в «Своей игре» почти всегда существительное.
//   common — 10 тысяч самых частых слов. Отсекает словарную экзотику, которую никто не отгадает.
//
// Почему набор хранится одной строкой, а не массивом. Полтора миллиона строк в массиве — это
// сотни мегабайт в памяти. Одна большая строка с переводами строк занимает свои 33 МБ и
// прекрасно ищется через indexOf: подстрочный поиск по ней уходит в нативный код V8.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type WordSet = "forms" | "nouns" | "common";

export const SET_TITLE: Record<WordSet, string> = {
  forms: "все словоформы",
  nouns: "существительные",
  common: "частые слова",
};

const FILES: Record<WordSet, string> = {
  forms: "ru-forms.txt",
  nouns: "ru-nouns.txt",
  common: "ru-common.txt",
};

/** Порядок частоты живой речи: 150 тысяч слов, первое — самое частое. */
const FREQ_FILE = "ru-freq.txt";

export interface DictStats {
  set: WordSet;
  words: number;
  loaded: boolean;
}

export class Dictionary {
  /** Текст набора: «\nслово\nслово\n…». Обёртка переводами строк с обоих концов — чтобы искать границы слов. */
  private text = new Map<WordSet, string>();
  private list = new Map<WordSet, string[]>();
  private missing = new Set<WordSet>();
  /** Слово → его место в порядке частоты. Чем меньше число, тем слово обиходнее. */
  private rank?: Map<string, number>;
  /** Наборы слов по длине: нужны там, где проверка «это слово?» идёт тысячами. */
  private byLength = new Map<string, Set<string>>();

  constructor(private dir: string) {}

  /**
   * Насколько слово на слуху: 0 — незнакомое, 1 — самое частое в языке.
   * По этому признаку головоломки сортируются: «эпизод» автор увидит раньше «пизолита».
   */
  async fame(): Promise<(word: string) => number> {
    if (!this.rank) {
      const map = new Map<string, number>();
      try {
        const raw = await readFile(join(this.dir, FREQ_FILE), "utf8");
        const words = raw.replace(/\r/g, "").split("\n");
        for (let i = 0; i < words.length; i++) if (words[i]) map.set(words[i], i);
      } catch {
        // частотного списка нет — тогда все слова равны, порядок останется по длине
      }
      this.rank = map;
    }
    const map = this.rank;
    const size = Math.max(1, map.size);
    return (word: string) => {
      const r = map.get(word.toLowerCase());
      return r === undefined ? 0 : 1 - r / size;
    };
  }

  /** Набор может быть не скачан: тогда говорим об этом честно, а не падаем. */
  async load(set: WordSet): Promise<boolean> {
    if (this.text.has(set)) return true;
    if (this.missing.has(set)) return false;
    try {
      const raw = await readFile(join(this.dir, FILES[set]), "utf8");
      this.text.set(set, `\n${raw.replace(/\r/g, "").trim()}\n`);
      return true;
    } catch {
      this.missing.add(set);
      return false;
    }
  }

  async stats(): Promise<DictStats[]> {
    const out: DictStats[] = [];
    for (const set of ["forms", "nouns", "common"] as WordSet[]) {
      const loaded = await this.load(set);
      out.push({ set, loaded, words: loaded ? (await this.words(set)).length : 0 });
    }
    return out;
  }

  /** Список слов набора. Считается один раз и остаётся в памяти — нужен для перебора. */
  async words(set: WordSet): Promise<string[]> {
    const have = this.list.get(set);
    if (have) return have;
    if (!(await this.load(set))) return [];
    const arr = this.text.get(set)!.split("\n").filter(Boolean);
    this.list.set(set, arr);
    return arr;
  }

  /**
   * Готовая проверка «это настоящее слово».
   * Нужна перемешивателю: он перебирает сотни вариантов, и на каждый лезть в async слишком дорого.
   *
   * Почему не indexOf по общей строке, как в остальных местах. Поиск подстроки в 33 МБ стоит
   * один проход по всей памяти. Перемешиватель зовёт проверку по 300 раз на слово, и на теме
   * из 30 слов это девять тысяч проходов — те самые полминуты, которые автор ждал у экрана.
   * Поэтому слова нужных длин один раз раскладываются в Set, и дальше проверка стоит наносекунды.
   */
  async matcher(set: WordSet, lengths?: number[]): Promise<(word: string) => boolean> {
    if (!(await this.load(set))) return () => false;
    if (!lengths?.length) {
      const text = this.text.get(set)!;
      return (word: string) => text.includes(`\n${word.toLowerCase()}\n`);
    }
    const want = new Set(lengths);
    const key = `${set}:${[...want].sort((a, b) => a - b).join(",")}`;
    let bag = this.byLength.get(key);
    if (!bag) {
      bag = new Set<string>();
      // идём по сплошной строке, а не через words(): массив из 1,7 млн строк остался бы
      // в памяти на всю сессию ради одной проверки
      const text = this.text.get(set)!;
      for (let from = 1; from < text.length;) {
        const to = text.indexOf("\n", from);
        if (to < 0) break;
        if (want.has(to - from)) bag.add(text.slice(from, to));
        from = to + 1;
      }
      this.byLength.set(key, bag);
    }
    const ready = bag;
    return (word: string) => ready.has(word.toLowerCase());
  }

  async has(word: string, set: WordSet): Promise<boolean> {
    if (!(await this.load(set))) return false;
    return this.text.get(set)!.includes(`\n${word.toLowerCase()}\n`);
  }

  /**
   * Слова, где встречается кусок. where говорит, в каком месте слова:
   * start — «шлюпка», end — «пошлю», any — где угодно, включая середину.
   * Идём по сплошному тексту: на 1,5 млн слов это десятки миллисекунд.
   */
  async withFragment(fragment: string, set: WordSet, where: "start" | "end" | "any", limit = 500): Promise<string[]> {
    if (!(await this.load(set))) return [];
    const frag = fragment.toLowerCase();
    if (!frag) return [];
    const text = this.text.get(set)!;
    const out: string[] = [];
    for (let i = text.indexOf(frag); i >= 0 && out.length < limit; i = text.indexOf(frag, i + 1)) {
      const from = text.lastIndexOf("\n", i) + 1;
      const to = text.indexOf("\n", i);
      if (where === "start" && i !== from) continue;
      if (where === "end" && i + frag.length !== to) continue;
      out.push(text.slice(from, to));
    }
    return out;
  }
}

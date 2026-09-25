// Тема «инициалы»: в ответах названия, где слова начинаются на одни и те же буквы.
//
//   Тема «Н.Н.»:  Нижний Новгород, Helly Hansen, Ник Нолти, никак нет.
//   Тема «С.С.»:  Сильвестр Сталлоне, C. C. Catch, скорость света, слово за слово.
//   Тема «Х.Х.»:  XXXTentacion, холостой ход, Халк Хоган, ходить ходуном.
//
// Латинская буква засчитывается, если выглядит так же, как русская (C = С, H = Н, X = Х, Y = У):
// в игре это одна и та же буква на экране. По звуку не сравниваем — так решил автор.
//
// Подбор идёт по набору, собранному заранее (`npm run fetch-initials`): вручную такие названия
// не найти, а на лету их не отдаёт ни один сервис.

import { latinTwin, matchLetters, normalizeLetters, WHERE_TITLE, type InitialsWhere } from "../initials";
import { KIND_TITLE, loadInitials, type InitialsEntry, type InitialsKind } from "../sources/initialsData";
import { wordSourceDirs } from "../sources/registry";
import type { Dictionary } from "../dict";
import type { GeneratorArgs, PuzzleGenerator, PuzzleTheme, WordHit } from "./types";

/** Буквы, с которых начинаются слова: без Ъ, Ь, Ы. */
const ALPHABET = [..."АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЭЮЯ"];

/** «СС» → «С.С.» */
const dotted = (letters: string) => [...letters].map((c) => `${c}.`).join("");

/** Совпадение «ровно» ценнее «в начале», а то — ценнее «внутри»: там буквы теряются среди прочих. */
const WHERE_WEIGHT: Record<InitialsWhere, number> = { exact: 1, start: 0.8, any: 0.6 };

/** Латинская буква в начале какого-нибудь слова — значит, совпало по облику, а не по букве. */
const hasLatin = (s: string) => /(^|[\s.\-&])[A-Za-z]/.test(s);

/**
 * Латинское написание, когда у вещи есть привычное русское, — находка второго ряда: Чаплина
 * у нас знают как Чарли Чаплина, и в «С.С.» он скорее ловушка, чем ответ. А Coca-Cola,
 * C. C. Catch и Helly Hansen русского названия не имеют (или оно тоже латиницей) — им штрафа нет.
 */
const TWIN_WEIGHT = 0.7;

function score(e: InitialsEntry, where: InitialsWhere): number {
  const knownInRussian = hasLatin(e.t) && !!e.a && /[А-ЯЁа-яё]/.test(e.a);
  return Math.log(1 + e.f) * WHERE_WEIGHT[where] * (knownInRussian ? TWIN_WEIGHT : 1);
}

/**
 * Разнообразие важнее точности сортировки: первые семь находок автор получает отмеченными сразу,
 * и если все семь — футболисты, тему придётся собирать руками. Поэтому раздаём по кругу:
 * лучшая находка каждого вида, потом вторая, и так далее. Порядок видов — по их лучшей находке.
 */
function roundRobin(groups: Map<string, { e: InitialsEntry; w: InitialsWhere; s: number }[]>, limit: number) {
  const lists = [...groups.values()].filter((l) => l.length).sort((a, b) => b[0].s - a[0].s);
  const out: { e: InitialsEntry; w: InitialsWhere }[] = [];
  for (let i = 0; out.length < limit; i++) {
    let any = false;
    for (const l of lists) {
      if (l[i]) { out.push(l[i]); any = true; }
      if (out.length >= limit) break;
    }
    if (!any) break;
  }
  return out;
}

/**
 * Пояснение в строке находки. Сами буквы не повторяем — они в названии темы, а строка узкая
 * и обрезается: первым должно стоять то, что отличает находку, — вид и второе написание.
 */
function why(e: InitialsEntry, where: InitialsWhere): string {
  const parts: string[] = [KIND_TITLE[e.k]];
  if (e.a) parts.push(e.a);
  if (where !== "exact") parts.push(`${WHERE_TITLE[where]}: ${dotted(e.i)}`);
  if (hasLatin(e.t)) parts.push("латиница по виду");
  return parts.join(" · ");
}

/** Подсказка, какую букву взять: буквы с самой богатой и разнообразной выдачей при таком повторе. */
function suggest(entries: InitialsEntry[], twins: boolean, count: number, limit: number): WordHit[] {
  const byPair = new Map<string, { n: number; kinds: Set<InitialsKind>; best: InitialsEntry[] }>();
  for (const e of entries) {
    if (!twins && hasLatin(e.t)) continue;
    const pair = e.i.slice(0, count);
    // только буквы, которые на экране выглядят русскими: S.S. к русской букве не приводится
    if (pair.length < count || pair !== pair[0].repeat(count) || !/[А-ЯЁ]/.test(pair[0])) continue;
    const p = byPair.get(pair) ?? { n: 0, kinds: new Set(), best: [] };
    p.n++;
    p.kinds.add(e.k);
    if (p.best.length < 4) p.best.push(e); // записи уже идут по убыванию известности
    byPair.set(pair, p);
  }
  return [...byPair.entries()]
    .sort((a, b) => b[1].n * b[1].kinds.size - a[1].n * a[1].kinds.size)
    .slice(0, limit)
    .map(([pair, p]) => ({
      word: dotted(pair),
      why: `${p.n} находок, ${p.kinds.size} видов: ${p.best.map((e) => e.t).join(", ")}`,
      question: "",
    }));
}

export const initialsGenerator: PuzzleGenerator = {
  id: "initials",
  title: "Инициалы (С.С., Н.Н., Х.Х.)",
  about: "Названия, где слова начинаются на одни буквы: Нижний Новгород и Helly Hansen, Сталлоне и C.C. Catch, холостой ход.",
  params: [
    // Букву выбирают из списка, а не вписывают: так просил автор, и так не бывает опечаток
    // вроде латинской N вместо Н. Возле буквы подписан её латинский двойник — он тоже засчитывается.
    {
      name: "letter",
      title: "Буква",
      kind: "select",
      def: "С",
      options: [
        { value: "", title: "— подскажи, какую" },
        ...ALPHABET.map((c) => ({ value: c, title: latinTwin(c) ? `${c}  (и ${latinTwin(c)})` : c })),
      ],
    },
    {
      name: "count",
      title: "Сколько раз",
      kind: "select",
      def: "2",
      options: ["2", "3", "4"].map((n) => ({ value: n, title: `${n}: ${dotted("Х".repeat(Number(n)))}` })),
    },
    {
      name: "where",
      title: "Где буквы",
      kind: "select",
      def: "start",
      options: [
        { value: "start", title: "в начале названия (С.С. Прокофьев, XXXTentacion)" },
        { value: "exact", title: "всё название — ровно эти буквы" },
        { value: "any", title: "где угодно подряд (датчик холостого хода)" },
      ],
    },
    {
      name: "kind",
      title: "Что искать",
      kind: "select",
      def: "all",
      options: [
        { value: "all", title: "всё вперемешку" },
        ...(Object.entries(KIND_TITLE) as [InitialsKind, string][]).map(([value, title]) => ({ value, title })),
      ],
    },
    { name: "twins", title: "Латиница по виду (C = С, H = Н, Y = У)", kind: "checkbox", def: true },
    { name: "limit", title: "Сколько показать", kind: "number", def: 60 },
  ],

  async run(_dict: Dictionary, args: GeneratorArgs): Promise<PuzzleTheme> {
    const set = await loadInitials(wordSourceDirs().bundled);
    if (!set) {
      return { title: "Инициалы", hits: [], note: "Набора нет. Выполните в папке приложения: npm run fetch-initials — это разовая загрузка." };
    }
    const limit = Number(args.limit) || 60;
    const twins = args.twins !== false;
    const count = Math.min(4, Math.max(2, Number(args.count) || 2));
    const letter = normalizeLetters(String(args.letter ?? "")).slice(0, 1);
    const letters = letter.repeat(count);

    if (!letters) {
      return {
        title: "Какую букву взять",
        hits: suggest(set.entries, twins, count, limit),
        note: "Буквы с самой богатой выдачей. Выберите понравившуюся в списке «Буква» и нажмите «Подобрать».",
      };
    }

    const whereArg = (["exact", "start", "any"].includes(String(args.where)) ? args.where : "start") as InitialsWhere;
    const kind = String(args.kind ?? "all");
    const groups = new Map<string, { e: InitialsEntry; w: InitialsWhere; s: number }[]>();
    const taken = new Set<string>();
    for (const e of set.entries) {
      if (kind !== "all" && e.k !== kind) continue;
      if (!twins && hasLatin(e.t)) continue;
      const w = matchLetters(e.i, letters, whereArg);
      if (!w) continue;
      // одна вещь под двумя написаниями (Кока-Кола и Coca-Cola) — одна находка
      const key = e.t.toLowerCase();
      if (taken.has(key) || (e.a && taken.has(e.a.toLowerCase()))) continue;
      taken.add(key);
      const g = kind === "all" ? e.k : `${e.k}:${w}`;
      const list = groups.get(g) ?? [];
      list.push({ e, w, s: score(e, w) });
      groups.set(g, list);
    }
    for (const l of groups.values()) l.sort((a, b) => b.s - a.s);

    const hits: WordHit[] = roundRobin(groups, limit).map(({ e, w }) => ({
      word: e.t,
      why: why(e, w),
      // текст вопроса пишет автор: подсказку из «почему» в вопрос не кладём
      question: "",
      common: e.f >= 40,
    }));

    return {
      title: dotted(letters),
      hits,
      note: `Инициалы во всех ответах — ${dotted(letters)} Латинские C, H, X, Y и подобные засчитаны как русские: на экране это одна буква. Текст вопроса при вставке не трогается — только ответ.`,
    };
  },
};

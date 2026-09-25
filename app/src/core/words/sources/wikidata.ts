// Тематические списки из Wikidata. Без ключа, запрос SPARQL, ответ JSON.
//
// Главная тонкость — известность. На запрос «города России» Wikidata честно вернёт и Москву,
// и городище Тиритака: для неё это одинаковые города. Играть в такое нельзя, поэтому
// сортируем по числу языковых разделов Википедии (wikibase:sitelinks) — простая и на удивление
// точная мера того, слышал ли человек про эту вещь.
//
// Вторая тонкость — скорость. Живой запрос идёт несколько секунд, а на больших классах
// («города мира», «животные») уходит в минуты и упирается в тайм-аут сервиса. Но списки городов
// и химических элементов не меняются годами, поэтому ходим в сеть только тогда, когда нечего
// взять с диска. Порядок такой:
//   1) набор, скачанный заранее (`npm run fetch-wordsets`, лежит рядом со словарями);
//   2) ответ, сохранённый прошлым запросом (папка настроек, годен месяц);
//   3) живой запрос к Wikidata — и он сразу же ложится в кэш.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getJson } from "../../media/providers/http";
import type { SourcePreset, ThemeWords, ThemeWordsQuery, WordSource } from "./types";

const ENDPOINT = "https://query.wikidata.org/sparql";

/** Месяц: Wikidata меняется медленнее, чем автор пишет паки. */
const CACHE_DAYS = 30;

export interface Preset extends SourcePreset {
  /** Тело запроса: должно связать ?item и дать ?label на русском. */
  where: string;
  /** Порог известности: сколько языковых разделов Википедии должно быть у вещи. */
  minFame?: number;
}

/**
 * Готовые наборы под темы, которые реально встречаются в паках.
 * P31/P279* — «это экземпляр вида, который является подвидом…», то есть «любой город», а не только
 * то, что помечено дословно. P17 — страна.
 */
export const PRESETS: Preset[] = [
  // Имена собственные: тут «экземпляр» — то, что нужно (Москва — экземпляр города).
  { value: "cities-ru", title: "Города России", where: "?item wdt:P31/wdt:P279* wd:Q515 ; wdt:P17 wd:Q159 .", minFame: 15 },
  { value: "cities-world", title: "Города мира", where: "?item wdt:P31/wdt:P279* wd:Q515 .", minFame: 60 },
  { value: "countries", title: "Страны", where: "?item wdt:P31 wd:Q6256 .", minFame: 20 },
  { value: "capitals", title: "Столицы", where: "?item wdt:P31/wdt:P279* wd:Q5119 .", minFame: 30 },
  { value: "elements", title: "Химические элементы", where: "?item wdt:P31 wd:Q11344 .", minFame: 10 },
  { value: "films-ru", title: "Фильмы (советские и российские)", where: "?item wdt:P31 wd:Q11424 ; wdt:P495 ?c . VALUES ?c { wd:Q159 wd:Q15180 }", minFame: 5 },
  // Юпитер помечен как «газовый гигант», а не «планета» напрямую, поэтому здесь нужен путь P31/P279*
  { value: "planets", title: "Планеты и спутники", where: "{ ?item wdt:P31/wdt:P279* wd:Q634 . } UNION { ?item wdt:P31/wdt:P279* wd:Q2537 . }", minFame: 10 },

  // Нарицательные: здесь нужен «подвид», а не «экземпляр». Экземпляры музыкального инструмента —
  // это конкретные предметы вроде Царь-колокола, а нам нужны гитара, скрипка, флейта.
  // Q55983715 — «организм под общеизвестным названием»: там и растения, поэтому добавлено
  // требование быть подклассом животного, иначе в набор попадали дерево и пшеница
  { value: "animals", title: "Животные", where: "?item wdt:P31 wd:Q55983715 ; wdt:P279* wd:Q729 .", minFame: 20 },
  { value: "instruments", title: "Музыкальные инструменты", where: "?item wdt:P279* wd:Q34379 .", minFame: 15 },
  { value: "professions", title: "Профессии", where: "?item wdt:P279* wd:Q28640 .", minFame: 15 },
  { value: "sports", title: "Виды спорта", where: "?item wdt:P279* wd:Q349 .", minFame: 15 },
];

interface SparqlAnswer {
  results?: { bindings?: { label?: { value: string }; sl?: { value: string } }[] };
}

/** Что лежит в файле набора: слова без отсева по длине, чтобы кэш годился при любых настройках. */
export interface CachedSet {
  preset: string;
  title: string;
  fetchedAt: string;
  words: { word: string; fame: number }[];
}

/**
 * Слово годится, если это одно слово из русских букв: «Нижний Новгород» перемешивать бессмысленно —
 * по пробелу сразу видно, где кончается первое слово.
 * Строчная первая буква разрешена: города пишутся с большой, а «золото» и «скрипка» — с маленькой,
 * и требование заглавной оставляло набор химических элементов пустым.
 */
function usable(word: string): boolean {
  return /^[А-ЯЁа-яё][а-яё-]+$/.test(word);
}

export function presetById(value?: string): Preset {
  return PRESETS.find((p) => p.value === value) ?? PRESETS[0];
}

export const SET_FILE = (preset: string) => `wikidata-${preset}.json`;

/** Сколько слов держим в наборе: с запасом на отсев по длине, но без гигантских файлов. */
const SET_SIZE = 400;

/** Живой запрос к Wikidata. Он же используется скриптом предзагрузки. */
export async function fetchSet(preset: Preset, signal?: AbortSignal): Promise<CachedSet> {
  const sparql = `SELECT ?label ?sl WHERE {
    ${preset.where}
    ?item wikibase:sitelinks ?sl ; rdfs:label ?label .
    FILTER(lang(?label) = "ru")
    FILTER(?sl > ${preset.minFame ?? 15})
  } ORDER BY DESC(?sl) LIMIT ${SET_SIZE}`;

  const url = `${ENDPOINT}?query=${encodeURIComponent(sparql)}&format=json`;
  const data = await getJson<SparqlAnswer>(url, signal, { accept: "application/sparql-results+json" });

  const seen = new Set<string>();
  const words = (data.results?.bindings ?? [])
    .map((b) => ({ word: (b.label?.value ?? "").trim(), fame: Number(b.sl?.value) || 0 }))
    .filter((w) => {
      if (!usable(w.word)) return false;
      const key = w.word.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return { preset: preset.value, title: preset.title, fetchedAt: new Date().toISOString(), words };
}

async function readSet(dir: string | undefined, preset: string): Promise<CachedSet | undefined> {
  if (!dir) return undefined;
  try {
    const raw = await readFile(join(dir, SET_FILE(preset)), "utf8");
    const set = JSON.parse(raw) as CachedSet;
    return Array.isArray(set.words) && set.words.length ? set : undefined;
  } catch {
    return undefined;
  }
}

function fresh(set: CachedSet): boolean {
  const age = Date.now() - new Date(set.fetchedAt).getTime();
  return Number.isFinite(age) && age < CACHE_DAYS * 24 * 3600 * 1000;
}

export interface WikidataDirs {
  /** Наборы, скачанные заранее и уехавшие в сборку. Не устаревают: их обновляют скриптом. */
  bundled?: string;
  /** Куда складывать ответы живых запросов. */
  cache?: string;
}

export function wikidataSource(dirs: WikidataDirs = {}): WordSource {
  return {
    id: "wikidata",
    title: "Wikidata",
    about: "Готовые списки: города, страны, элементы, животные. Сортировка по известности, ответы кэшируются.",
    presets: PRESETS.map(({ value, title }) => ({ value, title })),

    async list(q: ThemeWordsQuery, signal?: AbortSignal): Promise<ThemeWords> {
      const preset = presetById(q.preset);

      let set = await readSet(dirs.bundled, preset.value);
      if (!set) {
        const cached = await readSet(dirs.cache, preset.value);
        if (cached && fresh(cached)) set = cached;
      }
      if (!set) {
        set = await fetchSet(preset, signal);
        if (dirs.cache) {
          try {
            await mkdir(dirs.cache, { recursive: true });
            await writeFile(join(dirs.cache, SET_FILE(preset.value)), JSON.stringify(set), "utf8");
          } catch {
            // не записалось — не беда, в следующий раз просто снова сходим в сеть
          }
        }
      }

      const words = set.words
        .filter((w) => w.word.length >= q.minLen && w.word.length <= q.maxLen)
        .slice(0, q.limit)
        .map((w) => ({ ...w, note: `Википедия: ${w.fame} языков` }));

      return { title: set.title, words };
    },
  };
}

/** Набор по умолчанию: нужен только для списка готовых наборов в настройках генератора. */
export const wikidata = wikidataSource();

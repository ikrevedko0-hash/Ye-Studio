// Поиск фильмов, мультфильмов, сериалов и книг по русскому названию — для «фильма по детскому рисунку».
// Текстовая модель по одному названию угадывает произведение плохо: «Солнцестояние» она нарисовала
// солнцем, не вспомнив Midsommar (2019). Автор выбирает фильм из списка, и модель получает готовое.
//
// Источник — Wikidata: без ключа, русские прокатные названия знает. Кинопоиск не годится: открытого
// API нет, а сайт на частые запросы отвечает капчей.
//
// Пока автор печатает, делаем один лёгкий запрос (wbsearchentities) и отсеиваем по описанию:
// поиск идёт по всем элементам, и рядом с фильмом лежат явление природы и коммуна во Франции.
// Тип (P31) проверять здесь дорого — карточка фильма весит сотни килобайт. Полную карточку
// и краткий сюжет из Википедии берём только для выбранного.

import { getJson } from "../media/providers/http";

export interface WorkHit {
  /** Номер в Wikidata, Q… */
  id: string;
  /** Название по-русски — оно же ответ вопроса. */
  title: string;
  /** Описание из Wikidata: «фильм 2019 года режиссёра Ари Астера». */
  about: string;
}

export interface WorkDetails extends WorkHit {
  /** Оригинальное название: Midsommar. */
  original: string;
  year?: number;
  /** Описание по-английски — текстовой модели понятнее: «2019 film by Ari Aster». */
  aboutEn?: string;
  /** Начало статьи Википедии: завязка сюжета, по ней модель выбирает сцену. */
  plot?: string;
}

const API = "https://www.wikidata.org/w/api.php";

/** Похоже на произведение. «фильм» есть и в «персонаж фильма», и в «film director» — их отсекает NOT_WORK. */
const WORK = /фильм|сериал|аниме|роман|повест|рассказ|сказк|книг|пьеса|поэма|мюзикл|опера\b|балет\b|\bfilm\b|\bmovie\b|series|\bnovel(la)?\b|\bbook\b|anime|cartoon|short story|fairy tale|\bplay\b/i;
// «роман русского писателя…» и «film by Studio Ghibli» — произведения, поэтому «писатель» и «studio» сюда не входят
const NOT_WORK = /персонаж|character|режисс[её]р\b|актёр|актер|актриса|\bdirector\b|producer|actor|actress|кинотеатр|киностуди|кинокомпани|film (studio|production|company|distributor)|фестивал|festival|преми[яи]|award|список|list of|страница значений|disambiguation|^жанр|\bgenre\b/i;

export function isWork(about: string): boolean {
  return WORK.test(about) && !NOT_WORK.test(about);
}

interface SearchReply {
  search?: { id: string; label?: string; description?: string; match?: { text?: string } }[];
}

/** Разбор ответа wbsearchentities: только произведения, без повторов. */
export function parseSearch(data: SearchReply): WorkHit[] {
  const seen = new Set<string>();
  const out: WorkHit[] = [];
  for (const s of data.search ?? []) {
    const about = s.description?.trim() ?? "";
    if (!about || !isWork(about) || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push({ id: s.id, title: s.label?.trim() || s.match?.text?.trim() || s.id, about });
  }
  return out;
}

const hitsCache = new Map<string, WorkHit[]>();

export async function searchWorks(query: string, signal?: AbortSignal): Promise<WorkHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const key = q.toLowerCase();
  const cached = hitsCache.get(key);
  if (cached) return cached;
  const url = `${API}?action=wbsearchentities&format=json&type=item&language=ru&uselang=ru&limit=25&search=${encodeURIComponent(q)}`;
  const hits = parseSearch(await getJson<SearchReply>(url, signal)).slice(0, 10);
  hitsCache.set(key, hits);
  return hits;
}

interface Claim { mainsnak?: { datavalue?: { value?: unknown } } }
interface Entity {
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  claims?: Record<string, Claim[]>;
  sitelinks?: Record<string, { title: string }>;
}

function claimValues(e: Entity, prop: string): unknown[] {
  return (e.claims?.[prop] ?? []).map((c) => c.mainsnak?.datavalue?.value).filter((v) => v !== undefined);
}

/** Год: самая ранняя дата выхода (P577), у книг без неё — дата создания (P571). */
export function workYear(e: Entity): number | undefined {
  const years = [...claimValues(e, "P577"), ...(claimValues(e, "P577").length ? [] : claimValues(e, "P571"))]
    .map((v) => /^[+]?(\d{4})-/.exec((v as { time?: string }).time ?? "")?.[1])
    .filter(Boolean)
    .map(Number);
  return years.length ? Math.min(...years) : undefined;
}

/** Карточка элемента → то, что нужно модели. */
export function parseEntity(id: string, e: Entity, hit?: WorkHit): WorkDetails {
  const ru = e.labels?.ru?.value;
  const en = e.labels?.en?.value;
  const titles = claimValues(e, "P1476") as { text?: string }[];
  return {
    id,
    title: hit?.title ?? ru ?? en ?? id,
    about: hit?.about ?? e.descriptions?.ru?.value ?? e.descriptions?.en?.value ?? "",
    original: titles.find((t) => t.text)?.text ?? en ?? ru ?? id,
    year: workYear(e),
    aboutEn: e.descriptions?.en?.value,
  };
}

/** Начало статьи Википедии, не длиннее limit: пара-тройка предложений, обрезанных по точке. */
export function trimPlot(text: string, limit = 700): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= limit) return t;
  const cut = t.slice(0, limit);
  const dot = cut.lastIndexOf(". ");
  return dot > limit / 3 ? cut.slice(0, dot + 1) : `${cut}…`;
}

async function wikiSummary(lang: string, title: string, signal?: AbortSignal): Promise<string | undefined> {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  const r = await getJson<{ extract?: string }>(url, signal);
  return r.extract?.trim() || undefined;
}

const detailsCache = new Map<string, WorkDetails>();

export async function workDetails(id: string, hit?: WorkHit, signal?: AbortSignal): Promise<WorkDetails> {
  if (!/^Q\d+$/.test(id)) throw new Error(`не номер Wikidata: ${id}`);
  const cached = detailsCache.get(id);
  if (cached) return cached;
  const url = `${API}?action=wbgetentities&format=json&ids=${id}&props=labels|descriptions|claims|sitelinks&languages=ru|en&sitefilter=enwiki|ruwiki`;
  const data = await getJson<{ entities?: Record<string, Entity> }>(url, signal);
  const e = data.entities?.[id];
  if (!e) throw new Error(`в Wikidata нет ${id}`);
  const d = parseEntity(id, e, hit);
  // английская статья чаще начинается с завязки («It follows a couple who travel to Sweden…»),
  // русская — со списка актёров; сюжет — подсказка, без него сцена всё равно получится
  for (const [lang, link] of [["en", e.sitelinks?.enwiki], ["ru", e.sitelinks?.ruwiki]] as const) {
    if (!link) continue;
    const text = await wikiSummary(lang, link.title, signal).catch(() => undefined);
    if (text) { d.plot = trimPlot(text); break; }
  }
  detailsCache.set(id, d);
  return d;
}

/** Как произведение подписать в окне: «Midsommar (2019)». */
export function workLabel(d: WorkDetails): string {
  return d.year ? `${d.original} (${d.year})` : d.original;
}

/** Что сказать текстовой модели о выбранном произведении — вместо угадывания. */
export function workContext(d: WorkDetails): string {
  const lines = [`The work is already identified, do not guess another one: ${workLabel(d)} — ${d.aboutEn ?? d.about}.`];
  if (d.plot) lines.push(`Summary: ${d.plot}`);
  return lines.join("\n");
}

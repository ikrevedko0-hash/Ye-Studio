// Разовая сборка набора для темы «инициалы» (С.С., Н.Н., Х.Х.): npm run fetch-initials
//
// Откуда берутся названия:
//   1) Wikidata — 400 тысяч самых известных вещей (по числу языковых разделов Википедии)
//      с русским и английским названием. Запрос идёт в QLever — зеркало Wikidata, которое
//      отдаёт такой объём за 15–20 с; сама Wikidata на нём падает по тайм-ауту или отвечает 429.
//   2) Wikidata — понятия со строчной буквы: «скорость света», «свобода слова».
//   3) Викисловарь — устойчивые выражения: «холостой ход», «ходить ходуном», «слово за слово».
//   4) Заголовки русской Википедии, где каждое слово есть в словаре, — с низкой известностью.
//
// Вид вещи (люди, персонажи, бренды…) узнаём отдельными запросами «экземпляр подвида такого-то класса».
// В файл уходят только названия, где два инициала подряд одинаковы: остальное теме не нужно.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { hasDoubled, initialsOf, nameWords } from "../src/core/words/initials";
import { INITIALS_FILE, PROPER_KINDS, type InitialsEntry, type InitialsKind, type InitialsSet } from "../src/core/words/sources/initialsData";

const ROOT = join(import.meta.dirname, "..", "resources");
const QLEVER = "https://qlever.cs.uni-freiburg.de/api/wikidata";
const UA = "siq-workshop/0.1 (SIGame pack workshop; initials set)";
const PREFIX = `PREFIX wd: <http://www.wikidata.org/entity/> PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wikibase: <http://wikiba.se/ontology#> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> `;

/** Порядок важен: человек-музыкант — «люди», а не «музыка»; группа — «музыка», а не «организации». */
const KIND_CLASSES: [InitialsKind, string][] = [
  ["person", "wd:Q5"],
  ["character", "wd:Q95074"], // вымышленный персонаж
  ["music", "wd:Q2088357 wd:Q215380"], // музыкальный коллектив, группа
  ["brand", "wd:Q4830453 wd:Q431289 wd:Q167270"], // предприятие, бренд, товарный знак
  ["work", "wd:Q17537576 wd:Q7889"], // творческое произведение, видеоигра
  ["place", "wd:Q486972 wd:Q56061 wd:Q618123 wd:Q6256"], // поселение, административная единица, география, страна
  ["org", "wd:Q43229"], // организация: клубы, партии, ведомства
];

/** Ниже пяти разделов — местные знаменитости, которых игрок не знает. */
const MIN_PROPER_FAME = 5;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ответы складываем во временную папку: оборвался прогон — повтор не тянет всё заново. */
const CACHE = join(tmpdir(), "siq-initials-cache");

/**
 * QLever не любит параллельных запросов (429) и временами не отвечает на соединение —
 * идём по одному и повторяем с паузой, в том числе после сетевого сбоя.
 */
async function sparql(query: string): Promise<string[][]> {
  const file = join(CACHE, createHash("sha1").update(query).digest("hex") + ".tsv");
  let text = await readFile(file, "utf8").catch(() => "");
  for (let attempt = 1; !text; attempt++) {
    try {
      const res = await fetch(`${QLEVER}?query=${encodeURIComponent(PREFIX + query)}`, {
        headers: { accept: "text/tab-separated-values", "user-agent": UA },
      });
      if (res.ok) {
        text = await res.text();
        await mkdir(CACHE, { recursive: true });
        await writeFile(file, text, "utf8");
        await wait(1500);
        break;
      }
      if (attempt >= 5) throw new Error(`QLever ${res.status}: ${(await res.text()).slice(0, 200)}`);
    } catch (e) {
      if (attempt >= 5) throw e;
    }
    await wait(5000 * attempt);
  }
  return text.split("\n").slice(1).filter(Boolean).map((l) => l.split("\t"));
}

const qid = (uri: string) => uri.replace(/^<http:\/\/www\.wikidata\.org\/entity\/(Q\d+)>$/, "$1");
/** "Нижний Новгород"@ru → Нижний Новгород */
function literal(cell: string | undefined): string {
  const m = /^"(.*)"@[\w-]+$/.exec(cell ?? "");
  return m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\") : "";
}

/** Название годится в ответ: не служебная страница, не список, есть хоть одно слово длиннее буквы. */
function usableLabel(s: string): boolean {
  if (!s || s.length > 60 || /[:()]/.test(s)) return false;
  if (/^(список|list of|lists of)\b/i.test(s)) return false;
  // «XXXTentacion discography» — служебная статья, а не ответ
  if (/(?<!\p{L})(discography|filmography|bibliography|дискография|фильмография|библиография)(?!\p{L})/iu.test(s)) return false;
  // \b в JS знает только латиницу — у кириллицы границы слова ищем через \p{L}
  if (/(?<!\p{L})(век|веков|century|centuries)(?!\p{L})|до н\. э\./iu.test(s)) return false;
  const words = nameWords(s);
  // «Xavlegbmaoffassitimiwoamndutro…» — название озера из одного слова в полсотни букв
  return words.some((w) => w.length >= 2) && words.every((w) => w.length <= 25);
}

async function download(url: string): Promise<string[]> {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8").split("\n").slice(1).map((t) => t.replace(/_/g, " "));
}

async function main() {
  const t0 = Date.now();
  const log = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)} с] ${s}`);

  // --- словарь: по нему судим, что заголовок состоит из настоящих слов, и оцениваем известность
  const freq = (await readFile(join(ROOT, "dict", "ru-freq.txt"), "utf8")).replace(/\r/g, "").split("\n");
  const rank = new Map(freq.map((w, i) => [w, i]));
  const forms = new Set((await readFile(join(ROOT, "dict", "ru-forms.txt"), "utf8")).replace(/\r/g, "").split("\n"));
  /** Все слова настоящие; известность по самому редкому из них — фраза узнаваема, пока узнаваемо каждое слово. */
  const wordsFame = (s: string, known: (w: string) => boolean): number | undefined => {
    const ws = s.toLowerCase().split(/[\s-]+/).filter(Boolean);
    if (ws.length < 2 || !ws.every(known)) return undefined;
    const worst = Math.max(...ws.map((w) => rank.get(w) ?? freq.length));
    return 1 - worst / freq.length;
  };

  const out: InitialsEntry[] = [];
  const seen = new Set<string>();
  const push = (e: InitialsEntry) => {
    const key = `${e.t.toLowerCase()}|${e.i}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(e);
  };
  const labels = `OPTIONAL { ?item rdfs:label ?ru FILTER(LANG(?ru) = "ru") } OPTIONAL { ?item rdfs:label ?en FILTER(LANG(?en) = "en") }`;

  /**
   * Число языковых разделов меряет мировую известность, а играют русские. «Хоу Ханьшу»
   * (китайская хроника, 55 разделов) вставала выше «Халка Хогана». Поправка — доля слов названия,
   * знакомых частотному словарю русской речи: у незнакомого названия известность вдвое ниже.
   * Латиница не трогается — у брендов и групп своих русских слов нет.
   */
  const familiar = (label: string, fame: number): number => {
    const ws = label.toLowerCase().split(/[\s-]+/).filter((w) => /[а-яё]/.test(w));
    if (!ws.length) return fame;
    const share = ws.filter((w) => rank.has(w)).length / ws.length;
    return Math.round(fame * (0.5 + 0.5 * share));
  };

  // --- виды. Запрос по виду сразу несёт и названия: у имён собственных порог известности ниже,
  // чем в общем списке, — Helly Hansen есть всего в 17 разделах, а общий список кончается на 25.
  const kindOf = new Map<string, InitialsKind>();
  const rows: string[][] = [];
  for (const [kind, classes] of KIND_CLASSES) {
    const part = await sparql(`SELECT DISTINCT ?item ?sl ?ru ?en WHERE { VALUES ?c { ${classes} } ?item wdt:P31/wdt:P279* ?c .
      ?item wikibase:sitelinks ?sl . ${labels} } ORDER BY DESC(?sl) LIMIT 400000`);
    let added = 0;
    for (const r of part) {
      if (kindOf.has(qid(r[0]))) continue;
      kindOf.set(qid(r[0]), kind);
      if (Number(r[1]) >= MIN_PROPER_FAME) rows.push(r);
      added++;
    }
    log(`вид «${kind}»: ${part.length} (новых ${added}), хвост — ${part.at(-1)?.[1]} разделов`);
  }

  // --- 1. известные вещи всех прочих видов
  const top = await sparql(`SELECT ?item ?sl ?ru ?en WHERE { ?item wikibase:sitelinks ?sl . ${labels} } ORDER BY DESC(?sl) LIMIT 400000`);
  log(`Wikidata: ${top.length} известных вещей, хвост — ${top.at(-1)?.[1]} разделов`);
  for (const r of top) if (!kindOf.has(qid(r[0]))) rows.push(r);
  // Одно название носят разные вещи: «Нижний Новгород» — и город, и стадион. Дубли отсеиваются
  // по названию, поэтому первым должен прийти самый известный — иначе город уступал стадиону
  // лишь потому, что вид «произведения» запрашивается раньше «мест».
  rows.sort((a, b) => Number(b[1]) - Number(a[1]));

  for (const [item, sl, ruCell, enCell] of rows) {
    const ru = literal(ruCell);
    let en = literal(enCell);
    const lowerRu = !!ru && ru[0] !== ru[0].toUpperCase();
    // Иерархия классов Wikidata местами кривая: «насыщенные и ненасыщенные соединения» числились
    // персонажами. Имя собственное по-русски пишется с заглавной — со строчной это понятие.
    const known = kindOf.get(qid(item));
    const k: InitialsKind = lowerRu ? "concept" : known ?? "other";
    // английское — только у имён собственных и только с заглавной
    if (!PROPER_KINDS.has(k) || !/^[A-Z0-9]/.test(en)) en = "";
    const f = Number(sl) || 0;
    const ruOk = usableLabel(ru) && hasDoubled(ru);
    const enOk = usableLabel(en) && hasDoubled(en);
    if (ruOk) push({ t: ru, a: en && en !== ru ? en : undefined, i: initialsOf(ru), f: familiar(ru, f), k, s: "wd" });
    if (enOk && (!ruOk || initialsOf(en) !== initialsOf(ru))) push({ t: en, a: ru && ru !== en ? ru : undefined, i: initialsOf(en), f, k, s: "wd" });
  }
  log(`после Wikidata: ${out.length}`);

  // --- 2. понятия со строчной: «скорость света»
  const lower = await sparql(`SELECT ?item ?sl ?ru WHERE { ?item rdfs:label ?ru . FILTER(LANG(?ru) = "ru")
    FILTER(REGEX(STR(?ru), "^[а-яё]+[ -][а-яё]")) ?item wikibase:sitelinks ?sl . } ORDER BY DESC(?sl) LIMIT 300000`);
  for (const [, sl, ruCell] of lower) {
    const ru = literal(ruCell);
    const f = Number(sl) || 0;
    if (f < 2 || !usableLabel(ru) || !hasDoubled(ru)) continue;
    push({ t: ru, i: initialsOf(ru), f: familiar(ru, f), k: "concept", s: "wd" });
  }
  log(`после понятий: ${out.length}`);

  // --- 3. Викисловарь: выражения. Там статьи на всех языках, поэтому каждое слово обязано быть русским.
  const known = (w: string) => forms.has(w) || rank.has(w);
  const wikt = await download("https://dumps.wikimedia.org/ruwiktionary/latest/ruwiktionary-latest-all-titles-in-ns0.gz");
  let nWikt = 0;
  for (const t of wikt) {
    if (!/^[А-ЯЁа-яё][а-яё\s-]*$/.test(t) || !t.includes(" ") || !hasDoubled(t)) continue;
    const fame = wordsFame(t, known);
    if (fame === undefined) continue;
    // выражение из Викисловаря ставим вровень с вещью на 20–80 разделов Википедии
    push({ t, i: initialsOf(t), f: Math.round(20 + 60 * fame), k: "phrase", s: "wikt" });
    nWikt++;
  }
  log(`Викисловарь: ${nWikt} выражений`);

  // --- 4. Википедия: только заголовки из словарных слов (без имён из субтитров вроде «Холли»)
  const wiki = await download("https://dumps.wikimedia.org/ruwiki/latest/ruwiki-latest-all-titles-in-ns0.gz");
  let nWiki = 0;
  for (const t of wiki) {
    if (!/^[А-ЯЁ][а-яё]*(?:[ -][а-яё]+)+$/.test(t) || !hasDoubled(t)) continue;
    const fame = wordsFame(t, (w) => forms.has(w));
    if (fame === undefined || fame < 0.5) continue;
    const phrase = t[0].toLowerCase() + t.slice(1);
    push({ t: phrase, i: initialsOf(phrase), f: Math.round(3 + 20 * fame), k: "other", s: "wiki" });
    nWiki++;
  }
  log(`Википедия: ${nWiki} заголовков`);

  out.sort((a, b) => b.f - a.f);
  const set: InitialsSet = { fetchedAt: new Date().toISOString(), entries: out };
  const file = join(ROOT, "wordsets", INITIALS_FILE);
  await writeFile(file, JSON.stringify(set), "utf8");
  const byKind: Record<string, number> = {};
  for (const e of out) byKind[e.k] = (byKind[e.k] ?? 0) + 1;
  log(`готово: ${out.length} записей → ${file}`);
  console.log(byKind);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

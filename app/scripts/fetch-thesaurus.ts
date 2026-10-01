// Тезаурус для кубраи: npm run fetch-thesaurus (отдельно от fetch-dict, как и прочие наборы).
//
// Первая версия брала из Викисловаря всё подряд — и автор получил «сакс → супер (антоним)»,
// «излучение → теле (антоним)». Разбор (2026-10-01) показал два источника мусора:
//   • другие части речи: «сакс» в Викисловаре — прилагательное «отстой», его антонимы «супер», «круто»;
//   • связь в одну сторону: у «тела» в физическом смысле антоним «излучение», а «излучение» про «тело» молчит.
// Поэтому теперь:
//   • антонимы — Викисловарь (kaikki.org), только существительное ↔ существительное и только взаимные
//     пары (обе статьи ссылаются друг на друга): война↔мир, исток↔устье, рай↔ад. Плюс короткий список
//     пар «он ↔ она» (брат↔сестра записан в Викисловаре только в одну сторону);
//   • синонимы — RuWordNet 2021 (экспертные синсеты: врач = доктор, собака = пёс) и взаимные пары
//     существительных Викисловаря. Однословные, только существительные.
// Редкие слова отсекает уже генератор — по частотному списку.

import { createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { get } from "node:https";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";

const DIR = join(import.meta.dirname, "..", "resources", "dict");
const URL_WIKI =
  "https://kaikki.org/ruwiktionary/%D0%A0%D1%83%D1%81%D1%81%D0%BA%D0%B8%D0%B9/kaikki.org-dictionary-%D0%A0%D1%83%D1%81%D1%81%D0%BA%D0%B8%D0%B9.jsonl.gz";
const URL_RWN = "https://github.com/avidale/python-ruwordnet/releases/download/0.0.4/ruwordnet-2021.db";

const WORD = /^[а-яё]+$/;

/**
 * Пары «он ↔ она» и родство: в загадке это ясный антоним («Барану — корова» = ОВЦЕБЫК в той самой теме),
 * а Викисловарь пишет их в одну сторону или вовсе не пишет.
 */
const PAIRS: [string, string][] = [
  ["брат", "сестра"], ["сын", "дочь"], ["отец", "мать"], ["муж", "жена"], ["дед", "бабка"], ["дедушка", "бабушка"],
  ["дядя", "тетя"], ["племянник", "племянница"], ["внук", "внучка"], ["жених", "невеста"], ["король", "королева"],
  ["царь", "царица"], ["принц", "принцесса"], ["мальчик", "девочка"], ["парень", "девушка"], ["мужчина", "женщина"],
  ["кот", "кошка"], ["бык", "корова"], ["баран", "овца"], ["петух", "курица"], ["конь", "кобыла"], ["пес", "сука"],
  ["волк", "волчица"], ["лев", "львица"], ["козел", "коза"], ["хряк", "свинья"], ["селезень", "утка"], ["гусь", "гусыня"],
];

/** «Пе́кло» → «пекло»; ё → е, как во всём тезаурусе. Снимаем только знаки ударения: дужку «й» не трогать. */
function clean(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const w = raw.normalize("NFD").replace(/[̀́]/g, "").normalize("NFC").toLowerCase().replace(/ё/g, "е").trim();
  return w.length >= 2 && w.length <= 20 && WORD.test(w) ? w : undefined;
}

function open(url: string, hops = 0): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (hops > 5) return reject(new Error("слишком много переадресаций"));
    get(url, { headers: { "user-agent": "siq-workshop/0.1 (SIGame pack workshop)" } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        open(new URL(res.headers.location, url).toString(), hops + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) return reject(new Error(`${url} ответил ${res.statusCode}`));
      resolve(res);
    }).on("error", reject);
  });
}

type Graph = Map<string, Set<string>>;

function link(g: Graph, a: string, b: string): void {
  if (a === b) return;
  let s = g.get(a);
  if (!s) g.set(a, (s = new Set()));
  s.add(b);
}

/** Оставить только пары, где каждое слово указывает на другое. */
function mutual(g: Graph): Graph {
  const out: Graph = new Map();
  for (const [a, set] of g) for (const b of set) if (g.get(b)?.has(a)) { link(out, a, b); link(out, b, a); }
  return out;
}

interface Entry {
  word?: string;
  lang_code?: string;
  pos?: string;
  synonyms?: { word?: string }[];
  antonyms?: { word?: string }[];
}

/** Викисловарь: связи только между статьями-существительными, в одну сторону — как записано. */
async function wiktionary(): Promise<{ syn: Graph; ant: Graph }> {
  process.stdout.write("Викисловарь (существительные)… ");
  const res = await open(URL_WIKI);
  const lines = createInterface({ input: res.pipe(createGunzip()), crlfDelay: Infinity });
  const syn: Graph = new Map();
  const ant: Graph = new Map();
  for await (const line of lines) {
    if (!line.includes('"pos": "noun"') && !line.includes('"pos":"noun"')) continue;
    if (!line.includes('"synonyms"') && !line.includes('"antonyms"')) continue;
    let e: Entry;
    try { e = JSON.parse(line) as Entry; } catch { continue; }
    if (e.pos !== "noun" || (e.lang_code && e.lang_code !== "ru")) continue;
    const w = clean(e.word);
    if (!w) continue;
    for (const x of e.synonyms ?? []) { const v = clean(x.word); if (v) link(syn, w, v); }
    for (const x of e.antonyms ?? []) { const v = clean(x.word); if (v) link(ant, w, v); }
  }
  console.log("готово");
  // взаимность заодно отсекает слова, у которых статьи-существительного нет вовсе
  return { syn: mutual(syn), ant: mutual(ant) };
}

/** RuWordNet: синонимы — однословные существительные одного синсета. */
async function ruwordnet(dir: string): Promise<Graph> {
  process.stdout.write("RuWordNet (синсеты существительных)… ");
  const file = join(dir, "ruwordnet.tmp.db");
  await pipeline(await open(URL_RWN), createWriteStream(file));
  const syn: Graph = new Map();
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare(
      "SELECT s.synset_id AS id, s.name AS name FROM sense s JOIN synset y ON y.id = s.synset_id WHERE y.part_of_speech = 'N'",
    ).all() as { id: string; name: string }[];
    const bySynset = new Map<string, string[]>();
    for (const r of rows) {
      const w = clean(r.name);
      if (!w) continue;
      const list = bySynset.get(r.id) ?? [];
      if (!list.includes(w)) list.push(w);
      bySynset.set(r.id, list);
    }
    for (const words of bySynset.values()) for (const a of words) for (const b of words) link(syn, a, b);
  } finally {
    db.close();
    await rm(file, { force: true });
  }
  console.log("готово");
  return syn;
}

export async function fetchThesaurus(dir = DIR): Promise<void> {
  await mkdir(dir, { recursive: true });
  const wiki = await wiktionary();
  const rwn = await ruwordnet(dir);

  const syn: Graph = new Map();
  for (const g of [wiki.syn, rwn]) for (const [a, set] of g) for (const b of set) link(syn, a, b);
  const ant: Graph = new Map();
  for (const [a, set] of wiki.ant) for (const b of set) link(ant, a, b);
  for (const [a, b] of PAIRS) { link(ant, a, b); link(ant, b, a); }

  // слово в антонимах не должно оставаться и в синонимах того же слова
  for (const [a, set] of ant) for (const b of set) syn.get(a)?.delete(b);

  const words = [...new Set([...syn.keys(), ...ant.keys()])].sort((a, b) => a.localeCompare(b, "ru"));
  const out = createWriteStream(join(dir, "ru-thes.tsv"), "utf8");
  for (const w of words) out.write(`${w}\t${[...(syn.get(w) ?? [])].join(",")}\t${[...(ant.get(w) ?? [])].join(",")}\n`);
  await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : r())));

  await writeFile(join(dir, "ru-thes.LICENSE.txt"), [
    "ru-thes.tsv — синонимы и антонимы существительных.",
    "Антонимы и часть синонимов: русский Викисловарь (ru.wiktionary.org), участники Викисловаря, CC BY-SA 4.0;",
    "  выгрузка kaikki.org (wiktextract, Tatu Ylonen). Оставлены только взаимные пары существительных.",
    "Синонимы: RuWordNet 2021 (НИВЦ МГУ, Н. В. Лукашевич и др.), ruwordnet.ru — условия использования там же.",
    "Сняты ударения, ё заменена на е.",
    "",
  ].join("\n"), "utf8");

  const pairs = (g: Graph) => [...g.values()].reduce((s, x) => s + x.size, 0) / 2;
  console.log(`${words.length.toLocaleString("ru")} слов: синонимов ~${Math.round(pairs(syn)).toLocaleString("ru")} пар, антонимов ~${Math.round(pairs(ant)).toLocaleString("ru")} пар`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void fetchThesaurus();

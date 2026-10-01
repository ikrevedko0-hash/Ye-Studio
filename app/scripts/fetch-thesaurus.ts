// Тезаурус для кубраи: npm run fetch-thesaurus (отдельно от fetch-dict, как и прочие наборы).
//
// Источник — русские статьи русского Викисловаря в выгрузке kaikki.org (wiktextract), CC BY-SA 4.0.
// Файл большой (≈200 МБ gz, 1,7 ГБ внутри), поэтому читаем его потоком и оставляем только
// синонимы и антонимы. Связи лежат на верхнем уровне статьи (`synonyms[].word`, `antonyms[].word`),
// в senses их нет. Ударения в словах бывают прямо в тексте («пе́кло») — снимаем.
//
// Ассоциации (`related`, `hyponyms`) не берём нарочно: автор решил делать только простые кубраи,
// где замену можно объяснить словарём. «related» к тому же почти сплошь однокоренные.

import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { get } from "node:https";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";

const DIR = join(import.meta.dirname, "..", "resources", "dict");
const URL_RU =
  "https://kaikki.org/ruwiktionary/%D0%A0%D1%83%D1%81%D1%81%D0%BA%D0%B8%D0%B9/kaikki.org-dictionary-%D0%A0%D1%83%D1%81%D1%81%D0%BA%D0%B8%D0%B9.jsonl.gz";

const WORD = /^[а-яё]+$/;

/** «Пе́кло» → «пекло»; фразы, латиница и дефисы в кубрае не нужны. */
function clean(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const w = raw.normalize("NFD").replace(/[\u0300\u0301]/g, "").normalize("NFC").toLowerCase().replace(/ё/g, "е").trim();
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

interface Entry {
  word?: string;
  lang_code?: string;
  synonyms?: { word?: string }[];
  antonyms?: { word?: string }[];
}

export async function fetchThesaurus(dir = DIR): Promise<void> {
  await mkdir(dir, { recursive: true });
  process.stdout.write("тезаурус (ru-thes.tsv, Викисловарь)… ");
  const res = await open(URL_RU);
  const lines = createInterface({ input: res.pipe(createGunzip()), crlfDelay: Infinity });
  // омонимы идут отдельными статьями — сливаем по слову
  const syn = new Map<string, Set<string>>();
  const ant = new Map<string, Set<string>>();
  const put = (m: Map<string, Set<string>>, w: string, list: { word?: string }[] | undefined) => {
    for (const x of list ?? []) {
      const v = clean(x.word);
      if (!v || v === w) continue;
      let s = m.get(w);
      if (!s) m.set(w, (s = new Set()));
      s.add(v);
    }
  };
  let n = 0;
  for await (const line of lines) {
    if (!line.includes('"synonyms"') && !line.includes('"antonyms"')) continue;
    let e: Entry;
    try { e = JSON.parse(line) as Entry; } catch { continue; }
    if (e.lang_code && e.lang_code !== "ru") continue;
    const w = clean(e.word);
    if (!w) continue;
    put(syn, w, e.synonyms);
    put(ant, w, e.antonyms);
    n++;
  }
  const words = [...new Set([...syn.keys(), ...ant.keys()])].sort((a, b) => a.localeCompare(b, "ru"));
  const out = createWriteStream(join(dir, "ru-thes.tsv"), "utf8");
  for (const w of words) out.write(`${w}\t${[...(syn.get(w) ?? [])].join(",")}\t${[...(ant.get(w) ?? [])].join(",")}\n`);
  await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : r())));
  // CC BY-SA требует указать источник и лицензию — файл едет в приложение рядом с тезаурусом
  await writeFile(join(dir, "ru-thes.LICENSE.txt"), [
    "ru-thes.tsv — синонимы и антонимы из русского Викисловаря (ru.wiktionary.org).",
    "Авторы: участники Викисловаря. Лицензия: CC BY-SA 4.0 — https://creativecommons.org/licenses/by-sa/4.0/",
    "Выгрузка: kaikki.org (wiktextract, Tatu Ylonen). Изменения: оставлены только связи synonyms/antonyms,",
    "сняты ударения, ё заменена на е. Этот файл распространяется на тех же условиях (CC BY-SA 4.0).",
    "",
  ].join("\n"), "utf8");
  console.log(`${words.length.toLocaleString("ru")} слов из ${n.toLocaleString("ru")} статей со связями`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void fetchThesaurus();

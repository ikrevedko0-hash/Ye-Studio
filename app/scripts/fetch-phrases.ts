// Разовая загрузка словаря выражений из русского Викисловаря: npm run fetch-phrases
//
// Три вида — фразеологизмы, пословицы и поговорки, крылатые выражения — берём списками категорий.
// Потом пачками по 50 статей узнаём все категории каждой фразы: из них получаются пометы
// (шутливое, грубое, просторечное…) и темы (малость, угрозы, пьянство…) для фильтров в окне.
// Викисловарь на частые запросы отвечает 429, поэтому ходим по одному запросу с паузой.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PHRASE_KINDS, PHRASE_STYLES, PHRASES_FILE, type PhraseEntry, type PhraseSet } from "../src/core/words/phrases";

const DIR = join(import.meta.dirname, "..", "resources", "wordsets");
const API = "https://ru.wiktionary.org/w/api.php";
const UA = "PackWorkshop/1.0 (SIGame pack editor; one-off dictionary download)";
const PAUSE_MS = 700;

/** Служебные категории и сами виды — не темы. */
const NOT_TOPIC = /^(Нужн|Статьи|Цитаты|Требуется|Русский язык|Слова|Страницы|Викисловарь|Шаблоны|Термины|Многозначные|Омонимы|Выражения с переносным|Публицистические|Устойчивые сочетания|Экспрессивные|Регионализмы|Отрицательные оценки|Нейтральные|Разговорные|Специальные)/;
/** Сырой ответ Викисловаря: поменять фильтры можно без 10-минутной загрузки (--offline). */
const RAW = join(import.meta.dirname, ".cache", "phrases-raw.json");
/** Тема попадает в фильтр, только если в ней набралось столько фраз: иначе список тем на сотни строк. */
const MIN_TOPIC = 12;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(params: Record<string, string>): Promise<any> {
  const url = `${API}?${new URLSearchParams({ ...params, format: "json", formatversion: "2" })}`;
  for (let attempt = 1; ; attempt++) {
    await wait(PAUSE_MS);
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (r.ok) return r.json();
    if (r.status === 429 && attempt < 6) {
      const s = Number(r.headers.get("retry-after")) || attempt * 10;
      process.stdout.write(` [429, жду ${s} с]`);
      await wait(s * 1000);
      continue;
    }
    throw new Error(`HTTP ${r.status}`);
  }
}

async function members(category: string): Promise<string[]> {
  const out: string[] = [];
  let cont: Record<string, string> = {};
  do {
    const j = await api({ action: "query", list: "categorymembers", cmtitle: `Категория:${category}`, cmnamespace: "0", cmlimit: "500", ...cont });
    for (const m of j.query.categorymembers) out.push(m.title);
    cont = j.continue ?? {};
    process.stdout.write(".");
  } while (cont.cmcontinue);
  return out;
}

/** Все категории статей (без скрытых), пачками по 50 — столько API отдаёт за раз. */
async function categoriesOf(titles: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    let cont: Record<string, string> = {};
    do {
      const j = await api({ action: "query", prop: "categories", titles: batch.join("|"), cllimit: "max", clshow: "!hidden", ...cont });
      for (const p of j.query.pages ?? []) {
        const list = out.get(p.title) ?? [];
        for (const c of p.categories ?? []) list.push(String(c.title).replace(/^Категория:/, ""));
        out.set(p.title, list);
      }
      cont = j.continue ?? {};
    } while (cont.clcontinue);
    if ((i / 50) % 10 === 0) process.stdout.write(` ${i}`);
  }
  return out;
}

async function main() {
  await mkdir(DIR, { recursive: true });
  let kindOf: Map<string, Set<string>>;
  let cats: Map<string, string[]>;
  if (process.argv.includes("--offline")) {
    const raw = JSON.parse(await readFile(RAW, "utf8")) as { kinds: [string, string[]][]; cats: [string, string[]][] };
    kindOf = new Map(raw.kinds.map(([t, k]) => [t, new Set(k)]));
    cats = new Map(raw.cats);
  } else {
    kindOf = new Map();
    for (const k of PHRASE_KINDS) {
      process.stdout.write(`${k.title}: `);
      const list = await members(k.category);
      console.log(` ${list.length}`);
      for (const t of list) (kindOf.get(t) ?? kindOf.set(t, new Set()).get(t)!).add(k.id);
    }
    process.stdout.write(`Категории ${kindOf.size} статей:`);
    cats = await categoriesOf([...kindOf.keys()]);
    console.log();
    await mkdir(join(RAW, ".."), { recursive: true });
    await writeFile(RAW, JSON.stringify({ kinds: [...kindOf].map(([t, k]) => [t, [...k]]), cats: [...cats] }), "utf8");
  }
  const titles = [...kindOf.keys()];

  const styleByCat = new Map(PHRASE_STYLES.flatMap((s) => s.categories.map((c) => [c, s.id] as const)));
  const kindCats = new Set(PHRASE_KINDS.map((k) => k.category));
  const topicCount = new Map<string, number>();
  const raw = titles.map((text) => {
    const all = cats.get(text) ?? [];
    const styles = [...new Set(all.map((c) => styleByCat.get(c)).filter((s): s is string => !!s))];
    const topics = all
      .filter((c) => c.endsWith("/ru") && !kindCats.has(c) && !styleByCat.has(c) && !NOT_TOPIC.test(c))
      .map((c) => c.slice(0, -3));
    for (const t of topics) topicCount.set(t, (topicCount.get(t) ?? 0) + 1);
    return { text, kinds: [...kindOf.get(text)!], styles, topics };
  });
  const phrases: PhraseEntry[] = raw
    .map((p) => ({ ...p, topics: p.topics.filter((t) => (topicCount.get(t) ?? 0) >= MIN_TOPIC) }))
    .sort((a, b) => a.text.localeCompare(b.text, "ru"));
  const topics = [...topicCount].filter(([, n]) => n >= MIN_TOPIC).sort((a, b) => b[1] - a[1]).map(([t]) => t);

  const set: PhraseSet = { source: "ru.wiktionary.org", fetchedAt: new Date().toISOString(), topics, phrases };
  await writeFile(join(DIR, PHRASES_FILE), JSON.stringify(set), "utf8");
  console.log(`Готово: ${phrases.length} выражений, тем ${topics.length} (${topics.slice(0, 12).join(", ")}…)`);
  for (const s of PHRASE_STYLES) console.log(`  ${s.title}: ${phrases.filter((p) => p.styles.includes(s.id)).length}`);
}

void main();

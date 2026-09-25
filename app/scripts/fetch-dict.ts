// Разовая загрузка словарей для «Студии слов»: npm run fetch-dict
//
// Словари в репозиторий не кладём — они большие и общедоступные. Скрипт качает их в resources/dict,
// оттуда electron-builder кладёт их в готовое приложение (extraResources).
//
// Что берём и зачем:
//   ru-forms.txt  — все словоформы (≈1,5 млн). Нужны именно формы, а не начальные слова:
//                   в примере автора «шлю → шлюпка, пошлю, шлюха» слово «пошлю» — это форма глагола.
//                   Исходник в кодировке CP1251, переводим в UTF-8.
//   ru-nouns.txt  — существительные: ими удобно отбирать ответы, они в паках почти всегда существительные.
//   ru-common.txt — 10 тысяч самых частых слов: отсев редкой и словарной экзотики.
//   ru-freq.txt   — 150 тысяч слов живой речи по убыванию частоты. Даёт головоломкам порядок:
//                   «эпизод» показываем раньше «пизолита», хотя оба подходят под «пиз».
//
// Отдельная история — словарь Зализняка (danakt) не знает поздних заимствований: «эскапизма»
// в нём нет вовсе, и никакой настройкой поиска это не лечится. Поэтому к нему подмешивается
// частотный список по субтитрам (hermitdave): слова, встреченные в живой речи не меньше трёх раз.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { get } from "node:https";
import { join } from "node:path";

const DIR = join(import.meta.dirname, "..", "resources", "dict");

interface Source {
  file: string;
  url: string;
  encoding: "cp1251" | "utf8";
  what: string;
}

const SOURCES: Source[] = [
  { file: "ru-forms.txt", url: "https://raw.githubusercontent.com/danakt/russian-words/master/russian.txt", encoding: "cp1251", what: "словоформы" },
  { file: "ru-nouns.txt", url: "https://raw.githubusercontent.com/Harrix/Russian-Nouns/main/dist/russian_nouns.txt", encoding: "utf8", what: "существительные" },
  { file: "ru-common.txt", url: "https://raw.githubusercontent.com/hingston/russian/master/10000-russian-words.txt", encoding: "utf8", what: "частотные слова" },
];

/** Живая речь: слово и сколько раз встретилось в субтитрах. Из него растут и ru-freq, и добавка к формам. */
const LIVE = "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/ru/ru_full.txt";

/** Реже трёх раз на весь корпус — это уже опечатки и обрывки, в словарь им не надо. */
const LIVE_MIN = 3;

/** Сколько слов живой речи помнить по порядку частоты: хватает, чтобы отличить частое от редкого. */
const FREQ_TOP = 150_000;

function download(url: string, hops = 0): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (hops > 5) return reject(new Error("слишком много переадресаций"));
    get(url, { headers: { "user-agent": "siq-workshop/0.1 (SIGame pack workshop)" } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        download(new URL(res.headers.location, url).toString(), hops + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) return reject(new Error(`${url} ответил ${res.statusCode}`));
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

/** Оставляем только русские слова: латиница, цифры и мусор в головоломках не нужны. */
const WORD = /^[а-яё]+(-[а-яё]+)*$/;

function clean(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const w = raw.trim().toLowerCase().replace(/^-+/, "");
    if (w.length < 2 || w.length > 30) continue;
    if (!WORD.test(w)) continue;
    out.add(w);
  }
  return [...out].sort((a, b) => a.localeCompare(b, "ru"));
}

/** Разбор частотного списка: «слово частота» в строке, уже отсортировано по убыванию. */
function parseLive(text: string): { word: string; count: number }[] {
  const out: { word: string; count: number }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const sp = line.indexOf(" ");
    if (sp <= 0) continue;
    const word = line.slice(0, sp).trim().toLowerCase();
    const count = Number(line.slice(sp + 1));
    if (!Number.isFinite(count) || word.length < 2 || word.length > 30) continue;
    if (!WORD.test(word)) continue;
    out.push({ word, count });
  }
  return out;
}

const ALPHABET = [..."абвгдеёжзийклмнопрстуфхцчшщъыьэюя-"];

/**
 * Слово из субтитров — это опечатка известного слова?
 * Проверяем две самые частые беды расшифровки: одна буква не та и одна буква лишняя.
 * Так отсеиваются «епизод» и «ёпизод» при живом «эпизод», «сюрпиз» при «сюрприз».
 *
 * Настоящие новые слова («эскапизм», «пофигизм») соседей в словаре не имеют и остаются.
 */
function isTypoOf(word: string, known: Set<string>): boolean {
  for (let i = 0; i < word.length; i++) {
    if (known.has(word.slice(0, i) + word.slice(i + 1))) return true;
    for (const ch of ALPHABET) {
      if (ch === word[i]) continue;
      if (known.has(word.slice(0, i) + ch + word.slice(i + 1))) return true;
    }
  }
  return false;
}

/** Слово, встреченное хотя бы столько раз, считаем настоящим даже при похожем соседе. */
const TYPO_SAFE = 50;

async function main() {
  await mkdir(DIR, { recursive: true });
  for (const s of SOURCES) {
    process.stdout.write(`${s.what} (${s.file})… `);
    const buf = await download(s.url);
    const text = s.encoding === "cp1251" ? new TextDecoder("windows-1251").decode(buf) : buf.toString("utf8");
    const words = clean(text);
    await writeFile(join(DIR, s.file), words.join("\n"), "utf8");
    console.log(`${words.length.toLocaleString("ru")} слов, ${(Buffer.byteLength(words.join("\n")) / 1024 / 1024).toFixed(1)} МБ`);
  }
  // живая речь: порядок частоты в ru-freq.txt и добавка к словоформам
  process.stdout.write("живая речь (ru-freq.txt)… ");
  const live = parseLive((await download(LIVE)).toString("utf8"));
  const freq = live.slice(0, FREQ_TOP).map((x) => x.word);
  await writeFile(join(DIR, "ru-freq.txt"), freq.join("\n"), "utf8");
  console.log(`${freq.length.toLocaleString("ru")} слов по убыванию частоты`);

  process.stdout.write("добавка к словоформам… ");
  const formsPath = join(DIR, "ru-forms.txt");
  const have = new Set((await readFile(formsPath, "utf8")).split("\n"));
  const before = have.size;
  let typos = 0;
  for (const { word, count } of live) {
    if (count < LIVE_MIN || have.has(word)) continue;
    if (count < TYPO_SAFE && isTypoOf(word, have)) { typos++; continue; }
    have.add(word);
  }
  const merged = [...have].filter(Boolean).sort((a, b) => a.localeCompare(b, "ru"));
  await writeFile(formsPath, merged.join("\n"), "utf8");
  console.log(`+${(merged.length - before).toLocaleString("ru")} слов, всего ${merged.length.toLocaleString("ru")}; отброшено опечаток: ${typos.toLocaleString("ru")}`);

  console.log(`Готово: ${DIR}`);
}

void main();

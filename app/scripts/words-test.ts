// Проверка «Студии слов» без окна: npx tsx scripts/words-test.ts
import { join } from "node:path";
import { Dictionary } from "../src/core/words/dict";
import { anagramGenerator } from "../src/core/words/generators/anagram";
import { matrixGenerator, suggestFragments } from "../src/core/words/generators/matrix";
import { longestCommonChunk, fixedPoints, scramble } from "../src/core/words/scramble";
import { wordSourceById } from "../src/core/words/sources/registry";

const dict = new Dictionary(join(import.meta.dirname, "..", "resources", "dict"));
let failed = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "  ok  " : "ПРОВАЛ"} ${m}`); if (!c) failed++; };

async function main() {
  console.log("Словари:", (await dict.stats()).map((s) => `${s.set}=${s.words}`).join(" "));

  // ---------- матрицы ----------
  let t = Date.now();
  const m = await matrixGenerator.run(dict, { fragment: "шлю", set: "forms", minLen: 4, maxLen: 10, limit: 40 });
  const words = m.hits.map((h) => h.word);
  console.log(`  матрица «шлю» (${Date.now() - t} мс):`, words.slice(0, 16).join(", "));
  ok(words.includes("шлюпка"), "«шлюпка» нашлась (кусок в начале)");
  ok(words.includes("пошлю"), "«пошлю» нашлась (кусок в конце)");
  ok(words.some((w) => !w.startsWith("шлю") && !w.endsWith("шлю")), "есть слова с куском в середине");

  // ---------- перемешивание букв ----------
  const isWord = await dict.matcher("forms");
  const kr = scramble("Красноярск", { isWord });
  console.log(`  Красноярск → ${kr.scrambled} (кусок ${kr.score.chunk}, на местах ${kr.score.fixed})`);
  ok(kr.scrambled.length === "Красноярск".length, "длина сохранилась");
  ok([...kr.scrambled].sort().join("") === [..."красноярск"].sort().join(""), "буквы те же");
  ok(fixedPoints("красноярск", kr.scrambled) === 0, "ни одна буква не осталась на своём месте");
  ok(longestCommonChunk("красноярск", kr.scrambled) <= 2, "читаемых кусков исходника не осталось");
  ok(!isWord(kr.scrambled), "перемешанное не оказалось настоящим словом");
  ok(scramble("Красноярск", { isWord }).scrambled === kr.scrambled, "повтор даёт тот же результат");

  // ---------- источники слов ----------
  const manual = wordSourceById(dict, "manual")!;
  const own = await manual.list({ limit: 10, minLen: 4, maxLen: 20, text: "Красноярск, Вологда, Мурманск" });
  ok(own.words.length === 3, `свой список принят: ${own.words.map((w) => w.word).join(", ")}`);

  t = Date.now();
  try {
    const wd = wordSourceById(dict, "wikidata")!;
    const cities = await wd.list({ limit: 12, minLen: 5, maxLen: 12, preset: "cities-ru" });
    console.log(`  Wikidata «${cities.title}» (${Date.now() - t} мс):`, cities.words.map((w) => w.word).join(", "));
    ok(cities.words.length > 0, "Wikidata отдала города");
    ok(cities.words.some((w) => ["Москва", "Казань", "Самара", "Воронеж", "Красноярск", "Волгоград"].includes(w.word)), "в начале списка известные города, а не городища");
  } catch (e) {
    console.log(`  — Wikidata недоступна из этой среды: ${(e as Error).message.slice(0, 90)}`);
  }

  // ---------- готовая тема ----------
  t = Date.now();
  const theme = await anagramGenerator.run(dict, { source: "manual", text: "Красноярск, Вологда, Мурманск, Саратов, Иркутск", minLen: 5, maxLen: 12, limit: 10 });
  console.log(`  тема (${Date.now() - t} мс):`, theme.hits.map((h) => `${h.why}→${h.word}`).join(", "));
  ok(theme.hits.length > 0, "тема собралась");
  ok(theme.hits.every((h) => h.why !== h.word.toUpperCase()), "вопрос не совпадает с ответом");
  ok(theme.hits.every((h) => [...h.why.toLowerCase()].sort().join("") === [...h.word.toLowerCase()].sort().join("")), "у всех вопросов те же буквы, что в ответе");

  const frags = await suggestFragments(dict, { set: "common" }, 3, 6);
  ok(frags.length > 0, `куски для матриц предлагаются: ${frags.map((f) => f.fragment).join(" ")}`);

  console.log(failed ? `\nПРОВАЛОВ: ${failed}` : "\nВсё прошло.");
  process.exit(failed ? 1 : 0);
}
void main();

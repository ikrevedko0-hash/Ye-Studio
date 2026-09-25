// Разовая загрузка тематических наборов: npm run fetch-wordsets
//
// Зачем. Живой запрос к Wikidata идёт от секунд до минут — в окне это выглядит как «зависло».
// Списки городов и химических элементов не меняются, поэтому скачиваем их заранее, кладём
// рядом со словарями и в работе к сети больше не ходим.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchSet, PRESETS, SET_FILE } from "../src/core/words/sources/wikidata";

const DIR = join(import.meta.dirname, "..", "resources", "wordsets");

async function main() {
  await mkdir(DIR, { recursive: true });
  let failed = 0;
  for (const preset of PRESETS) {
    process.stdout.write(`${preset.title}… `);
    const t = Date.now();
    try {
      const set = await fetchSet(preset);
      await writeFile(join(DIR, SET_FILE(preset.value)), JSON.stringify(set), "utf8");
      console.log(`${set.words.length} слов за ${((Date.now() - t) / 1000).toFixed(1)} с` + (set.words[0] ? ` (первое: ${set.words[0].word})` : ""));
    } catch (e) {
      failed++;
      console.log(`не вышло: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  console.log(failed ? `Готово, но ${failed} наборов не скачалось: ${DIR}` : `Готово: ${DIR}`);
}

void main();

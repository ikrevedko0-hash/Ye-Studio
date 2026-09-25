// Проверка поиска произведений в Wikidata живыми запросами (нужна сеть, ключи не нужны).
//   npx tsx scripts/works-test.ts [название…]
// Печатает, что нашлось по началу названия, и карточку первого найденного — как её получит модель.

import { searchWorks, workContext, workDetails } from "../src/core/ai/works";

async function main() {
  const queries = process.argv.slice(2);
  for (const q of queries.length ? queries : ["Солнцестоя", "Сияние", "Ёжик в тум", "Мастер и Маргарита", "Остров"]) {
    const hits = await searchWorks(q);
    console.log(`\n«${q}»: ${hits.length ? "" : "ничего"}`);
    for (const h of hits) console.log(`  ${h.id}  ${h.title} — ${h.about}`);
    if (hits[0]) console.log(`  ↳ ${workContext(await workDetails(hits[0].id, hits[0])).replace(/\n/g, "\n    ")}`);
  }
}

main().catch((e) => {
  console.error(`ПРОВАЛ: ${(e as Error).message}`);
  process.exit(1);
});

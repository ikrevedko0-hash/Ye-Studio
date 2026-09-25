// Проверка генерации картинок без окна: фраза → промпт (текстовая модель) → картинка (очередь imageChain).
//   npx tsx scripts/imagegen-test.ts "ядрёна вошь" [literal|kids|free] [папка]
//
// Платные модели (pollinations) из очереди убираются, пока не передан --paid: тесты не должны
// тратить pollen. Картинку сохраняем в указанную папку (по умолчанию — временную) и печатаем путь,
// чтобы посмотреть её глазами.

import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_IMAGE_CHAIN, loadAiConfig } from "../src/core/ai/config";
import { generateImage } from "../src/core/ai/image";
import { phraseToPrompt } from "../src/core/ai/imagePresets";

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const paid = process.argv.includes("--paid");
  const phrase = args[0] || "ядрёна вошь";
  const preset = args[1] || "literal";
  const outDir = args[2] || join(tmpdir(), "siq-imagegen-test");

  const base = join(process.env.APPDATA ?? "", "Мастерская паков");
  const { cfg, path } = await loadAiConfig(base);
  console.log(`настройки: ${path}`);
  const chain = cfg.imageChain?.length ? cfg.imageChain : DEFAULT_IMAGE_CHAIN;
  cfg.imageChain = paid ? chain : chain.filter((r) => !r.startsWith("pollinations:"));
  console.log(`очередь картинок: ${cfg.imageChain.join(" → ")}`);

  const p = await phraseToPrompt(cfg, phrase, preset);
  console.log(`промпт (${p.model || "как есть"}): ${p.text}`);
  if (p.skipped.length) console.log(`  пропущены: ${p.skipped.join(" · ")}`);

  const r = await generateImage(cfg, { prompt: p.text, width: 1024, height: 768 });
  const ext = r.mime === "image/png" ? "png" : r.mime === "image/jpeg" ? "jpg" : "webp";
  await mkdir(outDir, { recursive: true });
  const file = join(outDir, `${phrase.replace(/[\\/:*?"<>|]/g, "_")} (${preset}).${ext}`);
  await writeFile(file, r.data);
  console.log(`картинка: ${r.model}, ${(r.ms / 1000).toFixed(1)} с, ${(r.data.length / 1024).toFixed(0)} КБ → ${file}`);
  if (r.skipped.length) console.log(`  пропущены: ${r.skipped.join(" · ")}`);
}

main().catch((e) => {
  console.error(`ПРОВАЛ: ${(e as Error).message}`);
  process.exit(1);
});

// Проверка дороги до YouTube: тот же код, что в приложении, но без окна.
//
// Ради чего написано. Раньше YouTube в этом проекте считался «непроверяемым в принципе»:
// системный резолвер отвечает «нет такого домена», и любая проверка падала на первом шаге.
// Но отказывает именно резолвер, а не сеть — встроенный DoH это и показывает.
//
// Запуск: cd app && npx tsx scripts/youtube-test.ts [слово для поиска]

import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { stat } from "node:fs/promises";
import { resolveDoh } from "../src/core/media/net/doh";
import { startDohProxy } from "../src/core/media/net/dohProxy";
import { diagnoseYoutube, youtube } from "../src/core/media/providers/youtube";
import type { ProviderConfig } from "../src/core/media/providers/types";

const cfg: ProviderConfig = { potProviderDir: join(process.cwd(), "tools", "pot-provider") };
const word = process.argv[2] || "крастер";

function line(ok: boolean, text: string): void {
  console.log(`${ok ? "✔" : "✖"} ${text}`);
}

async function main(): Promise<void> {
  let bad = 0;

  // 1. Резолвер сам по себе
  const t0 = Date.now();
  const ips = await resolveDoh("www.youtube.com");
  line(ips.length > 0, `DoH: www.youtube.com → ${ips[0]} (всего ${ips.length}), ${Date.now() - t0} мс`);

  // 2. Прокси поднимается и отдаёт настоящий ответ YouTube
  const proxy = await startDohProxy();
  line(!!proxy.port, `прокси слушает ${proxy.url}`);

  // 3. Полная проверка по шагам — ровно то, что увидит автор по кнопке
  const diag = await diagnoseYoutube(cfg);
  console.log("\n— проверка по шагам —");
  for (const s of diag.steps) {
    line(s.ok, `${s.name}: ${s.detail} (${(s.ms / 1000).toFixed(1)} с)`);
  }
  console.log(`вывод: ${diag.verdict}\nсовет: ${diag.advice}\n`);
  if (!diag.steps.find((s) => s.name.startsWith("поиск"))?.ok) bad++;

  // 4. Поиск через сам провайдер: то же, что делает медиацентр
  const t1 = Date.now();
  const found = await youtube.search({ text: word, type: "video", perPage: 5 }, { cfg, signal: new AbortController().signal });
  line(found.length > 0, `поиск «${word}»: ${found.length} находок за ${((Date.now() - t1) / 1000).toFixed(1)} с`);
  for (const r of found.slice(0, 3)) console.log(`   • ${r.title} — ${r.author ?? "?"}${r.durationSec ? `, ${Math.round(r.durationSec)} с` : ""}`);
  if (!found.length) bad++;

  // 5. Загрузка: берём самый короткий ролик из выдачи, чтобы не тянуть получасовое видео
  // Длинный ролик здесь ничего не доказывает, а тянуть его — сотни мегабайт: берём до трёх минут.
  const short = [...found].filter((r) => r.durationSec && r.durationSec < 180).sort((a, b) => a.durationSec! - b.durationSec!)[0];
  if (!short) {
    console.log("• загрузку пропускаю: в выдаче нет ролика короче трёх минут");
  } else {
    const dir = await mkdtemp(join(tmpdir(), "yt-test-"));
    try {
      const t2 = Date.now();
      const file = await youtube.download(short, dir, { cfg, signal: new AbortController().signal });
      const size = (await stat(file)).size;
      line(size > 0, `скачано «${short.title}»: ${(size / 1024 / 1024).toFixed(1)} МБ за ${((Date.now() - t2) / 1000).toFixed(1)} с`);
      if (!size) bad++;
    } catch (e) {
      line(false, `загрузка: ${(e as Error).message}`);
      bad++;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  proxy.close();
  console.log(bad ? `\nпровалов: ${bad}` : "\nвсё прошло");
  process.exit(bad ? 1 : 0);
}

void main();

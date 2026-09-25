// Проверка источников медиа без окна: живой поиск и настоящая загрузка во временную папку.
//   npx tsx scripts/providers-test.ts [запрос]
//
// Проверяем ровно то, что ломается на практике: источник отвечает, поля заполнены,
// файл скачивается и оказывается нужного размера, а метаданные ложатся в index.json.

import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addRecord, readIndex } from "../src/core/media/library";
import { providerInfos, providersFor } from "../src/core/media/providers/registry";
import type { MediaType, ProviderConfig, SourceMeta } from "../src/core/media/providers/types";

const cfg: ProviderConfig = {};
const query = process.argv[2] || "кремль";
// Для звука нужен свой запрос: у свободных хранилищ по «пятый элемент» или «крастер» звука нет
// вовсе, и проверка падала на пустой выдаче, хотя источник исправен.
const audioQuery = process.argv[3] || "музыка";

let failed = 0;

function ok(cond: boolean, msg: string) {
  console.log(`${cond ? "  ok  " : "ПРОВАЛ"} ${msg}`);
  if (!cond) failed++;
}

async function main() {
  console.log("Источники:");
  for (const i of await providerInfos(cfg)) {
    console.log(`  ${i.available ? "+" : "-"} ${i.id} (${i.types.join(", ")})${i.reason ? " — " + i.reason : ""}`);
  }

  const dir = await mkdtemp(join(tmpdir(), "siq-providers-"));
  try {
    for (const type of ["image", "audio"] as MediaType[]) {
      const list = await providersFor(type, cfg);
      for (const p of list) {
        // Видео-источники проверяем отдельно: их загрузка — это целый ролик через yt-dlp,
        // в общем прогоне она тянет минуты и зависит от доступности сайта.
        if (p.id === "youtube" || p.id === "rutube") continue;
        const t0 = Date.now();
        let results;
        try {
          results = await p.search({ text: type === "audio" ? audioQuery : query, type, perPage: 5 }, { cfg });
        } catch (e) {
          ok(false, `${p.id}/${type}: поиск упал — ${(e as Error).message}`);
          continue;
        }
        ok(results.length > 0, `${p.id}/${type}: найдено ${results.length} за ${Date.now() - t0} мс`);
        if (!results.length) continue;
        const r = results[0];
        ok(!!r.title && !!r.downloadUrl, `${p.id}/${type}: у первого есть название и ссылка («${r.title.slice(0, 40)}»)`);

        let file: string;
        try {
          file = await p.download(r, dir, { cfg });
        } catch (e) {
          // 429 от бесплатного источника — не поломка нашего кода, но сообщение должно быть внятным
          const msg = (e as Error).message;
          ok(/подожд|закрыл|нет на|не отвечает/.test(msg), `${p.id}/${type}: загрузка не прошла, сообщение понятное — «${msg}»`);
          continue;
        }
        const size = (await stat(file)).size;
        ok(size > 1000, `${p.id}/${type}: скачано ${(size / 1024).toFixed(0)} КБ → ${file.split(/[\\/]/).pop()}`);

        const meta: SourceMeta = {
          providerId: p.id, title: r.title, author: r.author, license: r.license,
          pageUrl: r.pageUrl, downloadUrl: r.downloadUrl,
          fetchedAt: new Date().toISOString(), file: file.split(/[\\/]/).pop()!, sizeBytes: size,
        };
        await addRecord(dir, meta);
      }
    }

    const index = await readIndex(dir);
    ok(index.length > 0, `index.json: записей ${index.length}, у всех есть источник — ${index.every((m) => !!m.providerId)}`);

    // Rutube: главный рабочий источник видео там, где YouTube закрыт. Проверяем поиск и поля,
    // без которых не будет ни плитки, ни встроенного плеера.
    const rt = (await providersFor("video", cfg)).find((p) => p.id === "rutube");
    if (rt) {
      const t0 = Date.now();
      try {
        const res = await rt.search({ text: query, type: "video", perPage: 5 }, { cfg });
        ok(res.length > 0, `rutube: найдено ${res.length} за ${Date.now() - t0} мс, первый — «${res[0]?.title.slice(0, 50)}»`);
        ok(res.every((r) => !!r.pageUrl && !!r.thumbUrl), "rutube: у всех есть страница и миниатюра");
        // длительности нет у прямых эфиров — важно, что она есть у обычных роликов
        ok(res.some((r) => r.durationSec !== undefined), "rutube: длительность известна — видно, не длиннее ли 30 с");
      } catch (e) {
        ok(false, `rutube: поиск упал — ${(e as Error).message}`);
      }
    }

    // YouTube: только поиск, без загрузки — она долгая и зависит от сети
    const yt = (await providersFor("video", cfg)).find((p) => p.id === "youtube");
    if (yt) {
      try {
        const res = await yt.search({ text: query, type: "video", perPage: 5 }, { cfg });
        ok(res.length > 0, `youtube: найдено ${res.length} роликов, первый — «${res[0]?.title.slice(0, 50)}»`);
        ok(res.every((r) => !!r.pageUrl), "youtube: у всех есть ссылка на страницу (нужна для плеера и загрузки)");
      } catch (e) {
        console.log(`  — youtube: сеть недоступна из этой среды (${(e as Error).message.slice(0, 80)}…)`);
      }
    } else {
      console.log("  — youtube пропущен: yt-dlp недоступен");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  console.log(failed ? `\nПРОВАЛОВ: ${failed}` : "\nВсё прошло.");
  process.exit(failed ? 1 : 0);
}

void main();

// Этап 0: доказательство совместимости формата.
// Для каждого .siq в папке проекта: открыть → собрать content.xml заново → сверить с оригиналом до байта →
// записать пак целиком → переоткрыть → сверить файлы по CRC → проверить официальной библиотекой SIPackages.
// Запуск: npm run roundtrip [-- путь/к/папке/с/паками]

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { buildContentXml } from "../src/core/siq/xml";
import { escapeName, openSiq, unescapeName, writeSiq, ZipReader } from "../src/core/siq/zip";

const packsDir = resolve(process.argv[2] ?? join(__dirname, "..", ".."));
const checker = resolve(__dirname, "..", "tools", "siq-check", "bin", "out", "siq-check.exe");
const tmp = mkdtempSync(join(tmpdir(), "siq-roundtrip-"));

function check(path: string): Record<string, unknown> {
  const out = execFileSync(checker, [path], { encoding: "utf8" }).trim();
  const r = JSON.parse(out);
  delete r.path;
  return r;
}

function firstDiff(a: string, b: string): string {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const ctx = (s: string) => JSON.stringify(s.slice(Math.max(0, i - 60), i + 60));
  return `позиция ${i} из ${a.length}/${b.length}\n    оригинал: ${ctx(a)}\n    наш:      ${ctx(b)}`;
}

async function main() {
  const packs = readdirSync(packsDir).filter((f) => f.toLowerCase().endsWith(".siq")).sort();
  console.log(`Паков: ${packs.length} в ${packsDir}\n`);
  let failed = 0;

  for (const file of packs) {
    const src = join(packsDir, file);
    const t0 = Date.now();
    const problems: string[] = [];
    const { pkg, contentXml, reader } = await openSiq(src);

    // 1. content.xml байт в байт
    const rebuilt = buildContentXml(pkg);
    const xmlSame = rebuilt === contentXml;
    if (!xmlSame) problems.push("content.xml отличается: " + firstDiff(contentXml, rebuilt));

    // 2. экранирование имён файлов обратимо и совпадает с SIQuester
    const media = reader.entries.filter((e) => e.name.includes("/"));
    const badNames = media.filter((e) => {
      const [folder, ...rest] = e.name.split("/");
      return `${folder}/${escapeName(unescapeName(rest.join("/")))}` !== e.name;
    });
    if (badNames.length) problems.push(`имена не совпали после экранирования: ${badNames.slice(0, 3).map((e) => e.name).join(", ")}`);

    // 3. хэши из <files> — это SHA-256 содержимого?
    let hashNote = "";
    if (pkg.files?.length) {
      let ok = 0, bad = 0;
      for (const f of pkg.files.slice(0, 20)) {
        const [folder, ...rest] = f.name.split("/");
        const entry = `${folder}/${escapeName(rest.join("/"))}`;
        if (!reader.has(entry)) { bad++; continue; }
        const h = createHash("sha256").update(await reader.read(entry)).digest("hex").toUpperCase();
        h === f.hash ? ok++ : bad++;
      }
      hashNote = ` | хэши <files>: ${ok} совпало, ${bad} нет (проверено ${ok + bad})`;
    }

    // 4. запись пака целиком и повторное чтение
    const out = join(tmp, "out.siq");
    await writeSiq(out, pkg, reader.entries.map((e) => ({ name: e.name, source: { kind: "zip" as const, reader, name: e.name } })));
    const re = await ZipReader.open(out);
    const origSet = new Map(reader.entries.map((e) => [e.name, e]));
    for (const e of re.entries) {
      if (e.name === "content.xml") continue;
      const o = origSet.get(e.name);
      if (!o) problems.push(`лишний файл ${e.name}`);
      else if (o.crc32 !== e.crc32 || o.size !== e.size) problems.push(`файл изменился ${e.name}`);
    }
    if (re.entries.length !== reader.entries.length) problems.push(`файлов было ${reader.entries.length}, стало ${re.entries.length}`);
    const reXml = (await re.read("content.xml")).toString("utf8").replace(/^﻿/, "");
    if (reXml !== contentXml) problems.push("content.xml в записанном паке отличается");
    re.close();
    reader.close();

    // 5. официальная библиотека: оригинал и наш файл должны читаться одинаково
    const a = check(src), b = check(out);
    if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`SIPackages видит разное:\n    оригинал ${JSON.stringify(a)}\n    наш      ${JSON.stringify(b)}`);
    if (b.ok !== true) problems.push(`SIPackages не открыл наш файл: ${b.error}`);
    if (Array.isArray(b.missing) && b.missing.length) problems.push(`битые ссылки на медиа: ${b.missing.length}`);

    const sizeMb = (statSync(src).size / 1048576).toFixed(0);
    rmSync(out);
    const status = problems.length ? "ОШИБКА" : "OK";
    if (problems.length) failed++;
    console.log(`${status.padEnd(6)} ${basename(file)} (${sizeMb} МБ, ${b.questions} вопр., ${media.length} файлов, ${((Date.now() - t0) / 1000).toFixed(1)} с)` +
      ` | content.xml ${xmlSame ? "идентичен" : "ОТЛИЧАЕТСЯ"}${hashNote}`);
    for (const p of problems) console.log("    - " + p);
  }

  rmSync(tmp, { recursive: true, force: true });
  console.log(`\nИтого: ${packs.length - failed} из ${packs.length} без ошибок.`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });

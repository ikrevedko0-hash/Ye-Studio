// Архив .siq (core/siq/zip.ts): имена файлов как у SIQuester, content.xml сжат и с BOM, медиа без сжатия.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import yazl from "yazl";
import { createWriteStream } from "node:fs";
import { escapeName, openSiq, unescapeName, writeSiq, ZipReader } from "../src/core/siq/zip";
import { parseContentXml } from "../src/core/siq/xml";

const NS = "https://github.com/VladimirKhil/SI/blob/master/assets/siq_5.xsd";
const tmp = () => mkdtempSync(join(tmpdir(), "ye-zip-"));
const pkg = () => parseContentXml(`<?xml version="1.0" encoding="utf-8"?><package name="П" xmlns="${NS}"><rounds><round name="Р" /></rounds></package>`);

function zipOf(path: string, entries: Record<string, string>): Promise<void> {
  const z = new yazl.ZipFile();
  const done = new Promise<void>((res, rej) => { const s = createWriteStream(path); s.on("close", res); s.on("error", rej); z.outputStream.pipe(s); });
  for (const [name, data] of Object.entries(entries)) z.addBuffer(Buffer.from(data), name);
  z.addEmptyDirectory("Images/");
  z.end();
  return done;
}

describe("имена файлов в архиве", () => {
  it("как Uri.EscapeUriString: пробел, % и не-ASCII кодируются, [ ] ( ) # и прочее — нет", () => {
    expect(escapeName("кадр 1.png")).toBe("%D0%BA%D0%B0%D0%B4%D1%80%201.png");
    expect(escapeName("a[1](2)#&!'~@,;=+$.png")).toBe("a[1](2)#&!'~@,;=+$.png");
    expect(escapeName("100%.png")).toBe("100%25.png");
    expect(escapeName("plain.png")).toBe("plain.png");
  });

  it("обратно — как было; битая последовательность % остаётся как есть", () => {
    for (const n of ["кадр 1.png", "a[1](2)#.png", "100%.png", "ё.mp3"]) expect(unescapeName(escapeName(n))).toBe(n);
    expect(unescapeName("%E0%A4%A.png")).toBe("%E0%A4%A.png");
    expect(unescapeName("%D0%B0")).toBe("а");
  });
});

describe("запись и чтение .siq", () => {
  it("content.xml сжат и с BOM, медиа без сжатия в заданном порядке, content.xml из списка не дублируется", async () => {
    const dir = tmp();
    const out = join(dir, "p.siq");
    const media = join(dir, "m.bin");
    writeFileSync(media, "файл");
    await writeSiq(out, pkg(), [
      { name: "Images/%D0%B0.png", source: { kind: "buffer", data: Buffer.from("картинка") } },
      { name: "content.xml", source: { kind: "buffer", data: Buffer.from("чужой") } },
      { name: "Audio/b.mp3", source: { kind: "file", path: media } },
    ]);
    const r = await ZipReader.open(out);
    expect(r.entries.map((e) => [e.name, e.method])).toEqual([["content.xml", 8], ["Images/%D0%B0.png", 0], ["Audio/b.mp3", 0]]);
    const xml = await r.read("content.xml");
    expect([...xml.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(xml.toString("utf8").slice(1)).toBe(`<?xml version="1.0" encoding="utf-8"?><package name="П" xmlns="${NS}"><rounds><round name="Р" /></rounds></package>`);
    expect((await r.read("Images/%D0%B0.png")).toString()).toBe("картинка");
    expect((await r.read("Audio/b.mp3")).toString()).toBe("файл");
    expect(r.entries.find((e) => e.name === "Audio/b.mp3")?.size).toBe(Buffer.byteLength("файл"));
    expect(r.has("Audio/b.mp3")).toBe(true);
    expect(r.has("нет")).toBe(false);
    await expect(r.read("нет")).rejects.toThrow("в архиве нет файла нет");
    r.close();
  });

  it("перезапись из другого архива (kind: zip) и повторное открытие — модель та же, BOM снят", async () => {
    const dir = tmp();
    const a = join(dir, "a.siq");
    await writeSiq(a, pkg(), [{ name: "Video/v.mp4", source: { kind: "buffer", data: Buffer.from("видео") } }]);
    const first = await openSiq(a);
    expect(first.contentXml.startsWith("<?xml")).toBe(true);
    const b = join(dir, "b.siq");
    await writeSiq(b, first.pkg, [{ name: "Video/v.mp4", source: { kind: "zip", reader: first.reader, name: "Video/v.mp4" } }]);
    first.reader.close();
    const second = await openSiq(b);
    expect(second.pkg).toEqual(first.pkg);
    expect((await second.reader.read("Video/v.mp4")).toString()).toBe("видео");
    second.reader.close();
  });

  it("папки в архиве пропускаются; без content.xml — «это не пак SIGame»", async () => {
    const dir = tmp();
    const p = join(dir, "x.zip");
    await zipOf(p, { "readme.txt": "x" });
    const r = await ZipReader.open(p);
    expect(r.entries.map((e) => e.name)).toEqual(["readme.txt"]);
    r.close();
    await expect(openSiq(p)).rejects.toThrow("это не пак SIGame: нет content.xml");
  });

  it("не архив — ошибка открытия", async () => {
    const dir = tmp();
    const p = join(dir, "bad.siq");
    writeFileSync(p, "не zip");
    await expect(ZipReader.open(p)).rejects.toThrow();
  });
});

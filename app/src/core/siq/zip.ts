// Чтение и запись архива .siq (обычный ZIP).
// Как у SIQuester: content.xml сжат (deflate), медиа лежат без сжатия (stored),
// имена медиафайлов внутри архива экранированы как Uri.EscapeUriString в .NET.

import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import yauzl from "yauzl";
import yazl from "yazl";
import type { Package } from "./model";
import { buildContentXml, parseContentXml } from "./xml";

/**
 * Как Uri.EscapeUriString в SIQuester: кодируются пробел, % и не-ASCII (UTF-8 → %XX),
 * а ( ) , [ ] ! ' & # @ ~ и прочие «URI-символы» остаются как есть.
 * Выведено по всем 3275 именам файлов в 19 реальных паках: из ASCII кодировался только пробел.
 */
export function escapeName(name: string): string {
  return encodeURI(name).replace(/%5B/g, "[").replace(/%5D/g, "]");
}

export function unescapeName(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

export interface SiqEntry {
  /** Имя записи в архиве как есть, например "Images/%D0%90.jpg" */
  name: string;
  method: number;
  crc32: number;
  size: number;
}

export class ZipReader {
  private constructor(
    private zip: yauzl.ZipFile,
    private map: Map<string, yauzl.Entry>,
    public readonly entries: SiqEntry[],
  ) {}

  static open(path: string): Promise<ZipReader> {
    return new Promise((resolve, reject) => {
      yauzl.open(path, { lazyEntries: true, autoClose: false }, (err, zip) => {
        if (err || !zip) return reject(err ?? new Error("не удалось открыть архив"));
        const map = new Map<string, yauzl.Entry>();
        const entries: SiqEntry[] = [];
        zip.on("entry", (e: yauzl.Entry) => {
          if (!e.fileName.endsWith("/")) {
            map.set(e.fileName, e);
            entries.push({ name: e.fileName, method: e.compressionMethod, crc32: e.crc32, size: e.uncompressedSize });
          }
          zip.readEntry();
        });
        zip.on("end", () => resolve(new ZipReader(zip, map, entries)));
        zip.on("error", reject);
        zip.readEntry();
      });
    });
  }

  has(name: string): boolean {
    return this.map.has(name);
  }

  read(name: string): Promise<Buffer> {
    const e = this.map.get(name);
    if (!e) return Promise.reject(new Error(`в архиве нет файла ${name}`));
    return new Promise((resolve, reject) => {
      this.zip.openReadStream(e, (err, stream) => {
        if (err || !stream) return reject(err);
        const chunks: Buffer[] = [];
        stream.on("data", (c: Buffer) => chunks.push(c));
        stream.on("end", () => resolve(Buffer.concat(chunks)));
        stream.on("error", reject);
      });
    });
  }

  close(): void {
    this.zip.close();
  }
}

export interface OpenedSiq {
  pkg: Package;
  /** Исходный текст content.xml без BOM — для сверки */
  contentXml: string;
  reader: ZipReader;
}

export async function openSiq(path: string): Promise<OpenedSiq> {
  const reader = await ZipReader.open(path);
  if (!reader.has("content.xml")) {
    reader.close();
    throw new Error("это не пак SIGame: нет content.xml");
  }
  const contentXml = (await reader.read("content.xml")).toString("utf8").replace(/^﻿/, "");
  return { pkg: parseContentXml(contentXml), contentXml, reader };
}

/** Откуда взять содержимое файла при записи пака. */
export type EntrySource =
  | { kind: "zip"; reader: ZipReader; name: string }
  | { kind: "file"; path: string }
  | { kind: "buffer"; data: Buffer };

export interface EntryToWrite {
  /** Имя записи в архиве (уже экранированное), например "Images/%D0%90.jpg" */
  name: string;
  source: EntrySource;
}

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

async function load(src: EntrySource): Promise<Buffer> {
  if (src.kind === "buffer") return src.data;
  if (src.kind === "file") return readFile(src.path);
  return src.reader.read(src.name);
}

/**
 * Записывает пак: content.xml из модели + остальные файлы в заданном порядке.
 * addBuffer, а не поток: так yazl знает CRC заранее и пишет размеры в локальный заголовок,
 * как SIQuester. Пак целиком может оказаться в памяти — для паков до ~200 МБ это приемлемо.
 */
export async function writeSiq(outPath: string, pkg: Package, entries: EntryToWrite[]): Promise<void> {
  const zip = new yazl.ZipFile();
  const out = createWriteStream(outPath);
  const done = new Promise<void>((resolve, reject) => {
    out.on("close", resolve);
    out.on("error", reject);
    zip.outputStream.on("error", reject);
  });
  zip.outputStream.pipe(out);

  const xml = Buffer.concat([BOM, Buffer.from(buildContentXml(pkg), "utf8")]);
  zip.addBuffer(xml, "content.xml", { compress: true });
  for (const e of entries) {
    if (e.name === "content.xml") continue;
    const data = await load(e.source);
    zip.addBuffer(data, e.name, { compress: false });
  }
  zip.end();
  await done;
}

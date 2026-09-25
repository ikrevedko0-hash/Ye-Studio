import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { addRecord, findByUrl } from "../src/core/media/library";

describe("библиотека: уже скачано", () => {
  let dir = "";
  afterAll(() => rm(dir, { recursive: true, force: true }));
  const rec = (file: string, pageUrl?: string, downloadUrl?: string) =>
    ({ providerId: "t", title: file, file, fetchedAt: "", sizeBytes: 1, pageUrl, downloadUrl });

  it("картинки с одной статьи — разные файлы, по странице не путаем", async () => {
    dir = await mkdtemp(join(tmpdir(), "lib-"));
    await addRecord(dir, rec("zazerkalie.webp", "https://rbc.ru/mem", "https://s0.rbk.ru/1.webp"));
    // другой кадр из той же статьи: раньше отдавался первый файл
    expect(await findByUrl(dir, "https://rbc.ru/mem", "https://s0.rbk.ru/2.webp")).toBeUndefined();
    expect((await findByUrl(dir, "https://rbc.ru/mem", "https://s0.rbk.ru/1.webp"))?.file).toBe("zazerkalie.webp");
  });

  it("ролик без прямой ссылки узнаётся по странице", async () => {
    await addRecord(dir, rec("video.mp4", "https://youtube.com/watch?v=1"));
    expect((await findByUrl(dir, "https://youtube.com/watch?v=1"))?.file).toBe("video.mp4");
    expect(await findByUrl(dir, "https://youtube.com/watch?v=2")).toBeUndefined();
  });
});

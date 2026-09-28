// Паки-фикстуры для прогона в настоящем SIGame (npm run sigame-e2e, tests/sigameE2E.test.ts).
// Каждый пак — одна беда, на которой игра споткнулась бы у игроков. Картинки рисуются здесь же,
// без сторонних программ: однотонный PNG нужного размера.
// Запуск: npx tsx scripts/e2e-fixtures.ts  → tests/fixtures/e2e/*.siq

import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import yazl from "yazl";
import { escapeName } from "../src/core/siq/zip";

const out = join(__dirname, "..", "tests", "fixtures", "e2e");
mkdirSync(out, { recursive: true });

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** Однотонный PNG w×h с рамкой другого цвета — чтобы на снимке было видно границы. */
export function png(w: number, h: number, rgb: [number, number, number] = [60, 120, 200]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = 1 + w * 3;
  const raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < w; x++) {
      const edge = x < 2 || y < 2 || x >= w - 2 || y >= h - 2;
      const [r, g, b] = edge ? [240, 200, 40] : rgb;
      raw.set([r, g, b], y * row + 1 + x * 3);
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const NS = "https://github.com/VladimirKhil/SI/blob/master/assets/siq_5.xsd";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const text = (s: string) => `<item>${esc(s)}</item>`;
const image = (name: string) => `<item type="image" isRef="True">${esc(name)}</item>`;
const q = (price: number, body: string, answer: string, extra = "") =>
  `<question price="${price}"><params><param name="question" type="content">${body}</param>${extra}</params><right><answer>${esc(answer)}</answer></right></question>`;
const options = (...opts: string[]) =>
  `<param name="answerType">select</param><param name="answerOptions" type="group">` +
  opts.map((o, i) => `<param name="${"ABCDEFGH"[i]}" type="content">${text(o)}</param>`).join("") + `</param>`;
const theme = (name: string, questions: string, info = "") => `<theme name="${esc(name)}">${info}<questions>${questions}</questions></theme>`;

function pack(name: string, themes: string, files: Record<string, Buffer> = {}): { xml: string; files: Record<string, Buffer> } {
  const xml = `<?xml version="1.0" encoding="utf-8"?><package name="${esc(name)}" version="5" id="e2e-${name.length}" date="28.09.2026" xmlns="${NS}">` +
    `<info><authors><author>Ye!Studio</author></authors></info>` +
    `<rounds><round name="Раунд 1"><themes>${themes}</themes></round></rounds></package>`;
  return { xml, files };
}

async function write(file: string, p: { xml: string; files: Record<string, Buffer> }) {
  const zip = new yazl.ZipFile();
  const done = new Promise<void>((res, rej) => {
    const s = createWriteStream(join(out, file));
    s.on("close", res); s.on("error", rej);
    zip.outputStream.pipe(s);
  });
  zip.addBuffer(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(p.xml, "utf8")]), "content.xml", { compress: true });
  for (const [path, data] of Object.entries(p.files)) {
    const [folder, ...rest] = path.split("/");
    zip.addBuffer(data, `${folder}/${escapeName(rest.join("/"))}`, { compress: false });
  }
  zip.end();
  await done;
  console.log(file);
}

async function main() {
  // Всё в порядке: текст, нормальная картинка, варианты ответа без картинки.
  await write("good.siq", pack("Чистый пак",
    theme("Кино", q(100, text("Какой фильм снял Гайдай в 1966 году?"), "Кавказская пленница") +
      q(200, image("кадр.png"), "Иван Васильевич") +
      q(300, text("Столица Франции?"), "A", options("Париж", "Лион", "Марсель", "Ницца"))) +
    theme("Музыка", q(100, text("Автор «Времён года»?"), "Вивальди") + q(200, text("Сколько струн у балалайки?"), "Три")),
    { "Images/кадр.png": png(800, 600) }));

  // Как во вчерашнем Уе!паке: пустые <info /> у тем. SIGame видит только первую тему.
  await write("empty-info.siq", pack("Пустые пометки",
    theme("Первая", q(100, text("Вопрос 1"), "Ответ 1"), "<info />") +
    theme("Вторая", q(100, text("Вопрос 2"), "Ответ 2"), "<info />") +
    theme("Третья", q(100, text("Вопрос 3"), "Ответ 3"), "<info />")));

  // Картинка 10×10 рядом с четырьмя вариантами: на телефоне кнопки съедают экран.
  await write("tiny-image-options.siq", pack("Мелкая картинка",
    theme("Флаги", q(100, image("флаг.png"), "B", options("Бельгия", "Германия", "Румыния", "Андорра")) +
      q(200, image("большой.png"), "A", options("Первый вариант подлиннее", "Второй", "Третий", "Четвёртый"))),
    { "Images/флаг.png": png(10, 10, [200, 30, 30]), "Images/большой.png": png(1200, 900) }));

  // Имена файлов, на которых ломается раздача: «#» в имени и расхождение регистра.
  await write("bad-names.siq", pack("Неудобные имена",
    theme("Файлы", q(100, image("кадр #1.png"), "Решётка") + q(200, image("photo.png"), "Регистр") + q(300, image("нет такого.png"), "Нет файла")),
    { "Images/кадр #1.png": png(640, 480), "Images/Photo.PNG": png(640, 480, [30, 160, 90]) }));
}

void main();

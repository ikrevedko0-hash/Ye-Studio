// Демо-пак для скриншотов README: нейтральные вопросы, все медиа рисует ffmpeg (фракталы, клеточные автоматы,
// сигналы) — ни чужих фото, ни чужой музыки. Один вопрос нарочно без ответа — чтобы «Проверке пака» было что показать.
//
//   npx tsx scripts/demo-pack.ts <выход.siq> [путь к ffmpeg]

import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newPackage, newQuestion, setQuestionType } from "../src/core/siq/helpers";
import type { ContentItem, Question, Round, Theme } from "../src/core/siq/model";
import { escapeName, writeSiq, type EntryToWrite } from "../src/core/siq/zip";

const out = process.argv[2];
const ffmpeg = process.argv[3] ?? "ffmpeg";
if (!out) throw new Error("укажите выходной .siq");

const tmp = mkdtempSync(join(tmpdir(), "ye-demo-"));
const entries: EntryToWrite[] = [];

/** Сгенерировать файл ffmpeg-ом из lavfi-источника и положить в пак. */
function media(folder: "Images" | "Audio" | "Video", name: string, args: string[]): string {
  const file = join(tmp, name);
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", ...args, file]);
  entries.push({ name: `${folder}/${escapeName(name)}`, source: { kind: "file", path: file } });
  return name;
}
const still = (src: string) => ["-f", "lavfi", "-i", src, "-frames:v", "1"];

const logo = media("Images", "logo.png", still("gradients=s=512x512:c0=0x3b82f6:c1=0xa855f7:c2=0x22d3ee:n=3:type=radial:seed=7"));
const sierpinski = media("Images", "sierpinski.png", still("sierpinski=s=800x600:type=triangle"));
const life = media("Images", "life.png", [...still("life=s=160x120:mold=10:r=25:ratio=0.1:death_color=#0f1424:life_color=#22d3ee,scale=800:600:flags=neighbor")]);
const gradient = media("Images", "gradient.png", still("gradients=s=800x600:c0=0xf97316:c1=0x8b5cf6:type=linear:seed=3"));
const rule30 = media("Images", "rule30.png", still("cellauto=s=800x600:rule=30:start_full=0,negate"));
const video = media("Video", "mandelbrot.mp4", ["-f", "lavfi", "-i", "mandelbrot=s=960x540:rate=25", "-t", "8", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "28"]);
const beeps = media("Audio", "beeps.mp3", ["-f", "lavfi", "-i", "aevalsrc=sin(2*PI*880*t)*lt(mod(t\\,1)\\,0.25):d=5", "-c:a", "libmp3lame", "-b:a", "128k"]);

const ref = (type: string, value: string): ContentItem => ({ type, isRef: "True", value });

function q(price: number, text: string, answer: string, item?: ContentItem): Question {
  const x = newQuestion(price);
  x.params![0].children = [
    ...(text ? [{ kind: "item" as const, item: { value: text } }] : []),
    ...(item ? [{ kind: "item" as const, item }] : []),
  ];
  x.right = [answer];
  return x;
}
const theme = (name: string, prices: number[], rows: [string, string, ContentItem?][]): Theme =>
  ({ name, questions: rows.map(([t, a, it], i) => q(prices[i], t, a, it)) });

const P1 = [100, 200, 300, 400, 500];
const P2 = [200, 400, 600, 800, 1000];

const round1: Round = {
  name: "Разминка",
  themes: [
    theme("🎬 Кино 🍿", P1, [
      ["Фильм Джеймса Кэмерона 1997 года о гибели лайнера", "Титаник"],
      ["Волшебник, наставник Фродо во «Властелине колец»", "Гэндальф"],
      ["В каком городе происходит действие мультфильма «Рататуй»?", "Париж"],
      ["Кто сыграл Джокера в «Тёмном рыцаре» (2008)?", "Хит Леджер"],
      ["Кто снял «Сталкера» (1979)?", "Андрей Тарковский"],
    ]),
    theme("🌍 География 🗺️", P1, [
      ["Столица Австралии", "Канберра"],
      ["Самая длинная река Европы", "Волга"],
      ["У какой страны больше всего часовых поясов с учётом заморских территорий?", "Франция"],
      ["Самое глубокое озеро мира", "Байкал"],
      ["На каком материке пустыня Атакама?", "Южная Америка"],
    ]),
    theme("🔬 Наука 🧪", P1, [
      ["Химический символ золота", "Au"],
      ["Самая большая планета Солнечной системы", "Юпитер"],
      ["Сколько костей у взрослого человека?", "206"],
      ["Кто сформулировал три закона движения?", "Исаак Ньютон"],
      ["Какой газ составляет около 78% атмосферы Земли?", "Азот"],
    ]),
    theme("🎵 Музыка 🎧", P1, [
      ["Сколько сигналов прозвучало?", "Пять", ref("audio", beeps)],
      ["Сколько струн у классической гитары?", "Шесть"],
      ["Какая группа записала альбом «Abbey Road»?", "The Beatles"],
      ["Кто написал балет «Лебединое озеро»?", "Пётр Чайковский"],
      ["Музыкальный термин для «очень тихо»", "Пианиссимо"],
    ]),
    theme("🖼️ Картинки 🔍", P1, [
      ["Как называется этот фрактал?", "Треугольник Серпинского", ref("image", sierpinski)],
      ["Такие узоры рождает «игра» Джона Конвея. Как она называется?", "«Жизнь»", ref("image", life)],
      ["Приближение к какому множеству показано на видео?", "Множество Мандельброта", ref("video", video)],
      ["Как называется плавный переход одного цвета в другой?", "Градиент", ref("image", gradient)],
      ["Этот узор даёт «правило 30». Как называются такие модели?", "Клеточные автоматы", ref("image", rule30)],
    ]),
  ],
};
setQuestionType(round1.themes![2].questions![2], "secret");
setQuestionType(round1.themes![0].questions![3], "stake");

const round2: Round = {
  name: "Второй раунд",
  themes: [
    theme("🐾 Животные 🐱", P2, [
      ["Самое быстрое сухопутное животное", "Гепард"],
      ["Сколько сердец у осьминога?", "Три"],
      ["Какую птицу считают символом мудрости?", "Сова"],
      ["Как называют детёныша лошади?", "Жеребёнок"],
      ["Единственное млекопитающее, способное к активному полёту", "Летучая мышь"],
    ]),
    theme("📚 Литература 📖", P2, [
      ["Кто написал «Евгения Онегина»?", "Александр Пушкин"],
      ["Как звали собаку Герасима?", "Муму"],
      ["Автор «Мастера и Маргариты»", "Михаил Булгаков"],
      ["Сколько лет проспал Рип ван Винкль?", "Двадцать"],
      ["Настоящая фамилия Максима Горького", ""], // нарочно без ответа — для «Проверки пака»
    ]),
  ],
};

const final: Round = {
  name: "ФИНАЛ",
  type: "final",
  themes: [theme("🏁 Химия 🏆", [0], [["Какой химический элемент назван в честь России?", "Рутений"]])],
};

const pkg = newPackage("Демо-пак Ye!Studio");
pkg.attrs.push(["logo", `@${logo}`]);
pkg.info = { authors: ["Ye!Studio"] };
pkg.rounds = [round1, round2, final];

void writeSiq(out, pkg, entries).then(() => console.log(`готово: ${out} (${entries.length} файлов)`));

// Проверка движка обработки медиа на реальных файлах из паков.
// Запуск: npx tsx scripts/media-test.ts <папка-с-паками> <рабочая-папка>

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ffmpegTools, frameAt, probe, transcode, waveform } from "../src/core/media/ffmpeg";
import { openSiq } from "../src/core/siq/zip";

const packsDir = resolve(process.argv[2] ?? join(__dirname, "..", ".."));
const work = resolve(process.argv[3] ?? join(__dirname, "..", ".tmp-media"));
mkdirSync(work, { recursive: true });

// тот же поиск, что и в приложении: winget любой версии, PATH
const FFMPEG = ffmpegTools()?.ffmpeg ?? "ffmpeg";

/** Полупрозрачная накладка с эллипсом — то, что в приложении нарисует холст поверх кадра. */
function makeOverlay(w: number, h: number, out: string) {
  const cx = w * 0.55, cy = h * 0.35, rx = w * 0.18, ry = h * 0.18;
  const expr = `if(lte(((X-${cx})/${rx})^2+((Y-${cy})/${ry})^2\\,1)\\,255\\,0)`;
  execFileSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=black:s=${w}x${h}`,
    "-vf", `format=rgba,geq=r='0':g='0':b='0':a='${expr}'`, "-frames:v", "1", out]);
}

async function extract(pack: string, prefix: string, count: number): Promise<string[]> {
  const { reader } = await openSiq(join(packsDir, pack));
  const picked = reader.entries.filter((e) => e.name.startsWith(prefix)).slice(0, count);
  const files: string[] = [];
  for (const e of picked) {
    const p = join(work, `in_${files.length}${e.name.slice(e.name.lastIndexOf("."))}`);
    writeFileSync(p, await reader.read(e.name));
    files.push(p);
  }
  reader.close();
  return files;
}

async function main() {
  // 1. Самый неудобный материал: видео из «Уе!пака №6» (там попадается AV1 10 бит + opus)
  const videos = [...(await extract("Уе!пак №6.siq", "Video/", 3)), ...(await extract("Уе!пак №8.siq", "Video/", 2))];
  for (const input of videos) {
    const before = await probe(input);
    const output = input.replace(/in_/, "out_").replace(/\.[^.]+$/, ".mp4");
    const overlay = join(work, "overlay.png");
    makeOverlay(before.width ?? 1280, before.height ?? 720, overlay);

    const t0 = Date.now();
    let lastRatio = 0;
    await transcode(
      {
        input, output,
        start: Math.min(1, before.durationSec / 4),
        end: Math.min(before.durationSec, Math.min(1, before.durationSec / 4) + 6),
        crop: { x: 0.05, y: 0.05, w: 0.9, h: 0.85 },
        covers: [{ x: 0.1, y: 0.6, w: 0.3, h: 0.2, style: "blur" }, { x: 0.6, y: 0.7, w: 0.25, h: 0.15, style: "pixelate" }],
        overlayPng: overlay,
        audio: "keep",
        height: 720,
        quality: "normal",
      },
      (p) => { lastRatio = p.ratio; },
    );
    const after = await probe(output);
    const frame = output.replace(".mp4", "_frame.png");
    await frameAt(output, Math.min(2, after.durationSec / 2), frame);
    console.log(
      `${input.split(/[\\/]/).pop()}: ${before.videoCodec}/${before.width}x${before.height}/${before.audioCodec}, ${before.durationSec.toFixed(1)} с, ${(before.sizeBytes / 1048576).toFixed(1)} МБ` +
      `\n  → ${after.videoCodec}/${after.width}x${after.height}/${after.audioCodec}, ${after.durationSec.toFixed(1)} с, ${(after.sizeBytes / 1048576).toFixed(1)} МБ, за ${((Date.now() - t0) / 1000).toFixed(1)} с, прогресс дошёл до ${(lastRatio * 100).toFixed(0)}%` +
      `\n  кадр: ${frame}`,
    );
  }

  // 2. Звук: вырезать кусок и выровнять громкость
  const [audio] = await extract("Уе!пак №6.siq", "Audio/", 1);
  const aOut = join(work, "out_audio.mp3");
  const aInfo = await probe(audio);
  await transcode({ input: audio, output: aOut, start: 0, end: Math.min(10, aInfo.durationSec), audio: "only", quality: "normal", normalize: true, fadeIn: true, fadeOut: true });
  const aAfter = await probe(aOut);
  console.log(`звук: ${aInfo.audioCodec} ${aInfo.durationSec.toFixed(1)} с → ${aAfter.audioCodec} ${aAfter.durationSec.toFixed(1)} с`);

  // 3. Волна для таймлайна
  const peaks = await waveform(audio, 120);
  console.log(`волна: ${peaks.length} точек, максимум ${Math.max(...peaks).toFixed(2)}`);

  // 4. Видео без звука и «только звук из видео»
  const vOnly = join(work, "out_mute.mp4");
  await transcode({ input: videos[0], output: vOnly, start: 0, end: 3, audio: "mute", quality: "light" });
  const muteInfo = await probe(vOnly);
  console.log(`без звука: hasAudio=${muteInfo.hasAudio} (должно быть false)`);
}

if (require.main === module) main().catch((e) => { console.error("ОШИБКА:", e); process.exit(1); });

// Дополнительная проверка новых возможностей: быстрый режим, поворот, заглушка со временем показа.
export async function extras() {
  const { canStreamCopy } = await import("../src/core/media/ffmpeg");
  const [src] = await extract("Уе!пак №8.siq", "Video/", 1);
  const info = await probe(src);

  const fast = join(work, "x_fast.mp4");
  const plan = { input: src, output: fast, start: 1, end: 6, audio: "keep" as const, quality: "normal" as const };
  const t1 = Date.now();
  await transcode(plan);
  const fastInfo = await probe(fast);
  console.log(`быстрый режим: копирование возможно=${canStreamCopy(plan, info)} | ${((Date.now() - t1) / 1000).toFixed(1)} с | ${fastInfo.videoCodec}/${fastInfo.durationSec.toFixed(1)} с`);

  const t2 = Date.now();
  const enc = join(work, "x_encode.mp4");
  await transcode({ ...plan, output: enc, mode: "encode" });
  console.log(`точный режим (перекод): ${((Date.now() - t2) / 1000).toFixed(1)} с`);

  const rot = join(work, "x_rotate.mp4");
  await transcode({ input: src, output: rot, start: 1, end: 4, audio: "mute", quality: "light", rotate: 90, flip: true,
    covers: [{ x: 0.3, y: 0.3, w: 0.4, h: 0.3, style: "pixelate", from: 1.5, to: 3 }] });
  const rotInfo = await probe(rot);
  console.log(`поворот: ${info.width}x${info.height} → ${rotInfo.width}x${rotInfo.height}`);
  await frameAt(rot, 0.5, join(work, "x_rot_before.png"));
  await frameAt(rot, 2.2, join(work, "x_rot_after.png"));

  const small = join(work, "x_2mb.mp4");
  await transcode({ input: src, output: small, start: 0, end: Math.min(20, info.durationSec), audio: "keep", quality: "normal", targetMb: 2 });
  const smallInfo = await probe(small);
  console.log(`цель 2 МБ: получилось ${(smallInfo.sizeBytes / 1048576).toFixed(2)} МБ за ${smallInfo.durationSec.toFixed(1)} с`);
}

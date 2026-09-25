// Живая проверка установки компонентов без окна: npx tsx scripts/components-test.ts [папка-модели]
//  1) скачать самый маленький файл манифеста (sd.cpp Vulkan, 32 МБ) с обрывом посередине и докачкой, сверить SHA256;
//  2) убедиться, что Hugging Face отдаёт куски по Range (без этого докачка 7-гигабайтной модели не работает);
//  3) поставить ffmpeg-компонент (115 МБ) и запустить его;
//  4) узнать профиль уже скачанной папки (по умолчанию — local-image рядом с проектом).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { detectProfile, parseManifest } from "../src/core/components/manifest";
import { once } from "../src/core/media/providers/http";
import { downloadResumable, installTool } from "../src/main/modelInstall";

const manifest = parseManifest(readFileSync(join(__dirname, "..", "resources", "components.json"), "utf8"));

async function main() {
  const f = manifest.files["sd-vulkan"];
  const dir = mkdtempSync(join(tmpdir(), "components-test-"));
  const dest = join(dir, "sd-vulkan.zip");
  const t0 = Date.now();
  // обрыв: отменяем, когда скачана треть
  const ac = new AbortController();
  await downloadResumable(f, dest, { signal: ac.signal, onBytes: (n) => { if (n > f.size / 3) ac.abort(); } }).catch((e) => console.log("обрыв как задумано:", (e as Error).message));
  const part = existsSync(`${dest}.part`) ? statSync(`${dest}.part`).size : 0;
  console.log(`после обрыва в .part ${part} байт из ${f.size}`);
  await downloadResumable(f, dest);
  console.log(`sd-vulkan: ${statSync(dest).size} байт, SHA256 сошлась, ${((Date.now() - t0) / 1000).toFixed(1)} с`);
  rmSync(dir, { recursive: true, force: true });

  const hf = manifest.files["klein-4b"];
  const res = await once(hf.url, { range: "bytes=1000-1999" });
  let got = 0;
  for await (const c of res) got += (c as Buffer).length;
  console.log(`Hugging Face Range: код ${res.statusCode}, пришло ${got} байт (ждём 206 и 1000)`);

  // ffmpeg-компонент: 115 МБ архива, из него только ffmpeg.exe и ffprobe.exe
  const comp = mkdtempSync(join(tmpdir(), "components-ffmpeg-"));
  const t1 = Date.now();
  await installTool({ manifest, tool: "ffmpeg", componentsDir: comp, onProgress: () => undefined });
  const ver = execFileSync(join(comp, "ffmpeg", "ffmpeg.exe"), ["-version"]).toString().split(/\r?\n/)[0];
  console.log(`ffmpeg: ${((Date.now() - t1) / 1000).toFixed(1)} с, в папке ${readdirSync(join(comp, "ffmpeg")).join(", ")}; ${ver}`);
  rmSync(comp, { recursive: true, force: true });

  const local = resolve(process.argv[2] ?? join(__dirname, "..", "..", "local-image"));
  const stat = (p: string) => { try { return { size: statSync(p).size }; } catch { return null; } };
  console.log(`папка ${local}: профиль ${detectProfile(manifest, local, stat, join) ?? "не узнан"}`);
}

main().catch((e) => { console.error("ПРОВАЛ:", e); process.exit(1); });

// Живая проверка yt-dlp как компонента — «машина друга»: без Python-yt-dlp и без Node.
// npx tsx scripts/ytdlp-component-test.ts
//  1) поставить yt-dlp.exe + плагин во временную папку компонентов (как кнопка в окне);
//  2) убрать Node из PATH: JS-рантаймом служит Electron (ELECTRON_RUN_AS_NODE);
//  3) найти видео на YouTube (через VPN, если он есть) и на Rutube, скачать короткий ролик Rutube в 360p.
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseManifest } from "../src/core/components/manifest";
import { installTool } from "../src/main/modelInstall";
import { youtube } from "../src/core/media/providers/youtube";
import { rutube } from "../src/core/media/providers/rutube";
import type { MediaResult, ProviderConfig } from "../src/core/media/providers/types";

async function main() {
  const manifest = parseManifest(readFileSync(join(__dirname, "..", "resources", "components.json"), "utf8"));
  const comp = mkdtempSync(join(tmpdir(), "cmp-yt-"));
  const t0 = Date.now();
  await installTool({ manifest, tool: "yt-dlp", componentsDir: comp, onProgress: () => undefined });
  console.log(`yt-dlp поставлен за ${((Date.now() - t0) / 1000).toFixed(1)} с`);
  const cfg: ProviderConfig = {
    ytdlpExe: join(comp, "yt-dlp", "yt-dlp.exe"),
    ytdlpPluginDir: join(comp, "yt-dlp", "plugins"),
    electronNode: join(__dirname, "..", "node_modules", "electron", "dist", "electron.exe"),
  };
  process.env.PATH = (process.env.PATH ?? "").split(";").filter((d) => !/nodejs/i.test(d)).join(";");
  console.log("available:", await youtube.available(cfg));

  const yt = await youtube.search({ text: "гараж 54 ход поршня", type: "video" } as never, { cfg });
  console.log(`YouTube: ${yt.length} находок, первая «${yt[0]?.title}»`);
  const rt = await rutube.search({ text: "крастер", type: "video" } as never, { cfg });
  const short = (rt.find((r) => (r.durationSec ?? 999) < 90) ?? rt[0]) as MediaResult;
  console.log(`Rutube: ${rt.length} находок, качаю «${short?.title}» (${short?.durationSec} с)`);
  const dir = mkdtempSync(join(tmpdir(), "cmp-dl-"));
  const file = await rutube.download(short, dir, { cfg, want: { maxHeight: 360 } as never });
  console.log(`скачано: ${statSync(file).size} байт → ${file}`);
  rmSync(dir, { recursive: true, force: true });
  rmSync(comp, { recursive: true, force: true });
}

main().catch((e) => { console.error("ПРОВАЛ:", e); process.exit(1); });

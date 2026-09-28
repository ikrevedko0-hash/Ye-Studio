// Поставить компонент «Прогон в SIGame» так же, как кнопка «Скачать и установить» в приложении:
// манифест оболочки + component.ts, скачивание из релиза с проверкой SHA-256, распаковка в папку компонентов.
// npx tsx scripts/sigame-install-test.ts [папка-компонентов]  (по умолчанию — та же, что у приложения)

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { defaultComponentsDir } from "../src/main/components";
import { installTool, loadManifest } from "../src/main/modelInstall";
import { sigameLayout } from "../src/core/sigame/paths";

async function main() {
  const componentsDir = resolve(process.argv[2] ?? defaultComponentsDir());
  const manifest = await loadManifest(join(__dirname, "..", "resources"));
  if (!manifest.tools?.sigame) throw new Error("в манифесте нет компонента sigame — src/core/sigame/component.ts пуст");
  const t0 = Date.now();
  let last = "";
  await installTool({
    manifest, tool: "sigame", componentsDir,
    onProgress: (p) => { const s = `${p.phase} ${p.file ?? ""}`; if (s !== last) console.log(`  ${s}`); last = s; },
  });
  const l = sigameLayout(join(componentsDir, "sigame"), process.platform);
  for (const f of [l.runner, l.table]) if (!existsSync(f)) throw new Error(`после установки нет ${f}`);
  console.log(`Компонент sigame ${manifest.tools.sigame.version} поставлен в ${componentsDir} за ${((Date.now() - t0) / 1000).toFixed(1)} с`);
}

main().catch((e) => { console.error(e); process.exit(1); });

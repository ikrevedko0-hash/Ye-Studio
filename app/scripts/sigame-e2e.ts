// «Прогон в SIGame» из командной строки — тот же, что по кнопке в Ye!Studio, только стол SIOnline
// открывается в Chromium (playwright-core), а не в скрытом окне Electron.
// Нужны собранные стенд и стол: npm run sigame-src && npm run sigame-build.
//
// npm run sigame-e2e -- пак.siq [ещё.siq …] [--out папка] [--profiles phone,pc] [--json]
// Код выхода: 0 — ошибок нет, 1 — есть ошибки, 2 — сбой самого прогона.

import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright-core";
import { PROFILES, type Profile, type SigameReport } from "../src/core/sigame/report";
import { runSigame, type TableBrowser, type TablePage } from "../src/core/sigame/run";
import { openSiq } from "../src/core/siq/zip";
import { devSigameDir, sigameLayout } from "../src/core/sigame/paths";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const outRoot = resolve(opt("--out") ?? join(__dirname, "..", "reports", "sigame"));
const only = opt("--profiles")?.split(",");
const json = args.includes("--json") ? (args.splice(args.indexOf("--json"), 1), true) : false;
const packs = args.map((a) => resolve(a));

const paths = sigameLayout(process.env.SIGAME_DIR ?? devSigameDir(join(__dirname, "..")), process.platform);
const chromiumPath = process.env.SIGAME_E2E_CHROMIUM ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

function playwrightTable(browser: Browser): TableBrowser {
  return {
    async open(profile: Profile): Promise<TablePage> {
      const ctx = await browser.newContext({
        viewport: { width: profile.width, height: profile.height },
        deviceScaleFactor: profile.scale, isMobile: profile.mobile, hasTouch: profile.mobile,
      });
      const page = await ctx.newPage();
      await page.goto(pathToFileURL(paths.table).href);
      await page.waitForFunction(() => (window as unknown as { __ye?: { ready: boolean } }).__ye?.ready === true, undefined, { timeout: 30000 });
      type Ye = { feed(m: unknown): void; settle(a: number, b: number): Promise<{ waitedMs: number; stillLoading: number }>; measure(): unknown };
      return {
        feed: async (m) => { await page.evaluate((ms) => (window as unknown as { __ye: Ye }).__ye.feed(ms), m); },
        settle: (a, b) => page.evaluate(([x, y]) => (window as unknown as { __ye: Ye }).__ye.settle(x, y), [a, b] as const),
        measure: () => page.evaluate(() => (window as unknown as { __ye: Ye }).__ye.measure()) as never,
        screenshot: async (path) => { await page.screenshot({ path, type: "jpeg", quality: 70 }); },
        close: () => ctx.close(),
      };
    },
  };
}

function label(names: Map<string, string>, at: { round: number; theme?: number; question?: number }): string {
  return names.get(`${at.round}/${at.theme ?? ""}/${at.question ?? ""}`) ?? names.get(`${at.round}/${at.theme ?? ""}/`) ?? names.get(`${at.round}//`) ?? `раунд ${at.round + 1}`;
}

async function namesOf(pack: string): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  try {
    const { pkg, reader } = await openSiq(pack);
    reader.close();
    (pkg.rounds ?? []).forEach((r, ri) => {
      m.set(`${ri}//`, r.name);
      (r.themes ?? []).forEach((t, ti) => {
        m.set(`${ri}/${ti}/`, `${r.name} › ${t.name}`);
        (t.questions ?? []).forEach((q, qi) => m.set(`${ri}/${ti}/${qi}`, `${r.name} › ${t.name} · ${q.price}`));
      });
    });
  } catch { /* пак не открылся и у нас — подписи будут номерами */ }
  return m;
}

function print(pack: string, report: SigameReport, names: Map<string, string>, outDir: string) {
  const mark = { error: "ОШИБКА ", warn: "ВНИМАНИЕ", info: "совет   " };
  console.log(`\n=== ${basename(pack)}`);
  if (report.file) console.log(`В файле: раундов ${report.file.rounds}, тем ${report.file.themes}, вопросов ${report.file.questions}` +
    (report.sigame ? ` · SIGame видит: ${report.sigame.rounds}/${report.sigame.themes}/${report.sigame.questions}` : ""));
  console.log(`Сыграно вопросов: ${report.played} из ${report.expected} за ${report.seconds} с · снимки: ${outDir}`);
  for (const i of report.issues) {
    const where = i.at ? `${label(names, i.at)}: ` : "";
    const src = i.source === "rules" ? " [по правилам]" : "";
    console.log(`  ${mark[i.level]} ${where}${i.text}${src}`);
  }
  if (!report.issues.length) console.log("  Всё чисто.");
}

async function main() {
  if (!packs.length) {
    console.error("npm run sigame-e2e -- пак.siq [--out папка] [--profiles phone,pc] [--json]");
    process.exit(2);
  }
  for (const [what, p] of [["стенд SIGame", paths.runner], ["стол SIOnline", paths.table]] as const) {
    if (!existsSync(p)) {
      console.error(`Нет ${what}: ${p}\nСоберите: npm run sigame-src && npm run sigame-build`);
      process.exit(2);
    }
  }
  const browser = await chromium.launch({
    executablePath: chromiumPath,
    // CORS: сервер медиа SIGame заголовков CORS не шлёт, а стол открыт с file:// — как в WebView2 SImulator
    args: ["--disable-web-security", "--autoplay-policy=no-user-gesture-required"],
  });
  const profiles = only ? PROFILES.filter((p) => only.includes(p.id)) : PROFILES;
  let errors = 0;
  try {
    for (const pack of packs) {
      const outDir = join(outRoot, basename(pack, ".siq"));
      let last = "";
      const report = await runSigame({
        pack, runner: paths.runner, browser: playwrightTable(browser), outDir, profiles,
        onProgress: (p) => { if (!json && p.text !== last && (p.stage !== "table" || p.done % 20 === 0)) console.error(`  ${p.text}`); last = p.text; },
      });
      await writeFile(join(outDir, "report.json"), JSON.stringify(report, null, 2));
      if (json) console.log(JSON.stringify(report));
      else print(pack, report, await namesOf(pack), outDir);
      errors += report.issues.filter((i) => i.level === "error").length;
    }
  } finally {
    await browser.close();
  }
  process.exit(errors ? 1 : 0);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(2); });

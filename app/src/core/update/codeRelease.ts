// Какие релизы GitHub годятся в обновление кода. Без Electron — чтобы проверять тестами.
// Релиз с обновлением кода несёт два файла: code.json (версия, оболочка, sha512, подпись) и code-<версия>.asar.gz.
// Установщик (exe + beta.yml/latest.yml) тоже есть в каждом релизе — для новой оболочки (scripts/release.ts).

import { cmpVersion } from "../../../bootstrap/pick.js";

export interface GhAsset { name: string; browser_download_url: string; size: number }
export interface GhRelease { tag_name: string; draft: boolean; prerelease: boolean; assets: GhAsset[] }

export interface CodeCandidate { version: string; metaUrl: string; gzUrl: string; gzSize: number }

export const codeGzName = (version: string) => `code-${version}.asar.gz`;

/** Релизы новее текущего кода, где есть code.json и архив кода, — от новых к старым. */
export function codeCandidates(rels: GhRelease[], current: string, allowPrerelease: boolean, skip: string[] = []): CodeCandidate[] {
  const out: CodeCandidate[] = [];
  for (const r of rels) {
    if (r.draft || (r.prerelease && !allowPrerelease)) continue;
    const version = r.tag_name.replace(/^v/, "");
    if (cmpVersion(version, current) <= 0 || skip.includes(version)) continue;
    const meta = r.assets.find((a) => a.name === "code.json");
    const gz = r.assets.find((a) => a.name === codeGzName(version));
    if (meta && gz) out.push({ version, metaUrl: meta.browser_download_url, gzUrl: gz.browser_download_url, gzSize: gz.size });
  }
  return out.sort((a, b) => cmpVersion(b.version, a.version));
}

/** Что делать с найденным описанием кода: встаёт кодом, нужен установщик (новая оболочка) или не подходит. */
export function decide(metaShell: number, shell: number): "code" | "installer" | "skip" {
  if (metaShell === shell) return "code";
  return metaShell > shell ? "installer" : "skip";
}

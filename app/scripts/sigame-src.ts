// Скачать исходники SIGame (SI) и SIOnline на закреплённых коммитах (tools/sigame-runner/versions.json)
// в app/.sigame-src/. Нужны для сборки стенда «Прогон в SIGame» (npm run sigame-build).
// Запуск: npm run sigame-src

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const versions = JSON.parse(readFileSync(join(root, "tools", "sigame-runner", "versions.json"), "utf8")) as Record<string, { repo: string; commit: string }>;
const dest = join(root, ".sigame-src");
mkdirSync(dest, { recursive: true });

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "inherit" });
const head = (cwd: string) => execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();

for (const [name, v] of Object.entries(versions)) {
  if (name === "_") continue;
  const dir = join(dest, name);
  if (existsSync(join(dir, ".git")) && head(dir) === v.commit) {
    console.log(`${name}: уже ${v.commit.slice(0, 7)}`);
    continue;
  }
  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(dir, { recursive: true });
    git(dir, "init", "-q");
    git(dir, "remote", "add", "origin", v.repo);
  }
  git(dir, "fetch", "-q", "--depth", "1", "origin", v.commit);
  git(dir, "checkout", "-q", "--force", v.commit);
  console.log(`${name}: ${v.commit.slice(0, 7)}`);
}

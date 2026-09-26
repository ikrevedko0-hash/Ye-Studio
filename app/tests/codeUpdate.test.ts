import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cmpVersion, order, sha512, signMeta, verifyMeta } from "../bootstrap/pick.js";
import { codeCandidates, decide, type GhRelease } from "../src/core/update/codeRelease";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUB = publicKey.export({ type: "spki", format: "pem" }) as string;
const PRIV = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

describe("версии", () => {
  it("semver с пре-релизами", () => {
    expect(cmpVersion("0.2.10", "0.2.9")).toBe(1);
    expect(cmpVersion("0.3.0-beta.1", "0.3.0")).toBe(-1);
    expect(cmpVersion("0.2.0-beta.10", "0.2.0-beta.4")).toBe(1);
    expect(cmpVersion("v1.0.0", "1.0.0")).toBe(0);
    expect(cmpVersion("0.2.0-beta.4", "0.2.0-alpha.9")).toBe(1);
  });
});

describe("подпись кода", () => {
  const data = Buffer.from("код программы");
  const meta = { version: "0.3.0", shell: 1, size: data.length, sha512: sha512(data) } as Parameters<typeof signMeta>[0];
  meta.sig = signMeta(meta, PRIV);

  it("своя подпись проходит, подмена любого поля — нет", () => {
    expect(verifyMeta(meta, PUB)).toBe(true);
    for (const patch of [{ version: "9.9.9" }, { shell: 2 }, { size: 1 }, { sha512: sha512(Buffer.from("чужой")) }]) {
      expect(verifyMeta({ ...meta, ...patch }, PUB)).toBe(false);
    }
    const other = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    expect(verifyMeta({ ...meta, sig: signMeta(meta, other) }, PUB)).toBe(false);
    expect(verifyMeta({ ...meta, sig: undefined }, PUB)).toBe(false);
    expect(verifyMeta(null, PUB)).toBe(false);
  });
});

describe("что запускает загрузчик", () => {
  const c = (version: string, source: "builtin" | "downloaded", shell = 1, signed = true) => ({ version, shell, source, signed });

  it("самая новая подписанная для этой оболочки, встроенная — запасная", () => {
    const list = order([c("0.3.0", "builtin"), c("0.3.2", "downloaded"), c("0.3.1", "downloaded")], 1, []);
    expect(list.map((x) => x.version)).toEqual(["0.3.2", "0.3.1", "0.3.0"]);
  });

  it("чужая оболочка, без подписи, отложенная — мимо; встроенная новее скачанной — первая", () => {
    const list = order([
      c("0.4.0", "builtin"),
      c("0.5.0", "downloaded", 2),        // для новой оболочки
      c("0.4.5", "downloaded", 1, false), // без подписи
      c("0.4.2", "downloaded"),           // дважды упала
      c("0.3.9", "downloaded"),           // старее встроенной
    ], 1, ["0.4.2"]);
    expect(list.map((x) => `${x.version}:${x.source}`)).toEqual(["0.4.0:builtin", "0.3.9:downloaded"]);
  });

  it("при равной версии — встроенная", () => {
    expect(order([c("0.3.0", "downloaded"), c("0.3.0", "builtin")], 1, [])[0].source).toBe("builtin");
  });
});

describe("релизы GitHub", () => {
  const rel = (tag: string, names: string[], pre = true, draft = false): GhRelease => ({
    tag_name: tag, prerelease: pre, draft,
    assets: names.map((name) => ({ name, browser_download_url: `https://x/${tag}/${name}`, size: 1500000 })),
  });

  it("новее текущей, с code.json и архивом; черновики, отложенные и старые релизы — мимо", () => {
    const rels = [
      rel("v0.2.0-beta.3", ["beta.yml"]),
      rel("v0.2.0-beta.5", ["code.json", "code-0.2.0-beta.5.asar.gz"]),
      rel("v0.2.0-beta.7", ["code.json", "code-0.2.0-beta.7.asar.gz"], true, true),
      rel("v0.2.0-beta.6", ["code.json", "code-0.2.0-beta.6.asar.gz"]),
      rel("v0.2.0-beta.8", ["code.json"]),                         // нет архива
      rel("v0.2.0-beta.9", ["code.json", "code-0.2.0-beta.9.asar.gz"]),
    ];
    expect(codeCandidates(rels, "0.2.0-beta.4", true, ["0.2.0-beta.9"]).map((c) => c.version)).toEqual(["0.2.0-beta.6", "0.2.0-beta.5"]);
    expect(codeCandidates(rels, "0.2.0-beta.4", false)).toEqual([]);   // релизная версия пре-релизы не берёт
  });

  it("оболочка: та же — код, новее — установщик, старее — пропуск", () => {
    expect(decide(1, 1)).toBe("code");
    expect(decide(2, 1)).toBe("installer");
    expect(decide(1, 2)).toBe("skip");
  });
});

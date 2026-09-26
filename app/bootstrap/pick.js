"use strict";
// Выбор кода при запуске и проверка подписи обновлений. Общий модуль загрузчика (bootstrap/index.js)
// и программы (src/main/updater.ts, scripts/release.ts). Только встроенные модули Node: загрузчик
// лежит в app.asar без node_modules.

const crypto = require("crypto");

/** Сравнение версий по semver: 1.2.10 > 1.2.9, пре-релиз младше релиза (0.3.0-beta.1 < 0.3.0). */
function cmpVersion(a, b) {
  const parse = (v) => {
    const [core, pre] = String(v || "0").replace(/^v/, "").split("+")[0].split(/-(.*)/s);
    return { nums: core.split(".").map((x) => parseInt(x, 10) || 0), pre: pre ? pre.split(".") : [] };
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] || 0) - (y.nums[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn && +p !== +q) return +p > +q ? 1 : -1;
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p > q ? 1 : -1;
  }
  return 0;
}

/** Что подписывается в описании кода (code.json): поля в фиксированном порядке. */
function signedPayload(meta) {
  return Buffer.from(JSON.stringify(["ye-studio-code", meta.version, meta.shell, meta.size, meta.sha512]), "utf8");
}

function signMeta(meta, privateKeyPem) {
  return crypto.sign(null, signedPayload(meta), privateKeyPem).toString("base64");
}

/** Подпись ed25519 описания кода открытым ключом из bootstrap/public-key.js. */
function verifyMeta(meta, publicKeyPem) {
  try {
    if (!meta || typeof meta.sig !== "string" || typeof meta.version !== "string" || typeof meta.sha512 !== "string") return false;
    if (!Number.isInteger(meta.shell) || !Number.isInteger(meta.size)) return false;
    return crypto.verify(null, signedPayload(meta), publicKeyPem, Buffer.from(meta.sig, "base64"));
  } catch {
    return false;
  }
}

function sha512(buf) {
  return crypto.createHash("sha512").update(buf).digest("base64");
}

/**
 * Порядок, в котором пробовать код: скачанные версии (подписанные, для этой оболочки, не упавшие дважды)
 * и встроенная. Новее — раньше; при равной версии встроенная первой.
 * candidates: [{ version, shell, source: "builtin" | "downloaded", signed }]
 */
function order(candidates, shell, bad) {
  return candidates
    .filter((c) => c.source === "builtin" || (c.signed && c.shell === shell && !bad.includes(c.version)))
    .sort((a, b) => cmpVersion(b.version, a.version) || (a.source === "builtin" ? -1 : b.source === "builtin" ? 1 : 0));
}

/** Сколько раз подряд версия может не дожить до «окно открылось», прежде чем её отложат. */
const MAX_ATTEMPTS = 2;

module.exports = { cmpVersion, signMeta, verifyMeta, sha512, order, MAX_ATTEMPTS };

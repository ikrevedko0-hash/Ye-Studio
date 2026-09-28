// Как script.js у SImulator: запустить стол SIOnline в #reactHost.
try {
  sigame.run("reactHost", "Игрок 2");
  window.__ye.ready = true;
} catch (e) {
  window.__ye.errors.push({ kind: "start", message: String(e && e.message || e) });
}

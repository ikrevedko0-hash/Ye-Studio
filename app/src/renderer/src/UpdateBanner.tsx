// ---------- обновления ----------
// Ненавязчивая плашка (не модалка): доступно обновление → скачать → готово → перезапустить.
// Обновление кода (kind: "code") — пара мегабайт и перезапуск; установщик — только при новой оболочке.
// «Позже» просто прячет плашку до следующего запуска (state сбрасывается перезапуском окна).

import { useEffect, useState } from "react";
import type { UpdateStatus } from "../../shared/api";

export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    void window.api.updateStatus().then(setStatus);
    return window.api.onUpdateState((s) => {
      setStatus(s);
      // новая версия нашлась заново (например, после ручной проверки) — снова показываем плашку
      if (s.state === "available" || s.state === "ready") setDismissed(false);
    });
  }, []);

  if (dismissed || status.state === "idle" || status.state === "checking" || status.state === "error") return null;

  return (
    <div className="update-banner">
      {status.state === "available" && (
        <>
          <span>
            Доступна версия {status.version}
            {status.kind === "code" && status.sizeMb !== undefined ? ` (${String(status.sizeMb).replace(".", ",")} МБ)` : ""}
            {status.kind === "installer" ? " — новая сборка, через установщик" : ""}
            {status.notes ? ` — ${status.notes.split("\n")[0]}` : ""}
          </span>
          <span className="spacer" />
          <button className="primary small" onClick={() => void window.api.updateDownload()}>Скачать</button>
          <button className="small" onClick={() => setDismissed(true)}>Позже</button>
        </>
      )}
      {status.state === "downloading" && (
        <>
          <span>Скачивание обновления{status.version ? ` ${status.version}` : ""}… {status.percent ?? 0}%</span>
          <span className="spacer" />
          <div className="update-progress"><div style={{ width: `${status.percent ?? 0}%` }} /></div>
        </>
      )}
      {status.state === "ready" && (
        <>
          <span>{status.kind === "code" ? `Версия ${status.version} скачана — применится после перезапуска` : `Обновление ${status.version} готово к установке`}</span>
          <span className="spacer" />
          <button className="primary small" onClick={() => void window.api.updateInstall()}>
            {status.kind === "code" ? "Перезапустить" : "Перезапустить и обновить"}
          </button>
          <button className="small" onClick={() => setDismissed(true)}>Позже</button>
        </>
      )}
    </div>
  );
}

// «⚙ Компоненты»: что умеет эта машина и локальная модель картинок одной кнопкой.
//
// Сверху — проверка системы (видеокарта, память, диск, программы), ниже — профили модели с причинами
// «почему не подходит» и рекомендацией. Установка идёт в главном процессе: окно можно закрыть,
// загрузка продолжится, а при следующем открытии полоса покажет, где она.

import { useEffect, useState } from "react";
import type { ComponentsState, InstallProgress } from "../../core/components/manifest";
import type { FirstRunOptions, UpdateStatus } from "../../shared/api";
import type { ProfileId, SystemReport } from "../../core/system/probe";
import { PIPER_VOICES } from "../../core/components/voices";
import { Icon } from "./Icon";

const plainError = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "");
const gb = (bytes: number) => `${(bytes / 1073741824).toFixed(1).replace(".", ",")} ГБ`;
/** Меньше гигабайта — в мегабайтах: «18 МБ», а не «0,0 ГБ». */
const size = (bytes: number) => (bytes < 1073741824 ? `${Math.max(1, Math.round(bytes / 1048576))} МБ` : gb(bytes));
const gbFromMB = (mb: number) => `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1).replace(".", ",")} ГБ`;

function eta(p: InstallProgress): string {
  if (!p.speed || p.speed < 1) return "";
  const s = Math.max(0, (p.total - p.done) / p.speed);
  if (s < 90) return `≈ ${Math.ceil(s)} с`;
  if (s < 5400) return `≈ ${Math.ceil(s / 60)} мин`;
  return `≈ ${(s / 3600).toFixed(1).replace(".", ",")} ч`;
}

/** Программы-компоненты: что дают и что будет без них. */
const TOOLS = [
  { id: "ffmpeg", title: "ffmpeg", what: "обрезка, перекодирование, коллажи, волна звука", without: "медиа-редакторы (обрезка, перекодирование) не работают" },
  { id: "yt-dlp", title: "yt-dlp", what: "видео с YouTube, Rutube, Instagram и по ссылкам", without: "видео из интернета не ищется; картинки и звук — работают" },
  { id: "upscaler", title: "ИИ-увеличение", what: "кнопка «Увеличить ×4 (ИИ)» в редакторе картинок (Real-ESRGAN)", without: "мелкие картинки не увеличить нейросетью" },
  { id: "sigame", title: "Прогон в SIGame", what: "«Автопроверка пака» → «Прогнать в SIGame»: настоящий движок SIGame и экран игрока SIOnline", without: "пак проверяется только своими правилами, а не самой игрой" },
];

const PHASE: Record<InstallProgress["phase"], string> = {
  download: "качаю",
  verify: "проверяю сумму",
  unzip: "распаковываю",
  register: "подключаю",
  done: "готово",
  error: "ошибка",
  cancelled: "остановлено",
};

export function Components({ onClose, firstRun }: { onClose(): void; firstRun?: FirstRunOptions }) {
  const [report, setReport] = useState<SystemReport | null>(null);
  const [state, setState] = useState<ComponentsState | null>(null);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [choice, setChoice] = useState<ProfileId | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const [r, s] = await Promise.all([window.api.probeSystem(), window.api.componentsState()]);
    setReport(r);
    setState(s);
    if (s.installing) setProgress(s.installing);
    setChoice((c) => c ?? (r.profile.recommended === "cloud" ? null : r.profile.recommended));
  };

  useEffect(() => {
    const off = window.api.onComponentsProgress(setProgress);
    void (async () => {
      await refresh();
      if (!firstRun) return;
      // первый запуск: ставим без вопросов то, без чего приложение неполноценно; модель — только предлагаем
      const [r, s] = await Promise.all([window.api.probeSystem(), window.api.componentsState()]);
      const queue = [
        !r.tools.ffmpeg && s.tools.ffmpeg && !s.tools.ffmpeg.component ? "ffmpeg" : null,
        firstRun.ytdlp && !r.tools.ytdlp && s.tools["yt-dlp"] && !s.tools["yt-dlp"].component ? "yt-dlp" : null,
      ].filter((x): x is string => !!x);
      for (const tool of queue) {
        setMsg({ ok: true, text: `Первый запуск: ставлю ${tool}…` });
        await window.api.installTool(tool);
      }
      await refresh();
      setMsg({ ok: true, text: firstRun.model ? "Программы на месте. Выберите профиль модели картинок и нажмите «Установить»." : "Программы на месте. Модель картинок можно поставить здесь в любой момент (кнопка 🧩 в шапке)." });
    })().catch((e) => setMsg({ ok: false, text: plainError(e) }));
    return off;
  }, []);

  const installing = !!progress && !["done", "error", "cancelled"].includes(progress.phase);

  const act = async (fn: () => Promise<ComponentsState | null | void>, ok?: string) => {
    setMsg(null);
    setBusy(true);
    try {
      const s = await fn();
      if (s) setState(s);
      if (ok) setMsg({ ok: true, text: ok });
    } catch (e) {
      const text = plainError(e);
      if (text !== "отменено") setMsg({ ok: false, text });
    } finally {
      setBusy(false);
    }
  };

  const install = (id: ProfileId) =>
    act(async () => {
      setProgress(null);
      return window.api.installModel(id);
    }, "Модель скачана и подключена: она первая в очереди «Картинок». Первая картинка после запуска рисуется ~30 с, дальше ~15 с.");

  const checks = report?.profile.checks.filter((c) => c.profile.id !== "cloud") ?? [];
  const bytesOf = (id: ProfileId) => state?.profiles.find((p) => p.id === id)?.bytes ?? 0;
  const t = report?.tools;
  // сборка llama.cpp с CUDA есть только для NVIDIA; для AMD/Intel и неизвестной карты — Vulkan
  const nvidia = !!report?.gpus.some((g) => /nvidia|geforce|rtx|gtx/i.test(g.name));

  /** Одна строка «Перевод и голос»: программа из манифеста, поставить/удалить. */
  const voiceRow = (id: string, title: string, what: string, dim = false) => {
    const st = state?.tools[id];
    if (!st) return null;
    return (
      <div key={`${id}:${title}`} className="cmp-installed">
        <span className={st.component ? "ok" : dim ? "muted" : "bad"}>{st.component ? `✓ ${title}` : `✗ ${title}`}</span>
        <span className="muted">{what}</span>
        <span className="spacer" />
        {st.component ? (
          <button className="small" disabled={busy || installing} onClick={() => void act(() => window.api.removeTool(id), `${title} удалён.`).then(refresh)}>Удалить</button>
        ) : (
          <button className={dim ? "small" : "primary"} disabled={busy || installing}
            onClick={() => void act(() => { setProgress(null); return window.api.installTool(id); }, `${title} установлен.`).then(refresh)}>
            Установить ({size(st.bytes)})
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="components-panel">
        <header>
          <b><Icon name="puzzle" />Компоненты</b>
          <span className="spacer" />
          <button className="small" disabled={busy} onClick={() => void refresh()}>Проверить заново</button>
          <button className="icon" onClick={onClose} title={installing ? "Закрыть — загрузка продолжится" : "Закрыть"}>×</button>
        </header>

        <section>
          <h4>Эта машина</h4>
          {!report && <div className="muted">Проверяю видеокарту, память и программы…</div>}
          {report && (
            <div className="cmp-grid">
              <span>Видеокарта</span>
              <span>
                {report.gpus.length
                  ? report.gpus.map((g) => `${g.name}${g.vramMB ? `, ${gbFromMB(g.vramMB)}` : ""}${g.driver ? `, драйвер ${g.driver}` : ""}`).join(" · ")
                  : "не найдена"}
              </span>
              <span>Память</span>
              <span>{gbFromMB(report.ramMB)} оперативной · свободно на диске {report.freeDiskMB !== undefined ? gbFromMB(report.freeDiskMB) : "?"}</span>
              <span>Программы</span>
              <span className="cmp-tools">
                <Tool ok={!!t?.ffmpeg} name="ffmpeg" hint="нужен для обрезки и перекодирования медиа" />
                <Tool ok={!!t?.ytdlp} name="yt-dlp" hint="видео с YouTube, Rutube, Instagram" />
                <Tool ok={!!t?.node} name="Node" hint="YouTube отдаёт больше форматов" />
                <Tool ok={!!t?.chrome} name="Chrome" hint="«смотреть рядом»" />
                <Tool ok={!!t?.vpn} name="VPN" hint={t?.vpn ?? "для YouTube из России"} />
              </span>
            </div>
          )}
        </section>

        <section>
          <h4>Программы</h4>
          {state && (
            <div className="cmp-tool-list">
              {TOOLS.filter((x) => state.tools[x.id]).map((x) => {
                const st = state.tools[x.id];
                // апскейлер в системе не ищем: он бывает только нашим компонентом
                const inSystem = x.id === "ffmpeg" ? !!t?.ffmpeg : x.id === "yt-dlp" ? !!t?.ytdlp : false;
                return (
                  <div key={x.id} className="cmp-installed">
                    {st.component ? (
                      <span className="ok">✓ {x.title} {st.version}</span>
                    ) : (
                      <span className={inSystem ? "ok" : "bad"}>{inSystem ? `✓ ${x.title} уже есть в системе` : `✗ ${x.title} не установлен`}</span>
                    )}
                    <span className="muted">{inSystem || st.component ? x.what : x.without}</span>
                    <span className="spacer" />
                    {st.component ? (
                      <>
                        {/* yt-dlp обновляется сам (YouTube ломает старые версии); остальное — когда в манифесте версия новее */}
                        {(x.id === "yt-dlp" || (st.manifestVersion && st.version !== st.manifestVersion)) && (
                          <button className="small" disabled={busy || installing}
                            title={x.id === "yt-dlp" ? "Скачать свежий yt-dlp с GitHub (проверяется подписью). Раз в неделю это делается само" : `Поставить версию ${st.manifestVersion}`}
                            onClick={() => void act(async () => { const text = await window.api.updateTool(x.id); setMsg({ ok: true, text }); }).then(refresh)}>
                            Обновить{x.id !== "yt-dlp" && st.manifestVersion ? ` до ${st.manifestVersion}` : ""}
                          </button>
                        )}
                        <button className="small" disabled={busy || installing} onClick={() => void act(() => window.api.removeTool(x.id), `${x.title} удалён.`).then(refresh)}>Удалить</button>
                      </>
                    ) : (
                      <button
                        className={inSystem ? "small" : "primary"}
                        disabled={busy || installing}
                        onClick={() => void act(() => { setProgress(null); return window.api.installTool(x.id); }, `${x.title} установлен.`).then(refresh)}
                      >
                        {inSystem ? "Поставить отдельный" : "Установить"} ({size(st.bytes)})
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ---------- перевод и голос ---------- */}
        {state && state.tools.llama && (
          <section>
            <h4>Перевод и голос</h4>
            <div className="muted">Для «Латыни» и других иностранных ответов: перевести фразу и озвучить её. Всё работает на вашем компьютере, без интернета.</div>
            <div className="cmp-tool-list">
              <div className="muted"><b>Переводчик</b> — три варианта перевода с русского. Если в модели картинок уже стоит Qwen3 (8B или 4B), переводчик возьмёт её сам, отдельную модель ставить не нужно.</div>
              {voiceRow(nvidia ? "llama" : "llama-vulkan", nvidia ? "Сервер llama.cpp (NVIDIA)" : "Сервер llama.cpp (Vulkan: AMD, Intel)", nvidia ? "запускает переводчика и голос на видеокарте" : "запускает переводчика на любой видеокарте")}
              {voiceRow("llm-model", "Модель перевода Qwen3 4B", "нужна, только если Qwen3 из картинок не стоит")}
              <div className="muted"><b>Голос на видеокарте (NVIDIA)</b> — живой голос, около секунды на фразу, 10 языков.</div>
              {voiceRow("llama", "Сервер llama.cpp (NVIDIA)", "общий с переводчиком, ставится один раз", !nvidia)}
              {voiceRow("tts-model", "Модель голоса Qwen3-TTS", "около 0,7 ГБ видеопамяти")}
              <div className="muted"><b>Голос Piper (для слабых компьютеров)</b> — работает на процессоре, звучит проще. Каждый язык — отдельный голос.</div>
              {voiceRow("piper", "Piper", "движок озвучки на процессоре")}
              {PIPER_VOICES.map((v) => voiceRow(v.id, v.title, "голос Piper"))}
            </div>
          </section>
        )}

        {/* ---------- обновления ---------- */}
        <section>
          <h4>Обновления</h4>
          <UpdatesBlock />
        </section>

        <section>
          <h4>Локальная модель картинок</h4>
          {state?.model && !installing && (
            <div className="cmp-installed">
              <span className="ok">✓ Стоит: {checks.find((c) => c.profile.id === state.model!.profile)?.profile.title ?? state.model.profile ?? "модель"}</span>
              <span className="muted">{state.model.own ? state.model.path : `${state.componentsDir}\\${state.model.path}`}</span>
              <span className="spacer" />
              <button className="small" disabled={busy} onClick={() => void act(() => window.api.removeModel(), state.model!.own ? "Папка забыта, файлы на месте." : "Модель удалена.")}>
                {state.model.own ? "Отключить" : "Удалить"}
              </button>
            </div>
          )}

          {report && report.profile.recommended === "cloud" && !state?.model && (
            <div className="muted">
              Своей модели этой машине не хватит — картинки будет рисовать облако. Бесплатный ключ Cloudflare
              добавляется в «ИИ».
            </div>
          )}

          {checks.length > 0 && (!state?.model || installing) && (
            <div className="cmp-profiles">
              {checks.map((c) => (
                <label key={c.profile.id} className={`cmp-profile${c.ok ? "" : " off"}`}>
                  <input type="radio" name="profile" disabled={busy || installing} checked={choice === c.profile.id} onChange={() => setChoice(c.profile.id)} />
                  <span>
                    <b>{c.profile.title}</b>
                    {report?.profile.recommended === c.profile.id && <span className="cmp-badge">подходит лучше всего</span>}
                    <span className="muted"> · {gb(bytesOf(c.profile.id))}</span>
                    <div className="muted">{c.profile.what}</div>
                    {!c.ok && <div className="cmp-why">{c.why.join("; ")}</div>}
                  </span>
                </label>
              ))}
            </div>
          )}

          {progress && progress.phase !== "done" && (
            <div className="cmp-progress">
              <div className="cmp-bar"><div style={{ width: `${progress.total ? Math.min(100, (progress.done / progress.total) * 100) : 0}%` }} /></div>
              <div className="muted">
                {PHASE[progress.phase]}
                {progress.file && ` · ${progress.fileIndex}/${progress.fileCount} ${progress.file}`}
                {progress.total > 0 && ` · ${size(progress.done)} из ${size(progress.total)}`}
                {progress.phase === "download" && progress.speed ? ` · ${(progress.speed / 1048576).toFixed(1).replace(".", ",")} МБ/с ${eta(progress)}` : ""}
              </div>
              {progress.message && <div className={progress.phase === "error" ? "bad" : "muted"}>{progress.message}</div>}
            </div>
          )}

          <div className="cmp-actions">
            {installing ? (
              <button onClick={() => void window.api.cancelModelInstall()}>Остановить</button>
            ) : (
              !state?.model && (
                <>
                  <button
                    className="primary"
                    disabled={busy || !choice}
                    title={choice && !checks.find((c) => c.profile.id === choice)?.ok ? "машина не проходит по требованиям — модель может не запуститься" : ""}
                    onClick={() => choice && void install(choice)}
                  >
                    {choice ? `Установить (${gb(bytesOf(choice))})` : "Установить"}
                  </button>
                  <button className="link" disabled={busy} onClick={() => void act(() => window.api.adoptModelFolder(), "Папка подключена: модель берётся оттуда, ничего не копировалось.")}>
                    Указать уже скачанную папку…
                  </button>
                </>
              )
            )}
          </div>
          {choice && !installing && !state?.model && !checks.find((c) => c.profile.id === choice)?.ok && (
            <div className="cmp-why">Эта машина не проходит требования профиля — скачать можно, но модель может не запуститься.</div>
          )}
          {msg && <div className={msg.ok ? "ok" : "bad"}>{msg.text}</div>}
          <div className="muted cmp-note">
            Файлы качаются с GitHub (sd.cpp) и Hugging Face (модели), каждый сверяется по SHA256. Оборвалось —
            нажмите «Установить» снова: загрузка продолжится с места обрыва. Лицензия FLUX.2 klein 9B — некоммерческая.
          </div>
        </section>
      </div>
    </div>
  );
}

function Tool({ ok, name, hint }: { ok: boolean; name: string; hint: string }) {
  return <span className={ok ? "ok" : "bad"} title={hint}>{ok ? "✓" : "✗"} {name}</span>;
}

// ---------- обновления ----------
// «Проверить обновления» с текущей версией — полноценная плашка UpdateBanner.tsx всплывает сама,
// когда обновление найдено; здесь — только версия и ручная проверка по кнопке.

const UPDATE_LABEL: Record<UpdateStatus["state"], string> = {
  idle: "Обновлений нет",
  checking: "Проверяю…",
  available: "Найдено обновление",
  downloading: "Скачиваю…",
  ready: "Обновление готово — установится плашкой внизу окна",
  error: "Не удалось проверить",
};

function UpdatesBlock() {
  const [version, setVersion] = useState("");
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    void window.api.appVersion().then(setVersion);
    void window.api.updateStatus().then(setStatus);
    return window.api.onUpdateState((s) => { setStatus(s); setChecking(false); });
  }, []);

  return (
    <div className="cmp-installed">
      <span className="muted">Установлена версия {version || "…"}</span>
      <span className="spacer" />
      <span className={status.state === "error" ? "bad" : "muted"}>
        {UPDATE_LABEL[status.state]}{status.state === "available" || status.state === "ready" ? ` (${status.version})` : ""}
        {status.state === "downloading" && status.percent !== undefined ? ` ${status.percent}%` : ""}
        {status.state === "error" && status.error ? `: ${status.error}` : ""}
      </span>
      <button className="small" disabled={checking} onClick={() => { setChecking(true); void window.api.updateCheck(); }}>
        Проверить обновления
      </button>
    </div>
  );
}

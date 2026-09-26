// Настройки ИИ: сервисы, ключи, модели и очереди — всё, что раньше правилось руками в providers.json.
//
// Ключи в окно не приходят: видно только «есть, …a1b2». Новый ключ вписывается в пустое поле;
// пустое поле при сохранении значит «оставить прежний», а не «стереть» — стирает отдельная кнопка.

import { useEffect, useMemo, useState } from "react";
import type { AiSettings as Settings, ProviderEdit, ProviderTemplate, QuotaInfo } from "../../shared/api";

interface Props {
  onClose(): void;
}

function cleanError(e: unknown): string {
  return String((e as Error).message).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "");
}

const lines = (s: string) => s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

export function AiSettings({ onClose }: Props) {
  const [s, setS] = useState<Settings | null>(null);
  const [templates, setTemplates] = useState<ProviderTemplate[]>([]);
  const [sel, setSel] = useState<string>("");
  const [tab, setTab] = useState<"services" | "queues" | "other">("services");
  // ---------- связь с сервером автора: галочка отчётов об ошибках ----------
  const [reportErrors, setReportErrors] = useState(window.api.ui.reportErrors ?? true);
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [quota, setQuota] = useState<Record<string, QuotaInfo>>({});
  const [quotaBusy, setQuotaBusy] = useState(false);
  /** Черновики многострочных полей: пока автор печатает, пустые строки не выбрасываем. */
  const [draft, setDraft] = useState<Record<string, string>>({});

  const loadQuota = async () => {
    setQuotaBusy(true);
    try {
      const list = await window.api.aiQuota();
      setQuota(Object.fromEntries(list.map((q) => [q.provider, q])));
    } finally {
      setQuotaBusy(false);
    }
  };

  useEffect(() => {
    void window.api.aiSettings().then((x) => { setS(x); setSel(x.providers[0]?.id ?? ""); });
    void window.api.aiTemplates().then(setTemplates);
    void loadQuota();
  }, []);

  const cur = s?.providers.find((p) => p.id === sel);

  const patch = (id: string, change: Partial<ProviderEdit>) => {
    setS((prev) => prev && { ...prev, providers: prev.providers.map((p) => (p.id === id ? { ...p, ...change } : p)) });
    setDirty(true);
  };

  const addFrom = (t: ProviderTemplate) => {
    if (!s) return;
    let id = t.id;
    for (let n = 2; s.providers.some((p) => p.id === id); n++) id = `${t.id}${n}`;
    const p: ProviderEdit = {
      id, title: t.title, kind: t.kind, base: t.base, account: t.kind === "cloudflare" ? "" : undefined,
      models: t.models, imageModels: t.imageModels, extraBody: t.extraBody ? JSON.stringify(t.extraBody) : "",
      note: t.note, paid: t.paid, hasKey: false, keyHint: "", key: "",
    };
    setS({ ...s, providers: [...s.providers, p] });
    setSel(id);
    setTab("services");
    setDirty(true);
    setNote(t.keyUrl ? `Ключ берётся здесь: ${t.keyUrl}` : "");
  };

  const remove = (id: string) => {
    if (!s || !confirm(`Убрать сервис «${cur?.title}»? Его модели уйдут и из очередей.`)) return;
    const refOf = (r: string) => r.slice(0, r.indexOf(":")) !== id;
    const providers = s.providers.filter((p) => p.id !== id);
    setS({ ...s, providers, chain: s.chain.filter(refOf), imageChain: s.imageChain.filter(refOf) });
    setSel(providers[0]?.id ?? "");
    setDirty(true);
  };

  const save = async (): Promise<boolean> => {
    if (!s) return false;
    setBusy(true);
    setNote("");
    try {
      const saved = await window.api.aiSettingsSave(s);
      setS(saved);
      setDraft({});
      setDirty(false);
      setNote(`Сохранено: ${saved.path ?? ""}`);
      void loadQuota();
      return true;
    } catch (e) {
      setNote(`Не сохранилось: ${cleanError(e)}`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!cur) return;
    if (dirty && !(await save())) return;
    setBusy(true);
    setNote(`Проверяю «${cur.title}»…`);
    try {
      setNote(`«${cur.title}»: ${await window.api.aiTest(cur.id)}`);
      void loadQuota();
    } catch (e) {
      setNote(`«${cur.title}»: не отвечает — ${cleanError(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (dirty && !confirm("Есть несохранённые изменения. Закрыть без сохранения?")) return;
    onClose();
  };

  // все модели всех сервисов — для добавления в очереди
  const allText = useMemo(() => s?.providers.flatMap((p) => p.models.map((m) => `${p.id}:${m}`)) ?? [], [s]);
  const allImage = useMemo(() => s?.providers.flatMap((p) => p.imageModels.map((m) => `${p.id}:${m}`)) ?? [], [s]);

  const field = (key: string, value: string[]) => draft[key] ?? value.join("\n");

  if (!s) return null;

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div className="media-editor ai-settings">
        <header>
          <b>Настройки ИИ</b>
          <span className="ws-tabs">
            <button className={tab === "services" ? "sel" : ""} onClick={() => setTab("services")}>Сервисы и ключи</button>
            <button className={tab === "queues" ? "sel" : ""} onClick={() => setTab("queues")}>Очереди моделей</button>
            <button className={tab === "other" ? "sel" : ""} onClick={() => setTab("other")}>Прочее</button>
          </span>
          <span className="spacer" />
          <button onClick={() => void loadQuota()} disabled={quotaBusy} title="Спросить у сервисов остатки">
            {quotaBusy ? "Узнаю остатки…" : "↻ Остатки"}
          </button>
          <button onClick={close} disabled={busy}>Закрыть</button>
        </header>

        {tab === "services" ? (
          <div className="ws-body">
            <div className="ws-side">
              {s.providers.map((p) => {
                const q = quota[p.id];
                return (
                  <button key={p.id} className={`ws-gen${sel === p.id ? " sel" : ""}${p.disabled ? " off" : ""}`} onClick={() => setSel(p.id)}>
                    <b>
                      <span className={`ai-dot ${q?.level ?? "unknown"}`} />
                      {p.title}{p.paid ? " ₽" : ""}{p.disabled ? " (выкл.)" : ""}
                    </b>
                    <span className="muted">{p.hasKey || p.key ? "" : "нет ключа · "}{q?.text ?? p.note ?? ""}</span>
                  </button>
                );
              })}
              <select
                value=""
                onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); if (t) addFrom(t); }}
                title="Готовые заготовки: адрес и модели уже вписаны, остаётся ключ"
              >
                <option value="">+ Добавить сервис…</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </div>

            <div className="ws-main ai-form">
              {!cur ? (
                <span className="muted">Сервисов пока нет — добавьте из списка слева.</span>
              ) : (
                <>
                  {quota[cur.id] && (
                    <div className={`ai-quota ${quota[cur.id].level}`}>
                      <b>{quota[cur.id].text}</b>
                      {quota[cur.id].source && <span className="muted"> — {quota[cur.id].source}</span>}
                      {quota[cur.id].hint && <div className="muted">{quota[cur.id].hint}</div>}
                    </div>
                  )}
                  <div className="ai-grid">
                    <label>Название
                      <input value={cur.title} onChange={(e) => patch(cur.id, { title: e.target.value })} />
                    </label>
                    <label>Тип
                      <select value={cur.kind} onChange={(e) => patch(cur.id, { kind: e.target.value as ProviderEdit["kind"] })}>
                        <option value="openai">OpenAI-совместимый</option>
                        <option value="cloudflare">Cloudflare Workers AI</option>
                      </select>
                    </label>
                    <label className="wide">Адрес API
                      <input value={cur.base} onChange={(e) => patch(cur.id, { base: e.target.value })} placeholder="https://…/v1" />
                    </label>
                    {cur.kind === "cloudflare" && (
                      <label className="wide">Account ID (Cloudflare → Workers AI → «Use REST API»)
                        <input value={cur.account ?? ""} onChange={(e) => patch(cur.id, { account: e.target.value })} />
                      </label>
                    )}
                    <label className="wide">Ключ API
                      <span className="ai-key">
                        <input
                          type="password"
                          value={typeof cur.key === "string" ? cur.key : ""}
                          placeholder={cur.key === null ? "ключ будет стёрт при сохранении" : cur.hasKey ? `сохранён (${cur.keyHint}) — впишите новый, чтобы заменить` : "вставьте ключ"}
                          onChange={(e) => patch(cur.id, { key: e.target.value })}
                          autoComplete="off"
                        />
                        {cur.hasKey && <button className="small" onClick={() => patch(cur.id, { key: null })} title="Стереть сохранённый ключ">Стереть</button>}
                      </span>
                    </label>
                    <label>Текстовые модели (по одной в строке)
                      <textarea rows={4} value={field(`${cur.id}.models`, cur.models)}
                        onChange={(e) => { setDraft({ ...draft, [`${cur.id}.models`]: e.target.value }); patch(cur.id, { models: lines(e.target.value) }); }} />
                    </label>
                    <label>Модели картинок (по одной в строке)
                      <textarea rows={4} value={field(`${cur.id}.imageModels`, cur.imageModels)}
                        onChange={(e) => { setDraft({ ...draft, [`${cur.id}.imageModels`]: e.target.value }); patch(cur.id, { imageModels: lines(e.target.value) }); }} />
                    </label>
                    <label className="wide">Дополнительные поля запроса (JSON, необязательно)
                      <input value={cur.extraBody} placeholder='например {"reasoning_effort":"low"}' onChange={(e) => patch(cur.id, { extraBody: e.target.value })} />
                    </label>
                    <label>Ждать ответа, с
                      <input type="number" min={0} value={cur.timeoutSec ?? ""} placeholder="авто"
                        onChange={(e) => patch(cur.id, { timeoutSec: Number(e.target.value) || undefined })} />
                    </label>
                    <label>Заметка
                      <input value={cur.note ?? ""} onChange={(e) => patch(cur.id, { note: e.target.value })} />
                    </label>
                    <label className="ai-check">
                      <input type="checkbox" checked={!!cur.paid} onChange={(e) => patch(cur.id, { paid: e.target.checked })} />
                      Платный — рисовать им только после моего подтверждения
                    </label>
                    <label className="ai-check">
                      <input type="checkbox" checked={!!cur.disabled} onChange={(e) => patch(cur.id, { disabled: e.target.checked })} />
                      Выключен — пропускать в очередях
                    </label>
                  </div>
                  <div className="ig-actions">
                    <button onClick={() => void test()} disabled={busy} title="Короткий запрос к первой текстовой модели (или список моделей). Картинку не рисует — лимит не тратится">
                      Проверить связь
                    </button>
                    <span className="spacer" />
                    <button onClick={() => remove(cur.id)} disabled={busy}>Убрать сервис</button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : tab === "queues" ? (
          <div className="ai-queues">
            <Queue
              title="Текст (сцены для картинок и прочие подсказки)"
              about="Идём сверху вниз: первая ответившая модель побеждает. Сбой 429/5xx — модель отдыхает, ответ берётся у следующей."
              list={s.chain} all={allText}
              onChange={(chain) => { setS({ ...s, chain }); setDirty(true); }}
            />
            <Queue
              title="Картинки"
              about="Платные (₽) пропускаются, пока вы не нажмёте «Нарисовать платной». Исчерпанный дневной лимит — сервис пропускается до сброса."
              list={s.imageChain} all={allImage}
              paid={new Set(s.providers.filter((p) => p.paid).map((p) => p.id))}
              onChange={(imageChain) => { setS({ ...s, imageChain }); setDirty(true); }}
            />
          </div>
        ) : (
          // ---------- связь с сервером автора ----------
          <div className="ai-queues">
            <section className="ai-queue">
              <b>Связь с автором</b>
              <label className="ai-check">
                <input
                  type="checkbox"
                  checked={reportErrors}
                  onChange={(e) => { setReportErrors(e.target.checked); void window.api.setUi("reportErrors", e.target.checked); }}
                />
                Отправлять отчёты об ошибках автору
              </label>
              <span className="muted">Только текст ошибки и версия программы. Паки, ключи и файлы не отправляются.</span>
            </section>
          </div>
        )}

        <footer className="mc-foot">
          <span className="muted ai-note">{note || (s.path ? `Файл: ${s.path}` : "Файла настроек ещё нет — создастся при сохранении")}</span>
          <span className="spacer" />
          <button className="primary" onClick={() => void save()} disabled={busy || !dirty}>Сохранить</button>
        </footer>
      </div>
    </div>
  );
}

function Queue({ title, about, list, all, paid, onChange }: {
  title: string; about: string; list: string[]; all: string[]; paid?: Set<string>; onChange(next: string[]): void;
}) {
  const move = (i: number, d: number) => {
    const next = [...list];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    onChange(next);
  };
  const free = all.filter((r) => !list.includes(r));
  return (
    <section className="ai-queue">
      <b>{title}</b>
      <span className="muted">{about}</span>
      <ol>
        {list.map((r, i) => (
          <li key={r}>
            <span className="ai-ref">{r}{paid?.has(r.slice(0, r.indexOf(":"))) ? " ₽" : ""}</span>
            <button className="icon" disabled={i === 0} onClick={() => move(i, -1)} title="Выше">↑</button>
            <button className="icon" disabled={i === list.length - 1} onClick={() => move(i, 1)} title="Ниже">↓</button>
            <button className="icon" onClick={() => onChange(list.filter((x) => x !== r))} title="Убрать из очереди">✕</button>
          </li>
        ))}
        {!list.length && <li className="muted">очередь пуста</li>}
      </ol>
      <select value="" onChange={(e) => e.target.value && onChange([...list, e.target.value])} disabled={!free.length}>
        <option value="">{free.length ? "+ Добавить модель в конец…" : "все модели уже в очереди"}</option>
        {free.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
    </section>
  );
}

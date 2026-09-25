// Вкладка «Картинки» в студии слов: фраза → сцена (текстовая модель) → картинка (модель рисования).
//
// Два шага нарочно разведены: промпт виден и правится руками. Модель часто понимает фразу
// «по смыслу», а для темы нужна буква — автор должен видеть, что именно уйдёт в рисование.
// Картинка до нажатия «В вопрос» / «В пак» в пак не попадает: неудачные варианты не копятся.

import { useEffect, useState } from "react";
import { PhrasePicker } from "./PhrasePicker";
import type { GeneratedImage, ImagePreset, ImageStyleInfo, MediaInfo, QuotaInfo } from "../../shared/api";

interface Props {
  /** Положить картинку в открытый вопрос, фразу — в ответ. Нет выбранного вопроса — нет и кнопки. */
  onInsert?(img: MediaInfo, answer: string): void;
  insertTarget?: string;
  /** Картинка легла в пак без вопроса: окну надо знать о новом файле. */
  onAdded(img: MediaInfo): void;
  /** Открыть настройки ИИ (ключи, очереди). */
  onOpenAi?(): void;
}

const SIZES = [
  { id: "1024x768", title: "4:3 (как экран SIGame)", w: 1024, h: 768 },
  { id: "1024x1024", title: "квадрат", w: 1024, h: 1024 },
  { id: "768x1024", title: "портрет", w: 768, h: 1024 },
];

/** Смелость сцены помним между запусками: автор выставил под свою тему — так и оставить. */
const TEMP_KEY = "imageStudio.temperature";
function loadTemp(): number {
  try {
    const v = Number(localStorage.getItem(TEMP_KEY));
    return v >= 0 && v <= 1.5 && localStorage.getItem(TEMP_KEY) !== null ? v : 1;
  } catch {
    return 1;
  }
}

function tempLabel(t: number): string {
  return t < 0.4 ? "предсказуемо" : t < 0.9 ? "умеренно" : t < 1.25 ? "смело" : "безумно";
}

/** Отмеченные стили помним: автор выбрал свой вкус — так и оставить. По умолчанию — «эпичный мрак». */
const STYLES_KEY = "imageStudio.styles";
function loadStyles(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(STYLES_KEY) ?? "null") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : ["epic"];
  } catch {
    return ["epic"];
  }
}

/** Фразы, уже вставленные в вопросы: словарь помечает их, чтобы тема не повторялась. */
const USED_KEY = "imageStudio.usedPhrases";
function loadUsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(USED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function cleanError(e: unknown): string {
  return String((e as Error).message).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "");
}

export function ImageStudio({ onInsert, insertTarget, onAdded, onOpenAi }: Props) {
  const [presets, setPresets] = useState<ImagePreset[]>([]);
  const [preset, setPreset] = useState("literal");
  const [phrase, setPhrase] = useState("");
  const [prompt, setPrompt] = useState("");
  const [promptBy, setPromptBy] = useState("");
  const [size, setSize] = useState(SIZES[0].id);
  const [img, setImg] = useState<GeneratedImage | null>(null);
  const [busy, setBusy] = useState<"" | "prompt" | "image" | "save">("");
  const [note, setNote] = useState("");
  const [quota, setQuota] = useState<QuotaInfo[]>([]);
  /** Черновик инструкции текущего стиля; null — не правили, показываем сохранённую. */
  const [temperature, setTemperature] = useState(loadTemp);
  const [showDict, setShowDict] = useState(false);
  const [used, setUsed] = useState(loadUsed);
  const [sysDraft, setSysDraft] = useState<string | null>(null);
  const [styles, setStyles] = useState<ImageStyleInfo[]>([]);
  const [picked, setPicked] = useState<string[]>(loadStyles);
  /** Каким стилем нарисована текущая картинка — подписываем под ней. */
  const [imgStyle, setImgStyle] = useState("");
  /** Бесплатные не нарисовали — какие платные можно попросить. */
  const [paidOffer, setPaidOffer] = useState<string[]>([]);

  // остатки по сервисам из очереди картинок: учёт ведёт главный процесс, окно только показывает
  const loadQuota = () => void window.api.aiQuota("images").then(setQuota).catch(() => setQuota([]));

  useEffect(() => {
    void window.api.imagePresets().then(setPresets);
    void window.api.imageStyles().then(setStyles);
    loadQuota();
    // окно закрыли посреди генерации — не ждём ответа зря
    return () => { void window.api.imageCancel(); };
  }, []);

  const current = presets.find((p) => p.id === preset);
  const sysText = sysDraft ?? current?.system ?? "";
  const sysDirty = sysDraft !== null && sysDraft !== current?.system;

  const saveSystem = async (text: string | null) => {
    try {
      setPresets(await window.api.imagePresetSave(preset, text));
      setSysDraft(null);
      setNote(text === null ? "Вернула исходную инструкцию." : "Инструкция сохранена — «Другая сцена» пойдёт уже по ней.");
    } catch (e) {
      setNote(`Инструкция не сохранилась: ${cleanError(e)}`);
    }
  };

  const makePrompt = async (): Promise<string | null> => {
    if (!phrase.trim()) { setNote("Сначала напишите фразу."); return null; }
    setBusy("prompt");
    setNote("");
    try {
      const r = await window.api.imagePrompt(phrase, preset, temperature);
      setPrompt(r.text);
      setPromptBy(r.model);
      return r.text;
    } catch (e) {
      setNote(`Сцену придумать не получилось: ${cleanError(e)}`);
      return null;
    } finally {
      setBusy("");
    }
  };

  const togglePicked = (id: string) => {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setPicked(next);
    try { localStorage.setItem(STYLES_KEY, JSON.stringify(next)); } catch { /* не запомнится — не беда */ }
  };

  /** Стиль для очередного рисунка: из отмеченных случайный, ничего не отмечено — из всех. */
  const nextStyle = (): string => {
    if (!current?.styled || !styles.length) return "";
    const pool = picked.filter((id) => styles.some((s) => s.id === id));
    const from = pool.length ? pool : styles.map((s) => s.id);
    return from[Math.floor(Math.random() * from.length)];
  };

  const draw = async (text = prompt, allowPaid = false) => {
    if (!text.trim()) { setNote("Промпт пуст."); return; }
    const s = SIZES.find((x) => x.id === size) ?? SIZES[0];
    const style = nextStyle();
    setBusy("image");
    setNote("");
    setPaidOffer([]);
    try {
      const r = await window.api.imageGenerate(text, s.w, s.h, allowPaid, style);
      if ("needPaid" in r) {
        setPaidOffer(r.needPaid);
        setNote(`Бесплатные модели не нарисовали: ${r.skipped.join(" · ")}`);
        return;
      }
      setImg(r);
      setImgStyle(styles.find((x) => x.id === style)?.title ?? "");
    } catch (e) {
      setNote(`Не нарисовалось: ${cleanError(e)}`);
    } finally {
      setBusy("");
      loadQuota();
    }
  };

  /** Главная кнопка: если промпта ещё нет или фраза поменялась — сначала сцена, потом рисунок. */
  const both = async () => {
    // в «своём промпте» фраза — только ответ, рисовать надо то, что автор написал в сцене
    if (!current?.system && !prompt.trim()) { setNote("Опишите сцену в поле ниже."); return; }
    const text = prompt.trim() ? prompt : await makePrompt();
    if (text) await draw(text);
  };

  const save = async (toQuestion: boolean) => {
    if (!img) return;
    setBusy("save");
    try {
      const created = await window.api.imageKeep(img.dataUrl, phrase.trim(), { model: img.model, style: imgStyle || undefined, prompt });
      if (toQuestion && onInsert) {
        onInsert(created, phrase.trim());
        const next = new Set(used).add(phrase.trim());
        setUsed(next);
        try { localStorage.setItem(USED_KEY, JSON.stringify([...next])); } catch { /* пометка не запомнится — не беда */ }
        setNote(`«${phrase.trim()}» вставлено в вопрос. Выбор перешёл к следующему — пишите новую фразу.`);
        setPhrase("");
        setPrompt("");
        setPromptBy("");
        setImg(null);
      } else {
        onAdded(created);
        setNote(`Картинка «${created.name}» лежит в паке (Images) и в библиотеке.`);
      }
    } catch (e) {
      setNote(`Не сохранилось: ${cleanError(e)}`);
    } finally {
      setBusy("");
    }
  };

  const shortModel = (m: string) => m.replace(/^[^:]+:/, "").replace(/^@cf\/[^/]+\//, "");

  return (
    <div className="ws-body">
      <div className="ws-side">
        {presets.map((p) => (
          <button
            key={p.id}
            className={`ws-gen${preset === p.id ? " sel" : ""}`}
            onClick={() => { setPreset(p.id); setPrompt(""); setPromptBy(""); setSysDraft(null); }}
          >
            <b>{p.title}</b>
            <span className="muted">{p.about}</span>
          </button>
        ))}
        <span className="spacer" />
        <div className="ig-quota">
          {quota.map((q) => (
            <div key={q.provider} title={[q.source, q.hint].filter(Boolean).join(" · ")}>
              <span className={`ai-dot ${q.level}`} /> <b>{q.provider}</b>: <span className="muted">{q.text}</span>
            </div>
          ))}
          {onOpenAi && <button className="small" onClick={onOpenAi}>⚙ Ключи и модели</button>}
        </div>
      </div>

      <div className="ws-main ig-main">
        <div className="ws-params">
          <label className="ig-phrase">
            {current?.system ? "Фраза (она же ответ)" : "Ответ"}
            <input
              value={phrase}
              placeholder={current ? `например: ${current.system ? current.example : "кот-король"}` : ""}
              onChange={(e) => { setPhrase(e.target.value); if (current?.system) { setPrompt(""); setPromptBy(""); } }}
              onKeyDown={(e) => { if (e.key === "Enter" && !busy) void both(); }}
              autoFocus
            />
          </label>
          {current?.id === "literal" && (
            <button className={`ig-dict-toggle${showDict ? " sel" : ""}`} onClick={() => setShowDict(!showDict)} title="Выбрать фразу из словаря Викисловаря">
              📖 Словарь
            </button>
          )}
          <label className="narrow">
            Размер
            <select value={size} onChange={(e) => setSize(e.target.value)}>
              {SIZES.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </label>
          <button className="primary ws-run" onClick={() => void both()} disabled={!!busy}>
            {busy === "prompt" ? "Придумываю сцену…" : busy === "image" ? "Рисую…" : "Нарисовать"}
          </button>
        </div>

        <label className="ig-prompt">
          <span>
            Сцена для рисования {promptBy && <span className="muted">— придумала {shortModel(promptBy)}</span>}
            {current?.system && (
              <button className="small" onClick={() => void makePrompt()} disabled={!!busy || !phrase.trim()} title="Попросить модель описать сцену заново">
                Другая сцена
              </button>
            )}
          </span>
          {current?.system && (
            <span className="ig-temp" title="Температура текстовой модели: чем выше, тем неожиданнее сцена. Выше 1.2 модель иногда уходит от фразы — жмите «Другая сцена».">
              Фантазия
              <input
                type="range" min={0} max={1.5} step={0.05} value={temperature}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setTemperature(v);
                  try { localStorage.setItem(TEMP_KEY, String(v)); } catch { /* не запомнится — не беда */ }
                }}
              />
              <b>{temperature.toFixed(2)}</b> <span className="muted">{tempLabel(temperature)}</span>
            </span>
          )}
          <textarea
            value={prompt}
            rows={3}
            placeholder={current?.system ? "Появится здесь после «Нарисовать» — можно поправить и перерисовать" : current?.example}
            onChange={(e) => { setPrompt(e.target.value); setPromptBy(""); }}
          />
        </label>

        {current?.styled && styles.length > 0 && (
          <div className="ig-styles">
            <span className="ig-styles-head">
              Стиль
              <span className="muted">
                {picked.length > 1 ? " — каждый раз случайный из отмеченных" : picked.length ? "" : " — ничего не отмечено: каждый раз случайный из всех"}
              </span>
            </span>
            {styles.map((st) => (
              <label key={st.id} className={`ig-style${picked.includes(st.id) ? " sel" : ""}`} title={st.about}>
                <input type="checkbox" checked={picked.includes(st.id)} onChange={() => togglePicked(st.id)} />
                {st.title}
              </label>
            ))}
          </div>
        )}

        {current?.system && (
          <details className="ig-system">
            <summary>
              Инструкция для текстовой модели{current.edited ? " (ваша)" : ""}
              <span className="muted"> — как она превращает фразу в сцену</span>
            </summary>
            <textarea value={sysText} rows={9} spellCheck={false} onChange={(e) => setSysDraft(e.target.value)} />
            <div className="ig-system-bar">
              <span className="muted">К сцене приложение само дописывает стиль с галочек и «No text, no letters…», чтобы на картинке не было подписей.</span>
              <span className="spacer" />
              {sysDirty && <button className="small" onClick={() => setSysDraft(null)}>Отменить правку</button>}
              {current.edited && !sysDirty && <button className="small" onClick={() => void saveSystem(null)}>Вернуть исходную</button>}
              <button className="small primary" disabled={!sysDirty || !sysText.trim()} onClick={() => void saveSystem(sysText)}>Сохранить</button>
            </div>
          </details>
        )}

        {note && <div className="mc-note">{note}</div>}
        {paidOffer.length > 0 && (
          <div className="ig-paid">
            <span>Можно нарисовать платной моделью: <b>{paidOffer.join(", ")}</b>. Это тратит деньги с баланса сервиса.</span>
            <button className="primary" onClick={() => void draw(prompt, true)} disabled={!!busy}>💰 Нарисовать платной</button>
          </div>
        )}

        {/* словарь — колонкой справа от картинки: так картинка не сжимается, а у списка одна своя прокрутка */}
        <div className="ig-work">
          <div className="ig-stage">
            {img ? (
              <img src={img.dataUrl} alt={phrase} />
            ) : (
              <span className="muted">{busy === "image" ? "Рисую: облако — секунды, своя видеокарта — ~15 с (первая картинка дольше)…" : "Здесь появится картинка"}</span>
            )}
          </div>
          {showDict && current?.id === "literal" && (
            <PhrasePicker
              used={used}
              onPick={(t) => { setPhrase(t); setPrompt(""); setPromptBy(""); setImg(null); }}
            />
          )}
        </div>

        {img && (
          <div className="ig-actions">
            <span className="muted" title={img.skipped.join("\n")}>
              {imgStyle && `${imgStyle} · `}{shortModel(img.model)} · {(img.ms / 1000).toFixed(1)} с{img.skipped.length ? ` · до неё не справились: ${img.skipped.length}` : ""}
            </span>
            <span className="spacer" />
            <button onClick={() => void draw()} disabled={!!busy} title="Та же сцена, новый рисунок (стиль — из отмеченных галочками)">Ещё вариант</button>
            <button onClick={() => void save(false)} disabled={!!busy} title="Положить в Images пака, в вопрос не вставлять">В пак</button>
            {onInsert && (
              <button
                className="primary"
                onClick={() => void save(true)}
                disabled={!!busy || !phrase.trim()}
                title={`Картинка в вопрос, фраза в ответ${insertTarget ? `: ${insertTarget}` : ""}. Выбор сам перейдёт к следующему вопросу темы`}
              >
                В вопрос{insertTarget ? ` (${insertTarget})` : ""}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

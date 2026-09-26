// Студия: темы на словах (матрицы, анаграммы) и ИИ-картинки для тем.
//
// Окно ничего не знает про сами головоломки: оно спрашивает у главного процесса список генераторов
// вместе с их настройками и рисует форму по описанию. Новый генератор появится здесь сам,
// без единой правки в этом файле.

import { useEffect, useState } from "react";
import type { GeneratorArgs, GeneratorInfo, MediaInfo, PuzzleTheme, WordHit } from "../../shared/api";
import { ImageStudio } from "./ImageStudio";
import { Icon } from "./Icon";

interface Props {
  onClose(): void;
  /** Создать тему в текущем раунде из отмеченных слов. */
  onCreateTheme(title: string, hits: WordHit[]): void;
  /** Вставить одну находку в открытый вопрос. Нет выбранного вопроса — нет и кнопки. */
  onInsert?(hit: WordHit): void;
  /** Что сейчас выбрано на табло — показываем в подсказке к кнопке. */
  insertTarget?: string;
  /** Сколько вопросов встанет в тему: столько цен в раунде. По этому числу автор и отмечает слова. */
  themeSize?: number;
  /** Сгенерированная картинка в открытый вопрос, фраза — в ответ. */
  onInsertImage?(img: MediaInfo, answer: string): void;
  /** Картинка легла в пак без вопроса. */
  onImageAdded(img: MediaInfo): void;
  /** Открыть настройки ИИ поверх студии. */
  onOpenAi?(): void;
}

/** Значения по умолчанию из описания генератора. */
function defaults(g: GeneratorInfo): GeneratorArgs {
  const a: GeneratorArgs = {};
  for (const p of g.params) if (p.def !== undefined) a[p.name] = p.def;
  return a;
}

export function WordStudio({ onClose, onCreateTheme, onInsert, insertTarget, themeSize, onInsertImage, onImageAdded, onOpenAi }: Props) {
  // Вкладку не запоминаем нарочно: самопроверка --word-studio ждёт, что окно откроется на словах.
  const [tab, setTab] = useState<"words" | "images">("words");
  const [gens, setGens] = useState<GeneratorInfo[]>([]);
  const [current, setCurrent] = useState<GeneratorInfo | null>(null);
  const [args, setArgs] = useState<GeneratorArgs>({});
  const [theme, setTheme] = useState<PuzzleTheme | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [dicts, setDicts] = useState<{ set: string; words: number; loaded: boolean }[]>([]);

  useEffect(() => {
    void window.api.wordGenerators().then((list) => {
      setGens(list);
      if (list[0]) { setCurrent(list[0]); setArgs(defaults(list[0])); }
    });
    void window.api.wordStats().then(setDicts);
  }, []);

  const pickGen = (g: GeneratorInfo) => {
    setCurrent(g);
    setArgs(defaults(g));
    setTheme(null);
    setPicked(new Set());
    setNote("");
  };

  const run = async () => {
    if (!current) return;
    setBusy(true);
    setNote("");
    try {
      const t = await window.api.wordRun(current.id, args);
      setTheme(t);
      // Отмечаем ровно столько, сколько вопросов встанет в тему: обычно семь. Раньше
      // отмечалось всё подряд, и автор снимал галочки с полусотни слов вручную.
      setPicked(new Set(t.hits.slice(0, themeSize || t.hits.length).map((h) => h.word)));
      if (!t.hits.length) setNote("Ничего не нашлось. Смягчите длину или возьмите словарь побольше.");
    } catch (e) {
      setNote(`Не получилось: ${String((e as Error).message).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "")}`);
    } finally {
      setBusy(false);
    }
  };

  const all = theme?.hits ?? [];
  const pickAll = () => setPicked(new Set(all.map((h) => h.word)));
  const pickNone = () => setPicked(new Set());
  const pickFirst = () => setPicked(new Set(all.slice(0, themeSize ?? 7).map((h) => h.word)));

  const toggle = (w: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(w)) next.delete(w);
    else next.add(w);
    return next;
  });

  const chosen: WordHit[] = (theme?.hits ?? []).filter((h) => picked.has(h.word));
  const noDict = dicts.length > 0 && dicts.every((d) => !d.loaded);

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="media-editor word-studio">
        <header>
          <b>Студия</b>
          <span className="ws-tabs">
            <button className={tab === "words" ? "sel" : ""} onClick={() => setTab("words")}><Icon name="text" />Слова</button>
            <button className={tab === "images" ? "sel" : ""} onClick={() => setTab("images")}><Icon name="palette" />Картинки</button>
          </span>
          {tab === "words" && (
            <span className="muted">
              {dicts.filter((d) => d.loaded).map((d) => `${d.set}: ${d.words.toLocaleString("ru")}`).join(" · ") || "словари не загружены"}
            </span>
          )}
          <span className="spacer" />
          <button onClick={onClose} disabled={busy}>Закрыть</button>
        </header>

        {tab === "images" ? (
          <ImageStudio onInsert={onInsertImage} insertTarget={insertTarget} onAdded={onImageAdded} onOpenAi={onOpenAi} />
        ) : (<>
        {noDict && (
          <div className="mc-errors">
            Словарей нет. Выполните в папке приложения: <code>npm run fetch-dict</code> — это разовая загрузка.
          </div>
        )}

        <div className="ws-body">
          <div className="ws-side">
            {gens.map((g) => (
              <button key={g.id} className={`ws-gen${current?.id === g.id ? " sel" : ""}`} onClick={() => pickGen(g)}>
                <b>{g.title}</b>
                <span className="muted">{g.about}</span>
              </button>
            ))}
          </div>

          <div className="ws-main">
            {current && (
              <div className="ws-params">
                {current.params.filter((p) => !p.when || p.when.values.includes(String(args[p.when.param] ?? ""))).map((p) => (
                  <label key={p.name} className={p.kind === "number" ? "narrow" : ""} title={p.hint}>
                    {p.title}
                    {p.kind === "select" ? (
                      <select name={p.name} value={String(args[p.name] ?? "")} onChange={(e) => setArgs({ ...args, [p.name]: e.target.value })}>
                        {p.options?.map((o) => <option key={o.value} value={o.value}>{o.title}</option>)}
                      </select>
                    ) : p.kind === "checkbox" ? (
                      <input type="checkbox" checked={!!args[p.name]} onChange={(e) => setArgs({ ...args, [p.name]: e.target.checked })} />
                    ) : (
                      <input
                        type={p.kind === "number" ? "number" : "text"}
                        value={String(args[p.name] ?? "")}
                        placeholder={p.placeholder}
                        onChange={(e) => setArgs({ ...args, [p.name]: p.kind === "number" ? Number(e.target.value) : e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") void run(); }}
                      />
                    )}
                  </label>
                ))}
                <button className="primary ws-run" onClick={() => void run()} disabled={busy}>{busy ? "Считаю…" : "Подобрать"}</button>
              </div>
            )}

            {note && <div className="mc-note">{note}</div>}
            {theme?.note && <div className="ws-hint">{theme.note}</div>}

            {/* Отбор — главное действие в этом окне, поэтому счётчик и кнопки стоят над списком,
                а не только в подвале: там их не замечали. */}
            {all.length > 0 && (
              <div className="ws-pickbar">
                <b className={themeSize && chosen.length === themeSize ? "ok" : undefined}>
                  Отмечено {chosen.length} из {all.length}
                </b>
                {themeSize ? (
                  <span className="muted">
                    в тему войдут первые {themeSize} отмеченных — по числу вопросов в раунде
                    {chosen.length > themeSize ? `; лишние ${chosen.length - themeSize} не войдут` : ""}
                  </span>
                ) : null}
                <span className="spacer" />
                <button onClick={pickAll}>Выделить все</button>
                <button onClick={pickNone}>Снять все</button>
                {themeSize ? <button onClick={pickFirst}>Ровно {themeSize}</button> : null}
              </div>
            )}

            <div className="ws-results">
              {(theme?.hits ?? []).map((h) => (
                <label key={h.word} className={`ws-hit${picked.has(h.word) ? " sel" : ""}`}>
                  <input type="checkbox" checked={picked.has(h.word)} onChange={() => toggle(h.word)} />
                  <b>{h.word}</b>
                  {/* у анаграмм в «почему» лежит сама загадка — её видно должно быть лучше, чем пояснение */}
                  {/* пояснение в узкой плитке обрезается — целиком оно во всплывающей подсказке */}
                  <span className={/^[А-ЯЁ]{3,}$/.test(h.why) ? "ws-puzzle" : "muted"} title={h.why}>{h.why}</span>
                  {onInsert && (
                    <button
                      className="small ws-insert"
                      title={`Вставить в вопрос${insertTarget ? `: ${insertTarget}` : ""} — загадка в текст, слово в ответ. Выбор сам перейдёт к следующему вопросу темы`}
                      onClick={(e) => { e.preventDefault(); onInsert(h); setNote(`«${h.word}» вставлено в вопрос`); }}
                    >
                      →
                    </button>
                  )}
                </label>
              ))}
            </div>
          </div>
        </div>

        <footer className="mc-foot">
          <span className="muted">
            Отмечено: {chosen.length} из {all.length}
            {themeSize ? ` · в теме будет ${Math.min(chosen.length, themeSize)} вопросов` : ""}
          </span>
          {all.length > 0 && (
            <>
              <button onClick={pickAll}>Выделить все</button>
              <button onClick={pickNone}>Снять все</button>
            </>
          )}
          <span className="spacer" />
          <button
            className="primary"
            disabled={!chosen.length}
            title="Создаст тему в текущем раунде: по вопросу на каждое отмеченное слово, ответ уже подставлен"
            onClick={() => { onCreateTheme(theme?.title ?? "Тема из слов", chosen); onClose(); }}
          >
            Создать тему из отмеченных
          </button>
        </footer>
        </>)}
      </div>
    </div>
  );
}

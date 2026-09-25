import { useEffect, useState } from "react";
import { CollageEditor } from "./CollageEditor";
import { GamePreview } from "./GamePreview";
import { ImageEditor } from "./ImageEditor";
import { MediaCenter } from "./MediaCenter";
import { MediaLibrary } from "./MediaLibrary";
import { MediaEditor } from "./MediaEditor";
import { PointEditor } from "./PointEditor";
import { PixelTheme } from "./PixelTheme";
import { replaceImages } from "./pixelWork";
import { answerDuration, appendMedia, defaultTimedIndex, questionDefaultSec, TIME_DEFAULTS, contentGroups, itemDefaultTime, parseDuration, setAnswerDuration, withDuration, findParam, getOptions, isPointQuestion, isRef, isWithNext, itemKind, mediaKindByName, OPTION_LETTERS, paramItems, SECRET_TYPES, secretPrice, setOptions, setParamText, setPointMode, setQuestionType, setSecretPrice, setWithNext, SPECIAL_TYPES } from "../../core/siq/helpers";
import type { ContentItem, Param, Question } from "../../core/siq/model";
import type { MediaInfo, PackDTO } from "../../shared/api";
import type { Mutate, Selection } from "./App";

interface Props {
  pack: PackDTO;
  selection: Selection | null;
  mutate: Mutate;
  addMedia(paths?: string[]): Promise<MediaInfo[]>;
  /** цену дописали — поставить клетку на место по цене */
  onPriceCommit?(): void;
  /** перенести вопрос в конец другой темы (в этом или другом раунде) */
  onMoveTo?(round: number, theme: number): void;
}

const FOLDER: Record<string, string> = { image: "Images", audio: "Audio", video: "Video" };
const KIND_LABEL: Record<string, string> = { text: "Текст", image: "Картинка", audio: "Звук", video: "Видео", html: "HTML" };

function MediaPreview({ item, media }: { item: ContentItem; media: MediaInfo[] }) {
  const kind = itemKind(item);
  if (!isRef(item)) {
    return <div className="media-missing">Внешняя ссылка: {item.value}</div>;
  }
  const m = media.find((x) => x.folder === FOLDER[kind] && x.name === item.value);
  if (!m) return <div className="media-missing">Файла «{item.value}» нет в паке</div>;
  if (kind === "image") return <img className="preview" src={m.url} alt={item.value} />;
  if (kind === "audio") return <audio className="preview" src={m.url} controls preload="metadata" />;
  if (kind === "video") return <video className="preview" src={m.url} controls preload="metadata" />;
  return null;
}

const secText = (s: number) => String(Math.round(s * 10) / 10).replace(".", ",");

/**
 * Секунды с черновиком: пишем по Enter или уходу из поля, иначе «0,5» по пути превращался бы в «0» и стирался.
 * Пусто — своё время убрать, игра возьмёт по умолчанию (оно в подсказке поля).
 */
function SecondsField({ value, placeholder, title, disabled, onCommit }: {
  value: number | undefined;
  placeholder: string;
  title: string;
  disabled?: boolean;
  onCommit(v: number | undefined): void;
}) {
  const [draft, setDraft] = useState(value === undefined ? "" : secText(value));
  useEffect(() => setDraft(value === undefined ? "" : secText(value)), [value]);
  const commit = () => {
    const v = Number(draft.replace(",", ".").trim());
    onCommit(draft.trim() && Number.isFinite(v) && v > 0 ? v : undefined);
  };
  return (
    <label className="secs" title={title}>
      ⏱
      <input value={draft} placeholder={placeholder} disabled={disabled} inputMode="decimal"
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setDraft(value === undefined ? "" : secText(value)); } }} />
      с
    </label>
  );
}

/** Своё время элемента: пусто — как решит игра (подсказка показывает сколько). */
function ItemTime({ it, isLast, inAnswer, packDefault, onChange }: { it: ContentItem; isLast: boolean; inAnswer: boolean; packDefault?: number; onChange(sec: number | undefined): void }) {
  if (it.placement === "background") return null;
  if (isWithNext(it)) {
    return <SecondsField value={undefined} placeholder="сразу" disabled onCommit={() => {}}
      title="Выходит на один экран со следующим: игра его не ждёт. Время ставьте последнему элементу экрана" />;
  }
  const def = packDefault ?? itemDefaultTime(it, isLast, inAnswer);
  const kind = itemKind(it);
  return (
    <SecondsField
      value={parseDuration(it.duration)}
      placeholder={def === undefined ? "до конца" : secText(def)}
      title={packDefault !== undefined
        ? `Пусто — ${packDefault} с: время показа вопроса по умолчанию мастерской, запишется при сохранении пака`
        : kind === "audio" || kind === "video"
        ? "Сколько секунд держать на экране. Пусто — до конца файла. Со своим временем игра конца файла не ждёт: обрежет или подождёт"
        : kind === "text"
          ? "Сколько секунд держать текст. Пусто — по скорости чтения (20 знаков/с), в подсказке сколько выйдет"
          : "Сколько секунд держать на экране. Пусто — 5 с, как в SIGame по умолчанию"}
      onCommit={onChange}
    />
  );
}

/** Редактор списка элементов контента одного параметра (question или answer). */
function ContentList({ items, inAnswer = false, timed, media, onChange, onAddMedia, onEdit, onCollage, onSearch, onLibrary }: {
  items: ContentItem[];
  inAnswer?: boolean;
  /** элемент, которому при сохранении достанется время по умолчанию, и сколько секунд */
  timed?: { index: number; sec: number };
  media: MediaInfo[];
  onChange(items: ContentItem[]): void;
  onAddMedia(): void;
  onEdit(m: MediaInfo, replace: (created: MediaInfo) => void): void;
  onCollage(): void;
  onSearch(): void;
  onLibrary(): void;
}) {
  const set = (i: number, patch: Partial<ContentItem>) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const remove = (i: number) => onChange(items.filter((_, j) => j !== i));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    // «одновременно» остаётся на своём месте: картинка и текст меняются местами, но экран общий
    const next = [...items];
    [next[i], next[j]] = [{ ...items[j], waitForFinish: items[i].waitForFinish }, { ...items[i], waitForFinish: items[j].waitForFinish }];
    onChange(next.map((it) => { if (it.waitForFinish === undefined) { const { waitForFinish: _, ...rest } = it; return rest; } return it; }));
  };
  const renderItem = (it: ContentItem, i: number) => {
    const kind = itemKind(it);
    return (
      <div className="content-item" key={i}>
        <div className="content-item-head">
          <span className={`kind kind-${kind}`}>{KIND_LABEL[kind]}</span>
          {it.placement === "background" && <span className="file-name" title="Звучит фоном, пока идёт вопрос">фоном</span>}
          {kind !== "text" && <span className="file-name" title={it.value}>{it.value}</span>}
          <span className="spacer" />
          <ItemTime it={it} isLast={i === items.length - 1} inAnswer={inAnswer} packDefault={timed?.index === i ? timed.sec : undefined} onChange={(sec) => onChange(items.map((x, j) => (j === i ? withDuration(x, sec) : x)))} />
          {(kind === "video" || kind === "audio" || kind === "image") && isRef(it) && (() => {
            const m = media.find((x) => x.folder === FOLDER[kind] && x.name === it.value);
            if (!m) return null;
            const label = kind === "image" ? "Изменить…" : "Обрезать…";
            return <button className="small" onClick={() => onEdit(m, (created) => set(i, { value: created.name, type: mediaKindByName(created.name) ?? "image" }))}>{label}</button>;
          })()}
          <button className="icon" onClick={() => move(i, -1)} title="Выше">↑</button>
          <button className="icon" onClick={() => move(i, 1)} title="Ниже">↓</button>
          <button className="icon" onClick={() => remove(i)} title="Убрать из вопроса">×</button>
        </div>
        {kind === "text" ? (
          <textarea value={it.value} onChange={(e) => set(i, { value: e.target.value })} rows={Math.min(8, Math.max(2, it.value.split("\n").length + 1))} placeholder="Текст вопроса" />
        ) : (
          <MediaPreview item={it} media={media} />
        )}
      </div>
    );
  };
  // переключатель между элементом i и следующим: waitForFinish="False" у верхнего
  const link = (i: number) => {
    const on = isWithNext(items[i]);
    return (
      <button
        key={`link-${i}`}
        className={`link-toggle${on ? " on" : ""}`}
        onClick={() => onChange(setWithNext(items, i, !on))}
        title={on
          ? "Сейчас: на одном экране, сверху вниз в том же порядке, что здесь (текст под картинкой — поставьте его ниже стрелками). Нажмите — и игра покажет их по очереди"
          : "Сейчас: игра покажет по очереди, дождавшись конца верхнего. Нажмите — и они выйдут на один экран"}
      >
        {on ? "🔗 одновременно" : "⇣ по очереди"}
      </button>
    );
  };
  return (
    <div className="content-list">
      {contentGroups(items).map((g) => {
        const body = g.flatMap((i, k) => (k < g.length - 1 ? [renderItem(items[i], i), link(i)] : [renderItem(items[i], i)]));
        const last = g[g.length - 1];
        return [
          g.length > 1
            ? <div className="content-group" key={`g-${g[0]}`}><div className="content-group-label">Один экран в игре · сверху вниз как здесь</div>{body}</div>
            : body,
          last < items.length - 1 ? link(last) : null,
        ];
      })}
      <div className="content-add">
        <button onClick={() => onChange([...items, { value: "" }])}>+ Текст</button>
        <button onClick={onAddMedia} title="Взять файл с диска через проводник">+ С диска…</button>
        <button onClick={onLibrary} title="Взять из того, что уже скачано для этого пака: папка source рядом с паком">📚 Библиотека…</button>
        <button onClick={onSearch} title="Найти картинку, звук или видео в интернете и скачать в пак">🌐 В интернете…</button>
        <button onClick={onCollage}>+ Коллаж…</button>
      </div>
    </div>
  );
}

function getItems(q: Question, name: string): ContentItem[] {
  return paramItems(findParam(q, name));
}

function setItems(q: Question, name: string, items: ContentItem[]) {
  q.params ??= [];
  let p: Param | undefined = q.params.find((x) => x.name === name);
  if (!p) {
    if (!items.length) return;
    p = { name, type: "content", children: [] };
    q.params.push(p);
  }
  const others = p.children.filter((c) => c.kind !== "item");
  p.children = [...items.map((item) => ({ kind: "item" as const, item })), ...others];
  if (!p.children.length && name !== "question") q.params = q.params.filter((x) => x !== p);
}

function mediaItems(added: MediaInfo[]): ContentItem[] {
  return added.map((m) => ({ type: mediaKindByName(m.name) ?? "image", isRef: "True", value: m.name }));
}

export function QuestionEditor({ pack, selection, mutate, addMedia, onPriceCommit, onMoveTo }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [editing, setEditing] = useState<{ media: MediaInfo; replace: (created: MediaInfo) => void; inQuestion?: boolean } | null>(null);
  const [pixelTheme, setPixelTheme] = useState(false);
  const [collageFor, setCollageFor] = useState<"question" | "answer" | null>(null);
  const [searchFor, setSearchFor] = useState<"question" | "answer" | null>(null);
  const [libraryFor, setLibraryFor] = useState<"question" | "answer" | null>(null);
  const [playing, setPlaying] = useState(false);
  if (!selection) {
    return (
      <aside className="editor placeholder">
        <p>Выберите вопрос на табло.</p>
        <p className="hint">Медиа можно перетаскивать прямо в редактор вопроса.</p>
      </aside>
    );
  }
  const round = pack.pkg.rounds?.[selection.round];
  const theme = round?.themes?.[selection.theme];
  const q = theme?.questions?.[selection.question];
  if (!round || !theme || !q) return <aside className="editor placeholder"><p>Вопрос не найден.</p></aside>;

  const edit = (fn: (q: Question) => void) =>
    mutate((p) => fn(p.rounds![selection.round].themes![selection.theme].questions![selection.question]));

  const addTo = async (param: string, paths?: string[]) => {
    const added = await addMedia(paths);
    if (added.length) edit((qq) => setItems(qq, param, appendMedia(getItems(qq, param), mediaItems(added))));
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean);
    if (paths.length) await addTo("question", paths);
  };

  const options = getOptions(q);
  const finalRound = round.type === "final";
  // время показа по умолчанию мастерской — кому достанется при сохранении (в финале не ставим)
  const qTimedIndex = finalRound ? -1 : defaultTimedIndex(getItems(q, "question"));
  const qTimed = qTimedIndex >= 0 ? { index: qTimedIndex, sec: questionDefaultSec(q) } : undefined;
  const point = isPointQuestion(q);
  // у точки первый правильный ответ — координаты, их правит разметка; ниже — ответы словами для ведущего
  const firstAnswer = point ? 1 : 0;

  return (
    <aside
      className={`editor${dragOver ? " drag" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="crumbs">{round.name} › {theme.name}</div>
      <div className="row">
        <label>
          Цена
          <input
            type="number"
            value={q.price}
            step={100}
            title="Любая цена. Клетка встанет на место по цене, когда закончите ввод (Enter или щелчок мимо)"
            onChange={(e) => edit((qq) => { qq.price = e.target.value; })}
            onBlur={() => onPriceCommit?.()}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          />
        </label>
        <label className="grow">
          Тип
          <select value={q.type ?? ""} onChange={(e) => edit((qq) => setQuestionType(qq, e.target.value))}>
            <option value="">Обычный</option>
            {Object.entries(SPECIAL_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      {onMoveTo && (
        <label>
          Перенести в другую тему
          {/* значение «раунд:тема»; вопрос встаёт в конец темы и берёт её следующую цену */}
          <select value="" onChange={(e) => {
            const [r, t] = e.target.value.split(":").map(Number);
            if (Number.isInteger(r) && Number.isInteger(t)) onMoveTo(r, t);
          }}>
            <option value="">— выберите тему —</option>
            {(pack.pkg.rounds ?? []).map((r, ri) => (
              <optgroup key={ri} label={r.name || `Раунд ${ri + 1}`}>
                {(r.themes ?? []).map((t, ti) => !(ri === selection.round && ti === selection.theme) && (
                  <option key={ti} value={`${ri}:${ti}`}>{t.name || "без названия"}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}

      <div className="question-head">
        <h3>Вопрос</h3>
        <button className="small" onClick={() => setPlaying(true)} title="Проиграть вопрос так, как его покажет SIGame: экраны, время, кнопка, ответ">▶ Как в игре</button>
      </div>
      <ContentList
        items={getItems(q, "question")}
        timed={qTimed}
        media={pack.media}
        onChange={(items) => edit((qq) => setItems(qq, "question", items))}
        onAddMedia={() => addTo("question")}
        onEdit={(m, replace) => setEditing({ media: m, replace, inQuestion: true })}
        onCollage={() => setCollageFor("question")}
        onSearch={() => setSearchFor("question")}
        onLibrary={() => setLibraryFor("question")}
      />
      <div className="row answer-time">
        <SecondsField value={answerDuration(q)} placeholder={String(finalRound ? 5 : TIME_DEFAULTS.button)}
          title={finalRound
            ? "Сколько секунд ждать ответа. Пусто — по настройкам игры"
            : `Сколько секунд ждать нажатия кнопки (сжимается рамка). Пусто — ${TIME_DEFAULTS.button} с: умолчание мастерской, запишется при сохранении пака`}
          onCommit={(sec) => edit((qq) => setAnswerDuration(qq, sec))} />
        <span className="hint">время на кнопку после вопроса</span>
      </div>

      {q.type && SECRET_TYPES.has(q.type) && (
        <div className="special-box">
          <h3>Кот в мешке</h3>
          <label>
            Тема, которую увидит получатель
            <input value={findParam(q, "theme")?.text ?? ""} placeholder="можно оставить пустым" onChange={(e) => edit((qq) => setParamText(qq, "theme", e.target.value))} />
          </label>
          <div className="row">
            <label className="grow">
              Кому можно отдать
              <select value={findParam(q, "selectionMode")?.text ?? "exceptCurrent"} onChange={(e) => edit((qq) => setParamText(qq, "selectionMode", e.target.value))}>
                <option value="exceptCurrent">любому, кроме себя</option>
                <option value="any">любому, включая себя</option>
              </select>
            </label>
            <label title="0 и 0 — как в большинстве паков SIQuester">
              Цена от
              <input type="number" value={secretPrice(q).minimum} onChange={(e) => edit((qq) => setSecretPrice(qq, e.target.value, secretPrice(qq).maximum))} />
            </label>
            <label title="0 и 0 — как в большинстве паков SIQuester">
              до
              <input type="number" value={secretPrice(q).maximum} onChange={(e) => edit((qq) => setSecretPrice(qq, secretPrice(qq).minimum, e.target.value))} />
            </label>
          </div>
        </div>
      )}

      <label className="check">
        <input type="checkbox" checked={options.length > 0} onChange={(e) => edit((qq) => { setOptions(qq, e.target.checked ? ["", ""] : []); if (e.target.checked) qq.right = ["A"]; })} />
        Вопрос с вариантами ответа
      </label>
      {options.length > 0 && (
        <div className="options-edit">
          {options.map((o, i) => (
            <div className="option" key={o.letter}>
              <input type="radio" name="right-option" checked={q.right[0] === o.letter} onChange={() => edit((qq) => { qq.right = [o.letter]; })} title="Правильный вариант" />
              <b>{o.letter}</b>
              <input value={o.text} onChange={(e) => edit((qq) => setOptions(qq, getOptions(qq).map((x, j) => (j === i ? e.target.value : x.text))))} placeholder={`Вариант ${o.letter}`} />
              {options.length > 2 && (
                <button className="icon" onClick={() => edit((qq) => { const rest = getOptions(qq).filter((_, j) => j !== i).map((x) => x.text); setOptions(qq, rest); if (!OPTION_LETTERS.slice(0, rest.length).includes(qq.right[0])) qq.right = ["A"]; })}>×</button>
              )}
            </div>
          ))}
          {options.length < OPTION_LETTERS.length && (
            <button className="small" onClick={() => edit((qq) => setOptions(qq, [...getOptions(qq).map((x) => x.text), ""]))}>+ вариант</button>
          )}
          <p className="hint">Кружок слева отмечает правильный вариант — в пак он записывается буквой, как у SIQuester.</p>
        </div>
      )}

      <label className="check" title="Игрок щёлкает по картинке, SIGame сама засчитывает попадание в круг">
        <input type="checkbox" checked={point} onChange={(e) => edit((qq) => setPointMode(qq, e.target.checked))} />
        Ответ точкой на картинке («Найдите…»)
      </label>
      {point && <PointEditor q={q} media={pack.media} edit={edit} />}

      <h3>{point ? "Ответ словами — для ведущего" : "Правильный ответ"}</h3>
      {q.right.map((a, i) => i >= firstAnswer && (
        <div className="answer" key={i}>
          <input value={a} onChange={(e) => edit((qq) => { qq.right[i] = e.target.value; })} placeholder={point ? "например: Шрек у лампы" : "Ответ"} />
          {q.right.length > firstAnswer + 1 && <button className="icon" onClick={() => edit((qq) => { qq.right.splice(i, 1); })}>×</button>}
        </div>
      ))}
      <button className="small" onClick={() => edit((qq) => { qq.right.push(""); })}>{point ? "+ ответ словами" : "+ ещё вариант ответа"}</button>

      <details open={(q.wrong?.length ?? 0) > 0}>
        <summary>Неправильные ответы</summary>
        {(q.wrong ?? []).map((a, i) => (
          <div className="answer" key={i}>
            <input value={a} onChange={(e) => edit((qq) => { qq.wrong![i] = e.target.value; })} />
            <button className="icon" onClick={() => edit((qq) => { qq.wrong!.splice(i, 1); if (!qq.wrong!.length) qq.wrong = undefined; })}>×</button>
          </div>
        ))}
        <button className="small" onClick={() => edit((qq) => { (qq.wrong ??= []).push(""); })}>+ неправильный ответ</button>
      </details>

      <details open={getItems(q, "answer").length > 0}>
        <summary>Медиа в ответе</summary>
        <ContentList
          items={getItems(q, "answer")}
          inAnswer
          media={pack.media}
          onChange={(items) => edit((qq) => setItems(qq, "answer", items))}
          onAddMedia={() => addTo("answer")}
          onEdit={(m, replace) => setEditing({ media: m, replace })}
          onCollage={() => setCollageFor("answer")}
          onSearch={() => setSearchFor("answer")}
          onLibrary={() => setLibraryFor("answer")}
        />
      </details>

      <details open={!!q.info?.comments || !!q.info?.showmanComments}>
        <summary>Комментарии</summary>
        <label>
          Комментарий к вопросу
          <textarea value={q.info?.comments ?? ""} rows={2} onChange={(e) => edit((qq) => { (qq.info ??= {}).comments = e.target.value || undefined; })} />
        </label>
        <label>
          Подсказка ведущему
          <textarea value={q.info?.showmanComments ?? ""} rows={2} onChange={(e) => edit((qq) => { (qq.info ??= {}).showmanComments = e.target.value || undefined; })} />
        </label>
      </details>
      {playing && <GamePreview question={q} timeDefaults={!finalRound} theme={theme.name} price={q.price} media={pack.media} onClose={() => setPlaying(false)} />}
      {dragOver && <div className="drop-hint">Отпустите, чтобы добавить в вопрос</div>}
      {editing && (editing.media.folder === "Images" ? (
        <ImageEditor media={editing.media} onClose={() => setEditing(null)} onDone={(created) => { editing.replace(created); setEditing(null); }}
          onThemeByPrice={editing.inQuestion ? () => { setEditing(null); setPixelTheme(true); } : undefined}
          onReveal={editing.inQuestion ? (created, pause) => {
            const name = editing.media.name;
            setEditing(null);
            // проявление: картинки по очереди, каждая стоит pause секунд; оригинал — в ответ или в source/
            void replaceImages(pack, mutate, [{
              round: selection.round, theme: selection.theme, question: selection.question, name,
              items: created.map((c) => withDuration({ type: "image", isRef: "True", value: c.name }, pause)),
            }], "оригинал до проявления");
          } : undefined} />
      ) : (
        <MediaEditor media={editing.media} onClose={() => setEditing(null)} onDone={(created) => { editing.replace(created); setEditing(null); }} />
      ))}
      {pixelTheme && <PixelTheme pack={pack} round={selection.round} theme={selection.theme} mutate={mutate} onClose={() => setPixelTheme(false)} />}
      {searchFor && (
        <MediaCenter
          target={searchFor}
          onClose={() => setSearchFor(null)}
          onAdded={(created) => {
            const param = searchFor;
            edit((qq) => setItems(qq, param, appendMedia(getItems(qq, param), mediaItems([created]))));
          }}
        />
      )}
      {libraryFor && (
        <MediaLibrary
          target={libraryFor}
          onClose={() => setLibraryFor(null)}
          onAdded={(created) => {
            const param = libraryFor;
            edit((qq) => setItems(qq, param, appendMedia(getItems(qq, param), mediaItems([created]))));
          }}
        />
      )}
      {collageFor && (
        <CollageEditor
          media={pack.media}
          addMedia={addMedia}
          onClose={() => setCollageFor(null)}
          onDone={(created) => {
            const param = collageFor;
            edit((qq) => setItems(qq, param, appendMedia(getItems(qq, param), mediaItems([created]))));
            setCollageFor(null);
          }}
        />
      )}
    </aside>
  );
}

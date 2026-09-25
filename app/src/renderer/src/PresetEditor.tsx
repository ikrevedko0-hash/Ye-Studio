// Редактор пресета картинок: всё, из чего складывается сцена и рисунок, — в одном окне.
// Инструкцию автор пишет своими словами, а примеры, словарь уточнений и общие правила
// приложение собирает само; итоговый текст целиком виден внизу, ничего не прячем.

import { useState } from "react";
import { assembleSystem, templateToModel, type ImagePreset, type PresetExample, type PresetWord } from "../../core/ai/presetText";
import type { ImageStyleInfo } from "../../shared/api";
import { Icon } from "./Icon";

interface Props {
  preset: ImagePreset;
  /** Такого id ещё нет в колонке — пресет новый: нечего удалять. */
  isNew: boolean;
  styles: ImageStyleInfo[];
  sizes: { id: string; title: string }[];
  onSave(p: ImagePreset): void;
  onCancel(): void;
  /** Свой — удалить, встроенный изменённый — вернуть исходный. */
  onDelete(p: ImagePreset): void;
}

export function PresetEditor({ preset, isNew, styles, sizes, onSave, onCancel, onDelete }: Props) {
  const [p, setP] = useState<ImagePreset>(preset);
  const [sure, setSure] = useState(false);
  const set = <K extends keyof ImagePreset>(k: K, v: ImagePreset[K]) => setP((x) => ({ ...x, [k]: v }));

  const setRow = <T,>(k: "examples" | "glossary", i: number, patch: Partial<T>) =>
    setP((x) => ({ ...x, [k]: (x[k] as T[]).map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const dropRow = (k: "examples" | "glossary", i: number) =>
    setP((x) => ({ ...x, [k]: (x[k] as unknown[]).filter((_, j) => j !== i) }));

  const problem = !p.title.trim() ? "Дайте пресету название." : p.mode === "model" && !p.system.trim() ? "Напишите инструкцию для модели." : "";
  const canDelete = !isNew && (!p.builtin || p.edited);

  return (
    <div className="ws-main pe">
      <div className="pe-head">
        <b>{isNew ? "Новый пресет" : p.builtin ? "Встроенный пресет" : "Свой пресет"}</b>
        {p.builtin && <span className="muted">правки хранятся поверх исходного, «Вернуть исходный» их уберёт</span>}
      </div>

      <div className="pe-row">
        <label className="pe-grow">Название<input value={p.title} onChange={(e) => set("title", e.target.value)} /></label>
        <label className="pe-grow">Подпись в колонке<input value={p.about} onChange={(e) => set("about", e.target.value)} /></label>
        <label>Пример фразы<input value={p.example} onChange={(e) => set("example", e.target.value)} /></label>
      </div>

      <fieldset className="pe-box">
        <legend>Как получается сцена</legend>
        <label className="check inline"><input type="radio" checked={p.mode === "template"} onChange={() => set("mode", "template")} />Шаблон — мой текст, фраза подставляется вместо {"{фраза}"}, модель не нужна</label>
        <label className="check inline"><input type="radio" checked={p.mode === "model"} onChange={() => set("mode", "model")} />Текстовая модель пишет сцену по инструкции</label>

        {p.mode === "template" ? (
          <>
            <textarea
              rows={4} spellCheck={false} value={p.template}
              placeholder="a fat {фраза} sitting on a golden throne made of fish — пусто: сцену пишете каждый раз сами"
              onChange={(e) => set("template", e.target.value)}
            />
            <div className="pe-bar">
              <span className="muted">{p.template.includes("{фраза}") || !p.template.trim() ? "" : "В шаблоне нет {фраза} — каждая картинка будет по одному и тому же тексту."}</span>
              <span className="spacer" />
              <button className="small" onClick={() => setP(templateToModel(p))} title="Шаблон станет образцом: модель будет писать похожие сцены под любую фразу">Сделать инструкцией</button>
            </div>
          </>
        ) : (
          <>
            <span className="pe-sub">Инструкция своими словами (лучше по-английски)</span>
            <textarea rows={7} spellCheck={false} value={p.system} onChange={(e) => set("system", e.target.value)} />

            <span className="pe-sub">Примеры «фраза → сцена» <span className="muted">— по ним модель понимает, чего от неё хотят</span></span>
            {p.examples.map((r, i) => (
              <div className="pe-pair" key={i}>
                <input value={r.phrase} placeholder="фраза" onChange={(e) => setRow<PresetExample>("examples", i, { phrase: e.target.value })} />
                <span className="muted">→</span>
                <input className="pe-grow" value={r.scene} placeholder="сцена по-английски" onChange={(e) => setRow<PresetExample>("examples", i, { scene: e.target.value })} />
                <button className="small" onClick={() => dropRow("examples", i)} title="Убрать пример">×</button>
              </div>
            ))}
            <button className="small pe-add" onClick={() => set("examples", [...p.examples, { phrase: "", scene: "" }])}><Icon name="plus" size={12} />пример</button>

            <span className="pe-sub">Словарь уточнений <span className="muted">— слова, которые модель переводит неточно («бензопила» → «saw», и рисуется ножовка)</span></span>
            {p.glossary.map((r, i) => (
              <div className="pe-pair" key={i}>
                <input value={r.word} placeholder="слово" onChange={(e) => setRow<PresetWord>("glossary", i, { word: e.target.value })} />
                <span className="muted">=</span>
                <input className="pe-grow" value={r.en} placeholder="точно по-английски, с приметой" onChange={(e) => setRow<PresetWord>("glossary", i, { en: e.target.value })} />
                <button className="small" onClick={() => dropRow("glossary", i)} title="Убрать слово">×</button>
              </div>
            ))}
            <button className="small pe-add" onClick={() => set("glossary", [...p.glossary, { word: "", en: "" }])}><Icon name="plus" size={12} />слово</button>

            <div className="pe-row pe-temp">
              <label className="check inline">
                <input type="checkbox" checked={p.temperature !== undefined} onChange={(e) => set("temperature", e.target.checked ? 1 : undefined)} />
                Своя «Фантазия»
              </label>
              {p.temperature !== undefined ? (
                <>
                  <input type="range" min={0} max={1.5} step={0.05} value={p.temperature} onChange={(e) => set("temperature", Number(e.target.value))} />
                  <b>{p.temperature.toFixed(2)}</b>
                </>
              ) : <span className="muted">— как выставлено в окне последний раз</span>}
            </div>

            <details className="pe-final">
              <summary>Итоговая инструкция, как её получит модель</summary>
              <pre>{assembleSystem(p)}</pre>
            </details>
          </>
        )}
        <span className="pe-sub">Подсказки при наборе фразы</span>
        <label className="check inline">
          <input type="checkbox" checked={p.suggest === "works"} onChange={(e) => set("suggest", e.target.checked ? "works" : "none")} />
          Фраза — название фильма или книги: подсказывать из Wikidata при наборе
        </label>
        <label className="check inline">
          <input type="checkbox" checked={p.suggest === "phrases"} onChange={(e) => set("suggest", e.target.checked ? "phrases" : "none")} />
          Кнопка «Словарь» поговорок рядом с фразой
        </label>
      </fieldset>

      <fieldset className="pe-box">
        <legend>Стиль и картинка</legend>
        <label className="check inline"><input type="radio" checked={p.styleMode === "picks"} onChange={() => set("styleMode", "picks")} />Галочки стилей</label>
        <label className="check inline"><input type="radio" checked={p.styleMode === "own"} onChange={() => set("styleMode", "own")} />Свой стиль текстом</label>
        <label className="check inline"><input type="radio" checked={p.styleMode === "none"} onChange={() => set("styleMode", "none")} />Без стиля — только сцена</label>
        {p.styleMode === "picks" && (
          <div className="ig-styles">
            <span className="ig-styles-head">
              Начальные галочки
              <span className="muted">{p.styles.length ? " — в окне их можно менять каждый раз" : " — не отмечено: останутся последние отмеченные в окне"}</span>
            </span>
            {styles.map((st) => (
              <label key={st.id} className={`ig-style${p.styles.includes(st.id) ? " sel" : ""}`} title={st.about}>
                <input
                  type="checkbox" checked={p.styles.includes(st.id)}
                  onChange={() => set("styles", p.styles.includes(st.id) ? p.styles.filter((x) => x !== st.id) : [...p.styles, st.id])}
                />
                {st.title}
              </label>
            ))}
          </div>
        )}
        {p.styleMode === "own" && (
          <textarea rows={2} spellCheck={false} value={p.styleText} placeholder="Style: soviet cartoon, soft pastel colours, hand-drawn outlines…" onChange={(e) => set("styleText", e.target.value)} />
        )}
        <div className="pe-row">
          <label>
            Размер
            <select value={p.size ?? ""} onChange={(e) => set("size", e.target.value || undefined)}>
              <option value="">как выбран в окне</option>
              {sizes.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </label>
          <label className="check inline pe-notext">
            <input type="checkbox" checked={p.noText} onChange={(e) => set("noText", e.target.checked)} />
            Дописывать «No text, no letters…» — без него модель рисует подписи и выдаёт ответ
          </label>
        </div>
      </fieldset>

      <div className="pe-bar">
        {problem && <span className="pe-problem">{problem}</span>}
        {canDelete && (
          sure
            ? <button className="danger" onClick={() => onDelete(p)}>{p.builtin ? "Да, вернуть исходный" : "Да, удалить"}</button>
            : <button onClick={() => setSure(true)}>{p.builtin ? "Вернуть исходный" : "Удалить пресет"}</button>
        )}
        <span className="spacer" />
        <button onClick={onCancel}>Отмена</button>
        <button className="primary" disabled={!!problem} onClick={() => onSave({ ...p, title: p.title.trim() })}><Icon name="save" />Сохранить</button>
      </div>
    </div>
  );
}

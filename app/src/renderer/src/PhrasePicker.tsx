// Словарь выражений во вкладке «Картинки»: выбрать фразу вместо того, чтобы вспоминать и печатать.
//
// Весь словарь (~5 тыс. строк) приходит в окно один раз и фильтруется здесь же: так поиск
// откликается на каждую букву без походов в главный процесс.

import { useEffect, useMemo, useState } from "react";
import type { PhraseDictionary } from "../../shared/api";

interface Props {
  onPick(text: string): void;
  /** Фразы, уже вставленные в вопросы: помечаем, чтобы не повторяться. */
  used: Set<string>;
}

const LIMIT = 300;

export function PhrasePicker({ onPick, used }: Props) {
  const [dict, setDict] = useState<PhraseDictionary | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [styles, setStyles] = useState<string[]>([]);
  const [topic, setTopic] = useState("");
  const [hideUsed, setHideUsed] = useState(true);
  const [maxWords, setMaxWords] = useState(0);

  useEffect(() => { void window.api.phrases().then(setDict); }, []);

  const found = useMemo(() => {
    if (!dict) return [];
    const q = query.trim().toLowerCase().replace(/ё/g, "е");
    return dict.set.phrases.filter((p) =>
      (!kind || p.kinds.includes(kind)) &&
      (!styles.length || styles.some((s) => p.styles.includes(s))) &&
      (!topic || p.topics.includes(topic)) &&
      (!hideUsed || !used.has(p.text)) &&
      (!maxWords || p.text.split(/[\s—-]+/).filter(Boolean).length <= maxWords) &&
      (!q || p.text.toLowerCase().replace(/ё/g, "е").includes(q)));
  }, [dict, query, kind, styles, topic, hideUsed, maxWords, used]);

  if (!dict) return <div className="pp muted">Загружаю словарь…</div>;
  if (!dict.set.phrases.length) return <div className="pp muted">Словарь не скачан: в папке app выполните npm run fetch-phrases.</div>;

  const styleTitle = (id: string) => dict.styles.find((s) => s.id === id)?.title ?? id;
  const random = () => {
    if (found.length) onPick(found[Math.floor(Math.random() * found.length)].text);
  };

  return (
    <div className="pp">
      <div className="pp-filters">
        <input className="pp-search" value={query} placeholder="поиск по словам: кот, рак, вода…" onChange={(e) => setQuery(e.target.value)} />
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">все виды</option>
          {dict.kinds.map((k) => <option key={k.id} value={k.id}>{k.title}</option>)}
        </select>
        <select value={topic} onChange={(e) => setTopic(e.target.value)}>
          <option value="">все темы</option>
          {[...dict.set.topics].sort((a, b) => a.localeCompare(b, "ru")).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={maxWords} onChange={(e) => setMaxWords(Number(e.target.value))} title="Короткие фразы проще нарисовать и угадать">
          <option value={0}>любая длина</option>
          <option value={2}>до 2 слов</option>
          <option value={3}>до 3 слов</option>
          <option value={5}>до 5 слов</option>
        </select>
        <button className="small primary" onClick={random} disabled={!found.length} title="Случайная фраза из того, что осталось после фильтров">🎲 Случайная</button>
      </div>
      <div className="pp-styles">
        {dict.styles.map((s) => (
          <button
            key={s.id}
            className={`pp-chip${styles.includes(s.id) ? " sel" : ""}`}
            onClick={() => setStyles(styles.includes(s.id) ? styles.filter((x) => x !== s.id) : [...styles, s.id])}
          >
            {s.title}
          </button>
        ))}
        <label className="pp-used"><input type="checkbox" checked={hideUsed} onChange={(e) => setHideUsed(e.target.checked)} /> скрыть уже вставленные</label>
        <span className="spacer" />
        <span className="muted">{found.length > LIMIT ? `${found.length}, показаны первые ${LIMIT}` : found.length}</span>
      </div>
      <div className="pp-list">
        {found.slice(0, LIMIT).map((p) => (
          <button key={p.text} className={`pp-item${used.has(p.text) ? " used" : ""}`} onClick={() => onPick(p.text)} title={[...p.styles.map(styleTitle), ...p.topics].join(" · ")}>
            {used.has(p.text) && "✓ "}{p.text}
            {p.styles.length > 0 && <span className="muted"> · {p.styles.map(styleTitle).join(", ")}</span>}
          </button>
        ))}
        {!found.length && <span className="muted">Ничего не нашлось — ослабьте фильтры.</span>}
      </div>
    </div>
  );
}

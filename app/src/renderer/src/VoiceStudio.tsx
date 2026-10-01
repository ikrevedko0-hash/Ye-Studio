// Студия → «Голос»: фраза → перевод (латынь, английский, «свой вариант»…) → озвучка → в вопрос.
// Перевод — облако из «Ключей и моделей» (Gemini, Groq), без разрешения — локально; озвучка — Qwen3-TTS на видеокарте
// или Piper на процессоре, оба ставятся из «Компонентов». Куда что ляжет в вопросе — core/tts/placement.ts.

import { useEffect, useRef, useState } from "react";
import type { MediaInfo } from "../../shared/api";
import type { Engine, VoiceState } from "../../core/tts/types";
import { TARGETS, TTS_LANGS, piperVoiceForLang, targetById } from "../../core/tts/languages";
import type { PlacementOptions } from "../../core/tts/placement";
import { Icon } from "./Icon";
import { PhrasePicker } from "./PhrasePicker";

interface Props {
  /** Озвучка (если есть) и тексты — в открытый вопрос по галочкам. Нет выбранного вопроса — нет кнопки. */
  onInsert?(media: MediaInfo | undefined, opts: PlacementOptions, data: { translated: string; original: string }): void;
  insertTarget?: string;
  /** Озвучка легла в пак без вопроса. */
  onAdded(media: MediaInfo): void;
  onOpenAi?(): void;
  onOpenComponents?(): void;
}

const PREFS_KEY = "voice-studio";
interface Prefs { target: string; custom: string; allowCloud: boolean; engine?: Engine; place: PlacementOptions }
const DEFAULT_PLACE: PlacementOptions = { soundInQuestion: true, textOnScreen: false, originalToAnswer: true, soundInAnswer: false };

function loadPrefs(): Prefs {
  const def: Prefs = { target: "la", custom: "", allowCloud: true, place: DEFAULT_PLACE };
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
    return { ...def, ...p, place: { ...DEFAULT_PLACE, ...p.place } };
  } catch { return def; }
}

/** Фразы, уже озвученные в вопросы: словарь помечает их, чтобы не повторяться. Свой список — не общий с «Картинками». */
const USED_KEY = "voiceStudio.usedPhrases";
function loadUsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(USED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

const plainError = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "");

const PLACE_LABELS: [keyof PlacementOptions, string, string][] = [
  ["soundInQuestion", "Звук в вопросе", "Озвучка играет в вопросе"],
  ["textOnScreen", "Перевод текстом на экране", "Переведённая фраза видна в вопросе вместе со звуком"],
  ["originalToAnswer", "Оригинал — правильный ответ", "Русская фраза встанет в правильные ответы"],
  ["soundInAnswer", "Звук и в ответе", "Озвучка ещё раз — в «Медиа в ответе»"],
];

export function VoiceStudio({ onInsert, insertTarget, onAdded, onOpenAi, onOpenComponents }: Props) {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [state, setState] = useState<VoiceState | null>(null);
  const [phrase, setPhrase] = useState("");
  const [variants, setVariants] = useState<string[]>([]);
  const [via, setVia] = useState("");
  const [text, setText] = useState("");
  const [ttsLang, setTtsLang] = useState(targetById(prefs.target).ttsLang);
  const [piperVoice, setPiperVoice] = useState("");
  const [speed, setSpeed] = useState(1);
  const [audio, setAudio] = useState<{ path: string; url: string; text: string; engine: Engine; lang: string } | null>(null);
  const [busy, setBusy] = useState<"" | "translate" | "speak" | "keep">("");
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [showDict, setShowDict] = useState(false);
  const [used, setUsed] = useState(loadUsed);
  const player = useRef<HTMLAudioElement>(null);

  const target = targetById(prefs.target);
  const save = (p: Partial<Prefs>) => setPrefs((prev) => {
    const next = { ...prev, ...p };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* не запомнится — не беда */ }
    return next;
  });

  const refresh = () => void window.api.voiceState().then(setState).catch(() => setState(null));
  useEffect(() => {
    refresh();
    // окно «Компоненты» могло поставить голос, пока студия открыта
    window.addEventListener("focus", refresh);
    return () => { window.removeEventListener("focus", refresh); void window.api.voiceCancel(); };
  }, []);
  useEffect(() => () => { if (audio) URL.revokeObjectURL(audio.url); }, [audio]);

  const engine: Engine | undefined = !state ? undefined
    : prefs.engine === "piper" && state.piper ? "piper"
    : prefs.engine === "gpu" && state.gpu ? "gpu"
    : state.gpu ? "gpu" : state.piper ? "piper" : undefined;
  const voices = state?.voices ?? [];
  const voiceId = piperVoice && voices.some((v) => v.id === piperVoice) ? piperVoice
    : voices.find((v) => v.id === (target.piperVoice ?? piperVoiceForLang(ttsLang)))?.id ?? voices[0]?.id ?? "";

  const pickTarget = (id: string) => {
    const t = targetById(id);
    save({ target: id });
    setTtsLang(t.ttsLang);
    setPiperVoice("");
    setVariants([]);
    setVia("");
    if (id === "none") setText(phrase.trim());
  };

  const translate = async () => {
    const src = phrase.trim();
    if (!src) return;
    if (target.id === "none") { setText(src); return; }
    setBusy("translate");
    setNote(null);
    try {
      const r = await window.api.voiceTranslate(src, target.id, prefs.custom, prefs.allowCloud);
      setVariants(r.variants);
      setVia(r.via);
      setText(r.variants[0] ?? "");
    } catch (e) {
      setNote({ text: plainError(e), bad: true });
    } finally { setBusy(""); }
  };

  const speak = async () => {
    const t = text.trim();
    if (!t || !engine) return;
    setBusy("speak");
    setNote(null);
    try {
      const r = await window.api.voiceSpeak({ text: t, engine, lang: ttsLang, piperVoice: engine === "piper" ? voiceId : undefined, speed });
      const url = URL.createObjectURL(new Blob([r.data as BlobPart], { type: r.mime }));
      setAudio({ path: r.path, url, text: t, engine, lang: ttsLang });
      setTimeout(() => void player.current?.play().catch(() => { /* автозапуск запрещён — есть кнопка */ }), 0);
    } catch (e) {
      setNote({ text: plainError(e), bad: true });
    } finally { setBusy(""); }
  };

  const needsSound = prefs.place.soundInQuestion || prefs.place.soundInAnswer;
  const stale = !!audio && audio.text !== text.trim();

  const keep = async (toQuestion: boolean) => {
    const translated = text.trim();
    if (!translated) return;
    setBusy("keep");
    setNote(null);
    try {
      let media: MediaInfo | undefined;
      if (audio && !stale && (!toQuestion || needsSound)) {
        media = await window.api.voiceKeep(audio.path, { text: audio.text, original: phrase.trim() || undefined, engine: audio.engine, lang: audio.lang });
      }
      if (toQuestion && onInsert) {
        onInsert(media, prefs.place, { translated, original: phrase.trim() });
        if (phrase.trim()) {
          const next = new Set(used).add(phrase.trim());
          setUsed(next);
          try { localStorage.setItem(USED_KEY, JSON.stringify([...next])); } catch { /* пометка не запомнится — не беда */ }
        }
        setNote({ text: `«${phrase.trim() || translated}» — в вопросе. Выбор перешёл к следующему — пишите новую фразу.` });
        setPhrase("");
        setText("");
        setVariants([]);
        setVia("");
        setAudio(null);
      } else if (media) {
        onAdded(media);
        setNote({ text: `Озвучка «${media.name}» — в паке (Audio).` });
      }
    } catch (e) {
      setNote({ text: plainError(e), bad: true });
    } finally { setBusy(""); }
  };

  const noVoice = state && !state.gpu && !state.piper;

  return (
    <div className="ws-body">
      <div className="ws-side">
        {TARGETS.map((t) => (
          <button key={t.id} className={`ws-gen${prefs.target === t.id ? " sel" : ""}`} onClick={() => pickTarget(t.id)}>
            <b>{t.title}</b>
            <span className="muted">
              {t.id === "la" ? "читает итальянский голос" : t.id === "custom" ? "«язык Йоды», «гопник», «канцелярит»…" : t.id === "none" ? "озвучить как есть" : ""}
            </span>
          </button>
        ))}
        <span className="spacer" />
        <div className="ig-quota">
          <label className="vs-check" title="Облачные модели из «Ключей и моделей» переводят заметно точнее своей видеокарты. Фраза уходит в сервис (Gemini, Groq…)">
            <input type="checkbox" checked={prefs.allowCloud} onChange={(e) => save({ allowCloud: e.target.checked })} />
            Можно облачные ИИ (точнее)
          </label>
          {state && (
            <div className="muted">
              Перевод: {prefs.allowCloud && state.translator.cloud.length ? state.translator.cloud.slice(0, 2).join(", ") : state.translator.local ? "локальный сервис" : state.translator.own ? `${state.translator.model} на видеокарте` : "не настроен"}
            </div>
          )}
          {onOpenAi && <button className="small" onClick={onOpenAi}><Icon name="gear" />Ключи и модели</button>}
        </div>
      </div>

      <div className="ws-main ig-main vs-main">
        {noVoice && (
          <div className="mc-errors">
            Голоса ещё не установлены. Поставьте «Голос на видеокарте» или Piper в разделе «Перевод и голос».
            {onOpenComponents && <button className="small" onClick={onOpenComponents}><Icon name="box" size={12} />Компоненты</button>}
          </div>
        )}

        <div className="ws-params">
          <label className="ig-phrase">
            <span>Фраза по-русски (она же ответ)</span>
            <input
              value={phrase}
              placeholder="например: Латынь — не хуй собачий"
              onChange={(e) => { setPhrase(e.target.value); if (target.id === "none") setText(e.target.value); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !busy) void translate(); }}
              autoFocus
            />
          </label>
          <button className={`ig-dict-toggle${showDict ? " sel" : ""}`} onClick={() => setShowDict(!showDict)} title="Выбрать фразу из словаря Викисловаря">
            <Icon name="library" />Словарь
          </button>
          {target.id !== "none" && (
            <button className="primary ws-run" onClick={() => void translate()} disabled={!!busy || !phrase.trim()}>
              {busy === "translate" ? "Перевожу…" : "Перевести"}
            </button>
          )}
        </div>

        {showDict && (
          <PhrasePicker
            used={used}
            onPick={(t) => {
              setPhrase(t);
              setVariants([]);
              setVia("");
              setText(target.id === "none" ? t : "");
            }}
          />
        )}

        {target.id === "custom" && (
          <label className="ig-phrase">
            <span>Как переписать</span>
            <input value={prefs.custom} placeholder="язык Йоды / как гопник / канцеляритом" onChange={(e) => save({ custom: e.target.value })} />
          </label>
        )}

        {variants.length > 0 && (
          <div className="vs-variants">
            <span className="muted">Варианты{via ? ` — ${via}` : ""}. Щёлкните, чтобы взять; поправить можно ниже.</span>
            {variants.map((v) => (
              <button key={v} className={`vs-variant${v === text ? " sel" : ""}`} onClick={() => setText(v)}>{v}</button>
            ))}
          </div>
        )}

        <label className="ig-prompt">
          <span>Текст для озвучки</span>
          <textarea value={text} rows={2} placeholder={target.id === "none" ? "Возьмётся из фразы" : "Появится после «Перевести» — можно поправить"} onChange={(e) => setText(e.target.value)} />
        </label>

        <div className="ws-params">
          <label className="narrow">
            Голос
            <select value={engine ?? ""} onChange={(e) => save({ engine: e.target.value as Engine })} disabled={!state || noVoice === true}>
              {state?.gpu && <option value="gpu">Видеокарта (Qwen3-TTS)</option>}
              {state?.piper && <option value="piper">Процессор (Piper)</option>}
              {!engine && <option value="">не установлен</option>}
            </select>
          </label>
          {engine === "gpu" && (
            <label className="narrow" title="Каким языком читать. У латыни своего нет — итальянский звучит ближе всего к церковной латыни">
              Читать как
              <select value={ttsLang} onChange={(e) => setTtsLang(e.target.value)}>
                {TTS_LANGS.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
              </select>
            </label>
          )}
          {engine === "piper" && (
            <>
              <label className="narrow">
                Голос Piper
                <select value={voiceId} onChange={(e) => setPiperVoice(e.target.value)}>
                  {voices.map((v) => <option key={v.id} value={v.id}>{v.title} · {v.lang}</option>)}
                </select>
              </label>
              <label className="narrow" title="Скорость речи Piper">
                Скорость
                <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                  {[0.8, 0.9, 1, 1.1, 1.25].map((s) => <option key={s} value={s}>{s}×</option>)}
                </select>
              </label>
            </>
          )}
          <button className="primary ws-run" onClick={() => void speak()} disabled={!!busy || !text.trim() || !engine}>
            <Icon name="audio" size={14} />{busy === "speak" ? "Озвучиваю…" : audio && !stale ? "Ещё раз" : "Озвучить"}
          </button>
        </div>

        {audio && (
          <div className="vs-player">
            <audio ref={player} src={audio.url} controls />
            {stale && <span className="muted">Текст поменялся — озвучьте заново, иначе в вопрос пойдёт только текст</span>}
          </div>
        )}

        <div className="vs-place">
          {PLACE_LABELS.map(([k, label, hint]) => (
            <label key={k} className="vs-check" title={hint}>
              <input type="checkbox" checked={prefs.place[k]} onChange={(e) => save({ place: { ...prefs.place, [k]: e.target.checked } })} />
              {label}
            </label>
          ))}
        </div>

        {note && <div className={`mc-note${note.bad ? " bad" : ""}`}>{note.text}</div>}

        <div className="ig-actions">
          <span className="spacer" />
          <button onClick={() => void keep(false)} disabled={!!busy || !audio || stale} title="Положить озвучку в Audio пака, в вопрос не вставлять">В пак</button>
          {onInsert && (
            <button
              className="primary"
              onClick={() => void keep(true)}
              disabled={!!busy || !text.trim() || (needsSound && (!audio || stale))}
              title={`По галочкам выше${insertTarget ? `: ${insertTarget}` : ""}. Выбор сам перейдёт к следующему вопросу темы`}
            >
              В вопрос{insertTarget ? ` (${insertTarget})` : ""}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

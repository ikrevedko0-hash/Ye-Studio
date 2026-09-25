import { useEffect, useMemo, useRef, useState } from "react";
import { answerItems, contentGroups, findParam, GAME_TIME, getOptions, isPointQuestion, isRef, itemGameTime, itemKind, pointAnswer, pointDeviation, pointHit, pointImage, POINT_DEVIATION, questionItems, withTimeDefaults } from "../../core/siq/helpers";
import { fractionIn, useFitBox } from "./fitBox";
import type { ContentItem, Question } from "../../core/siq/model";
import type { MediaInfo } from "../../shared/api";

// Проигрывание вопроса так, как его покажет SIGame: элементы, связанные «одновременно»
// (waitForFinish="False"), выходят одним экраном и раскладываются сверху вниз в порядке пака;
// время каждого экрана — по правилам движка (см. GAME_TIME в core/siq/helpers.ts).

const FOLDER: Record<string, string> = { image: "Images", audio: "Audio", video: "Video" };

type Step =
  | { kind: "screen"; part: "question" | "answer"; items: ContentItem[]; times: (number | undefined)[]; n: number; of: number }
  | { kind: "button"; seconds: number }
  | { kind: "end" };

function buildSteps(q: Question): Step[] {
  const steps: Step[] = [];
  const add = (part: "question" | "answer", items: ContentItem[]) => {
    const groups = contentGroups(items);
    groups.forEach((g, n) => steps.push({
      kind: "screen", part, n: n + 1, of: groups.length,
      items: g.map((i) => items[i]),
      times: g.map((i) => itemGameTime(items[i], i === items.length - 1, part === "answer")),
    }));
  };
  add("question", questionItems(q).filter((it) => it.value.trim() !== ""));
  const own = Number(findParam(q, "answerDuration")?.text);
  steps.push({ kind: "button", seconds: own > 0 ? own : GAME_TIME.button });
  const answer = answerItems(q).filter((it) => it.value.trim() !== "");
  // у точки первый ответ — координаты: без медиа в ответе игра показывает ту же картинку с точкой
  const point = isPointQuestion(q) ? pointImage(q) : undefined;
  const right = q.right.slice(point ? 1 : 0).filter((a) => a.trim()).join(" / ");
  // без медиа в ответе игра показывает текст правильного ответа
  // своё время картинки (часто 40 с на поиск) к ответу не относится: там картинка стоит обычные 5 с
  const pointShown: ContentItem | undefined = point && { type: point.type, isRef: point.isRef, value: point.value };
  add("answer", answer.length ? answer : pointShown ? [pointShown] : [{ value: right || "(ответ не заполнен)" }]);
  steps.push({ kind: "end" });
  return steps;
}

/** Сколько экран держится по известным временам: максимум по местам вывода из сумм. */
function knownTime(items: ContentItem[], times: (number | undefined)[]): number {
  const sums: Record<string, number> = {};
  items.forEach((it, i) => {
    const place = it.placement === "background" ? "background" : it.placement === "replic" ? "replic" : "screen";
    sums[place] = (sums[place] ?? 0) + (times[i] ?? 0);
  });
  return Math.max(0, ...Object.values(sums));
}

/**
 * Картинка вопроса-точки: щелчок — ответ игрока, попадание считается как в SIGame.
 * reveal — экран ответа: виден круг правильной зоны.
 */
function PointTarget({ src, question, shot, onShot, reveal }: {
  src: string;
  question: Question;
  shot: { x: number; y: number } | null;
  onShot(p: { x: number; y: number }): void;
  reveal: boolean;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const fit = useFitBox(frameRef, size?.w, size?.h);
  const right = pointAnswer(question);
  const dev = pointDeviation(question) || POINT_DEVIATION.def;
  const r = Math.max(POINT_DEVIATION.min, dev) * (typeof fit.height === "number" ? fit.height : 0);
  const hit = shot && right ? pointHit(right, dev, shot) : null;
  return (
    <div className="gp-point" ref={frameRef}>
      <div className="fit-box" ref={boxRef} style={fit} onClick={(e) => { if (!reveal) onShot(fractionIn(boxRef.current!, e)); }}>
        <img src={src} alt="" draggable={false} onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
        {reveal && right && <div className="point-zone" style={{ left: `${right.x * 100}%`, top: `${right.y * 100}%`, width: r * 2, height: r * 2 }} />}
        {shot && <div className={`point-dot ${hit ? "hit" : "miss"}`} style={{ left: `${shot.x * 100}%`, top: `${shot.y * 100}%` }} />}
      </div>
    </div>
  );
}

const fmt = (s: number) => s.toFixed(1).replace(".", ",") + " с";

/** Ряды экрана: текст — свой ряд, идущие подряд картинки/видео — общий ряд (как ContentGroup в SIGame). */
function screenRows(items: ContentItem[]) {
  const rows: { text?: ContentItem; media?: ContentItem[] }[] = [];
  for (const it of items) {
    if (it.placement === "background" || it.placement === "replic") continue;
    const kind = itemKind(it);
    if (kind === "text") rows.push({ text: it });
    else {
      const last = rows[rows.length - 1];
      if (last?.media) last.media.push(it);
      else rows.push({ media: [it] });
    }
  }
  return rows;
}

function textSize(len: number) {
  return len <= 30 ? 34 : len <= 80 ? 28 : len <= 180 ? 22 : 17;
}

export function GamePreview({ question, timeDefaults = false, theme, price, media, onClose }: {
  question: Question;
  /** показать с временем по умолчанию мастерской (оно запишется при сохранении) */
  timeDefaults?: boolean;
  theme: string;
  price: string;
  media: MediaInfo[];
  onClose(): void;
}) {
  // время по умолчанию мастерской: показываем так, как ляжет в пак после сохранения
  const steps = useMemo(() => buildSteps(timeDefaults ? withTimeDefaults(question) : question), [question, timeDefaults]);
  const [at, setAt] = useState(0);
  const [run, setRun] = useState(0); // «Сначала» перезапускает тот же шаг 0
  const [now, setNow] = useState(0);
  const started = useRef(0);
  const questionStart = useRef(0);
  const [questionTook, setQuestionTook] = useState<number | null>(null);
  const pending = useRef(new Set<number>());
  const step = steps[at];
  const pointImg = isPointQuestion(question) ? pointImage(question) : undefined;
  const [shot, setShot] = useState<{ x: number; y: number } | null>(null);
  const rightPoint = pointImg ? pointAnswer(question) : undefined;
  const hit = !!(shot && rightPoint && pointHit(rightPoint, pointDeviation(question), shot));

  const next = () => setAt((a) => Math.min(a + 1, steps.length - 1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === " " || e.key === "ArrowRight") { e.preventDefault(); next(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // таймер шага: экран уходит, когда вышло известное время и доиграли все звуки/видео без duration
  useEffect(() => {
    started.current = performance.now();
    if (at === 0) { questionStart.current = started.current; setQuestionTook(null); setShot(null); }
    if (step.kind === "button" && questionTook === null) setQuestionTook((started.current - questionStart.current) / 1000);
    pending.current = new Set(step.kind === "screen" ? step.times.flatMap((t, i) => (t === undefined ? [i] : [])) : []);
    const limit = step.kind === "screen" ? knownTime(step.items, step.times) : step.kind === "button" ? step.seconds : Infinity;
    const cap = step.kind === "screen" && pending.current.size ? GAME_TIME.mediaCap : 0;
    const timer = window.setInterval(() => {
      const el = (performance.now() - started.current) / 1000;
      setNow(el);
      if (step.kind === "end") return;
      if (el >= limit && (pending.current.size === 0 || el >= cap)) next();
    }, 100);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, run]);

  const mediaEnded = (i: number) => { pending.current.delete(i); };

  const url = (it: ContentItem) => {
    if (!isRef(it)) return it.value;
    return media.find((m) => m.folder === FOLDER[itemKind(it)] && m.name === it.value)?.url;
  };

  // последний экран вопроса стоит на табло, пока ждём кнопку
  const shown = step.kind === "screen" ? step : step.kind === "button"
    ? (steps.slice(0, at).reverse().find((s) => s.kind === "screen") as Extract<Step, { kind: "screen" }> | undefined)
    : undefined;
  const live = step.kind === "screen"; // звук/видео играют только на своём экране

  const renderMedia = (it: ContentItem, i: number) => {
    const src = url(it);
    const kind = itemKind(it);
    if (!src) return <div className="gp-missing" key={i}>нет файла «{it.value}»</div>;
    if (kind === "image" && pointImg && it.value === pointImg.value) {
      const reveal = shown?.part === "answer";
      return <PointTarget key={`pt-${reveal}`} src={src} question={question} shot={shot} reveal={reveal}
        onShot={(p) => { setShot(p); setAt(steps.findIndex((s) => s.kind === "screen" && s.part === "answer")); }} />;
    }
    if (kind === "image") return <img key={i} src={src} alt="" />;
    if (kind === "video") {
      return (
        <video key={`${at}-${run}-${i}`} src={src} autoPlay={live} muted={!live}
          onEnded={() => mediaEnded(i)} onError={() => mediaEnded(i)} />
      );
    }
    if (kind === "audio") {
      return (
        <div className="gp-note" key={i}>
          ♪
          {live && <audio key={`${at}-${run}-${i}`} src={src} autoPlay onEnded={() => mediaEnded(i)} onError={() => mediaEnded(i)} />}
        </div>
      );
    }
    return <div className="gp-missing" key={i}>HTML в предпросмотре не показывается</div>;
  };

  const indexOf = (it: ContentItem) => (shown ? shown.items.indexOf(it) : -1);
  const options = getOptions(question);
  const stepLabel = step.kind === "screen"
    ? `${step.part === "question" ? "Вопрос" : "Ответ"} · экран ${step.n} из ${step.of}`
    : step.kind === "button" ? "Жмите кнопку!" : "Конец";
  const stepLimit = step.kind === "screen" ? knownTime(step.items, step.times) : step.kind === "button" ? step.seconds : 0;
  const waitsMedia = step.kind === "screen" && step.times.some((t) => t === undefined);

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="game-preview">
        <header>
          <b>▶ Как в игре</b>
          <span className="muted">{theme} · {price}</span>
          <span className="spacer" />
          <button onClick={() => { setAt(0); setRun((r) => r + 1); }}>⟲ Сначала</button>
          <button onClick={next} disabled={step.kind === "end"} title="Пробел или →">⏭ Дальше</button>
          <button className="icon" onClick={onClose} title="Закрыть (Esc)">×</button>
        </header>
        <div className={`gp-screen${step.kind === "screen" && step.part === "answer" ? " answer" : ""}`}>
          {shown && screenRows(shown.items).map((row, r) => row.text ? (
            <div className="gp-text" key={r} style={{ flexGrow: Math.min(5, Math.max(1, row.text.value.length / 80)), fontSize: textSize(row.text.value.length) }}>
              {row.text.value}
            </div>
          ) : (
            <div className="gp-media" key={r}>{row.media!.map((it) => renderMedia(it, indexOf(it)))}</div>
          ))}
          {shown?.part === "question" && options.length > 0 && step.kind !== "end" && (
            <div className="gp-options">{options.map((o) => <div key={o.letter}><b>{o.letter}</b> {o.text}</div>)}</div>
          )}
          {live && shown?.items.map((it, i) => it.placement === "background" && url(it)
            ? <audio key={`${at}-${run}-bg${i}`} src={url(it)} autoPlay onEnded={() => mediaEnded(i)} onError={() => mediaEnded(i)} />
            : null)}
          {shown?.items.some((it) => it.placement === "background") && live && <div className="gp-bg">🔊 фоновый звук</div>}
          {shown?.items.filter((it) => it.placement === "replic").map((it, i) => <div className="gp-replic" key={i}>Ведущий: {it.value}</div>)}
          {step.kind === "button" && <div className="gp-button">{pointImg ? "Щёлкните по картинке!" : "Жмите кнопку!"} {fmt(Math.max(0, step.seconds - now))}</div>}
          {pointImg && shown?.part === "answer" && (
            <div className={`gp-verdict ${hit ? "hit" : "miss"}`}>{!shot ? "Никто не щёлкнул" : hit ? "✔ Попал" : "✘ Мимо"}</div>
          )}
          {step.kind === "end" && (
            <div className="gp-end">
              <div>Показ вопроса занял <b>{fmt(questionTook ?? 0)}</b></div>
              <div className="muted">по правилам SIGame по умолчанию: картинка {GAME_TIME.image} с, текст {GAME_TIME.readingSpeed} знаков/с (+{GAME_TIME.reflection} с, если за ним что-то идёт), звук и видео — до конца</div>
            </div>
          )}
        </div>
        <footer>
          <span>{stepLabel}</span>
          {step.kind !== "end" && <span className="muted">{fmt(now)}{stepLimit ? ` из ${fmt(stepLimit)}` : ""}{waitsMedia ? " · ждём конец звука/видео" : ""}</span>}
        </footer>
      </div>
    </div>
  );
}

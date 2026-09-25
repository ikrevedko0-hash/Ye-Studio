import { useEffect, useRef, useState } from "react";
import { fractionIn, useFitBox } from "./fitBox";
import { isRef, pointAnswer, pointDeviation, pointImage, pointProblems, POINT_DEVIATION, setPoint, setPointDeviation } from "../../core/siq/helpers";
import type { Question } from "../../core/siq/model";
import type { MediaInfo } from "../../shared/api";

/**
 * Разметка ответа точкой: щелчок по картинке ставит правильную точку, круг — зона, которую засчитает SIGame.
 * Радиус зоны — допуск в долях ВЫСОТЫ картинки, поэтому в пикселях это ровный круг при любых пропорциях.
 */
export function PointEditor({ q, media, edit }: { q: Question; media: MediaInfo[]; edit(fn: (q: Question) => void): void }) {
  const [big, setBig] = useState(false);
  const img = pointImage(q);
  const m = img && isRef(img) ? media.find((x) => x.folder === "Images" && x.name === img.value) : undefined;
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => setSize(null), [m?.url]);
  const ratio = size ? size.w / size.h : undefined;
  const problems = pointProblems(q, ratio);

  if (!img) return <p className="point-note">{problems[0]}. Добавьте картинку в конец вопроса.</p>;
  if (!m) return <p className="point-note">Картинка «{img.value}» — внешняя ссылка или её нет в паке: точку поставить не на чем.</p>;

  const dev = pointDeviation(q) || POINT_DEVIATION.def;
  const place = (p: { x: number; y: number }) => { if (ratio) edit((qq) => setPoint(qq, { ...p, ratio })); };
  const stage = (cls: string) => <PointStage url={m.url} q={q} size={size} onSize={setSize} onPlace={place} className={cls} />;

  return (
    <div className="point-edit">
      {stage("point-frame")}
      <div className="row point-tools">
        <label className="grow" title="Радиус круга в долях высоты картинки — так его меряет SIGame">
          Допуск {dev.toFixed(2).replace(".", ",")}
          <input type="range" min={0.03} max={POINT_DEVIATION.max} step={0.01} value={dev}
            onChange={(e) => edit((qq) => setPointDeviation(qq, Number(e.target.value)))} />
        </label>
        <button className="small" onClick={() => setBig(true)} title="Открыть картинку крупно, чтобы попасть точнее">⤢ Крупно</button>
      </div>
      {problems.map((p) => <p className="point-note" key={p}>⚠ {p}</p>)}
      {!problems.length && <p className="hint">Игрок щёлкнет по картинке — SIGame засчитает щелчок внутри круга.</p>}
      {big && (
        <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setBig(false); }}>
          <div className="point-big">
            <header>
              <b>Где правильный ответ?</b>
              <span className="muted">щёлкните по картинке · круг — зона попадания</span>
              <span className="spacer" />
              <button className="icon" onClick={() => setBig(false)} title="Закрыть">×</button>
            </header>
            {stage("point-frame big")}
          </div>
        </div>
      )}
    </div>
  );
}

function PointStage({ url, q, size, onSize, onPlace, className }: {
  url: string;
  q: Question;
  size: { w: number; h: number } | null;
  onSize(s: { w: number; h: number }): void;
  onPlace(p: { x: number; y: number }): void;
  className: string;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const fit = useFitBox(frameRef, size?.w, size?.h);
  const p = pointAnswer(q);
  const r = (pointDeviation(q) || POINT_DEVIATION.def) * (typeof fit.height === "number" ? fit.height : 0);
  return (
    <div className={`frame ${className}`} ref={frameRef}>
      <div className="fit-box" ref={boxRef} style={fit} onClick={(e) => onPlace(fractionIn(boxRef.current!, e))}>
        <img src={url} alt="" draggable={false} onLoad={(e) => onSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
        {p && (
          <>
            <div className="point-zone" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: r * 2, height: r * 2 }} />
            <div className="point-dot" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} />
          </>
        )}
      </div>
    </div>
  );
}

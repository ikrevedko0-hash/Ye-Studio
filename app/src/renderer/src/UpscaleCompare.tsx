// Сравнение до/после ИИ-увеличения: оригинал (растянутый браузером — как обычное увеличение)
// и результат Real-ESRGAN друг на друге, граница — ползунком. «1:1» — в настоящую величину,
// чтобы разглядеть мелкие артефакты модели. В пак ничего не пишется, пока не нажато «Сохранить в пак».

import { useState } from "react";

interface Props {
  before: string;
  after: string;
  afterBytes: number;
  factor: 2 | 4;
  busy: boolean;
  onKeep(): void;
  onDrop(): void;
}

export function UpscaleCompare({ before, after, afterBytes, factor, busy, onKeep, onDrop }: Props) {
  const [split, setSplit] = useState(50);
  const [real, setReal] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  // рамку задаёт результат: исходник маленький, и по нему окно сравнения было бы крошечным
  const box = !size ? { width: 0, height: 0 }
    : real ? { width: size.w, height: size.h }
    : { width: `min(100%, ${((70 * size.w) / size.h).toFixed(2)}vh)`, aspectRatio: `${size.w} / ${size.h}` };
  return (
    <div className="modal-back upscale-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onDrop(); }}>
      <div className="upscale-compare">
        <header>
          <b>ИИ-увеличение ×{factor}: сравните</b>
          <span className="muted">слева — просто растянуто, справа — нейросеть{size ? ` · ${size.w}×${size.h}, ${Math.round(afterBytes / 1024)} КБ` : ""}</span>
          <span className="spacer" />
          <label className="check inline"><input type="checkbox" checked={real} onChange={(e) => setReal(e.target.checked)} /> 1:1 (настоящий размер)</label>
        </header>
        <div className={`uc-view${real ? " real" : ""}`}>
          <div className="uc-stage" style={box}>
            <img src={before} alt="до" draggable={false} />
            <img src={after} alt="после" draggable={false} style={{ clipPath: `inset(0 0 0 ${split}%)` }}
                 onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
            <i className="uc-line" style={{ left: `${split}%` }} />
          </div>
        </div>
        <input className="uc-slider" type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))}
               aria-label="Граница до/после" />
        <footer>
          <span className="muted">Оригинал в паке не меняется; результат встанет рядом новым файлом.</span>
          <span className="spacer" />
          <button onClick={onDrop} disabled={busy}>Не сохранять</button>
          <button className="primary" onClick={onKeep} disabled={busy}>{busy ? "Сохраняю…" : "Сохранить в пак"}</button>
        </footer>
      </div>
    </div>
  );
}

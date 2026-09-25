import { useState } from "react";
import { buildVkPost } from "../../core/siq/publish";
import { getAttr } from "../../core/siq/model";
import type { PackDTO } from "../../shared/api";

interface Props {
  pack: PackDTO;
  onClose(): void;
}

/** Окно «📣 Публикация»: готовый текст для ВК и афиша пака — одна картинка со всеми темами. */
export function Publish({ pack, onClose }: Props) {
  const pkg = pack.pkg;
  const packName = getAttr(pkg, "name")?.trim() || "Без названия";

  const [text, setText] = useState(() => buildVkPost(pkg));
  const [drawing, setDrawing] = useState(false);
  const [posterPath, setPosterPath] = useState<string | null>(null);
  const [posterBroken, setPosterBroken] = useState(false);
  const [note, setNote] = useState("");

  const drawPoster = async () => {
    setDrawing(true);
    setNote("Рисую афишу…");
    setPosterBroken(false);
    try {
      const out = await window.api.publishPoster(pkg, pack.path, packName);
      setPosterPath(out);
      setNote(`Афиша готова: ${out}`);
    } catch (e) {
      setNote(`Не удалось нарисовать афишу: ${(e as Error).message}`);
    } finally {
      setDrawing(false);
    }
  };

  const copyText = async () => {
    await window.api.clipboardWrite(text);
    setNote("Текст скопирован в буфер");
  };

  const openFolder = async () => {
    const dir = await window.api.publishFolder(pack.path, packName);
    await window.api.openPath(dir);
  };

  const publishToVk = async () => {
    await window.api.clipboardWrite(text);
    await window.api.publishOpenVk();
    setNote("Текст скопирован. На странице ВК вставьте текст (Ctrl+V) и перетащите афишу из открытой папки");
  };

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !drawing) onClose(); }}>
      <div className="publish">
        <header>
          <b>📣 Публикация</b>
          <span className="spacer" />
          <button className="icon" onClick={onClose} disabled={drawing} title="Закрыть">×</button>
        </header>

        <label>
          Текст поста (можно править)
          <textarea className="publish-text" rows={16} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <p className="muted">Символов: {text.length}</p>

        <div className="buttons">
          <button onClick={copyText}>📋 Скопировать текст</button>
          <button onClick={() => void drawPoster()} disabled={drawing} title="Одна картинка со всеми раундами и темами пака">
            🖼 Картинка со всеми темами
          </button>
          {posterPath && <button onClick={openFolder}>Открыть папку</button>}
          <button className="primary" onClick={() => void publishToVk()} title="Скопирует текст и откроет страницу ВК">
            🚀 Опубликовать в ВК
          </button>
        </div>

        {posterPath && !posterBroken && (
          <img
            className="poster-preview"
            src={`file://${encodeURI(posterPath.replace(/\\/g, "/"))}`}
            alt="Афиша пака"
            onError={() => setPosterBroken(true)}
          />
        )}

        {note && <p className="muted">{note}</p>}
      </div>
    </div>
  );
}

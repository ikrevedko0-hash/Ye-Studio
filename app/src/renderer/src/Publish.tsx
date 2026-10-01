import { useState } from "react";
import { buildPackCard, buildVkPost } from "../../core/siq/publish";
import { getAttr } from "../../core/siq/model";
import type { PackDTO } from "../../shared/api";
import { Icon } from "./Icon";

interface Props {
  pack: PackDTO;
  onClose(): void;
}

/** Окно «📣 Публикация»: готовый текст для ВК и афиша пака — одна картинка со всеми темами. */
export function Publish({ pack, onClose }: Props) {
  const pkg = pack.pkg;
  const packName = getAttr(pkg, "name")?.trim() || "Без названия";

  // «Пост ВК» — анонс в своей группе; «Описание пака» — для FirePacks, темы ВК SIGame и Steam Workshop
  const [kind, setKind] = useState<"vk" | "card">("vk");
  const [humor, setHumor] = useState(false);
  const [steam, setSteam] = useState("");
  const [text, setText] = useState(() => buildVkPost(pkg));
  const show = (k: "vk" | "card", h = humor, s = steam) => {
    setKind(k);
    setText(k === "vk" ? buildVkPost(pkg) : buildPackCard(pkg, { humorWarning: h, steamUrl: s }));
  };
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

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !drawing) onClose(); }}>
      <div className="publish">
        <header>
          <b><Icon name="megaphone" />Публикация</b>
          <span className="spacer" />
          <button className="icon" onClick={onClose} disabled={drawing} title="Закрыть">×</button>
        </header>

        <div className="buttons">
          <button className={kind === "vk" ? "primary" : ""} onClick={() => show("vk")}>Пост ВК</button>
          <button className={kind === "card" ? "primary" : ""} onClick={() => show("card")} title="Описание в шаблоне топ-паков: сложность, время, число вопросов">
            Описание пака
          </button>
        </div>
        {kind === "card" && (
          <>
            <label className="check">
              <input type="checkbox" checked={humor} onChange={(e) => { setHumor(e.target.checked); show("card", e.target.checked); }} />
              Предупредить о чёрном и взрослом юморе
            </label>
            <label>
              Ссылка на пак в Steam Workshop (если выложили)
              <input value={steam} placeholder="https://steamcommunity.com/sharedfiles/filedetails/?id=…" onChange={(e) => { setSteam(e.target.value); show("card", humor, e.target.value); }} />
            </label>
            <p className="muted">Это описание — для FirePacks, темы паков в группе SIGame ВКонтакте и Steam Workshop: у топ-паков оно в таком же шаблоне. Сложность берётся из свойств пака.</p>
          </>
        )}
        <label>
          {kind === "vk" ? "Текст поста" : "Описание пака"} (можно править)
          <textarea className="publish-text" rows={16} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <p className="muted">Символов: {text.length}</p>

        <div className="buttons">
          <button className="primary" onClick={copyText}><Icon name="paste" />Скопировать текст</button>
          <button onClick={() => void drawPoster()} disabled={drawing} title="Одна картинка со всеми раундами и темами пака">
            <Icon name="image" />Картинка со всеми темами
          </button>
          {posterPath && <button onClick={openFolder}>Открыть папку</button>}
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

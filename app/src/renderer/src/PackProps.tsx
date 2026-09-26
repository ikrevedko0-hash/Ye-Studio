import { useState } from "react";
import { packLogo, setPackAttr, setPackLogo } from "../../core/siq/board";
import { clearAllComments, countComments } from "../../core/siq/helpers";
import { getAttr } from "../../core/siq/model";
import type { MediaInfo, PackDTO } from "../../shared/api";
import type { Mutate } from "./App";
import { LogoNumber } from "./LogoNumber";

interface Props {
  pack: PackDTO;
  mutate: Mutate;
  addMedia(paths?: string[]): Promise<MediaInfo[]>;
  onClose(): void;
}

const splitList = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

/** Свойства пака — то, что SIGame показывает на карточке пака: логотип, авторы, сложность, возраст… */
export function PackProps({ pack, mutate, addMedia, onClose }: Props) {
  const pkg = pack.pkg;
  const attr = (k: string) => getAttr(pkg, k) ?? "";
  const set = (k: string) => (v: string) => mutate((p) => setPackAttr(p, k, v));
  const images = pack.media.filter((m) => m.folder === "Images");
  const logo = packLogo(pkg);
  const logoMedia = logo ? images.find((m) => m.name === logo) : undefined;
  const [note, setNote] = useState("");
  const [numbering, setNumbering] = useState(false);

  // списки правим строкой: «Иванов, Петров» — иначе запятая посреди ввода съедалась бы
  const [authors, setAuthors] = useState((pkg.info?.authors ?? []).filter(Boolean).join(", "));
  const [tags, setTags] = useState((pkg.tags ?? []).join(", "));

  // поле теряет фокус и при закрытии окна — пишем только если список правда поменялся
  const same = (a: string[] | undefined, b: string[]) => (a ?? []).filter(Boolean).join("|") === b.join("|");
  const commitAuthors = (v: string) => !same(pkg.info?.authors, splitList(v)) && mutate((p) => {
    const list = splitList(v);
    // SIQuester пишет пустой список как <authors><author /></authors>
    (p.info ??= {}).authors = list.length ? list : [""];
  });
  const commitTags = (v: string) => !same(pkg.tags, splitList(v)) && mutate((p) => {
    const list = splitList(v);
    p.tags = list.length || p.tags ? list : undefined;
  });
  const setComments = (v: string) => mutate((p) => {
    if (v === "" && p.info?.comments === undefined) return;
    (p.info ??= {}).comments = v || undefined;
  });

  const commentsCount = countComments(pkg);
  const [commentsNote, setCommentsNote] = useState("");
  const clearComments = () => {
    if (!commentsCount) return;
    if (!window.confirm(`Удалить все комментарии в паке (${commentsCount} шт.)?`)) return;
    mutate((p) => clearAllComments(p));
    setCommentsNote(`Комментарии очищены: ${commentsCount} шт.`);
  };

  const uploadLogo = async () => {
    const added = await addMedia();
    const img = added.find((m) => m.folder === "Images");
    if (img) { mutate((p) => setPackLogo(p, img.name)); setNote(""); }
    else if (added.length) setNote("Логотипом может быть только картинка — файл добавлен в пак, но логотип не сменился");
  };

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pack-props">
        <header>
          <b>Свойства пака</b>
          <span className="spacer" />
          <button className="icon" onClick={onClose} title="Закрыть">×</button>
        </header>

        <div className="pp-logo">
          <div className="pp-logo-preview">
            {logoMedia ? <img src={logoMedia.url} alt={logo} /> : logo ? <span>нет файла<br />{logo}</span> : <span>без логотипа</span>}
          </div>
          <div className="pp-logo-side">
            <b>Логотип</b>
            <p className="muted">Картинка на карточке пака в SIGame. Лучше квадратная.</p>
            <div className="buttons">
              <button onClick={uploadLogo}>Загрузить файл…</button>
              {logoMedia && <button onClick={() => setNumbering(true)} title="Смешная цифра поверх логотипа — радуга-мозаика, огонь, неон, золото…">Номер на логотип…</button>}
              {logo && <button onClick={() => mutate((p) => setPackLogo(p, undefined))}>Убрать</button>}
            </div>
            {note && <p className="muted">{note}</p>}
            {images.length > 0 && (
              <>
                <p className="muted">или выберите из картинок пака:</p>
                <div className="pp-thumbs">
                  {images.map((m) => (
                    <button key={m.name} className={m.name === logo ? "active" : ""} title={m.name} onClick={() => mutate((p) => setPackLogo(p, m.name))}>
                      <img src={m.url} alt={m.name} loading="lazy" />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="pp-grid">
          <label className="wide">
            Название
            <input value={attr("name")} onChange={(e) => set("name")(e.target.value)} />
          </label>
          <label className="wide">
            Авторы (через запятую)
            <input value={authors} onChange={(e) => setAuthors(e.target.value)} onBlur={(e) => commitAuthors(e.target.value)} />
          </label>
          <label>
            Издатель
            <input value={attr("publisher")} onChange={(e) => set("publisher")(e.target.value)} />
          </label>
          <label>
            Контакты (сайт, почта)
            <input value={attr("contactUri")} onChange={(e) => set("contactUri")(e.target.value)} placeholder="https://vk.com/…" />
          </label>
          <label>
            Дата
            <input value={attr("date")} onChange={(e) => set("date")(e.target.value)} placeholder="дд.мм.гггг" />
          </label>
          <label>
            Сложность
            <select value={attr("difficulty")} onChange={(e) => set("difficulty")(e.target.value)}>
              <option value="">не указана</option>
              {Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={String(i + 1)}>{i + 1}</option>)}
            </select>
          </label>
          <label>
            Возрастное ограничение
            <input list="pp-restriction" value={attr("restriction")} onChange={(e) => set("restriction")(e.target.value)} placeholder="нет" />
            <datalist id="pp-restriction">
              {["12+", "16+", "18+", "30+"].map((v) => <option key={v} value={v} />)}
            </datalist>
          </label>
          <label>
            Язык
            <select value={attr("language")} onChange={(e) => set("language")(e.target.value)}>
              <option value="">не указан</option>
              <option value="ru-RU">русский</option>
              <option value="en-US">английский</option>
            </select>
          </label>
          <label className="wide">
            Теги (через запятую)
            <input value={tags} onChange={(e) => setTags(e.target.value)} onBlur={(e) => commitTags(e.target.value)} />
          </label>
          <label className="wide">
            Комментарий к паку
            <textarea rows={3} value={pkg.info?.comments ?? ""} onChange={(e) => setComments(e.target.value)} />
          </label>
          <div className="wide">
            <button onClick={clearComments} disabled={!commentsCount}
              title={commentsCount ? undefined : "В паке нет комментариев"}>
              Очистить все комментарии
            </button>
            {commentsNote && <p className="muted">{commentsNote}</p>}
          </div>
        </div>

        <footer>
          <button className="primary" onClick={onClose}>Готово</button>
        </footer>
        {numbering && logoMedia && (
          <LogoNumber media={logoMedia} packName={attr("name")} onClose={() => setNumbering(false)}
            onDone={(created) => { mutate((p) => setPackLogo(p, created.name)); setNumbering(false); }} />
        )}
      </div>
    </div>
  );
}

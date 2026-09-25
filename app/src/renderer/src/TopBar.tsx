import { packLogo } from "../../core/siq/board";
import type { PackStats } from "../../core/siq/helpers";
import { useEffect, useRef, useState } from "react";
import type { PackDTO } from "../../shared/api";
import type { Mutate } from "./App";
import { Icon } from "./Icon";
import { ThemeSwitch } from "./ThemeSwitch";

type Actions = { newPack(): void; open(): void; save(saveAs: boolean): void; mediaCenter(): void; library(): void; wordStudio(): void; aiSettings(): void; proposals(): void; components(): void; assistant(): void; packProps(): void; packSize(): void; publish(): void; feedback(): void; check(): void; openInSigame(): void; openBackups(): void };

interface Props {
  pack: PackDTO;
  dirty: boolean;
  stats: PackStats;
  status: string;
  mutate: Mutate;
  actions: Actions;
}

/** «Файл ▾»: редкие действия с файлом пака в одном меню. Сохранить — ещё и Ctrl+S и «● Сохранить» у названия. */
function FileMenu({ dirty, path, actions }: { dirty: boolean; path?: string; actions: Actions }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const run = (f: () => void) => () => { setOpen(false); f(); };
  return (
    <div className="tb-menu" ref={ref}>
      <button className={open ? "active" : ""} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} title="Новый, открыть, сохранить">
        <Icon name="file" /><span className="tb-label minor">Файл</span>{dirty && <span className="dot" />}<Icon name="chevron" size={12} />
      </button>
      {open && (
        <div className="tb-menu-list" role="menu">
          <button role="menuitem" onClick={run(actions.newPack)}><Icon name="plus" />Новый пак</button>
          <button role="menuitem" onClick={run(actions.open)}><Icon name="folder" />Открыть…</button>
          <hr />
          <button role="menuitem" onClick={run(() => actions.save(false))}><Icon name="save" />Сохранить<kbd>Ctrl+S</kbd></button>
          <button role="menuitem" onClick={run(() => actions.save(true))}><Icon name="save" />Сохранить как…<kbd>Ctrl+Shift+S</kbd></button>
          <hr />
          <button role="menuitem" onClick={run(actions.openInSigame)} title="Сохранить, запустить SIGame и положить путь к паку в буфер — в «Добавить пакет» вставить Ctrl+V">
            <Icon name="play" />Открыть в SIGame
          </button>
          {path && <button role="menuitem" onClick={run(() => window.api.reveal(path))} title={path}><Icon name="folder" />Показать в папке</button>}
          <button role="menuitem" onClick={run(actions.openBackups)} title="Прежние версии паков: перед каждым сохранением старый файл уходит сюда (последние 5)">
            <Icon name="history" />Резервные копии…
          </button>
        </div>
      )}
    </div>
  );
}

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);

/** Пороги FirePacks для плашек на карточке пака: спецвопросов >5% — жёлтая, >15% — красная. */
function specialLevel(share: number): "ok" | "warn" | "alarm" {
  return share > 15 ? "alarm" : share > 5 ? "warn" : "ok";
}

export function TopBar({ pack, dirty, stats, status, mutate, actions }: Props) {
  const name = pack.pkg.attrs.find(([k]) => k === "name")?.[1] ?? "";
  const withContent = stats.byKind.text + stats.byKind.image + stats.byKind.audio + stats.byKind.video;
  const specialShare = pct(stats.specials, stats.questions);
  const logo = packLogo(pack.pkg);
  const logoUrl = logo ? pack.media.find((m) => m.folder === "Images" && m.name === logo)?.url : undefined;

  const setName = (v: string) =>
    mutate((p) => {
      const a = p.attrs.find(([k]) => k === "name");
      if (a) a[1] = v;
      else p.attrs.unshift(["name", v]);
    });

  return (
    <header className="topbar">
      <div className="topbar-row">
        <div className="topbar-brand" title="Ye!Studio — мастерская паков «Своя игра»">
          <span className="logo-word"><span className="logo-ye">Ye!</span><span className="logo-studio">Studio</span></span>
          <span className="beta-badge" title="Бета-тест: возможны ошибки. Сообщите о них через обратную связь">БЕТА</span>
        </div>
        {/* группы переносятся на новую строку целиком, а не уезжают за край окна; в узком окне у второстепенных
            кнопок остаётся только значок (подпись — в подсказке) */}
        <div className="tb-groups">
          <FileMenu dirty={dirty} path={pack.path} actions={actions} />
          <div className="tb-group media" role="group" aria-label="Медиа">
            <span className="tb-caption">Медиа</span>
            <button onClick={actions.mediaCenter} title="Найти в интернете картинки, звук и видео и скачать в пак. Уже скачанное — в «Скачанном»">
              <Icon name="globe" /><span className="tb-label">Найти в сети</span>
            </button>
            <button onClick={actions.library} title="Всё, что уже скачано для этого пака: оригиналы в source/">
              <Icon name="library" /><span className="tb-label">Скачанное</span>
            </button>
          </div>
          <button className="tb-studio" onClick={actions.wordStudio} title="Слова и картинки: темы на словах (матрицы, анаграммы) и ИИ-картинки для тем">
            <Icon name="palette" /><span className="tb-label">Слова и картинки</span>
          </button>
          <div className="tb-group ai" role="group" aria-label="ИИ">
            <button className="primary tb-paste" onClick={actions.proposals} title="Вставить вопросы, которые Claude или ChatGPT выдал блоком json (или кнопкой «📋 Для Ye!Studio» на странице разметки): скопируйте и нажмите">
              <Icon name="paste" /><span>Вставить из AI</span>
            </button>
            <button onClick={actions.assistant} title="Помощник: настроить Claude или ChatGPT для тем и вопросов"><Icon name="helper" /></button>
            <button onClick={actions.aiSettings} title="Сервисы ИИ: ключи, модели, очереди, остатки лимитов"><Icon name="gear" /><span className="tb-label minor">ИИ</span></button>
          </div>
          <div className="tb-group" role="group" aria-label="Пак">
            <button onClick={actions.check} title="Проверить пак перед игрой и публикацией: пустые вопросы, ответы, файлы, объём">
              <Icon name="check" /><span className="tb-label minor">Проверить</span>
            </button>
            <button onClick={actions.publish} title="Афиша со всеми темами и готовый текст поста для ВКонтакте">
              <Icon name="megaphone" /><span className="tb-label minor">Публикация</span>
            </button>
            <button onClick={actions.components} title="Компоненты: проверка машины и локальная модель картинок одной кнопкой"><Icon name="puzzle" /></button>
            {/* ---------- связь с сервером автора ---------- */}
            <button onClick={actions.feedback} title="Обратная связь: что случилось или что улучшить"><Icon name="chat" /></button>
          </div>
        </div>
        <div className="tb-pack">
          <button className="pack-logo-btn" onClick={actions.packProps} title="Свойства пака: логотип, номер на логотипе, авторы, сложность, возраст…">
            <span className="pack-logo-thumb">{logoUrl ? <img src={logoUrl} alt="логотип" /> : <Icon name="pencil" />}</span>
            <span className="tb-label">Свойства</span>
          </button>
          <input className="pack-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Название пака" />
          {dirty && (
            <button className="save-now" onClick={() => actions.save(false)} title="Есть несохранённые изменения — сохранить (Ctrl+S)">
              ● Сохранить
            </button>
          )}
          <ThemeSwitch />
        </div>
      </div>
      <div className="topbar-row stats">
        <span className="chip">Вопросов: <b>{stats.questions}</b></span>
        <span className="chip ready">готово {stats.ready}</span>
        <span className="chip draft">черновик {stats.draft}</span>
        <span className="chip empty">пусто {stats.empty}</span>
        <span className="sep" />
        <span className="chip" title="Доля вопросов по главному типу медиа — как в статистике FirePacks">
          текст {pct(stats.byKind.text, withContent)}% · картинки {pct(stats.byKind.image, withContent)}% · звук {pct(stats.byKind.audio, withContent)}% · видео {pct(stats.byKind.video, withContent)}%
        </span>
        <span className={`chip special-${specialLevel(specialShare)}`} title="FirePacks вешает жёлтую плашку при доле спецвопросов больше 5% и красную — больше 15%">
          спецвопросов {stats.specials} ({specialShare}%)
        </span>
        <span className="chip">медиафайлов {pack.media.length}</span>
        {(() => {
          const total = pack.media.reduce((s, m) => s + m.size, 0) / 1048576;
          return (
            <button className={`pack-size-btn${total > 100 ? " over" : ""}`} onClick={actions.packSize}
              title="Объём пака: что лежит без дела, какие картинки ужать, какие видео сжать — чтобы уложиться в 100 МБ">
              <Icon name="box" size={14} /> {total.toFixed(0)} МБ <span className="chip-cta">{total > 100 ? "сжать" : "объём"} ›</span>
            </button>
          );
        })()}
        {status && <span className="status">{status}</span>}
      </div>
    </header>
  );
}

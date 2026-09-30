import { packLogo } from "../../core/siq/board";
import type { PackStats } from "../../core/siq/helpers";
import { useState, type ReactNode } from "react";
import type { PackDTO } from "../../shared/api";
import type { Mutate } from "./App";
import { Icon, type IconName } from "./Icon";
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

/**
 * Разделы шапки (вариант D3 автора): вкладки Пак / Настройки / Выпуск, под ними — кнопки открытого раздела.
 * Медиа в шапке нет — оно над редактором вопроса (MediaStrip), чтобы мышь не бегала через всё окно.
 * Кнопки всех разделов в разметке всегда, закрытые только спрятаны: самопроверки ищут их по подсказке.
 */
type Section = "pack" | "ai" | "out";
const SECTIONS: { id: Section; icon: IconName; label: string }[] = [
  { id: "pack", icon: "file", label: "Пак" },
  { id: "ai", icon: "gear", label: "Настройки" },
  { id: "out", icon: "megaphone", label: "Выпуск" },
];

function Ribbon({ section, path, actions }: { section: Section | null; path?: string; actions: Actions }) {
  const part = (id: Section, children: ReactNode) => <div className={`tb-ribbon${section === id ? " on" : ""}`} data-section={id}>{children}</div>;
  return (
    <>
      {part("pack", <>
        <button className="k-file" onClick={actions.newPack}><Icon name="plus" />Новый</button>
        <button className="k-file" onClick={actions.open} title="Ctrl+O"><Icon name="folder" />Открыть</button>
        <button className="k-file" onClick={() => actions.save(false)} title="Ctrl+S"><Icon name="save" />Сохранить</button>
        <button className="k-file" onClick={() => actions.save(true)} title="Ctrl+Shift+S"><Icon name="save" />Сохранить как</button>
        <button className="k-file" onClick={actions.openInSigame} title="Сохранить, запустить SIGame и положить путь к паку в буфер — в «Добавить пакет» вставить Ctrl+V">
          <Icon name="play" />Открыть в SIGame
        </button>
        {path && <button className="k-file" onClick={() => window.api.reveal(path)} title={path}><Icon name="folder" />Показать в папке</button>}
        <button className="k-file" onClick={actions.openBackups} title="Прежние версии паков: перед каждым сохранением старый файл уходит сюда (последние 5)">
          <Icon name="history" />Резервные копии
        </button>
      </>)}
      {part("ai", <>
        <button className="k-ai" onClick={actions.assistant} title="Помощник: настроить Claude или ChatGPT для тем и вопросов"><Icon name="helper" />ИИ-помощник Claude/ChatGPT</button>
        <button className="k-set" onClick={actions.aiSettings} title="Сервисы ИИ: ключи, модели, очереди, остатки лимитов"><Icon name="gear" />Настройка ИИ-компонентов</button>
        <button className="k-set" onClick={actions.components} title="Компоненты: проверка машины и локальная модель картинок одной кнопкой"><Icon name="puzzle" />Компоненты</button>
      </>)}
      {part("out", <>
        {/* подсказка начинается с «Проверить пак» — по ней кнопку находит самопроверка */}
        <button className="k-check" onClick={actions.check} title="Проверить пак: повторы на FirePacks, а заодно пустые вопросы, ответы, файлы, объём">
          <Icon name="check" />Автопроверка пака
        </button>
        <button className="k-pub" onClick={actions.publish} title="Афиша со всеми темами и готовый текст поста для ВКонтакте"><Icon name="megaphone" />Публикация</button>
      </>)}
    </>
  );
}

/** Медиа над редактором вопроса: найти, взять скачанное, сделать картинку, вставить вопросы из чата. */
export function MediaStrip({ actions }: { actions: Pick<Actions, "proposals" | "mediaCenter" | "library" | "wordStudio"> }) {
  return (
    <div className="media-strip" role="group" aria-label="Медиа">
      <button className="k-ai main" onClick={actions.proposals} title="Вставить вопросы, которые Claude или ChatGPT выдал блоком json (или кнопкой «📋 Для Ye!Studio» на странице разметки): скопируйте и нажмите">
        <Icon name="paste" />Вставить из AI
      </button>
      <button className="k-media" onClick={actions.mediaCenter} title="Найти в интернете картинки, звук и видео и скачать в пак. Уже скачанное — в «Скачанном»">
        <Icon name="globe" />Найти в сети
      </button>
      <button className="k-media" onClick={actions.library} title="Всё, что уже скачано для этого пака: оригиналы в source/"><Icon name="library" />Скачанное</button>
      <button className="k-words tb-studio" onClick={actions.wordStudio} title="Студия: темы на словах (матрицы, анаграммы), ИИ-картинки и голос — перевод фразы (латынь и др.) с озвучкой">
        <Icon name="palette" />Слова, картинки, голос
      </button>
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
  const [section, setSection] = useState<Section | null>("pack");

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
        </div>
        {/* щелчок по открытому разделу сворачивает его — табло достаётся больше места */}
        <div className="tb-tabs" role="tablist">
          {SECTIONS.map((s) => (
            <button key={s.id} role="tab" aria-selected={section === s.id} className={`tb-tab k-${s.id}${section === s.id ? " on" : ""}`}
                    onClick={() => setSection(section === s.id ? null : s.id)}>
              <Icon name={s.icon} />{s.label}{s.id === "pack" && dirty && <span className="dot" title="Есть несохранённые изменения" />}
            </button>
          ))}
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
          {/* ---------- связь с сервером автора ---------- */}
          <button className="tb-feedback" onClick={actions.feedback} title="Обратная связь: что случилось или что улучшить"><Icon name="chat" />Автору</button>
          <ThemeSwitch />
        </div>
      </div>
      <Ribbon section={section} path={pack.path} actions={actions} />
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

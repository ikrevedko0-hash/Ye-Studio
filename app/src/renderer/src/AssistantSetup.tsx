// «🤝 Помощник»: связать Мастерскую с чатом, где пишутся вопросы (Claude или ChatGPT).
//
// Чат предлагает темы и вопросы, собирает страницу-разметчик, автор ставит ✓/✕ в браузере,
// одобренное приходит сюда кнопкой «Вставить из AI». Окно раскладывает набор (памятка, гайд по вкусу,
// шаблоны разметки) в рабочую папку и ставит навык Claude либо готовит всё для проекта ChatGPT.
// Само открывается при первом запуске на машине, где навыка ещё нет.

import { useEffect, useState } from "react";
import type { AssistantKind, AssistantSetupResult, AssistantStatus } from "../../shared/api";

const plainError = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "");

export function AssistantSetup({ onClose, first }: { onClose(): void; first?: boolean }) {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [workdir, setWorkdir] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<AssistantSetupResult | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    void window.api.assistantStatus().then((s) => { setStatus(s); setWorkdir(s.workdir); });
  }, []);

  const setup = async (kind: AssistantKind) => {
    setErr("");
    setBusy(true);
    try {
      setDone(await window.api.assistantSetup(kind, workdir));
    } catch (e) {
      setErr(plainError(e));
    } finally {
      setBusy(false);
    }
  };

  const later = () => {
    if (first) void window.api.assistantDone();
    onClose();
  };

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) later(); }}>
      <div className="components-panel assistant-panel">
        <header>
          <b>🤝 Помощник для вопросов</b>
          <span className="spacer" />
          <button className="icon" onClick={later} title="Закрыть">×</button>
        </header>

        {!done && (
          <>
            <p className="assistant-lead">
              Темы и вопросы удобно придумывать с ИИ в чате: он собирает страницу-разметчик, вы отмечаете
              ✓/✕ и правите прямо в браузере, а одобренное вставляете в пак кнопкой <b>«Вставить из AI»</b> —
              Мастерская сама разложит вопросы по темам и подберёт картинки.
              {first && " Настроим, с каким чатом вы работаете?"}
            </p>

            <section>
              <h4>Рабочая папка</h4>
              <div className="assistant-dir">
                <code title={workdir}>{workdir || "…"}</code>
                <button className="small" disabled={busy || !status} onClick={() => void window.api.assistantPickDir(workdir).then((d) => d && setWorkdir(d))}>
                  Изменить…
                </button>
              </div>
              <div className="muted">
                Сюда лягут памятка формата, гайд по вкусу, шаблоны разметки и ваши отзывы. То, что в папке уже
                есть, не перезаписывается.
              </div>
            </section>

            {status?.claudeSkill && (
              <div className="ok" title={status.claudeSkill}>✓ Навык Claude на этой машине уже стоит — «Claude» ниже обновит его под выбранную папку.</div>
            )}

            <div className="assistant-choice">
              <button className="assistant-card" disabled={busy || !workdir} onClick={() => void setup("claude")}>
                <b>Claude</b>
                <span className="cmp-badge">удобнее всего</span>
                <span className="muted">
                  Claude Desktop или Claude Code: работает прямо с папкой — сам кладёт страницы разметки и читает
                  ваши отзывы. Ставится навык «{"sigame-pack-labeler"}».
                </span>
              </button>
              <button className="assistant-card" disabled={busy || !workdir} onClick={() => void setup("chatgpt")}>
                <b>ChatGPT</b>
                <span className="muted">
                  Проект в ChatGPT с инструкциями и файлами. Страницы разметки он отдаёт на скачивание, отзывы
                  прикладываются в чат файлом.
                </span>
              </button>
            </div>
          </>
        )}

        {done?.kind === "claude" && (
          <section>
            <h4>Claude — готово</h4>
            <ol className="assistant-steps">
              <li>
                <b>Claude Code</b> и вкладка «Code» в Claude Desktop видят навык сразу
                <span className="muted"> ({done.skillPath})</span>.
              </li>
              <li>
                <b>Чат Claude Desktop или claude.ai:</b> Настройки → Возможности → Навыки → «Загрузить навык» →
                выберите в рабочей папке файл <code>{done.skillZip?.split(/[\\/]/).pop()}</code>.
                <div className="assistant-row">
                  <button className="small" onClick={() => void window.api.assistantOpen("folder")}>📂 Открыть папку</button>
                  <button className="small" onClick={() => void window.api.assistantOpen("claude-skills")}>Открыть настройки Claude</button>
                </div>
              </li>
              <li>
                В Claude Desktop выберите для работы рабочую папку и напишите, например:
                <i> «Предложи 15 тем для нового пака, собери страницу разметки»</i>.
              </li>
              <li>Готовые вопросы со страницы («📋 Для Ye!Studio») вставляйте кнопкой «Вставить из AI» в шапке.</li>
            </ol>
          </section>
        )}

        {done?.kind === "chatgpt" && (
          <section>
            <h4>ChatGPT — готово</h4>
            <ol className="assistant-steps">
              <li>
                На chatgpt.com создайте <b>Проект</b> (слева «Проекты» → «Новый проект»).
                <div className="assistant-row">
                  <button className="small" onClick={() => void window.api.assistantOpen("chatgpt")}>Открыть ChatGPT</button>
                </div>
              </li>
              <li>
                В настройках проекта → «Инструкции» вставьте текст: <b>он уже в буфере обмена</b> (копия —
                «Инструкции проекта.txt»).
              </li>
              <li>
                В «Файлы проекта» перетащите всё из папки <code>{CHATGPT_LABEL}</code>, кроме инструкций.
                <div className="assistant-row">
                  <button className="small" onClick={() => void window.api.assistantOpen("chatgpt-dir")}>📂 Открыть папку</button>
                </div>
              </li>
              <li>
                В проекте напишите, например: <i>«Предложи 15 тем для нового пака, собери страницу разметки»</i>.
                Скачанную страницу откройте в браузере; «Сохранить отзывы» → приложите файл в чат.
              </li>
              <li>Готовые вопросы («📋 Для Ye!Studio» на странице) вставляйте кнопкой «Вставить из AI» в шапке — она понимает и ChatGPT.</li>
            </ol>
          </section>
        )}

        {done && done.added.length > 0 && <div className="muted">В рабочую папку положено файлов: {done.added.length}.</div>}
        {err && <div className="bad">{err}</div>}

        <div className="cmp-actions">
          {done ? (
            <>
              <button className="link" onClick={() => setDone(null)}>Настроить другой чат</button>
              <span className="spacer" />
              <button className="primary" onClick={onClose}>Готово</button>
            </>
          ) : (
            <>
              <span className="spacer" />
              <button onClick={later}>{first ? "Не сейчас" : "Закрыть"}</button>
            </>
          )}
        </div>
        {!done && first && <div className="muted cmp-note">Позже — кнопка 🤝 в шапке.</div>}
      </div>
    </div>
  );
}

const CHATGPT_LABEL = "Для ChatGPT";

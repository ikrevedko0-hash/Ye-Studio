// ---------- связь с сервером автора: окно «💬 Обратная связь» ----------
//
// Снимок окна главный процесс уже сделал по нажатию кнопки 💬 (App.tsx, до открытия этой модалки) —
// здесь только галочка, прикладывать его или нет. Текст при неудаче не теряется: можно поправить и повторить.

import { useState } from "react";

interface Props {
  onClose(): void;
}

export function Feedback({ onClose }: Props) {
  const [text, setText] = useState("");
  const [contact, setContact] = useState("");
  const [withShot, setWithShot] = useState(true);
  const [withLog, setWithLog] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const send = async () => {
    if (!text.trim()) {
      setStatus("Напишите хоть немного — иначе автору не с чем разбираться");
      return;
    }
    setBusy(true);
    setStatus("Отправляю…");
    try {
      const r = await window.api.feedbackSend({
        text: text.trim(),
        contact: contact.trim() || undefined,
        includeScreenshot: withShot,
        includeLog: withLog,
      });
      setStatus(r.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="publish feedback">
        <header>
          <b>💬 Обратная связь</b>
          <span className="spacer" />
          <button className="icon" onClick={onClose} title="Закрыть">×</button>
        </header>

        <label>
          Что случилось или что улучшить?
          <textarea
            className="publish-text"
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Опишите как можно подробнее — что делали, что ожидали, что получилось"
          />
        </label>
        <label>
          Как с вами связаться (ВК/Telegram) — необязательно
          <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="@ник или ссылка" />
        </label>
        <label className="check">
          <input type="checkbox" checked={withShot} onChange={(e) => setWithShot(e.target.checked)} />
          Приложить снимок окна
        </label>
        <label className="check">
          <input type="checkbox" checked={withLog} onChange={(e) => setWithLog(e.target.checked)} />
          Приложить журнал ошибок (последние 50 записей)
        </label>

        <div className="buttons">
          <button className="primary" onClick={() => void send()} disabled={busy}>Отправить</button>
        </div>
        {status && <p className="muted">{status}</p>}
      </div>
    </div>
  );
}

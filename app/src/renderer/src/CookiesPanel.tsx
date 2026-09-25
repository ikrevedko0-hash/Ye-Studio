// Куки YouTube: что подключено сейчас и как достать свежие.
//
// Главный путь — «Войти в YouTube» прямо в окне приложения (см. main/youtubeLogin.ts):
// приложение само выгружает куки и освежает их раз в час. Прежний путь — выгрузка из инкогнито
// Chrome расширением — остался запасным, на случай если Google не пустит во встроенное окно.
//
// Открывается тремя путями: кнопкой в медиацентре, отказом загрузки «подтвердите, что вы не бот»
// и кнопкой «Войти» во встроенном плеере. Во всех трёх случаях лечение одно — свежие куки.

import { useEffect, useState } from "react";
import type { CookiesStatus } from "../../shared/api";
import { CookieJarArt } from "./CookieJarArt";

/** Расширение, которое советуют сами авторы yt-dlp: выгружает куки локально, никуда не отправляя. */
const EXTENSION_URL = "https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc";

const plainError = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "");

function age(ms?: number): string {
  if (!ms) return "";
  const min = Math.floor((Date.now() - ms) / 60_000);
  // куки из окна входа освежаются раз в час — тут важны минуты, а не дни
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const days = Math.floor(min / 1440);
  return days <= 0 ? `${Math.floor(min / 60)} ч назад` : days === 1 ? "вчера" : `${days} дн. назад`;
}

export function CookiesPanel({ reason, onClose }: { reason?: string; onClose(): void }) {
  const [status, setStatus] = useState<CookiesStatus | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void window.api.cookiesStatus().then(setStatus); }, []);

  /** Общая обёртка кнопок: статус, сообщение, человеческая ошибка. null — окно выбора закрыли. */
  const act = async (fn: () => Promise<CookiesStatus | null>) => {
    setMsg(null);
    setBusy(true);
    try {
      const s = await fn();
      if (!s) return;
      setStatus(s);
      setMsg({ ok: s.ok, text: s.message ?? (s.ok ? "Готово" : "Не вышло") });
    } catch (e) {
      setMsg({ ok: false, text: `Не получилось: ${plainError(e)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mc-diag mc-cookies">
      <div className="mc-diag-head">
        <b>Куки YouTube</b>
        {status && (
          <span className={status.ok ? "ok" : "bad"}>
            {status.ok
              ? `✔ ${status.auto ? "вход в приложении, освежены" : "подключены из файла, положены"} ${age(status.updated)}`
              : `✖ ${status.message ?? "не подключены"}`}
          </span>
        )}
        <span className="spacer" />
        <button className="link" onClick={onClose}>скрыть</button>
      </div>
      {reason && <div className="mc-cookies-reason">{reason}</div>}

      <div className="mc-cookies-hero">
        <CookieJarArt />
        <div className="mc-cookies-hero-text">
          <div className="mc-cookies-actions">
            <button className="primary" disabled={busy} onClick={() => void act(() => window.api.cookiesLogin())}>
              {busy ? "Жду вход…" : status?.auto ? "Войти заново" : "Войти в YouTube"}
            </button>
            {status?.auto && <button disabled={busy} onClick={() => void act(() => window.api.cookiesRefresh())}>Освежить сейчас</button>}
            {status?.auto && <button disabled={busy} onClick={() => void act(() => window.api.cookiesLogout())}>Выйти</button>}
          </div>
          <div className="muted">
            Откроется окно Google прямо в приложении: войдите, и оно закроется само. Куки приложение выгрузит
            для загрузчика и будет освежать раз в час — ни инкогнито, ни расширений. Пароль видит только Google.
            Лучше войти отдельным, не основным аккаунтом: YouTube может ограничить аккаунт, с которого качают.
          </div>
        </div>
      </div>
      {msg && <div className={msg.ok ? "ok" : "bad"}>{msg.text}</div>}

      <details className="mc-cookies-manual">
        <summary>Запасной путь: выгрузить куки из Chrome вручную</summary>
        <ol className="mc-steps">
          <li>
            Поставьте в Chrome расширение{" "}
            <button className="link inline" onClick={() => void window.api.openPath(EXTENSION_URL)}>«Get cookies.txt LOCALLY»</button>.
            Не перепутайте с похожим «Get cookies.txt» без слова LOCALLY — его ловили на краже данных.
          </li>
          <li>В <code>chrome://extensions</code> → «Сведения» у расширения включите «Разрешить в режиме инкогнито».</li>
          <li>
            Откройте окно инкогнито (Ctrl+Shift+N), зайдите на youtube.com и войдите в аккаунт.
            <div className="muted">
              Инкогнито пишет «не удалось найти IP-адрес»? Это VPN перехватывает DNS. Chrome → Настройки →
              Конфиденциальность и безопасность → Безопасность → «Использовать безопасный DNS» → Cloudflare.
            </div>
          </li>
          <li>Там же нажмите значок расширения → <b>Export</b>. Файл ляжет в «Загрузки».</li>
          <li>
            <b>Закройте окно инкогнито.</b>
            <span className="muted"> В открытой вкладке YouTube постоянно меняет куки, и выгрузка быстро протухает; закрытая сессия живёт долго.</span>
          </li>
          <li>Нажмите кнопку ниже и выберите этот файл. Приложение проверит, что в нём есть вход, и сохранит у себя.</li>
        </ol>
        <div className="mc-cookies-actions">
          <button disabled={busy} onClick={() => void act(() => window.api.cookiesImport())}>{status?.ok ? "Заменить куки файлом…" : "Подключить cookies.txt…"}</button>
          <span className="muted">Файл — это полный доступ к аккаунту: никому не отправляйте и не храните в облаке.</span>
        </div>
      </details>
    </div>
  );
}

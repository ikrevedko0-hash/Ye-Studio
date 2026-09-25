// Вход в YouTube прямо в приложении — вместо выгрузки кук из инкогнито Chrome расширением.
//
// Приложение само построено на Chromium, так что браузер у него свой. Вход живёт в отдельном
// постоянном хранилище (`persist:youtube-login`), которым больше никто не пользуется: ни окно
// Мастерской, ни встроенный плеер. Из него приложение само пишет cookies.txt для yt-dlp.
//
// Почему прежде это не работало и почему теперь сработает. Раньше куки из файла отдавали окну
// приложения — и сессию держали двое: окно (живой браузер, Google обновлял в нём куки) и файл,
// который от этого протухал за часы (см. `forgetYoutubeLoginInWindow`). Здесь источник один —
// хранилище входа, а файл — его выгрузка: браузер в этом хранилище запускается только нами,
// и после каждого запуска файл переписывается. Разойтись им негде.
//
// Пароль вводит сам человек в окне Google; приложение его не видит и нигде не хранит.

import { writeFile } from "node:fs/promises";
import { BrowserWindow, session, type Cookie, type Session } from "electron";
import { checkCookiesTxt, isYoutubeDomain, LOGIN_NAMES, type CookiesCheck } from "../core/media/cookies";

const PARTITION = "persist:youtube-login";
const LOGIN_URL = "https://accounts.google.com/ServiceLogin?service=youtube&hl=ru&continue=https%3A%2F%2Fwww.youtube.com%2F";

/**
 * Честный User-Agent Chrome без «Electron» и имени приложения. С ними Google отвечает
 * «Этот браузер или приложение могут быть небезопасны» и не пускает ко входу.
 */
function chromeUserAgent(): string {
  const major = process.versions.chrome.split(".")[0];
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

let prepared: Session | undefined;

/** Хранилище входа. Маршрут (VPN-вход) ему ставит главный процесс — тот же, что у yt-dlp. */
export function loginSession(): Session {
  if (!prepared) {
    prepared = session.fromPartition(PARTITION);
    prepared.setUserAgent(chromeUserAgent());
    // Client Hints у Electron — «Chromium» без «Google Chrome», а User-Agent уже говорит «Chrome».
    // Такое расхождение Google может счесть встроенным браузером, поэтому бренды выравниваем.
    const major = process.versions.chrome.split(".")[0];
    const brands = `"Chromium";v="${major}", "Google Chrome";v="${major}", "Not?A_Brand";v="99"`;
    prepared.webRequest.onBeforeSendHeaders((details, done) => {
      const headers = { ...details.requestHeaders };
      for (const k of Object.keys(headers)) {
        if (k.toLowerCase() === "sec-ch-ua") headers[k] = brands;
      }
      done({ requestHeaders: headers });
    });
  }
  return prepared;
}

/** Строка cookies.txt (Netscape) — в том же виде, что пишет расширение и читает yt-dlp. */
function netscapeLine(c: Cookie): string {
  const domain = c.domain ?? "";
  // кука без hostOnly действует и на поддомены — в файле это точка в начале и TRUE
  const dotted = !c.hostOnly && !domain.startsWith(".") ? `.${domain}` : domain;
  const sub = dotted.startsWith(".") ? "TRUE" : "FALSE";
  const expires = c.expirationDate ? Math.floor(c.expirationDate) : 0;
  const line = [dotted, sub, c.path ?? "/", c.secure ? "TRUE" : "FALSE", String(expires), c.name, c.value].join("\t");
  return c.httpOnly ? `#HttpOnly_${line}` : line;
}

/** Выгрузить куки YouTube и Google из хранилища входа в файл. Возвращает проверку файла. */
export async function exportLoginCookies(file: string): Promise<CookiesCheck> {
  const all = await loginSession().cookies.get({});
  const rows = all.filter((c) => c.domain && isYoutubeDomain(c.domain));
  const text = ["# Netscape HTTP Cookie File", "# Выгружено Мастерской паков из её окна входа. Это полный доступ к аккаунту.", "", ...rows.map(netscapeLine), ""].join("\n");
  const check = checkCookiesTxt(text);
  // Файл без входа не пишем поверх рабочего: выгрузка до входа не должна стирать прежние куки.
  if (check.ok) await writeFile(file, text, "utf8");
  return check;
}

/**
 * Окно входа. Закрывается само, как только YouTube признал вход (появились куки входа
 * и страница вернулась на youtube.com), или когда человек закрыл его сам.
 * Ответ — проверка выгруженного файла.
 */
export function openLoginWindow(parent: BrowserWindow | undefined, file: string): Promise<CookiesCheck> {
  return new Promise((resolve) => {
    const w = new BrowserWindow({
      width: 520,
      height: 720,
      parent,
      title: "Вход в YouTube — Ye!Studio",
      autoHideMenuBar: true,
      webPreferences: { session: loginSession(), sandbox: true, contextIsolation: true },
    });
    let done = false;
    const finish = async () => {
      if (done) return;
      done = true;
      const check = await exportLoginCookies(file);
      if (!w.isDestroyed()) w.close();
      resolve(check);
    };
    w.webContents.on("did-navigate", async (_e, url) => {
      if (!/^https:\/\/(www|m)\.youtube\.com\//.test(url)) return;
      const check = await exportLoginCookies(file);
      if (check.ok) setTimeout(() => void finish(), 800); // дать YouTube дописать куки
    });
    w.on("closed", () => void finish());
    void w.loadURL(LOGIN_URL);
  });
}

/**
 * Освежить куки: в невидимом окне того же хранилища открыть youtube.com и выгрузить заново.
 * YouTube со временем меняет часть кук (`__Secure-*PSIDTS`), и без этого файл протухает.
 */
export async function refreshLoginCookies(file: string, timeoutMs = 40_000): Promise<CookiesCheck> {
  const w = new BrowserWindow({ show: false, webPreferences: { session: loginSession(), sandbox: true, contextIsolation: true } });
  try {
    await Promise.race([
      w.loadURL("https://www.youtube.com/"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("youtube.com не ответил")), timeoutMs)),
    ]);
    // страница после загрузки ещё дописывает куки скриптами
    await new Promise((r) => setTimeout(r, 4000));
  } catch {
    // не открылось — выгружаем то, что есть: протухшие куки лучше, чем никаких
  } finally {
    if (!w.isDestroyed()) w.destroy();
  }
  return exportLoginCookies(file);
}

/** Есть ли в хранилище вход — без выгрузки, для строки состояния. */
export async function hasLogin(): Promise<boolean> {
  const all = await loginSession().cookies.get({});
  return all.some((c) => c.domain && isYoutubeDomain(c.domain) && LOGIN_NAMES.includes(c.name));
}

/**
 * Самопроверка `--yt-login-test=1`: пускает ли Google к форме входа в нашем окне.
 * Вход не выполняется — только открываем страницу и смотрим, что на ней: поле почты
 * или отказ «браузер небезопасен». Окно не показывается, снимок — по желанию.
 */
export async function probeLoginPage(shot?: string): Promise<Record<string, unknown>> {
  const w = new BrowserWindow({ show: false, width: 520, height: 720, webPreferences: { session: loginSession(), sandbox: true, contextIsolation: true } });
  try {
    await w.loadURL(LOGIN_URL);
    await new Promise((r) => setTimeout(r, 3000));
    const page = (await w.webContents.executeJavaScript(`({
      url: location.href,
      title: document.title,
      emailField: !!document.querySelector('input[type=email], #identifierId'),
      refused: /небезопасн|not be secure|isn.t secure/i.test(document.body.innerText),
      text: document.body.innerText.slice(0, 300),
      ua: navigator.userAgent,
      brands: (navigator.userAgentData?.brands ?? []).map((b) => b.brand).join(", "),
    })`)) as Record<string, unknown>;
    if (shot) {
      const img = await w.webContents.capturePage();
      if (!img.isEmpty()) await writeFile(shot, img.toPNG());
    }
    return { ...page, login: await hasLogin() };
  } finally {
    w.destroy();
  }
}

/** Выйти: стереть хранилище входа целиком (например, чтобы войти другим аккаунтом). */
export async function logout(): Promise<void> {
  await loginSession().clearStorageData();
}

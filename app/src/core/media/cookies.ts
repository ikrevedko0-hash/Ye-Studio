// Проверка выгруженного cookies.txt перед тем, как отдать его yt-dlp.
//
// Файл выбирает человек, и выбрать можно что угодно: куки другого сайта, пустую выгрузку
// с непрошедшим входом, вообще не тот файл. yt-dlp в любом из этих случаев промолчит,
// а YouTube ответит всё тем же «подтвердите, что вы не бот» — и будет непонятно, почему.

/** Куки, без которых YouTube не считает сессию вошедшей. Хватает любой из них. */
export const LOGIN_NAMES =["SID", "__Secure-1PSID", "__Secure-3PSID", "SAPISID", "LOGIN_INFO"];

export interface CookiesCheck {
  ok: boolean;
  /** Почему файл не годится — человеческими словами. */
  reason?: string;
  /** Сколько кук YouTube/Google в файле. */
  count: number;
}

export interface CookieRow {
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  /** Секунды с 1970 года; 0 — кука на время сессии. */
  expires: number;
  name: string;
  value: string;
}

/** Строки cookies.txt (формат Netscape) в куки. Пустые строки и комментарии пропускаем. */
export function parseCookiesTxt(text: string): CookieRow[] {
  const out: CookieRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    // «#HttpOnly_.youtube.com» — это кука с пометкой, а не комментарий
    const httpOnly = raw.startsWith("#HttpOnly_");
    const line = httpOnly ? raw.slice("#HttpOnly_".length) : raw;
    if (!line.trim() || line.startsWith("#")) continue;
    const f = line.split("\t");
    if (f.length < 7) continue;
    out.push({ domain: f[0], path: f[2] || "/", secure: f[3] === "TRUE", httpOnly, expires: Number(f[4]) || 0, name: f[5], value: f.slice(6).join("\t") });
  }
  return out;
}

/** Куки YouTube и Google — только они нужны и загрузчику, и встроенному плееру. */
export const isYoutubeDomain = (domain: string) => /(^|\.)(youtube|google)\.com$/i.test(domain);

export function checkCookiesTxt(text: string): CookiesCheck {
  const rows = parseCookiesTxt(text);
  if (!rows.length) {
    return { ok: false, count: 0, reason: "это не файл cookies.txt: внутри нет ни одной куки в формате Netscape" };
  }
  const yt = rows.filter((c) => isYoutubeDomain(c.domain));
  if (!yt.length) {
    return { ok: false, count: 0, reason: "в файле нет кук YouTube — выгрузка сделана не на странице youtube.com" };
  }
  if (!yt.some((c) => LOGIN_NAMES.includes(c.name))) {
    return { ok: false, count: yt.length, reason: "в файле нет входа в аккаунт — войдите в YouTube в окне инкогнито и выгрузите заново" };
  }
  return { ok: true, count: yt.length };
}

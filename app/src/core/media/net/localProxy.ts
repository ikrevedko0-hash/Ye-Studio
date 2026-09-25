// Поиск локального входа VPN-клиента.
//
// Зачем. VPN-клиенты на xray/sing-box (Happ, v2rayN, Clash, Hiddify…) в режиме TUN забирают
// себе весь DNS и на имена вроде youtube.com могут отвечать «нет такого домена». Браузеру это
// не мешает, а yt-dlp и ffmpeg спрашивают систему и встают. Зато каждый такой клиент держит
// на 127.0.0.1 HTTP-вход: отдай ему имя сайта — он сам найдёт адрес и сам проложит маршрут.
//
// Почему HTTP, а не SOCKS. При скачивании отрезка ролик тянет ffmpeg, а он понимает только
// HTTP-прокси: через SOCKS-вход поиск работал, а отрезок падал.

import { connect } from "node:net";

export interface LocalProxy {
  url: string;
  port: number;
  /** Кто обычно держит этот порт — для подписи в окне, а не для решений. */
  app: string;
}

/** Порты по умолчанию у распространённых клиентов. Порядок — порядок предпочтения. */
const CANDIDATES: { port: number; app: string }[] = [
  { port: 10809, app: "Happ / v2rayN" },
  { port: 7890, app: "Clash / Mihomo" },
  { port: 7897, app: "Clash Verge" },
  { port: 2080, app: "NekoRay / Throne" },
  { port: 12334, app: "Hiddify" },
  { port: 10808, app: "xray (смешанный вход)" },
];

/**
 * Живой ли на порту HTTP-прокси, который пускает к YouTube.
 * Мало, чтобы порт был открыт: SOCKS-вход тоже откроется, но на CONNECT не ответит «200».
 */
function probe(port: number, host: string, ms = 2500): Promise<boolean> {
  return new Promise((done) => {
    const s = connect({ host: "127.0.0.1", port });
    let buf = "";
    const finish = (ok: boolean) => { s.destroy(); done(ok); };
    s.setTimeout(ms, () => finish(false));
    s.on("error", () => finish(false));
    s.on("connect", () => s.write(`CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`));
    s.on("data", (c) => {
      buf += c.toString("latin1");
      if (buf.includes("\r\n")) finish(/^HTTP\/1\.[01] 200/.test(buf));
    });
  });
}

/**
 * Помним ответ недолго: VPN включают и выключают посреди работы, и приложение должно это
 * заметить само, без перезапуска. Проба стоит миллисекунды, когда порт закрыт.
 */
const TTL_MS = 20_000;
let cache: { at: number; value: Promise<LocalProxy | null> } | undefined;

export function findLocalProxy(host = "www.youtube.com"): Promise<LocalProxy | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const value = Promise.all(CANDIDATES.map((c) => probe(c.port, host))).then((oks) => {
    const i = oks.findIndex(Boolean);
    return i < 0 ? null : { ...CANDIDATES[i], url: `http://127.0.0.1:${CANDIDATES[i].port}` };
  });
  cache = { at: Date.now(), value };
  return value;
}

export function forgetLocalProxy(): void {
  cache = undefined;
}

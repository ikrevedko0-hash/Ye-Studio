// Какие сайты пускать через локальный вход VPN, а какие — как обычно.
//
// Через вход VPN — только YouTube и Google. Им он и нужен: с включённым Happ прямое соединение
// с www.youtube.com через его туннель виснет, а через HTTP-вход идёт сразу.
// Всё остальное — как ходит система (при включённом Happ это его же туннель со своими правилами).
// Однажды через вход пустили всю сеть окна, и Rutube, который не пускает заграничные адреса,
// начал отвечать «Access to resource was blocked».

/** Домены YouTube и всё, что тянет его плеер: видео, картинки, вход, скрипты. */
const VIA_VPN = [
  "youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "googlevideo.com",
  "ytimg.com",
  "ggpht.com",
  "google.com",
  "gstatic.com",
  "googleapis.com",
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  // Instagram: как и YouTube, DNS VPN-клиента отвечает на него «нет такого домена».
  // Через вход публичные посты и рилсы открываются без входа в аккаунт.
  "instagram.com",
  "cdninstagram.com",
  "fbcdn.net",
];

export function wantsVpn(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return VIA_VPN.some((d) => h === d || h.endsWith(`.${d}`));
}

/**
 * Куда yt-dlp пойдёт по этим аргументам: поиск ytsearch — это YouTube, иначе смотрим адрес.
 * Нет адреса (например, «--version») — считаем, что YouTube: так было до разделения.
 */
export function targetWantsVpn(args: string[]): boolean {
  if (args.some((a) => a.startsWith("ytsearch"))) return true;
  const url = [...args].reverse().find((a) => /^https?:\/\//i.test(a));
  if (!url) return true;
  try {
    return wantsVpn(new URL(url).hostname);
  } catch {
    return true;
  }
}

/**
 * Правило для окна (PAC): YouTube и Google — через вход, остальное — напрямую.
 * `proxy` — адрес входа вида http://127.0.0.1:10809 или socks5://….
 */
export function pacScript(proxy: string): string {
  const u = new URL(proxy);
  const kind = u.protocol.startsWith("socks") ? "SOCKS5" : "PROXY";
  const list = JSON.stringify(VIA_VPN);
  return `function FindProxyForURL(url, host) {
  var d = ${list};
  for (var i = 0; i < d.length; i++) {
    if (host === d[i] || dnsDomainIs(host, "." + d[i])) return "${kind} ${u.host}";
  }
  return "DIRECT";
}`;
}

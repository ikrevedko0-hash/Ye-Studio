import { describe, expect, it } from "vitest";
import { pacScript, targetWantsVpn, wantsVpn } from "../src/core/media/net/routing";

describe("маршрут через VPN", () => {
  it("YouTube и его домены — через вход", () => {
    for (const h of ["www.youtube.com", "youtube.com", "rr3---sn-abc.googlevideo.com", "i.ytimg.com", "accounts.google.com", "www.instagram.com", "scontent-arn2-1.cdninstagram.com"]) expect(wantsVpn(h)).toBe(true);
  });
  it("Rutube и прочие — нет, и похожие имена не путаются", () => {
    for (const h of ["rutube.ru", "static.rutube.ru", "vk.com", "notyoutube.com", "youtube.com.evil.ru"]) expect(wantsVpn(h)).toBe(false);
  });
  it("по аргументам yt-dlp", () => {
    expect(targetWantsVpn(["--dump-json", "ytsearch5:крастер"])).toBe(true);
    expect(targetWantsVpn(["-f", "best", "https://www.youtube.com/watch?v=x"])).toBe(true);
    expect(targetWantsVpn(["-f", "best", "https://rutube.ru/video/abc/"])).toBe(false);
    expect(targetWantsVpn(["--version"])).toBe(true);
  });
  it("PAC: HTTP-вход как PROXY, SOCKS как SOCKS5", () => {
    expect(pacScript("http://127.0.0.1:10809")).toContain('"PROXY 127.0.0.1:10809"');
    expect(pacScript("socks5://127.0.0.1:10808")).toContain('"SOCKS5 127.0.0.1:10808"');
  });
});

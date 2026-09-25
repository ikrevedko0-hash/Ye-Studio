import { describe, expect, it } from "vitest";
import { checkCookiesTxt } from "../src/core/media/cookies";

const row = (domain: string, name: string) => [domain, "TRUE", "/", "TRUE", "1999999999", name, "x"].join("\t");
const file = (...rows: string[]) => ["# Netscape HTTP Cookie File", "", ...rows].join("\n");

describe("checkCookiesTxt", () => {
  it("принимает выгрузку с входом в аккаунт", () => {
    const r = checkCookiesTxt(file(row(".youtube.com", "VISITOR_INFO1_LIVE"), row(".youtube.com", "SAPISID")));
    expect(r.ok).toBe(true);
    expect(r.count).toBe(2);
  });
  it("считает куки с пометкой #HttpOnly_ настоящими, а не комментарием", () => {
    expect(checkCookiesTxt(file("#HttpOnly_" + row(".youtube.com", "__Secure-3PSID"))).ok).toBe(true);
  });
  it("отказывает выгрузке без входа", () => {
    const r = checkCookiesTxt(file(row(".youtube.com", "VISITOR_INFO1_LIVE")));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/нет входа/);
  });
  it("отказывает куки чужого сайта", () => {
    expect(checkCookiesTxt(file(row(".vk.com", "remixsid"))).reason).toMatch(/нет кук YouTube/);
  });
  it("отказывает файлу не в формате Netscape", () => {
    expect(checkCookiesTxt("{\"cookies\": []}").reason).toMatch(/не файл cookies\.txt/);
  });
});

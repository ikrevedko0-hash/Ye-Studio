// Instagram — только по прямой ссылке на пост или рилс.
//
// Поиска по словам у Instagram нет: открытого поиска у сайта не существует, а внутренний
// работает только с входом, и аккаунты за него банят. Зато открытые посты и рилсы по ссылке
// yt-dlp забирает без входа — если идти через вход VPN (см. net/routing.ts): DNS VPN-клиента
// на instagram.com отвечает «нет такого домена».
//
// Отдельным источником — чтобы в окне было видно, кто нашёл пост и почему не нашёл, а не
// растворять Instagram в «YouTube и ссылках».

import type { MediaProvider } from "./types";
import { isInstagramLink, youtube, ytLookup } from "./youtube";

export const instagram: MediaProvider = {
  id: "instagram",
  title: "Instagram — по ссылке",
  types: ["video", "audio"],
  note: "вставьте ссылку на пост или рилс; открытые посты качаются без входа",
  searchTimeoutMs: 30_000,
  available: (cfg) => youtube.available(cfg),

  async search(q, ctx) {
    const text = q.text.trim();
    // Слова — не наша работа: молча уступаем остальным источникам.
    if (!isInstagramLink(text)) return [];
    return ytLookup(text, q, ctx, "instagram", "Instagram");
  },

  // Качает тот же yt-dlp по ссылке на пост; отрезок, потолок качества и маршрут — общие.
  download: (r, destDir, ctx, onProgress) => youtube.download(r, destDir, ctx, onProgress),
};

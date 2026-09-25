// Окно приложения отдаётся не из файла, а с локального http-сервера.
//
// Зачем. Страница на `file://` не имеет нормального origin: встроенный плеер YouTube приходит
// к сайту без заголовка `Referer` (проверено замером на собственном сервере — заголовка нет
// вообще), и YouTube отвечает «видео недоступно» с кодом 150/152/153. Подстановка `Referer`
// и параметр `origin` в ссылке помогли частично: код сменился со 153 на 152, но ролики
// по-прежнему не игрались. Настоящий http-origin — последнее, что можно дать плееру,
// не отказываясь от него совсем.
//
// Сервер слушает только 127.0.0.1 и только пока живёт приложение. Но 127.0.0.1 — это вся
// машина: на порт может постучаться и соседняя программа, и страница в браузере. Поэтому:
//   • порт выбирает система (`listen(0)`), угадать его заранее нельзя;
//   • в пути стоит случайный ключ, без него сервер отвечает 404 и ничего о себе не сообщает;
//   • запросы с чужого origin отбиваются: странице из браузера здесь делать нечего.
// Файлы отдаются только из каталога окна, и путь с «..» наружу не выпускает.

import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, normalize, sep, extname } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

export interface RendererServer {
  /** Адрес страницы окна вместе со случайным ключом. */
  url: string;
  port: number;
  close(): void;
}

/**
 * Поднять сервер для файлов окна.
 * @param root каталог собранного окна (в сборке он лежит внутри asar — fs читает его как обычно)
 */
export function startRendererServer(root: string): Promise<RendererServer> {
  const keyPath = randomBytes(16).toString("hex");
  const prefix = `/${keyPath}/`;

  const server: Server = createServer((req, res) => {
    void (async () => {
      const deny = (code: number) => {
        res.writeHead(code, { "content-type": "text/plain; charset=utf-8" });
        res.end(code === 404 ? "нет такой страницы" : "нельзя");
      };

      // Чужая страница в браузере обращалась бы сюда со своим origin. Своя — без него
      // (обычная навигация) либо со своим же адресом.
      const origin = req.headers.origin;
      if (origin && !origin.startsWith(`http://127.0.0.1:`)) return deny(403);

      const url = req.url ?? "/";
      if (!url.startsWith(prefix)) return deny(404); // ключ не тот — сервера как будто нет

      const rel = decodeURIComponent(url.slice(prefix.length).split("?")[0]) || "index.html";
      // «..» и абсолютные пути наружу не выпускаем: отдаём только то, что лежит в каталоге окна
      const full = join(root, normalize(rel));
      if (!full.startsWith(root.endsWith(sep) ? root : root + sep)) return deny(403);

      let size: number;
      try {
        const st = await stat(full);
        if (!st.isFile()) return deny(404);
        size = st.size;
      } catch {
        return deny(404);
      }

      res.writeHead(200, {
        "content-type": TYPES[extname(full).toLowerCase()] ?? "application/octet-stream",
        "content-length": String(size),
        // ничего из этого окна наружу отдавать не нужно
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      createReadStream(full).pipe(res);
    })();
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}${prefix}index.html`,
        port,
        close: () => server.close(),
      });
    });
  });
}

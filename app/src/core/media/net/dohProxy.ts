// Локальный прокси, который отличается от прямого соединения ровно одним: именами он спрашивает
// у DoH, а не у системного DNS.
//
// Почему прокси, а не настройка yt-dlp. Своего резолвера у yt-dlp нет и не предвидится: это
// дело операционной системы. Зато у него есть `--proxy`, и через него внешняя программа
// получает наш резолвер, ничего о нём не зная. Тот же приём работает для любой внешней
// программы, которую приложение позовёт дальше.
//
// Прокси слушает только 127.0.0.1 и только на время работы приложения: наружу он не смотрит,
// и чужие программы в него не попадут.

import { createServer, type IncomingMessage, type Server } from "node:http";
import { connect as tcpConnect, type Socket } from "node:net";
import { resolveDoh } from "./doh";

export interface DohProxy {
  /** Что передавать внешней программе: «http://127.0.0.1:53114». */
  url: string;
  port: number;
  close(): void;
}

/** Оба конца туннеля закрываем вместе: полузакрытое соединение висит и держит порт. */
function pipeBoth(a: Socket, b: Socket): void {
  const end = () => {
    a.destroy();
    b.destroy();
  };
  a.on("error", end);
  b.on("error", end);
  a.pipe(b);
  b.pipe(a);
}

async function openUpstream(host: string, port: number, timeoutMs: number): Promise<Socket> {
  const ips = await resolveDoh(host);
  let last = "";
  // адресов у крупных сайтов много; если первый не отвечает, честно пробуем следующий
  for (const ip of ips.slice(0, 4)) {
    try {
      return await new Promise<Socket>((resolve, reject) => {
        const s = tcpConnect({ host: ip, port, timeout: timeoutMs });
        s.once("connect", () => {
          s.setTimeout(0);
          resolve(s);
        });
        s.once("timeout", () => {
          s.destroy();
          reject(new Error(`${ip}:${port} не отвечает`));
        });
        s.once("error", reject);
      });
    } catch (e) {
      last = (e as Error).message;
    }
  }
  throw new Error(`не подключиться к ${host}:${port} (${last || "адресов нет"})`);
}

/**
 * Поднять прокси. Порт выбирает система (`listen(0)`): фиксированный номер рано или поздно
 * занял бы кто-то другой, а для внешней программы номер всё равно подставляем сами.
 */
export function startDohProxy(connectTimeoutMs = 15_000): Promise<DohProxy> {
  const server: Server = createServer();

  // Обычный HTTP: переписываем строку запроса из абсолютной ссылки в путь и пересылаем как есть.
  server.on("request", (req: IncomingMessage, res) => {
    void (async () => {
      try {
        const u = new URL(req.url ?? "", "http://invalid");
        const up = await openUpstream(u.hostname, Number(u.port) || 80, connectTimeoutMs);
        const path = u.pathname + u.search;
        const head = [`${req.method} ${path} HTTP/1.1`];
        for (let i = 0; i < req.rawHeaders.length; i += 2) head.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
        up.write(head.join("\r\n") + "\r\n\r\n");
        req.pipe(up);
        up.pipe(res.socket!);
        up.on("error", () => res.socket?.destroy());
      } catch (e) {
        res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        res.end((e as Error).message);
      }
    })();
  });

  // HTTPS идёт через CONNECT: мы не расшифровываем ничего, только соединяем провода.
  // Шифрование остаётся между внешней программой и сайтом, нам видно лишь имя хоста.
  server.on("connect", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    void (async () => {
      const [host, rawPort] = (req.url ?? "").split(":");
      try {
        const up = await openUpstream(host, Number(rawPort) || 443, connectTimeoutMs);
        socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
        if (head?.length) up.write(head);
        pipeBoth(socket, up);
      } catch (e) {
        socket.end(`HTTP/1.1 502 Bad Gateway\r\n\r\n${(e as Error).message}`);
      }
    })();
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        close: () => server.close(),
      });
    });
  });
}

/**
 * Один прокси на всё приложение: открывать его на каждый поиск незачем, а закрывается он
 * сам вместе с процессом. Первый вызов поднимает, остальные получают тот же самый.
 */
let shared: Promise<DohProxy> | undefined;

export function sharedDohProxy(): Promise<DohProxy> {
  if (!shared) shared = startDohProxy();
  return shared;
}

export function stopSharedDohProxy(): void {
  void shared?.then((p) => p.close()).catch(() => {});
  shared = undefined;
}

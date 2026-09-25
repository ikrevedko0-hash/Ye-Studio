// Свой резолвер имён через DNS-over-HTTPS.
//
// Зачем это вообще понадобилось. У автора YouTube открывается в браузере, но yt-dlp его «не видит».
// Разница не в блокировке сайта, а в том, КТО переводит имя в адрес: Chrome и Firefox давно ходят
// своим DoH, а Python и Node спрашивают системный DNS. Если системный резолвер отвечает на
// www.youtube.com «такого домена нет», браузер этого даже не заметит, а всё остальное встанет.
//
// Проверено на этой машине: системный резолвер отвечает NXDOMAIN, DoH к 1.1.1.1 по IP отдаёт
// восемь адресов за доли секунды, и соединение по любому из них проходит за 0,3 с. То есть
// сеть в порядке целиком, и подменить нужен ровно один шаг — «имя → адрес».
//
// Запрос идёт на IP 1.1.1.1 напрямую (иначе пришлось бы резолвить имя резолвера тем же
// сломанным DNS), а имя для проверки сертификата задаётся отдельно через servername.

import { request } from "node:https";
import { isIP } from "node:net";

/** Публичные DoH-резолверы: адрес, по которому идём, и имя для проверки сертификата. */
const RESOLVERS: { ip: string; host: string }[] = [
  { ip: "1.1.1.1", host: "cloudflare-dns.com" },
  { ip: "8.8.8.8", host: "dns.google" },
  { ip: "9.9.9.9", host: "dns.quad9.net" },
];

interface CacheEntry {
  ips: string[];
  until: number;
}

const cache = new Map<string, CacheEntry>();

/** Минимальный срок хранения: у YouTube TTL бывает 25 секунд, а дёргать резолвер на каждый файл ни к чему. */
const MIN_TTL_MS = 60_000;
const MAX_TTL_MS = 10 * 60_000;

interface DohAnswer {
  Status: number;
  Answer?: { name: string; type: number; TTL: number; data: string }[];
}

function askOne(resolver: { ip: string; host: string }, name: string, timeoutMs: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: resolver.ip,
        servername: resolver.host, // сертификат выписан на имя, а идём мы по адресу
        port: 443,
        path: `/dns-query?name=${encodeURIComponent(name)}&type=A`,
        headers: { accept: "application/dns-json", host: resolver.host },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          if (res.statusCode !== 200) return reject(new Error(`${resolver.host} ответил ${res.statusCode}`));
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString("utf8")) as DohAnswer;
            const ips = (data.Answer ?? []).filter((a) => a.type === 1).map((a) => a.data);
            if (!ips.length) return reject(new Error(`${resolver.host}: нет адреса для ${name}`));
            const ttl = Math.min(...(data.Answer ?? []).map((a) => a.TTL || 60));
            cache.set(name, { ips, until: Date.now() + Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, ttl * 1000)) });
            resolve(ips);
          } catch (e) {
            reject(new Error(`${resolver.host}: не разобрал ответ (${(e as Error).message})`));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`${resolver.host} молчит дольше ${Math.round(timeoutMs / 1000)} с`)));
    req.on("error", reject);
    req.end();
  });
}

/**
 * Перевести имя в адреса через DoH. Резолверы пробуем по очереди: у одного бывает свой
 * сбой, а весь смысл затеи — не зависеть от единственного источника правды об адресах.
 */
export async function resolveDoh(name: string, timeoutMs = 8000): Promise<string[]> {
  if (isIP(name)) return [name];
  const hit = cache.get(name);
  if (hit && hit.until > Date.now()) return hit.ips;

  const reasons: string[] = [];
  for (const r of RESOLVERS) {
    try {
      return await askOne(r, name, timeoutMs);
    } catch (e) {
      reasons.push((e as Error).message);
    }
  }
  throw new Error(`не удалось узнать адрес ${name}: ${reasons.join("; ")}`);
}

/** Забыть накопленное — нужно проверкам, чтобы мерить настоящую работу, а не кэш. */
export function clearDohCache(): void {
  cache.clear();
}

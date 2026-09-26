// «Повторы на FirePacks»: что из пака отправить на сервер (server/packindex, POST /api/pack-check).
// Нормализацию и хеши делает сервер, сюда — сырой текст вопроса, правильные ответы и файлы вопроса.
// Отпечаток файла «crc32:размер» (как в оглавлении zip) считает главный процесс: у него байты медиа.

import { isRef, itemKind, questionItems } from "./helpers";
import { MEDIA_FOLDERS, type Package } from "./model";

export interface DupQuestion {
  at: { round: number; theme: number; question: number };
  /** «Тема / 300» — подпись в списке */
  label: string;
  text: string;
  answers: string[];
  /** Файлы вопроса в паке: папка и имя, как в content.xml */
  refs: { folder: string; name: string }[];
}

export function dupQuestions(pkg: Package): DupQuestion[] {
  const out: DupQuestion[] = [];
  (pkg.rounds ?? []).forEach((r, ri) => (r.themes ?? []).forEach((t, ti) => (t.questions ?? []).forEach((q, qi) => {
    const items = questionItems(q);
    const text = items.filter((i) => itemKind(i) === "text").map((i) => i.value.trim()).filter(Boolean).join(" ");
    const refs = items
      .filter((i) => itemKind(i) !== "text" && isRef(i) && i.value.trim())
      .map((i) => ({ folder: MEDIA_FOLDERS[itemKind(i)], name: i.value.trim() }));
    const answers = q.right.map((a) => a.trim()).filter(Boolean);
    if (!text && !refs.length && !answers.length) return;          // пустая клетка — нечего сверять
    out.push({ at: { round: ri, theme: ti, question: qi }, label: `${t.name || `Тема ${ti + 1}`} / ${q.price}`, text, answers, refs });
  })));
  return out;
}

/** Ответ сервера (server/packindex/packlib.py → check). */
export interface ServerCheck {
  results: { i: number; kind: DupKind; total: number; where: { pack: number; tq: number; price: number | null }[] }[];
  packs: Record<string, { name: string; url: string; date: number | null; authors: string }>;
  themes: Record<string, [string, string]>;
  summary: { pack: number; exact: number; media: number; answer: number }[];
  index: { builtAt: string | null; packs: number; questions: number };
}

export type DupKind = "exact" | "media" | "answer";

export interface DupPlace { pack: number; name: string; url: string; round: string; theme: string; price: number | null; date: number | null }

export interface DupHit {
  kind: DupKind;
  at: DupQuestion["at"];
  label: string;
  answer: string;
  /** Сколько всего вопросов в базе совпало; в where — самые ранние */
  total: number;
  where: DupPlace[];
}

export interface DupReport {
  checkedAt: number;
  checked: number;
  hits: DupHit[];
  /** Паки, где совпало 3+ вопроса дословно или файлом: списанный пак или ваш же, выложенный раньше */
  similar: { pack: number; name: string; url: string; count: number }[];
  base: { builtAt: string | null; packs: number; questions: number };
}

const ORDER: Record<DupKind, number> = { exact: 0, media: 1, answer: 2 };

/** Ответ сервера → то, что показывает окно проверки. */
export function toReport(qs: DupQuestion[], res: ServerCheck, now = Date.now()): DupReport {
  const place = (w: ServerCheck["results"][number]["where"][number]): DupPlace => {
    const p = res.packs[String(w.pack)];
    const th = res.themes[`${w.pack}:${Math.floor(w.tq / 1000)}`] ?? ["", ""];
    return { pack: w.pack, name: p?.name ?? `пак ${w.pack}`, url: p?.url ?? `https://firepacks.net/pack/${w.pack}`,
      round: th[0], theme: th[1], price: w.price, date: p?.date ?? null };
  };
  const hits = res.results
    .filter((r) => qs[r.i])
    .map((r) => ({ kind: r.kind, at: qs[r.i].at, label: qs[r.i].label, answer: qs[r.i].answers[0] ?? "", total: r.total, where: r.where.map(place) }))
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  const similar = res.summary
    .filter((s) => s.exact + s.media >= 3)
    .map((s) => ({ pack: s.pack, name: res.packs[String(s.pack)]?.name ?? `пак ${s.pack}`,
      url: res.packs[String(s.pack)]?.url ?? `https://firepacks.net/pack/${s.pack}`, count: s.exact + s.media }));
  return { checkedAt: now, checked: qs.length, hits, similar, base: res.index };
}

// Вопросы, которые предложил Claude, — в открытый пак без копипаста.
//
// Claude выдаёт в чате блок json (формат — «Подсказки\Как отдавать вопросы в Мастерскую.md»),
// автор копирует его, Мастерская разбирает и показывает план: куда встанет каждый вопрос.
// Здесь только чистые функции: разбор, план и вставка. Поиск и скачивание картинок — в окне.
//
// Главное правило: готовые вопросы пака не трогаем. Занятая цена — ближайшая свободная,
// тот же ответ в теме — «уже есть», и такой вопрос по умолчанию не вставляется.

import type { ContentItem, Package, Question, Theme } from "./model";
import { appendMedia, findParam, newQuestion, newTheme, OPTION_LETTERS, setOptions, setQuestionType, slotStatus } from "./helpers";

export const PROPOSAL_TYPES = ["simple", "secret", "secretPublicPrice", "stake", "stakeAll", "forAll", "noRisk"] as const;

export interface ProposalQuestion {
  price: number;
  type: string;
  text: string;
  /** Запрос для Яндекс.Картинок: картинка в вопрос. */
  image?: string;
  answer: string;
  /** Запрос для Яндекс.Картинок: картинка в ответ. */
  answerImage?: string;
  /** Ещё засчитываемые ответы. */
  accept: string[];
  options: string[];
}

export interface ProposalTheme {
  /** Номер раунда с единицы, как на табло. */
  round: number;
  name: string;
  comment?: string;
  questions: ProposalQuestion[];
}

export type ParseResult = { ok: true; themes: ProposalTheme[]; warnings: string[] } | { ok: false; error: string };

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

/** Запрос картинки: строка или объект старого формата { kind, search, what }. */
function imageQuery(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o.kind && o.kind !== "image") return undefined;
    return str(o.search) || str(o.what) || undefined;
  }
  return undefined;
}

/**
 * Разбор того, что автор скопировал из чата. Терпимый: ограждение ```json, текст вокруг,
 * лишние поля и темы без обёртки { themes } — всё проходит. Ошибка — с местом, где споткнулись.
 */
export function parseProposals(input: string): ParseResult {
  const text = input.replace(/^﻿/, "");
  const start = text.search(/[[{]/);
  if (start < 0) return { ok: false, error: "В буфере нет json. Скопируйте блок целиком кнопкой «Копировать» в чате." };
  const open = text[start];
  const end = text.lastIndexOf(open === "{" ? "}" : "]");
  if (end <= start) return { ok: false, error: "json оборван: нет закрывающей скобки. Скопируйте блок целиком." };
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    return { ok: false, error: `json не разбирается: ${(e as Error).message}` };
  }
  const list = Array.isArray(raw) ? raw : (raw as { themes?: unknown })?.themes;
  if (!Array.isArray(list) || !list.length) return { ok: false, error: "В json нет списка themes." };

  const warnings: string[] = [];
  const themes: ProposalTheme[] = [];
  list.forEach((t, ti) => {
    const o = (t ?? {}) as Record<string, unknown>;
    const name = str(o.name);
    const round = Number(o.round);
    if (!name) { warnings.push(`Тема №${ti + 1}: нет названия — пропущена`); return; }
    if (!Number.isInteger(round) || round < 1) { warnings.push(`«${name}»: нет номера раунда (round с 1) — пропущена`); return; }
    const questions: ProposalQuestion[] = [];
    (Array.isArray(o.questions) ? o.questions : []).forEach((q, qi) => {
      const x = (q ?? {}) as Record<string, unknown>;
      const answer = str(x.answer);
      const price = Number(x.price);
      if (!answer) { warnings.push(`«${name}», вопрос ${qi + 1}: нет ответа — пропущен`); return; }
      let type = str(x.type) || "simple";
      if (!(PROPOSAL_TYPES as readonly string[]).includes(type)) {
        warnings.push(`«${name}», ${answer}: тип «${type}» неизвестен — будет обычный`);
        type = "simple";
      }
      questions.push({
        price: Number.isFinite(price) && price >= 0 ? price : 0,
        type,
        text: str(x.text),
        image: imageQuery(x.image ?? x.media),
        answer,
        answerImage: imageQuery(x.answerImage ?? x.answerMedia),
        accept: Array.isArray(x.accept) ? x.accept.map(str).filter(Boolean) : [],
        options: Array.isArray(x.options) ? x.options.map(str).filter(Boolean).slice(0, OPTION_LETTERS.length) : [],
      });
    });
    if (!questions.length) { warnings.push(`«${name}»: нет вопросов — пропущена`); return; }
    themes.push({ round, name, comment: str(o.comment) || undefined, questions });
  });
  if (!themes.length) return { ok: false, error: ["Ни одного вопроса для вставки.", ...warnings].join(" ") };
  return { ok: true, themes, warnings };
}

// ---------- план ----------

export interface PlanRow {
  /** Уникален в пределах плана: «тема.вопрос». */
  key: string;
  q: ProposalQuestion;
  round: number;
  roundName: string;
  themeName: string;
  themeComment?: string;
  /** Тема уже есть в паке (иначе создастся). */
  themeExists: boolean;
  /** Цена, на которую встанет вопрос. */
  price: number;
  /** Встаёт в пустую клетку, а не новой клеткой в конец темы. */
  intoEmptySlot: boolean;
  /** Такой ответ в теме уже есть — по умолчанию не вставляем. */
  duplicate: boolean;
  /** Что не так: раунда нет и т. п. Такую строку вставить нельзя. */
  error?: string;
}

const findTheme = (themes: Theme[] | undefined, name: string) => themes?.find((t) => norm(t.name) === norm(name));

/** Сетка цен раунда: по первой теме с вопросами. Для финала — 0. */
function roundPrices(pkg: Package, ri: number): number[] {
  const r = pkg.rounds?.[ri];
  if (r?.type === "final") return [0];
  const t = r?.themes?.find((x) => x.questions?.length);
  const ps = t?.questions?.map((q) => Number(q.price) || 0) ?? [];
  return ps.length ? ps : [100, 200, 300, 400, 500].map((p) => p * (ri + 1));
}

/**
 * Куда встанет каждый вопрос. Идём по порядку: вопросы плана занимают места друг у друга
 * так же, как будут занимать при вставке, поэтому план совпадает с результатом.
 */
export function planInsert(pkg: Package, themes: ProposalTheme[]): PlanRow[] {
  const rows: PlanRow[] = [];
  // клетки, которые план уже занял: «раунд|тема» → цены
  const taken = new Map<string, number[]>();
  themes.forEach((t, ti) => {
    const ri = t.round - 1;
    const round = pkg.rounds?.[ri];
    const existing = findTheme(round?.themes, t.name);
    const slotKey = `${ri}|${norm(t.name)}`;
    const planned = taken.get(slotKey) ?? [];
    taken.set(slotKey, planned);
    const grid = roundPrices(pkg, ri);
    // клетки темы: существующие вопросы или сетка раунда для новой темы
    const cells = existing
      ? (existing.questions ?? []).map((q) => ({ price: Number(q.price) || 0, empty: slotStatus(q) === "empty" }))
      : grid.map((price) => ({ price, empty: true }));
    const answers = new Set((existing?.questions ?? []).flatMap((q) => q.right.map(norm)).filter(Boolean));

    t.questions.forEach((q, qi) => {
      const base = {
        key: `${ti}.${qi}`, q, round: t.round, roundName: round?.name ?? `Раунд ${t.round}`,
        themeName: existing?.name ?? t.name, themeComment: t.comment, themeExists: !!existing,
      };
      if (!round) {
        rows.push({ ...base, price: q.price, intoEmptySlot: false, duplicate: false, error: `в паке нет раунда ${t.round}` });
        return;
      }
      const duplicate = answers.has(norm(q.answer));
      // свободные клетки: пустые и ещё не занятые планом; ближайшая по цене, при равенстве — дешевле
      const free = cells.filter((c) => c.empty && !planned.includes(c.price));
      const exact = free.find((c) => c.price === q.price);
      const nearest = exact ?? [...free].sort((a, b) => Math.abs(a.price - q.price) - Math.abs(b.price - q.price) || a.price - b.price)[0];
      let price: number;
      let intoEmptySlot = true;
      if (nearest) price = nearest.price;
      else {
        // пустых клеток нет — новая клетка: своя цена, если она не занята, иначе следующая за самой дорогой
        intoEmptySlot = false;
        const used = [...cells.map((c) => c.price), ...planned];
        const step = grid.length > 1 ? grid[1] - grid[0] : 100;
        price = used.includes(q.price) ? Math.max(0, ...used) + (step || 100) : q.price;
        if (round.type === "final") price = 0;
      }
      // место держим и за дублем: включит его автор — встанет сюда, не толкаясь с соседями
      planned.push(price);
      if (!intoEmptySlot) cells.push({ price, empty: false });
      rows.push({ ...base, price, intoEmptySlot, duplicate });
      answers.add(norm(q.answer));
    });
  });
  return rows;
}

// ---------- вставка ----------

/** Скачанные картинки строки плана: имена файлов в Images пака. */
export interface RowMedia {
  question?: string;
  answer?: string;
}

const imageItem = (name: string): ContentItem => ({ type: "image", isRef: "True", value: name });

/** Пустой вопрос-клетка заполняется предложением Claude. */
function fill(q: Question, row: PlanRow, media: RowMedia) {
  const p = row.q;
  setQuestionType(q, p.type === "simple" ? undefined : p.type);
  q.params ??= [];
  let param = findParam(q, "question");
  if (!param) {
    param = { name: "question", type: "content", children: [] };
    q.params.unshift(param);
  }
  const lost = p.image && !media.question ? ` [🖼 найти: ${p.image}]` : "";
  const text = (p.text + lost).trim();
  let items: ContentItem[] = text ? [{ value: text }] : [];
  if (media.question) items = appendMedia(items, [imageItem(media.question)]);
  if (!items.length) items = [{ value: "" }];
  param.children = [...items.map((item) => ({ kind: "item" as const, item })), ...param.children.filter((c) => c.kind !== "item")];

  if (media.answer) {
    q.params = q.params.filter((x) => x.name !== "answer");
    q.params.push({ name: "answer", type: "content", children: [{ kind: "item", item: imageItem(media.answer) }] });
  } else if (p.answerImage) {
    q.info = { ...q.info, comments: [q.info?.comments, `🖼 к ответу найти: ${p.answerImage}`].filter(Boolean).join("\n") };
  }

  setOptions(q, p.options);
  // при вариантах SIGame засчитывает букву: ищем ответ среди вариантов
  const letter = p.options.findIndex((o) => norm(o) === norm(p.answer));
  q.right = [letter >= 0 ? OPTION_LETTERS[letter] : p.answer, ...p.accept];
}

/**
 * Вставляет выбранные строки плана в пак (пак меняется на месте). Строки берутся как есть:
 * план посчитан по этому же паку, и снятые галочки только освобождают места, а не сдвигают чужие.
 */
export function applyInsert(pkg: Package, rows: PlanRow[], media: Record<string, RowMedia> = {}): number {
  let done = 0;
  for (const row of rows) {
    if (row.error) continue;
    const round = pkg.rounds?.[row.round - 1];
    if (!round) continue;
    round.themes ??= [];
    let theme = findTheme(round.themes, row.themeName);
    if (!theme) {
      theme = newTheme(row.themeName, roundPrices(pkg, row.round - 1));
      if (row.themeComment) theme.info = { comments: row.themeComment };
      round.themes.push(theme);
    }
    theme.questions ??= [];
    let q = row.intoEmptySlot
      ? theme.questions.find((x) => (Number(x.price) || 0) === row.price && slotStatus(x) === "empty")
      : undefined;
    if (!q) {
      q = newQuestion(row.price);
      // по возрастанию цены, как на табло
      const at = theme.questions.findIndex((x) => (Number(x.price) || 0) > row.price);
      theme.questions.splice(at < 0 ? theme.questions.length : at, 0, q);
    }
    fill(q, row, media[row.key] ?? {});
    done++;
  }
  return done;
}


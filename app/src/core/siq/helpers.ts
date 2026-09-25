// Удобные операции над моделью пака. Чистые функции — работают и в интерфейсе, и в Node.

import { MEDIA_FOLDERS, type ContentItem, type Info, type Package, type Param, type ParamChild, type Question, type Round, type Theme } from "./model";

export const SPECIAL_TYPES: Record<string, string> = {
  secret: "Кот в мешке",
  secretPublicPrice: "Кот (цена известна)",
  secretNoQuestion: "Кот без вопроса",
  stake: "Аукцион",
  stakeAll: "Ставка для всех",
  noRisk: "Без риска",
  forAll: "Вопрос для всех",
};

export const SPECIAL_SHORT: Record<string, string> = {
  secret: "КОТ",
  secretPublicPrice: "КОТ",
  secretNoQuestion: "КОТ",
  stake: "СТАВКА",
  stakeAll: "СТАВКА",
  noRisk: "БЕЗ РИСКА",
  forAll: "ДЛЯ ВСЕХ",
};

export function findParam(q: Question, name: string): Param | undefined {
  return q.params?.find((p) => p.name === name);
}

/** Элементы контента параметра (question, answer, …). */
export function paramItems(p: Param | undefined): ContentItem[] {
  if (!p) return [];
  return p.children.flatMap((c) => (c.kind === "item" ? [c.item] : []));
}

export function questionItems(q: Question): ContentItem[] {
  return paramItems(findParam(q, "question"));
}

export function answerItems(q: Question): ContentItem[] {
  return paramItems(findParam(q, "answer"));
}

export function itemKind(it: ContentItem): "text" | "image" | "audio" | "video" | "html" {
  const t = (it.type ?? "text").toLowerCase();
  if (t === "image" || t === "audio" || t === "video" || t === "html") return t;
  if (t === "voice") return "audio";
  return "text";
}

export function isRef(it: ContentItem): boolean {
  return (it.isRef ?? "").toLowerCase() === "true";
}

/** waitForFinish="False": SIGame не ждёт этот элемент и сразу выводит следующий вместе с ним. */
export function isWithNext(it: ContentItem): boolean {
  return (it.waitForFinish ?? "").toLowerCase() === "false";
}

/** Включает/выключает показ элемента i вместе со следующим (атрибут пишем так же, как SIQuester). */
export function setWithNext(items: ContentItem[], i: number, on: boolean): ContentItem[] {
  return items.map((it, j) => {
    if (j !== i) return it;
    const { waitForFinish: _, ...rest } = it;
    return on ? { ...rest, waitForFinish: "False" } : rest;
  });
}

/** Группы элементов, которые игра показывает одним экраном: по индексам, в исходном порядке. */
export function contentGroups(items: ContentItem[]): number[][] {
  const groups: number[][] = [];
  let cur: number[] = [];
  items.forEach((it, i) => {
    cur.push(i);
    if (!isWithNext(it) || i === items.length - 1) {
      groups.push(cur);
      cur = [];
    }
  });
  return groups;
}

/**
 * Добавляет медиа в вопрос. Если последним стоит текст — медиа встаёт перед ним и выходит на один
 * экран с ним: SIGame раскладывает группу сверху вниз в порядке пака, так текст окажется под картинкой,
 * а вопрос не затянется показом по очереди. Иначе — просто в конец.
 */
export function appendMedia(items: ContentItem[], added: ContentItem[]): ContentItem[] {
  if (!added.length) return items;
  const last = items[items.length - 1];
  const caption = last && itemKind(last) === "text" && last.value.trim() !== "" && (last.placement ?? "screen") === "screen";
  if (!caption) return [...items, ...added];
  const screen = added.filter((it) => it.placement !== "background");
  const background = added.filter((it) => it.placement === "background");
  const linked = screen.map((it) => ({ ...it, waitForFinish: "False" }));
  return [...items.slice(0, -1), ...background, ...linked, last];
}

// ---------- время показа, как считает SIGame (SICore GameController, TimeSettings по умолчанию) ----------

export const GAME_TIME = {
  /** картинка без duration */
  image: 5,
  /** скорость чтения текста, символов в секунду */
  readingSpeed: 20,
  /** пауза на обдумывание после текста, если за ним что-то идёт (или это ответ) */
  reflection: 2,
  /** шаг элемента с waitForFinish="False" */
  noWait: 0.1,
  /** потолок ожидания звука и видео */
  mediaCap: 120,
  /** на нажатие кнопки, если в вопросе нет answerDuration */
  button: 5,
};

/** "00:00:10" → 10; пусто или мусор → undefined. */
export function parseDuration(d: string | undefined): number | undefined {
  if (!d) return undefined;
  const parts = d.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return undefined;
  const s = parts.reduce((acc, n) => acc * 60 + n, 0);
  return s > 0 ? s : undefined;
}

/**
 * Сколько секунд игра держит элемент. Своё время (duration) SIGame берёт у любого элемента как есть:
 * у текста оно заменяет чтение, у звука и видео — ровно столько, конца файла не ждём
 * (GameController.OnContent…: CollectMediaCompletions только без duration). Пауза на обдумывание
 * к тексту — в ответе всегда, в вопросе — только если за ним что-то идёт и своего времени нет.
 * Для звука и видео без duration — undefined: до конца файла (но не дольше GAME_TIME.mediaCap).
 */
export function itemGameTime(it: ContentItem, isLast: boolean, inAnswer = false): number | undefined {
  if (isWithNext(it)) return GAME_TIME.noWait;
  const own = parseDuration(it.duration);
  switch (itemKind(it)) {
    case "text":
      return (own ?? it.value.length / GAME_TIME.readingSpeed) + (inAnswer || (!isLast && own === undefined) ? GAME_TIME.reflection : 0);
    case "audio":
    case "video":
      return own;
    default:
      return own ?? GAME_TIME.image;
  }
}

/** Время по умолчанию, если своё не задано: для подсказки в поле. undefined — звук/видео «до конца». */
export function itemDefaultTime(it: ContentItem, isLast: boolean, inAnswer = false): number | undefined {
  const { duration: _, ...rest } = it;
  return itemGameTime(rest, isLast, inAnswer);
}

/** 40 → "00:00:40", 2.5 → "00:00:02.5", 75 → "00:01:15" (TimeSpan, как пишет SIQuester). */
export function formatDuration(sec: number): string {
  const whole = Math.floor(sec);
  const frac = Math.round((sec - whole) * 10) / 10;
  const two = (n: number) => String(n).padStart(2, "0");
  const ss = two(whole % 60) + (frac > 0 ? String(frac).slice(1) : "");
  return `${two(Math.floor(whole / 3600))}:${two(Math.floor(whole / 60) % 60)}:${ss}`;
}

/** Своё время элемента в секундах; 0, пусто или мусор — убрать (игра возьмёт своё по умолчанию). */
export function withDuration(it: ContentItem, sec: number | undefined): ContentItem {
  const { duration: _, ...rest } = it;
  return sec !== undefined && Number.isFinite(sec) && sec > 0 ? { ...rest, duration: formatDuration(sec) } : rest;
}

/**
 * Время по умолчанию, которое мастерская ставит сама (решение автора, 2026-09-25): вопрос показывается
 * 10 с, «найди на картинке» — 40 с, на кнопку (сжимающаяся рамка) — 10 с. SIGame своих умолчаний
 * (картинка 5 с, текст по скорости чтения, кнопка 5 с) автору мало.
 */
export const TIME_DEFAULTS = { question: 10, point: 40, button: 10 };

/**
 * Какому элементу вопроса достаётся время показа по умолчанию: последнему на экране, если это текст
 * или картинка и ни у одного элемента нет своего времени. Звук и видео не трогаем — со своим временем
 * SIGame обрезала бы их. -1 — умолчание не нужно.
 */
export function defaultTimedIndex(items: ContentItem[]): number {
  if (items.some((it) => parseDuration(it.duration) !== undefined)) return -1;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.placement === "background" || it.placement === "replic" || it.value.trim() === "") continue;
    const kind = itemKind(it);
    return (kind === "text" || kind === "image") && !isWithNext(it) ? i : -1;
  }
  return -1;
}

export const questionDefaultSec = (q: Question) => (isPointQuestion(q) ? TIME_DEFAULTS.point : TIME_DEFAULTS.question);

/** Вопрос с проставленными умолчаниями времени (копия; исходный не меняется). */
export function withTimeDefaults(q: Question): Question {
  const copy: Question = structuredClone(q);
  const p = findParam(copy, "question");
  const items = paramItems(p);
  const i = defaultTimedIndex(items);
  // paramItems отдаёт сами элементы копии — правим на месте
  if (p && i >= 0) items[i].duration = formatDuration(questionDefaultSec(copy));
  if (answerDuration(copy) === undefined) setAnswerDuration(copy, TIME_DEFAULTS.button);
  return copy;
}

/** Проставляет умолчания времени во всех вопросах пака, кроме финала. Возвращает, сколько вопросов поменялось. */
export function applyTimeDefaults(pkg: Package): number {
  let changed = 0;
  for (const r of pkg.rounds ?? []) {
    if (r.type === "final") continue;
    for (const t of r.themes ?? []) {
      t.questions = (t.questions ?? []).map((q) => {
        if (slotStatus(q) === "empty") return q;
        const next = withTimeDefaults(q);
        if (JSON.stringify(next) === JSON.stringify(q)) return q;
        changed++;
        return next;
      });
    }
  }
  return changed;
}

export interface ClearCommentsOptions {
  /** Очищать ли showmanComments (комментарии ведущему). По умолчанию true. */
  showman?: boolean;
}

/** Все блоки info пака: сам пак, раунды, темы, вопросы. */
function* allInfos(pkg: Package): Generator<Info> {
  if (pkg.info) yield pkg.info;
  for (const r of pkg.rounds ?? []) {
    if (r.info) yield r.info;
    for (const t of r.themes ?? []) {
      if (t.info) yield t.info;
      for (const q of t.questions ?? []) if (q.info) yield q.info;
    }
  }
}

const hasText = (s: string | undefined) => !!s && s.trim() !== "";

/** Сколько непустых комментариев удалит clearAllComments с теми же опциями. Пак не меняет. */
export function countComments(pkg: Package, opts: ClearCommentsOptions = {}): number {
  const showman = opts.showman ?? true;
  let n = 0;
  for (const info of allInfos(pkg)) n += +hasText(info.comments) + +(showman && hasText(info.showmanComments));
  return n;
}

/** Убирает comments (и, если не отключено опцией, showmanComments) на уровнях пака, раунда, темы и вопроса.
 * Правит pkg на месте. Возвращает число удалённых непустых комментариев. */
export function clearAllComments(pkg: Package, opts: ClearCommentsOptions = {}): number {
  const showman = opts.showman ?? true;
  const removed = countComments(pkg, opts);
  for (const info of allInfos(pkg)) {
    delete info.comments;
    if (showman) delete info.showmanComments;
  }
  return removed;
}

/** answerDuration — секунды на кнопку (или на ответ в вопросе без кнопки); undefined — по настройкам игры. */
export function answerDuration(q: Question): number | undefined {
  const d = Number(findParam(q, "answerDuration")?.text);
  return Number.isFinite(d) && d > 0 ? d : undefined;
}

export function setAnswerDuration(q: Question, sec: number | undefined) {
  if (sec === undefined || !Number.isFinite(sec) || sec <= 0) {
    q.params = (q.params ?? []).filter((p) => p.name !== "answerDuration");
    return;
  }
  setParamText(q, "answerDuration", String(Math.round(sec)));
}

export function questionText(q: Question): string {
  return questionItems(q).filter((i) => itemKind(i) === "text").map((i) => i.value).join(" ").trim();
}

export function isAnswerOptions(q: Question): boolean {
  return findParam(q, "answerType")?.text === "select";
}

export type SlotStatus = "empty" | "draft" | "ready";

/** empty — нет ни вопроса, ни ответа; ready — есть содержимое вопроса и ответ; иначе draft. У точки ответ — поставленная точка. */
export function slotStatus(q: Question): SlotStatus {
  const hasContent = questionItems(q).some((i) => i.value.trim() !== "");
  const hasAnswer = isPointQuestion(q) ? !!pointAnswer(q) && !!pointImage(q) : q.right.some((a) => a.trim() !== "");
  if (!hasContent && !hasAnswer) return "empty";
  return hasContent && hasAnswer ? "ready" : "draft";
}

/** Все элементы с медиа по всему паку (включая ответы и варианты). */
export function allItems(pkg: Package): { q: Question; item: ContentItem }[] {
  const out: { q: Question; item: ContentItem }[] = [];
  const walk = (q: Question, p: Param) => {
    for (const c of p.children) {
      if (c.kind === "item") out.push({ q, item: c.item });
      else if (c.kind === "param") walk(q, c.param);
    }
  };
  for (const r of pkg.rounds ?? []) for (const t of r.themes ?? []) for (const q of t.questions ?? []) for (const p of q.params ?? []) walk(q, p);
  return out;
}

/** Все элементы темы, включая ответ и варианты ответа. */
function themeItems(t: Theme): ContentItem[] {
  const out: ContentItem[] = [];
  const walk = (p: Param) => {
    for (const c of p.children) {
      if (c.kind === "item") out.push(c.item);
      else if (c.kind === "param") walk(c.param);
    }
  };
  for (const q of t.questions ?? []) for (const p of q.params ?? []) walk(p);
  return out;
}

/** Файлы пака, на которые ссылается тема: папка (Images/Audio/Video/Html) и имя, без повторов. */
export function themeMediaRefs(t: Theme): { folder: string; name: string }[] {
  const seen = new Map<string, { folder: string; name: string }>();
  for (const it of themeItems(t)) {
    if (!isRef(it) || !it.value) continue;
    const folder = MEDIA_FOLDERS[itemKind(it)];
    if (folder) seen.set(`${folder}/${it.value}`, { folder, name: it.value });
  }
  return [...seen.values()];
}

/** Меняет имена файлов в ссылках темы по таблице «папка/старое имя» → новое имя. */
export function renameThemeMedia(t: Theme, renames: Map<string, string>): void {
  if (!renames.size) return;
  for (const it of themeItems(t)) {
    if (!isRef(it)) continue;
    const to = renames.get(`${MEDIA_FOLDERS[itemKind(it)]}/${it.value}`);
    if (to) it.value = to;
  }
}

export interface PackStats {
  rounds: number;
  themes: number;
  questions: number;
  ready: number;
  draft: number;
  empty: number;
  specials: number;
  /** Доли вопросов по главному типу медиа в вопросе (как на FirePacks). */
  byKind: Record<"text" | "image" | "audio" | "video", number>;
}

export function packStats(pkg: Package): PackStats {
  const s: PackStats = { rounds: 0, themes: 0, questions: 0, ready: 0, draft: 0, empty: 0, specials: 0, byKind: { text: 0, image: 0, audio: 0, video: 0 } };
  for (const r of pkg.rounds ?? []) {
    s.rounds++;
    for (const t of r.themes ?? []) {
      s.themes++;
      for (const q of t.questions ?? []) {
        s.questions++;
        s[slotStatus(q)]++;
        if (q.type && q.type !== "simple") s.specials++;
        const kinds = new Set(questionItems(q).filter((i) => i.value.trim() !== "").map(itemKind));
        const main = kinds.has("video") ? "video" : kinds.has("audio") ? "audio" : kinds.has("image") ? "image" : kinds.has("text") ? "text" : null;
        if (main) s.byKind[main]++;
      }
    }
  }
  return s;
}

// ---------- спецвопросы ----------

export const SECRET_TYPES = new Set(["secret", "secretPublicPrice", "secretNoQuestion"]);

/**
 * Меняет тип вопроса. Для «кота в мешке» добавляет параметры, которые пишет SIQuester:
 * selectionMode (exceptCurrent — отдать любому, кроме себя), price (numberSet 0/0/0 — как в большинстве паков), theme.
 */
export function setQuestionType(q: Question, type: string | undefined) {
  q.type = type || undefined;
  q.params ??= [];
  const secretNames = ["selectionMode", "price", "theme"];
  if (type && SECRET_TYPES.has(type)) {
    if (!findParam(q, "selectionMode")) q.params.push({ name: "selectionMode", text: "exceptCurrent", children: [] });
    if (!findParam(q, "price")) q.params.push({ name: "price", type: "numberSet", children: [{ kind: "numberSet", numberSet: { minimum: "0", maximum: "0", step: "0" } }] });
    if (!findParam(q, "theme")) q.params.push({ name: "theme", text: "", children: [] });
  } else {
    q.params = q.params.filter((p) => !secretNames.includes(p.name ?? ""));
  }
}

export function setParamText(q: Question, name: string, text: string) {
  const p = findParam(q, name);
  if (p) p.text = text;
  else (q.params ??= []).push({ name, text, children: [] });
}

export function secretPrice(q: Question): { minimum: string; maximum: string } {
  const ns = findParam(q, "price")?.children.find((c) => c.kind === "numberSet");
  return ns?.kind === "numberSet" ? { minimum: ns.numberSet.minimum ?? "0", maximum: ns.numberSet.maximum ?? "0" } : { minimum: "0", maximum: "0" };
}

export function setSecretPrice(q: Question, minimum: string, maximum: string) {
  const p = findParam(q, "price");
  if (!p) return;
  p.children = [{ kind: "numberSet", numberSet: { minimum, maximum, step: "0" } }];
}

// ---------- варианты ответа ----------

export const OPTION_LETTERS = "ABCDEFGHIJ".split("");

export interface AnswerOption {
  letter: string;
  text: string;
}

export function getOptions(q: Question): AnswerOption[] {
  const group = findParam(q, "answerOptions");
  if (!group) return [];
  return group.children.flatMap((c) =>
    c.kind === "param" ? [{ letter: c.param.name ?? "", text: paramItems(c.param).map((i) => i.value).join(" ") }] : [],
  );
}

/**
 * Пустой список — убрать варианты. Иначе answerType=select + answerOptions (A, B, C…); правильный ответ — буква.
 * Допуск (answerDeviation) у вариантов не бывает — SIQuester его снимает, и мы тоже.
 */
export function setOptions(q: Question, options: string[]) {
  q.params = (q.params ?? []).filter((p) => p.name !== "answerType" && p.name !== "answerOptions");
  if (!options.length) return;
  q.params = q.params.filter((p) => p.name !== "answerDeviation");
  q.params.push({ name: "answerType", text: "select", children: [] });
  q.params.push({
    name: "answerOptions",
    type: "group",
    children: options.map((text, i) => ({
      kind: "param" as const,
      param: { name: OPTION_LETTERS[i], type: "content", children: [{ kind: "item" as const, item: { value: text } }] },
    })),
  });
}

// ---------- ответ точкой на картинке ----------
//
// answerType=point: игрок щёлкает по картинке, SIGame засчитывает попадание сама.
// Правильный ответ — первый в <right>: "x,y,ширина/высота", x и y — доли картинки от левого верхнего угла,
// всё округлено до 0,01 (так пишет SIQuester, SelectPointView). Остальные ответы — подсказки ведущему.
// answerDeviation — радиус зоны в долях ВЫСОТЫ картинки: SIGame умножает x на ширину/высоту и берёт
// обычное расстояние, допуск меньше 0,02 не бывает (SICore AnswerChecker.IsPointAnswerRight).
// Точку ставят по ПОСЛЕДНЕМУ элементу вопроса, и это должна быть картинка (PointAnswerViewModel).

export const POINT_DEVIATION = { def: 0.1, min: 0.02, max: 0.3 };

export interface PointAnswer {
  x: number;
  y: number;
  /** ширина / высота картинки; 1 — если в ответе только "x,y" */
  ratio: number;
}

export function isPointQuestion(q: Question): boolean {
  return findParam(q, "answerType")?.text === "point";
}

/** "0.38,0.48,1.78" или "0.38,0.48" → точка; иначе undefined. */
export function parsePoint(s: string | undefined): PointAnswer | undefined {
  const parts = (s ?? "").split(",").map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => p === "")) return undefined;
  const [x, y, ratio = 1] = parts.map(Number);
  if (![x, y, ratio].every(Number.isFinite)) return undefined;
  return { x, y, ratio: ratio > 0 ? ratio : 1 };
}

/** Число так, как его печатает .NET после Math.Round(v, 2): 0.4, 1, 0.07. */
const round2 = (v: number) => String(Math.round(v * 100) / 100);

export function formatPoint(p: PointAnswer): string {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return `${round2(clamp(p.x))},${round2(clamp(p.y))},${round2(p.ratio)}`;
}

export function pointAnswer(q: Question): PointAnswer | undefined {
  return parsePoint(q.right[0]);
}

export function pointDeviation(q: Question): number {
  const d = Number(findParam(q, "answerDeviation")?.text);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

/** Картинка, по которой ставят точку: последний элемент вопроса, если это картинка. */
export function pointImage(q: Question): ContentItem | undefined {
  const items = questionItems(q).filter((it) => it.value.trim() !== "");
  const last = items[items.length - 1];
  return last && itemKind(last) === "image" ? last : undefined;
}

/** Попал ли щелчок (доли картинки) в зону — ровно как считает SIGame. */
export function pointHit(right: PointAnswer, deviation: number, click: { x: number; y: number }): boolean {
  const dx = (right.x - click.x) * right.ratio;
  const dy = right.y - click.y;
  return Math.hypot(dx, dy) <= Math.max(POINT_DEVIATION.min, deviation);
}

/**
 * Включает/выключает ответ точкой. Включение снимает варианты ответа и ставит допуск по умолчанию;
 * текстовые ответы, что уже были, остаются ниже точки — ведущему как подсказка. Выключение убирает
 * тип, допуск и саму точку из ответов.
 */
export function setPointMode(q: Question, on: boolean) {
  if (on) {
    q.params = (q.params ?? []).filter((p) => p.name !== "answerOptions" && !(p.name === "answerType" && p.text !== "point"));
    setParamText(q, "answerType", "point");
    if (!(pointDeviation(q) > 0)) setParamText(q, "answerDeviation", String(POINT_DEVIATION.def));
    if (!pointAnswer(q)) {
      // буква от вариантов ответа («A») подсказкой не нужна
      const texts = q.right.filter((a) => a.trim() !== "" && !/^[A-J]$/.test(a.trim()));
      q.right = ["", ...texts];
    }
    return;
  }
  q.params = (q.params ?? []).filter((p) => p.name !== "answerType" && p.name !== "answerDeviation");
  const rest = q.right.filter((a, i) => !(i === 0 && (parsePoint(a) || a === "")));
  q.right = rest.length ? rest : [""];
}

export function setPoint(q: Question, p: PointAnswer) {
  if (q.right.length) q.right[0] = formatPoint(p);
  else q.right = [formatPoint(p)];
}

export function setPointDeviation(q: Question, d: number) {
  setParamText(q, "answerDeviation", round2(Math.max(POINT_DEVIATION.min, Math.min(POINT_DEVIATION.max, d))));
}

/** Что не так с вопросом-точкой; пустой список — всё в порядке. naturalRatio — ширина/высота файла, если известна. */
export function pointProblems(q: Question, naturalRatio?: number): string[] {
  if (!isPointQuestion(q)) return [];
  const out: string[] = [];
  if (!pointImage(q)) out.push("последним в вопросе должна стоять картинка — по ней щёлкают игроки");
  const p = pointAnswer(q);
  if (!p) out.push("точка не поставлена: щёлкните по картинке в редакторе");
  else if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) out.push("точка за краем картинки");
  else if (naturalRatio && Math.abs(naturalRatio - p.ratio) > 0.02) out.push("картинку заменили после разметки — поставьте точку заново");
  const d = pointDeviation(q);
  if (d < 0.05) out.push("допуск меньше 0,05 — попасть почти невозможно");
  else if (d > POINT_DEVIATION.max) out.push("допуск больше 0,3 — засчитает почти любой щелчок");
  return out;
}

// ---------- замена картинки обработанной (пиксели, проявление) ----------

/**
 * Меняет картинку name в содержимом вопроса на replacement (одну или несколько — проявление).
 * Оригинал кладётся в ответ, если медиа в ответе ещё нет: так ведущий и игроки увидят, что было
 * под пикселями. Возвращает, лёг ли оригинал в ответ (иначе его надо сберечь в source/).
 */
export function replaceQuestionImage(q: Question, name: string, replacement: ContentItem[]): { originalInAnswer: boolean; replaced: boolean } {
  const p = findParam(q, "question");
  if (!p) return { originalInAnswer: false, replaced: false };
  let replaced = false;
  p.children = p.children.flatMap((c): ParamChild[] => {
    if (c.kind !== "item" || itemKind(c.item) !== "image" || c.item.value !== name) return [c];
    replaced = true;
    // «одновременно со следующим» остаётся у последнего из замены, как было у исходного
    const tail = isWithNext(c.item);
    return replacement.map((item, i) => {
      const { waitForFinish: _, ...rest } = item;
      return { kind: "item" as const, item: i === replacement.length - 1 && tail ? { ...rest, waitForFinish: "False" } : rest };
    });
  });
  if (!replaced) return { originalInAnswer: false, replaced };
  if (answerItems(q).some((it) => it.value.trim() !== "")) return { originalInAnswer: false, replaced };
  const original: ContentItem = { type: "image", isRef: "True", value: name };
  const answer = findParam(q, "answer");
  if (answer) answer.children = [...answer.children.filter((c) => c.kind !== "item"), { kind: "item", item: original }];
  else (q.params ??= []).push({ name: "answer", type: "content", children: [{ kind: "item", item: original }] });
  return { originalInAnswer: true, replaced };
}

/** Ссылается ли ещё кто-то в паке на файл (папка по типу элемента). */
export function isMediaUsed(pkg: Package, folder: string, name: string): boolean {
  return allItems(pkg).some(({ item }) => isRef(item) && item.value === name && MEDIA_FOLDERS[itemKind(item)] === folder);
}

// ---------- создание ----------

export function newQuestion(price: number): Question {
  return {
    price: String(price),
    params: [{ name: "question", type: "content", children: [{ kind: "item", item: { value: "" } }] }],
    right: [""],
  };
}

export function newTheme(name: string, prices: number[]): Theme {
  return { name, questions: prices.map(newQuestion) };
}

export function newRound(name: string, themes: number, prices: number[], final = false): Round {
  return {
    name,
    type: final ? "final" : undefined,
    themes: Array.from({ length: themes }, (_, i) => newTheme(`Тема ${i + 1}`, final ? [0] : prices)),
  };
}

function uuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? "00000000-0000-4000-8000-" + Date.now().toString(16).padStart(12, "0");
}

/** Шаблон пака: 3 раунда по 6 тем × 5 вопросов + финал из 7 тем (как в «Уе!паках»). */
export function newPackage(name = "Новый пак"): Package {
  const today = new Date();
  const date = `${String(today.getDate()).padStart(2, "0")}.${String(today.getMonth() + 1).padStart(2, "0")}.${today.getFullYear()}`;
  return {
    attrs: [
      ["name", name],
      ["version", "5"],
      ["id", uuid()],
      ["date", date],
      ["language", "ru-RU"],
      ["xmlns", "https://github.com/VladimirKhil/SI/blob/master/assets/siq_5.xsd"],
    ],
    order: ["tags", "info", "rounds"],
    tags: [],
    info: { authors: [""] },
    rounds: [
      newRound("Раунд 1", 6, [100, 200, 300, 400, 500]),
      newRound("Раунд 2", 6, [200, 400, 600, 800, 1000]),
      newRound("Раунд 3", 6, [300, 600, 900, 1200, 1500]),
      newRound("ФИНАЛ", 7, [0], true),
    ],
  };
}

// ---------- медиа ----------

export const MEDIA_EXT: Record<string, "image" | "audio" | "video"> = {
  jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image", bmp: "image",
  mp3: "audio", wav: "audio", ogg: "audio", m4a: "audio", aac: "audio", flac: "audio",
  mp4: "video", webm: "video", mkv: "video", mov: "video", avi: "video",
};

export function mediaKindByName(file: string): "image" | "audio" | "video" | undefined {
  return MEDIA_EXT[file.split(".").pop()?.toLowerCase() ?? ""];
}

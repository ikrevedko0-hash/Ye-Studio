// Перестановки на табло и свойства пака.
// Цену вопроса автор ставит любую (не обязательно с шагом 100) — тема просто держится по возрастанию.
// При перетаскивании набор цен темы не меняется: вопрос берёт цену клетки, на которую его бросили,
// остальные сдвигаются вместе со своими местами.

import type { Package, Round, Theme } from "./model";

export interface Slot {
  theme: number;
  question: number;
}

/** Куда попал вопрос, стоявший в slot до перестановки. */
export type Relocate = (slot: Slot) => Slot;

const priceNum = (p: string | undefined) => {
  const n = Number(p);
  return p !== undefined && p.trim() !== "" && Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
};

/**
 * Разложить вопросы темы по возрастанию цены. Равные цены и нечисловые сохраняют
 * взаимный порядок (нечисловые — в конце). Возвращает order: order[новое место] = старое место.
 */
export function sortThemeByPrice(theme: Theme): number[] {
  const qs = theme.questions ?? [];
  const order = qs.map((_, i) => i).sort((a, b) => priceNum(qs[a].price) - priceNum(qs[b].price) || a - b);
  theme.questions = order.map((i) => qs[i]);
  return order;
}

/** Уже по порядку — тогда и трогать нечего. */
export function isSortedByPrice(theme: Theme): boolean {
  const qs = theme.questions ?? [];
  return qs.every((q, i) => i === 0 || priceNum(qs[i - 1].price) <= priceNum(q.price));
}

/** Цены мест темы: как стоят сейчас, по возрастанию. */
function slotPrices(theme: Theme): string[] {
  return (theme.questions ?? []).map((q) => q.price).sort((a, b) => priceNum(a) - priceNum(b));
}

/** Цена для нового места в конце темы: шаг берём из двух последних цен. */
function nextPrice(prices: string[]): string {
  const nums = prices.map(Number).filter(Number.isFinite);
  if (!nums.length) return "100";
  const last = nums[nums.length - 1];
  if (nums.every((n) => n === 0)) return "0"; // финал
  const step = nums.length > 1 ? last - nums[nums.length - 2] : last;
  return String(last + (step || 100));
}

/**
 * Перенести вопрос на место to (вставкой: остальные сдвигаются). Цены остаются за местами.
 * В другой теме вопрос встаёт перед to.question; to.question = длине темы — в конец.
 * Возвращает, куда уехал каждый вопрос раунда.
 */
export function moveQuestion(round: Round, from: Slot, to: Slot): Relocate {
  const themes = round.themes ?? [];
  const src = themes[from.theme];
  const dst = themes[to.theme];
  const same = from.theme === to.theme;
  const identity: Relocate = (s) => s;
  if (!src?.questions?.[from.question] || !dst) return identity;

  const srcPrices = slotPrices(src);
  const dstPrices = same ? srcPrices : slotPrices(dst);
  const [q] = src.questions.splice(from.question, 1);
  const dq = (dst.questions ??= []);
  const at = Math.max(0, Math.min(to.question, dq.length));
  if (same && at === from.question) {
    dq.splice(at, 0, q);
    return identity;
  }
  dq.splice(at, 0, q);

  if (same) dq.forEach((x, i) => { x.price = srcPrices[i]; });
  else repriceAfterTransfer(src, srcPrices, dst, dstPrices);

  return (s) => {
    if (s.theme === from.theme && s.question === from.question) return { theme: to.theme, question: at };
    let { theme, question } = s;
    if (theme === from.theme && question > from.question) question--;
    if (theme === to.theme && question >= at) question++;
    return { theme, question };
  };
}

/** Вопрос ушёл из src в dst: src теряет старшую цену, dst получает следующую по своей шкале. */
function repriceAfterTransfer(src: Theme, srcPrices: string[], dst: Theme, dstPrices: string[]) {
  src.questions?.forEach((x, i) => { x.price = srcPrices[i]; });
  const prices = [...dstPrices, nextPrice(dstPrices)];
  dst.questions?.forEach((x, i) => { x.price = prices[i]; });
}

/**
 * Перенести вопрос в конец темы другого раунда (или другой темы этого же). Цены — как при
 * перетаскивании в чужую тему. Возвращает место вопроса в новой теме или -1.
 */
export function moveQuestionTo(pkg: Package, fromRound: number, from: Slot, toRound: number, toTheme: number): number {
  if (fromRound === toRound) {
    const r = pkg.rounds?.[fromRound];
    if (!r || from.theme === toTheme) return -1;
    const at = r.themes?.[toTheme]?.questions?.length ?? 0;
    return moveQuestion(r, from, { theme: toTheme, question: at })(from).question;
  }
  const src = pkg.rounds?.[fromRound]?.themes?.[from.theme];
  const dst = pkg.rounds?.[toRound]?.themes?.[toTheme];
  if (!src?.questions?.[from.question] || !dst) return -1;
  const srcPrices = slotPrices(src);
  const dstPrices = slotPrices(dst);
  const [q] = src.questions.splice(from.question, 1);
  (dst.questions ??= []).push(q);
  repriceAfterTransfer(src, srcPrices, dst, dstPrices);
  return dst.questions.length - 1;
}

/**
 * Перенести тему в конец другого раунда. Цены берутся по шкале раунда-приёмника (ряд его первой
 * темы, дальше тем же шагом): тема из первого раунда во втором должна стоить как второй раунд.
 * В пустой раунд тема идёт со своими ценами. Возвращает номер темы в новом раунде или -1.
 */
export function moveTheme(pkg: Package, fromRound: number, themeIndex: number, toRound: number): number {
  const src = pkg.rounds?.[fromRound];
  const dst = pkg.rounds?.[toRound];
  if (!src?.themes?.[themeIndex] || !dst || fromRound === toRound) return -1;
  const scale = dst.themes?.[0]?.questions?.map((q) => q.price);
  const [theme] = src.themes.splice(themeIndex, 1);
  if (scale?.length) {
    const prices = [...scale];
    while (prices.length < (theme.questions?.length ?? 0)) prices.push(nextPrice(prices));
    theme.questions?.forEach((q, i) => { q.price = prices[i]; });
  }
  (dst.themes ??= []).push(theme);
  return dst.themes.length - 1;
}

// ---------- свойства пака ----------

/** Порядок атрибутов <package>, как их пишет SIQuester. */
const ATTR_ORDER = ["name", "version", "id", "restriction", "date", "publisher", "contactUri", "difficulty", "logo", "language", "xmlns"];

/** Поставить атрибут пака на его штатное место; пустое значение убирает атрибут (кроме name). */
export function setPackAttr(pkg: Package, name: string, value: string): void {
  const i = pkg.attrs.findIndex(([k]) => k === name);
  if (value === "" && name !== "name") {
    if (i >= 0) pkg.attrs.splice(i, 1);
    return;
  }
  if (i >= 0) {
    pkg.attrs[i][1] = value;
    return;
  }
  const rank = ATTR_ORDER.indexOf(name);
  const before = rank < 0 ? -1 : pkg.attrs.findIndex(([k]) => {
    const r = ATTR_ORDER.indexOf(k);
    return r > rank;
  });
  if (before < 0) {
    // неизвестный атрибут — перед xmlns, если он есть
    const x = pkg.attrs.findIndex(([k]) => k === "xmlns");
    pkg.attrs.splice(x < 0 ? pkg.attrs.length : x, 0, [name, value]);
  } else pkg.attrs.splice(before, 0, [name, value]);
}

/** Логотип хранится как logo="@имя" и ссылается на файл в Images/. */
export function packLogo(pkg: Package): string | undefined {
  const v = pkg.attrs.find(([k]) => k === "logo")?.[1];
  return v?.startsWith("@") ? v.slice(1) : v || undefined;
}

export function setPackLogo(pkg: Package, file: string | undefined): void {
  setPackAttr(pkg, "logo", file ? `@${file}` : "");
}

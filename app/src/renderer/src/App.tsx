import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History } from "../../core/history";
import { flushSync } from "react-dom";
import { isSortedByPrice, moveQuestion, moveQuestionTo, moveTheme, sortThemeByPrice, type Relocate, type Slot } from "../../core/siq/board";
import { appendMedia, applyTimeDefaults, packStats, paramItems } from "../../core/siq/helpers";
import type { Package, Round } from "../../core/siq/model";
import type { DraftInfo, MediaInfo, PackDTO, WordHit } from "../../shared/api";
import { Board } from "./Board";
import { CollageEditor } from "./CollageEditor";
import { Feedback } from "./Feedback"; // ---------- связь с сервером автора ----------
import { ImageEditor } from "./ImageEditor";
import { MediaCenter } from "./MediaCenter";
import { ProposalsPaste } from "./ProposalsPaste";
import { applyInsert } from "../../core/siq/proposals";
import { MediaLibrary } from "./MediaLibrary";
import { MediaEditor } from "./MediaEditor";
import { PackProps } from "./PackProps";
import { Publish } from "./Publish";
import { RoundTabs } from "./RoundTabs";
import { QuestionEditor } from "./QuestionEditor";
import { PackSize } from "./PackSize";
import { PackCheck, type DupState } from "./PackCheck";
import { WordStudio } from "./WordStudio";
import { AiSettings } from "./AiSettings";
import { Components } from "./Components";
import { AssistantSetup } from "./AssistantSetup";
import type { FirstRunOptions } from "../../shared/api";
import { ThemeSwitch } from "./ThemeSwitch";
import { ThemeTransfer } from "./ThemeTransfer";
import { TopBar } from "./TopBar";
import { UpdateBanner } from "./UpdateBanner"; // ---------- обновления ----------
import { Icon } from "./Icon";

export interface Selection {
  round: number;
  theme: number;
  question: number;
}

export type Mutate = (fn: (pkg: Package) => void) => void;

type WithTransition = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };

export function App() {
  const [pack, setPack] = useState<PackDTO | null>(null);
  const [dirty, setDirty] = useState(false);
  const [round, setRound] = useState(0);
  const [sel, setSel] = useState<Selection | null>(null);
  const [status, setStatus] = useState("");
  const [selfTestEditor, setSelfTestEditor] = useState<MediaInfo | null>(null);
  const [selfTestCollage, setSelfTestCollage] = useState(false);
  const [mediaCenter, setMediaCenter] = useState(false);
  const [library, setLibrary] = useState(false);
  const [wordStudio, setWordStudio] = useState(false);
  const [aiSettings, setAiSettings] = useState(false);
  const [proposals, setProposals] = useState(false);
  const [components, setComponents] = useState(false);
  const [packProps, setPackProps] = useState(false);
  const [packSize, setPackSize] = useState(false);
  const [publish, setPublish] = useState(false);
  const [packCheck, setPackCheck] = useState(false);
  const [dups, setDups] = useState<DupState>({ exclude: [] });
  /** несохранённый пак, оставшийся после сбоя, — предлагаем восстановить на заставке */
  const [draft, setDraft] = useState<DraftInfo | null>(null);
  useEffect(() => { void window.api.draftInfo().then(setDraft); }, []);
  // ---------- связь с сервером автора ----------
  const [feedback, setFeedback] = useState(false);
  /** Имена view-transition клеток на время перестановки: «тема-место» → имя, которое было у вопроса до неё. */
  const [vtNames, setVtNames] = useState<Map<string, string> | null>(null);
  // мастер первого запуска: после установщика или на машине без ffmpeg окно «Компоненты» открывается само
  const [firstRun, setFirstRun] = useState<FirstRunOptions | null>(null);
  useEffect(() => {
    void window.api.firstRun().then((o) => { if (o) { setFirstRun(o); setComponents(true); } });
    void window.api.assistantStatus().then((s) => { if (s.ask) setAssistant("first"); });
  }, []);
  // мастер чат-помощника: «first» — сам при первом запуске на машине (после «Компонентов»), «manual» — кнопка 🤝
  const [assistant, setAssistant] = useState<"first" | "manual" | null>(null);
  const [transfer, setTransfer] = useState<{ round: number; theme: number } | null>(null);
  // Ширина правой колонки: её тянут мышью, значение переживает перезапуск.
  // Хранится на диске, а не в localStorage: окно грузится по http с локального сервера,
  // и при смене адреса прежнее хранилище страницы оказалось бы пустым.
  const [editorWidth, setEditorWidth] = useState(() => {
    const saved = window.api.ui.editorWidth ?? 0;
    return saved >= 320 && saved <= 1200 ? saved : 460;
  });
  const [dragging, setDragging] = useState(false);

  // ---------- отмена правок (Ctrl+Z / Ctrl+Y) ----------
  // Каждая правка даёт новый объект pkg, поэтому история — просто ссылки на прежние состояния.
  // Её пишет эффект ниже при любой смене pkg; загрузка пака историю сбрасывает, отмена и сохранение — не пишут.
  const history = useRef(new History<Package>());
  const lastPkg = useRef<Package | null>(null);
  /** следующая смена pkg — не правка автора: "reset" — новый пак, "skip" — отмена/повтор/сохранение */
  const pkgChange = useRef<"reset" | "skip" | null>(null);
  useEffect(() => {
    const pkg = pack?.pkg ?? null;
    if (pkg === lastPkg.current) return;
    if (pkgChange.current === "reset") history.current.reset();
    else if (pkgChange.current !== "skip" && lastPkg.current && pkg) history.current.record(lastPkg.current, Date.now());
    pkgChange.current = null;
    lastPkg.current = pkg;
  }, [pack?.pkg]);

  const load = useCallback((d: PackDTO | null) => {
    if (!d) return;
    pkgChange.current = "reset";
    setPack(d);
    setDirty(false);
    setRound(0);
    setSel(null);
  }, []);

  useEffect(() => window.api.onSelfTestLoad((d) => {
    load(d);
    setSel({ round: 0, theme: 0, question: 1 });
    if (d.openEditorMedia) setSelfTestEditor(d.openEditorMedia);
    if (d.openCollage) setSelfTestCollage(true);
  }), [load]);

  const mutate: Mutate = useCallback((fn) => {
    setPack((prev) => {
      if (!prev) return prev;
      const pkg = structuredClone(prev.pkg);
      fn(pkg);
      return { ...prev, pkg };
    });
    setDirty(true);
  }, []);

  /**
   * Перестановка вопросов в раунде: change правит копию раунда и говорит, куда уехал каждый вопрос
   * (null — менять нечего). Выбор едет вместе с вопросом, а клетки плавно переезжают: на время
   * перехода каждая клетка носит имя, которое было у её вопроса на старом месте.
   */
  const reorder = useCallback((ri: number, change: (r: Round) => Relocate | null) => {
    if (!pack) return;
    const pkg = structuredClone(pack.pkg);
    const r = pkg.rounds?.[ri];
    const where = r && change(r);
    if (!where) return;
    const names = new Map<string, string>();
    (pack.pkg.rounds?.[ri]?.themes ?? []).forEach((t, ti) => t.questions?.forEach((_, qi) => {
      const s = where({ theme: ti, question: qi });
      names.set(`${s.theme}-${s.question}`, `bq-${ti}-${qi}`);
    }));
    const apply = () => {
      setPack((prev) => (prev ? { ...prev, pkg } : prev));
      setDirty(true);
      setSel((s) => (s && s.round === ri ? { round: ri, ...where({ theme: s.theme, question: s.question }) } : s));
      setVtNames(names);
    };
    const doc = document as WithTransition;
    if (!doc.startViewTransition) { apply(); setVtNames(null); return; }
    void doc.startViewTransition(() => flushSync(apply)).finished.finally(() => setVtNames(null));
  }, [pack]);

  const moveQ = useCallback((ri: number, from: Slot, to: Slot) => reorder(ri, (r) => moveQuestion(r, from, to)), [reorder]);

  const roundName = (i: number) => pack?.pkg.rounds?.[i]?.name || `Раунд ${i + 1}`;

  /** Тема в конец другого раунда; выбор внутри старого раунда сдвигается за оставшимися темами. */
  const themeToRound = useCallback((from: number, ti: number, to: number) => {
    const theme = pack?.pkg.rounds?.[from]?.themes?.[ti];
    if (from === to || !theme || !pack?.pkg.rounds?.[to]) return;
    const name = theme.name;
    mutate((p) => { moveTheme(p, from, ti, to); });
    setSel((s) => (s && s.round === from && s.theme >= ti ? (s.theme === ti ? null : { ...s, theme: s.theme - 1 }) : s));
    setStatus(`Тема «${name}» перенесена в конец раунда «${roundName(to)}», цены — по шкале этого раунда`);
  }, [pack, mutate]);

  /** Выбранный вопрос — в конец темы to (в этом или другом раунде). */
  const questionTo = useCallback((toRound: number, toTheme: number) => {
    if (!sel || !pack) return;
    const target = pack.pkg.rounds?.[toRound]?.themes?.[toTheme];
    if (!target) return;
    const at = target.questions?.length ?? 0;
    const from = sel;
    mutate((p) => { moveQuestionTo(p, from.round, { theme: from.theme, question: from.question }, toRound, toTheme); });
    if (toRound === from.round) setSel({ round: toRound, theme: toTheme, question: at });
    else {
      setSel(null);
      setStatus(`Вопрос перенесён в «${roundName(toRound)} › ${target.name}» (в конец темы)`);
    }
  }, [sel, pack, mutate]);

  /** Цену поменяли в редакторе — клетка встаёт на место по цене. */
  const sortTheme = useCallback((ri: number, ti: number) => reorder(ri, (r) => {
    const t = r.themes?.[ti];
    if (!t || isSortedByPrice(t)) return null;
    const order = sortThemeByPrice(t);
    const to = new Map(order.map((old, now) => [old, now]));
    return (s) => (s.theme === ti ? { theme: ti, question: to.get(s.question) ?? s.question } : s);
  }), [reorder]);

  // редактор медиа кладёт в пак новый файл — добавляем его в список
  useEffect(() => {
    const handler = (e: Event) => {
      const created = (e as CustomEvent<MediaInfo>).detail;
      setPack((prev) => (prev && !prev.media.some((m) => m.folder === created.folder && m.name === created.name)
        ? { ...prev, media: [...prev.media, created] } : prev));
      setDirty(true);
    };
    window.addEventListener("media-created", handler as EventListener);
    // оригинал ушёл из пака в source/ (пикселизация) — убираем из списка
    const removed = (e: Event) => {
      const { folder, name } = (e as CustomEvent<{ folder: string; name: string }>).detail;
      setPack((prev) => (prev ? { ...prev, media: prev.media.filter((m) => !(m.folder === folder && m.name === name)) } : prev));
      setDirty(true);
    };
    window.addEventListener("media-removed", removed as EventListener);
    return () => {
      window.removeEventListener("media-created", handler as EventListener);
      window.removeEventListener("media-removed", removed as EventListener);
    };
  }, []);

  const addMedia = useCallback(async (paths?: string[]): Promise<MediaInfo[]> => {
    const added = await window.api.addMedia(paths);
    if (added.length) {
      setPack((prev) => (prev ? { ...prev, media: [...prev.media, ...added] } : prev));
      setDirty(true);
    }
    return added;
  }, []);

  /**
   * Тема из подобранных слов: по вопросу на слово, ответ уже проставлен.
   * Цены берём из соседней темы этого же раунда — иначе новая тема не встанет в табло ровно.
   */
  const addThemeFromWords = useCallback((title: string, hits: WordHit[]) => {
    let used = 0;
    let dropped = 0;
    mutate((p) => {
      const r = p.rounds?.[round];
      if (!r) return;
      r.themes ??= [];
      const prices = r.themes[0]?.questions?.map((q) => Number(q.price) || 0) ?? [];
      // тема должна встать в табло ровно: берём столько слов, сколько в раунде цен
      const take = prices.length || 5;
      const chosen = hits.slice(0, take);
      used = chosen.length;
      dropped = hits.length - used;
      r.themes.push({
        name: title,
        questions: chosen.map((h, i) => ({
          price: String(prices[i] ?? (i + 1) * 100),
          params: [{ name: "question", type: "content", children: [{ kind: "item" as const, item: { value: h.question ?? h.why } }] }],
          right: [h.word],
        })),
      });
    });
    setStatus(
      `Тема «${title}» создана: ${used} вопросов, ответы проставлены — тексты за вами`
      + (dropped ? `. Остальные ${dropped} слов не вошли: в раунде ${used} цен` : ""),
    );
  }, [mutate, round]);

  /**
   * Одна находка из студии слов в открытый вопрос: загадка становится текстом вопроса,
   * само слово — ответом. Прежний текст не затираем, а дописываем: вдруг там уже есть медиа.
   *
   * После вставки выбор сам переходит на следующий вопрос темы. Без этого второе нажатие
   * складывало вторую загадку в ту же клетку, и на одном вопросе оказывалась вся матрица.
   */
  const insertWord = useCallback((hit: WordHit) => {
    if (!sel) return;
    // Сколько вопросов в теме, знаем ДО изменения: функция внутри mutate выполняется отложенно,
    // и признак «есть куда переходить», посчитанный там, оказывался ложным со второго нажатия —
    // все слова, кроме первого, ложились в один и тот же вопрос.
    const inTheme = pack?.pkg.rounds?.[sel.round]?.themes?.[sel.theme]?.questions?.length ?? 0;
    const moved = sel.question + 1 < inTheme;
    mutate((p) => {
      const theme = p.rounds?.[sel.round]?.themes?.[sel.theme];
      const q = theme?.questions?.[sel.question];
      if (!q) return;
      q.params ??= [];
      let param = q.params.find((x) => x.name === "question");
      if (!param) {
        param = { name: "question", type: "content", children: [] };
        q.params.push(param);
      }
      // у инициалов текст вопроса пишет автор: пустой question значит «ставим только ответ»
      const text = hit.question ?? hit.why;
      const items = param.children.filter((c) => c.kind === "item");
      const empty = items.find((c) => c.item && !c.item.type && !c.item.value.trim());
      if (text && empty?.item) empty.item.value = text;
      else if (text) param.children.push({ kind: "item", item: { value: text } });
      q.right = [hit.word];
    });
    if (moved) setSel({ ...sel, question: sel.question + 1 });
    setStatus(
      (hit.question === "" ? `Ответ «${hit.word}»` : `«${hit.question ?? hit.why}» → ответ «${hit.word}»`)
      + (moved ? ". Перешёл к следующему вопросу темы" : ". Это был последний вопрос темы — дальше выберите вопрос сами"),
    );
  }, [mutate, sel, pack]);

  /** Новый файл пака из генератора картинок: главный процесс его уже зарегистрировал, окну надо узнать. */
  const imageAdded = useCallback((img: MediaInfo) => {
    setPack((prev) => (prev ? { ...prev, media: [...prev.media, img] } : prev));
    setDirty(true);
  }, []);

  /**
   * Сгенерированная картинка в открытый вопрос, фраза — в ответ. Устроено как insertWord:
   * число вопросов темы считаем до mutate, после вставки выбор переходит к следующему вопросу.
   */
  const insertImage = useCallback((img: MediaInfo, answer: string) => {
    if (!sel) return;
    imageAdded(img);
    const inTheme = pack?.pkg.rounds?.[sel.round]?.themes?.[sel.theme]?.questions?.length ?? 0;
    const moved = sel.question + 1 < inTheme;
    mutate((p) => {
      const q = p.rounds?.[sel.round]?.themes?.[sel.theme]?.questions?.[sel.question];
      if (!q) return;
      q.params ??= [];
      let param = q.params.find((x) => x.name === "question");
      if (!param) {
        param = { name: "question", type: "content", children: [] };
        q.params.push(param);
      }
      // пустую текстовую заготовку заменяем картинкой, чтобы в вопросе не висел пустой текст
      const empty = param.children.findIndex((c) => c.kind === "item" && c.item && !c.item.type && !c.item.value.trim());
      const item = { kind: "item" as const, item: { type: "image", isRef: "True", value: img.name } };
      if (empty >= 0) param.children[empty] = item;
      else {
        // к готовому тексту — картинкой над ним, одним экраном (как в редакторе вопроса)
        const joined = appendMedia(paramItems(param), [item.item]);
        param.children = [...joined.map((it) => ({ kind: "item" as const, item: it })), ...param.children.filter((c) => c.kind !== "item")];
      }
      if (answer) q.right = [answer];
    });
    if (moved) setSel({ ...sel, question: sel.question + 1 });
    setStatus(
      `Картинка → ответ «${answer}»`
      + (moved ? ". Перешёл к следующему вопросу темы" : ". Это был последний вопрос темы — дальше выберите вопрос сами"),
    );
  }, [mutate, sel, pack, imageAdded]);

  // перетаскивание границы между табло и редактором вопроса
  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => {
      // табло оставляем хотя бы 300 px: дальше оно ужимается раскладкой, а не пропадает
      const w = Math.min(1200, window.innerWidth - 300, Math.max(320, window.innerWidth - e.clientX));
      setEditorWidth(w);
    };
    const up = () => {
      setDragging(false);
      void window.api.setUi("editorWidth", editorWidth);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    // пока тянем, текст выделяться не должен — иначе курсор «цепляет» табло
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.userSelect = "";
    };
  }, [dragging, editorWidth]);

  const guard = () => !dirty || window.confirm("Есть несохранённые изменения. Продолжить без сохранения?");

  const actions = {
    mediaCenter: () => setMediaCenter(true),
    library: () => setLibrary(true),
    wordStudio: () => setWordStudio(true),
    aiSettings: () => setAiSettings(true),
    proposals: () => setProposals(true),
    components: () => setComponents(true),
    assistant: () => setAssistant("manual"),
    packProps: () => setPackProps(true),
    packSize: () => setPackSize(true),
    publish: () => setPublish(true),
    // ---------- связь с сервером автора ----------
    // снимок — сразу по нажатию 💬, до открытия модалки (иначе в кадр попадёт сама модалка)
    feedback: () => { void window.api.feedbackCapture().then(() => setFeedback(true)); },
    newPack: async () => guard() && load(await window.api.newPack()),
    open: async () => guard() && load(await window.api.openPack()),
    check: () => setPackCheck(true),
    openBackups: () => { void window.api.openBackups(); },
    /** SIGame сама пак не откроет: сохраняем, запускаем игру, путь — в буфер (вставить в «Добавить пакет»). */
    openInSigame: async () => {
      if (!pack) return;
      const path = dirty || !pack.path ? await actions.save(false) : pack.path;
      if (!path) return;
      const r = await window.api.openInSigame(path);
      setStatus(r.ok
        ? "SIGame запускается. Путь к паку скопирован — в SIGame «Добавить пакет» → Ctrl+V"
        : "SIGame не найдена (ни в AppData, ни в Steam). Путь к паку скопирован в буфер");
    },
    save: async (saveAs: boolean): Promise<string | undefined> => {
      if (!pack) return;
      setStatus("Сохраняю…");
      try {
        // время по умолчанию мастерской (10 с показ, 40 с «найди», 10 с кнопка) — туда, где своего нет
        const pkg = structuredClone(pack.pkg);
        const timed = applyTimeDefaults(pkg);
        const saved = await window.api.savePack(pkg, saveAs);
        if (saved) {
          // после сохранения pkg — новый объект с тем же содержимым: это не правка, историю не пишем
          pkgChange.current = "skip";
          setPack(saved);
          setDirty(false);
          setStatus(`Сохранено: ${saved.path}${timed ? ` · время по умолчанию проставлено в ${timed} вопр.` : ""}`);
          return saved.path;
        } else setStatus("");
      } catch (e) {
        setStatus(`Ошибка сохранения: ${(e as Error).message}`);
      }
    },
  };

  /** Ctrl+Z / Ctrl+Y: вернуть пак к прежнему состоянию; выбор и раунд подтягиваются, если их больше нет. */
  const step = (dir: "undo" | "redo") => {
    if (!pack) return;
    const pkg = dir === "undo" ? history.current.undo(pack.pkg) : history.current.redo(pack.pkg);
    if (!pkg) { setStatus(dir === "undo" ? "Отменять нечего" : "Повторять нечего"); return; }
    pkgChange.current = "skip";
    setPack({ ...pack, pkg });
    setDirty(true);
    const n = pkg.rounds?.length ?? 0;
    if (round >= n) setRound(Math.max(0, n - 1));
    setSel((s) => (s && pkg.rounds?.[s.round]?.themes?.[s.theme]?.questions?.[s.question] ? s : null));
    setStatus(dir === "undo" ? "Отменено (Ctrl+Y — вернуть)" : "Возвращено");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // в полях ввода Ctrl+Z отменяет набранный текст — это делает само поле
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      const k = e.key.toLowerCase();
      if (e.ctrlKey && !typing && (k === "z" || k === "я")) { e.preventDefault(); step(e.shiftKey ? "redo" : "undo"); }
      if (e.ctrlKey && !typing && (k === "y" || k === "н")) { e.preventDefault(); step("redo"); }
      if (e.ctrlKey && e.key.toLowerCase() === "s") { e.preventDefault(); void actions.save(e.shiftKey); }
      if (e.ctrlKey && e.key.toLowerCase() === "o") { e.preventDefault(); void actions.open(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------- черновик на случай сбоя: раз в 3 минуты, если есть несохранённое и оно поменялось ----------
  const latest = useRef({ pack, dirty });
  latest.current = { pack, dirty };
  const draftPkg = useRef<Package | null>(null);
  useEffect(() => {
    const t = setInterval(() => {
      const { pack: p, dirty: d } = latest.current;
      if (!p || !d || p.pkg === draftPkg.current) return;
      draftPkg.current = p.pkg;
      void window.api.draftWrite(p.pkg).catch(() => { draftPkg.current = null; });
    }, 3 * 60_000);
    return () => clearInterval(t);
  }, []);

  const restoreDraft = async () => {
    const d = await window.api.draftRestore();
    setDraft(null);
    if (!d) return;
    load(d);
    setDirty(true);
    setStatus(d.path ? `Восстановлен несохранённый пак — Ctrl+S сохранит его в ${d.path}` : "Восстановлен несохранённый пак — сохраните его (Ctrl+S)");
  };

  // для самопроверки без человека: текущее состояние пака доступно из main через executeJavaScript
  useEffect(() => { (window as unknown as { __pack?: unknown }).__pack = pack?.pkg; }, [pack]);
  useEffect(() => { window.api.setDirty(dirty); }, [dirty]);

  const stats = useMemo(() => (pack ? packStats(pack.pkg) : null), [pack]);

  const componentsWindow = components && (
    <Components
      firstRun={firstRun ?? undefined}
      onClose={() => {
        setComponents(false);
        if (firstRun) { setFirstRun(null); void window.api.firstRunDone(); }
      }}
    />
  );
  // первый запуск: сначала «Компоненты» (ffmpeg, yt-dlp), помощник — после них, а не поверх
  const assistantWindow = assistant && !components && (
    <AssistantSetup first={assistant === "first"} onClose={() => setAssistant(null)} />
  );

  if (!pack) {
    return (
      <div className="welcome">
        <h1>
          <span className="logo-ye">Ye!</span>Studio{" "}
          <span className="beta-badge" title="Бета-тест: возможны ошибки. Сообщите о них через обратную связь">БЕТА</span>
        </h1>
        <p>Планирование, медиа и сборка паков для «Своей игры».</p>
        <div className="welcome-actions">
          <button className="primary" onClick={actions.newPack}>Новый пак</button>
          <button onClick={actions.open}>Открыть .siq</button>
          <button onClick={actions.components} title="Проверка машины, ffmpeg, yt-dlp и локальная модель картинок"><Icon name="puzzle" />Компоненты</button>
          <button onClick={actions.assistant} title="Писать вопросы с Claude или ChatGPT: разметка в браузере и вставка в пак"><Icon name="helper" />Помощник</button>
        </div>
        {draft && (
          <div className="draft-banner">
            <span>
              Остался несохранённый пак <b>«{draft.name}»</b> от {new Date(draft.time).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
              {" "}— похоже, мастерская закрылась без сохранения.
            </span>
            <button className="primary" onClick={() => void restoreDraft()}>Восстановить</button>
            <button onClick={() => { void window.api.draftDiscard(); setDraft(null); }}>Выбросить</button>
          </div>
        )}
        <ThemeSwitch />
        {componentsWindow}
        {assistantWindow}
        <UpdateBanner />
      </div>
    );
  }

  const rounds = pack.pkg.rounds ?? [];
  const current = rounds[round];

  return (
    <div className="app">
      <TopBar pack={pack} dirty={dirty} stats={stats!} status={status} mutate={mutate} actions={actions} />
      <RoundTabs
        rounds={rounds}
        current={round}
        mutate={mutate}
        onPick={(i) => { setRound(i); setSel(null); }}
        onMoved={(map) => { setRound((r) => map(r)); setSel((s) => (s ? { ...s, round: map(s.round) } : s)); }}
        onRemoved={(i) => { setRound((r) => Math.max(0, r > i || r === rounds.length - 1 ? r - 1 : r)); setSel(null); }}
        onThemeDrop={themeToRound}
      />
      <main className="workspace">
        {current ? (
          <Board round={current} roundIndex={round} media={pack.media} selection={sel} onSelect={setSel} mutate={mutate} vtNames={vtNames} onMove={(from, to) => moveQ(round, from, to)} onTransfer={(ti) => setTransfer({ round, theme: ti })}
                 rounds={rounds.map((r, i) => r.name || `Раунд ${i + 1}`)} onThemeToRound={(ti, to) => themeToRound(round, ti, to)} />
        ) : (
          <div className="empty-note">В паке нет раундов.</div>
        )}
        <div
          className={`splitter${dragging ? " active" : ""}`}
          onMouseDown={(e) => { e.preventDefault(); setDragging(true); }}
          onDoubleClick={() => { setEditorWidth(460); void window.api.setUi("editorWidth", 460); }}
          title="Тяните, чтобы изменить ширину. Двойной щелчок — вернуть как было"
        />
        <div className="editor-col" style={{ width: editorWidth }}>
          <QuestionEditor pack={pack} selection={sel} mutate={mutate} addMedia={addMedia} onPriceCommit={() => sel && sortTheme(sel.round, sel.theme)} onMoveTo={questionTo} />
        </div>
      </main>
      {selfTestEditor && (selfTestEditor.folder === "Images" ? (
        <ImageEditor media={selfTestEditor} onClose={() => setSelfTestEditor(null)} onDone={() => setSelfTestEditor(null)} />
      ) : (
        <MediaEditor media={selfTestEditor} onClose={() => setSelfTestEditor(null)} onDone={() => setSelfTestEditor(null)} />
      ))}
      {wordStudio && (
        <WordStudio
          onClose={() => setWordStudio(false)}
          onCreateTheme={(title, hits) => addThemeFromWords(title, hits)}
          onInsert={sel ? insertWord : undefined}
          onInsertImage={sel ? insertImage : undefined}
          onImageAdded={imageAdded}
          onOpenAi={() => setAiSettings(true)}
          themeSize={rounds[round]?.themes?.[0]?.questions?.length || undefined}
          insertTarget={sel ? `${rounds[sel.round]?.themes?.[sel.theme]?.name ?? ""} · ${rounds[sel.round]?.themes?.[sel.theme]?.questions?.[sel.question]?.price ?? ""}` : undefined}
        />
      )}
      {/* после студии: настройки, открытые из «Картинок», должны лечь поверх неё */}
      {aiSettings && <AiSettings onClose={() => setAiSettings(false)} />}
      {componentsWindow}
      {assistantWindow}
      {packSize && <PackSize pack={pack} mutate={mutate} onClose={() => setPackSize(false)} />}
      {packCheck && (
        <PackCheck
          pack={pack}
          dups={dups}
          setDups={setDups}
          onClose={() => setPackCheck(false)}
          onPackSize={() => { setPackCheck(false); setPackSize(true); }}
          onSigame={() => { setPackCheck(false); void actions.openInSigame(); }}
          onGo={(at) => {
            setPackCheck(false);
            setRound(at.round);
            setSel(at.theme !== undefined && at.question !== undefined ? { round: at.round, theme: at.theme, question: at.question } : null);
          }}
        />
      )}
      {packProps && <PackProps pack={pack} mutate={mutate} addMedia={addMedia} onClose={() => setPackProps(false)} />}
      {publish && <Publish pack={pack} onClose={() => setPublish(false)} />}
      {transfer && pack.pkg.rounds?.[transfer.round]?.themes?.[transfer.theme] && (
        <ThemeTransfer
          theme={pack.pkg.rounds[transfer.round].themes![transfer.theme]}
          final={pack.pkg.rounds[transfer.round].type === "final"}
          onClose={() => setTransfer(null)}
          onDone={(r, cut) => {
            const { round: ri, theme: ti } = transfer;
            const name = pack.pkg.rounds?.[ri]?.themes?.[ti]?.name ?? "";
            if (cut) {
              mutate((p) => { p.rounds?.[ri]?.themes?.splice(ti, 1); });
              if (sel?.round === ri) setSel(null);
            }
            const target = r.path.split(/[\\/]/).pop();
            setStatus(
              `Тема «${name}» ${cut ? "вырезана" : "скопирована"} в «${target}»: файлов ${r.copied}`
              + (r.reused ? `, уже были там ${r.reused}` : "")
              + (r.renamed.length ? `, переименованы (имя было занято): ${r.renamed.join(", ")}` : "")
              + (r.missing.length ? `. Нет в паке и не перенесены: ${r.missing.join(", ")}` : "")
              + (cut ? ". Сохраните этот пак, чтобы тема ушла и из него" : ""),
            );
            setTransfer(null);
          }}
        />
      )}
      {proposals && (
        <ProposalsPaste
          pkg={pack.pkg}
          onClose={() => setProposals(false)}
          onInsert={(rows, media, files) => {
            if (files.length) setPack((prev) => (prev ? { ...prev, media: [...prev.media, ...files] } : prev));
            mutate((p) => { applyInsert(p, rows, media); });
            const lost = rows.filter((r) => (r.q.image && !media[r.key]?.question) || (r.q.answerImage && !media[r.key]?.answer)).length;
            const themes = new Set(rows.map((r) => `${r.round}|${r.themeName}`)).size;
            setStatus(`Из AI: вставлено вопросов ${rows.length} в тем ${themes}, картинок ${files.length}`
              + (lost ? `. Без картинки ${lost} — у них пометка «🖼 найти»` : "") + ". Сохраните пак");
          }}
        />
      )}
      {mediaCenter && (
        <MediaCenter onClose={() => setMediaCenter(false)} onAdded={() => {}} />
      )}
      {library && (
        <MediaLibrary onClose={() => setLibrary(false)} onAdded={() => {}} />
      )}
      {selfTestCollage && (
        <CollageEditor media={pack.media} addMedia={addMedia} onClose={() => setSelfTestCollage(false)} onDone={() => setSelfTestCollage(false)} />
      )}
      <UpdateBanner />
      {/* ---------- связь с сервером автора ---------- */}
      {feedback && <Feedback onClose={() => setFeedback(false)} />}
    </div>
  );
}

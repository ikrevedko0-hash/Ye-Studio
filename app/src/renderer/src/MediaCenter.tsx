// Медиацентр: поиск по внешним источникам, предпросмотр, загрузка в пак.
//
// Сеть целиком в главном процессе: окно только показывает найденное и говорит, что скачать.
// Оригинал уходит в source/ рядом с паком, копия — в пак, дальше её правят обычными редакторами.

import { useCallback, useEffect, useRef, useState } from "react";
import { CookiesPanel } from "./CookiesPanel";
import type { Diagnosis, FetchProgress, MediaInfo, MediaResult, MediaType, ProviderInfo } from "../../shared/api";
import { Icon } from "./Icon";

interface Props {
  /** Куда предлагать вставить найденное: подпись на главной кнопке. */
  target?: "question" | "answer";
  onClose(): void;
  /** Файл лёг в пак. Если задан target — его ещё и вставляют в вопрос. */
  onAdded(media: MediaInfo): void;
}

const TYPES: { id: MediaType; label: string }[] = [
  { id: "image", label: "Картинки" },
  { id: "audio", label: "Звук" },
  { id: "video", label: "Видео" },
];

/** IPC оборачивает ошибку главного процесса в «Error invoking remote method…» — автору пака это лишнее. */
const plainError = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "");

const mb = (n?: number) => (n ? `${(n / 1024 / 1024).toFixed(1)} МБ` : "");
const mmss = (s?: number) => (s === undefined ? "" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);

/** Медиа длиннее полминуты FirePacks помечает жёлтой плашкой — предупреждаем заранее. */
const LONG_SEC = 30;

/**
 * Время из поля ввода в секунды: «29:55», «1:02:03», «12», «12,5».
 * Пишут по-разному, а переспрашивать автора из-за двоеточия — последнее дело.
 */
function parseTime(text: string): number | undefined {
  const t = text.trim().replace(",", ".");
  if (!t) return undefined;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(t);
  if (!m) return undefined;
  const min = Number(m[2]);
  const sec = Number(m[3]);
  if (min > 59 || sec >= 60) return undefined;
  return Number(m[1] ?? 0) * 3600 + min * 60 + sec;
}

/** Отрезок умеют только источники, которые качает yt-dlp: он один тянет кусок, а не весь файл. */
const CAN_CLIP = new Set(["youtube", "rutube", "instagram"]);

/** Номер ролика YouTube из ссылки на страницу — для обложки и «смотреть рядом». */
function youtubeId(r: MediaResult): string | undefined {
  return /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{6,})/.exec(r.pageUrl ?? "")?.[1];
}

/**
 * Ссылка на плеер YouTube.
 *
 * Про `origin`. Плеер спрашивает «откуда меня открыли» тремя способами сразу, и отвечать
 * приходится на все: заголовком `Referer` (его подставляет главный процесс), настоящим
 * адресом окна (ради него окно грузится по http с локального сервера — см. `rendererServer.ts`)
 * и вот этим параметром в ссылке. По одному ни один из трёх не сработал: на `file://` отказ
 * шёл с кодом 153, после `Referer` — 152, и только адрес окна закрывает вопрос целиком.
 *
 * Запрет владельца ролика этим не обходится: если показ вне YouTube закрыт, отказ останется,
 * и под плеером об этом написано прямо.
 */
// Сейчас встроенный плеер YouTube в предпросмотре не показывается (см. `poster`): с адреса VPN он
// через раз требует «подтвердите, что вы не бот», и вместо него ролик открывается в Chrome рядом.
// Куки загрузчика окну не передаются — живая сессия в окне быстро портила выгруженный файл.
function ytEmbed(id: string): string {
  return `https://www.youtube.com/embed/${id}?origin=${encodeURIComponent("https://www.youtube.com")}`;
}

/**
 * Ссылка на встроенный плеер — чтобы посмотреть ролик до загрузки, а не после.
 * Берём youtube-nocookie: он не ставит рекламные куки. Другие сайты, которые умеет yt-dlp,
 * плеера не дают — там останется кнопка «Источник».
 */
function embedUrl(r: MediaResult): string | undefined {
  const url = r.pageUrl ?? "";
  const yt = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{6,})/.exec(url);
  if (yt) return ytEmbed(yt[1]);
  if (r.providerId === "youtube" && /^[\w-]{6,}$/.test(r.id)) return ytEmbed(r.id);
  const ig = /instagram\.com\/(p|reel|tv)\/([\w-]+)/.exec(url);
  if (ig) return `https://www.instagram.com/${ig[1]}/${ig[2]}/embed`;
  const rt = /rutube\.ru\/video\/([\da-f]{16,})/.exec(url);
  if (rt) return `https://rutube.ru/play/embed/${rt[1]}`;
  if (r.providerId === "rutube") return `https://rutube.ru/play/embed/${r.id}`;
  return undefined;
}

/**
 * Миниатюра с запасным путём: Openverse иногда отдаёт ссылку на превью, которая не открывается.
 * Тогда показываем сам файл, а если и он не открылся — значок вместо битой картинки.
 */
function Thumb({ r }: { r: MediaResult }) {
  const chain = [r.thumbUrl, r.previewUrl].filter(Boolean) as string[];
  const [step, setStep] = useState(0);
  useEffect(() => { setStep(0); }, [r.thumbUrl, r.previewUrl]);
  if (step >= chain.length) return <span className="mc-noimg"><Icon name={r.type === "audio" ? "audio" : r.type === "video" ? "video" : "image"} size={34} /></span>;
  return <img src={chain[step]} alt="" onError={() => setStep((n) => n + 1)} />;
}

export function MediaCenter({ target, onClose, onAdded }: Props) {
  const [type, setType] = useState<MediaType>("image");
  const [text, setText] = useState("");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [only, setOnly] = useState<string[]>([]);
  const [results, setResults] = useState<MediaResult[]>([]);
  const [errors, setErrors] = useState<{ providerId: string; message: string }[]>([]);
  const [searching, setSearching] = useState(false);
  /** Кто уже ответил, кто ещё думает. Ключ — источник, значение — что с ним. */
  const [waiting, setWaiting] = useState<{ id: string; title: string; state: "ждём" | "готово" | "отказ"; count?: number; ms?: number }[]>([]);
  /** Номер текущего поиска: ответы прошлого запроса окно обязано выбросить. */
  const job = useRef(0);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<MediaResult | null>(null);
  const [progress, setProgress] = useState<FetchProgress | null>(null);
  const [note, setNote] = useState("");
  /** Удалась ли последняя загрузка: успех видно зелёным и в панели предпросмотра, а не только строкой сверху. */
  const [noteOk, setNoteOk] = useState<boolean | null>(null);
  const [lastDone, setLastDone] = useState<{ key: string; name: string } | null>(null);
  /** Панель куков YouTube и почему её открыли (пусто — открыли кнопкой). */
  const [cookies, setCookies] = useState<{ reason?: string } | null>(null);
  /** Какой дорогой сейчас ходит загрузчик — чтобы было видно, заметило ли приложение VPN. */
  const [route, setRoute] = useState("");
  const [preview, setPreview] = useState<MediaResult | null>(null);
  /** Итог проверки дороги до YouTube. Показывается только когда её запросили. */
  const [diag, setDiag] = useState<Diagnosis | null>(null);
  const [diagRunning, setDiagRunning] = useState(false);
  /**
   * Потолок качества для видео. По умолчанию 720p: ролик в игре показывают в окне,
   * а «лучшее доступное» на YouTube — это запросто 4K на полгигабайта, и такой пак
   * никто не скачает. Выбор живёт между запусками: он у автора один на все паки.
   */
  const [maxHeight, setMaxHeight] = useState<number>(() => {
    // Значение лежит на диске (ui-settings.json), а не в хранилище страницы: окно грузится
    // по http с локального сервера, и при смене адреса localStorage начинался бы с нуля.
    // Ноль здесь — это «как есть», поэтому отсутствие записи и ноль надо различать:
    // на этом уже обжигались, и первый запуск качал 4K вместо 720p.
    const saved = window.api.ui.ytMaxHeight;
    return saved !== undefined && [0, 360, 480, 720, 1080].includes(saved) ? saved : 720;
  });
  useEffect(() => { void window.api.setUi("ytMaxHeight", maxHeight); }, [maxHeight]);
  /** Отрезок ролика: что набрал автор, как есть. Разбираем при каждом изменении. */
  const [clipFrom, setClipFrom] = useState("");
  const [clipTo, setClipTo] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { void window.api.mediaProviders().then(setProviders); }, []);
  const refreshRoute = useCallback(() => { void window.api.mediaRoute().then((r) => setRoute(r.label), () => setRoute("")); }, []);
  useEffect(refreshRoute, [refreshRoute]);
  // «Войти» во встроенном плеере: войти в окне приложения нельзя (Google не пускает во встроенные
  // браузеры), да и не нужно — загрузчику нужны куки. Показываем, как их достать.
  useEffect(() => window.api.onYtLogin(() => setCookies({
    reason: "Плеер YouTube просит войти. В окне приложения Google вход не пускает — и не нужно: для загрузки хватит куков из вашего Chrome.",
  })), []);
  useEffect(() => window.api.onFetchProgress(setProgress), []);
  useEffect(() => { input.current?.focus(); }, []);

  // Пока один источник молчит, остальные уже показаны. Ответ с чужим номером — от прошлого
  // запроса: именно так в окне однажды оказалась выдача по «сиба» на запрос «моцарт».
  useEffect(() => window.api.onSearchStart((s) => {
    if (s.jobId !== job.current) return;
    setWaiting(s.providers.map((p) => ({ id: p.id, title: p.title, state: "ждём" })));
  }), []);

  useEffect(() => window.api.onSearchChunk((c) => {
    if (c.jobId !== job.current) return;
    setWaiting((prev) => prev.map((w) => (w.id === c.providerId
      ? { ...w, state: c.error ? "отказ" : "готово", count: c.results.length, ms: c.tookMs }
      : w)));
    if (c.error) setErrors((prev) => [...prev.filter((x) => x.providerId !== c.providerId), { providerId: c.providerId, message: c.error! }]);
    // находки нового источника вперемешку с уже показанными, без повторов
    if (c.results.length) {
      setResults((prev) => {
        const seen = new Set(prev.map((r) => `${r.providerId}:${r.id}`));
        return [...prev, ...c.results.filter((r) => !seen.has(`${r.providerId}:${r.id}`))];
      });
    }
  }), []);

  const search = useCallback(async (nextPage = 1) => {
    if (!text.trim()) return;
    const mine = job.current + 1;
    job.current = mine;
    setSearching(true);
    setNote("");
    setErrors([]);
    setResults([]);
    setPreview(null);
    setWaiting([]);
    setPage(nextPage);
    try {
      const hit = await window.api.mediaSearch({ text: text.trim(), type, page: nextPage, perPage: 30 }, only);
      if (job.current !== mine) return; // пока ждали, автор начал новый поиск
      setResults(hit.results);
      setErrors(hit.errors);
      if (!hit.results.length && !hit.errors.length) setNote("Ничего не нашлось. Попробуйте другие слова или другой источник.");
      if (!hit.results.length && hit.errors.length) setNote("Ни один источник не ответил — причины ниже.");
    } catch (e) {
      if (job.current === mine) setNote(`Поиск не удался: ${plainError(e)}`);
    } finally {
      if (job.current === mine) setSearching(false);
    }
  }, [text, type, only]);

  // при смене типа выдача от прошлого типа только путает
  useEffect(() => { setResults([]); setErrors([]); setPreview(null); }, [type]);

  const usable = providers.filter((p) => p.types.includes(type));
  const toggle = (id: string) => setOnly((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // ---- отрезок ролика ----
  // Разбираем на каждом кадре: поля маленькие, а ошибку лучше показать сразу, чем после загрузки.
  const from = parseTime(clipFrom);
  const to = parseTime(clipTo);
  const bothFilled = clipFrom.trim() !== "" && clipTo.trim() !== "";
  const clipError = !bothFilled && (clipFrom.trim() !== "" || clipTo.trim() !== "")
    ? "заполните обе границы"
    : bothFilled && (from === undefined || to === undefined)
      ? "время пишется как 29:55 или 1:02:03"
      : bothFilled && from !== undefined && to !== undefined && to <= from
        ? "конец должен быть позже начала"
        : "";
  const clip = !clipError && bothFilled && from !== undefined && to !== undefined ? { from, to } : undefined;
  const clipNote = clip
    ? `скачается ${Math.round(clip.to - clip.from)} с вместо всего ролика`
    : "например 29:55 и 30:05 — приедут только эти секунды";

  // у нового ролика свои тайминги: чужие границы здесь только вредят
  useEffect(() => { setClipFrom(""); setClipTo(""); }, [preview?.providerId, preview?.id]);

  const fetchIt = async (r: MediaResult, insert: boolean) => {
    setBusy(r);
    setProgress(null);
    setNote("");
    setNoteOk(null);
    setLastDone(null);
    try {
      // Пожелания к загрузке: потолок качества для видео и отрезок, если автор его указал.
      const want = {
        ...(r.type === "video" && maxHeight ? { maxHeight } : {}),
        ...(clip && CAN_CLIP.has(r.providerId) ? { clip } : {}),
      };
      const done = await window.api.mediaFetch(r, true, Object.keys(want).length ? want : undefined);
      if (done.media) {
        // App слушает это событие и добавляет файл в список медиа пака
        window.dispatchEvent(new CustomEvent("media-created", { detail: done.media }));
        if (insert) onAdded(done.media);
        setNote(`✔ Успешно скачано: «${done.media.name}» — в паке, оригинал в ${done.sourceDir}`);
        setNoteOk(true);
        setLastDone({ key: `${r.providerId}:${r.id}`, name: done.media.name });
      }
      refreshRoute();
    } catch (e) {
      const why = plainError(e);
      setNote(`Не скачалось: ${why}`);
      setNoteOk(false);
      if (/не бот/.test(why)) setCookies({ reason: "YouTube не отдал ролик: просит подтвердить, что вы не бот. Значит, куки протухли или не подключены." });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const cancel = () => void window.api.mediaFetchCancel();

  /** Ролик — в Chrome слева, Мастерская — справа. С заполненным «с» YouTube откроется с этой секунды. */
  const watchNear = async (r: MediaResult) => {
    if (!r.pageUrl) return;
    const url = youtubeId(r) && from !== undefined ? `${r.pageUrl}${r.pageUrl.includes("?") ? "&" : "?"}t=${Math.floor(from)}s` : r.pageUrl;
    try {
      const res = await window.api.watchSideBySide(url);
      if (!res.chrome) setNote("Chrome не найден — ролик открыт в браузере по умолчанию.");
      else if (!res.placed) setNote("Ролик открыт в Chrome, но поставить его слева не вышло — подвиньте окно вручную.");
    } catch (e) {
      setNote(`Не открылось: ${plainError(e)}`);
    }
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="media-editor media-center">
        <header>
          <b>Поиск медиа в интернете</b>
          <span className="muted">поиск → предпросмотр → в пак; оригинал остаётся в source/</span>
          <span className="spacer" />
          <button onClick={onClose} disabled={!!busy}>Закрыть</button>
        </header>

        <div className="mc-search">
          <div className="mc-types">
            {TYPES.map((t) => (
              <button key={t.id} className={t.id === type ? "primary" : ""} onClick={() => setType(t.id)}><Icon name={t.id} />{t.label}</button>
            ))}
          </div>
          <input
            ref={input}
            className="mc-query"
            value={text}
            placeholder={type === "video" ? "Что искать, или вставьте ссылку на ролик (YouTube, Instagram, Rutube…)" : "Что искать"}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void search(1); }}
          />
          {type === "video" && (
            <select
              className="mc-quality"
              value={maxHeight}
              onChange={(e) => setMaxHeight(Number(e.target.value))}
              title="Потолок качества для скачиваемого видео. Меньше — легче пак"
            >
              <option value={360}>360p</option>
              <option value={480}>480p</option>
              <option value={720}>720p</option>
              <option value={1080}>1080p</option>
              <option value={0}>как есть</option>
            </select>
          )}
          <button className="primary" onClick={() => void search(1)} disabled={searching || !text.trim()}>
            {searching ? "Ищу…" : "Найти"}
          </button>
          {searching && (
            <button
              title="Прекратить ждать молчащие источники — найденное останется"
              onClick={() => { job.current++; setSearching(false); void window.api.mediaSearchCancel(); }}
            >
              Хватит
            </button>
          )}
        </div>

        {/* Видно, кто ответил, кто молчит и сколько это заняло: иначе «Ищу…» ничем не отличается
            от зависшего источника, и автор не знает, ждать ему или искать иначе. */}
        {waiting.length > 0 && (
          <div className="mc-waiting">
            {waiting.map((w) => (
              <span key={w.id} className={`mc-src ${w.state === "ждём" ? "wait" : w.state === "отказ" ? "bad" : "ok"}`}>
                {w.state === "ждём" ? "…" : w.state === "отказ" ? "✖" : "✔"} {w.title}
                {w.state === "готово" ? ` — ${w.count}${w.ms !== undefined ? `, ${(w.ms / 1000).toFixed(1)} с` : ""}` : ""}
                {w.state === "отказ" ? " — не ответил" : ""}
              </span>
            ))}
          </div>
        )}

        <div className="mc-providers">
          {usable.map((p) => (
            <button
              key={p.id}
              className={`chip-btn${only.includes(p.id) ? " sel" : ""}${p.available ? "" : " off"}`}
              disabled={!p.available}
              title={p.reason ?? p.note}
              onClick={() => toggle(p.id)}
            >
              {p.title}
            </button>
          ))}
          {only.length > 0 && <button className="link" onClick={() => setOnly([])}>все источники</button>}
          <button
            className="link"
            disabled={diagRunning}
            title="Пройти дорогу до YouTube по шагам и увидеть, где именно рвётся"
            onClick={() => {
              setDiagRunning(true);
              setDiag(null);
              void window.api.diagnoseYoutube()
                .then((d) => { setDiag(d); refreshRoute(); })
                .catch((e: Error) => setDiag({ steps: [], verdict: "проверка не прошла", advice: e.message }))
                .finally(() => setDiagRunning(false));
            }}
          >
            {diagRunning ? "проверяю YouTube…" : "проверить YouTube"}
          </button>
          <button className="link" title="Как достать свежие куки YouTube и подключить их" onClick={() => setCookies(cookies ? null : {})}>
            куки YouTube
          </button>
          {route && <span className="muted mc-route" title="Приложение само находит включённый VPN и ходит через него">маршрут: {route}</span>}
          <span className="spacer" />
          {usable.some((p) => !p.available) && (
            <span className="muted">недоступны: {usable.filter((p) => !p.available).map((p) => `${p.title} — ${p.reason}`).join("; ")}</span>
          )}
        </div>

        {/* Отказ резолвера, закрытый доступ и требование входа в выдаче выглядят одинаково.
            Здесь видно, какой именно шаг красный, — и что с этим делать. */}
        {diag && (
          <div className="mc-diag">
            <div className="mc-diag-head">
              <b>Проверка YouTube — {diag.verdict}</b>
              <button className="link" onClick={() => setDiag(null)}>скрыть</button>
            </div>
            {diag.steps.map((s) => (
              <div key={s.name} className={s.ok ? "ok" : "bad"}>
                {s.ok ? "✔" : "✖"} {s.name} — {s.detail} <span className="muted">({(s.ms / 1000).toFixed(1)} с)</span>
              </div>
            ))}
            <div className="mc-diag-advice">{diag.advice}</div>
          </div>
        )}

        {cookies && <CookiesPanel reason={cookies.reason} onClose={() => setCookies(null)} />}

        {errors.length > 0 && (
          <div className="mc-errors">
            {errors.map((e) => (
              <div key={e.providerId}>
                <b>{providers.find((p) => p.id === e.providerId)?.title ?? e.providerId}:</b> {e.message}
              </div>
            ))}
          </div>
        )}
        {note && <div className={`mc-note${noteOk === true ? " ok" : noteOk === false ? " bad" : ""}`}>{note}</div>}

        <div className="mc-grid">
          {results.map((r) => (
            <div key={`${r.providerId}:${r.id}`} className={`mc-card${preview === r ? " sel" : ""}`} onClick={() => setPreview(r)}>
              <div className="mc-thumb">
                <Thumb r={r} />
                {r.durationSec !== undefined && (
                  <span className={`mc-dur${r.durationSec > LONG_SEC ? " long" : ""}`} title={r.durationSec > LONG_SEC ? "Длиннее 30 секунд — FirePacks пометит жёлтым" : ""}>
                    {mmss(r.durationSec)}
                  </span>
                )}
              </div>
              <div className="mc-title" title={r.title}>{r.title}</div>
              <div className="mc-meta">
                <span>{providers.find((p) => p.id === r.providerId)?.title ?? r.providerId}</span>
                {r.author && <span title={r.author}> · {r.author}</span>}
                {r.license && <span> · {r.license}</span>}
                {r.width ? <span> · {r.width}×{r.height}</span> : null}
                {r.sizeBytes ? <span> · {mb(r.sizeBytes)}</span> : null}
              </div>
              <div className="mc-actions">
                <button className="small primary" disabled={!!busy} onClick={(e) => { e.stopPropagation(); void fetchIt(r, !!target); }}>
                  {target ? "В вопрос" : "В пак"}
                </button>
                {target && (
                  <button className="small" disabled={!!busy} onClick={(e) => { e.stopPropagation(); void fetchIt(r, false); }}>Только в пак</button>
                )}
                {r.pageUrl && (
                  <button className="small link" onClick={(e) => { e.stopPropagation(); void window.api.openPath(r.pageUrl!); }} title={r.pageUrl}>Источник</button>
                )}
              </div>
            </div>
          ))}
        </div>

        {preview && (() => {
          // YouTube и Instagram во встроенном плеере не играют: YouTube с адреса VPN через раз
          // требует «подтвердите, что вы не бот», Instagram показывает чёрный прямоугольник.
          // Вместо плеера — обложка, по щелчку ролик открывается в Chrome рядом.
          const ytId = youtubeId(preview);
          const outside = !!ytId || preview.providerId === "instagram";
          const embed = outside ? undefined : embedUrl(preview);
          const poster = outside && (
            <button
              className="mc-player mc-poster"
              title="Ролик откроется в Chrome на левой половине экрана, Мастерская встанет справа"
              onClick={() => void watchNear(preview)}
            >
              {/* hq720 — широкая, без чёрных полос (у hqdefault они вшиты в картинку); есть не у всех роликов */}
              <img
                src={ytId ? `https://i.ytimg.com/vi/${ytId}/hq720.jpg` : preview.thumbUrl}
                alt=""
                onError={(e) => {
                  const img = e.currentTarget;
                  if (ytId && img.src.includes("hq720")) img.src = `https://i.ytimg.com/vi/${ytId}/mqdefault.jpg`;
                  else if (preview.thumbUrl && img.src !== preview.thumbUrl) img.src = preview.thumbUrl;
                }}
              />
              <span className="mc-play">▶</span>
              <span className="mc-poster-note">Смотреть в Chrome рядом{from !== undefined ? ` с ${mmss(from)}` : ""}</span>
            </button>
          );
          return (
            <div className="mc-preview">
              {preview.type === "audio" && preview.previewUrl && <audio src={preview.previewUrl} controls preload="none" />}
              {/* Звук с видеосайта слушается тем же встроенным плеером: иначе у находок с Rutube
                  и YouTube в разделе «Звук» не было никакого предпросмотра вообще. */}
              {preview.type === "audio" && !preview.previewUrl && poster}
              {preview.type === "audio" && !preview.previewUrl && embed && (
                <iframe className="mc-player" src={embed} title={preview.title} allow="autoplay; encrypted-media" allowFullScreen />
              )}
              {preview.type === "image" && preview.previewUrl && <img src={preview.previewUrl} alt={preview.title} />}
              {preview.type === "video" && (poster || (embed
                ? <iframe className="mc-player" src={embed} title={preview.title} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
                : <span className="muted">Этот сайт не даёт встроенный плеер — нажмите «Смотреть в Chrome рядом» или качайте и смотрите в паке.</span>))}
              <div className="mc-preview-side">
                <b>{preview.title}</b>
                {preview.author && <span className="muted">{preview.author}</span>}
                {preview.license && <span className="mc-lic">Лицензия: {preview.license}</span>}
                {preview.width ? <span className="muted">{preview.width}×{preview.height}</span> : null}
                {preview.pageUrl && (
                  <button className="link" title="Ролик в Chrome слева, Мастерская справа — смотрите и вписывайте тайминги" onClick={() => void watchNear(preview)}>
                    Смотреть в Chrome рядом
                  </button>
                )}
                {/* Встроенный плеер YouTube отвечает «ошибка 153», когда владелец ролика запретил
                    показ на чужих страницах. Это решение владельца, и обойти его нельзя — зато
                    сам ролик открывается в браузере, а скачиванию в пак запрет не мешает. */}
                {embed && (
                  <span className="muted mc-embed-hint">
                    Плеер молчит или пишет ошибку? Смотрите ролик в Chrome рядом — на загрузку в пак это не влияет.
                  </span>
                )}
                {preview.durationSec !== undefined && (
                  <span className={preview.durationSec > LONG_SEC ? "warn" : "muted"}>
                    длительность {mmss(preview.durationSec)}{preview.durationSec > LONG_SEC ? " — длиннее 30 с, стоит обрезать" : ""}
                  </span>
                )}

                {/* Кусок вместо всего ролика. Для пака это обычное дело: из получасового видео
                    в вопрос идут пять секунд, и тянуть ради них весь файл незачем — yt-dlp
                    умеет забрать только нужный отрезок. */}
                {CAN_CLIP.has(preview.providerId) && preview.type !== "image" && (
                  <div className="mc-clip">
                    <label>
                      Нужен кусок? с
                      <input
                        className="mc-time"
                        value={clipFrom}
                        placeholder="29:55"
                        onChange={(e) => setClipFrom(e.target.value)}
                      />
                    </label>
                    <label>
                      по
                      <input
                        className="mc-time"
                        value={clipTo}
                        placeholder="30:05"
                        onChange={(e) => setClipTo(e.target.value)}
                      />
                    </label>
                    <span className={clipError ? "warn" : "muted"}>{clipError || clipNote}</span>
                  </div>
                )}

                <span className="spacer" />
                {lastDone?.key === `${preview.providerId}:${preview.id}` && (
                  <div className="mc-done">✔ Успешно скачано — «{lastDone.name}» уже в паке</div>
                )}
                <button className="primary" disabled={!!busy || !!clipError} onClick={() => void fetchIt(preview, !!target)}>
                  {clip ? "Скачать кусок в пак" : target ? "Скачать и в вопрос" : "Скачать в пак"}
                </button>
                <button onClick={() => setPreview(null)}>Свернуть</button>
              </div>
            </div>
          );
        })()}

        <footer className="mc-foot">
          {busy ? (
            <>
              <span>Качаю «{busy.title}»…</span>
              <div className="bar"><i style={{ width: `${Math.round((progress?.ratio ?? 0) * 100)}%` }} /></div>
              <span className="muted">{progress?.note ?? (progress ? `${mb(progress.receivedBytes)}${progress.totalBytes ? ` из ${mb(progress.totalBytes)}` : ""}` : "")}</span>
              <button onClick={cancel}>Отменить</button>
            </>
          ) : (
            <>
              <span className="muted">Найдено: {results.length}</span>
              <span className="spacer" />
              {results.length > 0 && (
                <>
                  <button disabled={page <= 1 || searching} onClick={() => void search(page - 1)}>← назад</button>
                  <span className="muted">страница {page}</span>
                  <button disabled={searching} onClick={() => void search(page + 1)}>вперёд →</button>
                </>
              )}
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

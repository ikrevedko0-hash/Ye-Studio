// Контракт между интерфейсом и главным процессом.

import type { MediaInfoProbe, MediaPlan, ProgressInfo } from "../core/media/ffmpeg";
import type { ProviderInfo } from "../core/media/providers/registry";
import type { DownloadWish, FetchProgress, MediaResult, MediaType, SearchQuery, SourceMeta } from "../core/media/providers/types";
import type { DiagStep, Diagnosis } from "../core/media/providers/youtube";
import type { Package, Theme } from "../core/siq/model";
import type { DupReport } from "../core/siq/dupCheck";
import type { DictStats } from "../core/words/dict";
import type { GeneratorInfo } from "../core/words/generators/registry";
import type { GeneratorArgs, PuzzleTheme, WordHit } from "../core/words/generators/types";
import type { ImagePreset } from "../core/ai/presetText";
import type { WorkHit } from "../core/ai/works";
import type { QuotaInfo } from "../core/ai/quota";
import type { ImageModelInfo } from "../core/ai/image";
import type { PhraseSet } from "../core/words/phrases";
import type { Suggestion, SuggestOptions } from "../core/rebus/suggest";
import type { ProfileId, SystemReport } from "../core/system/probe";
import type { ComponentsState, InstallProgress } from "../core/components/manifest";
import type { SigameProgress } from "../core/sigame/run";
import type { SigameReport } from "../core/sigame/report";

/** Галочки со страницы установщика «Компоненты». */
export interface FirstRunOptions {
  ytdlp: boolean;
  model: boolean;
}

/** Чат-помощник, с которым автор пишет вопросы. */
export type AssistantKind = "claude" | "chatgpt";

export interface AssistantStatus {
  /** Предложить мастер: первый запуск на этой машине и навык Claude здесь ещё не стоит. */
  ask: boolean;
  /** Рабочая папка помощника (выбранная раньше или предлагаемая по умолчанию). */
  workdir: string;
  /** Где уже лежит навык Claude, если он есть. */
  claudeSkill: string | null;
}

export interface AssistantSetupResult {
  kind: AssistantKind;
  workdir: string;
  /** Файлы, положенные в рабочую папку впервые (существующие не перезаписываются). */
  added: string[];
  skillPath?: string;
  skillZip?: string;
  chatgptDir?: string;
  /** Текст инструкций проекта ChatGPT — окно кладёт его в буфер. */
  instructions?: string;
}

/** Словарь выражений вместе со списками видов и помет для фильтров. */
export interface PhraseDictionary {
  set: PhraseSet;
  kinds: { id: string; title: string }[];
  styles: { id: string; title: string }[];
}
import type { SpeakRequest, TranslateResult, VoiceKeepInfo, VoiceSpeakResult, VoiceState } from "../core/tts/types";
import type { AiSettings, ProviderEdit, ProviderTemplate } from "../core/ai/settings";

export type { DictStats, GeneratorArgs, GeneratorInfo, PuzzleTheme, WordHit };
export type { AiSettings, ImageModelInfo, ImagePreset, ProviderEdit, ProviderTemplate, QuotaInfo, WorkHit };

/** Бесплатные модели не справились, платные есть — окно спрашивает автора. */
export interface NeedPaid {
  needPaid: string[];
  skipped: string[];
}

/** Картинка от генератора: ещё не в паке, окно само решает, сохранять ли. */
/** Художественный стиль для галочек в окне: только русские название и подсказка. */
export interface ImageStyleInfo {
  id: string;
  title: string;
  about: string;
}

export interface GeneratedImage {
  dataUrl: string;
  /** «провайдер:модель», что нарисовала. */
  model: string;
  ms: number;
  skipped: string[];
}
export type { DiagStep, Diagnosis, DownloadWish };
export type { FetchProgress, MediaInfoProbe, MediaPlan, MediaResult, MediaType, ProgressInfo, ProviderInfo, SearchQuery, SourceMeta };

export interface MediaInfo {
  /** Images | Audio | Video */
  folder: string;
  /** Имя файла, как в content.xml */
  name: string;
  size: number;
  /** Адрес для предпросмотра: siq://media/… */
  url: string;
}

/** Несохранённый пак, оставшийся после сбоя. */
export interface DraftInfo {
  origPath?: string;
  name: string;
  time: number;
}

export interface PackDTO {
  path?: string;
  pkg: Package;
  media: MediaInfo[];
  /** В архиве есть quality.marker — SIGame показывает пак как прошедший контроль качества. */
  quality?: boolean;
  /** Только для самопроверки: открыть редактор медиа сразу после загрузки. */
  openEditorMedia?: MediaInfo;
  /** Только для самопроверки: открыть сборку коллажа сразу после загрузки. */
  openCollage?: boolean;
}

/** План обработки без путей: их подставляет главный процесс. */
export type EditPlan = Omit<MediaPlan, "input" | "output" | "overlayPng">;

export interface MediaEditRequest {
  folder: string;
  name: string;
  plan: EditPlan;
  /** PNG со сплошными фигурами во всю ширину исходного кадра, data:image/png;base64,… */
  overlayPngBase64?: string;
  /** Приписка к имени нового файла; по умолчанию « (обрезано)». */
  suffix?: string;
}

/** Выдача поиска: результаты вперемешку плюс источники, которые не ответили. */
export interface SearchHit {
  results: MediaResult[];
  errors: { providerId: string; message: string }[];
}

/**
 * Ответ одного источника. Приходит сразу, как источник отозвался, не дожидаясь остальных:
 * быстрый Викисклад показывается, пока медленный YouTube ещё думает.
 */
export interface SearchChunk {
  /** Номер поиска. Ответы от прежнего запроса окно выбрасывает по этому номеру. */
  jobId: number;
  providerId: string;
  results: MediaResult[];
  error?: string;
  /** Сколько миллисекунд отвечал источник — видно, кто тормозит. */
  tookMs: number;
}

/** Начало поиска: кто из источников опрошен. Окно рисует по ним строку состояния. */
export interface SearchStart {
  jobId: number;
  providers: { id: string; title: string }[];
}

/** Итог загрузки: оригинал на диске, копия в паке. */
export interface FetchResult {
  meta: SourceMeta;
  media?: MediaInfo;
  sourcePath: string;
  sourceDir: string;
}

export interface CookiesStatus {
  /** Файл подключён и в нём есть вход в аккаунт. */
  ok: boolean;
  file?: string;
  /** Когда файл положен (мс), чтобы было видно, насколько он старый. */
  updated?: number;
  /** Почему не годится, или что сделали с файлом. */
  message?: string;
  /** Файл ведёт приложение из своего окна входа и освежает сам. */
  auto?: boolean;
}

/** Пак, куда можно перенести тему: имя и раунды. */
export interface TargetPack {
  path: string;
  name: string;
  rounds: { name: string; final: boolean; themes: number }[];
}

/** Куда переносим тему: новый пак (файл выбирается при переносе) или уже выбранный существующий. */
export type ThemeTransfer =
  /** path — без диалога сохранения (самопроверка) */
  | { mode: "new"; packName: string; final: boolean; path?: string }
  /** round: номер раунда в целевом паке; -1 — новый раунд с именем roundName */
  | { mode: "file"; path: string; round: number; roundName?: string };

/** Тема в буфере Ye!Studio («Копировать тему» → в другом паке «Вставить тему»). */
export interface ThemeClipInfo {
  name: string;
  questions: number;
  /** файлов темы взято в буфер */
  files: number;
  /** на них ссылается тема, но в паке их не было */
  missing: string[];
  /** тема из финала */
  final: boolean;
  /** из какого пака */
  from: string;
}

export interface ThemeTransferResult {
  path: string;
  /** сколько файлов дописано в целевой пак */
  copied: number;
  /** такие же файлы уже были в целевом паке — не дублировали */
  reused: number;
  /** пришлось переименовать: имя было занято другим файлом */
  renamed: string[];
  /** на них ссылается тема, но в открытом паке их нет */
  missing: string[];
}

export interface Api {
  /**
   * Настройки окна с диска. Раньше жили в localStorage, но окно теперь грузится по http
   * с локального сервера — для нового адреса прежнее хранилище чужое и пустое.
   */
  ui: { editorWidth?: number; ytMaxHeight?: number; theme?: string; reportErrors?: boolean };
  setUi(key: "editorWidth" | "ytMaxHeight", value: number): Promise<void>;
  setUi(key: "theme", value: string): Promise<void>;
  /** «Отправлять отчёты об ошибках автору» — галочка в настройках. */
  setUi(key: "reportErrors", value: boolean): Promise<void>;
  newPack(): Promise<PackDTO>;
  openPack(path?: string): Promise<PackDTO | null>;
  savePack(pkg: Package, saveAs: boolean): Promise<PackDTO | null>;
  /** Черновик несохранённого пака (на случай сбоя): записать, узнать, восстановить, выбросить. */
  draftWrite(pkg: Package): Promise<void>;
  draftInfo(): Promise<DraftInfo | null>;
  draftRestore(): Promise<PackDTO | null>;
  draftDiscard(): Promise<void>;
  /** Открыть папку резервных копий (прежние версии паков перед каждым сохранением). */
  openBackups(): Promise<string>;
  /** Запустить SIGame; путь к паку кладётся в буфер. ok: false — SIGame не найдена. */
  openInSigame(packPath: string): Promise<{ ok: boolean }>;
  /** Стоит ли «Прогон в SIGame» (стенд с движком SIGame и стол SIOnline). */
  sigameRunReady(): Promise<boolean>;
  /** Прогнать сохранённый пак через настоящий SIGame; снимки — siq://sigame/<run>/<file>. */
  sigameRun(packPath: string): Promise<{ run: string; report: SigameReport }>;
  sigameRunCancel(): Promise<void>;
  /** «Сохранить отчёт»: HTML со снимками вопросов с бедами; labels — «раунд/тема/вопрос» → подпись. null — отменили. */
  sigameExport(run: string, title: string, labels: Record<string, string>): Promise<string | null>;
  onSigameProgress(cb: (p: SigameProgress) => void): () => void;
  /** Выбрать существующий пак для переноса темы (открытый нельзя). path — без диалога. */
  pickTargetPack(path?: string): Promise<TargetPack | null>;
  /** Дописать тему со всеми её файлами в другой пак; null — автор отменил выбор файла. */
  transferTheme(theme: Theme, to: ThemeTransfer): Promise<ThemeTransferResult | null>;
  /** Копировать тему в буфер Ye!Studio вместе с файлами (from — название пака для подписи). */
  copyTheme(theme: Theme, final: boolean, from: string): Promise<ThemeClipInfo>;
  /** Что в буфере темы (null — пусто). */
  themeClip(): Promise<ThemeClipInfo | null>;
  /** Вставка: файлы темы добавлены в открытый пак, тема (с новыми именами файлов) — вставить самому. */
  pasteTheme(): Promise<{ theme: Theme; media: MediaInfo[]; renamed: string[] } | null>;
  addMedia(paths?: string[]): Promise<MediaInfo[]>;
  removeMedia(folder: string, name: string): Promise<boolean>;
  /** Галочка «контроль качества» SIGame (quality.marker в архиве). */
  setQuality(on: boolean): Promise<boolean>;
  reveal(path: string): Promise<void>;
  /** Текст из буфера обмена (для «📋 Из Claude»). */
  clipboardText(): Promise<string>;
  /** Записать текст в буфер (окно «📣 Публикация»). */
  clipboardWrite(text: string): Promise<void>;
  /** Есть ли несохранённые правки — главный процесс спросит «сохранить?» при закрытии. */
  setDirty(dirty: boolean): void;
  openPath(path: string): Promise<string>;
  /** Путь к файлу, перетащенному в окно (Electron 32+ не даёт File.path) */
  pathForFile(file: File): string;
  ffmpegAvailable(): Promise<boolean>;
  /** Проверка системы: видеокарта, память, диск, программы и подходящий профиль локальной модели. */
  probeSystem(): Promise<SystemReport>;
  /** Окно «Компоненты»: что стоит, какие профили есть, идёт ли установка. */
  componentsState(): Promise<ComponentsState>;
  /** Скачать и подключить модель профиля; ход — в onComponentsProgress. */
  installModel(profile: ProfileId): Promise<ComponentsState>;
  cancelModelInstall(): Promise<void>;
  /** Подключить уже скачанную папку (выбор папки в окне). null — выбор отменили. */
  adoptModelFolder(): Promise<ComponentsState | null>;
  removeModel(): Promise<ComponentsState>;
  /** Программа-компонент: «yt-dlp» (видео без Python) или «ffmpeg» (обработка медиа). */
  installTool(tool: string): Promise<ComponentsState>;
  removeTool(tool: string): Promise<ComponentsState>;
  /** Обновить программу: yt-dlp — своим -U, остальное — из манифеста. Ответ — строка для статуса. */
  updateTool(tool: string): Promise<string>;
  onComponentsProgress(cb: (p: InstallProgress) => void): () => void;
  /** Мастер первого запуска: что отметили в установщике; null — показывать не нужно. */
  firstRun(): Promise<FirstRunOptions | null>;
  firstRunDone(): Promise<void>;
  /** Чат-помощник (Claude / ChatGPT): нужен ли мастер и где рабочая папка. */
  assistantStatus(): Promise<AssistantStatus>;
  assistantPickDir(current: string): Promise<string | null>;
  assistantSetup(kind: AssistantKind, workdir: string): Promise<AssistantSetupResult>;
  /** «Не сейчас» — больше не предлагать при запуске (кнопка в шапке остаётся). */
  assistantDone(): Promise<void>;
  /** Открыть рабочую папку, папку для ChatGPT или сайт помощника. */
  assistantOpen(target: "folder" | "chatgpt-dir" | "claude-skills" | "chatgpt"): Promise<void>;
  probeMedia(folder: string, name: string): Promise<MediaInfoProbe>;
  waveform(folder: string, name: string, points: number): Promise<number[]>;
  /** Стоп-кадр: кладёт PNG в пак и возвращает его */
  grabFrame(folder: string, name: string, timeSec: number): Promise<MediaInfo | null>;
  editMedia(req: MediaEditRequest): Promise<MediaInfo>;
  /** Готовая картинка (data:image/…;base64,…) из редактора картинок или коллажа — кладётся в Images */
  saveImage(dataUrl: string, suggestedName: string): Promise<MediaInfo>;
  /** Стоит ли ИИ-увеличение (модель Real-ESRGAN и sd-cli) — «Компоненты». */
  upscaleReady(): Promise<boolean>;
  /** ИИ-увеличение ×2 или ×4 (до 1920 px) — только предпросмотр, в пак не пишет. w, h — исходный размер. */
  upscaleImage(folder: string, name: string, w: number, h: number, factor: 2 | 4): Promise<{ token: string; url: string; size: number }>;
  /** Сохранить предпросмотр в пак новым JPEG рядом с оригиналом (name — имя оригинала). */
  upscaleKeep(token: string, name: string, factor: 2 | 4): Promise<MediaInfo>;
  /** Выбросить предпросмотр. */
  upscaleDrop(token: string): Promise<void>;
  /** Содержимое файла из пака: для canvas, куда siq:// не дотягивается */
  mediaBytes(folder: string, name: string): Promise<{ type: string; data: Uint8Array }>;
  cancelEdit(): Promise<void>;
  // ---------- медиацентр ----------
  mediaProviders(): Promise<ProviderInfo[]>;
  /** Проверить дорогу до YouTube по шагам и назвать место разрыва. */
  diagnoseYoutube(): Promise<Diagnosis>;
  /** Какой дорогой сейчас ходит yt-dlp: свой прокси, найденный VPN, встроенный резолвер, напрямую. */
  mediaRoute(): Promise<{ kind: string; label: string }>;
  /** Есть ли куки YouTube и годятся ли они. */
  cookiesStatus(): Promise<CookiesStatus>;
  /** Выбрать выгруженный cookies.txt, проверить и подключить. null — окно выбора закрыли. */
  cookiesImport(): Promise<CookiesStatus | null>;
  /** Войти в YouTube в окне приложения; куки приложение выгрузит и будет освежать само. */
  cookiesLogin(): Promise<CookiesStatus>;
  /** Освежить куки из окна входа сейчас. */
  cookiesRefresh(): Promise<CookiesStatus>;
  /** Выйти: стереть вход и файл куков. */
  cookiesLogout(): Promise<CookiesStatus>;
  /** Встроенный плеер попросил войти в аккаунт — окно показывает инструкцию про куки. */
  onYtLogin(cb: () => void): () => void;
  /** Открыть ролик в Chrome на левой половине экрана, Мастерскую — на правую. */
  watchSideBySide(url: string): Promise<{ chrome: boolean; placed: boolean }>;
  mediaSearch(q: SearchQuery, only?: string[]): Promise<SearchHit>;
  mediaSearchCancel(): Promise<void>;
  /** Качает оригинал в source/ и кладёт копию в пак. */
  mediaFetch(r: MediaResult, toPack?: boolean, want?: DownloadWish): Promise<FetchResult>;
  mediaFetchCancel(): Promise<void>;
  /** Что уже скачано для текущего пака. */
  mediaSources(): Promise<{ dir: string; items: SourceMeta[] }>;
  /** Положить в пак файлы, которые уже лежат в библиотеке (второй раз из сети не тянем). */
  libraryToPack(files: string[]): Promise<MediaInfo[]>;
  /** Открыть папку библиотеки, а с именем файла — показать его в ней. Возвращает путь папки. */
  libraryReveal(file?: string): Promise<string>;
  /** Убрать оригинал из библиотеки — файл уходит в корзину. */
  libraryRemove(file: string): Promise<boolean>;
  /** Положить копию файла пака в source/ (оригинал, который заменила обработка). Возвращает имя в библиотеке. */
  libraryKeep(folder: string, name: string, note: string): Promise<string>;
  onFetchProgress(cb: (p: FetchProgress) => void): () => void;
  /** Источник ответил. Окно показывает его находки, не дожидаясь остальных. */
  onSearchChunk(cb: (c: SearchChunk) => void): () => void;
  /** Поиск начался: известно, кого спрашиваем. */
  onSearchStart(cb: (s: SearchStart) => void): () => void;
  // ---------- студия слов ----------
  wordGenerators(): Promise<GeneratorInfo[]>;
  wordStats(): Promise<DictStats[]>;
  wordRun(id: string, args: GeneratorArgs): Promise<PuzzleTheme>;
  /** Ребусы: варианты разбора ответа по словарю существительных (core/rebus/suggest.ts). */
  rebusSuggest(answer: string, opts?: SuggestOptions): Promise<Suggestion[]>;
  // ---------- генерация картинок ----------
  imagePresets(): Promise<ImagePreset[]>;
  /** Словарь фразеологизмов и пословиц (скачан заранее, из сети не читается). */
  phrases(): Promise<PhraseDictionary>;
  /** Сохранить пресет (встроенный — правкой поверх исходного). Ответ — пресеты заново. */
  imagePresetPut(p: ImagePreset): Promise<ImagePreset[]>;
  /** Удалить свой пресет; у встроенного — вернуть исходный. */
  imagePresetDelete(id: string): Promise<ImagePreset[]>;
  /**
   * Фраза → промпт для рисования (шаблон — подстановка, без модели).
   * temperature — насколько смело модель придумывает сцену (0 — предсказуемо, 1.5 — безумно);
   * work — фильм, выбранный из списка Wikidata: модель не угадывает его, а получает готовым.
   * В ответе work — какое произведение узнала модель, если она его назвала.
   */
  imagePrompt(phrase: string, preset: string, temperature?: number, work?: WorkHit): Promise<{ text: string; model: string; skipped: string[]; work?: string }>;
  /** Фильмы, мультфильмы, сериалы и книги по началу русского названия (Wikidata). */
  worksSearch(query: string): Promise<WorkHit[]>;
  /** style — id из imageStyles.ts: его английское описание дописывается к сцене. */
  /** ownStyle — свой английский текст стиля пресета: дописывается вместо стиля с галочки. */
  /** only — рисовать только этой моделью («провайдер:модель»), а не по очереди. */
  imageGenerate(prompt: string, width: number, height: number, allowPaid?: boolean, style?: string, ownStyle?: string, only?: string): Promise<GeneratedImage | NeedPaid>;
  /** Модели для выбора в окне «Картинки»: очередь и свои модели вне очереди. */
  imageModels(): Promise<ImageModelInfo[]>;
  imageStyles(): Promise<ImageStyleInfo[]>;
  /** Картинку от ИИ — оригиналом в библиотеку (с моделью, стилем и сценой) и копией в пак. */
  imageKeep(dataUrl: string, phrase: string, info: { model: string; style?: string; prompt: string }): Promise<MediaInfo>;
  imageCancel(): Promise<void>;
  // ---------- перевод + озвучка ----------
  /** Что установлено: движки озвучки, голоса Piper, есть ли переводчик. */
  voiceState(): Promise<VoiceState>;
  /** Перевод фразы: до трёх вариантов. target — id из core/tts/languages (none, la, en, …, custom); custom — инструкция для «Свой вариант». Облако — только при allowCloud. */
  voiceTranslate(text: string, target: string, custom: string, allowCloud: boolean): Promise<TranslateResult>;
  /** Озвучить: wav во временной папке + байты для предпросмотра (Blob → URL.createObjectURL). */
  voiceSpeak(req: SpeakRequest): Promise<VoiceSpeakResult>;
  /** Оставить озвучку: оригинал — в библиотеку, mp3 (или wav без ffmpeg) — в пак. */
  voiceKeep(wavPath: string, info: VoiceKeepInfo): Promise<MediaInfo>;
  /** Прервать перевод или озвучку. */
  voiceCancel(): Promise<void>;
  // ---------- настройки ИИ ----------
  aiSettings(): Promise<AiSettings>;
  aiSettingsSave(s: AiSettings): Promise<AiSettings>;
  aiTest(id: string): Promise<string>;
  aiTemplates(): Promise<ProviderTemplate[]>;
  aiQuota(only?: "images"): Promise<QuotaInfo[]>;
  onEditProgress(cb: (p: ProgressInfo) => void): () => void;
  onSelfTestLoad(cb: (d: PackDTO) => void): void;
  // ---------- публикация (окно «📣 Публикация») ----------
  /** Папка для афиши: рядом с файлом пака, или в Документах, если пак не сохранён. */
  publishFolder(packPath: string | undefined, packName: string): Promise<string>;
  /** Афиша со всеми темами пака — одна картинка PNG; возвращает путь сохранённого файла. */
  publishPoster(pkg: Package, packPath: string | undefined, packName: string): Promise<string>;

  // ---------- обновления ----------
  /** Версия из package.json — «Проверить обновления» в окне «Компоненты» показывает её рядом с кнопкой. */
  appVersion(): Promise<string>;
  updateStatus(): Promise<UpdateStatus>;
  updateCheck(): Promise<void>;
  updateDownload(): Promise<void>;
  /** Перед установкой главный процесс спросит про несохранённые правки — тем же диалогом, что при закрытии окна. */
  updateInstall(): Promise<void>;
  onUpdateState(cb: (s: UpdateStatus) => void): () => void;

  // ---------- связь с сервером автора ----------
  /** Ошибка окна (window.onerror / unhandledrejection) — главный процесс её обрежет и почистит от путей. */
  reportError(err: { kind: string; message: string; stack?: string }): Promise<void>;
  /** Снимок окна для отзыва — снимается сразу по 💬, до открытия формы. */
  feedbackCapture(): Promise<void>;
  feedbackSend(req: FeedbackRequest): Promise<{ ok: boolean; message: string }>;
  /** «Повторы на FirePacks»: сверить вопросы пака с базой на сервере. exclude — id паков FirePacks, которые не считать. */
  dupCheck(pkg: Package, exclude?: number[]): Promise<{ ok: true; report: DupReport } | { ok: false; message: string }>;
}

// ---------- обновления ----------

export type UpdateStateKind = "idle" | "checking" | "available" | "downloading" | "ready" | "error";

export interface UpdateStatus {
  state: UpdateStateKind;
  /** code — лёгкое обновление кода (перезапуск), installer — новая оболочка через установщик */
  kind?: "code" | "installer";
  /** размер скачивания, МБ (для обновления кода) */
  sizeMb?: number;
  version?: string;
  percent?: number;
  notes?: string;
  error?: string;
}

// ---------- связь с сервером автора ----------

export interface FeedbackRequest {
  text: string;
  contact?: string;
  includeScreenshot: boolean;
  includeLog: boolean;
}

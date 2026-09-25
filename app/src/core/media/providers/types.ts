// Контракт источников медиа. Ядро без Electron: сюда не тянем ни окно, ни ipc.
//
// Правило, ради которого всё это заведено: приложение не должно знать ни одного конкретного сайта.
// Оно знает только «источник, который умеет искать и умеет скачивать». Новый источник — новый файл рядом.

export type MediaType = "image" | "audio" | "video";

/** Ключи и настройки источников. Лежат рядом с providers.json, в файлы проекта не попадают. */
export interface ProviderConfig {
  /** Ключи по идентификатору источника: { jamendo: "…", freesound: "…" } */
  keys?: Record<string, string>;
  /** Выключенные вручную источники. */
  disabled?: string[];
  /** Путь к python для тех источников, что зовут внешние программы (yt-dlp). */
  python?: string;
  /** yt-dlp.exe (компонент или свой): есть — Python не нужен. Главный процесс подставляет компонент сам. */
  ytdlpExe?: string;
  /** Папка плагинов для yt-dlp.exe (там zip провайдера PO-токенов). */
  ytdlpPluginDir?: string;
  /** Путь к самому приложению: при отсутствии Node оно служит yt-dlp JS-рантаймом (ELECTRON_RUN_AS_NODE). */
  electronNode?: string;
  /**
   * Путь к ffmpeg.exe или к папке с ним (ffprobe должен лежать рядом). Пусто — искать самим:
   * resources\bin из установщика, пакет winget Gyan.FFmpeg любой версии, PATH.
   */
  ffmpeg?: string;
  /**
   * Брать вход из браузера для закрытых сайтов (Instagram, приватные ролики).
   * По умолчанию выключено: в чужие куки без спроса не лезем.
   * Chrome с версии 127 шифрует куки App-Bound Encryption, и достать их удаётся не всегда —
   * firefox работает надёжнее, а совсем надёжно — свой файл cookies.txt.
   */
  cookiesFromBrowser?: "firefox" | "chrome" | "chromium" | "edge" | "brave" | "opera" | "vivaldi";
  /** Путь к экспортированному cookies.txt — запасной путь, когда из браузера не достаётся. */
  cookiesFile?: string;
  /**
   * Файл куков пишет само приложение из своего окна входа и освежает его в фоне.
   * Подключили файл вручную — флаг снимается, и фон свой файл не трогает.
   */
  cookiesAuto?: boolean;
  /**
   * Прокси для источников, которые зовут yt-dlp: «socks5://127.0.0.1:1080» или «http://…».
   * Нужен там, где YouTube закрыт, а скачать ролик всё-таки надо.
   * Если он задан, встроенный резолвер (dns) не применяется: свой прокси главнее.
   */
  proxy?: string;
  /**
   * Кто переводит имена сайтов в адреса для внешних программ.
   *
   * «auto» (по умолчанию) — один раз спросить системный DNS про www.youtube.com и, если он
   * отвечает «нет такого домена», дальше ходить через встроенный DoH-прокси. Ровно этим
   * отличается браузер, у которого YouTube открывается, от yt-dlp, у которого не открывается:
   * браузер давно резолвит сам, а внешняя программа спрашивает систему.
   * «doh» — всегда через встроенный резолвер, «system» — никогда (прежнее поведение).
   */
  dns?: "auto" | "doh" | "system";
  /**
   * Искать включённый VPN-клиент (Happ, v2rayN, Clash, Hiddify…) по его локальному HTTP-входу
   * и ходить через него. По умолчанию включено; false — не искать.
   */
  localVpn?: boolean;
  /**
   * Подделка заголовка X-Forwarded-For для сайтов с ограничением по стране:
   * «RU», «default», «never» или блок адресов вида «1.2.3.0/24». Передаётся в yt-dlp как --xff.
   */
  xff?: string;
  /** Отдельный прокси только для проверки страны (--geo-verification-proxy). */
  geoVerificationProxy?: string;
  /**
   * Путь к node или deno для yt-dlp (--js-runtimes). Без рантайма YouTube отдаёт не все
   * форматы: часть ссылок закрыта задачей на JavaScript, и решать её нечем.
   * Пусто — искать node в PATH самостоятельно; «нет» — не использовать вовсе.
   */
  jsRuntime?: string;
  /**
   * Папка собранного bgutil-ytdlp-pot-provider (та, где лежит build/generate_once.js).
   * Он выдаёт PO-токен — пропуск, без которого YouTube иногда отвечает
   * «Sign in to confirm you're not a bot». Пусто — взять вложенный в приложение.
   */
  potProviderDir?: string;
}

export interface SearchQuery {
  text: string;
  type: MediaType;
  /** Страница с единицы. */
  page?: number;
  perPage?: number;
}

/** Найденная единица медиа. Пока ничего не скачано — только ссылки и описание. */
export interface MediaResult {
  providerId: string;
  /** Уникален в пределах источника. */
  id: string;
  type: MediaType;
  title: string;
  author?: string;
  license?: string;
  /** Страница, откуда взято, — попадёт в метаданные и в описание пака. */
  pageUrl?: string;
  /** Маленькая картинка для плитки. */
  thumbUrl?: string;
  /** Что показывать или проигрывать в окне до скачивания. */
  previewUrl?: string;
  /** Прямая ссылка на оригинал. Может отсутствовать: тогда качает сам источник. */
  downloadUrl?: string;
  width?: number;
  height?: number;
  durationSec?: number;
  sizeBytes?: number;
  ext?: string;
}

/** Метаданные, которые остаются рядом с оригиналом в source/. */
export interface SourceMeta {
  providerId: string;
  title: string;
  author?: string;
  license?: string;
  pageUrl?: string;
  downloadUrl?: string;
  /** ISO-дата скачивания. */
  fetchedAt: string;
  /** Имя оригинала в source/. */
  file: string;
  sizeBytes: number;
  /** Имя файла в паке, если обработанная версия уже туда легла. */
  packFile?: string;
  packFolder?: string;
  /** Картинка от ИИ: по какой сцене нарисована — чтобы потом перерисовать так же или иначе. */
  prompt?: string;
}

export interface FetchProgress {
  /** 0..1, если длина ответа известна. */
  ratio?: number;
  receivedBytes: number;
  totalBytes?: number;
  note?: string;
}

export interface ProviderCtx {
  cfg: ProviderConfig;
  signal?: AbortSignal;
  /** Чего хочет автор от этой конкретной загрузки. Источник вправе не уметь ничего из этого. */
  want?: DownloadWish;
}

/**
 * Пожелания к скачиваемому файлу.
 *
 * Зачем это в паках: ролик с YouTube по умолчанию тянется в лучшем доступном качестве, а это
 * запросто 4K на полгигабайта — при том что в игре видео показывают в окне на пол-экрана,
 * и пак с такими файлами никто не скачает. Высота кадра — самый понятный автору рычаг.
 */
export interface DownloadWish {
  /** Максимальная высота кадра: 1080, 720, 480, 360. Не задано — лучшее, что есть. */
  maxHeight?: number;
  /**
   * Нужен только кусок ролика — секунды от начала.
   *
   * Для пака это обычное дело: из получасового видео в вопрос идут пять секунд. yt-dlp умеет
   * забирать только нужный отрезок, не выкачивая всё остальное, — и это не «скачать и обрезать»,
   * а именно частичная загрузка: с сервера тянется лишь тот кусок, что попал в отрезок.
   */
  clip?: { from: number; to: number };
}

export interface MediaProvider {
  id: string;
  /** Как называется в окне. */
  title: string;
  types: MediaType[];
  /** Короткая подпись под названием: лицензии, ограничения. */
  note?: string;
  /** Имя ключа в ProviderConfig.keys, если без ключа не работает. */
  needsKey?: string;
  /**
   * Сколько ждать ответа на поиск. Источник, который молчит дольше, считается упавшим.
   * Без этого один неотвечающий сайт держал всю выдачу: окно писало «Ищу…» минутами,
   * а ответы остальных источников не показывались вовсе.
   */
  searchTimeoutMs?: number;
  /** Готов ли источник к работе (есть ключ, есть внешняя программа). */
  available(cfg: ProviderConfig): boolean | Promise<boolean>;
  search(q: SearchQuery, ctx: ProviderCtx): Promise<MediaResult[]>;
  /**
   * Кладёт оригинал в destDir и возвращает путь к нему.
   * Имя файла выбирает сам источник: он один знает настоящее расширение.
   */
  download(r: MediaResult, destDir: string, ctx: ProviderCtx, onProgress?: (p: FetchProgress) => void): Promise<string>;
}

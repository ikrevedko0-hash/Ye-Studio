// Модель пака SIGame (формат SIQ v5, схема https://github.com/VladimirKhil/SI/blob/master/assets/siq_5.xsd).
// Значения атрибутов хранятся строками «как в файле» (isRef="True" и т.п.), чтобы пак после
// открытия и сохранения совпадал с оригиналом байт в байт. Удобные типы — в слое приложения.

export interface Info {
  authors?: string[];
  sources?: string[];
  comments?: string;
  showmanComments?: string;
  extension?: string;
}

/** Элемент контента вопроса: текст, картинка, звук, видео, html. */
export interface ContentItem {
  /** text (по умолчанию) | image | audio | video | html */
  type?: string;
  /** "True" — value это имя файла внутри пака, иначе — внешняя ссылка/текст */
  isRef?: string;
  /** screen (по умолчанию) | background | replic */
  placement?: string;
  /** длительность показа hh:mm:ss */
  duration?: string;
  /** "False" — не ждать окончания медиа */
  waitForFinish?: string;
  value: string;
}

export interface NumberSet {
  minimum?: string;
  maximum?: string;
  step?: string;
  value?: string;
}

/**
 * Параметр вопроса. Известные имена: question, answer (контент), answerType (select),
 * answerOptions (группа A, B, C…), price (numberSet), theme, selectionMode, answerDeviation, answerDuration.
 */
export interface Param {
  name?: string;
  /** content | group | numberSet | (нет — простое текстовое значение) */
  type?: string;
  /** Текстовое значение простого параметра (mixed content). */
  text?: string;
  /** Дочерние узлы в исходном порядке. */
  children: ParamChild[];
}

export type ParamChild =
  | { kind: "item"; item: ContentItem }
  | { kind: "param"; param: Param }
  | { kind: "numberSet"; numberSet: NumberSet };

export interface Question {
  price: string;
  /** secret | secretPublicPrice | secretNoQuestion | stake | stakeAll | noRisk | forAll | … */
  type?: string;
  info?: Info;
  params?: Param[];
  right: string[];
  wrong?: string[];
  /** Устаревшие элементы type/scenario/script — храним как сырой XML, чтобы не потерять. */
  legacyXml?: string[];
}

export interface Theme {
  name: string;
  info?: Info;
  questions?: Question[];
}

export interface Round {
  name: string;
  /** final — финальный раунд; иначе обычный */
  type?: string;
  info?: Info;
  themes?: Theme[];
}

export interface FileHash {
  name: string;
  hash: string;
}

export interface Package {
  /** Атрибуты <package> в исходном порядке (id, name, version, restriction, date, …, xmlns). */
  attrs: [string, string][];
  tags?: string[];
  files?: FileHash[];
  info?: Info;
  /** Устаревший <global> — сырой XML. */
  globalXml?: string;
  rounds?: Round[];
  /** Порядок дочерних элементов <package>, чтобы писать их как в оригинале. */
  order: string[];
}

export const MEDIA_FOLDERS: Record<string, string> = {
  image: "Images",
  audio: "Audio",
  video: "Video",
  html: "Html",
};

export function getAttr(pkg: Package, name: string): string | undefined {
  return pkg.attrs.find(([k]) => k === name)?.[1];
}

// Линейные значки шапки: одноцветные (цвет текста кнопки), одного размера и толщины —
// в отличие от цветных эмодзи не спорят с подписью и не сливаются друг с другом.

const PATHS = {
  file: "M4 4h6l2 2h8v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z",
  chevron: "M6 9l6 6 6-6",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z",
  library: "M4 4h4v16H4zM10 4h4v16h-4zM16.5 5.2l3.8-1 3.7 15.5-3.8 1z",
  palette: "M12 3a9 9 0 0 0 0 18c1.1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H16a5 5 0 0 0 5-5c0-4-4-7.2-9-7.2zM7.5 11.5h.01M10 7.5h.01M14.5 7.5h.01M17 11h.01",
  paste: "M9 4h6v3H9zM9 5.5H6.5A1.5 1.5 0 0 0 5 7v12.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5H15M9 12h6M9 16h4",
  helper: "M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z",
  gear: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-1.7-1L15 3.5h-4l-.3 2.5a7.5 7.5 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 1.7 1l.3 2.5h4l.3-2.5a7.5 7.5 0 0 0 1.7-1l2.4 1 2-3.4z",
  puzzle: "M10 4a2 2 0 1 1 4 0v2h4v4h-2a2 2 0 1 0 0 4h2v4h-4v-2a2 2 0 1 0-4 0v2H6v-4h2a2 2 0 1 0 0-4H6V6h4z",
  megaphone: "M3 10v4h3l7 4V6L6 10zM16 9a4 4 0 0 1 0 6M6 14l1.5 5h2.5l-1.3-4.4",
  chat: "M4 5h16v11H9l-5 4z",
  box: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9",
  folder: "M4 6h6l2 2h8v10H4z",
  plus: "M12 5v14M5 12h14",
  save: "M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6",
  pencil: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  check: "M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6zM8.5 12l2.5 2.5 4.5-5",
  play: "M7 4.5v15l12-7.5z",
  history: "M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9h.01",
  audio: "M9 18V6l10-2v12M9 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM19 16a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
  video: "M4 6h11v12H4zM15 10l5-3v10l-5-3z",
  shuffle: "M4 7h3l10 10h3M4 17h3l3-3M14 10l3-3h3M18 5l2 2-2 2M18 15l2 2-2 2",
  text: "M5 7V5h14v2M12 5v14M9 19h6",
  doc: "M6 3h8l4 4v14H6zM14 3v4h4",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

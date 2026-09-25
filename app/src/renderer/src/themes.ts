// Темы оформления. Сами цвета — в styles.css (`:root[data-theme="…"]`), здесь только список
// и переключение. Выбор хранится в ui-settings.json, как ширина редактора: окно грузится
// по http с локального сервера, и localStorage для него ненадёжен.

export const THEMES = [
  { id: "dark", title: "Ночь" },
  { id: "studio", title: "Студия" },
  { id: "paper", title: "Бумага" },
  { id: "pastel", title: "Пастель" },
  { id: "minimal", title: "Минимал" },
  { id: "ye", title: "Ye! (неон)" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export function isTheme(v: unknown): v is ThemeId {
  return THEMES.some((t) => t.id === v);
}

/** Поставить тему на <html>. «Ночь» — это стили по умолчанию, атрибут ей не нужен. */
export function applyTheme(id: ThemeId): void {
  if (id === "dark") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = id;
}

/** Тема, сохранённая с прошлого раза; для новых пользователей по умолчанию — «Ye!». */
export function savedTheme(): ThemeId {
  const t = window.api.ui.theme;
  return isTheme(t) ? t : "ye";
}

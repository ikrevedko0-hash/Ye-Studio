// Переключатель темы: в шапке и на стартовом экране. Тема меняется сразу и запоминается.

import { useState } from "react";
import { applyTheme, isTheme, savedTheme, THEMES, type ThemeId } from "./themes";

export function ThemeSwitch() {
  const [theme, setTheme] = useState<ThemeId>(savedTheme);
  const pick = (v: string) => {
    if (!isTheme(v)) return;
    setTheme(v);
    applyTheme(v);
    void window.api.setUi("theme", v);
  };
  return (
    <label className="theme-switch" title="Оформление приложения">
      Тема
      <select value={theme} onChange={(e) => pick(e.target.value)}>
        {THEMES.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
      </select>
    </label>
  );
}

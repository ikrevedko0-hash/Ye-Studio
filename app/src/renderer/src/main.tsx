import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Шрифты лежат внутри приложения: Inter — интерфейс, Rubik — цены и названия тем.
import "@fontsource-variable/inter";
import "@fontsource-variable/rubik";
import { App } from "./App";
import { applyTheme, savedTheme } from "./themes";
import "./styles.css";

// тема — до первой отрисовки, иначе окно мигнёт тёмным
applyTheme(savedTheme());

// ---------- связь с сервером автора: ошибки окна ----------
// Ставим до рендера — тогда падение даже в самом первом кадре не проходит мимо главного процесса.
window.onerror = (message, source, lineno, colno, error) => {
  void window.api.reportError({
    kind: error?.name || "Error",
    message: String(message),
    stack: error?.stack || `${source ?? ""}:${lineno ?? 0}:${colno ?? 0}`,
  });
};
window.addEventListener("unhandledrejection", (e) => {
  const err = e.reason instanceof Error ? e.reason : new Error(String(e.reason));
  void window.api.reportError({ kind: err.name || "UnhandledRejection", message: err.message, stack: err.stack });
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

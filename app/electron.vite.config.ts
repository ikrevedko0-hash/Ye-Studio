import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

// Код открыт (GPL-3.0): сборка без обфускации и без V8-байткода — exe содержит читаемый код, как в репозитории.

export default defineConfig({
  // Зависимости вшиты в out/main: код целиком живёт в code.asar и обновляется без установщика (bootstrap/).
  // bootstrap/pick.js — CommonJS (его же грузит загрузчик без сборки): включаем для него разбор CommonJS.
  main: { build: { sourcemap: false, externalizeDeps: false, commonjsOptions: { include: [/node_modules/, /bootstrap[\/]/] } } },
  preload: { build: { sourcemap: false } },
  renderer: { plugins: [react()], build: { sourcemap: false } },
});

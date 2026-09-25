import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

// Код открыт (GPL-3.0): сборка без обфускации и без V8-байткода — exe содержит читаемый код, как в репозитории.

export default defineConfig({
  main: { build: { sourcemap: false } },
  preload: { build: { sourcemap: false } },
  renderer: { plugins: [react()], build: { sourcemap: false } },
});

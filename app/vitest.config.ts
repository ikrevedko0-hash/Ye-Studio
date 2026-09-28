import { defineConfig } from "vitest/config";

// Тесты — только из tests/: в .stryker-tmp (мутационные прогоны) и .sigame-src (исходники SIGame) свои копии.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});

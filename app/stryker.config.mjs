// Мутационное тестирование (npm run mutate): Stryker портит код по одной правке за раз
// (меняет > на >=, выкидывает условие, подменяет строку) и гоняет тесты. Если тесты остались
// зелёными — «выживший мутант»: эту строку тесты на самом деле не проверяют.
// Отчёт: reports/mutation/index.html. Порог break — ниже него прогон падает (см. .github/workflows/mutation.yml).

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  // Раннер @stryker-mutator/vitest-runner 10 под vitest 5 не включает мутанта в тестах (inject из его
  // setup-файла не доходит): «выживают» все, счёт около 1%. Поэтому командный раннер: Stryker сам
  // передаёт номер мутанта переменной __STRYKER_ACTIVE_MUTANT__, тесты гоняются целиком (~6 с).
  testRunner: "command",
  // sigameRunner.test.ts играет паки настоящим SIGame (~1 мин) и core/siq не проверяет — мимо
  commandRunner: { command: "npx vitest run --no-isolate --bail=1 --reporter=dot --exclude tests/sigameRunner.test.ts" },
  mutate: [
    "src/core/siq/xml.ts",
    "src/core/siq/zip.ts",
    "src/core/siq/helpers.ts",
    "src/core/siq/check.ts",
    "src/core/siq/board.ts",
    "src/core/siq/packSize.ts",
    "src/core/siq/publish.ts",
    "src/core/sigame/report.ts",
    "src/core/sigame/screens.ts",
    "src/core/sigame/protocol.ts",
  ],
  coverageAnalysis: "off",
  reporters: ["html", "clear-text", "progress", "json"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  thresholds: { high: 90, low: 80, break: null },
  concurrency: 4,
  timeoutMS: 20000,
  tempDirName: ".stryker-tmp",
  // повторный прогон пропускает мутантов, которых не касались ни код, ни тесты
  incremental: true,
  incrementalFile: "reports/stryker-incremental.json",
  ignorePatterns: [".sigame-src", "tools", "out", "dist", "dist-*", "reports", "resources/bin", "resources/dict", "build"],
  // TypeScript 7 (нативный) без JS API, которым Stryker переписывает tsconfig; vitest он и не нужен.
  tsconfigFile: "stryker-no-tsconfig.json",
};

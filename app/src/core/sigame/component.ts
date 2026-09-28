// Компонент «Прогон в SIGame» (движок SIGame + стол SIOnline): откуда его качать.
// Лежит в коде, а не в resources/components.json: так новая версия компонента приходит лёгким обновлением кода,
// без нового установщика. Архивы собирает и выкладывает workflow sigame-runner (релиз sigame-… в Ye-Studio,
// без пометки «Latest» — обновления приложения его не видят). Файл пишет npm run sigame-manifest — руками не править.

import type { Manifest } from "../components/manifest";

export const SIGAME_COMPONENT: Pick<Manifest, "files" | "tools"> | null = {
  "files": {
    "sigame-runner": {
      "title": "Движок SIGame 7.13.12 (стенд прогона)",
      "url": "https://github.com/ikrevedko0-hash/Ye-Studio/releases/download/sigame-7.13.12-c94254f-r2/sigame-runner-win-x64.zip",
      "size": 45069561,
      "sha256": "5eb8e5fdaca7509ebcc5ed6f29a19f9dcabfff7c120f338e3c95d02189f5f2d6",
      "unzipTo": "sigame/runner"
    },
    "sigame-table": {
      "title": "Стол SIOnline (экран игрока)",
      "url": "https://github.com/ikrevedko0-hash/Ye-Studio/releases/download/sigame-7.13.12-c94254f-r2/sigame-table.zip",
      "size": 2359102,
      "sha256": "6fed2c2c229ba74c06ad38db2700544bf971bb4f98fb0170c6b94c6243829030",
      "unzipTo": "sigame/table"
    }
  },
  "tools": {
    "sigame": {
      "version": "7.13.12 / c94254f / r2",
      "files": [
        "sigame-runner",
        "sigame-table"
      ]
    }
  }
};

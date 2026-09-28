// Компонент «Прогон в SIGame» (движок SIGame + стол SIOnline): откуда его качать.
// Лежит в коде, а не в resources/components.json: так новая версия компонента приходит лёгким обновлением кода,
// без нового установщика. Архивы собирает и выкладывает workflow sigame-runner (релиз sigame-… в Ye-Studio,
// без пометки «Latest» — обновления приложения его не видят). Файл пишет npm run sigame-manifest — руками не править.

import type { Manifest } from "../components/manifest";

export const SIGAME_COMPONENT: Pick<Manifest, "files" | "tools"> | null = {
  "files": {
    "sigame-runner": {
      "title": "Движок SIGame 7.13.12 (стенд прогона)",
      "url": "https://github.com/ikrevedko0-hash/Ye-Studio/releases/download/sigame-7.13.12-c94254f/sigame-runner-win-x64.zip",
      "size": 45068637,
      "sha256": "640ba7a4c011ec903096fbeff700bdd302d06eeb4946081e336bd6a6fee407fc",
      "unzipTo": "sigame/runner"
    },
    "sigame-table": {
      "title": "Стол SIOnline (экран игрока)",
      "url": "https://github.com/ikrevedko0-hash/Ye-Studio/releases/download/sigame-7.13.12-c94254f/sigame-table.zip",
      "size": 2359102,
      "sha256": "a4084e2b8f4b8af92bcd4154f03d2d1459c5a7dd09d1f99de857006943a33cea",
      "unzipTo": "sigame/table"
    }
  },
  "tools": {
    "sigame": {
      "version": "7.13.12 / c94254f",
      "files": [
        "sigame-runner",
        "sigame-table"
      ]
    }
  }
};

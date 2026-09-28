// Компонент «Прогон в SIGame» (движок SIGame + стол SIOnline): откуда его качать.
// Лежит в коде, а не в resources/components.json: так новая версия компонента приходит лёгким обновлением кода,
// без нового установщика. Архивы собирает и выкладывает workflow sigame-runner (релиз sigame-… в Ye-Studio,
// без пометки «Latest» — обновления приложения его не видят). Файл пишет npm run sigame-manifest — руками не править.

import type { Manifest } from "../components/manifest";

export const SIGAME_COMPONENT: Pick<Manifest, "files" | "tools"> | null = {
  "files": {
    "sigame-runner": {
      "title": "Движок SIGame 7.13.12 (стенд прогона)",
      "url": "https://github.com/ikrevedko0-hash/Ye-Studio/releases/download/sigame-7.13.12-c94254f-r3/sigame-runner-win-x64.zip",
      "size": 45069538,
      "sha256": "c6ee4a22dccf7399ec122edbffb347ea91143b95a6edfc31765e5fcdcf008ef0",
      "unzipTo": "sigame/runner"
    },
    "sigame-table": {
      "title": "Стол SIOnline (экран игрока)",
      "url": "https://github.com/ikrevedko0-hash/Ye-Studio/releases/download/sigame-7.13.12-c94254f-r3/sigame-table.zip",
      "size": 2359102,
      "sha256": "bafe3f69bef1807bdf5056acf09fe76beb2e241f9551bf8708dde57832ee1739",
      "unzipTo": "sigame/table"
    }
  },
  "tools": {
    "sigame": {
      "version": "7.13.12 / c94254f / r3",
      "files": [
        "sigame-runner",
        "sigame-table"
      ]
    }
  }
};

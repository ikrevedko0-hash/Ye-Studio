// Компонент «Прогон в SIGame» (движок SIGame + стол SIOnline): откуда его качать.
// Лежит в коде, а не в resources/components.json: так новая версия компонента приходит лёгким обновлением кода,
// без нового установщика. Архивы собирает и выкладывает workflow sigame-runner (релиз sigame-… в Ye-Studio,
// без пометки «Latest» — обновления приложения его не видят). Файл пишет npm run sigame-manifest — руками не править.

import type { Manifest } from "../components/manifest";

export const SIGAME_COMPONENT: Pick<Manifest, "files" | "tools"> | null = null;

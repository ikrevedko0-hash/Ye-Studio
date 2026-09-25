// Реестр источников. Единственное место, где перечислены конкретные сайты.

import { instagram } from "./instagram";
import { openverse } from "./openverse";
import { rutube } from "./rutube";
import { wikimedia } from "./wikimedia";
import { yandex } from "./yandex";
import { youtube } from "./youtube";
import type { MediaProvider, MediaType, ProviderConfig } from "./types";

// порядок важен: выдача раскладывается по кругу, и первым идёт самый полезный для паков
const ALL: MediaProvider[] = [yandex, openverse, wikimedia, rutube, youtube, instagram];

/** Добавить источник из другого места (проверки, будущие расширения). */
export function registerProvider(p: MediaProvider): void {
  const i = ALL.findIndex((x) => x.id === p.id);
  if (i >= 0) ALL[i] = p;
  else ALL.push(p);
}

export function allProviders(): MediaProvider[] {
  return [...ALL];
}

export function providerById(id: string): MediaProvider | undefined {
  return ALL.find((p) => p.id === id);
}

export interface ProviderInfo {
  id: string;
  title: string;
  types: MediaType[];
  note?: string;
  available: boolean;
  /** Почему недоступен: нет ключа, нет внешней программы. */
  reason?: string;
}

export async function providerInfos(cfg: ProviderConfig): Promise<ProviderInfo[]> {
  const off = new Set(cfg.disabled ?? []);
  return Promise.all(ALL.map(async (p) => {
    const available = !off.has(p.id) && (await p.available(cfg));
    const reason = off.has(p.id)
      ? "выключен в настройках"
      : !available
        ? p.needsKey ? `нужен ключ «${p.needsKey}»` : "недоступен на этой машине"
        : undefined;
    return { id: p.id, title: p.title, types: p.types, note: p.note, available, reason };
  }));
}

/** Источники, которые сейчас умеют искать такой тип медиа. */
export async function providersFor(type: MediaType, cfg: ProviderConfig): Promise<MediaProvider[]> {
  const infos = await providerInfos(cfg);
  const ok = new Set(infos.filter((i) => i.available).map((i) => i.id));
  return ALL.filter((p) => ok.has(p.id) && p.types.includes(type));
}

// «Контроль качества» SIGame: пустой файл quality.marker в корне архива (SIPackages 7.14, SIDocument.QualityMarkerName).
// Пак с маркером SIGame показывает как проверенный; лимиты ниже — из SIPackages.Models.Quality.

export const QUALITY_MARKER = "quality.marker";

export const QUALITY_LIMITS: Record<string, { mb: number; ext: string[] }> = {
  Images: { mb: 1, ext: [".jpg", ".jpe", ".jpeg", ".png", ".gif", ".webp", ".avif"] },
  Audio: { mb: 5, ext: [".mp3", ".opus"] },
  Video: { mb: 10, ext: [".mp4"] },
  Html: { mb: 1, ext: [".html"] },
};

export interface QualityProblem {
  folder: string;
  name: string;
  /** «больше 1 МБ» или «формат .wav» */
  why: string;
}

/** Файлы пака, которые не проходят лимиты контроля качества. */
export function qualityProblems(media: { folder: string; name: string; size: number }[]): QualityProblem[] {
  const out: QualityProblem[] = [];
  for (const m of media) {
    const lim = QUALITY_LIMITS[m.folder];
    if (!lim) continue;
    const dot = m.name.lastIndexOf(".");
    const ext = dot < 0 ? "" : m.name.slice(dot).toLowerCase();
    if (!lim.ext.includes(ext)) out.push({ folder: m.folder, name: m.name, why: ext ? `формат ${ext}` : "без расширения" });
    else if (m.size > lim.mb * 1024 * 1024) out.push({ folder: m.folder, name: m.name, why: `больше ${lim.mb} МБ` });
  }
  return out;
}

/** Дата пака, как её пишет SIQuester: дд.мм.гггг. */
export function packDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

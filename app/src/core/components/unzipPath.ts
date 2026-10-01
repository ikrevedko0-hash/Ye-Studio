// Куда в папке назначения ложится запись архива при распаковке «с деревом» (keepTree).
// Чистая функция: yauzl и диск здесь не нужны, поэтому проверяется тестом без файлов.

/**
 * Относительный путь записи после среза префикса (stripPrefix, например «piper/»).
 * null — запись пропустить: папка, лежит вне префикса, либо путь опасный
 * (`..`, абсолютный, с диском, обратные слэши как разделители не допускаются).
 */
export function treeTarget(entryName: string, stripPrefix?: string): string[] | null {
  if (!entryName || entryName.endsWith("/")) return null;
  let name = entryName;
  if (stripPrefix) {
    if (!name.startsWith(stripPrefix)) return null;
    name = name.slice(stripPrefix.length);
  }
  if (!name || name.startsWith("/") || name.includes("\\") || /^[a-zA-Z]:/.test(name)) return null;
  const parts = name.split("/");
  if (parts.some((p) => p === "" || p === "." || p === ".." || p.includes(":"))) return null;
  return parts;
}

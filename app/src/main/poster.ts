// Отрисовка афиши пака (buildPosterHtml) в PNG: скрытое окно Electron, снимок содержимого.
//
// HTML кладём во временный файл, а не в data:-URL — большая страница в data:-URL на Windows
// иногда не грузится (лимит длины адреса), loadFile надёжнее.

import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, nativeImage, type NativeImage } from "electron";

/** Снимок делаем не выше этой высоты (физических пикселей) — иначе PNG становится неприлично тяжёлым. */
const MAX_CAPTURE_HEIGHT = 8000;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Отрисовать HTML афиши в PNG шириной 1600 и высотой по содержимому. Окно нигде не показывается. */
export async function renderPoster(html: string, outPng: string): Promise<void> {
  const tmpHtml = join(app.getPath("temp"), `ye-poster-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  await writeFile(tmpHtml, html, "utf8");
  const win = new BrowserWindow({
    show: false,
    width: 1600,
    height: 900,
    useContentSize: true,
    frame: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false, offscreen: false },
  });
  try {
    await win.loadFile(tmpHtml);
    // ждём загрузку шрифтов (эмодзи и системный шрифт) плюс небольшой запас на перерисовку
    await win.webContents.executeJavaScript('(document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve()');
    await wait(100);
    const fullHeight: number = await win.webContents.executeJavaScript("document.documentElement.scrollHeight");

    // Очень много тем → страница выше MAX_CAPTURE_HEIGHT: уменьшаем масштаб окна целиком (обе стороны
    // пропорционально), чтобы снять одним кадром без склейки, а не резать на куски без нужды.
    let zoom = 1;
    let targetHeight = Math.max(1, Math.round(fullHeight));
    if (targetHeight > MAX_CAPTURE_HEIGHT) {
      zoom = MAX_CAPTURE_HEIGHT / targetHeight;
      win.webContents.setZoomFactor(zoom);
      targetHeight = MAX_CAPTURE_HEIGHT;
    }
    const targetWidth = Math.max(1, Math.round(1600 * zoom));

    win.setContentSize(targetWidth, targetHeight);
    await wait(150); // ~2 кадра, чтобы разметка успела перестроиться под новый размер

    const [, gotH] = win.getContentSize();
    let image: NativeImage;
    if (gotH >= targetHeight - 2) {
      // окно приняло нужный размер целиком — обычный снимок (первый кадр бывает устаревшим)
      await win.webContents.capturePage();
      image = await win.webContents.capturePage();
    } else {
      // Windows ограничила окно высотой экрана (окно выше рабочей области) — снимаем кусками со
      // прокруткой и складываем сырые пиксели вручную.
      image = await captureInChunks(win, targetHeight, gotH);
    }
    await writeFile(outPng, image.toPNG());
  } finally {
    win.destroy();
    await rm(tmpHtml, { force: true });
  }
}

/**
 * Снимок кусками: окну не дали вырасти выше `chunkCssHeight` (логических пикселей), а страница
 * высотой `fullCssHeight` — прокручиваем и снимаем видимую часть раз за разом, складывая
 * результат по сырым BGRA-пикселям (nativeImage.toBitmap/createFromBitmap). Размеры кадра берём
 * из image.getSize() — capturePage отдаёт физические пиксели с учётом scaleFactor экрана.
 */
async function captureInChunks(win: BrowserWindow, fullCssHeight: number, chunkCssHeight: number): Promise<NativeImage> {
  const rows: Buffer[] = [];
  let physWidth = 0;
  let capturedCss = 0;
  while (capturedCss < fullCssHeight) {
    await win.webContents.executeJavaScript(`window.scrollTo(0, ${capturedCss})`);
    await wait(120);
    await win.webContents.capturePage();
    const shot = await win.webContents.capturePage();
    const { width, height } = shot.getSize();
    physWidth = width;
    const remainingCss = fullCssHeight - capturedCss;
    const takeCss = Math.min(chunkCssHeight, remainingCss);
    // сколько физических строк этого куска реально нужно (последний кусок обычно неполный)
    const takePhys = Math.max(1, Math.round((takeCss / chunkCssHeight) * height));
    const bytesPerRow = width * 4; // BGRA
    const bitmap = shot.toBitmap();
    rows.push(Buffer.from(bitmap.subarray(0, Math.min(bitmap.length, takePhys * bytesPerRow))));
    capturedCss += takeCss;
  }
  const combined = Buffer.concat(rows);
  const totalPhysHeight = Math.max(1, Math.floor(combined.length / (physWidth * 4)));
  return nativeImage.createFromBitmap(combined, { width: physWidth, height: totalPhysHeight });
}

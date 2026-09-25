import { useEffect, useState, type CSSProperties, type RefObject } from "react";

/**
 * Коробка ровно по картинке, вписанной в рамку редактора. Рамка тянется на всё свободное место,
 * а кадр внутри неё меньше и стоит по центру. Если считать доли фигур от рамки, заглушка
 * ложится на кадр сжатой и сдвинутой к центру. Поэтому кадр и фигуры кладём в эту коробку,
 * и доли считаем от неё.
 */
export function useFitBox(frameRef: RefObject<HTMLElement | null>, mediaW?: number, mediaH?: number): CSSProperties {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = frameRef.current;
    if (!el || !mediaW || !mediaH) return;
    const apply = () => {
      const fw = el.clientWidth, fh = el.clientHeight;
      if (!fw || !fh) return;
      // кадр не растягиваем больше натурального размера — как было с max-width/max-height
      const k = Math.min(fw / mediaW, fh / mediaH, 1);
      setBox({ w: Math.floor(mediaW * k), h: Math.floor(mediaH * k) });
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [frameRef, mediaW, mediaH]);
  return box ? { width: box.w, height: box.h } : { width: "100%", height: "100%" };
}

/** Точка указателя в долях коробки кадра, прижатая к её краям. */
export function fractionIn(box: HTMLElement, e: { clientX: number; clientY: number }): { x: number; y: number } {
  const r = box.getBoundingClientRect();
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
}

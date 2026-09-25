// Художественные стили картинок: автор ставит галочки по-русски, а английское описание
// дописывается к сцене при рисовании. Сцену текстовая модель пишет без стиля — поэтому
// сменить стиль можно без новой сцены, «Ещё вариант» сразу рисует уже по-другому.
//
// FLUX klein своего «лица» не имеет: без явного стиля он рисует ровно и безлико
// (в отличие от Midjourney v4, где мрачный концепт-арт был стилем по умолчанию). Поэтому стиль
// называем прямо и с приметами — освещение, палитра, материал.

export interface ImageStyle {
  id: string;
  title: string;
  /** Одна строка подсказки в окне: чего ждать. */
  about: string;
  /** Английский хвост к сцене. */
  text: string;
}

export const IMAGE_STYLES: ImageStyle[] = [
  {
    id: "epic",
    title: "Эпичный мрак",
    about: "как Midjourney: концепт-арт, дым, огонь, чудовищный масштаб",
    text: "Style: epic dark cinematic concept art, digital matte painting like a disaster-movie poster; dramatic moody lighting, smoke, dust and haze, muted desaturated palette with fiery orange accents, highly detailed textures, monumental scale, ominous atmosphere; everything is huge, grotesque and deadly serious.",
  },
  {
    id: "photo",
    title: "Фото всерьёз",
    about: "будто это правда случилось: обычный снимок, естественный свет",
    text: "Style: candid realistic photograph, natural daylight, real textures, shallow depth of field, shot on a 35mm camera; the absurd scene looks completely real and ordinary.",
  },
  {
    id: "film",
    title: "Кадр из фильма",
    about: "широкий кинокадр, кинематографичный свет и цвет",
    text: "Style: cinematic film still, anamorphic widescreen composition, dramatic film lighting, rich color grading, film grain, like a frame from a big-budget movie.",
  },
  {
    id: "pixar",
    title: "3D-мультфильм",
    about: "как Pixar: объёмные милые персонажи, мягкий свет",
    text: "Style: 3D animated feature film still in the style of Pixar, expressive stylized characters, soft global illumination, vibrant but natural colors, highly detailed.",
  },
  {
    id: "clay",
    title: "Пластилин",
    about: "кукольная анимация: пластилин, отпечатки пальцев, миниатюра",
    text: "Style: stop-motion claymation, everything sculpted from plasticine with visible fingerprints and tool marks, miniature handmade set, soft studio lighting.",
  },
  {
    id: "oil",
    title: "Масло, классика",
    about: "картина маслом как в музее, мазки, старые мастера",
    text: "Style: classical oil painting in the manner of old masters, visible brushstrokes, rich chiaroscuro lighting, varnished canvas texture, museum masterpiece.",
  },
  {
    id: "soviet-book",
    title: "Советская книжка",
    about: "иллюстрация детской книги 70-х: гуашь, тёплые цвета",
    text: "Style: 1970s Soviet children's book illustration, gouache and ink on paper, warm muted colors, charming naive characters, slightly faded print texture.",
  },
  {
    id: "engraving",
    title: "Старинная гравюра",
    about: "чёрно-белая гравюра XIX века, штриховка",
    text: "Style: 19th-century black and white engraving, fine cross-hatching, etched lines on aged paper, like an illustration from an old encyclopedia.",
  },
  {
    id: "watercolor",
    title: "Акварель",
    about: "лёгкая акварель, подтёки, бумага",
    text: "Style: delicate watercolor painting, soft washes and blooms, visible paper grain, loose expressive brushwork.",
  },
  {
    id: "anime",
    title: "Аниме",
    about: "рисованный японский мультфильм, как у Миядзаки",
    text: "Style: hand-drawn Japanese anime film still in the style of Studio Ghibli, lush painted backgrounds, soft cel shading, gentle warm light.",
  },
  {
    id: "comic",
    title: "Комикс",
    about: "американский комикс: контур, растр, динамика",
    text: "Style: bold American comic book panel, thick ink outlines, halftone dots, dynamic angle, saturated flat colors, no speech bubbles.",
  },
  {
    id: "vintage",
    title: "Старое фото",
    about: "выцветшая фотография начала XX века, сепия",
    text: "Style: vintage photograph from the early 1900s, sepia tone, faded and scratched print, soft focus, formal old-fashioned composition.",
  },
  {
    id: "pixel",
    title: "Пиксель-арт",
    about: "ретро-игра 90-х, крупные пиксели",
    text: "Style: 16-bit retro video game pixel art, crisp large pixels, limited color palette, side view like a 1990s console game.",
  },
];

/** Стиль по id; неизвестный или пустой — без стиля. */
export function styleText(id: string | undefined): string {
  return IMAGE_STYLES.find((s) => s.id === id)?.text ?? "";
}

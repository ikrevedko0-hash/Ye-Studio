// «Живая пикселизация» — HTML-вопрос для SIGame: картинка проявляется из крупных пикселей по таймеру.
// Продолжение темы «Картина по пикселизации» (игроки Уе!пака №10 отметили её 🔥) и ответ на находку из
// топа FirePacks: в «Солянке №5» 19 HTML-вопросов, и у неё самый быстрый рост игр в серии.
//
// SIGame кладёт такие файлы в папку Html пака: <item type="html" isRef="True">имя.html</item>.
// Страница самодостаточна: картинка внутри (data:), ни одного запроса в сеть — у игрока может не быть
// выхода наружу, а у окна Ye!Studio он закрыт намеренно. Чистая функция — без DOM, проверяется тестами.

export interface PixelRevealOptions {
  /** Картинка как data:image/…;base64,… */
  image: string;
  /** За сколько секунд пройти все ступени. */
  seconds?: number;
  /** Блоков по длинной стороне: от первой ступени к последней. Последняя — ещё не оригинал: его покажет ответ. */
  blocks?: number[];
  /** Подпись сверху («Назовите картину»). */
  title?: string;
}

export const REVEAL_DEFAULTS = { seconds: 20, blocks: [4, 6, 9, 14, 20, 30, 44, 64] };

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function buildPixelRevealHtml(opts: PixelRevealOptions): string {
  if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(opts.image)) throw new Error("нужна картинка data:image/…;base64");
  const seconds = opts.seconds && opts.seconds > 0 ? opts.seconds : REVEAL_DEFAULTS.seconds;
  const blocks = (opts.blocks?.length ? opts.blocks : REVEAL_DEFAULTS.blocks).map((b) => Math.max(1, Math.round(b)));
  const title = opts.title?.trim() ? `<div class="t">${escapeHtml(opts.title.trim())}</div>` : "";
  // JSON в <script>: «</» не может закрыть тег, картинка проверена регуляркой выше
  const data = JSON.stringify({ seconds, blocks }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Живая пикселизация</title>
<style>
html,body{margin:0;height:100%;background:#111;color:#fff;font:600 3vmin system-ui,sans-serif;overflow:hidden}
body{display:flex;flex-direction:column;align-items:center;justify-content:center}
.t{padding:1vmin 2vmin}
canvas{max-width:100vw;max-height:${title ? "88" : "95"}vh;image-rendering:pixelated}
.bar{position:fixed;left:0;bottom:0;height:1vmin;background:#f5b300;width:0}
</style></head><body>${title}<canvas id="c"></canvas><div class="bar" id="bar"></div>
<script>
(function(){
var cfg=${data};
var img=new Image();
img.onload=function(){
  var c=document.getElementById("c"),x=c.getContext("2d"),bar=document.getElementById("bar");
  c.width=img.naturalWidth;c.height=img.naturalHeight;
  var small=document.createElement("canvas"),sx=small.getContext("2d");
  var step=-1,start=Date.now(),per=cfg.seconds*1000/cfg.blocks.length;
  function draw(i){
    var n=cfg.blocks[i],k=n/Math.max(img.naturalWidth,img.naturalHeight);
    small.width=Math.max(1,Math.round(img.naturalWidth*k));small.height=Math.max(1,Math.round(img.naturalHeight*k));
    sx.imageSmoothingEnabled=true;sx.drawImage(img,0,0,small.width,small.height);
    x.imageSmoothingEnabled=false;x.clearRect(0,0,c.width,c.height);x.drawImage(small,0,0,c.width,c.height);
  }
  function tick(){
    var t=Date.now()-start,i=Math.min(cfg.blocks.length-1,Math.floor(t/per));
    if(i!==step){step=i;draw(i);}
    bar.style.width=Math.min(100,t/(cfg.seconds*10))+"%";
    if(t<cfg.seconds*1000)requestAnimationFrame(tick);
  }
  tick();
};
img.src=${JSON.stringify(opts.image)};
})();
</script></body></html>
`;
}

/** Ступени «живого» проявления: от выбранного крупного пикселя к 64 блокам, геометрически, 8 шагов. */
export function liveRevealBlocks(coarsest: number, finest = 64, steps = 8): number[] {
  const a = Math.max(2, Math.round(coarsest));
  const b = Math.max(a + 1, Math.round(finest));
  const out: number[] = [];
  for (let i = 0; i < steps; i++) {
    const v = Math.round(a * Math.pow(b / a, i / (steps - 1)));
    if (!out.length || v > out[out.length - 1]) out.push(v);
  }
  return out;
}

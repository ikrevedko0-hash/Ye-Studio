// Картинка к панели кук: рука в полосатом рукаве воришки тащит печенье из банки с этикеткой YouTube.
// Свой рисунок, а не стоковое фото: у стока есть правообладатель и водяной знак.
// Рука с печеньем слегка покачивается, с печенья сыплются крошки; при «уменьшить движение» — стоит.

/** Одно печенье: песочный круг и шоколадные капли. Капли разложены по-разному, чтобы не было клонов. */
function Cookie({ x, y, r = 20, seed = 0 }: { x: number; y: number; r?: number; seed?: number }) {
  const chips = [
    [-0.45, -0.3], [0.3, -0.45], [0.05, 0.05], [-0.25, 0.45], [0.5, 0.25], [-0.6, 0.1], [0.2, 0.6],
  ];
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="#d9a35b" stroke="#a8702f" strokeWidth="1.5" />
      <circle cx={x - r * 0.15} cy={y - r * 0.2} r={r * 0.75} fill="#e6b772" opacity=".45" />
      {chips.map(([dx, dy], i) => (
        <ellipse
          key={i}
          cx={x + dx * r * (1 - ((seed + i) % 3) * 0.08)}
          cy={y + dy * r}
          rx={r * 0.11}
          ry={r * 0.08}
          transform={`rotate(${(seed * 37 + i * 53) % 180} ${x + dx * r} ${y + dy * r})`}
          fill="#5a3418"
        />
      ))}
    </g>
  );
}

export function CookieJarArt() {
  return (
    <svg className="cookie-jar-art" viewBox="0 -44 250 244" role="img" aria-label="Рука в полосатом рукаве достаёт печенье из банки с надписью YouTube">
      <defs>
        <clipPath id="cj-inside">
          <rect x="42" y="74" width="126" height="114" rx="16" />
        </clipPath>
        <linearGradient id="cj-glass" x1="0" x2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity=".16" />
          <stop offset=".5" stopColor="#ffffff" stopOpacity=".04" />
          <stop offset="1" stopColor="#ffffff" stopOpacity=".12" />
        </linearGradient>
      </defs>

      {/* тень под банкой */}
      <ellipse cx="108" cy="192" rx="72" ry="6" fill="#000" opacity=".35" />

      {/* печенье внутри банки */}
      <g clipPath="url(#cj-inside)">
        <Cookie x={62} y={178} seed={1} />
        <Cookie x={100} y={182} seed={2} />
        <Cookie x={140} y={177} seed={3} />
        <Cookie x={80} y={150} seed={4} />
        <Cookie x={122} y={148} seed={5} />
        <Cookie x={58} y={124} r={18} seed={6} />
        <Cookie x={150} y={122} r={19} seed={7} />
        <Cookie x={100} y={116} seed={8} />
        <Cookie x={72} y={96} r={17} seed={9} />
        <Cookie x={134} y={94} r={18} seed={10} />
      </g>

      {/* стекло банки */}
      <rect x="40" y="72" width="130" height="118" rx="18" fill="url(#cj-glass)" stroke="#c9d6ee" strokeOpacity=".7" strokeWidth="2" />
      <path d="M52 86 Q48 130 54 176" stroke="#fff" strokeOpacity=".35" strokeWidth="5" strokeLinecap="round" fill="none" />
      <rect x="36" y="62" width="138" height="13" rx="5" fill="#ffffff" fillOpacity=".08" stroke="#c9d6ee" strokeOpacity=".8" strokeWidth="2" />

      {/* этикетка: банка-то чужая */}
      <g transform="rotate(-4 106 150)">
        <rect x="72" y="138" width="68" height="24" rx="5" fill="#f4efe6" stroke="#b9ab94" />
        <rect x="78" y="143" width="20" height="14" rx="4" fill="#e62117" />
        <path d="M85 146.5 L85 153.5 L91.5 150 Z" fill="#fff" />
        <text x="119" y="154" textAnchor="middle" fontSize="10" fontWeight="700" fill="#2a2a2a" fontFamily="Segoe UI, sans-serif">куки</text>
      </g>

      {/* крышка лежит рядом */}
      <g transform="rotate(-22 212 150)">
        <ellipse cx="212" cy="150" rx="15" ry="40" fill="#ffffff" fillOpacity=".07" stroke="#c9d6ee" strokeOpacity=".75" strokeWidth="2" />
        <ellipse cx="229" cy="150" rx="6" ry="11" fill="#ffffff" fillOpacity=".1" stroke="#c9d6ee" strokeOpacity=".75" strokeWidth="2" />
      </g>

      {/* рука воришки с добычей — покачивается. Сдвиг вверх отдельной группой: CSS-анимация
          перекрывает атрибут transform у той же группы. Рукав уходит за верхний край — рука тянется сверху. */}
      <g transform="translate(0 -18)">
      <g className="cj-hand">
        <Cookie x={108} y={62} r={17} seed={11} />
        {/* рукав в полоску */}
        <g>
          <rect x="84" y="-30" width="52" height="64" rx="6" fill="#f2f2f2" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <rect key={i} x="84" y={-30 + i * 10} width="52" height="5" fill="#1d2433" />
          ))}
          <rect x="82" y="30" width="56" height="7" rx="3" fill="#1d2433" />
        </g>
        {/* перчатка: ладонь, пальцы поверх печенья, большой палец сбоку */}
        <path d="M88 36 Q86 52 94 58 L124 58 Q134 52 132 36 Z" fill="#2b3040" stroke="#8d97ad" strokeWidth="1.5" />
        {[92, 101, 110, 119].map((x, i) => (
          <rect key={x} x={x} y={50} width="9" height={i === 0 || i === 3 ? 18 : 22} rx="4.5" fill="#2b3040" stroke="#8d97ad" strokeWidth="1.5" />
        ))}
        <rect x="126" y="44" width="9" height="20" rx="4.5" transform="rotate(-28 130 54)" fill="#2b3040" stroke="#8d97ad" strokeWidth="1.5" />
      </g>
      </g>

      {/* крошки */}
      <circle className="cj-crumb c1" cx="100" cy="62" r="1.8" fill="#d9a35b" />
      <circle className="cj-crumb c2" cx="114" cy="64" r="1.4" fill="#d9a35b" />
      <circle className="cj-crumb c3" cx="106" cy="61" r="1.2" fill="#a8702f" />
    </svg>
  );
}

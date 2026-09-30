/* Айсберг отзывов на Уе!паки. Без фреймворков: один файл, работает с 2019-х телефонов.
   Ответы копятся локально и порциями уходят на сервер — закрыл вкладку посередине, отзыв всё равно засчитан. */
"use strict";

// ---------- справочники (коды — как в server/reviews/reviews.py) ----------
const DISLIKES = [["ai", "🤖 Много ИИ-контента"], ["boring", "😴 Скучно / банально"], ["hard", "🧱 Слишком сложно"],
  ["easy", "🍼 Слишком легко"], ["sound", "🔊 Много звука и видео"], ["dup", "🔁 Вопросы уже были"],
  ["broken", "🔧 Криво собрано"], ["long", "🐌 Затянуто"], ["humor", "😐 Юмор не мой"], ["niche", "👴 Не для моего поколения"]];
const LIKES = [["pics", "🖼 Картинки"], ["themes", "🧩 Темы"], ["humor", "😂 Юмор"], ["nostalgia", "📼 Ностальгия"],
  ["final", "🏁 Финал"], ["balance", "⚖️ Сложность в самый раз"], ["mechanics", "🧠 Необычные механики"], ["adult", "🔞 Взрослые темы"]];
const CONTEXT = [["friends", "🍻 С друзьями"], ["stream", "📺 Смотрел стрим"], ["host", "🎤 Вёл сам"], ["random", "🎲 С незнакомцами в SIGame"]];
const DIFF = [["🧸", "детсад"], ["🎒", "школа"], ["👌", "норм"], ["😵", "больно"], ["🔥", "ад"]];
const WHY = [["boring", "Скучно"], ["wording", "Непонятно, что хотят"], ["wrong", "Факт неверен"], ["hint", "Ответ подсказан"],
  ["media", "Трудно с медиа"], ["dup", "Уже было"], ["easy", "Слишком легко"], ["hard", "Слишком сложно"]];
const REACT = [["meh", "💩", "мимо"], ["ok", "👌", "норм"], ["fire", "🔥", "огонь"]];
const TEXTS = [["author", "Что сказать автору", "Хвали, ругай, предлагай. Автор всё читает (и перечитывает)."],
  ["idea", "Тема, которую ты хочешь увидеть", "«Узнай … по …» — и автор её сделает. Может быть."],
  ["steal", "Вопрос, который ты бы украл", "Опиши вопрос, который ты придумал бы сам."]];

// глубина — та же формула, что Store.depth на сервере; до дна (10 994 м) — только если ответил на всё
const DEPTH = { rating: 5, chip: 15, chipsMax: 10, ctx: 20, diff: 20, themes: 600, questions: 9200, text: 333, max: 10994 };
const POINTS = { rating: 100, chip: 20, ctx: 30, diff: 30, theme: 25, q: 40, why: 10, text: 150, fish: 50, chest: 100 };
const COMBO_GAP_MS = 6000;

// ---------- мелочи ----------
// браузер отдаёт домен в punycode — на грамоте пишем по-человечески
const SITE = location.hostname === "xn--80ajqss.xn--p1ai" ? "уепак.рф" : location.host;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => Math.round(n).toLocaleString("ru-RU");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* iOS: нет вибрации в браузере */ } };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* приватный режим */ } },
};
const JK = window.JOKES || {};
const FALLBACK = { "tier:sky": "Верхушка айсберга | Оцени пак", "tier:l1": "Что не зашло? | ", "tier:l2": "Как играли? | ",
  "tier:l3": "Темы | 🔥 или 💩", "tier:l4": "Бездна | Каждый вопрос отдельно", "tier:l5": "Дно | Напиши автору",
  "misc:offline": "Нет связи. Ответы сохранены и уйдут позже.", "misc:empty_board": "Тут пока никого.",
  "misc:bottom_btn": "🫧 Всплыть с грамотой", "misc:why": "＋ почему?" };
function joke(slot, key) {
  const list = (JK[slot] || []).filter(v => key === undefined || v.k === key);
  if (!list.length) return FALLBACK[`${slot}:${key}`] || "";
  return list[Math.floor(Math.random() * list.length)].t;
}
const split2 = s => { const i = s.indexOf("|"); return i < 0 ? [s.trim(), ""] : [s.slice(0, i).trim(), s.slice(i + 1).trim()]; };
const rateKey = n => n <= 3 ? "1-3" : n <= 6 ? "4-6" : n <= 8 ? "7-8" : String(n);

function pid() {
  let id = store.get("ice:pid", "");
  if (!/^[a-f0-9]{24}$/.test(id)) {
    const b = new Uint8Array(12); crypto.getRandomValues(b);
    id = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
    store.set("ice:pid", id);
  }
  return id;
}

async function api(url, body) {
  const opt = body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {};
  const r = await fetch(url, opt);
  if (!r.ok) throw new Error(r.status + "");
  return r.json();
}

const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
const nQuestions = n => `${n} ${plural(n, "вопрос", "вопроса", "вопросов")}`;

// случайность с зерном: у каждого игрока свой порядок, но после перезагрузки тот же
function rng(seedStr) {
  let h = 1779033703;
  for (const ch of seedStr) h = Math.imul(h ^ ch.charCodeAt(0), 3432918353), h = (h << 13) | (h >>> 19);
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

// Бездна: вопросы вперемешку, дорогие (эмоциональные) — ближе к началу, одна тема подряд не идёт.
// «Дороговизна» — место цены внутри своей темы: у раундов разные шкалы (700 / 1400 / 2100), в финале цен нет.
function mixQuestions(M, seed) {
  const rnd = rng(seed), items = [];
  M.rounds.forEach(r => r.themes.forEach(t => {
    const prices = t.questions.map(q => q.price), lo = Math.min(...prices), hi = Math.max(...prices);
    t.questions.forEach(q => {
      const rank = r.final ? 0.9 : hi > lo ? (q.price - lo) / (hi - lo) : 0.5;
      items.push({ q, t, key: rank + rnd() * 0.45 });
    });
  }));
  items.sort((x, y) => y.key - x.key);
  const out = [];
  while (items.length) {
    const recent = out.slice(-2).map(x => x.t.id), last = recent[recent.length - 1];
    let k = items.findIndex(x => !recent.includes(x.t.id));
    if (k < 0) k = items.findIndex(x => x.t.id !== last);
    out.push(items.splice(Math.max(k, 0), 1)[0]);
  }
  return out;
}

// ---------- эффекты ----------
function toast(html, cls = "", ms = 2800) {
  const t = document.createElement("div");
  t.className = "toast " + cls; t.innerHTML = html;
  const box = $("#toasts"); box.appendChild(t);
  while (box.children.length > 2) box.firstChild.remove();
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, ms);
}
function plus(el, text) {
  if (!el || reduced) return;
  const r = el.getBoundingClientRect(), s = document.createElement("span");
  s.className = "plus"; s.textContent = text;
  s.style.left = Math.min(innerWidth - 90, Math.max(8, r.left + r.width / 2 - 20)) + "px";
  s.style.top = (r.top - 6) + "px";
  $("#fx").appendChild(s); setTimeout(() => s.remove(), 950);
}
function burst(el, emoji) {
  if (!el || reduced) return;
  const r = el.getBoundingClientRect();
  for (let i = 0; i < 7; i++) {
    const s = document.createElement("span"), a = Math.random() * Math.PI * 2, d = 50 + Math.random() * 60;
    s.className = "bit"; s.textContent = emoji;
    s.style.left = (r.left + r.width / 2 - 11) + "px"; s.style.top = (r.top + r.height / 2 - 11) + "px";
    s.style.setProperty("--dx", Math.cos(a) * d + "px"); s.style.setProperty("--dy", Math.sin(a) * d + "px");
    s.style.setProperty("--rot", (Math.random() * 90 - 45) + "deg");
    $("#fx").appendChild(s); setTimeout(() => s.remove(), 950);
  }
}

// верхушка айсберга над линией воды — и на главной, и на странице пака
const TIP = `<svg class="tip" viewBox="0 0 400 90" preserveAspectRatio="none" aria-hidden="true">
      <path d="M140 90 L170 40 L188 52 L206 10 L230 46 L244 36 L260 90 Z" fill="#f4fbff"/>
      <path d="M206 10 L230 46 L220 90 L198 90 Z" fill="#d7ecfa"/>
      <path d="M0 78 Q50 70 100 78 T200 78 T300 78 T400 78 V90 H0 Z" fill="#3aa6d8"/>
    </svg>`;

// ---------- главная ----------
// «Цитаты из прессы», как на обложке книги: n случайных разных из слота blurb («цитата | источник»).
function blurbs(n) {
  const list = (JK.blurb || []).slice();
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  const items = list.slice(0, n).map(v => { const [q, src] = split2(v.t);
    return `<figure class="blurb"><blockquote>${esc(q)}</blockquote>${src ? `<figcaption>— ${esc(src)}</figcaption>` : ""}</figure>`; });
  return items.length ? `<div class="blurbs">${items.join("")}</div>` : "";
}

async function home() {
  document.title = "Айсберг Уе!паков";
  const app = $("#app");
  app.innerHTML = `<div class="home"><div class="home-sky">
    <div class="sky-top"><div class="sun"></div></div>
    <h1>Айсберг Уе!паков</h1>
    <p class="sub">${esc(joke("home_sub"))}</p>
    ${blurbs(2)}
    <p class="hint">Отвечай на что хочешь: до дна нырять не обязательно, каждый ответ сохраняется сразу.</p>
    ${TIP}</div>
    <div class="packs" id="packs"><div class="pk">Грузим паки…</div></div></div>`;
  try {
    const { packs } = await api("/api/review/packs");
    $("#packs").innerHTML = packs.map((p, i) => `<a class="pk ${i === 0 ? "new" : ""}" href="/${esc(p.slug)}">
      ${p.logo ? `<img src="/p/${esc(p.slug)}/${esc(p.logo)}" alt="" loading="lazy">` : `<div class="nologo"></div>`}
      <div><b>${esc(p.title)}</b><small>${esc(p.date)} · ${nQuestions(p.questions)} · 🤿 ${p.divers}</small></div>
      <span class="go">›</span></a>`).join("") || `<div class="pk">Паков пока нет. Автор, видимо, ещё пишет.</div>`;
  } catch (e) {
    $("#packs").innerHTML = `<div class="pk">${esc(joke("misc", "offline"))}</div>`;
  }
}

// ---------- страница пака ----------
async function pack(slug) {
  let M;
  try { M = await api(`/api/review/pack/${encodeURIComponent(slug)}`); }
  catch (e) {
    $("#app").innerHTML = `<div class="home"><h1>Такого пака нет</h1><p class="sub">Или сервер утонул. <a href="/">К списку паков</a></p></div>`;
    return;
  }
  document.title = `${M.title} — айсберг отзывов`;
  const KEY = `ice:${slug}`;
  const S = Object.assign({ answers: {}, awarded: {}, score: 0, ach: [], nick: "", fish: 0, chest: false, depthTop: 0, streak: { r: "", n: 0 } },
    store.get(KEY, {}));
  const themes = M.rounds.flatMap(r => r.themes);
  const questions = themes.flatMap(t => t.questions);
  const nT = themes.length, nQ = questions.length;
  let pending = store.get(KEY + ":pending", {});
  let combo = 1, lastAt = 0, sendTimer = 0, lastSent = 0, server = null;

  const save = () => { store.set(KEY, S); store.set(KEY + ":pending", pending); };

  // --- глубина и HUD
  function depth() {
    const a = S.answers; let d = 0;
    if (a.rating) d += DEPTH.rating;
    d += DEPTH.chip * Math.min((a.dis || []).length + (a.like || []).length, DEPTH.chipsMax);
    if (a.ctx) d += DEPTH.ctx;
    if (a.diff) d += DEPTH.diff;
    const th = Object.keys(a).filter(k => k.startsWith("th:")).length, qs = Object.keys(a).filter(k => k.startsWith("q:")).length;
    if (nT) d += DEPTH.themes * Math.min(th, nT) / nT;
    if (nQ) d += DEPTH.questions * Math.min(qs, nQ) / nQ;
    d += DEPTH.text * TEXTS.filter(([k]) => a["txt:" + k]).length;
    return Math.min(DEPTH.max, Math.round(d));
  }
  function hud() {
    const d = depth();
    $("#hud-m").textContent = fmt(d);
    $("#hud-s").textContent = fmt(S.score);
    $("#hud-bar").style.width = (100 * d / DEPTH.max).toFixed(1) + "%";
    const c = $("#hud-combo"); c.hidden = combo < 2; c.textContent = "×" + combo;
    if (d >= 1000) achieve("d1000");
    if (d >= 5000) achieve("d5000");
    if (d >= DEPTH.max) achieve("bottom");
  }

  // --- очки, комбо, ачивки
  function award(key, pts, el) {
    const now = Date.now(), before = combo;
    combo = now - lastAt < COMBO_GAP_MS ? Math.min(5, combo + 1) : 1;
    lastAt = now;
    if ((combo === 3 || combo === 5) && combo > before) toast(esc(joke("combo", String(combo))), "", 1800);
    if (combo === 5) achieve("combo5");
    if (S.awarded[key]) { hud(); return; }   // за один и тот же ответ очки один раз — перещёлкивать бесполезно
    S.awarded[key] = 1;
    const got = pts * combo;
    S.score += got;
    plus(el, `+${got}${combo > 1 ? " ×" + combo : ""}`);
    buzz(12);
    hud();
  }
  function achieve(id) {
    if (S.ach.includes(id)) return;
    S.ach.push(id); save();
    const [name, desc] = split2(joke("ach", id) || id);
    toast(`🏆 ${esc(name)}<small>${esc(desc)}</small>`, "ach", 3400);
    buzz([20, 40, 20]);
  }

  // --- ответы и отправка
  function setAnswer(key, value) {
    if (value === null || value === undefined || (Array.isArray(value) && !value.length)) delete S.answers[key];
    else S.answers[key] = value;
    pending[key] = S.answers[key] ?? null;
    save(); schedule();
  }
  function schedule(now) {
    clearTimeout(sendTimer);
    const wait = now ? 0 : Math.max(1200, 4000 - (Date.now() - lastSent));
    sendTimer = setTimeout(flush, wait);
  }
  async function flush() {
    const keys = Object.keys(pending);
    if (!keys.length && S.nickSent === S.nick) return;
    const batch = {}; keys.forEach(k => batch[k] = pending[k]);
    lastSent = Date.now();
    try {
      server = await api("/api/review", { pack: slug, pid: pid(), answers: batch, nick: S.nick, score: S.score, website: $("#hp") ? $("#hp").value : "" });
      keys.forEach(k => { if (JSON.stringify(pending[k]) === JSON.stringify(batch[k])) delete pending[k]; });
      S.nickSent = S.nick; save();
    } catch (e) {
      if (!flush.warned) { flush.warned = true; toast(esc(joke("misc", "offline"))); }
      sendTimer = setTimeout(flush, 15000);
    }
  }
  const beacon = () => {
    if (!Object.keys(pending).length || !navigator.sendBeacon) return;
    navigator.sendBeacon("/api/review", new Blob([JSON.stringify({ pack: slug, pid: pid(), answers: pending, nick: S.nick, score: S.score })], { type: "application/json" }));
  };
  addEventListener("pagehide", beacon);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") beacon(); });

  // --- разметка ярусов
  const tier = (key, meters) => { const [h, sub] = split2(joke("tier", key)); return `<div class="tier"><b>${meters}</b></div><h2>${esc(h)}</h2>${sub ? `<p class="sub">${esc(sub)}</p>` : ""}`; };
  const chip = (group, [id, label], on, bad) => `<button class="chip ${bad ? "bad" : ""} ${on ? "on" : ""}" data-g="${group}" data-v="${id}">${esc(label)}</button>`;
  const thumb = q => q.thumb ? `/p/${encodeURIComponent(slug)}/${q.thumb}` : "";
  const mediaIcons = q => (q.media || []).map(m => ({ image: "🖼", audio: "🎵", video: "🎬" }[m] || "")).join(" ");
  const a = S.answers;

  const qCard = (q, t) => {
    const v = a["q:" + q.id], r = v && v.r, why = (v && v.why) || [];
    return `<div class="q ${r ? "done r-" + r : ""}" data-q="${q.id}">
      ${q.thumb ? `<img class="q-img" src="${thumb(q)}" alt="" loading="lazy" decoding="async">` : `<div class="q-noimg">${mediaIcons(q) || "❓"}</div>`}
      <div class="q-meta"><b>${q.price || "финал"}</b><span class="q-theme">${esc(t.name)}</span><span>${mediaIcons(q)}</span>${q.type === "stake" ? "<span>🎰 аукцион</span>" : q.type === "secret" ? "<span>🐱 кот</span>" : ""}</div>
      ${q.text ? `<div class="q-text">${esc(q.text)}</div>` : ""}
      <div class="q-ans">Ответ: <b>${esc(q.answer || "—")}</b></div>
      <div class="rx">${REACT.map(([id, e, l]) => `<button data-r="${id}" class="${r === id ? "on" : ""}" aria-label="${l}"><span>${e}</span>${l}</button>`).join("")}</div>
      <button class="why-toggle" ${r ? "" : "hidden"}>${esc(joke("misc", "why"))}</button>
      <div class="why chips" ${why.length || r === "meh" ? "" : "hidden"}>${WHY.map(w => chip("why", w, why.includes(w[0]), true)).join("")}</div>
    </div>`;
  };

  const logo = M.logo ? `<img src="/p/${encodeURIComponent(slug)}/${M.logo}" alt="">` : "";
  $("#app").innerHTML = `
  <section class="lv lv-sky" id="lv0">
    <div class="sky-top"><a href="/">← все паки</a><div class="sun"></div></div>
    <div class="pack-head">${logo}<div><h1>${esc(M.title)}</h1><div class="date">${esc(M.date)} · ${nQuestions(nQ)}</div></div></div>
    <p class="hint" style="margin:10px 0 18px">💾 Каждый ответ сохраняется сразу. Проходить весь айсберг не обязательно: ответь на что хочется и уходи, когда надоест.</p>
    ${tier("sky", "Уровень 0 · над водой")}
    <div class="rating">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<button data-rate="${n}" class="${a.rating === n ? "on" : ""}">${n}</button>`).join("")}</div>
    <p class="say" id="say-rate"></p>
    ${TIP}
  </section>
  <section class="lv lv-1" id="lv1">
    ${tier("l1", "Уровень 1 · верхушка")}
    <div class="q-title">Что не зашло</div>
    <div class="chips" data-multi="dis">${DISLIKES.map(d => chip("dis", d, (a.dis || []).includes(d[0]), true)).join("")}</div>
    <p class="say" id="say-dis"></p>
    <div class="q-title">А что зашло</div>
    <div class="chips" data-multi="like">${LIKES.map(d => chip("like", d, (a.like || []).includes(d[0]))).join("")}</div>
    <p class="say" id="say-like"></p>
  </section>
  <section class="lv lv-2" id="lv2">
    ${tier("l2", "Уровень 2 · мелководье")}
    <div class="q-title">Как играл</div>
    <div class="chips">${CONTEXT.map(d => chip("ctx", d, a.ctx === d[0])).join("")}</div>
    <div class="q-title">Сложность пака</div>
    <div class="scale">${DIFF.map(([e, l], i) => `<button data-diff="${i + 1}" class="${a.diff === i + 1 ? "on" : ""}"><span>${e}</span>${l}</button>`).join("")}</div>
  </section>
  <section class="lv lv-3" id="lv3">
    ${tier("l3", "Уровень 3 · стая тем")}
    ${M.rounds.map(r => `<div class="round-name">${esc(r.name)}</div><div class="themes">${r.themes.map(t => {
      const m = a["th:" + t.id], q0 = t.questions.find(q => q.thumb);
      return `<button class="theme ${m || ""}" data-th="${t.id}" ${q0 ? `style="background-image:url('${thumb(q0)}')"` : ""}>
        <span class="mark">${m === "fire" ? "🔥" : m === "poop" ? "💩" : ""}</span>${esc(t.name)}</button>`;
    }).join("")}</div>`).join("")}
    <p class="hint">Тап — 🔥, ещё тап — 💩, третий — передумал.</p>
  </section>
  <section class="lv lv-4" id="lv4">
    ${tier("l4", "Уровень 4 · бездна")}
    <p class="hint" id="abyss-cnt"></p>
    ${mixQuestions(M, pid() + ":" + slug).map(x => qCard(x.q, x.t)).join("")}
  </section>
  <section class="lv lv-5" id="lv5">
    ${tier("l5", "Уровень 5 · дно")}
    ${TEXTS.map(([k, label, ph]) => `<label class="fld" for="txt-${k}">${esc(label)}</label><textarea id="txt-${k}" data-txt="${k}" maxlength="1000" placeholder="${esc(ph)}">${esc(a["txt:" + k] || "")}</textarea>`).join("")}
    <label class="fld" for="nick">Ник для доски дайверов (можно не писать)</label>
    <input type="text" id="nick" maxlength="24" autocomplete="nickname" value="${esc(S.nick)}" placeholder="Капитан Немо">
    <input type="text" id="hp" class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <button class="big" id="finish">${esc(joke("misc", "bottom_btn"))}</button>
    <div class="board"><div class="q-title">🏆 Самые глубокие дайверы</div><ol id="board"></ol></div>
    <button class="chest" id="chest" aria-label="Сундук">🧰</button>
  </section>`;
  $("#hud").hidden = false;
  document.documentElement.style.background = "#010309";
  updateCounts(); hud();

  function updateCounts() {
    const n = questions.filter(q => a["q:" + q.id]).length;
    $("#abyss-cnt").textContent = n ? `Оценено ${n} из ${nQuestions(nQ)}` : `Здесь ${nQuestions(nQ)} вперемешку, самые дорогие — ближе к началу.`;
  }

  // --- события (делегирование: одна подписка на весь айсберг)
  const app = $("#app");
  app.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;

    if (b.dataset.rate) {
      const n = +b.dataset.rate;
      $$("[data-rate]").forEach(x => x.classList.toggle("on", x === b));
      setAnswer("rating", n);
      $("#say-rate").textContent = joke("rate", rateKey(n));
      award("rating", POINTS.rating, b);
      achieve("first");
      if (n <= 3) achieve("hater");
      if (n === 10) { achieve("mom"); burst(b, "💖"); }
      return;
    }
    if (b.dataset.g === "dis" || b.dataset.g === "like") {
      const g = b.dataset.g, v = b.dataset.v, cur = new Set(a[g] || []);
      const on = !cur.has(v); on ? cur.add(v) : cur.delete(v);
      b.classList.toggle("on", on);
      setAnswer(g, Array.from(cur));
      if (on) { $("#say-" + g).textContent = joke(g, v); award(`${g}:${v}`, POINTS.chip, b); }
      hud(); return;
    }
    if (b.dataset.g === "ctx") {
      $$('[data-g="ctx"]').forEach(x => x.classList.toggle("on", x === b));
      setAnswer("ctx", b.dataset.v); award("ctx", POINTS.ctx, b); return;
    }
    if (b.dataset.diff) {
      $$("[data-diff]").forEach(x => x.classList.toggle("on", x === b));
      setAnswer("diff", +b.dataset.diff); award("diff", POINTS.diff, b); return;
    }
    if (b.dataset.th) {
      const id = b.dataset.th, next = { undefined: "fire", fire: "poop", poop: undefined }[a["th:" + id]];
      b.classList.remove("fire", "poop"); if (next) b.classList.add(next);
      $(".mark", b).textContent = next === "fire" ? "🔥" : next === "poop" ? "💩" : "";
      setAnswer("th:" + id, next || null);
      if (next) award("th:" + id, POINTS.theme, b);
      if (next === "fire") burst(b, "🔥");
      if (themes.every(t => a["th:" + t.id])) achieve("themes");
      hud(); return;
    }
    const card = b.closest(".q");
    if (card && b.dataset.r) {
      const id = card.dataset.q, r = b.dataset.r, prev = a["q:" + id] || {};
      setAnswer("q:" + id, Object.assign({}, prev, { r }));
      $$(".rx button", card).forEach(x => x.classList.toggle("on", x === b));
      card.className = `q done r-${r}`;
      $(".why-toggle", card).hidden = false;
      $(".why", card).hidden = r !== "meh" && !(prev.why || []).length;
      award("q:" + id, POINTS.q, b);
      if (r === "fire") burst(b, "🔥");
      if (!prev.r) {   // серии считаем только по новым ответам
        S.streak = S.streak.r === r ? { r, n: S.streak.n + 1 } : { r, n: 1 };
        if (S.streak.n >= 10 && r === "meh") achieve("meh10");
        if (S.streak.n >= 10 && r === "fire") achieve("fire10");
      }
      updateCounts(); hud(); return;
    }
    if (card && b.classList.contains("why-toggle")) { const w = $(".why", card); w.hidden = !w.hidden; return; }
    if (card && b.dataset.g === "why") {
      const id = card.dataset.q, cur = a["q:" + id]; if (!cur) return;
      const why = new Set(cur.why || []), v = b.dataset.v, on = !why.has(v);
      on ? why.add(v) : why.delete(v);
      b.classList.toggle("on", on);
      const val = { r: cur.r }; if (why.size) val.why = Array.from(why);
      setAnswer("q:" + id, val);
      if (on) award(`why:${id}:${v}`, POINTS.why, b);
      if (on && v === "dup") achieve("dup");
      return;
    }
    if (b.id === "chest") {
      if (!S.chest) { S.chest = true; award("chest", POINTS.chest, b); }
      toast(esc(joke("chest")), "", 4000); burst(b, "💰"); save(); return;
    }
    if (b.id === "finish") { finish(); return; }
  });

  // тексты: сохраняем, когда человек перестал печатать
  let typing = 0;
  app.addEventListener("input", e => {
    const t = e.target;
    if (t.dataset.txt) {
      clearTimeout(typing);
      typing = setTimeout(() => {
        const k = t.dataset.txt, val = t.value.trim();
        setAnswer("txt:" + k, val || null);
        if (val.length >= 10) award("txt:" + k, POINTS.text, t);
        if (k === "author" && val.length > 100) achieve("critic");
        hud();
      }, 700);
    } else if (t.id === "nick") {
      S.nick = t.value.trim().slice(0, 24); save(); schedule();
    }
  });

  // --- рыбы в бездне
  let fishTimer = 0;
  const abyss = $("#lv4");
  if (!reduced && "IntersectionObserver" in window) {
    new IntersectionObserver(([en]) => {
      clearInterval(fishTimer);
      if (en.isIntersecting) fishTimer = setInterval(spawnFish, 16000 + Math.random() * 8000);
    }).observe(abyss);
  }
  function spawnFish() {
    if (document.visibilityState !== "visible") return;
    const f = document.createElement("button"), rtl = Math.random() < .5;
    f.className = "fish" + (rtl ? " rtl" : ""); f.setAttribute("aria-label", "Рыба");
    f.textContent = ["🐟", "🐠", "🐡", "🦑", "🐙"][Math.floor(Math.random() * 5)];
    f.style.top = (innerHeight * (.25 + Math.random() * .5)) + "px"; f.style.left = "0";
    f.style.setProperty("--t", (6 + Math.random() * 4) + "s");
    f.onclick = () => {
      S.fish++; award("fish:" + S.fish, POINTS.fish, f); achieve("fish");
      toast(esc(joke("fish"))); burst(f, "🫧"); f.remove(); save();
    };
    f.addEventListener("animationend", () => f.remove());
    document.body.appendChild(f);
  }

  // --- доска и грамота
  async function board() {
    try {
      const { board } = await api(`/api/review/board/${encodeURIComponent(slug)}`);
      $("#board").innerHTML = board.length ? board.map(b => `<li class="${S.nick && b.nick === S.nick ? "me" : ""}"><span>${esc(b.nick)}</span>${fmt(b.depth)} м · ⭐ ${fmt(b.score)}</li>`).join("")
        : `<li><span>${esc(joke("misc", "empty_board"))}</span></li>`;
    } catch (e) { /* доска — не главное */ }
  }
  new IntersectionObserver(([en], ob) => { if (en.isIntersecting) { board(); ob.disconnect(); } }).observe($("#board"));

  async function finish() {
    clearTimeout(sendTimer);
    await flush();
    board();
    const d = depth(), png = await certificate(d);
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<img src="${png}" alt="Грамота">
      <div class="row"><button class="share">📤 Поделиться</button><button class="close">Назад</button></div>`;
    document.body.appendChild(m);
    buzz([30, 60, 30]);
    $(".close", m).onclick = () => m.remove();
    $(".share", m).onclick = async () => {
      const blob = await (await fetch(png)).blob(), file = new File([blob], `айсберг-${slug}.png`, { type: "image/png" });
      const text = `Я нырнул на ${fmt(d)} м в ${M.title} — ${SITE}/${slug}`;
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], text, url: location.href });
        else if (navigator.share) await navigator.share({ text, url: location.href });
        else { const l = document.createElement("a"); l.href = png; l.download = file.name; l.click(); }
      } catch (e) { /* закрыл меню «Поделиться» */ }
    };
  }

  async function certificate(d) {
    const W = 1080, H = 1350, c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"), bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#cdeeff"); bg.addColorStop(.22, "#eaf7ff"); bg.addColorStop(.2201, "#3aa6d8");
    bg.addColorStop(.55, "#134582"); bg.addColorStop(1, "#010309");
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(235,248,255,.9)";   // айсберг
    g.beginPath(); g.moveTo(420, 297); g.lineTo(480, 170); g.lineTo(520, 200); g.lineTo(560, 110); g.lineTo(610, 190); g.lineTo(650, 170); g.lineTo(700, 297); g.fill();
    g.fillStyle = "rgba(200,232,255,.22)";
    g.beginPath(); g.moveTo(420, 297); g.lineTo(700, 297); g.lineTo(960, H); g.lineTo(120, H); g.fill();
    // маркер глубины на айсберге
    const y = 297 + (H - 420) * (d / DEPTH.max);
    g.fillStyle = "#ffd23f"; g.beginPath(); g.arc(W / 2, y, 16, 0, 7); g.fill();
    g.textAlign = "center"; g.fillStyle = "#0b2340";
    const font = (w, s) => `${w} ${s}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    g.font = font(900, 44); g.fillText(joke("cert"), W / 2, 80, W - 80);
    g.fillStyle = "#fff"; g.font = font(900, 150); g.fillText(`${fmt(d)} м`, W / 2, 560);
    g.font = font(700, 50); g.fillText(M.title, W / 2, 650, W - 80);
    g.font = font(800, 56); g.fillStyle = "#ffd23f"; g.fillText(`⭐ ${fmt(S.score)}`, W / 2, 760);
    g.fillStyle = "#cfe6ff"; g.font = font(600, 40);
    if (server && server.divers > 1) g.fillText(`глубже ${server.deeperThan}% дайверов`, W / 2, 830);
    if (S.nick) g.fillText(S.nick, W / 2, 900, W - 80);
    const names = S.ach.map(id => "🏆 " + split2(joke("ach", id) || id)[0]);
    g.font = font(600, 32); g.fillStyle = "#a9c6e2";
    for (let i = 0; i < Math.min(names.length, 8); i += 2) g.fillText(names.slice(i, i + 2).join("   "), W / 2, 990 + i * 26, W - 80);
    g.font = font(700, 34); g.fillStyle = "#7fdcff"; g.fillText(SITE + "/" + slug, W / 2, H - 60);
    return c.toDataURL("image/png");
  }

  if (Object.keys(pending).length) schedule(true);   // хвост с прошлого раза
}

// ---------- вход ----------
const route = location.pathname.replace(/^\/+|\/+$/g, "");
if (route) pack(route); else home();

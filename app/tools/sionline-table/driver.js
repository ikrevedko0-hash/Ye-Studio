// Драйвер стола SIOnline для «Прогона в SIGame».
// 1. window.chrome.webview — канал, по которому SIGame/SImulator передают столу сообщения сервера
//    ({ type: "raw", message }); SIOnline подписывается на него в LibraryCore.runCore.
// 2. Сбор того, что видит игрок: где и какого размера картинки, видео, кнопки вариантов, текст;
//    что не загрузилось и почему (ошибки элементов, fetch, декодирования звука).
// Всё в одном файле без сборки: грузится в скрытое окно Ye!Studio или в Chromium (npm run sigame-e2e).

(function () {
  "use strict";
  var hub = new EventTarget();
  if (!window.chrome) window.chrome = {};
  window.chrome.webview = hub;

  var errors = [];
  var ye = (window.__ye = { ready: false, errors: errors, host: "127.0.0.1" });

  function note(kind, message, url) {
    errors.push({ kind: kind, message: String(message).slice(0, 300), url: url || null, at: Date.now() });
  }

  // ---------- ошибки ----------
  window.addEventListener("error", function (e) {
    var t = e.target;
    if (t && t !== window && (t.tagName === "IMG" || t.tagName === "VIDEO" || t.tagName === "AUDIO" || t.tagName === "SOURCE")) {
      var code = t.error && t.error.code;
      note(t.tagName.toLowerCase(), code ? "MediaError " + code + (t.error.message ? ": " + t.error.message : "") : "не загрузилось", t.currentSrc || t.src);
    } else if (e.message) {
      note("script", e.message);
    }
  }, true);
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    note("promise", (r && (r.name ? r.name + ": " : "") + (r.message || r)) || "unhandled rejection");
  });

  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : input && input.url;
    return origFetch.call(this, input, init).then(function (resp) {
      if (!resp.ok) note("fetch", "HTTP " + resp.status, url);
      return resp;
    }, function (err) {
      note("fetch", err && err.message || err, url);
      throw err;
    });
  };

  var AC = window.AudioContext || window.webkitAudioContext;
  if (AC && AC.prototype.decodeAudioData) {
    var origDecode = AC.prototype.decodeAudioData;
    AC.prototype.decodeAudioData = function () {
      var p = origDecode.apply(this, arguments);
      if (p && p.catch) p.catch(function (err) { note("audio", "не декодируется: " + (err && err.message || err)); });
      return p;
    };
  }

  // ---------- сообщения ----------
  ye.feed = function (messages) {
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      var text = String(m.text).split("<GAMEHOST>").join(ye.host);
      var ev = new MessageEvent("message", { data: { type: "raw", message: { isSystem: !!m.isSystem, sender: m.sender || "@", text: text } } });
      hub.dispatchEvent(ev);
    }
  };

  // ---------- ожидание ----------
  function pending() {
    var n = 0;
    document.querySelectorAll("img").forEach(function (img) { if (img.src && !img.complete) n++; });
    document.querySelectorAll("video").forEach(function (v) { if (v.src && !v.error && v.readyState < 2) n++; });
    return n;
  }
  /** Ждём, пока догрузятся картинки и видео (не дольше maxMs), и ещё quietMs на анимации появления. */
  ye.settle = function (maxMs, quietMs) {
    var start = Date.now();
    return new Promise(function (resolve) {
      (function tick() {
        var left = pending();
        if (left === 0 || Date.now() - start > maxMs) {
          setTimeout(function () { resolve({ waitedMs: Date.now() - start, stillLoading: pending() }); }, quietMs);
        } else setTimeout(tick, 50);
      })();
    });
  };

  // ---------- замеры ----------
  function rect(el) {
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  }
  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    var s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  }
  function timing(url) {
    if (!url) return null;
    var list = performance.getEntriesByName(url);
    var e = list[list.length - 1];
    return e ? { ms: Math.round(e.duration), bytes: e.transferSize || e.encodedBodySize || 0 } : null;
  }
  function font(el) { return Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10; }

  ye.measure = function () {
    var table = document.getElementById("table") || document.querySelector(".tableContent") || document.body;
    var content = document.querySelector(".layout__content");
    var options = document.querySelector(".layout__options");
    var out = {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      table: rect(table),
      content: rect(content),
      optionsArea: rect(options),
      images: [],
      videos: [],
      options: [],
      texts: [],
      errors: errors.splice(0, errors.length),
    };
    document.querySelectorAll("img.inGameImg").forEach(function (img) {
      if (!visible(img)) return;
      out.images.push({
        src: img.currentSrc || img.src, complete: img.complete, natural: { w: img.naturalWidth, h: img.naturalHeight },
        rect: rect(img), inOption: !!img.closest(".answerOption"), timing: timing(img.currentSrc || img.src),
      });
    });
    document.querySelectorAll("video").forEach(function (v) {
      if (!v.src) return;
      out.videos.push({
        src: v.currentSrc || v.src, readyState: v.readyState, error: v.error ? v.error.code : 0,
        natural: { w: v.videoWidth, h: v.videoHeight }, rect: rect(v), timing: timing(v.currentSrc || v.src),
      });
    });
    document.querySelectorAll(".answerOption").forEach(function (o) {
      if (!visible(o)) return;
      out.options.push({ text: (o.innerText || "").trim().slice(0, 80), rect: rect(o), font: font(o) });
    });
    document.querySelectorAll(".tableText, .tableContent .tableText").forEach(function (t) {
      if (!visible(t) || t.closest(".answerOption")) return;
      var txt = (t.innerText || "").trim();
      if (!txt) return;
      out.texts.push({ text: txt.slice(0, 120), rect: rect(t), font: font(t), overflow: t.scrollHeight > t.clientHeight + 2 || t.scrollWidth > t.clientWidth + 2 });
    });
    return out;
  };
})();

import { TV_POLL_MS } from "./limits"

/**
 * The TV player, as one HTML page. Two copies are made from it: the page at
 * /tv (src/app/tv/route.ts) for a browser or a URL Launcher, and the Samsung
 * app's own index.html (tizen-app/, written by scripts/tizen-player.ts and
 * checked against this by tests/lib/screens/player-html.test.ts). The app
 * carries the player inside it and only talks to the dashboard's API. The first time
 * it shows a 6-digit code to type on the dashboard's Screens page; after that,
 * the playlist the owner picked. No sign-in; see /api/tv/content.
 *
 * Plain HTML and old-style JavaScript on purpose, not a React page. Samsung
 * displays run old browser engines (Tizen 4.0 is Chromium 56, Tizen 6.5 is
 * Chromium 85, Tizen 7.0 is Chromium 94), while the app's bundle is built for
 * Chrome 123+ (package.json browserslist) and the Counter sheets use oklch()
 * and container units. So this page has no framework, no build step, hex
 * colours, vh/vw units, and no syntax newer than Chromium 56 runs (no `?.`,
 * `??`, padStart or spread).
 *
 * What the script does:
 * - First run: makes a random token and keeps it in localStorage (in memory
 *   if storage is full or blocked). That token is the TV's only identity; the
 *   server stores its hash.
 * - Asks /api/tv/content every 5 s while it shows a code (so pairing feels
 *   instant), every 30 s once paired.
 * - Saves every image of the playlist in Cache Storage and the last answer in
 *   localStorage, so with no internet it keeps playing what it had and shows a
 *   small corner note. An image that failed to load is tried again next poll.
 * - Reloads itself once a day, when online, to pick up a new version.
 */
export const DASHBOARD_ORIGIN = "https://dashboard.chrisneddys.com"

/**
 * `base` is "" on the hosted page and the dashboard's address in the app.
 * `app` adds Samsung's TV API script, which only exists inside an installed app.
 */
export function playerHtml({ base, app }: { base: string; app: boolean }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#000000">
<title>Screens</title>${app ? '\n<script src="$WEBAPIS/webapis/webapis.js"></script>' : ""}
<style>
html, body { margin: 0; height: 100%; background: #000; overflow: hidden; cursor: none; }
#tv { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: #000; color: #ede6e1;
  font-family: "DM Sans", "Samsung One", Roboto, "Helvetica Neue", Arial, sans-serif; }
.slide { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: contain; opacity: 0; transition: opacity 700ms ease; }
.slide.on { opacity: 1; }
@media (prefers-reduced-motion: reduce) { .slide { transition: none; } }
.screen { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: #0c0806; box-sizing: border-box; }
.pair { display: flex; align-items: center; padding: 7vh 7vw; }
.pair > div { flex: 1.1 1 0; }
.pair > .code { flex: 1 1 0; margin-left: 5vw; text-align: center; }
.brand { font-weight: 700; font-size: 3.2vh; color: #a49d98; margin: 0; }
h1 { font-weight: 700; font-size: 9vh; line-height: 1.05; margin: 2vh 0 3vh; }
p { font-size: 3.4vh; line-height: 1.45; color: #a49d98; margin: 0 0 2vh; max-width: 34em; }
p b { color: #ede6e1; }
.digits { display: inline-flex; }
.digits span { font-family: "JetBrains Mono", Menlo, Consolas, monospace; font-size: 12vh; font-weight: 500;
  width: 11vh; height: 16vh; line-height: 16vh; text-align: center; border-radius: 1.6vh; margin: 0 0.8vh;
  background: #1e1a17; box-shadow: inset 0 0 0 1px #37322e; }
.digits span:nth-child(3) { margin-right: 3.8vh; }
small { display: block; margin-top: 3vh; font-family: "JetBrains Mono", Menlo, Consolas, monospace; font-size: 2.6vh; color: #a49d98; }
.msg { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.msg h1 { font-size: 7vh; margin: 0 0 2vh; }
.msg p { font-size: 3.2vh; }
#badge { position: absolute; right: 2vh; bottom: 2vh; display: none; align-items: center; padding: 1vh 1.8vh; border-radius: 1vh;
  background: rgba(12, 8, 6, 0.82); color: #ede6e1; font-family: "JetBrains Mono", Menlo, Consolas, monospace; font-size: 2.2vh; }
#badge:before { content: ""; width: 1.4vh; height: 1.4vh; border-radius: 50%; background: #f4af2d; margin-right: 1vh; }
</style>
</head>
<body>
<div id="tv"><div class="screen msg"><h1>Starting…</h1></div></div>
<div id="badge"></div>
<script>
(function () {
  "use strict";
  var BASE = "${base}";
  var TOKEN_KEY = "screens.token", LAST_KEY = "screens.last", CACHE = "screens-media-v1";
  var PAIRED_POLL = ${TV_POLL_MS}, UNPAIRED_POLL = 5000, RELOAD_AFTER = 24 * 60 * 60 * 1000;
  var root = document.getElementById("tv"), badge = document.getElementById("badge");
  var started = Date.now(), memory = {};

  function get(k) { try { return window.localStorage.getItem(k); } catch (e) { return memory[k] || null; } }
  function put(k, v) { memory[k] = v; try { window.localStorage.setItem(k, v); } catch (e) { /* full or blocked: kept in memory */ } }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function pad2(n) { return n < 10 ? "0" + n : String(n); }

  function deviceToken() {
    var have = get(TOKEN_KEY);
    if (have && /^[A-Za-z0-9_-]{32,128}$/.test(have)) return have;
    var bytes = new Uint8Array(32), bin = "";
    window.crypto.getRandomValues(bytes);
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    var token = btoa(bin).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
    put(TOKEN_KEY, token);
    return token;
  }
  function deviceLabel() {
    var ua = navigator.userAgent, t = /Tizen\\s?([\\d.]+)/i.exec(ua);
    var kind = t ? "Tizen " + t[1] : /Web0S|webOS/i.test(ua) ? "webOS" : /Android/i.test(ua) ? "Android" : "Browser";
    var r = window.devicePixelRatio || 1;
    return kind + " · " + Math.round(screen.width * r) + "x" + Math.round(screen.height * r);
  }
  function readLast() { try { var raw = get(LAST_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }

  // A blob URL for an image from Cache Storage, fetching and saving it first.
  // The plain URL where there is no Cache Storage; null if it could not be had.
  function cachedUrl(url) {
    if (!("caches" in window)) return Promise.resolve(url);
    return caches.open(CACHE).then(function (cache) {
      return cache.match(url).then(function (hit) {
        if (hit) return hit;
        return fetch(url).then(function (res) {
          if (!res.ok) throw new Error(String(res.status));
          return cache.put(url, res.clone()).then(function () { return res; });
        });
      });
    }).then(function (res) { return res.blob(); })
      .then(function (b) { return URL.createObjectURL(b); })
      ["catch"](function () { return null; });
  }
  function pruneCache(keep) {
    if (!("caches" in window)) return;
    caches.open(CACHE).then(function (cache) {
      return cache.keys().then(function (reqs) {
        reqs.forEach(function (r) { if (!keep[new URL(r.url).pathname]) cache["delete"](r); });
      });
    })["catch"](function () {});
  }

  var token = deviceToken(), device = deviceLabel();
  var shownJson = null, version = null, srcs = {}, retry = false, gen = 0;
  var slideTimer = null, clockTimer = null, index = 0, slides = [];

  function stopTimers() {
    if (slideTimer) clearTimeout(slideTimer);
    if (clockTimer) clearInterval(clockTimer);
    slideTimer = clockTimer = null;
  }
  function setOffline(on, paired) {
    badge.textContent = on ? (paired ? "No internet · showing saved slides" : "No internet · waiting to connect") : "";
    badge.style.display = on ? "flex" : "none";
  }

  function showPair(c) {
    stopTimers();
    var digits = "";
    for (var i = 0; i < c.code.length; i++) digits += "<span>" + esc(c.code.charAt(i)) + "</span>";
    root.innerHTML = '<div class="screen pair"><div><p class="brand">Chris N Eddy\\'s Screens</p><h1>Pair this screen</h1>' +
      "<p>On your phone or computer, open <b>Screens</b> in the dashboard, tap <b>Pair a screen</b> and type this code.</p></div>" +
      '<div class="code"><div class="digits">' + digits + '</div><small id="left"></small></div></div>';
    var left = document.getElementById("left"), ends = new Date(c.expiresAt).getTime();
    function tick() {
      var ms = Math.max(0, ends - Date.now());
      left.textContent = ms > 0 ? "new code in " + Math.floor(ms / 60000) + ":" + pad2(Math.floor((ms % 60000) / 1000)) : "getting a new code";
    }
    tick();
    clockTimer = setInterval(tick, 1000);
  }
  function showMsg(title, line) {
    stopTimers();
    root.innerHTML = '<div class="screen msg"><h1>' + esc(title) + "</h1><p>" + esc(line) + "</p></div>";
  }
  function showSlides(list) {
    stopTimers();
    slides = list;
    index = 0;
    var html = "";
    for (var i = 0; i < list.length; i++) {
      html += '<img class="slide' + (i === 0 ? " on" : "") + '" alt="' + esc(list[i].name) + '" src="' + esc(srcs[list[i].url] || BASE + list[i].url) + '">';
    }
    root.innerHTML = html;
    if (list.length > 1) step();
  }
  function step() {
    var s = slides[index];
    slideTimer = setTimeout(function () {
      var imgs = root.getElementsByTagName("img");
      if (imgs[index]) imgs[index].className = "slide";
      index = (index + 1) % slides.length;
      if (imgs[index]) imgs[index].className = "slide on";
      step();
    }, Math.max(3, s.seconds) * 1000);
  }

  function apply(c) {
    var mine = ++gen;
    var ready = Promise.resolve(false);
    if (c.paired && c.playlist) {
      if (c.playlist.version !== version || retry) {
        var list = c.playlist.slides;
        ready = Promise.all(list.map(function (s) { return cachedUrl(BASE + s.url); })).then(function (urls) {
          if (mine !== gen) {
            // A newer answer started meanwhile: drop this one's blob URLs.
            urls.forEach(function (u) { if (u && u.indexOf("blob:") === 0) URL.revokeObjectURL(u); });
            return null;
          }
          var next = {}, failed = false, keep = {};
          for (var i = 0; i < list.length; i++) {
            if (urls[i]) next[list[i].url] = urls[i]; else failed = true;
            keep[list[i].url] = true;
          }
          for (var k in srcs) if (srcs[k].indexOf("blob:") === 0 && next[k] !== srcs[k]) URL.revokeObjectURL(srcs[k]);
          srcs = next;
          retry = failed;
          version = c.playlist.version;
          pruneCache(keep);
          return true;
        });
      }
    } else {
      version = null;
    }
    return ready.then(function (changed) {
      if (changed === null) return;
      var json = JSON.stringify(c);
      // Same answer and same images: leave the slideshow running.
      if (json === shownJson && !changed) return;
      shownJson = json;
      if (!c.paired) showPair(c);
      else if (!c.playlist || c.playlist.slides.length === 0) {
        showMsg(c.screen.name, c.screen.store + " · Nothing to show yet. Pick a playlist for this screen in the dashboard.");
      } else showSlides(c.playlist.slides);
    });
  }

  function poll() {
    var paired = true;
    fetch(BASE + "/api/tv/content", {
      headers: { authorization: "Bearer " + token, "x-screen-device": device },
      cache: "no-store"
    }).then(function (res) {
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    }).then(function (c) {
      paired = c.paired;
      put(LAST_KEY, JSON.stringify(c));
      setOffline(false, paired);
      if (Date.now() - started > RELOAD_AFTER) { window.location.reload(); return; }
      return apply(c);
    })["catch"](function () {
      var last = readLast();
      paired = last ? last.paired : false;
      setOffline(true, paired);
    }).then(function () {
      setTimeout(poll, paired ? PAIRED_POLL : UNPAIRED_POLL);
    });
  }

  // Keep the screen awake: the Samsung app turns the TV's screen saver off;
  // a browser asks for a wake lock where it offers one.
  function wake() {
    try {
      var ac = window.webapis && window.webapis.appcommon;
      if (ac) ac.setScreenSaver(ac.AppCommonScreenSaverState.SCREEN_SAVER_OFF);
    } catch (e) {}
    try { if (navigator.wakeLock) navigator.wakeLock.request("screen")["catch"](function () {}); } catch (e) {}
  }
  wake();
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") wake(); });

  var last = readLast();
  if (last) apply(last);
  poll();
})();
</script>
</body>
</html>
`
}

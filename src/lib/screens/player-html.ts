import { PLAYER_VERSION, TV_BEAT_MS, TV_NUDGE_RETRY_MS, TV_POLL_DOWN_MS, TV_POLL_FAST_FOR_MS, TV_POLL_FAST_MS, TV_POLL_SLOW_MS } from "./limits"
import { TV_LOGO } from "./tv-logo"

/**
 * The TV player, as one HTML page. Two copies are made from it: the page at
 * /tv (src/app/tv/route.ts) for a browser or a URL Launcher, and the Samsung
 * app's own index.html (tizen-app/, written by scripts/tizen-player.ts and
 * checked against this by tests/lib/screens/player-html.test.ts). The app
 * carries the player inside it and only talks to the dashboard's API. The first time
 * it shows a square to scan (and a 6-digit code to type); after that, the
 * pictures the owner put on this screen. No sign-in; see /api/tv/content.
 *
 * Plain HTML and old-style JavaScript on purpose, not a React page. Samsung
 * TVs run old browser engines (Tizen 2.3 and 2.4 are WebKit, 3.0 is Chromium
 * 47, 4.0 is 56, 6.5 is 85, 7.0 is 94), while the app's bundle is built for
 * Chrome 123+ (package.json browserslist) and the Counter sheets use oklch()
 * and container units. So this page has no framework, no build step, hex
 * colours, vh/vw units, XMLHttpRequest instead of fetch, a small Promise where
 * there is none, -webkit- prefixes, and no syntax newer than ES5. Where the TV
 * has no Cache Storage (2015 and 2016 sets) pictures play straight from the
 * network, so only those sets go dark if they restart with no internet.
 *
 * What the script does:
 * - First run: makes a random token and keeps it in localStorage (in memory
 *   if storage is full or blocked). That token is the TV's only identity; the
 *   server stores its hash.
 * - While it shows a code it asks /api/tv/content every 5 s, with its token
 *   in a header, so pairing feels instant. That address makes the code.
 * - Once paired it asks /api/tv/c/<token> instead, with no headers at all, so
 *   Vercel's CDN can answer without running the server. The dashboard clears
 *   that copy when anything changes. The answer can be up to an hour old, so
 *   its clock is never used to set the time, and a copy older than the one
 *   already showing is not put back. If it says "not paired" the TV goes back
 *   to /api/tv/content for a code. A call that hangs is given up on. An answer
 *   that is not the shape expected is a failed call, never shown. When that
 *   address answers wrongly four times running (not when the internet is
 *   down), the TV asks /api/tv/content once, at most every 5 minutes, so it
 *   still gets its pictures, the time, and is seen to be on. "No internet"
 *   shows only when the network itself failed.
 * - A push line (EventSource to Ably, at the address the answer gives) says
 *   "changed": the TV asks at once, then again after 3 s and 10 s in case the
 *   CDN was still clearing; a burst of messages restarts those two, it does
 *   not add more, and one that lands while a slow call is out is followed
 *   by one more call when it ends. While the line is open the TV asks every
 *   2 minutes. Without it (not open yet, down, or a set with no EventSource)
 *   it asks every 15 s for the first ten minutes, then every 60 s; only a
 *   line that opens starts those ten minutes over. Each wait is plus up to a
 *   tenth so TVs do not ask in step. Never two calls at once. A line closed
 *   for good is opened again after 15 s, then twice as long each time, up to
 *   5 minutes; coming back from standby or offline opens a new one, and so
 *   does a jump in the TV's clock (it slept, or its clock was set). One line
 *   at most.
 * - Every 3 minutes, and when the screen comes back, it calls /api/tv/beat:
 *   that tells the dashboard the TV is on, and its answer is the only live
 *   clock once paired (server time, minutes from UTC, player version).
 * - One picture stays up with no timer. Nothing redraws unless the pictures
 *   themselves change, and a new one is fully loaded before it fades in over
 *   the old one, so the screen never goes dark between them.
 * - Switches to the pictures for a window of the week (lunch, late night) by
 *   itself, offline too, in store time worked out from the server's clock.
 * - Saves every picture in Cache Storage, one download at a time, each tried
 *   again after a growing pause. Old pictures are dropped, and the saved
 *   answer replaced, only once everything in the new one is on the TV, so a
 *   power cut half way through a change comes back to a full board.
 * - Back on the remote opens a small panel: keep playing, check now, close.
 * - The hosted page (not the app) reloads itself once when PLAYER_VERSION moves,
 *   whichever answer says so: never twice for one version, never twice in 10
 *   minutes, and not at all if the TV cannot write that down.
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
<title>ChrisnEddysTV</title>
${app ? '<script src="$WEBAPIS/webapis/webapis.js"></script>\n' : ""}<style>
html, body { margin: 0; height: 100%; background: #000; overflow: hidden; cursor: none; }
body { color: #ede6e1; font-family: "DM Sans", "Samsung One", Roboto, "Helvetica Neue", Arial, sans-serif; }
#stage, .screen { position: fixed; top: 0; left: 0; right: 0; bottom: 0; }
#stage { background: #000; }
.slide { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: #000; -o-object-fit: contain; object-fit: contain; opacity: 0; }
.slide.on { opacity: 1; -webkit-transition: opacity 700ms ease; transition: opacity 700ms ease; }
.screen { background: #14100d; display: none; -webkit-align-items: center; align-items: center; box-sizing: border-box; padding: 7vh 7vw; }
.screen.on { display: -webkit-flex; display: flex; }
.mid { -webkit-flex-direction: column; flex-direction: column; -webkit-justify-content: center; justify-content: center; text-align: center; }
.mid p { margin-left: auto; margin-right: auto; }
.wm { display: block; height: 24vh; width: auto; margin: 0 0 4vh; }
.mid .wm { height: 34vh; margin: 0 auto 5vh; }
h1 { font-weight: 700; font-size: 8.4vh; line-height: 1.08; margin: 0 0 2.4vh; }
p { font-size: 3.4vh; line-height: 1.45; color: #b9b1ab; margin: 0; max-width: 30em; }
p b { color: #ede6e1; }
.left { -webkit-flex: 1 1 0; flex: 1 1 0; padding-right: 6vw; }
.code { font-family: "JetBrains Mono", Menlo, Consolas, monospace; font-size: 8vh; letter-spacing: 0.12em; margin: 3.4vh 0 1vh; }
.small { font-family: "JetBrains Mono", Menlo, Consolas, monospace; font-size: 2.4vh; color: #a49d98; }
.qr { -webkit-flex: none; flex: none; background: #fbf5e4; border-radius: 2vh; padding: 3vh; }
.qr canvas { display: block; width: 46vh; height: 46vh; image-rendering: pixelated; }
.tick { width: 15vh; height: 15vh; line-height: 15vh; border-radius: 50%; background: #2c7a55; font-size: 9vh; margin-bottom: 4vh; }
.bar { width: 40vh; height: 1vh; border-radius: 1vh; background: #332c27; margin-top: 4vh; overflow: hidden; }
.bar i { display: block; width: 35%; height: 100%; background: #f4af2d; -webkit-animation: go 1.6s ease-in-out infinite alternate; animation: go 1.6s ease-in-out infinite alternate; }
@-webkit-keyframes go { from { -webkit-transform: translateX(-10%); } to { -webkit-transform: translateX(200%); } }
@keyframes go { from { transform: translateX(-10%); } to { transform: translateX(200%); } }
#ident { background: #b3261e; z-index: 6; }
#ident h1 { font-size: 15vh; } #ident p { color: #ffe9e4; font-size: 6vh; }
#badge { position: fixed; right: 2vh; bottom: 2vh; display: none; z-index: 5; padding: 1vh 1.8vh; border-radius: 1vh;
  background: #14100d; background: rgba(20, 16, 13, 0.86); font-size: 2.2vh; }
#badge:before { content: ""; display: inline-block; width: 1.4vh; height: 1.4vh; border-radius: 50%; background: #f4af2d; margin-right: 1vh; }
#menu { position: fixed; top: 0; right: 0; bottom: 0; width: 62vh; box-sizing: border-box; padding: 8vh 5vh; display: none; z-index: 7;
  background: #14100d; background: rgba(20, 16, 13, 0.96); }
#menu.on { display: block; }
#menu h2 { font-size: 5vh; margin: 0 0 1vh; } #menu p { font-size: 2.6vh; margin-bottom: 4vh; }
.opt { padding: 2vh 2.6vh; margin-bottom: 1.6vh; border-radius: 1vh; border: 0.3vh solid #4a423c; font-size: 3vh; font-weight: 600; }
.opt.f { background: #fbf5e4; border-color: #fbf5e4; color: #1c1815; }
@media (prefers-reduced-motion: reduce) { .slide.on { transition: none; } .bar i { animation: none; } }
</style>
</head>
<body>
<div id="stage"></div>
<div id="msg" class="screen mid on"><img class="wm" alt="" src="${TV_LOGO}"><h1>Getting your menu ready</h1><div class="bar"><i></i></div></div>
<div id="pair" class="screen"><div class="left"><img class="wm" alt="" src="${TV_LOGO}"><h1>Scan to add this TV</h1><p>Point your phone's camera at the square. Or open <b>Screens</b> in the dashboard, tap <b>Add a TV</b> and type:</p><div class="code" id="code"></div><div class="small" id="left"></div></div><div class="qr"><canvas id="qr"></canvas></div></div>
<div id="ident" class="screen mid"><h1></h1><p></p></div>
<div id="badge"></div>
<div id="menu"></div>
<script>
(function () {
  "use strict";
  var BASE = "${base}", APP = ${app}, PLAYER = "${PLAYER_VERSION}";
  var TOKEN_KEY = "screens.token", LAST_KEY = "screens.last", CACHE = "screens-media-v1";
  var FAST_POLL = ${TV_POLL_FAST_MS}, SLOW_POLL = ${TV_POLL_SLOW_MS}, DOWN_POLL = ${TV_POLL_DOWN_MS}, FAST_FOR = ${TV_POLL_FAST_FOR_MS}, BEAT = ${TV_BEAT_MS}, NUDGE = ${JSON.stringify(TV_NUDGE_RETRY_MS)};
  var UNPAIRED_POLL = 5000, TIMEOUT = 20000, FADE = 900, LINE_WAIT = 15000, LINE_WAIT_MAX = 300000;
  var MISSES = 4, RESCUE_EVERY = 300000, HURRY = 1500, HURRY_EVERY = 60000, OLDER_MAX = 7200000, IDENT_MAX = 120000, RELOAD_EVERY = 600000;
  var stage = el("stage"), badge = el("badge"), menu = el("menu"), msg = el("msg"), ident = el("ident");
  var memory = {}, LOGO = document.querySelector("#pair .wm").src;
  var URLS = window.URL || window.webkitURL;

  // A small Promise for sets that have none (2015). Only what this page uses.
  var P = window.Promise || (function () {
    function P(run) {
      var self = this;
      self.s = 0; self.v = undefined; self.q = [];
      function settle(s, v) { if (self.s) return; self.s = s; self.v = v; setTimeout(function () { self.q.forEach(function (f) { f(); }); self.q = []; }, 0); }
      function ok(v) {
        if (v && typeof v.then === "function") { try { v.then(ok, no); } catch (e) { no(e); } } else settle(1, v);
      }
      function no(e) { settle(2, e); }
      try { run(ok, no); } catch (e) { no(e); }
    }
    P.prototype.then = function (a, b) {
      var self = this;
      return new P(function (ok, no) {
        function go() {
          var f = self.s === 1 ? a : b;
          if (typeof f !== "function") { if (self.s === 1) ok(self.v); else no(self.v); return; }
          try { ok(f(self.v)); } catch (e) { no(e); }
        }
        if (self.s) setTimeout(go, 0); else self.q.push(go);
      });
    };
    P.resolve = function (v) { return new P(function (ok) { ok(v); }); };
    P.all = function (list) {
      return new P(function (ok, no) {
        var out = [], left = list.length;
        if (!left) ok(out);
        list.forEach(function (x, i) { P.resolve(x).then(function (v) { out[i] = v; left -= 1; if (!left) ok(out); }, no); });
      });
    };
    return P;
  })();
  function nothing() { return null; }

  function el(id) { return document.getElementById(id); }
  function get(k) { try { var v = window.localStorage.getItem(k); return v === null && memory[k] ? memory[k] : v; } catch (e) { return memory[k] || null; } }
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

  /* ---- the network ---- */

  // XMLHttpRequest, not fetch: every Samsung TV has it, and it can be given up on.
  // A failure with .net is the network's (nothing came back). Any other is an answer that was wrong.
  function netError(m) { var e = new Error(m); e.net = true; return e; }
  function ask(url, as, headers, ms) {
    return new P(function (ok, no) {
      var x = new XMLHttpRequest(), k;
      x.open("GET", url, true);
      if (as === "blob") x.responseType = "blob";
      x.timeout = ms;
      for (k in headers) x.setRequestHeader(k, headers[k]);
      var guard = setTimeout(function () { try { x.abort(); } catch (e) {} no(netError("timeout")); }, ms + 1000);
      x.onload = function () {
        clearTimeout(guard);
        if (x.status < 200 || x.status > 299) { no(new Error(String(x.status))); return; }
        if (as === "blob") { if (x.response && x.response.size) ok(x.response); else no(new Error("empty")); return; }
        try { ok(JSON.parse(x.responseText)); } catch (e) { no(e); }
      };
      x.onerror = x.ontimeout = x.onabort = function () { clearTimeout(guard); no(netError("network")); };
      x.send();
    });
  }

  /* ---- pictures, saved on the TV ---- */

  var CAN_SAVE = !!(window.caches && window.Response), inflight = {}, waitFor = {}, unsaved = {}, line = P.resolve(null);

  function saved(url) {
    if (!CAN_SAVE) return P.resolve(null);
    try {
      return window.caches.open(CACHE).then(function (c) { return c.match(url); }).then(function (r) { return r ? r.blob() : null; }).then(null, nothing);
    } catch (e) { return P.resolve(null); }
  }
  function present(url) {
    try {
      return window.caches.open(CACHE).then(function (c) { return c.match(url); }).then(function (r) { return !!r; }, function () { return false; });
    } catch (e) { return P.resolve(false); }
  }
  // True once the TV has it. No room is not a reason not to show it, and not a reason to keep asking.
  function save(url, blob) {
    if (!CAN_SAVE) return P.resolve(false);
    try {
      return window.caches.open(CACHE)
        .then(function (c) { return c.put(url, new window.Response(blob, { headers: { "Content-Type": blob.type || "image/jpeg" } })); })
        .then(function () { delete unsaved[url]; return true; }, function () { unsaved[url] = Date.now(); return false; });
    } catch (e) { return P.resolve(false); }
  }
  // The picture's bytes, from the TV or else the network, or null. One caller's
  // download serves them all; downloads go one at a time; a failure waits
  // 15 s, then twice as long each time, up to 15 minutes.
  function bytes(url) {
    if (inflight[url]) return inflight[url];
    inflight[url] = saved(url).then(function (hit) {
      if (hit) return hit;
      var w = waitFor[url];
      if (w && Date.now() < w.until) return null;
      var got = line.then(function () { return ask(url, "blob", {}, 120000); }).then(function (blob) {
        delete waitFor[url];
        return save(url, blob).then(function () { return blob; });
      }, function () {
        var ms = w ? Math.min(w.ms * 2, 900000) : 15000;
        waitFor[url] = { ms: ms, until: Date.now() + ms };
        return null;
      });
      line = got;
      return got;
    }).then(function (b) { delete inflight[url]; return b; }, function () { delete inflight[url]; return null; });
    return inflight[url];
  }
  function release(u) { if (u && u.indexOf("blob:") === 0) try { URLS.revokeObjectURL(u); } catch (e) {} }

  // In an <img> and ready to paint, or null. Without the bytes (an old set that
  // will not hand them over) the plain address is tried.
  function picture(slide) {
    var url = BASE + slide.url;
    return bytes(url).then(function (blob) {
      var src = null;
      if (blob && URLS) try { src = URLS.createObjectURL(blob); } catch (e) {}
      if (src) return paint(slide, src).then(function (it) { return it || paint(slide, url); });
      // The plain address gets one try per pause, so a picture that is gone is not asked for all day.
      var w = waitFor[url];
      if (w && w.tried && Date.now() < w.until) return null;
      if (w) w.tried = true;
      return paint(slide, url);
    });
  }
  function paint(slide, src) {
    return new P(function (done) {
      var img = document.createElement("img"), over = false;
      function end(it) { if (over) return; over = true; clearTimeout(t); if (!it) { img.onload = img.onerror = null; img.removeAttribute("src"); release(src); } done(it); }
      var t = setTimeout(function () { end(null); }, 60000);
      img.className = "slide";
      img.alt = slide.name;
      img.onload = function () { end({ img: img, src: src, url: slide.url }); };
      img.onerror = function () { end(null); };
      img.src = src;
    });
  }
  function everyPath(c) {
    var out = {}, all = (c.playlist ? c.playlist.slides : []).slice();
    (c.times || []).forEach(function (t) { all = all.concat(t.slides); });
    all.forEach(function (s) { out[s.url] = true; });
    return Object.keys(out);
  }
  // Bring every window's pictures onto the TV. Only when all of them are here
  // is this answer the one to restart from, and only then are old ones dropped.
  var storing = null, stored = null, storedAt = 0, wrote = "", wroteAt = 0;
  function keepAnswer(c) {
    var bare = JSON.stringify(c, function (k, v) { return k === "clock" ? undefined : v; });
    if (bare === wrote && Date.now() - wroteAt < 600000) return;
    wrote = bare; wroteAt = Date.now();
    put(LAST_KEY, JSON.stringify(c));
  }
  function store(c) {
    var paths = everyPath(c), key = paths.slice().sort().join("|");
    // Everything was here within the hour (the TV may throw saved files away): nothing to look up.
    if (!CAN_SAVE || (key === stored && Date.now() - storedAt < 3600000)) { keepAnswer(c); return; }
    if (storing === key) return;
    storing = key;
    var all = true, chain = P.resolve(null);
    paths.forEach(function (path) {
      chain = chain.then(function () {
        if (storing !== key) return null;
        var u = BASE + path;
        if (unsaved[u] && Date.now() - unsaved[u] < 3600000) { all = false; return null; }
        return present(u).then(function (hit) {
          if (hit) return null;
          return bytes(u).then(function (b) { if (!b || unsaved[u]) all = false; });
        });
      });
    });
    chain.then(function () {
      if (storing !== key) return;
      storing = null;
      if (!all) return;
      stored = key; storedAt = Date.now();
      keepAnswer(c);
      window.caches.open(CACHE).then(function (cache) {
        return cache.keys().then(function (reqs) {
          reqs.forEach(function (r) {
            var keep = paths.some(function (p) { return r.url.slice(-p.length) === p; });
            if (!keep) cache["delete"](r);
          });
        });
      }).then(null, nothing);
    }, function () { storing = null; });
  }

  /* ---- what is on screen ---- */

  var token = deviceToken(), device = deviceLabel();
  var now = null, sig = null, loading = null, gen = 0, retry = false, set = [], live = {}, top = null, z = 1, index = 0;
  var slideTimer = null, codeTimer = null, identTimer = null, holdTimer = null, holdUntil = 0, seenAt = 0;
  // The server's clock less the TV's, kept so a restart with no internet still knows the time.
  var skew = Number(get("screens.skew")) || 0;
  // Minutes from UTC to store time, from the last live clock, and the server time that clock gave.
  var zone = null;
  // True while this TV takes itself to be paired: it then asks the address the CDN answers.
  var cached = false;

  // A live clock: from /api/tv/beat, or from /api/tv/content. Never from the CDN's copy, which can be an hour old.
  // True when the time or the zone moved enough to matter.
  function setClock(k) {
    var at = k ? new Date(k.now).getTime() : NaN, moved = false;
    if (at !== at) return false;
    var off = at - Date.now();
    if (Math.abs(off - skew) > 5000 || get("screens.skew") === null) { put("screens.skew", String(Math.round(off))); moved = true; }
    skew = off;
    if (typeof k.offsetMinutes === "number") {
      if (!zone || zone.minutes !== k.offsetMinutes) moved = true;
      zone = { at: at, minutes: k.offsetMinutes };
    }
    return moved;
  }

  function only(id) {
    ["msg", "pair"].forEach(function (k) { el(k).className = el(k).className.replace(/ on$/, "") + (k === id ? " on" : ""); });
  }
  function say(title, line, tick) {
    var html = (tick ? '<div class="tick">✓</div>' : '<img class="wm" alt="" src="' + LOGO + '">') + "<h1>" + esc(title) + "</h1><p>" + esc(line) + "</p>";
    if (msg.getAttribute("data-says") !== title + line) { msg.innerHTML = html; msg.setAttribute("data-says", title + line); }
    only("msg");
  }
  function drop(it) { if (it.img.parentNode === stage) stage.removeChild(it.img); release(it.src); }
  function clearStage() {
    if (slideTimer) clearTimeout(slideTimer);
    slideTimer = null;
    Object.keys(live).forEach(function (u) { drop(live[u]); });
    set = []; live = {}; top = null; sig = null; loading = null; retry = false;
  }
  function bring(it) {
    var img = it.img, under = top;
    if (img === under) return;
    img.style.webkitTransition = img.style.transition = "none";
    img.className = "slide";
    img.style.zIndex = String(++z);
    if (img.parentNode !== stage) stage.appendChild(img);
    void img.offsetWidth;
    img.style.webkitTransition = img.style.transition = "";
    img.className = "slide on";
    top = img;
    // Once covered, the one underneath goes: nothing shows through, and nothing is drawn for no reason.
    if (under) setTimeout(function () { if (under !== top) under.className = "slide"; }, FADE);
  }
  function step() {
    slideTimer = setTimeout(function () {
      index = (index + 1) % set.length;
      bring(live[set[index].url]);
      step();
    }, Math.max(3, Number(set[index].seconds) || 10) * 1000);
  }
  function signature(slides) { return slides.map(function (s) { return s.url + ":" + s.seconds; }).join("|"); }

  function show(slides) {
    var want = signature(slides);
    if (want === sig && !retry) {
      // Back to what is already up: whatever was on its way in is no longer wanted.
      if (loading) { gen++; loading = null; }
      return;
    }
    if (want === loading) return;
    var mine = ++gen, want1 = {};
    loading = want;
    slides.forEach(function (s) { if (!want1[s.url]) want1[s.url] = live[s.url] ? P.resolve(live[s.url]) : picture(s); });
    var urls = Object.keys(want1);
    // The first slide goes up as soon as it is here; the rest join it when all are.
    // retry stays set so a draw meanwhile neither restarts nor cancels this load.
    if (urls.length > 1) want1[slides[0].url].then(function (it) {
      if (!it || mine !== gen || loading !== want) return;
      if (slideTimer) clearTimeout(slideTimer);
      slideTimer = null;
      var was = live;
      live = {}; live[it.url] = it; set = [slides[0]]; sig = want; retry = true; index = 0;
      bring(it);
      only(null);
      // What this load reuses stays: the full set below takes it over.
      setTimeout(function () { Object.keys(was).forEach(function (u) { if (!want1[u] && live[u] !== was[u]) drop(was[u]); }); }, FADE + 100);
    });
    P.all(urls.map(function (u) { return want1[u]; })).then(function (items) {
      var got = {};
      items.forEach(function (it) { if (it) got[it.url] = it; });
      if (mine !== gen) { Object.keys(got).forEach(function (u) { if (live[u] !== got[u]) drop(got[u]); }); return; }
      loading = null;
      retry = Object.keys(got).length < urls.length;
      var good = slides.filter(function (s) { return got[s.url]; });
      // Nothing new could be loaded: leave what is up, and try again on a later draw.
      if (!good.length) { if (!set.length) say(now.screen.name, "Waiting for the pictures to load."); sig = set.length ? sig : null; return; }
      if (want === sig && good.length === set.length) return;
      if (slideTimer) clearTimeout(slideTimer);
      slideTimer = null;
      var was = live, at = top;
      set = good; live = got; sig = want; index = 0;
      // Already showing one of these: carry on from it rather than jump to the first.
      set.forEach(function (s, i) { if (live[s.url].img === at) index = i; });
      if (set.length < 2 || live[set[index].url].img !== at) index = 0;
      bring(live[set[index].url]);
      only(null);
      setTimeout(function () { Object.keys(was).forEach(function (u) { if (live[u] !== was[u]) drop(was[u]); }); }, FADE + 100);
      if (set.length > 1) step();
    });
  }

  // BEGIN pickTime
  function pickTime(times, utcMs, offsetMinutes) {
    var local = Math.floor(utcMs / 60000) + offsetMinutes;
    var minute = ((local % 1440) + 1440) % 1440;
    var day = ((Math.floor(local / 1440) + 4) % 7 + 7) % 7;
    function on(t, d) { return (t.days & (1 << ((d + 7) % 7))) !== 0; }
    for (var i = times.length - 1; i >= 0; i--) {
      var t = times[i];
      if (t.end > t.start) { if (on(t, day) && minute >= t.start && minute < t.end) return t; }
      else if ((on(t, day) && minute >= t.start) || (on(t, day - 1) && minute < t.end)) return t;
    }
    return null;
  }
  // END pickTime

  // Nothing thrown in here may stop the timers that call it.
  function draw() { try { drawNow(); } catch (e) {} }
  function drawNow() {
    if (!now || !now.paired) return;
    var wait = holdUntil - Date.now();
    if (wait > 0) { if (holdTimer) clearTimeout(holdTimer); holdTimer = setTimeout(draw, wait + 20); return; }
    var utc = Date.now() + skew;
    var said = now.clock ? new Date(now.clock.now).getTime() : 0;
    var known = now.clock && utc >= said - 60000;
    // The zone from the live clock, unless this answer was made after it.
    var offset = zone && zone.at >= said ? zone.minutes : now.clock ? now.clock.offsetMinutes : 0;
    // A window with no pictures yet changes nothing. A clock earlier than the last answer is wrong: show the usual pictures.
    var t = known ? pickTime((now.times || []).filter(function (x) { return x.slides.length; }), utc, offset) : null;
    var slides = t ? t.slides : now.playlist ? now.playlist.slides : [];
    if (slides.length) show(slides);
    else { gen++; clearStage(); say("Ready for a picture", now.screen.store + ", " + now.screen.name + ". Open Screens on your phone and put one on this TV."); }

    if (identTimer) { clearTimeout(identTimer); identTimer = null; }
    // The name goes up only when the time is known and it has under two minutes to run (the dashboard asks for 90 s).
    // A wrong clock must not leave it over the menu, and a wait too long for a timer would fire at once, over and over.
    var left = known && now.identifyUntil ? new Date(now.identifyUntil).getTime() - utc : 0;
    var naming = left > 0 && left <= IDENT_MAX;
    ident.className = naming ? "screen mid on" : "screen mid";
    if (naming) {
      ident.querySelector("h1").textContent = now.screen.name;
      ident.querySelector("p").textContent = now.screen.store;
      identTimer = setTimeout(draw, left + 50);
    }
  }

  // Is this answer the shape the page draws from? One that is not is a failed call, never shown.
  function slidesOk(list) {
    return Array.isArray(list) && list.every(function (x) { return !!x && typeof x.url === "string"; });
  }
  function sound(c, needsCode) {
    if (!c || typeof c !== "object" || typeof c.paired !== "boolean") return false;
    if (!c.paired) return !needsCode || typeof c.code === "string";
    var sc = c.screen, pl = c.playlist, ti = c.times;
    if (!sc || typeof sc.name !== "string" || typeof sc.store !== "string") return false;
    if (pl !== null && pl !== undefined && (typeof pl !== "object" || !slidesOk(pl.slides))) return false;
    if (ti === null || ti === undefined) return true;
    return Array.isArray(ti) && ti.every(function (x) { return !!x && slidesOk(x.slides); });
  }

  function showPair(c) {
    gen++;
    clearStage();
    ident.className = "screen mid";
    el("code").textContent = c.code.slice(0, 3) + " " + c.code.slice(3);
    if (c.qr && c.qr.length) {
      var cv = el("qr"), n = c.qr.length, cx;
      cv.width = n; cv.height = n;
      cx = cv.getContext("2d");
      cx.fillStyle = "#fbf5e4"; cx.fillRect(0, 0, n, n);
      cx.fillStyle = "#14100d";
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (c.qr[y].charAt(x) === "1") cx.fillRect(x, y, 1, 1);
      cv.parentNode.style.display = "";
    } else el("qr").parentNode.style.display = "none";
    if (codeTimer) clearInterval(codeTimer);
    var ends = new Date(c.expiresAt).getTime();
    function tick() {
      var ms = Math.max(0, ends - (Date.now() + skew));
      el("left").textContent = ms > 0 ? "new code in " + Math.floor(ms / 60000) + ":" + pad2(Math.floor((ms % 60000) / 1000)) : "getting a new code";
    }
    tick();
    codeTimer = setInterval(tick, 1000);
    only("pair");
  }

  // fresh: from the network, not from storage. liveClock: from /api/tv/content, whose clock is the time now.
  function apply(c, fresh, liveClock) {
    var was = now;
    now = c;
    if (!c.paired) {
      if (!was || was.paired || was.code !== c.code) showPair(c);
      return;
    }
    if (codeTimer) { clearInterval(codeTimer); codeTimer = null; }
    if (fresh && liveClock && c.clock) setClock(c.clock);
    if (was && !was.paired) {
      say(c.screen.store + ", " + c.screen.name, "Connected. Pick a picture on your phone.", true);
      holdUntil = Date.now() + 3500;
    }
    // Draw first: downloads go one at a time, so the pictures for now get in line before every other window's.
    draw();
    if (fresh) store(c);
  }

  /* ---- talking to the dashboard ---- */

  function setOffline(on, paired) {
    badge.textContent = on ? (paired ? "No internet. Still showing your menu." : "No internet. Waiting to connect.") : "";
    badge.style.display = on ? "block" : "none";
  }
  /* The push line: the dashboard says "changed" down it, so the TV need not ask often. */

  var es = null, esUrl = "", esTimer = null, esWait = LINE_WAIT, nudges = [];
  function closeLine() {
    if (esTimer) { clearTimeout(esTimer); esTimer = null; }
    if (!es) return;
    var old = es;
    es = null;
    try { old.onopen = old.onmessage = old.onerror = null; old.close(); } catch (e) {}
  }
  // Only ever one line: whatever was open or waiting is closed first.
  function openLine(url) {
    closeLine();
    esUrl = url;
    if (!url || !window.EventSource) return;
    var s;
    try { s = new window.EventSource(url); } catch (e) { lineLater(); return; }
    es = s;
    s.onopen = function () { if (es === s) { esWait = LINE_WAIT; downAt = 0; } };
    // Any message means something changed; what it says is not read.
    s.onmessage = function () { if (es === s) nudge(); };
    // Closed for good is ours to open again, after a growing pause. Still trying is the browser's.
    s.onerror = function () { if (es === s && s.readyState === 2) { closeLine(); lineLater(); } };
  }
  function lineLater() {
    if (esTimer) clearTimeout(esTimer);
    var wait = esWait;
    esWait = Math.min(esWait * 2, LINE_WAIT_MAX);
    esTimer = setTimeout(function () { esTimer = null; if (cached && esUrl) openLine(esUrl); }, wait);
  }
  // After each answer from the CDN: the line it names, opened only if new or closed.
  function pushTo(c) {
    var url = c.push && c.push.url && window.EventSource ? String(c.push.url) : "";
    if (!url) { closeLine(); esUrl = ""; return; }
    if (url === esUrl && (esTimer || (es && es.readyState !== 2))) return;
    esWait = LINE_WAIT;
    openLine(url);
  }
  function clearNudges() { nudges.forEach(function (t) { clearTimeout(t); }); nudges = []; }
  // Ask now, and twice more in case the CDN was still clearing. A burst starts the two over; it adds none.
  function nudge() {
    clearNudges();
    NUDGE.forEach(function (ms) { nudges.push(setTimeout(poll, ms)); });
    poll();
  }

  /* The beat: tells the dashboard this TV is on, and brings back the time now. */

  var beatTimer = null, beating = false;
  function beat() {
    if (beating || !cached || !now || !now.paired || !now.beat) return;
    beating = true;
    if (beatTimer) { clearTimeout(beatTimer); beatTimer = null; }
    ask(BASE + "/api/tv/beat/" + token + "?k=" + encodeURIComponent(now.beat) + "&d=" + encodeURIComponent(device), "json", {}, TIMEOUT).then(function (b) {
      if (!cached) return;
      if (!APP && b.player && b.player !== PLAYER && reloadOnce(b.player)) return;
      if (setClock(b.clock)) draw();
    }).then(null, nothing).then(function () {
      beating = false;
      if (cached) beatTimer = setTimeout(function () { beatTimer = null; beat(); }, BEAT);
    });
  }
  function startBeat() { if (!beatTimer && !beating) beat(); }
  // Not paired: no line, no beat, nothing left waiting to ask.
  function hush() {
    cached = false;
    downAt = 0;
    misses = 0;
    newest = 0;
    closeLine();
    esUrl = "";
    clearNudges();
    if (beatTimer) { clearTimeout(beatTimer); beatTimer = null; }
  }

  var pollTimer = null, polling = false, again = false, askedAt = 0;
  // Wrong answers running from the CDN's address, and when the other address was last asked because of them.
  var misses = 0, rescuedAt = 0;
  // When the short wait after pairing was last used, and the server time of the newest answer shown.
  var hurriedAt = 0, newest = 0;
  // When this TV was first seen paired with no open line. 0 while the line is open, and before that is known.
  var downAt = 0;
  // With the line open the dashboard says when to ask, so every two minutes is enough. With none (not yet
  // open, down, or a set with no EventSource) the TV asks every 15 s for the first ten minutes, then every
  // 60 s. Only a line that opens starts the ten minutes over: opening one that then fails does not, so
  // coming back on screen or online again and again through a long outage cannot keep the TV asking fast.
  function pairedPoll() {
    var ms = SLOW_POLL, t = Date.now();
    if (es && es.readyState === 1) downAt = 0;
    else {
      // A clock set back must not read as a wait below zero: the ten minutes start from now.
      if (!downAt || t < downAt) downAt = t;
      ms = t - downAt < FAST_FOR ? FAST_POLL : DOWN_POLL;
    }
    return ms + Math.floor(Math.random() * ms / 10);
  }
  function poll() {
    // One at a time. Asked for while one that is not just gone out is still out (a push, the remote): one more when it ends.
    if (polling) { if (Math.abs(Date.now() - askedAt) > 1000) again = true; return; }
    polling = true;
    askedAt = Date.now();
    if (pollTimer) clearTimeout(pollTimer);
    var paired = now ? now.paired : true, quiet = cached, soon = false, hurry = false;
    // The CDN's address keeps answering wrongly: ask the other one, once, and not again for five minutes. It costs the server.
    if (quiet && misses >= MISSES && Math.abs(Date.now() - rescuedAt) >= RESCUE_EVERY) { quiet = false; rescuedAt = Date.now(); }
    // The quiet address takes no headers: one would force a second call first, and stop the CDN keeping the answer.
    (quiet ? ask(BASE + "/api/tv/c/" + token, "json", {}, TIMEOUT)
      : ask(BASE + "/api/tv/content", "json", { authorization: "Bearer " + token, "x-screen-device": device }, TIMEOUT)).then(function (c) {
      if (!sound(c, !quiet)) throw new Error("answer");
      seenAt = Date.now();
      setOffline(false, c.paired);
      if (quiet) misses = 0;
      if (!c.paired) { keepAnswer(c); storing = stored = null; hush(); }
      // No screen for this TV any more, and no code in this answer: the other address makes one, so ask it now.
      if (quiet && !c.paired) { soon = true; return; }
      paired = c.paired;
      var at = c.paired && c.clock ? new Date(c.clock.now).getTime() : 0, mine = now && now.paired ? now : null;
      if (at !== at) at = 0;
      // A copy made before the answer already showing (the CDN can hand out an old one after a new one) is not put back.
      // Unless it is hours behind: then what is showing has a wrong time on it, and must not shut out every answer.
      if (quiet && mine && at < newest && newest - at <= OLDER_MAX) {
        if (!mine.beat) mine.beat = c.beat;
        if (!mine.push) mine.push = c.push;
        pushTo(mine);
        startBeat();
        return;
      }
      // Only a live answer says which player is current: the CDN's copy can be up to an hour old. The beat checks it too.
      if (!quiet && !APP && c.player && c.player !== PLAYER && reloadOnce(c.player)) return;
      // The other address knows nothing of the line or the beat: keep the ones this TV has.
      if (!quiet && c.paired && mine) {
        if (!c.beat) c.beat = mine.beat;
        if (!c.push) c.push = mine.push;
      }
      apply(c, true, !quiet);
      if (!c.paired) return;
      newest = at;
      // Just paired: the line, the beat and the first picture should not wait a whole turn.
      // Only once a minute, so two addresses that disagree cannot make the TV ask in a tight circle.
      if (!cached && Math.abs(Date.now() - hurriedAt) > HURRY_EVERY) { hurriedAt = Date.now(); hurry = true; }
      cached = true;
      if (quiet) pushTo(c);
      startBeat();
    }).then(null, function (e) {
      // Only a call that got no answer means no internet. A wrong answer leaves the menu up and says nothing.
      if (e && e.net) setOffline(true, paired && !!now);
      else { setOffline(false, paired); if (quiet) misses += 1; }
    }).then(function () {
      polling = false;
      var next = again || soon ? 0 : hurry ? HURRY : paired ? pairedPoll() : UNPAIRED_POLL;
      again = false;
      // The next one is set before anything else here can go wrong.
      pollTimer = setTimeout(poll, next);
      if (menu.className === "on") try { drawMenu(); } catch (e) {}
    });
  }
  // Once per version and never twice in ten minutes, so a page that can't be replaced, or answers that
  // disagree about the version, never reload in a circle. Read back from the TV's own storage, not from
  // memory: if it cannot be written down, the next page would not know, so there is no reload at all.
  function reloadOnce(version) {
    try {
      var ls = window.localStorage, t = String(Date.now());
      if (ls.getItem("screens.reloaded") === version) return false;
      if (Math.abs(Number(t) - (Number(ls.getItem("screens.reloadedAt")) || 0)) < RELOAD_EVERY) return false;
      ls.setItem("screens.reloadedAt", t);
      ls.setItem("screens.reloaded", version);
      if (ls.getItem("screens.reloaded") !== version || ls.getItem("screens.reloadedAt") !== t) return false;
    } catch (e) { return false; }
    window.location.reload();
    return true;
  }

  /* ---- the remote ---- */

  var focus = 0, menuTimer = null;
  function options() {
    var o = [["Keep playing", closeMenu], ["Check for changes now", function () { poll(); }]];
    if (APP) o.push(["Close the app", function () { try { window.tizen.application.getCurrentApplication().exit(); } catch (e) { closeMenu(); } }]);
    return o;
  }
  function drawMenu() {
    var mins = seenAt ? Math.floor((Date.now() - seenAt) / 60000) : -1;
    var when = mins < 0 ? "Not connected yet." : mins < 1 ? "Connected. Checked just now." : "Last checked " + mins + " min ago.";
    menu.innerHTML = "<h2>" + esc(now && now.paired ? now.screen.name : "This TV") + "</h2><p>" + esc(now && now.paired ? now.screen.store + ". " : "") + when + "</p>" +
      options().map(function (o, i) { return '<div class="opt' + (i === focus ? " f" : "") + '">' + o[0] + "</div>"; }).join("");
  }
  // Left alone, the panel closes itself: a stray press must not cover a menu board all day.
  function stayOpen() { if (menuTimer) clearTimeout(menuTimer); menuTimer = setTimeout(closeMenu, 30000); }
  function openMenu() { focus = 0; menu.className = "on"; drawMenu(); stayOpen(); }
  function closeMenu() { menu.className = ""; if (menuTimer) clearTimeout(menuTimer); }
  document.addEventListener("keydown", function (e) {
    var k = e.keyCode, open = menu.className === "on";
    // 10009 is Back on a Samsung remote; Escape does the same in a browser.
    if (k === 10009 || k === 27) { e.preventDefault(); if (open) closeMenu(); else openMenu(); return; }
    if (!open) return;
    stayOpen();
    var o = options();
    if (k === 38) focus = (focus + o.length - 1) % o.length;
    else if (k === 40) focus = (focus + 1) % o.length;
    else if (k === 13) { o[focus][1](); return; }
    else return;
    e.preventDefault();
    drawMenu();
  });

  // Keep the screen awake: the Samsung app turns the TV's screen saver off;
  // a browser asks for a wake lock where it offers one.
  function wake() {
    try {
      var ac = window.webapis && window.webapis.appcommon;
      if (ac) ac.setScreenSaver(ac.AppCommonScreenSaverState.SCREEN_SAVER_OFF);
    } catch (e) {}
    try { if (navigator.wakeLock) navigator.wakeLock.request("screen").then(null, nothing); } catch (e) {}
  }
  wake();
  // Back from standby or from no internet: a line that slept through it can be dead and not say so. Open a new one.
  function back() {
    wake();
    if (cached && esUrl) { esWait = LINE_WAIT; openLine(esUrl); }
    poll();
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") { back(); beat(); } });
  window.addEventListener("online", function () { back(); });

  var last = readLast();
  // What was showing before the restart, and the beat with it: the TV is on whether or not the CDN's address answers.
  if (last && last.paired && sound(last, false)) { apply(last, false, false); cached = true; startBeat(); }
  var tickAt = Date.now();
  setInterval(function () {
    var t = Date.now(), gap = t - tickAt;
    tickAt = t;
    draw();
    // Ten seconds were due. Over a minute more: the TV slept, and the line can be dead and not say so.
    // A minute less: its clock was set back. Either way open a new line, check in, and get the time again.
    if (gap > 70000 || gap < -50000) { back(); beat(); }
  }, 10000);
  poll();
})();
</script>
</body>
</html>
`
}

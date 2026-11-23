import { PLAYER_VERSION, TV_POLL_MS } from "./limits"
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
 * - Asks /api/tv/content every 5 s while it shows a code (so pairing feels
 *   instant), every 30 s once paired. A call that hangs is given up on.
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
 * - The hosted page (not the app) reloads itself once when PLAYER_VERSION moves.
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
  var PAIRED_POLL = ${TV_POLL_MS}, UNPAIRED_POLL = 5000, TIMEOUT = 20000, FADE = 900;
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
  function ask(url, as, headers, ms) {
    return new P(function (ok, no) {
      var x = new XMLHttpRequest(), k;
      x.open("GET", url, true);
      if (as === "blob") x.responseType = "blob";
      x.timeout = ms;
      for (k in headers) x.setRequestHeader(k, headers[k]);
      var guard = setTimeout(function () { try { x.abort(); } catch (e) {} no(new Error("timeout")); }, ms + 1000);
      x.onload = function () {
        clearTimeout(guard);
        if (x.status < 200 || x.status > 299) { no(new Error(String(x.status))); return; }
        if (as === "blob") { if (x.response && x.response.size) ok(x.response); else no(new Error("empty")); return; }
        try { ok(JSON.parse(x.responseText)); } catch (e) { no(e); }
      };
      x.onerror = x.ontimeout = x.onabort = function () { clearTimeout(guard); no(new Error("network")); };
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
    }, Math.max(3, set[index].seconds) * 1000);
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

  function draw() {
    if (!now || !now.paired) return;
    var wait = holdUntil - Date.now();
    if (wait > 0) { if (holdTimer) clearTimeout(holdTimer); holdTimer = setTimeout(draw, wait + 20); return; }
    var utc = Date.now() + skew;
    var known = now.clock && utc >= new Date(now.clock.now).getTime() - 60000;
    // A window with no pictures yet changes nothing. A clock earlier than the last answer is wrong: show the usual pictures.
    var t = known ? pickTime((now.times || []).filter(function (x) { return x.slides.length; }), utc, now.clock.offsetMinutes) : null;
    var slides = t ? t.slides : now.playlist ? now.playlist.slides : [];
    if (slides.length) show(slides);
    else { gen++; clearStage(); say("Ready for a picture", now.screen.store + ", " + now.screen.name + ". Open Screens on your phone and put one on this TV."); }

    if (identTimer) clearTimeout(identTimer);
    var left = now.identifyUntil ? new Date(now.identifyUntil).getTime() - utc : 0;
    ident.className = left > 0 ? "screen mid on" : "screen mid";
    if (left > 0) {
      ident.querySelector("h1").textContent = now.screen.name;
      ident.querySelector("p").textContent = now.screen.store;
      identTimer = setTimeout(draw, left + 50);
    }
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

  function apply(c, fresh) {
    var was = now;
    now = c;
    if (!c.paired) {
      if (!was || was.paired || was.code !== c.code) showPair(c);
      return;
    }
    if (codeTimer) { clearInterval(codeTimer); codeTimer = null; }
    if (fresh && c.clock) {
      var off = new Date(c.clock.now).getTime() - Date.now();
      if (Math.abs(off - skew) > 5000 || get("screens.skew") === null) put("screens.skew", String(Math.round(off)));
      skew = off;
    }
    if (was && !was.paired) {
      say(c.screen.store + ", " + c.screen.name, "Connected. Pick a picture on your phone.", true);
      holdUntil = Date.now() + 3500;
    }
    if (fresh) store(c);
    draw();
  }

  /* ---- talking to the dashboard ---- */

  function setOffline(on, paired) {
    badge.textContent = on ? (paired ? "No internet. Still showing your menu." : "No internet. Waiting to connect.") : "";
    badge.style.display = on ? "block" : "none";
  }
  var pollTimer = null, polling = false;
  function poll() {
    if (polling) return;
    polling = true;
    if (pollTimer) clearTimeout(pollTimer);
    var paired = now ? now.paired : true;
    ask(BASE + "/api/tv/content", "json", { authorization: "Bearer " + token, "x-screen-device": device }, TIMEOUT).then(function (c) {
      paired = c.paired;
      seenAt = Date.now();
      if (!c.paired) { keepAnswer(c); storing = stored = null; }
      setOffline(false, paired);
      if (!APP && c.player && c.player !== PLAYER && reloadOnce(c.player)) return;
      apply(c, true);
    }).then(null, function () {
      setOffline(true, paired && !!now);
    }).then(function () {
      polling = false;
      if (menu.className === "on") drawMenu();
      pollTimer = setTimeout(poll, paired ? PAIRED_POLL : UNPAIRED_POLL);
    });
  }
  // Once per version, so a page that can't be replaced never reloads in a circle.
  function reloadOnce(version) {
    if (get("screens.reloaded") === version) return false;
    put("screens.reloaded", version);
    if (get("screens.reloaded") !== version) return false;
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
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") { wake(); poll(); } });
  window.addEventListener("online", function () { poll(); });

  var last = readLast();
  if (last && last.paired) apply(last, false);
  setInterval(draw, 10000);
  poll();
})();
</script>
</body>
</html>
`
}

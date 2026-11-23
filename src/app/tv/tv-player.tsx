"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { TV_POLL_MS } from "@/lib/screens/limits"

/**
 * The TV side of Screens.
 *
 * - First run: makes a random token and keeps it in localStorage. That token
 *   is the TV's only identity; the server stores its hash.
 * - Asks /api/tv/content: every 5 s while it shows a code (so pairing feels
 *   instant), every 30 s once paired.
 * - Saves every image of the playlist in the browser's Cache Storage and the
 *   last answer in localStorage, so with no internet it keeps playing what it
 *   had and shows a small corner note.
 * - Reloads itself once a day, when online, to pick up a new version of
 *   this page.
 */

type Slide = { id: string; url: string; seconds: number; name: string }
type Content =
  | { paired: false; code: string; expiresAt: string }
  | { paired: true; screen: { name: string; store: string }; playlist: { name: string; version: string; slides: Slide[] } | null }

const TOKEN_KEY = "screens.token"
const LAST_KEY = "screens.last"
const CACHE = "screens-media-v1"
const UNPAIRED_POLL_MS = 5_000
const RELOAD_AFTER_MS = 24 * 60 * 60_000

function store(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function deviceToken(): string {
  const s = store()
  const have = s?.getItem(TOKEN_KEY)
  if (have && /^[A-Za-z0-9_-]{32,128}$/.test(have)) return have
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  s?.setItem(TOKEN_KEY, token)
  return token
}

function deviceLabel(): string {
  const ua = navigator.userAgent
  const tizen = /Tizen\s?([\d.]+)/i.exec(ua)
  const kind = tizen ? `Tizen ${tizen[1]}` : /Web0S|webOS/i.test(ua) ? "webOS" : /Android/i.test(ua) ? "Android" : "Browser"
  const w = Math.round(window.screen.width * (window.devicePixelRatio || 1))
  const h = Math.round(window.screen.height * (window.devicePixelRatio || 1))
  return `${kind} · ${w}x${h}`
}

function readLast(): Content | null {
  try {
    const raw = store()?.getItem(LAST_KEY)
    return raw ? (JSON.parse(raw) as Content) : null
  } catch {
    return null
  }
}

/** A blob URL for a slide, from the cache, fetching and saving it first if needed. */
async function cachedUrl(url: string): Promise<string> {
  if (!("caches" in window)) return url
  try {
    const cache = await caches.open(CACHE)
    let res = await cache.match(url)
    if (!res) {
      const fresh = await fetch(url)
      if (!fresh.ok) throw new Error(String(fresh.status))
      await cache.put(url, fresh.clone())
      res = fresh
    }
    return URL.createObjectURL(await res.blob())
  } catch {
    return url
  }
}

/** Drop cached images no current slide uses, so the TV's storage doesn't fill. */
async function pruneCache(keep: Set<string>) {
  if (!("caches" in window)) return
  try {
    const cache = await caches.open(CACHE)
    for (const req of await cache.keys()) {
      if (!keep.has(new URL(req.url).pathname)) await cache.delete(req)
    }
  } catch {
    // Best effort.
  }
}

export function TvPlayer() {
  const [content, setContent] = useState<Content | null>(null)
  const [offline, setOffline] = useState(false)
  const [srcs, setSrcs] = useState<Record<string, string>>({})
  const [index, setIndex] = useState(0)
  const version = useRef<string | null>(null)
  const shown = useRef<string | null>(null)

  // Ask the server; fall back to what we had.
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const started = Date.now()
    const token = deviceToken()
    const device = deviceLabel()

    const last = readLast()

    const apply = async (c: Content) => {
      if (c.paired && c.playlist) {
        if (c.playlist.version !== version.current) {
          const entries = await Promise.all(c.playlist.slides.map(async (s) => [s.url, await cachedUrl(s.url)] as const))
          if (stopped) return
          setSrcs((old) => {
            for (const u of Object.values(old)) if (u.startsWith("blob:")) URL.revokeObjectURL(u)
            return Object.fromEntries(entries)
          })
          setIndex(0)
          version.current = c.playlist.version
          void pruneCache(new Set(c.playlist.slides.map((s) => s.url)))
        }
      } else {
        version.current = null
      }
      // Same answer as last time: keep the same object, so the slideshow's timer isn't reset.
      const json = JSON.stringify(c)
      if (json === shown.current) return
      shown.current = json
      setContent(c)
    }

    if (last) void apply(last)

    const tick = async () => {
      let paired = true
      try {
        const res = await fetch("/api/tv/content", {
          headers: { authorization: `Bearer ${token}`, "x-screen-device": device },
          cache: "no-store",
        })
        if (!res.ok) throw new Error(String(res.status))
        const c = (await res.json()) as Content
        paired = c.paired
        try {
          store()?.setItem(LAST_KEY, JSON.stringify(c))
        } catch {
          // Storage full or blocked: playing still works, offline won't.
        }
        await apply(c)
        setOffline(false)
        if (Date.now() - started > RELOAD_AFTER_MS) {
          window.location.reload()
          return
        }
      } catch {
        setOffline(true)
        paired = readLast()?.paired ?? false
      }
      if (!stopped) timer = setTimeout(tick, paired ? TV_POLL_MS : UNPAIRED_POLL_MS)
    }
    void tick()

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  // Keep the screen awake where the browser allows it.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    const ask = async () => {
      try {
        const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock
        lock = (await wl?.request("screen")) ?? null
      } catch {
        // Not offered here; the TV's own settings keep it on.
      }
    }
    void ask()
    const again = () => {
      if (document.visibilityState === "visible") void ask()
    }
    document.addEventListener("visibilitychange", again)
    return () => {
      document.removeEventListener("visibilitychange", again)
      void lock?.release()
    }
  }, [])

  const slides = useMemo(() => (content?.paired && content.playlist ? content.playlist.slides : []), [content])

  // Step through the slides.
  useEffect(() => {
    if (slides.length < 2) return
    const s = slides[index % slides.length]
    const t = setTimeout(() => setIndex((i) => (i + 1) % slides.length), Math.max(3, s.seconds) * 1000)
    return () => clearTimeout(t)
  }, [slides, index])

  if (!content) {
    return (
      <div className="tv-msg">
        <h1>Starting…</h1>
      </div>
    )
  }

  if (!content.paired) {
    return (
      <>
        <PairCode code={content.code} expiresAt={content.expiresAt} />
        {offline ? <div className="tv-badge">No internet · waiting to connect</div> : null}
      </>
    )
  }

  if (slides.length === 0) {
    return (
      <div className="tv-msg">
        <h1>{content.screen.name}</h1>
        <p>{content.screen.store} · Nothing to show yet. Pick a playlist for this screen in the dashboard.</p>
      </div>
    )
  }

  return (
    <>
      {slides.map((s, i) => (
        <img key={s.id} className="tv-slide" data-on={i === index % slides.length} src={srcs[s.url] ?? s.url} alt={s.name} />
      ))}
      {offline ? <div className="tv-badge">No internet · showing saved slides</div> : null}
    </>
  )
}

function PairCode({ code, expiresAt }: { code: string; expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const left = Math.max(0, new Date(expiresAt).getTime() - now)
  const mm = Math.floor(left / 60_000)
  const ss = String(Math.floor((left % 60_000) / 1000)).padStart(2, "0")
  return (
    <div className="tv-pair">
      <div>
        <p className="tv-brand">Chris N Eddy&apos;s Screens</p>
        <h1>Pair this screen</h1>
        <p>
          On your phone or computer, open <b>Screens</b> in the dashboard, tap <b>Pair a screen</b> and type this code.
        </p>
      </div>
      <div className="tv-code">
        <div className="tv-digits" aria-label={`Code ${code.split("").join(" ")}`}>
          {code.split("").map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        <small>{left > 0 ? `new code in ${mm}:${ss}` : "getting a new code"}</small>
      </div>
    </div>
  )
}

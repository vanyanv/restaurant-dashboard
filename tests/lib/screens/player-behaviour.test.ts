// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DASHBOARD_ORIGIN, playerHtml } from "@/lib/screens/player-html"
import { PLAYER_VERSION, TV_BEAT_MS, TV_NUDGE_RETRY_MS, TV_POLL_DOWN_MS, TV_POLL_FAST_FOR_MS, TV_POLL_FAST_MS, TV_POLL_SLOW_MS } from "@/lib/screens/limits"

/**
 * These RUN the player's own script: the page's real markup in jsdom, with a
 * pretend network (XMLHttpRequest), push line (EventSource), storage and
 * clock around it. Each case runs twice: with the page's own small Promise
 * (what a 2015 set uses) and with the engine's.
 *
 * What they cannot show is a Samsung TV: its EventSource, its standby, its
 * CORS rules. See the risks in the pull request.
 */

const TOKEN = "T".repeat(40)
const PUSH = "https://realtime.ably.io/sse?v=1.2&channels=tv&accessToken=abc"
const START = new Date("2026-03-10T19:30:00.000Z").getTime() // a Tuesday, 12:30 pm in Los Angeles (UTC-7)

/** `json: null` is the body "null"; `text` is a body sent as it is (HTML, say). */
type Reply = { json?: unknown; text?: string; status?: number; blob?: boolean } | "fail" | "hang"
/** `at` is the TV's clock when the call went out; `mono` is time gone by, which setting the TV's clock does not move. */
type Call = { url: string; headers: Record<string, string>; at: number; mono: number; kind: "c" | "content" | "beat" | "media" }

class FakeLine {
  readyState = 0
  onopen: ((e: unknown) => void) | null = null
  onmessage: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  constructor(public url: string) {}
  close() {
    this.readyState = 2
  }
  /** The server accepted the line. */
  open() {
    this.readyState = 1
    this.onopen?.({})
  }
  message(data = '{"name":"changed"}') {
    this.onmessage?.({ data })
  }
  /** The line broke: for good (the browser gave up), or the browser is trying again. */
  drop(forGood: boolean) {
    this.readyState = forGood ? 2 : 0
    this.onerror?.({})
  }
}

const slide = (name: string) => ({ id: name, url: `/api/tv/media/${name}.jpg`, seconds: 10, name })

function pairedAnswer(over: Record<string, unknown> = {}) {
  return {
    paired: true,
    player: PLAYER_VERSION,
    screen: { name: "Front", store: "Main St" },
    playlist: null,
    times: [],
    clock: { now: new Date(Date.now()).toISOString(), offsetMinutes: -420 },
    identifyUntil: null,
    beat: "tick.et+/=",
    push: { url: PUSH },
    ...over,
  }
}
const codeAnswer = () => ({ paired: false, code: "482913", expiresAt: new Date(Date.now() + 600_000).toISOString(), player: PLAYER_VERSION, qr: [] })

function boot(opts: { stored?: unknown; eventSource?: boolean | "throws"; nativePromise: boolean
  app?: boolean
  /** First answers: the first check-in and beat go out as the page starts. */
  c?: () => Reply
  beat?: () => Reply
  content?: () => Reply
  /** The TV's storage, kept across page lives when the same one is passed again. */
  disk?: Map<string, string>
  /** "full": nothing can be written. "blocked": it cannot be read either. */
  storage?: "ok" | "full" | "blocked"
  /** How long an answer takes, in ms. */
  delay?: () => number
}) {
  const html = playerHtml({ base: opts.app ? DASHBOARD_ORIGIN : "", app: !!opts.app })
  const js = /<script>([\s\S]*?)<\/script>/.exec(html)![1]
  // A page of its own for each TV. A parsed page does not run its script: that is done below, with the pretend TV around it.
  const doc = new DOMParser().parseFromString(html, "text/html")
  Object.defineProperty(doc, "visibilityState", { value: "visible", configurable: true })
  // A picture "loads" a moment after it is given an address.
  const create = doc.createElement.bind(doc)
  doc.createElement = ((tag: string) => {
    const e = create(tag) as HTMLElement & { onload?: (() => void) | null }
    if (tag === "img") {
      let src = ""
      Object.defineProperty(e, "src", {
        get: () => src,
        set: (v: string) => {
          src = v
          setTimeout(() => e.onload?.(), 1)
        },
      })
    }
    return e
  }) as typeof doc.createElement

  const disk = opts.disk ?? new Map<string, string>()
  if (!disk.has("screens.token")) disk.set("screens.token", TOKEN)
  if (opts.stored) disk.set("screens.last", JSON.stringify(opts.stored))

  const calls: Call[] = []
  const lines: FakeLine[] = []
  const tv = {
    /** What each address answers. Tests swap these; the first check-in goes out as the page starts, so its answer is set in boot(). */
    c: opts.c ?? ((): Reply => ({ json: pairedAnswer() })),
    content: opts.content ?? ((): Reply => ({ json: codeAnswer() })),
    beat: opts.beat ?? ((): Reply => ({ json: { clock: { now: new Date(Date.now()).toISOString(), offsetMinutes: -420 }, player: PLAYER_VERSION } })),
    inflight: 0,
    most: 0,
  }

  class X {
    method = ""
    url = ""
    headers: Record<string, string> = {}
    responseType = ""
    timeout = 0
    status = 0
    responseText = ""
    response: unknown = null
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    ontimeout: (() => void) | null = null
    onabort: (() => void) | null = null
    private over = false
    private poll = false
    open(method: string, url: string) {
      this.method = method
      this.url = url
    }
    setRequestHeader(k: string, v: string) {
      this.headers[k] = v
    }
    private end() {
      if (this.over) return false
      this.over = true
      if (this.poll) tv.inflight--
      return true
    }
    abort() {
      this.end()
    }
    send() {
      const kind = this.url.includes("/api/tv/c/") ? "c" : this.url.includes("/api/tv/content") ? "content" : this.url.includes("/api/tv/beat/") ? "beat" : "media"
      calls.push({ url: this.url, headers: this.headers, at: Date.now(), mono: performance.now(), kind })
      this.poll = kind === "c" || kind === "content"
      if (this.poll) tv.most = Math.max(tv.most, ++tv.inflight)
      const r: Reply = kind === "media" ? { blob: true } : tv[kind]()
      if (r === "hang") return
      setTimeout(() => {
        if (!this.end()) return
        if (r === "fail") return this.onerror?.()
        this.status = r.status ?? 200
        if (r.blob) this.response = { size: 3, type: "image/jpeg" }
        else this.responseText = "text" in r ? r.text! : "json" in r ? JSON.stringify(r.json) : "{}"
        this.onload?.()
      }, opts.delay?.() ?? 5)
    }
  }

  const listeners: Record<string, (() => void)[]> = {}
  let blobs = 0
  const win: Record<string, unknown> = {
    localStorage: {
      getItem: (k: string) => {
        if (opts.storage === "blocked") throw new Error("SecurityError")
        return disk.has(k) ? disk.get(k)! : null
      },
      setItem: (k: string, v: string) => {
        if (opts.storage === "full" || opts.storage === "blocked") throw new Error("QuotaExceededError")
        disk.set(k, String(v))
      },
    },
    Promise: opts.nativePromise ? Promise : undefined,
    URL: { createObjectURL: () => `blob:${++blobs}`, revokeObjectURL: () => {} },
    crypto: globalThis.crypto,
    devicePixelRatio: 1,
    location: { reload: vi.fn() },
    addEventListener: (name: string, f: () => void) => void (listeners[name] ??= []).push(f),
  }
  let refused = 0
  if (opts.eventSource === "throws") {
    win.EventSource = function () {
      refused++
      throw new Error("SECURITY_ERR")
    }
  } else if (opts.eventSource !== false) {
    win.EventSource = function (url: string) {
      const l = new FakeLine(url)
      lines.push(l)
      return l
    }
  }
  const nav = { userAgent: "Mozilla/5.0 (SMART-TV; Linux; Tizen 6.5) AppleWebKit/537.36" }
  const scr = { width: 1920, height: 1080 }
  new Function("window", "document", "navigator", "screen", "XMLHttpRequest", js)(win, doc, nav, scr, X)

  const of = (kind: Call["kind"]) => calls.filter((c) => c.kind === kind)
  return {
    tv,
    doc,
    disk,
    calls,
    lines,
    /** How many times a set whose EventSource throws was asked for one. */
    refused: () => refused,
    of,
    /** Check-ins of either kind, in order. */
    polls: () => calls.filter((c) => c.kind === "c" || c.kind === "content"),
    /** Lines not closed. There must never be two. */
    open: () => lines.filter((l) => l.readyState !== 2),
    reload: (win.location as { reload: ReturnType<typeof vi.fn> }).reload,
    fire: (name: string) => (listeners[name] ?? []).forEach((f) => f()),
    visible: () => doc.dispatchEvent(new Event("visibilitychange")),
    ident: () => doc.getElementById("ident")!,
    badge: () => doc.getElementById("badge")!,
    stage: () => doc.querySelectorAll("#stage img").length,
    /** The picture on top (while one fades in over another, both are "on"; the later one is on top). */
    showing: () => {
      const on = doc.querySelectorAll<HTMLImageElement>("#stage img.slide.on")
      return on.length ? on[on.length - 1].alt : null
    },
    last: () => JSON.parse(disk.get("screens.last") ?? "null"),
  }
}

/**
 * Every test here shares one pretend clock, and the only thing that moves it is tick().
 * A test that ran past vitest's time limit is reported as failed but its code keeps running,
 * and its tick() calls would then move the clock under the tests after it. That happened: the
 * two-day run took over the default 5 s when the whole suite ran at once, and 26 later tests
 * failed with times that made no sense. So: a limit no test here can reach on a busy machine,
 * and a tick() that stops a test that is over at the step it was waiting on (checked by setting the
 * limit to 400 ms: only the tests that ran out of time failed).
 */
vi.setConfig({ testTimeout: 180_000 })
let running = 0
let ticking = 0
/** The three waits between check-ins, in seconds: no line (first ten minutes), no line (after), line open. */
const FAST = TV_POLL_FAST_MS / 1000
const DOWN = TV_POLL_DOWN_MS / 1000
const SLOW = TV_POLL_SLOW_MS / 1000
const HOUR = 3_600_000
/** How many check-ins an hour with no line may take from its start: ten minutes of fast ones, then slow ones. */
const FIRST_HOUR = TV_POLL_FAST_FOR_MS / TV_POLL_FAST_MS + (HOUR - TV_POLL_FAST_FOR_MS) / TV_POLL_DOWN_MS
const tick = async (ms: number) => {
  const mine = ticking
  await vi.advanceTimersByTimeAsync(ms)
  // A test that is over was waiting here (its clock was taken away under it). It goes no further.
  if (mine !== running) throw new Error("this test is over: it may not move the clock")
}

describe.each([
  ["the page's own Promise", false],
  ["the engine's Promise", true],
])("TV player, run (%s)", (_name, nativePromise) => {
  beforeEach(() => {
    // Everything the page reads for time (Date, setTimeout, setInterval and their clears) is the pretend clock's.
    vi.useFakeTimers()
    vi.setSystemTime(START)
    vi.spyOn(Math, "random").mockReturnValue(0)
    ticking = running
  })
  afterEach(() => {
    // Whatever this test still has waiting on a tick() is stopped there.
    running++
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("a TV that was paired asks the CDN's address first, with no headers", async () => {
    const p = boot({ stored: pairedAnswer(), nativePromise })
    await tick(100)
    expect(p.polls()[0].url).toBe(`/api/tv/c/${TOKEN}`)
    expect(p.polls()[0].headers).toEqual({})
    expect(p.of("content")).toHaveLength(0)
    // The app asks the live dashboard, the same way.
    const app = boot({ stored: pairedAnswer(), nativePromise, app: true })
    await tick(100)
    expect(app.polls()[0].url).toBe(`${DASHBOARD_ORIGIN}/api/tv/c/${TOKEN}`)
    expect(app.polls()[0].headers).toEqual({})
  })

  it("a TV with nothing stored asks the old address, with its token and what it is", async () => {
    const p = boot({ nativePromise })
    await tick(100)
    expect(p.polls()[0].url).toBe("/api/tv/content")
    expect(p.polls()[0].headers).toEqual({ authorization: `Bearer ${TOKEN}`, "x-screen-device": "Tizen 6.5 · 1920x1080" })
    expect(p.doc.getElementById("code")!.textContent).toBe("482 913")
    expect(p.doc.getElementById("pair")!.className).toContain(" on")
    // Every 5 s while the code is up; no line and no beat.
    await tick(10_000)
    expect(p.of("content")).toHaveLength(3)
    expect(p.of("c")).toHaveLength(0)
    expect(p.of("beat")).toHaveLength(0)
    expect(p.lines).toHaveLength(0)
  })

  it("the CDN's answer never sets the clock; the beat's does", async () => {
    // The TV's clock is two hours slow. The CDN's copy was made 50 minutes ago.
    const AHEAD = 2 * 3_600_000
    const old = () => new Date(Date.now() + AHEAD - 50 * 60_000).toISOString()
    const stored = pairedAnswer({ beat: "", clock: { now: old(), offsetMinutes: -420 } })
    const p = boot({ stored, nativePromise, c: () => ({ json: pairedAnswer({ beat: "", clock: { now: old(), offsetMinutes: -420 } }) }) })
    p.tv.beat = () => ({ json: { clock: { now: new Date(Date.now() + AHEAD).toISOString(), offsetMinutes: -420 }, player: PLAYER_VERSION } })
    await tick(5 * 60_000)
    expect(p.of("c").length).toBeGreaterThan(10)
    expect(p.disk.has("screens.skew")).toBe(false)
    // Now the answer carries a ticket: the beat goes out, and its clock is taken.
    p.tv.c = () => ({ json: pairedAnswer({ clock: { now: old(), offsetMinutes: -420 } }) })
    await tick(TV_POLL_FAST_MS + 2_000)
    expect(p.of("beat")).toHaveLength(1)
    expect(Math.abs(Number(p.disk.get("screens.skew")) - AHEAD)).toBeLessThan(100)
    // More stale answers do not move it back.
    await tick(60_000)
    expect(Math.abs(Number(p.disk.get("screens.skew")) - AHEAD)).toBeLessThan(100)
  })

  it("store time comes from the beat: a slow TV clock is put right and lunch goes up", async () => {
    // The TV thinks it is 6:30 am; it is 12:30 pm. Lunch is 11 to 3.
    const AHEAD = 6 * 3_600_000
    vi.setSystemTime(START - AHEAD)
    const answer = (beat: string) =>
      pairedAnswer({
        beat,
        clock: { now: new Date(Date.now() + AHEAD - 30 * 60_000).toISOString(), offsetMinutes: -420 },
        playlist: { name: "Usual", version: "1", slides: [slide("Usual")] },
        times: [{ id: "t", days: 127, start: 11 * 60, end: 15 * 60, slides: [slide("Lunch")] }],
      })
    const p = boot({ stored: answer(""), nativePromise, c: () => ({ json: answer("") }) })
    p.tv.beat = () => ({ json: { clock: { now: new Date(Date.now() + AHEAD).toISOString(), offsetMinutes: -420 }, player: PLAYER_VERSION } })
    await tick(60_000)
    // A clock earlier than the answer cannot be trusted: the usual pictures.
    expect(p.showing()).toBe("Usual")
    p.tv.c = () => ({ json: answer("k") })
    await tick(TV_POLL_FAST_MS + 3_000)
    expect(p.showing()).toBe("Lunch")
  })

  it("the zone comes from the beat when the CDN's copy is from before the clocks changed", async () => {
    // The copy says UTC-8 (11:30 am, before lunch at 12). The beat says UTC-7 (12:30 pm).
    const answer = (beat: string) =>
      pairedAnswer({
        beat,
        clock: { now: new Date(Date.now() - 40 * 60_000).toISOString(), offsetMinutes: -480 },
        playlist: { name: "Usual", version: "1", slides: [slide("Usual")] },
        times: [{ id: "t", days: 127, start: 12 * 60, end: 15 * 60, slides: [slide("Lunch")] }],
      })
    const p = boot({ stored: answer(""), nativePromise, c: () => ({ json: answer("") }) })
    await tick(60_000)
    expect(p.showing()).toBe("Usual")
    p.tv.c = () => ({ json: answer("k") })
    await tick(TV_POLL_FAST_MS + 3_000)
    expect(p.showing()).toBe("Lunch")
    // An answer made after that beat is newer than it: its zone wins again.
    p.tv.c = () => ({ json: { ...answer(""), clock: { now: new Date(Date.now() + 1_000).toISOString(), offsetMinutes: -480 } } })
    p.tv.beat = () => "fail"
    await tick(TV_POLL_FAST_MS + 12_000)
    expect(p.showing()).toBe("Usual")
  })

  it("told it is not paired by the CDN's address, it asks the old one at once and drops the line and the beat", async () => {
    const p = boot({ stored: pairedAnswer(), nativePromise })
    await tick(100)
    p.lines[0].open()
    expect(p.of("beat")).toHaveLength(1)
    p.tv.c = () => ({ json: { paired: false } })
    await tick(TV_POLL_FAST_MS)
    const polls = p.polls()
    const told = polls.findIndex((c, i) => i > 0 && c.kind === "c")
    const next = polls[told + 1]
    expect(next.url).toBe("/api/tv/content")
    expect(next.headers).toEqual({ authorization: `Bearer ${TOKEN}`, "x-screen-device": "Tizen 6.5 · 1920x1080" })
    expect(next.at - polls[told].at).toBeLessThan(100)
    expect(p.open()).toHaveLength(0)
    expect(p.last().paired).toBe(false)
    expect(p.doc.getElementById("code")!.textContent).toBe("482 913")
    // From here on: the old address every 5 s, and nothing else.
    const before = p.calls.length
    await tick(10 * 60_000)
    const after = p.calls.slice(before)
    expect(after.every((c) => c.kind === "content")).toBe(true)
    expect(after.length).toBeGreaterThan(100)
    expect(p.of("beat")).toHaveLength(1)
    expect(p.lines).toHaveLength(1)
  })

  it("paired through the old address, it takes that live clock and asks the CDN's address next", async () => {
    const AHEAD = 2 * 3_600_000
    const p = boot({ nativePromise })
    await tick(100)
    expect(p.polls().map((c) => c.kind)).toEqual(["content"])
    p.tv.content = () => ({ json: pairedAnswer({ beat: undefined, push: undefined, clock: { now: new Date(Date.now() + AHEAD).toISOString(), offsetMinutes: -420 } }) })
    await tick(5_000)
    expect(p.doc.getElementById("msg")!.textContent).toContain("Connected")
    expect(Math.abs(Number(p.disk.get("screens.skew")) - AHEAD)).toBeLessThan(100)
    const n = p.polls().length
    await tick(TV_POLL_FAST_MS + 100)
    const next = p.polls()[n]
    expect(next.url).toBe(`/api/tv/c/${TOKEN}`)
    expect(next.headers).toEqual({})
    await tick(5 * 60_000)
    expect(p.polls().slice(n).every((c) => c.kind === "c")).toBe(true)
    expect(p.last().paired).toBe(true)
  })

  it("a push asks at once and twice more; a burst of five asks no more than that", async () => {
    const p = boot({ stored: pairedAnswer(), nativePromise })
    await tick(100)
    p.lines[0].open()
    await tick(TV_POLL_FAST_MS) // the second check-in; the next is two minutes away
    const n = p.of("c").length
    const t0 = Date.now()
    for (let i = 0; i < 5; i++) p.lines[0].message()
    await tick(50)
    expect(p.of("c")).toHaveLength(n + 1)
    await tick(1_000)
    p.lines[0].message("not json at all") // what it says is not read; the two start over
    const t1 = Date.now()
    await tick(50)
    expect(p.of("c")).toHaveLength(n + 2)
    await tick(40_000)
    const got = p.of("c").slice(n).map((c) => c.at)
    expect(got).toEqual([t0, t1, t1 + TV_NUDGE_RETRY_MS[0], t1 + TV_NUDGE_RETRY_MS[1]])
    // Then back to the slow turn, counted from the last one.
    await tick(TV_POLL_SLOW_MS)
    expect(p.of("c")).toHaveLength(n + 5)
    expect(p.tv.most).toBe(1)
  })

  it("a push while a check-in is still out does not start a second one", async () => {
    const p = boot({ stored: pairedAnswer(), nativePromise })
    await tick(100)
    p.lines[0].open()
    p.tv.c = () => "hang"
    await tick(TV_POLL_FAST_MS)
    const n = p.of("c").length
    for (let i = 0; i < 5; i++) p.lines[0].message()
    p.visible()
    p.fire("online")
    await tick(2_000)
    expect(p.of("c")).toHaveLength(n)
    await tick(10 * 60_000)
    expect(p.tv.most).toBe(1)
    // The hung call was given up on: the badge says so, and it kept trying. Never the old address: the network is what failed.
    expect(p.doc.getElementById("badge")!.textContent).toBe("No internet. Still showing your menu.")
    expect(p.of("c").length).toBeGreaterThan(n + 5)
    expect(p.of("content")).toHaveLength(0)
    // The line was opened again twice (back on screen, back online): the last is the one open.
    expect(p.lines).toHaveLength(3)
    expect(p.open()).toEqual([p.lines[2]])
  })

  it("asks every two minutes while the line is open, every 15 s while it is connecting or has just dropped", async () => {
    const p = boot({ stored: pairedAnswer(), nativePromise })
    const gaps = () => {
      const at = p.of("c").map((c) => c.at)
      return at.slice(1).map((t, i) => Math.round((t - at[i]) / 1000))
    }
    await tick(100)
    // Still connecting: fast.
    await tick(2 * TV_POLL_FAST_MS)
    expect(gaps()).toEqual([FAST, FAST])
    p.lines[0].open()
    await tick(TV_POLL_FAST_MS + 3 * TV_POLL_SLOW_MS)
    expect(gaps()).toEqual([FAST, FAST, FAST, SLOW, SLOW, SLOW])
    // The browser lost it and is trying again: fast until it is back.
    p.lines[0].drop(false)
    await tick(TV_POLL_SLOW_MS + 2 * TV_POLL_FAST_MS)
    expect(gaps().slice(6)).toEqual([SLOW, FAST, FAST])
    expect(p.lines).toHaveLength(1)
  })

  it("spreads check-ins by up to a tenth so TVs do not ask in step", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999)
    const p = boot({ stored: pairedAnswer(), nativePromise })
    await tick(100)
    await tick(TV_POLL_FAST_MS * 1.1 + 100)
    const at = p.of("c").map((c) => c.at)
    expect(at).toHaveLength(2)
    expect(at[1] - at[0]).toBeGreaterThan(TV_POLL_FAST_MS * 1.09)
    expect(at[1] - at[0]).toBeLessThanOrEqual(TV_POLL_FAST_MS * 1.1 + 50)
  })

  it("with no EventSource on the set it still works, by asking every 15 s at first", async () => {
    const p = boot({ stored: pairedAnswer(), nativePromise, eventSource: false })
    await tick(100)
    p.visible()
    p.fire("online")
    await tick(4 * TV_POLL_FAST_MS)
    const at = p.of("c").map((c) => c.at)
    expect(at).toHaveLength(5)
    expect(at[4] - at[3]).toBeGreaterThanOrEqual(TV_POLL_FAST_MS)
    expect(at[4] - at[3]).toBeLessThan(TV_POLL_FAST_MS + 100)
    expect(p.of("beat").length).toBeGreaterThan(0)
    expect(p.doc.getElementById("badge")!.style.display).toBe("none")
  })

  it("an EventSource that throws when made is tried again with the same growing wait, and the TV keeps asking", async () => {
    const p = boot({ stored: pairedAnswer(), nativePromise, eventSource: "throws" })
    await tick(100)
    expect(p.refused()).toBe(1)
    await tick(15_000 + 30_000 + 60_000 + 500)
    expect(p.refused()).toBe(4)
    await tick(60 * 60_000)
    // 120 s, 240 s, then every 5 minutes: not once per check-in.
    expect(p.refused()).toBeLessThan(4 + 2 + 12)
    // An hour and two minutes of check-ins with no line: ten minutes of fast ones, then one a minute.
    const most = FIRST_HOUR + 105_500 / TV_POLL_DOWN_MS
    expect(p.of("c").length).toBeGreaterThan(most - 4)
    expect(p.of("c").length).toBeLessThanOrEqual(most + 1)
    expect(p.doc.getElementById("badge")!.style.display).toBe("none")
  })

  it("beats as it starts from the stored ticket, then every three minutes, with no headers", async () => {
    const p = boot({ stored: pairedAnswer(), nativePromise })
    expect(p.of("beat")).toHaveLength(1)
    await tick(100)
    expect(p.of("beat")).toHaveLength(1)
    const b = p.of("beat")[0]
    expect(b.url).toBe(`/api/tv/beat/${TOKEN}?k=${encodeURIComponent("tick.et+/=")}&d=${encodeURIComponent("Tizen 6.5 · 1920x1080")}`)
    expect(b.headers).toEqual({})
    await tick(TV_BEAT_MS - 200)
    expect(p.of("beat")).toHaveLength(1)
    await tick(300)
    expect(p.of("beat")).toHaveLength(2)
    // One that fails is not chased: the next is three minutes on.
    p.tv.beat = () => "fail"
    await tick(TV_BEAT_MS)
    expect(p.of("beat")).toHaveLength(3)
    await tick(TV_BEAT_MS - 1_000)
    expect(p.of("beat")).toHaveLength(3)
    await tick(1_100)
    expect(p.of("beat")).toHaveLength(4)
    // Coming back from standby beats at once, and the count starts from there.
    await tick(60_000)
    p.visible()
    await tick(50)
    expect(p.of("beat")).toHaveLength(5)
    await tick(TV_BEAT_MS - 1_000)
    expect(p.of("beat")).toHaveLength(5)
    await tick(1_100)
    expect(p.of("beat")).toHaveLength(6)
  })

  it("does not beat without a ticket, and starts when one arrives", async () => {
    const p = boot({ stored: pairedAnswer({ beat: "" }), nativePromise, c: () => ({ json: pairedAnswer({ beat: "" }) }) })
    await tick(100)
    p.visible()
    await tick(3 * TV_BEAT_MS)
    expect(p.of("beat")).toHaveLength(0)
    p.tv.c = () => ({ json: pairedAnswer({ beat: "k2" }) })
    await tick(TV_POLL_SLOW_MS)
    expect(p.of("beat")).toHaveLength(1)
    expect(p.of("beat")[0].url).toContain("?k=k2&d=")
  })

  it("a line closed for good is opened again after 15 s, then 30 s; never two at once", async () => {
    const p = boot({ stored: pairedAnswer(), nativePromise })
    await tick(100)
    expect(p.lines.map((l) => l.url)).toEqual([PUSH])
    p.lines[0].open()
    p.lines[0].drop(true)
    await tick(14_000)
    expect(p.lines).toHaveLength(1) // the check-ins in between name the same line: not a reason to hurry
    await tick(1_100)
    expect(p.lines).toHaveLength(2)
    expect(p.open()).toHaveLength(1)
    p.lines[1].drop(true)
    await tick(29_000)
    expect(p.lines).toHaveLength(2)
    await tick(1_100)
    expect(p.lines).toHaveLength(3)
    p.lines[2].drop(true)
    await tick(59_000)
    expect(p.lines).toHaveLength(3)
    await tick(1_100)
    expect(p.lines).toHaveLength(4)
    // One that opens puts the wait back to 15 s.
    p.lines[3].open()
    p.lines[3].drop(true)
    await tick(15_100)
    expect(p.lines).toHaveLength(5)
    expect(p.open()).toHaveLength(1)
    // Trying again by itself is left to the browser, however long.
    p.lines[4].drop(false)
    await tick(30 * 60_000)
    expect(p.lines).toHaveLength(5)
    // A closed line's late events are not listened to.
    p.lines[0].open()
    p.lines[0].message()
    p.lines[0].drop(true)
    await tick(10 * 60_000)
    expect(p.lines).toHaveLength(5)
    expect(p.open()).toHaveLength(1)
  })

  it("the wait for a dead line stops growing at five minutes", async () => {
    const p = boot({ stored: pairedAnswer(), nativePromise })
    await tick(100)
    const made: number[] = []
    for (let i = 0; i < 8; i++) {
      const l = p.lines[p.lines.length - 1]
      const at = Date.now()
      l.drop(true)
      while (p.lines[p.lines.length - 1] === l) await tick(1_000)
      made.push(Math.round((Date.now() - at) / 1000))
      expect(p.open()).toHaveLength(1)
    }
    expect(made).toEqual([15, 30, 60, 120, 240, 300, 300, 300])
  })

  it("back from standby or offline it opens a new line, one only, and checks in", async () => {
    const p = boot({ stored: pairedAnswer(), nativePromise })
    await tick(100)
    p.lines[0].open()
    await tick(TV_POLL_FAST_MS)
    const n = p.of("c").length
    p.visible()
    await tick(50)
    expect(p.lines).toHaveLength(2)
    expect(p.lines[0].readyState).toBe(2)
    expect(p.open()).toEqual([p.lines[1]])
    expect(p.of("c")).toHaveLength(n + 1)
    p.fire("online")
    p.fire("online")
    await tick(50)
    expect(p.lines).toHaveLength(4)
    expect(p.open()).toEqual([p.lines[3]])
    expect(p.tv.most).toBe(1)
    // While a line is waiting to be tried again, coming back tries it now and does not leave the wait running.
    p.lines[3].drop(true)
    p.visible()
    await tick(60_000)
    expect(p.lines).toHaveLength(5)
    expect(p.open()).toEqual([p.lines[4]])
  })

  it("follows the line the answer names: a new address replaces it, none closes it", async () => {
    const p = boot({ stored: pairedAnswer(), nativePromise })
    await tick(100)
    p.lines[0].open()
    p.tv.c = () => ({ json: pairedAnswer({ push: { url: PUSH + "2" } }) })
    await tick(TV_POLL_FAST_MS)
    expect(p.lines.map((l) => l.url)).toEqual([PUSH, PUSH + "2"])
    expect(p.open()).toEqual([p.lines[1]])
    p.tv.c = () => ({ json: pairedAnswer({ push: null }) })
    await tick(TV_POLL_FAST_MS)
    expect(p.open()).toHaveLength(0)
    await tick(10 * 60_000)
    expect(p.lines).toHaveLength(2)
  })

  it("a check-in the network failed shows the badge, keeps the pictures' state and keeps trying; the next good one clears it", async () => {
    const p = boot({ stored: pairedAnswer(), nativePromise })
    await tick(100)
    p.tv.c = () => "fail"
    await tick(TV_POLL_FAST_MS)
    expect(p.doc.getElementById("badge")!.style.display).toBe("block")
    expect(p.last().paired).toBe(true)
    const n = p.of("c").length
    await tick(20 * TV_POLL_FAST_MS)
    expect(p.of("c").length).toBeGreaterThanOrEqual(n + 19)
    // No internet is not a reason to try the other address.
    expect(p.of("content")).toHaveLength(0)
    p.tv.c = () => ({ json: pairedAnswer() })
    await tick(TV_POLL_FAST_MS)
    expect(p.doc.getElementById("badge")!.style.display).toBe("none")
  })

  it("the hosted page reloads once when the beat names a new player; the app never does", async () => {
    const beat = (): Reply => ({ json: { clock: { now: new Date(Date.now()).toISOString(), offsetMinutes: -420 }, player: "999" } })
    const p = boot({ stored: pairedAnswer(), nativePromise, beat })
    await tick(100)
    expect(p.reload).toHaveBeenCalledTimes(1)
    await tick(3 * TV_BEAT_MS)
    expect(p.reload).toHaveBeenCalledTimes(1)
    const app = boot({ stored: pairedAnswer(), nativePromise, app: true, beat, c: () => ({ json: pairedAnswer({ player: "999" }) }) })
    await tick(3 * TV_BEAT_MS)
    expect(app.reload).not.toHaveBeenCalled()
  })

  it("Check for changes now on the remote checks in, and the panel says when it last did", async () => {
    const p = boot({ stored: pairedAnswer(), nativePromise })
    await tick(100)
    p.lines[0].open()
    await tick(TV_POLL_FAST_MS + 5_000)
    const n = p.of("c").length
    const key = (keyCode: number) => {
      const e = new Event("keydown", { cancelable: true })
      Object.defineProperty(e, "keyCode", { value: keyCode })
      p.doc.dispatchEvent(e)
    }
    key(10009)
    expect(p.doc.getElementById("menu")!.textContent).toContain("Connected. Checked just now.")
    key(40)
    key(13)
    await tick(50)
    expect(p.of("c")).toHaveLength(n + 1)
  })

  /* ---- from the review: each of these failed before its fix ---- */

  const usual = (name: string, over: Record<string, unknown> = {}) => pairedAnswer({ playlist: { name, version: name, slides: [slide(name)] }, ...over })
  const big = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter((c) => Number(c[1]) > 2_147_483_647).length

  it("Which TV is which: the name goes up for its 90 s and comes down", async () => {
    const p = boot({ stored: usual("Usual"), nativePromise })
    await tick(100)
    p.lines[0].open()
    expect(p.ident().className).toBe("screen mid")
    p.tv.c = () => ({ json: usual("Usual", { identifyUntil: new Date(START + 100 + 90_000).toISOString(), clock: { now: new Date(START + 100).toISOString(), offsetMinutes: -420 } }) })
    p.lines[0].message()
    await tick(100)
    expect(p.ident().className).toBe("screen mid on")
    expect(p.ident().textContent).toBe("FrontMain St")
    await tick(89_000)
    expect(p.ident().className).toBe("screen mid on")
    await tick(1_200)
    expect(p.ident().className).toBe("screen mid")
  })

  it.each([
    ["2 days", 2],
    ["40 days", 40],
  ])("Which TV is which: a TV clock %s behind, restarted offline, does not leave the name over the menu or spin a timer", async (_n, days) => {
    // The stored answer named the TV 38 minutes ago by the real clock; the TV's own clock is far behind and nothing says otherwise.
    const stored = usual("Usual", { clock: { now: new Date(START - 40 * 60_000).toISOString(), offsetMinutes: -420 }, identifyUntil: new Date(START - 38 * 60_000).toISOString() })
    vi.setSystemTime(START - days * 86_400_000)
    const spy = vi.spyOn(globalThis, "setTimeout")
    const p = boot({ stored, nativePromise, disk: new Map([["screens.skew", "0"]]), c: () => "fail", beat: () => "fail" })
    await tick(5_000)
    expect(p.ident().className).toBe("screen mid")
    expect(p.showing()).toBe("Usual")
    await tick(3_600_000)
    expect(p.ident().className).toBe("screen mid")
    expect(big(spy)).toBe(0)
  })

  it("Which TV is which: a time further off than the dashboard ever asks for is not shown, and no timer is set for it", async () => {
    const far = (ms: number) => usual("Usual", { identifyUntil: new Date(Date.now() + ms).toISOString() })
    const spy = vi.spyOn(globalThis, "setTimeout")
    const p = boot({ stored: far(40 * 86_400_000), nativePromise, c: () => ({ json: far(40 * 86_400_000) }) })
    await tick(60_000)
    expect(p.ident().className).toBe("screen mid")
    p.tv.c = () => ({ json: far(3_600_000) })
    await tick(60_000)
    expect(p.ident().className).toBe("screen mid")
    p.tv.c = () => ({ json: usual("Usual", { identifyUntil: "not a time" }) })
    await tick(60_000)
    expect(p.ident().className).toBe("screen mid")
    expect(big(spy)).toBe(0)
    expect(vi.getTimerCount()).toBeLessThan(12)
  })

  it.each<[string, Reply]>([
    ["404", { status: 404 }],
    ["500", { status: 500 }],
    ["429", { status: 429 }],
    ["a null body", { json: null }],
    ["a page of HTML", { text: "<html><body>Not found</body></html>" }],
    ["a body with no paired in it", { json: { ok: true } }],
  ])("the CDN's address answering %s four times running: the old address is asked once, shown, and not again for 5 minutes", async (_n, wrong) => {
    // The TV's clock is an hour slow; the server's is the same at both addresses.
    const AHEAD = 3_600_000
    const p = boot({ stored: usual("Stored"), nativePromise, c: () => ({ json: usual("Stored") }) })
    await tick(100)
    p.lines[0].open()
    p.tv.c = () => wrong
    p.tv.content = () => ({ json: usual("FromOld", { beat: undefined, push: undefined, clock: { now: new Date(Date.now() + AHEAD).toISOString(), offsetMinutes: -420 } }) })
    const n = p.polls().length
    await tick(TV_POLL_FAST_MS + 3 * TV_POLL_SLOW_MS + 1_000)
    // Four wrong answers, and nothing asked of the old address yet. The menu stays up, and nothing says "No internet".
    expect(p.polls().slice(n).map((c) => c.kind)).toEqual(["c", "c", "c", "c"])
    expect(p.badge().style.display).toBe("none")
    expect(p.showing()).toBe("Stored")
    await tick(TV_POLL_SLOW_MS)
    const fifth = p.polls()[n + 4]
    expect(fifth.url).toBe("/api/tv/content")
    expect(fifth.headers).toEqual({ authorization: `Bearer ${TOKEN}`, "x-screen-device": "Tizen 6.5 · 1920x1080" })
    // Shown, with its live clock; the line and the beat's ticket are kept.
    expect(p.showing()).toBe("FromOld")
    expect(Math.abs(Number(p.disk.get("screens.skew")) - AHEAD)).toBeLessThan(100)
    expect(p.open()).toEqual([p.lines[0]])
    expect(p.last().beat).toBe("tick.et+/=")
    // Then the CDN's address again on the usual turn, and the old one at most every 5 minutes.
    const before = { content: p.of("content").length, c: p.of("c").length, beat: p.of("beat").length }
    await tick(30 * 60_000)
    // The line is open, so a turn is two minutes: the old address gets the first turn after each 5 minutes.
    const rescues = (30 * 60_000) / (Math.ceil(300_000 / TV_POLL_SLOW_MS) * TV_POLL_SLOW_MS)
    expect(p.of("content").length - before.content).toBe(rescues)
    expect(p.of("c").length - before.c).toBe((30 * 60_000) / TV_POLL_SLOW_MS - rescues)
    expect(p.of("beat").length - before.beat).toBe(10)
    expect(p.badge().style.display).toBe("none")
    expect(p.tv.most).toBe(1)
    // Put right, it is left alone.
    p.tv.c = () => ({ json: usual("Right", { clock: { now: new Date(Date.now() + AHEAD).toISOString(), offsetMinutes: -420 } }) })
    await tick(4 * TV_POLL_SLOW_MS)
    const settled = p.of("content").length
    await tick(30 * 60_000)
    expect(p.of("content")).toHaveLength(settled)
    expect(p.showing()).toBe("Right")
  })

  it("started from storage with the CDN's address down, the TV still beats, so the dashboard sees it on", async () => {
    const p = boot({ stored: pairedAnswer(), nativePromise, c: () => ({ status: 500 }), content: () => ({ status: 500 }) })
    expect(p.of("beat")).toHaveLength(1)
    await tick(60 * 60_000 + 1_000)
    expect(p.of("beat")).toHaveLength(21)
    // The old address was tried for it too, every 5 minutes and no more.
    expect(p.of("content").length).toBeGreaterThanOrEqual(11)
    expect(p.of("content").length).toBeLessThanOrEqual(12)
    expect(p.badge().style.display).toBe("none")
  })

  it("an answer of the wrong shape is a failed check-in: not shown, not stored, and the page carries on", async () => {
    const p = boot({ stored: usual("Good"), nativePromise, c: () => ({ json: usual("Good") }), content: () => ({ status: 500 }) })
    await tick(100)
    const bad: unknown[] = [
      { paired: true, player: PLAYER_VERSION },
      usual("Bad", { screen: { name: "Front" } }),
      usual("Bad", { playlist: { name: "Bad", slides: "none" } }),
      usual("Bad", { playlist: { name: "Bad", slides: [{ id: "x", seconds: 5 }] } }),
      usual("Bad", { times: {} }),
      usual("Bad", { times: [{ id: "t", days: 127, start: 0, end: 0 }] }),
      "paired",
      [1, 2],
    ]
    for (const body of bad) {
      p.tv.c = () => ({ json: body })
      await tick(TV_POLL_FAST_MS)
      expect(p.showing()).toBe("Good")
      expect(p.last().playlist.name).toBe("Good")
      expect(p.badge().style.display).toBe("none")
    }
    // The same on the way in: a stored answer of the wrong shape is not started from.
    const q = boot({ stored: { paired: true, screen: null }, nativePromise })
    await tick(100)
    expect(q.polls()[0].kind).toBe("content")
    // And a code with no code in it is not shown as one.
    const r = boot({ nativePromise, content: () => ({ json: { paired: false } }) })
    await tick(20_000)
    expect(r.doc.getElementById("pair")!.className).toBe("screen")
    expect(r.of("content")).toHaveLength(2)
  })

  it.each(["full", "blocked"] as const)("storage that is %s: the page still runs, and never reloads for a new version", async (storage) => {
    const disk = new Map<string, string>()
    let reloads = 0
    for (let life = 0; life < 5; life++) {
      const p = boot({ disk, storage, nativePromise, content: () => ({ json: pairedAnswer({ player: "5", beat: undefined, push: undefined }) }), c: () => ({ json: pairedAnswer({ player: "5" }) }), beat: () => ({ json: { clock: { now: new Date().toISOString(), offsetMinutes: -420 }, player: "5" } }) })
      await tick(15 * 60_000)
      reloads += p.reload.mock.calls.length
      // Paired through the old address, then on to the CDN's, the line and the beat, all from memory.
      expect(p.polls()[0].kind).toBe("content")
      expect(p.polls()[0].headers.authorization).toMatch(/^Bearer [A-Za-z0-9_-]{40,43}$/)
      expect(p.of("c").length).toBeGreaterThan(10)
      expect(p.of("beat").length).toBeGreaterThan(3)
      expect(p.open()).toHaveLength(1)
      vi.clearAllTimers()
    }
    expect(reloads).toBe(0)
  })

  it("answers that disagree about the version do not reload in a circle: once per version, and never twice in ten minutes", async () => {
    // The page is this version, the CDN's copy says 5, the beat says 6.
    const disk = new Map<string, string>([["screens.last", JSON.stringify(pairedAnswer())]])
    const at: number[] = []
    for (let life = 0; life < 12; life++) {
      const p = boot({ disk, nativePromise, c: () => ({ json: pairedAnswer({ player: "5" }) }), beat: () => ({ json: { clock: { now: new Date().toISOString(), offsetMinutes: -420 }, player: "6" } }) })
      // Each page lives two minutes, or until it reloads.
      for (let t = 0; t < 120_000 && !p.reload.mock.calls.length; t += 1_000) await tick(1_000)
      expect(p.reload.mock.calls.length).toBeLessThanOrEqual(1)
      if (p.reload.mock.calls.length) at.push(Date.now())
      vi.clearAllTimers()
    }
    expect(at.length).toBeLessThanOrEqual(3)
    at.slice(1).forEach((t, i) => expect(t - at[i]).toBeGreaterThanOrEqual(600_000))
    // One version, said again and again by the beat, reloads once however long it goes on.
    const live = (player: string) => () => ({ json: { clock: { now: new Date().toISOString(), offsetMinutes: -420 }, player } })
    const one = new Map<string, string>([["screens.last", JSON.stringify(pairedAnswer())]])
    let n = 0
    for (let life = 0; life < 4; life++) {
      const p = boot({ disk: one, nativePromise, c: () => ({ json: pairedAnswer({ player: "5" }) }), beat: live("5") })
      await tick(20 * 60_000)
      n += p.reload.mock.calls.length
      vi.clearAllTimers()
    }
    expect(n).toBe(1)
  })

  it("the CDN's copy naming another version never reloads the page: it can be an hour old, only a live answer counts", async () => {
    const disk = new Map<string, string>([["screens.last", JSON.stringify(pairedAnswer())]])
    let n = 0
    for (let life = 0; life < 3; life++) {
      const p = boot({ disk, nativePromise, c: () => ({ json: pairedAnswer({ player: "5" }) }) })
      await tick(30 * 60_000)
      n += p.reload.mock.calls.length
      vi.clearAllTimers()
    }
    expect(n).toBe(0)
  })

  it("an older copy handed out after a newer one does not put the old pictures back", async () => {
    const made = (name: string, minutesAgo: number) => usual(name, { clock: { now: new Date(Date.now() - minutesAgo * 60_000).toISOString(), offsetMinutes: -420 } })
    const old = made("Old", 30)
    const p = boot({ stored: old, nativePromise, c: () => ({ json: old }) })
    await tick(100)
    p.lines[0].open()
    p.tv.c = () => ({ json: made("New", 0) })
    p.lines[0].message()
    await tick(1_000)
    expect(p.showing()).toBe("New")
    // The re-checks after the push get the old copy from another part of the CDN.
    p.tv.c = () => ({ json: { ...old, push: { url: PUSH + "x" }, beat: "old" } })
    await tick(15_000)
    expect(p.showing()).toBe("New")
    expect(p.last().playlist.name).toBe("New")
    // It is still an answer: no badge, the line it already has is kept, and the old address is not asked.
    expect(p.badge().style.display).toBe("none")
    expect(p.open()).toEqual([p.lines[0]])
    await tick(10 * 60_000)
    expect(p.of("content")).toHaveLength(0)
    expect(p.showing()).toBe("New")
    // A copy saying the TV was removed is never passed over.
    p.tv.c = () => ({ json: { paired: false } })
    await tick(TV_POLL_SLOW_MS)
    expect(p.doc.getElementById("code")!.textContent).toBe("482 913")
  })

  it("a stored answer, or one with a time hours ahead, does not shut out the answers after it", async () => {
    const made = (name: string, ms: number) => usual(name, { clock: { now: new Date(Date.now() + ms).toISOString(), offsetMinutes: -420 } })
    // Stored with a later time than the first copy from the network: storage is not a reason to pass an answer over.
    const p = boot({ stored: made("Stored", 20 * 60_000), nativePromise, c: () => ({ json: made("First", -60_000) }) })
    await tick(100)
    expect(p.showing()).toBe("First")
    // One with a time three hours ahead gets shown; the true ones after it must still get in.
    p.tv.c = () => ({ json: made("Ahead", 3 * 3_600_000) })
    await tick(TV_POLL_FAST_MS)
    expect(p.last().playlist.name).toBe("Ahead")
    p.tv.c = () => ({ json: made("True", 0) })
    await tick(TV_POLL_FAST_MS + 1_000)
    expect(p.showing()).toBe("True")
    // An answer from the old address is the time now: always taken.
    p.tv.c = () => ({ status: 500 })
    p.tv.content = () => ({ json: made("Live", -30 * 60_000) })
    await tick(6 * TV_POLL_FAST_MS)
    expect(p.of("content")).toHaveLength(1)
    expect(p.showing()).toBe("Live")
  })

  it("a push that lands while a slow check-in is out is followed by one more check-in when it ends", async () => {
    let takes = 5
    const p = boot({ stored: usual("Old"), nativePromise, c: () => ({ json: usual("Old") }), delay: () => takes })
    await tick(100)
    p.lines[0].open()
    await tick(TV_POLL_FAST_MS)
    takes = 12_000
    await tick(TV_POLL_SLOW_MS) // the slow turn's check-in goes out, and will come back with the old pictures
    const n = p.of("c").length
    await tick(500)
    takes = 5
    p.tv.c = () => ({ json: usual("New") })
    p.lines[0].message()
    // All three asks (now, 3 s, 10 s) fall inside the one that is out.
    await tick(11_000)
    expect(p.of("c")).toHaveLength(n)
    expect(p.showing()).toBe("Old")
    await tick(1_000)
    expect(p.of("c")).toHaveLength(n + 1)
    expect(p.showing()).toBe("New")
    // One more, not one per ask; then the usual slow turn.
    await tick(TV_POLL_SLOW_MS - 1_000)
    expect(p.of("c")).toHaveLength(n + 1)
    expect(p.tv.most).toBe(1)
  })

  it("just paired through the old address: the CDN's address, the line and the beat follow within 2 s", async () => {
    const p = boot({ nativePromise })
    await tick(100)
    p.tv.content = () => ({ json: pairedAnswer({ beat: undefined, push: undefined }) })
    await tick(5_000)
    const paired = Date.now()
    expect(p.of("c")).toHaveLength(0)
    await tick(2_000)
    expect(p.of("c")).toHaveLength(1)
    expect(p.of("c")[0].at - paired).toBeGreaterThanOrEqual(1_000)
    expect(p.lines).toHaveLength(1)
    expect(p.of("beat")).toHaveLength(1)
    // After that, the usual turn.
    await tick(TV_POLL_FAST_MS)
    expect(p.of("c")).toHaveLength(2)
  })

  it("two addresses that disagree (paired, not paired) do not make the TV ask in a tight circle", async () => {
    const p = boot({ nativePromise, content: () => ({ json: pairedAnswer({ beat: undefined, push: undefined }) }), c: () => ({ json: { paired: false } }) })
    await tick(5 * 60_000)
    // A pair of calls each fast turn, not a pair every second and a half (which would be about 400).
    expect(p.polls().length).toBeLessThan(50)
    expect(p.tv.most).toBe(1)
    expect(vi.getTimerCount()).toBeLessThan(12)
  })

  it("the TV slept (its clock jumped on, no event said so): a new line, a check-in and a beat within seconds", async () => {
    const p = boot({ stored: pairedAnswer(), nativePromise })
    await tick(100)
    p.lines[0].open()
    await tick(60_000)
    const c = p.of("c").length
    const b = p.of("beat").length
    vi.setSystemTime(Date.now() + 9 * 3_600_000)
    await tick(10_100)
    expect(p.lines).toHaveLength(2)
    expect(p.lines[0].readyState).toBe(2)
    expect(p.open()).toEqual([p.lines[1]])
    expect(p.of("c")).toHaveLength(c + 1)
    expect(p.of("beat")).toHaveLength(b + 1)
    // An ordinary ten seconds, or a late one, is not a jump.
    await tick(5 * 60_000)
    expect(p.lines).toHaveLength(2)
  })

  it("the TV's clock is set back after a beat: it beats again at once, and store time is right again", async () => {
    const lunch = () =>
      usual("Usual", { times: [{ id: "t", days: 127, start: 12 * 60, end: 15 * 60, slides: [slide("Lunch")] }], clock: { now: new Date(START - 60_000).toISOString(), offsetMinutes: -420 } })
    let real = 0 // the true time less the TV's
    const p = boot({ stored: lunch(), nativePromise, c: () => ({ json: lunch() }), beat: () => ({ json: { clock: { now: new Date(Date.now() + real).toISOString(), offsetMinutes: -420 }, player: PLAYER_VERSION } }) })
    await tick(30_000)
    expect(p.showing()).toBe("Lunch")
    const b = p.of("beat").length
    // Someone sets the TV's clock back two hours: by it, lunch has not started.
    real = 2 * 3_600_000
    vi.setSystemTime(Date.now() - real)
    await tick(10_100)
    expect(p.of("beat")).toHaveLength(b + 1)
    await tick(2_000)
    expect(p.showing()).toBe("Lunch")
    expect(Math.abs(Number(p.disk.get("screens.skew")) - real)).toBeLessThan(100)
  })

  it("the remote's panel open across check-ins, even one that cannot be drawn, never stops the check-ins", async () => {
    const p = boot({ stored: pairedAnswer(), nativePromise })
    await tick(100)
    const key = (keyCode: number) => {
      const e = new Event("keydown", { cancelable: true })
      Object.defineProperty(e, "keyCode", { value: keyCode })
      p.doc.dispatchEvent(e)
    }
    key(10009)
    const menu = p.doc.getElementById("menu")!
    expect(menu.className).toBe("on")
    await tick(TV_POLL_FAST_MS + 100)
    expect(menu.textContent).toContain("Connected. Checked just now.")
    // The panel breaks (a set that will not take the markup, say).
    Object.defineProperty(menu, "innerHTML", { set: () => { throw new Error("no") }, get: () => "" })
    const n = p.of("c").length
    await tick(4 * TV_POLL_FAST_MS)
    expect(p.of("c")).toHaveLength(n + 4)
    expect(p.tv.most).toBe(1)
  })

  it("a throw while drawing does not fail the check-in or stop the ten-second redraw", async () => {
    const p = boot({ stored: usual("One"), nativePromise })
    await tick(100)
    p.lines[0].open()
    // Naming the TV breaks on this set.
    p.ident().querySelector = () => { throw new Error("no") }
    p.tv.c = () => ({ json: usual("Two", { identifyUntil: new Date(Date.now() + 60_000).toISOString() }) })
    p.lines[0].message()
    await tick(1_000)
    // The answer still counted: stored, pictures up, no old address, no badge.
    expect(p.last().playlist.name).toBe("Two")
    expect(p.showing()).toBe("Two")
    await tick(10 * 60_000)
    expect(p.of("content")).toHaveLength(0)
    // The redraw is still running: it is what notices the clock jump.
    const b = p.of("beat").length
    vi.setSystemTime(Date.now() + 3_600_000)
    await tick(10_100)
    expect(p.of("beat")).toHaveLength(b + 1)
  })

  it("two days of pushes, drops, failures, wrong answers and standby: timers, lines and pictures stay bounded", async () => {
    const ans = (v: number) => pairedAnswer({ playlist: { name: "U", version: String(v), slides: [slide("A"), slide("B" + (v % 3))] } })
    const p = boot({ stored: ans(0), nativePromise, c: () => ({ json: ans(0) }) })
    await tick(100)
    const timers: number[] = []
    for (let h = 0; h < 48; h++) {
      const line = () => p.lines[p.lines.length - 1]
      if (h % 3 === 0) line().open()
      for (let i = 0; i < 10; i++) {
        line().message()
        await tick(700)
      }
      if (h % 5 === 1) line().drop(true)
      if (h % 7 === 2) {
        p.tv.c = () => "fail"
        p.tv.beat = () => "hang"
      } else if (h % 7 === 4) {
        p.tv.c = () => ({ status: 500 })
        p.tv.content = () => ({ json: { ...ans(h), beat: undefined, push: undefined } })
      } else {
        p.tv.c = () => ({ json: ans(h) })
        p.tv.beat = () => ({ json: { clock: { now: new Date().toISOString(), offsetMinutes: -420 }, player: PLAYER_VERSION } })
      }
      if (h % 4 === 3) {
        p.visible()
        p.fire("online")
      }
      if (h % 11 === 6) vi.setSystemTime(Date.now() + 8 * 3_600_000)
      await tick(3_600_000 - 7_000)
      timers.push(vi.getTimerCount())
      expect(p.open().length).toBeLessThanOrEqual(1)
      expect(p.stage()).toBeLessThanOrEqual(3)
    }
    // The redraw, the next check-in, the next beat, the slide change, and at most a line waiting and a call's guard or two.
    expect(Math.max(...timers)).toBeLessThanOrEqual(8)
    expect(p.tv.most).toBe(1)
    expect(p.reload).not.toHaveBeenCalled()
  })

  /* ---- how often it asks: 2 min with the line; without it 15 s for ten minutes, then 60 s ---- */

  // In these, answers take no time (delay 0). A turn is then its wait and a few ms (the pretend clock gives
  // each zero-length timer inside a tick one millisecond), so gaps are rounded to the second.

  /** Seconds between the check-ins at the CDN's address over the next `ms` (and a second, for those few ms), the first counted from the one before. */
  async function watch(p: ReturnType<typeof boot>, ms: number) {
    const from = p.of("c").length
    await tick(ms + 1_000)
    const at = p.of("c").map((c) => c.mono)
    return at.slice(from).map((t, i) => Math.round((t - at[from + i - 1]) / 1000))
  }
  const fastThenDown = (ms: number) => [...Array(TV_POLL_FAST_FOR_MS / TV_POLL_FAST_MS).fill(FAST), ...Array((ms - TV_POLL_FAST_FOR_MS) / TV_POLL_DOWN_MS).fill(DOWN)]

  it.each<[string, Parameters<typeof boot>[0]]>([
    ["a set with no EventSource", { nativePromise, stored: pairedAnswer(), eventSource: false, delay: () => 0 }],
    ["an answer that names no line", { nativePromise, stored: pairedAnswer({ push: null }), c: () => ({ json: pairedAnswer({ push: null }) }), delay: () => 0 }],
    ["a line that never opens", { nativePromise, stored: pairedAnswer(), delay: () => 0 }],
  ])("with no line (%s) it asks every 15 s for the first ten minutes, then every 60 s", async (_n, opts) => {
    const p = boot(opts)
    await tick(100)
    const gaps = await watch(p, HOUR)
    expect(gaps).toEqual(fastThenDown(HOUR))
    // The first hour after start-up: the one at start-up and these. Every hour after: one a minute.
    expect(p.of("c")).toHaveLength(1 + FIRST_HOUR)
    expect(await watch(p, HOUR)).toEqual(Array(HOUR / TV_POLL_DOWN_MS).fill(DOWN))
    expect(p.badge().style.display).toBe("none")
    expect(p.tv.most).toBe(1)
  })

  it("the spread is up to a tenth of whichever wait is on: 15 s, 60 s or 2 minutes", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999)
    const p = boot({ stored: pairedAnswer(), nativePromise, delay: () => 0 })
    await tick(100)
    const spread = async (ms: number, base: number, least: number) => {
      const from = p.of("c").length
      await tick(ms)
      // The first one after a change of wait was set under the old one.
      const at = p.of("c").slice(from).map((c) => c.mono)
      const gaps = at.slice(2).map((t, i) => t - at[i + 1])
      expect(gaps.length).toBeGreaterThan(least)
      gaps.forEach((g) => {
        expect(g).toBeGreaterThan(base * 1.09)
        expect(g).toBeLessThanOrEqual(base * 1.1 + 10)
      })
    }
    await spread(TV_POLL_FAST_FOR_MS - 30_000, TV_POLL_FAST_MS, 30)
    await tick(60_000)
    await spread(20 * 60_000, TV_POLL_DOWN_MS, 15)
    p.lines[0].open()
    await spread(30 * 60_000, TV_POLL_SLOW_MS, 10)
  })

  it("the line opening puts it on two minutes; dropping after that gives ten fresh fast minutes, then 60 s again", async () => {
    const p = boot({ stored: pairedAnswer(), nativePromise, delay: () => 0 })
    await tick(100)
    // Twenty minutes with the line still trying: fast, then down to one a minute.
    expect(await watch(p, 20 * 60_000)).toEqual(fastThenDown(20 * 60_000))
    p.lines[0].open()
    // The turn already set (60 s) runs out, then every two minutes for as long as the line is open.
    expect(await watch(p, TV_POLL_DOWN_MS + HOUR)).toEqual([DOWN, ...Array(HOUR / TV_POLL_SLOW_MS).fill(SLOW)])
    // It drops, and the browser keeps trying. The ten minutes start when the TV next takes its turn and finds it down.
    p.lines[0].drop(false)
    const after = await watch(p, TV_POLL_SLOW_MS + 30 * 60_000)
    expect(after).toEqual([SLOW, ...fastThenDown(30 * 60_000)])
    expect(p.lines).toHaveLength(1)
    // Open again: two minutes again.
    p.lines[0].open()
    expect((await watch(p, TV_POLL_DOWN_MS + 10 * TV_POLL_SLOW_MS)).slice(1)).toEqual(Array(10).fill(SLOW))
  })

  it("through a long outage, coming back on screen or online again and again cannot keep it on 15 s", async () => {
    // The line is made and fails every time, for good.
    const p = boot({ stored: pairedAnswer(), nativePromise, delay: () => 0 })
    await tick(100)
    const n = p.of("c").length
    let events = 0
    for (let m = 0; m < 60; m++) {
      p.lines[p.lines.length - 1].drop(true)
      if (m % 2 === 0) {
        p.visible()
        p.fire("online")
        events++
      }
      await tick(60_000)
    }
    // Ten minutes of fast ones, fifty of one a minute, and the one check-in each coming-back asks for. No more.
    const asked = p.of("c").length - n
    expect(asked).toBeLessThanOrEqual(FIRST_HOUR + events + 2)
    expect(asked).toBeGreaterThanOrEqual(HOUR / TV_POLL_DOWN_MS)
    // The same hour again, every minute this time: still one a minute and the ones asked for.
    const n2 = p.of("c").length
    for (let m = 0; m < 60; m++) {
      p.visible()
      p.fire("online")
      p.lines[p.lines.length - 1].drop(true)
      await tick(60_000)
    }
    expect(p.of("c").length - n2).toBeLessThanOrEqual(HOUR / TV_POLL_DOWN_MS + 60 + 2)
    expect(p.open().length).toBeLessThanOrEqual(1)
    expect(p.tv.most).toBe(1)
  })

  it("a clock jump with no line (the TV slept) leaves it on one a minute, not back on 15 s", async () => {
    const p = boot({ stored: pairedAnswer(), nativePromise, eventSource: false, delay: () => 0 })
    await tick(100)
    await tick(20 * 60_000)
    vi.setSystemTime(Date.now() + 9 * HOUR)
    // The jump is noticed and one check-in asked for; then the minute's turn as before.
    const gaps = await watch(p, 30 * 60_000)
    expect(gaps.filter((g) => g < DOWN).length).toBeLessThanOrEqual(2)
    expect(gaps.slice(2).every((g) => g === DOWN)).toBe(true)
  })

  it("the TV's clock set back does not make a wait below zero, a huge one, or fast check-ins for hours", async () => {
    const spy = vi.spyOn(globalThis, "setTimeout")
    const p = boot({ stored: pairedAnswer(), nativePromise, eventSource: false, delay: () => 0 })
    await tick(100)
    await tick(20 * 60_000)
    vi.setSystemTime(Date.now() - 2 * HOUR)
    const gaps = await watch(p, 2 * HOUR)
    // Taken as just started: at most ten fast minutes (and the one check-in the jump asks for), then one a minute.
    const fast = gaps.filter((g) => g < DOWN)
    expect(fast.length).toBeLessThanOrEqual(TV_POLL_FAST_FOR_MS / TV_POLL_FAST_MS + 2)
    expect(gaps.slice(fast.length + 1).every((g) => g === DOWN)).toBe(true)
    expect(Math.max(...gaps)).toBe(DOWN)
    const waits = spy.mock.calls.map((c) => Number(c[1] ?? 0))
    expect(Math.min(...waits)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...waits)).toBeLessThanOrEqual(300_000)
  })

  it("an hour with the line open is thirty check-ins", async () => {
    const p = boot({ stored: pairedAnswer(), nativePromise, delay: () => 0 })
    await tick(100)
    p.lines[0].open()
    await tick(TV_POLL_FAST_MS + 100)
    expect(await watch(p, HOUR)).toEqual(Array(HOUR / TV_POLL_SLOW_MS).fill(SLOW))
  })
})

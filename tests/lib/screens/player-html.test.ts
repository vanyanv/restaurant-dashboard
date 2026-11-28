import { describe, it, expect } from "vitest"
import { parse } from "acorn"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { DASHBOARD_ORIGIN, playerHtml } from "@/lib/screens/player-html"
import { TV_BEAT_MS, TV_NUDGE_RETRY_MS, TV_POLL_DOWN_MS, TV_POLL_FAST_FOR_MS, TV_POLL_FAST_MS, TV_POLL_SLOW_MS } from "@/lib/screens/limits"

/**
 * The TV player runs on old Samsung engines (back to Tizen 2.3's WebKit), and
 * the Samsung app carries a copy of it. These keep both true.
 */
const script = (html: string) => /<script>([\s\S]*?)<\/script>/.exec(html)![1]

describe("TV player page", () => {
  it("the Samsung app's copy is the current player", () => {
    const committed = readFileSync(join(process.cwd(), "tizen-app/index.html"), "utf8")
    // If this fails: npx tsx scripts/tizen-player.ts
    expect(committed).toBe(playerHtml({ base: DASHBOARD_ORIGIN, app: true }))
  })

  it("the app talks to the live dashboard and loads Samsung's TV API; the page does neither", () => {
    const app = playerHtml({ base: DASHBOARD_ORIGIN, app: true })
    const page = playerHtml({ base: "", app: false })
    expect(app).toContain(`var BASE = "${DASHBOARD_ORIGIN}"`)
    expect(app).toContain("$WEBAPIS/webapis/webapis.js")
    expect(page).toContain('var BASE = ""')
    expect(page).not.toContain("webapis.js")
  })

  it("uses nothing an old Samsung engine can't run", () => {
    const html = playerHtml({ base: "", app: false })
    const js = script(html)
    // Plain ES5, with no fetch, URL or unguarded Promise: Tizen 2.3 and 2.4 have none of them.
    expect(() => parse(js, { ecmaVersion: 5 })).not.toThrow()
    expect(js).not.toMatch(/\bfetch\(|\bnew URL\(|\["catch"\]|\?\.|\?\?|\.padStart\(|\.\.\.|=>|\blet\b|\bconst\b|`/)
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)![1]
    expect(css).not.toMatch(/oklch\(|\bcq[whib]\b|\d+cq|:has\(|container-type|\binset:/)
  })

  it("leaves a picture up: no reload on a timer, and a call that hangs is given up on", () => {
    const js = script(playerHtml({ base: "", app: false }))
    expect(js).not.toMatch(/RELOAD_AFTER/)
    expect(js.match(/location\.reload/g)).toHaveLength(1)
    expect(js).toContain("x.timeout = ms")
  })

  it("asks for a code with its token in a header; once paired, the CDN's address and the beat with no headers", () => {
    const js = script(playerHtml({ base: "", app: false }))
    // The pairing loop: the address that makes the code, with both headers.
    expect(js).toContain('ask(BASE + "/api/tv/content", "json", { authorization: "Bearer " + token, "x-screen-device": device }, TIMEOUT)')
    // A header here would force a CORS preflight and stop the CDN keeping the answer.
    expect(js).toContain('ask(BASE + "/api/tv/c/" + token, "json", {}, TIMEOUT)')
    expect(js).toContain('ask(BASE + "/api/tv/beat/" + token + "?k=" + encodeURIComponent(now.beat) + "&d=" + encodeURIComponent(device), "json", {}, TIMEOUT)')
    expect(js.match(/authorization/g)).toHaveLength(1)
    // The numbers are the shared ones, and the push line is only made where the set has one.
    expect(js).toContain(`FAST_POLL = ${TV_POLL_FAST_MS}, SLOW_POLL = ${TV_POLL_SLOW_MS}, DOWN_POLL = ${TV_POLL_DOWN_MS}, FAST_FOR = ${TV_POLL_FAST_FOR_MS}, BEAT = ${TV_BEAT_MS}, NUDGE = ${JSON.stringify(TV_NUDGE_RETRY_MS)};`)
    expect(js.match(/new window\.EventSource\(/g)).toHaveLength(1)
    expect(js).toContain("if (!url || !window.EventSource) return;")
    // Check-ins are a chain of timeouts, one at a time; the only intervals are the redraw and the code's countdown.
    expect(js.match(/setInterval\(/g)).toHaveLength(2)
  })

  it("Back on the remote opens the panel, and only the app offers to close itself", () => {
    const js = script(playerHtml({ base: DASHBOARD_ORIGIN, app: true }))
    expect(js).toContain("k === 10009")
    expect(js).toContain("getCurrentApplication().exit()")
  })
})

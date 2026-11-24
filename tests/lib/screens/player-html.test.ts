import { describe, it, expect } from "vitest"
import { parse } from "acorn"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { DASHBOARD_ORIGIN, playerHtml } from "@/lib/screens/player-html"

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
    expect(js).toContain('ask(BASE + "/api/tv/content", "json"')
    expect(js).toContain("x.timeout = ms")
  })

  it("Back on the remote opens the panel, and only the app offers to close itself", () => {
    const js = script(playerHtml({ base: DASHBOARD_ORIGIN, app: true }))
    expect(js).toContain("k === 10009")
    expect(js).toContain("getCurrentApplication().exit()")
  })
})

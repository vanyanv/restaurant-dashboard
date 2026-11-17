import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Every page stylesheet is imported globally by `src/app/globals.css`, so a
 * class that two of them both declare is one class with two sets of rules,
 * and whichever file loads later wins on every page.
 *
 * That happened on 2026-11-16: Inventory reused `.iv-pill`, `.iv-bar` and
 * `.iv-days`, which Invoices already owned. Inventory loads after Invoices,
 * so the Invoices "Spend by vendor" bars collapsed to an 88 x 8 px sliver
 * and its status pills shrank to 9.5 px capitals. Inventory's classes are
 * now `.inv-*`.
 *
 * This test fails when a class STARTS a rule in two page stylesheets. A file
 * that deliberately extends another page's class does so in a compound
 * selector and is listed below with its reason.
 */

const STYLES = join(process.cwd(), "src", "styles")

const PAGE_SHEETS = [
  "counter-checks.css",
  "crew-checks.css",
  "counter-shop.css",
  "counter-invoices.css",
  "counter-pnl.css",
  "counter-menu.css",
  "counter-count.css",
  "counter-inventory.css",
  "counter-people.css",
  "counter-ui.css",
]

/** class -> the sheets allowed to start a rule with it, and why. */
const INTENTIONAL: Record<string, string[]> = {
  // Shop's tables reuse the store-checks table and add a selected-row state.
  ".ck-table": ["counter-checks.css", "counter-shop.css"],
}

function ruleStarts(css: string): Set<string> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "")
  const out = new Set<string>()
  // A selector list sits between a `}` / `{` / start and the next `{`.
  for (const m of text.matchAll(/(?:^|[{}])\s*([^{}@]+?)\s*\{/g)) {
    for (const sel of m[1].split(",")) {
      const first = sel.trim().match(/^(\.[a-z][a-z0-9_-]*)/)
      // `.ct-root` / `.ct-phone` are the app's scope wrappers: every sheet
      // writes `.ct-phone .its-own-class`, which is not a shared class.
      if (first && !first[1].startsWith(".ct-")) out.add(first[1])
    }
  }
  return out
}

describe("page stylesheets do not share class names", () => {
  it("no class starts a rule in two page stylesheets", () => {
    const owners = new Map<string, string[]>()
    for (const sheet of PAGE_SHEETS) {
      const css = readFileSync(join(STYLES, sheet), "utf8")
      for (const cls of ruleStarts(css)) {
        owners.set(cls, [...(owners.get(cls) ?? []), sheet])
      }
    }
    const clashes = [...owners]
      .filter(([, sheets]) => sheets.length > 1)
      .filter(([cls, sheets]) => {
        const allowed = INTENTIONAL[cls.replace(/--.*$/, "")]
        return !allowed || sheets.some((s) => !allowed.includes(s))
      })
      .map(([cls, sheets]) => `${cls}: ${sheets.join(", ")}`)
    expect(clashes).toEqual([])
  })

  it("still catches the 2026-11-16 clash", () => {
    const a = ruleStarts(".iv-pill{color:red}\n.iv-bar .n{x:y}")
    expect(a.has(".iv-pill")).toBe(true)
    expect(a.has(".iv-bar")).toBe(true)
  })
})

// The harness is itself under test.
//
// A comparison that finds nothing on BOTH sides reports "no differences" and
// passes forever — an outcome strictly worse than having no gate, because it
// would be believed. A selector typo, a prototype navigation that silently
// no-opped, a page that redirected to /login: all three produce two empty
// landmark lists. Two tests earlier in this project shipped unable to fail and
// were only found by deliberately breaking the implementation first, so every
// case below was proved red before it was allowed to be green — the outputs
// are in .superpowers/sdd/2026-08-25-counter-fidelity-foundation/task-2-report.md.
//
// The fixtures are hand-written rather than captured, so they say what the
// comparison is FOR: a missing section, a table where the design specifies
// cards, a style that drifted, and — the case this whole task exists for —
// silence on both sides.

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { converter, parse } from "culori"

import {
  CHECKED_PROPERTIES,
  COMPARED_ATTRIBUTES,
  compareLandmarks,
  contrastRatio,
  defectWhere,
  findThemeDefects,
  landmarkTally,
  matchedCount,
  relativeLuminance,
  requiredContrast,
  isTokenCorrection,
  applyAbsenceAllowances,
  TOKEN_CORRECTIONS,
  type Difference,
  type Landmark,
  type ThemedNode,
} from "../../e2e/fidelity/landmarks"
import { PAGES, pageById, absenceBudget } from "../../e2e/fidelity/manifest"

/** A landmark carrying the prototype's own Overview values, so a fixture reads like a real render. */
function lm(classes: string[], over: Partial<Landmark> = {}): Landmark {
  const base: Record<string, string> = {}
  for (const p of CHECKED_PROPERTIES) base[p] = DEFAULT_STYLE[p] ?? "normal"
  const { style: styleOver, ...rest } = over
  return {
    order: 0,
    classes,
    attrs: {},
    text: "some text",
    box: { w: 640, h: 96 },
    ...rest,
    // A fixture overrides one property, not the whole computed style — the
    // point of these cases is that ONE thing differs.
    style: { ...base, ...(styleOver ?? {}) },
  }
}

const DEFAULT_STYLE: Record<string, string> = {
  display: "grid",
  "font-family": "sans",
  "font-size": "13px",
  "font-weight": "400",
  "line-height": "19.5px",
  "letter-spacing": "normal",
  color: "oklch(0.24 0.014 40)",
  "background-color": "oklch(0.984 0.004 66)",
  "border-radius": "8px",
  "border-top-width": "1px",
  "border-left-width": "0px",
  "border-left-color": "n/a",
  "padding-top": "18px",
  "padding-left": "20px",
  gap: "20px",
  "grid-template-columns": "2 tracks",
  "text-transform": "none",
  "font-variant-numeric": "lining-nums tabular-nums",
}

/** The prototype's Overview opens with a dispatch line, then the duo head block. */
const withDispatch: Landmark[] = [
  lm(["dispatch"], { order: 0, text: "3 need you · 41 orders trading · synced 12 min ago" }),
  lm(["headline"], { order: 1, text: "$34,525" }),
]
/** What shipped: the head block, and nothing above it. */
const withoutDispatch: Landmark[] = [lm(["headline"], { order: 0, text: "$7,122" })]

/** Prototype note 33: the per-store rows "are cards now". */
const withStores: Landmark[] = [
  lm(["sec"], { order: 0, text: "Where the money came from" }),
  lm(["stores"], { order: 1, text: "Hollywood Glendale Van Nuys" }),
  lm(["stcard"], { order: 2, text: "Hollywood" }),
]
/** What shipped: a four-column table whose empty rows are em-dashes. */
const withTable: Landmark[] = [
  lm(["sec"], { order: 0, text: "Stores" }),
  lm(["tbl"], { order: 1, text: "Hollywood — — —" }),
]

/**
 * The prototype's strip emits its cells as bare <div>s with no class, and
 * records the count in data-n. Six against four is the addendum's own
 * "a four-cell strip of plain figures" defect.
 */
const stripOfSix: Landmark[] = [lm(["strip"], { order: 0, attrs: { "data-n": "6" } })]
const stripOfFour: Landmark[] = [lm(["strip"], { order: 0, attrs: { "data-n": "4" } })]

const radius8: Landmark[] = [lm(["strip"], { order: 0 })]
const radius0: Landmark[] = [lm(["strip"], { order: 0, style: { "border-radius": "0px" } })]

/** The prototype's figures are invented; ours come from a real database. */
const sales34525: Landmark[] = [lm(["fig"], { order: 0, text: "$34,525" })]
const sales7122: Landmark[] = [lm(["fig"], { order: 0, text: "$7,122" })]
const salesEmpty: Landmark[] = [lm(["fig"], { order: 0, text: "" })]

describe("compareLandmarks", () => {
  it("reports a section the prototype has and we do not", () => {
    const diffs = compareLandmarks(withDispatch, withoutDispatch)
    expect(diffs).toContainEqual(
      expect.objectContaining({ kind: "missing", classes: ["dispatch"] }),
    )
  })

  it("reports a table where the prototype has cards", () => {
    // The exact defect that shipped: note 33's per-store cards rendered as a table.
    const diffs = compareLandmarks(withStores, withTable)
    expect(diffs.some((d) => d.kind === "missing" && d.classes.includes("stores"))).toBe(true)
    expect(diffs.some((d) => d.kind === "extra" && d.classes.includes("tbl"))).toBe(true)
  })

  it("reports a style difference on a landmark present in both", () => {
    const diffs = compareLandmarks(radius8, radius0)
    expect(diffs).toContainEqual(
      expect.objectContaining({ kind: "style", property: "border-radius" }),
    )
  })

  it("reports a strip of four where the prototype has six", () => {
    // The strip's cells carry no class of their own, so the class sequence is
    // identical either way and only data-n can tell these apart. Before fix
    // round 1 this passed clean.
    const diffs = compareLandmarks(stripOfSix, stripOfFour)
    expect(diffs).toContainEqual(
      expect.objectContaining({ kind: "style", property: "data-n", prototype: "6", ours: "4" }),
    )
    expect(COMPARED_ATTRIBUTES).toContain("data-n")
  })

  it("aligns a mis-sized strip as one strip, not as a missing and an extra one", () => {
    // data-n is compared but must NOT join the alignment signature: a strip
    // built with the wrong number of cells is one strip rendered wrong.
    const diffs = compareLandmarks(stripOfSix, stripOfFour)
    expect(diffs.some((d) => d.kind === "missing" || d.kind === "extra")).toBe(false)
  })

  it("reports NOTHING when the two sides genuinely match", () => {
    expect(compareLandmarks(withDispatch, withDispatch)).toEqual([])
  })

  it("does not report a difference merely because the numbers differ", () => {
    // Prototype figures are invented; ours come from the database. Text is
    // compared for presence, never for equality.
    expect(compareLandmarks(sales34525, sales7122)).toEqual([])
  })

  it("reports an element that should carry text and carries none", () => {
    expect(compareLandmarks(sales34525, salesEmpty)).toContainEqual(
      expect.objectContaining({ kind: "style", property: "text" }),
    )
  })

  it("throws when BOTH sides are empty — never a false pass", () => {
    // A selector typo, a failed navigation, an unauthenticated page: all three
    // produce two empty landmark lists. Silence here would be a green gate over
    // a blank screen.
    expect(() => compareLandmarks([], [])).toThrow(/no landmarks/i)
  })

  it("still reports when only one side is empty", () => {
    // Not the throwing case, and it must not become one: an unbuilt page is a
    // wall of `missing`, which is the Overview baseline this project starts from.
    const proto = [...withDispatch, ...withStores]
    const diffs = compareLandmarks(proto, [])
    expect(diffs).toHaveLength(proto.length)
    expect(diffs.every((d) => d.kind === "missing")).toBe(true)
  })

  it("keeps order, so an element built in the wrong place is a finding", () => {
    const inOrder = [lm(["dispatch"], { order: 0 }), lm(["strip"], { order: 1 })]
    const reversed = [lm(["strip"], { order: 0 }), lm(["dispatch"], { order: 1 })]
    const diffs = compareLandmarks(inOrder, reversed)
    expect(diffs.some((d) => d.kind === "missing")).toBe(true)
    expect(diffs.some((d) => d.kind === "extra")).toBe(true)
  })

  it("counts how many landmarks the two sides actually share", () => {
    // The rendering pass only looks at landmarks present on both sides, so it
    // needs to know when that set is empty — otherwise it goes green over a
    // page that renders nothing at all. It did exactly that on this suite's
    // first end-to-end run.
    expect(matchedCount(withStores, withStores)).toBe(withStores.length)
    expect(matchedCount(withDispatch, withTable)).toBe(0)
  })

  it("counts landmarks by class for the report headline", () => {
    expect(landmarkTally(withStores)).toEqual({ sec: 1, stores: 1, stcard: 1 })
  })
})

describe("applyAbsenceAllowances — landmarks the database cannot fill", () => {
  const missing = (cls: string[], order: number): Difference => ({
    kind: "missing",
    order,
    classes: cls,
  })

  it("forgives exactly the recorded count, and reports the one past it", () => {
    // Five missing bullet meters is the recorded fact: only two of Overview's
    // six figures are judged against anything this schema publishes. A sixth
    // is a regression, and has to read as one.
    const five = [0, 1, 2, 3, 4].map((i) => missing(["blt"], i))
    expect(applyAbsenceAllowances(five, { blt: 5 }).unexplained).toEqual([])

    const six = [...five, missing(["blt"], 5)]
    const out = applyAbsenceAllowances(six, { blt: 5 })
    expect(out.unexplained).toHaveLength(1)
    expect(out.stale).toEqual([])
  })

  it("NEVER forgives an extra, however the budget is written", () => {
    // Ruling F-R8: an extra silently leaves the rendering comparison, so
    // forgiving one shrinks what is checked without saying so.
    const diffs: Difference[] = [{ kind: "extra", order: 3, classes: ["strip"] }]
    expect(applyAbsenceAllowances(diffs, { strip: 9 }).unexplained).toEqual(diffs)
  })

  it("forgives nothing it was not asked to", () => {
    const diffs = [missing(["blt"], 0), missing(["queue"], 1)]
    const out = applyAbsenceAllowances(diffs, { blt: 1 })
    expect(out.unexplained.map((d) => d.classes)).toEqual([["queue"]])
  })

  it("reports an allowance that forgave fewer than it budgets for", () => {
    // The day the schema starts publishing a target, the landmark lands and
    // the line claiming it cannot has to go — otherwise it sits there
    // absorbing a future regression. Same contract as the extractor's
    // corrections, which throw when they match nothing.
    const out = applyAbsenceAllowances([missing(["blt"], 0)], { blt: 5 })
    expect(out.unexplained).toEqual([])
    expect(out.stale).toEqual([{ landmark: "blt", budgeted: 5, used: 1 }])
  })

  it("keys on the WHOLE class list, so a compound landmark is not forgiven by a part", () => {
    const out = applyAbsenceAllowances([missing(["sec", "blt"], 0)], { blt: 3 })
    expect(out.unexplained).toHaveLength(1)
    expect(out.stale).toEqual([{ landmark: "blt", budgeted: 3, used: 0 }])
  })

  it("leaves style differences alone — they are the rendering pass's", () => {
    const style: Difference = {
      kind: "style",
      order: 1,
      classes: ["band"],
      property: "color",
      prototype: "a",
      ours: "b",
    }
    expect(applyAbsenceAllowances([style], {})).toEqual({ unexplained: [], stale: [] })
  })
})

describe("the Overview manifest entry accounts for what it cannot render", () => {
  it("is marked counter, carries a baseline, and records every absence with a reason", () => {
    const overview = pageById("overview")
    expect(overview.status).toBe("counter")
    if (overview.status !== "counter") throw new Error("unreachable")
    expect(overview.baseline.desktop).toBeGreaterThan(0)
    expect(overview.baseline.mobile).toBeGreaterThan(0)

    // Every allowance names something, on at least one surface, and says why
    // in more than a word. A blank reason is how "not built yet" gets
    // laundered into "the database has nothing to say".
    for (const a of overview.absentLandmarks ?? []) {
      expect(a.desktop + a.mobile, `${a.landmark} forgives nothing`).toBeGreaterThan(0)
      expect(a.reason.length, `${a.landmark} has no reason`).toBeGreaterThan(80)
    }
  })

  it("asks for the window the prototype's own date control opens in", () => {
    // Without it, `Chart`'s single-reading degrade — which is the prototype's
    // own `chart()` behaviour — reports as a missing `.ch` plus an extra
    // `.strip`, for a rule behaving identically on both sides.
    expect(pageById("overview").query).toBe("?range=d7&cmp=weekday")
  })
})

describe("the P&L manifest entry accounts for what it cannot render", () => {
  it("is gated, with the baseline both surfaces actually measured", () => {
    // Ruling F-R4 makes `baseline` a type requirement of `status: "counter"`,
    // so `tsc` already refuses a page declared done without a floor. What it
    // cannot check is whether the numbers were MEASURED. These two are: desk
    // 43 of the prototype's 51, phone 21 of 21 — the first surface in this
    // project that matches the prototype landmark for landmark.
    const pnl = pageById("pnl")
    expect(pnl.status).toBe("counter")
    if (pnl.status !== "counter") throw new Error("unreachable")
    expect(pnl.baseline).toEqual({ desktop: 43, mobile: 21 })
  })

  it("forgives exactly the desk's eight absences, and nothing on the phone", () => {
    // The phone budget being EMPTY is the assertion worth having. An absence
    // allowance that forgives a landmark which in fact lands fails as stale,
    // so a `mobile: 1` written "to be safe" would turn a complete surface red
    // — and a `mobile` count written on a surface that never had the landmark
    // would be a false absence, which never goes stale and quietly stops the
    // gate asking. `P.pnl.phone()` composes none of these, so every entry is
    // `mobile: 0` and `absenceBudget` drops them all.
    const pnl = pageById("pnl")
    expect(absenceBudget(pnl, "desk")).toEqual({ blt: 1, gap: 1, btnrow: 2, btn: 4 })
    expect(absenceBudget(pnl, "phone")).toEqual({})

    // 43 rendered + 8 forgiven = the prototype's 51. If that ever stops
    // adding up, either the page grew a landmark or an allowance is stale.
    const forgiven = Object.values(absenceBudget(pnl, "desk")).reduce((a, b) => a + b, 0)
    if (pnl.status !== "counter") throw new Error("unreachable")
    expect(pnl.baseline.desktop + forgiven).toBe(51)
  })
})

describe("the two Orders manifest entries are gated on what they measured", () => {
  it("is gated on both surfaces, with the counts the suite actually reported", () => {
    // Desk 10 of the prototype's 10, phone 5 of 5 — the first PAGE in this
    // project whose two surfaces both match the prototype landmark for
    // landmark, with nothing missing and nothing extra.
    const orders = pageById("orders")
    expect(orders.status).toBe("counter")
    if (orders.status !== "counter") throw new Error("unreachable")
    expect(orders.baseline).toEqual({ desktop: 10, mobile: 5 })

    const order = pageById("order")
    expect(order.status).toBe("counter")
    if (order.status !== "counter") throw new Error("unreachable")
    expect(order.baseline).toEqual({ desktop: 20, mobile: 12 })
  })

  it("forgives NOTHING on either page, on either surface", () => {
    // The plan budgeted `.blt`, `.band` and `.sp` under every strip cell on
    // both pages, reasoning that no per-order target is published. The
    // reasoning holds and the conclusion did not: `P.orders.desk()` and
    // `P.order.desk()` pass no reference to `strip()` either, so the meter is
    // absent from BOTH sides and there is nothing to forgive. An allowance
    // written anyway would have failed on its first run as stale — which is
    // exactly what that rule is for.
    for (const id of ["orders", "order"]) {
      expect(pageById(id).absentLandmarks ?? []).toEqual([])
      expect(absenceBudget(pageById(id), "desk")).toEqual({})
      expect(absenceBudget(pageById(id), "phone")).toEqual({})
    }
  })

  it("names a real order rather than the prototype's invented #4821", () => {
    // The prototype's route is `/dashboard/orders/4821`; ours must be an id
    // this database holds, or the page 404s and the gate reports a design
    // difference about a page that never loaded.
    const order = pageById("order")
    expect(order.protoRoute).toBe("/dashboard/orders/4821")
    expect(order.route).not.toBe(order.protoRoute)
    expect(order.route).toMatch(
      /^\/dashboard\/orders\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
    // The phone lands on the same order through the middleware's rewrite, so
    // the two routes must name the SAME id — a mismatch would compare two
    // different orders and call the difference a design finding.
    expect(order.mobileRoute).toBe(order.route.replace("/dashboard/", "/m/"))
  })

  it("asks for no window, because neither page has one to ask for", () => {
    // Overview and the P&L pass `?range=d7&cmp=weekday` so their day series
    // are not degraded to a strip by our one-day default. Orders' only chart
    // is hourly and the order detail is `nodate` on both sides, so both pages
    // are compared at their own defaults.
    expect(pageById("orders").query).toBeUndefined()
    expect(pageById("order").query).toBeUndefined()
  })
})

describe("every gated page carries a floor and a written reason for each absence", () => {
  // The same three things the Overview entry has always been checked for,
  // asserted over the whole manifest rather than page by page — so the next
  // page to flip to "counter" inherits the check instead of needing a
  // hand-written copy of it that someone forgets to add.
  const gated = PAGES.filter((p) => p.status === "counter")

  it("has every page gated so far, in manifest order", () => {
    // Manifest order, which is the prototype's own page order — not the order
    // they were gated in. `decisions` and `alerts` joined on 2026-08-27, which
    // is why they sit between Overview and Orders rather than at the end.
    // `analytics` and `analyticsstore` joined the same day and are further
    // apart than they read: the manifest keeps the prototype's rail order for
    // the group pages and its own tail for the per-store ones, so the store
    // page sits after `pnl` rather than beside its own group page.
    expect(gated.map((p) => p.protoId)).toEqual([
      "overview",
      "decisions",
      "alerts",
      "orders",
      "order",
      "analytics",
      "pnl",
      "cogs",
      "menu",
      "labor",
      "menuhub",
      "catalog",
      "catalogitem",
      "productmix",
      "invoices",
      "analyticsstore",
      "laborstore",
      "cogsstore",
    ])
  })

  for (const page of gated) {
    it(`${page.protoId}: a positive floor on both surfaces, and no blank reasons`, () => {
      if (page.status !== "counter") throw new Error("unreachable")
      expect(page.baseline.desktop).toBeGreaterThan(0)
      expect(page.baseline.mobile).toBeGreaterThan(0)

      // Every allowance names something, on at least one surface, and says why
      // in more than a word. A blank reason is how "not built yet" gets
      // laundered into "the database has nothing to say".
      for (const a of page.absentLandmarks ?? []) {
        expect(a.desktop + a.mobile, `${a.landmark} forgives nothing`).toBeGreaterThan(0)
        expect(a.reason.length, `${a.landmark} has no reason`).toBeGreaterThan(80)
      }
    })
  }
})

describe("TOKEN_CORRECTIONS — the colours this app moved on purpose", () => {
  it("forgives the recorded pair, on a colour property, and nothing else", () => {
    const [c] = TOKEN_CORRECTIONS
    const proto = [lm(["band"], { order: 0, style: { color: c.prototype } })]
    const ours = [lm(["band"], { order: 0, style: { color: c.ours } })]
    expect(compareLandmarks(proto, ours)).toEqual([])

    // The SAME strings on a property that is not a colour are still a
    // difference — a correction is about a token's value, not a spelling.
    expect(isTokenCorrection("font-size", c.prototype, c.ours)).toBe(false)
    expect(isTokenCorrection("color", c.prototype, c.ours)).toBe(true)
    // And it is a pair, not a tolerance: our value against some OTHER
    // prototype colour is reported.
    expect(isTokenCorrection("color", "oklch(0.47 0.012 45)", c.ours)).toBe(false)
    expect(isTokenCorrection("color", c.prototype, "oklch(0.47 0.012 45)")).toBe(false)
  })

  it("still reports a landmark where anything ELSE differs", () => {
    const [c] = TOKEN_CORRECTIONS
    const proto = [lm(["band"], { order: 0, style: { color: c.prototype } })]
    const ours = [
      lm(["band"], { order: 0, style: { color: c.ours, "font-size": "11px" } }),
    ]
    expect(compareLandmarks(proto, ours).map((d) => d.property)).toEqual(["font-size"])
  })

  it("describes what counter.css and the prototype ACTUALLY declare", () => {
    // A correction that has stopped matching either source is forgiving a
    // colour nobody renders — the same failure `applyCorrections` throws on in
    // the extractor. Both sides are read back out of the files here so the
    // table cannot go stale in silence.
    const counterCss = readFileSync(
      join(process.cwd(), "src", "styles", "counter.css"),
      "utf-8",
    )
    const proto = readFileSync(
      join(process.cwd(), "docs", "counter", "counter-prototype.html"),
      "utf-8",
    )
    const near = (a: string, b: string) => {
      const x = parse(a)
      const y = parse(b)
      if (!x || !y) throw new Error(`unparseable colour: ${a} / ${b}`)
      const cx = converter("oklch")(x)
      const cy = converter("oklch")(y)
      return (
        Math.abs((cx.l ?? 0) - (cy.l ?? 0)) < 1e-6 &&
        Math.abs((cx.c ?? 0) - (cy.c ?? 0)) < 1e-6 &&
        Math.abs((cx.h ?? 0) - (cy.h ?? 0)) < 1e-6
      )
    }

    for (const c of TOKEN_CORRECTIONS) {
      // Ours: the LIGHT half of the light-dark() pair in counter.css. The
      // rendering pass runs in light.
      const declared = counterCss.match(
        new RegExp(`${c.token}:\\s*light-dark\\(\\s*([^,]+?)\\s*,`),
      )
      expect(declared, `${c.token} is not declared in counter.css`).not.toBeNull()
      expect(near(declared![1], c.ours), `${c.token}: counter.css declares ${declared![1]}, the table says ${c.ours}`).toBe(true)

      // Theirs: the same token name, unprefixed, in the prototype's own
      // `.frame` block.
      const theirs = proto.match(new RegExp(`${c.token.replace("--ct-", "--")}:\\s*([^;]+);`))
      expect(theirs, `${c.token} has no counterpart in the prototype`).not.toBeNull()
      expect(near(theirs![1], c.prototype), `${c.token}: the prototype declares ${theirs![1]}, the table says ${c.prototype}`).toBe(true)

      // A correction that agreed with the prototype would forgive nothing and
      // should be deleted rather than left sitting there.
      expect(near(c.prototype, c.ours), `${c.token} no longer diverges`).toBe(false)
    }
  })
})

/* -------------------------------------------------------------------------
   Pass 3. Dark is never compared to the prototype: its application tokens are
   light-only, it carries 35 inherited colour literals, and its own
   `.qbtn[aria-pressed="true"]` paints var(--ink) — near-white in dark —
   behind a hardcoded light grey. A gate comparing dark against it would call
   that invisible text a perfect match.
   ---------------------------------------------------------------------- */

const INK_DARK = "oklch(0.93 0.006 60)"
const PAPER_DARK = "oklch(0.19 0.008 55)"
const TOKENS = [INK_DARK, PAPER_DARK]

function themed(over: Partial<ThemedNode> = {}): ThemedNode {
  return {
    order: 0,
    classes: ["strip"],
    within: "",
    colours: [
      { property: "color", value: INK_DARK, rgb: { r: 232, g: 230, b: 226 } },
      { property: "background-color", value: PAPER_DARK, rgb: { r: 26, g: 24, b: 22 } },
    ],
    ownText: "NET SALES",
    fontSizePx: 13,
    fontWeight: 400,
    surface: { r: 26, g: 24, b: 22 },
    ...over,
  }
}

describe("findThemeDefects", () => {
  it("passes a landmark whose colours all come from --ct-* tokens", () => {
    expect(findThemeDefects([themed()], TOKENS)).toEqual([])
  })

  it("reports a colour that does not resolve through a token", () => {
    // The inherited-literal case: it will not move when the theme does.
    const defects = findThemeDefects(
      [
        themed({
          colours: [
            { property: "color", value: "rgb(216, 216, 216)", rgb: { r: 216, g: 216, b: 216 } },
            { property: "background-color", value: PAPER_DARK, rgb: { r: 26, g: 24, b: 22 } },
          ],
        }),
      ],
      TOKENS,
    )
    expect(defects).toContainEqual(
      expect.objectContaining({ kind: "literal", property: "color" }),
    )
  })

  it("reports a defect on an element that is NOT itself a landmark", () => {
    // `.qbtn .n` — the element the whole dark pass was written for — carries
    // no landmark class. Before fix round 1 the sweep only looked at elements
    // that did, so this defect was unreachable by the check named after it.
    const defects = findThemeDefects(
      [
        themed({
          classes: ["sec"],
          within: ".qbtn .n",
          colours: [{ property: "color", value: "oklch(0.78 0.01 55)", rgb: { r: 199, g: 194, b: 189 } }],
          ownText: "12",
        }),
      ],
      TOKENS,
    )
    expect(defects).toContainEqual(
      expect.objectContaining({ kind: "literal", within: ".qbtn .n", classes: ["sec"] }),
    )
    expect(defectWhere(defects[0])).toBe(".sec -> .qbtn .n")
  })

  it("names an element with no landmark ancestor rather than dropping it", () => {
    const defects = findThemeDefects(
      [
        themed({
          order: -1,
          classes: [],
          within: ".pagehead .sub",
          colours: [{ property: "color", value: "rgb(216, 216, 216)", rgb: { r: 216, g: 216, b: 216 } }],
          ownText: "12 days to Aug 25",
        }),
      ],
      TOKENS,
    )
    expect(defects).toHaveLength(1)
    expect(defectWhere(defects[0])).toBe("(outside any landmark) -> .pagehead .sub")
  })

  it("reports text that loses its contrast against the surface it sits on", () => {
    // .qbtn[aria-pressed="true"] in dark: background var(--ink) (near-white),
    // child .n a hardcoded light grey. Both are "tokens" as far as the literal
    // check goes if the grey happens to match one; the contrast check is what
    // actually catches it.
    const nearWhite = { r: 232, g: 230, b: 226 }
    const lightGrey = "oklch(0.86 0.004 60)"
    const defects = findThemeDefects(
      [
        themed({
          classes: ["qitem"],
          colours: [{ property: "color", value: lightGrey, rgb: { r: 214, g: 212, b: 208 } }],
          surface: nearWhite,
        }),
      ],
      [...TOKENS, lightGrey],
    )
    expect(defects).toContainEqual(expect.objectContaining({ kind: "contrast" }))
  })

  it("does not ask large text for small text's contrast", () => {
    expect(requiredContrast(13, 400)).toBe(4.5)
    expect(requiredContrast(28, 400)).toBe(3)
    expect(requiredContrast(20, 700)).toBe(3)
  })

  it("throws rather than passing when there are no landmarks to check", () => {
    expect(() => findThemeDefects([], TOKENS)).toThrow(/no landmarks/i)
  })

  it("throws rather than calling every colour a literal when the token sweep is empty", () => {
    expect(() => findThemeDefects([themed()], [])).toThrow(/token/i)
  })
})

describe("contrast maths", () => {
  const white = { r: 255, g: 255, b: 255 }
  const black = { r: 0, g: 0, b: 0 }

  it("agrees with WCAG on the extremes", () => {
    expect(contrastRatio(white, black)).toBeCloseTo(21, 5)
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5)
    expect(relativeLuminance(white)).toBeCloseTo(1, 5)
    expect(relativeLuminance(black)).toBeCloseTo(0, 5)
  })

  it("agrees with WCAG on mid-tones, where the transfer function actually matters", () => {
    // The extremes are the ONE place a wrong decode still looks right: with
    // `return s` in place of the piecewise sRGB curve, black-on-white is still
    // 21:1 and white-on-white is still 1:1, so every other case in this file
    // stayed green when that curve was mutated. A wrong transfer function
    // shifts every real ratio, and text sitting near the 4.5:1 floor flips
    // either way — which is precisely the text this gate is meant to protect.
    //
    // #767676 on white is the canonical AA-boundary grey: 4.542:1 correctly
    // decoded (luminance 0.1812), 2.048:1 with the curve replaced by the
    // identity (luminance 0.4627).
    const grey767676 = { r: 118, g: 118, b: 118 }
    expect(contrastRatio(grey767676, white)).toBeCloseTo(4.5422, 3)
    expect(relativeLuminance(grey767676)).toBeCloseTo(0.1812, 4)

    // A second pair, further from the boundary and on a dark surface, so the
    // assertion is not one lucky point: 6.770:1 correct, 4.665:1 identity.
    const paleGrey = { r: 160, g: 160, b: 160 }
    const darkPaper = { r: 26, g: 24, b: 22 }
    expect(contrastRatio(paleGrey, darkPaper)).toBeCloseTo(6.7703, 3)
  })

  it("puts #767676 on white on the correct side of the AA floor", () => {
    // 4.542 clears 4.5 for small text — barely, which is the point. Under the
    // identity decode it reads 2.05 and this text would be failed. The gate
    // has to agree with WCAG here or it fails real pages and passes invisible
    // ones.
    const grey767676 = { r: 118, g: 118, b: 118 }
    expect(contrastRatio(grey767676, white)).toBeGreaterThan(requiredContrast(13, 400))
    expect(contrastRatio(grey767676, white)).toBeLessThan(5)
  })
})

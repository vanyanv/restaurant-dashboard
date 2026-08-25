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

import {
  CHECKED_PROPERTIES,
  compareLandmarks,
  contrastRatio,
  findThemeDefects,
  landmarkTally,
  matchedCount,
  relativeLuminance,
  requiredContrast,
  type Landmark,
  type ThemedLandmark,
} from "../../e2e/fidelity/landmarks"

/** A landmark carrying the prototype's own Overview values, so a fixture reads like a real render. */
function lm(classes: string[], over: Partial<Landmark> = {}): Landmark {
  const base: Record<string, string> = {}
  for (const p of CHECKED_PROPERTIES) base[p] = DEFAULT_STYLE[p] ?? "normal"
  const { style: styleOver, ...rest } = over
  return {
    order: 0,
    classes,
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

function themed(over: Partial<ThemedLandmark> = {}): ThemedLandmark {
  return {
    order: 0,
    classes: ["strip"],
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
  it("agrees with WCAG on the extremes", () => {
    const white = { r: 255, g: 255, b: 255 }
    const black = { r: 0, g: 0, b: 0 }
    expect(contrastRatio(white, black)).toBeCloseTo(21, 5)
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5)
    expect(relativeLuminance(white)).toBeCloseTo(1, 5)
    expect(relativeLuminance(black)).toBeCloseTo(0, 5)
  })
})

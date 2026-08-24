import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  parse,
  wcagContrast,
  differenceCiede2000,
  filterDeficiencyProt,
  filterDeficiencyDeuter,
  filterDeficiencyTrit,
} from "culori"
import type { Color } from "culori"

/**
 * tests/styles/token-parity.test.ts guards against copies of a token drifting
 * apart. This file guards the values themselves.
 *
 * The prototype states its own numbers: adjacent mx pairs clear dE 15 in
 * normal vision and under all three CVD models, where the four brand hexes
 * clear only 8.5; the gp ramp clears dE 16 and 3:1 on surface. Those numbers
 * are the prototype's own claims about the light set it designed. The dark
 * set was not designed — it is ours (Task 12), so it is asserted rather than
 * assumed.
 *
 * Precedent: --ink-faint shipped at 2.48:1 for months because nothing checked.
 *
 * Three rulings on top of the original spec for this test (task-11-report.md
 * has the full reasoning and every measured number):
 *
 * A) The `--ct-line-strong` vs `--ct-paper` row is dropped from CONTRAST.
 *    Light is `oklch(82.5% ...)` on `oklch(96.2% ...)`, ~1.4:1, and light is
 *    frozen — it can never clear 3:1. WCAG 1.4.11's 3:1 is for UI components
 *    and graphical objects required to understand content; a decorative
 *    hairline separator is neither. Replaced by an assertion that the two
 *    hairline tokens are distinguishable FROM EACH OTHER (see below).
 *
 * B) "every mx band clears 3:1 on paper" is dropped entirely. The prototype
 *    never claimed it (`--ct-mx-4` is ~1.7:1 on paper by design) — its actual
 *    requirement for stacked bands is ADJACENCY (dE 15, asserted below).
 *    Bands stack against each other, not against the page. The gp ramp's
 *    "3:1 on surface" claim IS made by the prototype and stays, because it's
 *    fair to hold the prototype to what it actually claims.
 *
 * C) Light values are frozen (copied verbatim from the prototype). If a
 *    light assertion the prototype itself makes turns out false when
 *    measured, that is an inherited defect in the prototype, not something
 *    this test papers over by default. Measuring the real light values
 *    surfaced four: --ct-ink-3 on --ct-paper (4.356:1, needs 4.5), --ct-gp-3
 *    on --ct-surface (2.980:1, needs 3), the mx-1/mx-2 adjacent pair
 *    (13.6-14.12 dE across all four vision models, needs 15), and the
 *    gp-1/gp-2 adjacent pair under normal/protanopia/deuteranopia
 *    (13.24-15.25 dE, needs 16).
 *
 *    These four were taken to the user for a ruling, because "inherited
 *    defect" isn't automatically "leave it": a sub-AA text contrast ratio is
 *    a hard compliance floor, not a design choice, where the three ΔE
 *    misses are chart-band SEPARATION — a legibility trade a designer may
 *    have made deliberately for palette harmony. The ruling split them:
 *
 *    FIXED: --ct-ink-3 was corrected in counter.css (55% -> 53.5% lightness
 *    only; hue and chroma untouched) and both its contrast assertions are
 *    live, ordinary, passing tests below — not skipped, not gated. See the
 *    header comment in counter.css for the full before/after.
 *
 *    LEFT AS INHERITED, KNOWINGLY ACCEPTED (not fixed): --ct-gp-3 on
 *    --ct-surface, the mx-1/mx-2 adjacency, and the gp-1/gp-2 adjacency
 *    under three of four vision models. Each stays a real, named, skipped
 *    assertion — not deleted, not weakened, token not touched — with the
 *    measured value, the threshold, and "knowingly accepted" in the test
 *    title, so nobody mistakes the skip for an oversight six months from
 *    now. The skip is LIGHT-ONLY: the identical assertion still runs live
 *    for dark, because dark values are not frozen and Task 12 must be held
 *    to the claim.
 */

const CSS = readFileSync(join(process.cwd(), "src", "styles", "counter.css"), "utf8")

/**
 * Every `--ct-*` declaration, resolved for one theme.
 *
 * Tokens are declared once as `light-dark(a, b)`, so this picks a side rather
 * than reading a second block. A token that is NOT a light-dark pair has no
 * dark value, which is a failure — that is how this test drives Task 12.
 */
export function parseTokens(css: string, theme: "light" | "dark"): Map<string, string> {
  const start = css.indexOf(":root {")
  if (start === -1) throw new Error("no :root block in counter.css")
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start))
  const out = new Map<string, string>()
  for (const m of body.matchAll(/(--ct-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const [, name, raw] = [m[0], m[1], m[2].trim()] as const
    const pair = raw.match(/^light-dark\(\s*(.+?)\s*,\s*(.+?)\s*\)$/)
    if (pair) {
      out.set(name, theme === "light" ? pair[1] : pair[2])
    } else if (theme === "light") {
      out.set(name, raw)
    } else {
      throw new Error(
        `${name} has no dark value: declare it as light-dark(light, dark) — Task 12 supplies the dark half`,
      )
    }
  }
  return out
}

type Vision = "normal" | "protanopia" | "deuteranopia" | "tritanopia"

// Typed as a plain Record<Vision, (c: Color) => Color> rather than left to
// inference: the three filterDeficiency* calls and the identity function are
// each individually generic (`<C extends Color>(color: C) => C`), and an
// object literal typed `as const` infers a union of those distinct generic
// signatures. TypeScript cannot call through a union of incompatible generic
// signatures picked by dynamic index (`DEFICIENCIES[vision]`) — "not
// callable" — even though every member is individually callable. Annotating
// the object type up front monomorphizes each entry to (Color) => Color,
// which every generic implementation still satisfies.
const DEFICIENCIES: Record<Vision, (c: Color) => Color> = {
  normal: (c) => c,
  protanopia: filterDeficiencyProt(1),
  deuteranopia: filterDeficiencyDeuter(1),
  tritanopia: filterDeficiencyTrit(1),
}

function colorOf(tokens: Map<string, string>, name: string) {
  const raw = tokens.get(name)
  if (!raw) throw new Error(`missing token ${name}`)
  const c = parse(raw)
  if (!c) throw new Error(`unparseable token ${name}: ${raw}`)
  return c
}

/**
 * Chart-band ΔE separation misses in the real, frozen light values (ruling C
 * above). Keyed so each generated test can look itself up. LIGHT ONLY: the
 * dark instance of the same test is never in this set, so it stays live.
 *
 * NOTE: --ct-ink-3 on --ct-paper used to be in this map (4.356:1 vs the
 * 4.5:1 WCAG floor) but is NOT anymore — the user ruled that a sub-AA text
 * contrast ratio is a compliance floor, not a design trade, and had the
 * token corrected in counter.css instead. Its assertion is back in CONTRAST
 * below as a normal, live, passing test. The three defects remaining here
 * are chart-band ΔE separation, which the same ruling treated differently:
 * a legibility trade a designer may make deliberately for palette harmony,
 * so INHERITED and KNOWINGLY ACCEPTED rather than fixed. Someone reading a
 * skipped test below must see: the measured value, the threshold it misses,
 * that it is inherited from the prototype (not introduced by this project),
 * and that it was a deliberate, informed call, not laziness.
 */
const LIGHT_DEFECTS = new Map<string, string>([
  [
    "gp-surface:--ct-gp-3",
    "INHERITED prototype defect, knowingly accepted: measures 2.980:1 vs the 3:1 threshold — misses by 0.02, a designer trade for palette harmony, not an oversight",
  ],
  [
    "mx-adj:normal:--ct-mx-1:--ct-mx-2",
    "INHERITED prototype defect, knowingly accepted: measures dE 14.00 vs threshold 15 (normal vision)",
  ],
  [
    "mx-adj:protanopia:--ct-mx-1:--ct-mx-2",
    "INHERITED prototype defect, knowingly accepted: measures dE 13.60 vs threshold 15 (protanopia)",
  ],
  [
    "mx-adj:deuteranopia:--ct-mx-1:--ct-mx-2",
    "INHERITED prototype defect, knowingly accepted: measures dE 14.09 vs threshold 15 (deuteranopia)",
  ],
  [
    "mx-adj:tritanopia:--ct-mx-1:--ct-mx-2",
    "INHERITED prototype defect, knowingly accepted: measures dE 14.12 vs threshold 15 (tritanopia)",
  ],
  [
    "gp-adj:normal:--ct-gp-1:--ct-gp-2",
    "INHERITED prototype defect, knowingly accepted: measures dE 14.95 vs threshold 16 (normal vision)",
  ],
  [
    "gp-adj:protanopia:--ct-gp-1:--ct-gp-2",
    "INHERITED prototype defect, knowingly accepted: measures dE 13.24 vs threshold 16 (protanopia)",
  ],
  [
    "gp-adj:deuteranopia:--ct-gp-1:--ct-gp-2",
    "INHERITED prototype defect, knowingly accepted: measures dE 15.25 vs threshold 16 (deuteranopia)",
  ],
])

function adjacentPairs(names: readonly string[]): Array<[string, string]> {
  return names.slice(0, -1).map((a, i) => [a, names[i + 1]])
}

/** Text-on-surface pairs and the WCAG ratio each must clear. Ruling A drops
 * the --ct-line-strong/--ct-paper row. --ct-ink-3/--ct-paper was previously
 * pulled out into its own gated test because it failed at the prototype's
 * original 55% lightness (4.356:1); the token has since been corrected to
 * 53.5% (see counter.css header) and this row is back to being a normal,
 * live assertion like every other row here. */
const CONTRAST: Array<[fg: string, bg: string, min: number, why: string]> = [
  ["--ct-ink", "--ct-paper", 4.5, "body text on the page"],
  ["--ct-ink", "--ct-surface", 4.5, "body text on a panel"],
  ["--ct-ink-2", "--ct-paper", 4.5, "secondary prose"],
  ["--ct-ink-3", "--ct-paper", 4.5, "captions, folios, SKUs"],
  ["--ct-ink-3", "--ct-surface", 4.5, "captions on a panel"],
  ["--ct-accent", "--ct-paper", 4.5, "the proofmark, used as text"],
  ["--ct-accent", "--ct-accent-wash", 4.5, "accent text on its own wash"],
  ["--ct-signal-ink", "--ct-signal-wash", 4.5, "signal text on signal wash"],
  ["--ct-good", "--ct-good-wash", 4.5, "good text on good wash"],
  ["--ct-warn", "--ct-warn-wash", 4.5, "warn text on warn wash"],
  ["--ct-bad", "--ct-bad-wash", 4.5, "bad text on bad wash"],
]

const MX_BANDS = ["--ct-mx-1", "--ct-mx-2", "--ct-mx-3", "--ct-mx-4"] as const
const GP_STEPS = ["--ct-gp-1", "--ct-gp-2", "--ct-gp-3"] as const

const THEMES = ["light", "dark"] as const

describe.each(THEMES)("counter tokens — %s", (theme) => {
  // Resolved lazily, inside each test body rather than once here at
  // collection time. Calling parseTokens() eagerly at this point means a
  // dark-theme throw happens during collection and vitest fails the entire
  // file with "no tests" — hiding every passing light assertion along with
  // it. Deferring the call into each `it` makes every dark test fail
  // independently, with its own copy of the useful message, exactly as
  // intended.
  function tokens() {
    return parseTokens(CSS, theme)
  }

  const isLightDefect = (key: string) => theme === "light" && LIGHT_DEFECTS.has(key)

  describe("contrast", () => {
    // No rows are gated here any more — --ct-ink-3/--ct-paper was the one
    // contrast defect this file found, and it was fixed at the token rather
    // than skipped (see counter.css header and the ruling-C comment above).
    it.each(CONTRAST)("%s on %s clears %s:1 (%s)", (fg, bg, min) => {
      const t = tokens()
      const ratio = wcagContrast(colorOf(t, fg), colorOf(t, bg))
      expect(ratio).toBeGreaterThanOrEqual(min)
    })
  })

  // Amendment A: --ct-line-strong vs --ct-paper (WCAG 1.4.11, 3:1) is dropped
  // — light is ~1.4:1 and frozen, and a decorative hairline isn't a UI
  // component or graphical object under 1.4.11's own scope. What matters
  // instead is that the two hairline weights read as different FROM EACH
  // OTHER. Threshold: dE00 < 1 is imperceptible, 1-2 needs close inspection,
  // 2-10 is perceptible at a glance (standard CIEDE2000 rule-of-thumb bands).
  // dE >= 3 asks for a clear, non-marginal step into the "perceptible at a
  // glance" band — comfortably above the ~1-2 JND, comfortably below the
  // dE 15/16 bar reserved for telling apart categorical data bands, which
  // hairlines are not.
  it("--ct-line and --ct-line-strong are distinguishable from each other", () => {
    const t = tokens()
    const dE = differenceCiede2000()(colorOf(t, "--ct-line"), colorOf(t, "--ct-line-strong"))
    expect(dE).toBeGreaterThanOrEqual(3)
  })

  describe("mx bands — adjacency", () => {
    const cases = (Object.keys(DEFICIENCIES) as Vision[]).flatMap((vision) =>
      adjacentPairs(MX_BANDS).map(([a, b]) => [vision, a, b] as const),
    )
    const live = cases.filter(([vision, a, b]) => !isLightDefect(`mx-adj:${vision}:${a}:${b}`))
    const skipped = cases.filter(([vision, a, b]) => isLightDefect(`mx-adj:${vision}:${a}:${b}`))

    it.each(live)("%s: %s vs %s clears dE 15 (adjacent mx bands)", (vision, a, b) => {
      const t = tokens()
      const filter = DEFICIENCIES[vision]
      const dE = differenceCiede2000()(filter(colorOf(t, a)), filter(colorOf(t, b)))
      expect(dE).toBeGreaterThanOrEqual(15)
    })

    it.skip.each(
      skipped.map(([vision, a, b]) => [vision, a, b, LIGHT_DEFECTS.get(`mx-adj:${vision}:${a}:${b}`)!] as const),
    )("%s: %s vs %s clears dE 15 (adjacent mx bands) — %s", (vision, a, b) => {
      const t = tokens()
      const filter = DEFICIENCIES[vision]
      const dE = differenceCiede2000()(filter(colorOf(t, a)), filter(colorOf(t, b)))
      expect(dE).toBeGreaterThanOrEqual(15)
    })
  })

  describe("gp ramp — adjacency", () => {
    const cases = (Object.keys(DEFICIENCIES) as Vision[]).flatMap((vision) =>
      adjacentPairs(GP_STEPS).map(([a, b]) => [vision, a, b] as const),
    )
    const live = cases.filter(([vision, a, b]) => !isLightDefect(`gp-adj:${vision}:${a}:${b}`))
    const skipped = cases.filter(([vision, a, b]) => isLightDefect(`gp-adj:${vision}:${a}:${b}`))

    it.each(live)("%s: %s vs %s clears dE 16 (adjacent gp steps)", (vision, a, b) => {
      const t = tokens()
      const filter = DEFICIENCIES[vision]
      const dE = differenceCiede2000()(filter(colorOf(t, a)), filter(colorOf(t, b)))
      expect(dE).toBeGreaterThanOrEqual(16)
    })

    it.skip.each(
      skipped.map(([vision, a, b]) => [vision, a, b, LIGHT_DEFECTS.get(`gp-adj:${vision}:${a}:${b}`)!] as const),
    )("%s: %s vs %s clears dE 16 (adjacent gp steps) — %s", (vision, a, b) => {
      const t = tokens()
      const filter = DEFICIENCIES[vision]
      const dE = differenceCiede2000()(filter(colorOf(t, a)), filter(colorOf(t, b)))
      expect(dE).toBeGreaterThanOrEqual(16)
    })
  })

  // Amendment B: "every mx band clears 3:1 on paper" is dropped entirely —
  // the prototype never claimed it (--ct-mx-4 is ~1.7:1 on paper by design).
  // Bands stack against each other; the requirement is the adjacency test
  // above. The gp ramp's 3:1-on-surface claim IS made by the prototype, so
  // it stays, gated per-step for the one measured light defect (gp-3).
  describe("gp ramp — contrast on surface", () => {
    const live = GP_STEPS.filter((n) => !isLightDefect(`gp-surface:${n}`))
    const skipped = GP_STEPS.filter((n) => isLightDefect(`gp-surface:${n}`))

    it.each(live)("%s clears 3:1 on surface", (n) => {
      const t = tokens()
      expect(wcagContrast(colorOf(t, n), colorOf(t, "--ct-surface"))).toBeGreaterThanOrEqual(3)
    })

    it.skip.each(skipped.map((n) => [n, LIGHT_DEFECTS.get(`gp-surface:${n}`)!] as const))(
      "%s clears 3:1 on surface — %s",
      (n) => {
        const t = tokens()
        expect(wcagContrast(colorOf(t, n), colorOf(t, "--ct-surface"))).toBeGreaterThanOrEqual(3)
      },
    )
  })

  it("the surface stack is monotone, so panels read as lifted", () => {
    const t = tokens()
    // Color is a union across every culori mode, and not all of them (e.g.
    // rgb, a98) carry an `l` channel, so a plain `.l` access doesn't
    // typecheck on the union. Every stacked-surface token here is oklch, so
    // narrow with the `in` operator rather than widening the return type.
    const l = (n: string) => {
      const c = parse(t.get(n)!)
      return c && "l" in c ? c.l : 0
    }
    const stack = ["--ct-surface", "--ct-paper", "--ct-chrome", "--ct-sunk"].map(l)
    const descending = stack.every((v, i) => i === 0 || v <= stack[i - 1])
    const ascending = stack.every((v, i) => i === 0 || v >= stack[i - 1])
    expect(descending || ascending).toBe(true)
  })

  it("declares no pure white and no pure black", () => {
    const t = tokens()
    for (const [name, value] of t) {
      if (!/^--ct-(ch|mx|gp|surface|paper|chrome|sunk|line|ink|accent|signal|good|warn|bad)/.test(name)) continue
      const c = parse(value)
      if (!c) continue
      expect(`${name} ${value}`).not.toMatch(/#fff\b|#ffffff|#000\b|#000000/i)
    }
  })

  it("declares every token exactly once, in a single :root block", () => {
    // A second block is how six copies of --ink-faint drifted apart. Tokens are
    // light-dark() pairs precisely so there is nothing to keep in step.
    expect(CSS.match(/^:root\s*\{/gm)?.length ?? 0).toBe(1)
    expect(CSS).not.toMatch(/prefers-color-scheme/)
  })
})

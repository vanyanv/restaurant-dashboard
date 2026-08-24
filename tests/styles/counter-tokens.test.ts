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
 *    FIXED: --ct-ink-3 was corrected in counter.css — lightness only, hue
 *    and chroma untouched throughout. Round 1 moved it 55% -> 53.5%, solved
 *    against --ct-paper alone; round 2's ink-token surface audit found it
 *    also renders on --ct-chrome (darker than paper) and still failed
 *    there at 53.5%, so round 3 moved it again, 53.5% -> 52.5%, this time
 *    solved against every surface it actually renders on. Every
 *    --ct-ink-3 contrast assertion below is now live and passing — none
 *    are skipped or gated. See the header comment in counter.css for the
 *    full before/after and the measured ratio on each surface.
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
 * than reading a second block. A token with no light-dark() pair is
 * theme-invariant by construction — Task 12's brief is explicit that the type
 * scale, radii and easing curve stay bare in both themes, not fabricated
 * `light-dark(8px, 8px)` pairs — so this function does NOT treat an unpaired
 * token as an error. It carries the bare value through unchanged for BOTH
 * themes... except that for "dark", carrying a bare value through would be
 * actively wrong for a token that genuinely needs a dark half: it would let
 * a dark-theme colour assertion silently reuse the light colour and report a
 * false pass. So for dark, an unpaired token is left OUT of the map
 * entirely — `.get(name)` returns undefined — and it is `colorOf`, below,
 * that turns "undefined" into a precise, actionable failure for whichever
 * specific token some assertion actually tried to read as a colour. A test
 * that never touches a given token (radius, easing, type scale) never
 * notices it's unpaired, exactly as Task 12's brief requires.
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
    }
    // dark + unpaired: deliberately not set. See doc comment above.
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

/**
 * Resolves a token to a parsed colour, or throws. This is also where the
 * "has no dark value" check now lives (moved out of parseTokens — see its
 * doc comment): a colour token missing from `tokens` might be a genuine typo
 * in this test, or it might be a token that's declared in the CSS but only
 * as a bare, theme-invariant-looking value with no light-dark() dark half —
 * exactly the situation Task 12 exists to fix. Re-parsing the light side
 * here (only on the failure path, so it costs nothing that matters) tells
 * the two apart so the message stays precise either way.
 */
function colorOf(tokens: Map<string, string>, name: string) {
  const raw = tokens.get(name)
  if (!raw) {
    if (parseTokens(CSS, "light").has(name)) {
      throw new Error(
        `${name} has no dark value: declare it as light-dark(light, dark) — Task 12 supplies the dark half`,
      )
    }
    throw new Error(`missing token ${name}`)
  }
  const c = parse(raw)
  if (!c) throw new Error(`unparseable token ${name}: ${raw}`)
  return c
}

/**
 * Known misses against the real, frozen light values (ruling C). Keyed so
 * each generated test can look itself up. LIGHT ONLY: the dark instance of
 * the same test is never in this set, so it stays live.
 *
 * NOTE: --ct-ink-3 is not in this map at all any more. Round 1 fixed it
 * against --ct-paper (55% -> 53.5%); round 2's ink-token surface audit
 * found it also renders on --ct-chrome and still failed there at 53.5%
 * (4.396:1) — chrome is darker than paper, so the first fix didn't reach
 * far enough. Round 3 fixed it again, this time against every surface it
 * actually renders on (53.5% -> 52.5%; --ct-sunk excluded — see the comment
 * by CONTRAST below). All --ct-ink-3 contrast assertions are now normal,
 * live, passing tests, not skipped. See counter.css's header comment for
 * the full before/after and the ramp-compression consequence of a second
 * correction.
 *
 * The three entries remaining here are chart-band ΔE separation misses,
 * which the user's ruling treated differently from a text-contrast floor: a
 * legibility trade a designer may make deliberately for palette harmony, so
 * INHERITED and KNOWINGLY ACCEPTED rather than fixed. Someone reading a
 * skipped test below must see: the measured value, the threshold it
 * misses, that it is inherited from the prototype (not introduced by this
 * project), and that it was a deliberate, informed call, not laziness.
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

/**
 * Text-on-surface pairs and the WCAG ratio each must clear. Ruling A drops
 * the --ct-line-strong/--ct-paper row.
 *
 * --ct-ink-3 has been corrected TWICE (see counter.css header for the full
 * before/after): round 1 fixed it against --ct-paper alone (55% -> 53.5%);
 * round 2's surface audit below found it also renders on --ct-chrome and
 * still failed there at 53.5% (4.396:1, chrome being darker than paper);
 * round 3 fixed it again against every surface it actually renders on
 * (53.5% -> 52.5%). Every --ct-ink-3 row below is now a normal, live,
 * passing assertion — none of them are gated.
 *
 * Fix round 2: audited docs/counter/counter-prototype.html for every
 * surface each of --ct-ink, --ct-ink-2 and --ct-ink-3 actually renders text
 * on (own-background CSS rules, plus BEM/descendant selectors confirmed
 * against the generated HTML), not just the surfaces this table happened to
 * already cover. Every real pairing found is added below.
 *
 * --ct-ink-3 on --ct-sunk was checked and deliberately NOT added: the only
 * --ct-ink-3 text inside a --ct-sunk-background element in the prototype is
 * `.interval .tg` (`.interval{height:32px;background:var(--sunk)}`,
 * `.tg{position:absolute;top:-19px;color:var(--ink-3)}`) — the -19px offset
 * places that label entirely above the 32px bar's own painted box, so what
 * actually renders behind it is whatever sits above the bar (paper or
 * surface, both already covered here), not the sunk fill. Measured anyway
 * so this is a documented decision, not a gap to rediscover and "fix" by
 * darkening the token further: at the current 52.5%, --ct-ink-3 on
 * --ct-sunk is 4.342:1 (would still fail even if the pairing were real).
 * Do not add this row on the assumption it was overlooked.
 *
 * Fix round 4: round 2's audit missed four real pairings — hover/selected
 * table rows and error rows are exactly the places a first pass skips.
 * Added: --ct-ink on --ct-accent-wash (`.tbl tbody tr[data-goto]:hover`,
 * `tr.is-sel`, `tr[data-ln].is-on`, `.wkt tbody tr:hover`/`tr.is-here` —
 * all set `background:var(--accent-wash)` on a row whose `td`s have no own
 * colour and inherit ink; same via `.sh__r .i{color:var(--ink)}` under
 * `.sh__r:hover`/`.sh__r.is-on`); --ct-ink-3 on --ct-accent-wash
 * (`.storeopt[aria-pressed="true"]` overrides only `.storeopt b`, leaving
 * `.storeopt span{color:var(--ink-3)}` on the wash; same via
 * `.sh__r .g{color:var(--ink-3)}`); --ct-ink on --ct-bad-wash
 * (`.tbl tbody tr.is-hole td{background:var(--bad-wash)}` recolours only
 * `.hole`, other cells stay ink; same via a dynamic `.mhead` template);
 * --ct-ink-3 on --ct-bad-wash (`.rowline.is-missing` — neither `.grip` nor
 * `.nm span`, both ink-3, is recoloured).
 *
 * A follow-up targeted sweep of every `*-wash` background reachable via
 * `:hover`/`.is-*`/`[aria-pressed]` (not just the four cited above) found
 * two more, both via a direct child-selector colour declaration that beats
 * an inherited colour from the state-triggering ancestor (CSS specificity
 * doesn't matter here — a rule that targets the child directly always wins
 * over an inherited value, regardless of the ancestor rule's specificity):
 * --ct-ink-2 on --ct-accent-wash (`.stcard[aria-expanded="true"]` overrides
 * only `.car`, leaving `.stcard .d{color:var(--ink-2)}` on the wash) and
 * --ct-ink-2 on --ct-good-wash (`.loginmsg.is-ok` overrides `.fi` and `b`
 * but not `.loginmsg p{color:var(--ink-2)}`; confirmed independently via
 * `.vd.is-fit` overriding only `.vd b`, leaving `.vd span{color:var(--ink-2)}`
 * on the same wash). No ink token pairs with --ct-warn-wash anywhere in the
 * prototype (its one background use, `.statuspill.REVIEW`, recolours its
 * text to --ct-warn, not an ink token) — checked and genuinely absent, not
 * overlooked. No further ink-on-wash/state pairings were found beyond
 * these six plus the ones already listed above.
 */
const CONTRAST: Array<[fg: string, bg: string, min: number, why: string]> = [
  ["--ct-ink", "--ct-paper", 4.5, "body text on the page"],
  ["--ct-ink", "--ct-surface", 4.5, "body text on a panel"],
  ["--ct-ink", "--ct-sunk", 4.5, "e.g. nav/date-picker hover states"],
  ["--ct-ink", "--ct-signal-wash", 4.5, "emphasis inside a signal callout"],
  ["--ct-ink", "--ct-accent-wash", 4.5, "e.g. a hovered/selected table row"],
  ["--ct-ink", "--ct-bad-wash", 4.5, "e.g. a missing-line table row"],
  ["--ct-ink-2", "--ct-paper", 4.5, "secondary prose"],
  ["--ct-ink-2", "--ct-surface", 4.5, "e.g. the channel toggle, the share card"],
  ["--ct-ink-2", "--ct-chrome", 4.5, "e.g. the nav rail's resting label"],
  ["--ct-ink-2", "--ct-sunk", 4.5, "e.g. the segmented control, the compare toggle"],
  ["--ct-ink-2", "--ct-signal-wash", 4.5, "prose inside a signal callout"],
  ["--ct-ink-2", "--ct-bad-wash", 4.5, "prose inside a login error message"],
  ["--ct-ink-2", "--ct-accent-wash", 4.5, "e.g. an expanded store card's detail line"],
  ["--ct-ink-2", "--ct-good-wash", 4.5, "e.g. a fitting-variance note, an OK login message"],
  ["--ct-ink-3", "--ct-paper", 4.5, "captions, folios, SKUs"],
  ["--ct-ink-3", "--ct-surface", 4.5, "captions on a panel"],
  ["--ct-ink-3", "--ct-chrome", 4.5, "e.g. the nav rail's captions, the topbar breadcrumbs"],
  ["--ct-ink-3", "--ct-signal-wash", 4.5, "captions inside a signal callout"],
  ["--ct-ink-3", "--ct-accent-wash", 4.5, "e.g. a pressed store-picker option's caption"],
  ["--ct-ink-3", "--ct-bad-wash", 4.5, "captions in a missing-line row"],
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
    // No CONTRAST rows are gated here any more. --ct-ink-3/--ct-paper was
    // gated in round 1 and fixed at the token instead; round 2 found
    // --ct-ink-3/--ct-chrome also failing and gated that too; round 3 fixed
    // --ct-ink-3 again (52.5%) against every real surface it renders on, so
    // that gate is gone as well. `skipped` stays here, generating zero
    // tests when empty, so the next inherited contrast defect (if any) has
    // a ready-made place to land without restructuring this block again.
    const live = CONTRAST.filter(([fg, bg]) => !isLightDefect(`contrast:${fg}:${bg}`))
    const skipped = CONTRAST.filter(([fg, bg]) => isLightDefect(`contrast:${fg}:${bg}`))

    it.each(live)("%s on %s clears %s:1 (%s)", (fg, bg, min) => {
      const t = tokens()
      const ratio = wcagContrast(colorOf(t, fg), colorOf(t, bg))
      expect(ratio).toBeGreaterThanOrEqual(min)
    })

    it.skip.each(
      skipped.map(([fg, bg, min, why]) => [fg, bg, min, why, LIGHT_DEFECTS.get(`contrast:${fg}:${bg}`)!] as const),
    )("%s on %s clears %s:1 (%s) — %s", (fg, bg, min) => {
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
    // Uses colorOf, which throws on a missing/unparseable/no-dark-value
    // token with a precise message — same as every other assertion in this
    // file. It used to call parse() directly and silently default to
    // lightness 0 on failure, which would turn a missing-token bug into a
    // confusing "stack not monotone" failure instead of the real error.
    const l = (n: string) => {
      const c = colorOf(t, n)
      if (!("l" in c)) throw new Error(`${n} has no lightness channel in mode ${c.mode}`)
      return c.l
    }
    const stack = ["--ct-surface", "--ct-paper", "--ct-chrome", "--ct-sunk"].map(l)
    const descending = stack.every((v, i) => i === 0 || v <= stack[i - 1])
    const ascending = stack.every((v, i) => i === 0 || v >= stack[i - 1])
    expect(descending || ascending).toBe(true)
  })

  it("declares no pure white and no pure black", () => {
    const t = tokens()
    // Iterates the full declared-token universe (from the light side, since
    // every token is declared there regardless of whether it has a dark
    // half yet) rather than `t` itself. For dark, `t` only contains tokens
    // that DO have a light-dark() pair (see parseTokens), so iterating `t`
    // directly would silently skip every colour token Task 12 hasn't
    // reached yet — a vacuous pass with zero assertions run, not a real
    // check. colorOf(t, name) throws its own precise message for whichever
    // token is missing, keeping this test's dark-theme failure as loud and
    // specific as every other assertion here.
    for (const name of parseTokens(CSS, "light").keys()) {
      if (!/^--ct-(ch|mx|gp|surface|paper|chrome|sunk|line|ink|accent|signal|good|warn|bad)/.test(name)) continue
      colorOf(t, name)
      const value = t.get(name)!
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

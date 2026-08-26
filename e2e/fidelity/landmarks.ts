/**
 * The fidelity comparison, as pure functions.
 *
 * This module never touches a DOM or a browser, so `compareLandmarks` and the
 * theme checks can be unit-tested by vitest against hand-written fixtures —
 * see tests/e2e/landmarks.test.ts. The extraction that DOES touch a DOM lives
 * in ./extract.ts, and runs inside the page.
 *
 * WHY THIS EXISTS. `npm run tokens` checks colour literals and status
 * branching. It has no opinion about whether a page matches its design, which
 * is how a Counter Overview shipped with six bordered cards where the
 * prototype has sixteen structural elements, and how that survived seven plans
 * against a permanently green gate. This is the thing that can see it.
 *
 * THE FAILURE MODE THIS MODULE IS BUILT AGAINST. A comparison that finds
 * nothing on *both* sides reports "no differences" and passes forever. A
 * selector typo, a navigation that silently no-opped, an unauthenticated page
 * that redirected to /login — all three produce two empty landmark lists, and
 * a gate that went green over a blank screen would be worse than no gate,
 * because it would be believed. So `compareLandmarks([], [])` THROWS. Do not
 * "fix" that by returning [].
 */

/**
 * The classes that mark a structural element of a Counter page. A landmark is
 * something a reader would name if asked what is on the screen: the dispatch
 * line, the head block, a strip, a section, the queue, the store cards.
 *
 * NOT every class — the prototype has 452 and matching all of them would
 * report a diff for every hover state and every utility. This list is what the
 * page IS.
 *
 * Container/item pairs are deliberate (`queue`/`qitem`, `stores`/`stcard`,
 * `chan`/`chan__row`, `sugs`/`sug`). The count of items is itself a finding:
 * the addendum's "strip of six" against "a four-cell strip" is only visible
 * because the items are counted, not just the box that holds them.
 *
 * Changes from the brief's starting list, all verified by walking all 53
 * prototype pages in both surfaces (scripts note: docs/counter/fidelity/README.md):
 *
 *   - REMOVED "cascade". Not a class. The prototype's `cascade()` (line 5023)
 *     emits `.wf` / `.wf__row`, and `wf` is already on this list. Left in, it
 *     would have been a landmark that can never appear on either side —
 *     silently narrowing the gate while looking like it widened it.
 *   - REMOVED "empt". Not a class either. `bodyEmpty()` emits `.empty`, so
 *     that is what is listed instead — and it is a valuable landmark in the
 *     other direction: our shipped Overview renders grey "not computed" boxes
 *     where the prototype renders content, and those show up as an EXTRA
 *     `.empty` rather than as silence.
 *   - ADDED "stcard". `.stores` is only the container. Prototype note 33 —
 *     "the ledger printed twelve em-dashes and called it a store list. They
 *     are cards now" — is about the cards, and the cards are `.stcard`.
 *   - ADDED the phone set: "mstrip", "mlist", "mhead", "moneyline". The brief's
 *     list was desk-only, so the fidelity-mobile project would have found zero
 *     landmarks on the prototype side of most pages. (It would have thrown
 *     rather than passed — the guard works — but throwing on every mobile page
 *     is not a gate.)
 *   - ADDED "sug", "chan__row", "kv" for the container/item reason above.
 *   - ADDED (fix round 1) "sp", "band", "sec__head", "sec__body", "btnrow",
 *     "btn". Every one of these is named in the addendum's sixteen-element
 *     table and none of them was on the list: "each cell carrying value +
 *     delta + sparkline + bullet meter + band words" is five things, and only
 *     the value, the delta and the bullet (`blt`) were checked. A strip cell
 *     with no `.sp` and no `.band` is missing two of the five things that make
 *     it a Counter figure, and before this it was invisible to the gate.
 *     `.sec__head` / `.sec__body` are a section's own two halves — a section
 *     rendered as a bare box with no head was also invisible — and
 *     `.btnrow` / `.btn` are the row actions ("two actions" in the channel
 *     row, "with a link to it" in the verdict block).
 */
export const LANDMARK_CLASSES = [
  // the head of a page
  "dispatch",
  "headline",
  "fig",
  "say",
  "hfloor",
  // the body
  "strip",
  "sec",
  "moving",
  "askbar",
  "sugs",
  "sug",
  "queue",
  "qitem",
  "stores",
  "stcard",
  "chan",
  "chan__row",
  "cbar",
  "gap",
  "ch",
  "drill",
  "tbl",
  "wkt",
  "blt",
  "mtr",
  "wf",
  "kv",
  // the parts of a figure that make it a Counter figure rather than a number
  "sp",
  "band",
  // a section's own two halves, and the actions a row offers
  "sec__head",
  "sec__body",
  "btnrow",
  "btn",
  // the state the page fell into
  "empty",
  // the phone's own compositions
  "mstrip",
  "mlist",
  "mhead",
  "moneyline",
] as const

export type LandmarkClass = (typeof LANDMARK_CLASSES)[number]

/**
 * The computed properties a fidelity mismatch would actually show up in.
 *
 * Three of these are NORMALISED by the extractor before they get here, because
 * their raw computed values differ for reasons that are not fidelity defects.
 * The normalisation is applied identically to both sides, so it can hide a
 * difference but never invent one:
 *
 *   font-family            -> a role: "display" | "sans" | "mono".
 *                             next/font emits hashed families
 *                             (`"DM Sans", "DM Sans Fallback"`) and the
 *                             prototype emits its own stack
 *                             (`"DM Sans", ui-sans-serif, system-ui, …`).
 *                             Compared raw, every single landmark would report
 *                             a font-family diff forever. The role is the thing
 *                             Counter actually rules on: Bricolage for titles,
 *                             DM Sans for figures, JetBrains Mono for captions.
 *
 *   grid-template-columns  -> a track COUNT ("6 tracks"). Chromium returns the
 *                             used value in px, so the same rule reads
 *                             "226px 226px 226px" at 1440 and
 *                             "208.656px 208.672px 208.672px" at 1280. Measured:
 *                             it is the ONLY property of these eighteen that
 *                             changes with the viewport, and a px width is a
 *                             pixel comparison, which this gate does not do.
 *                             The count is what carries the design decision.
 *
 *   border-left-color      -> "n/a" when border-left-width computes to 0px.
 *                             A zero-width border still reports a colour, and
 *                             that colour is just the inherited `color` — which
 *                             `color` already checks. Unnormalised it is pure
 *                             noise on ~90% of landmarks.
 *
 * `display` is added to the brief's sixteen: `.strip` is `display:grid` and a
 * div that merely looks stacked is a real defect the other properties miss.
 * `border-left-width` is added so the accent-bar pattern is checked for
 * presence, not only for colour.
 */
export const CHECKED_PROPERTIES = [
  "display",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "color",
  "background-color",
  "border-radius",
  "border-top-width",
  "border-left-width",
  "border-left-color",
  "padding-top",
  "padding-left",
  "gap",
  "grid-template-columns",
  "text-transform",
  "font-variant-numeric",
] as const

export type CheckedProperty = (typeof CHECKED_PROPERTIES)[number]

/**
 * Attributes compared alongside the computed properties.
 *
 * `data-n` is the strip's cell count. It is compared but deliberately NOT part
 * of the alignment signature: a strip of four against a strip of six is one
 * strip rendered wrong, and should report as that, not as a missing strip plus
 * an extra one.
 */
export const COMPARED_ATTRIBUTES = ["data-n"] as const

export interface Landmark {
  /** Depth-first index, so order is part of the comparison. */
  order: number
  classes: string[]
  /**
   * Structural attributes that carry a design decision no class name does.
   *
   * Only `data-n` so far, and it is not optional detail: the prototype's
   * `strip()` (line 3008) emits its cells as BARE `<div>`s with no class at
   * all, and records how many there are in `data-n` on the strip. Without
   * this field a rebuilt strip of four passes the structure pass clean
   * against a design that specifies six — which is the addendum's own
   * "a four-cell strip of plain figures" defect, sailing through the gate
   * built to catch it. Fix round 1; the first version of this file claimed
   * item counting covered the strip, and it did not.
   */
  attrs: Record<string, string>
  /** Trimmed to 60 chars. Compared only for presence, never for equality. */
  text: string
  /**
   * Captured for the report so a human can read "the strip is 1120x96 there
   * and 340x40 here". Deliberately NOT compared: the prototype's figures are
   * invented and ours come from a real database, so a size diff is noise.
   */
  box: { w: number; h: number }
  style: Record<string, string>
}

/**
 * Colour values this application renders differently from the prototype ON
 * PURPOSE, each with the token that decided it and both measured values.
 *
 * This is the rendering pass's counterpart to
 * `scripts/extract-prototype-css.ts`'s CORRECTIONS table, and it exists for
 * the same reason: the prototype's palette was designed light-only and against
 * no accessibility floor, so a handful of its values cannot be shipped as
 * written. `--ct-ink-3` is the one. Correcting it in counter.css and then
 * failing the fidelity gate for the correction would leave exactly two moves —
 * revert the fix, or turn the gate off — and both are worse than saying which
 * value moved and why.
 *
 * A correction here is NOT a tolerance. It forgives one exact (prototype,
 * ours) PAIR on a colour property; anything else on the same element, and any
 * other value of the same property, still reports. Painting `--ct-ink-2` where
 * the prototype paints `--ct-ink-3` is a difference and stays one.
 *
 * It is deliberately keyed on the VALUE and not on a selector, because the
 * substitution is systematic: every element in the design that paints
 * `--ink-3` paints the corrected value here, on every page, now and later. One
 * line covers all of them and cannot drift out of step with a page that gains
 * or loses a `.band`.
 *
 * `tests/e2e/landmarks.test.ts` reads both sides back out of
 * `src/styles/counter.css` and the prototype itself, so a table that stops
 * describing what the two files actually declare fails rather than quietly
 * forgiving the wrong colour.
 */
export const TOKEN_CORRECTIONS: ReadonlyArray<{
  /** The token whose value moved. */
  token: string
  /** What the prototype computes, as Chromium serialises it. */
  prototype: string
  /** What we compute. */
  ours: string
  why: string
}> = [
  {
    token: "--ct-ink-3",
    prototype: "oklch(0.55 0.011 50)",
    ours: "oklch(0.525 0.011 50)",
    why:
      "The prototype's muted ink is 4.356:1 on its own --paper and 4.29:1 on " +
      "its --chrome — below the WCAG AA 4.5:1 floor for the caption, folio " +
      "and SKU text it is used for. Sub-AA text is a compliance floor rather " +
      "than an aesthetic call, so counter.css corrects it to 52.5% lightness " +
      "(hue and chroma untouched), which clears every surface it actually " +
      "renders on with margin. The correction is documented at the head of " +
      "src/styles/counter.css and asserted live in " +
      "tests/styles/counter-tokens.test.ts. It reaches the fidelity gate as a " +
      "`.band` colour difference on every Counter page.",
  },
]

/**
 * The colour-valued members of CHECKED_PROPERTIES. A token correction applies
 * to these and to nothing else — a `font-size` that happens to match a
 * correction's strings cannot be forgiven by one.
 */
const COLOUR_PROPERTIES: ReadonlySet<string> = new Set([
  "color",
  "background-color",
  "border-left-color",
])

/** True when a difference is one of the recorded token corrections, exactly. */
export function isTokenCorrection(property: string, prototype: string, ours: string): boolean {
  if (!COLOUR_PROPERTIES.has(property)) return false
  return TOKEN_CORRECTIONS.some((c) => c.prototype === prototype && c.ours === ours)
}

export interface Difference {
  kind: "missing" | "extra" | "style"
  order: number
  classes: string[]
  property?: string
  prototype?: string
  ours?: string
}

/** The signature two landmarks are aligned on. Sorted, so fixture order is irrelevant. */
function signature(l: Landmark): string {
  return [...l.classes].sort().join(".")
}

/**
 * Compares two landmark sequences by structure.
 *
 * Alignment is a longest-common-subsequence over the landmark signatures, so a
 * section we never built is reported as `missing` at the place it should have
 * been, rather than shifting every landmark after it into a wall of style
 * diffs. Landmarks matched by the LCS are then compared property by property.
 *
 * Text is compared for PRESENCE only: an element that should carry text and
 * carries none is reported as a `style` difference on the pseudo-property
 * "text"; an element carrying a different number is not a difference at all.
 *
 * @throws if both sides are empty. See the module comment — this is the whole
 *         point of the exercise, not a defensive nicety.
 */
export function compareLandmarks(proto: Landmark[], ours: Landmark[]): Difference[] {
  if (proto.length === 0 && ours.length === 0) {
    throw new Error(
      "compareLandmarks: no landmarks on either side, so there is nothing to " +
        "compare and 'no differences' would be a lie. This is what a selector " +
        "typo, a navigation that silently did not happen, or a page that " +
        "redirected to /login looks like. Check that the prototype page id is " +
        "real and that the extraction root actually contains the render.",
    )
  }

  const diffs: Difference[] = []
  for (const [p, o] of alignLandmarks(proto, ours)) {
    if (p && !o) {
      diffs.push({ kind: "missing", order: p.order, classes: p.classes })
      continue
    }
    if (o && !p) {
      diffs.push({ kind: "extra", order: o.order, classes: o.classes })
      continue
    }
    if (!p || !o) continue

    for (const key of COMPARED_ATTRIBUTES) {
      const a = p.attrs?.[key]
      const b = o.attrs?.[key]
      if (a === undefined && b === undefined) continue
      if (a === b) continue
      diffs.push({
        kind: "style",
        order: p.order,
        classes: p.classes,
        property: key,
        prototype: a ?? "",
        ours: b ?? "",
      })
    }

    if (p.text.length > 0 && o.text.length === 0) {
      diffs.push({
        kind: "style",
        order: p.order,
        classes: p.classes,
        property: "text",
        prototype: p.text,
        ours: "",
      })
    }
    for (const prop of CHECKED_PROPERTIES) {
      const a = p.style[prop]
      const b = o.style[prop]
      if (a === undefined && b === undefined) continue
      if (a === b) continue
      // A colour this application deliberately moved off the prototype's
      // value, named and reasoned in TOKEN_CORRECTIONS above. One exact pair,
      // on a colour property; everything else still reports.
      if (isTokenCorrection(prop, a ?? "", b ?? "")) continue
      diffs.push({
        kind: "style",
        order: p.order,
        classes: p.classes,
        property: prop,
        prototype: a ?? "",
        ours: b ?? "",
      })
    }
  }
  return diffs
}

/**
 * Split the structural differences into the ones a page has ACCOUNTED FOR and
 * the ones it has not, given a per-landmark budget of allowed absences.
 *
 * WHY A BUDGET AND NOT A FLAG. A page whose database publishes no target for
 * four of its six figures renders four fewer bullet meters than the design
 * draws. That is the page being right — ruling Scan-R1: never invent a target
 * to close a gate — but it is also indistinguishable, to a comparison, from a
 * meter someone forgot to build. The difference is a written reason and a
 * COUNT: five missing `.blt` is the recorded fact; a sixth is a regression.
 *
 * Three rules, and each one is the point of a different failure this project
 * has already had:
 *
 *  1. An EXTRA is never allowed. An extra silently leaves the rendering
 *     comparison (ruling F-R8), so forgiving one shrinks what is checked
 *     without saying so. They come back untouched.
 *
 *  2. A missing landmark with no allowance comes back untouched too. The
 *     budget forgives the recorded absences and nothing else.
 *
 *  3. An allowance with budget LEFT OVER is itself reported, as `stale`. That
 *     is the day the schema started publishing the target — the landmark now
 *     lands, and the line claiming it cannot is a lie that would quietly
 *     forgive a future regression. Same contract as
 *     `scripts/extract-prototype-css.ts`'s corrections, which throw when they
 *     match nothing.
 *
 * `allowed` is keyed by a landmark's full class list, joined and sorted the
 * way `signature()` does it, so an allowance for `blt` cannot forgive a
 * compound landmark that merely includes it.
 */
export interface AbsenceOutcome {
  /** Differences that are still findings. */
  unexplained: Difference[]
  /** Allowances that forgave fewer landmarks than they budgeted for. */
  stale: Array<{ landmark: string; budgeted: number; used: number }>
}

export function applyAbsenceAllowances(
  differences: Difference[],
  allowed: Readonly<Record<string, number>>,
): AbsenceOutcome {
  const left = new Map<string, number>(Object.entries(allowed))
  const budgeted = new Map<string, number>(Object.entries(allowed))
  const unexplained: Difference[] = []

  for (const d of differences) {
    if (d.kind === "style") continue
    if (d.kind === "extra") {
      unexplained.push(d)
      continue
    }
    const key = [...d.classes].sort().join(".")
    const remaining = left.get(key) ?? 0
    if (remaining > 0) {
      left.set(key, remaining - 1)
      continue
    }
    unexplained.push(d)
  }

  const stale = [...left.entries()]
    .filter(([, remaining]) => remaining > 0)
    .map(([landmark, remaining]) => ({
      landmark,
      budgeted: budgeted.get(landmark) ?? 0,
      used: (budgeted.get(landmark) ?? 0) - remaining,
    }))

  return { unexplained, stale }
}

/**
 * Longest-common-subsequence alignment over signatures. Returns pairs in
 * prototype order: [proto, ours] for a match, [proto, null] for a landmark
 * only the prototype has, [null, ours] for one only we have.
 */
export function alignLandmarks(
  proto: Landmark[],
  ours: Landmark[],
): Array<[Landmark | null, Landmark | null]> {
  const n = proto.length
  const m = ours.length
  const a = proto.map(signature)
  const b = ours.map(signature)

  // dp[i][j] = LCS length of proto[i..] and ours[j..]
  const w = m + 1
  const dp = new Int32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        a[i] === b[j]
          ? dp[(i + 1) * w + j + 1] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
    }
  }

  const out: Array<[Landmark | null, Landmark | null]> = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push([proto[i], ours[j]])
      i++
      j++
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      out.push([proto[i], null])
      i++
    } else {
      out.push([null, ours[j]])
      j++
    }
  }
  while (i < n) out.push([proto[i++], null])
  while (j < m) out.push([null, ours[j++]])
  return out
}

/**
 * How many landmarks the two sides have in common.
 *
 * The rendering pass needs this, and needs it badly: it only compares
 * landmarks present on BOTH sides, so on a page we have not built it compares
 * nothing and reports zero differences — a green rendering pass over a page
 * with no rendering. Measured, not theorised: the first end-to-end run of this
 * suite against the un-rebuilt Overview failed structure and failed dark, and
 * passed "rendering matches the prototype" with 53 landmarks on one side and
 * 0 on the other.
 */
export function matchedCount(proto: Landmark[], ours: Landmark[]): number {
  let n = 0
  for (const [p, o] of alignLandmarks(proto, ours)) if (p && o) n++
  return n
}

/** A one-line count for a report headline. */
export function landmarkTally(landmarks: Landmark[]): Record<string, number> {
  const tally: Record<string, number> = {}
  for (const l of landmarks) {
    for (const c of l.classes) tally[c] = (tally[c] ?? 0) + 1
  }
  return tally
}

/* ============================================================================
   Pass 3: dark mode, asserted on its own terms.

   Dark is NEVER compared to the prototype (ruling F-R2). The prototype
   declares its application tokens light-only, and dark is this project's own
   design. Worse, the ported sheet inherited 35 colour literals from it — and
   `.qbtn[aria-pressed="true"]` sets its background to var(--ink), which themes
   to near-white in dark, while its `.n` child keeps a hardcoded light grey.
   That is invisible text, and a gate comparing dark against the prototype
   would call it a perfect match, because the prototype does exactly the same.

   So dark is asserted against two rules of its own:
     1. every colour rendered resolves through a --ct-* token;
     2. text keeps its contrast against the surface it actually sits on.

   FIX ROUND 1 — WHAT THIS SWEEP COVERS, AND WHY IT IS NOT "LANDMARKS".
   The first version of these rules inspected only elements that themselves
   carried a landmark class. Measured on the prototype's own Overview desk
   render: 543 elements, 53 of them landmarks, and 297 of them painting a
   colour or a background of their own — of which 30 were landmarks. It
   covered about a tenth of the page.

   Worse, it covered the wrong tenth. `.qbtn` and `.qbtn .n` — the exact
   elements the addendum, the README and the commit message all name as the
   REASON dark is asserted separately rather than compared — carry no landmark
   class at all, so they were unreachable by the check written for them. The
   end-to-end proof injected those colours onto elements that DID carry a
   landmark class, which is why it read as complete.

   So the sweep now walks every element under the extraction root and
   attributes each finding to its nearest landmark ancestor, so a report still
   reads structurally: `.qitem -> .qbtn .n`. An element with no landmark
   ancestor is still checked and attributed to "(outside any landmark)" —
   a hardcoded grey on a page's own head block is exactly as invisible in dark
   as one inside a section.

   Contrast was thinner still, for a second reason: it needs the element's OWN
   text nodes, and only 4 of 53 desk landmarks (2 of 30 on phone) have any.
   Containers keep their text in `.k` / `.v` / `.t` children, so the rule
   skipped almost the whole page. The descendant sweep is what fixes that too.
   ========================================================================= */

export interface Rgb {
  r: number
  g: number
  b: number
}

export interface ThemedColour {
  property: string
  /** The computed value as the browser reported it, for the failure message. */
  value: string
  /** The same colour rasterised to sRGB bytes, for the contrast maths. */
  rgb: Rgb
}

/**
 * One element that paints a colour or carries text, attributed to the landmark
 * it sits inside. NOT necessarily a landmark itself — see the section header.
 */
export interface ThemedNode {
  /** The order of the nearest landmark ancestor, or -1 when there is none. */
  order: number
  /** The landmark ancestor's landmark classes. Empty when there is no landmark ancestor. */
  classes: string[]
  /**
   * This element's position inside that landmark, e.g. ".qbtn .n". Empty
   * string when this element IS the landmark. This is what makes a finding on
   * a class-less `<div>` deep inside a section readable.
   */
  within: string
  /**
   * Only the colours this element DECIDES. A transparent background is
   * dropped, and so is an inherited `color` on a non-landmark element — the
   * ancestor that introduced it is swept too, and reporting it again on every
   * descendant would bury the one element that actually chose it.
   */
  colours: ThemedColour[]
  /** Text in this element's OWN text nodes. Inherited text is somebody else's contrast problem. */
  ownText: string
  fontSizePx: number
  fontWeight: number
  /** The nearest non-transparent background behind this element's text. */
  surface: Rgb | null
}

export interface ThemeDefect {
  kind: "literal" | "contrast"
  order: number
  classes: string[]
  /** Where inside the landmark, e.g. ".qbtn .n". */
  within: string
  property: string
  value: string
  detail: string
}

/** How a defect names its element in a failure message. */
export function defectWhere(d: ThemeDefect): string {
  const landmark = d.classes.length ? `.${d.classes.join(".")}` : "(outside any landmark)"
  return d.within ? `${landmark} -> ${d.within}` : landmark
}

/** WCAG 2.x relative luminance of an sRGB colour. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const ch = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}

/** WCAG 2.x contrast ratio, 1..21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** The AA floor for text of this size and weight. */
export function requiredContrast(fontSizePx: number, fontWeight: number): number {
  const large = fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700)
  return large ? 3 : 4.5
}

/**
 * Both rules, over one theme's render.
 *
 * @param nodes        every element that paints a colour or carries text, in
 *                     the theme under test — not only the landmarks.
 * @param tokenValues  every --ct-* colour token, resolved in that same theme.
 *                     A colour not in this set is a literal: it will not move
 *                     when the theme does.
 */
export function findThemeDefects(
  nodes: ThemedNode[],
  tokenValues: string[],
): ThemeDefect[] {
  const landmarks = nodes
  if (landmarks.length === 0) {
    throw new Error(
      "findThemeDefects: no landmarks, so there is nothing to assert and a " +
        "clean result would be a lie. Same failure mode as compareLandmarks([], []).",
    )
  }
  if (tokenValues.length === 0) {
    throw new Error(
      "findThemeDefects: no --ct-* token values were resolved, so every colour " +
        "on the page would be reported as a literal. The token sweep is broken, " +
        "not the page.",
    )
  }
  const tokens = new Set(tokenValues)
  const defects: ThemeDefect[] = []

  for (const l of landmarks) {
    for (const c of l.colours) {
      if (!tokens.has(c.value)) {
        defects.push({
          kind: "literal",
          order: l.order,
          classes: l.classes,
          within: l.within,
          property: c.property,
          value: c.value,
          detail:
            "resolves to a colour no --ct-* token holds in this theme, so it " +
            "will not move when the theme does",
        })
      }
    }

    if (!l.ownText.trim()) continue
    if (!l.surface) continue
    const fg = l.colours.find((c) => c.property === "color")
    if (!fg) continue
    const ratio = contrastRatio(fg.rgb, l.surface)
    const need = requiredContrast(l.fontSizePx, l.fontWeight)
    if (ratio + 1e-9 < need) {
      defects.push({
        kind: "contrast",
        order: l.order,
        classes: l.classes,
        within: l.within,
        property: "color",
        value: fg.value,
        detail: `${ratio.toFixed(2)}:1 against its surface, needs ${need}:1 at ${l.fontSizePx}px/${l.fontWeight}`,
      })
    }
  }
  return defects
}

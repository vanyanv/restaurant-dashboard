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

export interface Landmark {
  /** Depth-first index, so order is part of the comparison. */
  order: number
  classes: string[]
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
     1. every colour a landmark renders resolves through a --ct-* token;
     2. text keeps its contrast against the surface it actually sits on.
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

export interface ThemedLandmark {
  order: number
  classes: string[]
  /** Only the colours this element actually paints. Transparent ones are dropped. */
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
  property: string
  value: string
  detail: string
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
 * @param landmarks    what the page painted, in the theme under test.
 * @param tokenValues  every --ct-* colour token, resolved in that same theme.
 *                     A colour not in this set is a literal: it will not move
 *                     when the theme does.
 */
export function findThemeDefects(
  landmarks: ThemedLandmark[],
  tokenValues: string[],
): ThemeDefect[] {
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
        property: "color",
        value: fg.value,
        detail: `${ratio.toFixed(2)}:1 against its surface, needs ${need}:1 at ${l.fontSizePx}px/${l.fontWeight}`,
      })
    }
  }
  return defects
}

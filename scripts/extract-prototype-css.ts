#!/usr/bin/env tsx
/**
 * Port the Counter prototype's stylesheet into the application, verbatim.
 *
 * `docs/counter/counter-prototype.html` is the design. Reimplementing it with
 * Tailwind utilities drifted far enough that the shipped page looked nothing
 * like it, so the correction is to stop reimplementing: this script lifts the
 * prototype's own rules out of its twelve `<style>` blocks and writes them to
 * `src/styles/counter-components.css`, which is committed and regenerated with
 * `npm run css:extract`.
 *
 * The prototype is a documentation site that HAPPENS to contain the app, so the
 * extraction is a filter, not a copy. Three things in that filter are subtle,
 * and each one silently loses (or silently leaks) styling if it is missed:
 *
 *  1. A selector naming NO class is never ported. The prototype styles bare
 *     `body`, `a`, `*` and `:root` for its own page chrome; porting those would
 *     leak the prototype's page styling over the WHOLE application, including
 *     the login and editorial routes that are not Counter at all.
 *
 *  2. A grouped selector is narrowed per comma, not kept or dropped whole.
 *     `.pchip,.mtab,.seg button` is doc chrome, app, app — dropping the group
 *     because one part is doc chrome loses two real components. The commas that
 *     matter are only the top-level ones: those inside `:is(...)`, `:where(...)`
 *     and `[data-n="1,2"]` are not group separators.
 *
 *  3. Token DECLARATIONS are stripped; token REFERENCES are kept. See
 *     `stripColourTokens` below — this is the one place the port is not
 *     verbatim, and the reason is dark mode.
 *
 * `rt` looks like doc chrome and is NOT — `.mli .rt` is the phone list's
 * trailing figure. Do not add it to DOC_ONLY.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
export const SOURCE = path.join(ROOT, "docs", "counter", "counter-prototype.html")
export const OUTPUT = path.join(ROOT, "src", "styles", "counter-components.css")

/**
 * Classes belonging to the prototype's own documentation site rather than to
 * the application it documents. Every one of these was confirmed by reading
 * the rule it names, not by how the name sounds.
 */
export const DOC_ONLY: ReadonlySet<string> = new Set([
  "wrap",
  "eyebrow",
  "masthead",
  "lede",
  "scene",
  "spec",
  "purpose",
  "speccols",
  "speccol",
  "notes",
  "notegrid",
  "idx",
  "idx__in",
  "idx__k",
  "pchip",
  "stagehead",
  "stage",
  "devcap",
  "bareviews",
])

export interface Rule {
  /** Selector text, or RAW for the whitespace/comment runs between rules. */
  sel: string
  body: string
  isAt: boolean
}

/** Sentinel selector for the inter-rule whitespace and comments, which are dropped. */
const RAW = "__raw__"

/**
 * Split a stylesheet into rules, preserving source order and nesting one level
 * (an at-rule keeps its whole brace-matched body, which is re-split by the
 * caller). Brace matching is depth-counted rather than regex-matched so that
 * `@media`, `@supports` and `@container` bodies survive intact.
 */
export function splitRules(css: string): Rule[] {
  const out: Rule[] = []
  const skip = /\s*(?:\/\*[\s\S]*?\*\/\s*)*/y
  let i = 0
  const n = css.length
  while (i < n) {
    skip.lastIndex = i
    skip.exec(css)
    if (skip.lastIndex > i) {
      out.push({ sel: RAW, body: css.slice(i, skip.lastIndex), isAt: false })
      i = skip.lastIndex
      if (i >= n) break
    }
    const brace = css.indexOf("{", i)
    if (brace === -1) {
      out.push({ sel: RAW, body: css.slice(i), isAt: false })
      break
    }
    const sel = css.slice(i, brace).trim()
    let depth = 1
    let j = brace + 1
    while (j < n && depth > 0) {
      if (css[j] === "{") depth += 1
      else if (css[j] === "}") depth -= 1
      j += 1
    }
    out.push({ sel, body: css.slice(brace + 1, j - 1), isAt: sel.startsWith("@") })
    i = j
  }
  return out
}

/** Every class name a selector mentions. */
export function classNamesIn(sel: string): Set<string> {
  const out = new Set<string>()
  for (const m of sel.matchAll(/\.([a-zA-Z][\w-]*)/g)) out.add(m[1])
  return out
}

/**
 * Split a grouped selector on its top-level commas only. Commas inside
 * `:is(...)`, `:where(...)` and attribute selectors are not group separators;
 * splitting on every comma would shatter `:where(.pframe) button` and every
 * `[data-n="4"]`-style selector.
 */
export function splitGroup(sel: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ""
  for (const ch of sel) {
    if (ch === "(" || ch === "[") depth += 1
    else if (ch === ")" || ch === "]") depth -= 1
    if (ch === "," && depth === 0) {
      out.push(cur)
      cur = ""
    } else {
      cur += ch
    }
  }
  if (cur.trim()) out.push(cur)
  return out.map((x) => x.trim()).filter((x) => x.length > 0)
}

/**
 * One comma-separated part. It belongs to the app if it names at least one
 * class and none of the classes it names is documentation chrome.
 */
export function isAppSelector(part: string): boolean {
  const classes = classNamesIn(part)
  if (classes.size === 0) return false // bare element / `:root` selectors: never port
  for (const c of classes) if (DOC_ONLY.has(c)) return false
  return true
}

/** True if any part of a grouped selector belongs to the app. */
export function keep(sel: string): boolean {
  if (sel === RAW) return false
  if (sel.startsWith("@")) return true
  return splitGroup(sel).some(isAppSelector)
}

/** Keep only the app's parts of a grouped selector. */
export function narrow(sel: string): string {
  if (sel.startsWith("@")) return sel
  const parts = splitGroup(sel).filter(isAppSelector)
  return parts.length > 0 ? parts.join(",") : sel
}

/**
 * A colour written as a value rather than referenced through a token.
 *
 * Deliberately BROADER than `scripts/counter-lint.ts`'s COLOUR_LITERAL, which
 * this otherwise mirrors: it also matches `color-mix(`. The lint rule is
 * looking for a colour someone typed by hand, and a `color-mix()` of two
 * tokens is not that. This is deciding whether a custom property is a THEMED
 * value that counter.css must own, and a `color-mix()` of two light-only
 * token values is exactly as light-only as a literal — it has to be stripped
 * too. Nothing in the prototype uses it today; the extra alternative is here
 * so that a prototype that starts to would not slip a light-only token past
 * this and kill dark mode silently, which is the whole point of the strip.
 */
const COLOUR_VALUE = /#[0-9a-fA-F]{3,8}\b|\boklch\(|\brgba?\(|\bhsla?\(|\bcolor-mix\(/

/**
 * Strip every custom property whose VALUE is a colour, from any rule that
 * declares one.
 *
 * This is the only place the port is not verbatim, and it is not optional.
 * The prototype declares its colour tokens light-only, three times over —
 * `.frame`, `.pframe` and `.login` each carry their own copy — while
 * `src/styles/counter.css` declares the same 33 values as `light-dark()` pairs
 * that `tests/styles/counter-tokens.test.ts` asserts in BOTH themes. Porting
 * those declarations verbatim would shadow every one of them with a light
 * value inside the very elements the port styles, killing dark mode while
 * every test stayed green.
 *
 * Only colour-valued custom properties are stripped. The type scale, the radii
 * and any other unit-valued token are theme-independent, so leaving them in
 * place costs nothing and preserves a real difference: `.login` sets
 * `--t-body:13.5px`, half a pixel larger than `.frame`'s 13px, which is a
 * deliberate choice by the prototype and not something the alias layer should
 * flatten.
 *
 * A stripped declaration takes its leading comment with it, so the block does
 * not end up holding a paragraph about channel identity and no channels.
 */
export function stripColourTokens(body: string): { body: string; stripped: number } {
  // Split into declaration-sized pieces at top-level semicolons. Each piece
  // carries the whitespace and comments that PRECEDE it, which is what makes
  // dropping a declaration drop its own comment too.
  const pieces: string[] = []
  let depth = 0
  let cur = ""
  for (const ch of body) {
    if (ch === "(" || ch === "[") depth += 1
    else if (ch === ")" || ch === "]") depth -= 1
    cur += ch
    if (ch === ";" && depth === 0) {
      pieces.push(cur)
      cur = ""
    }
  }
  if (cur.length > 0) pieces.push(cur)

  let stripped = 0
  const kept = pieces.filter((piece) => {
    const code = piece.replace(/\/\*[\s\S]*?\*\//g, " ").trim()
    if (!/^--[\w-]+\s*:/.test(code)) return true
    if (!COLOUR_VALUE.test(code)) return true
    stripped += 1
    return false
  })
  // Collapse the blank runs left behind by the stripped declarations.
  return { body: kept.join("").replace(/\n[ \t]*(?:\n[ \t]*)+/g, "\n"), stripped }
}

/**
 * The alias layer.
 *
 * The ported rules read the prototype's own token names. Their VALUES now come
 * from counter.css, which stays the only place in the application where a
 * colour is decided — every entry here is a `var()`, never a literal.
 *
 * The selector list is the set of roots the tokens were stripped from
 * (`.frame`, `.pframe`, `.login`) plus `.ct-root`, the application's own
 * Counter root. Restoring them at exactly the selectors they were removed from
 * keeps a ported subtree self-sufficient wherever it is mounted.
 *
 * `--len`, `--pc` and `--qc` are deliberately absent: they are set inline per
 * element at runtime (chart lengths, bar percentages) and a default here would
 * mask a component that forgot to set one.
 *
 * --t-small is read twice and declared nowhere, in the prototype itself. It
 * is left undeclared here deliberately. Every read is
 * invalid-at-computed-value-time on an inherited property, so it resolves to
 * the inherited --t-body — which is 13px under .frame, 14px under .pframe and
 * 13.5px under .login. Aliasing it to any one of those pins it to a single
 * value and renders .pframe .wf__p a pixel small. Unlike --len/--pc/--qc,
 * which are set inline per element, this one is never set at all.
 */
const ALIAS_LAYER = `.ct-root, .frame, .pframe, .login {
  /* surfaces */
  --surface: var(--ct-surface);          --paper: var(--ct-paper);
  --chrome: var(--ct-chrome);            --sunk: var(--ct-sunk);
  --line: var(--ct-line);                --line-strong: var(--ct-line-strong);
  --scrim: var(--ct-scrim);

  /* ink */
  --ink: var(--ct-ink);                  --ink-2: var(--ct-ink-2);
  --ink-3: var(--ct-ink-3);

  /* action + state */
  --accent: var(--ct-accent);            --accent-hi: var(--ct-accent-hi);
  --accent-wash: var(--ct-accent-wash);
  --signal: var(--ct-signal);            --signal-wash: var(--ct-signal-wash);
  --signal-line: var(--ct-signal-line);  --signal-ink: var(--ct-signal-ink);
  --good: var(--ct-good);                --good-wash: var(--ct-good-wash);
  --warn: var(--ct-warn);                --warn-wash: var(--ct-warn-wash);
  --bad: var(--ct-bad);                  --bad-wash: var(--ct-bad-wash);

  /* channel identity + chart ramps */
  --ch-house: var(--ct-ch-house);        --ch-dd: var(--ct-ch-dd);
  --ch-ue: var(--ct-ch-ue);              --ch-gh: var(--ct-ch-gh);
  --mx-1: var(--ct-mx-1);                --mx-2: var(--ct-mx-2);
  --mx-3: var(--ct-mx-3);                --mx-4: var(--ct-mx-4);
  --gp-1: var(--ct-gp-1);                --gp-2: var(--ct-gp-2);
  --gp-3: var(--ct-gp-3);

  /* type scale, radii, easing — not colours, but still counter.css's to own */
  --t-micro: var(--ct-t-micro);          --t-cap: var(--ct-t-cap);
  --t-body: var(--ct-t-body);            --t-mid: var(--ct-t-mid);
  --t-lg: var(--ct-t-lg);                --t-xl: var(--ct-t-xl);
  --t-hero: var(--ct-t-hero);
  --r: var(--ct-r);                      --r-sm: var(--ct-r-sm);
  --ease: var(--ct-ease);

  /* The prototype's own documentation-page tokens, read by a handful of
     ported rules. Mapped onto their application equivalents rather than
     reintroduced, so they theme with everything else. */
  --page-bg: var(--ct-paper);            --page-surface: var(--ct-surface);
  --page-line: var(--ct-line);           --page-ink: var(--ct-ink);
  --page-ink-2: var(--ct-ink-2);         --page-ink-3: var(--ct-ink-3);
  --page-accent: var(--ct-accent);

  /* The three next/font variables declared in src/app/layout.tsx. */
  --sans: var(--font-dm-sans), ui-sans-serif, system-ui, -apple-system, sans-serif;
  --display: var(--font-bricolage), var(--sans);
  --mono: var(--font-jetbrains-mono), ui-monospace, Menlo, monospace;
}`

/**
 * `.frame`'s base, restated for `.ct-root`.
 *
 * THE DEFECT THIS CLOSES. The alias layer above carries the prototype's token
 * DECLARATIONS onto `.ct-root`. It did not carry the prototype's BASE — and
 * the prototype declares its base on `.frame`, together with that element's
 * demo-card layout (`display:grid`, a fixed 212px column, a border, a shadow,
 * `min-height:840px`). Nothing in this application carries `.frame`, and
 * nothing should: it is a page-of-documentation wrapper, not an app shell.
 *
 * The consequence was that the entire base of the design system was dead.
 * Every ported rule that sets a size but no colour (`.strip .v`,
 * `.headline .v`) painted in whatever ink the document happened to have — in
 * dark theme, near-black figures on a near-black surface. Every figure
 * inherited 16px/24px/`normal` instead of the design's 13px/19.5px/tabular.
 * And `@container fr`, which the prototype uses for the 6->3->2 strip reflow
 * and eleven other responsive rules, never fired at all, because
 * `container-name: fr` is declared in exactly one place: `.frame`.
 *
 * So the base travels with the tokens, and the demo-card layout does not.
 * Every value here is `.frame`'s own, read through the alias layer above.
 *
 * `.frame`, `.pframe` and `.login` are deliberately NOT in this selector.
 * They keep their own base further down the file, at their own `--t-body`
 * (13px / 14px / 13.5px), and `tests/styles/counter-components.test.ts`
 * asserts that those three stay distinct.
 */
const CT_ROOT_BASE = `.ct-root {
  font-family: var(--sans);
  font-size: var(--t-body);
  line-height: 1.5;
  font-variant-numeric: tabular-nums lining-nums;
  color: var(--ink);
  background: var(--paper);
  /* What makes every \`@container fr\` rule in this file live. Named and typed
     on the same element, exactly as .frame does it. */
  container-name: fr;
  container-type: inline-size;
}`

/**
 * `.pframe`'s type scale, restated for `.ct-phone`.
 *
 * THE DEFECT THIS CLOSES, and it is `CT_ROOT_BASE`'s defect one surface over.
 * The prototype declares TWO scales — `.frame` at `--t-body:13px` and
 * `.pframe` at 14px, a step up because a phone is held closer and the column
 * is 316px wide — and it declares each of them on that surface's demo wrapper.
 * `.ct-root` restated `.frame`'s. Nothing restated `.pframe`'s, so Counter's
 * phone surface (`/m`, Phase C task 4) rendered the whole design at the DESK
 * scale: measured against the prototype, every one of its 38 shared landmarks
 * reported `font-size 14px / 13px` and `line-height 21px / 19.5px` — 76 of the
 * 79 rendering differences on that page, from one missing declaration.
 *
 * `.pframe` itself cannot be the phone's root for exactly the reason `.frame`
 * cannot be the desk's: it is the documentation page's bezel — 340x718 fixed,
 * a 26px radius and a drop shadow — not an app shell.
 *
 * Only the seven type steps travel. `.pframe`'s `--r`/`--r-sm` are already
 * `.frame`'s values, and its base (`font-family`, `line-height`, ink, ground,
 * the container declarations) is `.ct-root`'s, which the phone carries as
 * well: `.ct-phone` is worn WITH `.ct-root`, never instead of it. It follows
 * `CT_ROOT_BASE` in the output so that its declarations win the cascade at
 * equal specificity, which is what lets one element carry both.
 */
const CT_PHONE_SCALE = `.ct-phone {
  --t-micro: 10px; --t-cap: 11.5px; --t-body: 14px; --t-mid: 15.5px;
  --t-lg: 19px; --t-xl: 23px; --t-hero: 32px;
}`

const HEADER = `/* GENERATED by scripts/extract-prototype-css.ts — do not edit by hand.
 * Regenerate with: npm run css:extract
 * Source: docs/counter/counter-prototype.html
 *
 * The prototype's rules are ported verbatim. Only its colour-token
 * DECLARATIONS are replaced: it declares them light-only (inside .frame,
 * .pframe and .login), and counter.css declares the same values as
 * light-dark() pairs asserted in both themes. The alias layer below lets the
 * ported rules read the prototype's own names while the values keep coming
 * from counter.css — which stays the only place a colour is decided.
 *
 * The alias layer is followed by .ct-root's base: the typography, ink, ground
 * and container declarations the prototype keeps on .frame. They are restated
 * because nothing in this application carries .frame, so without them the
 * design's 13px tabular base, its ink, and every @container fr rule in this
 * file are dead. .frame's demo-card layout is NOT restated.
 *
 * Selectors that name no class are not ported at all, so nothing here can
 * apply outside an element that opted in by class name.
 */`

export interface ExtractResult {
  css: string
  styleBlocks: number
  kept: number
  atRules: number
  dropped: number
  droppedSelectors: string[]
  classes: Set<string>
  strippedTokens: number
  /** Length of the ported rules alone, excluding header and alias layer. */
  rulesChars: number
  /** Names of the @keyframes carried across because a ported rule animates with them. */
  keyframes: string[]
  /** @keyframes present in the prototype that no ported rule references. */
  unusedKeyframes: string[]
  /** At-rules dropped whole because every rule inside them was documentation chrome. */
  droppedAtRules: string[]
}

export function extract(html: string): ExtractResult {
  const blocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1])

  const kept: Rule[] = []
  const droppedSelectors: string[] = []
  const droppedAtRules: string[] = []
  const keyframeRules = new Map<string, string>()
  let atRules = 0
  let strippedTokens = 0

  const stripInto = (body: string) => {
    const r = stripColourTokens(body)
    strippedTokens += r.stripped
    return r.body
  }

  for (const block of blocks) {
    for (const rule of splitRules(block)) {
      if (rule.sel === RAW) continue
      if (rule.isAt) {
        // `@keyframes` is the one at-rule whose inner "selectors" are not
        // selectors: `from`, `to` and `40%` name no class and never could,
        // so running them through the class-name filter empties every
        // keyframes block and leaves 19 ported `animation:` declarations
        // pointing at names that no longer exist — animation silently dead,
        // nothing to see in any test. A keyframes block cannot leak either:
        // it applies only where a rule names it. So it is carried across
        // whole, and only when a ported rule actually animates with it.
        const kf = /^@keyframes\s+([A-Za-z_-][\w-]*)/.exec(rule.sel)
        if (kf) {
          keyframeRules.set(kf[1], `@keyframes ${kf[1]}{${rule.body}}`)
          continue
        }
        const inner = splitRules(rule.body).filter((r) => r.sel !== RAW)
        const good = inner.filter((r) => keep(r.sel))
        if (good.length > 0) {
          atRules += 1
          kept.push({
            sel: rule.sel,
            body: good.map((r) => `  ${narrow(r.sel)}{${stripInto(r.body)}}`).join("\n"),
            isAt: true,
          })
        }
        if (good.length === 0) droppedAtRules.push(rule.sel)
        continue
      }
      if (keep(rule.sel)) {
        kept.push({ sel: narrow(rule.sel), body: stripInto(rule.body), isAt: false })
      } else {
        droppedSelectors.push(rule.sel)
      }
    }
  }

  const rules = applyCorrections(
    kept
      .map((r) => (r.isAt ? `${r.sel}{\n${r.body}\n}` : `${r.sel}{${r.body}}`))
      .join("\n"),
  )

  const animated = new Set<string>()
  for (const m of rules.matchAll(/\banimation(?:-name)?\s*:\s*([^;}]*)/g)) {
    for (const word of m[1].matchAll(/[A-Za-z_-][\w-]*/g)) animated.add(word[0])
  }
  const usedKeyframes = [...keyframeRules.keys()].filter((n) => animated.has(n)).sort()
  const unusedKeyframes = [...keyframeRules.keys()].filter((n) => !animated.has(n)).sort()
  const keyframeCss = usedKeyframes.map((n) => keyframeRules.get(n)).join("\n")

  const classes = new Set<string>()
  for (const r of kept) for (const c of classNamesIn(r.sel)) classes.add(c)

  return {
    css:
      `${HEADER}\n${ALIAS_LAYER}\n${CT_ROOT_BASE}\n${CT_PHONE_SCALE}\n\n${rules}\n\n` +
      `/* @keyframes referenced by the rules above. Carried across whole: a\n` +
      ` * keyframe selector names no class because it cannot, and a keyframes\n` +
      ` * block applies only where a rule animates with its name. */\n` +
      `${keyframeCss}\n`,
    keyframes: usedKeyframes,
    unusedKeyframes,
    droppedAtRules,
    styleBlocks: blocks.length,
    kept: kept.length,
    atRules,
    dropped: droppedSelectors.length,
    droppedSelectors,
    classes,
    strippedTokens,
    rulesChars: rules.length,
  }
}

/**
 * The ONE place the ported stylesheet is allowed to disagree with the
 * prototype, and every disagreement has to earn its line here.
 *
 * The porting rule is that this file is the prototype's stylesheet, lifted
 * whole — `tests/styles/counter-components.test.ts` asserts the committed CSS
 * is byte-identical to what this script produces, precisely so nobody can
 * hand-edit a rule and call it a port. That rule has one real exception: the
 * prototype declares its application tokens LIGHT ONLY, so a colour choice
 * that reads fine there can be invisible in the dark theme this project added.
 * The fidelity gate's dark pass is what finds those, and a correction recorded
 * here is the honest way to fix one — a hand-edit to the .css is not.
 *
 * A correction may ONLY change a colour to a `var()` the alias layer supplies,
 * whose value is decided in `src/styles/counter.css` — the one place in this
 * application a colour is decided. It may not change layout and it may not
 * write a value here: `npm run tokens` and this file's own tests both still
 * apply, and a correction that needs a token the design has never named must
 * add that token to counter.css as a light-dark() pair, in the open, with its
 * reasoning — not smuggle a literal in through this table.
 */
const CORRECTIONS: Array<{
  /**
   * The exact rule texts to replace, and what each becomes.
   *
   * More than one edit per entry when a single design decision is written
   * into the sheet at more than one selector. Splitting those into separate
   * entries would let a later change fix one and leave the other — and "the
   * desk and the phone disagree about what a falling number looks like" is
   * the defect, not the mechanism for fixing it.
   */
  edits: Array<{ from: string; to: string }>
  why: string
}> = [
  {
    edits: [
      {
        from: ".dispatch .sep{color:var(--line-strong)}",
        to: ".dispatch .sep{color:var(--ink-3)}",
      },
    ],
    why:
      "The prototype paints the dispatch line's separator in a RULE colour. " +
      "In the dark theme --line-strong against --surface is 1.73:1, which the " +
      "fidelity gate's contrast pass reports as a defect on the Overview " +
      "(CONTRAST .dispatch -> .sep), and a separator nobody can see is not a " +
      "separator. --ct-ink-3 is the muted-ink token counter.css already " +
      "contrast-corrected for exactly this reason, and it is what `.crumbs " +
      ".sep` uses. Proved by the dark pass going green with this line and red " +
      "without it.",
  },
  {
    edits: [
      {
        from:
          ".headline .d{font-family:var(--mono);font-size:var(--t-cap);" +
          "font-weight:500;color:var(--good)}",
        to:
          ".headline .d{font-family:var(--mono);font-size:var(--t-cap);" +
          "font-weight:500;color:var(--good)}\n" +
          ".headline .d.is-down{color:var(--bad)}\n" +
          ".headline .d.is-flat{color:var(--ink-3)}",
      },
      {
        from:
          ".mhead .d{font-family:var(--mono);font-size:var(--t-cap);" +
          "font-weight:500;color:var(--good)}",
        to:
          ".mhead .d{font-family:var(--mono);font-size:var(--t-cap);" +
          "font-weight:500;color:var(--good)}\n" +
          ".mhead .d.is-down{color:var(--bad)}\n" +
          ".mhead .d.is-flat{color:var(--ink-3)}",
      },
    ],
    why:
      "A FALL IS PAINTED AS GOOD NEWS, on both surfaces. The prototype gives " +
      "its two lead-figure deltas exactly one rule each — `.headline .d` " +
      "(line 155) and `.mhead .d` (line 465) both paint var(--good) and " +
      "nothing else — while the two STRIP deltas beside them each carry " +
      "`.is-down` and `.is-flat` overrides (`.strip .d` lines 233-235, " +
      "`.mstrip .d` lines 628-630). So the strip can say a figure moved the " +
      "wrong way and the head block, which carries the one figure an owner " +
      "reads first, cannot. Measured on our own Overview on 2026-08-25: net " +
      "sales read \"\\u25bc 37.2% vs the prior period\" in var(--good) green on " +
      "the desk and again on the phone. A number going the wrong way that " +
      "looks like good news is the most consequential kind of fidelity " +
      "defect, and it is the prototype's own omission rather than ours. " +
      "`.is-flat` comes with it because the same two elements print " +
      "\"no comparison set\" and \"14 day readings with labour posted\" — " +
      "statements of fact, painted the colour of a rise. " +
      "\n\n" +
      "THE CLASS IS SENTIMENT, NOT DIRECTION, and the prototype's own call " +
      "sites are what settle that: line 4911 writes `mkt.d > 0 ? 'is-down'` " +
      "and line 4926 writes `rep.d < 0 ? 'is-down'` on the SAME page, so a " +
      "rise and a fall both earn it depending on which way is bad for that " +
      "figure; line 4776 puts it on `['Open','3','2 need a decision']`, which " +
      "has no direction at all. The caller decides, the arrow does not — so " +
      "these two rules cannot make every fall red, and a figure whose fall " +
      "is a win (marketplace fees) simply is not given the class. " +
      "\n\n" +
      "Two colours, both already in the sheet, both already used by the " +
      "sibling rules this copies. No layout, no new value.",
  },
  {
    edits: [
      {
        from:
          ".pshade{position:absolute;inset:0;background:oklch(24% 0.014 40 / .3);" +
          "display:none;z-index:15}",
        to:
          ".pshade{position:absolute;inset:0;background:var(--scrim);" +
          "display:none;z-index:15}",
      },
    ],
    why:
      "THE PHONE SHEET'S SCRIM DID THE OPPOSITE OF A SCRIM IN DARK. The " +
      "prototype writes the value inline because it has no dark theme to keep " +
      "it honest: oklch(24% 0.014 40 / .3) is --ink's LIGHT value at 30%, and " +
      "a 24%-lightness wash over the dark theme's 19%-lightness ground " +
      "LIGHTENS it to about 20.5% — pushing the page forward while the sheet " +
      "covering it sits at 22%. Depth inverted, and no separation at all " +
      "between a modal surface and the page behind it. The fidelity gate's " +
      "dark pass found it on its first run against /m: LITERAL .ct-root " +
      ".mtop .pshade background-color. " +
      "\n\n" +
      "It cannot be derived from an existing token. --ct-ink themes to " +
      "near-WHITE in dark, so a color-mix() of it would paint a white veil, " +
      "and every other token is opaque while a scrim needs alpha by " +
      "definition. So --ct-scrim is authored in counter.css as a light-dark() " +
      "pair whose LIGHT half is this literal, verbatim — the same situation " +
      "as every dark half in that file, which the prototype never drew. The " +
      "rule here changes nothing but where the colour comes from.",
  },
]

/** Applies `CORRECTIONS`, and fails loudly if one no longer matches anything. */
function applyCorrections(css: string): string {
  let out = css
  for (const c of CORRECTIONS) {
    for (const edit of c.edits) {
      if (!out.includes(edit.from)) {
        throw new Error(
          `extract-prototype-css: correction for ${JSON.stringify(edit.from)} matched ` +
            `nothing. The prototype's rule changed under it — re-read the rule and ` +
            `either update the correction or delete it, but do not leave a ` +
            `correction that silently does nothing.`,
        )
      }
      out = out.split(edit.from).join(edit.to)
    }
  }
  return out
}

/** Read the prototype and produce the stylesheet text. Pure: writes nothing. */
export function generate(): string {
  return extract(readFileSync(SOURCE, "utf-8")).css
}

function main(): void {
  const result = extract(readFileSync(SOURCE, "utf-8"))
  writeFileSync(OUTPUT, result.css, "utf-8")
  const unique = [...new Set(result.droppedSelectors.map((s) => s.slice(0, 40)))].sort()
  console.log(`source            : ${path.relative(ROOT, SOURCE)}`)
  console.log(`style blocks      : ${result.styleBlocks}`)
  console.log(`rules kept        : ${result.kept}  (of which @-rules: ${result.atRules})`)
  console.log(`rules dropped     : ${result.dropped}`)
  console.log(`dropped selectors : ${unique.slice(0, 28).join(", ")}`)
  console.log(`at-rules dropped  : ${result.droppedAtRules.join(" | ") || "(none)"}`)
  console.log(`colour tokens stripped: ${result.strippedTokens}`)
  console.log(`@keyframes ported     : ${result.keyframes.length} (${result.keyframes.join(", ")})`)
  console.log(`@keyframes unreferenced: ${result.unusedKeyframes.join(", ") || "(none)"}`)
  console.log(`distinct app classes  : ${result.classes.size}`)
  console.log(`\nwrote ${path.relative(ROOT, OUTPUT)}: ${result.css.length} chars (${result.rulesChars} of ported rules)`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { generate } from "../../scripts/extract-prototype-css"

/**
 * `src/styles/counter-components.css` is not written by hand: it is the
 * prototype's own stylesheet, lifted out of docs/counter/counter-prototype.html
 * by scripts/extract-prototype-css.ts. Everything below is asserted against the
 * COMMITTED file, because that is what ships — the generator is only checked
 * for agreeing with it.
 *
 * The parsing here is deliberately its own small implementation rather than an
 * import of the extractor's helpers. The extractor decides what to port; this
 * file decides whether what was ported is safe. Sharing the filter functions
 * between the two would mean a bug in the filter could never be seen from here.
 *
 * The two load-bearing cases are "reads no custom property the alias layer does
 * not supply" and "keeps counter.css the only place a colour VALUE is decided".
 * Both were proved red before being accepted — see task-1-report.md for the
 * exact failures (delete one alias; turn one alias into a literal).
 */

const ROOT = process.cwd()
const CSS = readFileSync(join(ROOT, "src", "styles", "counter-components.css"), "utf-8")
const COUNTER_CSS = readFileSync(join(ROOT, "src", "styles", "counter.css"), "utf-8")
const GLOBALS = readFileSync(join(ROOT, "src", "app", "globals.css"), "utf-8")
const LAYOUT = readFileSync(join(ROOT, "src", "app", "layout.tsx"), "utf-8")

/** `--len`, `--pc` and `--qc` are set inline per element (chart lengths, bar
 *  percentages). A default in the alias layer would mask a component that
 *  forgot to set one, so they are expected to be read and never declared. */
const RUNTIME_VARS = new Set(["--len", "--pc", "--qc"])

/**
 * `--t-small` is read twice and declared nowhere, in the prototype itself, and
 * is left that way on purpose — for a different reason than RUNTIME_VARS.
 *
 * Every read is invalid-at-computed-value-time on an inherited property, so it
 * resolves to the inherited `--t-body`: 13px under `.frame`, 14px under
 * `.pframe`, 13.5px under `.login`. Aliasing it to any one of those pins it to
 * a single value and renders `.pframe .wf__p` (prototype :853) a pixel small.
 * The three-scale invariant that makes this true is asserted below.
 *
 * RUNTIME_VARS are set inline per element; this one is never set at all.
 */
const UNRESOLVED_BY_DESIGN = new Set(["--t-small"])

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, " ")
}

/** Remove every `@keyframes name{…}` block, matching braces. Keyframe
 *  selectors (`from`, `to`, `40%`) name no class because they cannot, and are
 *  not what the bare-element-selector rule is about. */
function withoutKeyframes(css: string): string {
  let out = ""
  let i = 0
  while (i < css.length) {
    const at = css.indexOf("@keyframes", i)
    if (at === -1) {
      out += css.slice(i)
      break
    }
    out += css.slice(i, at)
    const open = css.indexOf("{", at)
    let depth = 1
    let j = open + 1
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth += 1
      else if (css[j] === "}") depth -= 1
      j += 1
    }
    i = j
  }
  return out
}

/** Every `prelude{…}` block in the sheet, at any nesting depth. */
function blocks(css: string): Array<{ prelude: string; body: string }> {
  const out: Array<{ prelude: string; body: string }> = []
  const open: Array<{ prelude: string; from: number }> = []
  let start = 0
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i]
    if (ch === "{") {
      open.push({ prelude: css.slice(start, i).trim(), from: i + 1 })
      start = i + 1
    } else if (ch === "}") {
      const frame = open.pop()
      if (frame) out.push({ prelude: frame.prelude, body: css.slice(frame.from, i) })
      start = i + 1
    } else if (ch === ";") {
      start = i + 1
    }
  }
  return out
}

const RULES = blocks(stripComments(withoutKeyframes(CSS)))
const SELECTORS = RULES.map((r) => r.prelude).filter((p) => !p.startsWith("@"))

function classNames(css: string): Set<string> {
  const out = new Set<string>()
  for (const sel of blocks(stripComments(css)).map((r) => r.prelude)) {
    if (sel.startsWith("@")) continue
    for (const m of sel.matchAll(/\.([a-zA-Z][\w-]*)/g)) out.add(m[1])
  }
  return out
}

/** Split a grouped selector on top-level commas only — the commas inside
 *  `:is(…)`, `:where(…)` and `[data-n="1,2"]` are not group separators. */
function splitGroup(sel: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ""
  for (const ch of sel) {
    if (ch === "(" || ch === "[") depth += 1
    else if (ch === ")" || ch === "]") depth -= 1
    if (ch === "," && depth === 0) {
      out.push(cur)
      cur = ""
    } else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim()).filter(Boolean)
}

function namesAClass(sel: string): boolean {
  return /\.[a-zA-Z][\w-]*/.test(sel)
}

function varsRead(css: string): Set<string> {
  const out = new Set<string>()
  for (const m of stripComments(css).matchAll(/var\(\s*(--[A-Za-z][\w-]*)/g)) out.add(m[1])
  return out
}

function varsDeclared(css: string): Set<string> {
  const out = new Set<string>()
  for (const m of stripComments(css).matchAll(/(?:^|[;{\s])(--[A-Za-z][\w-]*)\s*:/g)) out.add(m[1])
  return out
}

/** Every custom-property declaration, as name + value. */
function customPropertyDeclarations(css: string): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = []
  for (const m of stripComments(css).matchAll(/(?:^|[;{\s])(--[A-Za-z][\w-]*)\s*:([^;{}]*)/g)) {
    out.push({ name: m[1], value: m[2].trim() })
  }
  return out
}

/** Same shape as scripts/counter-lint.ts's COLOUR_LITERAL. */
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\boklch\(|\brgba?\(|\bhsla?\(|\bcolor-mix\(/

const DOC_CHROME = [
  "masthead",
  "scene",
  "idx",
  "pchip",
  "notegrid",
  "speccol",
  "eyebrow",
  "devcap",
  "bareviews",
  "stagehead",
  "notes",
  "spec",
]

const APP_COMPONENTS = [
  "strip",
  "sec",
  "blt",
  "dispatch",
  "headline",
  "askbar",
  "moving",
  "qitem",
  "chan",
  "cbar",
  "wkt",
  "mlist",
  "rail",
  "rt",
]

describe("counter-components.css", () => {
  it("ports the whole application stylesheet and none of the documentation site", () => {
    // The reference extraction keeps 1030 rules and 452 classes. These floors
    // are what stop a regeneration silently shrinking; they are not the number
    // itself, so a genuine prototype edit does not have to touch this test.
    expect(SELECTORS.length).toBeGreaterThanOrEqual(1000)
    const classes = classNames(CSS)
    expect(classes.size).toBeGreaterThanOrEqual(440)
    for (const doc of DOC_CHROME) expect(classes.has(doc)).toBe(false)
    for (const app of APP_COMPONENTS) expect(classes.has(app)).toBe(true)
  })

  it("declares no bare element selector, so nothing leaks past a Counter page", () => {
    // A selector naming no class would apply to the whole application the
    // moment globals.css imports this file — including /login and the ~19
    // editorial routes, which are not Counter at all.
    const bare = SELECTORS.flatMap(splitGroup).filter((part) => !namesAClass(part))
    expect(bare).toEqual([])
  })

  it("reads no custom property the alias layer does not supply", () => {
    const declared = varsDeclared(CSS)
    // Two suppliers outside this file, both verified rather than assumed:
    // counter.css for every --ct-* token, and next/font for the three family
    // variables that src/app/layout.tsx declares.
    const fromCounterCss = varsDeclared(COUNTER_CSS)
    const fromNextFont = new Set(
      [...LAYOUT.matchAll(/variable:\s*"(--[\w-]+)"/g)].map((m) => m[1]),
    )
    expect(fromNextFont).toEqual(
      new Set(["--font-dm-sans", "--font-jetbrains-mono", "--font-bricolage"]),
    )

    const missing = [...varsRead(CSS)].filter(
      (v) =>
        !declared.has(v) &&
        !RUNTIME_VARS.has(v) &&
        !UNRESOLVED_BY_DESIGN.has(v) &&
        !fromCounterCss.has(v) &&
        !fromNextFont.has(v),
    )
    expect(missing.sort()).toEqual([])
  })

  it("supplies no default for the three properties set inline per element", () => {
    // The mirror of the case above: a default here would hide a component
    // that forgot to set one, which is a silently wrong chart, not a crash.
    const declared = varsDeclared(CSS)
    for (const v of RUNTIME_VARS) expect(declared.has(v)).toBe(false)
  })

  it("leaves --t-small undeclared so it keeps resolving per scope", () => {
    // Declaring it anywhere — the alias layer included — turns a reference
    // that resolves to its scope's own --t-body into one fixed value.
    expect(varsDeclared(CSS).has("--t-small")).toBe(false)
    expect(varsRead(CSS).has("--t-small")).toBe(true)
  })

  it("keeps a distinct --t-body at each of the three prototype scopes", () => {
    // This is the invariant --t-small rides on, and the reason the extractor
    // strips only COLOUR-valued custom properties: a blanket strip of every
    // custom property in .frame/.pframe/.login would have flattened all three
    // of these onto the alias layer's single value, and .pframe's whole type
    // scale is a step up from the desk's, not a copy of it.
    const scale = new Map(
      RULES.filter((r) => /^\.(frame|pframe|login)$/.test(r.prelude) && r.body.includes("--t-body"))
        .map((r) => [r.prelude, /--t-body:\s*([\d.]+px)/.exec(r.body)?.[1]]),
    )
    expect(scale.get(".frame")).toBe("13px")
    expect(scale.get(".pframe")).toBe("14px")
    expect(scale.get(".login")).toBe("13.5px")
  })

  it("keeps counter.css the only place a colour VALUE is decided", () => {
    // The port may REFERENCE a token; it may not DEFINE one as a literal.
    // The prototype declares its 33 colour tokens light-only, three times over
    // (.frame, .pframe, .login). Carrying those across would shadow
    // counter.css's light-dark() pairs with a light value and kill dark mode
    // inside exactly the elements this sheet styles — with every existing test
    // still green, because counter.css itself would be untouched.
    const literals = customPropertyDeclarations(CSS).filter((d) =>
      COLOUR_LITERAL.test(d.value),
    )
    expect(literals).toEqual([])
  })

  it("aliases every colour token onto its counter.css source", () => {
    const aliased = new Map(
      customPropertyDeclarations(CSS)
        .filter((d) => /^var\(--ct-[\w-]+\)$/.test(d.value))
        .map((d) => [d.name, d.value.slice(4, -1)]),
    )
    const counterTokens = varsDeclared(COUNTER_CSS)
    for (const [, source] of aliased) expect(counterTokens.has(source)).toBe(true)
    // The 33 colours, plus the type scale, radii and easing curve.
    expect(aliased.size).toBeGreaterThanOrEqual(43)
  })

  it("scopes the alias layer to the Counter roots and nothing wider", () => {
    const aliasRule = RULES.find((r) => r.body.includes("--ct-surface"))
    expect(aliasRule?.prelude).toBe(".ct-root, .frame, .pframe, .login")
  })

  /*
   * `.ct-root` carries `.frame`'s BASE as well as its tokens.
   *
   * The port originally gave `.ct-root` the token declarations alone and left
   * the base — type, ink, ground, container — on `.frame`, which nothing in
   * this application carries. The whole base of the design system was
   * therefore dead: every ported rule that sets a size but no colour painted
   * in the document's ink (near-black on near-black in dark theme), figures
   * inherited 16px/24px/`normal` instead of 13px/19.5px/tabular, and every
   * `@container fr` rule in the file — the strip's 6->3->2 reflow among them —
   * never fired, because `container-name: fr` is declared in exactly one
   * place. Each assertion below is one of those failures, pinned.
   */
  it("gives .ct-root the base .frame carries, so the design has a ground to stand on", () => {
    const base = RULES.find((r) => r.prelude === ".ct-root")
    expect(base, "counter-components.css declares no .ct-root base rule").toBeDefined()
    for (const decl of [
      "font-family: var(--sans)",
      "font-size: var(--t-body)",
      "line-height: 1.5",
      // Without this, a column of figures does not align — and no figure
      // restates it, because the prototype's figures do not either.
      "font-variant-numeric: tabular-nums lining-nums",
      // Without these two, a ported rule that sets a size but no colour paints
      // in whatever ink the document has.
      "color: var(--ink)",
      "background: var(--paper)",
    ]) {
      expect(base!.body).toContain(decl)
    }
  })

  it("names AND types the container, or every @container rule in the file is dead", () => {
    const base = RULES.find((r) => r.prelude === ".ct-root")!
    expect(base.body).toContain("container-name: fr")
    expect(base.body).toContain("container-type: inline-size")
    // Not a hypothetical: the file is written against this container.
    const queries = [...CSS.matchAll(/@container\s+fr\b/g)].length
    expect(queries).toBeGreaterThan(10)
  })

  /*
   * `.ct-phone` carries `.pframe`'s TYPE SCALE, and nothing else.
   *
   * `CT_ROOT_BASE`'s defect, one surface over. The prototype declares two
   * scales — `.frame` at 13px and `.pframe` at 14px, a step up at every step
   * because a phone is held closer and its column is 316px — and `.ct-root`
   * restated only the desk's. The phone surface (`/m`) therefore rendered the
   * entire design at the desk's scale: 76 of its 79 rendering differences
   * against the prototype were `font-size 14px / 13px` and its line-height
   * partner, on every landmark the two sides shared.
   */
  it("gives .ct-phone .pframe's type scale, step for step", () => {
    const phone = RULES.find((r) => r.prelude === ".ct-phone")
    expect(phone, "counter-components.css declares no .ct-phone rule").toBeDefined()
    const pframe = RULES.find((r) => r.prelude === ".pframe")!
    for (const step of ["--t-micro", "--t-cap", "--t-body", "--t-mid", "--t-lg", "--t-xl", "--t-hero"]) {
      const want = new RegExp(`${step}:\\s*([\\d.]+px)`).exec(pframe.body)?.[1]
      const got = new RegExp(`${step}:\\s*([\\d.]+px)`).exec(phone!.body)?.[1]
      expect(got, `${step} on .ct-phone`).toBe(want)
    }
    // The phone is a step UP from the desk, or this class says nothing.
    expect(RULES.find((r) => r.prelude === ".frame")!.body).toContain("--t-body:13px")
    expect(phone!.body).toContain("--t-body: 14px")
  })

  it("declares .ct-phone AFTER .ct-root, so one element can wear both", () => {
    // Equal specificity: the later rule wins. `.ct-phone` overrides the alias
    // layer's `--t-*` on the same element rather than replacing `.ct-root`,
    // which still supplies the ink, the ground and `container-name: fr`.
    expect(CSS.indexOf(".ct-phone {")).toBeGreaterThan(CSS.indexOf(".ct-root {"))
  })

  it("gives .ct-phone nothing but the scale — not .pframe's bezel", () => {
    // 340x718 fixed, a 26px radius and a drop shadow: the documentation
    // page's phone, not an app shell. Same rule as `.ct-root` and `.frame`.
    const phone = RULES.find((r) => r.prelude === ".ct-phone")!
    for (const banned of ["width", "height", "display", "border", "box-shadow", "background", "color:"]) {
      expect(phone.body).not.toContain(banned)
    }
  })

  it("does NOT give .ct-root .frame's demo-card layout", () => {
    // `.frame` is a page-of-documentation wrapper: a fixed 212px grid column,
    // a border, a shadow and a 840px floor. An application shell composes its
    // own layout, and porting these would fight it.
    const base = RULES.find((r) => r.prelude === ".ct-root")!
    for (const banned of ["display:", "grid-template-columns", "min-height", "box-shadow", "border:"]) {
      expect(base.body).not.toContain(banned)
    }
  })

  it("is imported by globals.css after counter.css, so the aliases resolve", () => {
    const counterAt = GLOBALS.indexOf('@import "../styles/counter.css"')
    const componentsAt = GLOBALS.indexOf('@import "../styles/counter-components.css"')
    expect(counterAt).toBeGreaterThan(-1)
    expect(componentsAt).toBeGreaterThan(counterAt)
  })

  it("carries the recorded corrections, and carries them for reasons the gate proved", () => {
    // The ported sheet is byte-identical to the extractor's output (the test
    // below), so a colour that is wrong here cannot be hand-edited — it has to
    // be recorded in the extractor's CORRECTIONS table. Two are recorded.
    //
    // 1. The prototype paints `.dispatch .sep` in a rule colour, which is
    //    1.73:1 against the surface in dark and which the fidelity gate's
    //    contrast pass reports as a defect on the Overview.
    expect(CSS).toContain(".dispatch .sep{color:var(--ink-3)}")
    expect(CSS).not.toContain(".dispatch .sep{color:var(--line-strong)}")
    // And the prototype still says what the correction says it says, so the
    // correction is a divergence rather than a coincidence.
    const proto = readFileSync(
      join(ROOT, "docs", "counter", "counter-prototype.html"),
      "utf-8",
    )
    expect(proto).toContain(".dispatch .sep{color:var(--line-strong)}")
  })

  it("gives BOTH lead-figure deltas a down tone, so a fall cannot read as good news", () => {
    // `.strip .d` and `.mstrip .d` carry `.is-down`/`.is-flat` in the prototype
    // itself; `.headline .d` and `.mhead .d` — the two elements that carry the
    // ONE figure an owner reads first — carry neither, so a 37.2% fall paints
    // var(--good) green on the desk and again on the phone. Both selectors, in
    // one CORRECTIONS entry, because a fix that reached one surface and not the
    // other would BE the defect.
    for (const sel of [".headline .d", ".mhead .d"]) {
      expect(CSS, `${sel} has no down tone`).toContain(`${sel}.is-down{color:var(--bad)}`)
      expect(CSS, `${sel} has no flat tone`).toContain(`${sel}.is-flat{color:var(--ink-3)}`)
    }

    // The prototype still has the gap this corrects — otherwise the entry is
    // forgiving something that no longer exists.
    const proto = readFileSync(
      join(ROOT, "docs", "counter", "counter-prototype.html"),
      "utf-8",
    )
    for (const sel of [".headline .d", ".mhead .d"]) {
      expect(proto, `${sel} unexpectedly gained a tone in the prototype`).not.toContain(
        `${sel}.is-down`,
      )
    }
    // And the two tones are the SAME two the sibling strip rules already use:
    // a correction may only reach for a token the sheet already decided on.
    expect(proto).toContain(".strip .d.is-down{color:var(--bad)}")
    expect(proto).toContain(".mstrip .d.is-flat{color:var(--ink-3)}")
  })

  it("takes the phone sheet's scrim off a token, because the literal inverts in dark", () => {
    // `oklch(24% 0.014 40 / .3)` is --ink's LIGHT value at 30%. Over the dark
    // theme's 19%-lightness ground it composites to ~20.5% — LIGHTER, so the
    // page it is meant to push away comes forward instead, in front of a
    // 22%-lightness sheet. The fidelity gate's dark pass reported it as a
    // literal the first time it ran against /m.
    expect(CSS).toContain(".pshade{position:absolute;inset:0;background:var(--scrim);")
    expect(CSS).not.toContain("background:oklch(24% 0.014 40 / .3)")
    // The token it reaches for is real, aliased, and decided in counter.css.
    expect(CSS).toContain("--scrim: var(--ct-scrim);")
    expect(COUNTER_CSS).toMatch(/--ct-scrim:\s*light-dark\(/)

    const proto = readFileSync(
      join(ROOT, "docs", "counter", "counter-prototype.html"),
      "utf-8",
    )
    expect(proto).toContain(".pshade{position:absolute;inset:0;background:oklch(24% 0.014 40 / .3)")
  })

  it("is exactly what the extractor produces from the prototype today", () => {
    // Regeneration is deterministic, and the committed file is not stale.
    expect(generate()).toBe(CSS)
  })

  it("carries the @keyframes its own rules animate with", () => {
    // A keyframe selector names no class because it cannot, so the
    // class-name filter would drop every keyframes block and leave the ported
    // `animation:` declarations pointing at names that no longer exist —
    // silently dead motion. They are carried across separately instead.
    const defined = new Set(
      [...stripComments(CSS).matchAll(/@keyframes\s+([A-Za-z_-][\w-]*)/g)].map((m) => m[1]),
    )
    const used = new Set<string>()
    for (const m of stripComments(withoutKeyframes(CSS)).matchAll(
      /\banimation(?:-name)?\s*:\s*([^;}]*)/g,
    )) {
      for (const w of m[1].matchAll(/[A-Za-z_-][\w-]*/g)) {
        if (defined.has(w[0])) used.add(w[0])
      }
    }
    expect(used.size).toBeGreaterThan(0)
    expect([...used].filter((n) => !defined.has(n))).toEqual([])
    // Nothing is carried across that no rule animates with.
    expect([...defined].filter((n) => !used.has(n))).toEqual([])
  })
})

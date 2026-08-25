import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const GLOBALS_CSS = join(process.cwd(), "src", "app", "globals.css")

/**
 * Regression test for the bug documented at the `@layer base` comment in
 * globals.css: an UNLAYERED `* { border-color: ... }` rule silently beat
 * every `border-ct-*` utility (which Tailwind v4 puts inside
 * `@layer utilities`), because an unlayered CSS rule always wins over a
 * layered one in the cascade regardless of specificity. That defeated
 * Section's panel border, Table's row rules, Toast/Failed/Empty/Owed
 * borders, and the shell rail's separator from Plan 2 through Plan 4, in
 * both themes, invisibly — jsdom never computes the cascade, so no unit
 * test could see it.
 *
 * This asserts the built-CSS property directly from source text — no build
 * required — the same technique token-parity.test.ts and
 * counter-tokens.test.ts already use.
 */

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "")
}

/**
 * Walk the stylesheet tracking brace nesting and which open braces were
 * introduced by an `@layer <name> {` block. Returns true if a bare `*`
 * selector rule declaring `border-color` exists OUTSIDE any `@layer` block.
 */
function hasUnlayeredUniversalBorderColorRule(css: string): boolean {
  const text = stripComments(css)
  const layerStack: boolean[] = []
  let insideLayerDepth = 0
  let i = 0

  while (i < text.length) {
    const ch = text[i]

    if (ch === "{") {
      let j = i - 1
      while (j >= 0 && !"{};".includes(text[j])) j--
      const header = text.slice(j + 1, i).trim()
      const opensLayer = /^@layer\b/.test(header)
      layerStack.push(opensLayer)
      if (opensLayer) insideLayerDepth++

      if (header === "*" && insideLayerDepth === 0) {
        let depth = 1
        let k = i + 1
        while (k < text.length && depth > 0) {
          if (text[k] === "{") depth++
          else if (text[k] === "}") depth--
          k++
        }
        const body = text.slice(i + 1, k - 1)
        if (/border-color\s*:/.test(body)) return true
      }
      i++
      continue
    }

    if (ch === "}") {
      const opened = layerStack.pop()
      if (opened) insideLayerDepth--
      i++
      continue
    }

    i++
  }

  return false
}

describe("globals.css border cascade layering", () => {
  const css = readFileSync(GLOBALS_CSS, "utf8")

  it("has no unlayered universal border-color rule", () => {
    // A bare `* { border-color: ... }` written outside any @layer beats
    // every layered `border-ct-*` utility regardless of specificity. This
    // must live inside @layer base — see the comment above the rule.
    expect(hasUnlayeredUniversalBorderColorRule(css)).toBe(false)
  })

  it("declares the universal border-color default inside @layer base", () => {
    expect(css).toMatch(
      /@layer base\s*{[^]*?\*\s*{\s*border-color:\s*hsl\(var\(--border\)\)/
    )
  })

  it("catches the historical bug via a synthetic unlayered rule", () => {
    // Sanity check that the detector actually detects the failure mode it
    // exists to catch, not just always returning false.
    const buggy = `
      :root { --border: 0 0% 90%; }
      * {
        border-color: hsl(var(--border));
      }
      @layer utilities {
        .border-ct-line { border-color: var(--ct-line); }
      }
    `
    expect(hasUnlayeredUniversalBorderColorRule(buggy)).toBe(true)
  })
})

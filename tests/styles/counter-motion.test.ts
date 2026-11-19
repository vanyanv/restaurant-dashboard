import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * The app-wide motion layer (`src/styles/counter-motion.css`): it must load
 * after every page sheet so its presses and states win, time everything with
 * the --ct-dur-* tokens (which reduced motion zeroes), and use no colour
 * that is not a token.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8")
const CSS = read("src/styles/counter-motion.css").replace(/\/\*[\s\S]*?\*\//g, "")

describe("app-wide motion layer", () => {
  it("is imported last, after the shared blocks", () => {
    const imports = [...read("src/app/globals.css").matchAll(/@import "\.\.\/styles\/([^"]+)"/g)].map((m) => m[1])
    expect(imports.at(-1)).toBe("counter-motion.css")
  })

  it("times everything with tokens: no raw durations but the spinner's turn and an instant press", () => {
    const raw = [...CSS.matchAll(/(?<![\w-])(\d*\.?\d+)(ms|s)\b/g)].map((m) => m[0])
    expect(raw.filter((d) => d !== ".7s" && d !== "0s")).toEqual([])
    expect(CSS).toMatch(/var\(--ct-dur-spring\)/)
    expect(CSS).toMatch(/var\(--ct-dur-rise\)/)
  })

  it("uses only colour tokens", () => {
    expect(CSS).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(|oklch\(/i)
  })

  it("presses with the tokens: firmer on touch, springing back on the gentle spring", () => {
    const root = read("src/styles/counter.css").replace(/\/\*[\s\S]*?\*\//g, "")
    expect(root).toMatch(/--ct-ease-spring:\s*linear\(/)
    expect(root).toMatch(/@media \(pointer: coarse\)\s*\{\s*:root\s*\{[^}]*--ct-press:/)
    expect(root).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{[^}]*--ct-dur-spring: 0ms/)
    expect(CSS).not.toMatch(/scale\(\.\d+\)\s*;\s*transition-duration:0s/)
    expect(CSS).toMatch(/scale\(var\(--ct-press\)\)/)
  })

  it("animates only transform and opacity: no keyframe or transition moves height, size or spacing", () => {
    for (const file of ["src/styles/counter-motion.css", "src/styles/counter-ui.css"]) {
      const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "")
      for (const k of css.matchAll(/@keyframes [\w-]+\{((?:[^{}]*\{[^}]*\})*)\}/g)) {
        expect(k[1], `${file}: ${k[0].slice(0, 40)}`).not.toMatch(/(?:^|[{;])\s*(?:max-|min-)?(?:height|width|block-size|inline-size|padding[\w-]*|margin[\w-]*|border-width)\s*:/)
      }
      for (const t of css.matchAll(/transition:([^;}]*)/g)) {
        expect(t[1], file).not.toMatch(/\b(?:max-)?(?:height|width|block-size|inline-size)\b/)
      }
    }
  })
})

describe("hover only where there is a pointer that hovers", () => {
  it("every :hover rule in the Counter sheets sits inside @media (hover:hover)", () => {
    const sheets = readdirSync(join(process.cwd(), "src/styles")).filter((f) => f.startsWith("counter") && f.endsWith(".css"))
    for (const f of sheets) {
      let css = read(`src/styles/${f}`).replace(/\/\*[\s\S]*?\*\//g, "")
      // Cut out each @media (hover:hover){...} block, matching braces.
      for (let at = css.indexOf("@media (hover:hover){"); at !== -1; at = css.indexOf("@media (hover:hover){")) {
        let depth = 0
        let end = at
        for (let i = css.indexOf("{", at); i < css.length; i++) {
          if (css[i] === "{") depth++
          else if (css[i] === "}" && --depth === 0) {
            end = i + 1
            break
          }
        }
        css = css.slice(0, at) + css.slice(end)
      }
      expect(css.match(/[^\n]*:hover[^\n]*/g) ?? [], f).toEqual([])
    }
  })
})

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
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
    expect(CSS).toMatch(/var\(--ct-dur-tap\)/)
    expect(CSS).toMatch(/var\(--ct-dur-rise\)/)
  })

  it("uses only colour tokens", () => {
    expect(CSS).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(|oklch\(/i)
  })
})

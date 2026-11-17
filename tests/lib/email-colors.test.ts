/**
 * Emails can't read counter.css, so they carry its light-theme tokens as hex
 * (`src/lib/email-colors.ts`). This keeps the two the same.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { EMAIL, EMAIL_TOKENS, EMAIL_TOKEN_SOURCE, oklchToHex } from "@/lib/email-colors"

const css = readFileSync(join(process.cwd(), "src", "styles", "counter.css"), "utf8")

function lightValue(token: string): string {
  const m = css.match(new RegExp(`${token}:\\s*light-dark\\((oklch\\([^)]*\\))`))
  if (!m) throw new Error(`${token} not found in counter.css`)
  return m[1].replace(/\s+/g, " ")
}

describe("email colours", () => {
  it.each(Object.keys(EMAIL_TOKENS) as Array<keyof typeof EMAIL_TOKENS>)("%s matches counter.css", (k) => {
    expect(EMAIL_TOKENS[k]).toBe(lightValue(EMAIL_TOKEN_SOURCE[k]))
  })

  it("converts oklch to the hex the old emails used", () => {
    expect(oklchToHex("oklch(20.3% 0.01 67)")).toBe("#1a1612")
    expect(EMAIL.brandLine).toBe("#e3d8bc")
    expect(EMAIL.brandCream).toBe("#fff2c9")
  })

  it("the emails use these colours and no hex of their own", () => {
    for (const f of ["src/lib/checks/report.ts", "src/lib/price-alert-email.ts"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8")
      expect(src.match(/#[0-9a-fA-F]{3,6}\b/g) ?? [], f).toEqual([])
    }
  })
})

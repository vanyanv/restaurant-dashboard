import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * The editorial token set is declared once in `editorial-tokens.css` and then
 * MIRRORED onto every surface Radix portals outside `.editorial-surface` — the
 * date-range popover, dropdown menus, dialogs, sheets, and the mobile bottom
 * sheet. Six copies at the time of writing.
 *
 * Copies drift silently. `--ink-faint` was corrected from #a69d92 (2.48:1) to
 * clear AA, and five of the six copies kept the failing value for months:
 * every caption in a dropdown, dialog, sheet or date picker was below AA and
 * nothing said so, because each copy is valid CSS on its own.
 *
 * These tests read the stylesheets as text rather than rendering anything, so
 * they cost nothing and fail the moment a seventh copy appears out of step.
 */

const STYLE_DIR = join(process.cwd(), "src", "styles")

function cssFiles(dir: string): string[] {
  return readdirSync(dir)
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).isFile() && p.endsWith(".css"))
}

/** Every `--token: value;` declaration in the stylesheets, with its location. */
function declarationsOf(token: string): Array<{ file: string; value: string }> {
  const out: Array<{ file: string; value: string }> = []
  for (const path of cssFiles(STYLE_DIR)) {
    const text = readFileSync(path, "utf8")
    const re = new RegExp(`^\\s*${token}:\\s*([^;]+);`, "gm")
    for (const m of text.matchAll(re)) {
      out.push({ file: path.split("/").pop()!, value: m[1].trim() })
    }
  }
  return out
}

function luminance(hex: string): number {
  const h = hex.replace("#", "")
  const parts = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const lin = parts.map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  )
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)]
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

describe("editorial token parity", () => {
  it("declares --ink-faint identically in every copy", () => {
    const decls = declarationsOf("--ink-faint")
    expect(decls.length, "expected several mirrored copies").toBeGreaterThan(1)
    const values = [...new Set(decls.map((d) => d.value.toLowerCase()))]
    expect(
      values,
      `--ink-faint disagrees across copies: ${decls
        .map((d) => `${d.file}=${d.value}`)
        .join(", ")}`
    ).toHaveLength(1)
  })

  it("keeps every mirrored ink token in step with the source", () => {
    // The tokens a portalled surface has to restate for the paper to resolve.
    for (const token of ["--ink", "--ink-muted", "--paper", "--hairline"]) {
      const values = [
        ...new Set(declarationsOf(token).map((d) => d.value.toLowerCase())),
      ]
      expect(values, `${token} disagrees across copies`).toHaveLength(1)
    }
  })
})

describe("caption ink clears AA across the whole page ground", () => {
  // The surface is `linear-gradient(--paper, --paper-deep)`, so a caption's
  // background depends on how far down the page it sits. Checking only against
  // --paper is what let #776d63 (4.70 at the top, 4.31 at the bottom) look
  // safe. Both ends have to pass.
  const value = () => {
    const [first] = declarationsOf("--ink-faint")
    return first.value
  }

  it("passes against the top of the gradient", () => {
    expect(contrast(value(), "#fbf6ee")).toBeGreaterThanOrEqual(4.5)
  })

  it("passes against the bottom of the gradient", () => {
    expect(contrast(value(), "#f4ecdf")).toBeGreaterThanOrEqual(4.5)
  })

  it("would have caught the value this replaced", () => {
    expect(contrast("#776d63", "#f4ecdf")).toBeLessThan(4.5)
    expect(contrast("#a69d92", "#fbf6ee")).toBeLessThan(4.5)
  })
})

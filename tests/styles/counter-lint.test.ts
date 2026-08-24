import { describe, it, expect } from "vitest"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { lintCounter, LEGACY } from "../../scripts/counter-lint"

const FIXTURES = join(process.cwd(), "tests", "styles", "fixtures", "counter-lint")

describe("counter lint", () => {
  const violations = lintCounter([FIXTURES])
  const rules = new Set(violations.map((v) => v.rule))

  it("catches a raw colour literal", () => {
    expect(rules).toContain("no-colour-literal")
  })

  it("catches a Tailwind palette colour", () => {
    expect(rules).toContain("no-tailwind-palette")
  })

  it("catches a page branching on section status", () => {
    expect(rules).toContain("no-status-branch")
  })

  it("catches a direct prisma or server-action import", () => {
    expect(rules).toContain("no-direct-data-import")
  })

  it("catches a direct framer-motion import", () => {
    expect(rules).toContain("no-direct-motion-import")
  })

  it("reports nothing for the compliant fixture", () => {
    expect(violations.filter((v) => v.file.endsWith("good.tsx"))).toEqual([])
  })

  it("reports the real Counter tree clean", () => {
    const real = lintCounter([
      join(process.cwd(), "src", "components", "counter"),
    ])
    expect(real).toEqual([])
  })

  it("reports the whole gated tree clean (legacy exemptions applied)", () => {
    const real = lintCounter([
      join(process.cwd(), "src", "app", "dashboard"),
      join(process.cwd(), "src", "app", "(mobile)", "m"),
      join(process.cwd(), "src", "components", "counter"),
      join(process.cwd(), "src", "lib", "counter"),
    ])
    expect(real).toEqual([])
  })

  it("handles a root that does not exist yet without throwing", () => {
    expect(() =>
      lintCounter([join(process.cwd(), "src", "lib", "counter", "adapters")]),
    ).not.toThrow()
    expect(
      lintCounter([join(process.cwd(), "src", "lib", "counter", "adapters")]),
    ).toEqual([])
  })
})

/**
 * The LEGACY skip list is only trustworthy if it can never silently grow
 * stale. Every entry must:
 *   1. Point at a path that still exists (a deleted-path entry gives false
 *      confidence forever, since it can never fire again).
 *   2. Actually be load-bearing right now: with the legacy exemption turned
 *      off for that one path, linting it must produce at least one
 *      violation. An entry that suppresses nothing is dead weight — the
 *      files under it have already been rewritten onto Counter, and the
 *      phase that was "supposed" to delete the entry already happened.
 *   3. Not be a subpath of (or identical to) another entry — that would be
 *      double coverage of the same files, which hides how much of the tree
 *      is really still legacy.
 */
describe("LEGACY skip list is well-formed", () => {
  for (const entry of LEGACY) {
    it(`${entry.path} exists on disk`, () => {
      expect(existsSync(join(process.cwd(), entry.path))).toBe(true)
    })

    it(`${entry.path} is still suppressing at least one real violation`, () => {
      const root = join(process.cwd(), entry.path)
      const suppressed = lintCounter([root])
      const raw = lintCounter([root], { ignoreLegacy: true })
      expect(raw.length).toBeGreaterThan(suppressed.length)
    })
  }

  it("has no entry that is a subpath of (or duplicate of) another entry", () => {
    for (const a of LEGACY) {
      for (const b of LEGACY) {
        if (a === b) continue
        const isSubpath = a.path === b.path || a.path.startsWith(b.path + "/")
        expect(isSubpath).toBe(false)
      }
    }
  })

  it("carries a non-empty justification naming what removes it", () => {
    for (const entry of LEGACY) {
      expect(entry.reason.trim().length).toBeGreaterThan(0)
    }
  })
})

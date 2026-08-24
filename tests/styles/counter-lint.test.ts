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
 * Fix round 1, FIX 1: a hex colour mentioned only in a trailing `//`
 * comment, or in a block comment that opens on a line with real code, must
 * not fire `no-colour-literal` — and the one real violation in the fixture
 * must still be reported on its true line number, not shifted by the
 * comments around it.
 */
describe("FIX 1: comments are stripped before matching", () => {
  const found = lintCounter([FIXTURES]).filter((v) => v.file.endsWith("comments.tsx"))

  it("reports exactly one violation: the real one, on its real line", () => {
    expect(found).toEqual([
      {
        file: expect.stringContaining("comments.tsx"),
        line: 8,
        rule: "no-tailwind-palette",
        text: expect.stringContaining("bg-sky-500"),
      },
    ])
  })

  it("does not fire no-colour-literal for the commented-out hex values", () => {
    expect(found.some((v) => v.rule === "no-colour-literal")).toBe(false)
  })
})

/**
 * Fix round 1, FIX 2: dynamic `import("...")` / `require("...")` forms are
 * exactly what someone reaches for once a static `from "..."` import starts
 * failing the gate, so both rules must catch them too.
 */
describe("FIX 2: dynamic import()/require() forms are caught", () => {
  const found = lintCounter([FIXTURES]).filter((v) => v.file.endsWith("dynamic-imports.tsx"))

  it("catches a dynamic framer-motion import", () => {
    expect(found).toContainEqual(
      expect.objectContaining({ rule: "no-direct-motion-import", line: 5 }),
    )
  })

  it("catches a require()'d prisma import", () => {
    expect(found).toContainEqual(
      expect.objectContaining({ rule: "no-direct-data-import", line: 10 }),
    )
  })
})

/**
 * Fix round 1, FIX 3: no-status-branch protects pages, not adapters.
 * src/lib/counter/** constructs SectionData and may branch on whatever it
 * likes (including an ordinary HTTP response status); an app route may
 * still not branch on SectionData.status.
 */
describe("FIX 3: no-status-branch is scoped away from lib/counter", () => {
  it("does not fire inside a path under lib/counter", () => {
    const found = lintCounter([
      join(FIXTURES, "status-scope", "lib", "counter", "adapters"),
    ])
    expect(found).toEqual([])
  })

  it("still fires for an app-route-shaped fixture outside lib/counter", () => {
    const found = lintCounter([join(FIXTURES, "status-scope", "app", "dashboard")])
    expect(found).toContainEqual(
      expect.objectContaining({ rule: "no-status-branch" }),
    )
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

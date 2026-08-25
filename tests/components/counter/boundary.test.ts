import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const BARREL = join(process.cwd(), "src/components/counter/index.ts")
const SURFACE = join(process.cwd(), "src/components/counter/surface")
const STATE = join(process.cwd(), "src/components/counter/state")
const SHELL = join(process.cwd(), "src/components/counter/shell")
const ASK = join(process.cwd(), "src/components/counter/ask")

describe("the Counter public surface", () => {
  it("re-exports every surface primitive, so a page imports from one place", () => {
    const barrel = readFileSync(BARREL, "utf8")
    for (const f of readdirSync(SURFACE).filter((f) => f.endsWith(".tsx"))) {
      const name = f.replace(/\.tsx$/, "")
      expect(barrel).toMatch(new RegExp(`from "\\./surface/${name}"`))
    }
  })

  // shell/ is the visible frame (Wordmark, Rail, AppShell, EntryItem) — the
  // same "a page imports from one place" reasoning as surface/ applies: a
  // page has no business reaching src/components/counter/shell/rail
  // directly when the barrel exists. Held to the identical rule rather than
  // a shell-specific one, so a new shell/*.tsx file fails this test the
  // same way a new surface/*.tsx file would if someone forgot the export.
  it("re-exports every shell primitive, so a page imports from one place", () => {
    const barrel = readFileSync(BARREL, "utf8")
    for (const f of readdirSync(SHELL).filter((f) => f.endsWith(".tsx"))) {
      const name = f.replace(/\.tsx$/, "")
      expect(barrel).toMatch(new RegExp(`from "\\./shell/${name}"`))
    }
  })

  // ask/ is the ⌘K surface — a single file today, but the same "a page
  // imports from one place" reasoning as surface/ and shell/ applies: a
  // page has no business reaching src/components/counter/ask/ask-surface
  // directly when the barrel already re-exports it. Held to the identical
  // rule so a second ask/*.tsx file (a results pane, a history list, ...)
  // fails this test the same way a forgotten surface/ or shell/ export
  // would, rather than silently working unexported.
  it("re-exports every ask primitive, so a page imports from one place", () => {
    const barrel = readFileSync(BARREL, "utf8")
    for (const f of readdirSync(ASK).filter((f) => f.endsWith(".tsx"))) {
      const name = f.replace(/\.tsx$/, "")
      expect(barrel).toMatch(new RegExp(`from "\\./ask/${name}"`))
    }
  })

  it("does NOT re-export the state components — they belong to surface/ alone", () => {
    const barrel = readFileSync(BARREL, "utf8")
    expect(barrel).not.toMatch(/\.\/state\//)
  })

  it("state components are imported only by surface components", () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) {
          if (p !== STATE && p !== SURFACE) walk(p)
          continue
        }
        if (!p.endsWith(".tsx") && !p.endsWith(".ts")) continue
        if (readFileSync(p, "utf8").includes("counter/state/")) offenders.push(p)
      }
    }
    walk(join(process.cwd(), "src"))
    expect(offenders).toEqual([])
  })
})

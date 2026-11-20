import { describe, it, expect } from "vitest"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  checkSource,
  findPageLayoutViolations,
  measureLayout,
  KNOWN,
  MAX_OPEN_BLOCKS,
} from "../../scripts/page-layout-lint"
import { COUNTER_ROUTE_GROUPS } from "../../scripts/counter-lint"

const blocks = (n: number) => Array.from({ length: n }, (_, i) => `<Section title="s${i}" />`).join("\n")
const FIXTURES = join(process.cwd(), "tests", "styles", "fixtures", "page-layout")

describe("page layout lint", () => {
  it("passes a page with the answer and four blocks", () => {
    expect(checkSource("a.tsx", blocks(MAX_OPEN_BLOCKS))).toEqual([])
  })

  it("fails a page stacking more blocks than that with no tabs", () => {
    const v = checkSource("a.tsx", blocks(MAX_OPEN_BLOCKS + 1))
    expect(v.map((x) => x.rule)).toEqual(["page-too-long"])
  })

  it("trusts a page that uses the shared Tabs", () => {
    expect(checkSource("a.tsx", `<Tabs items={t} active="a" label="View" />\n${blocks(9)}`)).toEqual([])
  })

  it("fails a fold that holds the rest of the page", () => {
    const v = checkSource("a.tsx", `<Section title="answer" />\n<Fold summary="Every figure, as before">\n${blocks(3)}\n</Fold>`)
    expect(v.map((x) => x.rule)).toEqual(["fold-holds-a-page"])
    expect(v[0].line).toBe(2)
  })

  it("does not count blocks inside a fold as open, or blocks in comments", () => {
    const src = `${blocks(4)}\n// <Section title="old" />\n<Fold summary="x">\n<Card />\n<Card />\n</Fold>\n<Section title="after" />`
    expect(checkSource("a.tsx", src)).toEqual([])
  })

  it("reads a string holding \"/*\" as a string, not a comment", () => {
    const src = `<input accept="image/*" />\n${blocks(MAX_OPEN_BLOCKS + 1)}\n{/* note */}`
    expect(checkSource("a.tsx", src).map((x) => x.rule)).toEqual(["page-too-long"])
  })

  it("takes tags on one line in source order", () => {
    const m = measureLayout(`<Fold summary="x"><Card /></Fold><Card /><Card />`)
    expect(m.folds).toEqual([{ line: 1, blocks: 1 }])
    expect(m.openBlocks).toBe(2)
  })

  it("checks a page.tsx that renders its own sections", () => {
    const dir = mkdtempSync(join(tmpdir(), "page-layout-"))
    writeFileSync(join(dir, "page.tsx"), blocks(MAX_OPEN_BLOCKS + 1))
    const v = findPageLayoutViolations([dir], [])
    expect(v.map((x) => x.rule)).toEqual(["page-too-long"])
  })

  it("passes the compliant fixture", () => {
    expect(findPageLayoutViolations([FIXTURES], [])).toEqual([])
  })

  it("flags a known-list entry that no longer breaks the rules", () => {
    const fine = "tests/styles/fixtures/page-layout/fine.tsx"
    const v = findPageLayoutViolations([FIXTURES], [fine])
    expect(v.map((x) => x.rule)).toEqual(["page-layout-known-stale"])
  })

  it("flags a known-list entry whose file is gone", () => {
    const gone = "tests/styles/fixtures/page-layout/gone.tsx"
    const v = findPageLayoutViolations([FIXTURES], [gone])
    expect(v.map((x) => x.rule)).toEqual(["page-layout-known-stale"])
  })

  it("reports the real tree clean with today's known list", () => {
    expect(findPageLayoutViolations(COUNTER_ROUTE_GROUPS)).toEqual([])
  })

  it("keeps the known list from growing past the 40 files of 2026-11-20", () => {
    expect(KNOWN.length).toBeLessThanOrEqual(40)
    expect(new Set(KNOWN).size).toBe(KNOWN.length)
  })
})

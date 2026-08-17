// stripJargon removes model vocabulary from operator-facing briefing text.
//
// It is applied per *chunk*, and briefing chunks render as adjacent inline
// spans — so the space joining a text chunk to the number beside it lives at
// that chunk's own edge. A trailing `.trim()` therefore ate it, and the
// Decisions briefing shipped reading "Food cost forecast at23.4%",
// "trends+8.1%next 7 days" and "plus49more". These tests pin the edge
// behaviour so the whitespace can't be trimmed away again.

import { describe, it, expect } from "vitest"
import { stripJargon } from "@/app/dashboard/decisions/lib/translate"

describe("stripJargon — chunk edge whitespace", () => {
  it("keeps the trailing space that joins a chunk to the number after it", () => {
    expect(stripJargon("Food cost forecast at ")).toBe("Food cost forecast at ")
  })

  it("keeps a leading space", () => {
    expect(stripJargon(" next 7 days")).toBe(" next 7 days")
  })

  it("keeps both edges", () => {
    expect(stripJargon(" plus ")).toBe(" plus ")
  })

  it("leaves a chunk with no edge whitespace alone", () => {
    expect(stripJargon("Revenue tracks flat.")).toBe("Revenue tracks flat.")
  })

  it("collapses runs of whitespace to a single space at each edge", () => {
    expect(stripJargon("  plus   more   ")).toBe(" plus more ")
  })

  it("returns empty when the whole chunk was jargon", () => {
    expect(stripJargon(" MAPE ")).toBe("")
  })
})

describe("stripJargon — jargon removal still works", () => {
  it("strips model vocabulary", () => {
    expect(stripJargon("Revenue WAPE was high")).not.toMatch(/WAPE/)
    expect(stripJargon("computed via MinTrace")).not.toMatch(/MinTrace/)
    expect(stripJargon("p50 forecast")).not.toMatch(/p50/)
  })

  it("does not leave a space stranded before punctuation", () => {
    expect(stripJargon("forecast MAPE.")).toBe("forecast.")
  })

  it("assembles into a readable sentence across chunks", () => {
    // How the renderer concatenates: text chunk, number chunk, text chunk.
    const line =
      stripJargon("Food cost forecast at ") + "23.4%" + stripJargon(".")
    expect(line).toBe("Food cost forecast at 23.4%.")
  })
})

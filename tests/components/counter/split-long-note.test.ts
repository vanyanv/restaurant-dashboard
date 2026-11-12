import { describe, expect, it } from "vitest"
import { splitLongNote } from "@/components/counter/surface/note"

const tail =
  " Commission rates still at the default are marked so you can check them against your contracts, which is the only place the real rate lives."

describe("splitLongNote", () => {
  it("leaves a short note alone", () => {
    expect(splitLongNote("Short and plain.")).toBeNull()
  })

  it("keeps the first sentence as the lead and folds the rest", () => {
    const s = splitLongNote(`Glendale has fixed labor saved as $0, and the P&L uses that zero.${tail}`)
    expect(s?.lead).toBe("Glendale has fixed labor saved as $0, and the P&L uses that zero.")
    expect(s?.rest).toMatch(/^Commission rates/)
  })

  it("does not end the lead at an abbreviation in a store name", () => {
    const s = splitLongNote(
      `St. James Restaurant on North Glendale Avenue has fixed labor saved as $0, and the P&L uses that zero.${tail}`,
    )
    expect(s?.lead).toBe(
      "St. James Restaurant on North Glendale Avenue has fixed labor saved as $0, and the P&L uses that zero.",
    )
  })
})

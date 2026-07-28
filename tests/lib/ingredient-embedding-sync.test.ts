import { describe, it, expect, vi } from "vitest"
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
import { buildCanonicalIngredientText } from "@/lib/ingredient-embedding-sync"

describe("buildCanonicalIngredientText", () => {
  it("folds name, category and aliases into one string", () => {
    const text = buildCanonicalIngredientText("Ground Beef 73/27", "Protein", [
      "GRND BEEF 73/27 CREEKSTONE",
    ])
    expect(text).toContain("Ground Beef 73/27")
    expect(text).toContain("Protein")
    expect(text).toContain("GRND BEEF 73/27 CREEKSTONE")
  })

  it("omits the category segment when null", () => {
    const text = buildCanonicalIngredientText("Kosher Salt", null, [])
    expect(text).toContain("Kosher Salt")
    expect(text.toLowerCase()).not.toContain("null")
  })
})

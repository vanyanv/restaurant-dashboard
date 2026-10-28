// The photo map points at files copied from chrisneddys.com. A renamed or
// missing file would render a blank frame with no error, so the map and the
// folder are checked against each other here.

import { describe, it, expect } from "vitest"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { allPhotoIds, photoFrame } from "@/lib/counter/menu-photos"
import { allIngredientPhotoIds, ingredientPhoto } from "@/lib/counter/ingredient-photos"

const DIR = join(process.cwd(), "public", "menu-photos")

describe("menu photos", () => {
  it("has a full shot and a thumbnail for every photo the map names", () => {
    const missing = allPhotoIds().flatMap((id) =>
      [`${id}.webp`, `${id}-thumb.webp`].filter((f) => !existsSync(join(DIR, f))),
    )
    expect(missing).toEqual([])
  })

  it("serves the Eddy's Way shot when asked, and Chris's Way by default", () => {
    expect(photoFrame("Double Slider")?.full).toBe("/menu-photos/chris-n-eddy-s-slider-chris.webp")
    expect(photoFrame("Double Slider", "eddy")?.thumb).toBe("/menu-photos/chris-n-eddy-s-slider-eddy-thumb.webp")
    // One-way items fall back to their only shot.
    expect(photoFrame("Grilled Cheese", "eddy")?.full).toBe("/menu-photos/grilled-cheese.webp")
  })

  it("carries the site's measured framing, and none for a dish with no photo", () => {
    expect(photoFrame("Double Slider")).toMatchObject({ focus: 87, zoom: 109 })
    expect(photoFrame("Not On The Menu")).toBeNull()
  })
})

describe("ingredient photos", () => {
  const DIR_ING = join(process.cwd(), "public", "ingredient-photos")

  it("has a full shot and a thumbnail for every photo the map names", () => {
    const missing = allIngredientPhotoIds().flatMap((id) =>
      [`${id}.webp`, `${id}-thumb.webp`].filter((f) => !existsSync(join(DIR_ING, f))),
    )
    expect(missing).toEqual([])
  })

  it("matches the catalogue name in any case and spacing", () => {
    expect(ingredientPhoto("American Cheese Yellow 160")?.thumb).toBe("/ingredient-photos/american-cheese-thumb.webp")
    expect(ingredientPhoto("  martins bread potato roll  sandwich 3.5 inch")?.full).toBe("/ingredient-photos/potato-roll.webp")
    expect(ingredientPhoto("Something Else")).toBeNull()
  })
})

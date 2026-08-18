// Station resolution runs on product name BEFORE stored category, because the
// stored categories are unreliable: House Sauce is filed under "Other" and its
// cup under nothing, which together are 18% of 90-day spend.

import { describe, it, expect } from "vitest"
import { stationFor, isPackagingStation, PANTRY_STATIONS } from "@/lib/pantry-stations"

describe("stationFor", () => {
  it("routes packaging categories to Packaging & Supplies regardless of name", () => {
    expect(stationFor("container foam hinged white", "Paper/Supplies")).toBe("Packaging & Supplies")
    expect(stationFor("keyston sanitizer multi quat liq", "Cleaning")).toBe("Packaging & Supplies")
    expect(stationFor("napkin dispenser", "Equipment")).toBe("Packaging & Supplies")
  })

  it("resolves by product name when the stored category is wrong or missing", () => {
    expect(stationFor("chris & eddy's house sauce", "Other")).toBe("Sauce & Condiment")
    expect(stationFor("chris & eddy's house sauce cup", null)).toBe("Sauce & Condiment")
    expect(stationFor("ketchup packets foil", "Dry Goods")).toBe("Sauce & Condiment")
  })

  it("falls back to the stored category when the name says nothing", () => {
    expect(stationFor("packer onion sweet fresh", "Produce")).toBe("Produce")
    expect(stationFor("some unlabelled item", "Bakery")).toBe("Bread & Bakery")
  })

  it("prefers dairy over frozen for frozen dairy products", () => {
    // "whole frozen butter solid usda aa unsalted" matches /frozen/ and /butter/.
    // Butter belongs with dairy; only the fry programme belongs to Fry & Frozen.
    expect(stationFor("whole frozen butter solid usda aa unsalted", "Dairy")).toBe("Dairy & Ice Cream")
    expect(stationFor("lamb potato fry ss 1/4 stealth", "Frozen")).toBe("Fry & Frozen")
  })

  it("routes the anchor products of the menu correctly", () => {
    expect(stationFor("ground beef fine grnd 73/27 creekstone", "Meat")).toBe("Beef & Protein")
    expect(stationFor("martins bread potato roll sandwich 3.5 inch", "Bakery")).toBe("Bread & Bakery")
    expect(stationFor("soda coke mexican glass", "Beverages")).toBe("Drinks")
    expect(stationFor("whole class ice cream mix soft serve vanilla 5%", "Dairy")).toBe("Dairy & Ice Cream")
  })

  it("falls back to Dry Goods when nothing matches", () => {
    expect(stationFor("kosher flake coarse salt", "Dry Goods")).toBe("Dry Goods")
    expect(stationFor("mystery item", null)).toBe("Dry Goods")
  })

  it("only flags the packaging station as packaging", () => {
    expect(isPackagingStation("Packaging & Supplies")).toBe(true)
    expect(isPackagingStation("Beef & Protein")).toBe(false)
  })

  it("lists every station it can return, packaging last", () => {
    const produced = new Set<string>(PANTRY_STATIONS)
    expect(produced.has("Dry Goods")).toBe(true)
    expect(PANTRY_STATIONS[PANTRY_STATIONS.length - 1]).toBe("Packaging & Supplies")
  })
})

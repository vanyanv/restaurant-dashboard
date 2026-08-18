import { describe, it, expect } from "vitest"
import { normalizeVendorName, vendorMatchKey } from "@/lib/vendor-normalize"

describe("normalizeVendorName", () => {
  it("collapses known vendor spellings onto one display name", () => {
    expect(normalizeVendorName("VITCO FOODSERVICE")).toBe("Vitco Foodservice")
    expect(normalizeVendorName("Vitco Food Service")).toBe("Vitco Foodservice")
    expect(normalizeVendorName("Sysco Los Angeles, Inc.")).toBe("Sysco")
  })

  it("passes unknown vendors through with their raw casing", () => {
    expect(normalizeVendorName("  Bear State Kitchen ")).toBe("Bear State Kitchen")
    expect(normalizeVendorName("BEAR STATE KITCHEN")).toBe("BEAR STATE KITCHEN")
  })
})

describe("vendorMatchKey", () => {
  it("gives casing variants of a known vendor one key", () => {
    expect(vendorMatchKey("VITCO FOODSERVICE")).toBe(vendorMatchKey("Vitco Foodservice"))
    expect(vendorMatchKey("Premier Meats")).toBe(vendorMatchKey("Premier Meats & Crystal Bay"))
  })

  it("gives casing variants of an UNKNOWN vendor one key too", () => {
    // normalizeVendorName cannot do this — it is why the key exists.
    expect(normalizeVendorName("BEAR STATE KITCHEN")).not.toBe(
      normalizeVendorName("Bear State Kitchen")
    )
    expect(vendorMatchKey("BEAR STATE KITCHEN")).toBe(vendorMatchKey("Bear State Kitchen"))
  })

  it("treats punctuation and repeated whitespace as noise", () => {
    expect(vendorMatchKey("Ben E. Keith")).toBe(vendorMatchKey("ben e keith"))
    expect(vendorMatchKey("Acme  Foods,  Inc.")).toBe("acme foods inc")
  })

  it("never emits leading or trailing separators", () => {
    expect(vendorMatchKey("  ***Acme*** ")).toBe("acme")
  })
})

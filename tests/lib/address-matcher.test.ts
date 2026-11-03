import { describe, expect, it } from "vitest"
import {
  addressSimilarity,
  matchInvoiceToStore,
  verifyByStreetAndZip,
  VERIFIED_FUZZY_CONFIDENCE,
} from "@/lib/address-matcher"

// This account's stores, as stored.
const STORES = [
  { id: "glendale", address: "1360 Colorado Blvd, Glendale, CA 91205, USA" },
  { id: "hollywood", address: "5539 Sunset Blvd, Los Angeles, CA 90028, USA" },
  { id: "vannuys", address: "14523 Sherman Way, Van Nuys, CA 91405, USA" },
]

describe("matchInvoiceToStore — addresses that sat in review", () => {
  it("reads a number fused to its directional (Premier Meats, Glendale, 2026-10-29 / 11-02)", () => {
    for (const addr of ["1360E Colorado St, Glendale, CA 91205", "1360E COLORADO ST, GLENDALE, CA 91205"]) {
      expect(matchInvoiceToStore(addr, STORES)).toEqual({ storeId: "glendale", confidence: 1 })
    }
  })

  it("reads a number fused to a unit letter (Premier Deli, Van Nuys, 2026-10-19)", () => {
    expect(matchInvoiceToStore("14523A Sherman Way, Van Nuys, CA 91405", STORES)).toEqual({
      storeId: "vannuys",
      confidence: 1,
    })
  })

  it("verifies IFS's truncated number by street + ZIP when no other store shares the ZIP", () => {
    expect(matchInvoiceToStore("1452 A SHERMAN WAY, VAN NUYS, CA 91405", STORES)).toEqual({
      storeId: "vannuys",
      confidence: VERIFIED_FUZZY_CONFIDENCE,
    })
  })

  it("does NOT verify a truncated number when another store is in the same ZIP", () => {
    const crowded = [...STORES, { id: "vannuys-2", address: "15000 Sherman Way, Van Nuys, CA 91405" }]
    expect(matchInvoiceToStore("1452 A SHERMAN WAY, VAN NUYS, CA 91405", crowded)?.confidence).toBe(0.75)
  })

  it("does NOT verify a truncated number on a different street", () => {
    expect(verifyByStreetAndZip("1452 Victory Blvd, Van Nuys, CA 91405", STORES[2].address!, [])).toBe(false)
  })

  it("does NOT verify without a ZIP", () => {
    expect(verifyByStreetAndZip("1452 A Sherman Way, Van Nuys, CA", STORES[2].address!, [])).toBe(false)
  })

  it("still refuses a different street number", () => {
    expect(addressSimilarity("1361 E Colorado St, Glendale, CA 91205", STORES[0].address!)).toBe(0)
    expect(matchInvoiceToStore("1999 Colorado St, Glendale, CA 91205", STORES)).toBeNull()
  })
})

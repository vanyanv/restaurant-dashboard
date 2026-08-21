import { describe, it, expect } from "vitest"
import { shortStoreLabels } from "@/lib/dashboard/store-label"

describe("shortStoreLabels", () => {
  it("drops a brand prefix every store shares", () => {
    expect(
      shortStoreLabels([
        "Chris N Eddys - Hollywood",
        "Chris N Eddys - Glendale",
        "Chris N Eddys - Van Nuys",
      ])
    ).toEqual(["Hollywood", "Glendale", "Van Nuys"])
  })

  it("accepts en and em dashes as separators", () => {
    expect(
      shortStoreLabels(["Brand — North", "Brand – South"])
    ).toEqual(["North", "South"])
  })

  it("ignores case when deciding the prefix is shared", () => {
    expect(
      shortStoreLabels(["CHRIS N EDDYS - Hollywood", "Chris N Eddys - Glendale"])
    ).toEqual(["Hollywood", "Glendale"])
  })

  it("leaves names alone when the prefixes differ", () => {
    const names = ["Chris N Eddys - Hollywood", "Other Brand - Glendale"]
    expect(shortStoreLabels(names)).toEqual(names)
  })

  it("leaves a single unseparated name alone", () => {
    expect(shortStoreLabels(["Hollywood"])).toEqual(["Hollywood"])
  })

  it("never strips a name down to nothing", () => {
    const names = ["Brand - ", "Brand - Glendale"]
    expect(shortStoreLabels(names)).toEqual(names)
  })

  it("handles an empty list", () => {
    expect(shortStoreLabels([])).toEqual([])
  })

  it("keeps a single store's own suffix when it has one", () => {
    expect(shortStoreLabels(["Chris N Eddys - Hollywood"])).toEqual(["Hollywood"])
  })
})

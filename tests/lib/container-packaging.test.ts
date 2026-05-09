import { describe, expect, it } from "vitest"
import { packOrderCostAware, type ContainerGroup } from "@/lib/container-packaging"

const GROUP_COSTS: Record<ContainerGroup, number> = {
  medium_6x6: 0.084,
  large_9x6: 0.153,
  one_compartment: 0.162,
}

describe("packOrderCostAware", () => {
  it("packs three 1 Slider Combos as three medium 6x6 boxes when cheaper", () => {
    const result = packOrderCostAware(
      {
        fulfillmentMode: "FULFILLMENT_MODE_PICKUP",
        items: [
          {
            name: "1 Slider Combo",
            quantity: 3,
            subItems: [{ name: "Eddy Way", quantity: 1, subHeader: null }],
          },
        ],
      },
      GROUP_COSTS
    )

    expect(result.classification.normalizedSignature).toBe("3 burger + 3 fries")
    expect(result.counts).toEqual({
      medium_6x6: 3,
      large_9x6: 0,
      one_compartment: 0,
    })
    expect(result.packing.chosenAlternative).toBe("3x(1 slider + fries) as medium 6x6")
  })
})

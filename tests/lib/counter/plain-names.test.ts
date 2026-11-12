import { describe, expect, it } from "vitest"
import { plainName } from "@/lib/counter/plain-names"

describe("plainName", () => {
  it("says what the owner calls it", () => {
    expect(plainName("lamb potato fry ss 1/4 stealth")).toBe("Fries")
    expect(plainName("chris & eddy's house sauce cup 1.5 oz")).toBe("House sauce cups 1.5 oz")
    expect(plainName("chris & eddy's house sauce")).toBe("House sauce")
    expect(plainName("greeno lid flat with hole 20 oz pe pet")).toBe("20 oz lids")
    expect(plainName("greeno cup pet 20 oz c&d pet")).toBe("20 oz cups")
    expect(plainName("erthpls lid plastic clear dome for burrito")).toBe("Burrito bowl lids")
    expect(plainName("chrsned bag plas tshirt logo ptsbchrisneddy")).toBe("Logo bags")
    expect(plainName("bag t-shirt white 12x7x22 17mic with warning")).toBe("Plain t-shirt bags")
  })
  it("never guesses: an unknown item keeps its invoice text", () => {
    expect(plainName("pickle chips kosher")).toBe("Pickle chips kosher")
  })
})

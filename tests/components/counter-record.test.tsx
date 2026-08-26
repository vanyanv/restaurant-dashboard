// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { Record } from "@/components/counter"

describe("Record", () => {
  it("renders one mark per day, in order, tagged hit or miss", () => {
    const { container } = render(<Record marks={["hit", "hit", "miss", "hit"]} />)
    const marks = container.querySelectorAll(".record i")
    expect(marks).toHaveLength(4)
    // `.record i` alone carries the hit colour and `.record i.m` carries the
    // miss colour — the prototype's `rec()` (counter-prototype.html:3711)
    // marks a miss with class "m" and leaves a hit with no class at all.
    // counter-components.css only has rules for `.record i` and `.record i.m`
    // (src/styles/counter-components.css:406-408); there is no `.record
    // i.miss` rule. The brief's test asserted className literally equal to
    // "hit"/"miss", which would leave a miss mark wearing the hit colour.
    // Corrected here to the class the CSS actually keys on.
    expect([...marks].map((m) => m.className)).toEqual(["", "", "m", ""])
  })

  it("renders an empty record without crashing", () => {
    const { container } = render(<Record marks={[]} />)
    expect(container.querySelectorAll(".record")).toHaveLength(1)
    expect(container.querySelectorAll(".record i")).toHaveLength(0)
  })
})

// @vitest-environment jsdom
/**
 * Store checks opens with the shared Answer and BigNumber, the same blocks
 * P&L and Invoices use, on the desk Today and Report tabs and the phone.
 */
import { describe, it, expect, vi } from "vitest"
import { render } from "@testing-library/react"

vi.mock("@/lib/counter/actions/checks", () => ({ reviewCheckPhoto: vi.fn(), reviewCheckPhotos: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))

import { PlainHead } from "@/app/dashboard/(counter)/checks/checks-plain-ui"

const base = { sentence: "Every check was done on time yesterday.", figure: "92%", figureLabel: "on time · 11 of 12", deltaLabel: "vs last week" }

describe("Store checks PlainHead", () => {
  it("draws the sentence and the figure with the shared blocks", () => {
    const { container } = render(<PlainHead {...base} delta={4} />)
    expect(container.querySelector(".cu-answer")?.textContent).toBe(base.sentence)
    expect(container.querySelector(".cu-big__value")?.textContent).toBe("92%")
    expect(container.querySelector(".cu-big__label")?.textContent).toBe("on time · 11 of 12")
    expect(container.querySelector(".cu-vs--up")?.textContent).toBe("▲ 4 pts")
    expect(container.querySelector(".cu-big__vs")?.textContent).toBe("▲ 4 pts vs last week")
  })

  it("says a drop in red and no change in words", () => {
    const down = render(<PlainHead {...base} delta={-3} />).container
    expect(down.querySelector(".cu-vs--down")?.textContent).toBe("▼ 3 pts")
    const same = render(<PlainHead {...base} delta={0} />).container
    expect(same.querySelector(".cu-big__vs")?.textContent).toBe("Same as last week")
  })

  it("draws no figure row when nothing was due", () => {
    const { container } = render(<PlainHead {...base} figure={null} delta={null} />)
    expect(container.querySelector(".cu-answer")).not.toBeNull()
    expect(container.querySelector(".cu-big")).toBeNull()
  })
})

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, fireEvent } from "@testing-library/react"

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/pnl",
  useSearchParams: () => new URLSearchParams(window.location.search),
}))

import { PageTabs, StoreCard, Tabs } from "@/components/counter/ui"

const CARD = {
  name: "Hollywood",
  status: { tone: "good" as const, label: "On track" },
  figures: [{ label: "Sales", value: "$21,940" }],
}

describe("StoreCard that opens in place", () => {
  it("is a closed <details> whose button inside does what the whole card used to", () => {
    const onClick = vi.fn()
    const { container, getByText } = render(
      <StoreCard {...CARD} onClick={onClick} more={[{ label: "Food", value: "30¢ of each dollar" }]} moreAction="Show only Hollywood" />,
    )
    const d = container.querySelector("details")!
    expect(d.open).toBe(false)
    expect(d.querySelector("summary")!.textContent).toContain("$21,940")
    expect(d.querySelector("dd")!.textContent).toBe("30¢ of each dollar")
    fireEvent.click(getByText("Show only Hollywood"))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
  it("stays the plain pressable card without `more`", () => {
    const { container } = render(<StoreCard {...CARD} onClick={() => {}} />)
    expect(container.querySelector("details")).toBeNull()
    expect(container.querySelector("button.cu-store")).not.toBeNull()
  })
  it("treats an empty `more` as none", () => {
    const { container } = render(<StoreCard {...CARD} onClick={() => {}} more={[]} />)
    expect(container.querySelector("details")).toBeNull()
  })
})

describe("Tabs sliding highlight", () => {
  it("hands the highlight to the pill once the picked tab is measured", () => {
    const { container } = render(
      <Tabs label="Period" active="b" items={[{ key: "a", label: "A" }, { key: "b", label: "B" }]} onSelect={() => {}} />,
    )
    const track = container.querySelector<HTMLElement>(".cu-tabs__in")!
    expect(track.dataset.pill).toBe("on")
    expect(track.style.getPropertyValue("--cu-pill-x")).toMatch(/px$/)
    expect(track.querySelector(".cu-tabs__pill")!.getAttribute("aria-hidden")).toBe("true")
  })
})

describe("PageTabs panel direction", () => {
  const TABS = [
    { key: "one", label: "One", content: <p>1</p> },
    { key: "two", label: "Two", content: <p>2</p> },
    { key: "three", label: "Three", content: <p>3</p> },
  ]
  it("does not slide on arrival, then comes in from the side the pick moved toward", () => {
    window.history.replaceState(null, "", "/dashboard/pnl")
    const { container, rerender } = render(<PageTabs label="Views" tabs={TABS} />)
    const panel = (k: string) => container.querySelector<HTMLElement>(`[data-tab="${k}"]`)!
    expect(panel("one").dataset.dir).toBeUndefined()
    fireEvent.click(container.querySelectorAll(".cu-tab")[2])
    rerender(<PageTabs label="Views" tabs={TABS} />)
    expect(panel("three").dataset.dir).toBe("fwd")
    fireEvent.click(container.querySelectorAll(".cu-tab")[1])
    rerender(<PageTabs label="Views" tabs={TABS} />)
    expect(panel("two").dataset.dir).toBe("back")
    expect(panel("three").dataset.dir).toBeUndefined()
  })
})

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, fireEvent } from "@testing-library/react"

let SEARCH = ""
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/pnl",
  useSearchParams: () => new URLSearchParams(SEARCH),
}))

import { PageTabs } from "@/components/counter/ui"

const TABS = [
  { key: "summary", label: "Summary", content: <p>answer</p> },
  { key: "days", label: "Days", content: <p>every day</p> },
  { key: "statement", label: "Statement", content: <p>the statement</p> },
]

const panels = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>(".cu-pagetabs__panel")]

describe("PageTabs", () => {
  beforeEach(() => {
    SEARCH = "store=hollywood"
    window.history.replaceState(null, "", "/dashboard/pnl?store=hollywood")
  })

  it("draws every panel and hides all but the first", () => {
    const { container } = render(<PageTabs label="P&L views" tabs={TABS} />)
    expect(panels(container).map((p) => p.hidden)).toEqual([false, true, true])
    expect(container.querySelector(".cu-tab[aria-pressed='true']")!.textContent).toBe("Summary")
  })

  it("opens the tab the address names", () => {
    SEARCH = "store=hollywood&tab=statement"
    const { container } = render(<PageTabs label="P&L views" tabs={TABS} />)
    expect(panels(container).map((p) => p.hidden)).toEqual([true, true, false])
  })

  it("ignores a tab the page does not have", () => {
    SEARCH = "tab=nope"
    const { container } = render(<PageTabs label="P&L views" tabs={TABS} />)
    expect(panels(container)[0].hidden).toBe(false)
  })

  it("writes the picked tab into the address and keeps the other params", () => {
    const { container } = render(<PageTabs label="P&L views" tabs={TABS} />)
    fireEvent.click([...container.querySelectorAll(".cu-tab")][1])
    expect(window.location.search).toBe("?store=hollywood&tab=days")
  })

  it("leaves the default tab out of the address", () => {
    SEARCH = "store=hollywood&tab=days"
    window.history.replaceState(null, "", "/dashboard/pnl?store=hollywood&tab=days")
    const { container } = render(<PageTabs label="P&L views" tabs={TABS} />)
    fireEvent.click([...container.querySelectorAll(".cu-tab")][0])
    expect(window.location.search).toBe("?store=hollywood")
  })

  it("starts on `initial` when the address names no tab", () => {
    const { container } = render(<PageTabs label="P&L views" tabs={TABS} initial="statement" />)
    expect(panels(container).map((p) => p.hidden)).toEqual([true, true, false])
  })

  it("draws a lone tab without a row to pick from", () => {
    const { container } = render(<PageTabs label="Recipe views" tabs={[TABS[1]]} />)
    expect(container.querySelector(".cu-tabs")).toBeNull()
    expect(container.textContent).toBe("every day")
  })
})

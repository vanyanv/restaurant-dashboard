// @vitest-environment jsdom
/**
 * `StoreRows` against the prototype's own `pstores()`
 * (`docs/counter/counter-prototype.html` line 3868).
 *
 * The same note-33 rule as `StoreCards`, on a 340px screen: a store that has
 * not opened shows what its file answers, never an em-dash and never an
 * invented percentage.
 */
import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { StoreRows } from "@/components/counter/surface/store-rows"
import type { StoreCard, TradingStore, PreOpenStore } from "@/components/counter/surface/store-cards"

const HOLLYWOOD: TradingStore = {
  kind: "trading",
  id: "hollywood",
  name: "Hollywood",
  stage: "trading",
  netSales: 25_879,
  series: [820, 910, 1_040],
  comparison: "▲ 4.1% vs the prior period",
  orders: 1_024,
  ticket: 25.27,
  salesPerHour: 71.9,
  panel: <p>where Hollywood&rsquo;s money came from</p>,
}

const GLENDALE: PreOpenStore = {
  kind: "pre_open",
  id: "glendale",
  name: "Glendale",
  opensOn: new Date(2026, 5, 15),
  missingFromFile: ["Rent"],
  panel: <p>Glendale is not trading yet</p>,
}

const VAN_NUYS: PreOpenStore = {
  ...GLENDALE,
  id: "vannuys",
  name: "Van Nuys",
  opensOn: null,
  missingFromFile: ["Rent", "Opening date"],
  panel: <p>Van Nuys is not trading yet</p>,
}

const ALL: StoreCard[] = [HOLLYWOOD, GLENDALE, VAN_NUYS]

describe("StoreRows — the stores, as the phone lists them", () => {
  it("emits one .pstore per store, each a .prow and its own drawer", () => {
    const { container } = render(<StoreRows stores={ALL} />)
    const rows = [...container.querySelectorAll(".pstore")]
    expect(rows).toHaveLength(3)
    expect([...rows[0].children].map((c) => c.getAttribute("class"))).toEqual(["prow", "ldrawer"])
  })

  it("emits the caret, the name block and the value block, in the prototype's order", () => {
    const { container } = render(<StoreRows stores={[HOLLYWOOD]} />)
    const prow = container.querySelector(".prow")!
    expect([...prow.children].map((c) => c.getAttribute("class"))).toEqual(["car", "pn", "pv"])
    expect(prow.querySelector(".pn b")!.textContent).toBe("Hollywood")
    expect(prow.querySelector(".pn em")!.textContent).toBe("Trading")
  })

  it("reads a trading store's net sales over its order count", () => {
    const { container } = render(<StoreRows stores={[HOLLYWOOD]} />)
    const pv = container.querySelector(".pv")!
    expect(pv.textContent).toBe("$25,8791,024 orders")
    expect(pv.querySelector("em")!.textContent).toBe("1,024 orders")
  })

  it("shows a pre-open store its opening date, NEVER a build-out percentage", () => {
    // Ruling C-R3: there is no build-out column, no milestone table and nothing
    // resembling one. The prototype's 68% / 31% are invented for the mockup.
    const { container } = render(<StoreRows stores={[GLENDALE]} />)
    expect(container.querySelector(".pv em")!.textContent).toBe("opens")
    expect(container.textContent).not.toMatch(/%/)
    expect(container.textContent).not.toMatch(/build-?out/i)
  })

  it("says 'No date' rather than guessing when nobody set an opening date", () => {
    const { container } = render(<StoreRows stores={[VAN_NUYS]} />)
    expect(container.querySelector(".pv")!.textContent).toBe("No dateopens")
  })

  it("never prints an em-dash for a figure a pre-open store does not have", () => {
    const { container } = render(<StoreRows stores={ALL} />)
    expect(container.textContent).not.toContain("—")
  })

  it("speaks one stage vocabulary with StoreCards", () => {
    const { container } = render(
      <StoreRows stores={[HOLLYWOOD, { ...HOLLYWOOD, id: "warm", stage: "warming_up" }, GLENDALE]} />,
    )
    expect([...container.querySelectorAll(".pn em")].map((e) => e.textContent)).toEqual([
      "Trading",
      "Warming up",
      "Pre-open",
    ])
  })

  it("opens the row it is told to, and its panel is inside .lpanel", () => {
    const { container } = render(<StoreRows stores={ALL} defaultOpenId="hollywood" />)
    const open = container.querySelector(".ldrawer.is-open")!
    expect(open.querySelector(".lpanel")!.textContent).toContain("where Hollywood")
    expect(container.querySelectorAll(".ldrawer.is-open")).toHaveLength(1)
  })

  it("opens one at a time — a second tap closes the first", () => {
    const { container } = render(<StoreRows stores={ALL} defaultOpenId="hollywood" />)
    fireEvent.click(screen.getByText("Glendale"))
    const open = [...container.querySelectorAll(".ldrawer.is-open")]
    expect(open).toHaveLength(1)
    expect(open[0].querySelector(".lpanel")!.textContent).toContain("Glendale is not trading")
  })

  it("tapping the open row closes it, leaving none open", () => {
    const { container } = render(<StoreRows stores={ALL} defaultOpenId="hollywood" />)
    fireEvent.click(screen.getByText("Hollywood"))
    expect(container.querySelectorAll(".ldrawer.is-open")).toHaveLength(0)
  })

  it("each .prow says whether it is expanded and names the panel it controls", () => {
    const { container } = render(<StoreRows stores={ALL} defaultOpenId="hollywood" />)
    const prows = [...container.querySelectorAll(".prow")]
    expect(prows.map((p) => p.getAttribute("aria-expanded"))).toEqual(["true", "false", "false"])
    const controlled = prows[0].getAttribute("aria-controls")!
    expect(container.querySelector(`#${controlled}`)!.className).toBe("ldrawer is-open")
  })

  it("opens nothing when told to open nothing", () => {
    const { container } = render(<StoreRows stores={ALL} />)
    expect(container.querySelectorAll(".ldrawer.is-open")).toHaveLength(0)
  })
})

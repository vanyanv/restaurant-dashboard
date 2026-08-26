// @vitest-environment jsdom
/**
 * Note 33, as a test. The shipped app's per-store table printed twelve
 * em-dashes and called it a store list; the assertion that matters most here
 * is `it("never prints an em-dash…")`.
 */
import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import {
  StoreCards,
  type StoreCard,
  type TradingStore,
  type PreOpenStore,
} from "@/components/counter/surface/store-cards"

const HOLLYWOOD: TradingStore = {
  kind: "trading",
  id: "hollywood",
  name: "Hollywood",
  stage: "trading",
  netSales: 25_879,
  series: [820, 910, 1_040, 990, 1_120, 1_260, 1_180],
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

function cards(container: HTMLElement) {
  return Array.from(container.querySelectorAll(".stcard")) as HTMLElement[]
}

describe("StoreCards", () => {
  it("emits the prototype's DOM: .stores > .stcard × n, then .ldrawer × n", () => {
    const { container } = render(<StoreCards stores={ALL} />)
    expect(container.querySelector(".stores")).toBeTruthy()
    expect(container.querySelectorAll(".stores > .stcard")).toHaveLength(3)
    expect(container.querySelectorAll(".stores > .ldrawer > .lpanel")).toHaveLength(3)

    // Drawer order matters: `.stores > .ldrawer` is `grid-column: 1 / -1`, so
    // a drawer only lands UNDER the row of cards if every card precedes it.
    const kids = Array.from(container.querySelector(".stores")!.children).map((c) =>
      c.className.split(" ")[0],
    )
    expect(kids.slice(0, 3)).toEqual(["stcard", "stcard", "stcard"])
    expect(kids.slice(3, 6)).toEqual(["ldrawer", "ldrawer", "ldrawer"])
  })

  it("NEVER prints an em-dash for a figure that does not apply — note 33", () => {
    const { container } = render(<StoreCards stores={ALL} />)
    const [, glendale, vannuys] = cards(container)
    for (const c of [glendale, vannuys]) {
      expect(c.textContent).not.toMatch(/—/)
      expect(c.textContent).not.toMatch(/\$0\b/)
      expect(c.textContent).not.toMatch(/0\.0%/)
    }
  })

  it("a pre-open card shows the fact it DOES have: when it opens", () => {
    // NOT a build-out percentage. The prototype's 68% and 31% are invented for
    // the mockup — there is no build-out column, no milestone table and
    // nothing resembling one in the schema — and drawing a meter against a
    // number nobody measured is note 33's em-dash reached by another route.
    const { container } = render(<StoreCards stores={ALL} />)
    const glendale = cards(container)[1]
    expect(glendale.querySelector(".k")!.textContent).toBe("Opens")
    expect(glendale.querySelector(".v")!.textContent).toBe("Jun 15, 2026")
    expect(container.querySelector(".bld")).toBeNull()
  })

  it("a store with no opening date says so, rather than guessing one", () => {
    const { container } = render(<StoreCards stores={ALL} />)
    expect(cards(container)[2].querySelector(".v")!.textContent).toBe("No date set")
  })

  it("a pre-open card says what its store file is still missing, and why it matters later", () => {
    const { container } = render(<StoreCards stores={ALL} />)
    const note = cards(container)[1].querySelector(".stnote")!
    expect(note.querySelector("b")!.textContent).toBe("Rent is still missing")
    expect(note.textContent).toContain("its P&L cannot be right the day it opens")
  })

  it("two missing fields read as a list, and the verb agrees with it", () => {
    const { container } = render(<StoreCards stores={ALL} />)
    expect(cards(container)[2].querySelector(".stnote b")!.textContent).toBe(
      "Rent and Opening date are still missing",
    )
  })

  it("a complete store file says so rather than leaving the note blank", () => {
    const { container } = render(
      <StoreCards stores={[{ ...GLENDALE, missingFromFile: [] }]} />,
    )
    expect(container.querySelector(".stnote")!.textContent).toContain(
      "Its store file is complete",
    )
  })

  it("a trading card carries net sales, its shape, its comparison and three sub-figures", () => {
    const { container } = render(<StoreCards stores={ALL} />)
    const hollywood = cards(container)[0]
    expect(hollywood.querySelector(".k")!.textContent).toBe("Net sales")
    expect(hollywood.querySelector(".v")!.textContent).toBe("$25,879")
    expect(hollywood.querySelector("svg.sp")).toBeTruthy()
    expect(hollywood.querySelector(".d")!.textContent).toBe("▲ 4.1% vs the prior period")
    const figs = Array.from(hollywood.querySelectorAll(".stfig > div")).map((d) => [
      d.querySelector("dt")!.textContent,
      d.querySelector("dd")!.textContent,
    ])
    expect(figs).toEqual([
      ["Orders", "1,024"],
      ["Ticket", "$25.27"],
      ["Sales/hr", "$71.90"],
    ])
  })

  it("the stage tag is the sheet's .mtag, and the two arms wear different tones", () => {
    const { container } = render(<StoreCards stores={ALL} />)
    const tags = cards(container).map((c) => {
      const t = c.querySelector(".mtag")!
      return [t.className, t.textContent]
    })
    expect(tags).toEqual([
      ["mtag good", "Trading"],
      ["mtag", "Pre-open"],
      ["mtag", "Pre-open"],
    ])
  })

  it("a card is an operable control: role, tab stop, aria-expanded, aria-controls", () => {
    const { container } = render(<StoreCards stores={ALL} />)
    for (const c of cards(container)) {
      expect(c.getAttribute("role")).toBe("button")
      expect(c.getAttribute("tabindex")).toBe("0")
      expect(c.getAttribute("aria-expanded")).toBe("false")
      const panel = container.querySelector(`#${CSS.escape(c.getAttribute("aria-controls")!)}`)
      expect(panel!.className).toMatch(/ldrawer/)
    }
  })

  it("clicking a card opens its own drawer, and only its own", () => {
    const { container } = render(<StoreCards stores={ALL} />)
    fireEvent.click(cards(container)[1])

    expect(cards(container)[1].getAttribute("aria-expanded")).toBe("true")
    const open = Array.from(container.querySelectorAll(".ldrawer.is-open"))
    expect(open).toHaveLength(1)
    expect(open[0].id).toBe(cards(container)[1].getAttribute("aria-controls"))
  })

  it("opening a second card closes the first — two open reads as one panel on the wrong card", () => {
    const { container } = render(<StoreCards stores={ALL} />)
    fireEvent.click(cards(container)[0])
    fireEvent.click(cards(container)[2])

    expect(cards(container)[0].getAttribute("aria-expanded")).toBe("false")
    expect(cards(container)[2].getAttribute("aria-expanded")).toBe("true")
    expect(container.querySelectorAll(".ldrawer.is-open")).toHaveLength(1)
  })

  it("clicking the open card closes it again", () => {
    const { container } = render(<StoreCards stores={ALL} />)
    fireEvent.click(cards(container)[0])
    fireEvent.click(cards(container)[0])
    expect(container.querySelectorAll(".ldrawer.is-open")).toHaveLength(0)
  })

  it("Enter and Space work, because a div with role=button gets neither for free", () => {
    const { container } = render(<StoreCards stores={ALL} />)
    fireEvent.keyDown(cards(container)[0], { key: "Enter" })
    expect(cards(container)[0].getAttribute("aria-expanded")).toBe("true")

    fireEvent.keyDown(cards(container)[0], { key: " " })
    expect(cards(container)[0].getAttribute("aria-expanded")).toBe("false")
  })

  it("the panel stays mounted while closed, so aria-controls never dangles", () => {
    render(<StoreCards stores={ALL} />)
    expect(screen.getByText(/where Hollywood’s money came from/)).toBeTruthy()
  })

  it("defaultOpenId opens one card on first paint", () => {
    const { container } = render(<StoreCards stores={ALL} defaultOpenId="vannuys" />)
    expect(cards(container)[2].getAttribute("aria-expanded")).toBe("true")
    expect(container.querySelectorAll(".ldrawer.is-open")).toHaveLength(1)
  })

  it("the footnotes render into .stores__foot, one span each", () => {
    const { container } = render(
      <StoreCards stores={ALL} notes={[<>1 of 3 trading</>, <>the group is Hollywood</>]} />,
    )
    const foot = container.querySelector(".stores__foot")!
    expect(foot.querySelectorAll("span")).toHaveLength(2)
    expect(foot.textContent).toMatch(/1 of 3 trading/)
  })

  it("a trading store with a flat range still renders its figure — a spark is not the figure", () => {
    const { container } = render(
      <StoreCards stores={[{ ...HOLLYWOOD, series: [] }]} />,
    )
    expect(container.querySelector("svg.sp")).toBeNull()
    expect(container.querySelector(".stcard .v")!.textContent).toBe("$25,879")
  })

  it("a warming-up store is a TRADING card, wearing the louder tag", () => {
    // `isOperational` is `stage !== "pre_open"`, so a warming-up store has
    // customers and therefore figures. The tag is the only difference, and it
    // carries the model's own word rather than the prototype's "Fit-out".
    const { container } = render(
      <StoreCards stores={[{ ...HOLLYWOOD, stage: "warming_up" }]} />,
    )
    const tag = container.querySelector(".mtag")!
    expect([tag.className, tag.textContent]).toEqual(["mtag warn", "Warming up"])
    expect(container.querySelector(".stcard .v")!.textContent).toBe("$25,879")
  })

  it("a trading store with no orders prints an em-dash for the ticket, never $0.00", () => {
    // The one place an em-dash is right on a card: a missing measurement on a
    // row that has every other figure. Note 33 is about a card that is NOTHING
    // but em-dashes.
    const { container } = render(
      <StoreCards stores={[{ ...HOLLYWOOD, orders: 0, ticket: null }]} />,
    )
    const figs = Array.from(container.querySelectorAll(".stfig dd")).map((d) => d.textContent)
    expect(figs).toEqual(["0", "—", "$71.90"])
  })
})

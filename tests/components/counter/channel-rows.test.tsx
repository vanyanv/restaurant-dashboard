// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { ChannelRows, type ChannelRow } from "@/components/counter/surface/channel-rows"
import { markVarFor } from "@/lib/counter/channels"

// The prototype's own split of a $25,879 range: 39.1 / 28.9 / 19.3 / 12.7.
const ROWS: ChannelRow[] = [
  { id: "house", net: 10_119, orders: 400 },
  { id: "doordash", net: 7_479, orders: 296 },
  { id: "ubereats", net: 4_995, orders: 197 },
  { id: "grubhub", net: 3_286, orders: 131 },
]

function rows(container: HTMLElement) {
  return Array.from(container.querySelectorAll(".chan__row")).map((r) => ({
    chip: r.querySelector(".chip")!.textContent,
    pc: (r.querySelector(".chip") as HTMLElement).style.getPropertyValue("--pc"),
    keep: (r.querySelector(".cbar i") as HTMLElement).style.width,
    fee: r.querySelector(".cbar u") as HTMLElement | null,
    value: r.querySelector("b")!.textContent,
    meta: r.querySelector(".cmeta")!.textContent,
  }))
}

describe("ChannelRows", () => {
  it("emits the prototype's DOM: .chan > .chan__cap + .chan__row × n", () => {
    const { container } = render(<ChannelRows caption="Where the money came from" rows={ROWS} />)
    expect(container.querySelector(".chan > .chan__cap")).toBeTruthy()
    expect(container.querySelectorAll(".chan__row")).toHaveLength(4)
    expect(container.querySelectorAll(".cbar")).toHaveLength(4)
    expect(container.querySelectorAll(".cmeta")).toHaveLength(4)
  })

  it("the brand colour is IDENTITY only — on the chip beside the name, via --pc", () => {
    const { container } = render(<ChannelRows caption="c" rows={ROWS} />)
    const r = rows(container)
    expect(r[1].chip).toBe("DoorDash")
    expect(r[1].pc).toBe(markVarFor("doordash"))
    // and every swatch reads a token, never a literal
    for (const row of r) expect(row.pc).toMatch(/^var\(--ch-/)
    // four channels, four distinct marks
    expect(new Set(r.map((x) => x.pc)).size).toBe(4)
  })

  it("bar LENGTH is the channel's share of net; inside it, i keeps and u is commission", () => {
    const { container } = render(<ChannelRows caption="c" rows={ROWS} />)
    const dd = rows(container)[1]
    // 7,479 of 25,879 = 28.9%. DoorDash takes 25%, so the store keeps 21.7%
    // of net and the marketplace takes 7.2% — and the two are the whole slice.
    expect(dd.keep).toBe("21.7%")
    expect(dd.fee!.style.left).toBe("21.7%")
    expect(dd.fee!.style.width).toBe("7.2%")
  })

  it("in-house has no commission, so it draws no taken portion at all", () => {
    const { container } = render(<ChannelRows caption="c" rows={ROWS} />)
    const house = rows(container)[0]
    expect(house.fee).toBeNull()
    expect(house.meta).toMatch(/no commission · keeps \$10,119/)
  })

  it("the meta line states share, orders, ticket, rate, what it took and what is left", () => {
    const { container } = render(<ChannelRows caption="c" rows={ROWS} />)
    expect(rows(container)[1].meta).toBe(
      "28.9% of net · 296 orders · $25.27 ticket · commission 25% −$1,870 · keeps $5,609",
    )
  })

  it("the commission rate comes from channels.ts, not from the caller", () => {
    // The prototype's own note: DoorDash was 20% on an order, 20% on an item
    // and 25% here. There is no prop to retype it into.
    const { container } = render(<ChannelRows caption="c" rows={ROWS} />)
    const r = rows(container)
    expect(r[2].meta).toMatch(/commission 23%/) // Uber Eats
    expect(r[3].meta).toMatch(/commission 20%/) // Grubhub
  })

  it("the keeps/commission legend is drawn once, in the cap", () => {
    const { container } = render(<ChannelRows caption="c" rows={ROWS} />)
    const key = container.querySelector(".chan__cap .chan__key")!
    expect(key.textContent).toBe("keepscommission")
    expect(key.querySelectorAll("i.k1")).toHaveLength(1)
    expect(key.querySelectorAll("i.k2")).toHaveLength(1)
  })

  it("a store with no channels reuses the same box and drops the legend it cannot key", () => {
    // prePanel(): "A store with no customers has no channels; say what it is
    // waiting for."
    const { container } = render(
      <ChannelRows
        caption="Glendale is not trading yet"
        rows={[]}
        footer={<>Build-out is 68%, and rent is still missing from its store file.</>}
      />,
    )
    expect(container.querySelector(".chan")).toBeTruthy()
    expect(container.querySelector(".chan__key")).toBeNull()
    expect(container.querySelectorAll(".chan__row")).toHaveLength(0)
    expect((container.querySelector(".chan__foot") as HTMLElement).style.marginTop).toBe("0px")
  })

  it("a range with no sales at all renders 0%, never NaN%", () => {
    const { container } = render(
      <ChannelRows caption="c" rows={[{ id: "house", net: 0, orders: 0 }]} />,
    )
    const r = rows(container)[0]
    expect(r.keep).toBe("0%")
    expect(r.keep).not.toMatch(/NaN|Infinity/)
    // a channel with no orders has no ticket — a missing measurement on a row
    // that still has every other figure
    expect(r.meta).toMatch(/0 orders · — ticket/)
  })

  it("renders the footer and the actions where the sheet puts them", () => {
    const { container } = render(
      <ChannelRows
        caption="c"
        rows={ROWS}
        footer={<>The three marketplaces pay 23.3% off the top.</>}
        actions={
          <button className="btn" type="button">
            Open this store&rsquo;s P&amp;L
          </button>
        }
      />,
    )
    expect(container.querySelector("p.chan__foot")).toBeTruthy()
    expect(container.querySelector(".chan > .btnrow > .btn")).toBeTruthy()
    expect(screen.getByRole("button", { name: /P&L/ })).toBeTruthy()
  })
})

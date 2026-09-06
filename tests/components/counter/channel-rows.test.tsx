// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { ChannelRows, type ChannelRow } from "@/components/counter/surface/channel-rows"
import { markVarFor } from "@/lib/counter/channels"

// The prototype's own split of a $25,879 range: 39.1 / 28.9 / 19.3 / 12.7 —
// commission and ticket now come from the reading itself (Task 8), not a
// trade-average constant applied here.
const ROWS: ChannelRow[] = [
  { id: "house", net: 10_119, orders: 400, commission: 0, ticket: 25.3 },
  { id: "doordash", net: 7_479, orders: 296, commission: 1_870, ticket: 25.27 },
  { id: "ubereats", net: 4_995, orders: 197, commission: 1_149, ticket: 25.36 },
  { id: "grubhub", net: 3_286, orders: 131, commission: null, ticket: 25.09 },
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
    // 7,479 of 25,879 = 28.9% of net. DoorDash's own reading kept $5,609 of
    // that — 21.7% of the whole track — and the $1,870 fee is the remaining
    // 7.2%, drawn as the hatch.
    expect(dd.keep).toBe("21.7%")
    expect(dd.fee!.style.left).toBe("21.7%")
    expect(dd.fee!.style.width).toBe("7.2%")
  })

  it("in-house has no commission (fee === 0), so it draws no taken portion at all", () => {
    const { container } = render(<ChannelRows caption="c" rows={ROWS} />)
    const house = rows(container)[0]
    expect(house.fee).toBeNull()
    // fee===0: full-width kept bar — the whole slice, not a share of it.
    expect(house.keep).toBe(`${((10_119 / 25_879) * 100).toFixed(1)}%`)
    expect(house.meta).toMatch(/no commission · keeps \$10,119/)
  })

  it("a published rate draws the dollar fee, with no percent on the line", () => {
    const { container } = render(<ChannelRows caption="c" rows={ROWS} />)
    expect(rows(container)[1].meta).toBe(
      "28.9% of net · 296 orders · $25.27 ticket · commission −$1,870 · keeps $5,609",
    )
    // The percent left the line entirely — multi-store aggregation has no
    // single rate to print, so only the trade-average constants used to
    // fabricate one. "commission 25%" (the old, fabricated form) never
    // appears again.
    expect(rows(container)[1].meta).not.toMatch(/commission \d+%/)
  })

  it("no published rate (Grubhub) draws no hatch and keeps nothing, never a fabricated bar", () => {
    const { container } = render(<ChannelRows caption="c" rows={ROWS} />)
    const gh = rows(container)[3]
    expect(gh.fee).toBeNull()
    // fee===null: full-width kept bar too — there is no known fee to carve
    // a hatch out of.
    expect(gh.keep).toBe(`${((3_286 / 25_879) * 100).toFixed(1)}%`)
    expect(gh.meta).toBe("12.7% of net · 131 orders · $25.09 ticket · commission rate not on file · keeps —")
  })

  it("clamps geometry when a high rate on a discounted range pushes fee past net", () => {
    // `commission` is the store's rate against GROSS (`channel-mix.ts`);
    // `net` here is what actually landed on this row. A heavily discounted
    // range can leave net below what that gross-based fee would be, so
    // `keep = net - fee` goes negative. The BAR must clamp — an unclamped
    // negative width is silently dropped by the browser, and the hatch's
    // `left`/`width` must not overflow the row's own track — while the META
    // LINE stays the honest parenthesized negative.
    const { container } = render(
      <ChannelRows
        caption="c"
        rows={[{ id: "doordash", net: 100, orders: 4, commission: 150, ticket: 25 }]}
      />,
    )
    const r = rows(container)[0]
    const keepPct = parseFloat(r.keep)
    const feeLeft = parseFloat(r.fee!.style.left)
    const feeWidth = parseFloat(r.fee!.style.width)
    expect(keepPct).toBeGreaterThanOrEqual(0)
    expect(feeLeft).toBeGreaterThanOrEqual(0)
    expect(feeWidth).toBeGreaterThanOrEqual(0)
    // The hatch never draws past this channel's own share of net — with a
    // single row, that share is the whole track (100%).
    expect(feeLeft + feeWidth).toBeLessThanOrEqual(100)
    // Nothing is left to call "kept" — the slice is fully hatched.
    expect(keepPct).toBe(0)
    // The meta line stays honest — a parenthesized negative keep, never a
    // clamped-to-zero figure.
    expect(r.meta).toBe(
      "100.0% of net · 4 orders · $25.00 ticket · commission −$150 · keeps ($50)",
    )
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
      <ChannelRows
        caption="c"
        rows={[{ id: "house", net: 0, orders: 0, commission: 0, ticket: null }]}
      />,
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

// @vitest-environment jsdom
/**
 * The phone composition, and specifically the chrome around it.
 *
 * `npm run fidelity` measures this page against `P.overview.phone()` — but its
 * phone surface root is `#phoneHost .pframe .mscroll`, so `.mtop` is outside
 * everything it compares. The store selector and the date control live there.
 * That is how a phone-only reader ended up unable to change the store, the
 * range or the comparison on a page that reads all three from the URL, with
 * every gate in this repo green. These tests are that surface's gate.
 */
import { describe, it, expect, vi } from "vitest"
import { render, fireEvent, within } from "@testing-library/react"

const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))

import { CounterPhoneOverviewClient } from "@/app/(mobile)/m/counter-phone-overview-client"
import { ready, notComputed } from "@/lib/counter/section-data"
import type { OverviewSections } from "@/lib/counter/adapters/overview"

const STORES = [
  { id: "hollywood", name: "Hollywood", stage: "trading" as const },
  { id: "glendale", name: "Glendale", stage: "pre_open" as const },
]

const sections: OverviewSections = {
  sales: ready({ grossSales: 7468, comparison: "▼ 37.2% vs the prior period", comparisonTone: "is-down" }),
  splh: notComputed("sales per labour hour"),
  strip: ready([
    { label: "Orders", value: "1,024" },
    { label: "Avg ticket", value: "$25.66" },
  ]),
  verdict: ready({ tone: "bad", headline: "One figure is over", body: "Food cost is 31.4%." }),
  moving: ready([
    { label: "Range", value: "1 days", note: "1 daily buckets · no comparison" },
    { label: "Not in the figures", value: "2", note: "open orders" },
  ]),
  needsYou: ready([
    { key: "a1", tone: "bad", lead: "3", unit: "days open", title: "Invoice lines", body: "Short of the header total." },
  ]),
  salesChart: ready({ labels: ["Mon"], series: [{ name: "Net sales", color: "var(--ink)", data: [7468] }] }),
  splhChart: notComputed("sales per labour hour"),
  stores: ready([
    {
      kind: "trading",
      id: "hollywood",
      name: "Hollywood",
      stage: "trading",
      grossSales: 7468,
      series: [7468],
      comparison: "no comparison set",
      orders: 291,
      ticket: 25.66,
      salesPerHour: 71.4,
      channels: [{ id: "house", net: 4000, orders: 160 }],
    },
    { kind: "pre_open", id: "glendale", name: "Glendale", opensOn: null, missingFromFile: ["Rent"] },
  ]),
  comparison: notComputed("the comparison drill"),
  channels: notComputed("the channel mix"),
  invoices: notComputed("invoices"),
  modelCall: notComputed("the model's call"),
  ratings: notComputed("guest ratings"),
}

/** The sheet `.mdate` controls — `.mtop` holds two. */
function dateSheet(container: HTMLElement): HTMLElement {
  const id = container.querySelector(".mdate")!.getAttribute("aria-controls")!
  return document.getElementById(id) as HTMLElement
}

function renderPhone(params = "") {
  push.mockClear()
  return render(
    <CounterPhoneOverviewClient
      params={params}
      stores={STORES}
      today={new Date(2026, 7, 25)}
      sections={sections}
    />,
  )
}

describe("Counter Overview — the phone", () => {
  it("puts .ct-root and .ct-phone ABOVE .mscroll, so .mtop is inside the token root", () => {
    // `.pframe`'s own arrangement. `.mtop` reads `--chrome` and `--line`, which
    // the alias layer declares only on a Counter root; left outside, the bar
    // would render with no ground and no rule under it.
    const { container } = renderPhone()
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toBe("ct-root ct-phone")
    const kids = [...root.children].map((c) => c.className)
    expect(kids).toEqual(["mtop", "mscroll"])
  })

  it("renders the store and the date controls a phone-only reader needs", () => {
    const { container } = renderPhone()
    const top = container.querySelector(".mtop")!
    expect(top.querySelector(".st")!.tagName).toBe("BUTTON")
    expect(top.querySelector(".mdate")!.tagName).toBe("BUTTON")
  })

  it("the store control writes ?store — the SAME parameter the desk writes", () => {
    // Not `?period=`. Two range vocabularies on one page is note 60's defect,
    // and it is why the editorial MToolbar could not simply be kept.
    const { container } = renderPhone()
    fireEvent.click(container.querySelector(".st")!)
    // The store sheet is the one `.st` controls — two sheets live in `.mtop`.
    const storeSheet = document.getElementById(container.querySelector(".st")!.getAttribute("aria-controls")!)!
    fireEvent.click(within(storeSheet).getByText("Glendale"))
    expect(push).toHaveBeenCalledWith("/m?store=glendale", { scroll: false })
  })

  it("the date control writes ?range, and drops it again at the default", () => {
    const { container } = renderPhone("store=hollywood")
    fireEvent.click(container.querySelector(".mdate")!)
    const sheet = within(dateSheet(container))

    fireEvent.click(sheet.getByText("Last 7 days"))
    expect(push).toHaveBeenLastCalledWith("/m?store=hollywood&range=d7", { scroll: false })

    // `writeCounterParams` drops anything at its default, so a shared phone URL
    // is the same short URL the desk produces.
    fireEvent.click(sheet.getByText("Yesterday"))
    expect(push).toHaveBeenLastCalledWith("/m?store=hollywood", { scroll: false })
  })

  it("the comparison control writes ?cmp", () => {
    const { container } = renderPhone()
    fireEvent.click(container.querySelector(".mdate")!)
    const cmp = container.querySelector(".drcmp")!
    fireEvent.click(within(cmp as HTMLElement).getByText("None"))
    expect(push).toHaveBeenLastCalledWith("/m?cmp=none", { scroll: false })
  })

  it("the store the URL names is the store the control shows", () => {
    const { container } = renderPhone("store=glendale")
    expect(container.querySelector(".st")!.textContent).toContain("Glendale")
  })

  it("adds no landmark outside .mscroll, so the fidelity count is unmoved", () => {
    // Our extraction root on the phone is `main.m-shell__main`, which contains
    // the chrome the prototype's `.mscroll` root excludes. A landmark up here
    // would be reported as an EXTRA — and an extra silently leaves the
    // rendering comparison (ruling F-R8), shrinking what is checked.
    const { container } = renderPhone()
    fireEvent.click(container.querySelector(".st")!)
    fireEvent.click(container.querySelector(".mdate")!)
    const CLASSES = [
      "dispatch", "headline", "fig", "say", "hfloor", "strip", "sec", "moving",
      "askbar", "sugs", "sug", "queue", "qitem", "stores", "stcard", "chan",
      "chan__row", "cbar", "gap", "ch", "drill", "tbl", "wkt", "blt", "mtr",
      "wf", "kv", "sp", "band", "sec__head", "sec__body", "btnrow", "btn",
      "empty", "mstrip", "mlist", "mhead", "moneyline",
    ]
    const top = container.querySelector(".mtop")!
    const found = [...top.querySelectorAll("*")]
      .flatMap((el) => CLASSES.filter((c) => el.classList.contains(c)))
    expect(found).toEqual([])
  })

  it("still leads with the phone's own head block, and the fall reads as a fall", () => {
    const { container } = renderPhone()
    const head = container.querySelector(".mhead")!
    expect(head.querySelector(".v")!.textContent).toBe("$7,468")
    expect(head.querySelector(".d")!.className).toBe("d is-down")
  })

  it("the moving band is ONE cell on the phone, whatever the adapter built", () => {
    // Three cells at 316px wrap into a seamless block with rules through the
    // middle of it; the prototype's phone passes one, and the first is the
    // range — the only one of the three that is about the page rather than
    // about a figure that is no longer on it.
    const { container } = renderPhone()
    const moving = container.querySelector(".moving")!
    expect(moving.children).toHaveLength(1)
    expect(moving.textContent).toContain("Range")
  })
})

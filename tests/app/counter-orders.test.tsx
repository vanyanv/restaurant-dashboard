// @vitest-environment jsdom
/**
 * The desk orders list, asserted against `P.orders.desk()`'s own composition
 * (`docs/counter/counter-prototype.html:4852`).
 *
 * The prototype writes three blocks and nothing else:
 *
 *   strip([...five cells])                       — page level, above any .sec
 *   <div class="sec">.filters + tbl(...)</div>   — a .sec with NO .sec__head
 *   sec('Orders by hour', meta, chart + p.mono + .btnrow)
 *
 * The fidelity gate measures the same thing in a browser against the
 * prototype itself. These are the fast half: the ORDER, the block that must
 * NOT grow a head, the two pieces of page furniture the adapter does not
 * carry, and every gesture on this page that writes the URL — because the
 * filters are the whole point of the page and a filter that does not survive a
 * reload is a filter nobody can share.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, render, fireEvent } from "@testing-library/react"

const push = vi.fn()
// Both the island's controls and `Table`'s own row navigation call
// `useRouter()`, and a plain RTL render is not an App Router tree.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))

import { CounterOrdersClient } from "@/app/dashboard/orders/counter-orders-client"
import { ready, empty, failed, loading } from "@/lib/counter/section-data"
import type { OrdersList, OrdersSections } from "@/lib/counter/adapters/orders"

const TODAY = new Date(2026, 7, 25) // Tuesday 25 Aug 2026

const main = (c: HTMLElement) => c.querySelector("main#ct-main") as HTMLElement

const base = {
  pathname: "/dashboard/orders",
  // Plain text, never a URLSearchParams instance — see the island's own note.
  params: "",
  stores: [
    { id: "hollywood", name: "Hollywood", stage: "trading" as const },
    { id: "glendale", name: "Glendale", stage: "pre_open" as const },
  ],
  user: { name: "Chris Karimian", role: "Owner" },
  today: TODAY,
}

/** The prototype's own four toggles, in `CHANNELS` order. */
const toggles = (pressed: string[] = []) =>
  [
    { id: "house", label: "In-house", tint: "--ch-house" },
    { id: "doordash", label: "DoorDash", tint: "--ch-dd" },
    { id: "ubereats", label: "Uber Eats", tint: "--ch-ue" },
    { id: "grubhub", label: "Grubhub", tint: "--ch-gh" },
  ].map((t) => ({ ...t, pressed: pressed.includes(t.id) }))

const ROWS: OrdersList["rows"] = [
  {
    key: "o1",
    href: "/dashboard/orders/o1",
    id: "#4821",
    time: "9:32pm",
    channel: { label: "DoorDash", tint: "var(--ch-dd)" },
    items: "3",
    ticket: "$36.65",
    fees: "$9.16",
    feesRecorded: true,
    net: "$27.49",
  },
  {
    key: "o2",
    href: "/dashboard/orders/o2",
    id: "#4820",
    time: "9:26pm",
    channel: { label: "In-house", tint: "var(--ch-house)" },
    items: "2",
    ticket: "$24.80",
    fees: "—",
    feesRecorded: true,
    net: "$24.80",
  },
]

const list = (over: Partial<OrdersList> = {}): OrdersList => ({
  toggles: toggles(),
  search: "",
  count: "2 of 187",
  nextCursor: null,
  rows: ROWS,
  ...over,
})

const BY_HOUR = {
  meta: "band = the last four Tuesdays",
  chart: {
    type: "bars" as const,
    h: 132,
    zero: true,
    legend: false,
    vs: null,
    alt: "Orders by hour",
    labels: ["10a", "11a", "12p", "1p", "2p", "3p"],
    series: [{ name: "Orders", color: "var(--ink)", data: [4, 9, 22, 18, 7, 5] }],
    band: { lo: [2, 6, 18, 14, 5, 3], hi: [7, 12, 27, 23, 10, 8] },
  },
}

const sections = (over: Partial<OrdersSections> = {}): OrdersSections => ({
  strip: ready([
    { label: "Orders", value: "187", delta: "▲ 5.1%" },
    { label: "Net sales", value: "$4,912", delta: "▲ 8.4%" },
    { label: "Avg ticket", value: "$26.27", delta: "▼ 1.2%", deltaTone: "is-down" as const },
    { label: "Marketplace fees", value: "$684", delta: "23.3% of 3P", deltaTone: "is-down" as const },
    { label: "Details not drained", value: "0", delta: "all drained", deltaTone: "is-flat" as const },
  ]),
  list: ready(list()),
  byHour: ready(BY_HOUR),
  ...over,
})

beforeEach(() => push.mockClear())
afterEach(() => vi.useRealTimers())

describe("the orders desk composition", () => {
  it("composes the page in the prototype's order, with the strip OUTSIDE any section", () => {
    const { container } = render(<CounterOrdersClient {...base} sections={sections()} />)
    const kids = [...main(container).children].map((c) => c.className.split(" ")[0])
    expect(kids).toEqual([
      "pagehead",
      "strip", // page level — `strip([...])` precedes the first `<div class="sec">`
      "sec", // the filters and the table
      "sec", // orders by hour
    ])
    expect(main(container).querySelector(".strip")!.closest(".sec")).toBeNull()
  })

  /**
   * The prototype writes the list as a bare `<div class="sec">` — no
   * `.sec__head`, no `<h3>`, no `.k`. A head here would be an EXTRA landmark,
   * and ruling F-R8 never forgives an extra.
   */
  it("gives the list section no head, and the hour section one", () => {
    const { container } = render(<CounterOrdersClient {...base} sections={sections()} />)
    const secs = main(container).querySelectorAll(":scope > .sec")
    expect(secs).toHaveLength(2)
    expect(secs[0].querySelector(".sec__head")).toBeNull()
    expect(secs[0].querySelector(".filters")).not.toBeNull()
    expect(secs[1].querySelector(".sec__head h3")!.textContent).toBe("Orders by hour")
    expect(secs[1].querySelector(".sec__head .k")!.textContent).toBe(
      "band = the last four Tuesdays",
    )
  })

  /**
   * `sec()`'s fourth argument is what emits `.askmini`, and `P.orders.desk()`
   * passes it on neither block — where `P.pnl.desk()` passes `true` on two of
   * its five. The prototype decides which sections carry a question, and an
   * unasked-for button would put a control and its words inside a `.sec__head`
   * the gate compares by text.
   */
  it("asks about nothing, because the prototype asks about nothing here", () => {
    const { container } = render(<CounterOrdersClient {...base} sections={sections()} />)
    expect(main(container).querySelectorAll(".askmini")).toHaveLength(0)
    expect(main(container).querySelector(".sec__head")!.textContent).toBe(
      "Orders by hourband = the last four Tuesdays",
    )
  })

  it("offers no retry on a failed section, so no button the prototype never drew", () => {
    const { container } = render(
      <CounterOrdersClient
        {...base}
        sections={sections({ list: failed("orders unavailable", "retryOrders") })}
      />,
    )
    expect(container.querySelector(".failed")).not.toBeNull()
    expect(container.querySelector(".failed .btn")).toBeNull()
  })

  it("draws the strip the adapter handed it, five cells and no more", () => {
    const { container } = render(<CounterOrdersClient {...base} sections={sections()} />)
    const strip = container.querySelector(".strip")!
    expect(strip.getAttribute("data-n")).toBe("5")
    expect(Array.from(strip.querySelectorAll(".k")).map((e) => e.textContent)).toEqual([
      "Orders",
      "Net sales",
      "Avg ticket",
      "Marketplace fees",
      "Details not drained",
    ])
  })

  it("heads the table with the prototype's seven columns and right-aligns the last four", () => {
    const { container } = render(<CounterOrdersClient {...base} sections={sections()} />)
    const table = container.querySelector("table.tbl") as HTMLElement
    const ths = Array.from(table.querySelectorAll("thead th"))
    expect(ths.map((th) => th.textContent)).toEqual([
      "Order",
      "Time",
      "Channel",
      "Items",
      "Ticket",
      "Fees",
      "Net",
    ])
    expect(ths.map((th) => th.classList.contains("num"))).toEqual([
      false, false, false, true, true, true, true,
    ])
  })

  it("prints a row's figures, its channel chip and the route it opens", () => {
    const { container } = render(<CounterOrdersClient {...base} sections={sections()} />)
    const rows = container.querySelectorAll("table.tbl tbody tr")
    expect(rows).toHaveLength(2)
    expect(Array.from(rows[0].querySelectorAll("td")).map((td) => td.textContent)).toEqual([
      "#4821", "9:32pm", "DoorDash", "3", "$36.65", "$9.16", "$27.49",
    ])
    // The prototype's `<span class="chip" style="--pc:var(--ch-dd)">`.
    const chip = rows[0].querySelector(".chip") as HTMLElement
    expect(chip.style.getPropertyValue("--pc")).toBe("var(--ch-dd)")
    expect(chip.querySelector("i")).not.toBeNull()
    // Note 47: the row opens the order.
    expect(rows[0].getAttribute("data-goto")).toBe("/dashboard/orders/o1")
  })

  /*
   * The three-state fee repair, on the surface that shows fifty rows.
   *
   * `OrdersRow.fees` is an em dash both when a channel took nothing and when
   * its commission never synced. The phone has told those apart in words since
   * the repair that found it; the desk read the figure and not the flag, so a
   * DoorDash order with no fee on file printed the same blank an in-house
   * order gets for genuinely paying none — and its Net column then equalled
   * its Ticket with nothing saying why.
   */
  it("says a marketplace fee is not recorded rather than printing the in-house blank", () => {
    const unrecorded = [
      ROWS[0],
      { ...ROWS[0], key: "o3", href: "/dashboard/orders/o3", id: "#4819", fees: "—", feesRecorded: false, net: "$36.65" },
      ROWS[1],
    ]
    const { container } = render(
      <CounterOrdersClient {...base} sections={sections({ list: ready(list({ rows: unrecorded })) })} />,
    )
    const cells = Array.from(container.querySelectorAll("table.tbl tbody tr")).map(
      (r) => (r.querySelectorAll("td")[5] as HTMLElement),
    )
    expect(cells.map((c) => c.textContent)).toEqual(["$9.16", "not recorded", "—"])
    // A word in a money column, coloured so it cannot be read as a figure —
    // the same shape as the order page's `not costed`.
    const marked = cells[1].querySelector("span")
    expect(marked).not.toBeNull()
    expect(marked?.getAttribute("style")).toContain("var(--warn)")
    // And the in-house row keeps its bare em dash: zero IS the truth there.
    expect(cells[2].querySelector("span")).toBeNull()
  })
})

describe("the filters, which live in the URL", () => {
  it("presses a channel toggle and writes it to the URL", () => {
    const { container } = render(<CounterOrdersClient {...base} sections={sections()} />)
    const togs = container.querySelectorAll(".togs .tog")
    expect(togs).toHaveLength(4)
    fireEvent.click(togs[1]) // DoorDash
    expect(push).toHaveBeenCalledWith("/dashboard/orders?channels=doordash", { scroll: false })
  })

  it("adds a second channel in the canonical order, whichever order they were pressed", () => {
    const { container } = render(
      <CounterOrdersClient
        {...base}
        params="channels=grubhub"
        sections={sections({ list: ready(list({ toggles: toggles(["grubhub"]) })) })}
      />,
    )
    fireEvent.click(container.querySelectorAll(".togs .tog")[0]) // In-house
    // `house` before `grubhub` — the CHANNELS order, not the press order, so
    // two readers who pressed the same two toggles share the same link.
    expect(push).toHaveBeenCalledWith("/dashboard/orders?channels=house%2Cgrubhub", {
      scroll: false,
    })
  })

  it("presses a pressed toggle and takes it back out of the URL", () => {
    const { container } = render(
      <CounterOrdersClient
        {...base}
        params="channels=doordash"
        sections={sections({ list: ready(list({ toggles: toggles(["doordash"]) })) })}
      />,
    )
    fireEvent.click(container.querySelectorAll(".togs .tog")[1])
    // The key is REMOVED, not written empty: no channel pressed is every
    // channel, which is what the reader who just unpressed the last one asked
    // for.
    expect(push).toHaveBeenCalledWith("/dashboard/orders", { scroll: false })
  })

  it("hides the clear affordance when nothing is filtered and shows it when something is", () => {
    const { container: quiet } = render(
      <CounterOrdersClient {...base} sections={sections()} />,
    )
    expect((quiet.querySelector(".filters .clear") as HTMLButtonElement).hidden).toBe(true)

    const { container: filtered } = render(
      <CounterOrdersClient
        {...base}
        params="channels=doordash"
        sections={sections({ list: ready(list({ toggles: toggles(["doordash"]) })) })}
      />,
    )
    expect((filtered.querySelector(".filters .clear") as HTMLButtonElement).hidden).toBe(false)
  })

  it("shows the clear affordance for a search alone", () => {
    const { container } = render(
      <CounterOrdersClient
        {...base}
        params="q=4821"
        sections={sections({ list: ready(list({ search: "4821" })) })}
      />,
    )
    expect((container.querySelector(".filters .clear") as HTMLButtonElement).hidden).toBe(false)
  })

  it("clears both keys at once, and keeps the range that is not a filter", () => {
    const { container } = render(
      <CounterOrdersClient
        {...base}
        params="range=d7&channels=doordash&q=4821"
        sections={sections({
          list: ready(list({ toggles: toggles(["doordash"]), search: "4821" })),
        })}
      />,
    )
    fireEvent.click(container.querySelector(".filters .clear")!)
    expect(push).toHaveBeenCalledWith("/dashboard/orders?range=d7", { scroll: false })
  })

  it("commits a typed search to the URL once the typing settles, not once per keystroke", () => {
    vi.useFakeTimers()
    const { container } = render(<CounterOrdersClient {...base} sections={sections()} />)
    const input = container.querySelector(".search input") as HTMLInputElement

    fireEvent.change(input, { target: { value: "48" } })
    fireEvent.change(input, { target: { value: "482" } })
    fireEvent.change(input, { target: { value: "4821" } })
    // The box shows every keystroke immediately — it is the reader's own
    // typing, not a round trip.
    expect(input.value).toBe("4821")
    expect(push).not.toHaveBeenCalled()

    act(() => void vi.advanceTimersByTime(400))
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith("/dashboard/orders?q=4821", { scroll: false })
  })

  /*
   * The debounce racing the controls beside it.
   *
   * `router.push` does not land synchronously, so between an action and its
   * re-render the settle timer was still holding the params from BEFORE the
   * action — and firing on them. These two are the reader-visible symptoms.
   */
  it("does not let a settling draft put back the filter Clear just removed", () => {
    vi.useFakeTimers()
    const { container } = render(
      <CounterOrdersClient
        {...base}
        params="range=d7&channels=doordash&q=burger"
        sections={sections({
          list: ready(list({ toggles: toggles(["doordash"]), search: "burger" })),
        })}
      />,
    )
    // The URL already HOLDS a search, which is what makes this race reachable:
    // Clear empties the box, but `search` stays "burger" until the navigation
    // lands, so the effect still sees draft ≠ search and arms one more write.
    fireEvent.change(container.querySelector(".search input")!, { target: { value: "burgers" } })
    fireEvent.click(container.querySelector(".filters .clear")!)
    act(() => void vi.advanceTimersByTime(400))

    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith("/dashboard/orders?range=d7", { scroll: false })
  })

  it("carries a half-typed word along with a channel pressed mid-word", () => {
    vi.useFakeTimers()
    const { container } = render(
      <CounterOrdersClient {...base} params="range=d7" sections={sections()} />,
    )
    fireEvent.change(container.querySelector(".search input")!, { target: { value: "burger" } })
    fireEvent.click(container.querySelectorAll(".togs .tog")[1]!)
    act(() => void vi.advanceTimersByTime(400))

    // One write, holding BOTH: the toggle is not overwritten by the draft, and
    // the reader does not watch their own typing disappear.
    expect(push).toHaveBeenCalledTimes(1)
    const url = push.mock.calls[0][0] as string
    expect(url).toContain("channels=doordash")
    expect(url).toContain("q=burger")
  })

  it("reads the search back out of the URL, so a shared link opens filtered", () => {
    const { container } = render(
      <CounterOrdersClient
        {...base}
        params="q=burger"
        sections={sections({ list: ready(list({ search: "burger" })) })}
      />,
    )
    expect((container.querySelector(".search input") as HTMLInputElement).value).toBe("burger")
  })

  it("prints the adapter's own count — shown of matched", () => {
    const { container } = render(<CounterOrdersClient {...base} sections={sections()} />)
    expect(container.querySelector(".filters .count")!.textContent).toBe("2 of 187")
  })

  /**
   * The rule this page is built around: a filter that matches nothing must
   * still leave the reader the bar they filtered with.
   */
  it("keeps the filter bar when the filter matched nothing", () => {
    const { container } = render(
      <CounterOrdersClient
        {...base}
        params="q=nothing"
        sections={sections({
          list: ready(list({ rows: [], count: "0 of 0", search: "nothing" })),
        })}
      />,
    )
    expect(container.querySelector(".filters")).not.toBeNull()
    expect(container.querySelector(".filters .clear")!.hasAttribute("hidden")).toBe(false)
    expect(container.querySelectorAll("table.tbl tbody tr")).toHaveLength(0)
    // Not the grey empty box: an empty state here would take the filters away
    // with the rows and leave no way to widen the search that just failed.
    expect(container.querySelector(".empty")).toBeNull()
  })
})

describe("the page furniture the adapter does not carry", () => {
  it("closes the hour section with the sentence and the way to the page it names", () => {
    const { container } = render(<CounterOrdersClient {...base} sections={sections()} />)
    const sec = main(container).querySelectorAll(":scope > .sec")[1]
    expect(sec.querySelector("p.mono")!.textContent).toBe(
      "This is the list. The shape of it — which channel, which hour, which way it is moving — is one page over.",
    )
    const btn = sec.querySelector(".btnrow .btn") as HTMLAnchorElement
    expect(btn.textContent).toBe("Open analytics")
    expect(btn.getAttribute("href")).toBe("/dashboard/analytics")
    // The chart is above them both, in the prototype's own order.
    const order = Array.from(sec.querySelectorAll("*"))
    expect(order.findIndex((e) => e.classList.contains("ch"))).toBeLessThan(
      order.findIndex((e) => e.classList.contains("btnrow")),
    )
  })

  /**
   * `fmt` and `bandFmt` are props of the `Chart` COMPONENT, not fields of
   * `ChartSpec` — and `fmt` defaults to `money()`. Left unpassed, an hour that
   * took 22 orders reads "$22" and its band reads "$18–$27". That is a wrong
   * figure, not a cosmetic slip, so the composition passes the prototype's own
   * two (`fmt: v + ' orders'`, `bandFmt: v` — line 4871).
   */
  it("labels the hours in orders, not in dollars, in the card and in the reachable table", () => {
    const { container } = render(<CounterOrdersClient {...base} sections={sections()} />)

    // jsdom has no layout, so the pointer handler bails on a zero-width host.
    const host = container.querySelector(".ch") as HTMLElement
    host.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 700, bottom: 132, width: 700, height: 132, x: 0, y: 0 }) as DOMRect
    fireEvent.pointerMove(host, { clientX: 0.42 * 700 })

    const tip = container.querySelector(".ch-tip") as HTMLElement
    expect(tip.textContent).toContain("22 orders")
    // The band's own bounds are bare counts — `bandFmt` is the identity here,
    // because "4-week band 18 orders–27 orders" is not a sentence.
    expect(tip.textContent).toContain("4-week band 18–27")
    expect(tip.textContent).not.toContain("$")

    // And the same figures without the picture.
    const rows = container.querySelectorAll("table.sr-only tbody tr")
    expect(rows[2].textContent).toBe("12p22 orders")
  })

  it("does not draw the furniture over a section that has no chart to close", () => {
    // The sentence is a caption on the chart. Printing it under a failure
    // would caption nothing, and the button would offer a page over from a
    // page that is not there.
    const { container } = render(
      <CounterOrdersClient
        {...base}
        sections={sections({ byHour: failed("hourly patterns unavailable", "retryHourly") })}
      />,
    )
    expect(container.querySelector("p.mono")).toBeNull()
    expect(container.querySelector(".btnrow")).toBeNull()
  })
})

describe("the states this page never renders itself", () => {
  it("keeps the two sections while the list is loading", () => {
    const { container } = render(
      <CounterOrdersClient {...base} sections={sections({ list: loading() })} />,
    )
    expect(main(container).querySelectorAll(":scope > .sec")).toHaveLength(2)
    expect(container.querySelector(".filters")).toBeNull()
  })

  it("names the empty hour section rather than drawing an empty chart", () => {
    const { container } = render(
      <CounterOrdersClient {...base} sections={sections({ byHour: empty("no_match") })} />,
    )
    const sec = main(container).querySelectorAll(":scope > .sec")[1]
    expect(sec.querySelector(".sec__head h3")!.textContent).toBe("Orders by hour")
    expect(sec.querySelector(".empty")).not.toBeNull()
    expect(sec.querySelector(".ch")).toBeNull()
  })
})

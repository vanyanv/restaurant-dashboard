// @vitest-environment jsdom
/**
 * The orders list's phone composition, asserted against `P.orders.phone()`'s
 * own order (`docs/counter/counter-prototype.html:4880`).
 *
 * The prototype writes THREE blocks and nothing else:
 *
 *   <div><h2 class="mtitle">Orders</h2><p class="msub">N orders · $X</p></div>
 *   mstrip([['Orders', …], ['Avg ticket', …]])
 *   sec('Latest', '8 shown', mlist(ORDERS.slice(0, 6) …))
 *
 * `npm run fidelity` measures the same thing in a browser against the
 * prototype itself. These are the fast half — and they also cover the four
 * things a landmark count cannot see:
 *
 *  - **What the phone DROPS.** The desk's filter bar, its hour chart and its
 *    "Open analytics" button are all absent from `P.orders.phone()`. A
 *    landmark count notices a missing `.filters`; it does not notice a search
 *    box that was quietly kept because it seemed useful.
 *  - **The six-row cap.** `ORDERS.slice(0, 6)` is the prototype's own; a page
 *    handed a screenful of fifty would otherwise print all fifty.
 *  - **Where a row GOES.** `/m/orders/<id>`, the phone's own detail route —
 *    not the desk path the adapter carries.
 *  - **`.mtop`.** The fidelity phone surface is `.pframe .mscroll`, so the
 *    store selector and the date sheet are outside everything it compares.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, fireEvent, within } from "@testing-library/react"

const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))

import { CounterPhoneOrdersClient } from "@/app/(mobile)/m/orders/counter-phone-orders-client"
import { ready, failed } from "@/lib/counter/section-data"
import type { OrdersList, OrdersSections } from "@/lib/counter/adapters/orders"

const TODAY = new Date(2026, 7, 25) // Tuesday 25 Aug 2026

const STORES = [
  { id: "hollywood", name: "Hollywood", stage: "trading" as const },
  { id: "glendale", name: "Glendale", stage: "pre_open" as const },
]

/** The prototype's own four toggles — carried by the adapter, drawn by neither surface here. */
const TOGGLES = [
  { id: "house", label: "In-house", tint: "--ch-house", pressed: false },
  { id: "doordash", label: "DoorDash", tint: "--ch-dd", pressed: true },
  { id: "ubereats", label: "Uber Eats", tint: "--ch-ue", pressed: false },
  { id: "grubhub", label: "Grubhub", tint: "--ch-gh", pressed: false },
]

/**
 * EIGHT rows, because the prototype's `ORDERS` is eight and its phone slices
 * six off the front. A fixture of six could not tell a cap from a coincidence.
 *
 * Row 2 is the In-house one: its `fees` is the adapter's em dash, which the
 * prototype turns into "no fees" rather than "— fees". Row 8 carries a single
 * item, which is the only row that can catch "1 items".
 */
const ROWS: OrdersList["rows"] = [
  { key: "o1", href: "/dashboard/orders/o1", id: "#4821", time: "9:32pm", channel: { label: "DoorDash", tint: "var(--ch-dd)" }, items: "3", ticket: "$36.65", fees: "$9.16", net: "$27.49" },
  { key: "o2", href: "/dashboard/orders/o2", id: "#4820", time: "9:26pm", channel: { label: "In-house", tint: "var(--ch-house)" }, items: "2", ticket: "$24.80", fees: "—", net: "$24.80" },
  { key: "o3", href: "/dashboard/orders/o3", id: "#4819", time: "9:18pm", channel: { label: "Uber Eats", tint: "var(--ch-ue)" }, items: "4", ticket: "$48.10", fees: "$14.43", net: "$33.67" },
  { key: "o4", href: "/dashboard/orders/o4", id: "#4818", time: "9:09pm", channel: { label: "Grubhub", tint: "var(--ch-gh)" }, items: "2", ticket: "$31.20", fees: "$6.24", net: "$24.96" },
  { key: "o5", href: "/dashboard/orders/o5", id: "#4817", time: "9:02pm", channel: { label: "In-house", tint: "var(--ch-house)" }, items: "3", ticket: "$22.40", fees: "—", net: "$22.40" },
  { key: "o6", href: "/dashboard/orders/o6", id: "#4816", time: "8:58pm", channel: { label: "DoorDash", tint: "var(--ch-dd)" }, items: "2", ticket: "$29.90", fees: "$8.97", net: "$20.93" },
  { key: "o7", href: "/dashboard/orders/o7", id: "#4815", time: "8:51pm", channel: { label: "In-house", tint: "var(--ch-house)" }, items: "1", ticket: "$14.20", fees: "—", net: "$14.20" },
  { key: "o8", href: "/dashboard/orders/o8", id: "#4814", time: "8:44pm", channel: { label: "DoorDash", tint: "var(--ch-dd)" }, items: "5", ticket: "$61.80", fees: "$18.54", net: "$43.26" },
]

const list = (over: Partial<OrdersList> = {}): OrdersList => ({
  toggles: TOGGLES,
  search: "",
  count: "8 of 187",
  nextCursor: "cursor-9",
  rows: ROWS,
  ...over,
})

/** The DESK's five cells — the phone picks two of them and reads two more for its sub. */
const STRIP = [
  { label: "Orders", value: "187", delta: "▲ 5.1%" },
  { label: "Net sales", value: "$4,912", delta: "▲ 8.4%" },
  { label: "Avg ticket", value: "$26.27", delta: "▼ 1.2%", deltaTone: "is-down" as const },
  { label: "Marketplace fees", value: "$684", delta: "23.3% of 3P", deltaTone: "is-down" as const },
  { label: "Details not drained", value: "0", delta: "all drained", deltaTone: "is-flat" as const },
]

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
  strip: ready(STRIP),
  list: ready(list()),
  byHour: ready(BY_HOUR),
  ...over,
})

function renderPhone(params = "", over: Partial<OrdersSections> = {}) {
  push.mockClear()
  return render(
    <CounterPhoneOrdersClient
      params={params}
      stores={STORES}
      today={TODAY}
      sections={sections(over)}
    />,
  )
}

const scroll = (c: HTMLElement) => c.querySelector(".mscroll") as HTMLElement

/** The landmark classes the fidelity gate counts, in the order they render. */
const LANDMARKS = [
  "mstrip",
  "mlist",
  "moneyline",
  "sec",
  "sec__head",
  "sec__body",
  "wf",
  "blt",
  "band",
  "mhead",
  "strip",
  "sp",
  "tbl",
  "wkt",
  "filters",
  "chart",
]

function landmarkSequence(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>("*"))
    .map((el) => LANDMARKS.filter((c) => el.classList.contains(c)).join("."))
    .filter(Boolean)
}

const rows = (c: HTMLElement) => Array.from(c.querySelectorAll(".mli"))

beforeEach(() => push.mockClear())

describe("Counter Orders — the phone", () => {
  it("puts .ct-root and .ct-phone ABOVE .mscroll, so .mtop is inside the token root", () => {
    const { container } = renderPhone()
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toBe("ct-root ct-phone")
    expect([...root.children].map((c) => c.className)).toEqual(["mtop", "mscroll"])
  })

  it("composes the page in `P.orders.phone()`'s order — three blocks, nothing else", () => {
    const { container } = renderPhone()
    expect(landmarkSequence(scroll(container))).toEqual([
      "mstrip",
      "sec",
      "sec__head",
      "sec__body",
      "mlist",
    ])
  })

  /* ── What the phone does not draw ──────────────────────────────────── */

  it("draws NO filter bar — the prototype does not, so neither does this", () => {
    // The toggles and the search string are on `OrdersList` because the desk
    // needs them. Rendering them here because they arrived would be the phone
    // growing a landmark the design never drew (ruling F-R8).
    const { container } = renderPhone()
    expect(container.querySelector(".filters")).toBeNull()
    expect(container.querySelector("input[type=search]")).toBeNull()
    expect(container.querySelector(".tog")).toBeNull()
    expect(container.querySelector(".clear")).toBeNull()
    expect(container.textContent).not.toContain("8 of 187")
  })

  it("draws NO hour chart and no way to analytics — both are desk-only", () => {
    const { container } = renderPhone()
    expect(container.querySelector("svg.chart")).toBeNull()
    expect(container.textContent).not.toContain("band = the last four Tuesdays")
    expect(container.textContent).not.toContain("Open analytics")
    expect(container.querySelector(".btn")).toBeNull()
  })

  it("draws no pager, whatever cursor the adapter carried", () => {
    // `nextCursor` is on the fixture. The window above is what changes how
    // much is in the list — the same call the desk made.
    const { container } = renderPhone()
    expect(container.textContent).not.toContain("More")
    expect(container.textContent).not.toContain("Next")
  })

  /* ── The head ──────────────────────────────────────────────────────── */

  it("heads the page with its NAME and subs it with the count and the net", () => {
    const { container } = renderPhone()
    expect(container.querySelector(".mtitle")?.textContent).toBe("Orders")
    // `Math.round(R.orderTotal()).toLocaleString() + ' orders · ' + USD(R.netTotal())`,
    // and both figures come off the SAME `getOrdersSections` call the strip
    // below is drawn from — not a second loader, which is how one range ends
    // up with two answers.
    expect(container.querySelector(".msub")?.textContent).toBe("187 orders · $4,912")
  })

  it("counts orders, not rows: the sub reads the RANGE's total, not the six shown", () => {
    // The strip's figures cover the whole matched range; `rows` is one
    // screenful. A sub summed off the list would say "6 orders" on a
    // 187-order day and get quieter the further a reader scrolled.
    const { container } = renderPhone()
    expect(container.querySelector(".msub")?.textContent).not.toContain("6 orders")
  })

  /* ── The strip ─────────────────────────────────────────────────────── */

  it("draws the prototype's TWO cells — Orders and Avg ticket, not the desk's five", () => {
    const { container } = renderPhone()
    const strip = container.querySelector(".mstrip") as HTMLElement
    expect(Array.from(strip.querySelectorAll(".k")).map((e) => e.textContent)).toEqual([
      "Orders",
      "Avg ticket",
    ])
    expect(Array.from(strip.querySelectorAll(".v")).map((e) => e.textContent)).toEqual([
      "187",
      "$26.27",
    ])
    // Not the first two of the five: "Net sales" belongs to the sub here.
    expect(strip.textContent).not.toContain("$4,912")
    expect(strip.textContent).not.toContain("Marketplace fees")
  })

  it("keeps each cell's own delta and the tone the ADAPTER gave it", () => {
    // `['Avg ticket', …, '▼ 1.2%', 'is-down']` — the fourth slot is the
    // prototype's own. This page judges nothing (ruling O-R2).
    const { container } = renderPhone()
    const deltas = Array.from(container.querySelectorAll(".mstrip .d"))
    expect(deltas.map((e) => e.textContent)).toEqual(["▲ 5.1%", "▼ 1.2%"])
    expect(deltas.map((e) => e.className)).toEqual(["d", "d is-down"])
  })

  /* ── The six rows ──────────────────────────────────────────────────── */

  it("lists SIX rows — `ORDERS.slice(0, 6)`, the first six, newest first", () => {
    const { container } = renderPhone()
    const li = rows(container)
    expect(li).toHaveLength(6)
    expect(li.map((r) => r.querySelector("b")?.textContent)).toEqual([
      "#4821 · DoorDash",
      "#4820 · In-house",
      "#4819 · Uber Eats",
      "#4818 · Grubhub",
      "#4817 · In-house",
      "#4816 · DoorDash",
    ])
    // The two the cap drops are the two oldest, and they are GONE — not
    // hidden by CSS, which a landmark count would still see.
    expect(container.textContent).not.toContain("#4815")
    expect(container.textContent).not.toContain("#4814")
  })

  it("shows every row when there are fewer than six", () => {
    const { container } = renderPhone("", { list: ready(list({ rows: ROWS.slice(0, 3) })) })
    expect(rows(container)).toHaveLength(3)
  })

  it("says how many it showed, not how many matched", () => {
    // `sec('Latest', '8 shown', …)`. The desk's "8 of 187" is the filter
    // bar's count and the filter bar is not on this surface.
    const { container } = renderPhone()
    expect(container.querySelector(".sec__head h3")?.textContent).toBe("Latest")
    expect(container.querySelector(".sec__head .k")?.textContent).toBe("6 shown")
  })

  it("writes each row as `[id · channel, time · N items, net, fees]`", () => {
    const { container } = renderPhone()
    const first = rows(container)[0]
    expect(first.querySelector("b")?.textContent).toBe("#4821 · DoorDash")
    expect(first.querySelector("div > span")?.textContent).toBe("9:32pm · 3 items")
    // The NET, which is `ticket + commission` — never the ticket. See
    // `order-signs.ts`: this page does no arithmetic on either column.
    expect(first.querySelector(".rt")?.textContent).toBe("$27.49$9.16 fees")
    expect(first.querySelector(".rt em")?.className).toBe("")
  })

  it("says 'no fees' where the channel took none, never '— fees'", () => {
    // The prototype's own `o[6] === '&mdash;' ? 'no fees' : o[6] + ' fees'`.
    const { container } = renderPhone()
    expect(rows(container)[1].querySelector(".rt em")?.textContent).toBe("no fees")
  })

  it("pluralises the item count off the row's own figure", () => {
    const { container } = renderPhone("", { list: ready(list({ rows: [ROWS[6]] })) })
    expect(container.querySelector(".mli div > span")?.textContent).toBe("8:51pm · 1 item")
  })

  it("makes every row a LINK into the order on the PHONE's own detail route", () => {
    const { container } = renderPhone()
    const li = rows(container)
    expect(li.every((r) => r.tagName === "A")).toBe(true)
    // The adapter carries `/dashboard/orders/o1`, which the middleware would
    // rewrite — but a phone list that hands out desk paths puts a desk URL in
    // the address bar and in anything the reader shares from it.
    expect(li.map((r) => r.getAttribute("href"))).toEqual([
      "/m/orders/o1",
      "/m/orders/o2",
      "/m/orders/o3",
      "/m/orders/o4",
      "/m/orders/o5",
      "/m/orders/o6",
    ])
    expect(container.innerHTML).not.toContain("/dashboard/orders/")
  })

  /* ── The chrome the fidelity gate cannot see ───────────────────────── */

  it("renders the store and the date controls a phone-only reader needs", () => {
    const { container } = renderPhone()
    const top = container.querySelector(".mtop") as HTMLElement
    expect(top.querySelector(".st")?.tagName).toBe("BUTTON")
    expect(top.querySelector(".mdate")?.tagName).toBe("BUTTON")
  })

  it("the store control writes ?store on THIS page — the same parameter the desk writes", () => {
    const { container } = renderPhone()
    fireEvent.click(container.querySelector(".st")!)
    const sheet = document.getElementById(
      container.querySelector(".st")!.getAttribute("aria-controls")!,
    )!
    fireEvent.click(within(sheet).getByText("Hollywood"))
    expect(push).toHaveBeenCalledWith("/m/orders?store=hollywood", { scroll: false })
  })

  /* ── One section's failure is not another's ────────────────────────── */

  it("keeps the strip and the head when the LIST fails", () => {
    const { container } = renderPhone("", {
      list: failed("the orders query is down", "retryOrders"),
    })
    expect(container.querySelector(".mstrip")).not.toBeNull()
    expect(container.querySelector(".msub")?.textContent).toBe("187 orders · $4,912")
    expect(container.querySelector(".mlist")).toBeNull()
    expect(container.textContent).toContain("the orders query is down")
  })

  it("keeps the list when the STRIP fails, and says nothing it cannot count", () => {
    // The sub is the strip's own two figures. With the strip down there is no
    // count and no net — and a sub reading " orders · " is worse than none.
    const { container } = renderPhone("", {
      strip: failed("the totals are down", "retryOrders"),
    })
    expect(container.querySelector(".mtitle")?.textContent).toBe("Orders")
    expect(container.querySelector(".msub")).toBeNull()
    expect(rows(container)).toHaveLength(6)
  })
})

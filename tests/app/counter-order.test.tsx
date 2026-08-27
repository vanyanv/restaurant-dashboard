// @vitest-environment jsdom
/**
 * One order, on the desk — asserted against `P.order.desk()`'s own composition
 * (`docs/counter/counter-prototype.html:6572`).
 *
 * The prototype writes three blocks and nothing else:
 *
 *   strip([...five cells])                          page level, above any .sec
 *   <div class="split">sec('Items') sec('What you keep')</div>
 *   <div class="tri">sec('Timeline') sec('Platform') sec('Needs you')</div>
 *
 * and the page is declared `nodate: true` (line 6569), so the date control is
 * NOT drawn: one order does not have a range.
 *
 * `npm run fidelity` measures the same composition in a browser against the
 * prototype itself. These are the fast half, and they also cover the four
 * things a landmark count cannot see:
 *
 *  - **The em dash on a line that keeps nothing.** A $0.00 modifier divides
 *    into a margin of `0/0`; the adapter returns an em dash and the table has
 *    to print it rather than "NaN%" or "0%".
 *  - **The not-costed cell.** It is a warning, not a figure, and the prototype
 *    paints it `var(--bad)` — a reader must not read "not costed" as money.
 *  - **Tax, which is stated and never subtracted.** Prototype line 6600
 *    records this bug being repaired once already. Every `.mathline` IS summed
 *    into the figure below it, so the tax figure must appear ONLY in the prose.
 *  - **A 404 on an id that is not this account's.** `getOrderSections` answers
 *    `empty`; the page must answer `notFound()`, not a page of grey panels.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "@testing-library/react"

/*
 * `vi.hoisted`, not bare top-level consts: a `vi.mock` factory is evaluated
 * when the mocked module is first imported, which under ESM happens BEFORE any
 * statement in this file runs. A factory closing over an ordinary `const` reads
 * it in its temporal dead zone.
 */
const m = vi.hoisted(() => ({
  push: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
  redirect: vi.fn(),
  getOrderSections: vi.fn(),
  getOverviewStores: vi.fn(),
  getServerSession: vi.fn(),
}))

// Both the island's own controls and `Table`'s row navigation call
// `useRouter()`, and a plain RTL render is not an App Router tree.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: m.push }),
  notFound: m.notFound,
  redirect: m.redirect,
}))
// Mocked WHOLE rather than spied through `importOriginal`: both adapters pull
// `@/lib/prisma` in at module load, and a page test has no database.
vi.mock("@/lib/counter/adapters/orders", () => ({ getOrderSections: m.getOrderSections }))
vi.mock("@/lib/counter/adapters/overview", () => ({ getOverviewStores: m.getOverviewStores }))
vi.mock("next-auth", () => ({ getServerSession: m.getServerSession }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

import { CounterOrderClient } from "@/app/dashboard/orders/[id]/counter-order-client"
import OrderPage from "@/app/dashboard/orders/[id]/page"
import { ready, empty, failed, loading } from "@/lib/counter/section-data"
import type { OrderItems, OrderKeep, OrderSections } from "@/lib/counter/adapters/orders"
import type { KvRow, QueueItem } from "@/components/counter"

const TODAY = new Date(2026, 7, 25) // Tuesday 25 Aug 2026

const STORES = [
  { id: "hollywood", name: "Hollywood", stage: "trading" as const },
  { id: "glendale", name: "Glendale", stage: "pre_open" as const },
]

const SESSION = {
  user: { name: "Chris Karimian", role: "OWNER", accountId: "acc_1" },
}

const HEAD = { title: "Order #4821", sub: "DoorDash · Aug 21, 9:32pm · 3 items" }

/** `buildOrderStrip`'s five, in its order. Not one of them is judged (O-R2). */
const STRIP = [
  { label: "Ticket", value: "$36.65", delta: "DoorDash prices" },
  {
    label: "Commission",
    value: "−$9.16",
    delta: "25% of ticket",
    deltaTone: "is-down" as const,
  },
  { label: "You keep", value: "$27.49", delta: "75% of ticket" },
  {
    label: "Food cost",
    value: "−$8.10",
    delta: "1 line not costed",
    deltaTone: "is-down" as const,
  },
  { label: "Contribution", value: "$19.39", delta: "71% of what you keep" },
]

/**
 * Four lines: two ordinary items, one FREE modifier that IS costed (its keep
 * is zero, so its margin is the em dash), and one that is not costed at all.
 * A fixture without both could not tell the two em dashes apart.
 */
const ITEMS: OrderItems = {
  meta: "2 lines · 2 modifiers",
  rows: [
    {
      key: "l1",
      name: "The Family Box",
      modifier: false,
      qty: "1",
      price: "$37.20",
      keep: "$27.90",
      cost: "$11.40",
      margin: "59%",
      uncosted: false,
    },
    {
      key: "l2",
      name: "Add Grilled Onion",
      modifier: true,
      qty: "1",
      price: "$0.00",
      keep: "$0.00",
      cost: "$0.12",
      margin: "—",
      uncosted: false,
    },
    {
      key: "l3",
      name: "Add Pickle",
      modifier: true,
      qty: "1",
      price: "$0.00",
      keep: "$0.00",
      cost: "not costed",
      margin: "—",
      uncosted: true,
    },
    {
      key: "l4",
      name: "Vanilla Shake (20 oz cup)",
      modifier: false,
      qty: "1",
      price: "$3.59",
      keep: "$2.69",
      cost: "$0.94",
      margin: "65%",
      uncosted: false,
    },
  ],
  total: {
    key: "total",
    name: "Total",
    modifier: false,
    qty: "4",
    price: "$40.79",
    keep: "$30.59",
    cost: "$12.46",
    margin: "59%",
    uncosted: false,
  },
  // These lines already reach the order's ticket, so there is nothing to
  // reconcile. The chain itself is exercised below.
  reconcile: [],
}

const KEEP: OrderKeep = {
  rows: [
    { key: "ticket", label: "Ticket, as charged on DoorDash", value: "$36.65" },
    { key: "commission", label: "− commission 25%", op: true, value: "−$9.16" },
    { key: "net", label: "Net to you", strong: true, rule: true, value: "$27.49" },
    { key: "food", label: "− food cost", op: true, noBorder: true, value: "−$8.10" },
    {
      key: "contribution",
      label: "Contribution",
      strong: true,
      noBorder: true,
      value: "$19.39",
    },
  ],
  // THE TAX FIGURE. It appears here and must appear nowhere else on the page.
  note:
    "$4.85 of sales tax was collected and remitted by DoorDash. It is not in any figure above, " +
    "because it was never yours. $3.00 of tip was collected on this order. It is not in any " +
    "figure above, because a tip is not what the food earned.",
}

const TIMELINE: KvRow[] = [
  { label: "Placed", value: "9:32pm" },
  { label: "Status", value: "OFO_STATUS_FULFILLED" },
  { label: "Acceptance", value: "Accepted" },
  { label: "Lines drained", value: "Jul 26, 3:10am" },
  { label: "Synced to us", value: "Jul 26, 3:12am" },
]

const PLATFORM: KvRow[] = [
  { label: "Channel", value: "DoorDash" },
  { label: "External id", value: "24FA9B55" },
  { label: "Otter id", value: "1f708833" },
  { label: "Fulfilment", value: "FULFILLMENT_MODE_OFO_DELIVERY" },
  { label: "Store", value: "Hollywood" },
  { label: "Customer", value: "Lucas L" },
]

const NEEDS: QueueItem[] = [
  {
    key: "sku-pickle",
    tone: "warn",
    lead: "188",
    unit: "orders",
    title: "A modifier is not costed: Add Pickle",
    body: "Add Pickle is on this order and it has no recipe behind it, so every order carrying it overstates what you keep. It sold 188 times in the last 90 days.",
  },
]

const sections = (over: Partial<OrderSections> = {}): OrderSections => ({
  head: ready(HEAD),
  strip: ready(STRIP),
  items: ready(ITEMS),
  keep: ready(KEEP),
  timeline: ready(TIMELINE),
  platform: ready(PLATFORM),
  needsYou: ready(NEEDS),
  ...over,
})

function renderDesk(over: Partial<OrderSections> = {}) {
  m.push.mockClear()
  return render(
    <CounterOrderClient
      pathname="/dashboard/orders/1f708833"
      stores={STORES}
      user={{ name: "Chris Karimian", role: "Owner" }}
      today={TODAY}
      sections={sections(over)}
    />,
  )
}

const main = (c: HTMLElement) => c.querySelector("main#ct-main") as HTMLElement

/** The landmark classes the fidelity gate counts, in the order they render. */
const LANDMARKS = [
  "strip",
  "split",
  "tri",
  "sec",
  "sec__head",
  "sec__body",
  "tbl",
  "kv",
  "queue",
  "mathline",
  "moneyline",
  "chart",
  "filters",
  "mlist",
  "mstrip",
]

function landmarkSequence(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>("*"))
    .map((el) => LANDMARKS.filter((c) => el.classList.contains(c)).join("."))
    .filter(Boolean)
}

const itemRows = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLElement>(".tbl tbody tr"))
const cellsOf = (tr: HTMLElement) =>
  Array.from(tr.querySelectorAll("td")).map((td) => td.textContent)

beforeEach(() => {
  m.push.mockClear()
  m.notFound.mockClear()
  m.getOrderSections.mockReset()
  m.getOverviewStores.mockReset().mockResolvedValue(STORES)
  m.getServerSession.mockReset().mockResolvedValue(SESSION)
})

describe("Counter one order — the desk", () => {
  it("composes the page in `P.order.desk()`'s order and nothing else", () => {
    const { container } = renderDesk()
    expect(landmarkSequence(main(container))).toEqual([
      "strip",
      "split",
      "sec",
      "sec__head",
      "tbl",
      "sec",
      "sec__head",
      "sec__body",
      "mathline",
      "mathline",
      "mathline",
      "mathline",
      "mathline",
      "tri",
      "sec",
      "sec__head",
      "sec__body",
      "kv",
      "sec",
      "sec__head",
      "sec__body",
      "kv",
      "sec",
      "sec__head",
      "sec__body",
      "queue",
    ])
  })

  it("puts TWO sections in .split and THREE in .tri", () => {
    const { container } = renderDesk()
    const split = container.querySelector(".split") as HTMLElement
    const tri = container.querySelector(".tri") as HTMLElement
    expect(Array.from(split.children).map((c) => c.tagName)).toEqual(["SECTION", "SECTION"])
    expect(Array.from(tri.children).map((c) => c.tagName)).toEqual([
      "SECTION",
      "SECTION",
      "SECTION",
    ])
    expect(Array.from(split.querySelectorAll("h3")).map((h) => h.textContent)).toEqual([
      "Items",
      "What you keep",
    ])
    expect(Array.from(tri.querySelectorAll("h3")).map((h) => h.textContent)).toEqual([
      "Timeline",
      "Platform",
      "Needs you",
    ])
  })

  /* ── nodate ────────────────────────────────────────────────────────── */

  it("draws NO date control — the page is `nodate: true`, and one order has no range", () => {
    // Note 46's defect is a control that is present and inert. The control is
    // not hidden here, it is not rendered: `.phactions` is emitted only when
    // there is something to put in it, so there is nothing to hide.
    const { container } = renderDesk()
    expect(container.querySelector(".phactions")).toBeNull()
    expect(container.querySelector(".cd")).toBeNull()
    expect(container.textContent).not.toContain("Compare")
  })

  it("heads the page with the order and its own sentence", () => {
    const { container } = renderDesk()
    expect(container.querySelector(".pagehead h2")?.textContent).toBe("Order #4821")
    expect(container.querySelector(".pagehead .sub")?.textContent).toBe(
      "DoorDash · Aug 21, 9:32pm · 3 items",
    )
    // The trail names the RECORD, not the destination — "Order #4821" beats
    // a second "Orders".
    expect(container.querySelector(".crumbs b")?.textContent).toBe("Order #4821")
  })

  /* ── The items table ───────────────────────────────────────────────── */

  it("names the price column after the channel that charged it", () => {
    const { container } = renderDesk()
    expect(Array.from(container.querySelectorAll(".tbl th")).map((t) => t.textContent)).toEqual([
      "Item",
      "Qty",
      "DoorDash price",
      "After commission",
      "Food cost",
      "Margin",
    ])
  })

  it("prints the ADAPTER's em dash on a line that keeps nothing", () => {
    // A free modifier keeps $0.00, so its margin is 0/0. `marginFigure` guards
    // it and the table prints what the adapter said — not "NaN%", not "0%",
    // which would read as a costed line earning nothing.
    const { container } = renderDesk()
    const onion = itemRows(main(container))[1]
    expect(cellsOf(onion)).toEqual(["  — Add Grilled Onion", "1", "$0.00", "$0.00", "$0.12", "—"])
  })

  it("draws `not costed` as a warning, not as a figure", () => {
    const { container } = renderDesk()
    const pickle = itemRows(main(container))[2]
    const cell = pickle.querySelectorAll("td")[4]
    expect(cell.textContent).toBe("not costed")
    const marked = cell.querySelector("span")
    expect(marked).not.toBeNull()
    expect(marked?.getAttribute("style")).toContain("var(--bad)")
  })

  it("indents a modifier and bolds an item, exactly as the prototype does", () => {
    const { container } = renderDesk()
    const rows = itemRows(main(container))
    expect(rows[0].querySelector("td b")?.textContent).toBe("The Family Box")
    expect(rows[1].querySelector("td b")).toBeNull()
    expect(rows[1].querySelectorAll("td")[0].textContent).toBe("  — Add Grilled Onion")
  })

  it("closes the table with the ADAPTER's total row, every cell bold", () => {
    const { container } = renderDesk()
    const rows = itemRows(main(container))
    expect(rows).toHaveLength(5) // four lines + the total
    const total = rows[4]
    expect(cellsOf(total)).toEqual(["Total", "4", "$40.79", "$30.59", "$12.46", "59%"])
    expect(total.querySelectorAll("td b")).toHaveLength(6)
  })

  /*
   * The chain the adapter draws under the Total when the drained lines do not
   * reach the ticket — 60 of the 500 most recently drained orders, including
   * the fidelity gate's own pinned one ($32.19 of lines on a $35.19 ticket).
   * Without it the table's bottom line sat under a strip saying something else
   * and the page reconciled neither.
   */
  it("draws the shortfall and the ticket under the total, and bolds the ticket", () => {
    const { container } = renderDesk({
      items: ready({
        ...ITEMS,
        reconcile: [
          { key: "missing", label: "Not on any line here", price: "$3.00", keep: "$2.25", strong: false },
          { key: "ticket", label: "Ticket", price: "$35.19", keep: "$26.39", strong: true },
        ],
      }),
    })
    const rows = itemRows(main(container))
    expect(rows).toHaveLength(7) // four lines, the total, and the two-row chain
    // Qty, food cost and margin are absent rather than dashed: there is no
    // quantity of "not on any line here" to state.
    expect(cellsOf(rows[5])).toEqual(["Not on any line here", "", "$3.00", "$2.25", "", ""])
    expect(cellsOf(rows[6])).toEqual(["Ticket", "", "$35.19", "$26.39", "", ""])
    expect(rows[5].querySelectorAll("td b")).toHaveLength(0)
    expect(rows[6].querySelectorAll("td b")).toHaveLength(3)
  })

  it("draws nothing extra when the lines already reach the ticket", () => {
    const { container } = renderDesk()
    expect(itemRows(main(container))).toHaveLength(5)
  })

  it("makes no row a link — the adapter carries no destination for a line", () => {
    // The prototype's `tbl(…, 'catalogitem')` opens a menu-item page from every
    // item row. `OrderItemRow` has no href, and a row that wears the cursor,
    // the hover wash and the chevron and then goes nowhere is note 46's defect.
    const { container } = renderDesk()
    expect(main(container).querySelectorAll(".tbl tbody tr[data-goto]")).toHaveLength(0)
    expect(main(container).querySelectorAll('.tbl tbody tr[role="link"]')).toHaveLength(0)
  })

  /* ── What you keep ─────────────────────────────────────────────────── */

  it("keeps TAX out of the money rows and states it in the prose below", () => {
    const { container } = renderDesk()
    const lines = Array.from(container.querySelectorAll(".mathline")).map((l) => l.textContent)
    expect(lines).toEqual([
      "Ticket, as charged on DoorDash$36.65",
      "− commission 25%−$9.16",
      "Net to you$27.49",
      "− food cost−$8.10",
      "Contribution$19.39",
    ])
    // Every `.mathline` IS summed into the figure below it, so a tax row would
    // be an operation drawn and then not applied — the exact bug prototype
    // line 6600 records repairing.
    for (const line of lines) expect(line).not.toContain("$4.85")
    const prose = container.querySelector(".split .mono") as HTMLElement
    expect(prose.textContent).toContain("$4.85 of sales tax")
    expect(prose.textContent).toContain("never yours")
  })

  /* ── The three small sections ──────────────────────────────────────── */

  it("metas Timeline `from the POS`, Platform with the channel, Needs you with the count", () => {
    const { container } = renderDesk()
    const tri = container.querySelector(".tri") as HTMLElement
    expect(Array.from(tri.querySelectorAll(".sec__head .k")).map((k) => k.textContent)).toEqual([
      "from the POS",
      "DoorDash",
      "1",
    ])
  })

  it("draws an EMPTY `Needs you` as an empty section, not a queue of nothing", () => {
    const { container } = renderDesk({ needsYou: empty("no_match") })
    const tri = container.querySelector(".tri") as HTMLElement
    expect(tri.querySelector(".queue")).toBeNull()
    expect(Array.from(tri.querySelectorAll("h3")).map((h) => h.textContent)).toEqual([
      "Timeline",
      "Platform",
      "Needs you",
    ])
    expect(tri.querySelector(".empty")).not.toBeNull()
  })

  it("wears no `.do` button — the queue carries no destination for a mapping", () => {
    // `buildNeedsYou` deliberately wires no `act`, and the page cannot supply
    // one: an unmapped ITEM is mapped on /dashboard/menu/catalog and an
    // unmapped MODIFIER on /dashboard/ingredients, and `QueueItem` does not
    // say which of the two this is. One button would send half the readers to
    // the wrong page.
    const { container } = renderDesk()
    expect(container.querySelector(".queue .do")).toBeNull()
  })

  /* ── States ────────────────────────────────────────────────────────── */

  it("lets one section fail without taking the rest of the page with it", () => {
    const { container } = renderDesk({ items: failed("Otter timed out", "retryOrder") })
    expect(container.querySelector(".tbl")).toBeNull()
    expect(container.textContent).toContain("Otter timed out")
    // The other four still drew their figures.
    expect(container.querySelectorAll(".mathline")).toHaveLength(5)
    expect(container.querySelectorAll(".kv")).toHaveLength(2)
  })

  it("falls back to a title rather than an empty masthead when the head is still loading", () => {
    const { container } = renderDesk({ head: loading() })
    expect(container.querySelector(".pagehead h2")?.textContent).toBe("Order")
    expect(container.querySelector(".pagehead .sub")).toBeNull()
  })
})

describe("Counter one order — the desk page", () => {
  const call = () => OrderPage({ params: Promise.resolve({ id: "nope" }) })

  it("404s on an id that does not exist or is not this account's", async () => {
    // `getOrderDetail` returns null for both, `classify`'s `isEmpty` turns
    // that into `empty`, and the page must not render an order-shaped page
    // around nothing.
    m.getOrderSections.mockResolvedValue(sections({ head: empty("no_match") }))
    await expect(call()).rejects.toThrow("NEXT_NOT_FOUND")
    expect(m.notFound).toHaveBeenCalledTimes(1)
  })

  it("does NOT 404 when the load FAILED — that is an outage, not a missing order", async () => {
    // The distinction `isMissing` exists for. 404ing here would tell the one
    // reader who needs the truth that their order does not exist.
    m.getOrderSections.mockResolvedValue(sections({ head: failed("db down", "retryOrder") }))
    await expect(call()).resolves.toBeTruthy()
    expect(m.notFound).not.toHaveBeenCalled()
  })

  it("calls the adapter exactly ONCE, with the id and the session's account", async () => {
    m.getOrderSections.mockResolvedValue(sections())
    await OrderPage({ params: Promise.resolve({ id: "1f708833" }) })
    expect(m.getOrderSections).toHaveBeenCalledTimes(1)
    expect(m.getOrderSections).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "1f708833", accountId: "acc_1" }),
    )
  })
})
